defmodule NovelApplication.CreativeArtifactTest do
  use ExUnit.Case, async: true

  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.DialogueGateway
  alias NovelApplication.Toolbox
  alias NovelApplication.TurnResultBuilder
  alias NovelDomain.TentativeArtifactSet
  alias NovelDomain.ToolRequest

  # ── Registry ──────────────────────────────────

  describe "creative_generation tool registration" do
    test "is registered and active" do
      entry = CapabilityRegistry.get("creative_generation")
      assert entry != nil
      assert entry.status == :active
      assert entry.tool_layer == :creative
      assert entry.risk_class == :medium
      assert CapabilityRegistry.dispatchable?("creative_generation")
    end

    test "has no write_scopes" do
      entry = CapabilityRegistry.get("creative_generation")
      assert entry.write_scopes == []
    end
  end

  # ── Toolbox creative dispatch ─────────────────

  describe "creative generation dispatch" do
    test "generates character_seed items" do
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req)

      assert result.status == :succeeded
      assert result.output.artifact_type == "character_seed"
      assert length(result.output.items) == 3
      assert Enum.all?(result.output.items, &(&1.title != nil and &1.body != nil))
    end

    test "generates plot_direction items" do
      req = build_creative_request("plot_direction")

      result = Toolbox.execute(req)
      assert result.status == :succeeded
      assert result.output.item_count == 2
    end

    test "typed plot_outline generates a P1 chapter plan artifact" do
      req = build_plot_outline_request()

      result = Toolbox.execute(req)

      assert result.status == :succeeded
      assert result.output.artifact_type == :outline_draft
      assert result.output.item_count == 12

      assert [
               %{title: "第01章：底层灵气账单"},
               _,
               _,
               _,
               _,
               _,
               _,
               _,
               _,
               _,
               _,
               %{title: "第12章：第一卷终局：灵气回流"}
             ] = result.output.items
    end

    test "result has tentative_artifact in state_delta" do
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req)

      assert Enum.any?(result.state_delta, &(&1.type == :tentative_artifact))
    end

    test "result has artifact_refs pointing to generated items" do
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req)

      assert result.artifact_refs != []
      assert length(result.artifact_refs) == 3
    end
  end

  # ── TentativeArtifactSet ──────────────────────

  describe "TentativeArtifactSet" do
    test "build_artifact_set from creative ToolResult" do
      req = build_creative_request("character_seed")
      result = Toolbox.execute(req)

      artifact_set = TurnResultBuilder.build_artifact_set(result, "turn-1")

      assert %TentativeArtifactSet{} = artifact_set
      assert artifact_set.artifact_type == :character_seed
      assert length(artifact_set.items) == 3
      assert artifact_set.adoption_status == :tentative
      assert artifact_set.source_tool_result_ref == result.tool_result_id
      assert artifact_set.source_turn_ref == "turn-1"
    end

    test "build_artifact_set preserves atom artifact_type from typed creative tools" do
      req = build_typed_creative_request("character_design")
      result = Toolbox.execute(req)

      assert result.output.artifact_type == :character_seed

      artifact_set = TurnResultBuilder.build_artifact_set(result, "turn-typed")

      assert artifact_set.artifact_type == :character_seed
    end

    test "tentative? returns true by default" do
      artifact_set = %TentativeArtifactSet{
        artifact_set_id: "as-1",
        artifact_type: :character_seed,
        source_turn_ref: "t-1",
        source_tool_result_ref: "tr-1"
      }

      assert TentativeArtifactSet.tentative?(artifact_set)
    end

    test "artifact items have required fields" do
      req = build_creative_request("character_seed")
      result = Toolbox.execute(req)
      artifact_set = TurnResultBuilder.build_artifact_set(result, "turn-1")

      for item <- artifact_set.items do
        assert item.item_id != nil
        assert item.title != nil
        assert item.body != nil
      end
    end
  end

  # ── Invariants ────────────────────────────────

  describe "tentative invariants" do
    test "creative tool has no write_scopes — cannot produce production fact" do
      entry = CapabilityRegistry.get("creative_generation")
      assert entry.write_scopes == []
    end

    test "artifacts default to tentative, not adopted" do
      artifact_set = %TentativeArtifactSet{
        artifact_set_id: "as-inv",
        artifact_type: :scene_draft,
        source_turn_ref: "t-inv",
        source_tool_result_ref: "tr-inv"
      }

      assert artifact_set.adoption_status == :tentative
      refute artifact_set.adoption_status == :adopted
    end

    test "tool provenance links result to request" do
      req = build_creative_request("character_seed")
      result = Toolbox.execute(req)

      assert result.tool_request_ref == req.tool_request_id
      assert result.tool_name == "creative_generation"
    end
  end

  describe "sync creative tool task_state events" do
    @frame_json """
    {
      "frame_type": "casual_reply",
      "dialogue_goal_summary": "用户要求创作角色",
      "needs_tool": false,
      "no_tool_reason": "no_tool_needed",
      "execution_readiness": "not_applicable",
      "assistant_message": "收到。",
      "candidate_directions": [],
      "context_used": false,
      "uncertainty": []
    }
    """

    @creative_plan_json """
    {
      "plan_goal_summary": "生成角色设定",
      "risk_hint": "low",
      "requires_confirmation_hint": false,
      "proposed_actions": [
        {"action_id": "a1", "action_type": "capability_invocation", "summary": "创作角色", "target_ref": "creative_generation", "write_intent": "tentative", "risk_hint": "low"}
      ],
      "state_changes_requested": [],
      "required_capabilities": [],
      "fallback_message": "无法生成角色"
    }
    """

    test "creative tool turn_result carries task_state lifecycle events" do
      complete_fn = sequenced_complete_fn([@frame_json, @creative_plan_json, "已经生成角色草案。"])

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "生成角色设定", workspace_id: "ws-task-state", generate_micro_plan: true},
          nil,
          complete_fn
        )

      phases = Enum.map(turn_result.task_state_events, & &1.phase)
      assert phases == ["RUNNING", "COMPLETED"]

      assert Enum.all?(turn_result.task_state_events, fn event ->
               event.task_id != nil and event.task_type == "creative_generation"
             end)
    end

    test "generic creative_generation keeps plot direction requests as plot artifacts" do
      plan_json = """
      {
        "plan_goal_summary": "生成剧情方向",
        "risk_hint": "low",
        "requires_confirmation_hint": false,
        "proposed_actions": [
          {"action_id": "a1", "action_type": "capability_invocation", "summary": "生成剧情方向", "target_ref": "creative_generation", "write_intent": "tentative", "risk_hint": "low"}
        ],
        "state_changes_requested": [],
        "required_capabilities": [],
        "fallback_message": "无法生成剧情方向"
      }
      """

      complete_fn = sequenced_complete_fn([@frame_json, plan_json, "已经生成剧情方向。"])

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "生成剧情方向", workspace_id: "ws-task-state", generate_micro_plan: true},
          nil,
          complete_fn
        )

      assert turn_result.tool_result.output.artifact_type == "plot_direction"
      assert [%{artifact_type: :plot_direction}] = turn_result.adoption_state.pending
    end

    test "plot_outline turn_result exposes chapter plan adoption payload" do
      plan_json = """
      {
        "plan_goal_summary": "生成章节计划",
        "risk_hint": "low",
        "requires_confirmation_hint": false,
        "proposed_actions": [
          {"action_id": "a1", "action_type": "capability_invocation", "summary": "生成章节计划", "target_ref": "plot_outline", "write_intent": "tentative", "risk_hint": "low"}
        ],
        "state_changes_requested": [],
        "required_capabilities": [],
        "fallback_message": "无法生成章节计划"
      }
      """

      complete_fn = sequenced_complete_fn([@frame_json, plan_json, "已生成章节计划草稿。"])

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "生成 10 万字长篇章节大纲", workspace_id: "ws-chapter-plan", generate_micro_plan: true},
          nil,
          complete_fn
        )

      assert turn_result.tool_result.output.artifact_type == :outline_draft

      assert [
               %{
                 artifact_type: :outline_draft,
                 payload: %{title: "P1 10 万字章节计划", chapter_count: 12, items: items}
               }
             ] = turn_result.adoption_state.pending

      assert length(items) == 12

      assert [
               %{
                 card_type: "adoption_card",
                 title: "章节计划待采纳",
                 body: body
               }
             ] = turn_result.ui_cards

      assert String.contains?(body, "12 章章节计划")
      assert String.contains?(body, "第01章：底层灵气账单")
    end
  end

  defp build_creative_request(direction) do
    %ToolRequest{
      tool_request_id: "tq-creative-#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "t-creative",
      frame_ref: "f-creative",
      decision_ref: "d-creative",
      tool_name: "creative_generation",
      tool_version: "1.0.0",
      input: %{"direction" => direction, "context_text" => "赛博修仙世界观"},
      read_scope_grants: ["author_text", "context_snapshot"],
      write_scope_grants: [],
      idempotency_key: "idem-creative",
      created_at: DateTime.utc_now()
    }
  end

  defp build_plot_outline_request do
    %ToolRequest{
      tool_request_id: "tq-outline-#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "t-outline",
      frame_ref: "f-outline",
      decision_ref: "d-outline",
      tool_name: "plot_outline",
      tool_version: "1.0.0",
      input: %{"text" => "生成 10 万字长篇章节大纲", "direction" => "plot_outline"},
      read_scope_grants: ["author_text", "plot_summary", "beat_list"],
      write_scope_grants: [],
      idempotency_key: "idem-outline",
      created_at: DateTime.utc_now()
    }
  end

  defp build_typed_creative_request(tool_name) do
    %ToolRequest{
      tool_request_id: "tq-typed-#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "t-typed",
      frame_ref: "f-typed",
      decision_ref: "d-typed",
      tool_name: tool_name,
      tool_version: "1.0.0",
      input: %{"text" => "生成角色设定", "direction" => tool_name},
      read_scope_grants: ["author_text", "character_list", "relationship_map"],
      write_scope_grants: [],
      idempotency_key: "idem-typed",
      created_at: DateTime.utc_now()
    }
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
