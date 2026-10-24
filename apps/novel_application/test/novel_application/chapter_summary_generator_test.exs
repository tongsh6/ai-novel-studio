defmodule NovelApplication.ChapterSummaryGeneratorTest do
  @moduledoc "B27 CP3c：章摘要任务语义（材料范围/版本/省略标注）与诚实失败。"
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AuxTaskBuilder
  alias NovelApplication.ChapterSummaryGenerator
  alias NovelCommon.AuthoringSemantics
  alias NovelDomain.ChapterSummary

  @four_column """
  【情节推进】主角追查灵气账单。
  【人物状态与弧光】沈砚警觉。
  【伏笔动作】（无）
  【情绪基调】紧张
  """

  defp capture_provider(caller, content) do
    %Execution{
      result_fn: fn prompt ->
        send(caller, {:summary_prompt, prompt})
        {:ok, %{content: content}}
      end
    }
  end

  defp task(attrs \\ %{}) do
    {:ok, task} =
      AuxTaskBuilder.for_chapter_summary(
        Map.merge(
          %{
            work_id: "w-summary",
            chapter_id: "chapter-1",
            prose_text: "沈砚在巷口收好账单。",
            source_ref: "turn-1",
            revision_base: "draft:d1:1",
            material_scope: :fragment
          },
          attrs
        )
      )

    task
  end

  defp generate_and_capture_prompt(attrs \\ %{}) do
    provider = capture_provider(self(), @four_column)

    input = %{
      task: task(attrs),
      prose_text: "沈砚在巷口收好账单。"
    }

    result = ChapterSummaryGenerator.generate(input, provider)

    prompt =
      receive do
        {:summary_prompt, prompt} -> prompt
      after
        0 -> flunk("provider 未被调用或未捕获 prompt")
      end

    {result, prompt}
  end

  test "prompt 消费共享语义 + 四栏契约，材料范围/版本/省略显式标注" do
    assert {:ok, sections} = generate_and_capture_prompt() |> elem(0)
    assert sections.plot =~ "灵气账单"

    {_result, prompt} = generate_and_capture_prompt()

    # 共享规则唯一真源（AuthoringSemantics）在场且只渲染一份
    assert prompt =~ "## 创作协作共同规则"
    assert prompt =~ AuthoringSemantics.shared_rules()
    assert length(String.split(prompt, AuthoringSemantics.shared_rules())) == 2
    assert prompt =~ "本轮为章节摘要"
    assert prompt =~ "摘要不是全文"
    # 材料范围/版本/省略
    assert prompt =~ "chapter:chapter-1"
    assert prompt =~ "版本 draft:d1:1"
    assert prompt =~ "不完整"
    assert prompt =~ "本次材料为单次采纳片段"
    # 四栏领域标签（NovelDomain.ChapterSummary 单一真源）
    for label <- Map.values(ChapterSummary.section_labels()) do
      assert prompt =~ "【#{label}】"
    end

    # 不再自称整章已采纳正文
    refute prompt =~ "这一章的已采纳正文"
  end

  test "整章补做路径标注 complete?：省略注记消失" do
    whole = task(%{material_scope: :chapter})
    material = hd(whole.materials)

    assert material.complete? == true
    assert Map.get(material, :omission_note) == nil
    assert whole.scope.coverage == :chapter
  end

  test "模型输出没有四栏标签 → 诚实失败，不把整段/整章原文塞进摘要" do
    provider = capture_provider(self(), "这是一段没有标签的自由文本，不属于四栏输出。")

    assert {:error, :summary_sections_unparseable} =
             ChapterSummaryGenerator.generate(
               %{task: task(), prose_text: "沈砚在巷口收好账单。"},
               provider
             )
  end

  test "空正文 → empty_prose（不发起模型调用）" do
    provider = capture_provider(self(), @four_column)

    assert {:error, :empty_prose} =
             ChapterSummaryGenerator.generate(%{task: task(), prose_text: "   "}, provider)
  end

  test "缺 AuthoringTask → authoring_task_missing（调用点必须先组装任务）" do
    assert {:error, :authoring_task_missing} =
             ChapterSummaryGenerator.generate(%{prose_text: "正文"}, nil)
  end
end
