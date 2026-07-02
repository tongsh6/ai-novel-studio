defmodule NovelApplication.AgentRunRuntimeTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result
  alias NovelApplication.AgentRunFlows.ConversationTurn
  alias NovelApplication.AgentRunFlows.ProviderProgress
  alias NovelApplication.AgentRunFlows.ReadonlyBatchContext
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
  alias NovelDomain.AgentNextStepDecision
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentStep
  alias NovelPersistence.{AgentRunLog, LongRunTaskLog, ProviderRunLog, Repo}

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})
    :ok
  end

  test "bounded runtime executes supervised step and emits author-safe events" do
    parent = self()
    run_id = unique_run_id()

    step = fn _run, sequence ->
      send(parent, {:step_started, sequence})

      {:ok,
       %{
         step: step_struct(run_id, sequence, "step_#{sequence}"),
         observations: [observation(run_id, sequence)],
         artifact_refs: ["as_#{sequence}"]
       }}
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(base_run(run_id),
               next_step_planner: sequential_steps([step]),
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert_receive {:agent_event, :run_started, "AgentRun 已启动。"}
    assert_receive {:agent_event, :plan_drafted, "执行测试步骤 1。"}
    assert_receive {:agent_event, :exploration_observed, "第 1 步观察。"}
    assert_receive {:agent_event, :run_completed, "AgentRun 已完成。"}

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :completed
    assert run.phase == :stopped
    assert run.completed_step_refs == ["step_1"]
    assert run.pending_artifact_refs == ["as_1"]
  end

  test "plan_revised is emitted only from a failed plan_holds evaluation and consumes replan budget" do
    parent = self()
    run_id = unique_run_id()

    step = fn _run, sequence ->
      {:ok,
       %{
         step: step_struct(run_id, sequence, "step_replanned"),
         observations: [],
         loop_status: :completed
       }}
    end

    planner = fn run, sequence, _snapshot ->
      {:execute, step, replan_decision(run, sequence), %{provider_call_count: 0}}
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(base_run(run_id),
               next_step_planner: planner,
               event_sink: event_sink_full(parent)
             )

    assert_receive {:agent_event_full, :plan_revised, event}, 500
    assert "agent_plan_revised" in event.reason_codes
    assert event.payload.evaluation_of_last.plan_holds == false
    assert event.payload.evaluation_of_last.new_constraint == "测试前提不成立。"
    assert event.payload.revision_reason == "测试前提不成立。"
    assert event.payload.plan_revision.plan_version == 2

    assert_receive {:agent_event_full, :run_completed, _event}, 500

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.plan_version == 2
    assert run.consumed_budget.replans == 1
  end

  test "bounded runtime persists run, step and author-safe event records" do
    parent = self()
    run_id = unique_run_id()

    step = fn _run, sequence ->
      send(parent, {:step_started, sequence})

      {:ok,
       %{
         step: step_struct(run_id, sequence, "step_#{run_id}_#{sequence}"),
         observations: [observation(run_id, sequence)],
         artifact_refs: ["as_#{sequence}"],
         turn_result: %{turn_id: "turn-agent-#{sequence}"},
         tool_call_count: 1,
         provider_call_count: 0
       }}
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(base_run(run_id),
               next_step_planner: sequential_steps([step]),
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert_receive {:agent_event, :run_completed, "AgentRun 已完成。"}, 500

    persisted_run =
      wait_for(fn ->
        case AgentRunLog.get_run(run_id) do
          %{status: "completed", phase: "stopped"} = run -> run
          _other -> nil
        end
      end)

    assert persisted_run.consumed_budget["steps"] == 1
    assert persisted_run.consumed_budget["tool_calls"] == 1
    assert persisted_run.completed_step_refs == ["step_#{run_id}_1"]
    assert persisted_run.pending_artifact_refs == ["as_1"]

    assert [%{decision_ref: "decision_1", tool_result_ref: "tr_1"}] =
             AgentRunLog.list_steps(run_id)

    event_types = AgentRunLog.list_events(run_id) |> Enum.map(& &1.event_type)
    assert "run_started" in event_types
    assert "plan_drafted" in event_types
    assert "exploration_observed" in event_types
    assert "artifact_created" in event_types
    assert "run_completed" in event_types

    artifact_event =
      AgentRunLog.list_events(run_id) |> Enum.find(&(&1.event_type == "artifact_created"))

    refute Map.has_key?(artifact_event.payload || %{}, "turn_result")
  end

  test "conversation turn publishes major DialogueGateway stages through AgentRun events" do
    parent = self()

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :conversation_turn,
        %{
          text: "测试",
          workspace_id: "ws-conversation",
          work_id: "work-conversation",
          session_id: "session-conversation",
          turn_id: "turn-conversation"
        },
        nil,
        reply_only_provider()
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, started}
    assert "profile_selected" in started.reason_codes

    assert started.payload.profile_ref == ConversationTurn.profile_ref()

    assert started.payload.profile_selection.profile_ref ==
             ConversationTurn.profile_ref()

    assert started.payload.profile_selection.source == "application_profile"
    assert_receive {:agent_event, :plan_drafted, context_step}
    assert context_step.summary =~ "组装当前作品"
    assert_planner_step(context_step, "context_assemble")

    assert_receive {:agent_event, :goal_understood, context_stage}, 500
    assert "context_assembled" in context_stage.reason_codes
    assert context_stage.payload.stage == :context_assembled

    assert_receive {:agent_event, :exploration_observed, context_event}, 500
    assert context_event.summary =~ "已组装本轮创作上下文"

    assert_receive {:agent_event, :evaluation_made, context_decision}, 500
    assert "agent_step_evaluated" in context_decision.reason_codes
    assert "agentic_next_step" in context_decision.reason_codes

    assert_receive {:agent_event, :plan_drafted, frame_step}, 500
    assert frame_step.summary =~ "形成对话认知帧"
    assert_planner_step(frame_step, "dialogue_frame")

    assert_receive {:agent_event, :exploration_observed, frame_event}, 500
    assert frame_event.summary =~ "casual_reply"
    assert_receive {:agent_event, :evaluation_made, frame_decision}, 500
    assert "agent_step_evaluated" in frame_decision.reason_codes

    assert_receive {:agent_event, :plan_drafted, strategy_step}, 500
    assert strategy_step.summary =~ "执行策略"
    assert_planner_step(strategy_step, "strategy_gate")

    assert_receive {:agent_event, :gate_decided, gate_stage}, 500
    assert "reply_only_no_tool" in gate_stage.reason_codes
    assert gate_stage.payload.stage == :reply_only_gate

    assert_receive {:agent_event, :exploration_observed, strategy_event}, 500
    assert strategy_event.summary =~ "无需工具"

    assert_receive {:agent_event, :plan_drafted, finalize_step}, 500
    assert finalize_step.summary =~ "生成本轮回应"
    assert_planner_step(finalize_step, "response_finalize")

    assert_receive {:agent_event, :turn_result_ready, turn_event}, 500
    assert turn_event.payload.turn_result.agent_run.run_id == run_id
    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :completed
    assert run.consumed_budget.steps == 4
    assert run.consumed_budget.tool_calls == 0
    assert run.consumed_budget.provider_calls == 6
  end

  test "conversation turn projects provider execution facts into author-safe provider progress" do
    parent = self()
    frame_json = reply_only_frame_json()

    provider_execution = provider_activity_execution(frame_json)

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :conversation_turn,
        %{
          text: "测试 provider execution 可见轨迹",
          workspace_id: "ws-provider-activity",
          work_id: "work-provider-activity",
          session_id: "session-provider-activity",
          turn_id: "turn-provider-activity"
        },
        nil,
        provider_execution
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: event_sink_full(parent)
             )

    events = collect_full_events_until(:turn_result_ready, 1_000)
    turn_event = List.last(events)

    provider_progress_events =
      Enum.filter(events, &(&1.event_type == :provider_progress))

    planner_started_projection =
      Enum.find(provider_progress_events, fn event ->
        "provider_started" in event.reason_codes and event.payload.purpose == "author_reasoning"
      end)

    conversation_started_projection =
      Enum.find(provider_progress_events, fn event ->
        "provider_started" in event.reason_codes and event.payload.purpose == "conversation"
      end)

    conversation_chunk_projection =
      Enum.find(provider_progress_events, fn event ->
        "provider_chunk" in event.reason_codes and event.payload.purpose == "conversation"
      end)

    planner_chunk_projection =
      Enum.find(provider_progress_events, fn event ->
        "provider_chunk" in event.reason_codes and event.payload.purpose == "author_reasoning"
      end)

    conversation_final_projection =
      Enum.find(provider_progress_events, fn event ->
        "provider_final_output" in event.reason_codes and event.payload.purpose == "conversation"
      end)

    assert planner_started_projection
    refute Map.has_key?(planner_started_projection.payload, :provider_progress_phase)
    assert conversation_started_projection
    assert conversation_started_projection.payload.provider_run_ref == "prun-conversation"
    assert conversation_started_projection.payload.provider_call_ref == "pcall-conversation"
    assert conversation_started_projection.payload.status == "ok"
    refute Map.has_key?(conversation_started_projection.payload, :provider_progress_phase)
    refute inspect(provider_progress_events) =~ "raw_prompt"
    refute inspect(provider_progress_events) =~ "must not be projected"
    refute inspect(provider_progress_events) =~ "assistant_message"

    assert conversation_chunk_projection
    assert conversation_chunk_projection.visibility == :developer
    assert conversation_chunk_projection.summary == "provider_event:chunk"
    assert conversation_chunk_projection.payload.output_type == "text"
    assert conversation_chunk_projection.payload.chunk_index == 1
    assert conversation_chunk_projection.payload.chunk_content_length == 7
    assert conversation_chunk_projection.payload.accumulated_content_length == 7
    refute Map.has_key?(conversation_chunk_projection.payload, :content_length)
    refute inspect(conversation_chunk_projection.payload) =~ "收到你的测试消息"
    refute Map.has_key?(conversation_chunk_projection.payload, :author_narrative_delta)

    assert planner_chunk_projection
    assert planner_chunk_projection.visibility == :author

    assert planner_chunk_projection.summary ==
             String.trim(planner_chunk_projection.payload.author_narrative_delta)

    assert planner_chunk_projection.payload.author_narrative_delta =~ "先"
    refute planner_chunk_projection.payload.author_narrative_delta =~ "evaluation_of_last"

    assert conversation_final_projection
    assert conversation_final_projection.payload.output_type == "text"
    assert conversation_final_projection.payload.content_length == String.length(frame_json)
    assert conversation_final_projection.payload.usage == %{total_tokens: 12}
    refute Map.has_key?(conversation_final_projection.payload, :provider_progress_phase)
    refute inspect(conversation_final_projection.payload) =~ "收到你的测试消息"

    persisted_provider_runs =
      wait_for(fn ->
        summaries = ProviderRunLog.list_usage_summaries(run_id)

        if Enum.any?(summaries, &(&1.purpose == "author_reasoning")) and
             Enum.any?(summaries, &(&1.purpose == "conversation")) do
          summaries
        end
      end)

    assert Enum.find(persisted_provider_runs, &(&1.provider_call_ref == "pcall-author-reasoning")).purpose ==
             "author_reasoning"

    assert %{
             purpose: "conversation",
             status: "ok",
             output_type: "text",
             usage: %{"total_tokens" => 12}
           } = Enum.find(persisted_provider_runs, &(&1.provider_call_ref == "pcall-conversation"))

    refute inspect(persisted_provider_runs) =~ "收到你的测试消息"

    assert turn_event.payload.turn_result.agent_run.run_id == run_id
    assert_receive {:agent_event_full, :run_completed, _}, 500
  end

  test "conversation turn projects provider execution error facts into author-safe provider progress" do
    parent = self()

    provider_execution = provider_activity_execution(:conversation_error)

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :conversation_turn,
        %{
          text: "测试 provider execution 失败轨迹",
          workspace_id: "ws-provider-error",
          work_id: "work-provider-error",
          session_id: "session-provider-error",
          turn_id: "turn-provider-error"
        },
        nil,
        provider_execution
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: event_sink_full(parent)
             )

    events = collect_full_events_until(:turn_result_ready, 1_000)
    turn_event = List.last(events)

    provider_progress_events =
      Enum.filter(events, &(&1.event_type == :provider_progress))

    started_projection =
      Enum.find(provider_progress_events, fn event ->
        "provider_started" in event.reason_codes and event.payload.purpose == "conversation"
      end)

    error_projection =
      Enum.find(provider_progress_events, fn event ->
        "provider_error" in event.reason_codes and event.payload.purpose == "conversation"
      end)

    assert started_projection
    assert started_projection.payload.provider_run_ref == "prun-conversation-error"
    assert started_projection.payload.provider_call_ref == "pcall-conversation-error"
    refute inspect(provider_progress_events) =~ "raw provider failure payload"
    refute inspect(provider_progress_events) =~ "raw_prompt"

    assert error_projection
    assert error_projection.visibility == :developer
    assert error_projection.summary == "provider_event:error"
    assert error_projection.payload.status == "error"
    assert error_projection.payload.output_type == "empty"
    assert error_projection.payload.provider_run_ref == "prun-conversation-error"
    assert error_projection.payload.provider_call_ref == "pcall-conversation-error"
    refute inspect(provider_progress_events) =~ "must not be projected"
    refute inspect(provider_progress_events) =~ "assistant_message"

    persisted_provider_runs =
      wait_for(fn ->
        summaries = ProviderRunLog.list_usage_summaries(run_id)

        if Enum.any?(summaries, &(&1.provider_call_ref == "pcall-conversation-error")) do
          summaries
        end
      end)

    assert %{
             purpose: "conversation",
             status: "error",
             output_type: "empty"
           } =
             Enum.find(
               persisted_provider_runs,
               &(&1.provider_call_ref == "pcall-conversation-error")
             )

    refute inspect(persisted_provider_runs) =~ "raw provider failure payload"

    assert turn_event.payload.turn_result.agent_run.run_id == run_id
    assert turn_event.payload.turn_result.assistant_message.text =~ "无法连接到创作引擎"
    assert_receive {:agent_event_full, :run_completed, _}, 500
  end

  test "pause is cooperative and stops before next step" do
    parent = self()
    run_id = unique_run_id()

    slow_step = fn _run, sequence ->
      send(parent, {:step_started, sequence})
      Process.sleep(80)

      {:ok, %{step: step_struct(run_id, sequence, "step_#{sequence}"), observations: []}}
    end

    fast_step = fn _run, sequence ->
      send(parent, {:step_started, sequence})
      {:ok, %{step: step_struct(run_id, sequence, "step_#{sequence}"), observations: []}}
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(
               base_run(run_id),
               next_step_planner: sequential_steps([slow_step, fast_step]),
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert :ok = AgentRunService.pause(run_id)

    assert_receive {:agent_event, :interrupt_requested, "正在请求暂停。"}
    assert_receive {:agent_event, :run_paused, "AgentRun 已暂停。"}, 500
    refute_receive {:step_started, 2}, 120

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :paused
    assert run.phase == :stopped
    assert run.completed_step_refs == ["step_1"]
  end

  test "cancel during an active step requests provider execution cancellation" do
    parent = self()
    run_id = unique_run_id()

    slow_step = fn _run, sequence ->
      send(parent, {:step_started, sequence})
      Process.sleep(120)
      {:ok, %{step: step_struct(run_id, sequence, "step_#{sequence}"), observations: []}}
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(base_run(run_id),
               next_step_planner: sequential_steps([slow_step]),
               event_sink: event_sink_full(parent)
             )

    assert_receive {:step_started, 1}
    assert :ok = AgentRunService.cancel(run_id)

    assert_receive {:agent_event_full, :interrupt_requested, interrupt_event}, 500
    assert "provider_execution_cancel_requested" in interrupt_event.reason_codes
    assert interrupt_event.payload.cancel_strategy == :provider_execution_cancel
    assert interrupt_event.payload.supports_cancellation == true
    assert interrupt_event.payload.current_task_active == true

    assert {:ok, %{run: cancelling_run, current_task?: true}} = AgentRunService.state(run_id)
    assert cancelling_run.status == :cancelling
    assert cancelling_run.interrupt_state.status == :cancel_requested

    assert_receive {:agent_event_full, :run_cancelled, cancelled_event}, 500
    assert "provider_execution_cancelled" in cancelled_event.reason_codes

    assert {:ok, %{run: cancelled_run, current_task?: false}} = AgentRunService.state(run_id)
    assert cancelled_run.status == :cancelled
    assert cancelled_run.phase == :stopped
  end

  test "budget stops the run before starting another step" do
    parent = self()
    run_id = unique_run_id()

    step = fn _run, sequence ->
      send(parent, {:step_started, sequence})
      {:ok, %{step: step_struct(run_id, sequence, "step_#{sequence}"), observations: []}}
    end

    attrs =
      Map.put(base_run(run_id), :budget, %{
        max_steps: 1,
        max_tool_calls: 4,
        max_provider_calls: 3,
        max_replans: 1
      })

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: sequential_steps([step, step]),
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert_receive {:agent_event, :awaiting_author, "AgentRun 已达到预算上限。"}, 500
    refute_receive {:step_started, 2}, 80

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :awaiting_author
    assert run.completed_step_refs == ["step_1"]
  end

  test "durable runtime links LongRunTask and checkpoints active state" do
    parent = self()
    run_id = unique_run_id()

    step = fn _run, sequence ->
      send(parent, {:step_started, sequence})

      {:ok,
       %{step: step_struct(run_id, sequence, "step_#{run_id}_#{sequence}"), observations: []}}
    end

    attrs =
      base_run(run_id)
      |> Map.put(:work_revision, 7)
      |> Map.put(:target_revision_ref, "draft:target:1")
      |> Map.put(:target_revision, 3)
      |> Map.put(:budget, %{
        max_steps: 1,
        max_tool_calls: 4,
        max_provider_calls: 3,
        max_replans: 1
      })

    assert {:ok, ^run_id} =
             AgentRunService.start_durable(attrs,
               next_step_planner: sequential_steps([step, step]),
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert_receive {:agent_event, :awaiting_author, "AgentRun 已达到预算上限。"}, 500

    persisted_run =
      wait_for(fn ->
        case AgentRunLog.get_run(run_id) do
          %{status: "awaiting_author", run_mode: "durable"} = run -> run
          _other -> nil
        end
      end)

    assert is_binary(persisted_run.long_run_task_ref)

    task = LongRunTaskLog.get(persisted_run.long_run_task_ref)
    assert task.status == "PAUSED"
    assert task.phase == "CHECKPOINT"
    assert task.completed_unit_refs == ["step_#{run_id}_1"]
    assert task.checkpoint_data["agent_run"]["run_id"] == run_id
    assert task.checkpoint_data["agent_run"]["status"] == "awaiting_author"
    assert task.checkpoint_data["agent_run"]["work_revision"] == 7
    assert task.checkpoint_data["agent_run"]["target_revision_ref"] == "draft:target:1"
    assert task.checkpoint_data["agent_run"]["target_revision"] == 3

    assert {:ok, [recovered]} = AgentRunService.recover_durable("work_1", "sess_1")
    assert recovered.runtime_live? == true
    assert recovered.run.long_run_task_ref == task.id
    assert "runtime_live" in recovered.recovery_event.reason_codes
  end

  test "durable live recovery marks stale when requested goal version changed" do
    parent = self()
    run_id = unique_run_id()

    step = fn _run, sequence ->
      send(parent, {:step_started, sequence})

      {:ok,
       %{step: step_struct(run_id, sequence, "step_#{run_id}_#{sequence}"), observations: []}}
    end

    attrs =
      base_run(run_id)
      |> Map.put(:work_id, "work_goal_version_stale")
      |> Map.put(:session_id, "session_goal_version_stale")
      |> Map.put(:parent_turn_ref, "turn_goal_version_stale")
      |> Map.put(:origin_frame_ref, "frame_goal_version_stale")
      |> Map.put(:budget, %{
        max_steps: 1,
        max_tool_calls: 4,
        max_provider_calls: 3,
        max_replans: 1
      })

    assert {:ok, ^run_id} =
             AgentRunService.start_durable(attrs,
               next_step_planner: sequential_steps([step, step]),
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert_receive {:agent_event, :awaiting_author, "AgentRun 已达到预算上限。"}, 500

    assert {:ok, [recovered]} =
             AgentRunService.recover_durable(
               "work_goal_version_stale",
               "session_goal_version_stale",
               goal_version: 2
             )

    assert recovered.runtime_live? == true
    assert recovered.run.status == :awaiting_author
    assert recovered.long_run_task.checkpoint_data["stale_resume"] == true
    assert recovered.long_run_task.checkpoint_data["stale_reason"] == "goal_version_mismatch"
    assert recovered.long_run_task.checkpoint_data["step"] == "恢复目标版本已变化，等待作者确认"
    assert "runtime_live" in recovered.recovery_event.reason_codes
    assert "stale_resume" in recovered.recovery_event.reason_codes
    assert "goal_version_mismatch" in recovered.recovery_event.reason_codes

    assert AgentRunLog.get_run(run_id).failure_ref == "goal_version_mismatch"
  end

  test "durable live recovery marks stale when joined session changed" do
    parent = self()
    run_id = unique_run_id()

    step = fn _run, sequence ->
      send(parent, {:step_started, sequence})

      {:ok,
       %{step: step_struct(run_id, sequence, "step_#{run_id}_#{sequence}"), observations: []}}
    end

    attrs =
      base_run(run_id)
      |> Map.put(:work_id, "work_live_session_stale")
      |> Map.put(:session_id, "session_live_original")
      |> Map.put(:parent_turn_ref, "turn_live_session_stale")
      |> Map.put(:origin_frame_ref, "frame_live_session_stale")
      |> Map.put(:budget, %{
        max_steps: 1,
        max_tool_calls: 4,
        max_provider_calls: 3,
        max_replans: 1
      })

    assert {:ok, ^run_id} =
             AgentRunService.start_durable(attrs,
               next_step_planner: sequential_steps([step, step]),
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert_receive {:agent_event, :awaiting_author, "AgentRun 已达到预算上限。"}, 500

    assert {:ok, [recovered]} =
             AgentRunService.recover_durable(
               "work_live_session_stale",
               "session_live_after_reload"
             )

    assert recovered.runtime_live? == true
    assert recovered.run.status == :awaiting_author
    assert recovered.run.session_id == "session_live_original"
    assert recovered.long_run_task.checkpoint_data["stale_resume"] == true
    assert recovered.long_run_task.checkpoint_data["stale_reason"] == "session_ref_mismatch"
    assert recovered.long_run_task.checkpoint_data["step"] == "恢复目标会话与运行记录不一致，等待作者确认"
    assert "runtime_live" in recovered.recovery_event.reason_codes
    assert "stale_resume" in recovered.recovery_event.reason_codes
    assert "session_ref_mismatch" in recovered.recovery_event.reason_codes

    assert AgentRunLog.get_run(run_id).failure_ref == "session_ref_mismatch"
  end

  test "durable checkpoint recovery waits for author when runtime is not live" do
    run_id = unique_run_id()

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: "work_stale",
        task_type: "agent_run",
        status: "PAUSED",
        phase: "CHECKPOINT",
        goal: "恢复长任务",
        scope_ref: "work_stale",
        created_by: "agent_run",
        parent_turn_ref: "turn_stale",
        checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "goal_version" => 1,
            "completed_step_refs" => ["step_stale_1"],
            "checkpoint_version" => 2
          },
          "progress" => 50,
          "step" => "AgentRun 检查点"
        }
      })

    assert {:ok, _record} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: "ws_stale",
               work_id: "work_stale",
               session_id: "session_stale",
               parent_turn_ref: "turn_stale",
               origin_frame_ref: "frame_stale",
               run_mode: "durable",
               profile_ref: "character_design_with_context_v1",
               status: "running",
               phase: "executing",
               goal: %{"text" => "恢复长任务", "version" => 1},
               goal_version: 1,
               plan: %{},
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
               completed_step_refs: ["step_stale_1"],
               interrupt_state: %{"status" => "none"},
               long_run_task_ref: task.id
             })

    assert {:ok, [recovered]} = AgentRunService.recover_durable("work_stale", "session_stale")
    assert recovered.runtime_live? == false
    assert recovered.run.status == :awaiting_author
    assert recovered.long_run_task.checkpoint_data["stale_resume"] == true
    assert "stale_resume" in recovered.recovery_event.reason_codes
    assert "runtime_not_live" in recovered.recovery_event.reason_codes

    assert AgentRunLog.get_run(run_id).failure_ref == "durable_runtime_not_live"
  end

  test "durable checkpoint recovery marks stale when checkpoint version is missing" do
    run_id = unique_run_id()

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: "work_checkpoint_version_missing",
        task_type: "agent_run",
        status: "PAUSED",
        phase: "CHECKPOINT",
        goal: "恢复旧格式长任务",
        scope_ref: "work_checkpoint_version_missing",
        created_by: "agent_run",
        parent_turn_ref: "turn_checkpoint_version_missing",
        checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "goal_version" => 1,
            "completed_step_refs" => ["step_checkpoint_version_missing_1"]
          },
          "progress" => 50,
          "step" => "旧格式 AgentRun 检查点"
        }
      })

    insert_durable_run_record(run_id, task.id, %{
      work_id: "work_checkpoint_version_missing",
      session_id: "session_checkpoint_version_missing",
      parent_turn_ref: "turn_checkpoint_version_missing",
      completed_step_refs: ["step_checkpoint_version_missing_1"]
    })

    assert {:ok, [recovered]} =
             AgentRunService.recover_durable(
               "work_checkpoint_version_missing",
               "session_checkpoint_version_missing"
             )

    assert recovered.run.status == :awaiting_author
    assert recovered.long_run_task.checkpoint_data["stale_reason"] == "checkpoint_version_missing"
    assert recovered.long_run_task.checkpoint_data["step"] == "恢复检查点缺少版本信息，等待作者确认"
    assert "checkpoint_version_missing" in recovered.recovery_event.reason_codes
    assert AgentRunLog.get_run(run_id).failure_ref == "checkpoint_version_missing"
  end

  test "durable checkpoint recovery marks stale when checkpoint version mismatches runtime contract" do
    run_id = unique_run_id()

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: "work_checkpoint_version_mismatch",
        task_type: "agent_run",
        status: "PAUSED",
        phase: "CHECKPOINT",
        goal: "恢复未来格式长任务",
        scope_ref: "work_checkpoint_version_mismatch",
        created_by: "agent_run",
        parent_turn_ref: "turn_checkpoint_version_mismatch",
        checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "goal_version" => 1,
            "completed_step_refs" => ["step_checkpoint_version_mismatch_1"],
            "checkpoint_version" => 999
          },
          "progress" => 50,
          "step" => "未来格式 AgentRun 检查点"
        }
      })

    insert_durable_run_record(run_id, task.id, %{
      work_id: "work_checkpoint_version_mismatch",
      session_id: "session_checkpoint_version_mismatch",
      parent_turn_ref: "turn_checkpoint_version_mismatch",
      completed_step_refs: ["step_checkpoint_version_mismatch_1"]
    })

    assert {:ok, [recovered]} =
             AgentRunService.recover_durable(
               "work_checkpoint_version_mismatch",
               "session_checkpoint_version_mismatch"
             )

    assert recovered.run.status == :awaiting_author

    assert recovered.long_run_task.checkpoint_data["stale_reason"] ==
             "checkpoint_version_mismatch"

    assert recovered.long_run_task.checkpoint_data["step"] == "恢复检查点版本与当前运行语义不一致，等待作者确认"
    assert "checkpoint_version_mismatch" in recovered.recovery_event.reason_codes
    assert AgentRunLog.get_run(run_id).failure_ref == "checkpoint_version_mismatch"
  end

  test "durable checkpoint recovery marks stale when work revision changed" do
    run_id = unique_run_id()

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: "work_revision_changed",
        task_type: "agent_run",
        status: "PAUSED",
        phase: "CHECKPOINT",
        goal: "恢复作品版本已变化的长任务",
        scope_ref: "work_revision_changed",
        created_by: "agent_run",
        parent_turn_ref: "turn_work_revision_changed",
        checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "goal_version" => 1,
            "work_revision" => 1,
            "completed_step_refs" => ["step_work_revision_changed_1"],
            "checkpoint_version" => 2
          },
          "progress" => 50,
          "step" => "AgentRun 检查点"
        }
      })

    insert_durable_run_record(run_id, task.id, %{
      work_id: "work_revision_changed",
      session_id: "session_work_revision_changed",
      parent_turn_ref: "turn_work_revision_changed",
      completed_step_refs: ["step_work_revision_changed_1"]
    })

    assert {:ok, [recovered]} =
             AgentRunService.recover_durable(
               "work_revision_changed",
               "session_work_revision_changed",
               work_revision: 2
             )

    assert recovered.run.status == :awaiting_author
    assert recovered.long_run_task.checkpoint_data["stale_reason"] == "work_revision_mismatch"
    assert recovered.long_run_task.checkpoint_data["step"] == "恢复时作品事实版本已变化，等待作者确认"
    assert "work_revision_mismatch" in recovered.recovery_event.reason_codes
    assert AgentRunLog.get_run(run_id).failure_ref == "work_revision_mismatch"
  end

  test "durable checkpoint recovery marks stale when target revision changed" do
    run_id = unique_run_id()

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: "work_target_revision_changed",
        task_type: "agent_run",
        status: "PAUSED",
        phase: "CHECKPOINT",
        goal: "恢复目标版本已变化的长任务",
        scope_ref: "work_target_revision_changed",
        created_by: "agent_run",
        parent_turn_ref: "turn_target_revision_changed",
        checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "goal_version" => 1,
            "target_revision_ref" => "draft:target:revision",
            "target_revision" => 4,
            "completed_step_refs" => ["step_target_revision_changed_1"],
            "checkpoint_version" => 2
          },
          "progress" => 50,
          "step" => "AgentRun 检查点"
        }
      })

    insert_durable_run_record(run_id, task.id, %{
      work_id: "work_target_revision_changed",
      session_id: "session_target_revision_changed",
      parent_turn_ref: "turn_target_revision_changed",
      completed_step_refs: ["step_target_revision_changed_1"]
    })

    assert {:ok, [recovered]} =
             AgentRunService.recover_durable(
               "work_target_revision_changed",
               "session_target_revision_changed",
               target_revision: 5
             )

    assert recovered.run.status == :awaiting_author
    assert recovered.long_run_task.checkpoint_data["stale_reason"] == "target_revision_mismatch"
    assert recovered.long_run_task.checkpoint_data["step"] == "恢复目标版本已变化，等待作者确认"
    assert "target_revision_mismatch" in recovered.recovery_event.reason_codes
    assert AgentRunLog.get_run(run_id).failure_ref == "target_revision_mismatch"
  end

  test "durable checkpoint recovery marks stale when target ref is missing" do
    run_id = unique_run_id()

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: "work_target_missing",
        task_type: "agent_run",
        status: "PAUSED",
        phase: "CHECKPOINT",
        goal: "恢复目标已不存在的长任务",
        scope_ref: "work_target_missing",
        created_by: "agent_run",
        parent_turn_ref: "turn_target_missing",
        checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "goal_version" => 1,
            "target_revision_ref" => "draft:target:missing",
            "target_revision" => 1,
            "completed_step_refs" => ["step_target_missing_1"],
            "checkpoint_version" => 2
          },
          "progress" => 50,
          "step" => "AgentRun 检查点"
        }
      })

    insert_durable_run_record(run_id, task.id, %{
      work_id: "work_target_missing",
      session_id: "session_target_missing",
      parent_turn_ref: "turn_target_missing",
      completed_step_refs: ["step_target_missing_1"]
    })

    assert {:ok, [recovered]} =
             AgentRunService.recover_durable(
               "work_target_missing",
               "session_target_missing",
               target_ref_exists?: false
             )

    assert recovered.run.status == :awaiting_author
    assert recovered.long_run_task.checkpoint_data["stale_reason"] == "target_ref_missing"
    assert recovered.long_run_task.checkpoint_data["step"] == "恢复目标已不存在，等待作者确认"
    assert "target_ref_missing" in recovered.recovery_event.reason_codes
    assert AgentRunLog.get_run(run_id).failure_ref == "target_ref_missing"
  end

  test "durable recovery falls back to active work run when joined session changed" do
    run_id = unique_run_id()

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: "work_session_changed",
        task_type: "agent_run",
        status: "PAUSED",
        phase: "CHECKPOINT",
        goal: "恢复长任务",
        scope_ref: "work_session_changed",
        created_by: "agent_run",
        parent_turn_ref: "turn_session_changed",
        checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
        completed_unit_refs: ["step_session_changed_1"],
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "goal_version" => 1,
            "completed_step_refs" => ["step_session_changed_1"],
            "checkpoint_version" => 2
          },
          "progress" => 50,
          "step" => "AgentRun 检查点"
        }
      })

    assert {:ok, _record} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: "work_session_changed",
               work_id: "work_session_changed",
               session_id: "session_original",
               parent_turn_ref: "turn_session_changed",
               origin_frame_ref: "frame_session_changed",
               run_mode: "durable",
               profile_ref: "character_design_with_context_v1",
               status: "awaiting_author",
               phase: "stopped",
               goal: %{"text" => "恢复长任务", "version" => 1},
               goal_version: 1,
               plan: %{},
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
               completed_step_refs: ["step_session_changed_1"],
               interrupt_state: %{"status" => "none"},
               long_run_task_ref: task.id
             })

    assert {:ok, [recovered]} =
             AgentRunService.recover_durable("work_session_changed", "session_after_reload")

    assert recovered.runtime_live? == false
    assert recovered.run.session_id == "session_original"
    assert recovered.run.long_run_task_ref == task.id
    assert recovered.long_run_task.checkpoint_data["stale_resume"] == true
    assert recovered.long_run_task.checkpoint_data["stale_reason"] == "session_ref_mismatch"
    assert "durable_recovered" in recovered.recovery_event.reason_codes
    assert "runtime_not_live" in recovered.recovery_event.reason_codes
    assert "session_ref_mismatch" in recovered.recovery_event.reason_codes
  end

  test "no-progress policy stops repeated step signatures" do
    parent = self()
    run_id = unique_run_id()

    step = fn _run, sequence ->
      send(parent, {:step_started, sequence})

      {:ok,
       %{
         step: step_struct(run_id, sequence, "step_#{sequence}"),
         observations: [],
         progress_signature: "same-tool:same-input"
       }}
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(base_run(run_id),
               next_step_planner: sequential_steps([step, step]),
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert_receive {:step_started, 2}
    assert_receive {:agent_event, :awaiting_author, "AgentRun 未取得新进展，已停止等待作者确认。"}, 500
    refute_receive {:agent_event, :run_completed, _}, 80

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :awaiting_author
    assert run.completed_step_refs == ["step_1", "step_2"]
  end

  test "steer updates run goal without pretending to complete the active step" do
    parent = self()
    run_id = unique_run_id()

    slow_step = fn _run, sequence ->
      send(parent, {:step_started, sequence})
      Process.sleep(80)
      {:ok, %{step: step_struct(run_id, sequence, "step_#{sequence}"), observations: []}}
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(base_run(run_id),
               next_step_planner: sequential_steps([slow_step]),
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert :ok = AgentRunService.steer(run_id, "改成更冷静的反派")

    assert_receive {:agent_event, :plan_adjusted, "已收到新的创作方向。"}
    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.goal.text == "改成更冷静的反派"
    assert run.goal.version == 2
    assert run.interrupt_state.status == :steer_requested

    assert_receive {:agent_event, :run_completed, "AgentRun 已完成。"}, 500
    assert {:ok, %{run: completed_run}} = AgentRunService.state(run_id)
    assert completed_run.status == :completed
  end

  test "steer promotes the next plan event into a single plan_revised event" do
    parent = self()
    run_id = unique_run_id()

    slow_step = fn _run, sequence ->
      send(parent, {:step_started, sequence})
      Process.sleep(40)
      {:ok, %{step: step_struct(run_id, sequence, "step_#{sequence}"), observations: []}}
    end

    final_step = fn _run, sequence ->
      send(parent, {:step_started, sequence})

      {:ok,
       %{
         step: step_struct(run_id, sequence, "step_#{sequence}"),
         observations: [],
         loop_status: :completed
       }}
    end

    planner = fn run, sequence, _snapshot ->
      step_fun = if sequence == 1, do: slow_step, else: final_step
      opts = if sequence == 2, do: [narrative_source: true], else: []

      {:execute, wrap_test_step(step_fun, 2), test_execute_decision(run, sequence, opts),
       %{provider_call_count: 0}}
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(base_run(run_id),
               next_step_planner: planner,
               event_sink: event_sink_full(parent)
             )

    assert_receive {:step_started, 1}
    assert :ok = AgentRunService.steer(run_id, "改成更冷静的反派")

    assert_receive {:agent_event_full, :plan_adjusted, _event}, 500
    assert_receive {:agent_event_full, :plan_revised, event}, 500

    assert "agent_plan_revised" in event.reason_codes
    assert "steer_replan" in event.reason_codes
    refute "agent_plan_drafted" in event.reason_codes
    assert event.payload.evaluation_of_last.plan_holds == false
    assert event.payload.evaluation_of_last.new_constraint == "改成更冷静的反派"
    assert event.payload.plan_revision.plan_version == 2
    assert event.payload.plan_revision.revision_reason == event.summary

    assert_receive {:step_started, 2}
    assert_receive {:agent_event_full, :run_completed, _event}, 500

    assert {:ok, %{run: completed_run}} = AgentRunService.state(run_id)
    assert completed_run.status == :completed
    assert completed_run.goal.version == 2
    assert completed_run.plan_version == 2
    assert completed_run.consumed_budget.replans == 1
    assert completed_run.interrupt_state.status == :none
  end

  test "character design flow reads roster then emits tentative artifact event" do
    parent = self()

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "先看看现有角色阵容，然后设计一个反派",
          workspace_id: "ws-flow",
          work_id: "work-flow",
          session_id: "session-flow",
          turn_id: "turn-flow"
        },
        nil,
        fixed_json_provider([single_item("agent-antagonist")])
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: event_sink_with_payload(parent)
             )

    assert_receive {:agent_event, :exploration_observed, "当前作品暂未读取到已确认角色。", _payload},
                   500

    assert_receive {:agent_event, :artifact_created, "已生成待采纳候选。", payload}, 500

    turn_result = payload.turn_result
    assert %{pending: [%{artifact_id: artifact_id}]} = turn_result.adoption_state
    assert is_binary(artifact_id)

    assert_receive {:agent_event, :run_completed, "AgentRun 已完成。", %{}}, 500

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :completed
    assert run.pending_artifact_refs == [artifact_id]
  end

  test "provider progress flow emits author-safe provider progress and provider budget" do
    parent = self()

    result_fn = fn prompt ->
      send(parent, {:provider_called, prompt})
      {:ok, %{content: "provider-progress-output"}}
    end

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :provider_progress,
        %{
          text: "请展示 provider 进度并说明取消边界",
          workspace_id: "ws-provider-progress",
          work_id: "work-provider-progress",
          session_id: "session-provider-progress",
          turn_id: "turn-provider-progress",
          provider_capabilities_fn: fn ->
            %{
              provider: :stub,
              supports_streaming: true,
              supports_cancellation: true,
              cancel_strategy: :provider_execution_cancel
            }
          end
        },
        nil,
        %Execution{result_fn: result_fn}
      )

    assert spec.run_attrs.profile_ref == "provider_progress_v1"
    assert spec.run_attrs.budget.max_provider_calls == 1
    assert is_function(spec.next_step_planner, 3)

    assert_raise ArgumentError, "provider_progress_v1 requires next_step_planner/1", fn ->
      ProviderProgress.steps(%{})
    end

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: event_sink_full(parent)
             )

    assert_receive {:agent_event_full, :provider_progress, start_event}, 500
    assert "provider_call_started" in start_event.reason_codes
    refute Map.has_key?(start_event.payload, :prompt)
    refute Map.has_key?(start_event.payload, "prompt")

    assert_receive {:agent_event_full, :provider_progress, active_event}, 500
    assert "provider_execution_stream_active" in active_event.reason_codes
    assert active_event.payload.stream_mode == :provider_stream

    assert_receive {:provider_called, prompt}, 500
    assert prompt =~ "请展示 provider 进度"

    assert_receive {:agent_event_full, :provider_progress, completed_event}, 500
    assert "provider_call_completed" in completed_event.reason_codes
    assert completed_event.payload.output_chars == String.length("provider-progress-output")

    assert_receive {:agent_event_full, :turn_result_ready, turn_event}, 500
    assert turn_event.payload.turn_result.agent_run.run_id == run_id
    assert_receive {:agent_event_full, :run_completed, _}, 500

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :completed
    assert run.consumed_budget.provider_calls == 1
    assert run.pending_artifact_refs == []
  end

  test "readonly batch profile reads multiple sources without provider calls or artifacts" do
    parent = self()

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :readonly_batch_context,
        %{
          text: "请只读批量读取作品上下文、角色档案和规则档案，不要写入作品。",
          workspace_id: "ws-readonly-batch",
          work_id: "work-readonly-batch",
          session_id: "session-readonly-batch",
          turn_id: "turn-readonly-batch",
          readonly_readers: %{
            work_profile: fn -> %{title: "只读作品", status: "DRAFT"} end,
            characters: fn -> [%{name: "林澈"}] end,
            rules: fn -> [%{title: "不能写入"}] end,
            stats: fn -> %{characters: 1, rules: 1} end
          }
        },
        nil,
        reply_only_provider()
      )

    assert spec.run_attrs.profile_ref == "readonly_batch_context_v1"
    assert spec.run_attrs.authority_scope.production_write == false
    assert spec.run_attrs.budget.max_provider_calls == 1
    assert is_function(spec.next_step_planner, 3)

    assert_raise ArgumentError, "readonly_batch_context_v1 requires next_step_planner/1", fn ->
      ReadonlyBatchContext.steps(%{})
    end

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: event_sink_full(parent)
             )

    batch_item_events =
      for _ <- 1..4 do
        assert_receive {:agent_event_full, :tool_completed, event}, 500
        event
      end

    assert Enum.all?(batch_item_events, &("readonly_batch_item_read" in &1.reason_codes))
    assert Enum.all?(batch_item_events, &(get_in(&1.payload, [:production_write]) == false))

    assert_receive {:agent_event_full, :turn_result_ready, turn_event}, 500
    assert get_in(turn_event.payload.turn_result, [:trace_summary, :readonly_batch]) == true
    assert get_in(turn_event.payload.turn_result, [:trace_summary, :production_write]) == false

    assert get_in(turn_event.payload.turn_result, [
             :trace_summary,
             :replay_policy,
             :recall_provider
           ]) ==
             false

    assert_receive {:agent_event_full, :run_completed, _}, 500

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :completed
    assert run.consumed_budget.provider_calls == 0
    assert run.consumed_budget.tool_calls == 4
    assert run.pending_artifact_refs == []
  end

  test "one-step budget in author request stops after roster observation" do
    parent = self()

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "先看看现有角色阵容，然后设计一个反派，最多一步",
          workspace_id: "ws-budget",
          work_id: "work-budget",
          session_id: "session-budget",
          turn_id: "turn-budget"
        },
        nil,
        fixed_json_provider([single_item("budget-antagonist")])
      )

    assert spec.run_attrs.budget.max_steps == 1

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: event_sink(parent)
             )

    assert_receive {:agent_event, :awaiting_author, "AgentRun 已达到预算上限。"}, 500

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :awaiting_author
    assert run.completed_step_refs == ["step_#{run_id}_1"]
    refute_receive {:agent_event, :artifact_created, _}, 80
  end

  test "repeated roster request stops at no-progress without character design provider call" do
    parent = self()

    result_fn = fn prompt ->
      if agent_next_step_prompt?(prompt) do
        {:ok, %{content: next_step_decision(prompt)}}
      else
        send(parent, :provider_called)
        {:ok, %{content: Jason.encode!([single_item("repeat-antagonist")])}}
      end
    end

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "先重复读取角色阵容，直到没有新信息，然后再设计一个反派",
          workspace_id: "ws-progress",
          work_id: "work-progress",
          session_id: "session-progress",
          turn_id: "turn-progress"
        },
        nil,
        %Execution{result_fn: result_fn}
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: event_sink(parent)
             )

    assert_receive {:agent_event, :awaiting_author, "AgentRun 未取得新进展，已停止等待作者确认。"},
                   500

    refute_receive :provider_called, 80

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :awaiting_author
    assert run.completed_step_refs == ["step_#{run_id}_1", "step_#{run_id}_2"]
  end

  defp base_run(run_id) do
    %{
      run_id: run_id,
      workspace_id: "ws_1",
      work_id: "work_1",
      session_id: "sess_1",
      parent_turn_ref: "turn_1",
      origin_frame_ref: "frame_1",
      profile_ref: "character_design_with_context_v1",
      goal: %{text: "先看角色阵容，再设计反派", version: 1},
      authority_scope: %{
        production_write: false,
        allowed_tools: ["character_roster", "character_design"]
      }
    }
  end

  defp step_struct(run_id, sequence, step_id) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: step_id,
        run_ref: run_id,
        sequence: sequence,
        status: :completed,
        goal: "执行第 #{sequence} 步",
        micro_plan_ref: "mp_#{sequence}",
        decision_ref: "decision_#{sequence}",
        tool_request_ref: "tq_#{sequence}",
        tool_result_ref: "tr_#{sequence}",
        idempotency_key: "#{run_id}:#{sequence}"
      })

    step
  end

  defp observation(run_id, sequence) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{sequence}",
        run_ref: run_id,
        step_ref: "step_#{sequence}",
        observation_type: :character_roster,
        source_ref: "tr_#{sequence}",
        summary: "第 #{sequence} 步观察。",
        evidence_refs: ["tool_result:tr_#{sequence}"]
      })

    observation
  end

  defp event_sink(parent) do
    fn event -> send(parent, {:agent_event, event.event_type, event.summary}) end
  end

  defp event_sink_with_payload(parent) do
    fn event -> send(parent, {:agent_event, event.event_type, event.summary, event.payload}) end
  end

  defp event_sink_full(parent) do
    fn event -> send(parent, {:agent_event_full, event.event_type, event}) end
  end

  defp collect_full_events_until(target_type, timeout_ms, acc \\ []) do
    receive do
      {:agent_event_full, ^target_type, event} ->
        Enum.reverse([event | acc])

      {:agent_event_full, _event_type, event} ->
        collect_full_events_until(target_type, timeout_ms, [event | acc])
    after
      timeout_ms ->
        flunk("expected agent_event_full #{target_type} before timeout")
    end
  end

  defp provider_activity_execution(frame_json) when is_binary(frame_json) do
    %Execution{
      purpose: :conversation,
      execute_fn: fn prompt ->
        if agent_next_step_prompt?(prompt) do
          provider_activity_success_result(
            prompt,
            :author_reasoning,
            next_step_decision(prompt)
          )
        else
          provider_activity_success_result(prompt, :conversation, frame_json)
        end
      end
    }
  end

  defp provider_activity_execution(:conversation_error) do
    %Execution{
      purpose: :conversation,
      execute_fn: fn prompt ->
        if agent_next_step_prompt?(prompt) do
          provider_activity_success_result(
            prompt,
            :author_reasoning,
            next_step_decision(prompt)
          )
        else
          provider_activity_error_result()
        end
      end
    }
  end

  defp provider_activity_success_result(_prompt, purpose, content) do
    {run_ref, call_ref} = provider_refs_for_purpose(purpose)

    {:ok, provider_run} =
      ProviderRun.new(%{
        provider_run_id: run_ref,
        provider_call_ref: call_ref,
        purpose: purpose,
        execution_mode: :event_stream,
        status: :completed,
        provider_id: "stub",
        model: "stub-model"
      })

    {:ok, started_event} =
      ProviderEvent.new(%{
        event_id: "pevt-#{purpose}-started",
        provider_run_ref: run_ref,
        sequence: 1,
        event_type: :started,
        summary: "provider started",
        refs: [call_ref],
        payload: %{provider: "stub"}
      })

    {:ok, final_event} =
      ProviderEvent.new(%{
        event_id: "pevt-#{purpose}-final",
        provider_run_ref: run_ref,
        sequence: 3,
        event_type: :final_output,
        visibility: :developer,
        summary: "provider final output",
        refs: [call_ref],
        payload: %{raw_prompt: "must not be projected"}
      })

    {:ok, chunk_event} =
      ProviderEvent.new(%{
        event_id: "pevt-#{purpose}-chunk",
        provider_run_ref: run_ref,
        sequence: 2,
        event_type: :chunk,
        summary: "provider chunk",
        refs: [call_ref],
        payload: %{
          output_type: :text,
          chunk_index: 1,
          content_length: 7,
          accumulated_content_length: 7,
          author_narrative_delta: author_reasoning_delta(purpose, content)
        }
      })

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: run_ref,
        provider_call_ref: call_ref,
        status: :ok,
        output_type: :text,
        content: %{text: content},
        usage: %{total_tokens: 12},
        refs: [call_ref]
      })

    {:ok,
     %{
       provider_run: provider_run,
       events: [started_event, chunk_event, final_event],
       output: output,
       result: Result.new(content)
     }}
  end

  defp provider_activity_error_result do
    raw_failure = "raw provider failure payload must not be projected"

    {:ok, provider_run} =
      ProviderRun.new(%{
        provider_run_id: "prun-conversation-error",
        provider_call_ref: "pcall-conversation-error",
        purpose: :conversation,
        execution_mode: :event_stream,
        status: :failed,
        provider_id: "stub",
        model: "stub-model"
      })

    {:ok, started_event} =
      ProviderEvent.new(%{
        event_id: "pevt-conversation-error-started",
        provider_run_ref: "prun-conversation-error",
        sequence: 1,
        event_type: :started,
        summary: "provider started",
        refs: ["pcall-conversation-error"],
        payload: %{provider: "stub"}
      })

    {:ok, error_event} =
      ProviderEvent.new(%{
        event_id: "pevt-conversation-error",
        provider_run_ref: "prun-conversation-error",
        sequence: 2,
        event_type: :error,
        visibility: :developer,
        summary: "provider failed",
        refs: ["pcall-conversation-error"],
        payload: %{message: raw_failure, raw_prompt: "must not be projected"}
      })

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun-conversation-error",
        provider_call_ref: "pcall-conversation-error",
        status: :error,
        output_type: :empty,
        error: %{type: :provider_error, message: raw_failure},
        refs: ["pcall-conversation-error"]
      })

    {:error,
     %{
       provider_run: provider_run,
       events: [started_event, error_event],
       output: output,
       error: %{type: :provider_error, message: raw_failure}
     }}
  end

  defp provider_refs_for_purpose(:author_reasoning),
    do: {"prun-author-reasoning", "pcall-author-reasoning"}

  defp provider_refs_for_purpose(:conversation), do: {"prun-conversation", "pcall-conversation"}

  defp author_reasoning_delta(:author_reasoning, content) when is_binary(content) do
    content
    |> String.split("{", parts: 2)
    |> hd()
    |> case do
      "" -> nil
      delta -> delta
    end
  end

  defp author_reasoning_delta(_purpose, _content), do: nil

  defp fixed_json_provider(items) do
    json = Jason.encode!(items)

    %Execution{
      result_fn: fn prompt ->
        if agent_next_step_prompt?(prompt) do
          {:ok, %{content: next_step_decision(prompt)}}
        else
          {:ok, %{content: json}}
        end
      end
    }
  end

  defp agent_next_step_prompt?(prompt) when is_binary(prompt),
    do: String.contains?(prompt, "AgentRun 下一步规划器")

  defp agent_next_step_prompt?(_prompt), do: false

  defp next_step_decision(prompt) do
    decision =
      cond do
        String.contains?(prompt, "profile_ref: conversation_turn_v1") ->
          conversation_next_step_decision(prompt)

        String.contains?(prompt, "/ artifact_created:") ->
          done_next("已生成待采纳角色候选，本轮目标已经满足。", ["goal_satisfied"])

        String.contains?(prompt, "/ character_roster:") and
            String.contains?(prompt, "重复读取角色阵容") ->
          continue_next("再次读取当前角色阵容，检查是否有新增信息。", "character_roster", "none", [
            "repeat_roster_probe"
          ])

        String.contains?(prompt, "/ character_roster:") ->
          continue_next("基于已读取的角色阵容设计新的主要反派。", "character_design", "tentative", [
            "roster_observation_consumed"
          ])

        true ->
          continue_next("先读取当前作品已确认角色阵容。", "character_roster", "none", [
            "missing_roster_observation"
          ])
      end

    structured_next_step_decision(decision, prompt)
  end

  defp structured_next_step_decision(packet, prompt) do
    plan_holds = not String.contains?(prompt, "NNARR_REPLAN_PLAN_HOLDS_FALSE")
    new_constraint = if plan_holds, do: nil, else: "测试前提不成立。"

    tail = %{
      "evaluation_of_last" => %{
        "advanced" => Map.get(Map.fetch!(packet, :decision), "type") != "no_progress",
        "plan_holds" => plan_holds,
        "new_constraint" => new_constraint
      },
      "decision" => decision_for_plan_holds(packet, plan_holds),
      "next_action" => Map.fetch!(packet, :next_action),
      "plan_revision" => plan_revision_for(plan_holds, new_constraint),
      "reason_codes" => Map.get(packet, :reason_codes, []),
      "confidence" => Map.get(packet, :confidence, 1.0)
    }

    Map.fetch!(packet, :reasoning) <> "\n" <> Jason.encode!(tail)
  end

  defp decision_for_plan_holds(packet, false) do
    case Map.fetch!(packet, :decision) do
      %{"type" => "continue"} -> %{"type" => "replan"}
      decision -> decision
    end
  end

  defp decision_for_plan_holds(packet, _plan_holds), do: Map.fetch!(packet, :decision)

  defp continue_next(reasoning, target_tool_ref, write_intent, reason_codes) do
    %{
      reasoning: reasoning,
      decision: %{"type" => "continue"},
      next_action: %{
        "target_tool_ref" => target_tool_ref,
        "write_intent" => write_intent,
        "risk_hint" => "low"
      },
      plan_revision: nil,
      reason_codes: reason_codes,
      confidence: 1.0
    }
  end

  defp done_next(reasoning, reason_codes) do
    %{
      reasoning: reasoning,
      decision: %{"type" => "done"},
      next_action: %{"target_tool_ref" => nil, "write_intent" => "none", "risk_hint" => "low"},
      plan_revision: nil,
      reason_codes: reason_codes,
      confidence: 1.0
    }
  end

  defp plan_revision_for(false, revision_reason),
    do: %{"plan_version" => 2, "revision_reason" => revision_reason}

  defp plan_revision_for(_plan_holds, _revision_reason), do: nil

  defp conversation_next_step_decision(prompt) do
    observations = existing_observation_section(prompt)

    cond do
      String.contains?(observations, "已生成本轮回应") ->
        done_next("已生成本轮回应，本轮目标已经满足。", [
          "goal_satisfied",
          "conversation_turn_response_created"
        ])

      String.contains?(observations, "无需工具") ->
        continue_next("根据系统裁决生成本轮回应。", "response_finalize", "none", [
          "agentic_next_step",
          "conversation_strategy_consumed"
        ])

      String.contains?(observations, "对话认知帧") ->
        continue_next("基于对话认知帧完成执行策略与系统裁决。", "strategy_gate", "none", [
          "agentic_next_step",
          "dialogue_frame_consumed"
        ])

      String.contains?(observations, "创作上下文") ->
        continue_next("基于已组装上下文形成对话认知帧。", "dialogue_frame", "none", [
          "agentic_next_step",
          "conversation_context_consumed"
        ])

      true ->
        continue_next("先组装当前作品的创作上下文。", "context_assemble", "none", [
          "agentic_next_step",
          "missing_conversation_context"
        ])
    end
  end

  defp existing_observation_section(prompt) do
    prompt
    |> String.split("## 决策规则", parts: 2)
    |> hd()
  end

  defp single_item(id) do
    %{
      "item_id" => id,
      "title" => "title-#{id}",
      "body" => "body-#{id}",
      "rationale" => nil
    }
  end

  defp reply_only_provider do
    %Execution{
      result_fn: fn prompt ->
        content =
          if agent_next_step_prompt?(prompt) do
            next_step_decision(prompt)
          else
            reply_only_frame_json()
          end

        {:ok, %{content: content}}
      end
    }
  end

  defp reply_only_frame_json do
    Jason.encode!(%{
      frame_type: "casual_reply",
      dialogue_goal_summary: "回应作者测试输入",
      needs_tool: false,
      no_tool_reason: "no_tool_needed",
      execution_readiness: "not_applicable",
      assistant_message: "收到你的测试消息。",
      candidate_directions: [],
      context_used: true,
      uncertainty: []
    })
  end

  defp sequential_steps(steps) when is_list(steps) do
    fn run, sequence, _snapshot ->
      case Enum.at(steps, sequence - 1) do
        nil ->
          {:complete, test_complete_decision(run, sequence), %{provider_call_count: 0}}

        step_fun when is_function(step_fun) ->
          {:execute, wrap_test_step(step_fun, length(steps)),
           test_execute_decision(run, sequence), %{provider_call_count: 0}}
      end
    end
  end

  defp assert_planner_step(event, target_tool_ref) do
    assert "agent_plan_drafted" in event.reason_codes
    assert is_list(event.payload.plan_steps)
    assert event.payload.author_narrative == event.summary

    NovelApplication.TestAssertions.assert_provider_output_narrative_source(
      event.payload.author_narrative_source
    )

    assert event.payload.target_tool_ref == target_tool_ref
  end

  defp wrap_test_step(step_fun, step_count) do
    fn run, sequence, snapshot ->
      step_fun
      |> execute_test_step(run, sequence, snapshot)
      |> maybe_complete_test_step(sequence, step_count)
    end
  end

  defp execute_test_step(step_fun, run, sequence, snapshot) when is_function(step_fun, 3),
    do: step_fun.(run, sequence, snapshot)

  defp execute_test_step(step_fun, run, sequence, _snapshot) when is_function(step_fun, 2),
    do: step_fun.(run, sequence)

  defp maybe_complete_test_step({:ok, result}, sequence, step_count)
       when is_map(result) and sequence >= step_count,
       do: {:ok, Map.put(result, :loop_status, :completed)}

  defp maybe_complete_test_step(result, _sequence, _step_count), do: result

  defp test_execute_decision(run, sequence, opts \\ []) do
    summary = "执行测试步骤 #{sequence}。"

    attrs = %{
      decision_id: "and_#{run.run_id}_#{sequence}_test_step",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :execute_step,
      summary: summary,
      target_tool_ref: first_allowed_tool(run),
      write_intent: :none,
      risk_hint: :low,
      reason_codes: ["test_sequential_step"]
    }

    attrs =
      if Keyword.get(opts, :narrative_source, false) do
        Map.put(attrs, :narrative_source, provider_output_narrative_source(summary))
      else
        attrs
      end

    {:ok, decision} =
      AgentNextStepDecision.new(attrs)

    decision
  end

  defp provider_output_narrative_source(summary) do
    %{
      source_type: "provider_output",
      provider_run_ref: "pr_test",
      provider_call_ref: "pc_test",
      provider_output_ref: "po_test",
      source_hash: "source_hash",
      source_byte_range: %{start: 0, length: byte_size(summary)},
      narrative_hash: "narrative_hash"
    }
  end

  defp replan_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_replan",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :execute_step,
        summary: "测试前提不成立，先按新约束执行下一步。",
        target_tool_ref: first_allowed_tool(run),
        write_intent: :none,
        risk_hint: :low,
        reason_codes: ["test_replan"],
        evaluation_of_last: %{
          advanced: true,
          plan_holds: false,
          new_constraint: "测试前提不成立。"
        },
        plan_revision: %{
          plan_version: 2,
          revision_reason: "测试前提不成立。"
        }
      })

    decision
  end

  defp test_complete_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_test_complete",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "测试 AgentRun 已完成。",
        reason_codes: ["test_goal_satisfied"]
      })

    decision
  end

  defp first_allowed_tool(%{authority_scope: %{allowed_tools: [tool | _rest]}}), do: tool
  defp first_allowed_tool(_run), do: "test_step"

  defp insert_durable_run_record(run_id, long_run_task_ref, attrs) do
    work_id = Map.fetch!(attrs, :work_id)
    session_id = Map.fetch!(attrs, :session_id)
    parent_turn_ref = Map.fetch!(attrs, :parent_turn_ref)
    completed_step_refs = Map.get(attrs, :completed_step_refs, [])

    assert {:ok, _record} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: Map.get(attrs, :workspace_id, work_id),
               work_id: work_id,
               session_id: session_id,
               parent_turn_ref: parent_turn_ref,
               origin_frame_ref: Map.get(attrs, :origin_frame_ref, "frame_#{parent_turn_ref}"),
               run_mode: "durable",
               profile_ref: Map.get(attrs, :profile_ref, "character_design_with_context_v1"),
               status: Map.get(attrs, :status, "running"),
               phase: Map.get(attrs, :phase, "executing"),
               goal: %{"text" => Map.get(attrs, :goal_text, "恢复长任务"), "version" => 1},
               goal_version: 1,
               plan: %{},
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
                 "steps" => length(completed_step_refs),
                 "tool_calls" => length(completed_step_refs),
                 "provider_calls" => 0,
                 "replans" => 0
               },
               completed_step_refs: completed_step_refs,
               interrupt_state: %{"status" => "none"},
               long_run_task_ref: long_run_task_ref
             })
  end

  defp unique_run_id do
    "run_test_#{System.unique_integer([:positive, :monotonic])}"
  end

  defp wait_for(fun, timeout_ms \\ 500) do
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
