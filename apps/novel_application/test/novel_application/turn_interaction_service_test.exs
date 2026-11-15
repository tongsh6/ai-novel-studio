defmodule NovelApplication.TurnInteractionServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.{
    AgentRunServer,
    ArtifactAssembler,
    AuthorContentRegistration,
    AuthorQuestion,
    TraceReplayService,
    TurnInteractionService,
    TurnResultBuilder
  }

  alias NovelApplication.AgentRunService

  alias NovelDomain.{AgentNextStepDecision, AgentStep, DecisionTrace, DialogueContext}

  alias NovelPersistence.{
    AgentRunLog,
    InteractionLifecycle,
    MemoryLog,
    Repo,
    TraceRepository,
    WorkRepo,
    WorkSessionRepo
  }

  setup do
    owner = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(owner) end)
    {:ok, work} = WorkRepo.create(%{title: "处置入口"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    run_id = "run_#{System.unique_integer([:positive])}"

    attrs = %{
      run_id: run_id,
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      parent_turn_ref: "turn_#{run_id}",
      origin_frame_ref: "frame_#{run_id}",
      profile_ref: "readonly_batch_context_v1",
      goal: %{text: "查看作品档案", version: 1},
      trigger: %{kind: "user_message"},
      authority_scope: %{production_write: false, allowed_tools: ["readonly_batch"]}
    }

    on_exit(fn ->
      NovelApplication.AgentRunSupervisor
      |> DynamicSupervisor.which_children()
      |> Enum.each(fn {_, pid, _, _} ->
        case AgentRunServer.state(pid) do
          %{run: %{work_id: work_id}} when work_id == work.id ->
            DynamicSupervisor.terminate_child(NovelApplication.AgentRunSupervisor, pid)

          _ ->
            :ok
        end
      end)
    end)

    %{attrs: attrs, store: &InteractionLifecycle.call/2}
  end

  test "当前作者输入缺失或空白时拒绝，不用应用 goal 合成作者消息", %{attrs: attrs, store: store} do
    {:ok, run} = NovelDomain.AgentRun.new(attrs)

    for input <- [%{}, %{text: nil}, %{text: " \n\t"}] do
      assert {:error, :author_input_unavailable} =
               TurnInteractionService.receive_input(run, store, input)
    end

    assert MemoryLog.transcript(attrs.session_id) == []
  end

  test "steer 使用当前 receipt 原字节，旧 context 与 planner 闭包不能覆盖来源", %{attrs: attrs, store: store} do
    old_persistence = Application.get_env(:novel_web, :persistence, [])

    Application.put_env(
      :novel_web,
      :persistence,
      Keyword.put(old_persistence, :inject_real_persistence, true)
    )

    on_exit(fn -> Application.put_env(:novel_web, :persistence, old_persistence) end)
    raw_initial = "  初始作者原文 Ω\n第二行  "
    raw_steer = "\t 改为只讨论 é 与雪。\n 保留空白。  "
    {:ok, run} = NovelDomain.AgentRun.new(%{attrs | profile_ref: "judgment_loop_v1"})
    assert {:ok, _} = TurnInteractionService.receive_input(run, store, %{text: raw_initial})
    next = %{run | goal: %{text: "应用归纳目标（不是作者原文）", version: 2}}

    stale = %DialogueContext{
      work_id: attrs.work_id,
      interaction_state: %{author_inputs: [%{turn_ref: run.parent_turn_ref, text: raw_initial}]}
    }

    assert_raise ArgumentError, "author_input_unavailable", fn ->
      NovelApplication.DialoguePlanningService.judgment_protocol_input_for_test(
        %{text: raw_initial},
        next,
        stale,
        []
      )
    end

    assert {:ok, _} = TurnInteractionService.record_steer(next, raw_steer, store, "unicode-steer")
    expected_ref = "#{run.parent_turn_ref}:steer:2"

    assert {:ok, %{turn_id: ^expected_ref, text: ^raw_steer}} =
             TurnInteractionService.current_input(next)

    input =
      NovelApplication.DialoguePlanningService.judgment_protocol_input_for_test(
        %{text: raw_initial},
        next,
        stale,
        []
      )

    assert input.author_text == raw_steer
    assert input.source_input_ref == "#{run.parent_turn_ref}:steer:2"
    request = NovelApplication.JudgmentProtocol.request_for_production(input)

    assert [%{blocks: [%{type: "text", text: ^raw_steer}]}] =
             Enum.filter(request.messages, &(&1.role == "user" and &1.provenance == "author"))

    assert NovelTest.TestProviderPrompt.scope_content(request)["goal"]["text"] == next.goal.text
  end

  test "专业调用从同一输入选择原文和身份，不使用规范化目标", %{attrs: attrs} do
    raw = "  原始作者 Ω\né 与雪。\t "
    {:ok, run} = NovelDomain.AgentRun.new(attrs)

    assert TurnInteractionService.author_input(%{text: raw}, run) ==
             %{turn_id: run.parent_turn_ref, text: raw}

    for input <- [nil, %{}, %{text: " \n\t"}] do
      assert_raise ArgumentError, "author_input_unavailable", fn ->
        TurnInteractionService.author_input(input, run)
      end
    end

    next = %{run | goal: %{text: "应用推导目标", version: 2}}
    ref = "#{run.parent_turn_ref}:steer:2"
    parent = self()

    store = fn :input, scope ->
      send(parent, {:receipt_read, scope.turn_id})
      {:ok, %{turn_id: ref, text: raw}}
    end

    assert TurnInteractionService.author_input(%{text: "旧闭包", interaction_store: store}, next) ==
             %{turn_id: ref, text: raw}

    assert_receive {:receipt_read, ^ref}
    refute_receive {:receipt_read, _}
  end

  test "输入保存失败不启动运行", %{attrs: attrs} do
    parent = self()
    planner = fn _run, _seq, _snapshot -> send(parent, :unexpected_execution) end

    assert {:error, :disk_full} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner,
               interaction_store: fn :receive, _ -> {:error, :disk_full} end,
               interaction_input: %{text: "查看作品档案"}
             )

    assert {:error, :not_found} = AgentRunService.state(attrs.run_id)
    refute_receive :unexpected_execution, 10
  end

  test "重发只起一个运行，结果落库早于发布，候选选择元数据保留", %{attrs: attrs, store: store} do
    parent = self()
    input = %{text: "  查看作品档案  ", candidate_selection: %{candidate_ref: "direction-1"}}

    event_forward = fn event ->
      if event.event_type == :turn_result_ready do
        send(parent, {:published, MemoryLog.transcript(attrs.session_id)})
      end
    end

    planner = planner(parent, :success)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(attrs, event_forward),
               next_step_planner: planner,
               interaction_store: store,
               interaction_input: input
             )

    assert_receive {:executed, ^run_id}, 2000
    assert_receive {:published, [user, assistant]}, 2000
    assert user.content["text"] == input.text
    assert user.content["candidate_selection"] == %{"candidate_ref" => "direction-1"}
    assert assistant.content["text"] == "读取完成，没有写入。"

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(%{attrs | run_id: run_id <> "-retry"},
               next_step_planner: planner,
               interaction_store: store,
               interaction_input: input
             )

    refute_receive {:executed, _}, 25
    assert length(MemoryLog.transcript(attrs.session_id)) == 2
  end

  test "订阅进程断开后运行仍完成，结果已提交不重启或重复执行，重发仍读取同一结果", %{
    attrs: attrs,
    store: store
  } do
    parent = self()
    base_planner = planner(parent, :success)

    blocking_planner = fn run, sequence, snapshot ->
      {:execute, step, decision} = base_planner.(run, sequence, snapshot)

      blocking_step = fn run, sequence, snapshot ->
        send(parent, {:step_started, run.run_id, self()})

        receive do
          :release_step -> step.(run, sequence, snapshot)
        after
          5_000 -> flunk("step was not released")
        end
      end

      {:execute, blocking_step, decision}
    end

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(attrs, fn event ->
                 send(parent, {:delivery_event, event.event_type})
                 send(parent, {:relay_pid, self()})
               end),
               next_step_planner: blocking_planner,
               interaction_store: store,
               interaction_input: %{text: "查看作品档案"}
             )

    on_exit(fn ->
      case Registry.lookup(NovelApplication.AgentRunRegistry, run_id) do
        [{pid, _}] -> DynamicSupervisor.terminate_child(NovelApplication.AgentRunSupervisor, pid)
        _ -> :ok
      end
    end)

    assert_receive {:step_started, ^run_id, step_pid}, 2_000
    assert_receive {:relay_pid, relay}

    # 真实订阅进程断开：测试不注入“回调抛错”，也不让生产为观察者保活。
    Process.unlink(relay)
    monitor = Process.monitor(relay)
    Process.exit(relay, :kill)
    assert_receive {:DOWN, ^monitor, :process, ^relay, _reason}

    # 断开后新订阅仍能观察到同一 run 完成，证明执行本身不依赖观察者。
    NovelApplication.TestAgentEventRelay.subscribe(
      attrs.work_id,
      attrs.session_id,
      run_id,
      fn event -> send(parent, {:delivery_event, event.event_type}) end
    )

    send(step_pid, :release_step)
    assert_receive {:executed, ^run_id}, 2_000
    assert_receive {:delivery_event, :run_completed}, 2_000

    assert {:ok, %{run: %{status: :completed}}} = AgentRunService.state(run_id)
    assert AgentRunLog.get_run(run_id).status == "completed"

    assert length(InteractionLifecycle.receipt_results(attrs.work_id, attrs.session_id, run_id)) ==
             1

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(%{attrs | run_id: run_id <> "-replay"},
               next_step_planner: blocking_planner,
               interaction_store: store,
               interaction_input: %{text: "查看作品档案"}
             )

    refute_receive {:executed, _}, 25
    refute_receive {:step_started, _, _}, 25
  end

  test "普通结果写入后输入状态更新失败，真实事务回滚结果和候选投影", %{attrs: attrs, store: store} do
    {:ok, run} = NovelDomain.AgentRun.new(attrs)
    assert {:ok, _} = TurnInteractionService.receive_input(run, store, %{text: "查看作品档案"})
    {:ok, output} = result(run, 1, :success)

    {:ok, artifact} =
      ArtifactAssembler.assemble_author_content(
        run.parent_turn_ref,
        run.goal.text,
        run.parent_turn_ref
      )

    candidate = TurnResultBuilder.attach_author_artifact(output.turn_result, artifact)

    Repo.query!("""
    CREATE TRIGGER fail_result_input_link BEFORE UPDATE OF content ON interactions
    WHEN OLD.role = 'user' AND json_array_length(NEW.content, '$.message_handling.result_turn_refs') > 0
    BEGIN SELECT RAISE(ABORT, 'injected result link failure'); END
    """)

    try do
      assert {:error, :interaction_store_unavailable} =
               TurnInteractionService.record_result(run, candidate, store)

      assert [user] = MemoryLog.transcript(attrs.session_id)
      assert user.content["message_handling"]["result_turn_refs"] == []

      assert InteractionLifecycle.receipt_results(attrs.work_id, attrs.session_id, attrs.run_id) ==
               []

      assert WorkSessionRepo.adoption_state(attrs.work_id, attrs.session_id).pending_adoptions ==
               []
    after
      Repo.query!("DROP TRIGGER fail_result_input_link")
    end

    assert :ok = TurnInteractionService.record_result(run, candidate, store)

    assert [stored] =
             WorkSessionRepo.adoption_state(attrs.work_id, attrs.session_id).pending_adoptions

    assert hd(stored["payload"]["items"])["body"] == run.goal.text
  end

  test "结果与 trace 同事务提交，trace 保存失败不会留下候选或完成输入", %{attrs: attrs, store: store} do
    {:ok, run} = NovelDomain.AgentRun.new(attrs)
    assert {:ok, _} = TurnInteractionService.receive_input(run, store, %{text: "查看作品档案"})
    {:ok, output} = result(run, 1, :success)

    {:ok, artifact} =
      ArtifactAssembler.assemble_author_content(run.parent_turn_ref, run.goal.text)

    candidate = TurnResultBuilder.attach_author_artifact(output.turn_result, artifact)

    trace = %DecisionTrace{
      trace_id: "trace_atomic",
      turn_id: run.parent_turn_ref,
      frame_ref: nil,
      decision_type: :reply_only,
      event_order: [:turn_result_emitted]
    }

    assert {:error, _} = TurnInteractionService.record_result(run, candidate, store, trace)
    assert [user] = MemoryLog.transcript(attrs.session_id)
    assert user.content["message_handling"]["result_turn_refs"] == []
    assert WorkSessionRepo.adoption_state(attrs.work_id, attrs.session_id).pending_adoptions == []
    assert TraceRepository.get_by_trace_id(trace.trace_id) == nil

    assert :ok =
             TurnInteractionService.record_result(run, candidate, store, %{
               trace
               | frame_ref: attrs.origin_frame_ref
             })

    assert TraceRepository.get_by_trace_id(trace.trace_id)
    assert [_] = WorkSessionRepo.adoption_state(attrs.work_id, attrs.session_id).pending_adoptions
  end

  test "回放保留普通回复来源与未提供认知，不把展示默认升级成模型判断", %{attrs: attrs, store: store} do
    {:ok, run} = NovelDomain.AgentRun.new(attrs)
    assert {:ok, _} = TurnInteractionService.receive_input(run, store, %{text: "查看作品档案"})

    trace = %DecisionTrace{
      trace_id: "trace_provenance",
      turn_id: run.parent_turn_ref,
      frame_ref: attrs.origin_frame_ref,
      decision_type: :reply_only,
      no_tool_reason: "no_tool_requested",
      event_order: [:turn_result_emitted],
      replay_policy: %{use_recorded_frame: true, recall_provider: false}
    }

    reply_record = %{
      source_input_ref: run.parent_turn_ref,
      raw_content: "分析结果。",
      provider_call_ref: "pc-provenance",
      model_interpretation_status: "not_provided",
      supplied_context_refs: ["context:provided"],
      coverage: []
    }

    result = %{
      turn_id: run.parent_turn_ref,
      assistant_message: %{text: "分析结果。"},
      frame_summary: %{
        frame_type: "casual_reply",
        frame_origin: "application_display_default",
        goal_origin: "author_input",
        model_interpretation_status: "not_provided"
      },
      trace_summary: %{
        trace_ref: trace.trace_id,
        reply_record: reply_record,
        context_refs: [%{context_ref: "context:provided", source_type: "current_work"}],
        has_context: true
      }
    }

    assert :ok = TurnInteractionService.record_result(run, result, store, trace)

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(
               attrs.work_id,
               attrs.session_id,
               run.parent_turn_ref
             )

    assert report.trace_summary.frame_origin == "application_display_default"
    assert report.trace_summary.goal_origin == "author_input"
    assert report.trace_summary.model_interpretation_status == "not_provided"
    assert report.trace_summary.reply_record == Jason.decode!(Jason.encode!(reply_record))
    assert [%{"context_ref" => "context:provided"}] = report.trace_summary.context_refs
    refute report.trace_summary.replay_provider_called

    assert InteractionLifecycle.trace_metadata(
             attrs.work_id,
             attrs.session_id,
             run.parent_turn_ref,
             "unrelated-trace"
           ) == %{}
  end

  test "结果保存失败发布诚实失败而非成功产物", %{attrs: attrs, store: store} do
    parent = self()

    failing_store = fn
      :result, _ -> {:error, :disk_full}
      op, data -> store.(op, data)
    end

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(attrs, fn event ->
                 send(parent, {:event, event.event_type, event.payload})
               end),
               next_step_planner: planner(parent, :success),
               interaction_store: failing_store,
               interaction_input: %{text: "查看作品档案"}
             )

    # 失败 TurnResult 无法持久时，安全失败通知不得携带未提交结果。
    assert_receive {:event, :run_failed, payload}, 2000
    refute Map.has_key?(payload, :turn_result)
    refute Map.has_key?(payload, "turn_result")
    refute_receive {:event, :turn_result_ready, _}, 25
    assert {:ok, %{run: %{status: :failed}}} = AgentRunService.state(run_id)
    assert [user] = MemoryLog.transcript(attrs.session_id)
    assert user.content["message_handling"]["status"] == "failed"
  end

  test "失败终局保留输入和可恢复的回应", %{attrs: attrs, store: store} do
    parent = self()

    assert {:ok, _} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(attrs, fn event ->
                 send(parent, {:event, event.event_type})
               end),
               next_step_planner: planner(parent, :failure),
               interaction_store: store,
               interaction_input: %{text: "查看作品档案"}
             )

    assert_receive {:event, :run_failed}, 2000
    assert [user, assistant] = MemoryLog.transcript(attrs.session_id)
    assert user.content["text"] == attrs.goal.text

    # B13b BB-4（ADR-0006 #2）：run 失败兜底 TurnResult = failed_recoverable（phase 仍 failed）。
    assert assistant.content["turn_result"]["status"] == "failed_recoverable"
    assert assistant.content["turn_result"]["phase"] == "failed"
  end

  test "作者动作结果不伪造输入，steer 作为独立来源保留", %{attrs: attrs, store: store} do
    {:ok, run} = NovelDomain.AgentRun.new(%{attrs | trigger: %{kind: "author_action"}})
    assert {:ok, _} = TurnInteractionService.receive_input(run, store, %{text: "查看作品档案"})
    assert MemoryLog.transcript(attrs.session_id) == []
    run = %{run | goal: %{text: "新方向", version: 2}}
    assert {:ok, _} = TurnInteractionService.record_steer(run, "新方向", store)
    assert {:ok, _} = TurnInteractionService.record_steer(run, "新方向", store)
    assert [entry] = MemoryLog.transcript(attrs.session_id)
    assert entry.turn_id == "#{attrs.parent_turn_ref}:steer:2"
    assert entry.content["agent_run_id"] == run.run_id
  end

  test "先前已提交候选后运行失败，保留原记录且不谎称零产出", %{attrs: attrs, store: store} do
    parent = self()

    plan = fn run, sequence, _snapshot ->
      if sequence == 1 do
        prior_candidate_step(run, sequence)
      else
        {:error, :after_committed_result}
      end
    end

    assert {:ok, id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(attrs, fn event ->
                 send(parent, {:prior_event, event})
               end),
               next_step_planner: plan,
               interaction_store: store,
               interaction_input: %{text: "查看作品档案"}
             )

    assert_receive {:prior_event, %{event_type: :run_failed, payload: %{turn_result: failure}}},
                   2000

    assert failure.assistant_message.text =~ "此前已提交的结果仍保留"
    refute failure.assistant_message.text =~ "没有创建待采纳内容"
    refute failure.turn_id == attrs.parent_turn_ref
    assert attrs.parent_turn_ref in failure.trace_summary.prior_committed_result_refs
    assert [_] = WorkSessionRepo.adoption_state(attrs.work_id, attrs.session_id).pending_adoptions
    assert {:ok, %{run: %{status: :failed}}} = AgentRunService.state(id)
  end

  test "同一运行在已提交候选后报告能力缺口，保留旧产物并诚实结束", %{attrs: attrs, store: store} do
    parent = self()

    planner = fn run, sequence, _ ->
      if sequence == 1,
        do: prior_candidate_step(run, sequence),
        else: gap_after_candidate(run, sequence)
    end

    assert {:ok, id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(attrs, fn event ->
                 send(parent, {:gap_event, event})
               end),
               next_step_planner: planner,
               interaction_store: store,
               interaction_input: %{text: "查看作品档案"}
             )

    assert_receive {:gap_event, %{event_type: :run_completed}}, 2000
    assert {:ok, %{run: run, events: events}} = AgentRunService.state(id)
    assert run.status == :completed
    assert length(run.pending_artifact_refs) == 1
    refute Enum.any?(events, &("goal_satisfied" in &1.reason_codes))
    results = InteractionLifecycle.receipt_results(attrs.work_id, attrs.session_id, id)
    assert length(results) == 2
    assert Enum.any?(results, &(&1["turn_id"] == attrs.parent_turn_ref))
    assert Enum.any?(results, &(&1["outcome"] == "goal_unfulfilled"))
    gap = Enum.find(results, &(&1["outcome"] == "goal_unfulfilled"))
    assert TraceRepository.get_by_trace_id(gap["trace_summary"]["trace_ref"])
    assert [_] = WorkSessionRepo.adoption_state(attrs.work_id, attrs.session_id).pending_adoptions
  end

  defp gap_after_candidate(run, sequence) do
    judgment = %{
      action: "capability_gap",
      dialogue_goal: run.goal.text,
      narrative: "此前的原文候选仍保留；当前缺少发布同步能力。",
      reply_record: %{},
      narrative_source: %{provider_call_ref: "pc-gap-after-candidate"},
      tool_call_id: "gap"
    }

    {result, trace} = AuthorQuestion.turn_result(run, judgment)

    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "gap-after-candidate",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :no_progress,
        summary: judgment.narrative,
        reason_codes: ["capability_gap", "goal_unfulfilled"]
      })

    {:complete, decision,
     %{
       turn_result: result,
       decision_trace: trace,
       provider_call_count: 1,
       suppress_plan_event: true
     }}
  end

  defp prior_candidate_step(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "prior_result",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :execute_step,
        summary: "登记原文",
        target_tool_ref: "readonly_batch",
        write_intent: :none,
        risk_hint: :low,
        reason_codes: []
      })

    step = fn run, _ ->
      {:ok, artifact} =
        ArtifactAssembler.assemble_author_content(run.parent_turn_ref, run.goal.text)

      result =
        %{
          turn_id: run.parent_turn_ref,
          assistant_message: %{text: "原文候选"},
          trace_summary: %{},
          available_actions: [],
          ui_cards: []
        }
        |> NovelApplication.TurnResultBuilder.attach_author_artifact(artifact)

      {:ok, %{turn_result: result, artifact_refs: [artifact.artifact_set_id]}}
    end

    {:execute, step, decision, %{provider_call_count: 0, suppress_plan_event: true}}
  end

  test "原文登记提交时重验来源，旧上下文不得重复生成；全放弃后可重新登记", %{attrs: attrs, store: store} do
    {:ok, run} = NovelDomain.AgentRun.new(attrs)
    raw = "  原文资料\n保留完整字节  "

    build = fn turn ->
      {:ok, artifact} = ArtifactAssembler.assemble_author_content(turn, raw, "author-original")

      %{
        turn_id: turn,
        outcome: "author_content_registration",
        assistant_message: %{text: "按原文登记候选。"},
        trace_summary: %{registration_source_ref: "author_input:author-original"},
        available_actions: [],
        ui_cards: []
      }
      |> NovelApplication.TurnResultBuilder.attach_author_artifact(artifact)
    end

    first = build.("registration-1")
    stale = build.("registration-2")
    assert :ok = TurnInteractionService.record_result(run, first, store)
    assert {:ok, reused} = TurnInteractionService.record_result(run, stale, store)
    assert reused.outcome == "already_materialized"
    assert reused.available_actions == []
    state = WorkSessionRepo.adoption_state(attrs.work_id, attrs.session_id)
    assert [only] = state.pending_adoptions
    assert only["source_turn_ref"] == "registration-1"
    assert hd(only["payload"]["items"])["body"] == raw
    assert [%{"artifact_id" => ref}] = reused.trace_summary.registration.artifacts
    assert ref == only["artifact_id"]

    resolved = %{
      turn_id: "registration-discard",
      assistant_message: %{text: "已放弃候选"},
      adoption_state: %{pending: [], resolved: [Map.put(only, "adoption_status", "DISCARDED")]}
    }

    assert :ok = TurnInteractionService.record_result(run, resolved, store)
    assert :ok = TurnInteractionService.record_result(run, build.("registration-3"), store)

    assert [next] =
             WorkSessionRepo.adoption_state(attrs.work_id, attrs.session_id).pending_adoptions

    refute next["artifact_id"] == ref
    assert hd(next["payload"]["items"])["body"] == raw
  end

  test "durable 消息重传不重复创建长任务", %{attrs: attrs, store: store} do
    parent = self()

    opts = [
      next_step_planner: planner(parent, :success),
      interaction_store: store,
      interaction_input: %{text: "查看作品档案"}
    ]

    assert {:ok, run_id} = AgentRunService.start_durable(attrs, opts)
    assert_receive {:executed, ^run_id}, 2000

    assert {:ok, ^run_id} =
             AgentRunService.start_durable(%{attrs | run_id: run_id <> "-retry"}, opts)

    assert [_] = NovelPersistence.LongRunTaskLog.recent(attrs.workspace_id)
    refute_receive {:executed, _}, 25
    assert {:ok, _} = AgentRunService.state(run_id)
  end

  test "运行取消后收到的输入仍可恢复", %{attrs: attrs, store: store} do
    parent = self()

    waiting = fn _run, _sequence, _snapshot ->
      send(parent, {:waiting_step, self()})

      receive do
        :release -> {:error, :cancelled_work}
      end
    end

    assert {:ok, run_id} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: waiting,
               interaction_store: store,
               interaction_input: %{text: "查看作品档案"}
             )

    assert_receive {:waiting_step, pid}, 2000
    assert :ok = AgentRunService.cancel(run_id)
    assert {:ok, %{run: %{status: :cancelling}}} = AgentRunService.state(run_id)
    send(pid, :release)
    wait_stopped(run_id)
    assert [user | _] = MemoryLog.transcript(attrs.session_id)
    assert user.content["text"] == attrs.goal.text
    assert user.content["message_handling"]["status"] == "cancelled"
  end

  defp wait_stopped(run_id, attempts \\ 100)
  defp wait_stopped(_run_id, 0), do: flunk("运行未停止")

  defp wait_stopped(run_id, attempts) do
    case AgentRunService.state(run_id) do
      {:ok, %{run: %{status: :cancelled}}} ->
        :ok

      _ ->
        Process.sleep(10)
        wait_stopped(run_id, attempts - 1)
    end
  end

  test "待采纳和已采纳来源阻止重复物化，放弃后允许重新提出" do
    item = %{provider_call_ref: "author_input:source-1", body: "原文"}

    pending = %{
      artifact_id: "a1",
      source_tool_result_ref: "author_input:source-1",
      payload: %{items: [item]}
    }

    context = %DialogueContext{
      work_id: "w",
      interaction_state: %{pending_adoptions: [pending]}
    }

    assert AuthorContentRegistration.materialized_source?(context, "source-1")
    resolved = %{artifact_id: "a1", adoption_status: "ACCEPTED", payload: %{items: [item]}}
    context = %{context | interaction_state: %{resolved_adoptions: [resolved]}}
    assert AuthorContentRegistration.materialized_source?(context, "source-1")

    context = %{
      context
      | interaction_state: %{resolved_adoptions: [%{resolved | adoption_status: "DISCARDED"}]}
    }

    refute AuthorContentRegistration.materialized_source?(context, "source-1")
  end

  test "登记计数沿版本来源汇总，已编辑正文与原文来源分别保留" do
    original = %{
      artifact_id: "a",
      adoption_status: "DISCARDED",
      payload: %{items: [%{body: "原文", provider_call_ref: "author_input:source"}]}
    }

    revision = %{
      artifact_id: "b",
      adoption_status: "TENTATIVE",
      payload: %{
        revision_of: "a",
        registration_source_ref: "author_input:source",
        items: [%{body: "模型修订", provider_call_ref: "pcall-revision"}]
      }
    }

    edited = %{
      artifact_id: "c",
      adoption_status: "EDITED_ACCEPTED",
      payload: %{
        content: "作者最终编辑",
        registration_source_ref: "author_input:source",
        items: [%{body: "编辑前正文", provider_call_ref: "pcall-old"}]
      }
    }

    state = %{
      author_inputs: [%{turn_ref: "source", text: "原文"}],
      pending_adoptions: [revision],
      resolved_adoptions: [original, edited]
    }

    facts = TurnInteractionService.context_payload(state)

    assert hd(facts.author_inputs).registration == %{
             pending_count: 1,
             accepted_count: 1,
             discarded_count: 1
           }

    assert TurnInteractionService.artifact_body(edited) == "作者最终编辑"
    assert AuthorContentRegistration.author_source_ref(revision) == "author_input:source"
    assert AuthorContentRegistration.registered_sources(%{interaction_state: state}) == ["source"]
  end

  defp planner(parent, outcome) do
    fn run, seq, _snapshot ->
      {:ok, decision} =
        AgentNextStepDecision.new(%{
          decision_id: "decision-#{seq}",
          run_ref: run.run_id,
          sequence: seq,
          decision_type: :execute_step,
          summary: "读取档案",
          target_tool_ref: "readonly_batch",
          write_intent: :none,
          risk_hint: :low
        })

      step = fn run, seq, _snapshot ->
        send(parent, {:executed, run.run_id})
        result(run, seq, outcome)
      end

      {:execute, step, decision}
    end
  end

  defp result(_run, _seq, :failure), do: {:error, :test_failure}

  defp result(run, seq, :success) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: "step-#{seq}",
        run_ref: run.run_id,
        sequence: seq,
        goal: "读取档案",
        status: :completed,
        idempotency_key: "#{run.run_id}:#{seq}"
      })

    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "complete-#{seq}",
        run_ref: run.run_id,
        sequence: seq,
        decision_type: :goal_satisfied,
        summary: "读取结束"
      })

    {:ok,
     %{
       step: step,
       turn_result: %{
         turn_id: run.parent_turn_ref,
         assistant_message: %{text: "读取完成，没有写入。"},
         truthfulness: %{production_write_performed: false}
       },
       loop_status: :completed,
       loop_decision: decision
     }}
  end
end
