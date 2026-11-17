defmodule NovelApplication.TranscriptCompactionSummaryTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.{AdapterExecution, Execution, Result, Usage}
  alias NovelApplication.{AgentRunService, AuthoringTranscript, TestAgenticLoopFixtures}
  alias NovelApplication.TranscriptCompactionSummary, as: Summary
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.{Compaction, MessageCoverage, Operation}
  alias NovelDomain.{AgentNextStepDecision, AgentRun}
  alias NovelPersistence.{AgentRunLog, ProviderRunLog, Repo}

  defmodule CaptureProvider do
    @behaviour NovelAgent.Provider
    defstruct []

    @impl true
    def execute(_state, _model, ir, params, ctx),
      do:
        Application.fetch_env!(:novel_application, :compaction_summary_test_provider).(
          ir,
          params,
          ctx
        )

    @impl true
    def health_check(_state), do: :ok
    @impl true
    def name, do: "compaction_summary_test"
    @impl true
    def projection_target(_state), do: "chat_completions"
    @impl true
    def capabilities(_state) do
      %{
        native_multi_turn: true,
        tool_calls: true,
        tool_results: true,
        streaming: true,
        structured_output: true,
        usage: true
      }
    end
  end

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})
    extra = Application.get_env(:novel_agent, :extra_providers)
    callback = Application.get_env(:novel_application, :compaction_summary_test_provider)
    maintenance = Application.get_env(:novel_application, :auto_maintenance)
    Application.put_env(:novel_application, :auto_maintenance, %{enabled: false})

    Application.put_env(
      :novel_agent,
      :extra_providers,
      Map.put(Map.new(extra || []), :compaction_summary_test, CaptureProvider)
    )

    on_exit(fn ->
      restore_env(:novel_agent, :extra_providers, extra)
      restore_env(:novel_application, :compaction_summary_test_provider, callback)
      restore_env(:novel_application, :auto_maintenance, maintenance)
    end)

    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-summary",
        workspace_id: "ws-summary",
        work_id: "work-summary",
        session_id: "session-summary",
        parent_turn_ref: "turn-current",
        origin_frame_ref: "frame-summary",
        profile_ref: "conversation_turn_v1",
        goal: %{text: "讨论动机", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["read_character"]},
        status: :running
      })

    {:ok, token} = Execution.start_cancellation_token(%{run_id: run.run_id})
    parent = self()

    snapshot = %{
      run: run,
      provider_cancellation_token: token,
      stage_sink: fn event -> send(parent, {:summary_stage, event}) end
    }

    %{
      run: run,
      snapshot: snapshot,
      dependency:
        Execution.dependency(
          provider: :compaction_summary_test,
          model: "summary-model",
          purpose: :conversation
        )
    }
  end

  test "one admitted execution binds exact summary bytes and can be verified on foreign-run history",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, messages} = plan(run)
    response = response_text()
    capture(response)

    assert {:ok, completed, 1} = Summary.prepare(plan, snapshot, dependency)
    assert_received {:summary_dispatched, request, params, ctx}
    assert request.run.run_id == run.run_id
    assert request.tools == []
    assert params.max_tokens == 8192
    assert completed.discussion.response_text == response
    assert completed.discussion.provider_call_ref == ctx.provider_call_ref
    assert completed.discussion.provider_run_ref == ctx.provider_run_id
    assert completed.discussion.response_sha256 == sha256(response)

    assert completed.discussion |> Map.keys() |> Enum.sort() ==
             [:provider_call_ref, :provider_run_ref, :response_sha256, :response_text]

    assert %{status: "ok", content_summary: %{"content_sha256" => hash}} =
             ProviderRunLog.get_output(ctx.provider_run_id)

    assert hash == sha256(response)

    checkpoint = checkpoint(completed, run)
    assert :ok = Summary.validate_history(messages ++ [checkpoint], run)
    other_request_run = %{run | run_id: "run-later", parent_turn_ref: "turn-later"}
    assert :ok = Summary.validate_history(messages ++ [checkpoint], other_request_run)

    assert {:error, :provider_operation_already_owned, 0} =
             Summary.prepare(plan, snapshot, dependency)

    refute_received {:summary_dispatched, _, _, _}

    assert {:error, _} =
             Summary.validate_history(messages ++ [checkpoint], %{run | work_id: "another-work"})

    tampered =
      put_in(checkpoint.blocks, [
        put_in(
          hd(checkpoint.blocks).discussion.response_sha256,
          sha256("different response")
        )
      ])

    assert {:error, :discussion_summary_persistence_mismatch} =
             Summary.validate_history(messages ++ [tampered], run)

    changed_source =
      List.update_at(messages, 1, fn message ->
        %{message | blocks: [RequestIR.text_block("我会确认完全不同的事项。")]}
      end)

    assert {:error, :discussion_summary_history_mismatch} =
             Summary.validate_history(changed_source ++ [checkpoint], run)
  end

  test "invalid native response retains the actual provider output and fences a repeated source",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    capture("this is not the required JSON")
    assert {:error, _reason, 1} = Summary.prepare(plan, snapshot, dependency)
    assert_received {:summary_dispatched, _ir, _params, ctx}
    refute Map.has_key?(plan, :discussion)
    assert %{status: "ok"} = ProviderRunLog.get_output(ctx.provider_run_id)

    assert {:error, :provider_operation_already_owned, 0} =
             Summary.prepare(plan, snapshot, dependency)

    refute_received {:summary_dispatched, _, _, _}
  end

  test "source attempts survive unrelated covers and source regrouping without a second call",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    capture("invalid summary leaves an attempted source")
    assert {:error, _reason, 1} = Summary.prepare(plan, snapshot, dependency)
    assert_received {:summary_dispatched, _, _, _}

    changed_covers = put_in(plan.covers.call_ids, ["unrelated-old-tool"])
    assert Summary.coverage_key(changed_covers, run) == Summary.coverage_key(plan, run)

    assert {:error, :provider_operation_already_owned, 0} =
             Summary.prepare(changed_covers, snapshot, dependency)

    [source] = plan.discussion_sources
    reindexed = %{source | source_index: 1}

    changed_bytes = %{plan | discussion_sources: [%{source | text: "同坐标的不同正文"}]}
    refute Summary.coverage_key(changed_bytes, run) == Summary.coverage_key(plan, run)

    assert Compaction.discussion_source_key(reindexed, run) ==
             Compaction.discussion_source_key(source, run)

    new_source = %{
      source
      | source: %{source.source | run_sequence: source.source.run_sequence + 1},
        text: "另一条尚未整理的讨论。"
    }

    grouped = %{plan | discussion_sources: [new_source, reindexed]}
    refute Summary.coverage_key(grouped, run) == Summary.coverage_key(plan, run)

    assert {:error, :discussion_summary_source_mismatch, 0} =
             Summary.prepare(grouped, snapshot, dependency)

    refute_received {:summary_dispatched, _, _, _}
  end

  test "admission persistence failure prevents dispatch without fabricating a call",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    capture(response_text())

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_summary_admission BEFORE INSERT ON provider_runs
    BEGIN SELECT RAISE(ABORT, 'provider admission unavailable'); END
    """)

    try do
      assert {:error, _reason, 0} = Summary.prepare(plan, snapshot, dependency)
      refute_received {:summary_dispatched, _, _, _}
      assert ProviderRunLog.list_runs(run.run_id) == []
    after
      SQL.query!(Repo, "DROP TRIGGER reject_summary_admission")
    end
  end

  test "terminal fact persistence failure never yields a ready discussion or redispatches",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    capture(response_text())

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_summary_output BEFORE INSERT ON provider_outputs
    BEGIN SELECT RAISE(ABORT, 'provider output unavailable'); END
    """)

    try do
      assert {:error, _reason, 1} = Summary.prepare(plan, snapshot, dependency)
      assert_received {:summary_dispatched, _ir, _params, ctx}
      assert ProviderRunLog.get_output(ctx.provider_run_id) == nil

      assert ProviderRunLog.operation_source_keys(run, Summary.operation()) ==
               {:ok,
                MapSet.new(plan.discussion_sources, &Compaction.discussion_source_key(&1, run))}

      assert {:error, :provider_operation_already_owned, 0} =
               Summary.prepare(plan, snapshot, dependency)

      refute_received {:summary_dispatched, _, _, _}
    after
      SQL.query!(Repo, "DROP TRIGGER reject_summary_output")
    end
  end

  test "cancellation before dispatch and during a real execution keep different call facts",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    parent = self()

    Application.put_env(:novel_application, :compaction_summary_test_provider, fn _ir,
                                                                                  _params,
                                                                                  ctx ->
      initial = AdapterExecution.initial_events(ctx)
      AdapterExecution.emit_events(ctx, initial, :running)
      send(parent, {:waiting_summary, self()})

      receive do
        :finish_cancel -> :ok
      end

      AdapterExecution.materialize_cancelled(ctx, initial_events: initial)
    end)

    task = Task.async(fn -> Summary.prepare(plan, snapshot, dependency) end)
    assert_receive {:waiting_summary, worker}, 1000
    assert :ok = Execution.cancel(snapshot.provider_cancellation_token, :author_cancelled)
    send(worker, :finish_cancel)
    assert {:error, %{type: :cancelled}, 1} = Task.await(task)
    assert [%{status: "cancelled"}] = ProviderRunLog.list_runs(run.run_id)

    assert {:error, :cancelled, 0} = Summary.prepare(plan, snapshot, dependency)
    refute_received {:waiting_summary, _}
  end

  test "oversized input and missing execution preserve sources without calling a global provider",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    capture(response_text())

    oversized =
      update_in(plan.discussion_sources, fn [source] ->
        [%{source | text: String.duplicate("原", 50_000)}]
      end)

    assert {:error, :discussion_summary_input_budget_exceeded, 0} =
             Summary.prepare(oversized, snapshot, dependency)

    assert {:error, :provider_execution_missing, 0} = Summary.prepare(plan, snapshot, nil)
    assert ProviderRunLog.list_runs(run.run_id) == []
    refute_received {:summary_dispatched, _, _, _}
  end

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

    NovelApplication.TestAgentRunCleanup.register_run(run_id)
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
                retained_obligations: ["稍后我会确认动机。"]
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

  defp capture(response) do
    parent = self()

    Application.put_env(:novel_application, :compaction_summary_test_provider, fn ir,
                                                                                  params,
                                                                                  ctx ->
      assert %{
               status: "initialized",
               provider_id: "compaction_summary_test",
               model: "summary-model"
             } = ProviderRunLog.get_run(ctx.provider_run_id)

      send(parent, {:summary_dispatched, ir, params, ctx})

      AdapterExecution.materialize_result({:ok, Result.new(response)}, ctx,
        initial_events: AdapterExecution.initial_events(ctx)
      )
    end)
  end

  defp plan(run) do
    source_run = %{run | run_id: "run-earlier", parent_turn_ref: "turn-earlier"}
    source_identity = source_run |> Map.from_struct() |> Map.put(:status, "completed")

    transcript =
      AuthoringTranscript.new(source_identity,
        base_text: "历史讨论的应用来源",
        author_text: "先讨论动机，不要写正文。",
        author_turn_ref: "turn-earlier"
      )
      |> AuthoringTranscript.append_assistant("我建议先对照资料。稍后我会确认动机。")

    TestAgenticLoopFixtures.append_segment!(transcript, status: "completed")

    messages =
      transcript.messages
      |> MessageCoverage.annotate(source_identity)
      |> Enum.reject(&(&1.role == "application_base"))

    selector = MessageCoverage.selector(List.last(messages))
    covers = %{call_ids: [], message_refs: [selector], turn_range: "turn-earlier"}
    {:ok, sources} = Compaction.discussion_sources(messages, covers)

    {%{
       covers: covers,
       discussion_sources: sources,
       source_refs: [MessageCoverage.source_ref(selector)],
       versions: %{},
       omissions: ["模型讨论摘要不是作者授权。"],
       summary: "较早讨论整理"
     }, messages}
  end

  defp checkpoint(plan, run) do
    block =
      RequestIR.checkpoint_block(
        plan.covers,
        plan.source_refs,
        plan.versions,
        plan.omissions,
        plan.summary,
        plan.discussion
      )

    [message] =
      MessageCoverage.annotate(
        [RequestIR.message(:checkpoint, :application, [block])],
        Map.from_struct(run)
      )

    message
  end

  defp response_text do
    ~s({"version":"authoring-discussion-summary/v1","entries":[{"source_index":0,"summary":"早期 AI 建议先对照资料，动机确认尚待处理。","retained_obligations":["稍后我会确认动机。"]}]})
  end

  defp sha256(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)
  defp restore_env(app, key, nil), do: Application.delete_env(app, key)
  defp restore_env(app, key, value), do: Application.put_env(app, key, value)
end
