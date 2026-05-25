defmodule NovelApplication.CreativeArtifactTest do
  @moduledoc """
  Creative artifact runtime contract tests.

  These tests protect the v3 correction: concrete production capabilities
  dispatch through the agent toolbox, ToolResult is converted by
  ArtifactAssembler, and UI cards/actions are assembled semantically.
  """

  use ExUnit.Case, async: true

  alias NovelAgent.Toolbox
  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.DialogueGateway
  alias NovelApplication.Planner
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.TentativeArtifactSet

  describe "production capability registry" do
    test "does not include removed generic creative capability" do
      removed_capability = "creative_" <> "generation"

      refute removed_capability in CapabilityRegistry.list()
      assert CapabilityRegistry.get(removed_capability) == nil
      refute CapabilityRegistry.dispatchable?(removed_capability)
    end

    test "planner prompt does not list removed generic creative capability" do
      removed_capability = "creative_" <> "generation"
      {:ok, prompt_agent} = Agent.start_link(fn -> [] end)

      complete_fn = fn prompt ->
        Agent.update(prompt_agent, &[prompt | &1])
        {:ok, %{content: plan_json("character_design")}}
      end

      assert {:ok, _plan} =
               Planner.form_micro_plan(frame("turn-planner"), %{text: "生成角色"}, complete_fn)

      prompts = Agent.get(prompt_agent, & &1)
      refute Enum.any?(prompts, &String.contains?(&1, removed_capability))
    end

    test "DialogueGateway source does not contain creative keyword classifier functions" do
      source =
        File.read!(Path.expand("../../lib/novel_application/dialogue_gateway.ex", __DIR__))

      refute String.contains?(source, "creative_direction")
      refute String.contains?(source, "contains_any")
      refute String.contains?(source, "creative_tool?")
    end

    test "keeps concrete creative capabilities dispatchable" do
      for tool <- ~w(character_design plot_outline prose_writing world_building) do
        entry = CapabilityRegistry.get(tool)
        assert entry.status == :active
        assert entry.tool_layer == :creative
        assert CapabilityRegistry.dispatchable?(tool)
      end
    end
  end

  describe "agent toolbox creative adapters" do
    test "removed generic creative capability returns failed ToolResult" do
      result = Toolbox.execute(request("creative_" <> "generation"))

      assert %ToolResult{status: :failed, output: nil, artifact_refs: []} = result
      assert [%{code: "unknown_tool"}] = result.errors
    end

    test "concrete creative adapters map to contract artifact types" do
      cases = [
        {"character_design", :character_seed},
        {"plot_outline", :outline_draft},
        {"prose_writing", :prose_fragment},
        {"world_building", :world_setting}
      ]

      for {tool, artifact_type} <- cases do
        result = Toolbox.execute(request(tool), fixed_json_provider([single_item(tool)]))

        assert result.status == :succeeded
        assert result.output.artifact_type == artifact_type
        assert result.output.output_contract_ref == "tentative_artifact_v1"
        assert [%{item_id: ^tool, title: title, body: body}] = result.output.items
        assert title == "title-#{tool}"
        assert body == "body-#{tool}"
        assert result.artifact_refs == [tool]
        refute Enum.any?(result.state_delta, &(&1[:type] == :production_write))
      end
    end

    test "provider failure returns failed ToolResult without artifact output" do
      result =
        Toolbox.execute(request("prose_writing"), fn _prompt -> {:error, %{reason: :down}} end)

      assert result.status == :failed
      assert result.output == nil
      assert result.artifact_refs == []
      assert [%{code: "provider_error"}] = result.errors
    end
  end

  describe "ArtifactAssembler" do
    test "accepts world_setting as a tentative artifact type" do
      result =
        Toolbox.execute(request("world_building"), fixed_json_provider([single_item("world")]))

      assert {:ok, %TentativeArtifactSet{} = artifact_set} =
               ArtifactAssembler.assemble(result, "turn-world")

      assert artifact_set.artifact_type == :world_setting
      assert artifact_set.adoption_status == :tentative
      assert artifact_set.source_turn_ref == "turn-world"
    end

    test "unknown artifact_type is validation failure and never falls back" do
      result = %ToolResult{
        tool_result_id: "tr-unknown",
        tool_request_ref: "tq-unknown",
        tool_name: "character_design",
        status: :succeeded,
        output: %{artifact_type: :unknown_type, items: [%{item_id: "i", title: "T", body: "B"}]}
      }

      assert {:error, %{code: "unknown_artifact_type"}} =
               ArtifactAssembler.assemble(result, "turn-unknown")
    end

    test "failed ToolResult does not create TentativeArtifactSet" do
      result = %ToolResult{
        tool_result_id: "tr-failed",
        tool_request_ref: "tq-failed",
        tool_name: "prose_writing",
        status: :failed,
        errors: [%{code: "provider_error", message: "down"}]
      }

      assert {:error, %{code: "tool_result_not_succeeded"}} =
               ArtifactAssembler.assemble(result, "turn-failed")
    end
  end

  describe "TurnResult semantic projection" do
    test "creative artifact emits candidate_set card without actions and separate available_actions" do
      result =
        Toolbox.execute(request("character_design"), fixed_json_provider([single_item("char")]))

      {:ok, artifact_set} = ArtifactAssembler.assemble(result, "turn-card")
      frame = frame("turn-card")

      turn_result =
        TurnResultBuilder.build(frame, %{trace_ref: "trace-card"}, [], nil, result, artifact_set)

      assert [
               %{
                 card_type: "candidate_set",
                 artifact_type: :character_seed,
                 items: [%{item_id: "char"}]
               } = card
             ] = turn_result.ui_cards

      refute Map.has_key?(card, :actions)

      assert Enum.any?(turn_result.available_actions, &(&1.action_type == "accept"))
      assert Enum.any?(turn_result.available_actions, &(&1.action_type == "discard"))
      assert Enum.any?(turn_result.available_actions, &(&1.action_type == "edit_then_accept"))
      refute Map.has_key?(turn_result, :task_state_events)
      assert turn_result.truthfulness.artifact_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
    end

    test "choose_candidate action is selection intent only, not adoption" do
      frame = frame("turn-candidate")

      candidate = %NovelDomain.CandidateDirection{
        direction_id: "dir-1",
        source_frame_ref: frame.frame_id,
        title: "方向一",
        pitch: "继续探索",
        tone_tags: [],
        adoption_status: :not_adopted
      }

      turn_result = TurnResultBuilder.build(frame, %{trace_ref: "trace-candidate"}, [candidate])

      assert [
               %{
                 action_type: "choose_candidate",
                 candidate_ref: "dir-1",
                 target_ref: "dir-1"
               }
             ] = turn_result.available_actions

      assert turn_result.truthfulness.artifact_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
    end
  end

  describe "DialogueGateway tool execution path" do
    test "successful creative tool turn has no synthetic task_state_events" do
      complete_fn =
        sequenced_complete_fn([
          frame_json(),
          plan_json("character_design"),
          Jason.encode!([single_item("gateway")]),
          "已生成待确认的创作材料，尚未采纳。"
        ])

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "生成角色设定", workspace_id: "ws-gateway", generate_micro_plan: true},
          nil,
          complete_fn
        )

      assert turn_result.tool_result.tool_name == "character_design"
      assert turn_result.tool_result.output.artifact_type == :character_seed
      assert [%{card_type: "candidate_set"}] = turn_result.ui_cards
      refute Map.has_key?(turn_result, :task_state_events)
    end

    test "explicit prose request overrides exploratory candidate frame and dispatches prose tool" do
      exploratory_frame_json =
        Jason.encode!(%{
          "frame_type" => "creative_exploration",
          "dialogue_goal_summary" => "推进开篇场景创作",
          "needs_tool" => false,
          "no_tool_reason" => "exploratory_only",
          "execution_readiness" => "not_applicable",
          "assistant_message" => "我为你准备了三种开篇写法。",
          "candidate_directions" => [
            %{
              "title" => "内心独白型开篇",
              "pitch" => "聚焦三秒内的心理博弈。",
              "tone_tags" => ["紧张"]
            },
            %{
              "title" => "视觉冲击型开篇",
              "pitch" => "用数据流和动作场面交织。",
              "tone_tags" => ["快节奏"]
            }
          ],
          "context_used" => true,
          "uncertainty" => []
        })

      complete_fn =
        sequenced_complete_fn([
          exploratory_frame_json,
          plan_json("prose_writing"),
          Jason.encode!([single_item("opening-scene")]),
          "已生成待确认的开篇场景，尚未采纳。"
        ])

      {:ok, turn_result, _trace, candidates, _context} =
        DialogueGateway.handle_input(
          %{
            text: "1. **开篇场景**：从AI提示生存率28%的瞬间切入，描写主角在3秒内的心理博弈与抉择",
            workspace_id: "ws-opening-scene"
          },
          nil,
          complete_fn
        )

      assert candidates == []
      refute Map.has_key?(turn_result, :candidate_directions)
      assert turn_result.frame_summary.frame_type == :creative_exploration
      assert turn_result.tool_result.tool_name == "prose_writing"
      assert turn_result.tool_result.output.artifact_type == :prose_fragment
      assert turn_result.truthfulness.tool_called == true
    end

    test "provider failure is honest failed TurnResult with no card or actions" do
      complete_fn =
        sequenced_complete_fn([
          frame_json(),
          plan_json("prose_writing"),
          "not json"
        ])

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "生成正文草稿", workspace_id: "ws-failed", generate_micro_plan: true},
          nil,
          complete_fn
        )

      assert turn_result.phase == "failed"
      assert turn_result.status == "failed"
      assert turn_result.tool_result.status == :failed
      assert turn_result.ui_cards == []
      assert turn_result.available_actions == []
      refute Map.has_key?(turn_result, :adoption_state)
    end
  end

  defp request(tool_name) do
    entry = CapabilityRegistry.get(tool_name)

    %ToolRequest{
      tool_request_id: "tq-#{tool_name}-#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "turn-#{tool_name}",
      frame_ref: "frame-#{tool_name}",
      decision_ref: "decision-#{tool_name}",
      tool_name: tool_name,
      tool_version: (entry && entry.tool_version) || "unknown",
      input: %{"text" => "fixture text #{tool_name}", "creative_brief" => "brief #{tool_name}"},
      read_scope_grants: (entry && entry.read_scopes) || [],
      write_scope_grants: [],
      idempotency_key: "idem-#{tool_name}",
      created_at: DateTime.utc_now()
    }
  end

  defp single_item(id) do
    %{
      "item_id" => id,
      "title" => "title-#{id}",
      "body" => "body-#{id}",
      "rationale" => nil
    }
  end

  defp fixed_json_provider(items) do
    json = Jason.encode!(items)
    fn _prompt -> {:ok, %{content: json}} end
  end

  defp frame(turn_id) do
    %NovelDomain.DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-#{turn_id}",
      turn_id: turn_id,
      workspace_id: "ws",
      primary: true,
      frame_type: :casual_reply,
      source_refs: %{},
      dialogue_goal: %{summary: "测试"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "测试"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp frame_json do
    Jason.encode!(%{
      "frame_type" => "casual_reply",
      "dialogue_goal_summary" => "用户要求创作",
      "needs_tool" => false,
      "no_tool_reason" => "no_tool_needed",
      "execution_readiness" => "not_applicable",
      "assistant_message" => "收到。",
      "candidate_directions" => [],
      "context_used" => false,
      "uncertainty" => []
    })
  end

  defp plan_json(tool_name) do
    Jason.encode!(%{
      "plan_goal_summary" => "调用 #{tool_name}",
      "risk_hint" => "low",
      "requires_confirmation_hint" => false,
      "proposed_actions" => [
        %{
          "action_id" => "a1",
          "action_type" => "capability_invocation",
          "summary" => "调用 #{tool_name}",
          "target_ref" => tool_name,
          "write_intent" => "tentative",
          "risk_hint" => "low"
        }
      ],
      "state_changes_requested" => [],
      "required_capabilities" => [tool_name],
      "fallback_message" => "无法执行"
    })
  end

  defp sequenced_complete_fn(responses) do
    {:ok, agent} = Agent.start_link(fn -> responses end)

    fn _prompt ->
      {:ok, %{content: next_response(agent)}}
    end
  end

  defp next_response(agent) do
    Agent.get_and_update(agent, fn
      [next | rest] -> {next, rest}
      [] -> {"工具执行完成。", []}
    end)
  end
end
