defmodule NovelApplication.CreativeArtifactTest do
  @moduledoc """
  Creative artifact runtime contract tests.

  These tests protect the v3 correction: concrete production capabilities
  dispatch through the agent toolbox, ToolResult is converted by
  ArtifactAssembler, and UI cards/actions are assembled semantically.
  """

  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Toolbox
  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.TentativeArtifactSet

  defp provider_execution(result_fn), do: %Execution{result_fn: result_fn}

  describe "production capability registry" do
    test "does not include removed generic creative capability" do
      removed_capability = "creative_" <> "generation"

      refute removed_capability in CapabilityRegistry.list()
      assert CapabilityRegistry.get(removed_capability) == nil
      refute CapabilityRegistry.dispatchable?(removed_capability)
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

    test "world_building chooses specific archive artifact types from author intent" do
      cases = [
        {"设计一个跨三卷回收的伏笔线索", :foreshadowing_seed},
        {"制定一条后续写作规则，约束战斗段落文风", :style_rule_seed},
        {"制定一个会持续制造选择压力的世界规则", :world_rule_seed},
        {"禁止提前揭示矿区旧账谜底", :constraint_seed}
      ]

      for {brief, artifact_type} <- cases do
        result =
          Toolbox.execute(
            request("world_building", %{"text" => brief, "creative_brief" => brief}),
            fixed_json_provider([single_item(to_string(artifact_type))])
          )

        assert result.status == :succeeded
        assert result.output.artifact_type == artifact_type
      end
    end

    test "provider failure returns failed ToolResult without artifact output" do
      result =
        Toolbox.execute(
          request("prose_writing"),
          provider_execution(fn _prompt -> {:error, %{reason: :down}} end)
        )

      assert result.status == :failed
      assert result.output == nil
      assert result.artifact_refs == []
      assert [%{code: "provider_error"}] = result.errors
    end
  end

  describe "ArtifactAssembler" do
    test "assembles primary prose and companion seeds as separate tentative sets" do
      result = %ToolResult{
        tool_result_id: "tr-companions",
        tool_request_ref: "tq-companions",
        tool_name: "prose_writing",
        status: :succeeded,
        output: %{
          artifact_type: :prose_fragment,
          items: [%{item_id: "prose", title: "正文", body: "正文", rationale: nil}],
          companion_artifacts: [
            %{
              artifact_type: :character_seed,
              items: [
                %{item_id: "char", title: "岑雾", body: "巡夜人", rationale: "正文首次出场"}
              ]
            },
            %{
              artifact_type: :world_rule_seed,
              items: [
                %{item_id: "rule", title: "灯禁", body: "日落后禁灯", rationale: "正文依据"}
              ]
            }
          ]
        }
      }

      assert {:ok, [prose, character, rule]} =
               ArtifactAssembler.assemble_all(result, "turn-companions", %{
                 authoring_intent: :continuation,
                 target_chapter: "第01章：灯禁"
               })

      assert prose.artifact_type == :prose_fragment
      assert prose.authoring_intent == :continuation
      assert prose.target_chapter == "第01章：灯禁"
      assert character.artifact_type == :character_seed
      assert character.authoring_intent == nil
      assert character.target_chapter == nil
      assert rule.artifact_type == :world_rule_seed
      assert Enum.all?([prose, character, rule], &(&1.adoption_status == :tentative))
      assert Enum.all?([prose, character, rule], &(&1.source_tool_result_ref == "tr-companions"))
    end

    test "accepts world_setting as a tentative artifact type" do
      result =
        Toolbox.execute(request("world_building"), fixed_json_provider([single_item("world")]))

      assert {:ok, %TentativeArtifactSet{} = artifact_set} =
               ArtifactAssembler.assemble(result, "turn-world")

      assert artifact_set.artifact_type == :world_setting
      assert artifact_set.adoption_status == :tentative
      assert artifact_set.source_turn_ref == "turn-world"
    end

    test "carries authoring_intent + target_chapter provenance when provided" do
      result =
        Toolbox.execute(request("prose_writing"), fixed_json_provider([single_item("prose")]))

      assert {:ok, %TentativeArtifactSet{} = artifact_set} =
               ArtifactAssembler.assemble(result, "turn-prose", %{
                 authoring_intent: :continuation,
                 target_chapter: "第01章：底层灵气账单"
               })

      assert artifact_set.authoring_intent == :continuation
      assert artifact_set.target_chapter == "第01章：底层灵气账单"
    end

    test "defaults provenance to nil when not provided (backward compatible)" do
      result =
        Toolbox.execute(request("prose_writing"), fixed_json_provider([single_item("prose")]))

      assert {:ok, %TentativeArtifactSet{} = artifact_set} =
               ArtifactAssembler.assemble(result, "turn-prose")

      assert artifact_set.authoring_intent == nil
      assert artifact_set.target_chapter == nil
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
                 items: [%{item_id: "char", title: "title-char", body: "body-char"}]
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

  defp request(tool_name, input_overrides \\ %{}) do
    entry = CapabilityRegistry.get(tool_name)

    input =
      Map.merge(
        %{"text" => "fixture text #{tool_name}", "creative_brief" => "brief #{tool_name}"},
        input_overrides
      )

    %ToolRequest{
      tool_request_id: "tq-#{tool_name}-#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "turn-#{tool_name}",
      frame_ref: "frame-#{tool_name}",
      decision_ref: "decision-#{tool_name}",
      tool_name: tool_name,
      tool_version: (entry && entry.tool_version) || "unknown",
      input: input,
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
    provider_execution(fn _prompt -> {:ok, %{content: json}} end)
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

end
