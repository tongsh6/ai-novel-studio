defmodule NovelApplication.B33CP1ContextHygieneTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunFlows.ProseDraftingWithQuality
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.JudgmentProtocol
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.DialogueContext

  defp context(overrides \\ %{}) do
    base = %DialogueContext{
      work_id: "w-b33",
      source_status: %{
        work: :ok,
        chapters: :ok,
        behavior: :ok,
        interaction: :ok,
        conversation: :ok,
        memory: :empty
      },
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
    protocol_input
    |> JudgmentProtocol.request_for_production()
    |> NovelApplication.TestAgenticLoopFixtures.prompt_text()
  end

  test "初始判断只构造一个结构化 Scope，消息处置只有一个实际字段" do
    run = %{
      run_id: "run-b33-judgment",
      profile_ref: "judgment_loop_v1",
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    request = protocol_input(context(), run) |> JudgmentProtocol.request_for_production()
    assert Enum.count(request.messages, &(&1.role == "scope_update")) == 1
    scope = NovelTest.TestProviderPrompt.scope_content(request)
    assert scope["context"]["interaction_state"]["pending_adoption_count"] == 10
    assert scope["context"]["interaction_state"]["resolved_adoption_count"] == 10
  end

  test "写作判断 keep-list 裁剪：消息处置 0 次，保留作品事实/章节，去掉候选/会话/行为/探索" do
    run = %{
      run_id: "run-b33-prose",
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
    assert protocol.scope.context == %{}
    assert protocol.scope.facts.work.title == "灯楼夜雨"
    assert protocol.scope.coverage.interaction.status == "not_read"
    assert Enum.any?(protocol.scope.omissions, &(&1.reason == "profile_not_supplied"))
    assert content =~ "第01章：灯楼夜雨"
    assert content =~ "第02章正文还没写，帮我写出来吧。"
    request = JudgmentProtocol.request_for_production(protocol)

    assert NovelTest.TestProviderPrompt.scope_content(request)["operation"][
             "available_operations"
           ] != []

    refute content =~ "长会话摘要："
    refute content =~ "开放行为摘要："
  end

  test "长上下文合成：写作判断 prompt 显著短于默认判断，trace 诊断字段 additive" do
    context = context()

    default_run = %{
      run_id: "run-b33-judgment",
      profile_ref: "judgment_loop_v1",
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    write_run = %{
      run_id: "run-b33-prose",
      profile_ref: ProseDraftingWithQuality.profile_ref(),
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    default_protocol = protocol_input(context, default_run)
    default_chars = default_protocol |> prompt_content() |> String.length()
    write_protocol = protocol_input(context, write_run)
    write_chars = write_protocol |> prompt_content() |> String.length()

    diagnostics =
      DialoguePlanningService.judgment_prompt_diagnostics_for_test(write_protocol, true)

    production_chars =
      write_protocol
      |> JudgmentProtocol.request_for_production()
      |> Map.fetch!(:messages)
      |> Enum.map_join("", &Projection.content_of(&1.blocks))
      |> String.length()

    IO.puts("B33 CP1 prompt chars: default=#{default_chars} write_cropped=#{write_chars}")

    assert write_chars < default_chars

    # profile 裁剪只比较实际应用材料；稳定 system 不属于选择预算。
    default_request = JudgmentProtocol.request_for_production(default_protocol)
    write_request = JudgmentProtocol.request_for_production(write_protocol)
    assert default_request.system == write_request.system
    default_scope_bytes = default_protocol.scope |> Jason.encode!() |> byte_size()
    write_scope_bytes = write_protocol.scope |> Jason.encode!() |> byte_size()
    assert write_scope_bytes * 3 < default_scope_bytes * 2
    assert diagnostics.prompt_chars == production_chars
    assert diagnostics.prompt_tokens == div(production_chars, 4)
    assert diagnostics.cropped == true
    assert "work" in diagnostics.selected_sections
    refute "interaction" in diagnostics.selected_sections
  end
end
