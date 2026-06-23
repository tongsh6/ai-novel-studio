defmodule NovelWeb.TraceReplayControllerTest do
  use NovelWeb.ConnCase, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelPersistence.Repo
  alias NovelPersistence.TraceRepository
  alias NovelPersistence.WorkSessionRepo

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "溯源控制器作品"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "历史会话"})
    %{work: work, session: session}
  end

  test "GET /api/works/:work/sessions/:session/turns/:turn/replay returns scoped report", %{
    conn: conn,
    work: work,
    session: session
  } do
    turn_id = "turn-controller-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: session.id,
        trace_id: "trace-controller-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-controller",
        decision_type: "reply_only",
        no_tool_reason: "no_tool_needed",
        no_behavior_reason: "reply_only",
        no_write_reason: "no production write",
        turn_result_ref: turn_id,
        event_order: ["author_input_received", "turn_result_emitted"]
      })

    conn = get(conn, "/api/works/#{work.id}/sessions/#{session.id}/turns/#{turn_id}/replay")
    body = json_response(conn, 200)

    assert body["work_id"] == work.id
    assert body["session_id"] == session.id
    assert body["turn_id"] == turn_id
    assert body["trace_summary"]["decision_type"] == "reply_only"
    assert body["trace_summary"]["replay_provider_called"] == false
    assert body["replay_report"]["provider_called"] == false
  end

  test "GET replay surfaces partial status for incomplete scoped trace", %{
    conn: conn,
    work: work,
    session: session
  } do
    turn_id = "turn-controller-partial-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: session.id,
        trace_id: "trace-controller-partial-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-controller-partial",
        plan_ref: "plan-controller-partial",
        decision_type: "tool_dispatched",
        no_tool_reason: "tool_was_dispatched",
        no_behavior_reason: "tool_dispatched",
        no_write_reason: "no production write",
        event_order: ["author_input_received", "micro_plan_recorded", "tool_dispatched"]
      })

    conn = get(conn, "/api/works/#{work.id}/sessions/#{session.id}/turns/#{turn_id}/replay")
    body = json_response(conn, 200)

    assert body["trace_summary"]["replay_provider_called"] == false
    assert body["trace_summary"]["replay_result_status"] == "partial"
    assert body["trace_summary"]["replay_missing_trace_refs_count"] >= 1
    assert body["replay_report"]["provider_called"] == false
    assert body["replay_report"]["result_status"] == "partial"
    assert "turn_result_ref" in body["replay_report"]["missing_trace_refs"]
    assert "tool_trace_refs" in body["replay_report"]["missing_trace_refs"]
  end

  test "GET replay includes author-safe first blocking gate for downgraded turns", %{
    conn: conn,
    work: work,
    session: session
  } do
    turn_id = "turn-controller-gate-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: session.id,
        trace_id: "trace-controller-gate-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-controller-gate",
        plan_ref: "plan-controller-gate",
        decision_type: "downgrade",
        no_tool_reason: "micro_plan_evaluated_by_orchestrator",
        no_behavior_reason: "execution candidate evaluated by orchestrator",
        no_write_reason: "orchestrator blocked execution: action_scope",
        turn_result_ref: turn_id,
        event_order: [
          "author_input_received",
          "micro_plan_recorded",
          "orchestrator_decision_recorded",
          "turn_result_emitted"
        ]
      })

    conn = get(conn, "/api/works/#{work.id}/sessions/#{session.id}/turns/#{turn_id}/replay")
    body = json_response(conn, 200)

    assert body["trace_summary"]["decision_type"] == "downgrade"
    assert body["trace_summary"]["first_blocking_gate"] == "action_scope"
    refute body["trace_summary"]["first_blocking_gate"] =~ "orchestrator"
  end

  test "GET replay rejects cross-work session ids", %{conn: conn, work: work} do
    {:ok, other_work} = WorkService.create(%{title: "另一作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id, title: "其他会话"})

    conn = get(conn, "/api/works/#{work.id}/sessions/#{other_session.id}/turns/turn-x/replay")

    assert %{"error" => "session_not_found"} = json_response(conn, 404)
  end
end
