defmodule NovelApplication.TraceReplayServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{AuthoringCheckpoint, AuthoringTranscript, TraceReplayService}
  alias NovelApplication.WorkService
  alias NovelPersistence.{AgentRunLog, AuthoringSessionLog, LongRunTaskLog, Repo}
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

    # B81 CP4：会话级 canonical 回查作为报告的补充证据（空会话是合法空历史）。
    assert report.trace_summary.session_authoring_history.status == :ok
    assert report.trace_summary.session_authoring_history.checkpoints == []
  end

  test "reads Form R non-reply decision types without provider call (clarification/gap)",
       %{work: work, session: session} do
    for decision_type <- ["clarification_required", "capability_gap", "exploration"] do
      turn_id = "turn-form-r-#{decision_type}-#{System.unique_integer([:positive, :monotonic])}"

      {:ok, _} =
        TraceRepository.insert(%{
          workspace_id: work.id,
          session_id: session.id,
          trace_id: "trace-form-r-#{System.unique_integer([:positive, :monotonic])}",
          turn_id: turn_id,
          frame_ref: "frame-form-r",
          decision_type: decision_type,
          no_tool_reason: "reply_only_no_execution",
          no_behavior_reason: "reply-only turn does not open durable behavior",
          no_write_reason: "this turn does not perform production write",
          turn_result_ref: turn_id,
          replay_policy: %{use_recorded_frame: true, recall_provider: false},
          event_order: [
            "author_input_received",
            "orchestrator_decision_recorded",
            "turn_result_emitted"
          ]
        })

      assert {:ok, report} = TraceReplayService.fetch_turn_report(work.id, session.id, turn_id)
      assert report.trace_summary.decision_type == decision_type
      assert report.replay_report.provider_called == false

      # Form R 非 reply 类型可能因缺少 StateTrace 而 partial；读取本身必须诚实可读。
      assert report.replay_report.result_status in ["complete", "partial"]
    end
  end

  test "rebuilds mission fields from persisted state_trace_refs (WR01c why-panel replay)", %{
    work: work,
    session: session
  } do
    turn_id = "turn-mission-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: session.id,
        trace_id: "trace-mission-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-mission",
        decision_type: "tool_dispatched",
        no_tool_reason: "tool_was_dispatched",
        no_behavior_reason: "tool_execution_completed",
        no_write_reason: "tool_result_not_adoption_awaiting_adoption_boundary",
        turn_result_ref: turn_id,
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        event_order: ["author_input_received", "turn_result_emitted"],
        state_trace_refs: [
          %{
            "kind" => "chapter_mission",
            "ref" => "mission:cm_1",
            "statement" => "本章必须让账牌兑现。",
            "status" => "TENTATIVE",
            "source" => "model",
            "must_advance" => [%{"text" => "账牌兑现", "basis_label" => "第02章计划"}],
            "must_avoid" => []
          },
          %{
            "kind" => "planning_mission",
            "ref" => "mission:cm_2",
            "statement" => "接下来的章节安排伏笔回收。",
            "status" => "AUTHOR_EDITED",
            "source" => "author",
            "must_advance" => [],
            "must_avoid" => [%{"text" => "不开新卷"}]
          }
        ]
      })

    assert {:ok, report} = TraceReplayService.fetch_turn_report(work.id, session.id, turn_id)
    summary = report.trace_summary

    assert summary.chapter_mission_ref == "mission:cm_1"
    assert summary.chapter_mission_statement == "本章必须让账牌兑现。"
    assert summary.chapter_mission["status"] == "TENTATIVE"

    assert [%{"text" => "账牌兑现", "basis_label" => "第02章计划"}] =
             summary.chapter_mission["must_advance"]

    refute Map.has_key?(summary.chapter_mission, "kind")

    assert summary.planning_mission_ref == "mission:cm_2"
    assert summary.planning_mission_statement == "接下来的章节安排伏笔回收。"
    assert summary.planning_mission["status"] == "AUTHOR_EDITED"
  end

  test "rebuilds memory_window from persisted state_trace_refs (B64 why-panel replay)", %{
    work: work,
    session: session
  } do
    turn_id = "turn-memory-window-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: session.id,
        trace_id: "trace-memory-window-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-memory-window",
        decision_type: "tool_dispatched",
        no_tool_reason: "tool_was_dispatched",
        no_behavior_reason: "tool_execution_completed",
        no_write_reason: "tool_result_not_adoption_awaiting_adoption_boundary",
        turn_result_ref: turn_id,
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        event_order: ["author_input_received", "turn_result_emitted"],
        state_trace_refs: [
          %{
            "kind" => "memory_window",
            "ref" => "memory_window:chapter:ch3",
            "target_chapter_ref" => "chapter:ch3",
            "target_chapter" => "第03章：旧誓",
            "applied" => true,
            "position" => "explicit_target"
          }
        ]
      })

    assert {:ok, report} = TraceReplayService.fetch_turn_report(work.id, session.id, turn_id)
    summary = report.trace_summary

    assert summary.memory_window["target_chapter_ref"] == "chapter:ch3"
    assert summary.memory_window["target_chapter"] == "第03章：旧誓"
    assert summary.memory_window["applied"] == true
    refute Map.has_key?(summary.memory_window, "kind")
    refute Map.has_key?(summary.memory_window, "ref")
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

  test "从同一运行的 canonical checkpoint 生成作者安全的历史说明", %{
    work: work,
    session: session
  } do
    turn_id = "turn-checkpoint-#{System.unique_integer([:positive, :monotonic])}"
    run_id = "run-checkpoint-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, transcript} =
      NovelApplication.AuthoringTranscript.new(
        %{
          run_id: run_id,
          work_id: work.id,
          workspace_id: work.id,
          session_id: session.id,
          parent_turn_ref: turn_id
        },
        base_text: "作者决定作品事实",
        author_text: "设计灵源矿区"
      )
      |> NovelApplication.AuthoringTranscript.append_assistant("", [
        NovelCommon.RequestIR.tool_call_block(
          "chapter_read",
          %{"chapter" => "第3章"},
          "call-checkpoint"
        )
      ])
      |> NovelApplication.AuthoringTranscript.append_observation("call-checkpoint", %{
        status: "ok",
        source_refs: [%{ref: "chapter:internal-03", display_name: "第03章：旧誓", version: 2}],
        versions: %{"chapter:internal-03" => 2}
      })
      |> NovelApplication.AuthoringTranscript.compact(
        %{call_ids: ["call-checkpoint"]},
        [%{ref: "chapter:internal-03", display_name: "第03章：旧誓", version: 2}],
        %{"chapter:internal-03" => 2},
        ["较早的工具调用细节已省略，原始记录仍可回查。"],
        "已保留确认过的作品背景，候选仍待作者审阅。"
      )

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: work.id,
        task_type: "agent_run",
        parent_turn_ref: turn_id,
        status: "READY",
        phase: "PLANNED",
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "checkpoint_version" => 3,
            "authoring_segment_ref" => %{
              "run_id" => run_id,
              "version" => AuthoringSessionLog.segment_format_version()
            }
          }
        }
      })

    {:ok, run} =
      AgentRunLog.upsert_run(%{
        id: run_id,
        workspace_id: work.id,
        work_id: work.id,
        session_id: session.id,
        parent_turn_ref: turn_id,
        origin_frame_ref: "frame-checkpoint",
        run_mode: "durable",
        profile_ref: "character_design_with_context_v1",
        status: "awaiting_author",
        phase: "stopped",
        long_run_task_ref: task.id
      })

    {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(run, transcript)
    {:ok, _state} = AuthoringSessionLog.append_run(run, segment)

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: session.id,
        trace_id: "trace-checkpoint-#{System.unique_integer([:positive, :monotonic])}",
        turn_id: turn_id,
        frame_ref: "frame-checkpoint",
        decision_type: "reply_only",
        turn_result_ref: turn_id,
        event_order: ["turn_result_emitted"]
      })

    assert [%{long_run_task_ref: task_ref}] =
             AgentRunLog.list_by_parent_turn(work.id, session.id, turn_id)

    task_data = LongRunTaskLog.get(task_ref).checkpoint_data

    assert %{"agent_run" => %{"authoring_segment_ref" => ref}} = task_data
    assert ref["run_id"] == run_id
    assert ref["version"] == AuthoringSessionLog.segment_format_version()

    record = AgentRunLog.get_run(run_id)

    assert {:ok, _transcript, :session_segment} = AuthoringCheckpoint.restore(record, task_data)

    assert {:ok, report} = TraceReplayService.fetch_turn_report(work.id, session.id, turn_id)

    assert [
             %{
               summary: "已保留确认过的作品背景，候选仍待作者审阅。",
               omissions: ["较早的工具调用细节已省略，原始记录仍可回查。"],
               source_names: ["第03章：旧誓"]
             }
           ] = report.trace_summary.authoring_history

    refute inspect(report.trace_summary.authoring_history) =~ "chapter:internal-03"
    assert report.replay_report.provider_called == false
  end

  test "rejects a session that does not belong to the work", %{work: work} do
    {:ok, other_work} = WorkService.create(%{title: "另一作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id, title: "其他会话"})

    assert {:error, :session_not_found} =
             TraceReplayService.fetch_turn_report(work.id, other_session.id, "turn-x")
  end

  test "durable 历史缺失必须报告 partial，不能假装完整回放", context do
    %{turn_id: turn_id} = persist_authoring_history(context, nil)

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(context.work.id, context.session.id, turn_id)

    assert report.replay_report.result_status == "partial"
    assert report.trace_summary.replay_result_status == "partial"
    assert "authoring_transcript" in report.replay_report.missing_trace_refs
    assert report.trace_summary.replay_missing_trace_refs_count == 1
    assert report.replay_report.provider_called == false
  end

  test "bounded 无私有历史只在已记录零 Provider 消耗时返回 not_applicable", context do
    for {consumed_budget, expected_status} <- [
          {%{"provider_calls" => 0}, "complete"},
          {%{"provider_calls" => 1}, "partial"},
          {nil, "partial"}
        ] do
      id = System.unique_integer([:positive, :monotonic])
      run_id = "run-bounded-history-#{id}"
      turn_id = "turn-bounded-history-#{id}"

      {:ok, _run} =
        NovelPersistence.AgentRunLog.upsert_run(%{
          id: run_id,
          workspace_id: context.work.id,
          work_id: context.work.id,
          session_id: context.session.id,
          parent_turn_ref: turn_id,
          origin_frame_ref: "frame-bounded-history",
          run_mode: "bounded",
          profile_ref: "conversation_turn_v1",
          status: "completed",
          phase: "stopped",
          consumed_budget: consumed_budget
        })

      {:ok, _trace} =
        TraceRepository.insert(%{
          workspace_id: context.work.id,
          session_id: context.session.id,
          trace_id: "trace-bounded-history-#{id}",
          turn_id: turn_id,
          frame_ref: "frame-bounded-history",
          decision_type: "reply_only",
          turn_result_ref: turn_id,
          event_order: ["turn_result_emitted"]
        })

      assert {:ok, report} =
               TraceReplayService.fetch_turn_report(context.work.id, context.session.id, turn_id)

      assert report.replay_report.result_status == expected_status
      assert report.replay_report.provider_called == false

      if expected_status == "complete" do
        refute Map.has_key?(report.trace_summary, :authoring_history)
        refute "authoring_transcript" in report.replay_report.missing_trace_refs
      else
        assert "authoring_transcript" in report.replay_report.missing_trace_refs
      end
    end
  end

  test "durable checkpoint 必须属于当前运行，不能展示另一运行的历史", context do
    turn_id = "turn-history-other-#{System.unique_integer([:positive, :monotonic])}"
    run_id = "run-history-other-#{System.unique_integer([:positive, :monotonic])}"

    checkpoint = history_checkpoint(run_id, context.work.id, context.session.id, turn_id)

    %{turn_id: ^turn_id} =
      persist_authoring_history(context, checkpoint,
        run_id: run_id,
        turn_id: turn_id,
        ref_run_id: "other-run"
      )

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(context.work.id, context.session.id, turn_id)

    assert report.replay_report.result_status == "partial"
    refute Map.has_key?(report.trace_summary, :authoring_history)
  end

  test "历史说明与来源名称不把内部调用和私有推理字段展示给作者" do
    transcript =
      NovelApplication.AuthoringTranscript.new(%{}, base_text: "作者主权", author_text: "检查旧誓")
      |> append_legacy_checkpoint(
        %{turn_range: "早期轮次"},
        [
          "chapter:reference-only",
          %{ref: "chapter:internal-03", display_name: "chapter:internal-03"}
        ],
        %{},
        ["reasoning_content 含内部推理"],
        "RequestIR 的 call_123 已执行"
      )

    [history] = NovelApplication.AuthoringReplay.checkpoint_summaries(transcript)
    refute inspect(history) =~ "RequestIR"
    refute inspect(history) =~ "reasoning_content"
    refute inspect(history) =~ "chapter:internal-03"
  end

  test "实际步骤的 Why 可以找到同作品同会话的 durable 历史", context do
    run_id = "run-history-#{System.unique_integer([:positive, :monotonic])}"
    parent = "turn-history-#{System.unique_integer([:positive, :monotonic])}"
    checkpoint = history_checkpoint(run_id, context.work.id, context.session.id, parent)

    %{turn_id: ^parent, trace_id: trace_id} =
      persist_authoring_history(context, checkpoint, run_id: run_id, turn_id: parent)

    turn_id = parent <> ":agent:1"

    {:ok, _} =
      NovelPersistence.AgentRunLog.insert_step(%{
        id: run_id <> ":step:1",
        run_id: run_id,
        sequence: 1,
        status: "completed",
        goal: "设计角色",
        idempotency_key: run_id <> ":1"
      })

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: context.work.id,
        session_id: context.session.id,
        trace_id: trace_id <> ":step",
        turn_id: turn_id,
        frame_ref: "frame-history-step",
        decision_type: "reply_only",
        turn_result_ref: turn_id,
        event_order: ["turn_result_emitted"]
      })

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(context.work.id, context.session.id, turn_id)

    assert [%{summary: "已核对旧誓，候选尚未采纳。"}] = report.trace_summary.authoring_history
    assert report.replay_report.provider_called == false
  end

  defp history_checkpoint(run_id, work_id, session_id, parent_turn_ref) do
    {:ok, compacted} =
      NovelApplication.AuthoringTranscript.new(
        %{
          run_id: run_id,
          work_id: work_id,
          workspace_id: work_id,
          session_id: session_id,
          parent_turn_ref: parent_turn_ref
        },
        base_text: "作者决定作品事实",
        author_text: "设计角色"
      )
      |> NovelApplication.AuthoringTranscript.append_assistant("", [
        NovelCommon.RequestIR.tool_call_block(
          "chapter_read",
          %{"chapter" => "第1章"},
          "call-history"
        )
      ])
      |> NovelApplication.AuthoringTranscript.append_observation("call-history", %{
        status: "ok",
        source_refs: []
      })
      |> NovelApplication.AuthoringTranscript.compact(
        %{call_ids: ["call-history"]},
        [],
        %{},
        ["省略细节"],
        "已核对旧誓，候选尚未采纳。"
      )

    NovelApplication.AuthoringCheckpoint.checkpoint(compacted)
  end

  defp persist_authoring_history(context, checkpoint, opts \\ []) do
    id = System.unique_integer([:positive, :monotonic])
    run_id = Keyword.get(opts, :run_id, "run-history-#{id}")
    turn_id = Keyword.get(opts, :turn_id, "turn-history-#{id}")
    trace_id = "trace-history-#{id}"
    ref_run_id = Keyword.get(opts, :ref_run_id, run_id)

    data = %{
      "agent_run" => %{
        "run_id" => run_id,
        "checkpoint_version" => 3,
        "authoring_segment_ref" => %{
          "run_id" => ref_run_id,
          "version" => AuthoringSessionLog.segment_format_version()
        }
      }
    }

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: context.work.id,
        task_type: "agent_run",
        parent_turn_ref: turn_id,
        status: "READY",
        phase: "PLANNED",
        checkpoint_data: data
      })

    {:ok, run} =
      AgentRunLog.upsert_run(%{
        id: run_id,
        workspace_id: context.work.id,
        work_id: context.work.id,
        session_id: context.session.id,
        parent_turn_ref: turn_id,
        origin_frame_ref: "frame-history",
        run_mode: "durable",
        profile_ref: "character_design_with_context_v1",
        status: "awaiting_author",
        phase: "stopped",
        long_run_task_ref: task.id
      })

    if checkpoint do
      {:ok, transcript} = AuthoringTranscript.restore(checkpoint)
      {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(run, transcript)
      {:ok, _state} = AuthoringSessionLog.append_run(run, segment)
    end

    {:ok, _} =
      TraceRepository.insert(%{
        workspace_id: context.work.id,
        session_id: context.session.id,
        trace_id: trace_id,
        turn_id: turn_id,
        frame_ref: "frame-history",
        decision_type: "reply_only",
        turn_result_ref: turn_id,
        event_order: ["turn_result_emitted"]
      })

    %{turn_id: turn_id, trace_id: trace_id}
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

  # append_checkpoint/6 已按「无历史兼容」退役：生产唯一压缩入口是 compact/6。
  # 历史 turn_range checkpoint 事实由测试直接构造 canonical 消息，不再经产品 API。
  defp append_legacy_checkpoint(transcript, covers, source_refs, versions, omissions, summary) do
    block =
      NovelCommon.RequestIR.checkpoint_block(covers, source_refs, versions, omissions, summary)

    message = NovelCommon.RequestIR.message(:checkpoint, :application, [block])
    %{transcript | messages: transcript.messages ++ [message]}
  end
end
