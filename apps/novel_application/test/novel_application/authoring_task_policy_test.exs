defmodule NovelApplication.AuthoringTaskPolicyTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringTaskPolicy
  alias NovelCommon.AuthoringSemantics

  test "shared rules come from the single common source (no duplicate copy)" do
    rules = AuthoringTaskPolicy.rules()

    assert String.contains?(rules, AuthoringSemantics.shared_rules())
    # 共享段只出现一次（单一真源，不得在判断段再抄一份）
    assert length(String.split(rules, "作者是唯一裁决者")) == 2
    assert String.contains?(rules, AuthoringTaskPolicy.judgment_rules())
    assert String.contains?(rules, AuthoringSemantics.author_narrative_rules())
    assert length(String.split(rules, "以实际作品和材料名称指明对象")) == 2
  end

  test "judgment rules describe implemented revision guards without promising successful output" do
    rules = AuthoringTaskPolicy.rules()

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

    for text <- [AuthoringTaskPolicy.judgment_rules(), AuthoringTaskPolicy.rules()],
        clause <- clauses do
      assert text =~ clause
      assert length(String.split(text, clause)) == 2
    end

    refute AuthoringTaskPolicy.judgment_rules() =~ "整体缺口说明与最近可行路径"
    assert AuthoringTaskPolicy.judgment_rules() =~ "不能用近似工具填平"
  end

  test "version and content hash are stable and detect rule text changes" do
    assert AuthoringTaskPolicy.version() == "b27-task-v6"
    assert AuthoringTaskPolicy.content_hash() == AuthoringTaskPolicy.content_hash()
    assert String.length(AuthoringTaskPolicy.content_hash()) == 64
    # hash 组合了共享真源 hash；共享真源变化必然改变策略 hash
    assert AuthoringTaskPolicy.content_hash() =~ ~r/^[0-9a-f]{64}$/
  end

  test "B33 CP2：判断规则包含动作意图必须 execute 或具体澄清、不得 reply/creative/await 终局" do
    rules = AuthoringTaskPolicy.rules()

    assert rules =~ "写/续写/重写某章正文时"
    assert rules =~ "直接 execute prose_writing"
    assert rules =~ "不能以 reply / propose_creative_directions / await_author 结束"
    assert rules =~ "设计一个角色时用 execute character_design"
    assert rules =~ "范围有实质歧义时用 ask_author"
  end

  test "负向取证允许诚实收束，排版规则与ADR-0029计划契约一致" do
    rules = NovelApplication.AuthoringTaskPolicy.rules()
    assert rules =~ "目标不存在或没有已采纳原文"
    assert rules =~ "核查已经完成"
    assert rules =~ "必要材料齐备后必须回到execute"
    assert rules =~ "模型提出换行计划"
    refute rules =~ "取证后必须回到 execute，不能以 reply"
    refute rules =~ "冻结空白归一后的"
  end
end
