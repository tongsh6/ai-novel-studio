defmodule NovelApplication.AgentRunServiceTest do
  @moduledoc """
  B23 CP4：join 时惰性死 bounded run 一次性收口。

  持久层仍非终态、runtime Registry 无进程的 bounded run 在首次 join 被收口为
  failed(runtime_lost_on_restart)，返回收口后快照供 channel 广播一次；
  第二次 join 不再命中、不再重复留痕；durable run 完全不被触碰。
  """
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AgentRunService
  alias NovelDomain.AgentNextStepDecision
  alias NovelPersistence.{AgentRunLog, Repo}

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})
    :ok
  end

  test "first join reaps a dead bounded run once and leaves durable runs untouched" do
    work_id = "work-cp4-#{System.unique_integer([:positive, :monotonic])}"
    session_id = "session-cp4"
    dead_run_id = "run-cp4-dead-#{System.unique_integer([:positive, :monotonic])}"
    durable_run_id = "run-cp4-durable-#{System.unique_integer([:positive, :monotonic])}"

    insert_run_record!(dead_run_id, work_id, session_id, "bounded")
    insert_run_record!(durable_run_id, work_id, session_id, "durable")

    assert {:ok, [dead]} = AgentRunService.list_dead_bounded(work_id, session_id)
    assert dead.run.run_id == dead_run_id
    assert dead.run.status == :failed
    assert dead.run.failure_ref == "runtime_lost_on_restart"
    assert dead.runtime_live? == false
    assert dead.recovered? == false

    persisted = AgentRunLog.get_run(dead_run_id)
    assert persisted.status == "failed"
    assert persisted.phase == "stopped"
    assert persisted.failure_ref == "runtime_lost_on_restart"
    assert %DateTime{} = persisted.completed_at

    assert [recovery_event] = AgentRunLog.list_events(dead_run_id)
    assert recovery_event.event_type == "run_failed"
    assert recovery_event.visibility == "developer"
    assert recovery_event.payload["run_id"] == dead_run_id
    assert recovery_event.payload["previous_status"] == "awaiting_author"
    assert recovery_event.payload["failure_ref"] == "runtime_lost_on_restart"
    assert recovery_event.payload["run_mode"] == "bounded"

    # 第二次 join：持久层已是终态 → 不再命中，也不再重复广播/留痕。
    assert {:ok, []} = AgentRunService.list_dead_bounded(work_id, session_id)
    assert length(AgentRunLog.list_events(dead_run_id)) == 1

    # durable run 的恢复路径零改动：状态与 failure_ref 都不被触碰。
    durable = AgentRunLog.get_run(durable_run_id)
    assert durable.status == "awaiting_author"
    assert durable.failure_ref == nil
    assert AgentRunLog.list_events(durable_run_id) == []
  end

  test "receipt facts share the same confirmed-loss boundary and fail closed out of scope" do
    work_id = "work-receipt-facts-#{System.unique_integer([:positive, :monotonic])}"
    session_id = "session-receipt-facts"
    dead_run_id = "run-receipt-facts-dead-#{System.unique_integer([:positive, :monotonic])}"
    durable_run_id = "run-receipt-facts-durable-#{System.unique_integer([:positive, :monotonic])}"

    insert_run_record!(dead_run_id, work_id, session_id, "bounded")
    insert_run_record!(durable_run_id, work_id, session_id, "durable")

    assert {:ok, dead} = AgentRunService.receipt_run_facts(dead_run_id, work_id, session_id)
    assert dead.run.status == :failed
    assert dead.run.failure_ref == "runtime_lost_on_restart"
    assert dead.runtime_live? == false

    # 二次读取不再重复收口/留痕。
    assert {:ok, %{run: %{status: :failed}}} =
             AgentRunService.receipt_run_facts(dead_run_id, work_id, session_id)

    assert length(AgentRunLog.list_events(dead_run_id)) == 1

    # durable 不因 Registry 无进程被收口。
    assert {:ok, durable} =
             AgentRunService.receipt_run_facts(durable_run_id, work_id, session_id)

    assert durable.run.status == :awaiting_author
    assert durable.run.failure_ref == nil
    assert durable.runtime_live? == false
    assert AgentRunLog.list_events(durable_run_id) == []

    assert {:error, :receipt_run_scope_mismatch} =
             AgentRunService.receipt_run_facts(dead_run_id, "other-work", session_id)

    assert {:error, :receipt_run_missing} =
             AgentRunService.receipt_run_facts("missing-run", work_id, session_id)
  end

  test "receipt facts return an existing terminal bounded record without rewriting it" do
    work_id = "work-terminal-#{System.unique_integer([:positive, :monotonic])}"
    session_id = "session-terminal"
    run_id = "run-terminal-#{System.unique_integer([:positive, :monotonic])}"

    insert_run_record!(run_id, work_id, session_id, "bounded", "completed")

    assert {:ok, %{run: run, runtime_live?: false}} =
             AgentRunService.receipt_run_facts(run_id, work_id, session_id)

    assert run.status == :completed
    assert %{status: "completed", failure_ref: nil} = AgentRunLog.get_run(run_id)
    assert AgentRunLog.list_events(run_id) == []
  end

  test "receipt facts treat an unknown Registry state as undecided and never close the run" do
    work_id = "work-unknown-#{System.unique_integer([:positive, :monotonic])}"
    session_id = "session-unknown"
    run_id = "run-unknown-#{System.unique_integer([:positive, :monotonic])}"

    insert_run_record!(run_id, work_id, session_id, "bounded")

    parent = self()

    holder =
      spawn(fn ->
        {:ok, _} = Registry.register(NovelApplication.AgentRunRegistry, run_id, nil)
        send(parent, {:registry_holder, self()})

        receive do
          :stop -> :ok
          _unknown -> exit(:unknown_registry_state)
        end
      end)

    assert_receive {:registry_holder, ^holder}, 1_000

    try do
      assert {:ok, %{run: run, runtime_live?: nil}} =
               AgentRunService.receipt_run_facts(run_id, work_id, session_id)

      assert run.status == :awaiting_author
      assert %{status: "awaiting_author", failure_ref: nil} = AgentRunLog.get_run(run_id)
      assert AgentRunLog.list_events(run_id) == []
    after
      send(holder, :stop)
    end
  end

  test "list_dead_bounded surfaces a rejected runtime-lost write instead of the old run" do
    work_id = "work-rejected-#{System.unique_integer([:positive, :monotonic])}"
    session_id = "session-rejected"
    run_id = "run-rejected-#{System.unique_integer([:positive, :monotonic])}"

    insert_run_record!(run_id, work_id, session_id, "bounded")
    trigger = "reject_runtime_lost_#{System.unique_integer([:positive, :monotonic])}"

    Repo.query!("""
    CREATE TRIGGER #{trigger}
    BEFORE UPDATE ON agent_runs
    WHEN NEW.id = '#{run_id}' AND NEW.status = 'failed'
    BEGIN SELECT RAISE(ABORT, 'runtime lost write rejected'); END
    """)

    try do
      assert {:error, :runtime_lost_write_failed} =
               AgentRunService.list_dead_bounded(work_id, session_id)

      assert %{status: "awaiting_author", failure_ref: nil} = AgentRunLog.get_run(run_id)
      assert AgentRunLog.list_events(run_id) == []
    after
      Repo.query!("DROP TRIGGER #{trigger}")
    end
  end

  test "live bounded run is never reaped by list_dead_bounded" do
    parent = self()
    run_id = unique_run_id()
    work_id = "work-cp4-live-#{run_id}"
    session_id = "session-cp4-live-#{run_id}"

    planner = fn run, sequence, _snapshot ->
      send(parent, {:await_author_step, run.run_id})

      {:ok, decision} =
        AgentNextStepDecision.new(%{
          decision_id: "and_#{run.run_id}_#{sequence}_await_author",
          run_ref: run.run_id,
          sequence: sequence,
          decision_type: :await_author,
          summary: "等待作者补充具体方向。",
          reason_codes: ["test_await_author"]
        })

      {:await_author, decision, %{provider_call_count: 0}}
    end

    attrs = %{
      run_id: run_id,
      workspace_id: work_id,
      work_id: work_id,
      session_id: session_id,
      parent_turn_ref: "turn-cp4-live",
      origin_frame_ref: "frame-cp4-live",
      profile_ref: "character_design_with_context_v1",
      goal: %{text: "先看角色阵容，再设计反派", version: 1},
      authority_scope: %{
        production_write: false,
        allowed_tools: ["character_roster", "character_design"]
      }
    }

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(attrs, next_step_planner: planner)

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive {:await_author_step, ^run_id}, 1_000

    assert {:ok, %{run: %{status: :awaiting_author}}} =
             wait_for(fn ->
               case AgentRunService.state(run_id) do
                 {:ok, %{run: %{status: :awaiting_author}}} = awaiting -> awaiting
                 _other -> nil
               end
             end)

    assert {:ok, []} = AgentRunService.list_dead_bounded(work_id, session_id)

    persisted = wait_for(fn -> AgentRunLog.get_run(run_id) end)
    assert persisted.status == "awaiting_author"
    assert persisted.failure_ref == nil

    :ok = AgentRunService.cancel(run_id)

    # 等收口后的持久化落盘，避免测试 sandbox 结束后 run 进程仍有异步写入。
    assert %{status: "cancelled"} =
             wait_for(fn ->
               case AgentRunLog.get_run(run_id) do
                 %{status: "cancelled"} = record -> record
                 _other -> nil
               end
             end)
  end

  defp insert_run_record!(run_id, work_id, session_id, run_mode, status \\ "awaiting_author") do
    assert {:ok, _record} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: work_id,
               work_id: work_id,
               session_id: session_id,
               parent_turn_ref: "turn-#{run_id}",
               origin_frame_ref: "frame-#{run_id}",
               run_mode: run_mode,
               long_run_task_ref: if(run_mode == "durable", do: "task-#{run_id}", else: nil),
               profile_ref: "character_design_with_context_v1",
               status: status,
               phase: "stopped",
               goal: %{"text" => "在现有基础上扩写第一章", "version" => 1},
               goal_version: 1,
               run_policy: %{"allowed_tool_refs" => ["character_roster"]},
               authority_scope: %{
                 "production_write" => false,
                 "allowed_tools" => ["character_roster"]
               },
               budget: %{
                 "max_steps" => 2,
                 "max_tool_calls" => 2,
                 "max_provider_calls" => 1,
                 "max_replans" => 1
               },
               consumed_budget: %{
                 "steps" => 1,
                 "tool_calls" => 1,
                 "provider_calls" => 0,
                 "replans" => 0
               },
               completed_step_refs: ["step-#{run_id}-1"],
               interrupt_state: %{"status" => "none"}
             })

    :ok
  end

  defp unique_run_id do
    "run_cp4_live_#{System.unique_integer([:positive, :monotonic])}"
  end

  defp wait_for(fun, timeout_ms \\ 1_000) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_wait_for(fun, deadline)
  end

  defp do_wait_for(fun, deadline) do
    case fun.() do
      nil ->
        if System.monotonic_time(:millisecond) >= deadline do
          flunk("condition was not met before timeout")
        else
          Process.sleep(10)
          do_wait_for(fun, deadline)
        end

      result ->
        result
    end
  end
end
