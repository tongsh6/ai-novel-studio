defmodule NovelWeb.WorkspaceChannel do
  @moduledoc """
  Workspace Channel — 用户对话主通道。

  Phase 0 Week 4：处理 user_message / adopt 事件，集成 TurnService。
  """

  use Phoenix.Channel

  alias NovelApplication.AdoptionBoundary
  alias NovelApplication.TurnService

  @impl true
  @spec join(String.t(), map(), Phoenix.Socket.t()) :: {:ok, map(), Phoenix.Socket.t()}
  def join("workspace:" <> _suffix, _payload, socket) do
    {:ok, %{joined: true}, socket}
  end

  @impl true
  def handle_in("user_message", %{"text" => text}, socket) do
    turn_result = TurnService.handle_message(text)
    broadcast!(socket, "turn_result", turn_result)
    {:reply, {:ok, %{received: true}}, socket}
  end

  def handle_in("adopt", %{"artifact_id" => _artifact_id, "payload" => payload}, socket) do
    case AdoptionBoundary.accept(payload) do
      {:ok, work} ->
        result = %{
          event: "adopted",
          artifact_id: work.id,
          title: work.title,
          status: work.status
        }

        broadcast!(socket, "turn_result", result)
        {:reply, {:ok, result}, socket}

      {:error, reason} ->
        {:reply, {:error, %{reason: inspect(reason)}}, socket}
    end
  end

  def handle_in("ping", payload, socket) do
    {:reply, {:ok, %{event: "pong", echo: payload}}, socket}
  end
end
