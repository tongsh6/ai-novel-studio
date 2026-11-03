defmodule NovelApplication.AgentRunEventQueryTest do
  @moduledoc """
  E1 补拉的应用层读取边界：按持久 run 校验 work/session 归属后，返回 since 之后的
  作者可见事件语义 DTO。只读：不启动 runtime、不更新 run、不调用 Provider。

  scope 与 since 由 Web 边界按 Socket 上下文/wire 规则归一，应用内信任，不在此
  重复证明任意内部坏 map 或坏 since。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AgentRunEventQuery
  alias NovelApplication.AgentRunEventQuery.Event
  alias NovelPersistence.{AgentRunLog, Repo, WorkRepo, WorkSessionRepo}

  setup do
    owner = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(owner) end)

    {:ok, work} = WorkRepo.create(%{title: "事件查询"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    run_id = "run_query_#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      AgentRunLog.upsert_run(%{
        id: run_id,
        workspace_id: work.id,
        work_id: work.id,
        session_id: session.id,
        parent_turn_ref: "turn-query",
        origin_frame_ref: "frame-query",
        run_mode: "bounded",
        profile_ref: "conversation_turn_v1",
        status: "running",
        phase: "executing"
      })

    for {sequence, visibility, event_type, summary} <- [
          {1, "author", "run_started", "已开始"},
          {2, "developer", "provider_progress", "开发进展"},
          {3, "author", "plan_adjusted", "已收到调整"},
          {4, "author", "run_finished", "已完成"}
        ] do
      {:ok, _} =
        AgentRunLog.insert_event(%{
          id: "evt_#{run_id}_#{sequence}",
          run_id: run_id,
          sequence: sequence,
          event_type: event_type,
          visibility: visibility,
          summary: summary,
          reason_codes: ["code_#{sequence}"],
          refs: ["ref_#{sequence}"],
          payload: %{"kind" => event_type}
        })
    end

    {:ok, work: work, session: session, run_id: run_id}
  end

  test "returns only author-visible semantic events after since", ctx do
    assert {:ok, [event, finished]} =
             AgentRunEventQuery.since(
               %{work_id: ctx.work.id, session_id: ctx.session.id},
               ctx.run_id,
               2
             )

    assert %Event{} = event
    assert event.event_id == "evt_#{ctx.run_id}_3"
    assert event.run_id == ctx.run_id
    assert event.sequence == 3
    assert event.event_type == "plan_adjusted"
    assert event.visibility == "author"
    assert event.summary == "已收到调整"
    assert event.reason_codes == ["code_3"]
    assert event.refs == ["ref_3"]
    assert event.payload == %{"kind" => "plan_adjusted"}
    assert %DateTime{} = event.inserted_at

    assert finished.sequence == 4
    assert finished.event_type == "run_finished"
  end

  test "still reads a dead run from its persisted ownership", ctx do
    {:ok, _} =
      AgentRunLog.upsert_run(%{
        id: ctx.run_id,
        workspace_id: ctx.work.id,
        work_id: ctx.work.id,
        session_id: ctx.session.id,
        parent_turn_ref: "turn-query",
        origin_frame_ref: "frame-query",
        run_mode: "bounded",
        profile_ref: "conversation_turn_v1",
        status: "completed",
        phase: "stopped"
      })

    assert {:ok, events} =
             AgentRunEventQuery.since(
               %{work_id: ctx.work.id, session_id: ctx.session.id},
               ctx.run_id,
               3
             )

    assert Enum.map(events, & &1.sequence) == [4]
  end

  test "rejects a run from another work", ctx do
    {:ok, other_work} = WorkRepo.create(%{title: "其它作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id})
    other_run_id = "run_query_other_#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      AgentRunLog.upsert_run(%{
        id: other_run_id,
        workspace_id: other_work.id,
        work_id: other_work.id,
        session_id: other_session.id,
        parent_turn_ref: "turn-other",
        origin_frame_ref: "frame-other",
        run_mode: "bounded",
        profile_ref: "conversation_turn_v1",
        status: "running",
        phase: "executing"
      })

    assert {:error, :run_scope_mismatch} =
             AgentRunEventQuery.since(
               %{work_id: ctx.work.id, session_id: ctx.session.id},
               other_run_id,
               0
             )
  end

  test "rejects a run from another session of the same work", ctx do
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: ctx.work.id})
    other_run_id = "run_query_session_#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      AgentRunLog.upsert_run(%{
        id: other_run_id,
        workspace_id: ctx.work.id,
        work_id: ctx.work.id,
        session_id: other_session.id,
        parent_turn_ref: "turn-session",
        origin_frame_ref: "frame-session",
        run_mode: "bounded",
        profile_ref: "conversation_turn_v1",
        status: "running",
        phase: "executing"
      })

    assert {:error, :run_scope_mismatch} =
             AgentRunEventQuery.since(
               %{work_id: ctx.work.id, session_id: ctx.session.id},
               other_run_id,
               0
             )
  end

  test "keeps the existing nil-session scope semantics", ctx do
    assert {:ok, events} =
             AgentRunEventQuery.since(%{work_id: ctx.work.id, session_id: nil}, ctx.run_id, 0)

    assert length(events) == 3
  end

  test "returns not_found for a missing run", ctx do
    assert {:error, :not_found} =
             AgentRunEventQuery.since(
               %{work_id: ctx.work.id, session_id: ctx.session.id},
               "run_query_missing",
               0
             )
  end

  test "rejects missing or empty run ids", ctx do
    scope = %{work_id: ctx.work.id, session_id: ctx.session.id}

    assert {:error, :invalid_run_id} = AgentRunEventQuery.since(scope, nil, 0)
    assert {:error, :invalid_run_id} = AgentRunEventQuery.since(scope, "", 0)
  end
end
