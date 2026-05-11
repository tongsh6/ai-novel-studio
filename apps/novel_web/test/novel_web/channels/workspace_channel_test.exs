defmodule NovelWeb.WorkspaceChannelTest do
  use ExUnit.Case, async: true

  import Phoenix.ChannelTest

  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint

  test "join workspace:lobby returns success" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    assert socket.topic == "workspace:lobby"
  end

  test "join workspace with arbitrary id" do
    {:ok, reply, _socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:01HJX-test")

    # VS-09: join now reports the work_id resolved from payload (or, by
    # default, the workspace id). Old clients still see {joined: true} +.
    assert reply.joined == true
    assert reply.work_id == "01HJX-test"
  end

  test "ping -> pong" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    ref = push(socket, "ping", %{"hello" => "world"})
    assert_reply(ref, :ok, %{event: "pong", echo: %{"hello" => "world"}})
  end

  test "user_message returns received acknowledgement" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    ref = push(socket, "user_message", %{"text" => "hello"})
    assert_reply(ref, :ok, %{received: true})
  end

  test "user_message broadcasts turn_result" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    push(socket, "user_message", %{"text" => "聊聊创作方向"})
    assert_broadcast("turn_result", %{phase: "completed"})
  end

  test "author_action without server source turn_result returns error" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    ref =
      push(socket, "author_action", %{
        "action" => %{
          "source_turn_ref" => "turn-1",
          "action_id" => "act-fake",
          "action_type" => "nonexistent_action"
        }
      })

    assert_reply(ref, :error, %{reason: reason})
    assert String.contains?(reason, "source_turn_result not available")
  end
end
