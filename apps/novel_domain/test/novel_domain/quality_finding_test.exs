defmodule NovelDomain.QualityFindingTest do
  use ExUnit.Case, async: true

  alias NovelDomain.QualityFinding, as: Finding

  defp base(extra) do
    Map.merge(
      %{
        "quality_gate_ref" => "quality_gate.style_fit",
        "validator_ref" => "validator.prose_pattern_repetition",
        "summary" => "模板化"
      },
      extra
    )
  end

  describe "new/1 validation" do
    test "nil and missing required fields → nil" do
      assert Finding.new(nil) == nil
      assert Finding.new(%{"validator_ref" => "v", "summary" => "s"}) == nil
      assert Finding.new(%{"quality_gate_ref" => "g", "summary" => "s"}) == nil
      assert Finding.new(%{"quality_gate_ref" => "g", "validator_ref" => "v"}) == nil
    end

    test "valid construct with string/atom keys" do
      f = Finding.new(base(%{"action" => "adoption_review", "severity" => "high"}))
      assert f.quality_gate_ref == "quality_gate.style_fit"
      assert f.action == :adoption_review
      assert f.severity == :high
    end

    test "illegal action/severity fall back to :warn" do
      f = Finding.new(base(%{"action" => "nuke", "severity" => "catastrophic"}))
      assert f.action == :warn
      assert f.severity == :warn
    end

    test "can_override defaults: block false, others true; explicit respected" do
      assert Finding.new(base(%{"action" => "block"})).can_override == false
      assert Finding.new(base(%{"action" => "warn"})).can_override == true

      assert Finding.new(base(%{"action" => "block", "can_override" => true})).can_override ==
               true
    end

    test "confidence normalized, out-of-range falls back to an explicit neutral value" do
      assert Finding.new(base(%{"confidence" => 0.8})).confidence == 0.8
      assert Finding.new(base(%{"confidence" => 5.0})).confidence == 0.5
      assert Finding.new(base(%{"confidence" => "high"})).confidence == 0.5
    end
  end

  describe "serialization" do
    test "to_map and author_safe_summary expose string-keyed fields" do
      f =
        Finding.new(
          base(%{
            "action" => "warn",
            "evidence_spans" => [%{"text" => "心脏猛地一跳"}],
            "brief_field_refs" => ["scene_1.emotion_transition"]
          })
        )

      m = Finding.to_map(f)
      assert m["action"] == "warn"
      assert m["quality_gate_ref"] == "quality_gate.style_fit"

      safe = Finding.author_safe_summary(f)
      assert safe["quality_gate"] == "quality_gate.style_fit"
      assert safe["summary"] == "模板化"
      assert safe["evidence_spans"] == [%{"text" => "心脏猛地一跳"}]
      assert String.starts_with?(safe["quality_finding_id"], "qf_")
      assert safe["reasoning"] != ""
      assert safe["confidence"] == 0.5
      assert safe["impact_scope"] == "local"
      assert safe["revision_scope"] == "local"
    end
  end
end
