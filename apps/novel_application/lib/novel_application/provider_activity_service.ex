defmodule NovelApplication.ProviderActivityService do
  @moduledoc """
  Author-safe ProviderRun activity query scoped by work/session/turn.

  This service reads persisted ProviderExecution facts only. It never calls a
  provider while building the activity report.
  """

  alias NovelApplication.WorkService
  alias NovelPersistence.{AgentRunLog, ProviderRunLog, WorkSessionRepo}

  @doc "Fetch persisted ProviderRun activity for one author turn."
  @spec fetch_turn_activity(String.t(), String.t(), String.t()) ::
          {:ok, map()} | {:error, :work_not_found | :session_not_found}
  def fetch_turn_activity(work_id, session_id, turn_id)
      when is_binary(work_id) and is_binary(session_id) and is_binary(turn_id) do
    with work when not is_nil(work) <- WorkService.get(work_id),
         session when not is_nil(session) <- WorkSessionRepo.get_by_work(work_id, session_id) do
      agent_runs = AgentRunLog.list_by_parent_turn(work.id, session.id, turn_id)
      provider_runs = Enum.flat_map(agent_runs, &provider_runs_for_agent_run/1)

      {:ok,
       %{
         work_id: work.id,
         session_id: session.id,
         turn_id: turn_id,
         provider_runs: provider_runs,
         agent_runs: Enum.map(agent_runs, &agent_run_summary/1),
         totals: totals(provider_runs)
       }}
    else
      nil ->
        if WorkService.get(work_id) == nil do
          {:error, :work_not_found}
        else
          {:error, :session_not_found}
        end
    end
  end

  defp agent_run_summary(run) do
    %{
      run_id: run.id,
      run_mode: run.run_mode,
      profile_ref: run.profile_ref,
      status: run.status,
      phase: run.phase,
      provider_run_count: length(ProviderRunLog.list_runs(run.id))
    }
  end

  defp provider_runs_for_agent_run(run) do
    run.id
    |> ProviderRunLog.list_activity_summaries()
    |> Enum.map(&Map.put(&1, :run_id, run.id))
  end

  defp totals(provider_runs) do
    %{
      provider_run_count: length(provider_runs),
      provider_call_refs:
        provider_runs
        |> Enum.map(&map_value(&1, :provider_call_ref))
        |> Enum.reject(&blank?/1),
      total_tokens: Enum.reduce(provider_runs, 0, &(&2 + provider_tokens(&1))),
      content_length: Enum.reduce(provider_runs, 0, &(&2 + content_length(&1)))
    }
  end

  defp provider_tokens(run) do
    usage =
      case map_value(run, :output) do
        output when is_map(output) -> map_value(output, :usage)
        _ -> nil
      end

    usage = if is_map(usage), do: usage, else: map_value(run, :usage)

    total_tokens = integer_value(usage, :total_tokens)

    if total_tokens > 0 do
      total_tokens
    else
      integer_value(usage, :input_tokens) + integer_value(usage, :output_tokens) +
        integer_value(usage, :prompt_tokens) + integer_value(usage, :completion_tokens)
    end
  end

  defp content_length(run), do: integer_value(run, :content_length)

  defp integer_value(map, key) when is_map(map) do
    case map_value(map, key) do
      value when is_integer(value) -> value
      value when is_binary(value) -> parse_integer(value)
      _ -> 0
    end
  end

  defp integer_value(_map, _key), do: 0

  defp parse_integer(value) do
    case Integer.parse(value) do
      {number, ""} -> number
      _ -> 0
    end
  end

  defp map_value(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_value(_map, _key), do: nil

  defp blank?(value), do: value in [nil, ""]
end
