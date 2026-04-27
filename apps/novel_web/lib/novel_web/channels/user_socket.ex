defmodule NovelWeb.UserSocket do
  @moduledoc """
  WebSocket transport 入口。Phase 0 Week 2 T8 阶段不做鉴权，
  Phase 1 真接入 Authority.Gate / Budget.Meter 时再加 connect/3 校验。
  """

  use Phoenix.Socket

  channel "workspace:*", NovelWeb.WorkspaceChannel

  @impl true
  def connect(_params, socket, _connect_info) do
    {:ok, socket}
  end

  @impl true
  def id(_socket), do: nil
end
