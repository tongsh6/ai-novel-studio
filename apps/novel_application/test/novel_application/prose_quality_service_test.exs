defmodule NovelApplication.ProseQualityServiceTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ProseQualityService

  @bad_uniform "他走进房间，看了看四周，坐了下来。\n他拿起书本，翻了翻几页，放了下来。\n他望向窗外，看了看天色，叹了口气。\n他端起茶杯，喝了一小口，搁了回去。"
  @clean "林越把木匣推到桌角，没有看师父的眼睛。炭火噼啪响了一声，他终于开口。"

  test "uniform form is recalled as a candidate but is not a finding before semantic adjudication" do
    result = ProseQualityService.evaluate(@bad_uniform, %{source_turn_ref: "t1"})
    assert result.review_status == :completed
    assert result.form_candidates != []
    assert result.findings == []
    assert result.policy.action == :proceed
  end

  test "clean prose → no findings, proceed" do
    result = ProseQualityService.evaluate(@clean, %{})
    assert result.findings == []
    assert result.review_status == :completed
    assert result.policy.action == :proceed
  end

  test "failing semantic evaluator → review unavailable, never faked as pass" do
    failing = fn _text, _ctx -> {:error, :timeout} end
    result = ProseQualityService.evaluate(@clean, %{}, semantic_fn: failing)
    assert result.review_status == :unavailable
    assert result.policy.action == :quality_review_unavailable
  end

  test "raising semantic evaluator is caught → unavailable without promoting form candidates" do
    raising = fn _text, _ctx -> raise "boom" end
    result = ProseQualityService.evaluate(@bad_uniform, %{}, semantic_fn: raising)
    assert result.review_status == :unavailable
    assert result.form_candidates != []
    assert result.findings == []
  end

  test "semantic evaluator can confirm a form candidate as a local mechanical repetition" do
    semantic = fn _text, %{form_candidates: [candidate]} ->
      {:ok,
       [
         %{
           "candidate_id" => candidate["candidate_id"],
           "quality_gate_ref" => "quality_gate.style_fit",
           "validator_ref" => "validator.sentence_rhythm_uniformity",
           "summary" => "连续动作句式机械重复",
           "reasoning" => "相同骨架没有形成强度或后果递进。",
           "confidence" => 0.88,
           "impact_scope" => "local",
           "revision_scope" => "local",
           "suggested_revision" => %{"instruction" => "只改命中句段。"}
         }
       ]}
    end

    result = ProseQualityService.evaluate(@bad_uniform, %{}, semantic_fn: semantic)
    assert [finding] = result.findings
    assert finding.validator_ref == "validator.sentence_rhythm_uniformity"
    assert finding.quality_finding_id =~ "qf_fc_"
    assert finding.evidence_spans != []
    assert finding.revision_scope == :local
  end

  test "semantic evaluator can suppress deliberate rhetoric without fabricating a finding" do
    rhetorical = "他要活着。他要回去。他要雪耻。"
    semantic = fn _text, %{form_candidates: [_candidate]} -> {:ok, []} end

    result = ProseQualityService.evaluate(rhetorical, %{}, semantic_fn: semantic)
    assert result.form_candidates != []
    assert result.findings == []
    assert result.policy.action == :proceed
  end

  test "successful semantic evaluator findings merged with deterministic" do
    semantic = fn _text, _ctx ->
      {:ok,
       [
         %{
           "quality_gate_ref" => "quality_gate.character_logic",
           "validator_ref" => "validator.character_agency",
           "summary" => "主角缺乏目标",
           "action" => "adoption_review",
           "reasoning" => "正文没有呈现主角的主动选择。",
           "confidence" => 0.82,
           "impact_scope" => "paragraph",
           "revision_scope" => "paragraph",
           "evidence_spans" => [
             %{"text" => "他只是站在那里。", "sentence_start" => 1, "sentence_end" => 1}
           ]
         }
       ], "pc-quality-evaluator"}
    end

    result = ProseQualityService.evaluate(@clean, %{source_turn_ref: "t2"}, semantic_fn: semantic)
    assert result.review_status == :completed
    assert result.evaluator_provider_call_ref == "pc-quality-evaluator"
    refs = Enum.map(result.findings, & &1.validator_ref)
    assert "validator.character_agency" in refs
    # semantic finding 溯源字段由服务用 ctx 补齐
    agency = Enum.find(result.findings, &(&1.validator_ref == "validator.character_agency"))
    assert agency.source_turn_ref == "t2"
    assert result.policy.action == :adoption_review
  end

  describe "B11D scene attribution (质量场粒度)" do
    @scene_units [
      %{"unit_id" => "scene_1", "scene_title" => "交锋"},
      %{"unit_id" => "scene_2", "scene_title" => "撤退"}
    ]

    test "finding with legal scene_N brief ref is attributed to that planned scene" do
      semantic = fn _text, _ctx ->
        {:ok,
         [
           %{
             "quality_finding_id" => "qf_scene",
             "quality_gate_ref" => "quality_gate.style_fit",
             "validator_ref" => "validator.sentence_rhythm_uniformity",
             "severity" => "warn",
             "action" => "warn",
             "summary" => "第二场动作句机械重复",
             "reasoning" => "相同骨架没有形成递进。",
             "confidence" => 0.8,
             "evidence_spans" => [
               %{"text" => "他猛地侧身。他一刀劈下。", "sentence_start" => 1, "sentence_end" => 2}
             ],
             "impact_scope" => "local",
             "revision_scope" => "local",
             "brief_field_refs" => ["scene_2.emotion_transition"]
           }
         ]}
      end

      result =
        ProseQualityService.evaluate(@bad_uniform, %{scene_units: @scene_units},
          semantic_fn: semantic
        )

      [finding] = result.findings
      assert finding.scene_index == 2
      assert finding.scene_title == "撤退"
    end

    test "self-reported scene fields are not trusted; only server-derived attribution is kept" do
      semantic = fn _text, _ctx ->
        {:ok,
         [
           %{
             "quality_finding_id" => "qf_forged",
             "quality_gate_ref" => "quality_gate.style_fit",
             "validator_ref" => "validator.sentence_rhythm_uniformity",
             "severity" => "warn",
             "action" => "warn",
             "summary" => "伪造场 id",
             "reasoning" => "evaluator 自报场字段。",
             "confidence" => 0.8,
             "evidence_spans" => [
               %{"text" => "他猛地侧身。", "sentence_start" => 1, "sentence_end" => 1}
             ],
             "impact_scope" => "local",
             "revision_scope" => "local",
             "scene_index" => 2,
             "scene_title" => "伪造"
           }
         ]}
      end

      result =
        ProseQualityService.evaluate(@bad_uniform, %{scene_units: @scene_units},
          semantic_fn: semantic
        )

      [finding] = result.findings
      assert finding.scene_index == nil
      assert finding.scene_title == nil
    end

    test "unknown scene_N ref does not fabricate attribution" do
      semantic = fn _text, _ctx ->
        {:ok,
         [
           %{
             "quality_finding_id" => "qf_unknown_scene",
             "quality_gate_ref" => "quality_gate.style_fit",
             "validator_ref" => "validator.sentence_rhythm_uniformity",
             "severity" => "warn",
             "action" => "warn",
             "summary" => "未知场",
             "reasoning" => "场 id 不在 brief 白名单。",
             "confidence" => 0.7,
             "evidence_spans" => [
               %{"text" => "他猛地侧身。", "sentence_start" => 1, "sentence_end" => 1}
             ],
             "impact_scope" => "local",
             "revision_scope" => "local",
             "brief_field_refs" => ["scene_9.emotion_transition"]
           }
         ]}
      end

      result =
        ProseQualityService.evaluate(@bad_uniform, %{scene_units: @scene_units},
          semantic_fn: semantic
        )

      [finding] = result.findings
      assert finding.scene_index == nil
      assert finding.scene_title == nil
    end
  end
end
