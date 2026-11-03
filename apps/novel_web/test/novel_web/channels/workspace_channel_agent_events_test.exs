defmodule NovelWeb.WorkspaceChannelAgentEventsTest do
  @moduledoc """
  E1（双向审核 P2）：断线重连后按 run 补拉作者可见事件序列（`agent_events_since`）。

  只读接口：归属按持久 run 记录校验（dead run 也可补拉）；只返回 author-visible 事件，
  形状与实时 `agent_event` 广播一致。
  """

  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelPersistence.{AgentRunLog, Repo, WorkRepo, WorkSessionRepo}
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint

  setup do
    owner = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(owner) end)

    {:ok, work} = WorkRepo.create(%{title: "事件补拉"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    run_id = "run_events_#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      AgentRunLog.upsert_run(%{
        id: run_id,
        workspace_id: work.id,
        work_id: work.id,
        session_id: session.id,
        parent_turn_ref: "turn-events",
        origin_frame_ref: "frame-events",
        run_mode: "bounded",
        profile_ref: "conversation_turn_v1",
        status: "running",
        phase: "executing"
      })

    for {sequence, visibility, event_type, summary} <- [
          {1, "author", "run_started", "已开始"},
          {2, "developer", "provider_progress", "开发进展"},
          {3, "author", "plan_adjusted", "已收到调整"}
        ] do
      {:ok, _} =
        AgentRunLog.insert_event(%{
          id: "evt_#{run_id}_#{sequence}",
          run_id: run_id,
          sequence: sequence,
          event_type: event_type,
          visibility: visibility,
          summary: summary
        })
    end

    {:ok, work: work, session: session, run_id: run_id}
  end

  test "returns author-visible events after since_sequence in real channel", ctx do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{ctx.work.id}", %{
        "session_id" => ctx.session.id
      })

    ref = push(socket, "agent_events_since", %{"run_id" => ctx.run_id, "since_sequence" => 1})
    assert_reply ref, :ok, %{events: events}

    assert Enum.map(events, & &1.sequence) == [3]
    assert Enum.map(events, & &1.event_type) == ["plan_adjusted"]
    assert Enum.map(events, & &1.visibility) == ["author"]
    assert Enum.map(events, & &1.summary) == ["已收到调整"]
  end

  test "rejects run outside the joined work/session scope", ctx do
    {:ok, other_work} = WorkRepo.create(%{title: "其它作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id})
    other_run_id = "run_events_other_#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      AgentRunLog.upsert_run(%{
        id: other_run_id,
        workspace_id: other_work.id,
        work_id: other_work.id,
        session_id: other_session.id,
        parent_turn_ref: "turn-events-other",
        origin_frame_ref: "frame-events-other",
        run_mode: "bounded",
        profile_ref: "conversation_turn_v1",
        status: "running",
        phase: "executing"
      })

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{ctx.work.id}", %{
        "session_id" => ctx.session.id
      })

    ref = push(socket, "agent_events_since", %{"run_id" => other_run_id, "since_sequence" => 0})
    assert_reply ref, :error, %{reason: _reason}
  end

  test "missing run returns error instead of empty history", ctx do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{ctx.work.id}", %{
        "session_id" => ctx.session.id
      })

    ref = push(socket, "agent_events_since", %{"run_id" => "run_missing_events"})
    assert_reply ref, :error, %{reason: _reason}
  end
end
