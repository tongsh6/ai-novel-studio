defmodule NovelWeb.WorkspaceChannelTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint
  @agent_run_timeout 45_000
  @agent_run_stopped_events ["run_completed", "awaiting_author", "run_failed", "run_cancelled"]

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

  # UA-01 收口：user_message 主链统一先启动 AgentRun。问答 / 工具 / 写作分流都在
  # conversation_turn_v1 run 内继续推进，不再由 channel 保留同步 TurnResult fallback。
  test "user_message 返回 bounded AgentRun ack" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:basic-agent-ack")

    ref = push(socket, "user_message", %{"text" => "hello"})

    assert_reply(
      ref,
      :ok,
      %{received: true, run_id: run_id, run_mode: "bounded", turn_id: turn_id},
      @agent_run_timeout
    )

    assert is_binary(run_id)

    assert_broadcast("turn_result", %{turn_id: ^turn_id, phase: "completed"}, @agent_run_timeout)
    assert_agent_run_stopped(run_id)
  end

  test "ordinary user_message broadcasts AgentRun state/events before turn_result" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:basic-agent-events")

    ref = push(socket, "user_message", %{"text" => "聊聊创作方向"})

    assert_reply(
      ref,
      :ok,
      %{received: true, run_id: run_id, run_mode: "bounded", turn_id: turn_id},
      @agent_run_timeout
    )

    assert_broadcast(
      "agent_event",
      %{run_id: ^run_id, event_type: "run_started"},
      @agent_run_timeout
    )

    assert_broadcast("agent_run_state", %{run_id: ^run_id, status: _status}, @agent_run_timeout)

    assert_broadcast(
      "turn_result",
      %{
        phase: "completed",
        turn_id: ^turn_id,
        assistant_message: %{text: _}
      },
      @agent_run_timeout
    )

    assert_agent_run_stopped(run_id)
  end

  test "复合创作请求同样返回 AgentRun ack，不回落同步对话" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:basic-agent-character")

    ref = push(socket, "user_message", %{"text" => "先看看现有角色阵容，然后设计一个反派"})

    assert_reply(
      ref,
      :ok,
      %{received: true, run_id: run_id, run_mode: "bounded", profile_ref: profile_ref},
      @agent_run_timeout
    )

    assert is_binary(run_id)
    assert profile_ref == "profile_routing_v1"

    assert_broadcast(
      "agent_run_state",
      %{run_id: ^run_id, profile_ref: "character_design_with_context_v1", status: "completed"},
      @agent_run_timeout
    )

    assert_agent_run_stopped(run_id)
  end

  test "写正文请求返回 AgentRun ack，CP4 分流在 run 内处理" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:basic-agent-prose")

    ref = push(socket, "user_message", %{"text" => "写下一章"})

    assert_reply(
      ref,
      :ok,
      %{received: true, run_id: run_id, run_mode: "bounded", profile_ref: profile_ref},
      @agent_run_timeout
    )

    assert is_binary(run_id)
    assert profile_ref == "profile_routing_v1"

    assert_broadcast(
      "agent_run_state",
      %{run_id: ^run_id, profile_ref: "prose_drafting_with_quality_v1", status: "completed"},
      @agent_run_timeout
    )

    assert_agent_run_stopped(run_id)
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

  defp assert_agent_run_stopped(run_id) do
    deadline = System.monotonic_time(:millisecond) + @agent_run_timeout
    do_assert_agent_run_stopped(run_id, deadline)
  end

  defp do_assert_agent_run_stopped(run_id, deadline) do
    remaining = max(deadline - System.monotonic_time(:millisecond), 0)

    receive do
      %Phoenix.Socket.Broadcast{
        event: "agent_event",
        payload: %{run_id: ^run_id, event_type: event_type}
      }
      when event_type in @agent_run_stopped_events ->
        :ok

      %Phoenix.Socket.Message{
        event: "agent_event",
        payload: %{run_id: ^run_id, event_type: event_type}
      }
      when event_type in @agent_run_stopped_events ->
        :ok

      %Phoenix.Socket.Broadcast{
        event: "agent_run_state",
        payload: %{run_id: ^run_id, status: status}
      } ->
        if status in ["completed", "awaiting_author", "failed", "cancelled"] do
          :ok
        else
          do_assert_agent_run_stopped(run_id, deadline)
        end

      %Phoenix.Socket.Message{
        event: "agent_run_state",
        payload: %{run_id: ^run_id, status: status}
      } ->
        if status in ["completed", "awaiting_author", "failed", "cancelled"] do
          :ok
        else
          do_assert_agent_run_stopped(run_id, deadline)
        end

      _other ->
        do_assert_agent_run_stopped(run_id, deadline)
    after
      remaining ->
        flunk("expected AgentRun #{run_id} to stop before the test exits")
    end
  end
end
