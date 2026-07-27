defmodule NovelApplication.ProseQualityValidatorsTest do
  @moduledoc """
  确定性 validator 对照 VS-00E CP0 基线坏样本
  （quality/acceptance/fixtures/prose-quality/baseline-bad-samples.yml）。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.ProseQualityValidators, as: V
  alias NovelDomain.QualityFinding

  defp validator_refs(findings), do: Enum.map(findings, & &1.validator_ref)

  test "clean varied prose produces no findings" do
    clean =
      "林越把木匣推到桌角，没有看师父的眼睛。炭火噼啪响了一声，他终于开口，问起十年前那桩旧案的卷宗下落。"

    assert V.evaluate(clean, %{}) == []
  end

  test "empty / nil → no findings" do
    assert V.evaluate("", %{}) == []
    assert V.evaluate(nil, %{}) == []
  end

  test "bad_emotion_declared → emotion_expression_balance" do
    text =
      "他感到非常愤怒。他也感到很悲伤，同时还有一点点害怕。\n她感到很幸福。两个人都觉得这一刻非常感人。"

    refs = V.evaluate(text, %{}) |> validator_refs()
    assert "validator.emotion_expression_balance" in refs
  end

  test "bad_body_reaction_template → prose_pattern_repetition" do
    text =
      "他的心脏猛地一跳。她的心脏也猛地一跳。\n他的瞳孔骤然收缩。她的瞳孔也骤然收缩。\n他的拳头不自觉握紧。她的拳头也不自觉握紧。\n他的后背渗出一层冷汗。她的后背也渗出一层冷汗。"

    refs = V.evaluate(text, %{}) |> validator_refs()
    assert "validator.prose_pattern_repetition" in refs
  end

  test "structural meta label leak → prose_pattern_repetition" do
    text = "场景 2\n他推开门，屋里空无一人。"
    refs = V.evaluate(text, %{}) |> validator_refs()
    assert "validator.prose_pattern_repetition" in refs
  end

  test "B9：章号叙述自指与工作流程词 → prose_pattern_repetition（M2 Q2/Q3 修向）" do
    for leaky <- [
          "他想起第51章中恢复的记忆碎片，握紧了拳。",
          "那是第60章将要出现的巨变的前兆。",
          "此段为待采纳内容，需后续审校。"
        ] do
      refs = V.evaluate(leaky, %{}) |> validator_refs()
      assert "validator.prose_pattern_repetition" in refs, "未命中：#{leaky}"
    end

    clean = "他握紧了拳，记忆碎片在脑海里翻涌，巷口的风带着铁锈味。"
    refute "validator.prose_pattern_repetition" in (V.evaluate(clean, %{}) |> validator_refs())
  end

  test "B9：meta_leak_hits 导出扫描与生成期同一 pattern 源" do
    assert V.meta_leak_hits("这是第12章的伏笔。") != []
    assert V.meta_leak_hits("干净的正文段落。") == []
  end

  test "ai cliche overuse → prose_pattern_repetition" do
    text =
      "随着夜色降临，他不由得停下脚步，仿佛听见了什么。一阵风吹过，他微微一怔，缓缓转身，心头掠过一丝不安。"

    refs = V.evaluate(text, %{}) |> validator_refs()
    assert "validator.prose_pattern_repetition" in refs
  end

  test "findings carry ctx source refs and are author-overridable warnings" do
    text = "场景 1\n他推门进来。"

    [finding | _] =
      V.evaluate(text, %{
        source_ref: "as_1",
        source_turn_ref: "turn_1",
        source_type: :prose_fragment
      })

    assert %QualityFinding{} = finding
    assert finding.source_ref == "as_1"
    assert finding.source_turn_ref == "turn_1"
    assert finding.action == :warn
    assert finding.can_override == true
    assert [evidence | _] = finding.evidence_spans
    assert evidence["text"] == "场景 1"
    assert evidence["location"] == "正文第 1 句"
    assert evidence["sentence_start"] == 1
    assert evidence["sentence_end"] == 1
    assert evidence["end_offset"] > evidence["start_offset"]
  end

  test "dialogue count is not used as a deterministic pacing proxy" do
    text =
      "矿道一路向下延伸，碎石在脚底咯咯作响。墙壁上的旧阵纹早已熄灭，只剩潮湿的灵气贴着石面流动。" <>
        "远处隐约传来巡检车低沉的嗡鸣。他停下脚步，借着护身符的微光辨认岔路。" <>
        "头顶的支架发出不堪重负的呻吟。空气里混着铁锈与霉味，呛得人喉咙发紧。" <>
        "脊背的冷汗一层层沁出。前方的黑暗深不见底，却又像在等他自己走进去。"

    findings = V.evaluate(text, %{})
    refs = validator_refs(findings)
    refute "validator.dialogue_density" in refs
  end
end
