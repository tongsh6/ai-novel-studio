Code.require_file(Path.expand("../support/transcript_compaction_helper.exs", __DIR__))

defmodule NovelApplication.TranscriptCompactionRuntimeTest do
  @moduledoc "讨论摘要维护在真实 AgentRunService 中的取消、转向、任务死亡与预算生命周期。"
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias NovelAgent.Provider.{AdapterExecution, Execution, Result, Usage}

  alias NovelApplication.{
    AgentRunService,
    AuthoringTranscript,
    TestAgenticLoopFixtures,
    TestAgentRunCleanup,
    TestTranscriptCompaction
  }

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.{Compaction, Operation}
  alias NovelDomain.AgentNextStepDecision
  alias NovelPersistence.{AgentRunLog, ProviderRunLog, Repo}

  setup do: TestTranscriptCompaction.setup()

  test "automatic discussion maintenance commits one author event and keeps canonical sources",
       %{run: run, dependency: dependency} do
    prior = seed_discussions(run, 5)
    run = seed_pressure(run, dependency)
    Application.put_env(:novel_application, :auto_maintenance, %{enabled: true})
    capture_material_summary(:complete)
    start_waiting_run(run, dependency)

    assert_receive {:runtime_summary_started, _worker, ctx}, 2_000

    state =
      wait_for_state(
        run.run_id,
        &(&1.current_task? == false and checkpoint_events(run.run_id) != [])
      )

    assert state.run.status == :awaiting_author
    assert state.run.consumed_budget.provider_calls == 2
    assert state.run.consumed_budget.execution_steps == 0
    assert state.run.consumed_budget.tool_calls == 0
    assert state.run.consumed_budget.replans == 0
    assert state.run.completed_step_refs == []
    assert_receive {:summary_planner_called, 1}
    refute_received {:summary_planner_called, 2}

    assert [event] = checkpoint_events(run.run_id)

    assert event.payload["covered_counts"] == %{
             "tool_exchanges" => 0,
             "scope_updates" => 0,
             "discussion_messages" => 1
           }

    assert event.payload["history_target"] == %{
             "session_id" => run.session_id,
             "turn_id" => prior.run.parent_turn_ref
           }

    restored = TestAgenticLoopFixtures.persisted_transcript(run.run_id)
    checkpoint = Enum.find(restored.messages, &(&1.role == "checkpoint"))
    assert hd(checkpoint.blocks).discussion.provider_run_ref == ctx.provider_run_id

    assert TestAgenticLoopFixtures.persisted_transcript(prior.run.run_id).messages ==
             prior.messages

    assert Enum.any?(restored.messages, fn message ->
             message.role == "user" and Enum.any?(message.blocks, &(&1.text == "现在只讨论方向。"))
           end)

    assert {:ok, %{compacted: false, reason: :nothing_to_compact}} =
             AgentRunService.compact_transcript(run.run_id)

    refute_received {:runtime_summary_started, _, _}
    assert AgentRunLog.get_run(run.run_id).consumed_budget["provider_calls"] == 2
  end

  test "runtime remains cancellable and rejects a late successful summary without losing call usage",
       %{run: run, dependency: dependency} do
    prior = seed_discussions(run, 5)
    capture_material_summary(:gated)
    start_waiting_run(run, dependency)
    wait_for_state(run.run_id, &(&1.run.status == :awaiting_author and not &1.current_task?))

    caller = Task.async(fn -> AgentRunService.compact_transcript(run.run_id) end)
    assert_receive {:runtime_summary_started, worker, ctx}, 2_000
    assert {:error, :execution_in_progress} = AgentRunService.compact_transcript(run.run_id)
    assert :ok = AgentRunService.cancel(run.run_id)

    assert {:ok, %{run: %{status: :cancelling}, current_task?: true}} =
             AgentRunService.state(run.run_id)

    send(worker, :finish_summary)

    assert {:error, :maintenance_stale} = Task.await(caller)
    assert {:ok, state} = AgentRunService.state(run.run_id)
    assert state.run.status == :cancelled
    assert state.run.consumed_budget.provider_calls == 1
    assert state.run.consumed_budget.execution_steps == 0
    assert state.run.consumed_budget.replans == 0
    assert AgentRunLog.get_run(run.run_id).consumed_budget["provider_calls"] == 1
    assert checkpoint_events(run.run_id) == []
    assert ProviderRunLog.get_output(ctx.provider_run_id).status == "ok"

    assert TestAgenticLoopFixtures.persisted_transcript(prior.run.run_id).messages ==
             prior.messages
  end

  test "author steering during maintenance rejects stale output and resumes the new direction",
       %{run: run, dependency: dependency} do
    _prior = seed_discussions(run, 5)
    capture_material_summary(:gated)
    start_waiting_run(run, dependency)
    wait_for_state(run.run_id, &(&1.run.status == :awaiting_author and not &1.current_task?))
    caller = Task.async(fn -> AgentRunService.compact_transcript(run.run_id) end)
    assert_receive {:runtime_summary_started, worker, _ctx}, 2_000

    assert {:ok, %{goal_version: 2}} =
             AgentRunService.steer(run.run_id, "保留原设定，先比较两种动机。")

    assert {:ok, %{run: %{status: :running}, current_task?: true}} =
             AgentRunService.state(run.run_id)

    refute_received {:summary_new_direction, 2, _text}
    send(worker, :finish_summary)
    assert {:error, :maintenance_stale} = Task.await(caller)
    assert_receive {:summary_new_direction, 2, "保留原设定，先比较两种动机。"}, 2_000

    state =
      wait_for_state(run.run_id, &(&1.run.status == :awaiting_author and not &1.current_task?))

    assert state.run.goal.version == 2
    assert state.run.consumed_budget.provider_calls == 1
    assert state.run.consumed_budget.execution_steps == 0
    assert checkpoint_events(run.run_id) == []
    assert state.run.goal.text == "保留原设定，先比较两种动机。"
  end

  test "provider task death retains unknown attempt and forbids automatic or explicit redispatch",
       %{run: run, dependency: dependency} do
    prior = seed_discussions(run, 5)
    run = seed_pressure(run, dependency)
    capture_material_summary(:crash)
    start_waiting_run(run, dependency)
    wait_for_state(run.run_id, &(&1.run.status == :awaiting_author and not &1.current_task?))

    assert {:error, :maintenance_task_down} = AgentRunService.compact_transcript(run.run_id)
    assert_receive {:runtime_summary_started, _worker, ctx}
    assert {:ok, state} = AgentRunService.state(run.run_id)
    assert state.run.status == :awaiting_author
    assert state.run.consumed_budget.provider_calls == 2
    assert state.run.consumed_budget.execution_steps == 0
    assert ProviderRunLog.get_run(ctx.provider_run_id).status in ["initialized", "running"]
    assert ProviderRunLog.get_output(ctx.provider_run_id) == nil

    assert {:ok, %{compacted: false, reason: :nothing_to_compact}} =
             AgentRunService.compact_transcript(run.run_id)

    refute_received {:runtime_summary_started, _, _}
    assert checkpoint_events(run.run_id) == []

    assert TestAgenticLoopFixtures.persisted_transcript(prior.run.run_id).messages ==
             prior.messages
  end

  test "unavailable accounting after task death stops execution without inventing zero calls",
       %{run: run, dependency: dependency} do
    _prior = seed_discussions(run, 5)
    run = seed_pressure(run, dependency)
    capture_material_summary(:gated)
    start_waiting_run(run, dependency)
    wait_for_state(run.run_id, &(&1.run.status == :awaiting_author and not &1.current_task?))

    caller = Task.async(fn -> AgentRunService.compact_transcript(run.run_id) end)
    assert_receive {:runtime_summary_started, worker, ctx}, 2_000
    SQL.query!(Repo, "ALTER TABLE provider_runs RENAME TO unavailable_provider_runs")

    try do
      Process.exit(worker, :kill)
      assert {:error, :maintenance_accounting_unavailable} = Task.await(caller)
    after
      SQL.query!(Repo, "ALTER TABLE unavailable_provider_runs RENAME TO provider_runs")
    end

    assert {:ok, state} = AgentRunService.state(run.run_id)
    assert state.run.status == :failed
    assert state.run.consumed_budget.provider_calls == 1
    assert AgentRunLog.get_run(run.run_id).consumed_budget["provider_calls"] == 1
    assert ProviderRunLog.get_run(ctx.provider_run_id).status in ["initialized", "running"]
    assert ProviderRunLog.get_output(ctx.provider_run_id) == nil
    assert checkpoint_events(run.run_id) == []
    assert_receive {:summary_planner_called, 1}
    refute_received {:summary_planner_called, 2}
  end

  test "a failed old source stays original while a newly eligible source can still be summarized",
       %{run: run, dependency: dependency} do
    prior = seed_discussions(run, 6)
    run = seed_pressure(run, dependency)

    Application.put_env(:novel_application, :auto_maintenance, %{
      enabled: true,
      keep_recent_items: 5
    })

    capture_material_summary(:crash)
    start_waiting_run(run, dependency)
    assert_receive {:runtime_summary_started, _worker, first_ctx}, 2_000

    wait_for_state(
      run.run_id,
      &(&1.current_task? == false and &1.run.consumed_budget.provider_calls == 2)
    )

    assert checkpoint_events(run.run_id) == []

    capture_material_summary(:complete)

    assert {:ok, %{covered_counts: %{discussion_messages: 1}}} =
             AgentRunService.compact_transcript(run.run_id)

    assert_receive {:runtime_summary_started, _worker, second_ctx}
    refute second_ctx.provider_call_ref == first_ctx.provider_call_ref
    assert ProviderRunLog.get_output(first_ctx.provider_run_id) == nil
    assert ProviderRunLog.get_output(second_ctx.provider_run_id).status == "ok"

    assert {:ok, %{run: %{consumed_budget: %{provider_calls: 3}}}} =
             AgentRunService.state(run.run_id)

    assert [event] = checkpoint_events(run.run_id)
    assert event.payload["covered_counts"]["discussion_messages"] == 1

    assert TestAgenticLoopFixtures.persisted_transcript(prior.run.run_id).messages ==
             prior.messages

    restored = TestAgenticLoopFixtures.persisted_transcript(run.run_id)
    checkpoint = Enum.find(restored.messages, &(&1.role == "checkpoint"))
    [covered] = hd(checkpoint.blocks).covers.message_refs
    assert covered.run_sequence == 5
    refute_received {:runtime_summary_started, _, _}
  end

  test "maintenance obeys the same run provider budget before a second eligible summary batch",
       %{run: run, dependency: dependency} do
    _prior = seed_discussions(run, 9)
    run = seed_pressure(run, dependency)
    run = %{run | budget: %{run.budget | max_provider_calls: 2}}
    Application.put_env(:novel_application, :auto_maintenance, %{enabled: true})
    capture_material_summary(:complete)
    start_waiting_run(run, dependency)

    assert_receive {:runtime_summary_started, _worker, _ctx}, 2_000

    state =
      wait_for_state(
        run.run_id,
        &(&1.current_task? == false and checkpoint_events(run.run_id) != [])
      )

    assert state.run.consumed_budget.provider_calls == 2
    assert [event] = checkpoint_events(run.run_id)
    assert event.payload["covered_counts"]["discussion_messages"] == 4

    assert {:error, :maintenance_provider_budget_exhausted} =
             AgentRunService.compact_transcript(run.run_id)

    refute_received {:runtime_summary_started, _, _}
  end

  defp seed_discussions(run, count) do
    identity =
      Map.from_struct(%{run | run_id: run.run_id <> "-prior", parent_turn_ref: "turn-prior"})

    initial =
      AuthoringTranscript.new(identity,
        base_text: "作者保留最终裁决",
        author_text: "先讨论第 1 个方向。",
        author_turn_ref: "turn-prior-1"
      )
      |> AuthoringTranscript.append_assistant("第 1 项建议仅供讨论。稍后我会确认动机。", [])

    prior =
      Enum.reduce(2..count, initial, fn index, transcript ->
        transcript
        |> AuthoringTranscript.append_author_turn("先讨论第 #{index} 个方向。", "turn-prior-#{index}")
        |> AuthoringTranscript.append_assistant("第 #{index} 项建议仅供讨论。稍后我会确认动机。", [])
      end)

    :ok = TestAgenticLoopFixtures.append_segment!(prior, status: "completed")
    prior
  end

  defp seed_pressure(run, dependency) do
    Application.put_env(:novel_application, :compaction_summary_test_provider, fn _ir,
                                                                                  _params,
                                                                                  ctx ->
      usage = Usage.new(24_000, 20, "summary-model", 1)

      AdapterExecution.materialize_result({:ok, Result.new("讨论中。", usage)}, ctx,
        initial_events: AdapterExecution.initial_events(ctx)
      )
    end)

    request =
      Operation.text_operation(%{
        profile_ref: "conversation_turn_v1",
        run: RequestIR.run_envelope(run),
        text: "测试压力事实"
      })

    context =
      run
      |> Map.from_struct()
      |> Map.take([:workspace_id, :work_id, :session_id, :parent_turn_ref])
      |> Map.put(:agent_run_id, run.run_id)

    execution = dependency |> Execution.with_owner_refs(context) |> Execution.execute(request)
    assert {:ok, _facts} = execution
    assert :ok = ProviderRunLog.record_execution(execution, context)
    %{run | consumed_budget: %{run.consumed_budget | provider_calls: 1}}
  end

  defp start_waiting_run(run, dependency) do
    parent = self()

    transcript =
      AuthoringTranscript.new(Map.from_struct(run),
        base_text: "作者保留最终裁决",
        author_text: "现在只讨论方向。",
        author_turn_ref: run.parent_turn_ref
      )

    planner = fn active, sequence, snapshot ->
      send(parent, {:summary_planner_called, sequence})

      if active.goal.version > 1,
        do: send(parent, {:summary_new_direction, active.goal.version, active.goal.text})

      active_transcript =
        Map.get(Map.get(snapshot, :stage_state, %{}), :judgment_transcript, transcript)

      {:ok, decision} =
        AgentNextStepDecision.new(%{
          decision_id: "await-" <> active.run_id,
          run_ref: active.run_id,
          sequence: sequence,
          decision_type: :await_author,
          summary: "等待作者继续讨论。",
          reason_codes: ["discussion_wait"]
        })

      {:await_author, decision, %{provider_call_count: 0, judgment_transcript: active_transcript}}
    end

    assert {:ok, run_id} =
             AgentRunService.start_bounded(Map.from_struct(run),
               next_step_planner: planner,
               provider_execution: dependency
             )

    TestAgentRunCleanup.register_run(run_id)
  end

  defp capture_material_summary(mode) do
    parent = self()

    Application.put_env(:novel_application, :compaction_summary_test_provider, fn ir,
                                                                                  _params,
                                                                                  ctx ->
      assert %{status: "initialized"} = ProviderRunLog.get_run(ctx.provider_run_id)
      material = ir.messages |> hd() |> Map.fetch!(:blocks) |> hd() |> Map.fetch!(:text)
      sources = Jason.decode!(material)["sources"]

      response =
        Jason.encode!(%{
          version: Compaction.discussion_version(),
          entries:
            Enum.map(sources, fn source ->
              %{
                source_index: source["source_index"],
                summary: "早期 AI 提出讨论建议，动机尚待确认。",
                retained_fragment_indices: [0]
              }
            end)
        })

      initial = AdapterExecution.initial_events(ctx)
      AdapterExecution.emit_events(ctx, initial, :running)
      send(parent, {:runtime_summary_started, self(), ctx})

      case mode do
        :gated ->
          receive do
            :finish_summary -> :ok
          after
            5_000 -> flunk("summary was not released")
          end

        :crash ->
          exit(:summary_transport_outcome_unknown)

        :complete ->
          :ok
      end

      AdapterExecution.materialize_result({:ok, Result.new(response)}, ctx,
        initial_events: initial,
        emit: :terminal
      )
    end)
  end

  defp checkpoint_events(run_id) do
    run_id
    |> AgentRunLog.list_author_events()
    |> Enum.filter(&(&1.event_type == "checkpoint_created"))
  end

  defp wait_for_state(run_id, predicate, remaining \\ 200)
  defp wait_for_state(_run_id, _predicate, 0), do: flunk("runtime state did not settle")

  defp wait_for_state(run_id, predicate, remaining) do
    {:ok, state} = AgentRunService.state(run_id)

    if predicate.(state) do
      state
    else
      Process.sleep(10)
      wait_for_state(run_id, predicate, remaining - 1)
    end
  end
end
