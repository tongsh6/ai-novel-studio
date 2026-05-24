defmodule NovelApplication.AdoptionBoundaryTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AdoptionBoundary
  alias NovelDomain.AdoptionDecision
  alias NovelDomain.CandidateSet

  defp build_candidate_set(attrs \\ []) do
    defaults = [
      candidate_set_id: "cs-test",
      turn_id: "t-test",
      candidate_type: :direction,
      candidates: [
        %{
          candidate_id: "c-1",
          summary: "方向A",
          content_ref: "ref-a",
          origin_ref: "tool:creative_gen",
          risk_hint: :low,
          adoption_target_ref: "char_1"
        },
        %{
          candidate_id: "c-2",
          summary: "方向B",
          content_ref: "ref-b",
          origin_ref: "tool:creative_gen",
          risk_hint: :high,
          adoption_target_ref: "char_2"
        },
        %{
          candidate_id: "c-3",
          summary: "方向C",
          content_ref: "ref-c",
          origin_ref: "tool:creative_gen",
          risk_hint: :medium,
          adoption_target_ref: "char_3"
        }
      ]
    ]

    struct!(CandidateSet, Keyword.merge(defaults, attrs))
  end

  # ── Candidate selection → adoption decision ────

  describe "adoption evaluation" do
    test "low-risk candidate is adopted as tentative" do
      set = build_candidate_set()
      chosen = %{candidate_id: "c-1"}

      decision = AdoptionBoundary.evaluate(set, chosen)

      assert decision.decision_type == :adopt_tentative
      assert AdoptionDecision.adopted?(decision)
      assert decision.adopted_state_ref != nil
      assert decision.projection_hints != []
    end

    test "high-risk candidate requires confirmation" do
      set = build_candidate_set()
      chosen = %{candidate_id: "c-2"}

      decision = AdoptionBoundary.evaluate(set, chosen)

      assert decision.decision_type == :require_confirmation
      refute AdoptionDecision.adopted?(decision)
    end

    test "unknown candidate fails with recovery" do
      set = build_candidate_set()
      chosen = %{candidate_id: "c-nonexistent"}

      decision = AdoptionBoundary.evaluate(set, chosen)

      assert decision.decision_type == :fail_with_recovery
      refute AdoptionDecision.adopted?(decision)
    end

    test "non-tentative candidate set is rejected" do
      set = build_candidate_set(stability: :adopted)
      chosen = %{candidate_id: "c-1"}

      decision = AdoptionBoundary.evaluate(set, chosen)

      assert decision.decision_type == :reject
    end

    test "stale candidate set is rejected with source freshness reason" do
      set = build_candidate_set(stability: :stale)
      chosen = %{candidate_id: "c-1"}

      decision = AdoptionBoundary.evaluate(set, chosen)

      assert decision.decision_type == :reject
      assert "source_turn_stale" in decision.reason_codes
      assert "stale_candidate_set" in decision.reason_codes
      refute AdoptionDecision.adopted?(decision)
    end

    test "adopted decision has reason codes" do
      set = build_candidate_set()
      chosen = %{candidate_id: "c-1"}

      decision = AdoptionBoundary.evaluate(set, chosen)

      assert [_ | _] = decision.reason_codes
      assert "candidate_adopted_as_tentative" in decision.reason_codes
    end

    test "uses candidate set trace as decision trace provenance" do
      set = build_candidate_set(trace_ref: "trace-source")

      adopted = AdoptionBoundary.evaluate(set, %{candidate_id: "c-1"})
      confirmation = AdoptionBoundary.evaluate(set, %{candidate_id: "c-2"})
      rejected = AdoptionBoundary.evaluate(%{set | stability: :adopted}, %{candidate_id: "c-1"})
      missing = AdoptionBoundary.evaluate(set, %{candidate_id: "missing"})

      assert adopted.decision_trace_ref == "trace-source"
      assert confirmation.decision_trace_ref == "trace-source"
      assert rejected.decision_trace_ref == "trace-source"
      assert missing.decision_trace_ref == "trace-source"
    end

    test "projection hint appears only on adoption" do
      set = build_candidate_set()

      adopted = AdoptionBoundary.evaluate(set, %{candidate_id: "c-1"})
      assert adopted.projection_hints != []

      rejected = AdoptionBoundary.evaluate(set, %{candidate_id: "c-2"})
      assert rejected.projection_hints == []
    end

    test "cross-work candidate is rejected before adoption" do
      set =
        build_candidate_set(
          candidates: [
            %{
              candidate_id: "c-1",
              summary: "方向A",
              content_ref: "ref-a",
              origin_ref: "tool:creative_gen",
              risk_hint: :low,
              adoption_target_ref: "char_1",
              work_id: "work-a"
            }
          ]
        )

      decision =
        AdoptionBoundary.evaluate(
          set,
          %{candidate_id: "c-1", work_id: "work-b"},
          nil,
          work_id: "work-b",
          artifact_work_id: "work-a"
        )

      assert decision.decision_type == :fail_with_recovery
      assert "work_id_mismatch" in decision.reason_codes
      refute AdoptionDecision.adopted?(decision)
    end
  end

  # ── Invariants ──────────────────────────────────

  describe "adoption invariants" do
    test "candidate set stability defaults to tentative" do
      set = build_candidate_set()
      assert set.stability == :tentative
    end

    test "selection != adoption by default" do
      set = build_candidate_set()
      chosen = %{candidate_id: "c-2"}

      decision = AdoptionBoundary.evaluate(set, chosen)

      refute AdoptionDecision.adopted?(decision)
    end

    test "stale candidate_id fails" do
      set = build_candidate_set()
      chosen = %{candidate_id: "stale-id"}

      decision = AdoptionBoundary.evaluate(set, chosen)
      assert decision.decision_type == :fail_with_recovery
    end
  end
end
