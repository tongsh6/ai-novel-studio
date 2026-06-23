defmodule NovelApplication.TraceReplayService do
  @moduledoc """
  Work/session scoped replay query for persisted turn traces.

  The service is the application boundary consumed by web/API callers: it checks
  work and session ownership before building an author-safe ReplayReport.
  """

  alias NovelApplication.ReplayService
  alias NovelApplication.WorkService
  alias NovelDomain.DecisionTrace
  alias NovelPersistence.TraceRepository
  alias NovelPersistence.WorkSessionRepo

  @decision_types ~w(
    reply_only exploration downgrade confirmation_required clarification_required rejected
    recovery fail_with_recovery tool_allowed tool_dispatched adopt_tentative cancel_waiting
    author_action
  )a

  @event_atoms ~w(
    author_input_received frame_formed micro_plan_recorded orchestrator_decision_recorded
    reply_only_decision_recorded turn_result_emitted tool_dispatched tool_result_received
    behavior_trace_recorded behavior_resolution_recorded state_trace_recorded
    projection_hint_emitted author_action_received
  )a

  @blocking_gates ~w(action_scope planner_boundary authority_budget confirmation_required)

  @doc """
  Return the latest persisted author-safe replay report for one work/session turn.
  """
  @spec fetch_turn_report(String.t(), String.t(), String.t()) ::
          {:ok, map()} | {:error, :work_not_found | :session_not_found | :trace_not_found}
  def fetch_turn_report(work_id, session_id, turn_id)
      when is_binary(work_id) and is_binary(session_id) and is_binary(turn_id) do
    with work when not is_nil(work) <- WorkService.get(work_id),
         session when not is_nil(session) <- WorkSessionRepo.get_by_work(work_id, session_id),
         [record | _] <- TraceRepository.list_by_scope(work_id, session_id, turn_id) do
      trace = trace_from_record(record)
      report = ReplayService.build_report(trace)

      {:ok,
       %{
         work_id: work.id,
         session_id: session.id,
         turn_id: turn_id,
         trace_summary: trace_summary(record, report),
         replay_report: replay_report_map(report)
       }}
    else
      nil ->
        if WorkService.get(work_id) == nil do
          {:error, :work_not_found}
        else
          {:error, :session_not_found}
        end

      [] ->
        {:error, :trace_not_found}
    end
  end

  defp trace_from_record(record) do
    %DecisionTrace{
      trace_id: record.trace_id,
      turn_id: record.turn_id,
      frame_ref: record.frame_ref,
      plan_ref: blank_to_nil(record.plan_ref),
      decision_type: atom_from_string(record.decision_type, @decision_types, :unknown),
      no_tool_reason: record.no_tool_reason || "",
      no_behavior_reason: record.no_behavior_reason || "",
      no_write_reason: record.no_write_reason || "",
      turn_result_ref: record.turn_result_ref,
      replay_policy: record.replay_policy || %{use_recorded_frame: true, recall_provider: false},
      redaction_level:
        atom_from_string(record.redaction_level, [:author_safe, :developer], :author_safe),
      tool_trace_refs: record.tool_trace_refs || [],
      behavior_trace_refs: record.behavior_trace_refs || [],
      state_trace_refs: record.state_trace_refs || [],
      event_order:
        Enum.map(record.event_order || [], &atom_from_string(&1, @event_atoms, :unknown))
    }
  end

  defp trace_summary(record, report) do
    %{
      trace_ref: record.trace_id,
      decision_type: record.decision_type,
      no_tool_reason: record.no_tool_reason,
      no_behavior_reason: record.no_behavior_reason,
      no_write_reason: record.no_write_reason,
      first_blocking_gate: first_blocking_gate(record.no_write_reason),
      plan_ref: record.plan_ref,
      frame_ref: record.frame_ref,
      context_refs: record.context_refs || [],
      tool_trace_refs: record.tool_trace_refs || [],
      behavior_trace_refs: record.behavior_trace_refs || [],
      state_trace_refs: record.state_trace_refs || [],
      replay_provider_called: report.provider_called,
      replay_result_status: Atom.to_string(report.result_status),
      replay_missing_trace_refs_count: length(report.missing_trace_refs)
    }
    |> put_tool_summary(record.tool_trace_refs || [])
  end

  defp put_tool_summary(summary, [tool_ref | _]) when is_map(tool_ref) do
    summary
    |> Map.put(:tool_name, map_value(tool_ref, :tool_name))
    |> Map.put(:tool_status, map_value(tool_ref, :tool_status))
  end

  defp put_tool_summary(summary, _), do: summary

  defp replay_report_map(report) do
    %{
      replay_report_id: report.replay_report_id,
      replay_case_ref: report.replay_case_ref,
      trace_ref: report.trace_ref,
      replay_level: Atom.to_string(report.replay_level),
      chain_summary: report.chain_summary,
      required_questions: report.required_questions,
      decision_explanations: report.decision_explanations,
      state_explanations: report.state_explanations,
      missing_trace_refs: report.missing_trace_refs,
      redaction_profile: Atom.to_string(report.redaction_profile),
      provider_called: report.provider_called,
      result_status: Atom.to_string(report.result_status),
      generated_at: report.generated_at
    }
  end

  defp atom_from_string(value, allowed, fallback) when is_atom(value) do
    if value in allowed, do: value, else: fallback
  end

  defp atom_from_string(value, allowed, fallback) when is_binary(value) do
    allowed
    |> Enum.find(&(Atom.to_string(&1) == value))
    |> Kernel.||(fallback)
  end

  defp atom_from_string(_value, _allowed, fallback), do: fallback

  defp blank_to_nil(value) when value in ["", nil], do: nil
  defp blank_to_nil(value), do: value

  defp first_blocking_gate(no_write_reason) when is_binary(no_write_reason) do
    Enum.find(@blocking_gates, fn gate ->
      String.contains?(no_write_reason, "blocked execution: #{gate}")
    end)
  end

  defp first_blocking_gate(_no_write_reason), do: nil

  defp map_value(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end
end
