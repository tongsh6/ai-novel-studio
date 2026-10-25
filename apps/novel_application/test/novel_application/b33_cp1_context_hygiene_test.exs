defmodule NovelApplication.B33CP1ContextHygieneTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunFlows.ProseDraftingWithQuality
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.JudgmentProtocol
  alias NovelDomain.DialogueContext

  defp context(overrides \\ %{}) do
    base = %DialogueContext{
      workspace_id: "w-b33",
      current_work_snapshot: %{
        title: "灯楼夜雨",
        genre: "悬疑",
        target_length: 200_000,
        planned_volumes: 3
      },
      current_chapters: ["第01章：灯楼夜雨", "第02章：井底回声"],
      structured_chapters: [
        %{
          id: "chapter-1",
          title: "第01章：灯楼夜雨",
          seq: 1,
          has_prose: true,
          word_count: 900,
          char_count: 950,
          accepted_draft_count: 3,
          scene_count: 3,
          current_draft_refs: ["draft:d1:1", "draft:d2:1", "draft:d3:1"],
          superseded_draft_count: 1,
          chapter_status: "DRAFTING",
          summary_status: "ACCEPTED",
          plan_direction: %{opening_hook: "第七盏灯自亮"}
        },
        %{
          id: "chapter-2",
          title: "第02章：井底回声",
          seq: 2,
          has_prose: false,
          word_count: 0,
          plan_direction: %{plot_progress: "下井"}
        }
      ],
      conversation_summary: "长会话摘要：" <> String.duplicate("历史讨论内容。", 200),
      open_behavior_summary: "开放行为摘要：" <> String.duplicate("观察。", 120),
      interaction_state: %{
        pending_adoptions:
          for i <- 1..10 do
            %{
              artifact_id: "as_pending_#{i}",
              adoption_status: "PENDING",
              artifact_type: "prose_fragment",
              title: "候选 #{i}",
              preview: String.duplicate("候选正文预览。", 80)
            }
          end,
        resolved_adoptions:
          for i <- 1..10 do
            %{
              artifact_id: "as_resolved_#{i}",
              adoption_status: "ACCEPTED",
              artifact_type: "prose_fragment",
              title: "已采纳 #{i}",
              preview: String.duplicate("已采纳正文预览。", 80)
            }
          end,
        author_inputs: [%{turn_ref: "turn-b33", text: "第02章正文还没写，帮我写出来吧。"}],
        recent_results: []
      }
    }

    struct(base, overrides)
  end

  defp protocol_input(context, run) do
    DialoguePlanningService.judgment_protocol_input_for_test(
      %{text: "第02章正文还没写，帮我写出来吧。"},
      run,
      context,
      []
    )
  end

  defp prompt_content(protocol_input) do
    %{messages: [%{content: content}]} = JudgmentProtocol.prompt(protocol_input)
    content
  end

  test "P0 去重：判断 prompt 中「消息处置与已有产物」恰好 1 次（默认 profile）" do
    run = %{
      profile_ref: "judgment_loop_v1",
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    content = protocol_input(context(), run) |> prompt_content()

    assert length(String.split(content, "## 消息处置与已有产物")) - 1 == 1
    # context_block 自身不再含该段（由 author_content_context 唯一渲染）
    refute DialoguePlanningService.judgment_context_block(context(), "写第02章") =~
             "## 消息处置与已有产物"
  end

  test "写作判断 keep-list 裁剪：消息处置 0 次，保留作品事实/章节，去掉候选/会话/行为/探索" do
    run = %{
      profile_ref: ProseDraftingWithQuality.profile_ref(),
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    context = context()
    protocol = protocol_input(context, run)
    content = prompt_content(protocol)

    # 写作判断不渲染历史消息处置段（按 keep-list 省略）
    assert length(String.split(content, "## 消息处置与已有产物")) - 1 == 0
    assert content =~ "## 作品事实（持久化只读投影"
    assert content =~ "第01章：灯楼夜雨"
    assert content =~ "第02章正文还没写，帮我写出来吧。"
    assert content =~ "## 当前可用操作"
    refute content =~ "长会话摘要："
    refute content =~ "开放行为摘要："
  end

  test "长上下文合成：写作判断 prompt 显著短于默认判断，trace 诊断字段 additive" do
    context = context()

    default_run = %{
      profile_ref: "judgment_loop_v1",
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    write_run = %{
      profile_ref: ProseDraftingWithQuality.profile_ref(),
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    default_chars = protocol_input(context, default_run) |> prompt_content() |> String.length()
    write_protocol = protocol_input(context, write_run)
    write_chars = write_protocol |> prompt_content() |> String.length()

    diagnostics =
      DialoguePlanningService.judgment_prompt_diagnostics_for_test(write_protocol, true)

    IO.puts("B33 CP1 prompt chars: default=#{default_chars} write_cropped=#{write_chars}")

    assert write_chars < default_chars
    assert write_chars * 5 < default_chars * 3
    assert diagnostics.prompt_chars == write_chars
    assert diagnostics.prompt_tokens == div(write_chars, 4)
    assert diagnostics.cropped == true
    assert "work" in diagnostics.selected_sections
    refute "interaction" in diagnostics.selected_sections
  end
end
