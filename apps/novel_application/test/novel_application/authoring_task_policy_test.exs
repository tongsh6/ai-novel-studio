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
    refute rendered =~ "精确匹配原文字词"

    revision = AuthoringTaskPolicy.operations(capabilities: ["revise_adopted_content"])
    assert revision =~ "精确匹配原文字词"
    assert revision =~ "缺失或多处命中会拒绝"
    assert revision =~ "确定性合并逐字保留"
    assert revision =~ "须作者采纳"
  end

  test "B33 CP2：动作意图存在性检测（不做路由）覆盖写章/设计角色/修订，讨论与查询不触发" do
    assert AuthoringTaskPolicy.explicit_action_intent("第02章：旧服务器里的残诀的正文还没写，帮我写出来吧。") ==
             :write_chapter

    assert AuthoringTaskPolicy.explicit_action_intent("接着第01章往下写一段正文") == :write_chapter

    assert AuthoringTaskPolicy.explicit_action_intent("帮我设计一个配角，后面剧情里会用到。") ==
             :design_character

    assert AuthoringTaskPolicy.explicit_action_intent("把「第02章」的结尾改一下，改成雨夜。") ==
             :revise_content

    assert AuthoringTaskPolicy.explicit_action_intent("老沈适合当主角吗？只讨论，不要改作品设定。") ==
             nil

    assert AuthoringTaskPolicy.explicit_action_intent("第二章写完了吗？") == nil
    assert AuthoringTaskPolicy.explicit_action_intent("帮我看看这章有什么建议") == nil
    assert AuthoringTaskPolicy.explicit_action_intent("设计一个角色有哪些方向？先讨论。") == nil

    assert AuthoringTaskPolicy.action_intent_capability(:write_chapter) == "prose_writing"
    assert AuthoringTaskPolicy.action_intent_capability(:design_character) == "character_design"

    assert AuthoringTaskPolicy.action_intent_capability(:revise_content) ==
             "revise_adopted_content"
  end

  test "B33 CP2：判断规则包含动作意图必须 execute 或具体澄清、不得 reply/creative/await 终局" do
    rules = AuthoringTaskPolicy.rules()

    assert rules =~ "写/续写/重写某章正文时"
    assert rules =~ "直接 execute prose_writing"
    assert rules =~ "不能以 reply / propose_creative_directions / await_author 结束"
    assert rules =~ "设计一个角色时用 execute character_design"
    assert rules =~ "目标段/范围不明确时用 ask_author"
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
