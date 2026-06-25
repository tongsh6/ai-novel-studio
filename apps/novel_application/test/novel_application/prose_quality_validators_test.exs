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

  test "bad_uniform_paragraphs → prose_pattern_repetition" do
    text =
      "他走进房间，看了看四周，坐了下来。\n他拿起书本，翻了翻几页，放了下来。\n他望向窗外，看了看天色，叹了口气。\n他端起茶杯，喝了一小口，搁了回去。"

    refs = V.evaluate(text, %{}) |> validator_refs()
    assert "validator.prose_pattern_repetition" in refs
  end

  test "structural meta label leak → prose_pattern_repetition" do
    text = "场景 2\n他推开门，屋里空无一人。"
    refs = V.evaluate(text, %{}) |> validator_refs()
    assert "validator.prose_pattern_repetition" in refs
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
      V.evaluate(text, %{source_ref: "as_1", source_turn_ref: "turn_1", source_type: :prose_fragment})

    assert %QualityFinding{} = finding
    assert finding.source_ref == "as_1"
    assert finding.source_turn_ref == "turn_1"
    assert finding.action == :warn
    assert finding.can_override == true
  end
end
