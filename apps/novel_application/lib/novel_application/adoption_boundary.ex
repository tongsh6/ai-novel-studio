defmodule NovelApplication.AdoptionBoundary do
  @moduledoc """
  采纳边界——决定 candidate/ToolResult/tentative artifact 能否成为 adopted state。

  VS-04 不写 production state，但证明选择→评估→采纳决策的完整链路。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelDomain.AdoptionDecision
  alias NovelDomain.CandidateSet
  alias NovelDomain.ToolResult

  @doc """
  评估一个 candidate 是否可被采纳。返回 AdoptionDecision。
  """
  @spec evaluate(CandidateSet.t(), map(), ToolResult.t() | nil) :: AdoptionDecision.t()
  def evaluate(%CandidateSet{} = candidate_set, chosen_candidate, _tool_result \\ nil) do
    decision_id = "ad_#{System.unique_integer([:positive, :monotonic])}"
    candidate_id = chosen_candidate[:candidate_id] || chosen_candidate["candidate_id"]
    candidate = find_candidate(candidate_set, candidate_id)

    t0 = System.monotonic_time(:millisecond)
    LogEmit.emit(:adoption, :evaluate, :start, %{candidate_set_id: candidate_set.candidate_set_id})

    decision =
      cond do
      is_nil(candidate) ->
        %AdoptionDecision{
          adoption_decision_id: decision_id,
          turn_id: candidate_set.turn_id,
          source_action_ref: "choose_candidate",
          candidate_ref: candidate_id || "unknown",
          decision_type: :fail_with_recovery,
          reason_codes: ["candidate_not_found", "stale_or_invented_selection"]
        }

      candidate_set.stability != :tentative ->
        %AdoptionDecision{
          adoption_decision_id: decision_id,
          turn_id: candidate_set.turn_id,
          source_action_ref: "choose_candidate",
          candidate_ref: candidate_id,
          decision_type: :reject,
          reason_codes: ["candidate_not_tentative", "stale_candidate_set"]
        }

      candidate.risk_hint == :high ->
        %AdoptionDecision{
          adoption_decision_id: decision_id,
          turn_id: candidate_set.turn_id,
          source_action_ref: "choose_candidate",
          candidate_ref: candidate_id,
          decision_type: :require_confirmation,
          target_ref: candidate.adoption_target_ref,
          reason_codes: ["high_risk_candidate", "confirmation_required"]
        }

      true ->
        %AdoptionDecision{
          adoption_decision_id: decision_id,
          turn_id: candidate_set.turn_id,
          source_action_ref: "choose_candidate",
          candidate_ref: candidate_id,
          decision_type: :adopt_tentative,
          target_ref: candidate.adoption_target_ref,
          adopted_state_ref: "adopted:#{candidate_id}",
          state_trace_ref: "state_trace:#{decision_id}",
          reason_codes: ["candidate_adopted_as_tentative", "provenance_verified"],
          projection_hints: [build_projection_hint(candidate_set.turn_id, decision_id)],
          decision_trace_ref: "decision_trace:#{decision_id}"
        }
    end

    duration = System.monotonic_time(:millisecond) - t0

    LogEmit.emit(:adoption, :evaluate, :done, %{
      decision_type: decision.decision_type,
      reason_codes: decision.reason_codes,
      duration_ms: duration,
      outcome: outcome_for_decision(decision.decision_type)
    })

    decision
  end

  defp outcome_for_decision(:adopt_tentative), do: "ok"
  defp outcome_for_decision(:require_confirmation), do: "skipped"
  defp outcome_for_decision(:reject), do: "skipped"
  defp outcome_for_decision(:fail_with_recovery), do: "error"
  defp outcome_for_decision(_), do: "ok"

  defp find_candidate(_set, nil), do: nil

  defp find_candidate(set, candidate_id) do
    Enum.find(set.candidates, &(&1.candidate_id == candidate_id))
  end

  defp build_projection_hint(turn_id, _decision_id) do
    %{
      projection_hint_id: "ph_#{System.unique_integer([:positive, :monotonic])}",
      turn_id: turn_id,
      projection_ref: "character_list",
      reason: :adopted_state_changed,
      priority: :normal,
      stale_strategy: :refresh
    }
  end
end
