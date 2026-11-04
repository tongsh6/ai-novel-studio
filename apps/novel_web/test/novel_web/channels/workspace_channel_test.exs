defmodule NovelWeb.WorkspaceChannelTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.BehaviorState
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.WorkspaceContext
  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint
  @agent_run_timeout 45_000
  @agent_run_stopped_events ["run_completed", "awaiting_author", "run_failed", "run_cancelled"]

  setup do
    owner = Sandbox.start_owner!(NovelPersistence.Repo, shared: true)

    on_exit(fn ->
      NovelApplication.TestAgentRunCleanup.await_quiescent()
      Sandbox.stop_owner(owner)
    end)

    :ok
  end

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

  test "消息作用域不匹配或身份非法时拒绝，不挪到当前作品执行" do
    {:ok, _, channel} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:identity-scope")

    for {payload, reason} <- [
          {%{"text" => "原文", "turn_id" => "stable-id", "work_id" => "other-work"},
           "message_scope_mismatch"},
          {%{"text" => "原文", "turn_id" => ""}, "invalid_message_identity"},
          {%{"text" => "原文", "turn_id" => ["invalid"]}, "invalid_message_identity"}
        ] do
      ref = push(channel, "user_message", payload)
      assert_reply(ref, :error, %{reason: ^reason})
    end

    refute_push("agent_run_state", _, 50)
  end

  test "已接收候选继续的重传不重新校验消失的候选，也不激活历史会话" do
    prior = Application.get_env(:novel_web, :persistence, [])

    Application.put_env(
      :novel_web,
      :persistence,
      Keyword.put(prior, :inject_real_persistence, true)
    )

    on_exit(fn -> Application.put_env(:novel_web, :persistence, prior) end)

    {:ok, work} = NovelApplication.WorkService.create(%{title: "重复回执"})
    {:ok, old} = NovelApplication.WorkSessionService.create(work.id)

    attrs = %{
      workspace_id: work.id,
      session_id: old.id,
      turn_id: "accepted-before",
      run_id: "past-run",
      text: "继续旧候选",
      candidate_selection: %{
        "source_turn_ref" => "removed",
        "candidate_ref" => "old",
        "candidate_set_ref" => "candidate_set:removed"
      }
    }

    {:ok, _} = NovelPersistence.InteractionLifecycle.call(:receive, attrs)
    {:ok, current} = NovelApplication.WorkSessionService.create(work.id)

    {:ok, _, channel} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        work_id: work.id,
        session_id: old.id
      })

    ref =
      push(channel, "user_message", %{
        text: attrs.text,
        turn_id: attrs.turn_id,
        work_id: work.id,
        session_id: old.id,
        candidate_selection: attrs.candidate_selection
      })

    assert_reply(ref, :ok, %{received: true, run_id: "past-run", runtime_live: false})
    {:ok, snapshot} = NovelApplication.WorkSessionService.resume(work.id)
    assert snapshot.active_session.id == current.id

    ref =
      push(channel, "user_message", %{
        text: "改变原文",
        turn_id: attrs.turn_id,
        work_id: work.id,
        session_id: old.id
      })

    assert_reply(ref, :error, %{reason: "input_identity_conflict"})
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

    assert_push("turn_result", %{turn_id: ^turn_id, phase: "dialogue"}, @agent_run_timeout)
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

    assert_push(
      "agent_event",
      %{run_id: ^run_id, event_type: "run_started"},
      @agent_run_timeout
    )

    assert_push("agent_run_state", %{run_id: ^run_id, status: _status}, @agent_run_timeout)

    assert_push(
      "turn_result",
      %{
        phase: "dialogue",
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
    assert profile_ref == "judgment_loop_v1"

    assert_push(
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
    assert profile_ref == "judgment_loop_v1"

    assert_push(
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

  test "join 恢复使用最后一处明确 behavior_state，并与模型 Base 摘要一致" do
    {:ok, work} = NovelApplication.WorkService.create(%{title: "恢复行为一致"})
    {:ok, session} = NovelApplication.WorkSessionService.create(work.id)

    record_channel_turn_result(work.id, session.id, open_behavior_turn("turn-open", "bh-open"))
    Process.sleep(2)

    record_channel_turn_result(
      work.id,
      session.id,
      ordinary_turn("turn-ordinary", "不携带行为字段的普通回复。")
    )

    {:ok, _reply, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session.id
      })

    assert %BehaviorState{behavior_id: "bh-open"} = socket.assigns.active_behavior

    assert {:ok, _snapshot, _summary, nil, behavior_summary, [], [], _interaction_state,
            _source_status} =
             WorkspaceContext.context_fetcher_with_query().(work.id, "继续", session.id)

    assert behavior_summary =~ "待作者确认"
  end

  test "live turn_result 复用同一投影：缺字段保持、显式清空清空" do
    {:ok, work} = NovelApplication.WorkService.create(%{title: "live 行为投影"})
    {:ok, session} = NovelApplication.WorkSessionService.create(work.id)

    record_channel_turn_result(work.id, session.id, open_behavior_turn("turn-open", "bh-live"))

    {:ok, _reply, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session.id
      })

    assert %BehaviorState{behavior_id: "bh-live"} = socket.assigns.active_behavior

    push_live_turn_result(socket, ordinary_turn("turn-live-ordinary", "普通回复"))

    assert %BehaviorState{behavior_id: "bh-live"} =
             wait_live_active_behavior(
               socket,
               &match?(%BehaviorState{behavior_id: "bh-live"}, &1)
             )

    push_live_turn_result(socket, %{
      "turn_id" => "turn-live-clear",
      "assistant_message" => %{"text" => "已关闭。"},
      "behavior_state" => %{"active" => nil, "history" => []}
    })

    assert wait_live_active_behavior(socket, &is_nil/1) == nil

    push_live_turn_result(socket, open_behavior_turn("turn-live-open", "bh-live-2"))

    assert %BehaviorState{behavior_id: "bh-live-2"} =
             wait_live_active_behavior(
               socket,
               &match?(%BehaviorState{behavior_id: "bh-live-2"}, &1)
             )
  end

  defp push_live_turn_result(socket, turn_result) do
    turn_result =
      Map.new(turn_result, fn {key, value} -> {live_turn_result_key(key), value} end)

    {:ok, event} =
      AgentEvent.new(%{
        event_id: "evt-behavior-#{System.unique_integer([:positive, :monotonic])}",
        run_ref: "run-behavior-read",
        sequence: 1,
        event_type: :artifact_created,
        summary: "behavior read test",
        payload: %{turn_result: turn_result}
      })

    send(socket.channel_pid, {:agent_event, event})
    :ok
  end

  defp live_turn_result_key("turn_id"), do: :turn_id
  defp live_turn_result_key("assistant_message"), do: :assistant_message
  defp live_turn_result_key("behavior_state"), do: :behavior_state
  defp live_turn_result_key(key), do: key

  defp live_active_behavior(socket) do
    socket.channel_pid
    |> :sys.get_state()
    |> Map.fetch!(:assigns)
    |> Map.get(:active_behavior)
  end

  defp wait_live_active_behavior(socket, predicate, deadline \\ nil) do
    deadline = deadline || System.monotonic_time(:millisecond) + 1_000
    active_behavior = live_active_behavior(socket)

    cond do
      predicate.(active_behavior) ->
        active_behavior

      System.monotonic_time(:millisecond) < deadline ->
        Process.sleep(5)
        wait_live_active_behavior(socket, predicate, deadline)

      true ->
        flunk("live active_behavior did not settle, last value: #{inspect(active_behavior)}")
    end
  end

  defp record_channel_turn_result(work_id, session_id, turn_result) do
    {:ok, _interaction} =
      MemoryLog.record(%{
        workspace_id: work_id,
        session_id: session_id,
        turn_id: turn_result["turn_id"],
        role: "assistant",
        content: %{
          "text" => turn_result["assistant_message"]["text"],
          "turn_result" => turn_result
        }
      })

    :ok
  end

  defp ordinary_turn(turn_id, text) do
    %{"turn_id" => turn_id, "assistant_message" => %{"text" => text}}
  end

  defp open_behavior_turn(turn_id, behavior_id) do
    %{
      "turn_id" => turn_id,
      "assistant_message" => %{"text" => "等待作者确认。"},
      "behavior_state" => %{
        "active" => %{
          "behavior_id" => behavior_id,
          "behavior_type" => "confirmation",
          "status" => "WAITING_USER",
          "lifecycle_status" => "awaiting_author",
          "target_ref" => "prose_writing",
          "required_next_action" => "confirm_before_execute"
        },
        "history" => []
      }
    }
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
