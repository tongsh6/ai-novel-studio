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

    LogContext.put_turn(suffix, work_id)

    socket =
      socket
      |> assign(:workspace_id, suffix)
      |> assign(:work_id, work_id)
      |> assign(:session_id, session_id)
      |> assign(:turn_results_by_id, restored_turn_results)
      |> assign(:current_turn_id, latest_turn_id(restored_turn_results))

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
  def handle_in("user_message", %{"text" => text} = msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id
    session_id = socket.assigns[:session_id] || Map.get(msg, "session_id")
    generate_plan = Map.get(msg, "generate_micro_plan", false)
    turn_id = Map.get(msg, "turn_id") || "turn_#{System.unique_integer([:positive, :monotonic])}"

    LogContext.put_turn(ws_id, work_id, turn_id)

    input = %{
      text: text,
      workspace_id: ws_id,
      work_id: work_id,
      session_id: session_id,
      turn_id: turn_id,
      generate_micro_plan: generate_plan
    }

    t0 = System.monotonic_time(:millisecond)

    LogEmit.emit(:channel, :user_message, :start, %{
      workspace_id: ws_id,
      work_id: work_id,
      session_id: session_id,
      generate_micro_plan: generate_plan,
      text_len: byte_size(text)
    })

    fetcher = NovelApplication.persistence_fetcher()
    persister = NovelApplication.persistence_tracer()
    recorder = NovelApplication.persistence_interaction_recorder()

    result =
      case NovelApplication.DialogueGateway.handle_input(input, fetcher, nil, persister, recorder) do
        {:ok, turn_result, _trace, _candidates, _context} ->
          broadcast!(socket, "turn_result", turn_result)
          socket = remember_turn_result(socket, turn_result)
          {:ok, socket}

        {:error, reason} ->
          broadcast!(socket, "turn_result", fallback_turn_result(inspect(reason)))
          {:error, reason, socket}
      end

    duration = System.monotonic_time(:millisecond) - t0

    case result do
      {:ok, socket} ->
        LogEmit.emit(:channel, :user_message, :done, %{
          duration_ms: duration,
          session_id: session_id
        })

        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason, socket} ->
        LogEmit.emit(:channel, :user_message, :error, %{
          duration_ms: duration,
          reason_code: reason
        })

        {:reply, {:ok, %{received: true, note: "fallback"}}, socket}
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

    case NovelApplication.DialogueGateway.handle_action(action_input, source_turn_result) do
      {:ok, result} ->
        broadcast!(socket, "action_result", result)
        {:reply, {:ok, %{received: true, action_status: result.status}}, socket}

      {:ok, result, turn_result} ->
        # Confirmation re-gate dispatched a tool — broadcast both ack + new turn
        broadcast!(socket, "action_result", result)
        broadcast_task_state_events(socket, turn_result)
        broadcast!(socket, "turn_result", turn_result)
        socket = remember_turn_result(socket, turn_result)
        {:reply, {:ok, %{received: true, action_status: result.status}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  def handle_in("adopt", %{"artifact_id" => artifact_id} = params, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id
    source_turn_ref = Map.get(params, "source_turn_ref") || socket.assigns[:current_turn_id]

    LogContext.put_turn(ws_id, work_id, source_turn_ref)

    t0 = System.monotonic_time(:millisecond)

    LogEmit.emit(:channel, :adopt, :start, %{
      workspace_id: ws_id,
      work_id: work_id,
      artifact_id: artifact_id
    })

    source_turn_result = source_turn_ref && source_turn_result(socket, source_turn_ref)

    adopt_params =
      params
      |> Map.put("work_id", work_id)
      |> Map.put("session_id", socket.assigns[:session_id])

    case NovelApplication.AdoptionWorkflow.handle_adopt(source_turn_result, adopt_params) do
      {:ok, action_result, turn_result} ->
        broadcast!(socket, "action_result", action_result)
        broadcast!(socket, "turn_result", turn_result)
        record_action_turn_result(socket, turn_result)
        socket = remember_turn_result(socket, turn_result)
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:channel, :adopt, :done, %{
          duration_ms: duration,
          artifact_id: artifact_id,
          action_status: action_result.status,
          persisted: get_in(action_result, [:persistence, :persisted]) == true,
          mutation_id: get_in(action_result, [:persistence, :mutation_id])
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

  def handle_in("discard", %{"artifact_id" => artifact_id} = params, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id
    source_turn_ref = Map.get(params, "source_turn_ref") || socket.assigns[:current_turn_id]

    LogContext.put_turn(ws_id, work_id, source_turn_ref)

    t0 = System.monotonic_time(:millisecond)

    LogEmit.emit(:channel, :discard, :start, %{
      workspace_id: ws_id,
      work_id: work_id,
      artifact_id: artifact_id
    })

    source_turn_result = source_turn_ref && source_turn_result(socket, source_turn_ref)

    case NovelApplication.AdoptionWorkflow.handle_discard(source_turn_result, params) do
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

  def handle_in("modify_draft", params, socket) do
    artifact_id = Map.get(params, "artifact_id") || Map.get(params, "draft_id")
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id
    source_turn_ref = Map.get(params, "source_turn_ref") || socket.assigns[:current_turn_id]

    LogContext.put_turn(ws_id, work_id, source_turn_ref)

    t0 = System.monotonic_time(:millisecond)

    LogEmit.emit(:channel, :modify_draft, :start, %{
      workspace_id: ws_id,
      work_id: work_id,
      artifact_id: artifact_id
    })

    source_turn_result = source_turn_ref && source_turn_result(socket, source_turn_ref)

    modify_params =
      params
      |> Map.put("work_id", work_id)
      |> Map.put("session_id", socket.assigns[:session_id])

    case NovelApplication.AdoptionWorkflow.handle_modify_draft(source_turn_result, modify_params) do
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

  def handle_in("get_characters", _payload, socket) do
    data = [
      %{id: "char_1", name: "主角", role: "Protagonist", summary: "一个神秘的幸存者", aliases: ["老李"]}
    ]

    {:reply, {:ok, data}, socket}
  end

  def handle_in("get_foreshadowing", _payload, socket) do
    data = [
      %{id: "mem_1", type: "foreshadowing", content: "脖子后的奇异纹身", tags: ["未解之谜", "主线"]}
    ]

    {:reply, {:ok, data}, socket}
  end

  def handle_in("get_rules", _payload, socket) do
    data = [
      %{id: "rule_1", type: "rule", content: "只能在夜间使用魔法", tags: ["世界观", "战斗"]}
    ]

    {:reply, {:ok, data}, socket}
  end

  def handle_in("get_work_stats", _payload, socket) do
    data = %{
      words_total: 10_000,
      words_today: 1500,
      volumes: 1,
      chapters: 2,
      characters: 1,
      memory_items: 2,
      drafts_total: 5,
      drafts_accepted: 2
    }

    {:reply, {:ok, data}, socket}
  end

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
