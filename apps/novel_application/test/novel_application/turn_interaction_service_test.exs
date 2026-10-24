defmodule NovelApplication.TurnInteractionServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.{
    AgentRunServer,
    AgentRunService,
    ArtifactAssembler,
    AuthorQuestion,
    TraceReplayService,
    TurnInteractionService,
    TurnResultBuilder
  }

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

  test "输入保存失败不启动运行", %{attrs: attrs} do
    parent = self()
    planner = fn _run, _seq, _snapshot -> send(parent, :unexpected_execution) end

    assert {:error, :disk_full} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner,
               interaction_store: fn :receive, _ -> {:error, :disk_full} end
             )

    assert {:error, :not_found} = AgentRunService.state(attrs.run_id)
    refute_receive :unexpected_execution
  end

  test "重发只起一个运行，结果落库早于发布，候选选择元数据保留", %{attrs: attrs, store: store} do
    parent = self()
    input = %{text: "  查看作品档案  ", candidate_selection: %{candidate_ref: "direction-1"}}

    event_sink = fn event ->
      if event.event_type == :turn_result_ready do
        send(parent, {:published, MemoryLog.transcript(attrs.session_id)})
      end
    end

    planner = planner(parent, :success)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner,
               event_sink: event_sink,
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

    refute_receive {:executed, _}
    assert length(MemoryLog.transcript(attrs.session_id)) == 2
  end

  test "结果已提交后通知抛错，不重启运行或重复执行，重发仍读取同一结果", %{attrs: attrs, store: store} do
    parent = self()
    {:ok, fail_once} = Agent.start_link(fn -> true end)

    sink = fn event ->
      if event.event_type == :turn_result_ready and Agent.get_and_update(fail_once, &{&1, false}) do
        raise "injected committed result publication failure"
      end

      send(parent, {:delivery_event, event.event_type})
    end

    planner = planner(parent, :success)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner,
               event_sink: sink,
               interaction_store: store
             )

    on_exit(fn ->
      case Registry.lookup(NovelApplication.AgentRunRegistry, run_id) do
        [{pid, _}] -> DynamicSupervisor.terminate_child(NovelApplication.AgentRunSupervisor, pid)
        _ -> :ok
      end
    end)

    assert_receive {:executed, ^run_id}, 2000
    assert_receive {:delivery_event, :run_completed}, 2000
    refute_receive {:executed, _}
    assert {:ok, %{run: %{status: :completed}}} = AgentRunService.state(run_id)
    assert AgentRunLog.get_run(run_id).status == "completed"

    assert length(InteractionLifecycle.receipt_results(attrs.work_id, attrs.session_id, run_id)) ==
             1

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(%{attrs | run_id: run_id <> "-replay"},
               next_step_planner: planner,
               interaction_store: store
             )

    refute_receive {:executed, _}
  end

  test "普通结果写入后输入状态更新失败，真实事务回滚结果和候选投影", %{attrs: attrs, store: store} do
    {:ok, run} = NovelDomain.AgentRun.new(attrs)
    assert {:ok, _} = TurnInteractionService.receive_input(run, store)
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
    assert {:ok, _} = TurnInteractionService.receive_input(run, store)
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
    assert {:ok, _} = TurnInteractionService.receive_input(run, store)

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
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner(parent, :success),
               interaction_store: failing_store,
               event_sink: fn event -> send(parent, {:event, event.event_type, event.payload}) end
             )

    assert_receive {:event, :run_failed, %{turn_result: result}}, 2000
    assert result.assistant_message.text =~ "结果未能保存"
    assert result.truthfulness.production_write_performed == false
    refute_receive {:event, :turn_result_ready, _}
    assert {:ok, %{run: %{status: :failed}}} = AgentRunService.state(run_id)
    assert [user] = MemoryLog.transcript(attrs.session_id)
    assert user.content["message_handling"]["status"] == "failed"
  end

  test "失败终局保留输入和可恢复的回应", %{attrs: attrs, store: store} do
    parent = self()

    assert {:ok, _} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner(parent, :failure),
               interaction_store: store,
               event_sink: fn event -> send(parent, {:event, event.event_type}) end
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
    assert {:ok, _} = TurnInteractionService.receive_input(run, store)
    assert MemoryLog.transcript(attrs.session_id) == []
    run = %{run | goal: %{text: "新方向", version: 2}}
    assert {:ok, _} = TurnInteractionService.record_steer(run, "新方向", store)
    assert {:ok, _} = TurnInteractionService.record_steer(run, "新方向", store)
    assert [entry] = MemoryLog.transcript(attrs.session_id)
    assert entry.turn_id == "#{attrs.parent_turn_ref}:steer:2"
    assert entry.content["agent_run_id"] == run.run_id
  end

  test "只有明确原文登记操作消费来源，不再使用旧布尔联合条件" do
    assert :ok =
             TurnInteractionService.validate_author_registration(
               %{action: "reply", author_content_registration: "true"},
               []
             )

    assert {:error, {:author_content_registration_invalid, :source_required}} =
             TurnInteractionService.validate_author_registration(
               %{action: "author_content_registration"},
               []
             )

    assert {:error, {:author_content_registration_invalid, :source_not_available}} =
             TurnInteractionService.validate_author_registration(
               %{action: "author_content_registration", author_content_source_ref: "foreign"},
               []
             )

    assert :ok =
             TurnInteractionService.validate_author_registration(
               %{action: "author_content_registration", author_content_source_ref: "current"},
               []
             )
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
             AgentRunService.start_bounded(attrs,
               next_step_planner: plan,
               interaction_store: store,
               event_sink: fn event -> send(parent, {:prior_event, event}) end
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
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner,
               interaction_store: store,
               event_sink: fn event -> send(parent, {:gap_event, event}) end
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

  test "历史来源只从上下文白名单读取，物化不改原文字节" do
    raw = "  原文\n第二行  "

    context = %DialogueContext{
      workspace_id: "w",
      interaction_state: %{
        author_inputs: [%{turn_ref: "source-1", text: raw}]
      }
    }

    assert TurnInteractionService.current_text(context, "source-1", "已裁剪") == raw

    assert TurnInteractionService.current_text(
             %DialogueContext{workspace_id: "w"},
             "current-2",
             raw
           ) == raw

    assert {:ok, "source-1", ^raw} =
             TurnInteractionService.source_text("source-1", "请存档", context, "current-2")

    assert {:error, {:author_content_registration_invalid, :source_not_available}} =
             TurnInteractionService.source_text("foreign-source", "请存档", context, "current-2")

    assert {:error, {:author_content_registration_invalid, :source_required}} =
             TurnInteractionService.source_text(nil, "把上一条原文存档", context, "current-2")

    assert {:ok, "current-2", ^raw} =
             TurnInteractionService.source_text("current", raw, context, "current-2")

    assert {:ok, artifact} = ArtifactAssembler.assemble_author_content("source-1", raw)
    assert hd(artifact.items).body == raw
    assert artifact.source_tool_result_ref == "author_input:source-1"

    assert {:ok, linked} =
             ArtifactAssembler.assemble_author_content("save-request-2", raw, "source-1")

    assert linked.source_turn_ref == "save-request-2"
    assert linked.source_tool_result_ref == "author_input:source-1"
    assert hd(linked.items).provider_call_ref == "author_input:source-1"
    assert hd(linked.items).body == raw
  end

  test "durable 消息重传不重复创建长任务", %{attrs: attrs, store: store} do
    parent = self()
    opts = [next_step_planner: planner(parent, :success), interaction_store: store]
    assert {:ok, run_id} = AgentRunService.start_durable(attrs, opts)
    assert_receive {:executed, ^run_id}, 2000

    assert {:ok, ^run_id} =
             AgentRunService.start_durable(%{attrs | run_id: run_id <> "-retry"}, opts)

    assert [_] = NovelPersistence.LongRunTaskLog.recent(attrs.workspace_id)
    refute_receive {:executed, _}
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
               interaction_store: store
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
      workspace_id: "w",
      interaction_state: %{pending_adoptions: [pending]}
    }

    assert TurnInteractionService.materialized_source?(context, "source-1")
    resolved = %{artifact_id: "a1", adoption_status: "ACCEPTED", payload: %{items: [item]}}
    context = %{context | interaction_state: %{resolved_adoptions: [resolved]}}
    assert TurnInteractionService.materialized_source?(context, "source-1")

    context = %{
      context
      | interaction_state: %{resolved_adoptions: [%{resolved | adoption_status: "DISCARDED"}]}
    }

    refute TurnInteractionService.materialized_source?(context, "source-1")
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

    section = TurnInteractionService.context_section(state)
    facts = section |> String.split("\n", trim: true) |> List.last() |> Jason.decode!()

    assert hd(facts["author_inputs"])["registration"] == %{
             "pending_count" => 1,
             "accepted_count" => 1,
             "discarded_count" => 1
           }

    assert TurnInteractionService.artifact_body(edited) == "作者最终编辑"
    assert TurnInteractionService.author_source_ref(revision) == "author_input:source"
    assert TurnInteractionService.registered_sources(%{interaction_state: state}) == ["source"]
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
