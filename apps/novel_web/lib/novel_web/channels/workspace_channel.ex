defmodule NovelWeb.WorkspaceChannel do
  @moduledoc """
  Workspace Channel — 用户对话主通道。

  Phase 0 Week 4：处理 user_message / adopt 事件，集成 TurnService。
  """

  use Phoenix.Channel

  alias NovelApplication.TurnService

  @impl true
  @spec join(String.t(), map(), Phoenix.Socket.t()) :: {:ok, map(), Phoenix.Socket.t()}
  def join("workspace:" <> suffix, _payload, socket) do
    socket = assign(socket, :workspace_id, suffix)
    {:ok, %{joined: true}, socket}
  end

  @impl true
  def handle_in("user_message", %{"text" => text}, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    turn_result = TurnService.handle_message(text, ws_id)
    broadcast!(socket, "turn_result", turn_result)
    {:reply, {:ok, %{received: true}}, socket}
  end

  def handle_in("adopt", %{"artifact_id" => artifact_id} = msg, socket) do
    ws_id = socket.assigns[:workspace_id] || "lobby"
    base_revision = parse_base_revision(Map.get(msg, "base_revision"))

    mutation_attrs = %{
      actor_ref: Map.get(msg, "actor_ref", "user"),
      target_scope: Map.get(msg, "target_scope", "work"),
      target_object_ref: artifact_id
    }

    case TurnService.handle_adopt(artifact_id, base_revision, mutation_attrs, ws_id) do
      {:ok, turn_result} ->
        broadcast!(socket, "turn_result", turn_result)
        {:reply, {:ok, %{received: true}}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  def handle_in("ping", payload, socket) do
    {:reply, {:ok, %{event: "pong", echo: payload}}, socket}
  end

  defp parse_base_revision(value) when is_integer(value), do: value

  defp parse_base_revision(value) when is_binary(value) do
    case Integer.parse(value) do
      {revision, ""} -> revision
      _ -> nil
    end
  end

  defp parse_base_revision(_), do: nil
end
