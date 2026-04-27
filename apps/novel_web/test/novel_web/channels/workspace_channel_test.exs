defmodule NovelWeb.WorkspaceChannelTest do
  use ExUnit.Case, async: true

  import Phoenix.ChannelTest

  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint

  test "join workspace:lobby 返回成功 + 状态 payload" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    assert socket.topic == "workspace:lobby"
  end

  test "join workspace:<arbitrary id> 也允许" do
    {:ok, reply, _socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:01HJX-test")

    assert reply == %{joined: true}
  end

  test "ping → pong" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    ref = push(socket, "ping", %{"hello" => "world"})
    assert_reply(ref, :ok, %{event: "pong", echo: %{"hello" => "world"}})
  end
end
