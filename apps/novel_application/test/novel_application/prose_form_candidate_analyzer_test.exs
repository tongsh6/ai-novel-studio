defmodule NovelApplication.ProseFormCandidateAnalyzerTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ProseFormCandidateAnalyzer

  test "recalls a consecutive local form anomaly with evidence and sentence position" do
    text =
      "风从高架下卷过。他猛地侧身，避开刀锋。他一刀劈下，逼退来人。他反手格挡，撞上护栏。远处警笛忽然响了。"

    [candidate] = ProseFormCandidateAnalyzer.detect(text)

    assert candidate["detector_ref"] == "detector.sentence_structure_uniformity"
    assert candidate["sentence_start"] == 2
    assert candidate["sentence_end"] == 4
    assert String.starts_with?(candidate["candidate_id"], "fc_")
    assert [span] = candidate["evidence_spans"]
    assert span["sentence_start"] == 2
    assert span["sentence_end"] == 4
    assert span["text"] =~ "他猛地侧身"
    assert candidate["signals"]["opening"] == "他"
    assert candidate["signals"]["punctuation_skeleton"] == "，。"
  end

  test "does not recall non-consecutive or materially different structures" do
    text =
      "他推开门。雨水从檐角砸下来，院中无人应声。她隔着窗纸问了一句是谁。灯芯忽然爆响，照亮桌边那封信。"

    assert ProseFormCandidateAnalyzer.detect(text) == []
  end

  test "a deliberate parallel form is still only a candidate, not a quality finding" do
    text = "他要活着。他要回去。他要雪耻。"

    [candidate] = ProseFormCandidateAnalyzer.detect(text)
    assert candidate["sentence_start"] == 1
    assert candidate["sentence_end"] == 3
    refute Map.has_key?(candidate, "quality_gate_ref")
    refute Map.has_key?(candidate, "validator_ref")
  end
end
