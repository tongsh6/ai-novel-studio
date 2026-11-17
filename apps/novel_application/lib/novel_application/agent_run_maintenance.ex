defmodule NovelApplication.AgentRunMaintenance do
  @moduledoc """
  AgentRun 安全点的维护任务编排。复用既有 task supervisor、会话选择器、
  Provider 执行和 checkpoint 提交；只负责何时开始、迟到结果判定及提交。
  Server 持有 task 身份与命令顺序，本模块不拥有进程或第二个 compactor。
  """

  require NovelTelemetry.LogEmit, as: LogEmit

  alias NovelApplication.AgentRunFlows.AuthoringSession

  alias NovelApplication.{
    AuthoringSessionHistory,
    CompactionRecord,
    ContextPressure,
    TranscriptCompaction,
    TranscriptCompactionSummary
  }

  alias NovelDomain.AgentRun
  alias NovelPersistence.ProviderRunLog

  @terminal_statuses [:completed, :cancelled, :failed]

  @spec maybe_start(map()) :: map()
  def maybe_start(state) do
    if enabled?() and state.run.status not in @terminal_statuses and safe_point(state) == :ok and
         not is_nil(Map.get(state.stage_state, :judgment_transcript)) do
      case start(state, nil, :automatic) do
        {:noreply, next} ->
          next

        {:reply, {:ok, _receipt}, next} ->
          next

        {:reply, {:error, reason}, next} ->
          log_failure(next, reason)
          next
      end
    else
      state
    end
  end

  @spec start(map(), GenServer.from() | nil, :explicit | :automatic) ::
          {:noreply, map()} | {:reply, {:ok, map()} | {:error, term()}, map()}
  def start(state, from, mode) do
    with :ok <- safe_point(state),
         {:ok, pending} <- TranscriptCompactionSummary.pending_plan(state.run) do
      if pending do
        {reply, next} = compact_and_commit(state, pending)
        {:reply, reply, next}
      else
        start_new(state, from, mode)
      end
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  defp start_new(state, from, mode) do
    with {:ok, view} <- session_view(state),
         {:ok, plan} <- plan(view, mode, state.run) do
      case plan do
        :nothing_to_compact ->
          {:reply, {:ok, TranscriptCompaction.receipt(:nothing_to_compact)}, state}

        %{} ->
          start_plan(state, from, plan)
      end
    else
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  defp safe_point(%{current_task_ref: ref}) when not is_nil(ref),
    do: {:error, :execution_in_progress}

  defp safe_point(state) do
    if interrupted?(state), do: {:error, :maintenance_interrupted}, else: :ok
  end

  defp start_plan(state, from, plan) do
    key = TranscriptCompactionSummary.coverage_key(plan, state.run)
    discussion? = Map.get(plan, :discussion_sources, []) != []

    if discussion? and provider_budget_exhausted?(state.run),
      do: {:reply, {:error, :maintenance_provider_budget_exhausted}, state},
      else: launch(state, from, plan, key)
  end

  defp launch(state, from, plan, key) do
    server = self()
    # 维护属于同一 run，但不是上一业务 step 的继续执行。
    snapshot = %{
      run: %{state.run | current_step_ref: nil},
      provider_cancellation_token: state.provider_cancellation_token,
      stage_sink: fn attrs -> send(server, {:agent_stage_event, attrs}) end
    }

    dependency = state.provider_execution

    task =
      Task.Supervisor.async_nolink(NovelApplication.AgentStepTaskSupervisor, fn ->
        run = snapshot.run

        NovelTelemetry.LogContext.put_turn(
          run.workspace_id,
          run.work_id,
          run.parent_turn_ref,
          run.session_id
        )

        TranscriptCompactionSummary.prepare(plan, snapshot, dependency)
      end)

    owner = %{
      type: :transcript_maintenance,
      from: from,
      coverage_key: key,
      goal_version: state.run.goal.version,
      status: state.run.status
    }

    {:noreply,
     %{
       state
       | current_task_ref: task.ref,
         current_task_pid: task.pid,
         current_task_kind: owner
     }}
  end

  @spec finish(map(), map(), term()) :: {{:ok, map()} | {:error, term()}, map()}
  def finish(state, owner, {:ok, plan, _count}) do
    if interrupted?(state) or state.run.goal.version != owner.goal_version or
         (state.run.status in @terminal_statuses and state.run.status != owner.status) do
      {{:error, :maintenance_stale}, state}
    else
      compact_and_commit(state, plan)
    end
  end

  def finish(state, _owner, {:error, reason, _count}) do
    log_failure(state, reason)
    {{:error, reason}, state}
  end

  def finish(state, _owner, _result) do
    log_failure(state, :invalid_maintenance_result)
    {{:error, :invalid_maintenance_result}, state}
  end

  @spec provider_call_count(AgentRun.t(), map(), term()) ::
          {:ok, non_neg_integer()} | {:error, :maintenance_accounting_unavailable}
  def provider_call_count(run, owner, {:error, :maintenance_task_down, _count}),
    do: TranscriptCompactionSummary.recorded_call_count(run, owner.coverage_key)

  def provider_call_count(_run, _owner, {:ok, _plan, count})
      when is_integer(count) and count >= 0,
      do: {:ok, count}

  def provider_call_count(_run, _owner, {:error, _reason, count})
      when is_integer(count) and count >= 0, do: {:ok, count}

  def provider_call_count(_run, _owner, _result),
    do: {:error, :maintenance_accounting_unavailable}

  @doc "initialized 占用一次待定预算，但不谎报已经发生的 Provider 调用。"
  @spec provider_budget_exhausted?(AgentRun.t()) :: boolean()
  def provider_budget_exhausted?(run) do
    reservations = length(ProviderRunLog.list_runs(run.run_id))
    max(run.consumed_budget.provider_calls, reservations) >= run.budget.max_provider_calls
  end

  @doc "维护的 pre-dispatch 事件不算实调用；其他业务用途沿既有计费语义。"
  @spec counts_provider_call?(map()) :: boolean()
  def counts_provider_call?(payload) do
    if map_get(payload, :operation) == TranscriptCompactionSummary.operation() do
      map_get(payload, :provider_progress_phase) in [:request_dispatched, "request_dispatched"] or
        map_get(payload, :provider_event_type) in [
          :chunk,
          :usage_recorded,
          "chunk",
          "usage_recorded"
        ] or
        map_get(payload, :status) in [:ok, "ok"]
    else
      true
    end
  end

  defp compact_and_commit(state, plan) do
    transcript = Map.get(state.stage_state, :judgment_transcript)

    with {:ok, compacted} <- AuthoringSession.compact(transcript, plan),
         next = %{
           state
           | stage_state:
               Map.merge(state.stage_state, AuthoringSession.transcript_state(compacted))
         },
         {:ok, receipt, committed} <- CompactionRecord.commit(next, plan, compacted) do
      {{:ok, receipt}, committed}
    else
      {:error, reason} ->
        log_failure(state, reason)
        {{:error, reason}, state}
    end
  end

  defp session_view(state) do
    case Map.get(state.stage_state, :judgment_transcript) do
      nil ->
        {:ok, nil}

      transcript ->
        with {:ok, history} <- AuthoringSessionHistory.fetch(state.run) do
          {:ok, AuthoringSessionHistory.compose(transcript, history)}
        end
    end
  end

  defp plan(view, :automatic, run) do
    if AgentRun.budget_exhausted?(run) or not ContextPressure.maintenance_due?(run.run_id),
      do: {:ok, :nothing_to_compact},
      else: plan_sources(view, maintenance_options(), run)
  end

  defp plan(view, :explicit, run), do: plan_sources(view, [], run)

  defp plan_sources(view, opts, run) do
    with {:ok, owned} <-
           ProviderRunLog.operation_source_keys(run, TranscriptCompactionSummary.operation()) do
      TranscriptCompaction.plan_maintenance(view, Keyword.put(opts, :owned_source_keys, owned))
    end
  rescue
    _error in [DBConnection.ConnectionError, DBConnection.OwnershipError, Exqlite.Error] ->
      {:error, :provider_operation_history_unavailable}
  end

  defp maintenance_options do
    case Map.get(config(), :keep_recent_items) do
      keep when is_integer(keep) and keep >= 0 -> [keep_recent_items: keep]
      _ -> []
    end
  end

  defp enabled?, do: Map.get(config(), :enabled, true) == true

  defp config do
    case Application.get_env(:novel_application, :auto_maintenance, %{}) do
      config when is_list(config) -> Map.new(config)
      config when is_map(config) -> config
      _ -> %{}
    end
  end

  defp interrupted?(state),
    do: state.run.interrupt_state.status in [:pause_requested, :cancel_requested]

  defp log_failure(state, reason) do
    LogEmit.emit(:agent_run, :auto_maintenance, :error, %{
      run_id: state.run.run_id,
      reason: inspect(reason)
    })
  end

  defp map_get(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
end
