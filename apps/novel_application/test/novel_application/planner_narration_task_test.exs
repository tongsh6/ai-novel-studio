defmodule NovelApplication.PlannerNarrationTaskTest do
  @moduledoc "B27 CP3c / C5：结果叙述消费 AuthoringTask(:result_narration)，任务缺失/失败诚实降级。"
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AuxTaskBuilder
  alias NovelApplication.Planner
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.SystemEnvelope

  defp tool_result(overrides \\ %{}) do
    Map.merge(
      %{
        tool_name: "chapter_read",
        status: :succeeded,
        output: %{prose_total_chars: 1200},
        artifact_refs: [],
        errors: []
      },
      overrides
    )
  end

  defp narration_task(overrides \\ %{}) do
    {:ok, task} =
      AuxTaskBuilder.for_result_narration(
        Map.merge(
          %{
            author_goal: "确认第二章是否写完",
            author_input: %{turn_id: "turn-1", text: "第二章写完了吗？"},
            tool_name: "chapter_read",
            tool_status: :succeeded,
            artifact_refs: [],
            outcome_summary: "已读取第二章正文（1200 字），未生成创作候选。",
            turn_ref: "turn-1"
          },
          overrides
        )
      )

    task
  end

  defp capture_provider(caller, content) do
    %Execution{
      result_fn: fn prompt ->
        send(caller, {:narration_prompt, prompt})
        {:ok, %{content: content}}
      end
    }
  end

  test "作者原字节与来源独立于静态规则和应用结果材料" do
    raw = "  第二章写完了吗？\r\nΩ é 雪。\n  "
    source_input_ref = "turn-1:steer:2"
    provider = capture_provider(self(), "已读取第二章正文，未生成候选。")

    task =
      narration_task(%{
        author_input: %{turn_id: source_input_ref, text: raw},
        provider_call_ref: "provider:read-1"
      })

    assert task.author_words == raw
    assert task.source == %{kind: :author_action, ref: source_input_ref}

    assert "已读取第二章正文，未生成候选。" ==
             Planner.narrate_tool_result(tool_result(), task, provider)

    assert_received {:narration_prompt, %RequestIR{} = request}
    assert :ok = RequestIR.validate(request)
    assert request.run == %{profile_ref: "result_narration"}

    assert [base, author] = request.messages
    assert base.role == "application_base"
    assert base.provenance == "application"
    assert [%{type: "text", text: material}] = base.blocks
    assert base.source_refs == ["tool:chapter_read", "provider:read-1"]
    assert request.refs.base_refs == base.source_refs
    assert request.refs.observation_refs == []

    assert author.role == "user"
    assert author.provenance == "author"
    assert author.blocks == [RequestIR.text_block(raw)]
    assert author.source_refs == [%{ref: source_input_ref}]

    system = SystemEnvelope.system_text(request.system)
    assert system =~ "## 创作协作共同规则"
    assert system =~ "本轮为结果叙述"
    assert system =~ "请用 1-2 句自然中文"
    assert system =~ "只读/无创作产物"
    refute system =~ "本次产出是待确认创作材料"

    for content <- [system, material] do
      refute content =~ raw
      refute content =~ "作者原话（逐字保留、可追溯）"
    end

    refute system =~ task.author_goal
    refute system =~ task.prior_result.summary
    assert material =~ task.author_goal
    assert material =~ task.prior_result.summary
    assert material =~ "## 工具执行结果"
    refute material =~ "## 创作协作共同规则"
  end

  test "创作候选结果使用待采纳口径" do
    provider = capture_provider(self(), "已生成 2 个角色草案，待你审阅。")

    result =
      %{
        tool_name: "character_design",
        status: :succeeded,
        output: %{artifact_type: :character_seed},
        artifact_refs: ["as-1"],
        errors: []
      }

    task = narration_task(%{tool_name: "character_design", outcome_summary: "已生成 2 个待采纳角色候选。"})

    assert is_binary(Planner.narrate_tool_result(result, task, provider))

    assert_received {:narration_prompt, %RequestIR{} = request}
    system = SystemEnvelope.system_text(request.system)
    assert system =~ "待确认创作材料"
    assert system =~ "尚未被采纳"
  end

  test "无作者输入的应用任务不从应用目标合成作者消息" do
    task = narration_task(%{author_input: nil, author_goal: "应用目标不是新作者原话"})
    provider = capture_provider(self(), "已读取第二章正文。")

    assert task.author_words == nil
    assert task.source == nil
    assert "已读取第二章正文。" == Planner.narrate_tool_result(tool_result(), task, provider)

    assert_received {:narration_prompt, %RequestIR{} = request}
    assert :ok = RequestIR.validate(request)
    assert [base] = request.messages
    assert base.role == "application_base"
    assert base.provenance == "application"
    assert [%{type: "text", text: material}] = base.blocks
    assert material =~ task.author_goal
    refute SystemEnvelope.system_text(request.system) =~ task.author_goal
  end

  test "缺失或不完整的作者原文与来源配对被任务 builder 拒绝" do
    for source_attrs <- [
          %{},
          %{author_input: %{text: "真实输入"}},
          %{author_input: %{turn_id: "turn-1:steer:2"}}
        ] do
      assert {:error, :author_input_unavailable} =
               AuxTaskBuilder.for_result_narration(
                 Map.merge(
                   %{
                     author_goal: "应用目标不能补成作者输入",
                     tool_name: "chapter_read",
                     tool_status: :succeeded
                   },
                   source_attrs
                 )
               )
    end
  end

  test "task 缺失 → 确定性叙述且不调用 provider" do
    provider = capture_provider(self(), "不应出现")

    text = Planner.narrate_tool_result(tool_result(), nil, provider)

    assert text =~ "本次操作已执行"
    assert text =~ "未生成待采纳创作材料"
    refute_receive {:narration_prompt, _}, 20
  end

  test "provider 失败或空内容 → 确定性叙述（不虚报完成）" do
    failing = %Execution{result_fn: fn _ -> {:error, %{type: :timeout}} end}
    empty = capture_provider(self(), "   ")

    for provider <- [failing, empty] do
      text = Planner.narrate_tool_result(tool_result(), narration_task(), provider)
      assert text =~ "本次操作已执行"
      refute text =~ "工具执行完成"
    end
  end
end
