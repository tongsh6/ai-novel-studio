defmodule NovelWeb.WorkspaceChannel do
  @moduledoc """
  Workspace Channel — v3 对话主通道。

  负责将 user_message / author_action 路由到 NovelApplication 主链，
  并注入真实 persistence 回调（context_fetcher + trace_persister）。
  """

  use Phoenix.Channel

  alias NovelDomain.AuthorActionInput
  alias NovelPersistence.WorkspaceContext

  @impl true
  def join("workspace:" <> suffix, _payload, socket) do
    socket = assign(socket, :workspace_id, suffix)
    {:ok, %{joined: true}, socket}
  end

  @impl true
  def handle_in("user_message", %{"text" => text} = msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    generate_plan = Map.get(msg, "generate_micro_plan", false)

    input = %{text: text, workspace_id: ws_id, generate_micro_plan: generate_plan}

    fetcher = if inject_persistence?(), do: WorkspaceContext.context_fetcher(), else: nil
    persister = if inject_persistence?(), do: WorkspaceContext.trace_persister(), else: nil

    case NovelApplication.DialogueGateway.handle_input(input, fetcher, nil, persister) do
      {:ok, turn_result, _trace, _candidates, _context} ->
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason} ->
        broadcast!(socket, "turn_result", fallback_turn_result(inspect(reason)))
        {:reply, {:ok, %{received: true, note: "fallback"}}, socket}
    end
  end

  @impl true
  def handle_in("author_action", %{"action" => action_params}, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    source_turn_result = action_params["source_turn_result"] || %{turn_id: action_params["source_turn_ref"]}

    action_input = %AuthorActionInput{
      input_id: "in_#{System.unique_integer([:positive, :monotonic])}",
      source_turn_ref: action_params["source_turn_ref"] || ws_id,
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

      {:error, reason} ->
        {:reply, {:error, %{reason: reason}}, socket}
    end
  end

  def handle_in("ping", payload, socket) do
    {:reply, {:ok, %{event: "pong", echo: payload}}, socket}
  end

  defp inject_persistence? do
    Application.get_env(:novel_web, :persistence, [])
    |> Keyword.get(:inject_real_persistence, false)
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
