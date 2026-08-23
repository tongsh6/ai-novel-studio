defmodule NovelWeb.WorkspaceChannel do
  @moduledoc """
  Workspace Channel — v3 对话主通道。

  负责将 user_message / author_action 路由到 NovelApplication 主链，
  并注入真实 persistence 回调（context_fetcher + trace_persister + interaction_recorder）。
  """

  use Phoenix.Channel

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelApplication.AgentRunService
  alias NovelApplication.DialogueGateway
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.TaskRunner
  alias NovelApplication.WorkSessionService
  alias NovelCommon.Contracts.AgentEvent
  alias NovelCommon.LogContext
  alias NovelDomain.AuthorActionInput

  @current_turn_author_action_types [
    "confirm_before_execute",
    "reject_or_cancel_confirmation",
    "cancel_pending_behavior"
  ]
  @agent_run_state_snapshot_timeout 5_000

  @impl true
  def join("workspace:" <> suffix, payload, socket) do
    work_id = resolve_join_work_id(suffix, payload)
    {session_id, restored_list} = restore_join_turn_results(work_id, payload)

    restored_map =
      Map.new(restored_list, fn tr ->
        {tr[:turn_id] || tr["turn_id"], tr}
      end)

    LogContext.put_turn(suffix, work_id, nil, session_id)

    socket =
      socket
      |> assign(:workspace_id, suffix)
      |> assign(:work_id, work_id)
      |> assign(:session_id, session_id)
      |> assign(:turn_results_list, restored_list)
      |> assign(:turn_results_by_id, restored_map)
      |> assign(:current_turn_id, latest_turn_id(restored_map))
      |> assign(:action_idempotency_ledger, %{})

    # Best-effort touch so the most-recently-opened work surfaces first in
    # GET /api/works (VS-09). Missing work_id is fine — pre-VS-09 clients
    # still pass workspace id only. Failures (DB unavailable, sandbox not
    # checked out, work_id is a non-uuid placeholder) must NOT abort join.
    _ =
      try do
        NovelApplication.WorkService.mark_opened(work_id)
      rescue
        _ -> :skipped
      catch
        _, _ -> :skipped
      end

    LogEmit.emit(:channel, :join, :done, %{
      workspace_id: suffix,
      work_id: work_id,
      session_id: session_id
    })

    send(self(), :recover_durable_agent_runs)

    {:ok, %{joined: true, work_id: work_id, session_id: session_id}, socket}
  end

  defp restore_join_turn_results(work_id, payload) do
    requested = is_map(payload) && Map.get(payload, "session_id")

    cond do
      valid_uuid?(requested) ->
        case restore_requested_turn_results(work_id, requested) do
          {:ok, turn_results} -> {requested, turn_results}
          _ -> resume_join_turn_results(work_id)
        end

      valid_uuid?(work_id) ->
        resume_join_turn_results(work_id)

      true ->
        {nil, []}
    end
  end

  defp restore_requested_turn_results(work_id, session_id) do
    t0 = System.monotonic_time(:millisecond)

    case WorkSessionService.restore_channel_turn_results(work_id, session_id) do
      {:ok, %{turn_results: turn_results, read_only: read_only?}} ->
        LogEmit.emit(:channel, :join_restore, :done, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          session_id: session_id,
          restore_source: :requested_session,
          read_only: read_only?,
          turn_result_count: length(turn_results),
          pending_adoption_count: count_pending_adoptions_in_turn_results(turn_results)
        })

        {:ok, turn_results}

      error ->
        error
    end
  end

  defp resume_join_turn_results(work_id) do
    t0 = System.monotonic_time(:millisecond)

    case WorkSessionService.resume(work_id) do
      {:ok, %{active_session: %{id: id}, transcript: transcript}} ->
        turn_results =
          transcript
          |> Enum.map(& &1.turn_result)
          |> Enum.reject(&is_nil/1)

        LogEmit.emit(:channel, :join_restore, :done, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          session_id: id,
          restore_source: :active_session_resume,
          turn_result_count: length(turn_results),
          pending_adoption_count: count_pending_adoptions_in_turn_results(turn_results)
        })

        {id, turn_results}

      _ ->
        {nil, []}
    end
  end

  defp latest_turn_id(turn_results) when map_size(turn_results) == 0, do: nil
  defp latest_turn_id(turn_results), do: turn_results |> Map.keys() |> List.last()

  defp count_pending_adoptions_in_turn_results(turn_results) do
    turn_results
    |> Enum.flat_map(fn entry ->
      get_in(entry, [:adoption_state, :pending]) ||
        get_in(entry, ["adoption_state", "pending"]) ||
        []
    end)
    |> length()
  end

  defp resolve_join_work_id(suffix, payload) do
    requested = (is_map(payload) && Map.get(payload, "work_id")) || suffix

    cond do
      valid_uuid?(requested) ->
        requested

      real_persistence_enabled?() ->
        reuse_or_create_work_id(requested)

      true ->
        requested
    end
  end

  defp reuse_or_create_work_id(fallback) do
    case NovelApplication.WorkService.list() do
      [%{id: id} | _] ->
        id

      [] ->
        case NovelApplication.WorkService.create(%{"title" => "未命名作品"}) do
          {:ok, work} -> work.id
          _ -> fallback
        end
    end
  end

  defp valid_uuid?(value) when is_binary(value) do
    Regex.match?(
      ~r/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      value
    )
  end

  defp valid_uuid?(_), do: false

  defp real_persistence_enabled? do
    :novel_web
    |> Application.get_env(:persistence, [])
    |> Keyword.get(:inject_real_persistence, false)
  end

  @impl true
  def handle_in("user_message", %{"text" => text} = msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id
    session_id = socket.assigns[:session_id] || Map.get(msg, "session_id")
    generate_plan = Map.get(msg, "generate_micro_plan", false)
    turn_id = Map.get(msg, "turn_id") || NovelFoundation.ID.unique("turn")

    case validate_candidate_selection(socket, Map.get(msg, "candidate_selection")) do
      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}

      {:ok, candidate_selection} ->
        case activate_author_session(work_id, session_id) do
          {:ok, active_session_id} ->
            handle_valid_user_message(socket, %{
              text: text,
              ws_id: ws_id,
              work_id: work_id,
              session_id: active_session_id,
              generate_plan: generate_plan,
              turn_id: turn_id,
              candidate_selection: candidate_selection
            })

          {:error, reason} ->
            {:reply, {:error, %{reason: error_reason(reason)}}, socket}
        end
    end
  end

  @impl true
  def handle_in("author_action", %{"action" => action_params}, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    source_turn_ref = action_params["source_turn_ref"] || ws_id
    work_id = socket.assigns[:work_id] || ws_id
    session_id = socket.assigns[:session_id]

    source_turn_result =
      source_turn_result(
        socket,
        source_turn_ref,
        action_params["action_type"],
        action_params["target_ref"]
      )

    LogContext.put_turn(ws_id, work_id, source_turn_ref, session_id)

    action_input = %AuthorActionInput{
      input_id: NovelFoundation.ID.unique("in"),
      source_turn_ref: source_turn_ref,
      action_id: action_params["action_id"],
      action_type: action_params["action_type"],
      target_ref: action_params["target_ref"],
      behavior_ref: action_params["behavior_ref"],
      candidate_set_ref: action_params["candidate_set_ref"],
      candidate_ref: action_params["candidate_ref"],
      payload: Map.get(action_params, "payload", %{}),
      idempotency_key: action_params["idempotency_key"]
    }

    LogEmit.emit(:channel, :author_action, :start, %{
      work_id: work_id,
      session_id: session_id,
      turn_id: source_turn_ref,
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      target_ref: action_input.target_ref,
      candidate_ref: action_input.candidate_ref,
      candidate_set_ref: action_input.candidate_set_ref
    })

    case lookup_author_action_receipt(socket, action_input) do
      {:duplicate, entry} ->
        result = Map.put(entry.result, :duplicate, true)

        LogEmit.emit(:channel, :author_action, :done, %{
          work_id: socket.assigns[:work_id],
          session_id: socket.assigns[:session_id],
          turn_id: action_input.source_turn_ref,
          action_id: action_input.action_id,
          action_type: action_input.action_type,
          action_status: result.status,
          duplicate: true
        })

        broadcast!(socket, "action_result", result)
        {:reply, {:ok, author_action_ack(result, duplicate: true)}, socket}

      :miss ->
        handle_author_action(socket, action_input, source_turn_result)
    end
  end

  def handle_in("adopt", %{"artifact_id" => artifact_id} = params, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id

    {source_turn_ref, source_turn_result} =
      source_turn_for_artifact_action(socket, Map.get(params, "source_turn_ref"), artifact_id)

    LogContext.put_turn(ws_id, work_id, source_turn_ref, socket.assigns[:session_id])

    t0 = System.monotonic_time(:millisecond)

    LogEmit.emit(:channel, :adopt, :start, %{
      workspace_id: ws_id,
      work_id: work_id,
      artifact_id: artifact_id
    })

    adopt_params =
      params
      |> Map.put("work_id", work_id)
      |> Map.put("session_id", socket.assigns[:session_id])

    case source_turn_result do
      {:error, reason} ->
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:channel, :adopt, :error, %{
          duration_ms: duration,
          artifact_id: artifact_id,
          reason_code: :adoption_rejected,
          outcome_detail: reason
        })

        {:reply, {:error, %{reason: reason}}, socket}

      source_turn_result ->
        handle_adopt_result(
          NovelApplication.AdoptionWorkflow.handle_adopt(source_turn_result, adopt_params),
          socket,
          artifact_id,
          t0
        )
    end
  end

  def handle_in("discard", %{"artifact_id" => artifact_id} = params, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id

    {source_turn_ref, source_turn_result} =
      source_turn_for_artifact_action(socket, Map.get(params, "source_turn_ref"), artifact_id)

    LogContext.put_turn(ws_id, work_id, source_turn_ref, socket.assigns[:session_id])

    t0 = System.monotonic_time(:millisecond)

    LogEmit.emit(:channel, :discard, :start, %{
      workspace_id: ws_id,
      work_id: work_id,
      artifact_id: artifact_id
    })

    case source_turn_result do
      {:error, reason} ->
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:channel, :discard, :error, %{
          duration_ms: duration,
          artifact_id: artifact_id,
          reason_code: :discard_rejected,
          outcome_detail: reason
        })

        {:reply, {:error, %{reason: reason}}, socket}

      source_turn_result ->
        discard_params =
          params
          |> Map.put("work_id", work_id)
          |> Map.put("session_id", socket.assigns[:session_id])

        handle_discard_result(
          NovelApplication.AdoptionWorkflow.handle_discard(source_turn_result, discard_params),
          socket,
          artifact_id,
          t0
        )
    end
  end

  def handle_in("modify_draft", params, socket) do
    artifact_id = Map.get(params, "artifact_id") || Map.get(params, "draft_id")
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id

    {source_turn_ref, source_turn_result} =
      source_turn_for_artifact_action(socket, Map.get(params, "source_turn_ref"), artifact_id)

    LogContext.put_turn(ws_id, work_id, source_turn_ref, socket.assigns[:session_id])

    t0 = System.monotonic_time(:millisecond)

    LogEmit.emit(:channel, :modify_draft, :start, %{
      workspace_id: ws_id,
      work_id: work_id,
      artifact_id: artifact_id
    })

    modify_params =
      params
      |> Map.put("work_id", work_id)
      |> Map.put("session_id", socket.assigns[:session_id])

    case source_turn_result do
      {:error, reason} ->
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:channel, :modify_draft, :error, %{
          duration_ms: duration,
          artifact_id: artifact_id,
          reason_code: :modify_draft_rejected,
          outcome_detail: reason
        })

        {:reply, {:error, %{reason: reason}}, socket}

      source_turn_result ->
        handle_modify_draft_result(
          NovelApplication.AdoptionWorkflow.handle_modify_draft(
            source_turn_result,
            modify_params
          ),
          socket,
          artifact_id,
          t0
        )
    end
  end

  def handle_in("ping", payload, socket) do
    {:reply, {:ok, %{event: "pong", echo: payload}}, socket}
  end

  def handle_in("agent_command", %{"run_id" => run_id, "command" => command} = payload, socket) do
    case dispatch_agent_command(socket, run_id, command, payload) do
      :ok -> {:reply, {:ok, %{received: true, run_id: run_id, command: command}}, socket}
      {:error, reason} -> {:reply, {:error, %{reason: reason_text(reason)}}, socket}
    end
  end

  def handle_in("agent_command", _payload, socket) do
    {:reply, {:error, %{reason: "agent_command requires run_id and command"}}, socket}
  end

  # --- Structure Panel / Reading Mode data handlers ---

  def handle_in("get_toc", payload, socket) do
    work_id = Map.get(payload, "work_id") || socket.assigns[:work_id] || "lobby"
    data = NovelApplication.ReadingProjectionService.toc(work_id)

    LogEmit.emit(:channel, :get_toc, :done, %{
      work_id: work_id,
      volume_count: length(data.volumes),
      chapter_count: data.volumes |> Enum.flat_map(& &1.chapters) |> length(),
      total_word_count: data.total_word_count,
      short_chapter_count: data.audit.short_chapter_count,
      empty_chapter_count: data.audit.empty_chapter_count,
      meets_threshold: data.audit.meets_threshold
    })

    {:reply, {:ok, data}, socket}
  end

  def handle_in("get_work_profile", payload, socket) do
    work_id = archive_work_id(payload, socket)
    data = NovelApplication.WorkArchiveService.profile(work_id)

    LogEmit.emit(:channel, :get_work_profile, :done, %{
      workspace_id: "current_workspace",
      work_id: "current_work",
      field_count: map_size(data),
      has_title: Map.has_key?(data, :title),
      status: data[:status]
    })

    {:reply, {:ok, data}, socket}
  end

  def handle_in("export_work", payload, socket) do
    work_id = socket.assigns[:work_id] || Map.get(payload, "work_id") || "lobby"
    export_dir = Map.get(payload, "export_dir")

    task_attrs = %{
      workspace_id: work_id,
      task_type: "export_work",
      status: "READY",
      phase: "PLANNED",
      goal: "导出全书"
    }

    result =
      TaskRunner.track(
        task_attrs,
        [
          checkpoint_data: %{"progress" => 10, "step" => "正在准备导出"},
          on_state_change: fn task -> broadcast_task_state(socket, task) end
        ],
        fn task ->
          NovelApplication.ExportService.export(
            work_id,
            export_dir: export_dir,
            on_progress: fn progress, step ->
              case TaskRunner.checkpoint(task, %{"progress" => progress, "step" => step}) do
                {:ok, updated_task} -> broadcast_task_state(socket, updated_task)
                _ -> :ok
              end
            end
          )
        end
      )

    case result do
      {:ok, result} ->
        LogEmit.emit(:channel, :export_work, :done, %{
          work_id: work_id,
          format: result.format,
          chapter_count: result.chapter_count,
          total_word_count: result.total_word_count,
          export_path: result.path
        })

        {:reply, {:ok, result}, socket}

      {:error, reason} ->
        LogEmit.emit(:channel, :export_work, :error, %{
          work_id: work_id,
          reason_code: reason
        })

        {:reply, {:error, %{reason: reason_text(reason)}}, socket}
    end
  end

  @impl true
  def handle_in("get_chapter_content", %{"chapter_id" => chapter_id}, socket) do
    work_id = socket.assigns[:work_id] || "lobby"

    case NovelApplication.ReadingProjectionService.chapter_content(chapter_id, work_id) do
      {:ok, data} ->
        LogEmit.emit(:channel, :get_chapter_content, :done, %{
          work_id: work_id,
          chapter_id: chapter_id,
          scene_count: length(data.scenes),
          content_chars:
            data.scenes
            |> Enum.map(&String.length(&1.content || ""))
            |> Enum.sum()
        })

        {:reply, {:ok, data}, socket}

      {:error, :not_found} ->
        LogEmit.emit(:channel, :get_chapter_content, :error, %{
          work_id: work_id,
          chapter_id: chapter_id,
          reason_code: :not_found
        })

        {:reply, {:error, %{reason: "chapter not found"}}, socket}
    end
  end

  def handle_in("get_characters", payload, socket) do
    work_id = archive_work_id(payload, socket)
    data = NovelApplication.WorkArchiveService.characters(work_id)

    LogEmit.emit(:channel, :get_characters, :done, %{
      work_id: work_id,
      character_count: length(data)
    })

    {:reply, {:ok, data}, socket}
  end

  # VS-00G CP5d：「暂定设定」区读端口——AI 工作假定清单（tentative+AI_ASSUMPTION）。
  def handle_in("get_assumptions", payload, socket) do
    work_id = archive_work_id(payload, socket)
    data = NovelApplication.AssumptionService.list(work_id)

    LogEmit.emit(:channel, :get_assumptions, :done, %{
      work_id: work_id,
      assumption_count: length(data)
    })

    {:reply, {:ok, %{assumptions: data}}, socket}
  end

  def handle_in("get_foreshadowing", payload, socket) do
    work_id = archive_work_id(payload, socket)
    data = NovelApplication.WorkArchiveService.foreshadowing(work_id)

    LogEmit.emit(:channel, :get_foreshadowing, :done, %{
      work_id: work_id,
      item_count: length(data)
    })

    {:reply, {:ok, data}, socket}
  end

  def handle_in("get_rules", payload, socket) do
    work_id = archive_work_id(payload, socket)
    data = NovelApplication.WorkArchiveService.rules(work_id)

    LogEmit.emit(:channel, :get_rules, :done, %{
      work_id: work_id,
      rule_count: length(data)
    })

    {:reply, {:ok, data}, socket}
  end

  # CP4c（VS-00F / ui43 §5 模块 9「脉络」）：五账分组进度态（面板 L2 只读）。
  def handle_in("get_ledger_threads", payload, socket) do
    work_id = archive_work_id(payload, socket)
    data = NovelApplication.LedgerViewService.threads(work_id)

    LogEmit.emit(:channel, :get_ledger_threads, :done, %{
      work_id: work_id,
      entry_count: data |> Map.values() |> List.flatten() |> length()
    })

    {:reply, {:ok, data}, socket}
  end

  # CP4c：最新活跃审读报告（面板 L3 只读；无报告诚实回 nil）。
  def handle_in("get_review_report", payload, socket) do
    work_id = archive_work_id(payload, socket)
    report = NovelApplication.LedgerViewService.review_report(work_id)

    LogEmit.emit(:channel, :get_review_report, :done, %{
      work_id: work_id,
      finding_count: (report && report.finding_count) || 0
    })

    {:reply, {:ok, %{report: report}}, socket}
  end

  def handle_in("get_work_stats", payload, socket) do
    work_id = archive_work_id(payload, socket)
    data = NovelApplication.WorkArchiveService.stats(work_id)

    LogEmit.emit(:channel, :get_work_stats, :done, %{
      work_id: work_id,
      volumes: data.volumes,
      chapters: data.chapters,
      characters: data.characters,
      memory_items: data.memory_items,
      drafts_total: data.drafts_total,
      drafts_accepted: data.drafts_accepted
    })

    {:reply, {:ok, data}, socket}
  end

  defp activate_author_session(work_id, session_id) do
    if valid_uuid?(work_id) and valid_uuid?(session_id) do
      case WorkSessionService.activate(work_id, session_id) do
        {:ok, %{id: id}} -> {:ok, id}
        {:error, reason} -> {:error, reason}
      end
    else
      {:ok, session_id}
    end
  end

  defp error_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp error_reason(reason), do: inspect(reason)

  @impl true
  def handle_info(:recover_durable_agent_runs, socket) do
    recover_durable_agent_runs(socket)
    {:noreply, socket}
  end

  def handle_info({:agent_event, %AgentEvent{} = event}, socket) do
    socket = maybe_broadcast_agent_turn_result(socket, event)

    if AgentEvent.author_visible?(event) do
      broadcast!(socket, "agent_event", agent_event_payload(event, socket))
    end

    if agent_event_needs_state_snapshot?(event) do
      request_agent_run_state_snapshot(event.run_ref)
    end

    {:noreply, socket}
  end

  def handle_info({:agent_run_state_snapshot, _run_ref, {:ok, state}}, socket) do
    if agent_run_state_belongs_to_socket?(state, socket) do
      # 快照来自成功的 live GenServer call——runtime 此刻在场。稳态广播显式携带
      # liveness，前端命令权限以此为真源而非历史 TurnResult（DS03）。
      state = Map.put(state, :runtime_live?, true)
      broadcast!(socket, "agent_run_state", agent_run_state_payload(state, socket))
    end

    {:noreply, socket}
  end

  def handle_info({:agent_run_state_snapshot, _run_ref, {:error, _reason}}, socket) do
    {:noreply, socket}
  end

  defp request_agent_run_state_snapshot(run_ref) when is_binary(run_ref) do
    channel_pid = self()

    Task.Supervisor.start_child(NovelApplication.BackgroundTaskSupervisor, fn ->
      result = AgentRunService.state(run_ref, @agent_run_state_snapshot_timeout)
      send(channel_pid, {:agent_run_state_snapshot, run_ref, result})
    end)

    :ok
  rescue
    _error -> :ok
  catch
    _kind, _reason -> :ok
  end

  defp request_agent_run_state_snapshot(_run_ref), do: :ok

  defp agent_event_needs_state_snapshot?(%AgentEvent{event_type: event_type}) do
    event_type in [
      :run_started,
      :plan_drafted,
      :plan_revised,
      :exploration_observed,
      :evaluation_made,
      :interrupt_requested,
      :run_paused,
      :run_resumed,
      :run_cancelled,
      :run_failed,
      :run_completed,
      :awaiting_author
    ]
  end

  defp agent_run_state_belongs_to_socket?(%{run: run}, socket) do
    session_id = socket.assigns[:session_id]

    run.work_id == socket.assigns[:work_id] and
      (is_nil(session_id) or run.session_id == session_id)
  end

  defp agent_run_state_belongs_to_socket?(_state, _socket), do: false

  defp recover_durable_agent_runs(socket) do
    work_id = socket.assigns[:work_id]
    session_id = socket.assigns[:session_id]

    if is_binary(work_id) and is_binary(session_id) do
      channel_pid = self()
      event_sink = fn event -> send(channel_pid, {:agent_event, event}) end

      {:ok, reconnected} =
        AgentRunService.reconnect_bounded(
          work_id,
          session_id,
          event_sink: event_sink
        )

      Enum.each(reconnected, &broadcast_reconnected_bounded_agent_run(socket, &1))

      {:ok, recovered} =
        AgentRunService.recover_durable(
          work_id,
          session_id,
          work_revision: current_work_revision(work_id),
          event_sink: event_sink
        )

      Enum.each(recovered, &broadcast_recovered_agent_run(socket, &1))

      {:ok, dead_bounded} = AgentRunService.list_dead_bounded(work_id, session_id)
      Enum.each(dead_bounded, &broadcast_dead_bounded_agent_run(socket, &1))
    end
  end

  defp broadcast_reconnected_bounded_agent_run(socket, %{run: run} = state) do
    broadcast!(socket, "agent_run_state", agent_run_state_payload(state, socket))

    LogEmit.emit(:channel, :agent_run_reconnect, :done, %{
      work_id: socket.assigns[:work_id],
      session_id: socket.assigns[:session_id],
      run_id: run.run_id,
      run_mode: :bounded,
      runtime_live: true
    })
  end

  defp broadcast_reconnected_bounded_agent_run(_socket, _state), do: :ok

  # DS03：bounded runtime 已死但持久层仍非终态——广播 runtime_live: false 的只读
  # 快照，前端据此把历史任务降为「已失效」，不得再提供实时命令入口。
  defp broadcast_dead_bounded_agent_run(socket, %{run: run} = state) do
    broadcast!(socket, "agent_run_state", agent_run_state_payload(state, socket))

    LogEmit.emit(:channel, :agent_run_expired, :done, %{
      work_id: socket.assigns[:work_id],
      session_id: socket.assigns[:session_id],
      run_id: run.run_id,
      run_mode: :bounded,
      runtime_live: false,
      status: run.status
    })
  end

  defp broadcast_dead_bounded_agent_run(_socket, _state), do: :ok

  defp broadcast_recovered_agent_run(socket, %{recovery_event: %AgentEvent{} = event} = state) do
    if AgentEvent.author_visible?(event) do
      broadcast!(socket, "agent_event", agent_event_payload(event, socket, state.run.session_id))
    end

    broadcast!(socket, "agent_run_state", agent_run_state_payload(state, socket))

    LogEmit.emit(:channel, :agent_run_recover, :done, %{
      work_id: socket.assigns[:work_id],
      session_id: socket.assigns[:session_id],
      run_id: event.run_ref,
      runtime_live: Map.get(state, :runtime_live?),
      recovered: Map.get(state, :recovered?, false)
    })
  end

  defp broadcast_recovered_agent_run(_socket, _state), do: :ok

  defp current_work_revision(work_id) do
    if valid_uuid?(work_id) do
      case NovelApplication.WorkService.get(work_id) do
        %{revision: revision} when is_integer(revision) -> revision
        _other -> nil
      end
    end
  rescue
    _error -> nil
  catch
    _kind, _reason -> nil
  end

  defp dispatch_agent_command(socket, run_id, command, payload) when is_binary(run_id) do
    with :ok <- ensure_run_belongs_to_socket(socket, run_id) do
      case command do
        "pause" -> AgentRunService.pause(run_id)
        "resume" -> AgentRunService.resume(run_id)
        "cancel" -> AgentRunService.cancel(run_id)
        "steer" -> dispatch_steer(socket, run_id, Map.get(payload, "text", ""))
        _ -> {:error, :unknown_command}
      end
    end
  end

  defp dispatch_agent_command(_socket, _run_id, _command, _payload),
    do: {:error, :unknown_command}

  # DS03：steer 被接受后把作者补充持久化为 session Interaction——作者输入不得
  # 只存在于 React state / AgentRun goal，刷新后必须能从 transcript 恢复。
  defp dispatch_steer(socket, run_id, text) do
    case AgentRunService.steer(run_id, text) do
      {:ok, steer_info} ->
        work_id = socket.assigns[:work_id]
        session_id = socket.assigns[:session_id]

        if is_binary(work_id) and is_binary(session_id) do
          DialogueGateway.persist_author_steer(work_id, session_id, steer_info, text)
        end

        :ok

      error ->
        error
    end
  end

  defp ensure_run_belongs_to_socket(socket, run_id) do
    case AgentRunService.state(run_id) do
      {:ok, %{run: run}} ->
        session_id = socket.assigns[:session_id]

        if run.work_id == socket.assigns[:work_id] and
             (is_nil(session_id) or run.session_id == session_id) do
          :ok
        else
          {:error, :run_scope_mismatch}
        end

      error ->
        error
    end
  end

  defp agent_event_payload(%AgentEvent{} = event, socket) do
    agent_event_payload(event, socket, socket.assigns[:session_id])
  end

  defp agent_event_payload(%AgentEvent{} = event, socket, session_id) do
    %{
      event_id: event.event_id,
      run_ref: event.run_ref,
      run_id: event.run_ref,
      step_ref: event.step_ref,
      sequence: event.sequence,
      event_type: Atom.to_string(event.event_type),
      visibility: Atom.to_string(event.visibility),
      summary: event.summary,
      reason_codes: event.reason_codes,
      refs: event.refs,
      payload: author_safe_agent_payload(event.payload),
      workspace_id: socket.assigns[:workspace_id],
      work_id: socket.assigns[:work_id],
      session_id: session_id,
      emitted_at: timestamp_iso(event.emitted_at)
    }
  end

  defp author_safe_agent_payload(payload) when is_map(payload) do
    payload
    |> Map.drop([:turn_result, "turn_result"])
    |> stringify_atom_values()
  end

  defp author_safe_agent_payload(_payload), do: %{}

  defp stringify_atom_values(value) when is_map(value) do
    Map.new(value, fn {key, item} -> {key, stringify_atom_values(item)} end)
  end

  defp stringify_atom_values(value) when is_list(value),
    do: Enum.map(value, &stringify_atom_values/1)

  defp stringify_atom_values(value) when is_boolean(value), do: value
  defp stringify_atom_values(value) when is_atom(value), do: Atom.to_string(value)
  defp stringify_atom_values(value), do: value

  defp agent_run_state_payload(%{run: run} = state, socket) do
    %{
      run_id: run.run_id,
      run_mode: Atom.to_string(run.run_mode),
      status: Atom.to_string(run.status),
      phase: Atom.to_string(run.phase),
      long_run_task_ref: run.long_run_task_ref,
      workspace_id: socket.assigns[:workspace_id],
      work_id: run.work_id,
      session_id: run.session_id,
      parent_turn_ref: run.parent_turn_ref,
      origin_frame_ref: run.origin_frame_ref,
      profile_ref: run.profile_ref,
      trigger: stringify_atom_values(run.trigger),
      current_activity: agent_run_current_activity(run),
      goal: run.goal,
      plan_ref: run.plan_ref,
      plan_version: run.plan_version,
      current_step_ref: run.current_step_ref,
      completed_step_refs: run.completed_step_refs,
      pending_artifact_refs: run.pending_artifact_refs,
      interrupt_state: stringify_atom_values(run.interrupt_state),
      budget: run.budget,
      consumed_budget: run.consumed_budget,
      current_task: Map.get(state, :current_task?),
      remaining_steps: Map.get(state, :remaining_steps),
      recovered: Map.get(state, :recovered?, false),
      runtime_live: Map.get(state, :runtime_live?),
      long_run_task: long_run_task_payload(Map.get(state, :long_run_task))
    }
  end

  defp agent_run_current_activity(run) do
    completed_steps = length(run.completed_step_refs || [])
    total_steps = max(agent_run_plan_step_count(run.plan), completed_steps)

    %{
      kind:
        if(get_in(run.trigger || %{}, [:action_type]) == "revise_from_findings",
          do: "revision_draft_generation",
          else: "agent_run_execution"
        ),
      phase: agent_run_activity_phase(run),
      completed_steps: completed_steps,
      total_steps: total_steps
    }
  end

  defp agent_run_plan_step_count(%{steps: steps}) when is_list(steps), do: length(steps)
  defp agent_run_plan_step_count(%{"steps" => steps}) when is_list(steps), do: length(steps)
  defp agent_run_plan_step_count(_plan), do: 0

  defp agent_run_activity_phase(%{status: status})
       when status in [:completed, :cancelled, :failed],
       do: "finalizing"

  defp agent_run_activity_phase(%{phase: :planning}), do: "preparing"
  defp agent_run_activity_phase(%{phase: :finalizing}), do: "finalizing"
  defp agent_run_activity_phase(_run), do: "generating"

  defp long_run_task_payload(nil), do: nil

  defp long_run_task_payload(task) do
    checkpoint_data = task.checkpoint_data || %{}

    %{
      task_id: task.id,
      status: task.status,
      phase: task.phase,
      current_unit_ref: task.current_unit_ref,
      completed_unit_refs: task.completed_unit_refs || [],
      pending_artifact_refs: task.pending_artifact_refs || [],
      progress: task_progress(task.phase, checkpoint_data),
      step: task_step(task, checkpoint_data),
      checkpoint_data: author_safe_agent_payload(checkpoint_data),
      updated_at: timestamp_iso(task.updated_at)
    }
  end

  defp maybe_broadcast_agent_turn_result(socket, %AgentEvent{} = event) do
    case Map.get(event.payload, :turn_result) || Map.get(event.payload, "turn_result") do
      turn_result when is_map(turn_result) ->
        turn_result = scope_turn_result(socket, turn_result)
        broadcast!(socket, "turn_result", turn_result)
        remember_turn_result(socket, turn_result)

      _ ->
        socket
    end
  end

  defp broadcast_task_state(socket, task) do
    payload = task_state_payload(task)
    broadcast!(socket, "task_state", payload)

    LogEmit.emit(:channel, :task_state, :done, %{
      work_id: socket.assigns[:work_id],
      session_id: socket.assigns[:session_id],
      task_id: payload.task_id,
      task_type: payload.task_type,
      phase: payload.phase,
      status: payload.status,
      progress: payload.progress,
      step: payload.step
    })
  end

  defp task_state_payload(task) do
    checkpoint_data = task.checkpoint_data || %{}
    phase = task.phase || "RUNNING"

    %{
      task_id: task.id,
      task_type: task.task_type,
      phase: phase,
      status: task.status,
      progress: task_progress(phase, checkpoint_data),
      step: task_step(task, checkpoint_data),
      updated_at: timestamp_iso(task.updated_at)
    }
  end

  defp task_progress("RUNNING", _checkpoint_data), do: 10
  defp task_progress("COMPLETED", _checkpoint_data), do: 100
  defp task_progress("FAILED", _checkpoint_data), do: 100

  defp task_progress(_phase, checkpoint_data) do
    case checkpoint_data["progress"] || checkpoint_data[:progress] do
      value when is_number(value) -> value
      _ -> 50
    end
  end

  defp task_step(task, checkpoint_data) do
    checkpoint_data["step"] || checkpoint_data[:step] || task.goal || task.task_type
  end

  defp timestamp_iso(%DateTime{} = timestamp), do: DateTime.to_iso8601(timestamp)
  defp timestamp_iso(_), do: nil

  defp reason_text(reason) when is_binary(reason), do: reason
  defp reason_text(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp reason_text(%{__exception__: true} = reason), do: Exception.message(reason)
  defp reason_text(reason), do: inspect(reason)

  defp handle_author_action(
         socket,
         %AuthorActionInput{action_type: type} = action_input,
         source_turn_result
       )
       when type in ["accept", "discard", "edit_then_accept"] do
    # 采纳/放弃/编辑后采纳 tentative artifact：ADR-0010 §87 要求 adoption 在 application
    # 执行，web 只路由。先用 ActionValidator 守住 stale/invented action（AU-05/06 不变量），
    # 再走既有 AdoptionWorkflow 持久化路径，并以 TurnResult 形式回传全部决定。
    source_turn_result = scope_source_turn_result(socket, source_turn_result)

    case NovelApplication.ActionValidator.validate(action_input, source_turn_result) do
      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}

      :ok ->
        params = %{
          "artifact_id" => action_input.target_ref,
          "work_id" => socket.assigns[:work_id],
          "session_id" => socket.assigns[:session_id],
          "source_turn_ref" => action_input.source_turn_ref,
          "action_id" => action_input.action_id,
          "action_type" => action_input.action_type,
          "behavior_ref" => action_input.behavior_ref,
          "idempotency_key" => action_input.idempotency_key
        }

        result =
          case type do
            "accept" ->
              NovelApplication.AdoptionWorkflow.handle_adopt(source_turn_result, params)

            "discard" ->
              NovelApplication.AdoptionWorkflow.handle_discard(source_turn_result, params)

            "edit_then_accept" ->
              # 作者全文编辑随 author_action.payload.edited_content 传入。
              edit_params =
                Map.put(params, "edited_content", action_payload(action_input, "edited_content"))

              NovelApplication.AdoptionWorkflow.handle_modify_draft(
                source_turn_result,
                edit_params
              )
          end

        finish_adoption_author_action(socket, action_input, result)
    end
  end

  # 采纳确认的 confirm/reject：当 target 是某个 pending artifact（采纳确认）时，
  # confirm → 重新 gate 采纳（confirmation_satisfied），reject → 关闭确认不写库。
  # 否则（工具派发确认等）走既有 DialogueGateway 路径。
  defp handle_author_action(
         socket,
         %AuthorActionInput{action_type: type} = action_input,
         source_turn_result
       )
       when type in ["confirm_before_execute", "reject_or_cancel_confirmation"] do
    case adoption_confirmation_source(socket, action_input) do
      {:adoption, draft_turn} ->
        route_adoption_confirmation(socket, action_input, source_turn_result, draft_turn)

      :not_adoption ->
        handle_dialogue_gateway_action(socket, action_input, source_turn_result)
    end
  end

  defp handle_author_action(
         socket,
         %AuthorActionInput{action_type: "revise_from_findings"} = action_input,
         source_turn_result
       ) do
    source_turn_result = scope_source_turn_result(socket, source_turn_result)

    case NovelApplication.ActionValidator.validate(action_input, source_turn_result) do
      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}

      :ok ->
        start_revision_agent_run(socket, action_input, source_turn_result)
    end
  end

  # CP4c（VS-00F §3.3 / AU-13）：审读报告逐项裁决。面板发起的作者动作，不依赖
  # turn available_actions（报告是档案对象非 turn 产物）；幂等由 author_action
  # receipt 机制承接。revise_* 返回 follow_up——前端据此回对话流发起修订意图
  # （复用 correction intent 范式），本动作只记处置不生成内容。
  defp handle_author_action(
         socket,
         %AuthorActionInput{action_type: "adjudicate_finding"} = action_input,
         _source_turn_result
       ) do
    payload = action_input.payload || %{}

    input = %{
      work_id: socket.assigns[:work_id],
      report_id: payload["report_id"],
      finding_index: payload["finding_index"],
      disposition: payload["disposition"],
      actor_ref: "author",
      note: payload["note"]
    }

    case NovelApplication.LedgerViewService.adjudicate(input) do
      {:ok, %{report: report}} ->
        result = adjudication_result(action_input, report, nil)
        socket = remember_action_result(socket, action_input, result)
        broadcast!(socket, "action_result", result)

        {:reply,
         {:ok,
          %{received: true, action_status: "applied", report_status: report.adoption_status}},
         socket}

      {:follow_up, kind, %{report: report}} ->
        result = adjudication_result(action_input, report, kind)
        socket = remember_action_result(socket, action_input, result)
        broadcast!(socket, "action_result", result)

        {:reply,
         {:ok,
          %{
            received: true,
            action_status: "applied",
            report_status: report.adoption_status,
            follow_up: to_string(kind)
          }}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  # CP4c-2（VS-00F 契约 §3.2）：显式发起全书审读——ledger_reconciliation_v1
  # AgentRun（readonly 纪律+恰一 tentative 审读报告；规则判定机械，模型只起草计划）。
  # 面板作者动作，异步于 turn 主链。
  defp handle_author_action(
         socket,
         %AuthorActionInput{action_type: "start_full_review"} = action_input,
         _source_turn_result
       ) do
    input = %{
      text: "对全书做一次审读：对照设计核查五条脉络并产出审读报告，不改动任何设定或正文。",
      workspace_id: socket.assigns[:workspace_id] || "lobby",
      work_id: socket.assigns[:work_id] || socket.assigns[:workspace_id] || "lobby",
      work_revision: current_work_revision(socket.assigns[:work_id]),
      session_id: socket.assigns[:session_id],
      turn_id: action_input.source_turn_ref,
      origin_frame_ref: "frame_#{action_input.source_turn_ref}_ledger_review"
    }

    spec =
      NovelApplication.DialoguePlanningService.run_spec_for_profile(
        :ledger_reconciliation,
        input,
        nil
      )

    case start_agent_run(spec.run_attrs, spec) do
      {:agent_run_started, run_id, attrs} ->
        LogEmit.emit(:channel, :author_action, :done, %{
          work_id: socket.assigns[:work_id],
          session_id: socket.assigns[:session_id],
          turn_id: action_input.source_turn_ref,
          action_id: action_input.action_id,
          action_type: action_input.action_type,
          action_status: :running,
          run_id: run_id
        })

        {:reply,
         {:ok,
          %{
            received: true,
            action_status: "running",
            run_id: run_id,
            turn_id: Map.get(attrs, :parent_turn_ref)
          }}, socket}

      other ->
        {:reply, {:error, %{reason: inspect(other)}}, socket}
    end
  end

  # VS-00G CP4b-2/CP4c：作品档案主动入口或主角未物化 finding 发起设定盘点——
  # fact_inventory_v1 AgentRun。finding 路径由服务端反查报告条目后记录既有
  # revise_design 处置，不信任客户端自报 rule；盘点仍只生成 tentative seed。
  defp handle_author_action(
         socket,
         %AuthorActionInput{action_type: "start_fact_inventory"} = action_input,
         _source_turn_result
       ) do
    payload = action_input.payload || %{}

    case prepare_fact_inventory_trigger(socket, payload) do
      {:ok, trigger} ->
        input = %{
          text: fact_inventory_prompt(trigger),
          workspace_id: socket.assigns[:workspace_id] || "lobby",
          work_id: socket.assigns[:work_id] || socket.assigns[:workspace_id] || "lobby",
          work_revision: current_work_revision(socket.assigns[:work_id]),
          session_id: socket.assigns[:session_id],
          turn_id: action_input.source_turn_ref,
          origin_frame_ref: "frame_#{action_input.source_turn_ref}_fact_inventory"
        }

        spec =
          NovelApplication.DialoguePlanningService.run_spec_for_profile(
            :fact_inventory,
            input,
            nil
          )

        case start_agent_run(spec.run_attrs, spec) do
          {:agent_run_started, run_id, attrs} ->
            log_fields =
              %{
                work_id: socket.assigns[:work_id],
                session_id: socket.assigns[:session_id],
                turn_id: action_input.source_turn_ref,
                action_id: action_input.action_id,
                action_type: action_input.action_type,
                action_status: :running,
                run_id: run_id
              }
              |> Map.merge(fact_inventory_trigger_log_fields(trigger))

            LogEmit.emit(:channel, :author_action, :done, log_fields)

            reply =
              %{
                received: true,
                action_status: "running",
                run_id: run_id,
                turn_id: Map.get(attrs, :parent_turn_ref)
              }
              |> Map.merge(fact_inventory_trigger_reply_fields(trigger))

            {:reply, {:ok, reply}, socket}

          other ->
            {:reply, {:error, %{reason: inspect(other)}}, socket}
        end

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  # VS-00G CP5d（§2.3 防护②）：「暂定设定」一键确认/否决——生命周期即既有
  # AdoptionStatus 状态机（确认=就地 accepted 转正，否决=discarded 停注入）。
  defp handle_author_action(
         socket,
         %AuthorActionInput{action_type: action_type} = action_input,
         _source_turn_result
       )
       when action_type in ["confirm_assumption", "discard_assumption"] do
    work_id = socket.assigns[:work_id] || socket.assigns[:workspace_id] || ""
    payload = action_input.payload || %{}
    character_ref = to_string(payload["character_ref"] || payload[:character_ref] || "")

    action_type
    |> assumption_decision(work_id, character_ref)
    |> reply_assumption_decision(socket, action_input, work_id, character_ref)
  end

  # WR01b（ADR-0024 S8）：本章使命裁决——档案大纲 tab 逐章 确认 / 改写 / 作废。
  # 只改 chapters.plan_direction["chapter_mission"]（设计态），不碰作品事实。
  defp handle_author_action(
         socket,
         %AuthorActionInput{action_type: action_type} = action_input,
         _source_turn_result
       )
       when action_type in [
              "confirm_chapter_mission",
              "rewrite_chapter_mission",
              "discard_chapter_mission"
            ] do
    work_id = socket.assigns[:work_id] || socket.assigns[:workspace_id] || ""
    payload = action_input.payload || %{}
    chapter_ref = merge_payload_field(payload, :chapter_ref)

    action_type
    |> chapter_mission_decision(work_id, chapter_ref, payload)
    |> reply_chapter_mission_decision(socket, action_input, work_id, chapter_ref)
  end

  # AU12：档案侧角色身份归并——name 不是身份主键，同名是同一人/别名/改名还是
  # 真重名只能由作者裁决；作者从档案发起 merge_characters，把 source 行并入 target 行。
  defp handle_author_action(
         socket,
         %AuthorActionInput{action_type: "merge_characters"} = action_input,
         _source_turn_result
       ) do
    work_id = socket.assigns[:work_id] || socket.assigns[:workspace_id] || ""
    payload = action_input.payload || %{}
    source_ref = merge_payload_field(payload, :source_ref)
    target_ref = merge_payload_field(payload, :target_ref)
    keep_name = merge_payload_field(payload, :keep_name, "target")

    work_id
    |> NovelApplication.CharacterIdentityService.merge(source_ref, target_ref, keep_name)
    |> reply_character_merge(socket, action_input, work_id, source_ref, target_ref)
  end

  defp handle_author_action(socket, action_input, source_turn_result) do
    handle_dialogue_gateway_action(socket, action_input, source_turn_result)
  end

  defp merge_payload_field(payload, key, default \\ "") do
    to_string(payload[to_string(key)] || payload[key] || default)
  end

  defp reply_character_merge({:ok, merged}, socket, action_input, work_id, source_ref, target_ref) do
    LogEmit.emit(:channel, :author_action, :done, %{
      work_id: work_id,
      session_id: socket.assigns[:session_id],
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      action_status: :applied,
      source_ref: source_ref,
      target_ref: target_ref,
      merged_name: merged.target.name,
      merged_alias_count: length(merged.target.aliases)
    })

    {:reply,
     {:ok,
      %{
        received: true,
        action_status: "applied",
        target: merged.target,
        superseded_ref: merged.superseded_ref
      }}, socket}
  end

  defp reply_character_merge({:error, reason}, socket, action_input, work_id, _source, _target) do
    LogEmit.emit(:channel, :author_action, :error, %{
      work_id: work_id,
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      reason_code: :character_merge_failed,
      outcome_detail: inspect(reason)
    })

    {:reply, {:error, %{reason: reason_text(reason)}}, socket}
  end

  defp chapter_mission_decision("confirm_chapter_mission", work_id, chapter_ref, _payload),
    do: NovelApplication.ChapterMissionDecisionService.confirm(work_id, chapter_ref)

  defp chapter_mission_decision("discard_chapter_mission", work_id, chapter_ref, _payload),
    do: NovelApplication.ChapterMissionDecisionService.discard(work_id, chapter_ref)

  defp chapter_mission_decision("rewrite_chapter_mission", work_id, chapter_ref, payload),
    do: NovelApplication.ChapterMissionDecisionService.rewrite(work_id, chapter_ref, payload)

  defp reply_chapter_mission_decision({:ok, decision}, socket, action_input, work_id, chapter_ref) do
    LogEmit.emit(:channel, :author_action, :done, %{
      work_id: work_id,
      session_id: socket.assigns[:session_id],
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      action_status: :applied,
      chapter_ref: chapter_ref,
      chapter_seq: decision.chapter_seq,
      mission_status: decision.mission_status
    })

    {:reply,
     {:ok,
      %{
        received: true,
        action_status: "applied",
        chapter_ref: chapter_ref,
        chapter_seq: decision.chapter_seq,
        mission_status: decision.mission_status,
        mission: decision.mission
      }}, socket}
  end

  defp reply_chapter_mission_decision({:error, reason}, socket, action_input, work_id, _ref) do
    LogEmit.emit(:channel, :author_action, :error, %{
      work_id: work_id,
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      reason_code: :chapter_mission_decision_failed,
      outcome_detail: inspect(reason)
    })

    {:reply, {:error, %{reason: reason_text(reason)}}, socket}
  end

  defp assumption_decision("confirm_assumption", work_id, character_ref),
    do: NovelApplication.AssumptionService.confirm(work_id, character_ref)

  defp assumption_decision("discard_assumption", work_id, character_ref),
    do: NovelApplication.AssumptionService.discard(work_id, character_ref)

  defp reply_assumption_decision({:ok, assumption}, socket, action_input, work_id, character_ref) do
    LogEmit.emit(:channel, :author_action, :done, %{
      work_id: work_id,
      session_id: socket.assigns[:session_id],
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      action_status: :applied,
      character_ref: character_ref,
      assumption_status: assumption.status
    })

    {:reply,
     {:ok,
      %{
        received: true,
        action_status: "applied",
        character_ref: character_ref,
        assumption_status: assumption.status
      }}, socket}
  end

  defp reply_assumption_decision({:error, reason}, socket, action_input, work_id, _character_ref) do
    LogEmit.emit(:channel, :author_action, :error, %{
      work_id: work_id,
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      reason_code: :assumption_decision_failed,
      outcome_detail: inspect(reason)
    })

    {:reply, {:error, %{reason: reason_text(reason)}}, socket}
  end

  defp adjudication_result(action_input, report, follow_up) do
    %{
      action_id: action_input.action_id,
      action_type: "adjudicate_finding",
      status: "applied",
      turn_id: action_input.source_turn_ref,
      report_id: report.id,
      report_status: report.adoption_status,
      follow_up: follow_up && to_string(follow_up)
    }
  end

  defp prepare_fact_inventory_trigger(_socket, %{"trigger_type" => nil}), do: {:ok, nil}

  defp prepare_fact_inventory_trigger(_socket, payload) when map_size(payload) == 0,
    do: {:ok, nil}

  defp prepare_fact_inventory_trigger(socket, %{"trigger_type" => "finding"} = payload) do
    binding = %{
      work_id: socket.assigns[:work_id],
      report_id: payload["report_id"],
      finding_index: payload["finding_index"]
    }

    with {:ok, %{finding: finding}} <-
           NovelApplication.LedgerViewService.active_finding(binding),
         :ok <- ensure_fact_inventory_finding(payload["finding_rule"], finding),
         {:follow_up, :revise_design, %{report: report}} <-
           NovelApplication.LedgerViewService.adjudicate(
             Map.merge(binding, %{
               disposition: "revise_design",
               actor_ref: "author",
               note: "从审读 finding 发起设定盘点"
             })
           ) do
      {:ok,
       %{
         type: "finding",
         report_id: report.id,
         report_status: report.adoption_status,
         finding_index: payload["finding_index"],
         rule: finding["rule"],
         signal: finding["signal"]
       }}
    else
      {:ok, _result} -> {:error, :finding_disposition_did_not_request_inventory}
      {:follow_up, other, _result} -> {:error, {:unexpected_finding_follow_up, other}}
      {:error, reason} -> {:error, reason}
    end
  end

  defp prepare_fact_inventory_trigger(_socket, %{"trigger_type" => other}),
    do: {:error, {:unsupported_fact_inventory_trigger, other}}

  defp prepare_fact_inventory_trigger(_socket, %{}), do: {:ok, nil}

  defp ensure_fact_inventory_finding(client_rule, finding) do
    actual_rule = finding["rule"]

    cond do
      client_rule != actual_rule ->
        {:error, {:finding_rule_mismatch, client_rule, actual_rule}}

      actual_rule != "protagonist_undermaterialized" ->
        {:error, {:finding_does_not_start_inventory, actual_rule}}

      finding["proposed_disposition"] != "revise_design" ->
        {:error,
         {:finding_disposition_mismatch, finding["proposed_disposition"], "revise_design"}}

      true ->
        :ok
    end
  end

  defp fact_inventory_prompt(nil) do
    "从当前作品已采纳正文与摘要中盘点事实上已经存在的角色、世界规则和伏笔，整理为待采纳提案；不要直接写入作品档案。"
  end

  defp fact_inventory_prompt(%{type: "finding", signal: signal}) do
    "审读发现「#{signal}」。从当前作品已采纳正文与摘要中发起设定盘点，优先识别实际主角及主角团，同时整理世界规则和伏笔为待采纳提案；不要直接写入作品档案。"
  end

  defp fact_inventory_trigger_log_fields(nil), do: %{}

  defp fact_inventory_trigger_log_fields(trigger) do
    %{
      trigger_type: trigger.type,
      trigger_report_id: trigger.report_id,
      trigger_finding_index: trigger.finding_index,
      trigger_rule: trigger.rule
    }
  end

  defp fact_inventory_trigger_reply_fields(nil), do: %{}

  defp fact_inventory_trigger_reply_fields(trigger) do
    %{
      trigger_type: trigger.type,
      trigger_report_id: trigger.report_id,
      trigger_finding_index: trigger.finding_index,
      trigger_rule: trigger.rule,
      report_status: trigger.report_status
    }
  end

  defp route_adoption_confirmation(socket, action_input, source_turn_result, draft_turn) do
    scoped_source = scope_source_turn_result(socket, source_turn_result)

    case NovelApplication.ActionValidator.validate(action_input, scoped_source) do
      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}

      :ok ->
        params = %{
          "artifact_id" => action_input.target_ref,
          "work_id" => socket.assigns[:work_id],
          "session_id" => socket.assigns[:session_id],
          "source_turn_ref" => action_input.source_turn_ref
        }

        scoped_draft = scope_source_turn_result(socket, draft_turn)
        result = run_adoption_confirmation(action_input.action_type, scoped_draft, params)
        finish_adoption_author_action(socket, action_input, result)
    end
  end

  defp run_adoption_confirmation("confirm_before_execute", scoped_draft, params) do
    NovelApplication.AdoptionWorkflow.handle_adopt(
      scoped_draft,
      Map.put(params, "confirmation_satisfied", true)
    )
  end

  defp run_adoption_confirmation("reject_or_cancel_confirmation", scoped_draft, params) do
    NovelApplication.AdoptionWorkflow.handle_confirmation_reject(scoped_draft, params)
  end

  defp adoption_confirmation_source(socket, %AuthorActionInput{target_ref: target_ref})
       when is_binary(target_ref) do
    case source_turn_for_artifact_action(socket, nil, target_ref) do
      {_ref, draft_turn} when is_map(draft_turn) ->
        if pending_artifact?(draft_turn, target_ref),
          do: {:adoption, draft_turn},
          else: :not_adoption

      _ ->
        :not_adoption
    end
  end

  defp adoption_confirmation_source(_socket, _action_input), do: :not_adoption

  defp handle_dialogue_gateway_action(socket, action_input, source_turn_result) do
    source_turn_result = scope_source_turn_result(socket, source_turn_result)

    case NovelApplication.DialogueGateway.handle_action(action_input, source_turn_result) do
      {:ok, result} ->
        socket = remember_action_result(socket, action_input, result)
        broadcast!(socket, "action_result", result)
        log_author_action_done(socket, action_input, result)
        {:reply, {:ok, %{received: true, action_status: result.status}}, socket}

      {:ok, result, turn_result} ->
        # Confirmation re-gate dispatched a tool — broadcast both ack + new turn
        turn_result = scope_turn_result(socket, turn_result)
        socket = remember_action_result(socket, action_input, result)
        broadcast!(socket, "action_result", result)
        broadcast!(socket, "turn_result", turn_result)
        socket = remember_turn_result(socket, turn_result)
        record_action_turn_result(socket, turn_result)
        record_action_decision_trace(socket, turn_result)
        log_author_action_done(socket, action_input, result)
        {:reply, {:ok, %{received: true, action_status: result.status}}, socket}

      {:error, reason} ->
        LogEmit.emit(:channel, :author_action, :error, %{
          work_id: socket.assigns[:work_id],
          session_id: socket.assigns[:session_id],
          turn_id: action_input.source_turn_ref,
          action_id: action_input.action_id,
          action_type: action_input.action_type,
          reason_code: :dialogue_gateway_rejected,
          outcome_detail: reason
        })

        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  defp start_revision_agent_run(socket, action_input, source_turn_result) do
    trigger = revision_agent_run_trigger(action_input)

    input = %{
      text: "按质量发现重写正文草稿",
      workspace_id: socket.assigns[:workspace_id] || "lobby",
      work_id: socket.assigns[:work_id] || socket.assigns[:workspace_id] || "lobby",
      work_revision: current_work_revision(socket.assigns[:work_id]),
      session_id: socket.assigns[:session_id],
      turn_id: action_input.source_turn_ref,
      origin_frame_ref: "frame_#{action_input.source_turn_ref}_revision",
      source_turn_result: source_turn_result,
      action_input: action_input,
      memory_recorder: NovelApplication.persistence_interaction_recorder(),
      trigger: trigger
    }

    spec =
      NovelApplication.DialoguePlanningService.run_spec_for_profile(
        :prose_revision_from_findings,
        input,
        nil
      )

    case start_agent_run(spec.run_attrs, spec) do
      {:agent_run_started, run_id, attrs} ->
        run_mode = run_mode_string(attrs)

        result = %{
          action_id: action_input.action_id,
          action_type: action_input.action_type,
          idempotency_key: action_input.idempotency_key,
          status: "running",
          receipt_id: trigger.receipt_id,
          run_id: run_id,
          run_mode: run_mode,
          long_run_task_ref: Map.get(attrs, :long_run_task_ref),
          turn_id: Map.get(attrs, :parent_turn_ref),
          source_turn_ref: trigger.source_turn_ref,
          source_surface_ref: trigger.source_surface_ref,
          target_artifact_ref: trigger.target_artifact_ref,
          profile_ref: Map.get(attrs, :profile_ref),
          goal: Map.get(attrs, :goal),
          trigger: trigger
        }

        socket = remember_action_result(socket, action_input, result)

        LogEmit.emit(:channel, :author_action, :done, %{
          work_id: socket.assigns[:work_id],
          session_id: socket.assigns[:session_id],
          turn_id: action_input.source_turn_ref,
          action_id: action_input.action_id,
          action_type: action_input.action_type,
          action_status: :running,
          run_id: run_id,
          run_mode: run_mode,
          candidate_ref: action_input.candidate_ref,
          candidate_set_ref: action_input.candidate_set_ref
        })

        broadcast!(socket, "action_result", result)
        {:reply, {:ok, author_action_ack(result)}, socket}

      {:error, reason} ->
        LogEmit.emit(:channel, :author_action, :error, %{
          work_id: socket.assigns[:work_id],
          session_id: socket.assigns[:session_id],
          turn_id: action_input.source_turn_ref,
          action_id: action_input.action_id,
          action_type: action_input.action_type,
          reason_code: :agent_run_start_failed,
          outcome_detail: inspect(reason)
        })

        {:reply, {:error, %{reason: reason_text(reason)}}, socket}
    end
  end

  defp revision_agent_run_trigger(action_input) do
    quality_finding_refs =
      action_input
      |> action_payload("quality_finding_refs")
      |> case do
        refs when is_list(refs) ->
          refs
          |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
          |> Enum.uniq()

        _other ->
          []
      end

    %{
      kind: "author_action",
      receipt_id: action_input.input_id,
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      source_turn_ref: action_input.source_turn_ref,
      source_surface_ref: "quality_review:#{action_input.source_turn_ref}",
      target_artifact_ref: action_input.target_ref,
      quality_finding_refs: quality_finding_refs
    }
  end

  defp author_action_ack(result, opts \\ []) do
    result
    |> Map.take([
      :receipt_id,
      :run_id,
      :run_mode,
      :long_run_task_ref,
      :turn_id,
      :source_turn_ref,
      :source_surface_ref,
      :target_artifact_ref,
      :profile_ref,
      :goal,
      :trigger
    ])
    |> Map.put(:received, true)
    |> Map.put(:action_status, result.status)
    |> maybe_put_duplicate(Keyword.get(opts, :duplicate, false))
  end

  defp maybe_put_duplicate(ack, true), do: Map.put(ack, :duplicate, true)
  defp maybe_put_duplicate(ack, false), do: ack

  defp finish_adoption_author_action(socket, action_input, {:ok, action_result, turn_result}) do
    turn_result = scope_turn_result(socket, turn_result)
    socket = remember_action_result(socket, action_input, action_result)
    notify_active_run_of_adoption(socket, action_input, action_result)
    broadcast!(socket, "action_result", action_result)
    broadcast!(socket, "turn_result", turn_result)
    socket = remember_turn_result(socket, turn_result)
    record_action_turn_result(socket, turn_result)
    record_action_decision_trace(socket, turn_result)
    log_author_action_done(socket, action_input, action_result)
    {:reply, {:ok, %{received: true, action_status: action_result.status}}, socket}
  end

  defp finish_adoption_author_action(socket, action_input, {:error, reason}) do
    LogEmit.emit(:channel, :author_action, :error, %{
      work_id: socket.assigns[:work_id],
      session_id: socket.assigns[:session_id],
      turn_id: action_input.source_turn_ref,
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      reason_code: :adoption_rejected,
      outcome_detail: reason
    })

    {:reply, {:error, %{reason: reason}}, socket}
  end

  # M0 缺陷修复（2026-07-19）：accept 采纳成功后通知活跃 run（若有）——作者采纳
  # 是单候选循环的收束信号。run 侧对非 pending 引用无害 no-op，此处不做精确归属判定。
  defp notify_active_run_of_adoption(
         socket,
         %AuthorActionInput{action_type: type} = action_input,
         action_result
       )
       when type in ["accept", "edit_then_accept"] do
    run_id = socket.assigns[:active_agent_run_id]

    if is_binary(run_id) and action_result.status in [:accepted, "accepted"] and
         is_binary(action_input.target_ref) do
      _ = AgentRunService.notify_artifact_resolved(run_id, action_input.target_ref)
    end

    :ok
  end

  defp notify_active_run_of_adoption(_socket, _action_input, _action_result), do: :ok

  defp action_payload(%AuthorActionInput{payload: payload}, key) when is_map(payload) do
    Map.get(payload, key) || Map.get(payload, to_string(key))
  end

  defp action_payload(_action_input, _key), do: nil

  defp log_author_action_done(socket, action_input, result) do
    LogEmit.emit(:channel, :author_action, :done, %{
      work_id: socket.assigns[:work_id],
      session_id: socket.assigns[:session_id],
      turn_id: action_input.source_turn_ref,
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      action_status: result.status,
      candidate_ref: action_input.candidate_ref,
      candidate_set_ref: action_input.candidate_set_ref
    })
  end

  defp remember_action_result(socket, action_input, result) do
    case NovelApplication.ActionIdempotencyService.record(
           action_input,
           action_idempotency_scope(socket),
           result
         ) do
      :ok ->
        :ok

      {:error, reason} ->
        LogEmit.emit(:channel, :author_action, :error, %{
          work_id: socket.assigns[:work_id],
          session_id: socket.assigns[:session_id],
          turn_id: action_input.source_turn_ref,
          action_id: action_input.action_id,
          action_type: action_input.action_type,
          reason_code: :idempotency_receipt_failed,
          outcome_detail: inspect(reason)
        })
    end

    ledger =
      NovelApplication.ActionIdempotencyLedger.record(
        socket.assigns[:action_idempotency_ledger],
        action_input,
        action_idempotency_scope(socket),
        result
      )

    assign(socket, :action_idempotency_ledger, ledger)
  end

  defp lookup_author_action_receipt(socket, action_input) do
    scope = action_idempotency_scope(socket)

    case NovelApplication.ActionIdempotencyService.lookup(action_input, scope) do
      {:duplicate, entry} ->
        {:duplicate, entry}

      :miss ->
        NovelApplication.ActionIdempotencyLedger.lookup(
          socket.assigns[:action_idempotency_ledger],
          action_input,
          scope
        )
    end
  end

  defp action_idempotency_scope(socket) do
    %{
      work_id: socket.assigns[:work_id],
      session_id: socket.assigns[:session_id]
    }
  end

  defp archive_work_id(payload, socket) do
    socket.assigns[:work_id] || Map.get(payload, "work_id") || "lobby"
  end

  defp handle_adopt_result(result, socket, artifact_id, t0) do
    case result do
      {:ok, action_result, turn_result} ->
        broadcast!(socket, "action_result", action_result)
        broadcast!(socket, "turn_result", turn_result)
        record_action_turn_result(socket, turn_result)
        record_action_decision_trace(socket, turn_result)
        socket = remember_turn_result(socket, turn_result)
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:channel, :adopt, :done, %{
          duration_ms: duration,
          artifact_id: artifact_id,
          artifact_type: action_result[:artifact_type],
          action_status: action_result.status,
          persisted: get_in(action_result, [:persistence, :persisted]) == true,
          mutation_id: get_in(action_result, [:persistence, :mutation_id]),
          reading_projection_materialized:
            not is_nil(get_in(action_result, [:persistence, :reading_projection]))
        })

        {:reply, {:ok, %{received: true, action_status: action_result.status}}, socket}

      {:error, reason} ->
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:channel, :adopt, :error, %{
          duration_ms: duration,
          artifact_id: artifact_id,
          reason_code: :adoption_rejected,
          outcome_detail: reason
        })

        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  defp handle_discard_result(result, socket, artifact_id, t0) do
    case result do
      {:ok, action_result, turn_result} ->
        broadcast!(socket, "action_result", action_result)
        broadcast!(socket, "turn_result", turn_result)
        record_action_turn_result(socket, turn_result)
        record_action_decision_trace(socket, turn_result)
        socket = remember_turn_result(socket, turn_result)
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:channel, :discard, :done, %{
          duration_ms: duration,
          artifact_id: artifact_id,
          action_status: action_result.status
        })

        {:reply, {:ok, %{received: true, action_status: action_result.status}}, socket}

      {:error, reason} ->
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:channel, :discard, :error, %{
          duration_ms: duration,
          artifact_id: artifact_id,
          reason_code: :discard_rejected,
          outcome_detail: reason
        })

        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  defp handle_modify_draft_result(result, socket, artifact_id, t0) do
    case result do
      {:ok, action_result, turn_result} ->
        broadcast!(socket, "action_result", action_result)
        broadcast!(socket, "turn_result", turn_result)
        record_action_turn_result(socket, turn_result)
        record_action_decision_trace(socket, turn_result)
        socket = remember_turn_result(socket, turn_result)
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:channel, :modify_draft, :done, %{
          duration_ms: duration,
          artifact_id: artifact_id,
          action_status: action_result.status
        })

        {:reply, {:ok, %{received: true, action_status: action_result.status}}, socket}

      {:error, reason} ->
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:channel, :modify_draft, :error, %{
          duration_ms: duration,
          artifact_id: artifact_id,
          reason_code: :modify_draft_rejected,
          outcome_detail: reason
        })

        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  defp handle_valid_user_message(socket, params) do
    LogContext.put_turn(params.ws_id, params.work_id, params.turn_id, params.session_id)

    input = %{
      text: params.text,
      workspace_id: params.ws_id,
      work_id: params.work_id,
      work_revision: current_work_revision(params.work_id),
      session_id: params.session_id,
      turn_id: params.turn_id,
      generate_micro_plan: params.generate_plan,
      candidate_selection: params.candidate_selection
    }

    t0 = System.monotonic_time(:millisecond)

    LogEmit.emit(:channel, :user_message, :start, %{
      workspace_id: params.ws_id,
      work_id: params.work_id,
      session_id: params.session_id,
      generate_micro_plan: params.generate_plan,
      candidate_ref: candidate_ref(params.candidate_selection),
      candidate_source_turn_ref: candidate_source_turn_ref(params.candidate_selection),
      text_len: byte_size(params.text)
    })

    result =
      case plan_agent_run(input) do
        {:agent_run_started, run_id, attrs} -> {:agent_run_started, run_id, attrs, socket}
        {:error, reason} -> {:error, reason, socket}
      end

    duration = System.monotonic_time(:millisecond) - t0

    reply_user_message_result(result, params.session_id, duration)
  end

  defp plan_agent_run(input) do
    fetcher = NovelApplication.persistence_fetcher()
    persister = NovelApplication.persistence_tracer()
    recorder = NovelApplication.persistence_interaction_recorder()

    input =
      input
      |> Map.put(:trace_persister, persister)
      |> Map.put(:memory_recorder, recorder)

    case DialoguePlanningService.plan_agent_run(input, fetcher) do
      {:ok, %{decision: %{decision_type: :allow_agent_run}, run_attrs: attrs} = spec} ->
        start_agent_run(attrs, spec)

      {:ok, _planned} ->
        {:error, :agent_run_not_allowed}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp start_agent_run(attrs, spec) when is_map(spec) do
    channel_pid = self()
    run_mode = normalize_run_mode(Map.get(attrs, :run_mode) || Map.get(attrs, "run_mode"))
    runtime_opts = agent_run_runtime_opts(spec)

    start_fun =
      if run_mode == :durable,
        do: &AgentRunService.start_durable/2,
        else: &AgentRunService.start_bounded/2

    case start_fun.(
           Map.put(attrs, :run_mode, run_mode),
           runtime_opts ++
             [
               event_sink: fn event -> send(channel_pid, {:agent_event, event}) end
             ]
         ) do
      {:ok, run_id} ->
        attrs =
          attrs
          |> Map.put(:run_mode, run_mode)
          |> put_runtime_agent_refs(run_id)

        {:agent_run_started, run_id, attrs}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp normalize_run_mode(:durable), do: :durable
  defp normalize_run_mode("durable"), do: :durable
  defp normalize_run_mode(_mode), do: :bounded

  defp agent_run_runtime_opts(%{} = spec) do
    [
      next_step_planner: Map.get(spec, :next_step_planner)
    ]
    |> Enum.reject(fn
      {:next_step_planner, nil} -> true
      {_key, _value} -> false
    end)
  end

  defp put_runtime_agent_refs(attrs, run_id) do
    case AgentRunService.state(run_id) do
      {:ok, %{run: run}} ->
        Map.put(attrs, :long_run_task_ref, run.long_run_task_ref)

      {:error, _reason} ->
        attrs
    end
  end

  defp reply_user_message_result(
         {:agent_run_started, run_id, attrs, socket},
         session_id,
         duration
       ) do
    socket = assign(socket, :active_agent_run_id, run_id)

    LogEmit.emit(:channel, :user_message, :done, %{
      duration_ms: duration,
      session_id: session_id,
      run_id: run_id,
      run_mode: Map.get(attrs, :run_mode, :bounded)
    })

    run_mode = run_mode_string(attrs)

    {:reply,
     {:ok,
      %{
        received: true,
        run_id: run_id,
        run_mode: run_mode,
        long_run_task_ref: Map.get(attrs, :long_run_task_ref),
        turn_id: Map.get(attrs, :parent_turn_ref),
        profile_ref: Map.get(attrs, :profile_ref),
        goal: Map.get(attrs, :goal)
      }}, socket}
  end

  defp reply_user_message_result({:error, reason, socket}, _session_id, duration) do
    LogEmit.emit(:channel, :user_message, :error, %{
      duration_ms: duration,
      reason_code: reason
    })

    {:reply, {:error, %{reason: reason_text(reason)}}, socket}
  end

  defp run_mode_string(attrs) do
    attrs
    |> Map.get(:run_mode, :bounded)
    |> normalize_run_mode()
    |> Atom.to_string()
  end

  defp validate_candidate_selection(_socket, nil), do: {:ok, nil}

  defp validate_candidate_selection(socket, %{} = selection) do
    source_turn_ref = selection["source_turn_ref"]
    candidate_ref = selection["candidate_ref"]

    turn_result =
      source_turn_ref && Map.get(socket.assigns[:turn_results_by_id] || %{}, source_turn_ref)

    cond do
      !is_binary(source_turn_ref) or !is_binary(candidate_ref) ->
        {:error, "candidate selection missing source_turn_ref or candidate_ref"}

      is_nil(turn_result) ->
        {:error, "candidate source turn not found"}

      candidate_direction?(turn_result, candidate_ref) ->
        {:ok,
         %{
           source_turn_ref: source_turn_ref,
           candidate_set_ref: selection["candidate_set_ref"],
           candidate_ref: candidate_ref
         }}

      true ->
        {:error, "candidate not found in source turn"}
    end
  end

  defp validate_candidate_selection(_socket, _selection),
    do: {:error, "candidate selection must be an object"}

  defp candidate_direction?(turn_result, candidate_ref) do
    turn_result
    |> map_field(:candidate_directions)
    |> List.wrap()
    |> Enum.any?(&(map_field(&1, :direction_id) == candidate_ref))
  end

  defp candidate_ref(nil), do: nil
  defp candidate_ref(selection), do: selection[:candidate_ref] || selection["candidate_ref"]

  defp candidate_source_turn_ref(nil), do: nil

  defp candidate_source_turn_ref(selection),
    do: selection[:source_turn_ref] || selection["source_turn_ref"]

  defp remember_turn_result(socket, %{turn_id: turn_id} = turn_result) when is_binary(turn_id) do
    turn_result = scope_turn_result(socket, turn_result)
    list = [turn_result | socket.assigns[:turn_results_list] || []]
    turn_results = Map.put(socket.assigns[:turn_results_by_id] || %{}, turn_id, turn_result)

    socket
    |> assign(:turn_results_list, list)
    |> assign(:turn_results_by_id, turn_results)
    |> assign(:current_turn_id, turn_id)
  end

  defp remember_turn_result(socket, _turn_result), do: socket

  defp scope_source_turn_result(_socket, nil), do: nil

  defp scope_source_turn_result(socket, source_turn_result) when is_map(source_turn_result) do
    source_turn_result
    |> Map.put_new(:workspace_id, socket.assigns[:workspace_id])
    |> Map.put_new(:work_id, socket.assigns[:work_id])
    |> Map.put_new(:session_id, socket.assigns[:session_id])
    |> Map.put(:current_work_id, socket.assigns[:work_id])
    |> Map.put(:current_session_id, socket.assigns[:session_id])
  end

  defp scope_source_turn_result(_socket, source_turn_result), do: source_turn_result

  defp scope_turn_result(socket, turn_result) when is_map(turn_result) do
    turn_result
    |> Map.put_new(:workspace_id, socket.assigns[:workspace_id])
    |> Map.put_new(:work_id, socket.assigns[:work_id])
    |> Map.put_new(:session_id, socket.assigns[:session_id])
  end

  defp scope_turn_result(_socket, turn_result), do: turn_result

  defp record_action_turn_result(socket, %{turn_id: turn_id} = turn_result)
       when is_binary(turn_id) do
    recorder = NovelApplication.persistence_interaction_recorder()
    session_id = socket.assigns[:session_id]

    if is_function(recorder, 2) and is_binary(session_id) do
      workspace_id = socket.assigns[:work_id] || socket.assigns[:workspace_id] || "lobby"
      text = get_in(turn_result, [:assistant_message, :text]) || ""

      entry = %{
        session_id: session_id,
        turn_id: turn_id,
        role: "assistant",
        content: %{text: text, turn_result: turn_result},
        source_ref: turn_id,
        scope_ref: workspace_id,
        freshness_score: 1.0,
        importance_score: 0.5,
        replayable: true,
        retrievable: true
      }

      case recorder.(workspace_id, [entry]) do
        :ok ->
          :ok

        {:error, reason} ->
          LogEmit.emit(:channel, :persist_interaction, :error, %{
            reason_code: :persistence_failed,
            outcome_detail: inspect(reason)
          })
      end
    end
  end

  defp record_action_turn_result(_socket, _turn_result), do: :ok

  defp record_action_decision_trace(socket, %{turn_id: turn_id} = turn_result)
       when is_binary(turn_id) do
    if application_persisted_tool_trace?(turn_result) do
      :ok
    else
      persist_action_decision_trace(socket, turn_result)
    end
  end

  defp record_action_decision_trace(_socket, _turn_result), do: :ok

  defp persist_action_decision_trace(socket, turn_result) do
    tracer = NovelApplication.persistence_tracer()

    with true <- is_function(tracer, 2),
         {:ok, attrs} <- action_trace_attrs(socket, turn_result) do
      workspace_id = socket.assigns[:work_id] || socket.assigns[:workspace_id] || "lobby"
      persist_action_decision_trace(tracer, workspace_id, attrs)
    else
      _ -> :ok
    end
  end

  defp persist_action_decision_trace(tracer, workspace_id, attrs) do
    case tracer.(workspace_id, attrs) do
      :ok ->
        :ok

      {:error, reason} ->
        LogEmit.emit(:channel, :persist_trace, :error, %{
          reason_code: :persistence_failed,
          outcome_detail: inspect(reason)
        })
    end
  end

  defp application_persisted_tool_trace?(turn_result) do
    trace_summary = map_field(turn_result, :trace_summary)
    string_field(trace_summary, :decision_type, "") == "tool_dispatched"
  end

  defp action_trace_attrs(socket, turn_result) do
    trace_summary = map_field(turn_result, :trace_summary)
    trace_ref = map_field(trace_summary, :trace_ref)

    if is_binary(trace_ref) and trace_ref != "" do
      turn_id = map_field(turn_result, :turn_id)

      {:ok,
       %{
         workspace_id: socket.assigns[:work_id] || socket.assigns[:workspace_id] || "lobby",
         session_id: socket.assigns[:session_id],
         trace_id: trace_ref,
         turn_id: turn_id,
         frame_ref:
           map_field(turn_result, :frame_ref) ||
             map_field(trace_summary, :frame_ref) ||
             "author_action:#{turn_id}",
         plan_ref:
           map_field(turn_result, :plan_ref) ||
             map_field(trace_summary, :plan_ref),
         decision_type: string_field(trace_summary, :decision_type, "author_action"),
         no_tool_reason:
           string_field(trace_summary, :no_tool_reason, "author_action_does_not_call_tool"),
         no_behavior_reason:
           string_field(trace_summary, :no_behavior_reason, "author_action_resolved"),
         no_write_reason: string_field(trace_summary, :no_write_reason, "no production write"),
         turn_result_ref: turn_id,
         replay_policy:
           map_field(trace_summary, :replay_policy) ||
             %{use_recorded_frame: true, recall_provider: false},
         redaction_level: "author_safe",
         tool_trace_refs: trace_ref_list(trace_summary, :tool_trace_refs),
         behavior_trace_refs: trace_ref_list(trace_summary, :behavior_trace_refs),
         state_trace_refs: trace_ref_list(trace_summary, :state_trace_refs),
         event_order: trace_event_order(trace_summary)
       }}
    else
      :skip
    end
  end

  defp trace_ref_list(trace_summary, key) do
    trace_summary
    |> map_field(key)
    |> List.wrap()
    |> Enum.filter(&is_map/1)
  end

  defp trace_event_order(trace_summary) do
    case map_field(trace_summary, :event_order) do
      [_ | _] = events -> Enum.map(events, &to_string/1)
      _ -> ["author_action_received", "turn_result_emitted"]
    end
  end

  defp string_field(map, key, default) do
    case map_field(map, key) do
      value when is_binary(value) and value != "" -> value
      value when is_atom(value) -> Atom.to_string(value)
      value when not is_nil(value) -> to_string(value)
      _ -> default
    end
  end

  defp source_turn_result(socket, source_turn_ref, target_ref) do
    list = socket.assigns[:turn_results_list] || []
    by_id_list = Map.values(socket.assigns[:turn_results_by_id] || %{})

    find_matching_turn_result(list, source_turn_ref, target_ref) ||
      find_matching_turn_result(by_id_list, source_turn_ref, target_ref)
  end

  defp find_matching_turn_result(list, source_turn_ref, target_ref) do
    match =
      if is_binary(target_ref) and target_ref != "" do
        Enum.find(list, fn tr ->
          tid = tr[:turn_id] || tr["turn_id"]
          tid == source_turn_ref and pending_artifact?(tr, target_ref)
        end)
      end

    match || Enum.find(list, &((&1[:turn_id] || &1["turn_id"]) == source_turn_ref))
  end

  defp source_turn_result(socket, source_turn_ref),
    do: source_turn_result(socket, source_turn_ref, nil)

  defp source_turn_result(socket, source_turn_ref, action_type, target_ref) do
    result = source_turn_result(socket, source_turn_ref, target_ref)

    if action_type in @current_turn_author_action_types do
      current_turn_id = socket.assigns[:current_turn_id]

      if is_binary(current_turn_id) and source_turn_ref != current_turn_id do
        %{turn_id: current_turn_id, available_actions: []}
      else
        result
      end
    else
      result
    end
  end

  defp source_turn_for_artifact_action(socket, requested_ref, artifact_id) do
    requested_turn_result = requested_ref && source_turn_result(socket, requested_ref)

    cond do
      artifact_resolved?(socket, artifact_id) ->
        {requested_ref || socket.assigns[:current_turn_id], {:error, "artifact already resolved"}}

      pending_artifact?(requested_turn_result, artifact_id) ->
        {turn_id(requested_turn_result) || requested_ref, requested_turn_result}

      true ->
        find_source_turn_with_pending_artifact(socket, artifact_id) ||
          fallback_source_turn(socket, requested_ref)
    end
  end

  defp fallback_source_turn(socket, requested_ref) do
    source_turn_ref = requested_ref || socket.assigns[:current_turn_id]
    {source_turn_ref, source_turn_ref && source_turn_result(socket, source_turn_ref)}
  end

  defp find_source_turn_with_pending_artifact(socket, artifact_id) do
    socket.assigns
    |> Map.get(:turn_results_by_id, %{})
    |> Enum.find_value(fn {turn_id, turn_result} ->
      if pending_artifact?(turn_result, artifact_id), do: {turn_id, turn_result}
    end)
  end

  defp pending_artifact?(turn_result, artifact_id) when is_binary(artifact_id) do
    turn_result
    |> adoption_entries(:pending)
    |> Enum.any?(&(map_field(&1, :artifact_id) == artifact_id))
  end

  defp pending_artifact?(_turn_result, _artifact_id), do: false

  defp artifact_resolved?(socket, artifact_id) when is_binary(artifact_id) do
    socket.assigns
    |> Map.get(:turn_results_by_id, %{})
    |> Map.values()
    |> Enum.flat_map(&adoption_entries(&1, :resolved))
    |> Enum.any?(&(map_field(&1, :artifact_id) == artifact_id))
  end

  defp artifact_resolved?(_socket, _artifact_id), do: false

  defp adoption_entries(turn_result, key) when is_map(turn_result) do
    turn_result
    |> map_field(:adoption_state)
    |> map_field(key)
    |> List.wrap()
  end

  defp adoption_entries(_turn_result, _key), do: []

  defp turn_id(turn_result), do: map_field(turn_result, :turn_id)

  defp map_field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp map_field(_map, _key), do: nil
end
