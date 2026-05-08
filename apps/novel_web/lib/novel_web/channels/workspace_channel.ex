defmodule NovelWeb.WorkspaceChannel do
  @moduledoc """
  Workspace Channel — v3 对话主通道。

  VS-00 只支持 user_message（reply-only）。后续 slice 逐步恢复 adopt/confirm/discard 等操作。
  """

  use Phoenix.Channel

  @impl true
  def join("workspace:" <> suffix, _payload, socket) do
    socket = assign(socket, :workspace_id, suffix)
    {:ok, %{joined: true}, socket}
  end

  @impl true
  def handle_in("user_message", %{"text" => text} = _msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"

    case NovelApplication.DialogueGateway.handle_input(%{text: text, workspace_id: ws_id}) do
      {:ok, turn_result, _trace, _candidates, _context} ->
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason} ->
        broadcast!(socket, "turn_result", fallback_turn_result(inspect(reason)))
        {:reply, {:ok, %{received: true, note: "fallback"}}, socket}
    end
  end

  def handle_in("ping", payload, socket) do
    {:reply, {:ok, %{event: "pong", echo: payload}}, socket}
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
