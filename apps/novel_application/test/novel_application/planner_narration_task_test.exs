defmodule NovelApplication.PlannerNarrationTaskTest do
  @moduledoc "B27 CP3c / C5：结果叙述消费 AuthoringTask(:result_narration)，任务缺失/失败诚实降级。"
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AuxTaskBuilder
  alias NovelApplication.Planner

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
            author_words: "第二章写完了吗？",
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

  test "prompt 含真实作者目标/工具后果/共享规则；只读操作不使用「待采纳创作材料」口径" do
    provider = capture_provider(self(), "已读取第二章正文，未生成候选。")

    assert "已读取第二章正文，未生成候选。" ==
             Planner.narrate_tool_result(tool_result(), narration_task(), provider)

    prompt =
      receive do
        {:narration_prompt, prompt} -> prompt
      after
        0 -> flunk("provider 未被调用")
      end

    assert prompt =~ "## 创作协作共同规则"
    assert prompt =~ "本轮为结果叙述"
    assert prompt =~ "作者原话（逐字保留、可追溯）：第二章写完了吗？"
    assert prompt =~ "已读取第二章正文（1200 字），未生成创作候选。"
    assert prompt =~ "## 工具执行结果"
    assert prompt =~ "请用 1-2 句自然中文"
    assert prompt =~ "只读/无创作产物"
    refute prompt =~ "本次产出是待确认创作材料"
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

    prompt =
      receive do
        {:narration_prompt, prompt} -> prompt
      after
        0 -> flunk("provider 未被调用")
      end

    assert prompt =~ "待确认创作材料"
    assert prompt =~ "尚未被采纳"
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
