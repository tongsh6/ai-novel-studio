defmodule NovelWeb.WorkspaceChannel do
  @moduledoc """
  Workspace Channel — v3 对话主通道。

  负责将 user_message / author_action 路由到 NovelApplication 主链，
  并注入真实 persistence 回调（context_fetcher + trace_persister + interaction_recorder）。
  """

  use Phoenix.Channel

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelCommon.LogContext
  alias NovelDomain.AuthorActionInput

  @impl true
  def join("workspace:" <> suffix, payload, socket) do
    work_id = (is_map(payload) && Map.get(payload, "work_id")) || suffix

    LogContext.put_turn(suffix, work_id)

    socket =
      socket
      |> assign(:workspace_id, suffix)
      |> assign(:work_id, work_id)
      |> assign(:turn_results_by_id, %{})
      |> assign(:current_turn_id, nil)

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

    LogEmit.emit(:channel, :join, :done, %{workspace_id: suffix, work_id: work_id})

    {:ok, %{joined: true, work_id: work_id}, socket}
  end

  @impl true
  def handle_in("user_message", %{"text" => text} = msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    work_id = socket.assigns[:work_id] || ws_id
    generate_plan = Map.get(msg, "generate_micro_plan", false)

    input = %{
      text: text,
      workspace_id: ws_id,
      work_id: work_id,
      generate_micro_plan: generate_plan
    }

    t0 = System.monotonic_time(:millisecond)
    LogEmit.emit(:channel, :user_message, :start, %{workspace_id: ws_id, work_id: work_id, text_len: byte_size(text)})

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
        LogEmit.emit(:channel, :user_message, :done, %{duration_ms: duration})
        {:reply, {:ok, %{received: true}}, socket}
      {:error, reason, socket} ->
        LogEmit.emit(:channel, :user_message, :error, %{duration_ms: duration, reason_code: reason})
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
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true, action_status: result.status}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  def handle_in("ping", payload, socket) do
    {:reply, {:ok, %{event: "pong", echo: payload}}, socket}
  end

  # --- Mock Handlers for Structure Panel ---

  def handle_in("get_toc", _payload, socket) do
    data = %{
      work_id: "mock_work",
      volumes: [
        %{
          id: "vol_1",
          title: "第一卷：起源",
          chapters: [
            %{id: "ch_1", title: "第一章：苏醒"},
            %{id: "ch_2", title: "第二章：危机"}
          ]
        }
      ]
    }

    {:reply, {:ok, data}, socket}
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

  defp source_turn_result(socket, source_turn_ref) do
    current_turn_id = socket.assigns[:current_turn_id]

    cond do
      is_nil(current_turn_id) ->
        nil

      source_turn_ref != current_turn_id ->
        %{turn_id: current_turn_id, available_actions: []}

      true ->
        socket.assigns
        |> Map.get(:turn_results_by_id, %{})
        |> Map.get(source_turn_ref)
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
