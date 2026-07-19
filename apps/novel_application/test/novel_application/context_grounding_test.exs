defmodule NovelApplication.ContextGroundingTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
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

  defp provider_execution(result_fn), do: %Execution{result_fn: result_fn}

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

    test "marks session-scoped transcript refs separately from workspace conversation fallback" do
      fetcher = fn _ws_id, _author_text, _session_id ->
        {:ok, nil, "user: 当前会话确认当前蓝桥计划 assistant: 已记录当前蓝桥计划", nil, nil}
      end

      ctx =
        ContextAssembler.assemble_for_input("ws-session-source", "继续", fetcher,
          session_id: "session-active"
        )

      ref = Enum.find(ctx.context_refs, &(&1.source_type == :session_transcript))

      assert ref.summary == "上一轮围绕「当前会话确认当前蓝桥计划」展开，AI 已给出回应。"
      refute Enum.any?(ctx.context_refs, &(&1.source_type == :conversation))
      refute ref.summary =~ "user:"
      refute ref.summary =~ "assistant:"
    end

    test "keeps workspace fallback conversation refs when no active session is provided" do
      fetcher = fn _ws_id ->
        {:ok, nil, "user: 工作区最近讨论 assistant: 已回应", nil, nil}
      end

      ctx = ContextAssembler.assemble("ws-conversation-fallback", fetcher)

      assert Enum.any?(ctx.context_refs, &(&1.source_type == :conversation))
      refute Enum.any?(ctx.context_refs, &(&1.source_type == :session_transcript))
    end

    test "does not create low-value current work trace refs for title-only snapshots" do
      fetcher = fn _ws_id -> {:ok, %{"title" => "未命名作品"}, nil, nil, nil} end

      ctx = ContextAssembler.assemble("ws-title-only", fetcher)

      assert ctx.current_work_snapshot == %{"title" => "未命名作品"}
      refute Enum.any?(ctx.context_refs, &(&1.source_type == :current_work))
    end

    test "summarizes persisted work fields into author-visible current work refs" do
      fetcher = fn _ws_id ->
        {:ok,
         %{
           "title" => "灵源纪元",
           "genre" => "东方奇幻",
           "core_selling_point" => "林烬追查灵源矿区真相",
           "target_reader" => "悬疑成长读者",
           "tone_preference" => "克制、带希望感"
         }, nil, nil, nil}
      end

      ctx = ContextAssembler.assemble("ws-work-summary", fetcher)
      ref = Enum.find(ctx.context_refs, &(&1.source_type == :current_work))

      assert ref.summary =~ "灵源纪元"
      assert ref.summary =~ "东方奇幻"
      assert ref.summary =~ "林烬追查灵源矿区真相"
      assert ref.summary =~ "悬疑成长读者"
    end

    test "assembles empty context correctly" do
      ctx = ContextAssembler.assemble("ws-empty", &empty_fetcher/1)

      assert ctx.workspace_id == "ws-empty"
      assert ctx.current_work_snapshot == nil
      assert ctx.conversation_summary == nil
      assert ctx.context_refs == []
      refute DialogueContext.has_context?(ctx)
    end

    test "accepts structured chapter entries without changing current_chapters title list" do
      fetcher = fn _ws_id ->
        {:ok, @work_snapshot, nil, nil, nil, ["第一章", "第二章"],
         [
           %{title: "第一章", seq: 1, summary: "开局计划", has_prose: true},
           %{
             title: "第二章",
             seq: 2,
             summary: "推进计划",
             has_prose: false,
             plan_direction: %{
               "chapter_role" => "转折章",
               "plot_progress" => "主角进入旧服务器",
               "emotion" => "紧张"
             }
           }
         ]}
      end

      ctx = ContextAssembler.assemble("ws-structured-chapters", fetcher)

      assert ctx.current_chapters == ["第一章", "第二章"]

      assert [
               %{title: "第一章", seq: 1, summary: "开局计划", has_prose: true},
               %{
                 title: "第二章",
                 seq: 2,
                 summary: "推进计划",
                 has_prose: false,
                 plan_direction: %{
                   "chapter_role" => "转折章",
                   "plot_progress" => "主角进入旧服务器",
                   "emotion" => "紧张"
                 }
               }
             ] = ctx.structured_chapters
    end

    test "can derive current_chapters from a legacy six-tuple structured chapter payload" do
      fetcher = fn _ws_id ->
        {:ok, @work_snapshot, nil, nil, nil,
         [
           %{"title" => "第一章", "seq" => "1", "summary" => "开局计划", "word_count" => 12},
           %{"title" => "第二章", "seq" => 2, "summary" => "推进计划", "word_count" => 0}
         ]}
      end

      ctx = ContextAssembler.assemble("ws-structured-six-tuple", fetcher)

      assert ctx.current_chapters == ["第一章", "第二章"]

      assert [
               %{title: "第一章", seq: 1, summary: "开局计划", has_prose: true},
               %{title: "第二章", seq: 2, summary: "推进计划", has_prose: false}
             ] = ctx.structured_chapters
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

    test "assembles behavior summary into prompt text and author-safe context refs" do
      fetcher = fn _ws_id ->
        {:ok, nil, nil, nil, "当前有待作者确认的操作：章节正文草稿；确认或取消前不能执行工具或写入作品事实。"}
      end

      ctx = ContextAssembler.assemble("ws-behavior", fetcher)
      ref = Enum.find(ctx.context_refs, &(&1.source_type == :behavior))
      text = DialogueContext.to_prompt_text(ctx)

      assert DialogueContext.has_context?(ctx)
      assert ctx.open_behavior_summary =~ "待作者确认"
      assert ref.summary =~ "待作者确认"
      assert ref.source_id == "behavior_summary"
      assert ref.redaction_level == :author_safe
      assert text =~ "## 当前待处理动作"
      assert text =~ "不能执行工具或写入作品事实"
    end
  end

  # ── Grounded vs Ungrounded Turn ──────────────

  defp trace_summary_has_no_context(trace) do
    trace.no_tool_reason != nil
  end

  defp event_order_indicates_empty_context(trace) do
    :dialogue_context_empty in trace.event_order
  end

  defp quality_fetcher(_ws_id, _author_text) do
    {:ok,
     %{
       "title" => "灵源纪元",
       "genre" => "赛博修仙",
       "core_selling_point" => "林烬追查妹妹林瑶留下的矿区线索",
       "target_reader" => "喜欢高压逆转和悬疑成长线的读者",
       "tone_preference" => "克制、悬疑、带希望感",
       "current_chapter" => "第三章：霓虹地牢",
       "protagonist" => "林烬"
     }, nil, "林瑶失踪指向灵源矿区，林烬必须追查线索。", nil, ["第三章：霓虹地牢"],
     [
       %{
         title: "第三章：霓虹地牢",
         seq: 3,
         summary: "林烬轻松击败守卫，但矿区代价还未显现。",
         has_prose: true
       }
     ]}
  end
end
