defmodule NovelApplication.AgentRunResultCommitTest do
  @moduledoc """
  B71 VS-00L §16.8 普通结果原子交付行为红候选（TDD，仅测试）。

  入口只走公开的 `NovelApplication.AgentRunService`，启动真实 `AgentRunServer`
  与真实 test DB；不调用 private 函数、不改 `:sys` state、不手工投递伪造结果消息。
  事件监听器（event sink）在收到目标事件时直接读 DB，并记录 `Repo.in_transaction?()`；
  成功发布与“已提交失败”用例都要求该值为 false，作为“先提交、后广播”的核心证据。
  失败后的 live 事实通过公开 `AgentRunService.state/1` 读取。

  本文件是候选红测试，已由 worker 实际运行：9/9 红，逐项红源见
  `artifacts/b71-resume/worker-atomic-valid-red.md`。

  Fixture 边界：
  - planner/step 是合法测试回调，不替代生产结果提交路径。
  - 私有 canonical 用 `AuthoringTranscript` 的既有 codec 构造，身份来自真实
    work/workspace/session/parent turn。
  - TurnResult 写入仍经过 `InteractionLifecycle` 的 `AuthorContentRegistration.resolve/1`；
    断言读取持久 Interaction，而不是假设写入前的内存结果就是落库结果。
  - SQL trigger 只拒绝私有历史列或结果类非流事件写入，模拟真实提交失败，不伪造事件。
  - 问题交付复用 `AuthorQuestion.turn_result/2` 的合法 fixture，不改问题契约。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.AgentRunService
  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.AuthorQuestion
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelApplication.TurnResultBuilder

  alias NovelDomain.{AgentNextStepDecision, AgentStep, DecisionTrace}

  alias NovelPersistence.{
    AgentRunLog,
    AuthorQuestionRepo,
    InteractionLifecycle,
    LongRunTaskLog,
    MemoryLog,
    Repo,
    TraceRepository,
    WorkRepo,
    WorkSessionRepo
  }

  @success_text "候选已生成，等待作者审阅。"
  @private_marker "private-result-commit-marker"

  @observed_events [
    :turn_result_ready,
    :artifact_created,
    :run_failed,
    :run_cancelled,
    :awaiting_author
  ]

  @success_events [:turn_result_ready, :artifact_created, :awaiting_author]

  setup do
    owner = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(owner) end)

    {:ok, work} = WorkRepo.create(%{title: "普通结果原子交付"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "普通结果原子交付会话"})

    %{work: work, session: session}
  end

  test "turn_result_ready 广播时 Interaction/trace/run/step/private/event 已同时可读", scope do
    attrs = run_attrs(scope)
    transcript = transcript_for(attrs, private_marker: true)
    trace = trace_for(attrs)
    step = step_for(attrs)
    parent = self()

    planner = fn run, sequence, _snapshot ->
      send(parent, {:planner_called, sequence})
      result = success_step_result(run, step, trace, transcript)

      {:execute, fn _run, _sequence, _snapshot -> {:ok, result} end,
       execute_decision(run, sequence), %{provider_call_count: 0}}
    end

    sink = event_forward(parent, fn _event -> db_snapshot(scope, attrs, trace) end)

    run_id =
      start_bounded!(NovelApplication.TestAgentEventRelay.observe(attrs, sink),
        next_step_planner: planner
      )

    assert_receive {:planner_called, 1}, 2_000
    {event, snapshot} = await_snapshot!(:turn_result_ready)

    assert event.event_type == :turn_result_ready
    assert event.run_ref == run_id
    assert_success_committed!(snapshot, attrs, step, trace, :turn_result_ready)
  end

  test "artifact_created 广播时 Interaction/trace/run/step/private/event 已同时可读", scope do
    attrs = run_attrs(scope)
    transcript = transcript_for(attrs, private_marker: true)
    trace = trace_for(attrs)
    step = step_for(attrs)
    artifact_ref = "artifact_#{attrs.run_id}"
    parent = self()

    planner = fn run, sequence, _snapshot ->
      send(parent, {:planner_called, sequence})

      result =
        success_step_result(run, step, trace, transcript, artifact_refs: [artifact_ref])

      {:execute, fn _run, _sequence, _snapshot -> {:ok, result} end,
       execute_decision(run, sequence), %{provider_call_count: 0}}
    end

    sink = event_forward(parent, fn _event -> db_snapshot(scope, attrs, trace) end)

    run_id =
      start_bounded!(NovelApplication.TestAgentEventRelay.observe(attrs, sink),
        next_step_planner: planner
      )

    assert_receive {:planner_called, 1}, 2_000
    {event, snapshot} = await_snapshot!(:artifact_created)

    assert event.event_type == :artifact_created
    assert event.run_ref == run_id
    assert artifact_ref in event.refs

    assert_success_committed!(snapshot, attrs, step, trace, :artifact_created)
    assert snapshot.run.pending_artifact_refs == [artifact_ref]
  end

  test "durable 普通结果广播时 task checkpoint 与私有历史同一提交已可读", scope do
    attrs = run_attrs(scope)
    transcript = transcript_for(attrs, private_marker: true)
    trace = trace_for(attrs)
    step = step_for(attrs)
    parent = self()

    planner = fn run, sequence, _snapshot ->
      send(parent, {:planner_called, sequence})
      result = success_step_result(run, step, trace, transcript)

      {:execute, fn _run, _sequence, _snapshot -> {:ok, result} end,
       execute_decision(run, sequence), %{provider_call_count: 0}}
    end

    sink =
      event_forward(parent, fn _event ->
        snapshot = db_snapshot(scope, attrs, trace)
        run = snapshot.run
        task = run && run.long_run_task_ref && LongRunTaskLog.get(run.long_run_task_ref)
        Map.put(snapshot, :task, task)
      end)

    run_id =
      start_durable!(NovelApplication.TestAgentEventRelay.observe(attrs, sink),
        next_step_planner: planner
      )

    assert_receive {:planner_called, 1}, 2_000
    {event, snapshot} = await_snapshot!(:turn_result_ready)

    assert event.event_type == :turn_result_ready
    assert event.run_ref == run_id
    assert_success_committed!(snapshot, attrs, step, trace, :turn_result_ready)

    run = snapshot.run
    assert run
    task_ref = run.long_run_task_ref
    assert task_ref
    task = snapshot.task
    assert task
    assert task.id == task_ref
    assert task.checkpoint_data["agent_run"]["checkpoint_version"] == 3
    ref = task.checkpoint_data["agent_run"]["authoring_segment_ref"]
    assert ref
    assert ref["run_id"] == attrs.run_id
    assert ref["version"] == NovelApplication.AuthoringCheckpoint.format_version()
    refute Map.has_key?(task.checkpoint_data, "authoring_transcript")
  end

  for {kind, label} <- [private_history: "私有列", event: "结果事件"] do
    test "SQL 拒绝#{label}写入时成功结果全量回滚，live 失败态保留 canonical 与真实消耗",
         scope do
      assert_result_commit_rolled_back!(scope, unquote(kind))
    end
  end

  test "仅 interaction_store :result 失败时保留已收到历史与真实消耗，不广播成功结果", scope do
    attrs = run_attrs(scope)
    transcript = transcript_for(attrs, private_marker: true)
    trace = trace_for(attrs)
    step = step_for(attrs)
    parent = self()

    failing_store = fn
      :result, _attrs -> {:error, :injected_result_commit_failure}
      operation, operation_attrs -> InteractionLifecycle.call(operation, operation_attrs)
    end

    planner = fn run, sequence, _snapshot ->
      send(parent, {:planner_called, sequence})
      result = success_step_result(run, step, trace, transcript)

      {:execute, fn _run, _sequence, _snapshot -> {:ok, result} end,
       execute_decision(run, sequence), %{provider_call_count: 0}}
    end

    sink = event_forward(parent, fn _event -> db_snapshot(scope, attrs, trace) end)

    run_id =
      start_bounded!(NovelApplication.TestAgentEventRelay.observe(attrs, sink),
        next_step_planner: planner,
        interaction_store: failing_store
      )

    assert_receive {:planner_called, 1}, 2_000
    {event, _snapshot} = await_failure_without_success!()
    assert event.event_type == :run_failed

    failure_result = published_turn_result(event)

    if failure_result do
      refute inspect(failure_result) =~ @success_text
    end

    assert {:ok, live} = AgentRunService.state(run_id)
    assert live.run.status == :failed
    assert live.stage_state.judgment_transcript == transcript
    assert live.run.consumed_budget.tool_calls == 1
    assert live.run.consumed_budget.provider_calls == 2

    refute Enum.any?(MemoryLog.transcript(scope.session.id), fn entry ->
             entry.role == "assistant" and
               get_in(entry.content, ["turn_result", "assistant_message", "text"]) ==
                 @success_text
           end)
  end

  test "失败 step 的失败 TurnResult/canonical/真实消耗先提交后广播，作者出口无 private marker",
       scope do
    attrs = run_attrs(scope)
    transcript = transcript_for(attrs, private_marker: true)
    parent = self()

    planner = fn _run, sequence, _snapshot ->
      send(parent, {:planner_called, sequence})

      {:error, :writer_failed,
       %{
         judgment_transcript: transcript,
         provider_call_count: 2,
         tool_call_count: 1
       }}
    end

    sink = event_forward(parent, fn _event -> db_snapshot(scope, attrs) end)

    run_id =
      start_bounded!(NovelApplication.TestAgentEventRelay.observe(attrs, sink),
        next_step_planner: planner
      )

    assert_receive {:planner_called, 1}, 2_000
    {event, snapshot} = await_failure_without_success!()
    assert event.event_type == :run_failed

    # 失败 TurnResult/canonical/消耗也已提交后才广播，读取时不得处于事务内。
    assert snapshot.transaction_open? == false
    refute_received {:planner_called, 2}

    assert [assistant] = Enum.filter(snapshot.transcript, &(&1.role == "assistant"))
    assert assistant.content["agent_run_id"] == run_id
    assert assistant.content["turn_result"]["status"] == "failed_recoverable"
    refute inspect(assistant.content) =~ @private_marker

    run = snapshot.run
    assert run
    assert run.status == "failed"
    assert run.consumed_budget["tool_calls"] == 1
    assert run.consumed_budget["provider_calls"] == 2

    canonical = TestAgenticLoopFixtures.persisted_transcript(run)
    assert canonical
    assert inspect(canonical) =~ @private_marker

    run_identity = canonical.run
    assert run_identity
    assert run_identity.run_id == attrs.run_id
    assert run_identity.work_id == attrs.work_id
    assert run_identity.workspace_id == attrs.workspace_id
    assert run_identity.session_id == attrs.session_id
    assert run_identity.parent_turn_ref == attrs.parent_turn_ref

    assert Enum.any?(snapshot.events, &(&1.event_type == "run_failed"))
    refute Enum.any?(snapshot.events, &(&1.event_type == "provider_progress"))
    refute inspect(event.payload) =~ @private_marker
    refute inspect(snapshot.events) =~ @private_marker
  end

  test "问题交付事务失败时保留本步 history/budget，且不广播未提交 question", scope do
    attrs = run_attrs(scope)
    transcript = transcript_for(attrs, private_marker: true)
    parent = self()

    judgment = %{
      action: "await_author",
      dialogue_goal: "确认结尾悬念的处理方式",
      question: "结尾保留悬念吗？",
      options: [],
      narrative: "结尾保留悬念吗？",
      reply_record: %{},
      tool_call_id: "question-call-#{attrs.run_id}",
      narrative_source: %{provider_call_ref: "provider-question-#{attrs.run_id}"}
    }

    failing_delivery_store = fn
      :question_delivery, delivery_attrs ->
        delivery_attrs =
          Map.put(delivery_attrs, :checkpoint, %{
            task_ref: "missing-question-delivery-checkpoint",
            attrs: %{}
          })

        InteractionLifecycle.call(:question_delivery, delivery_attrs)

      operation, operation_attrs ->
        InteractionLifecycle.call(operation, operation_attrs)
    end

    planner = fn run, sequence, _snapshot ->
      send(parent, {:planner_called, sequence})
      {question_result, trace} = AuthorQuestion.turn_result(run, judgment)

      result = %{
        turn_result: question_result,
        decision_trace: trace,
        stage_state: %{judgment_transcript: transcript},
        provider_call_count: 2,
        tool_call_count: 1
      }

      {:execute, fn _run, _sequence, _snapshot -> {:ok, result} end,
       execute_decision(run, sequence), %{provider_call_count: 0, suppress_plan_event: true}}
    end

    sink = event_forward(parent, fn _event -> db_snapshot(scope, attrs) end)

    run_id =
      start_bounded!(NovelApplication.TestAgentEventRelay.observe(attrs, sink),
        next_step_planner: planner,
        interaction_store: failing_delivery_store
      )

    assert_receive {:planner_called, 1}, 2_000
    {event, _snapshot} = await_failure_without_success!()
    assert event.event_type == :run_failed
    failure_result = published_turn_result(event) || %{}
    refute Map.has_key?(failure_result, :author_question)
    refute Map.has_key?(failure_result, "author_question")

    assert {:ok, live} = AgentRunService.state(run_id)
    assert live.run.status == :failed
    assert Map.get(live.stage_state, :judgment_transcript) == transcript
    assert live.run.consumed_budget.tool_calls == 1
    assert live.run.consumed_budget.provider_calls == 2

    assert AuthorQuestionRepo.results(scope.work.id, scope.session.id) == []
    refute Enum.any?(run_events(run_id), &(&1.event_type == "awaiting_author"))
  end

  test "公开取消后的晚到 step 响应保留已发生 history 与真实消耗", scope do
    attrs = run_attrs(scope)
    transcript = transcript_for(attrs)
    step_record = step_for(attrs)
    parent = self()

    step = fn run, _sequence, _snapshot ->
      send(parent, {:step_waiting, self()})

      receive do
        :release ->
          {:ok,
           %{
             step: step_record,
             turn_result: success_turn_result(run, @success_text),
             stage_state: %{judgment_transcript: transcript},
             provider_call_count: 2,
             tool_call_count: 1
           }}
      end
    end

    planner = fn run, sequence, _snapshot ->
      {:execute, step, execute_decision(run, sequence),
       %{provider_call_count: 0, suppress_plan_event: true}}
    end

    sink = event_forward(parent, fn _event -> db_snapshot(scope, attrs) end)

    run_id =
      start_bounded!(NovelApplication.TestAgentEventRelay.observe(attrs, sink),
        next_step_planner: planner
      )

    assert_receive {:step_waiting, step_pid}, 2_000
    assert :ok = AgentRunService.cancel(run_id)

    # 公开 state call 是 cast 之后的屏障：取消命令已被 GenServer 处理，再放行真实 step。
    assert {:ok, %{run: %{status: :cancelling}}} = AgentRunService.state(run_id)
    send(step_pid, :release)

    {event, _snapshot} = await_cancelled_without_success!()
    assert event.event_type == :run_cancelled

    assert {:ok, live} = AgentRunService.state(run_id)
    assert live.run.status == :cancelled
    assert Map.get(live.stage_state, :judgment_transcript) == transcript
    assert live.run.consumed_budget.tool_calls == 1
    assert live.run.consumed_budget.provider_calls == 2
  end

  test "替换结果提交失败保留已提交 pending，不落未提交 supersede 事件", scope do
    attrs = run_attrs(scope)
    transcript = transcript_for(attrs)
    trace = trace_for(attrs)
    first_step = step_for(attrs)
    old_ref = "old-pending-#{attrs.run_id}"
    new_ref = "new-pending-#{attrs.run_id}"
    parent = self()

    store = fn op, data ->
      if op == :result and result_assistant_text(data) == "替换候选",
        do: {:error, :disk_full},
        else: InteractionLifecycle.call(op, data)
    end

    planner = fn run, sequence, _snapshot ->
      result =
        if sequence == 1 do
          success_step_result(run, first_step, trace, transcript, artifact_refs: [old_ref])
          |> Map.drop([:loop_status, :loop_decision])
          |> Map.put(:provider_call_count, 0)
        else
          second_step = step_for_sequence(attrs, 2)

          success_step_result(run, second_step, trace, transcript, artifact_refs: [new_ref])
          |> Map.put(:turn_result, success_turn_result(run, "替换候选"))
          |> Map.put(:provider_call_count, 0)
          |> Map.put(:supersede_artifact_refs, [old_ref])
        end

      {:execute, fn _run, _sequence, _snapshot -> {:ok, result} end,
       execute_decision(run, sequence), %{provider_call_count: 0}}
    end

    run_id =
      start_bounded!(
        NovelApplication.TestAgentEventRelay.observe(
          attrs,
          event_forward(parent, fn _ -> db_snapshot(scope, attrs, trace) end)
        ),
        next_step_planner: planner,
        interaction_store: store
      )

    {_event, first} = await_snapshot!(:artifact_created)
    assert first.run.pending_artifact_refs == [old_ref]

    {_event, _snapshot} = await_failure_without_success!()

    assert {:ok, live} = AgentRunService.state(run_id)
    assert live.run.pending_artifact_refs == [old_ref]
    assert AgentRunLog.get_run(run_id).pending_artifact_refs == [old_ref]

    refute Enum.any?(
             AgentRunLog.list_events(run_id),
             &(&1.event_type == "artifact_superseded")
           )

    assert Enum.any?(MemoryLog.transcript(scope.session.id), fn row ->
             row.role == "assistant" and row.content["text"] == @success_text
           end)
  end

  test "真实运行时复用已物化原文候选：不重复登记、不重复广播、原候选保留", scope do
    attrs = run_attrs(scope)
    raw = "  原文资料\n保留完整字节  "
    parent = self()

    build = fn turn ->
      {:ok, artifact} = ArtifactAssembler.assemble_author_content(turn, raw, "author-original")

      turn_result =
        %{
          turn_id: turn,
          outcome: "author_content_registration",
          assistant_message: %{text: "按原文登记候选。"},
          trace_summary: %{registration_source_ref: "author_input:author-original"},
          available_actions: [],
          ui_cards: []
        }
        |> TurnResultBuilder.attach_author_artifact(artifact)

      {turn_result, hd(turn_result.adoption_state.pending).artifact_id}
    end

    planner = fn run, sequence, _snapshot ->
      send(parent, {:planner_called, sequence})
      {turn_result, artifact_ref} = build.("author-original-#{sequence}")
      step = step_for_sequence(attrs, sequence)

      result = %{
        step: step,
        turn_result: turn_result,
        artifact_refs: [artifact_ref],
        provider_call_count: 0,
        tool_call_count: 0,
        loop_status: if(sequence == 2, do: :completed, else: nil)
      }

      {:execute, fn _run, _sequence, _snapshot -> {:ok, result} end,
       execute_decision(run, sequence), %{provider_call_count: 0, suppress_plan_event: true}}
    end

    sink = event_forward(parent, fn _event -> db_snapshot(scope, attrs) end)

    run_id =
      start_bounded!(NovelApplication.TestAgentEventRelay.observe(attrs, sink),
        next_step_planner: planner
      )

    assert_receive {:planner_called, 1}, 2_000
    {first_event, _snapshot} = await_snapshot!(:artifact_created)
    assert first_event.event_type == :artifact_created

    assert_receive {:planner_called, 2}, 2_000
    await_snapshot!(:turn_result_ready)
    refute_receive {:agent_event_snapshot, %{event_type: :artifact_created}, _}, 150

    state = db_snapshot(scope, attrs)

    assert [pending] =
             WorkSessionRepo.adoption_state(scope.work.id, scope.session.id).pending_adoptions

    assert pending["payload"]["items"] |> hd() |> Map.fetch!("body") == raw

    assert Enum.count(state.events, &(&1.event_type == "artifact_created")) == 1

    assert Enum.any?(state.transcript, fn entry ->
             entry.role == "assistant" and
               get_in(entry.content, ["turn_result", "outcome"]) == "already_materialized"
           end)

    assert {:ok, live} = AgentRunService.state(run_id)
    assert live.run.status == :completed
    assert live.run.consumed_budget.provider_calls == 0
    assert live.run.consumed_budget.tool_calls == 0
    assert length(live.run.pending_artifact_refs) == 1
  end

  # 两种 SQL 故障共享同一观察/断言，只有 trigger 与用例名独立，保证各自红。
  defp assert_result_commit_rolled_back!(scope, kind) do
    attrs = run_attrs(scope)
    transcript = transcript_for(attrs, private_marker: true)
    trace = trace_for(attrs)
    step = step_for(attrs)
    trigger_name = "reject_result_commit_#{kind}_#{System.unique_integer([:positive])}"
    parent = self()

    planner = fn run, sequence, _snapshot ->
      send(parent, {:planner_called, kind, sequence})
      :ok = install_trigger!(kind, trigger_name)
      result = success_step_result(run, step, trace, transcript)

      {:execute, fn _run, _sequence, _snapshot -> {:ok, result} end,
       execute_decision(run, sequence), %{provider_call_count: 0}}
    end

    sink = event_forward(parent, fn _event -> db_snapshot(scope, attrs, trace) end)

    try do
      run_id =
        start_bounded!(NovelApplication.TestAgentEventRelay.observe(attrs, sink),
          next_step_planner: planner
        )

      assert_receive {:planner_called, ^kind, 1}, 2_000

      {event, _snapshot} = await_failure_without_success!()
      assert event.event_type == :run_failed

      assert {:ok, live} = AgentRunService.state(run_id)
      assert live.run.status == :failed
      assert Map.get(live.stage_state, :judgment_transcript) == transcript
      assert live.run.consumed_budget.tool_calls == 1
      assert live.run.consumed_budget.provider_calls == 2
      refute_received {:planner_called, ^kind, 2}

      assert AgentRunLog.list_steps(run_id) == []
      assert TraceRepository.get_by_trace_id(trace.trace_id) == nil

      run = AgentRunLog.get_run(run_id)
      assert run
      assert {:ok, nil} = NovelPersistence.AuthoringSessionLog.fetch_run_segment(run_id)

      assert NovelPersistence.AuthoringSessionLog.fetch_session_messages(attrs.session_id) == []

      refute Enum.any?(
               run_events(run_id),
               &(&1.event_type in ["turn_result_ready", "artifact_created"])
             )

      refute Enum.any?(MemoryLog.transcript(scope.session.id), fn entry ->
               entry.role == "assistant" and
                 get_in(entry.content, ["turn_result", "assistant_message", "text"]) ==
                   @success_text
             end)
    after
      drop_trigger!(trigger_name)
    end
  end

  # ── fixtures ───────────────────────────────────────────────────────────────

  defp run_attrs(scope) do
    run_id = unique("run_result_commit")
    parent_turn_ref = "turn_#{run_id}"

    %{
      run_id: run_id,
      workspace_id: scope.work.id,
      work_id: scope.work.id,
      session_id: scope.session.id,
      parent_turn_ref: parent_turn_ref,
      origin_frame_ref: "frame_#{run_id}",
      profile_ref: "conversation_turn_v1",
      trigger: %{kind: "user_message"},
      goal: %{text: "核对普通结果原子交付", version: 1},
      authority_scope: %{production_write: false, allowed_tools: ["readonly_batch"]}
    }
  end

  defp transcript_for(attrs, opts \\ []) do
    base =
      AuthoringTranscript.new(attrs,
        base_text: "B71 普通结果原子交付 Base",
        author_text: attrs.goal.text
      )

    transcript =
      if Keyword.get(opts, :private_marker) do
        AuthoringTranscript.append_provider_result(base, %{
          content: "模型私有回放不进入作者出口",
          provider_state: %{"reasoning_content" => @private_marker}
        })
      else
        AuthoringTranscript.append_assistant(base, "候选正文")
      end

    assert_canonical_fixture!(attrs, transcript)
    transcript
  end

  # fixture 自检：写入边界编码 + 共享 IR 校验后，段头身份与消息必须与内存 canonical 同源。
  # 只证明 fixture 可写可回读，不把 encoded 结果回灌给运行，不预归一历史。
  defp assert_canonical_fixture!(attrs, transcript) do
    record = %{
      id: attrs.run_id,
      workspace_id: attrs.workspace_id,
      work_id: attrs.work_id,
      session_id: attrs.session_id,
      parent_turn_ref: attrs.parent_turn_ref
    }

    assert {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(transcript)
    assert :ok = AuthoringCheckpoint.validate_segment(record, segment)

    # 直接回读等值：段头 run 身份与 JSON 形状消息必须与内存 canonical 一致。
    assert segment.header["version"] == AuthoringCheckpoint.format_version()
    assert segment.header["run"] == json_encode_decode(transcript.run)
    assert json_encode_decode(segment.messages) == json_encode_decode(transcript.messages)
  end

  defp json_encode_decode(value), do: value |> Jason.encode!() |> Jason.decode!()

  defp result_assistant_text(%{turn_result: result}) do
    message = Map.get(result, :assistant_message) || Map.get(result, "assistant_message") || %{}
    Map.get(message, :text) || Map.get(message, "text")
  end

  defp success_step_result(run, step, trace, transcript, opts \\ []) do
    result = %{
      step: step,
      turn_result: success_turn_result(run, @success_text),
      decision_trace: trace,
      stage_state: %{judgment_transcript: transcript},
      provider_call_count: 2,
      tool_call_count: 1,
      loop_status: :completed,
      loop_decision: complete_decision(run, step.sequence)
    }

    case Keyword.get(opts, :artifact_refs, []) do
      [] -> result
      refs -> Map.put(result, :artifact_refs, refs)
    end
  end

  defp success_turn_result(%{run_id: run_id, parent_turn_ref: parent_turn_ref}, text) do
    %{
      turn_id: parent_turn_ref,
      assistant_message: %{text: text},
      trace_summary: %{},
      available_actions: [],
      ui_cards: [],
      truthfulness: %{production_write_performed: false},
      agent_run: %{
        run_id: run_id,
        parent_turn_ref: parent_turn_ref,
        status: "completed"
      }
    }
  end

  defp trace_for(attrs) do
    %DecisionTrace{
      trace_id: "trace_#{attrs.run_id}",
      turn_id: attrs.parent_turn_ref,
      frame_ref: attrs.origin_frame_ref,
      decision_type: :reply_only,
      no_tool_reason: "no_tool_requested",
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      redaction_level: :author_safe,
      event_order: [:turn_result_emitted]
    }
  end

  defp step_for(attrs), do: step_for_sequence(attrs, 1)

  defp step_for_sequence(attrs, sequence) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: "step_#{attrs.run_id}_#{sequence}",
        run_ref: attrs.run_id,
        sequence: sequence,
        status: :completed,
        goal: "执行普通结果提交步骤",
        micro_plan_ref: "micro_plan_#{attrs.run_id}_#{sequence}",
        decision_ref: "decision_#{attrs.run_id}_#{sequence}",
        tool_request_ref: "tool_request_#{attrs.run_id}_#{sequence}",
        tool_result_ref: "tool_result_#{attrs.run_id}_#{sequence}",
        idempotency_key: "#{attrs.run_id}:#{sequence}"
      })

    step
  end

  defp execute_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "decision_#{run_id_of(run)}_#{sequence}",
        run_ref: run_id_of(run),
        sequence: sequence,
        decision_type: :execute_step,
        summary: "执行普通结果提交步骤",
        target_tool_ref: "readonly_batch",
        write_intent: :none,
        risk_hint: :low,
        reason_codes: ["atomic_result_test"]
      })

    decision
  end

  defp complete_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "complete_#{run_id_of(run)}_#{sequence}",
        run_ref: run_id_of(run),
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "普通结果已交付",
        reason_codes: ["goal_satisfied"]
      })

    decision
  end

  defp run_id_of(%{run_id: run_id}), do: run_id

  # ── event sink / DB observation ────────────────────────────────────────────

  defp event_forward(parent, snapshot_fun) when is_function(snapshot_fun, 1) do
    fn event ->
      if event.event_type in @observed_events do
        send(parent, {:agent_event_snapshot, event, snapshot_fun.(event)})
      end
    end
  end

  defp db_snapshot(scope, attrs, trace \\ nil) do
    %{
      transcript: MemoryLog.transcript(scope.session.id),
      trace: trace && TraceRepository.get_by_trace_id(trace.trace_id),
      run: AgentRunLog.get_run(attrs.run_id),
      steps: AgentRunLog.list_steps(attrs.run_id),
      events: run_events(attrs.run_id),
      questions: AuthorQuestionRepo.results(scope.work.id, scope.session.id),
      transaction_open?: Repo.in_transaction?()
    }
  end

  defp run_events(run_id), do: AgentRunLog.list_events(run_id)

  defp published_turn_result(event) do
    event.payload[:turn_result] || event.payload["turn_result"]
  end

  defp assert_success_committed!(snapshot, attrs, step, trace, event_type) do
    # 广播必须发生在提交之后；同连接读事务内未提交行会假绿。
    assert snapshot.transaction_open? == false
    assert snapshot.trace
    assert snapshot.trace.trace_id == trace.trace_id
    assert snapshot.trace.workspace_id == attrs.workspace_id
    assert snapshot.trace.session_id == attrs.session_id
    assert snapshot.trace.turn_id == attrs.parent_turn_ref

    assert [assistant] = Enum.filter(snapshot.transcript, &(&1.role == "assistant"))
    assert assistant.content["agent_run_id"] == attrs.run_id
    assert assistant.content["text"] == @success_text
    assert assistant.content["turn_result"]["turn_id"] == attrs.parent_turn_ref
    assert assistant.content["turn_result"]["assistant_message"]["text"] == @success_text
    refute inspect(assistant.content) =~ @private_marker

    run = snapshot.run
    assert run
    assert run.consumed_budget["tool_calls"] == 1
    assert run.consumed_budget["provider_calls"] == 2
    assert run.completed_step_refs == [step.step_id]

    canonical = TestAgenticLoopFixtures.persisted_transcript(run)
    assert canonical
    run_identity = canonical.run
    assert run_identity
    assert run_identity.run_id == attrs.run_id
    assert run_identity.work_id == attrs.work_id
    assert run_identity.workspace_id == attrs.workspace_id
    assert run_identity.session_id == attrs.session_id
    assert run_identity.parent_turn_ref == attrs.parent_turn_ref
    assert inspect(canonical) =~ @private_marker

    assert [stored_step] = snapshot.steps
    assert stored_step.id == step.step_id
    assert stored_step.status == "completed"

    event_name = Atom.to_string(event_type)

    assert Enum.any?(snapshot.events, fn stored_event ->
             stored_event.event_type == event_name and stored_event.run_id == attrs.run_id
           end)

    refute Enum.any?(snapshot.events, &(&1.event_type == "provider_progress"))
    refute inspect(snapshot.events) =~ @private_marker
  end

  defp await_snapshot!(type, timeout \\ 2_000) do
    receive do
      {:agent_event_snapshot, %{event_type: ^type} = event, snapshot} ->
        {event, snapshot}

      {:agent_event_snapshot, _other, _snapshot} ->
        await_snapshot!(type, timeout)
    after
      timeout -> flunk("未在超时前收到 #{inspect(type)} 的数据库快照")
    end
  end

  defp await_failure_without_success!(timeout \\ 2_000) do
    await_terminal_without_success!(:run_failed, timeout)
  end

  defp await_cancelled_without_success!(timeout \\ 2_000) do
    await_terminal_without_success!(:run_cancelled, timeout)
  end

  defp await_terminal_without_success!(terminal, timeout) do
    receive do
      {:agent_event_snapshot, %{event_type: type}, _snapshot} when type in @success_events ->
        flunk("提交失败/取消后仍观察到成功结果事件 #{inspect(type)}")

      {:agent_event_snapshot, %{event_type: ^terminal} = event, snapshot} ->
        {event, snapshot}

      {:agent_event_snapshot, _other, _snapshot} ->
        await_terminal_without_success!(terminal, timeout)
    after
      timeout -> flunk("未在超时前收到 #{inspect(terminal)} 终态通知")
    end
  end

  # ── SQL fault injection ────────────────────────────────────────────────────

  defp install_trigger!(:private_history, name) do
    Repo.query!("""
    CREATE TEMP TRIGGER #{name} BEFORE INSERT ON authoring_session_messages
    BEGIN SELECT RAISE(ABORT, 'injected private history rejection'); END
    """)

    :ok
  end

  defp install_trigger!(:event, name) do
    Repo.query!("""
    CREATE TEMP TRIGGER #{name} BEFORE INSERT ON agent_events
    WHEN NEW.event_type IN ('turn_result_ready', 'artifact_created', 'run_failed')
    BEGIN SELECT RAISE(ABORT, 'injected result event write rejection'); END
    """)

    :ok
  end

  defp drop_trigger!(name) do
    Repo.query!("DROP TRIGGER IF EXISTS #{name}")
    :ok
  end

  # ── runtime hygiene ────────────────────────────────────────────────────────

  defp start_bounded!(attrs, opts) do
    opts = Keyword.put_new(opts, :interaction_store, &InteractionLifecycle.call/2)

    assert {:ok, run_id} = AgentRunService.start_bounded(attrs, opts)
    track_run(run_id)
    run_id
  end

  defp start_durable!(attrs, opts) do
    opts = Keyword.put_new(opts, :interaction_store, &InteractionLifecycle.call/2)

    assert {:ok, run_id} = AgentRunService.start_durable(attrs, opts)
    track_run(run_id)
    run_id
  end

  defp track_run(run_id) do
    on_exit(fn ->
      case Registry.lookup(NovelApplication.AgentRunRegistry, run_id) do
        [{pid, _}] -> DynamicSupervisor.terminate_child(NovelApplication.AgentRunSupervisor, pid)
        _ -> :ok
      end
    end)
  end

  defp unique(prefix), do: "#{prefix}_#{System.unique_integer([:positive, :monotonic])}"
end
