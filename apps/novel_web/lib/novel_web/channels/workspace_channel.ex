defmodule NovelWeb.WorkspaceChannel do
  @moduledoc """
  Workspace Channel — v3 对话主通道。

  负责将 user_message / author_action 路由到 NovelApplication 主链，
  并注入真实 persistence 回调（context_fetcher + trace_persister + interaction_recorder）。
  """

  use Phoenix.Channel

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelApplication.WorkSessionService
  alias NovelCommon.LogContext
  alias NovelDomain.AuthorActionInput

  @impl true
  def join("workspace:" <> suffix, payload, socket) do
    work_id = resolve_join_work_id(suffix, payload)
    session_id = resolve_join_session_id(work_id, payload)
    restored_turn_results = restored_turn_results(work_id, session_id)

    LogContext.put_turn(suffix, work_id, nil, session_id)

    socket =
      socket
      |> assign(:workspace_id, suffix)
      |> assign(:work_id, work_id)
      |> assign(:session_id, session_id)
      |> assign(:turn_results_by_id, restored_turn_results)
      |> assign(:current_turn_id, latest_turn_id(restored_turn_results))
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

    {:ok, %{joined: true, work_id: work_id, session_id: session_id}, socket}
  end

  defp resolve_join_session_id(work_id, payload) do
    requested = is_map(payload) && Map.get(payload, "session_id")

    cond do
      valid_uuid?(requested) ->
        requested

      valid_uuid?(work_id) ->
        case WorkSessionService.resume(work_id) do
          {:ok, %{active_session: %{id: id}}} -> id
          _ -> nil
        end

      true ->
        nil
    end
  end

  defp restored_turn_results(work_id, session_id) do
    if valid_uuid?(work_id) and valid_uuid?(session_id) do
      turn_results_from_resume(work_id, session_id)
    else
      %{}
    end
  end

  defp turn_results_from_resume(work_id, session_id) do
    case WorkSessionService.resume(work_id) do
      {:ok, %{transcript: transcript}} ->
        LogEmit.emit(:work_session, :resume, :done, %{
          work_id: work_id,
          session_id: session_id,
          transcript_count: length(transcript),
          pending_adoption_count: count_pending_adoptions(transcript)
        })

        transcript
        |> Enum.map(& &1.turn_result)
        |> Enum.reject(&is_nil/1)
        |> Map.new(fn turn_result ->
          {turn_result[:turn_id] || turn_result["turn_id"], turn_result}
        end)

      _ ->
        %{}
    end
  end

  defp latest_turn_id(turn_results) when map_size(turn_results) == 0, do: nil
  defp latest_turn_id(turn_results), do: turn_results |> Map.keys() |> List.last()

  defp count_pending_adoptions(transcript) do
    transcript
    |> Enum.flat_map(fn entry ->
      turn_result = entry.turn_result || %{}

      get_in(turn_result, [:adoption_state, :pending]) ||
        get_in(turn_result, ["adoption_state", "pending"]) ||
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
  def handle_in("slice_verify_ui_state", %{"slice_id" => slice_id} = payload, socket) do
    if slice_verify_ui_state_enabled?() do
      record_slice_verify_ui_state(slice_id, payload, socket)
    else
      {:reply, {:error, %{reason: "slice_verify_disabled"}}, socket}
    end
  end

  @impl true
  def handle_in("user_message", %{"text" => text} = msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id
    session_id = socket.assigns[:session_id] || Map.get(msg, "session_id")
    generate_plan = Map.get(msg, "generate_micro_plan", false)
    turn_id = Map.get(msg, "turn_id") || "turn_#{System.unique_integer([:positive, :monotonic])}"

    case validate_candidate_selection(socket, Map.get(msg, "candidate_selection")) do
      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}

      {:ok, candidate_selection} ->
        handle_valid_user_message(socket, %{
          text: text,
          ws_id: ws_id,
          work_id: work_id,
          session_id: session_id,
          generate_plan: generate_plan,
          turn_id: turn_id,
          candidate_selection: candidate_selection
        })
    end
  end

  @impl true
  def handle_in("author_action", %{"action" => action_params}, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    source_turn_ref = action_params["source_turn_ref"] || ws_id

    source_turn_result = source_turn_result(socket, source_turn_ref)

    action_input = %AuthorActionInput{
      input_id: "in_#{System.unique_integer([:positive, :monotonic])}",
      source_turn_ref: source_turn_ref,
      action_id: action_params["action_id"],
      action_type: action_params["action_type"],
      behavior_ref: action_params["behavior_ref"],
      candidate_set_ref: action_params["candidate_set_ref"],
      candidate_ref: action_params["candidate_ref"],
      idempotency_key: action_params["idempotency_key"]
    }

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
        {:reply, {:ok, %{received: true, action_status: result.status, duplicate: true}}, socket}

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

  # --- Structure Panel / Reading Mode data handlers ---

  def handle_in("get_toc", payload, socket) do
    work_id = Map.get(payload, "work_id") || socket.assigns[:work_id] || "lobby"
    data = NovelApplication.ReadingProjectionService.toc(work_id)

    LogEmit.emit(:channel, :get_toc, :done, %{
      work_id: work_id,
      volume_count: length(data.volumes),
      chapter_count: data.volumes |> Enum.flat_map(& &1.chapters) |> length()
    })

    {:reply, {:ok, data}, socket}
  end

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

  defp handle_author_action(socket, action_input, source_turn_result) do
    case NovelApplication.DialogueGateway.handle_action(action_input, source_turn_result) do
      {:ok, result} ->
        socket = remember_action_result(socket, action_input, result)
        broadcast!(socket, "action_result", result)
        {:reply, {:ok, %{received: true, action_status: result.status}}, socket}

      {:ok, result, turn_result} ->
        # Confirmation re-gate dispatched a tool — broadcast both ack + new turn
        socket = remember_action_result(socket, action_input, result)
        broadcast!(socket, "action_result", result)
        broadcast_task_state_events(socket, turn_result)
        broadcast!(socket, "turn_result", turn_result)
        socket = remember_turn_result(socket, turn_result)
        {:reply, {:ok, %{received: true, action_status: result.status}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
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
    Map.get(payload, "work_id") || socket.assigns[:work_id] || "lobby"
  end

  defp handle_adopt_result(result, socket, artifact_id, t0) do
    case result do
      {:ok, action_result, turn_result} ->
        broadcast!(socket, "action_result", action_result)
        broadcast!(socket, "turn_result", turn_result)
        record_action_turn_result(socket, turn_result)
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

  defp record_slice_verify_ui_state(slice_id, payload, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id
    session_id = socket.assigns[:session_id]
    restored_turn_id = payload["restored_turn_id"]

    LogContext.put_turn(ws_id, work_id, restored_turn_id, session_id)

    LogEmit.emit(:slice_verify, :ui_state, :done, %{
      workspace_id: ws_id,
      work_id: work_id,
      session_id: session_id,
      slice_id: slice_id,
      context_work_id: payload["context_work_id"],
      context_work_title: payload["context_work_title"],
      active_session_id: payload["active_session_id"],
      restored_turn_id: restored_turn_id,
      socket_connected: payload["socket_connected"],
      message_count: payload["message_count"],
      welcome_message_count: payload["welcome_message_count"],
      pending_adoption_count: payload["pending_adoption_count"],
      first_message_text: payload["first_message_text"],
      service_status_text: payload["service_status_text"],
      title_text: payload["title_text"],
      adoption_status: payload["adoption_status"],
      artifact_type: payload["artifact_type"],
      decision_card_count: payload["decision_card_count"],
      open_reading_action_count: payload["open_reading_action_count"],
      reading_chapter_count: payload["reading_chapter_count"],
      archive_character_count: payload["archive_character_count"],
      archive_foreshadowing_count: payload["archive_foreshadowing_count"],
      archive_rule_count: payload["archive_rule_count"],
      archive_volumes: payload["archive_volumes"],
      archive_chapters: payload["archive_chapters"],
      archive_memory_items: payload["archive_memory_items"],
      archive_drafts_total: payload["archive_drafts_total"],
      archive_drafts_accepted: payload["archive_drafts_accepted"],
      archive_detail_kind: payload["archive_detail_kind"],
      archive_detail_id: payload["archive_detail_id"],
      archive_detail_title: payload["archive_detail_title"],
      initial_work_id: payload["initial_work_id"],
      created_work_id: payload["created_work_id"],
      assistant_name_after_save: payload["assistant_name_after_save"],
      assistant_role_after_save: payload["assistant_role_after_save"],
      assistant_name_in_created_work: payload["assistant_name_in_created_work"],
      assistant_name_after_return: payload["assistant_name_after_return"],
      assistant_role_after_return: payload["assistant_role_after_return"],
      trace_why_dialog_open: payload["trace_why_dialog_open"],
      trace_why_text: payload["trace_why_text"],
      trace_why_contains_raw_prompt: payload["trace_why_contains_raw_prompt"],
      frame_badge_label: payload["frame_badge_label"],
      frame_badge_kind: payload["frame_badge_kind"],
      frame_badge_goal: payload["frame_badge_goal"],
      candidate_panel_count: payload["candidate_panel_count"],
      llm_status_text: payload["llm_status_text"],
      llm_connected: payload["llm_connected"],
      llm_model_label: payload["llm_model_label"],
      ui_turn_ids: payload["ui_turn_ids"],
      user_message_count: payload["user_message_count"],
      assistant_turn_message_count: payload["assistant_turn_message_count"],
      message_role_order: payload["message_role_order"],
      thinking_observed: payload["thinking_observed"],
      thinking_visible_after_reply: payload["thinking_visible_after_reply"],
      available_action_count: payload["available_action_count"],
      card_action_count: payload["card_action_count"],
      adoption_decision_card_count: payload["adoption_decision_card_count"],
      searched_query: payload["searched_query"],
      readonly_session_id: payload["readonly_session_id"],
      readonly_banner_visible: payload["readonly_banner_visible"],
      readonly_input_disabled: payload["readonly_input_disabled"],
      readonly_send_disabled: payload["readonly_send_disabled"],
      readonly_visible_text: payload["readonly_visible_text"],
      active_session_restored: payload["active_session_restored"]
    })

    {:reply, {:ok, %{received: true}}, socket}
  end

  defp slice_verify_ui_state_enabled? do
    Application.get_env(:novel_web, :slice_verify_ui_state_enabled, false)
  end

  defp handle_valid_user_message(socket, params) do
    LogContext.put_turn(params.ws_id, params.work_id, params.turn_id, params.session_id)

    input = %{
      text: params.text,
      workspace_id: params.ws_id,
      work_id: params.work_id,
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

    result = dispatch_user_message(socket, input)
    duration = System.monotonic_time(:millisecond) - t0

    reply_user_message_result(result, params.session_id, duration)
  end

  defp dispatch_user_message(socket, input) do
    fetcher = NovelApplication.persistence_fetcher()
    persister = NovelApplication.persistence_tracer()
    recorder = NovelApplication.persistence_interaction_recorder()

    case NovelApplication.DialogueGateway.handle_input(input, fetcher, nil, persister, recorder) do
      {:ok, turn_result, _trace, _candidates, _context} ->
        broadcast!(socket, "turn_result", turn_result)
        socket = remember_turn_result(socket, turn_result)
        {:ok, socket}

      {:error, reason} ->
        broadcast!(socket, "turn_result", fallback_turn_result(inspect(reason)))
        {:error, reason, socket}
    end
  end

  defp reply_user_message_result({:ok, socket}, session_id, duration) do
    LogEmit.emit(:channel, :user_message, :done, %{
      duration_ms: duration,
      session_id: session_id
    })

    {:reply, {:ok, %{received: true}}, socket}
  end

  defp reply_user_message_result({:error, reason, socket}, _session_id, duration) do
    LogEmit.emit(:channel, :user_message, :error, %{
      duration_ms: duration,
      reason_code: reason
    })

    {:reply, {:ok, %{received: true, note: "fallback"}}, socket}
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
    turn_results = Map.put(socket.assigns[:turn_results_by_id] || %{}, turn_id, turn_result)

    socket
    |> assign(:turn_results_by_id, turn_results)
    |> assign(:current_turn_id, turn_id)
  end

  defp remember_turn_result(socket, _turn_result), do: socket

  defp broadcast_task_state_events(socket, %{task_state_events: events}) when is_list(events) do
    Enum.each(events, &broadcast!(socket, "task_state", &1))
  end

  defp broadcast_task_state_events(_socket, _turn_result), do: :ok

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

  defp source_turn_result(socket, source_turn_ref) do
    current_turn_id = socket.assigns[:current_turn_id]
    turn_results = Map.get(socket.assigns, :turn_results_by_id, %{})

    cond do
      is_map_key(turn_results, source_turn_ref) ->
        Map.get(turn_results, source_turn_ref)

      is_nil(current_turn_id) ->
        nil

      source_turn_ref != current_turn_id ->
        %{turn_id: current_turn_id, available_actions: []}

      true ->
        Map.get(turn_results, source_turn_ref)
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

  defp fallback_turn_result(reason) do
    %{
      schema_version: "3.0-draft",
      assistant_message: %{text: "抱歉，处理你的消息时出现了问题。请稍后再试。"},
      phase: "completed",
      status: "error",
      error: reason,
      available_actions: []
    }
  end
end
