defmodule NovelPersistence.AgentRunLogTest do
  use ExUnit.Case, async: true

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelPersistence.AgentRunLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  test "persists run, step and author-safe event records by run id" do
    run_id = "run-log-#{System.unique_integer([:positive, :monotonic])}"

    assert {:ok, run} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: "work-log",
               work_id: "work-log",
               session_id: "session-log",
               parent_turn_ref: "turn-log",
               origin_frame_ref: "frame-log",
               run_mode: "bounded",
               profile_ref: "character_design_with_context_v1",
               trigger: %{
                 "kind" => "author_action",
                 "action_type" => "revise_from_findings",
                 "source_turn_ref" => "turn-log"
               },
               status: "running",
               phase: "executing",
               goal: %{"text" => "先读角色阵容再设计反派", "version" => 1},
               goal_version: 1,
               run_policy: %{"max_steps" => 5},
               authority_scope: %{"production_write" => false},
               budget: %{"max_steps" => 5},
               consumed_budget: %{"steps" => 0},
               interrupt_state: %{"status" => "none"}
             })

    assert run.id == run_id
    assert run.trigger["action_type"] == "revise_from_findings"

    assert {:ok, _updated} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: "work-log",
               work_id: "work-log",
               session_id: "session-log",
               parent_turn_ref: "turn-log",
               origin_frame_ref: "frame-log",
               run_mode: "bounded",
               profile_ref: "character_design_with_context_v1",
               status: "completed",
               phase: "stopped",
               goal: %{"text" => "先读角色阵容再设计反派", "version" => 1},
               goal_version: 1,
               consumed_budget: %{"steps" => 1},
               completed_step_refs: ["step-log-1"],
               interrupt_state: %{"status" => "none"}
             })

    assert AgentRunLog.get_run(run_id).status == "completed"

    assert {:ok, _step} =
             AgentRunLog.insert_step(%{
               id: "step-log-1",
               run_id: run_id,
               sequence: 1,
               status: "completed",
               goal: "读取当前作品已确认角色阵容",
               micro_plan_ref: "mp-log-1",
               decision_ref: "decision-log-1",
               tool_request_ref: "tq-log-1",
               tool_result_ref: "tr-log-1",
               observation_refs: ["obs-log-1"],
               observation: %{"summaries" => ["当前作品暂未读取到已确认角色。"]},
               attempt: 1,
               idempotency_key: "#{run_id}:1:character_roster"
             })

    assert [%{tool_result_ref: "tr-log-1"}] = AgentRunLog.list_steps(run_id)

    assert {:ok, _event} =
             AgentRunLog.insert_event(%{
               id: "evt-log-1",
               run_id: run_id,
               step_id: "step-log-1",
               sequence: 1,
               event_type: "exploration_observed",
               visibility: "author",
               summary: "已读取当前角色阵容。",
               reason_codes: ["exploration_observed"],
               refs: ["obs-log-1"],
               payload: %{}
             })

    assert [%{summary: "已读取当前角色阵容。"}] = AgentRunLog.list_events(run_id)
  end

  test "rejects duplicate event sequence for one run" do
    run_id = "run-dup-#{System.unique_integer([:positive, :monotonic])}"

    attrs = %{
      id: "evt-dup-1",
      run_id: run_id,
      sequence: 1,
      event_type: "run_started",
      visibility: "author",
      summary: "AgentRun 已启动。"
    }

    assert {:ok, _event} = AgentRunLog.insert_event(attrs)
    assert {:error, _changeset} = AgentRunLog.insert_event(%{attrs | id: "evt-dup-2"})
  end

  test "queries parent-turn scoped runs and author-visible events" do
    run_id = "run-parent-#{System.unique_integer([:positive, :monotonic])}"
    other_session_run_id = "run-parent-other-#{System.unique_integer([:positive, :monotonic])}"

    assert {:ok, _run} =
             AgentRunLog.upsert_run(
               run_attrs(run_id, %{
                 parent_turn_ref: "turn-parent",
                 status: "completed",
                 phase: "stopped"
               })
             )

    assert {:ok, _run} =
             AgentRunLog.upsert_run(
               run_attrs(other_session_run_id, %{
                 session_id: "session-other",
                 parent_turn_ref: "turn-parent",
                 status: "completed",
                 phase: "stopped"
               })
             )

    assert [%{id: ^run_id}] =
             AgentRunLog.list_by_parent_turn("work-active", "session-active", "turn-parent")

    assert {:ok, _event} =
             AgentRunLog.insert_event(%{
               id: "evt-provider-developer",
               run_id: run_id,
               step_id: "step-provider",
               sequence: 1,
               event_type: "provider_progress",
               visibility: "developer",
               summary: "provider_event:started",
               reason_codes: ["provider_execution_stream", "provider_started"],
               refs: ["provider_run:prun-1", "provider_call:pcall-1"],
               payload: %{
                 "stage" => "provider_execution_recorded",
                 "provider_run_ref" => "prun-1",
                 "provider_call_ref" => "pcall-1"
               }
             })

    assert {:ok, _event} =
             AgentRunLog.insert_event(%{
               id: "evt-plan-author",
               run_id: run_id,
               step_id: "step-plan",
               sequence: 2,
               event_type: "plan_drafted",
               visibility: "author",
               summary: "模型先读取当前作品上下文。",
               reason_codes: ["agent_plan_drafted"],
               refs: ["provider_run:prun-plan", "provider_call:pcall-plan"],
               payload: %{
                 "author_narrative" => "模型先读取当前作品上下文。",
                 "author_narrative_source" => %{
                   "source_type" => "provider_output",
                   "provider_run_ref" => "prun-plan",
                   "provider_call_ref" => "pcall-plan",
                   "provider_output_ref" => "prun-plan",
                   "source_hash" => "source-hash",
                   "source_byte_range" => %{"start" => 0, "length" => 39},
                   "narrative_hash" => "narrative-hash"
                 }
               }
             })

    assert {:ok, _event} =
             AgentRunLog.insert_event(%{
               id: "evt-provider-internal",
               run_id: run_id,
               step_id: "step-provider",
               sequence: 3,
               event_type: "provider_progress",
               visibility: "internal",
               summary: "raw provider detail",
               reason_codes: ["provider_internal"],
               refs: [],
               payload: %{"raw_prompt" => "must not be restored to author"}
             })

    assert [%{id: "evt-plan-author", payload: %{"author_narrative" => "模型先读取当前作品上下文。"}}] =
             AgentRunLog.list_author_events(run_id)
  end

  test "lists only active durable runs for a work session" do
    active_id = "run-active-durable-#{System.unique_integer([:positive, :monotonic])}"
    completed_id = "run-completed-durable-#{System.unique_integer([:positive, :monotonic])}"
    bounded_id = "run-active-bounded-#{System.unique_integer([:positive, :monotonic])}"

    assert {:ok, _run} =
             AgentRunLog.upsert_run(
               run_attrs(active_id, %{
                 run_mode: "durable",
                 status: "awaiting_author",
                 long_run_task_ref: "task-active"
               })
             )

    assert {:ok, _run} =
             AgentRunLog.upsert_run(
               run_attrs(completed_id, %{
                 run_mode: "durable",
                 status: "completed",
                 long_run_task_ref: "task-completed"
               })
             )

    assert {:ok, _run} =
             AgentRunLog.upsert_run(
               run_attrs(bounded_id, %{
                 run_mode: "bounded",
                 status: "running"
               })
             )

    assert [%{id: ^active_id}] = AgentRunLog.list_active_durable("work-active", "session-active")

    assert [%{id: ^bounded_id}] =
             AgentRunLog.list_active_bounded("work-active", "session-active")
  end

  test "lists active durable runs by work across sessions" do
    active_id = "run-active-work-durable-#{System.unique_integer([:positive, :monotonic])}"
    other_work_id = "run-other-work-durable-#{System.unique_integer([:positive, :monotonic])}"

    assert {:ok, _run} =
             AgentRunLog.upsert_run(
               run_attrs(active_id, %{
                 run_mode: "durable",
                 status: "awaiting_author",
                 session_id: "session-original",
                 long_run_task_ref: "task-active-work"
               })
             )

    assert {:ok, _run} =
             AgentRunLog.upsert_run(
               run_attrs(other_work_id, %{
                 work_id: "work-other",
                 session_id: "session-original",
                 run_mode: "durable",
                 status: "awaiting_author",
                 long_run_task_ref: "task-other-work"
               })
             )

    assert [%{id: ^active_id}] = AgentRunLog.list_active_durable_by_work("work-active")
  end

  defp run_attrs(run_id, overrides) do
    %{
      id: run_id,
      workspace_id: "ws-active",
      work_id: "work-active",
      session_id: "session-active",
      parent_turn_ref: "turn-active",
      origin_frame_ref: "frame-active",
      run_mode: "bounded",
      profile_ref: "character_design_with_context_v1",
      status: "running",
      phase: "executing",
      goal: %{"text" => "恢复测试", "version" => 1},
      goal_version: 1,
      run_policy: %{"allowed_tool_refs" => ["character_roster"]},
      authority_scope: %{"production_write" => false, "allowed_tools" => ["character_roster"]},
      budget: %{"max_steps" => 2},
      consumed_budget: %{"steps" => 0},
      interrupt_state: %{"status" => "none"}
    }
    |> Map.merge(overrides)
  end
end
