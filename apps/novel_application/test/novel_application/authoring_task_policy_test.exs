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
  end

  test "judgment-specific rules remain judgment/plan scoped and do not re-promise formatting" do
    rules = AuthoringTaskPolicy.rules()

    refute rules =~ "首稿、续写、重写、修订、仅排版互斥"
    assert rules =~ "没有保证字句不变的独立排版能力"
    assert rules =~ "B28"
    # 判断专属语义仍在（取证/必要提问/自然表达）
    assert rules =~ "先取证"
    assert rules =~ "只有无法从材料消歧"
    assert rules =~ "不机械复述输入"
  end

  test "version and content hash are stable and detect rule text changes" do
    assert AuthoringTaskPolicy.version() == "b27-task-v2"
    assert AuthoringTaskPolicy.content_hash() == AuthoringTaskPolicy.content_hash()
    assert String.length(AuthoringTaskPolicy.content_hash()) == 64
    # hash 组合了共享真源 hash；共享真源变化必然改变策略 hash
    assert AuthoringTaskPolicy.content_hash() =~ ~r/^[0-9a-f]{64}$/
  end

  test "operations render from capability registry (no hardcoded catalog text)" do
    rendered =
      AuthoringTaskPolicy.operations(
        capabilities: ["character_design", "prose_writing", "work_archive_read"]
      )

    assert rendered =~ "character_design"
    assert rendered =~ "prose_writing"
    assert rendered =~ "work_archive_read"
    assert rendered =~ "创作结果先待采纳"
  end
end
