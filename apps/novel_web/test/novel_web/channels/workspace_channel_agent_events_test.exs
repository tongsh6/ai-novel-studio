defmodule NovelWeb.WorkspaceChannelAgentEventsTest do
  @moduledoc """
  E1（双向审核 P2）：断线重连后按 run 补拉作者可见事件序列（`agent_events_since`）。

  只读接口：归属按持久 run 记录校验（dead run 也可补拉）；只返回 author-visible 事件，
  形状与实时 `agent_event` 广播一致。
  """

  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelCommon.Contracts.AgentEvent
  alias NovelPersistence.{AgentRunLog, Repo, WorkRepo, WorkSessionRepo}
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint

  setup do
    owner = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(owner) end)

    {:ok, work} = WorkRepo.create(%{title: "事件补拉"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    run_id = "run_events_#{System.unique_integer([:positive, :monotonic])}"
    ctx = %{work: work, session: session, run_id: run_id}

    {:ok, _} = upsert_run(ctx, run_id, session.id)

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

    {:ok, ctx}
  end

  test "returns author-visible events after since_sequence in real channel", ctx do
    socket = join_workspace(ctx)

    ref = push(socket, "agent_events_since", %{"run_id" => ctx.run_id, "since_sequence" => 1})
    assert_reply(ref, :ok, %{events: events})

    assert Enum.map(events, & &1.sequence) == [3]
    assert Enum.map(events, & &1.event_type) == ["plan_adjusted"]
    assert Enum.map(events, & &1.visibility) == ["author"]
    assert Enum.map(events, & &1.summary) == ["已收到调整"]
  end

  test "defaults missing since_sequence to zero", ctx do
    socket = join_workspace(ctx)
    ref = push(socket, "agent_events_since", %{"run_id" => ctx.run_id})
    assert_reply(ref, :ok, %{events: events})

    assert Enum.map(events, & &1.sequence) == [1, 3]
  end

  test "rejects run outside the joined work/session scope", ctx do
    {:ok, other_work} = WorkRepo.create(%{title: "其它作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id})
    other_run_id = "run_events_other_#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      upsert_run(ctx, other_run_id, other_session.id, %{
        workspace_id: other_work.id,
        work_id: other_work.id
      })

    socket = join_workspace(ctx)

    ref = push(socket, "agent_events_since", %{"run_id" => other_run_id, "since_sequence" => 0})
    assert_reply(ref, :error, %{reason: _reason})
  end

  test "rejects a run from another session of the joined work", ctx do
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: ctx.work.id})
    other_run_id = "run_events_session_#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} = upsert_run(ctx, other_run_id, other_session.id)

    socket = join_workspace(ctx)

    ref = push(socket, "agent_events_since", %{"run_id" => other_run_id, "since_sequence" => 0})
    assert_reply(ref, :error, %{reason: "run_scope_mismatch"})
  end

  test "keeps a dead run readable from persisted ownership", ctx do
    {:ok, _} =
      upsert_run(ctx, ctx.run_id, ctx.session.id, %{status: "completed", phase: "stopped"})

    socket = join_workspace(ctx)

    ref = push(socket, "agent_events_since", %{"run_id" => ctx.run_id, "since_sequence" => 2})
    assert_reply(ref, :ok, %{events: events})

    assert Enum.map(events, & &1.sequence) == [3]
  end

  test "matches the live agent_event wire shape", ctx do
    socket = join_workspace(ctx)

    ref = push(socket, "agent_events_since", %{"run_id" => ctx.run_id, "since_sequence" => 2})
    assert_reply(ref, :ok, %{events: [historical]})

    live = %AgentEvent{
      event_id: "evt_live_#{ctx.run_id}",
      run_ref: ctx.run_id,
      step_ref: "step-live",
      sequence: 9,
      event_type: :plan_adjusted,
      visibility: :author,
      summary: "实时形状",
      reason_codes: ["live_reason"],
      refs: ["live_ref"],
      payload: %{"text" => "实时"},
      emitted_at: ~U[2026-11-04 00:00:00.000000Z]
    }

    send(socket.channel_pid, {:agent_event, live})
    assert_push("agent_event", live_payload)

    assert Enum.sort(Map.keys(historical)) == Enum.sort(Map.keys(live_payload))

    run_id = ctx.run_id
    event_id = "evt_#{run_id}_3"
    work_id = ctx.work.id
    session_id = ctx.session.id

    assert %{
             event_id: ^event_id,
             run_ref: ^run_id,
             run_id: ^run_id,
             step_ref: nil,
             sequence: 3,
             event_type: "plan_adjusted",
             visibility: "author",
             summary: "已收到调整",
             reason_codes: [],
             refs: [],
             payload: %{},
             workspace_id: ^work_id,
             work_id: ^work_id,
             session_id: ^session_id,
             emitted_at: emitted_at
           } = historical

    assert is_binary(emitted_at)
  end

  test "applies the existing author-safe payload projection", ctx do
    {:ok, _} =
      AgentRunLog.insert_event(%{
        id: "evt_#{ctx.run_id}_4",
        run_id: ctx.run_id,
        sequence: 4,
        event_type: "run_completed",
        visibility: "author",
        summary: "已完成",
        payload: %{
          "text" => "可见",
          "turn_result" => %{"secret" => true},
          "checkpoint_data" => %{"secret" => true},
          "nested" => %{"turn_result" => 1, "ok" => true}
        }
      })

    socket = join_workspace(ctx)

    ref = push(socket, "agent_events_since", %{"run_id" => ctx.run_id, "since_sequence" => 3})
    assert_reply(ref, :ok, %{events: [event]})

    assert event.payload == %{"text" => "可见", "nested" => %{"turn_result" => 1, "ok" => true}}
  end

  test "missing run returns error instead of empty history", ctx do
    socket = join_workspace(ctx)

    ref = push(socket, "agent_events_since", %{"run_id" => "run_missing_events"})
    assert_reply(ref, :error, %{reason: _reason})
  end

  defp join_workspace(ctx) do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{ctx.work.id}", %{
        "session_id" => ctx.session.id
      })

    socket
  end

  defp upsert_run(ctx, run_id, session_id, attrs \\ %{}) do
    AgentRunLog.upsert_run(
      Map.merge(
        %{
          id: run_id,
          workspace_id: ctx.work.id,
          work_id: ctx.work.id,
          session_id: session_id,
          parent_turn_ref: "turn-#{run_id}",
          origin_frame_ref: "frame-#{run_id}",
          run_mode: "bounded",
          profile_ref: "conversation_turn_v1",
          status: "running",
          phase: "executing"
        },
        attrs
      )
    )
  end
end
