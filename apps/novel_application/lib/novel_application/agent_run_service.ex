defmodule NovelApplication.AgentRunService do
  @moduledoc """
  Public application entrypoint for bounded AgentRun runtime.
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelApplication.AgentEventPublisher
  alias NovelApplication.AgentRunPersistence
  alias NovelApplication.AgentRunServer
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.TurnInteractionService
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentRun
  alias NovelFoundation.Enums.{Status, TaskPhase}
  alias NovelPersistence.{AgentRunLog, InteractionLifecycle, LongRunTaskLog}

  @runtime_lost_failure_ref "runtime_lost_on_restart"
  @terminal_run_statuses ["completed", "cancelled", "failed"]

  @type step_fun :: AgentRunServer.step_fun()
  @type next_step_planner :: AgentRunServer.next_step_planner()

  @spec start_bounded(map(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def start_bounded(attrs, opts \\ []) when is_map(attrs) do
    attrs =
      attrs
      |> Map.put(:run_mode, :bounded)
      |> Map.put_new(:status, :running)
      |> Map.put_new(:phase, :executing)

    start_requested_run(attrs, opts)
  end

  @spec start_durable(map(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def start_durable(attrs, opts \\ []) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> put_durable_fact_scope()
    |> Map.put(:run_mode, :durable)
    |> Map.put_new(:long_run_task_ref, Ecto.UUID.generate())
    |> Map.put_new(:status, :running)
    |> Map.put_new(:phase, :executing)
    |> start_requested_run(opts)
  end

  @doc """
  作者动作新 run 的唯一启动入口：receipt + run + run_started 由 Server init
  原子受理；duplicate 映射回原 run，不把重复当启动失败更新原 run。
  """
  @spec start_author_action(map(), keyword(), map()) ::
          {:ok, %{run_id: String.t(), receipt: map(), duplicate?: boolean()}}
          | {:error, term()}
  def start_author_action(attrs, opts, admission)
      when is_map(attrs) and is_map(admission) do
    attrs =
      attrs
      |> atomize_known()
      |> Map.put(:run_mode, :bounded)
      |> Map.put_new(:status, :running)
      |> Map.put_new(:phase, :executing)

    with {:ok, planner} <- next_step_planner(opts),
         {:ok, run} <- AgentRun.new(attrs) do
      start_admitted_run(run, planner, opts, admission)
    end
  end

  defp start_admitted_run(run, planner, opts, admission) do
    store = Keyword.get(opts, :interaction_store) || TurnInteractionService.store()

    case DynamicSupervisor.start_child(
           NovelApplication.AgentRunSupervisor,
           {AgentRunServer,
            [
              run: run,
              next_step_planner: planner,
              interaction_store: store,
              author_action_admission: admission
            ]}
         ) do
      {:ok, pid} ->
        receipt = AgentRunServer.author_action_receipt(pid)
        {:ok, %{run_id: run.run_id, receipt: receipt, duplicate?: false}}

      {:error, {:author_action_duplicate, receipt}} ->
        reuse_admitted_run(receipt)

      {:error, {:author_action_conflict, _receipt}} ->
        {:error, :idempotency_payload_conflict}

      {:error, {:author_action_admission_failed, reason}} ->
        {:error, reason}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  启动已在受理事务中提交 receipt/初始 run/作者决定结果的 child owner。

  不再次 admit、不重新生成初始事件；提交后的 child 只接管自己的执行状态。
  启动事实（run/events/event_sequence/stage_state）由受理事务原样交给 owner。
  """
  @spec start_committed_author_action(map(), keyword(), struct()) ::
          {:ok, pid()} | {:error, term()}
  def start_committed_author_action(%{run: %AgentRun{}} = startup, opts, receipt) do
    store = Keyword.get(opts, :interaction_store) || TurnInteractionService.store()

    DynamicSupervisor.start_child(
      NovelApplication.AgentRunSupervisor,
      {AgentRunServer,
       [
         run: startup.run,
         next_step_planner: Keyword.get(opts, :next_step_planner),
         interaction_store: store,
         author_action_admission: {:committed, receipt, startup}
       ]}
    )
  end

  defp reuse_admitted_run(receipt) do
    case receipt_run_id(receipt) do
      run_id when is_binary(run_id) and run_id != "" ->
        {:ok, %{run_id: run_id, receipt: receipt, duplicate?: true}}

      _missing ->
        {:error, :receipt_run_missing}
    end
  end

  defp receipt_run_id(receipt) do
    case receipt.result || %{} do
      %{"run_id" => run_id} -> run_id
      %{run_id: run_id} -> run_id
      _ -> nil
    end
  end

  defp start_requested_run(attrs, opts) do
    # 同一输入的接收与启动不可被另一 Channel 的重传穿插。
    lock =
      {{__MODULE__, attrs[:workspace_id], attrs[:session_id], attrs[:parent_turn_ref]}, self()}

    case :global.trans(lock, fn -> receive_and_start_run(attrs, opts) end) do
      :aborted -> {:error, :message_start_unavailable}
      result -> result
    end
  end

  defp receive_and_start_run(attrs, opts) do
    store = Keyword.get(opts, :interaction_store) || TurnInteractionService.store()

    with {:ok, planner} <- next_step_planner(opts),
         {:ok, run} <- AgentRun.new(attrs),
         {:ok, receipt} <-
           TurnInteractionService.receive_input(
             run,
             store,
             Keyword.get(opts, :interaction_input, %{})
           ) do
      if receipt.duplicate? do
        reuse_received_run(receipt)
      else
        start_received_run(run, attrs, planner, store)
      end
    end
  end

  defp reuse_received_run(receipt), do: {:ok, receipt.run_id}

  defp start_received_run(run, attrs, planner, store) do
    with {:ok, run} <- attach_durable_task(run, attrs),
         {:ok, _pid} <-
           DynamicSupervisor.start_child(
             NovelApplication.AgentRunSupervisor,
             {AgentRunServer,
              [
                run: run,
                next_step_planner: planner,
                interaction_store: store
              ]}
           ) do
      {:ok, run.run_id}
    else
      {:error, {:already_started, _pid}} ->
        {:ok, run.run_id}

      {:error, reason} ->
        TurnInteractionService.record_status(%{run | status: :failed}, store)
        {:error, reason}
    end
  end

  defp attach_durable_task(%{run_mode: :durable} = run, attrs) do
    case LongRunTaskLog.create_with_id(run.long_run_task_ref, long_run_task_attrs(attrs)) do
      {:ok, task} -> {:ok, %{run | long_run_task_ref: task.id}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp attach_durable_task(run, _attrs), do: {:ok, run}

  @spec recover_durable(String.t(), String.t(), keyword()) :: {:ok, [map()]}
  def recover_durable(work_id, session_id, opts \\ [])
      when is_binary(work_id) and is_binary(session_id) do
    recover_opts =
      opts
      |> Map.new()
      |> Map.put(:requested_work_id, work_id)
      |> Map.put(:requested_session_id, session_id)

    recovered =
      work_id
      |> active_durable_records(session_id)
      |> stable_record_sort()
      |> Enum.map(&recover_record(&1, recover_opts))
      |> Enum.reject(&is_nil/1)

    {:ok, recovered}
  end

  @doc """
  Returns still-live bounded runs for a newly joined Channel without restarting
  their planner/provider work.

  The live supervisor is the liveness authority, so a refresh cannot race an
  asynchronous persistence write. A stale non-terminal database record is
  never reconstructed because bounded runs have no checkpoint replay contract.
  """
  @spec reconnect_bounded(String.t(), String.t()) :: {:ok, [map()]}
  def reconnect_bounded(work_id, session_id)
      when is_binary(work_id) and is_binary(session_id) do
    states =
      NovelApplication.AgentRunSupervisor
      |> DynamicSupervisor.which_children()
      |> Enum.flat_map(fn
        {_id, pid, :worker, _modules} ->
          reconnect_live_bounded(pid, work_id, session_id)

        _child ->
          []
      end)
      |> Enum.sort_by(fn %{run: run} -> stable_run_sort_key(run.run_id) end)

    {:ok, states}
  rescue
    _error -> {:ok, []}
  catch
    _kind, _reason -> {:ok, []}
  end

  defp reconnect_live_bounded(pid, work_id, session_id) when is_pid(pid) do
    case AgentRunServer.state(pid) do
      %{
        run: %{
          run_mode: :bounded,
          work_id: ^work_id,
          session_id: ^session_id,
          status: status
        }
      } = state
      when status not in [:completed, :cancelled, :failed] ->
        [
          state
          |> Map.put(:recovered?, true)
          |> Map.put(:runtime_live?, true)
        ]

      _state ->
        []
    end
  catch
    :exit, _reason -> []
  end

  # B31 CP1 Q04：JoinRestore/reconnect 广播顺序确定化（created_at + run_id）。
  # 前端不依赖该序；此序仅保证重连/刷新证据与 UI 稳定可复现。
  defp stable_record_sort(records) do
    Enum.sort_by(records, fn record ->
      {record.inserted_at || ~U[1970-01-01 00:00:00Z], record.id}
    end)
  end

  defp stable_run_sort_key(run_id) do
    case AgentRunLog.get_run(run_id) do
      %{inserted_at: %DateTime{} = inserted} -> {inserted, run_id}
      _ -> {~U[1970-01-01 00:00:00Z], run_id}
    end
  end

  defp active_durable_records(work_id, session_id) do
    case AgentRunLog.list_active_durable(work_id, session_id) do
      [] -> AgentRunLog.list_active_durable_by_work(work_id)
      records -> records
    end
  end

  @doc """
  B23 CP4：首次 join 的惰性死 run 收口。持久层仍是非终态、但 runtime Registry
  已无进程的 bounded run，在同一 run 上一次性收口为 `failed`
  （`failure_ref = "runtime_lost_on_restart"`），保留历史记录可查；本次 join 仍
  返回失效快照（`runtime_live: false`、收口后状态），channel 据此诚实广播一次。
  bounded 无 checkpoint replay 契约，不重建进程。

  第二次 join 时该 run 已是终态，不再命中、不再广播。durable run 不在
  `AgentRunLog.list_active_bounded/2` 的查询范围内，恢复路径零改动。
  """
  @spec list_dead_bounded(String.t(), String.t()) :: {:ok, [map()]} | {:error, atom()}
  def list_dead_bounded(work_id, session_id)
      when is_binary(work_id) and is_binary(session_id) do
    outcomes =
      work_id
      |> AgentRunLog.list_active_bounded(session_id)
      |> stable_record_sort()
      |> Enum.map(&reap_dead_bounded/1)

    case Enum.find(outcomes, &match?({:error, _}, &1)) do
      {:error, reason} ->
        {:error, reason}

      nil ->
        states =
          Enum.flat_map(outcomes, fn
            {:ok, state} -> [state]
            :skip -> []
          end)

        {:ok, states}
    end
  rescue
    _error -> {:error, :runtime_lost_unavailable}
  catch
    _kind, _reason -> {:error, :runtime_lost_unavailable}
  end

  # 条件更新保证并发 join 至多一方收口成功：成功方产生失效快照与留痕，
  # 其余方看到 :already_terminal 后不再重复广播。写入失败或记录消失必须让
  # 调用方看到错误，不能把旧的非终态记录当成收口结果广播。
  defp reap_dead_bounded(record) do
    with {:error, :not_found} <- lookup(record.id),
         {:closed, closed_record} <- close_lost_bounded(record),
         {:ok, run} <- run_from_record(closed_record) do
      {:ok,
       %{
         run: run,
         remaining_steps: 0,
         current_task?: false,
         recovered?: false,
         runtime_live?: false
       }}
    else
      {:already_terminal, _record} -> :skip
      {:error, reason} -> {:error, reason}
      _other -> :skip
    end
  end

  # 单一 bounded runtime-lost 收口入口：join 与回执事实读取共用。只有条件更新
  # 真正把非终态 bounded run 置为 failed 的一方负责留痕，避免重复事件。
  defp close_lost_bounded(%{run_mode: "bounded", status: status} = record)
       when status in @terminal_run_statuses,
       do: {:already_terminal, record}

  defp close_lost_bounded(%{run_mode: "bounded"} = record) do
    case AgentRunLog.mark_runtime_lost(record.id, @runtime_lost_failure_ref) do
      {:ok, closed_record} ->
        emit_runtime_lost_trace(closed_record, record.status)
        {:closed, closed_record}

      {:error, :already_terminal} ->
        current_terminal_record(record.id)

      {:error, :not_found} ->
        {:error, :runtime_lost_missing}

      {:error, :write_failed} ->
        {:error, :runtime_lost_write_failed}
    end
  end

  defp close_lost_bounded(record), do: {:unchanged, record}

  # 只有持久层确认已是合法终态时才读取当前记录；记录消失按缺失处理，读取失败
  # 按写入失败处理，绝不回退到调用方手里的旧 record。
  defp current_terminal_record(run_id) do
    case safe_get_run(run_id) do
      {:ok, %{status: status} = record} when status in @terminal_run_statuses ->
        {:already_terminal, record}

      {:ok, nil} ->
        {:error, :runtime_lost_missing}

      {:ok, _still_open} ->
        {:error, :runtime_lost_write_failed}

      {:error, _reason} ->
        {:error, :runtime_lost_write_failed}
    end
  end

  defp safe_get_run(run_id) do
    {:ok, AgentRunLog.get_run(run_id)}
  rescue
    _error -> {:error, :runtime_lost_read_failed}
  catch
    _kind, _reason -> {:error, :runtime_lost_read_failed}
  end

  # developer 留痕走既有两条通道（二者都保留）：
  # ① AgentEvent visibility: :developer——持久层可查、进 run 事件序列，但不进作者
  #    活动轨迹（author_visible? == false）；
  # ② LogEmit app JSONL `agent_run.runtime_lost.done`——外部验收/grep 可检索。
  # payload 只放结构事实（run_id / previous_status / failure_ref / run_mode），
  # 不含 provider 原文。
  defp emit_runtime_lost_trace(record, previous_status) do
    payload = %{
      run_id: record.id,
      previous_status: previous_status,
      failure_ref: @runtime_lost_failure_ref,
      run_mode: record.run_mode,
      status: record.status,
      work_id: record.work_id,
      session_id: record.session_id
    }

    sequence = next_event_sequence(record.id)

    with {:ok, event} <-
           AgentEvent.new(%{
             event_id: "evt_#{record.id}_runtime_lost_#{sequence}",
             run_ref: record.id,
             step_ref: record.current_step_ref,
             sequence: sequence,
             event_type: :run_failed,
             visibility: :developer,
             summary: "后端重启后 runtime 已不存在，bounded run 已收口为 failed（历史记录保留可查）。",
             reason_codes: ["runtime_lost_on_restart", "agent_run_runtime_lost"],
             refs: [record.id],
             payload: payload,
             emitted_at: DateTime.utc_now()
           }) do
      _ = AgentRunLog.insert_event(event_attrs(event))
    end

    LogEmit.emit(:agent_run, :runtime_lost, :done, payload)

    :ok
  end

  defp next_event_sequence(run_id) do
    run_id
    |> AgentRunLog.list_events()
    |> Enum.reduce(0, fn event, acc -> max(acc, event.sequence || 0) end)
    |> Kernel.+(1)
  end

  @doc """
  订阅 work/session 的 AgentRun 事件；由 Channel join 调用一次。

  `Registry` 随订阅进程退出自动清理，不在每个 run 上重复 attach。
  """
  @spec subscribe_events(String.t(), String.t() | nil) :: :ok
  def subscribe_events(work_id, session_id)
      when is_binary(work_id) and (is_binary(session_id) or is_nil(session_id)) do
    AgentEventPublisher.subscribe(work_id, session_id)
  end

  @doc "已接受消息优先按原身份核对，不重新要求候选或会话仍可发起新操作。"
  def received_user_run(input) do
    if is_nil(TurnInteractionService.store()) or is_nil(input.session_id),
      do: :new,
      else: InteractionLifecycle.received_user_run(input)
  end

  @doc "用户消息的事实回执；运行不存在时不重建，不把持久的历史状态当成活 runtime。"
  def message_receipt(run_id, work_id, session_id) do
    state = receipt_runtime_state(run_id, work_id, session_id)

    if is_nil(TurnInteractionService.store()) do
      ephemeral_receipt(state)
    else
      with {:ok, input} <- InteractionLifecycle.receipt_input(work_id, session_id, run_id) do
        {:ok,
         %{
           state: state,
           input: input,
           turn_results: InteractionLifecycle.receipt_results(work_id, session_id, run_id)
         }}
      end
    end
  end

  defp ephemeral_receipt(%{run: run} = state) do
    {:ok,
     %{
       state: state,
       input: %{
         turn_id: run.parent_turn_ref,
         content: %{
           "text" => run.goal.text,
           "message_handling" => %{"status" => to_string(run.status)}
         }
       },
       turn_results: []
     }}
  end

  defp ephemeral_receipt(nil), do: {:error, :received_input_not_found}

  @doc "引导输入使用独立投递身份；重复回执不再次推进 goal.version。"
  def steer_submission(%{work_id: work, session_id: session, turn_id: id} = attrs) do
    :global.trans({{__MODULE__, work, session, id}, self()}, fn -> do_steer_submission(attrs) end)
  end

  defp do_steer_submission(
         %{
           work_id: work,
           session_id: session,
           run_id: run_id,
           turn_id: id,
           text: text
         } = attrs
       ) do
    expected = Map.get(attrs, :expected_goal_version)

    with true <- is_binary(text) and String.trim(text) != "",
         :ok <- accept_steer_submission(work, session, run_id, id, text, expected),
         {:ok, receipt} <- message_receipt(run_id, work, session),
         input when not is_nil(input) <- InteractionLifecycle.submission_input(work, session, id) do
      {:ok, Map.put(receipt, :input, input)}
    else
      false -> {:error, :steer_requires_text}
      nil -> {:error, :received_input_not_found}
      {:error, _} = error -> error
    end
  end

  defp accept_steer_submission(work, session, run_id, id, text, expected) do
    case InteractionLifecycle.submission_input(work, session, id) do
      %{content: %{"agent_run_id" => ^run_id, "text" => ^text, "message_kind" => "steer"}} -> :ok
      nil -> dispatch_new_steer_submission(work, session, run_id, id, text, expected)
      _ -> {:error, :input_identity_conflict}
    end
  end

  defp dispatch_new_steer_submission(work, session, run_id, id, text, expected) do
    with {:ok, pid} <- lookup(run_id),
         %{run: %{work_id: ^work, session_id: ^session}} <- AgentRunServer.state(pid),
         {:ok, _} <- AgentRunServer.steer_submission(pid, text, id, expected) do
      :ok
    else
      {:error, _} = error -> error
      _ -> {:error, :run_scope_mismatch}
    end
  end

  defp receipt_runtime_state(run_id, work_id, session_id) do
    case receipt_run_facts(run_id, work_id, session_id) do
      {:ok, state} -> state
      {:error, _reason} -> nil
    end
  end

  @doc """
  回执事实读取边界：用户消息 receipt 与作者动作 receipt 共用同一 run 执行事实，
  不按 receipt 中一次写入的旧 status 冒充当前状态。

  - Registry 有进程且作用域一致：`runtime_live?: true` 的 live 快照；
  - Registry 明确无进程：读取持久 run；只有已确认丢失的 bounded 非终态 run
    才沿用既有 runtime-lost 规则收口为 failed，保留 receipt/history/candidate；
  - Registry/状态读取超时等不确定结果：返回持久快照但 `runtime_live?: nil`，
    不宣布已死；
  - 记录缺失、作用域不匹配、失活写入失败或状态读取失败：返回明确 error，
    调用方失败闭合，不回退为旧 running，也不伪造收口事实。
  """
  @spec receipt_run_facts(String.t(), String.t(), String.t()) ::
          {:ok, map()} | {:error, atom()}
  def receipt_run_facts(run_id, work_id, session_id)
      when is_binary(run_id) and is_binary(work_id) and is_binary(session_id) do
    case state(run_id) do
      {:ok, %{run: %{work_id: ^work_id, session_id: ^session_id}} = live} ->
        {:ok, Map.put(live, :runtime_live?, true)}

      {:ok, %{run: _run}} ->
        {:error, :receipt_run_scope_mismatch}

      {:error, :not_found} ->
        persisted_receipt_facts(run_id, work_id, session_id, false)

      {:error, _uncertain} ->
        persisted_receipt_facts(run_id, work_id, session_id, nil)
    end
  catch
    :exit, _reason -> persisted_receipt_facts(run_id, work_id, session_id, nil)
    _kind, _reason -> {:error, :receipt_run_unavailable}
  end

  def receipt_run_facts(_run_id, _work_id, _session_id),
    do: {:error, :receipt_run_scope_unavailable}

  defp persisted_receipt_facts(run_id, work_id, session_id, runtime_live) do
    case safe_get_run(run_id) do
      {:ok, %{work_id: ^work_id, session_id: ^session_id} = record} ->
        with {:ok, record} <- maybe_close_lost_bounded(record, runtime_live),
             {:ok, run} <- run_from_record(record) do
          {:ok,
           %{
             run: run,
             runtime_live?: runtime_live,
             current_task?: false,
             remaining_steps: 0
           }}
        else
          {:error, reason} -> {:error, receipt_close_error(reason)}
        end

      {:ok, %{work_id: _, session_id: _}} ->
        {:error, :receipt_run_scope_mismatch}

      {:ok, nil} ->
        {:error, :receipt_run_missing}

      {:error, _reason} ->
        {:error, :receipt_run_unavailable}
    end
  end

  defp receipt_close_error(:runtime_lost_missing), do: :receipt_run_missing
  defp receipt_close_error(:runtime_lost_write_failed), do: :receipt_run_write_failed
  defp receipt_close_error(:runtime_lost_read_failed), do: :receipt_run_unavailable
  defp receipt_close_error(_reason), do: :receipt_run_state_unavailable

  # 只有“Registry 已确认无进程”才允许收口；超时/未知结果不宣布已死。
  defp maybe_close_lost_bounded(record, false) do
    case close_lost_bounded(record) do
      {:closed, closed_record} -> {:ok, closed_record}
      {:already_terminal, current_record} -> {:ok, current_record}
      {:unchanged, unchanged_record} -> {:ok, unchanged_record}
      {:error, _reason} = error -> error
    end
  end

  defp maybe_close_lost_bounded(record, _runtime_live), do: {:ok, record}

  @spec pause(String.t()) :: :ok | {:error, :not_found}
  def pause(run_id), do: command(run_id, :pause)

  @doc """
  resume 是同步命令（DS03）：拒绝必须对调用方可见。仅 paused 可原地恢复；
  awaiting_author 返回 :awaiting_author_requires_input，引导非空 steer / 绑定 action。
  """
  @spec resume(String.t()) ::
          :ok
          | {:error,
             :not_found | :awaiting_author_requires_input | :not_resumable | :resume_timeout}
  def resume(run_id) do
    case lookup(run_id) do
      {:ok, pid} -> AgentRunServer.resume(pid)
      error -> error
    end
  catch
    :exit, {:timeout, _call} -> {:error, :resume_timeout}
    :exit, reason -> {:error, {:resume_call_exit, reason}}
  end

  @spec cancel(String.t()) :: :ok | {:error, :not_found}
  def cancel(run_id), do: command(run_id, :cancel)

  @doc """
  作者显式压缩 canonical 会话（VS-00L §16.2/§16.4/§16.16）。

  只表达整理意图：覆盖范围、来源证据、摘要与省略说明由 `TranscriptCompaction`
  从 canonical 事实派生，调用方不能传入或伪造压缩内容。只在没有执行中任务的
  安全点受理；durable/bounded 同一提交边界先持久化、成功后才推进内存。
  回执只含作者可见的整理项数/摘要/省略/来源显示名。

  属于 §16.16 两类入口之一（作者命令）；另一类是应用安全点自动维护。
  """
  @spec compact_transcript(String.t()) :: {:ok, map()} | {:error, term()}
  def compact_transcript(run_id) when is_binary(run_id) do
    case lookup(run_id) do
      {:ok, pid} -> AgentRunServer.compact_transcript(pid)
      error -> error
    end
  catch
    :exit, {:timeout, _call} -> {:error, :compact_timeout}
    :exit, reason -> {:error, {:compact_call_exit, reason}}
  end

  @doc """
  steer 是同步命令（DS03）：空文本拒绝，成功回执携带 run_id / parent_turn_ref /
  goal_version；作者补充在运行状态变更前已由统一入口持久化。
  """
  @spec steer(String.t(), String.t()) ::
          {:ok,
           %{run_id: String.t(), parent_turn_ref: String.t() | nil, goal_version: pos_integer()}}
          | {:error, :not_found | :steer_requires_text | :not_steerable | :steer_timeout}
  def steer(run_id, text) when is_binary(text), do: steer(run_id, text, nil)

  @doc "B31 CP1 Q03：可选 expected_goal_version（nil 保持旧行为）。"
  def steer(run_id, text, expected_goal_version)
      when is_binary(text) and
             (is_integer(expected_goal_version) or is_nil(expected_goal_version)) do
    if String.trim(text) == "" do
      {:error, :steer_requires_text}
    else
      case lookup(run_id) do
        {:ok, pid} -> AgentRunServer.steer(pid, text, expected_goal_version, 5_000)
        error -> error
      end
    end
  catch
    :exit, {:timeout, _call} -> {:error, :steer_timeout}
    :exit, reason -> {:error, {:steer_call_exit, reason}}
  end

  @doc """
  作者显式选择预算恢复动作：只执行下一步，或授权执行剩余计划。
  仅 live、同 work/session、处于 awaiting_author 的 run 可执行；动作本身只扩预算，
  不绕过绝对硬上限，也不自动重规划。
  """
  @spec author_budget_action(
          String.t(),
          String.t(),
          String.t(),
          :next_step | :remaining_plan | {:steps, pos_integer()}
        ) :: {:ok, map()} | {:error, term()}
  def author_budget_action(run_id, work_id, session_id, mode) do
    if valid_recovery_mode?(mode) do
      do_author_budget_action(run_id, work_id, session_id, mode)
    else
      {:error, :invalid_recovery_mode}
    end
  end

  defp do_author_budget_action(run_id, work_id, session_id, mode) do
    case lookup(run_id) do
      {:ok, pid} ->
        case AgentRunServer.state(pid) do
          %{run: %{work_id: ^work_id, session_id: ^session_id}} ->
            AgentRunServer.author_budget_action(pid, mode)

          %{run: _run} ->
            {:error, :run_scope_mismatch}

          _ ->
            {:error, :not_found}
        end

      error ->
        error
    end
  catch
    :exit, {:timeout, _call} -> {:error, :budget_action_timeout}
    :exit, reason -> {:error, {:budget_action_call_exit, reason}}
  end

  defp valid_recovery_mode?(:next_step), do: true
  defp valid_recovery_mode?(:remaining_plan), do: true
  defp valid_recovery_mode?({:steps, count}), do: is_integer(count) and count > 0
  defp valid_recovery_mode?({:single_step, count}), do: is_integer(count) and count > 0
  defp valid_recovery_mode?({:selected_steps, refs}), do: is_list(refs) and refs != []
  defp valid_recovery_mode?(_mode), do: false

  @doc """
  作者已在采纳边界处理了本 run 的某个候选（accept 采纳）——通知 run 观察该作者
  决定（M0 缺陷修复 2026-07-19：单候选改进循环以作者采纳为收束信号，不再对已被
  作者拿走的候选继续改进/产未请求的第二候选）。非 pending 引用为无害 no-op。
  """
  @spec notify_artifact_resolved(String.t(), String.t()) :: :ok | {:error, :not_found}
  def notify_artifact_resolved(run_id, artifact_ref) when is_binary(artifact_ref),
    do: command(run_id, {:artifact_resolved, artifact_ref})

  @spec state(String.t(), timeout()) :: {:ok, map()} | {:error, term()}
  def state(run_id, timeout \\ 5_000) do
    case lookup(run_id) do
      {:ok, pid} ->
        {:ok, AgentRunServer.state(pid, timeout)}

      error ->
        error
    end
  catch
    :exit, {:timeout, _call} -> {:error, :state_timeout}
    :exit, reason -> {:error, {:state_call_exit, reason}}
  end

  defp command(run_id, command) do
    case lookup(run_id) do
      {:ok, pid} ->
        AgentRunServer.command(pid, command)
        :ok

      error ->
        error
    end
  end

  defp next_step_planner(opts) do
    case Keyword.get(opts, :next_step_planner) do
      planner when is_function(planner, 3) -> {:ok, planner}
      _ -> {:error, :next_step_planner_required}
    end
  end

  defp lookup(run_id) when is_binary(run_id) do
    case Registry.lookup(NovelApplication.AgentRunRegistry, run_id) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  defp long_run_task_attrs(attrs) do
    run_id = required(attrs, :run_id)

    %{
      workspace_id: required(attrs, :work_id),
      task_type: "agent_run",
      status: Status.ready(),
      phase: TaskPhase.planned(),
      goal: get_in_goal(attrs, :text) || required(attrs, :run_id),
      scope_ref: required(attrs, :work_id),
      created_by: "agent_run",
      parent_turn_ref: required(attrs, :parent_turn_ref),
      plan_ref: value(attrs, :plan_ref),
      checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
      estimated_budget: value(attrs, :budget) || %{},
      consumed_budget: value(attrs, :consumed_budget) || %{},
      authority_scope: inspect(value(attrs, :authority_scope) || %{}),
      current_unit_ref: nil,
      completed_unit_refs: [],
      pending_artifact_refs: [],
      checkpoint_data: %{
        "agent_run" =>
          Map.merge(
            %{
              "run_id" => run_id,
              "status" => "created",
              "phase" => "planning",
              "goal_version" => get_in_goal(attrs, :version) || 1,
              "completed_step_refs" => [],
              "checkpoint_version" => AgentRunPersistence.checkpoint_version()
            },
            durable_fact_checkpoint_data(attrs)
          ),
        "progress" => 0,
        "step" => "AgentRun 已登记为 durable 长任务"
      }
    }
  end

  defp recover_record(record, opts) do
    with {:ok, run} <- run_from_record(record),
         %{} = task <- LongRunTaskLog.get(run.long_run_task_ref) do
      recover_live_or_checkpoint(record, run, task, opts)
    else
      _ -> nil
    end
  end

  defp recover_live_or_checkpoint(record, run, task, opts) do
    case live_state(run.run_id) do
      {:ok, state} ->
        recover_live_state(record, state, task, opts)

      {:error, :not_found} ->
        recover_checkpoint_state(record, run, task, opts)
    end
  end

  defp recover_live_state(record, %{run: run} = state, task, opts) do
    stale_reason = stale_recovery_reason(record, task, Map.put(opts, :runtime_live?, true))

    {run, task, stale?} =
      if is_binary(stale_reason) do
        {run, task} = mark_stale_recovery(run, task, stale_reason)
        {run, task, true}
      else
        {run, task, false}
      end

    event = recovery_event(run, task, stale?: stale?, runtime_live?: true)

    state
    |> Map.put(:run, run)
    |> Map.put(:recovered?, true)
    |> Map.put(:runtime_live?, true)
    |> Map.put(:long_run_task, task)
    |> Map.put(:recovery_event, event)
  end

  defp recover_checkpoint_state(record, run, task, opts) do
    stale_reason = stale_recovery_reason(record, task, Map.put(opts, :runtime_live?, false))
    {run, task} = maybe_mark_checkpoint_recovery_stale(run, task, stale_reason)
    event = recovery_event(run, task, stale?: is_binary(stale_reason), runtime_live?: false)

    %{
      run: run,
      remaining_steps: 0,
      current_task?: false,
      recovered?: true,
      runtime_live?: false,
      long_run_task: task,
      recovery_event: event,
      authoring_transcript: nil,
      authoring_history: %{status: :missing}
    }
    |> restore_authoring_transcript(record, task)
  end

  defp restore_authoring_transcript(recovered, record, task) do
    case AuthoringCheckpoint.restore(record, task.checkpoint_data || %{}) do
      {:ok, nil, :none} ->
        Map.put(recovered, :authoring_history, %{status: :missing})

      {:ok, transcript, source} ->
        recovered
        |> Map.put(:authoring_transcript, transcript)
        |> Map.put(:stage_state, %{judgment_transcript: transcript})
        |> Map.put(:authoring_history, %{
          status: :available,
          source: source,
          format_version: AuthoringCheckpoint.format_version()
        })

      {:partial, reason} ->
        recovered
        |> Map.put(:authoring_transcript_error, reason)
        |> Map.put(:authoring_history, %{status: :partial, reason: reason})

      {:error, reason} ->
        recovered
        |> Map.put(:authoring_transcript_error, reason)
        |> Map.put(:authoring_history, %{status: :invalid, reason: reason})
    end
  end

  defp run_from_record(record) do
    AgentRun.new(%{
      run_id: record.id,
      run_mode: record.run_mode,
      workspace_id: record.workspace_id,
      work_id: record.work_id,
      session_id: record.session_id,
      parent_turn_ref: record.parent_turn_ref,
      origin_frame_ref: record.origin_frame_ref,
      profile_ref: record.profile_ref,
      trigger: record.trigger,
      goal: record.goal,
      status: record.status,
      phase: record.phase,
      plan: record.plan,
      plan_ref: record.plan_ref,
      plan_version: record.plan_version,
      current_step_ref: record.current_step_ref,
      completed_step_refs: record.completed_step_refs || [],
      authority_scope: record.authority_scope || %{},
      policy: record.run_policy || %{},
      budget: record.budget || %{},
      consumed_budget: record.consumed_budget || %{},
      interrupt_state: record.interrupt_state || %{},
      pending_artifact_refs: record.pending_artifact_refs || [],
      active_behavior_ref: record.active_behavior_ref,
      long_run_task_ref: record.long_run_task_ref,
      failure_ref: record.failure_ref
    })
  end

  defp stale_recovery_reason(record, task, opts) do
    forced = Map.get(opts, :force_stale, false)
    runtime_live? = Map.get(opts, :runtime_live?, false)
    ref_reason = stale_ref_mismatch_reason(record, opts)
    checkpoint_reason = stale_checkpoint_version_reason(task)
    fact_reason = stale_fact_revision_reason(task, opts)
    version_reason = stale_version_mismatch_reason(record, task, opts)

    cond do
      forced ->
        "forced_stale_recovery"

      is_binary(ref_reason) ->
        ref_reason

      is_binary(checkpoint_reason) ->
        checkpoint_reason

      is_binary(fact_reason) ->
        fact_reason

      is_binary(version_reason) ->
        version_reason

      not runtime_live? ->
        "durable_runtime_not_live"

      true ->
        nil
    end
  end

  defp stale_ref_mismatch_reason(record, opts) do
    cond do
      ref_mismatch?(Map.get(opts, :requested_work_id), record.work_id) ->
        "work_ref_mismatch"

      ref_mismatch?(Map.get(opts, :requested_session_id), record.session_id) ->
        "session_ref_mismatch"

      true ->
        nil
    end
  end

  defp stale_checkpoint_version_reason(task) do
    task_run = task.checkpoint_data && task.checkpoint_data["agent_run"]

    case task_run && task_run["checkpoint_version"] do
      version when version in [2, 3] -> nil
      nil -> "checkpoint_version_missing"
      _other -> "checkpoint_version_mismatch"
    end
  end

  defp stale_fact_revision_reason(task, opts) do
    task_run = (task.checkpoint_data && task.checkpoint_data["agent_run"]) || %{}

    cond do
      version_mismatch?(Map.get(opts, :work_revision), Map.get(task_run, "work_revision")) ->
        "work_revision_mismatch"

      version_mismatch?(Map.get(opts, :target_revision), Map.get(task_run, "target_revision")) ->
        "target_revision_mismatch"

      target_ref_missing?(Map.get(task_run, "target_revision_ref"), opts) ->
        "target_ref_missing"

      true ->
        nil
    end
  end

  defp stale_version_mismatch_reason(record, task, opts) do
    record_goal_version = record_goal_version(record)
    task_run = task.checkpoint_data && task.checkpoint_data["agent_run"]

    cond do
      version_mismatch?(Map.get(opts, :goal_version), record_goal_version) ->
        "goal_version_mismatch"

      version_mismatch?(task_run && task_run["goal_version"], record_goal_version) ->
        "checkpoint_goal_version_mismatch"

      true ->
        nil
    end
  end

  defp maybe_mark_checkpoint_recovery_stale(run, task, stale_reason) when is_binary(stale_reason),
    do: mark_stale_recovery(run, task, stale_reason)

  defp maybe_mark_checkpoint_recovery_stale(run, task, _stale_reason), do: {run, task}

  defp mark_stale_recovery(run, task, failure_ref) do
    run = %{run | status: :awaiting_author, phase: :stopped}

    {:ok, _record} =
      AgentRunLog.upsert_run(%{
        id: run.run_id,
        workspace_id: run.workspace_id,
        work_id: run.work_id,
        session_id: run.session_id,
        parent_turn_ref: run.parent_turn_ref,
        origin_frame_ref: run.origin_frame_ref,
        run_mode: Atom.to_string(run.run_mode),
        profile_ref: run.profile_ref,
        trigger: stringify(run.trigger),
        status: Atom.to_string(run.status),
        phase: Atom.to_string(run.phase),
        goal: run.goal,
        goal_version: run.goal.version,
        plan: run.plan,
        plan_ref: run.plan_ref,
        plan_version: run.plan_version,
        run_policy: stringify(run.policy),
        authority_scope: stringify(run.authority_scope),
        budget: stringify(run.budget),
        consumed_budget: stringify(run.consumed_budget),
        current_step_ref: run.current_step_ref,
        completed_step_refs: run.completed_step_refs,
        pending_artifact_refs: run.pending_artifact_refs,
        active_behavior_ref: run.active_behavior_ref,
        interrupt_state: stringify(run.interrupt_state),
        long_run_task_ref: run.long_run_task_ref,
        failure_ref: failure_ref
      })

    {:ok, task} =
      LongRunTaskLog.update(task, %{
        status: Status.paused(),
        phase: TaskPhase.checkpoint(),
        checkpoint_data:
          Map.merge(task.checkpoint_data || %{}, %{
            "stale_resume" => true,
            "stale_reason" => failure_ref,
            "step" => stale_step_text(failure_ref),
            "agent_run" =>
              Map.merge((task.checkpoint_data || %{})["agent_run"] || %{}, %{
                "status" => "awaiting_author",
                "phase" => "stopped",
                "stale_resume" => true,
                "stale_reason" => failure_ref
              })
          })
      })

    {run, task}
  end

  defp recovery_event(run, task, opts) do
    sequence = AgentRunLog.list_events(run.run_id) |> length() |> Kernel.+(1)

    {:ok, event} =
      AgentEvent.new(%{
        event_id: "evt_#{run.run_id}_recovered_#{sequence}",
        run_ref: run.run_id,
        step_ref: run.current_step_ref,
        sequence: sequence,
        event_type: :run_resumed,
        visibility: :author,
        summary: recovery_summary(task),
        reason_codes: recovery_reason_codes(task, opts),
        refs: [run.long_run_task_ref],
        payload: %{
          long_run_task_ref: run.long_run_task_ref,
          runtime_live: Keyword.get(opts, :runtime_live?, false)
        },
        emitted_at: DateTime.utc_now()
      })

    _ = AgentRunLog.insert_event(event_attrs(event))
    event
  end

  defp live_state(run_id) do
    with {:ok, pid} <- lookup(run_id) do
      {:ok, AgentRunServer.state(pid)}
    end
  end

  defp recovery_summary(%{checkpoint_data: %{"stale_resume" => true}}),
    do: "已恢复 AgentRun 检查点，但状态已过期，等待作者确认。"

  defp recovery_summary(_task), do: "已恢复 AgentRun 检查点。"

  defp recovery_reason_codes(
         %{checkpoint_data: %{"stale_resume" => true, "stale_reason" => reason}},
         opts
       ) do
    ["durable_recovered", "stale_resume", runtime_reason(opts), nonblank(reason)]
    |> Enum.reject(&is_nil/1)
  end

  defp recovery_reason_codes(_task, opts) do
    ["durable_recovered", runtime_reason(opts)]
    |> Enum.reject(&is_nil/1)
  end

  defp runtime_reason(opts) do
    if Keyword.get(opts, :runtime_live?, false), do: "runtime_live", else: "runtime_not_live"
  end

  defp stale_step_text("durable_runtime_not_live"),
    do: "后端运行进程已不存在，已从检查点恢复并等待作者确认"

  defp stale_step_text("goal_version_mismatch"),
    do: "恢复目标版本已变化，等待作者确认"

  defp stale_step_text("checkpoint_goal_version_mismatch"),
    do: "检查点目标版本与运行记录不一致，等待作者确认"

  defp stale_step_text("checkpoint_version_missing"),
    do: "恢复检查点缺少版本信息，等待作者确认"

  defp stale_step_text("checkpoint_version_mismatch"),
    do: "恢复检查点版本与当前运行语义不一致，等待作者确认"

  defp stale_step_text("work_revision_mismatch"),
    do: "恢复时作品事实版本已变化，等待作者确认"

  defp stale_step_text("target_revision_mismatch"),
    do: "恢复目标版本已变化，等待作者确认"

  defp stale_step_text("target_ref_missing"),
    do: "恢复目标已不存在，等待作者确认"

  defp stale_step_text("forced_stale_recovery"),
    do: "恢复状态需要作者重新确认"

  defp stale_step_text("work_ref_mismatch"),
    do: "恢复目标作品与运行记录不一致，等待作者确认"

  defp stale_step_text("session_ref_mismatch"),
    do: "恢复目标会话与运行记录不一致，等待作者确认"

  defp stale_step_text(_reason), do: "恢复状态已过期，等待作者确认"

  defp record_goal_version(%{goal_version: version}) when is_integer(version), do: version

  defp record_goal_version(%{goal: %{"version" => version}}) when is_integer(version),
    do: version

  defp record_goal_version(%{goal: %{version: version}}) when is_integer(version), do: version
  defp record_goal_version(_record), do: nil

  defp version_mismatch?(expected, actual) do
    case {integer_value(expected), integer_value(actual)} do
      {expected_int, actual_int} when is_integer(expected_int) and is_integer(actual_int) ->
        expected_int != actual_int

      _other ->
        false
    end
  end

  defp target_ref_missing?(target_ref, opts) do
    target_ref = nonblank(target_ref)

    cond do
      is_nil(target_ref) ->
        false

      Map.has_key?(opts, :target_ref_exists?) ->
        Map.get(opts, :target_ref_exists?) == false

      is_list(Map.get(opts, :available_target_refs)) ->
        target_ref not in Map.get(opts, :available_target_refs)

      true ->
        false
    end
  end

  defp integer_value(value) when is_integer(value), do: value

  defp integer_value(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> parsed
      _other -> nil
    end
  end

  defp integer_value(_value), do: nil

  defp ref_mismatch?(expected, actual)
       when is_binary(expected) and expected != "" and is_binary(actual) and actual != "",
       do: expected != actual

  defp ref_mismatch?(_expected, _actual), do: false

  defp nonblank(value) when is_binary(value) do
    if String.trim(value) == "", do: nil, else: value
  end

  defp nonblank(_value), do: nil

  defp event_attrs(%AgentEvent{} = event) do
    %{
      id: event.event_id,
      run_id: event.run_ref,
      step_id: event.step_ref,
      sequence: event.sequence,
      event_type: Atom.to_string(event.event_type),
      visibility: Atom.to_string(event.visibility),
      summary: event.summary,
      reason_codes: event.reason_codes,
      refs: event.refs,
      payload: stringify(event.payload)
    }
  end

  defp atomize_known(attrs) do
    for {key, value} <- attrs, into: %{} do
      {known_key(key), value}
    end
  end

  defp known_key(key) when is_atom(key), do: key
  defp known_key("run_id"), do: :run_id
  defp known_key("workspace_id"), do: :workspace_id
  defp known_key("work_id"), do: :work_id
  defp known_key("session_id"), do: :session_id
  defp known_key("parent_turn_ref"), do: :parent_turn_ref
  defp known_key("origin_frame_ref"), do: :origin_frame_ref
  defp known_key("profile_ref"), do: :profile_ref
  defp known_key("goal"), do: :goal
  defp known_key("plan"), do: :plan
  defp known_key("plan_ref"), do: :plan_ref
  defp known_key("budget"), do: :budget
  defp known_key("consumed_budget"), do: :consumed_budget
  defp known_key("authority_scope"), do: :authority_scope
  defp known_key("policy"), do: :policy
  defp known_key("work_revision"), do: :work_revision
  defp known_key("target_revision_ref"), do: :target_revision_ref
  defp known_key("target_revision"), do: :target_revision
  defp known_key(key), do: key

  defp value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
  defp required(map, key), do: value(map, key) || raise(ArgumentError, "#{key} is required")

  defp get_in_goal(attrs, key) do
    case value(attrs, :goal) do
      goal when is_map(goal) -> value(goal, key)
      goal when is_binary(goal) and key == :text -> goal
      _ -> nil
    end
  end

  defp put_durable_fact_scope(attrs) do
    scope = value(attrs, :authority_scope) || %{}

    scope =
      [:work_revision, :target_revision_ref, :target_revision]
      |> Enum.reduce(scope, fn key, acc ->
        case nonblank_value(value(attrs, key) || value(acc, key)) do
          nil -> acc
          fact_value -> Map.put(acc, key, fact_value)
        end
      end)

    Map.put(attrs, :authority_scope, scope)
  end

  defp durable_fact_checkpoint_data(attrs) do
    scope = value(attrs, :authority_scope) || %{}

    %{}
    |> maybe_put_fact(
      "work_revision",
      value(attrs, :work_revision) || value(scope, :work_revision)
    )
    |> maybe_put_fact(
      "target_revision_ref",
      value(attrs, :target_revision_ref) || value(scope, :target_revision_ref)
    )
    |> maybe_put_fact(
      "target_revision",
      value(attrs, :target_revision) || value(scope, :target_revision)
    )
  end

  defp maybe_put_fact(map, key, value) do
    case nonblank_value(value) do
      nil -> map
      fact_value -> Map.put(map, key, fact_value)
    end
  end

  defp nonblank_value(value) when is_binary(value) do
    value = String.trim(value)
    if value == "", do: nil, else: value
  end

  defp nonblank_value(nil), do: nil
  defp nonblank_value(value), do: value

  defp stringify(%_struct{} = struct) do
    struct
    |> Map.from_struct()
    |> stringify()
  end

  defp stringify(value) when is_map(value) do
    Map.new(value, fn {key, item} -> {to_string(key), stringify(item)} end)
  end

  defp stringify(value) when is_list(value), do: Enum.map(value, &stringify/1)
  defp stringify(nil), do: nil
  defp stringify(value) when is_atom(value), do: Atom.to_string(value)
  defp stringify(value), do: value
end
