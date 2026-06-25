defmodule NovelApplication.ProseQualityServiceTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ProseQualityService

  @bad_uniform "他走进房间，看了看四周，坐了下来。\n他拿起书本，翻了翻几页，放了下来。\n他望向窗外，看了看天色，叹了口气。\n他端起茶杯，喝了一小口，搁了回去。"
  @clean "林越把木匣推到桌角，没有看师父的眼睛。炭火噼啪响了一声，他终于开口。"

  test "deterministic findings on bad prose, review completed, proceed_with_warning" do
    result = ProseQualityService.evaluate(@bad_uniform, %{source_turn_ref: "t1"})
    assert result.review_status == :completed
    assert result.findings != []
    assert result.policy.action == :proceed_with_warning
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

  test "raising semantic evaluator is caught → unavailable, deterministic findings kept" do
    raising = fn _text, _ctx -> raise "boom" end
    result = ProseQualityService.evaluate(@bad_uniform, %{}, semantic_fn: raising)
    assert result.review_status == :unavailable
    # 确定性发现仍保留，只是整体复核标记未完成
    assert result.findings != []
  end

  test "successful semantic evaluator findings merged with deterministic" do
    semantic = fn _text, _ctx ->
      {:ok,
       [
         %{
           "quality_gate_ref" => "quality_gate.character_logic",
           "validator_ref" => "validator.character_agency",
           "summary" => "主角缺乏目标",
           "action" => "adoption_review"
         }
       ]}
    end

    result = ProseQualityService.evaluate(@clean, %{source_turn_ref: "t2"}, semantic_fn: semantic)
    assert result.review_status == :completed
    refs = Enum.map(result.findings, & &1.validator_ref)
    assert "validator.character_agency" in refs
    # semantic finding 溯源字段由服务用 ctx 补齐
    agency = Enum.find(result.findings, &(&1.validator_ref == "validator.character_agency"))
    assert agency.source_turn_ref == "t2"
    assert result.policy.action == :adoption_review
  end
end
