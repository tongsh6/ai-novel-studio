defmodule NovelApplication.AgentRunServer do
  @moduledoc """
  Supervised bounded AgentRun process.

  GenServer callbacks only update state and start supervised tasks. Step work is
  executed in `NovelApplication.AgentStepTaskSupervisor`.
  """

  use GenServer

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentEventPublisher
  alias NovelApplication.AgentNarrativeSource
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentNextStepDecision
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentRun
  alias NovelDomain.AgentRunPolicy
  alias NovelDomain.AgentStep
  alias NovelPersistence.{AgentRunLog, LongRunTaskLog}

  @checkpoint_version 2

  @type step_snapshot :: %{
          required(:observations) => [AgentObservation.t()],
          required(:events) => [AgentEvent.t()],
          required(:stage_state) => map(),
          optional(:provider_cancellation_token) => pid(),
          optional(:stage_sink) => (map() -> :ok)
        }
  @type step_result :: {:ok, map()} | {:error, term()}
  @type step_fun ::
          (AgentRun.t(), pos_integer() -> step_result())
          | (AgentRun.t(), pos_integer(), step_snapshot() -> step_result())
  @type next_step_result ::
          {:execute, step_fun(), AgentNextStepDecision.t()}
          | {:execute, step_fun(), AgentNextStepDecision.t(), map()}
          | {:complete, AgentNextStepDecision.t()}
          | {:complete, AgentNextStepDecision.t(), map()}
          | {:await_author, AgentNextStepDecision.t()}
          | {:await_author, AgentNextStepDecision.t(), map()}
          | {:error, term()}
  @type next_step_planner ::
          (AgentRun.t(), pos_integer(), step_snapshot() -> next_step_result())

  defstruct run: nil,
            next_step_planner: nil,
            next_sequence: 1,
            current_task_ref: nil,
            current_task_pid: nil,
            event_sequence: 0,
            events: [],
            observations: [],
            stage_state: %{},
            progress_signatures: MapSet.new(),
            final_turn_result: nil,
            event_sink: nil,
            provider_cancellation_token: nil

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

  @spec state(GenServer.server(), timeout()) :: map()
  def state(server, timeout \\ 5_000), do: GenServer.call(server, :state, timeout)

  @impl true
  def init(opts) do
    run = Keyword.fetch!(opts, :run)
    {:ok, provider_cancellation_token} = Execution.start_cancellation_token(%{run_id: run.run_id})

    state = %__MODULE__{
      run: run,
      next_step_planner: Keyword.get(opts, :next_step_planner),
      event_sink: Keyword.get(opts, :event_sink),
      provider_cancellation_token: provider_cancellation_token
    }

    state =
      state
      |> emit(
        :run_started,
        "AgentRun 已启动。",
        ["agent_run_started", "profile_selected"],
        [],
        run_started_payload(run)
      )
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
          |> request_provider_cancellation(:author_cancelled)
          |> put_interrupt(:cancel_requested)
          |> put_run_status(:cancelling)
          |> emit(
            :interrupt_requested,
            "正在取消当前 AgentRun 执行。",
            ["cancel_requested", "provider_execution_cancel_requested"],
            [],
            %{
              cancel_strategy: :provider_execution_cancel,
              supports_cancellation: true,
              current_task_active: true
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

      terminal?(state) ->
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
      |> settle_run_failed({:step_task_down, reason}, ["step_task_down"])

    {:noreply, state}
  end

  def handle_info({:agent_stage_event, attrs}, state) when is_map(attrs) do
    state =
      case normalize_stage_event(attrs) do
        {:ok, type, visibility, summary, reason_codes, refs, payload} ->
          {state, type, reason_codes, payload} =
            maybe_promote_steer_plan_revision(state, type, summary, reason_codes, payload)

          emit(state, type, visibility, summary, reason_codes, refs, payload)

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

      not is_function(state.next_step_planner, 3) ->
        state =
          state
          |> put_run_phase(:stopped)
          |> settle_run_failed(:next_step_planner_required, ["next_step_planner_required"])

        {:noreply, state}

      AgentRun.budget_exhausted?(state.run) ->
        state =
          state
          |> put_run_status(:awaiting_author)
          |> put_run_phase(:stopped)
          |> emit(:awaiting_author, "AgentRun 已达到预算上限。", ["budget_exhausted"])
          |> persist_run_state()

        {:noreply, state}

      is_function(state.next_step_planner, 3) ->
        start_dynamic_next_step(state)
    end
  end

  defp start_dynamic_next_step(state) do
    planner = state.next_step_planner

    start_step_task(state, planner, fn planner, run, sequence, snapshot ->
      execute_dynamic_next_step(planner, run, sequence, snapshot)
    end)
  end

  defp start_step_task(state, step_fun, executor) do
    sequence = state.next_sequence
    step_ref = step_ref(state.run.run_id, sequence)
    run_for_step = %{state.run | current_step_ref: step_ref}
    server = self()

    task =
      Task.Supervisor.async_nolink(NovelApplication.AgentStepTaskSupervisor, fn ->
        executor.(step_fun, run_for_step, sequence, step_snapshot(state, server, run_for_step))
      end)

    state =
      %{
        state
        | run: run_for_step,
          next_sequence: sequence + 1,
          current_task_ref: task.ref,
          current_task_pid: task.pid
      }
      |> put_run_status(:running)
      |> put_run_phase(:executing)
      |> persist_run_state()

    {:noreply, state}
  end

  defp step_ref(run_id, sequence), do: "step_#{run_id}_#{sequence}"

  defp handle_step_result(state, {:ok, result}) when is_map(result) do
    step = Map.get(result, :step)
    observations = Map.get(result, :observations, [])
    artifact_refs = Map.get(result, :artifact_refs, [])
    turn_result = Map.get(result, :turn_result)

    state =
      state
      |> merge_stage_state(Map.get(result, :stage_state))
      |> apply_superseded_artifacts(result)
      |> apply_progress_signature(Map.get(result, :progress_signature))

    no_progress_stopped? = no_progress_stopped?(state)

    {artifact_refs, turn_result, loop_status} =
      if no_progress_stopped?,
        do: {[], nil, nil},
        else: {artifact_refs, turn_result, Map.get(result, :loop_status)}

    state =
      state
      |> apply_run_patch(Map.get(result, :run_patch))
      |> maybe_mark_step_completed(step)
      |> add_consumed_budget(result)
      |> add_observations(observations)
      |> maybe_store_final_turn_result(turn_result)
      |> add_pending_artifacts(artifact_refs)
      |> persist_step_result(step, observations)
      |> emit_observations(observations)
      |> maybe_emit_artifact_created(artifact_refs, turn_result)
      |> maybe_emit_turn_result(artifact_refs, turn_result)
      |> maybe_emit_loop_decision(Map.get(result, :loop_decision))
      |> maybe_apply_loop_status(loop_status, Map.get(result, :loop_decision))
      |> maybe_stop_budget_exhausted()

    persist_run_state(state)
  end

  defp handle_step_result(state, {:error, reason}) do
    settle_run_failed(state, reason, ["step_failed" | failure_family_reason_codes(reason)])
  end

  defp handle_step_result(state, other) do
    handle_step_result(state, {:error, {:unexpected_step_result, other}})
  end

  # ── S7（ADR-0024 #121）：对话流中不允许存在「run 停了但没有下文」的终局 ──
  #
  # 失败终局统一收口：
  # ① 作者可见摘要只用系统结构词——原始失败载荷（provider 错误 message、进程退出原因）
  #    永不进入 author 事件（N-NARR/47 文案红线）；细节走业务日志（developer JSONL）。
  # ② 附带安全兜底 TurnResult（说明 + 全 false truthfulness），作者在对话流中始终有下文；
  #    恢复动作族（steer/resume available_actions）由 ADR-0024 CP3 扩展。
  defp settle_run_failed(state, reason, reason_codes) do
    LogEmit.emit(:agent_run, :run_failed, :error, %{
      run_id: state.run.run_id,
      reason_code: List.last(reason_codes),
      outcome_detail: reason |> inspect() |> String.slice(0, 300)
    })

    turn_result = safe_failure_turn_result(state.run, reason)

    state
    |> put_run_status(:failed)
    |> maybe_store_final_turn_result(turn_result)
    |> emit(:run_failed, failure_author_summary(reason), reason_codes, [], %{
      turn_result: turn_result
    })
    |> persist_run_state()
  end

  # provider 错误契约形状（Gateway execution_error：%{type:, message:}）判定失败家族。
  # 判断结构不可解析（ADR-0025 判断①call2 重试后仍坏）= provider 输出契约违约，
  # 与帧纪元 :frame_contract_invalid 同格——作者应得到"格式不符合契约，请重试"。
  defp provider_failure_reason?({:judgment_decision_unparseable, _fragment}), do: true

  defp provider_failure_reason?(reason),
    do: is_map(reason) and is_atom(Map.get(reason, :type))

  defp failure_family_reason_codes(reason) do
    if provider_failure_reason?(reason), do: ["provider_error"], else: []
  end

  defp failure_author_summary(reason) do
    if provider_failure_reason?(reason) do
      "模型调用失败，本轮运行已安全停止。"
    else
      "本轮运行执行失败，已安全停止。"
    end
  end

  defp safe_failure_turn_result(%AgentRun{} = run, reason) do
    %{
      schema_version: "3.0-draft",
      turn_id: run.parent_turn_ref,
      assistant_message: %{text: failure_fallback_message(reason)},
      ui_cards: [],
      phase: "failed",
      status: "failed",
      trace_summary: %{
        decision_type: :run_failed,
        no_write_reason: "run failed before producing any adoptable output"
      },
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false
      },
      agent_run: %{
        run_id: run.run_id,
        run_mode: run.run_mode,
        parent_turn_ref: run.parent_turn_ref,
        profile_ref: run.profile_ref,
        status: :failed
      }
    }
  end

  defp failure_fallback_message(reason) do
    if provider_failure_reason?(reason) do
      NovelApplication.Planner.provider_failure_fallback_message(reason)
    else
      "本轮运行遇到内部错误，已安全停止。没有创建待采纳内容，也没有写入作品事实。你可以重试，或继续对话。"
    end
  end

  defp maybe_emit_loop_decision(state, %AgentNextStepDecision{} = decision) do
    emit(
      state,
      :evaluation_made,
      reasoning_visibility(decision),
      decision.summary,
      ["agent_step_evaluated" | decision.reason_codes],
      [decision.decision_id],
      reasoning_payload(state.run, decision, :evaluation_made)
    )
  end

  defp maybe_emit_loop_decision(state, _decision), do: state

  defp maybe_apply_loop_status(state, :completed, %AgentNextStepDecision{} = decision) do
    state
    |> put_run_status(:completed)
    |> put_run_phase(:stopped)
    |> emit(:run_completed, "AgentRun 已完成。", ["goal_satisfied", "agent_loop_completed"], [
      decision.decision_id
    ])
  end

  defp maybe_apply_loop_status(state, :awaiting_author, %AgentNextStepDecision{} = decision) do
    state
    |> put_run_status(:awaiting_author)
    |> put_run_phase(:stopped)
    |> emit(
      :awaiting_author,
      decision.summary,
      Enum.uniq(["agent_loop_awaiting_author" | List.wrap(decision.reason_codes)]),
      [decision.decision_id]
    )
  end

  defp maybe_apply_loop_status(state, _status, _decision), do: state

  defp maybe_stop_budget_exhausted(state) do
    cond do
      terminal?(state) or state.run.status == :awaiting_author ->
        state

      AgentRun.budget_exhausted?(state.run) ->
        state
        |> put_run_status(:awaiting_author)
        |> put_run_phase(:stopped)
        |> emit(:awaiting_author, "AgentRun 已达到预算上限。", ["budget_exhausted"])

      true ->
        state
    end
  end

  defp apply_run_patch(state, patch) when is_map(patch) do
    run =
      state.run
      |> patch_profile_ref(patch)
      |> patch_authority_scope(patch)
      |> patch_plan(patch)
      |> patch_budget(patch)
      |> refresh_policy()

    %{state | run: run}
  end

  defp apply_run_patch(state, _patch), do: state

  defp patch_profile_ref(%AgentRun{} = run, patch) do
    case Map.get(patch, :profile_ref) || Map.get(patch, "profile_ref") do
      value when is_binary(value) and value != "" -> %{run | profile_ref: value}
      _ -> run
    end
  end

  defp patch_authority_scope(%AgentRun{} = run, patch) do
    case Map.get(patch, :authority_scope) || Map.get(patch, "authority_scope") do
      scope when is_map(scope) -> %{run | authority_scope: scope}
      _ -> run
    end
  end

  defp patch_plan(%AgentRun{} = run, patch) do
    case plan_from_patch(patch) do
      plan when is_map(plan) -> patch_plan_map(run, patch, plan)
      _ -> patch_plan_version(run, patch)
    end
  end

  defp patch_plan_map(%AgentRun{} = run, patch, plan) do
    %{
      run
      | plan: plan,
        plan_ref: plan_ref_from_patch(patch) || run.plan_ref,
        plan_version: plan_version_from_patch(patch) || run.plan_version
    }
  end

  defp patch_plan_version(%AgentRun{} = run, patch) do
    case plan_version_from_patch(patch) do
      nil -> run
      plan_version -> %{run | plan_version: plan_version}
    end
  end

  defp plan_from_patch(patch), do: Map.get(patch, :plan) || Map.get(patch, "plan")
  defp plan_ref_from_patch(patch), do: Map.get(patch, :plan_ref) || Map.get(patch, "plan_ref")

  defp plan_version_from_patch(patch) do
    positive_int(Map.get(patch, :plan_version) || Map.get(patch, "plan_version"))
  end

  defp patch_budget(%AgentRun{} = run, patch) do
    case Map.get(patch, :budget) || Map.get(patch, "budget") do
      budget when is_map(budget) -> %{run | budget: budget}
      _ -> run
    end
  end

  defp refresh_policy(%AgentRun{} = run) do
    tools =
      Map.get(run.authority_scope, :allowed_tools) ||
        Map.get(run.authority_scope, "allowed_tools") || []

    case AgentRunPolicy.new(
           allowed_tool_refs: tools,
           max_pending_artifacts: budget_value(run.budget, :max_pending_artifacts, 3)
         ) do
      {:ok, policy} -> %{run | policy: policy}
      {:error, _errors} -> run
    end
  end

  defp budget_value(budget, key, default) when is_map(budget) do
    case Map.get(budget, key) || Map.get(budget, Atom.to_string(key)) do
      value when is_integer(value) and value >= 0 -> value
      _ -> default
    end
  end

  defp budget_value(_budget, _key, default), do: default

  defp positive_int(value) when is_integer(value) and value > 0, do: value
  defp positive_int(_value), do: nil

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
    state.run.status == :awaiting_author and state.run.phase == :stopped
  end

  defp maybe_promote_steer_plan_revision(
         %{run: %AgentRun{interrupt_state: %{status: :steer_requested}} = run} = state,
         :plan_drafted,
         summary,
         reason_codes,
         payload
       ) do
    if provider_output_payload?(payload) do
      plan_version = next_replan_version(run, payload)
      consumed = run.consumed_budget

      state = %{
        state
        | run: %{
            run
            | plan_version: plan_version,
              consumed_budget: %{consumed | replans: consumed.replans + 1},
              interrupt_state: %{status: :none, requested_at: nil}
          }
      }

      reason_codes =
        reason_codes
        |> Enum.reject(&(&1 == "agent_plan_drafted"))
        |> Kernel.++(["agent_plan_revised", "steer_replan"])
        |> Enum.uniq()

      payload =
        payload
        |> Map.put(:stage, :plan_revised)
        |> Map.put(:plan_version, plan_version)
        |> Map.put(:evaluation_of_last, steer_evaluation(run))
        |> Map.put(:plan_revision, %{plan_version: plan_version, revision_reason: summary})
        |> Map.put(:revision_reason, summary)

      {state, :plan_revised, reason_codes, payload}
    else
      {state, :plan_drafted, reason_codes, payload}
    end
  end

  defp maybe_promote_steer_plan_revision(state, type, _summary, reason_codes, payload),
    do: {state, type, reason_codes, payload}

  defp provider_output_payload?(payload) when is_map(payload) do
    payload
    |> map_value(:author_narrative_source)
    |> AgentNarrativeSource.provider_output_source?()
  end

  defp provider_output_payload?(_payload), do: false

  defp next_replan_version(%AgentRun{} = run, payload) do
    payload_version =
      positive_int(Map.get(payload, :plan_version) || Map.get(payload, "plan_version"))

    max(payload_version || 0, (run.plan_version || 1) + 1)
  end

  defp steer_evaluation(%AgentRun{} = run) do
    %{
      advanced: false,
      plan_holds: false,
      new_constraint: run.goal.text
    }
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
        emit(
          acc,
          :exploration_observed,
          :developer,
          observation.summary,
          ["exploration_observed", "agent_observation_fact"],
          [observation.observation_id],
          %{
            stage: :exploration_observed,
            observation_ref: observation.observation_id,
            observation_type: observation.observation_type,
            source_ref: observation.source_ref,
            evidence_refs: observation.evidence_refs,
            confidence: observation.confidence
          }
        )

      _observation, acc ->
        acc
    end)
  end

  defp add_pending_artifacts(state, refs) when is_list(refs) do
    run = %{state.run | pending_artifact_refs: Enum.uniq(state.run.pending_artifact_refs ++ refs)}
    %{state | run: run}
  end

  # CP3b：中间稿替代落 state + 作者可见说明（结构词；改进稿本体随 artifact_created）。
  defp apply_superseded_artifacts(state, result) when is_map(result) do
    case result[:supersede_artifact_refs] do
      [_ | _] = refs ->
        %{state | run: AgentRun.supersede_pending_artifacts(state.run, refs)}
        |> emit(
          :artifact_superseded,
          "上一稿已按质量意见改进，被新稿替代。",
          ["artifact_superseded", "judgment_continuation"],
          refs
        )

      _ ->
        state
    end
  end

  defp apply_superseded_artifacts(state, _result), do: state

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
    |> emit(:run_cancelled, "AgentRun 已取消。", [
      "cancel_completed",
      "provider_execution_cancelled"
    ])
    |> persist_run_state()
  end

  defp request_provider_cancellation(state, reason) do
    Execution.cancel(state.provider_cancellation_token, reason)
    state
  end

  defp pause_requested?(state), do: state.run.interrupt_state.status == :pause_requested
  defp cancel_requested?(state), do: state.run.interrupt_state.status == :cancel_requested

  defp blocking_interrupt_requested?(state),
    do: pause_requested?(state) or cancel_requested?(state)

  defp resumable?(state),
    do: state.run.status in [:paused, :awaiting_author] and is_nil(state.current_task_ref)

  defp terminal?(state), do: state.run.status in [:completed, :cancelled, :failed]

  defp emit(state, type, summary, reason_codes),
    do: emit(state, type, summary, reason_codes, [], %{})

  defp emit(state, type, summary, reason_codes, refs),
    do: emit(state, type, summary, reason_codes, refs, %{})

  defp emit(state, type, summary, reason_codes, refs, payload) do
    emit(state, type, :author, summary, reason_codes, refs, payload)
  end

  defp emit(state, type, visibility, summary, reason_codes, refs, payload) do
    sequence = state.event_sequence + 1

    {:ok, event} =
      AgentEvent.new(%{
        event_id: "evt_#{state.run.run_id}_#{sequence}",
        run_ref: state.run.run_id,
        step_ref: state.run.current_step_ref,
        sequence: sequence,
        event_type: type,
        visibility: visibility,
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

  defp run_started_payload(%AgentRun{} = run) do
    %{
      profile_ref: run.profile_ref,
      allowed_tools: Map.get(run.authority_scope, :allowed_tools, []),
      profile_selection:
        Map.get(run.authority_scope, :profile_selection) ||
          Map.get(run.authority_scope, "profile_selection") ||
          %{}
    }
  end

  defp persist_run_state(%{run: %AgentRun{} = run} = state) do
    persist_async(fn ->
      AgentRunLog.upsert_run(run_attrs(run))
      persist_events_snapshot(run, state.events)
      persist_long_run_checkpoint(run, state)
    end)

    state
  end

  defp persist_run_state(state), do: state

  defp persist_step_result(state, %AgentStep{} = step, observations) do
    persist_async(fn -> AgentRunLog.insert_step(step_attrs(step, observations)) end)
    state
  end

  defp persist_step_result(state, _step, _observations), do: state

  defp persist_event(%AgentEvent{}), do: :ok

  defp persist_events_snapshot(%AgentRun{} = run, events) when is_list(events) do
    if persist_events_snapshot?(run) do
      events
      |> Enum.reject(&(&1.event_type == :provider_progress))
      |> Enum.map(&event_attrs/1)
      |> AgentRunLog.insert_events()
    else
      :ok
    end
  end

  defp persist_events_snapshot(_run, _events), do: :ok

  defp persist_events_snapshot?(%AgentRun{status: status}),
    do: status in [:completed, :cancelled, :failed, :awaiting_author, :paused]

  defp persist_async(fun) when is_function(fun, 0) do
    cond do
      not runtime_fact_persistence_enabled?() ->
        :ok

      async_persistence_enabled?() ->
        Task.Supervisor.start_child(NovelApplication.BackgroundTaskSupervisor, fn ->
          persist(fun)
        end)

        :ok

      true ->
        persist(fun)
    end
  rescue
    _error -> persist(fun)
  catch
    _kind, _reason -> persist(fun)
  end

  defp runtime_fact_persistence_enabled? do
    Application.get_env(:novel_application, :agent_run_fact_persistence_enabled, true)
  end

  defp async_persistence_enabled? do
    :novel_persistence
    |> Application.get_env(NovelPersistence.Repo, [])
    |> Keyword.get(:pool) != Ecto.Adapters.SQL.Sandbox
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
    result =
      case fun.() do
        {:ok, _record} -> :ok
        {:error, _changeset} -> :ok
        _other -> :ok
      end

    result
  rescue
    _error -> :ok
  catch
    :exit, _reason -> :ok
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
      "agent_run" =>
        Map.merge(
          %{
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
            "checkpoint_version" => @checkpoint_version
          },
          durable_fact_checkpoint_data(run.authority_scope)
        ),
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

  defp durable_fact_checkpoint_data(authority_scope) do
    %{}
    |> maybe_put_fact("work_revision", scope_value(authority_scope, :work_revision))
    |> maybe_put_fact("target_revision_ref", scope_value(authority_scope, :target_revision_ref))
    |> maybe_put_fact("target_revision", scope_value(authority_scope, :target_revision))
  end

  defp maybe_put_fact(map, key, value) do
    case nonblank_value(value) do
      nil -> map
      fact_value -> Map.put(map, key, fact_value)
    end
  end

  defp scope_value(scope, key) when is_map(scope),
    do: Map.get(scope, key) || Map.get(scope, Atom.to_string(key))

  defp scope_value(_scope, _key), do: nil

  defp nonblank_value(value) when is_binary(value) do
    value = String.trim(value)
    if value == "", do: nil, else: value
  end

  defp nonblank_value(nil), do: nil
  defp nonblank_value(value), do: value

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
      remaining_steps: remaining_steps(state.run)
    }
  end

  defp remaining_steps(%AgentRun{
         budget: %{max_steps: max_steps},
         consumed_budget: %{steps: steps}
       })
       when is_integer(max_steps) and is_integer(steps),
       do: max(max_steps - steps, 0)

  defp remaining_steps(_run), do: 0

  defp execute_step_fun(step_fun, run, sequence, snapshot) when is_function(step_fun, 3),
    do: step_fun.(run, sequence, snapshot)

  defp execute_step_fun(step_fun, run, sequence, _snapshot) when is_function(step_fun, 2),
    do: step_fun.(run, sequence)

  defp execute_dynamic_next_step(planner, run, sequence, snapshot) when is_function(planner, 3) do
    planner.(run, sequence, snapshot)
    |> handle_next_step_result(run, sequence, snapshot)
  end

  defp handle_next_step_result(
         {:execute, step_fun, %AgentNextStepDecision{} = decision},
         run,
         sequence,
         snapshot
       )
       when is_function(step_fun) do
    execute_or_complete_for_candidate_budget(
      step_fun,
      decision,
      %{provider_call_count: 1},
      run,
      sequence,
      snapshot
    )
  end

  defp handle_next_step_result(
         {:execute, step_fun, %AgentNextStepDecision{} = decision, meta},
         run,
         sequence,
         snapshot
       )
       when is_function(step_fun) do
    execute_or_complete_for_candidate_budget(step_fun, decision, meta, run, sequence, snapshot)
  end

  defp handle_next_step_result(
         {:complete, %AgentNextStepDecision{} = decision},
         _run,
         _sequence,
         _snapshot
       ) do
    terminal_next_step_result(decision, :completed, 1)
  end

  defp handle_next_step_result(
         {:complete, %AgentNextStepDecision{} = decision, meta},
         _run,
         _sequence,
         snapshot
       ) do
    maybe_emit_terminal_plan_revision(snapshot, decision, meta)

    decision
    |> terminal_next_step_result(:completed, provider_call_count(meta, 0))
    |> attach_terminal_plan_meta(decision, meta)
  end

  defp handle_next_step_result(
         {:await_author, %AgentNextStepDecision{} = decision},
         _run,
         _sequence,
         _snapshot
       ) do
    terminal_next_step_result(decision, :awaiting_author, 1)
  end

  defp handle_next_step_result(
         {:await_author, %AgentNextStepDecision{} = decision, meta},
         _run,
         _sequence,
         snapshot
       ) do
    maybe_emit_terminal_plan_revision(snapshot, decision, meta)

    decision
    |> terminal_next_step_result(:awaiting_author, provider_call_count(meta, 0))
    |> attach_terminal_plan_meta(decision, meta)
  end

  defp handle_next_step_result({:error, reason}, _run, _sequence, _snapshot), do: {:error, reason}

  defp handle_next_step_result(other, _run, _sequence, _snapshot),
    do: {:error, {:invalid_next_step_result, other}}

  defp execute_or_complete_for_candidate_budget(
         step_fun,
         %AgentNextStepDecision{} = decision,
         meta,
         %AgentRun{} = run,
         sequence,
         snapshot
       ) do
    maybe_emit_agent_plan_drafted(snapshot, decision, meta)

    # CP3b（判断②改进闭环）：续行重产出前，中间稿按 meta 声明被替代——快照上先移出
    # 待采纳集合放行 pending 预算；state 落地与 artifact_superseded 事件随步结果收口。
    run = apply_supersede_refs(run, supersede_refs(meta))

    if AgentRun.pending_artifact_budget_reached?(run) do
      complete_for_pending_artifact_budget(run, sequence, decision, meta)
    else
      step_fun
      |> execute_step_fun(run, sequence, snapshot)
      |> attach_loop_decision(decision, meta)
      |> attach_supersede_refs(meta)
    end
  end

  defp supersede_refs(meta) when is_map(meta),
    do: meta |> meta_value(:supersede_artifact_refs) |> List.wrap() |> Enum.filter(&is_binary/1)

  defp supersede_refs(_meta), do: []

  defp apply_supersede_refs(run, []), do: run
  defp apply_supersede_refs(run, refs), do: AgentRun.supersede_pending_artifacts(run, refs)

  defp attach_supersede_refs(result, meta) do
    case {result, supersede_refs(meta)} do
      {_result, []} -> result
      {{:ok, map}, refs} when is_map(map) -> {:ok, Map.put(map, :supersede_artifact_refs, refs)}
      _ -> result
    end
  end

  defp terminal_next_step_result(%AgentNextStepDecision{} = decision, status, provider_call_count) do
    {:ok,
     %{
       loop_decision: decision,
       loop_status: status,
       provider_call_count: provider_call_count
     }}
  end

  defp maybe_emit_terminal_plan_revision(snapshot, %AgentNextStepDecision{} = decision, meta) do
    if plan_revised?(decision) do
      maybe_emit_agent_plan_drafted(snapshot, decision, meta)
    else
      :ok
    end
  end

  defp attach_terminal_plan_meta({:ok, result}, %AgentNextStepDecision{} = decision, meta)
       when is_map(meta) do
    {:ok,
     result
     |> maybe_attach_plan_run_patch(meta)
     |> maybe_attach_replan(decision)}
  end

  defp attach_terminal_plan_meta(result, _decision, _meta), do: result

  defp maybe_emit_agent_plan_drafted(snapshot, decision, meta) do
    if meta_value(meta, :suppress_plan_event) == true do
      :ok
    else
      emit_agent_plan_drafted(snapshot, decision, meta)
    end
  end

  defp emit_agent_plan_drafted(snapshot, decision, meta) do
    run = plan_event_run(snapshot, meta)
    summary = meta_value(meta, :summary) || decision.summary
    reason_codes = meta_value(meta, :reason_codes) || decision.reason_codes

    decision =
      %{
        decision
        | summary: summary,
          reason_codes: reason_codes,
          confidence: meta_value(meta, :confidence) || decision.confidence
      }
      |> maybe_put_decision_narrative_source(meta_value(meta, :author_narrative_source))

    emit_agent_plan_drafted(%{snapshot | run: run}, decision)
  end

  defp plan_event_run(%{run: %AgentRun{} = run}, meta) do
    case meta_value(meta, :agent_plan) do
      plan when is_map(plan) ->
        %{
          run
          | plan: plan,
            plan_ref: plan_ref(plan) || run.plan_ref,
            plan_version: plan_version(plan) || run.plan_version
        }

      _ ->
        run
    end
  end

  defp maybe_put_decision_narrative_source(%AgentNextStepDecision{} = decision, source)
       when is_map(source) do
    %{decision | narrative_source: source}
  end

  defp maybe_put_decision_narrative_source(%AgentNextStepDecision{} = decision, _source),
    do: decision

  defp emit_agent_plan_drafted(
         %{stage_sink: stage_sink, run: %AgentRun{} = run},
         %AgentNextStepDecision{} = decision
       )
       when is_function(stage_sink, 1) do
    event_type = plan_event_type(decision)

    stage_sink.(%{
      event_type: event_type,
      visibility: reasoning_visibility(decision),
      summary: decision.summary,
      reason_codes: [plan_event_reason_code(event_type) | decision.reason_codes],
      refs: [decision.decision_id],
      payload: reasoning_payload(run, decision, event_type)
    })
  end

  defp emit_agent_plan_drafted(_snapshot, _decision), do: :ok

  defp plan_event_type(%AgentNextStepDecision{} = decision) do
    if plan_revised?(decision), do: :plan_revised, else: :plan_drafted
  end

  defp plan_event_reason_code(:plan_revised), do: "agent_plan_revised"
  defp plan_event_reason_code(_event_type), do: "agent_plan_drafted"

  defp reasoning_payload(%AgentRun{} = run, %AgentNextStepDecision{} = decision, stage) do
    steps = plan_steps(run, stage)

    %{
      stage: stage,
      plan_ref: run.plan_ref || plan_ref(run.plan),
      plan_version: payload_plan_version(run, decision),
      current_plan_step_ref: current_plan_step_ref(steps),
      plan_steps: steps,
      loop_decision_ref: decision.decision_id,
      loop_decision_type: decision.decision_type,
      target_tool_ref: decision.target_tool_ref,
      observation_refs: decision.observation_refs,
      evaluation_of_last: decision.evaluation_of_last,
      plan_revision: decision.plan_revision,
      revision_reason: revision_reason(decision),
      confidence: decision.confidence
    }
    |> maybe_put_author_narrative(decision)
    |> Enum.reject(fn {_key, value} -> is_nil(value) end)
    |> Map.new()
  end

  defp maybe_put_author_narrative(payload, %AgentNextStepDecision{} = decision) do
    if AgentNarrativeSource.provider_output_source?(decision.narrative_source) do
      payload
      |> Map.put(:author_narrative, decision.summary)
      |> Map.put(:author_narrative_source, decision.narrative_source)
    else
      payload
    end
  end

  defp reasoning_visibility(%AgentNextStepDecision{} = decision) do
    if AgentNarrativeSource.provider_output_source?(decision.narrative_source),
      do: :author,
      else: :developer
  end

  defp plan_revised?(%AgentNextStepDecision{
         evaluation_of_last: %{plan_holds: false},
         plan_revision: %{revision_reason: reason}
       })
       when is_binary(reason) and reason != "",
       do: true

  defp plan_revised?(_decision), do: false

  defp revision_reason(%AgentNextStepDecision{plan_revision: %{revision_reason: reason}}),
    do: reason

  defp revision_reason(_decision), do: nil

  defp payload_plan_version(_run, %AgentNextStepDecision{
         plan_revision: %{plan_version: version}
       })
       when is_integer(version) and version > 0,
       do: version

  defp payload_plan_version(run, _decision),
    do: run.plan_version || plan_version(run.plan)

  defp plan_steps(%AgentRun{} = run, stage) do
    steps = plan_steps_from_plan(run.plan)
    active_index = active_plan_step_index(run, steps, stage)

    steps
    |> Enum.with_index()
    |> Enum.map(fn {step, index} ->
      %{
        step_ref: plan_step_ref(step),
        kind: step |> map_value(:kind) |> atom_string(),
        status: step_status(index, active_index, stage) |> atom_string(),
        target_tool_ref: map_value(step, :target_tool_ref),
        description: map_value(step, :description),
        success_criteria: string_list(map_value(step, :success_criteria)),
        depends_on: string_list(map_value(step, :depends_on)),
        write_intent: step |> map_value(:write_intent) |> atom_string(),
        risk_hint: step |> map_value(:risk_hint) |> atom_string(),
        authoring_intent: optional_atom_string(map_value(step, :authoring_intent)),
        target_chapter: map_value(step, :target_chapter),
        requested_chapter_raw: map_value(step, :requested_chapter_raw)
      }
      |> Enum.reject(fn {_key, value} -> is_nil(value) end)
      |> Map.new()
    end)
  end

  defp plan_steps_from_plan(plan) when is_map(plan) do
    case Map.get(plan, :steps) || Map.get(plan, "steps") do
      steps when is_list(steps) -> steps
      _ -> []
    end
  end

  defp plan_steps_from_plan(_plan), do: []

  defp active_plan_step_index(_run, [], _stage), do: nil

  defp active_plan_step_index(
         %AgentRun{consumed_budget: %{steps: steps}},
         plan_steps,
         :plan_drafted
       )
       when is_integer(steps) do
    min(steps, length(plan_steps) - 1)
  end

  defp active_plan_step_index(%AgentRun{consumed_budget: %{steps: steps}}, plan_steps, _stage)
       when is_integer(steps) do
    min(max(steps - 1, 0), length(plan_steps) - 1)
  end

  defp active_plan_step_index(_run, _plan_steps, _stage), do: 0

  defp step_status(index, active_index, :plan_drafted) do
    cond do
      is_nil(active_index) -> :pending
      index < active_index -> :done
      index == active_index -> :active
      true -> :pending
    end
  end

  defp step_status(index, active_index, _stage) do
    cond do
      is_nil(active_index) -> :pending
      index <= active_index -> :done
      true -> :pending
    end
  end

  defp current_plan_step_ref(steps) do
    steps
    |> Enum.find(fn step -> Map.get(step, :status) == "active" end)
    |> case do
      nil -> nil
      step -> Map.get(step, :step_ref)
    end
  end

  defp plan_step_ref(step), do: map_value(step, :step_id) || map_value(step, :step_ref)

  defp plan_ref(plan) when is_map(plan), do: Map.get(plan, :plan_id) || Map.get(plan, "plan_id")
  defp plan_ref(_plan), do: nil

  defp plan_version(plan) when is_map(plan),
    do: Map.get(plan, :version) || Map.get(plan, "version")

  defp plan_version(_plan), do: nil

  defp map_value(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_value(_map, _key), do: nil

  defp optional_atom_string(nil), do: nil
  defp optional_atom_string(value), do: atom_string(value)

  defp meta_value(meta, key) when is_map(meta),
    do: Map.get(meta, key) || Map.get(meta, Atom.to_string(key))

  defp meta_value(_meta, _key), do: nil

  defp attach_loop_decision({:ok, result}, %AgentNextStepDecision{} = decision, meta)
       when is_map(result) do
    {:ok,
     result
     |> Map.put_new(:loop_decision, decision)
     |> Map.update(:provider_call_count, provider_call_count(meta, 1), fn count ->
       count + provider_call_count(meta, 1)
     end)
     |> maybe_attach_plan_run_patch(meta)
     |> maybe_attach_replan(decision)}
  end

  defp attach_loop_decision({:error, reason}, _decision, _meta), do: {:error, reason}
  defp attach_loop_decision(other, _decision, _meta), do: other

  defp provider_call_count(meta, default) when is_map(meta) do
    case Map.get(meta, :provider_call_count) || Map.get(meta, "provider_call_count") do
      value when is_integer(value) and value >= 0 -> value
      _ -> default
    end
  end

  defp provider_call_count(_meta, default), do: default

  defp maybe_attach_plan_run_patch(result, meta) when is_map(result) and is_map(meta) do
    case meta_value(meta, :agent_plan) do
      plan when is_map(plan) ->
        Map.update(result, :run_patch, plan_run_patch(plan), fn patch ->
          Map.merge(patch || %{}, plan_run_patch(plan))
        end)

      _ ->
        result
    end
  end

  defp maybe_attach_plan_run_patch(result, _meta), do: result

  defp plan_run_patch(plan) when is_map(plan) do
    %{
      plan: plan,
      plan_ref: plan_ref(plan),
      plan_version: plan_version(plan)
    }
  end

  defp complete_for_pending_artifact_budget(
         %AgentRun{} = run,
         sequence,
         %AgentNextStepDecision{} = proposed_decision,
         meta
       ) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_candidate_budget_goal_satisfied",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "已生成待采纳候选，候选预算已达上限，停止追加候选。",
        target_tool_ref: proposed_decision.target_tool_ref,
        write_intent: :none,
        risk_hint: proposed_decision.risk_hint,
        reason_codes:
          ["candidate_budget_exhausted", "model_requested_extra_candidate"] ++
            proposed_decision.reason_codes,
        observation_refs: proposed_decision.observation_refs,
        evaluation_of_last: %{
          advanced: false,
          plan_holds: false,
          new_constraint: "pending_artifact_budget_reached"
        },
        confidence: 1.0
      })

    {:ok,
     %{
       loop_decision: decision,
       loop_status: :completed,
       provider_call_count: provider_call_count(meta, 0)
     }}
  end

  defp maybe_attach_replan(result, %AgentNextStepDecision{} = decision) do
    if plan_revised?(decision) do
      result
      |> Map.update(:replan_count, 1, &(&1 + 1))
      |> Map.update(:run_patch, replan_run_patch(decision), fn patch ->
        Map.merge(patch || %{}, replan_run_patch(decision))
      end)
    else
      result
    end
  end

  defp replan_run_patch(%AgentNextStepDecision{
         plan_revision: %{plan_version: version}
       })
       when is_integer(version) and version > 0,
       do: %{plan_version: version}

  defp replan_run_patch(_decision), do: %{}

  defp step_snapshot(state, server, run_for_step) do
    %{
      run: run_for_step,
      observations: state.observations,
      events: state.events,
      stage_state: state.stage_state,
      provider_cancellation_token: state.provider_cancellation_token,
      stage_sink: fn attrs ->
        send(server, {:agent_stage_event, attrs})
        :ok
      end
    }
  end

  @stage_event_types [
    :goal_understood,
    :judgment_decided,
    :plan_drafted,
    :plan_revised,
    :exploration_observed,
    :evaluation_made,
    :gate_decided,
    :tool_started,
    :tool_completed,
    :provider_progress,
    :quality_review_started,
    :quality_finding_created
  ]

  defp normalize_stage_event(attrs) do
    type = stage_event_type(Map.get(attrs, :event_type) || Map.get(attrs, "event_type"))

    visibility =
      stage_event_visibility(Map.get(attrs, :visibility) || Map.get(attrs, "visibility"))

    summary = normalized_stage_summary(attrs)

    if type in @stage_event_types and is_binary(summary) do
      {:ok, type, visibility, summary,
       string_list(Map.get(attrs, :reason_codes) || Map.get(attrs, "reason_codes")),
       string_list(Map.get(attrs, :refs) || Map.get(attrs, "refs")),
       map_payload(Map.get(attrs, :payload) || Map.get(attrs, "payload"))}
    else
      :ignore
    end
  end

  defp normalized_stage_summary(attrs) do
    case Map.get(attrs, :summary) || Map.get(attrs, "summary") do
      summary when is_binary(summary) ->
        summary = String.trim(summary)
        if summary == "", do: nil, else: summary

      _ ->
        nil
    end
  end

  defp stage_event_type(value) when value in @stage_event_types, do: value

  defp stage_event_type(value) when is_binary(value) do
    Enum.find(@stage_event_types, &(Atom.to_string(&1) == value))
  end

  defp stage_event_type(_value), do: nil

  defp stage_event_visibility(value) when value in [:author, :developer, :internal], do: value
  defp stage_event_visibility("developer"), do: :developer
  defp stage_event_visibility("internal"), do: :internal
  defp stage_event_visibility(_), do: :author

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
