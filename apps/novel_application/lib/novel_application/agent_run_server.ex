defmodule NovelApplication.AgentRunServer do
  @moduledoc """
  Supervised bounded AgentRun process.

  GenServer callbacks only update state and start supervised tasks. Step work is
  executed in `NovelApplication.AgentStepTaskSupervisor`.
  """

  use GenServer

  alias NovelApplication.AgentEventPublisher
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentRun
  alias NovelDomain.AgentStep
  alias NovelPersistence.{AgentRunLog, LongRunTaskLog}

  @type step_snapshot :: %{
          required(:observations) => [AgentObservation.t()],
          required(:events) => [AgentEvent.t()],
          required(:stage_state) => map(),
          optional(:stage_sink) => (map() -> :ok)
        }
  @type step_result :: {:ok, map()} | {:error, term()}
  @type step_fun ::
          (AgentRun.t(), pos_integer() -> step_result())
          | (AgentRun.t(), pos_integer(), step_snapshot() -> step_result())

  defstruct run: nil,
            steps: [],
            next_sequence: 1,
            current_task_ref: nil,
            current_task_pid: nil,
            event_sequence: 0,
            events: [],
            observations: [],
            stage_state: %{},
            progress_signatures: MapSet.new(),
            final_turn_result: nil,
            event_sink: nil

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    run = Keyword.fetch!(opts, :run)
    GenServer.start_link(__MODULE__, opts, name: via(run.run_id))
  end

  @spec child_spec(keyword()) :: Supervisor.child_spec()
  def child_spec(opts) do
    run = Keyword.fetch!(opts, :run)

    %{
      id: {__MODULE__, run.run_id},
      start: {__MODULE__, :start_link, [opts]},
      restart: :transient,
      type: :worker
    }
  end

  @spec attach_event_sink(GenServer.server(), function() | nil) :: :ok
  def attach_event_sink(server, event_sink),
    do: GenServer.cast(server, {:attach_event_sink, event_sink})

  @spec command(GenServer.server(), :pause | :resume | :cancel | {:steer, String.t()}) :: :ok
  def command(server, command), do: GenServer.cast(server, {:command, command})

  @spec state(GenServer.server()) :: map()
  def state(server), do: GenServer.call(server, :state)

  @impl true
  def init(opts) do
    run = Keyword.fetch!(opts, :run)

    state = %__MODULE__{
      run: run,
      steps: Keyword.get(opts, :steps, []),
      event_sink: Keyword.get(opts, :event_sink)
    }

    state =
      state
      |> emit(:run_started, "AgentRun 已启动。")
      |> persist_run_state()

    {:ok, state, {:continue, :run_next_step}}
  end

  @impl true
  def handle_continue(:run_next_step, state), do: run_next_step(state)

  @impl true
  def handle_call(:state, _from, state) do
    {:reply, snapshot(state), state}
  end

  @impl true
  def handle_cast({:command, :pause}, state) do
    cond do
      terminal?(state) ->
        {:noreply, state}

      state.current_task_ref ->
        state =
          state
          |> put_interrupt(:pause_requested)
          |> put_run_status(:pausing)
          |> emit(:interrupt_requested, "正在请求暂停。", ["pause_requested"])
          |> persist_run_state()

        {:noreply, state}

      true ->
        state =
          state
          |> put_interrupt(:pause_requested)
          |> put_run_status(:pausing)
          |> emit(:interrupt_requested, "正在请求暂停。", ["pause_requested"])

        {:noreply, pause_now(state)}
    end
  end

  def handle_cast({:command, :cancel}, state) do
    cond do
      terminal?(state) ->
        {:noreply, state}

      state.current_task_ref ->
        state =
          state
          |> put_interrupt(:cancel_requested)
          |> put_run_status(:cancelling)
          |> emit(
            :interrupt_requested,
            "正在协作取消，等待当前 provider 调用到达安全点。",
            ["cancel_requested", "cooperative_cancel", "provider_hard_cancel_unsupported"],
            [],
            %{
              cancel_strategy: :cooperative_safe_point,
              supports_cancellation: false,
              provider_call_active: true
            }
          )
          |> persist_run_state()

        {:noreply, state}

      true ->
        state =
          state
          |> put_interrupt(:cancel_requested)
          |> put_run_status(:cancelled)
          |> emit(:interrupt_requested, "正在取消 AgentRun。", [
            "cancel_requested",
            "safe_point_available"
          ])

        {:noreply, cancel_now(state)}
    end
  end

  def handle_cast({:command, :resume}, state) do
    if resumable?(state) do
      state =
        state
        |> clear_interrupt()
        |> put_run_status(:running)
        |> put_run_phase(:executing)
        |> emit(:run_resumed, "AgentRun 已恢复。", ["resume_requested"])
        |> persist_run_state()

      {:noreply, state, {:continue, :run_next_step}}
    else
      {:noreply, state}
    end
  end

  def handle_cast({:command, {:steer, text}}, state) when is_binary(text) do
    if terminal?(state) do
      {:noreply, state}
    else
      goal = %{state.run.goal | text: text, version: state.run.goal.version + 1}

      state =
        %{state | run: %{state.run | goal: goal}}
        |> put_interrupt(:steer_requested)
        |> emit(:plan_adjusted, "已收到新的创作方向。", ["steer_requested"])
        |> persist_run_state()

      {:noreply, state}
    end
  end

  def handle_cast({:attach_event_sink, event_sink}, state)
      when is_function(event_sink, 1) or is_nil(event_sink) do
    {:noreply, %{state | event_sink: event_sink}}
  end

  @impl true
  def handle_info({ref, result}, %{current_task_ref: ref} = state) do
    Process.demonitor(ref, [:flush])

    state =
      state
      |> Map.put(:current_task_ref, nil)
      |> Map.put(:current_task_pid, nil)
      |> handle_step_result(result)

    cond do
      cancel_requested?(state) ->
        {:noreply, cancel_now(state)}

      pause_requested?(state) ->
        {:noreply, pause_now(state)}

      state.run.status == :awaiting_author ->
        {:noreply, state}

      true ->
        {:noreply, state, {:continue, :run_next_step}}
    end
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, %{current_task_ref: ref} = state) do
    state =
      state
      |> Map.put(:current_task_ref, nil)
      |> Map.put(:current_task_pid, nil)
      |> put_run_status(:failed)
      |> emit(:run_failed, "AgentRun step failed: #{inspect(reason)}", ["step_task_down"])
      |> persist_run_state()

    {:noreply, state}
  end

  def handle_info({:agent_stage_event, attrs}, state) when is_map(attrs) do
    state =
      case normalize_stage_event(attrs) do
        {:ok, type, summary, reason_codes, refs, payload} ->
          state
          |> emit(type, summary, reason_codes, refs, payload)
          |> persist_run_state()

        :ignore ->
          state
      end

    {:noreply, state}
  end

  def handle_info(_message, state), do: {:noreply, state}

  defp run_next_step(state) do
    cond do
      blocking_interrupt_requested?(state) ->
        {:noreply, state}

      state.steps == [] ->
        state =
          state
          |> put_run_status(:completed)
          |> put_run_phase(:stopped)
          |> emit(:run_completed, "AgentRun 已完成。")
          |> persist_run_state()

        {:noreply, state}

      AgentRun.budget_exhausted?(state.run) ->
        state =
          state
          |> put_run_status(:awaiting_author)
          |> put_run_phase(:stopped)
          |> emit(:awaiting_author, "AgentRun 已达到预算上限。", ["budget_exhausted"])
          |> persist_run_state()

        {:noreply, state}

      true ->
        [step_fun | rest] = state.steps
        sequence = state.next_sequence
        step_ref = step_ref(state.run.run_id, sequence)
        run_for_step = %{state.run | current_step_ref: step_ref}
        server = self()

        task =
          Task.Supervisor.async_nolink(NovelApplication.AgentStepTaskSupervisor, fn ->
            execute_step_fun(step_fun, run_for_step, sequence, step_snapshot(state, server))
          end)

        state =
          %{
            state
            | run: run_for_step,
              steps: rest,
              next_sequence: sequence + 1,
              current_task_ref: task.ref,
              current_task_pid: task.pid
          }
          |> put_run_status(:running)
          |> put_run_phase(:executing)
          |> emit(
            :step_proposed,
            step_started_summary(run_for_step, sequence),
            ["step_started"],
            [
              step_ref
            ]
          )
          |> persist_run_state()

        {:noreply, state}
    end
  end

  defp step_ref(run_id, sequence), do: "step_#{run_id}_#{sequence}"

  defp step_started_summary(run, sequence) do
    case milestone_summary(run.plan, sequence) do
      summary when is_binary(summary) and summary != "" ->
        summary
        |> String.trim()
        |> prefix_running()
        |> ensure_sentence()

      _ ->
        "正在执行第 #{sequence} 步。"
    end
  end

  defp milestone_summary(plan, sequence) when is_map(plan) do
    milestones = Map.get(plan, :milestones) || Map.get(plan, "milestones") || []

    milestones
    |> Enum.at(sequence - 1)
    |> case do
      milestone when is_map(milestone) ->
        Map.get(milestone, :summary) || Map.get(milestone, "summary")

      _ ->
        nil
    end
  end

  defp milestone_summary(_plan, _sequence), do: nil

  defp prefix_running("正在" <> _rest = summary), do: summary
  defp prefix_running(summary), do: "正在#{summary}"

  defp ensure_sentence(summary) do
    if String.ends_with?(summary, ["。", ".", "！", "!", "？", "?"]) do
      summary
    else
      summary <> "。"
    end
  end

  defp handle_step_result(state, {:ok, result}) when is_map(result) do
    step = Map.get(result, :step)
    observations = Map.get(result, :observations, [])
    artifact_refs = Map.get(result, :artifact_refs, [])
    turn_result = Map.get(result, :turn_result)

    state =
      state
      |> merge_stage_state(Map.get(result, :stage_state))
      |> apply_progress_signature(Map.get(result, :progress_signature))

    {artifact_refs, turn_result} =
      if no_progress_stopped?(state), do: {[], nil}, else: {artifact_refs, turn_result}

    state =
      state
      |> maybe_mark_step_completed(step)
      |> add_consumed_budget(result)
      |> add_observations(observations)
      |> maybe_store_final_turn_result(turn_result)
      |> add_pending_artifacts(artifact_refs)
      |> persist_step_result(step, observations)
      |> emit_observations(observations)
      |> maybe_emit_artifact_created(artifact_refs, turn_result)
      |> maybe_emit_turn_result(artifact_refs, turn_result)

    persist_run_state(state)
  end

  defp handle_step_result(state, {:error, reason}) do
    state
    |> put_run_status(:failed)
    |> emit(:run_failed, "AgentRun step failed: #{inspect(reason)}", ["step_failed"])
    |> persist_run_state()
  end

  defp handle_step_result(state, other) do
    handle_step_result(state, {:error, {:unexpected_step_result, other}})
  end

  defp maybe_mark_step_completed(state, %AgentStep{} = step) do
    consumed = state.run.consumed_budget

    run = %{
      state.run
      | current_step_ref: nil,
        completed_step_refs: state.run.completed_step_refs ++ [step.step_id],
        consumed_budget: %{consumed | steps: consumed.steps + 1}
    }

    %{state | run: run}
  end

  defp maybe_mark_step_completed(state, _step), do: state

  defp add_consumed_budget(state, result) when is_map(result) do
    consumed = state.run.consumed_budget

    run = %{
      state.run
      | consumed_budget: %{
          consumed
          | tool_calls: consumed.tool_calls + non_negative_count(result[:tool_call_count]),
            provider_calls:
              consumed.provider_calls + non_negative_count(result[:provider_call_count]),
            replans: consumed.replans + non_negative_count(result[:replan_count])
        }
    }

    %{state | run: run}
  end

  defp non_negative_count(value) when is_integer(value) and value > 0, do: value
  defp non_negative_count(_), do: 0

  defp apply_progress_signature(state, signature) when is_binary(signature) and signature != "" do
    if MapSet.member?(state.progress_signatures, signature) do
      state
      |> put_run_status(:awaiting_author)
      |> put_run_phase(:stopped)
      |> Map.put(:steps, [])
      |> emit(:awaiting_author, "AgentRun 未取得新进展，已停止等待作者确认。", [
        "no_progress"
      ])
      |> persist_run_state()
    else
      %{state | progress_signatures: MapSet.put(state.progress_signatures, signature)}
    end
  end

  defp apply_progress_signature(state, _signature), do: state

  defp no_progress_stopped?(state) do
    state.run.status == :awaiting_author and state.run.phase == :stopped and state.steps == []
  end

  defp add_observations(state, observations) when is_list(observations) do
    valid = Enum.filter(observations, &match?(%AgentObservation{}, &1))
    %{state | observations: state.observations ++ valid}
  end

  defp merge_stage_state(state, stage_state) when is_map(stage_state),
    do: %{state | stage_state: Map.merge(state.stage_state, stage_state)}

  defp merge_stage_state(state, _stage_state), do: state

  defp maybe_store_final_turn_result(state, turn_result) when is_map(turn_result),
    do: %{state | final_turn_result: turn_result}

  defp maybe_store_final_turn_result(state, _turn_result), do: state

  defp emit_observations(state, observations) when is_list(observations) do
    Enum.reduce(observations, state, fn
      %AgentObservation{} = observation, acc ->
        emit(acc, :observation_recorded, observation.summary, ["observation_recorded"], [
          observation.observation_id
        ])

      _observation, acc ->
        acc
    end)
  end

  defp add_pending_artifacts(state, refs) when is_list(refs) do
    run = %{state.run | pending_artifact_refs: Enum.uniq(state.run.pending_artifact_refs ++ refs)}
    %{state | run: run}
  end

  defp maybe_emit_artifact_created(state, [_ | _] = refs, turn_result) when is_map(turn_result) do
    emit(
      state,
      :artifact_created,
      "已生成待采纳候选。",
      ["artifact_created"],
      refs,
      %{turn_result: turn_result}
    )
  end

  defp maybe_emit_artifact_created(state, _refs, _turn_result), do: state

  defp maybe_emit_turn_result(state, [], turn_result) when is_map(turn_result) do
    emit(
      state,
      :turn_result_ready,
      "本轮回应已完成。",
      ["turn_result_ready"],
      [],
      %{turn_result: turn_result}
    )
  end

  defp maybe_emit_turn_result(state, _refs, _turn_result), do: state

  defp put_interrupt(state, status) do
    %{
      state
      | run: %{
          state.run
          | interrupt_state: %{
              status: status,
              requested_at: DateTime.utc_now() |> DateTime.to_iso8601()
            }
        }
    }
  end

  defp clear_interrupt(state) do
    %{
      state
      | run: %{
          state.run
          | interrupt_state: %{status: :none, requested_at: nil}
        }
    }
  end

  defp put_run_status(state, status), do: %{state | run: %{state.run | status: status}}
  defp put_run_phase(state, phase), do: %{state | run: %{state.run | phase: phase}}

  defp pause_now(state) do
    state
    |> put_run_status(:paused)
    |> put_run_phase(:stopped)
    |> emit(:run_paused, "AgentRun 已暂停。", ["pause_completed"])
    |> persist_run_state()
  end

  defp cancel_now(state) do
    state
    |> put_run_status(:cancelled)
    |> put_run_phase(:stopped)
    |> emit(:run_cancelled, "AgentRun 已取消。", ["cancel_completed", "cooperative_cancel"])
    |> persist_run_state()
  end

  defp pause_requested?(state), do: state.run.interrupt_state.status == :pause_requested
  defp cancel_requested?(state), do: state.run.interrupt_state.status == :cancel_requested

  defp blocking_interrupt_requested?(state),
    do: pause_requested?(state) or cancel_requested?(state)

  defp resumable?(state),
    do: state.run.status in [:paused, :awaiting_author] and is_nil(state.current_task_ref)

  defp terminal?(state), do: state.run.status in [:completed, :cancelled, :failed]

  defp emit(state, type, summary, reason_codes \\ [], refs \\ [], payload \\ %{}) do
    sequence = state.event_sequence + 1

    {:ok, event} =
      AgentEvent.new(%{
        event_id: "evt_#{state.run.run_id}_#{sequence}",
        run_ref: state.run.run_id,
        step_ref: state.run.current_step_ref,
        sequence: sequence,
        event_type: type,
        visibility: :author,
        summary: summary,
        reason_codes: reason_codes,
        refs: refs,
        payload: payload,
        emitted_at: DateTime.utc_now()
      })

    AgentEventPublisher.publish(event, state.event_sink)
    persist_event(event)

    %{state | event_sequence: sequence, events: state.events ++ [event]}
  end

  defp persist_run_state(%{run: %AgentRun{} = run} = state) do
    persist(fn -> AgentRunLog.upsert_run(run_attrs(run)) end)
    persist_long_run_checkpoint(run, state)
    state
  end

  defp persist_run_state(state), do: state

  defp persist_step_result(state, %AgentStep{} = step, observations) do
    persist(fn -> AgentRunLog.insert_step(step_attrs(step, observations)) end)
    state
  end

  defp persist_step_result(state, _step, _observations), do: state

  defp persist_event(%AgentEvent{} = event) do
    persist(fn -> AgentRunLog.insert_event(event_attrs(event)) end)
  end

  defp persist_long_run_checkpoint(
         %AgentRun{run_mode: :durable, long_run_task_ref: task_ref} = run,
         state
       )
       when is_binary(task_ref) and task_ref != "" do
    persist(fn ->
      case LongRunTaskLog.get(task_ref) do
        nil -> :ok
        task -> LongRunTaskLog.update(task, long_run_task_update_attrs(run, state))
      end
    end)
  end

  defp persist_long_run_checkpoint(_run, _state), do: :ok

  defp persist(fun) when is_function(fun, 0) do
    case fun.() do
      {:ok, _record} -> :ok
      {:error, _changeset} -> :ok
      _other -> :ok
    end
  rescue
    _error -> :ok
  end

  defp long_run_task_update_attrs(%AgentRun{} = run, state) do
    {status, phase} = long_run_status_phase(run.status)

    %{
      status: status,
      phase: phase,
      current_unit_ref: run.current_step_ref,
      completed_unit_refs: run.completed_step_refs,
      pending_artifact_refs: run.pending_artifact_refs,
      consumed_budget: json_safe(run.consumed_budget),
      checkpoint_data: long_run_checkpoint_data(run, state),
      completed_at: long_run_completed_at(run.status)
    }
  end

  defp long_run_status_phase(:completed), do: {"DONE", "COMPLETED"}
  defp long_run_status_phase(:cancelled), do: {"CANCELLED", "CANCELLED"}
  defp long_run_status_phase(:failed), do: {"ERROR", "FAILED"}

  defp long_run_status_phase(status) when status in [:paused, :awaiting_author],
    do: {"PAUSED", "CHECKPOINT"}

  defp long_run_status_phase(_status), do: {"RUNNING", "RUNNING"}

  defp long_run_completed_at(status) when status in [:completed, :cancelled, :failed],
    do: DateTime.utc_now()

  defp long_run_completed_at(_status), do: nil

  defp long_run_checkpoint_data(%AgentRun{} = run, state) do
    %{
      "agent_run" => %{
        "run_id" => run.run_id,
        "run_mode" => atom_string(run.run_mode),
        "status" => atom_string(run.status),
        "phase" => atom_string(run.phase),
        "profile_ref" => run.profile_ref,
        "goal_version" => run.goal.version,
        "current_step_ref" => run.current_step_ref,
        "completed_step_refs" => run.completed_step_refs,
        "pending_artifact_refs" => run.pending_artifact_refs,
        "consumed_budget" => json_safe(run.consumed_budget),
        "event_sequence" => state.event_sequence,
        "checkpoint_version" => 1
      },
      "progress" => long_run_progress(run),
      "step" => long_run_step_label(run)
    }
  end

  defp long_run_progress(%AgentRun{status: :completed}), do: 100
  defp long_run_progress(%AgentRun{status: status}) when status in [:cancelled, :failed], do: 100

  defp long_run_progress(%AgentRun{budget: %{max_steps: max}, consumed_budget: %{steps: steps}})
       when is_integer(max) and max > 0 do
    min(95, round(steps * 100 / max))
  end

  defp long_run_progress(_run), do: 50

  defp long_run_step_label(%AgentRun{status: :completed}), do: "AgentRun 已完成"
  defp long_run_step_label(%AgentRun{status: :cancelled}), do: "AgentRun 已取消"
  defp long_run_step_label(%AgentRun{status: :failed}), do: "AgentRun 执行失败"
  defp long_run_step_label(%AgentRun{current_step_ref: ref}) when is_binary(ref), do: ref
  defp long_run_step_label(_run), do: "AgentRun 检查点"

  defp run_attrs(%AgentRun{} = run) do
    goal = json_safe(run.goal || %{})

    %{
      id: run.run_id,
      workspace_id: run.workspace_id,
      work_id: run.work_id,
      session_id: run.session_id,
      parent_turn_ref: run.parent_turn_ref,
      origin_frame_ref: run.origin_frame_ref,
      run_mode: atom_string(run.run_mode),
      profile_ref: run.profile_ref,
      status: atom_string(run.status),
      phase: atom_string(run.phase),
      goal: goal,
      goal_version: Map.get(goal, "version", 1),
      plan: json_safe(run.plan),
      plan_ref: run.plan_ref,
      plan_version: run.plan_version,
      run_policy: json_safe(run.policy),
      authority_scope: json_safe(run.authority_scope),
      budget: json_safe(run.budget),
      consumed_budget: json_safe(run.consumed_budget),
      current_step_ref: run.current_step_ref,
      completed_step_refs: run.completed_step_refs,
      pending_artifact_refs: run.pending_artifact_refs,
      active_behavior_ref: run.active_behavior_ref,
      interrupt_state: json_safe(run.interrupt_state),
      long_run_task_ref: run.long_run_task_ref,
      failure_ref: run.failure_ref,
      completed_at: terminal_completed_at(run.status)
    }
  end

  defp step_attrs(%AgentStep{} = step, observations) do
    observation_refs =
      observations
      |> Enum.filter(&match?(%AgentObservation{}, &1))
      |> Enum.map(& &1.observation_id)
      |> Kernel.++(step.observation_refs)
      |> Enum.uniq()

    %{
      id: step.step_id,
      run_id: step.run_ref,
      sequence: step.sequence,
      status: atom_string(step.status),
      goal: step.goal,
      micro_plan_ref: step.micro_plan_ref,
      decision_ref: step.decision_ref,
      tool_request_ref: step.tool_request_ref,
      tool_result_ref: step.tool_result_ref,
      observation_refs: observation_refs,
      observation: observation_summary(observations),
      state_snapshot_ref: step.state_snapshot_ref,
      attempt: step.attempt,
      idempotency_key: step.idempotency_key,
      failure_ref: step.failure_ref,
      started_at: parse_datetime(step.started_at),
      completed_at: parse_datetime(step.completed_at) || DateTime.utc_now()
    }
  end

  defp event_attrs(%AgentEvent{} = event) do
    %{
      id: event.event_id,
      run_id: event.run_ref,
      step_id: event.step_ref,
      sequence: event.sequence,
      event_type: atom_string(event.event_type),
      visibility: atom_string(event.visibility),
      summary: event.summary,
      reason_codes: event.reason_codes,
      refs: event.refs,
      payload: event.payload |> Map.drop([:turn_result, "turn_result"]) |> json_safe()
    }
  end

  defp observation_summary(observations) when is_list(observations) do
    author_safe =
      observations
      |> Enum.filter(&match?(%AgentObservation{}, &1))
      |> Enum.map(&AgentObservation.author_safe_summary/1)

    %{
      "count" => length(author_safe),
      "items" => json_safe(author_safe),
      "summaries" => Enum.map(author_safe, &Map.fetch!(&1, :summary))
    }
  end

  defp terminal_completed_at(status) when status in [:completed, :cancelled, :failed],
    do: DateTime.utc_now()

  defp terminal_completed_at(_status), do: nil

  defp parse_datetime(nil), do: nil
  defp parse_datetime(%DateTime{} = datetime), do: datetime

  defp parse_datetime(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, datetime, _offset} -> datetime
      _error -> nil
    end
  end

  defp parse_datetime(_value), do: nil

  defp json_safe(nil), do: nil
  defp json_safe(value) when is_boolean(value), do: value
  defp json_safe(%DateTime{} = value), do: DateTime.to_iso8601(value)

  defp json_safe(%_struct{} = struct) do
    struct
    |> Map.from_struct()
    |> json_safe()
  end

  defp json_safe(%{} = map) do
    for {key, value} <- map, into: %{} do
      {to_string(key), json_safe(value)}
    end
  end

  defp json_safe(values) when is_list(values), do: Enum.map(values, &json_safe/1)
  defp json_safe(value) when is_atom(value), do: Atom.to_string(value)
  defp json_safe(value), do: value

  defp atom_string(value) when is_atom(value), do: Atom.to_string(value)
  defp atom_string(value), do: to_string(value)

  defp snapshot(state) do
    %{
      run: state.run,
      events: state.events,
      observations: state.observations,
      stage_state: state.stage_state,
      final_turn_result: state.final_turn_result,
      current_task?: state.current_task_ref != nil,
      remaining_steps: length(state.steps)
    }
  end

  defp execute_step_fun(step_fun, run, sequence, snapshot) when is_function(step_fun, 3),
    do: step_fun.(run, sequence, snapshot)

  defp execute_step_fun(step_fun, run, sequence, _snapshot) when is_function(step_fun, 2),
    do: step_fun.(run, sequence)

  defp step_snapshot(state, server) do
    %{
      observations: state.observations,
      events: state.events,
      stage_state: state.stage_state,
      stage_sink: fn attrs ->
        send(server, {:agent_stage_event, attrs})
        :ok
      end
    }
  end

  @stage_event_types [
    :goal_understood,
    :plan_created,
    :gate_decided,
    :tool_started,
    :tool_completed,
    :provider_progress,
    :quality_review_started,
    :quality_finding_created
  ]

  defp normalize_stage_event(attrs) do
    type = stage_event_type(Map.get(attrs, :event_type) || Map.get(attrs, "event_type"))
    summary = Map.get(attrs, :summary) || Map.get(attrs, "summary")

    if type in @stage_event_types and is_binary(summary) and String.trim(summary) != "" do
      {:ok, type, String.trim(summary),
       string_list(Map.get(attrs, :reason_codes) || Map.get(attrs, "reason_codes")),
       string_list(Map.get(attrs, :refs) || Map.get(attrs, "refs")),
       map_payload(Map.get(attrs, :payload) || Map.get(attrs, "payload"))}
    else
      :ignore
    end
  end

  defp stage_event_type(value) when value in @stage_event_types, do: value

  defp stage_event_type(value) when is_binary(value) do
    Enum.find(@stage_event_types, &(Atom.to_string(&1) == value))
  end

  defp stage_event_type(_value), do: nil

  defp string_list(values) when is_list(values) do
    values
    |> Enum.map(&to_string/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp string_list(_values), do: []

  defp map_payload(payload) when is_map(payload), do: payload
  defp map_payload(_payload), do: %{}

  defp via(run_id), do: {:via, Registry, {NovelApplication.AgentRunRegistry, run_id}}
end
