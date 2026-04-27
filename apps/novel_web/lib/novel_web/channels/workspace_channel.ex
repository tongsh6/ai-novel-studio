defmodule NovelWeb.WorkspaceChannel do
  @moduledoc """
  Phase 0 Week 2 T8 雏形 channel：
  - join `workspace:lobby` 或 `workspace:<id>` —— 都允许
  - 收到 "ping" 事件回 "pong"（用于 frontend T9 端到端打通验证）
  - 服务端可主动 push（Phase 1 真接入 turn_result push 后扩展）
  """

  use Phoenix.Channel

  @impl true
  def join("workspace:" <> _suffix, _payload, socket) do
    {:ok, %{joined: true}, socket}
  end

  @impl true
  def handle_in("ping", payload, socket) do
    {:reply, {:ok, %{event: "pong", echo: payload}}, socket}
  end
end
