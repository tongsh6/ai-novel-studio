defmodule NovelApplication.AgentRunFlows.AuthoringSessionToolHistoryTest do
  @moduledoc """
  首次工具请求承接已提交会话历史的回归。

  同时核对请求视图、真实父子运行的纠错与提交，以及真正重复调用编号的拒绝边界。
  真实 Gateway 用例复用现有 SliceVerify、事件转发与运行清理，不另建测试运行框架。
  """

  use NovelPersistence.DataCase, async: false

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelApplication.AgentRunFlows.ProseRevisionFromFindings
  alias NovelApplication.AgentRunPersistence
  alias NovelApplication.AgentRunService
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelApplication.TraceReplayService
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.AgentRun
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.DialogueContext

  alias NovelPersistence.{
    AgentRunLog,
    AuthoringSessionLog,
    InteractionLifecycle,
    MemoryLog,
    Repo,
    TraceRepository,
    WorkRepo,
    WorkSessionRepo
  }

  alias NovelPersistence.Schemas.{Chapter, Volume}

  @work "work-agent-prose-revision-flow"
  @quality_revision_retry_env "SLICE_VERIFY_QUALITY_REVISION_RETRY"

  # 作者中文、全角空格、制表符、行尾空格都必须逐字保留。
  @author_text "　第一章\t \n  连续  空格与结尾空格  \n"

  test "首次工具绑定承接父会话原文，父历史只进入请求视图" do
    run = agent_run()
    parent_run_id = "run-bind-parent"

    author =
      RequestIR.message(:user, :author, [RequestIR.text_block(@author_text)], %{
        source_refs: [%{ref: "turn-bind-parent"}]
      })

    history = %{
      rows: [
        %{
          run_id: parent_run_id,
          run_sequence: 1,
          sequence: 1,
          workspace_id: run.workspace_id,
          work_id: run.work_id,
          session_id: run.session_id,
          parent_turn_ref: "turn-bind-parent",
          run_status: "completed",
          role: "user",
          message: author
        }
      ],
      refs: %{base_refs: [], observation_refs: [], used_refs: []}
    }

    snapshot = %{run: run, stage_state: %{}, initial_session_history: history}
    bound = AuthoringSession.bind_tool_request(tool_request(), run, snapshot)

    ir = bound.input["request_ir"]
    assert %RequestIR{} = ir
    assert ir.run.run_id == run.run_id
    assert author_text(ir) == @author_text
    assert Enum.count(ir.messages, &(&1.role == "application_base")) == 1

    assert [%{canonical_ref: %{run_id: ^parent_run_id}}] =
             Enum.filter(ir.messages, &(&1.role == "user"))

    assert {:ok, transcript} = AuthoringTranscript.from_request_ir(ir)
    segment = AuthoringCheckpoint.checkpoint(transcript).transcript
    refute Enum.any?(segment.messages, &(&1.role == "user"))
    refute Enum.any?(segment.messages, &Map.has_key?(&1, :session_history_run_id))

    assert AuthoringSession.bind_tool_request(tool_request(), run, %{stage_state: %{}}).input[
             "request_ir"
           ] == nil
  end

  describe "real Gateway + SliceVerify quality finding revision" do
    setup do
      old_extra = Application.get_env(:novel_agent, :extra_providers)
      old_log_dir = Application.get_env(:novel_telemetry, :llm_log_dir)
      old_retry = System.get_env(@quality_revision_retry_env)
      dir = Path.join(System.tmp_dir!(), "slice-verify-quality-revision-#{unique_integer()}")

      Application.put_env(
        :novel_agent,
        :extra_providers,
        Map.put(old_extra || %{}, :slice_verify, SliceVerify)
      )

      Application.put_env(:novel_telemetry, :llm_log_dir, dir)
      System.delete_env(@quality_revision_retry_env)

      on_exit(fn ->
        restore_app_env(:novel_agent, :extra_providers, old_extra)
        restore_app_env(:novel_telemetry, :llm_log_dir, old_log_dir)
        restore_system_env(@quality_revision_retry_env, old_retry)
        File.rm_rf!(dir)
      end)

      {:ok, work} = WorkRepo.create(%{title: "B71 修订 trace 交付"})
      {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "修订 trace 会话"})

      %{dir: dir, work: work, session: session}
    end

    test "已提交父段进入修订首请求及纠错请求，最终只提交 child 执行段",
         %{dir: dir, work: work, session: session} do
      System.put_env(@quality_revision_retry_env, "1")
      {parent_run_id, source, author_text} = run_persisted_slice_verify_source(work, session)
      parent_segment = TestAgenticLoopFixtures.persisted_segment(parent_run_id)
      parent_transcript = TestAgenticLoopFixtures.persisted_transcript(parent_run_id)
      [source_pending] = source.adoption_state.pending
      original_body = prose_body(source_pending)
      parent = self()

      run_id =
        start_slice_verify_revision(source,
          work_id: work.id,
          session_id: session.id,
          interaction_store: &InteractionLifecycle.call/2,
          forward: fn event ->
            if event.event_type == :artifact_created,
              do: send(parent, {:parented_revision_artifact, event})

            if event.event_type in [:run_completed, :run_failed],
              do: send(parent, {:parented_revision_terminal, event})
          end
        )

      assert_receive {:parented_revision_terminal, %{run_ref: ^run_id} = terminal}, 5_000
      [first_record, second_record] = revision_writer_records(dir)
      first_messages = first_record["request_body"]["messages"]
      second_messages = second_record["request_body"]["messages"]

      # 现请求日志只裁这两个私有回放字段，其余父消息仍全字段、原序比较。
      expected_history =
        parent_transcript.messages
        |> Enum.reject(&(&1.role == "application_base"))
        |> Enum.map(&Map.drop(&1, [:provider_state, :provider_session]))
        |> Jason.encode!()
        |> Jason.decode!()

      actual_history =
        first_messages
        |> Enum.slice(1, length(expected_history))
        |> Enum.map(&Map.drop(&1, ["canonical_ref", "session_history_run_id"]))

      assert actual_history == expected_history,
             inspect(
               %{actual_history: actual_history, expected_history: expected_history},
               limit: :infinity,
               printable_limit: :infinity
             )

      assert Enum.count(first_messages, &(&1["role"] == "application_base")) == 1

      assert Enum.any?(first_messages, fn message ->
               message["role"] == "user" and
                 Enum.any?(message["blocks"], &(&1["text"] == author_text))
             end)

      assert request_text(first_record) =~ "[质量修订要求]"
      assert Enum.take(second_messages, length(first_messages)) == first_messages
      [failed_call, failed_result] = Enum.drop(second_messages, length(first_messages))
      assert [%{"type" => "tool_call", "arguments" => %{}}] = failed_call["blocks"]

      assert [%{"status" => "failed", "reason_code" => "provider_response_invalid"}] =
               failed_result["blocks"]

      assert terminal.event_type == :run_completed
      assert {:ok, state} = AgentRunService.state(run_id)
      assert state.run.consumed_budget.provider_calls == 2
      assert state.run.consumed_budget.tool_calls == 1
      child_transcript = TestAgenticLoopFixtures.persisted_transcript(run_id)
      child_calls = tool_call_blocks(child_transcript)
      assert length(child_calls) == 2
      assert Enum.all?(child_calls, &(&1.provider_call_id == "native-submit_tentative_artifact"))

      all_ids = Enum.map(tool_call_blocks(parent_transcript) ++ child_calls, & &1.call_id)
      assert length(all_ids) == length(Enum.uniq(all_ids))
      assert Enum.at(child_calls, 0).arguments == %{}
      assert is_list(Enum.at(child_calls, 1).arguments["items"])
      assert [%{status: "failed"}, %{status: "passed"}] = validation_blocks(child_transcript)
      refute Enum.any?(child_transcript.messages, &(&1.role == "user"))
      assert TestAgenticLoopFixtures.persisted_segment(parent_run_id) == parent_segment

      assert_receive {:parented_revision_artifact,
                      %{run_ref: ^run_id, payload: %{turn_result: revision}}},
                     1_000

      assert revision.parent_turn_id == source.turn_id
      [revision_pending] = revision.adoption_state.pending
      outside = original_body |> String.split("\n") |> Enum.drop(3) |> Enum.join("\n")
      assert String.ends_with?(prose_body(revision_pending), "\n" <> outside)
      assert prose_body(source_pending) == original_body
      refute revision.truthfulness.artifact_adopted
      refute revision.truthfulness.production_write_performed

      assert [trace] = TraceRepository.list_by_scope(work.id, session.id, revision.turn_id)
      assert trace.trace_id == revision.trace_summary.trace_ref

      assert Enum.any?(MemoryLog.transcript(session.id), fn entry ->
               entry.role == "assistant" and entry.turn_id == revision.turn_id
             end)

      before_replay = length(llm_records(dir))

      assert {:ok, replay} =
               TraceReplayService.fetch_turn_report(work.id, session.id, revision.turn_id)

      refute replay.replay_report.provider_called
      assert length(llm_records(dir)) == before_replay
    end

    test "新 child 段真正复用父 canonical call_id 时原提交事务仍拒绝",
         %{dir: dir, work: work, session: session} do
      {parent_run_id, source, _author_text} = run_persisted_slice_verify_source(work, session)
      parent_transcript = TestAgenticLoopFixtures.persisted_transcript(parent_run_id)

      [parent_call] =
        Enum.filter(
          tool_call_blocks(parent_transcript),
          &(&1.name == "submit_tentative_artifact")
        )

      child_run_id = "run-duplicate-child-#{unique_integer()}"

      assert {:ok, child} =
               AgentRun.new(%{
                 run_id: child_run_id,
                 run_mode: :bounded,
                 workspace_id: work.id,
                 work_id: work.id,
                 session_id: session.id,
                 parent_turn_ref: source.turn_id,
                 origin_frame_ref: "frame-duplicate-child",
                 profile_ref: ProseRevisionFromFindings.profile_ref(),
                 goal: %{text: "只修订所选质量问题", version: 1},
                 authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
               })

      transcript =
        child
        |> AuthoringTranscript.new(
          base_text: RequestIR.application_base_text(),
          allow_authorless: true
        )
        |> AuthoringTranscript.append_assistant("", [parent_call])

      assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)

      ir =
        RequestIR.append_validation_result(
          ir,
          parent_call.call_id,
          "passed",
          "tentative_artifact_validated",
          %{adoption_required: true, canon_written: false},
          %{retryable: false, budget_after: nil}
        )

      assert {:ok, transcript} = AuthoringTranscript.from_request_ir(ir)
      state = %{stage_state: %{judgment_transcript: transcript}, events: [], event_sequence: 0}
      assert {:ok, snapshot} = AgentRunPersistence.snapshot(child, state, :delivery)
      before_history = AuthoringSessionLog.fetch_session(session.id)
      before_messages = MemoryLog.transcript(session.id)
      before_traces = TraceRepository.list_by_workspace(work.id)
      before_calls = length(llm_records(dir))

      assert {:error, :duplicate_call_id} = AgentRunPersistence.commit(snapshot)
      assert AgentRunLog.get_run(child_run_id) == nil
      assert AgentRunLog.list_steps(child_run_id) == []
      assert AgentRunLog.list_events(child_run_id) == []
      assert AuthoringSessionLog.fetch_session(session.id) == before_history
      assert MemoryLog.transcript(session.id) == before_messages
      assert TraceRepository.list_by_workspace(work.id) == before_traces
      assert length(llm_records(dir)) == before_calls
    end
  end

  defp authoring_task_map do
    %AuthoringTask{
      kind: :revision,
      author_goal: "只改第二段，其余逐字保留",
      author_words: @author_text,
      source: %{kind: :author_action, ref: "turn-session"},
      operation_effect: :revise_candidate,
      scope: %{refs: ["artifact:one"], coverage: :single, base_ref: "artifact:one"},
      preserve: ["其余逐字保留"],
      output_contract: %{
        kind: :json,
        artifact_type: "prose_fragment",
        required_keys: ["items"]
      },
      source_refs: ["turn-session"]
    }
    |> AuthoringTask.to_map()
  end

  defp tool_request do
    %ToolRequest{
      tool_request_id: "tq-session",
      turn_id: "turn-session",
      frame_ref: "frame-session",
      plan_ref: "plan-session",
      decision_ref: "decision-session",
      tool_name: "prose_writing",
      tool_version: "prose/v1",
      input: %{
        "revision" => "只改第二段，其余逐字保留",
        "authoring_task" => authoring_task_map(),
        "source_input_ref" => "turn-session",
        "context_text" => "原候选全文"
      },
      read_scope_grants: ["author_text", "chapter_structure"],
      write_scope_grants: [],
      idempotency_key: "turn-session:revise:candidate",
      trace_policy: %{level: "standard"},
      created_at: ~U[2026-11-01 00:00:00Z]
    }
  end

  defp author_text(ir) do
    ir.messages
    |> Enum.filter(&(&1.role == "user"))
    |> Enum.map_join("", fn message -> Projection.text_of(message.blocks) end)
  end

  defp agent_run do
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-bind",
        run_mode: :bounded,
        workspace_id: "workspace-bind",
        work_id: "work-bind",
        session_id: "session-bind",
        parent_turn_ref: "turn-bind",
        origin_frame_ref: "frame-bind",
        profile_ref: "profile-bind",
        goal: %{text: "按作者要求修订候选", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    run
  end

  defp revise_action(turn_result) do
    Enum.find(turn_result.available_actions, &(&1.action_type == "revise_from_findings"))
  end

  defp tool_call_blocks(%{messages: messages}) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) == "tool_call",
        do: block
  end

  defp validation_blocks(%{messages: messages}) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) == "validation_result",
        do: block
  end

  defp run_persisted_slice_verify_source(work, session) do
    old_persistence = Application.get_env(:novel_web, :persistence)

    Application.put_env(
      :novel_web,
      :persistence,
      Keyword.put(old_persistence || [], :inject_real_persistence, true)
    )

    # 整个父→child 用例共享真实读端口；run 清理先完成，再恢复原配置。
    on_exit(fn -> restore_app_env(:novel_web, :persistence, old_persistence) end)

    parent = self()
    context = slice_verify_context(work.id)
    [chapter_data] = context.structured_chapters
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{
        work_id: work.id,
        volume_id: volume.id,
        title: chapter_data.title,
        seq: chapter_data.seq,
        summary: chapter_data.summary
      })

    context = %{context | structured_chapters: [Map.put(chapter_data, :id, chapter.id)]}
    author_text = "　写第02章：矿区追击战正文草稿，短促动作追击。\n保持为待采纳草稿。  "

    input =
      TestAgenticLoopFixtures.prose_drafting_input(work.id, %{
        text: author_text,
        session_id: session.id,
        turn_id: "turn-persisted-source-#{unique_integer()}",
        interaction_store: &InteractionLifecycle.call/2,
        quality_provider_execution: slice_verify_execution(:evaluator),
        chapter_mission_writer: fn _work, _seq, _mission -> :ok end
      })

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_drafting_with_quality,
        input,
        context,
        slice_verify_execution(:writer)
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(planned.run_attrs, fn event ->
                 send(parent, {:persisted_source_event, event.event_type, event})
               end),
               interaction_input: planned.interaction_input,
               interaction_store: planned.interaction_store,
               next_step_planner: planned.next_step_planner
             )

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive {:persisted_source_event, :artifact_created, %{run_ref: ^run_id} = artifact},
                   5_000

    assert_receive {:persisted_source_event, :run_completed, %{run_ref: ^run_id}}, 5_000
    assert AgentRunLog.get_run(run_id).status == "completed"
    {run_id, artifact.payload.turn_result, author_text}
  end

  defp start_slice_verify_revision(source, opts) do
    parent = self()
    revise = revise_action(source)
    work_id = Keyword.get(opts, :work_id, @work)

    session_id =
      Keyword.get(opts, :session_id, "session-slice-verify-revision-#{unique_integer()}")

    action_input = %AuthorActionInput{
      input_id: "in-slice-verify-revision-#{unique_integer()}",
      source_turn_ref: source.turn_id,
      action_id: revise.action_id,
      action_type: "revise_from_findings",
      target_ref: revise.target_ref,
      payload: %{"quality_finding_refs" => revise.quality_finding_refs},
      idempotency_key: revise.idempotency_key
    }

    input = %{
      text: "按质量发现重写正文草稿",
      workspace_id: work_id,
      work_id: work_id,
      session_id: session_id,
      turn_id: source.turn_id,
      source_turn_result: source,
      action_input: action_input
    }

    input =
      case Keyword.get(opts, :interaction_store) do
        nil -> input
        store -> Map.put(input, :interaction_store, store)
      end

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_revision_from_findings,
        input,
        nil,
        slice_verify_execution(:revision)
      )

    planner_hook = Keyword.get(opts, :planner_hook, fn _run, _sequence, _snapshot -> :ok end)

    planner = fn run, sequence, snapshot ->
      send(parent, {:revision_planner_snapshot, run.run_id, sequence, snapshot})
      planner_hook.(run, sequence, snapshot)
      planned.next_step_planner.(run, sequence, snapshot)
    end

    event_forward =
      Keyword.get(opts, :forward, fn event ->
        send(parent, {:agent_event, event.event_type, event})
      end)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(planned.run_attrs, event_forward),
               interaction_input: planned.interaction_input,
               next_step_planner: planner,
               interaction_store: planned.interaction_store
             )

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    run_id
  end

  defp slice_verify_execution(purpose) do
    Execution.dependency(
      provider: :slice_verify,
      model: "fixture-model",
      purpose: purpose
    )
  end

  defp prose_body(pending) do
    pending.payload.items |> hd() |> Map.get(:body)
  end

  defp revision_writer_records(dir) do
    dir
    |> llm_records()
    |> Enum.filter(&String.contains?(request_text(&1), "[质量修订要求]"))
  end

  # canonical IR 请求记录的 `prompt` 字段为 nil：正文材料在 `request_body` 的
  # canonical messages/blocks 中。只读实际落盘的请求字节，不重建旧 prompt。
  defp request_text(record) do
    case Map.get(record, "prompt") do
      text when is_binary(text) -> text
      _ -> record |> Map.get("request_body", %{}) |> Map.get("messages", []) |> Jason.encode!()
    end
  end

  defp llm_records(dir) do
    path = Path.join(dir, "#{NovelTelemetry.LogFileDate.today_iso8601()}.jsonl")

    path
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.map(fn
      "[" <> _ = line ->
        [_prefix, json] = String.split(line, "] ", parts: 2)
        Jason.decode!(json)

      line ->
        Jason.decode!(line)
    end)
  end

  defp slice_verify_context(work_id) do
    %DialogueContext{
      work_id: work_id,
      current_chapters: ["第02章：矿区追击战"],
      structured_chapters: [
        %{
          title: "第02章：矿区追击战",
          seq: 2,
          summary: "主角在废弃矿区遭遇巡检傀儡，短促的动作追击中且战且退。",
          has_prose: false
        }
      ],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end

  defp unique_integer, do: System.unique_integer([:positive, :monotonic])

  defp restore_app_env(app, key, nil), do: Application.delete_env(app, key)
  defp restore_app_env(app, key, value), do: Application.put_env(app, key, value)

  defp restore_system_env(key, nil), do: System.delete_env(key)
  defp restore_system_env(key, value), do: System.put_env(key, value)
end
