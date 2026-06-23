defmodule NovelApplication.TraceReplayServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.TraceReplayService
  alias NovelApplication.WorkService
  alias NovelPersistence.Repo
  alias NovelPersistence.TraceRepository
  alias NovelPersistence.WorkSessionRepo

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "溯源测试作品"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "旧会话"})
    %{work: work, session: session}
  end

  test "returns an author-safe replay report scoped to work/session/turn", %{
    work: work,
    session: session
  } do
    turn_id = "turn-replay-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: session.id,
        trace_id: "trace-replay-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-replay",
        decision_type: "reply_only",
        no_tool_reason: "no_tool_needed",
        no_behavior_reason: "reply_only",
        no_write_reason: "no production write",
        turn_result_ref: turn_id,
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        event_order: ["author_input_received", "turn_result_emitted"],
        context_refs: [
          %{
            "source_type" => "current_work",
            "summary" => "灵源纪元"
          }
        ]
      })

    assert {:ok, report} = TraceReplayService.fetch_turn_report(work.id, session.id, turn_id)
    assert report.work_id == work.id
    assert report.session_id == session.id
    assert report.turn_id == turn_id
    assert report.trace_summary.decision_type == "reply_only"
    assert report.trace_summary.replay_provider_called == false
    assert report.replay_report.provider_called == false
    assert report.replay_report.result_status == "complete"
  end

  test "restores whitelisted first blocking gate from persisted no-write reason", %{
    work: work,
    session: session
  } do
    turn_id = "turn-gate-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: session.id,
        trace_id: "trace-gate-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-gate",
        plan_ref: "plan-gate",
        decision_type: "downgrade",
        no_tool_reason: "micro_plan_evaluated_by_orchestrator",
        no_behavior_reason: "execution candidate evaluated by orchestrator",
        no_write_reason: "orchestrator blocked execution: action_scope",
        turn_result_ref: turn_id,
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        event_order: [
          "author_input_received",
          "micro_plan_recorded",
          "orchestrator_decision_recorded",
          "turn_result_emitted"
        ]
      })

    assert {:ok, report} = TraceReplayService.fetch_turn_report(work.id, session.id, turn_id)
    assert report.trace_summary.decision_type == "downgrade"
    assert report.trace_summary.no_tool_reason == "micro_plan_evaluated_by_orchestrator"
    assert report.trace_summary.first_blocking_gate == "action_scope"
  end

  test "returns partial replay status when the scoped trace is incomplete", %{
    work: work,
    session: session
  } do
    turn_id = "turn-partial-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: session.id,
        trace_id: "trace-partial-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-partial",
        plan_ref: "plan-partial",
        decision_type: "tool_dispatched",
        no_tool_reason: "tool_was_dispatched",
        no_behavior_reason: "tool_dispatched",
        no_write_reason: "no production write",
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        event_order: ["author_input_received", "micro_plan_recorded", "tool_dispatched"],
        context_refs: [
          %{
            "source_type" => "current_work",
            "summary" => "灵源纪元"
          }
        ]
      })

    assert {:ok, report} = TraceReplayService.fetch_turn_report(work.id, session.id, turn_id)
    assert report.trace_summary.replay_provider_called == false
    assert report.trace_summary.replay_result_status == "partial"
    assert report.trace_summary.replay_missing_trace_refs_count >= 1
    assert report.replay_report.provider_called == false
    assert report.replay_report.result_status == "partial"
    assert "turn_result_ref" in report.replay_report.missing_trace_refs
    assert "tool_trace_refs" in report.replay_report.missing_trace_refs
  end

  test "rejects a session that does not belong to the work", %{work: work} do
    {:ok, other_work} = WorkService.create(%{title: "另一作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id, title: "其他会话"})

    assert {:error, :session_not_found} =
             TraceReplayService.fetch_turn_report(work.id, other_session.id, "turn-x")
  end

  test "does not return same-turn trace from a different session", %{work: work, session: session} do
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: work.id, title: "同作品其他会话"})
    turn_id = "turn-shared-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: other_session.id,
        trace_id: "trace-other-session-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-other-session",
        decision_type: "reply_only",
        event_order: ["turn_result_emitted"]
      })

    assert {:error, :trace_not_found} =
             TraceReplayService.fetch_turn_report(work.id, session.id, turn_id)
  end
end
