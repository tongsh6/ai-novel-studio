defmodule NovelApplication.ProseQualityPolicyTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ProseQualityPolicy
  alias NovelDomain.QualityFinding

  defp finding(action) do
    QualityFinding.new(%{
      "quality_gate_ref" => "quality_gate.style_fit",
      "validator_ref" => "validator.x",
      "summary" => "s",
      "action" => Atom.to_string(action)
    })
  end

  test "no findings → proceed" do
    assert ProseQualityPolicy.decide([]).action == :proceed
  end

  test "only warn → proceed_with_warning" do
    assert ProseQualityPolicy.decide([finding(:warn)]).action == :proceed_with_warning
  end

  test "adoption_review present → adoption_review" do
    assert ProseQualityPolicy.decide([finding(:warn), finding(:adoption_review)]).action ==
             :adoption_review
  end

  test "confirm outranks adoption_review/warn" do
    assert ProseQualityPolicy.decide([finding(:warn), finding(:adoption_review), finding(:confirm)]).action ==
             :confirm
  end

  test "block outranks everything" do
    assert ProseQualityPolicy.decide([finding(:warn), finding(:confirm), finding(:block)]).action ==
             :block
  end

  test "evaluator unavailable never reported as pass, even with no findings" do
    assert ProseQualityPolicy.decide([], review_status: :unavailable).action ==
             :quality_review_unavailable

    assert ProseQualityPolicy.decide([finding(:warn)], review_status: :unavailable).action ==
             :quality_review_unavailable
  end

  test "decision carries counts and finding_count" do
    decision = ProseQualityPolicy.decide([finding(:warn), finding(:warn), finding(:block)])
    assert decision.finding_count == 3
    assert decision.action_counts[:warn] == 2
    assert decision.action_counts[:block] == 1
  end
end
