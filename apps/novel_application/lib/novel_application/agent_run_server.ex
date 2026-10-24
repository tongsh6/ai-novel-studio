defmodule NovelApplication.AgentRunServer do
  @moduledoc """
  受监督的 AgentRun 进程。Provider/工具步骤运行于 AgentStepTaskSupervisor；
  消息接收与结果发布边界同步保存 Interaction，防止 UI 成功但会话记录缺失。
  """

  use GenServer

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentEventPublisher
  alias NovelApplication.AgentNarrativeSource
  alias NovelApplication.AgentRunBudget
  alias NovelApplication.TurnInteractionService
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentNextStepDecision
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentRun
  alias NovelDomain.AgentRunPolicy
  alias NovelDomain.AgentStep
  alias NovelFoundation.Enums.{Status, TaskPhase}
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

  @typedoc "作者预算恢复动作（`author_budget_action` 入参；外部动作串归一化后的内部形态）。"
  @type recovery_mode ::
          :next_step
          | :remaining_plan
          | {:steps, pos_integer()}
          | {:single_step, pos_integer()}
          | {:selected_steps, [String.t()]}

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
            defer_delivery: false,
            interaction_store: nil,
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

  @spec command(GenServer.server(), :pause | :cancel) :: :ok
  def command(server, command), do: GenServer.cast(server, {:command, command})

  @spec resume(GenServer.server(), timeout()) ::
          :ok | {:error, :awaiting_author_requires_input | :not_resumable}
  def resume(server, timeout \\ 5_000), do: GenServer.call(server, {:command, :resume}, timeout)

  @spec steer(GenServer.server(), String.t(), timeout()) ::
          {:ok,
           %{run_id: String.t(), parent_turn_ref: String.t() | nil, goal_version: pos_integer()}}
          | {:error, :not_steerable}
  def steer(server, text, timeout \\ 5_000),
    do: GenServer.call(server, {:command, {:steer, text}}, timeout)

  @doc "B31 CP1 Q03：带 expected_goal_version 的 steer；nil/缺省保持旧行为。"
  def steer(server, text, expected_goal_version, timeout)
      when is_integer(expected_goal_version) or is_nil(expected_goal_version) do
    GenServer.call(server, {:command, {:steer, text, nil, expected_goal_version}}, timeout)
  end

  def steer_submission(server, text, submission_id, expected_goal_version \\ nil),
    do: GenServer.call(server, {:command, {:steer, text, submission_id, expected_goal_version}})

  @spec author_budget_action(GenServer.server(), recovery_mode(), timeout()) ::
          {:ok, map()}
          | {:error,
             :not_awaiting_author
             | :budget_not_exhausted
             | :hard_cap_reached
             | :invalid_recovery_mode}
  def author_budget_action(server, mode, timeout \\ 5_000),
    do: GenServer.call(server, {:author_budget_action, mode}, timeout)

  @doc false
  # 外部动作模式 → 内部 recovery_mode()；非法值收敛为 :invalid_recovery_mode。
  # 公开（非 defp）是因为 dialyzer 只在 public contract 上引用 spec：handle_call 的
  # GenServer 消息参数类型为 term()，经此归一化后才能让 tuple 分支按真实域参与分析。
  @spec normalize_recovery_mode(term()) :: recovery_mode() | :invalid_recovery_mode
  def normalize_recovery_mode(:next_step), do: :next_step
  def normalize_recovery_mode(:remaining_plan), do: :remaining_plan

  def normalize_recovery_mode({:steps, count}) when is_integer(count) and count > 0,
    do: {:steps, count}

  def normalize_recovery_mode({:single_step, count}) when is_integer(count) and count > 0,
    do: {:single_step, count}

  def normalize_recovery_mode({:selected_steps, refs}) when is_list(refs) and refs != [],
    do: {:selected_steps, refs}

  def normalize_recovery_mode(_mode), do: :invalid_recovery_mode

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
      interaction_store: Keyword.get(opts, :interaction_store) || TurnInteractionService.store(),
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

  # resume 是同步 call：命令被拒绝必须对作者可见（DS03）。awaiting_author 是系统
  # 缺作者输入的决策点，裸 resume 只会重放旧 settled 判断，必须走非空 steer 或
  # 绑定 action；resume 仅服务作者主动暂停（paused）的原地恢复。
  def handle_call({:command, :resume}, _from, state) do
    cond do
      state.run.status == :awaiting_author ->
        {:reply, {:error, :awaiting_author_requires_input}, state}

      not resumable?(state) ->
        {:reply, {:error, :not_resumable}, state}

      true ->
        state =
          state
          |> clear_interrupt()
          |> put_run_status(:running)
          |> put_run_phase(:executing)
          |> emit(:run_resumed, "AgentRun 已恢复。", ["resume_requested"])
          |> persist_run_state()

        {:reply, :ok, state, {:continue, :run_next_step}}
    end
  end

  # steer 是同步 call（DS03）：拒绝可见，且回执携带 run_id / parent_turn_ref /
  # goal_version，供调用方把作者补充持久化为 session Interaction（刷新可恢复）。
  def handle_call({:command, {:steer, text}}, from, state) when is_binary(text),
    do: handle_call({:command, {:steer, text, nil}}, from, state)

  def handle_call(
        {:command, {:steer, %{author_question_reply: request}, submission_id}},
        _from,
        state
      ) do
    alias NovelPersistence.AuthorQuestionRepo

    source =
      AuthorQuestionRepo.source(request.workspace_id, request.session_id, request.source_turn_ref)

    source = source && source.content["turn_result"]

    case AuthorQuestionRepo.receipt(request.receipt_key, request.payload_digest) do
      {:ok, receipt} ->
        {:reply, {:ok, Map.put(receipt, "duplicate", true)}, state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}

      :new ->
        case NovelApplication.AuthorQuestion.validate_reply(state.run, request, source) do
          :ok -> commit_question_answer(state, request, submission_id)
          {:error, reason} -> {:reply, {:error, reason}, state}
        end
    end
  end

  # B26 显式问题回复路径使用 map 形式 submission；B31 CP1 的 expected_goal_version 参数
  # 对其为 nil（问题回复的版本校验在 request payload 内由 AuthorQuestion.validate_reply 负责）。
  def handle_call(
        {:command, {:steer, %{author_question_reply: request}, submission_id, _expected}},
        from,
        state
      ),
      do:
        handle_call(
          {:command, {:steer, %{author_question_reply: request}, submission_id}},
          from,
          state
        )

  def handle_call({:command, {:steer, text, submission_id}}, from, state) when is_binary(text),
    do: handle_call({:command, {:steer, text, submission_id, nil}}, from, state)

  def handle_call(
        {:command, {:steer, text, submission_id, expected_goal_version}},
        _from,
        state
      )
      when is_binary(text) do
    current = state.run.goal.version

    cond do
      terminal?(state) ->
        {:reply, {:error, :not_steerable}, state}

      # B31 CP1 Q03：客户端声明版本与当前不符 → 可解释冲突；不推进 goal、不写 steer。
      is_integer(expected_goal_version) and expected_goal_version != current ->
        {:reply, {:error, {:goal_version_conflict, current, expected_goal_version}}, state}

      true ->
        do_apply_steer(state, text, submission_id, current)
    end
  end

  def handle_call({:author_budget_action, raw_mode}, _from, state) do
    mode = normalize_recovery_mode(raw_mode)

    cond do
      mode == :invalid_recovery_mode ->
        {:reply, {:error, :invalid_recovery_mode}, state}

      state.run.status != :awaiting_author ->
        {:reply, {:error, :not_awaiting_author}, state}

      not AgentRun.budget_exhausted?(state.run) and not scope_checkpoint?(state) ->
        {:reply, {:error, :budget_not_exhausted}, state}

      match?({:selected_steps, _}, mode) ->
        {:selected_steps, refs} = mode
        selected_steps_recovery(state, refs)

      match?({:single_step, _}, mode) ->
        {:single_step, index} = mode
        single_step_recovery(state, index)

      true ->
        expand_standard_recovery(state, mode)
    end
  end

  defp expand_standard_recovery(state, mode) do
    plan_steps = plan_steps_from_plan(state.run.plan)

    case AgentRunBudget.authorized_expand(
           state.run.budget,
           state.run.consumed_budget,
           plan_steps,
           mode
         ) do
      {:error, reason} ->
        {:reply, {:error, reason}, state}

      {:ok, budget} ->
        state =
          %{state | run: %{state.run | budget: budget}, final_turn_result: nil}
          |> clear_interrupt()
          |> put_run_status(:running)
          |> put_run_phase(:executing)
          |> emit(
            :budget_expanded,
            budget_expanded_summary(mode),
            ["author_budget_expanded" | recovery_mode_reason_codes(mode)],
            [],
            Map.merge(%{budget: budget}, recovery_mode_payload(mode))
          )
          |> persist_run_state()

        {:reply,
         {:ok,
          %{
            run_id: state.run.run_id,
            mode: recovery_mode_label(mode),
            step_count: recovery_step_count(mode),
            status: "running",
            budget: budget
          }}, state, {:continue, :run_next_step}}
    end
  end

  defp do_apply_steer(state, text, submission_id, current_version) do
    run = %{state.run | goal: %{state.run.goal | text: text, version: current_version + 1}}

    case TurnInteractionService.record_steer(run, text, state.interaction_store, submission_id) do
      {:ok, %{duplicate?: true} = receipt} ->
        {:reply,
         {:ok,
          %{
            run_id: run.run_id,
            parent_turn_ref: run.parent_turn_ref,
            goal_version: receipt.goal_version
          }}, state}

      {:ok, _receipt} ->
        apply_author_steer(state, run)

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  defp commit_question_answer(state, request, submission_id) do
    run = %{
      state.run
      | goal: %{state.run.goal | text: request.text, version: state.run.goal.version + 1}
    }

    applied = apply_author_steer(%{state | defer_delivery: true}, run)
    next = elem(applied, 2)

    result = %{
      status: "accepted",
      run_id: run.run_id,
      question_ref: request.question_ref,
      submission_id: submission_id,
      goal_version: run.goal.version,
      payload_digest: request.payload_digest
    }

    attrs =
      Map.merge(request, %{
        run_record: run_attrs(next.run),
        events: new_event_attrs(state, next),
        checkpoint: question_checkpoint(next),
        result: result,
        input: %{
          workspace_id: request.workspace_id,
          session_id: request.session_id,
          run_id: run.run_id,
          status: run.status,
          goal_version: run.goal.version,
          turn_id: "#{run.parent_turn_ref}:steer:#{run.goal.version}",
          submission_id: submission_id,
          text: request.text,
          message_kind: "steer",
          author_question_ref: request.question_ref,
          author_action_ref: request.action_input.action_id,
          author_choice_value: request.choice_value,
          source_question_turn_ref: request.source_turn_ref
        }
      })

    case TurnInteractionService.commit_question(:question_answer, attrs, state.interaction_store) do
      {:ok, receipt} ->
        next = publish_committed_events(state, next)
        reply = {:reply, {:ok, receipt}, next}
        if tuple_size(applied) == 4, do: Tuple.insert_at(reply, 3, elem(applied, 3)), else: reply

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  defp apply_author_steer(state, run) do
    resume? = state.run.status == :awaiting_author and is_nil(state.current_task_ref)
    {run, grant} = maybe_grant_writer_timeout_retry(run, state.events)

    state =
      %{state | run: run}
      |> maybe_emit_steer_budget_grant(grant)
      |> maybe_prepare_awaiting_author_steer(resume?)
      |> put_interrupt(:steer_requested)
      |> emit(:plan_adjusted, "已收到新的创作方向。", ["steer_requested"])
      |> maybe_resume_after_steer(resume?)
      |> persist_run_state()

    reply =
      {:ok,
       %{run_id: run.run_id, parent_turn_ref: run.parent_turn_ref, goal_version: run.goal.version}}

    if resume?,
      do: {:reply, reply, state, {:continue, :run_next_step}},
      else: {:reply, reply, state}
  end

  # B23 CP5：steer 预算追加同步一条 developer AgentEvent（visibility 非 author，
  # 不进作者活动轨迹），与 LogEmit `agent_run.steer_budget_granted.done` 同源，
  # 持久层可按 run_id 查证「作者补充后同一 run 获得一次有界重试预算」。
  defp maybe_emit_steer_budget_grant(state, nil), do: state

  defp maybe_emit_steer_budget_grant(state, grant) do
    emit(
      state,
      :budget_expanded,
      :developer,
      "作者补充后为停等 run 追加一次有界重试预算。",
      ["steer_budget_granted", grant.retry_reason],
      [],
      %{
        retry_reason: grant.retry_reason,
        reason_codes: grant.reason_codes,
        added: grant.added,
        budget: grant.budget
      }
    )
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

  # M0 缺陷修复（2026-07-19）：作者采纳 = 该候选的作者终局。从 pending 摘除 +
  # stage_state 旗标（单候选 flow 在下一 planner 迭代边界按旗标机械收束）+
  # 一等事件留痕。已终局/非 pending 引用一律无害 no-op（channel 侧不须精确判定）。
  def handle_cast({:command, {:artifact_resolved, artifact_ref}}, state)
      when is_binary(artifact_ref) do
    if terminal?(state) or artifact_ref not in state.run.pending_artifact_refs do
      {:noreply, state}
    else
      run = %{
        state.run
        | pending_artifact_refs: List.delete(state.run.pending_artifact_refs, artifact_ref)
      }

      adopted =
        (Map.get(state.stage_state, :author_adopted_refs) || []) ++ [artifact_ref]

      state =
        %{state | run: run}
        |> merge_stage_state(%{author_adopted_refs: adopted})
        |> emit(:artifact_resolved, "作者已采纳本轮候选。", ["artifact_resolved", "author_adopted"], [
          artifact_ref
        ])
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

          visibility =
            if cancel_requested?(state) or terminal?(state), do: :developer, else: visibility

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
        {summary, reason_codes} = budget_exhausted_outcome(state.run)
        state = settle_budget_shortfall(state, summary, reason_codes)
        {:noreply, persist_run_state(state)}

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
        # ADR-0018 / LogContext：Task 进程不继承 run server 的进程日志关联键，而
        # next_step_planner 内的独立计划起草/修订 provider 调用发生在该 step 的
        # TurnBinding.bind 之前。先按本 run 的源 turn 绑定，保证 provider 调用与
        # run 事件可被同一 turn 归因；后续 step 执行仍由 TurnBinding.bind 覆盖。
        NovelCommon.LogContext.put_turn(
          run_for_step.workspace_id,
          run_for_step.work_id,
          run_for_step.parent_turn_ref,
          run_for_step.session_id
        )

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

  defp handle_step_result(
         %{run: %{interrupt_state: %{status: :cancel_requested}}} = state,
         result
       ) do
    # 取消已先进入 run 命令序列：迟到结果仅计真实开销，不发布候选/问题/动作。
    case result do
      {:ok, facts} when is_map(facts) -> add_consumed_budget(state, facts)
      _ -> add_consumed_budget(state, %{})
    end
  end

  defp handle_step_result(state, {:ok, %{turn_result: %{author_question: _}} = result}) do
    next =
      %{state | defer_delivery: true}
      |> merge_stage_state(result[:stage_state])
      |> apply_recorded_result(result, result[:artifact_refs] || [], result.turn_result, nil)
      |> put_run_status(:awaiting_author)
      |> put_run_phase(:stopped)
      |> emit(
        :awaiting_author,
        result.turn_result.author_question.question,
        Enum.uniq([
          "model_question"
          | if(result[:loop_decision], do: result.loop_decision.reason_codes, else: [])
        ]),
        [
          result.turn_result.author_question.question_ref
        ]
      )

    attrs = %{
      workspace_id: next.run.work_id,
      session_id: next.run.session_id,
      run_id: next.run.run_id,
      status: :awaiting_author,
      goal_version: next.run.goal.version,
      turn_result: json_safe(result.turn_result),
      run_record: run_attrs(next.run),
      events: new_event_attrs(state, next),
      checkpoint: question_checkpoint(next),
      decision_trace:
        if(result[:decision_trace],
          do:
            NovelApplication.DialogueGateway.trace_to_attrs(
              result.decision_trace,
              next.run.work_id,
              next.run.session_id
            )
        )
    }

    case TurnInteractionService.commit_question(
           :question_delivery,
           attrs,
           state.interaction_store
         ) do
      {:ok, _} ->
        publish_committed_events(state, next)

      {:error, _} ->
        settle_run_failed(state, :interaction_persistence_failed, ["question_persistence_failed"])
    end
  end

  defp handle_step_result(state, {:ok, result}) when is_map(result) do
    artifact_refs = Map.get(result, :artifact_refs, [])
    turn_result = Map.get(result, :turn_result)

    state =
      state
      |> merge_stage_state(Map.get(result, :stage_state))
      |> sync_execution_steps()
      |> apply_superseded_artifacts(result)
      |> apply_progress_signature(Map.get(result, :progress_signature))

    no_progress_stopped? = no_progress_stopped?(state)

    {artifact_refs, turn_result, loop_status} =
      if no_progress_stopped?,
        do: {[], nil, nil},
        else: {artifact_refs, turn_result, Map.get(result, :loop_status)}

    case TurnInteractionService.record_result(
           state.run,
           turn_result,
           state.interaction_store,
           result[:decision_trace]
         ) do
      :ok ->
        apply_recorded_result(state, result, artifact_refs, turn_result, loop_status)

      {:ok, persisted} ->
        apply_recorded_result(
          state,
          Map.put(result, :turn_result, persisted),
          [],
          persisted,
          loop_status
        )

      {:error, _reason} ->
        settle_run_failed(state, :interaction_persistence_failed, [
          "interaction_persistence_failed"
        ])
    end
  end

  defp handle_step_result(state, {:error, reason}) do
    state
    |> add_consumed_budget(%{})
    |> settle_run_failed(reason, ["step_failed" | failure_family_reason_codes(reason)])
  end

  defp handle_step_result(state, other) do
    handle_step_result(state, {:error, {:unexpected_step_result, other}})
  end

  defp apply_recorded_result(state, result, artifact_refs, turn_result, loop_status) do
    step = Map.get(result, :step)
    observations = Map.get(result, :observations, [])

    common =
      state
      |> apply_run_patch(Map.get(result, :run_patch))
      |> maybe_mark_step_completed(step)
      |> add_consumed_budget(result)
      |> add_observations(observations)
      |> add_pending_artifacts(artifact_refs)
      |> collect_selection_artifact_result(turn_result)
      |> persist_step_result(step, observations)
      |> emit_observations(observations)

    if selection_scope_checkpoint?(state, loop_status, turn_result) do
      state =
        common
        |> settle_selection_checkpoint(selection_scope(state))
        |> persist_run_state()

      state
    else
      state =
        common
        |> maybe_store_final_turn_result(turn_result)
        |> maybe_emit_artifact_created(artifact_refs, turn_result)
        |> maybe_emit_turn_result(artifact_refs, turn_result)
        |> maybe_emit_loop_decision(Map.get(result, :loop_decision))
        |> maybe_apply_loop_status(loop_status, Map.get(result, :loop_decision))
        |> maybe_stop_budget_exhausted()

      persist_run_state(state)
    end
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

    turn_result =
      state.run |> safe_failure_turn_result(reason) |> preserve_committed_results(state)

    TurnInteractionService.record_result(
      %{state.run | status: :failed},
      turn_result,
      state.interaction_store
    )

    state
    |> put_run_status(:failed)
    |> maybe_store_final_turn_result(turn_result)
    |> emit(:run_failed, failure_author_summary(reason), reason_codes, [], %{
      turn_result: turn_result
    })
    |> persist_run_state()
  end

  defp preserve_committed_results(result, state) do
    refs =
      state.events
      |> Enum.filter(&(&1.event_type in [:artifact_created, :turn_result_ready]))
      |> Enum.map(
        &(get_in(&1.payload, [:turn_result, :turn_id]) ||
            get_in(&1.payload, ["turn_result", "turn_id"]))
      )
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    current = TurnInteractionService.input_ref(state.run)
    result = Map.put(result, :turn_id, current)
    preserve_result_refs(result, state, refs)
  end

  defp preserve_result_refs(result, _state, []), do: result

  defp preserve_result_refs(result, state, refs) do
    turn =
      if result.turn_id in refs,
        do: "#{result.turn_id}:failure:#{state.next_sequence}",
        else: result.turn_id

    result
    |> Map.put(:turn_id, turn)
    |> Map.put(:assistant_message, %{text: "本次操作未完成，运行已停止。此前已提交的结果仍保留，请查看原记录后决定下一步。"})
    |> Map.update!(
      :trace_summary,
      &Map.merge(&1, %{
        effect_scope: "current_operation",
        prior_committed_result_refs: refs,
        no_write_reason: "failed operation did not revoke prior committed results"
      })
    )
  end

  # provider 错误契约形状（Gateway execution_error：%{type:, message:}）判定失败家族。
  # 判断结构不可解析（ADR-0025 判断①单调用纠错重试后仍坏）= provider 输出契约违约，
  # 与帧纪元 :frame_contract_invalid 同格——作者应得到"格式不符合契约，请重试"。
  defp provider_failure_reason?({:judgment_decision_unparseable, _fragment}), do: true

  # Q3a：语义矛盾重试后仍矛盾 = 同族输出违约（缺口诚实律降级，不裸崩 run）。
  defp provider_failure_reason?({:judgment_semantic_conflict, _fragment}), do: true

  defp provider_failure_reason?(reason),
    do: is_map(reason) and is_atom(Map.get(reason, :type))

  defp failure_family_reason_codes({family, _reason})
       when family in [:judgment_protocol_violation, :agent_plan_protocol_violation],
       do: ["protocol_violation", Atom.to_string(family)]

  defp failure_family_reason_codes({:author_content_registration_invalid, reason}),
    do: ["author_content_registration_invalid", Atom.to_string(reason)]

  defp failure_family_reason_codes({:judgment_output_conflict, reason}),
    do: ["judgment_output_conflict", Atom.to_string(reason)]

  defp failure_family_reason_codes({:pending_artifact_execution_failed, _tool, _trace}),
    do: ["pending_artifact_execution_failed"]

  # B22：超时按"哪一层没有进展"给出可检索的原因码（作者安全：只用结构类别）。
  defp failure_family_reason_codes(%{type: :timeout, details: %{timeout_kind: kind}})
       when kind in [:connection_stall, :stream_interrupted, :deadline] do
    ["provider_error", "provider_timeout_#{kind}"]
  end

  defp failure_family_reason_codes(reason) do
    if provider_failure_reason?(reason), do: ["provider_error"], else: []
  end

  defp failure_author_summary({family, _reason})
       when family in [:judgment_protocol_violation, :agent_plan_protocol_violation],
       do: "模型输出未通过操作契约校验，本轮已安全停止。"

  defp failure_author_summary({:author_content_registration_invalid, _}),
    do: "原文登记未通过校验，本轮已安全停止。"

  defp failure_author_summary({:judgment_output_conflict, _}),
    do: "回复与本轮要求不一致，已停止生成候选。"

  # B22：作者可见摘要只讲结构性事实（无进展类别/字数），不携带 provider 原始载荷。
  defp failure_author_summary(%{type: :timeout, details: %{timeout_kind: :connection_stall}}) do
    "模型在限定的等待时间内没有任何输出（可能仍在排队或预填充），本轮运行已安全停止。"
  end

  defp failure_author_summary(%{
         type: :timeout,
         details: %{timeout_kind: :stream_interrupted, output_chars: chars}
       })
       when is_integer(chars) do
    "模型输出中途中断（已生成 #{chars} 字），本轮运行已安全停止。"
  end

  defp failure_author_summary(%{type: :timeout, details: %{timeout_kind: :deadline}}) do
    "模型调用超过部署侧配置的总时长上限，本轮运行已安全停止。"
  end

  defp failure_author_summary(reason) do
    if provider_failure_reason?(reason) do
      "模型调用失败，本轮运行已安全停止。"
    else
      "本轮运行执行失败，已安全停止。"
    end
  end

  defp safe_failure_turn_result(
         %AgentRun{} = run,
         {:pending_artifact_execution_failed, tool, trace}
       ) do
    run
    |> safe_failure_turn_result({:pending_artifact_invalid, :revision_failed})
    |> put_in([:truthfulness, :tool_called], true)
    |> put_in([:truthfulness, :tool_name], tool)
    |> put_in([:trace_summary, :trace_ref], trace)
    |> put_in([:assistant_message, :text], "修订未能生成有效的新稿。你的输入已保留，本次没有改变原稿或写入作品事实，可以稍后重试。")
  end

  defp safe_failure_turn_result(%AgentRun{} = run, reason) do
    %{
      schema_version: "3.0-draft",
      turn_id: run.parent_turn_ref,
      assistant_message: %{text: failure_fallback_message(reason)},
      ui_cards: [],
      phase: "failed",
      # ADR-0006 #2（B13b BB-4，2026-10-23 作者拍板方案 A）：run 失败兜底 TurnResult
      # 是「失败但可恢复」（作者可重试/继续对话）；phase 仍 failed、run 级 status
      # 仍 :failed——重试是新一轮 run，不是恢复同一 run。
      status: "failed_recoverable",
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
        trigger: run.trigger,
        status: :failed
      }
    }
  end

  defp failure_fallback_message(:interaction_persistence_failed),
    do: "本轮结果未能保存，已停止发布成功结果。请稍后重试。"

  defp failure_fallback_message({family, _reason})
       when family in [:judgment_protocol_violation, :agent_plan_protocol_violation],
       do: "模型返回的操作或来源没有通过校验，纠正后仍不符合约束。原请求已保留；没有生成候选或写入作品事实，可以调整请求后重试。"

  defp failure_fallback_message({:author_content_registration_invalid, reason}),
    do: TurnInteractionService.author_registration_failure_message(reason)

  defp failure_fallback_message({:judgment_output_conflict, _}),
    do: "模型回复与本轮要求不一致，纠正后仍未通过校验。你的输入已保留；没有生成候选或写入作品事实，可以继续对话。"

  defp failure_fallback_message({:pending_artifact_invalid, _}),
    do: "这次候选处理未完成，目标可能已被处理或修订未成功。没有据此采纳或写入作品事实，请核对当前候选后继续。"

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
    |> emit(
      :run_completed,
      "AgentRun 已完成。",
      if(decision.decision_type == :goal_satisfied,
        do: ["goal_satisfied", "agent_loop_completed"],
        else: ["agent_loop_completed"]
      ),
      [
        decision.decision_id
      ]
    )
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
        {summary, reason_codes} = budget_exhausted_outcome(state.run)
        settle_budget_shortfall(state, summary, reason_codes)

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
        plan_version: plan_version_from_patch(patch) || run.plan_version,
        budget:
          AgentRunBudget.expand(run.budget, plan_steps_from_plan(plan),
            author_limits: author_limits_for_run(run),
            # 计划执行完还需要一次收束/完成判断，它不计 execution_steps，
            # 但 runtime 在调用 planner 前会看 max_steps，因此预留 1 个收束 token。
            execution_overhead: %{steps: 1, tool_calls: 1, provider_calls: 1}
          )
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

  # CP2c：执行步预算只由 AgentPlan cursor 推进，不含判断/计划起草。
  defp sync_execution_steps(state) do
    current = AgentRun.execution_steps(state.run)
    cursor = plan_execution_cursor(state.stage_state)

    if cursor > current do
      consumed = state.run.consumed_budget
      %{state | run: %{state.run | consumed_budget: %{consumed | execution_steps: cursor}}}
    else
      state
    end
  end

  defp plan_execution_cursor(stage_state) when is_map(stage_state) do
    case Map.get(stage_state, :agent_plan_cursor) || Map.get(stage_state, "agent_plan_cursor") do
      value when is_integer(value) and value >= 0 ->
        value

      value when is_binary(value) ->
        case Integer.parse(value) do
          {cursor, ""} when cursor >= 0 -> cursor
          _ -> 0
        end

      _ ->
        0
    end
  end

  defp plan_execution_cursor(_stage_state), do: 0

  defp add_consumed_budget(state, result) when is_map(result) do
    consumed = state.run.consumed_budget

    run = %{
      state.run
      | consumed_budget: %{
          consumed
          | tool_calls: consumed.tool_calls + non_negative_count(result[:tool_call_count]),
            provider_calls:
              max(
                consumed.provider_calls + non_negative_count(result[:provider_call_count]),
                observed_provider_calls(state)
              ),
            replans: consumed.replans + non_negative_count(result[:replan_count])
        }
    }

    %{state | run: run}
  end

  # 失败/有界纠错也消耗调用；统一 provider 事件是实际调用的下界，不能只累计成功结果。
  defp observed_provider_calls(state) do
    state.events
    |> Enum.filter(&(&1.event_type == :provider_progress))
    |> Enum.map(
      &(Map.get(&1.payload, :provider_call_ref) || Map.get(&1.payload, "provider_call_ref"))
    )
    |> Enum.reject(&is_nil/1)
    |> MapSet.new()
    |> MapSet.size()
  end

  defp non_negative_count(value) when is_integer(value) and value > 0, do: value
  defp non_negative_count(_), do: 0

  defp apply_progress_signature(state, signature) when is_binary(signature) and signature != "" do
    if MapSet.member?(state.progress_signatures, signature) do
      state
      |> put_run_status(:awaiting_author)
      |> put_run_phase(:stopped)
      |> emit(:awaiting_author, "AgentRun 未取得新进展，已停止等待作者回复。", [
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

  # 仅 paused 可 resume（DS03）：awaiting_author 的恢复入口是非空 steer / 绑定
  # action（见 handle_call resume 分支的拒绝语义与 steer 的 resume_after_steer）。
  defp resumable?(state),
    do: state.run.status == :paused and is_nil(state.current_task_ref)

  # awaiting_author 是系统主动交还作者的决策点。作者补充新方向后，同一 run 必须
  # 重新进入判断，而不是继续消费上一次的 settled/context/checkpoint；goal.version
  # 已变化，旧 progress signature 也不能把新目标误判为重复空转。已完成 steps、
  # observations 与 pending artifacts 保留，符合 steer 的 Observation 保留语义。
  # B17：writer 连续超时导致计划耗尽后，作者点「先写第一场（500 字）」的 scoped
  # steer 必须能让同一 run 重新走一次有界判断/产出；否则继续按旧预算重放
  # “计划耗尽”只会再次停等。这里只在最近一次 awaiting 事件确为 writer_timeout 时
  # 追加一次 replan 预算，且由作者显式操作触发，不自动重试、不新建 run。
  # B23 CP5：计划耗尽停等（plan_exhausted_without_completion，无 writer_timeout）
  # 同样会让同一 run 的下一步判断立刻撞回同一停等点。作者显式给出方向后，在同一
  # run 内追加一次有界 replan/provider/tool 预算（同 writer_timeout 做法），使补充
  # 后能真正重试一次；仍不自动重试、不新建 run。grant 留结构化业务日志，供外部
  # 验收用 app JSONL 证明「作者补充后同一 run 获得重试预算」。
  defp maybe_grant_writer_timeout_retry(%AgentRun{} = run, events) when is_list(events) do
    reason_codes = latest_awaiting_reason_codes(events)

    case retry_grant_reason(reason_codes) do
      nil ->
        {run, nil}

      retry_reason ->
        # 一次 scoped retry 的真实开销：重新判断/修订 + 1 次 writer + 1 次质量复核 +
        # 1 次工具槽；按实测消耗留出一次判断/复核余量，避免重试成功前再次撞预算。
        added = %{max_replans: 1, max_provider_calls: 3, max_tool_calls: 1}

        budget =
          run.budget
          |> bump_budget(:max_replans, added.max_replans)
          |> bump_budget(:max_provider_calls, added.max_provider_calls)
          |> bump_budget(:max_tool_calls, added.max_tool_calls)

        LogEmit.emit(:agent_run, :steer_budget_granted, :done, %{
          run_id: run.run_id,
          retry_reason: retry_reason,
          reason_codes: reason_codes,
          added: added,
          budget: budget
        })

        {%{run | budget: budget},
         %{retry_reason: retry_reason, reason_codes: reason_codes, added: added, budget: budget}}
    end
  end

  defp maybe_grant_writer_timeout_retry(run, _events), do: {run, nil}

  defp latest_awaiting_reason_codes(events) when is_list(events) do
    case Enum.reverse(events) |> Enum.find(&(&1.event_type == :awaiting_author)) do
      nil -> []
      event -> event.reason_codes || []
    end
  end

  defp retry_grant_reason(reason_codes) when is_list(reason_codes) do
    cond do
      "writer_timeout" in reason_codes -> "writer_timeout"
      "plan_exhausted_without_completion" in reason_codes -> "plan_exhausted_without_completion"
      true -> nil
    end
  end

  defp retry_grant_reason(_reason_codes), do: nil

  defp bump_budget(budget, key, delta) when is_map(budget) do
    Map.update(budget, key, delta, fn
      value when is_integer(value) and value >= 0 -> value + delta
      _ -> delta
    end)
  end

  defp bump_budget(budget, _key, _delta), do: budget

  defp maybe_prepare_awaiting_author_steer(state, true) do
    stage_state =
      state.stage_state
      |> Map.drop([
        :judgment_settled,
        "judgment_settled",
        :judgment_context,
        :pending_artifact_request,
        "pending_artifact_request",
        :pending_artifact_tool,
        "pending_artifact_tool",
        "judgment_context",
        :judgment_input,
        "judgment_input"
      ])

    %{
      state
      | stage_state: stage_state,
        progress_signatures: MapSet.new(),
        final_turn_result: nil
    }
  end

  defp maybe_prepare_awaiting_author_steer(state, false), do: state

  defp maybe_resume_after_steer(state, true) do
    state
    |> put_run_status(:running)
    |> put_run_phase(:executing)
    |> emit(
      :run_resumed,
      "已收到调整，正在按新方向继续。",
      ["steer_requested", "resume_after_steer"]
    )
  end

  defp maybe_resume_after_steer(state, false), do: state

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

    unless state.defer_delivery do
      AgentEventPublisher.publish(event, state.event_sink)
      persist_event(event)
    end

    %{state | event_sequence: sequence, events: state.events ++ [event]}
  end

  defp question_checkpoint(%{run: %{run_mode: :durable, long_run_task_ref: ref}} = state)
       when is_binary(ref),
       do: %{task_ref: ref, attrs: long_run_task_update_attrs(state.run, state)}

  defp question_checkpoint(_state), do: nil

  defp new_event_attrs(before, after_state) do
    after_state.events |> Enum.drop(length(before.events)) |> Enum.map(&event_attrs/1)
  end

  defp publish_committed_events(before, after_state) do
    after_state.events
    |> Enum.drop(length(before.events))
    |> Enum.each(&AgentEventPublisher.publish(&1, after_state.event_sink))

    %{after_state | defer_delivery: false}
  end

  defp run_started_payload(%AgentRun{} = run) do
    %{
      profile_ref: run.profile_ref,
      trigger: run.trigger || %{},
      allowed_tools: Map.get(run.authority_scope, :allowed_tools, []),
      profile_selection:
        Map.get(run.authority_scope, :profile_selection) ||
          Map.get(run.authority_scope, "profile_selection") ||
          %{}
    }
  end

  defp persist_run_state(%{defer_delivery: true} = state), do: state

  defp persist_run_state(%{run: %AgentRun{} = run} = state) do
    TurnInteractionService.record_status(run, state.interaction_store)

    # 运行快照按 GenServer 命令序同步写入，避免旧异步快照覆盖已提交的问题/答复版本。
    persist(fn ->
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

  defp long_run_status_phase(:completed), do: {Status.done(), TaskPhase.completed()}
  defp long_run_status_phase(:cancelled), do: {Status.cancelled(), TaskPhase.cancelled()}
  defp long_run_status_phase(:failed), do: {Status.error(), TaskPhase.failed()}

  defp long_run_status_phase(status) when status in [:paused, :awaiting_author],
    do: {Status.paused(), TaskPhase.checkpoint()}

  defp long_run_status_phase(_status), do: {Status.running(), TaskPhase.running()}

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
      trigger: json_safe(run.trigger),
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

  defp remaining_steps(%AgentRun{} = run), do: AgentRun.remaining_steps(run)

  defp budget_exhausted_outcome(run) do
    plan_steps = plan_steps_from_plan(run.plan)

    if plan_steps == [] do
      {"AgentRun 已达到预算上限。", ["budget_exhausted"]}
    else
      remaining_lines = remaining_step_lines(run, plan_steps)

      summary =
        "AgentRun 预算不足：计划 #{length(plan_steps)} 步，执行预算剩余 #{remaining_steps(run)} 步。" <>
          remaining_steps_section(remaining_lines) <>
          "请选择接下来执行几步，或终止任务。"

      {summary, ["budget_exhausted", "plan_budget_shortfall"]}
    end
  end

  defp remaining_steps_section([]), do: ""

  defp remaining_steps_section(lines) do
    "\n接下来可选步骤：\n" <> Enum.join(lines, "\n") <> "\n"
  end

  defp remaining_step_options(run, plan_steps) do
    start = min(AgentRun.execution_steps(run), length(plan_steps))

    plan_steps
    |> Enum.drop(start)
    |> Enum.map(fn step ->
      %{
        step_ref: plan_step_ref(step),
        description: map_value(step, :description) || plan_step_ref(step)
      }
    end)
  end

  defp remaining_step_lines(run, plan_steps) do
    start = min(AgentRun.execution_steps(run), length(plan_steps))

    plan_steps
    |> Enum.drop(start)
    |> Enum.take(5)
    |> Enum.with_index(1)
    |> Enum.map(fn {step, index} ->
      description =
        map_value(step, :description) || map_value(step, :step_id) ||
          map_value(step, :step_ref) || "下一步"

      "#{index}. #{description}"
    end)
  end

  defp collect_selection_artifact_result(state, turn_result) when is_map(turn_result) do
    pending = get_in(turn_result, [:adoption_state, :pending]) || []

    if selection_scope(state) && pending != [] do
      results = Map.get(state.stage_state, :selection_artifact_results, [])

      %{
        state
        | stage_state:
            Map.put(state.stage_state, :selection_artifact_results, results ++ [turn_result])
      }
    else
      state
    end
  end

  defp collect_selection_artifact_result(state, _turn_result), do: state

  defp selection_scope(state) do
    case Map.get(state.stage_state, :selection_scope) do
      %{remaining_steps: remaining} when is_list(remaining) and remaining != [] ->
        %{remaining_steps: remaining}

      _ ->
        nil
    end
  end

  defp selection_scope_checkpoint?(state, loop_status, turn_result) do
    selection_scope(state) != nil and
      (loop_status == :completed or turn_result_status(turn_result) == "completed")
  end

  defp turn_result_status(result) when is_map(result) do
    result[:status] || result["status"]
  end

  defp turn_result_status(_result), do: nil

  defp settle_selection_checkpoint(state, %{remaining_steps: remaining}) do
    plan = put_plan_steps(state.run.plan, remaining)
    consumed = %{state.run.consumed_budget | execution_steps: 0}

    run = %{
      state.run
      | plan: plan,
        plan_version: state.run.plan_version + 1,
        consumed_budget: consumed
    }

    summary =
      "已执行选中的步骤。\n" <>
        remaining_steps_section(
          remaining_step_lines(
            %{run | consumed_budget: %{consumed | execution_steps: 0}},
            remaining
          )
        )

    turn_result = budget_shortfall_turn_result(%{run | status: :awaiting_author}, summary)
    artifact_results = Map.get(state.stage_state, :selection_artifact_results, [])
    turn_result = merge_checkpoint_artifacts(turn_result, artifact_results, run.parent_turn_ref)

    _ =
      TurnInteractionService.record_result(
        %{run | status: :awaiting_author},
        turn_result,
        state.interaction_store
      )

    state =
      %{
        state
        | run: run,
          stage_state:
            state.stage_state
            |> Map.delete(:selection_scope)
            |> Map.delete(:selection_artifact_results)
            |> Map.put(:scope_checkpoint, true)
            |> Map.put(:agent_plan_cursor, 0),
          final_turn_result: turn_result
      }
      |> put_run_status(:awaiting_author)
      |> put_run_phase(:stopped)
      |> emit(:awaiting_author, summary, ["scope_checkpoint", "plan_budget_shortfall"], [], %{
        turn_result: turn_result
      })

    state
  end

  defp merge_checkpoint_artifacts(turn_result, [], _parent_turn_ref), do: turn_result

  defp merge_checkpoint_artifacts(turn_result, artifact_results, parent_turn_ref) do
    pending =
      Enum.flat_map(artifact_results, fn result ->
        get_in(result, [:adoption_state, :pending]) || []
      end)

    cards = Enum.flat_map(artifact_results, fn result -> Map.get(result, :ui_cards, []) end)

    actions =
      artifact_results
      |> Enum.flat_map(fn result -> Map.get(result, :available_actions, []) end)
      |> Enum.filter(&(Map.get(&1, :action_type) in ["accept", "discard", "edit_then_accept"]))
      |> Enum.map(fn action ->
        action
        |> Map.put(:source_turn_ref, parent_turn_ref)
        |> Map.put(
          :idempotency_key,
          "idem:#{parent_turn_ref}:#{Map.get(action, :action_type)}:#{Map.get(action, :target_ref)}"
        )
      end)

    message =
      if pending == [] do
        turn_result.assistant_message.text
      else
        turn_result.assistant_message.text <> "\n选中步骤已生成待采纳草稿，请审阅。"
      end

    turn_result
    |> Map.put(:assistant_message, %{text: message})
    |> Map.put(:ui_cards, turn_result.ui_cards ++ cards)
    |> Map.put(:adoption_state, %{pending: pending, resolved: []})
    |> Map.update(:available_actions, actions, fn existing ->
      (existing ++ actions) |> Enum.uniq_by(& &1.action_id)
    end)
  end

  # S7（ADR-0024）：预算缺口不是「run 停了但没有下文」。同一 await 事件携带
  # 作者决策面 TurnResult；动作只做显式预算授权，不自动扩预算，不绕过绝对硬上限。
  defp settle_budget_shortfall(state, summary, reason_codes) do
    turn_result = budget_shortfall_turn_result(state.run, summary)

    _ =
      TurnInteractionService.record_result(
        %{state.run | status: :awaiting_author},
        turn_result,
        state.interaction_store
      )

    state
    |> put_run_status(:awaiting_author)
    |> put_run_phase(:stopped)
    |> maybe_store_final_turn_result(turn_result)
    |> emit(:awaiting_author, summary, reason_codes, [], %{turn_result: turn_result})
  end

  defp budget_shortfall_turn_result(%AgentRun{} = run, summary) do
    plan_steps = plan_steps_from_plan(run.plan)

    %{
      schema_version: "3.0-draft",
      turn_id: run.parent_turn_ref,
      assistant_message: %{text: summary},
      ui_cards: [],
      phase: "awaiting_author",
      status: "awaiting_author",
      next_action: "author_budget_recovery",
      plan_step_selection: remaining_step_options(run, plan_steps),
      available_actions: budget_recovery_actions(run, plan_steps),
      trace_summary: %{
        decision_type: :plan_budget_shortfall,
        plan_step_count: length(plan_steps),
        remaining_steps: remaining_steps(run)
      },
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false
      },
      agent_run: %{
        run_id: run.run_id,
        run_mode: run.run_mode,
        status: :awaiting_author,
        phase: :stopped,
        parent_turn_ref: run.parent_turn_ref,
        profile_ref: run.profile_ref,
        trigger: run.trigger,
        long_run_task_ref: run.long_run_task_ref
      }
    }
  end

  defp budget_recovery_actions(run, plan_steps) do
    pending = max(length(plan_steps) - AgentRun.execution_steps(run), 0)

    selection_actions = if pending > 1, do: [budget_selection_action(run)], else: []

    expansion_actions =
      pending
      |> budget_modes()
      |> Enum.uniq()
      |> Enum.flat_map(&authorized_recovery_action(run, plan_steps, &1))

    selection_actions ++ expansion_actions
  end

  # 显式整数分档（不用 min/range 推导），否则 dialyzer 会把 modes 元素类型收窄成
  # 仅 atom，误判 tuple 模式分支不可达；分档口径与 §agentRunBudget 动作契约一致。
  defp budget_modes(pending) do
    [:next_step] ++
      Enum.map(steps_count_modes(pending), &{:steps, &1}) ++
      Enum.map(single_step_count_modes(pending), &{:single_step, &1}) ++
      if(pending > 1, do: [:remaining_plan], else: [])
  end

  defp steps_count_modes(pending) do
    cond do
      pending > 3 -> [2, 3]
      pending == 3 -> [2]
      true -> []
    end
  end

  defp single_step_count_modes(pending) do
    cond do
      pending > 2 -> [2, 3]
      pending > 1 -> [2]
      true -> []
    end
  end

  defp authorized_recovery_action(run, plan_steps, mode) do
    case AgentRunBudget.authorized_expand(run.budget, run.consumed_budget, plan_steps, mode) do
      {:ok, _budget} -> [budget_recovery_action(run, mode)]
      {:error, _reason} -> []
    end
  end

  defp budget_selection_action(run) do
    %{
      action_id: "agent_run_budget_selected_steps:#{run.run_id}:#{run.consumed_budget.steps}",
      action_type: "agent_run_budget_selected_steps",
      label_key: "agentRunBudget.selected_steps",
      source_turn_ref: run.parent_turn_ref,
      target_ref: run.run_id,
      enabled: true,
      idempotency_key:
        "idem:#{run.parent_turn_ref}:agent_run_budget_selected_steps:#{run.run_id}:#{run.consumed_budget.steps}",
      trace_ref: "decision_trace:#{run.parent_turn_ref}"
    }
  end

  defp budget_recovery_action(run, mode) do
    {suffix, label_key} = recovery_action_names(mode)
    key = "agent_run_budget_#{suffix}"

    %{
      action_id: "#{key}:#{run.run_id}:#{run.consumed_budget.steps}",
      action_type: key,
      label_key: label_key,
      source_turn_ref: run.parent_turn_ref,
      target_ref: run.run_id,
      enabled: true,
      idempotency_key:
        "idem:#{run.parent_turn_ref}:#{key}:#{run.run_id}:#{run.consumed_budget.steps}",
      trace_ref: "decision_trace:#{run.parent_turn_ref}"
    }
  end

  defp selected_steps_recovery(state, refs) when is_list(refs) do
    plan_steps = plan_steps_from_plan(state.run.plan)
    execution = AgentRun.execution_steps(state.run)
    remaining = Enum.drop(plan_steps, execution)
    wanted = MapSet.new(Enum.map(refs, &to_string/1))
    selected = Enum.filter(remaining, &MapSet.member?(wanted, plan_step_ref(&1)))

    selected_refs = MapSet.new(Enum.map(selected, &plan_step_ref/1))

    if selected == [] or MapSet.size(wanted) != MapSet.size(selected_refs) do
      {:reply, {:error, :step_selection_invalid}, state}
    else
      selected = expand_selected_steps(remaining, selected)
      remaining_steps = remaining_steps_after(remaining, selected)

      apply_selection_recovery(
        state,
        selected,
        remaining_steps,
        "selected_steps",
        length(selected)
      )
    end
  end

  defp expand_selected_steps(plan_steps, selected) do
    wanted = MapSet.new(selected, &plan_step_ref/1)
    expanded = expand_dependencies(plan_steps, wanted)

    plan_steps
    |> Enum.filter(&MapSet.member?(expanded, plan_step_ref(&1)))
  end

  defp remaining_steps_after(plan_steps, selected_steps) do
    selected = MapSet.new(selected_steps, &plan_step_ref/1)
    Enum.reject(plan_steps, &MapSet.member?(selected, plan_step_ref(&1)))
  end

  defp apply_selection_recovery(state, selected_steps, remaining_steps, mode, step_count) do
    plan = put_plan_steps(state.run.plan, selected_steps)
    consumed = %{state.run.consumed_budget | execution_steps: 0}

    case AgentRunBudget.authorized_expand(
           state.run.budget,
           consumed,
           selected_steps,
           :remaining_plan
         ) do
      {:error, reason} ->
        {:reply, {:error, reason}, state}

      {:ok, budget} ->
        state =
          %{
            state
            | run: %{
                state.run
                | plan: plan,
                  plan_version: state.run.plan_version + 1,
                  budget: budget,
                  consumed_budget: consumed
              },
              stage_state:
                state.stage_state
                |> Map.put(:agent_plan_cursor, 0)
                |> Map.put(:scope_checkpoint, false)
                |> Map.put(:selection_scope, %{remaining_steps: remaining_steps}),
              final_turn_result: nil
          }
          |> clear_interrupt()
          |> put_run_status(:running)
          |> put_run_phase(:executing)
          |> emit(
            :budget_expanded,
            "已按你的授权执行选中的 #{step_count} 个步骤。",
            ["author_budget_expanded", mode],
            [],
            %{budget: budget, mode: mode, step_count: step_count}
          )
          |> persist_run_state()

        {:reply,
         {:ok,
          %{
            run_id: state.run.run_id,
            mode: mode,
            step_count: step_count,
            status: "running",
            budget: budget
          }}, state, {:continue, :run_next_step}}
    end
  end

  defp single_step_recovery(state, index) do
    plan_steps = plan_steps_from_plan(state.run.plan)
    execution = AgentRun.execution_steps(state.run)
    start = execution + index - 1

    with step when is_map(step) <- Enum.at(plan_steps, start),
         selected <- selected_step_with_dependencies(plan_steps, step),
         true <- selected != [] do
      selected_ids = MapSet.new(selected, &plan_step_ref/1)
      remaining_scope = Enum.drop(plan_steps, execution)

      selected_steps =
        Enum.filter(remaining_scope, &MapSet.member?(selected_ids, plan_step_ref(&1)))

      remaining_steps = remaining_steps_after(remaining_scope, selected_steps)
      plan = put_plan_steps(state.run.plan, selected_steps)

      consumed = %{state.run.consumed_budget | execution_steps: 0}

      case AgentRunBudget.authorized_expand(
             state.run.budget,
             consumed,
             selected_steps,
             :remaining_plan
           ) do
        {:error, reason} ->
          {:reply, {:error, reason}, state}

        {:ok, budget} ->
          state =
            %{
              state
              | run: %{
                  state.run
                  | plan: plan,
                    plan_version: state.run.plan_version + 1,
                    budget: budget,
                    consumed_budget: consumed
                },
                stage_state:
                  state.stage_state
                  |> Map.put(:agent_plan_cursor, 0)
                  |> Map.put(:selection_scope, %{remaining_steps: remaining_steps}),
                final_turn_result: nil
            }
            |> clear_interrupt()
            |> put_run_status(:running)
            |> put_run_phase(:executing)
            |> emit(
              :budget_expanded,
              "已按你的授权只执行第 #{index} 步。",
              ["author_budget_expanded", "single_step", "step_index_#{index}"],
              [],
              %{budget: budget, mode: "single_step", step_count: length(selected_steps)}
            )
            |> persist_run_state()

          {:reply,
           {:ok,
            %{
              run_id: state.run.run_id,
              mode: "single_step",
              step_count: length(selected_steps),
              status: "running",
              budget: budget
            }}, state, {:continue, :run_next_step}}
      end
    else
      _ -> {:reply, {:error, :step_index_out_of_range}, state}
    end
  end

  defp selected_step_with_dependencies(plan_steps, step) do
    wanted = MapSet.new([plan_step_ref(step)])

    expand_dependencies(plan_steps, wanted)
    |> Enum.map(fn ref -> Enum.find(plan_steps, &(plan_step_ref(&1) == ref)) end)
    |> Enum.reject(&is_nil/1)
  end

  defp expand_dependencies(plan_steps, wanted) do
    next =
      plan_steps
      |> Enum.filter(&MapSet.member?(wanted, plan_step_ref(&1)))
      |> Enum.flat_map(fn step -> List.wrap(map_value(step, :depends_on)) end)
      |> Enum.map(&to_string/1)
      |> Enum.reject(&(&1 == ""))

    expanded = Enum.reduce(next, wanted, &MapSet.put(&2, &1))

    if MapSet.size(expanded) == MapSet.size(wanted),
      do: expanded,
      else: expand_dependencies(plan_steps, expanded)
  end

  defp put_plan_steps(plan, steps) when is_map(plan), do: Map.put(plan, :steps, steps)

  defp recovery_action_names(:next_step), do: {"next_step", "agentRunBudget.next_step"}

  defp recovery_action_names(:remaining_plan),
    do: {"remaining_plan", "agentRunBudget.remaining_plan"}

  defp recovery_action_names({:steps, count}) do
    {"next_steps_#{count}", "agentRunBudget.next_steps"}
  end

  defp recovery_action_names({:single_step, count}) do
    {"single_step_#{count}", "agentRunBudget.single_step"}
  end

  defp recovery_step_count({:steps, count}), do: count
  defp recovery_step_count({:single_step, _count}), do: 1
  defp recovery_step_count(:next_step), do: 1
  defp recovery_step_count(:remaining_plan), do: nil

  defp recovery_mode_label({:steps, count}), do: "steps:#{count}"
  defp recovery_mode_label({:single_step, count}), do: "single_step:#{count}"
  defp recovery_mode_label(mode), do: Atom.to_string(mode)

  defp recovery_mode_payload({:steps, count}), do: %{mode: "steps", step_count: count}
  defp recovery_mode_payload({:single_step, _count}), do: %{mode: "single_step", step_count: 1}
  defp recovery_mode_payload(mode), do: %{mode: Atom.to_string(mode)}

  defp recovery_mode_reason_codes({:steps, count}), do: ["steps", "step_count_#{count}"]

  defp recovery_mode_reason_codes({:single_step, count}),
    do: ["single_step", "step_index_#{count}"]

  defp recovery_mode_reason_codes(mode), do: [Atom.to_string(mode)]

  defp budget_expanded_summary(:next_step), do: "已按你的授权再执行一步。"
  defp budget_expanded_summary(:remaining_plan), do: "已按你的授权执行当前计划的剩余步骤。"

  defp budget_expanded_summary({:steps, count}),
    do: "已按你的授权执行接下来 #{count} 步。"

  defp budget_expanded_summary({:single_step, count}),
    do: "已按你的授权只执行第 #{count} 步。"

  defp author_limits_for_run(%AgentRun{} = run) do
    cond do
      budget_author_override?(run.budget) ->
        %{}

      steps = budget_value(run.budget, :author_max_steps, nil) ->
        if is_integer(steps) and steps > 0, do: %{max_steps: steps}, else: %{}

      true ->
        %{}
    end
  end

  defp budget_author_override?(budget) when is_map(budget) do
    Map.get(budget, :author_budget_override) == true or
      Map.get(budget, "author_budget_override") == true
  end

  defp budget_author_override?(_budget), do: false

  defp scope_checkpoint?(state), do: Map.get(state.stage_state, :scope_checkpoint) == true

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
     |> maybe_attach_replan(decision)
     |> Map.merge(Map.take(meta, [:turn_result, :decision_trace]))}
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
        target_chapter_ref: map_value(step, :target_chapter_ref),
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

  defp active_plan_step_index(%AgentRun{} = run, plan_steps, :plan_drafted) do
    min(AgentRun.execution_steps(run), length(plan_steps) - 1)
  end

  defp active_plan_step_index(%AgentRun{} = run, plan_steps, _stage) do
    min(max(AgentRun.execution_steps(run) - 1, 0), length(plan_steps) - 1)
  end

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
    :mission_derived,
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
