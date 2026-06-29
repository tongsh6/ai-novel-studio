defmodule NovelApplication.AgentRunRuntimeTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentStep
  alias NovelPersistence.{AgentRunLog, LongRunTaskLog, Repo}

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
               steps: [step],
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert_receive {:agent_event, :run_started, "AgentRun 已启动。"}
    assert_receive {:agent_event, :step_proposed, "正在执行第 1 步。"}
    assert_receive {:agent_event, :observation_recorded, "第 1 步观察。"}
    assert_receive {:agent_event, :run_completed, "AgentRun 已完成。"}

    assert {:ok, %{run: run, remaining_steps: 0}} = AgentRunService.state(run_id)
    assert run.status == :completed
    assert run.phase == :stopped
    assert run.completed_step_refs == ["step_1"]
    assert run.pending_artifact_refs == ["as_1"]
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
               steps: [step],
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
    assert "step_proposed" in event_types
    assert "observation_recorded" in event_types
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
               steps: spec.steps,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    assert_receive {:agent_event, :step_proposed, context_step}
    assert context_step.summary =~ "组装创作上下文"

    assert_receive {:agent_event, :goal_understood, context_stage}, 500
    assert "context_assembled" in context_stage.reason_codes
    assert context_stage.payload.stage == :context_assembled

    assert_receive {:agent_event, :observation_recorded, context_event}, 500
    assert context_event.summary =~ "已组装本轮创作上下文"

    assert_receive {:agent_event, :step_proposed, frame_step}, 500
    assert frame_step.summary =~ "形成对话认知帧"

    assert_receive {:agent_event, :plan_created, frame_stage}, 500
    assert "dialogue_frame_formed" in frame_stage.reason_codes
    assert frame_stage.payload.stage == :dialogue_frame_formed
    assert frame_stage.payload.needs_tool == false

    assert_receive {:agent_event, :observation_recorded, frame_event}, 500
    assert frame_event.summary =~ "casual_reply"

    assert_receive {:agent_event, :step_proposed, strategy_step}, 500
    assert strategy_step.summary =~ "执行策略"

    assert_receive {:agent_event, :gate_decided, gate_stage}, 500
    assert "reply_only_no_tool" in gate_stage.reason_codes
    assert gate_stage.payload.stage == :reply_only_gate

    assert_receive {:agent_event, :observation_recorded, strategy_event}, 500
    assert strategy_event.summary =~ "无需工具"

    assert_receive {:agent_event, :step_proposed, finalize_step}, 500
    assert finalize_step.summary =~ "生成本轮回应"

    assert_receive {:agent_event, :turn_result_ready, turn_event}, 500
    assert turn_event.payload.turn_result.agent_run.run_id == run_id
    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :completed
    assert run.consumed_budget.steps == 4
    assert run.consumed_budget.tool_calls == 0
    assert run.consumed_budget.provider_calls == 1
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
               steps: [slow_step, fast_step],
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert :ok = AgentRunService.pause(run_id)

    assert_receive {:agent_event, :interrupt_requested, "正在请求暂停。"}
    assert_receive {:agent_event, :run_paused, "AgentRun 已暂停。"}, 500
    refute_receive {:step_started, 2}, 120

    assert {:ok, %{run: run, remaining_steps: 1}} = AgentRunService.state(run_id)
    assert run.status == :paused
    assert run.phase == :stopped
    assert run.completed_step_refs == ["step_1"]
  end

  test "cancel during an active provider step waits for cooperative safe point" do
    parent = self()
    run_id = unique_run_id()

    slow_step = fn _run, sequence ->
      send(parent, {:step_started, sequence})
      Process.sleep(120)
      {:ok, %{step: step_struct(run_id, sequence, "step_#{sequence}"), observations: []}}
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(base_run(run_id),
               steps: [slow_step],
               event_sink: event_sink_full(parent)
             )

    assert_receive {:step_started, 1}
    assert :ok = AgentRunService.cancel(run_id)

    assert_receive {:agent_event_full, :interrupt_requested, interrupt_event}, 500
    assert "cooperative_cancel" in interrupt_event.reason_codes
    assert "provider_hard_cancel_unsupported" in interrupt_event.reason_codes
    assert interrupt_event.payload.cancel_strategy == :cooperative_safe_point

    assert {:ok, %{run: cancelling_run, current_task?: true}} = AgentRunService.state(run_id)
    assert cancelling_run.status == :cancelling
    assert cancelling_run.interrupt_state.status == :cancel_requested

    assert_receive {:agent_event_full, :run_cancelled, cancelled_event}, 500
    assert "cooperative_cancel" in cancelled_event.reason_codes

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
               steps: [step, step],
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert_receive {:agent_event, :awaiting_author, "AgentRun 已达到预算上限。"}, 500
    refute_receive {:step_started, 2}, 80

    assert {:ok, %{run: run, remaining_steps: 1}} = AgentRunService.state(run_id)
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
      |> Map.put(:budget, %{
        max_steps: 1,
        max_tool_calls: 4,
        max_provider_calls: 3,
        max_replans: 1
      })

    assert {:ok, ^run_id} =
             AgentRunService.start_durable(attrs,
               steps: [step, step],
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

    assert {:ok, [recovered]} = AgentRunService.recover_durable("work_1", "sess_1")
    assert recovered.runtime_live? == true
    assert recovered.run.long_run_task_ref == task.id
    assert "runtime_live" in recovered.recovery_event.reason_codes
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
            "checkpoint_version" => 1
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
            "checkpoint_version" => 1
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
    assert "durable_recovered" in recovered.recovery_event.reason_codes
    assert "runtime_not_live" in recovered.recovery_event.reason_codes
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
               steps: [step, step],
               event_sink: event_sink(parent)
             )

    assert_receive {:step_started, 1}
    assert_receive {:step_started, 2}
    assert_receive {:agent_event, :awaiting_author, "AgentRun 未取得新进展，已停止等待作者确认。"}, 500
    refute_receive {:agent_event, :run_completed, _}, 80

    assert {:ok, %{run: run, remaining_steps: 0}} = AgentRunService.state(run_id)
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
               steps: [slow_step],
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
               steps: spec.steps,
               event_sink: event_sink_with_payload(parent)
             )

    assert_receive {:agent_event, :observation_recorded, "当前作品暂未读取到已确认角色。", _payload},
                   500

    assert_receive {:agent_event, :artifact_created, "已生成待采纳候选。", payload}, 500

    turn_result = payload.turn_result
    assert %{pending: [%{artifact_id: artifact_id}]} = turn_result.adoption_state
    assert is_binary(artifact_id)

    assert_receive {:agent_event, :run_completed, "AgentRun 已完成。", %{}}, 500

    assert {:ok, %{run: run, remaining_steps: 0}} = AgentRunService.state(run_id)
    assert run.status == :completed
    assert run.pending_artifact_refs == [artifact_id]
  end

  test "provider progress flow emits author-safe provider progress and provider budget" do
    parent = self()

    complete_fn = fn prompt ->
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
              supports_streaming: false,
              supports_cancellation: false,
              cancel_strategy: :cooperative_safe_point
            }
          end
        },
        nil,
        complete_fn
      )

    assert spec.run_attrs.profile_ref == "provider_progress_v1"
    assert spec.run_attrs.budget.max_provider_calls == 1

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               steps: spec.steps,
               event_sink: event_sink_full(parent)
             )

    assert_receive {:agent_event_full, :provider_progress, start_event}, 500
    assert "provider_call_started" in start_event.reason_codes
    refute Map.has_key?(start_event.payload, :prompt)
    refute Map.has_key?(start_event.payload, "prompt")

    assert_receive {:agent_event_full, :provider_progress, degraded_event}, 500
    assert "provider_streaming_unavailable" in degraded_event.reason_codes
    assert degraded_event.payload.stream_mode == :checkpoint

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

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               steps: spec.steps,
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
               steps: spec.steps,
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

    complete_fn = fn _prompt ->
      send(parent, :provider_called)
      {:ok, %{content: Jason.encode!([single_item("repeat-antagonist")])}}
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
        complete_fn
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               steps: spec.steps,
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

  defp fixed_json_provider(items) do
    json = Jason.encode!(items)
    fn _prompt -> {:ok, %{content: json}} end
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
    fn _prompt ->
      {:ok,
       %{
         content:
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
       }}
    end
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
