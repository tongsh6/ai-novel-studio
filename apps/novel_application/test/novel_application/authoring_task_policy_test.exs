defmodule NovelApplication.AuthoringTaskPolicyTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringTaskPolicy
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.AuthorVisible.Display

  test "判断专属规则不复制共同规则" do
    rules = AuthoringTaskPolicy.judgment_rules()
    refute rules =~ AuthoringSemantics.shared_rules()
    refute rules =~ "作者是唯一裁决者"
    assert rules =~ AuthoringSemantics.author_narrative_rules()
    assert length(String.split(rules, "以实际作品和材料名称指明对象")) == 2
    refute function_exported?(AuthoringTaskPolicy, :rules, 0)
  end

  test "judgment rules describe implemented revision guards without promising successful output" do
    rules = AuthoringTaskPolicy.judgment_rules()

    refute rules =~ "首稿、续写、重写、修订、仅排版互斥"
    assert rules =~ "所有非换行字节保持不变"
    assert rules =~ "不能将拒绝或生成方案说成排版已完成"
    refute rules =~ "B28 另有"
    # 判断专属语义仍在（取证/必要提问/自然表达）
    assert rules =~ "先取证"
    assert rules =~ "只有无法从材料消歧"
    assert rules =~ "不机械复述输入"
  end

  @tag :r08_gap_contract
  test "R08 能力缺口只提供有据替代，未知人工或界面能力不作存在性断言" do
    clauses = [
      "仅提供本轮可用操作目录或已供应材料证实可行的替代路径",
      "没有可确认的替代路径时如实说明",
      "未知的人工操作或界面能力，不能说成可用，也不能断言不存在"
    ]

    for text <- [
          AuthoringTaskPolicy.judgment_rules(),
          AuthoringTaskPolicy.capability_gap_guidance()
        ],
        clause <- clauses do
      assert text =~ clause
      assert length(String.split(text, clause)) == 2
    end

    refute AuthoringTaskPolicy.judgment_rules() =~ "整体缺口说明与最近可行路径"
    assert AuthoringTaskPolicy.judgment_rules() =~ "不能用近似工具填平"
  end

  test "能力目录补充已登记作者称谓并保留机器标识与既有效果" do
    assert [outline, archive] =
             AuthoringTaskPolicy.operation_data(
               capabilities: ["plot_outline", "work_archive_read"]
             )

    assert outline == %{
             name: "plot_outline",
             display_name: "大纲规划",
             effect_summary: "生成章节/卷纲候选，不冒充已存在章节的重编号或移动。",
             read_scopes: ["author_text", "plot_summary", "beat_list"],
             write_scopes: ["volume_plan", "chapter_outline", "plot_beat"],
             output_contract_ref: "tentative_artifact_v2",
             risk_class: :medium
           }

    assert archive == %{
             name: "work_archive_read",
             display_name: "作品档案查阅",
             effect_summary: "- work_archive_read：批量只读作品档案、结构与统计，不生成候选，不保存或登记任何内容。"
           }
  end

  test "未登记 capability 称谓不借用其他 kind 或通用兜底名，也不产生许可" do
    assert Display.known?(:tool, "text_analysis")

    for name <- ["revise_adopted_content", "text_analysis", "make_magic", "大纲规划"] do
      assert [%{name: ^name} = entry] =
               AuthoringTaskPolicy.operation_data(capabilities: [name])

      refute Map.has_key?(entry, :display_name)
    end

    assert {:error, :unsupported_judgment_capabilities} =
             AuthoringTaskPolicy.validate_judgment_options([capabilities: ["make_magic"]], [])

    assert {:error, :unsupported_judgment_capabilities} =
             AuthoringTaskPolicy.validate_judgment_options([capabilities: ["大纲规划"]], [])
  end

  test "judgment role keeps its explicit policy version" do
    assert AuthoringTaskPolicy.version() == "b27-task-v7"
  end

  test "B33 CP2：判断规则包含动作意图必须 execute 或具体澄清、不得 reply/creative/await 终局" do
    rules = AuthoringTaskPolicy.judgment_rules()

    assert rules =~ "写/续写/重写某章正文时"
    assert rules =~ "直接 execute prose_writing"
    assert rules =~ "不能以 reply / propose_creative_directions / await_author 结束"
    assert rules =~ "设计一个角色时用 execute character_design"
    assert rules =~ "范围有实质歧义时用 ask_author"
  end

  test "负向取证允许诚实收束，排版规则与ADR-0029计划契约一致" do
    rules = AuthoringTaskPolicy.judgment_rules()
    assert rules =~ "目标不存在或没有已采纳原文"
    assert rules =~ "核查已经完成"
    assert rules =~ "必要材料齐备后必须回到execute"
    assert rules =~ "模型提出换行计划"
    refute rules =~ "取证后必须回到 execute，不能以 reply"
    refute rules =~ "冻结空白归一后的"
  end
end
