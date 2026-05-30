defmodule NovelApplication.AdoptionBoundary do
  @moduledoc """
  采纳边界——决定 candidate/ToolResult/tentative artifact 能否成为 adopted state。

  VS-04 不写 production state，但证明选择→评估→采纳决策的完整链路。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.AdoptionDecision
  alias NovelDomain.CandidateSet

  @doc """
  评估一个 candidate 是否可被采纳。返回 AdoptionDecision。
  """
  @spec evaluate(CandidateSet.t(), map(), ToolResult.t() | nil) :: AdoptionDecision.t()
  def evaluate(%CandidateSet{} = candidate_set, chosen_candidate, tool_result \\ nil) do
    evaluate(candidate_set, chosen_candidate, tool_result, [])
  end

  @spec evaluate(CandidateSet.t(), map(), ToolResult.t() | nil, keyword() | map()) ::
          AdoptionDecision.t()
  def evaluate(%CandidateSet{} = candidate_set, chosen_candidate, _tool_result, opts) do
    decision_id = "ad_#{System.unique_integer([:positive, :monotonic])}"
    candidate_id = chosen_candidate[:candidate_id] || chosen_candidate["candidate_id"]
    candidate = find_candidate(candidate_set, candidate_id)
    decision_trace_ref = candidate_set.trace_ref || "decision_trace:#{decision_id}"

    t0 = System.monotonic_time(:millisecond)

    LogEmit.emit(:adoption, :evaluate, :start, %{candidate_set_id: candidate_set.candidate_set_id})

    decision =
      %{
        candidate_set: candidate_set,
        chosen_candidate: chosen_candidate,
        candidate: candidate,
        candidate_id: candidate_id,
        decision_id: decision_id,
        decision_trace_ref: decision_trace_ref,
        opts: opts
      }
      |> evaluate_candidate_decision()

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

  defp non_tentative_reason_codes(:stale), do: ["source_turn_stale", "stale_candidate_set"]
  defp non_tentative_reason_codes(_), do: ["candidate_not_tentative", "stale_candidate_set"]

  defp evaluate_candidate_decision(context) do
    [
      &missing_candidate_decision/1,
      &work_boundary_decision/1,
      &stability_decision/1,
      &canon_conflict_decision/1,
      &overwrite_decision/1,
      &high_risk_decision/1
    ]
    |> Enum.find_value(fn decision_fn -> decision_fn.(context) end)
    |> case do
      nil -> adopt_tentative_decision(context)
      decision -> decision
    end
  end

  defp missing_candidate_decision(%{
         candidate: nil,
         candidate_id: candidate_id,
         candidate_set: candidate_set,
         decision_id: decision_id,
         decision_trace_ref: decision_trace_ref
       }) do
    %AdoptionDecision{
      adoption_decision_id: decision_id,
      turn_id: candidate_set.turn_id,
      source_action_ref: "choose_candidate",
      candidate_ref: candidate_id || "unknown",
      decision_type: :fail_with_recovery,
      reason_codes: ["candidate_not_found", "stale_or_invented_selection"],
      decision_trace_ref: decision_trace_ref
    }
  end

  defp missing_candidate_decision(_context), do: nil

  defp work_boundary_decision(%{
         candidate: candidate,
         chosen_candidate: chosen_candidate,
         candidate_id: candidate_id,
         candidate_set: candidate_set,
         decision_id: decision_id,
         decision_trace_ref: decision_trace_ref,
         opts: opts
       }) do
    if work_boundary_mismatch?(candidate, chosen_candidate, opts) do
      %AdoptionDecision{
        adoption_decision_id: decision_id,
        turn_id: candidate_set.turn_id,
        source_action_ref: "choose_candidate",
        candidate_ref: candidate_id,
        target_ref: candidate.adoption_target_ref,
        decision_type: :fail_with_recovery,
        reason_codes: ["work_id_mismatch", "cross_work_adoption_rejected"],
        decision_trace_ref: decision_trace_ref
      }
    end
  end

  defp stability_decision(%{
         candidate_id: candidate_id,
         candidate_set: candidate_set,
         decision_id: decision_id,
         decision_trace_ref: decision_trace_ref
       }) do
    if candidate_set.stability != :tentative do
      %AdoptionDecision{
        adoption_decision_id: decision_id,
        turn_id: candidate_set.turn_id,
        source_action_ref: "choose_candidate",
        candidate_ref: candidate_id,
        decision_type: :reject,
        reason_codes: non_tentative_reason_codes(candidate_set.stability),
        decision_trace_ref: decision_trace_ref
      }
    end
  end

  defp canon_conflict_decision(%{
         candidate: candidate,
         candidate_id: candidate_id,
         candidate_set: candidate_set,
         decision_id: decision_id,
         decision_trace_ref: decision_trace_ref
       }) do
    if canon_conflict?(candidate) do
      %AdoptionDecision{
        adoption_decision_id: decision_id,
        turn_id: candidate_set.turn_id,
        source_action_ref: "choose_candidate",
        candidate_ref: candidate_id,
        target_ref: candidate.adoption_target_ref,
        decision_type: :fail_with_recovery,
        reason_codes: ["canon_conflict_detected", "conflict_recovery_required"],
        decision_trace_ref: decision_trace_ref
      }
    end
  end

  # 覆盖已有 canon（已采纳正文/设定）是 production write，必须先确认（VS-04 §4）。
  # 作者确认后（confirmation_satisfied）重新 gate 时放行。
  defp overwrite_decision(%{
         candidate: candidate,
         candidate_id: candidate_id,
         candidate_set: candidate_set,
         decision_id: decision_id,
         decision_trace_ref: decision_trace_ref,
         opts: opts
       }) do
    if option_field(opts, :overwrite) == true and not confirmation_satisfied?(opts) do
      %AdoptionDecision{
        adoption_decision_id: decision_id,
        turn_id: candidate_set.turn_id,
        source_action_ref: "choose_candidate",
        candidate_ref: candidate_id,
        decision_type: :require_confirmation,
        target_ref: candidate && candidate.adoption_target_ref,
        reason_codes: ["overwrite_existing_canon", "confirmation_required"],
        decision_trace_ref: decision_trace_ref
      }
    end
  end

  defp overwrite_decision(_context), do: nil

  defp high_risk_decision(%{
         candidate: candidate,
         candidate_id: candidate_id,
         candidate_set: candidate_set,
         decision_id: decision_id,
         decision_trace_ref: decision_trace_ref,
         opts: opts
       }) do
    if candidate.risk_hint == :high and not confirmation_satisfied?(opts) do
      %AdoptionDecision{
        adoption_decision_id: decision_id,
        turn_id: candidate_set.turn_id,
        source_action_ref: "choose_candidate",
        candidate_ref: candidate_id,
        decision_type: :require_confirmation,
        target_ref: candidate.adoption_target_ref,
        reason_codes: ["high_risk_candidate", "confirmation_required"],
        decision_trace_ref: decision_trace_ref
      }
    end
  end

  defp confirmation_satisfied?(opts), do: option_field(opts, :confirmation_satisfied) == true

  defp adopt_tentative_decision(%{
         candidate: candidate,
         candidate_id: candidate_id,
         candidate_set: candidate_set,
         decision_id: decision_id,
         decision_trace_ref: decision_trace_ref
       }) do
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
      decision_trace_ref: decision_trace_ref
    }
  end

  defp canon_conflict?(candidate) do
    candidate
    |> map_field(:canon_conflicts)
    |> List.wrap()
    |> Enum.any?(&map_size_positive?/1)
  end

  defp map_size_positive?(value) when is_map(value), do: map_size(value) > 0
  defp map_size_positive?(_value), do: false

  defp find_candidate(_set, nil), do: nil

  defp find_candidate(set, candidate_id) do
    Enum.find(set.candidates, &(&1.candidate_id == candidate_id))
  end

  defp work_boundary_mismatch?(candidate, chosen_candidate, opts) do
    requested_work_id =
      option_field(opts, :work_id) ||
        option_field(opts, :expected_work_id) ||
        map_field(chosen_candidate, :work_id)

    referenced_work_ids =
      [
        option_field(opts, :source_work_id),
        option_field(opts, :artifact_work_id),
        map_field(candidate, :work_id)
      ]
      |> Enum.reject(&blank?/1)
      |> Enum.uniq()

    if blank?(requested_work_id) do
      length(referenced_work_ids) > 1
    else
      Enum.any?(referenced_work_ids, &(&1 != requested_work_id))
    end
  end

  defp option_field(opts, key) when is_list(opts), do: Keyword.get(opts, key)

  defp option_field(opts, key) when is_map(opts) do
    Map.get(opts, key) || Map.get(opts, Atom.to_string(key))
  end

  defp option_field(_opts, _key), do: nil

  defp map_field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp map_field(_map, _key), do: nil

  defp blank?(value), do: is_nil(value) or value == ""

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
