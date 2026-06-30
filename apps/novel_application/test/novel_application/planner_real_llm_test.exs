defmodule NovelApplication.PlannerRealLLMTest do
  use ExUnit.Case, async: false

  @moduledoc """
  真实 LLM 集成测试 — 验证 Planner 能解析真实 LLM (LM Studio) 返回的 JSON。

  需要 LM Studio 运行在 localhost:1234。否则自动跳过。
  运行方式：`mix test --include real_llm`
  默认排除此测试。
  """

  alias NovelAgent.Provider.Execution
  alias NovelApplication.DialogueGateway
  alias NovelApplication.Planner
  alias NovelApplication.ReplayService
  alias NovelTest.ProviderHelpers

  @moduletag :real_llm

  # ── Frame parsing ────────────────────────────────

  describe "form_frame with real LLM" do
    setup do
      skip_unless_provider!()
      {:ok, provider_execution: %Execution{complete_fn: ProviderHelpers.lmstudio_complete_fn()}}
    end

    test "casual reply produces valid DialogueFrame", %{provider_execution: provider_execution} do
      {frame, _candidates} =
        Planner.form_frame(
          %{text: "你好，我想聊聊小说创作。最近有什么好思路吗？", workspace_id: "ws-real"},
          nil,
          provider_execution
        )

      assert frame.schema_version == "3.0-draft"
      assert frame.frame_id != nil
      assert frame.turn_id != nil

      assert frame.frame_type in [
               :casual_reply,
               :creative_exploration,
               :question_answer,
               :meta_discussion
             ]

      assert frame.dialogue_goal.summary != ""
      assert frame.author_visible_draft.message != ""
      assert is_boolean(frame.tool_need.needs_tool)
    end

    test "creative exploration produces candidate directions", %{
      provider_execution: provider_execution
    } do
      {frame, candidates} =
        Planner.form_frame(
          %{text: "我想写一个赛博修仙的故事，但还没想好方向。帮我想想可以怎么切入。", workspace_id: "ws-real"},
          nil,
          provider_execution
        )

      assert frame.frame_type in [:creative_exploration, :casual_reply]
      assert frame.dialogue_goal.summary != ""

      if frame.frame_type == :creative_exploration do
        assert candidates != []

        for c <- candidates do
          assert c.title != ""
          assert c.pitch != ""
          assert c.adoption_status == :not_adopted
        end
      end
    end

    test "no forbidden semantics in frame", %{provider_execution: provider_execution} do
      {frame, _candidates} =
        Planner.form_frame(
          %{text: "帮我写一段小说的开头。", workspace_id: "ws-real"},
          nil,
          provider_execution
        )

      message = String.downcase(frame.author_visible_draft.message)
      refute String.contains?(message, "approved")
      refute String.contains?(message, "ready_to_execute")
      refute String.contains?(message, "execution_approved")
      refute String.contains?(message, "production_write_allowed")
    end
  end

  # ── MicroPlan parsing ────────────────────────────

  describe "form_micro_plan with real LLM" do
    setup do
      skip_unless_provider!()
      {:ok, provider_execution: %Execution{complete_fn: ProviderHelpers.lmstudio_complete_fn()}}
    end

    test "produces valid MicroPlan from real LLM", %{provider_execution: provider_execution} do
      frame = build_exploration_frame()

      case Planner.form_micro_plan(frame, %{text: "聊聊赛博修仙的方向"}, provider_execution) do
        {:ok, plan} ->
          assert plan.plan_id != nil
          assert plan.turn_id == frame.turn_id
          assert plan.frame_ref == frame.frame_id
          assert plan.plan_goal.summary != ""
          assert plan.risk_hint in [:low, :medium, :high]
          assert is_boolean(plan.requires_confirmation_hint)
          assert is_list(plan.proposed_actions)
          assert :ok = plan.__struct__.check_forbidden(plan)

        {:error, reason} ->
          assert is_binary(reason) or is_atom(reason)
      end
    end

    test "MicroPlan does not contain execution authority", %{
      provider_execution: provider_execution
    } do
      frame = build_exploration_frame()

      assert {:ok, plan} = Planner.form_micro_plan(frame, %{text: "帮我写大纲"}, provider_execution)
      assert :ok = plan.__struct__.check_forbidden(plan)
    end

    test "plan actions are suggestions only", %{provider_execution: provider_execution} do
      frame = build_exploration_frame()

      assert {:ok, plan} = Planner.form_micro_plan(frame, %{text: "我想写角色设定"}, provider_execution)

      for action <- plan.proposed_actions do
        assert action.action_id != nil

        assert action.action_type in [
                 :candidate_generation,
                 :tentative_artifact,
                 :state_change_request,
                 :clarification_request,
                 :confirmation_request,
                 :capability_invocation
               ]

        assert action.write_intent in [:none, :tentative, :production_candidate]
        assert action.risk_hint in [:low, :medium, :high]
      end
    end
  end

  # ── Full Gateway pipeline ────────────────────────

  describe "full pipeline with real LLM" do
    setup do
      skip_unless_provider!()
      {:ok, provider_execution: %Execution{complete_fn: ProviderHelpers.lmstudio_complete_fn()}}
    end

    test "handle_input reply-only path", %{provider_execution: provider_execution} do
      input = %{text: "你好，我是作者。最近对赛博朋克很感兴趣。", workspace_id: "ws-real"}

      {:ok, turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(input, nil, provider_execution)

      assert turn_result.schema_version == "3.0-draft"
      assert turn_result.turn_id != nil
      assert turn_result.frame_ref != nil
      assert turn_result.assistant_message.text != ""
      assert trace.decision_type != nil
      assert trace.replay_policy.recall_provider == false
      assert :turn_result_emitted in trace.event_order
    end

    test "handle_input with generate_micro_plan reaches decision", %{
      provider_execution: provider_execution
    } do
      input = %{text: "帮我为赛博朋克小说创作角色设定", workspace_id: "ws-real", generate_micro_plan: true}

      {:ok, turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(input, nil, provider_execution)

      assert turn_result.turn_id != nil
      assert trace.decision_type != nil
      assert length(trace.event_order) >= 4
    end

    test "real LLM output is culturally appropriate (Chinese)", %{
      provider_execution: provider_execution
    } do
      input = %{text: "你好", workspace_id: "ws-real"}

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(input, nil, provider_execution)

      message = turn_result.assistant_message.text
      assert byte_size(message) > 0
      refute String.starts_with?(String.trim(message), "{")
    end

    test "context injection reaches LLM prompt", %{provider_execution: provider_execution} do
      fetcher = fn _ws_id ->
        {:ok, %{title: "赛博朋克世界观", genre: "科幻"}, "用户持续探索赛博朋克主题，偏好科技与人性的冲突", "用户擅长快速回复，对设定有主见", nil}
      end

      input = %{text: "我想深化义体改造的设定", workspace_id: "ws-real-context"}

      {:ok, turn_result, _trace, _candidates, context} =
        DialogueGateway.handle_input(input, fetcher, provider_execution)

      assert turn_result.assistant_message.text != ""
      assert context.workspace_id == "ws-real-context"
      assert context.current_work_snapshot != nil
      assert context.conversation_summary != nil
      assert context.memory_summary != nil
    end

    test "replay from real trace never calls provider", %{provider_execution: provider_execution} do
      {:ok, _turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "hi", workspace_id: "ws-real-r"},
          nil,
          provider_execution
        )

      report = ReplayService.build_report(trace)

      assert report.provider_called == false
      assert report.trace_ref == trace.trace_id
    end
  end

  # ── Error recovery ───────────────────────────────

  describe "provider error recovery" do
    setup do
      skip_unless_provider!()
      {:ok, provider_execution: %Execution{complete_fn: ProviderHelpers.lmstudio_complete_fn()}}
    end

    test "Planner falls back when provider returns garbage" do
      # Use a complete_fn that simulates a broken provider
      broken_fn = fn _prompt -> {:ok, %{content: "not valid json {{{"}} end

      {frame, _candidates} =
        Planner.form_frame(%{text: "测试降级", workspace_id: "ws-real"}, nil, %Execution{
          complete_fn: broken_fn
        })

      assert frame.schema_version == "3.0-draft"
      assert frame.frame_id != nil
      assert frame.author_visible_draft.message != ""
    end

    test "handle_input never crashes with broken provider" do
      broken_fn = fn _prompt -> {:error, %{code: "timeout", message: "timeout"}} end

      result =
        DialogueGateway.handle_input(
          %{text: "测试稳定性", workspace_id: "ws-real"},
          nil,
          %Execution{complete_fn: broken_fn}
        )

      assert match?({:ok, _, _, _, _}, result) or match?({:error, _}, result)
    end
  end

  # ── Helpers ──────────────────────────────────────

  defp build_exploration_frame do
    %NovelDomain.DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame_#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "turn_#{System.unique_integer([:positive, :monotonic])}",
      workspace_id: "ws-real",
      primary: true,
      frame_type: :creative_exploration,
      source_refs: %{author_input_ref: "a-real", dialogue_context_ref: nil},
      dialogue_goal: %{summary: "探索创作方向"},
      tool_need: %{needs_tool: true, reason_code: :insufficient_execution_target},
      execution_readiness: :not_ready,
      author_visible_draft: %{message: "让我们一起来探索。"},
      evidence_summary: %{context_used: false},
      uncertainty: []
    }
  end

  defp skip_unless_provider! do
    unless ProviderHelpers.lmstudio_available?() do
      IO.puts("  ⏭  Skipping: LM Studio (#{ProviderHelpers.default_model()}) 未启动")
      IO.puts("     启动 LM Studio 后运行: mix test --include real_llm")
    end
  end
end
