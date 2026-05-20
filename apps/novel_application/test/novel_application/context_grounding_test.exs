defmodule NovelApplication.ContextGroundingTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ContextAssembler
  alias NovelApplication.DialogueGateway
  alias NovelDomain.DialogueContext

  # Stub context fetcher that returns a realistic novel context
  @work_snapshot %{
    "title" => "灵源纪元",
    "genre" => "赛博修仙",
    "protagonist" => "林烬",
    "protagonist_goal" => "寻找失踪的妹妹林瑶",
    "current_chapter" => "第三章：霓虹地牢",
    "world_setting" => "2077年，灵气被垄断为能源，修仙者沦为公司的灵源电池"
  }

  defp stub_fetcher(_ws_id) do
    {:ok, @work_snapshot, "上一轮讨论了主角林烬潜入地牢的计划。", "林烬觉醒过雷电系灵力。", nil}
  end

  defp empty_fetcher(_ws_id), do: {:ok, nil, nil, nil, nil}

  # ── Context Assembly ──────────────────────────

  describe "ContextAssembler" do
    test "assembles context from fetcher" do
      ctx = ContextAssembler.assemble("ws-ctx", &stub_fetcher/1)

      assert ctx.workspace_id == "ws-ctx"
      assert ctx.current_work_snapshot != nil
      assert ctx.current_work_snapshot["protagonist"] == "林烬"
      assert ctx.conversation_summary != nil
      assert ctx.memory_summary != nil
      assert length(ctx.context_refs) == 3
      assert Enum.any?(ctx.context_refs, &(&1.source_type == :memory and &1.summary =~ "雷电系灵力"))
      assert ctx.assembled_at != nil
    end

    test "summarizes transcript-shaped conversation refs instead of exposing role logs" do
      fetcher = fn _ws_id ->
        {:ok, nil, "user: 我想写赛博修仙 assistant: 可以从灵气代码化切入", nil, nil}
      end

      ctx = ContextAssembler.assemble("ws-conversation-summary", fetcher)
      ref = Enum.find(ctx.context_refs, &(&1.source_type == :conversation))

      assert ref.summary == "上一轮围绕「我想写赛博修仙」展开，AI 已给出回应。"
      refute ref.summary =~ "user:"
      refute ref.summary =~ "assistant:"
    end

    test "does not create low-value current work trace refs for title-only snapshots" do
      fetcher = fn _ws_id -> {:ok, %{"title" => "未命名作品"}, nil, nil, nil} end

      ctx = ContextAssembler.assemble("ws-title-only", fetcher)

      assert ctx.current_work_snapshot == %{"title" => "未命名作品"}
      refute Enum.any?(ctx.context_refs, &(&1.source_type == :current_work))
    end

    test "assembles empty context correctly" do
      ctx = ContextAssembler.assemble("ws-empty", &empty_fetcher/1)

      assert ctx.workspace_id == "ws-empty"
      assert ctx.current_work_snapshot == nil
      assert ctx.conversation_summary == nil
      assert ctx.context_refs == []
      refute DialogueContext.has_context?(ctx)
    end

    test "has_context? returns true when snapshot exists" do
      ctx = ContextAssembler.assemble("ws-has", &stub_fetcher/1)
      assert DialogueContext.has_context?(ctx)
    end

    test "to_prompt_text includes all non-nil sections" do
      ctx = ContextAssembler.assemble("ws-prompt", &stub_fetcher/1)
      text = DialogueContext.to_prompt_text(ctx)

      assert String.contains?(text, "灵源纪元")
      assert String.contains?(text, "林烬")
      assert String.contains?(text, "潜入地牢")
      assert String.contains?(text, "雷电系灵力")
    end

    test "to_prompt_text with empty context shows (无)" do
      ctx = ContextAssembler.assemble("ws-empty", &empty_fetcher/1)
      text = DialogueContext.to_prompt_text(ctx)

      assert String.contains?(text, "无")
    end
  end

  # ── Grounded vs Ungrounded Turn ──────────────

  describe "grounded turn" do
    test "with context, trace records context_refs" do
      input = %{text: "把主角动机改得更狠一点。", workspace_id: "ws-grounded"}

      {:ok, _turn_result, _trace, _candidates, context} =
        DialogueGateway.handle_input(input, &stub_fetcher/1)

      assert DialogueContext.has_context?(context)
      assert context.context_refs != []
      assert Enum.any?(context.context_refs, &(&1.source_type == :current_work))
    end

    test "trace context refs carry author-safe source summaries" do
      input = %{text: "林烬为什么去矿区？", workspace_id: "ws-trace-source-summary"}

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(input, &stub_fetcher/1)

      memory_ref =
        Enum.find(turn_result.trace_summary.context_refs, &(&1.source_type == :memory))

      assert memory_ref.summary =~ "雷电系灵力"
      refute Map.has_key?(memory_ref, :source_id)
    end

    test "with context, frame records dialogue_context_ref" do
      input = %{text: "主角现在在哪里？", workspace_id: "ws-grounded"}

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(input, &stub_fetcher/1)

      assert turn_result.frame_ref != nil
      # The frame_summary should indicate context was available
      assert turn_result.frame_summary != nil
    end

    test "without context, trace records empty context event" do
      input = %{text: "把主角动机改得更狠一点。", workspace_id: "ws-noctx"}

      {:ok, _turn_result, trace, _candidates, context} =
        DialogueGateway.handle_input(input, &empty_fetcher/1)

      refute DialogueContext.has_context?(context)
      # Trace summary should indicate no context
      assert trace_summary_has_no_context(trace) or
               event_order_indicates_empty_context(trace)
    end

    test "without context, TurnResult does not fabricate work facts" do
      input = %{text: "主角现在在哪里？", workspace_id: "ws-noctx"}

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(input, &empty_fetcher/1)

      # The assistant message should not contain fabricated facts
      message = turn_result.assistant_message.text
      refute String.contains?(message, "林烬")
      refute String.contains?(message, "灵源纪元")
    end

    test "every turn with context has distinct context refs in summary" do
      input = %{text: "继续写下一段。", workspace_id: "ws-distinct"}

      {:ok, _turn_result, _trace, _candidates, context} =
        DialogueGateway.handle_input(input, &stub_fetcher/1)

      assert context.context_refs != []
      # Each context ref should have a unique id
      ref_ids = Enum.map(context.context_refs, & &1.context_ref)
      assert length(Enum.uniq(ref_ids)) == length(ref_ids)
    end
  end

  # ── Planner Boundary ──────────────────────────

  describe "planner boundary" do
    test "Planner receives assembled context, not raw Repo access" do
      alias NovelApplication.Planner

      # Planner directly receives DialogueContext — proves it doesn't access Repo
      ctx = ContextAssembler.assemble("ws-boundary", &stub_fetcher/1)
      {frame, _candidates} = Planner.form_frame(%{text: "继续", workspace_id: "ws-boundary"}, ctx)

      assert frame.source_refs.dialogue_context_ref != nil
      assert frame.evidence_summary.context_used == true
    end

    test "Planner with nil context produces frame without context_ref" do
      alias NovelApplication.Planner

      {frame, _candidates} = Planner.form_frame(%{text: "继续", workspace_id: "ws-nil"}, nil)

      assert frame.source_refs.dialogue_context_ref == nil
    end
  end

  defp trace_summary_has_no_context(trace) do
    trace.no_tool_reason != nil
  end

  defp event_order_indicates_empty_context(trace) do
    :dialogue_context_empty in trace.event_order
  end
end
