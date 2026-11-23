defmodule NovelApplication.ChapterSummaryGeneratorTest do
  @moduledoc "B27 CP3c：章摘要任务语义（材料范围/版本/省略标注）与诚实失败。"
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AuxTaskBuilder
  alias NovelApplication.ChapterSummaryGenerator
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.RequestIR
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
        # 生产入口已改为 canonical RequestIR；文本断言读与 provider 同源的投影文本视图。
        {:summary_prompt, prompt} -> NovelTest.TestProviderPrompt.text(prompt)
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

  describe "R08 四栏文本接收合同" do
    @describetag :r08_chapter_summary_text_contract

    test "真实 AuxTaskBuilder 到 Generator 请求只声明四栏文本输出" do
      summary_task = task()
      provider = capture_provider(self(), @four_column)

      assert {:ok, _sections} =
               ChapterSummaryGenerator.generate(
                 %{task: summary_task, prose_text: "沈砚在巷口收好账单。"},
                 provider
               )

      assert_received {:summary_prompt, %RequestIR{} = request}
      prompt = NovelTest.TestProviderPrompt.text(request)

      assert summary_task.output_contract.kind == :text
      assert summary_task.output_contract.required_keys == []
      assert summary_task.output_contract.schema_ref == "chapter_summary_v1"
      assert prompt =~ "输出契约：章节摘要（text）"
      assert prompt =~ "必须存在的结构字段：按角色专属 schema"
      assert prompt =~ "严格按以下四栏输出，每栏一行"
      refute prompt =~ "输出契约：章节摘要（json）"
      refute prompt =~ "必须存在的结构字段：plot、characters、foreshadowing、mood"

      for label <- ["情节推进", "人物状态与弧光", "伏笔动作", "情绪基调"] do
        assert prompt =~ "【#{label}】"
      end
    end

    test "完整四栏文本保留内容字节，不把栏内引号或花括号误作 JSON 外壳" do
      prose = "陈九斤拨亮灯芯，继续核对第七页。"

      output = """
      【情节推进】陈九斤说：“先核对  第七页。”纸边留下“{旧账}”记号。
      【人物状态与弧光】陈九斤继续守灯，尚未作出新决定。
      【伏笔动作】湿痕仍未解释；“第七页”只作线索。
      【情绪基调】安静、阴冷，结尾仍有悬念。
      """

      assert {:ok, sections} =
               ChapterSummaryGenerator.generate(
                 %{task: task(%{prose_text: prose}), prose_text: prose},
                 capture_provider(self(), output)
               )

      assert sections == %{
               plot: "陈九斤说：“先核对  第七页。”纸边留下“{旧账}”记号。",
               characters: "陈九斤继续守灯，尚未作出新决定。",
               foreshadowing: "湿痕仍未解释；“第七页”只作线索。",
               mood: "安静、阴冷，结尾仍有悬念。"
             }
    end

    test "四栏齐全且明确（无）时保留 Domain 的缺席语义" do
      assert {:ok, sections} =
               ChapterSummaryGenerator.generate(
                 %{task: task(), prose_text: "沈砚在巷口收好账单。"},
                 capture_provider(self(), @four_column)
               )

      assert sections == %{
               plot: "主角追查灵气账单。",
               characters: "沈砚警觉。",
               mood: "紧张"
             }

      refute Map.has_key?(sections, :foreshadowing)
    end

    test "行内已知标签与未知标签都是正文，接收后逐字保留" do
      prose = "账页上留着几段括号批注，陈九斤继续守灯。"

      output = """
      【情节推进】账页上的【情节推进】是原字，不是另一栏；【账牌】也应保留。
      【人物状态与弧光】陈九斤仍在守灯。
      【伏笔动作】湿痕尚未解释。
      【情绪基调】安静。
      """

      assert {:ok, sections} =
               ChapterSummaryGenerator.generate(
                 %{task: task(%{prose_text: prose}), prose_text: prose},
                 capture_provider(self(), output)
               )

      assert sections == %{
               plot: "账页上的【情节推进】是原字，不是另一栏；【账牌】也应保留。",
               characters: "陈九斤仍在守灯。",
               foreshadowing: "湿痕尚未解释。",
               mood: "安静。"
             }
    end

    test "四栏全部明确（无）仍是完整成功，不能把标签整段归入情节" do
      output = """
      【情节推进】（无）
      【人物状态与弧光】（无）
      【伏笔动作】（无）
      【情绪基调】（无）
      """

      result =
        ChapterSummaryGenerator.generate(
          %{task: task(), prose_text: "沈砚在巷口收好账单。"},
          capture_provider(self(), output)
        )

      assert result == {:ok, %{}}
    end

    for {label, output} <- [
          {"含四标签的 JSON 外壳",
           """
           {
             "plot": "【情节推进】材料仅覆盖单次采纳片段，未覆盖整章。灯楼夜间账簿推进到第七页，陈九斤在灯下继续核对，事件停在未完成的记账节点。",
             "characters": "【人物状态与弧光】三十岁的陈九斤处于守灯或管账状态，拨亮灯芯显示谨慎与警觉；纸面湿痕未干暗示异常刚发生。片段未展开目标、关系与弧光。",
             "foreshadowing": "【伏笔动作】第七页、夜间账簿与湿痕构成疑点，可能关联潮湿事故、涂改、遗漏或隐藏记录。当前仅铺设，未解释或回收。",
             "mood": "【情绪基调】安静压抑，带夜班疲惫与不确定；拨亮灯芯带来短暂清晰，湿痕未干保留潮湿、模糊和焦灼，整体阴冷悬疑。"
           }
           """},
          {"缺少一栏",
           """
           【情节推进】陈九斤继续核对账簿。
           【人物状态与弧光】陈九斤保持警觉。
           【伏笔动作】湿痕尚未解释。
           """},
          {"一栏仅有空白",
           "【情节推进】陈九斤继续核对账簿。\n" <>
             "【人物状态与弧光】陈九斤保持警觉。\n" <>
             "【伏笔动作】湿痕尚未解释。\n" <>
             "【情绪基调】 \t\n"},
          {"重复同一标签",
           """
           【情节推进】陈九斤继续核对账簿。
           【情节推进】重复这一栏不能覆盖前一栏。
           【人物状态与弧光】陈九斤保持警觉。
           【伏笔动作】湿痕尚未解释。
           【情绪基调】阴冷。
           """},
          {"四栏顺序错误",
           """
           【人物状态与弧光】陈九斤保持警觉。
           【情节推进】陈九斤继续核对账簿。
           【伏笔动作】湿痕尚未解释。
           【情绪基调】阴冷。
           """},
          {"四栏前有额外说明",
           """
           以下是本次摘要：
           【情节推进】陈九斤继续核对账簿。
           【人物状态与弧光】陈九斤保持警觉。
           【伏笔动作】湿痕尚未解释。
           【情绪基调】阴冷。
           """},
          {"四栏后有额外说明",
           """
           【情节推进】陈九斤继续核对账簿。
           【人物状态与弧光】陈九斤保持警觉。
           【伏笔动作】湿痕尚未解释。
           【情绪基调】阴冷。
           补充：这里不应混入另一段正文。
           """},
          {"四栏之间有额外空行",
           """
           【情节推进】陈九斤继续核对账簿。

           【人物状态与弧光】陈九斤保持警觉。
           【伏笔动作】湿痕尚未解释。
           【情绪基调】阴冷。
           """}
        ] do
      test "拒收#{label}，不从任意文本中提取标签" do
        prose = "陈九斤拨亮灯芯，继续核对第七页。"

        assert {:error, :summary_sections_unparseable} =
                 ChapterSummaryGenerator.generate(
                   %{task: task(%{prose_text: prose}), prose_text: prose},
                   capture_provider(self(), unquote(output))
                 )
      end
    end
  end

  test "缺 AuthoringTask → authoring_task_missing（调用点必须先组装任务）" do
    assert {:error, :authoring_task_missing} =
             ChapterSummaryGenerator.generate(%{prose_text: "正文"}, nil)
  end
end
