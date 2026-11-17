defmodule NovelApplication.AutoMaintenanceTest do
  @moduledoc """
  B71 安全点自动维护（VS-00L §16.16 第 2 类入口；§18 a–h）。

  覆盖：真实 usage 压力下安全点自动整理更早的已完成交换（事件 + checkpoint 同边界，
  原文保留）；阈值未到/usage 未知/当前工作回合/配置关闭 不触发；保留最近 K 项；
  未完成交换不压缩；幂等；失败保留原文且同源不重发；事件 payload 无技术词。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.{Execution, RuntimeConfig}
  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelApplication.AgentRunService
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelApplication.WorkSessionService
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.AgentNextStepDecision
  alias NovelPersistence.AgentRunLog
  alias NovelPersistence.InteractionLifecycle
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.ProviderOutputRecord
  alias NovelPersistence.Schemas.ProviderRunRecord
  alias NovelPersistence.WorkRepo
  alias NovelPersistence.WorkSessionRepo

  @provider "stub"
  # 测试替身不是供应商事实，不在窗口表内；未知 provider 用保守窗口 32k 兜底。
  # 24k tokens = 75%，越过维护线（0.70）。
  @due_tokens 24_000
  @low_tokens 5_000

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})

    on_exit(fn ->
      Application.delete_env(:novel_application, :auto_maintenance)
      Application.delete_env(:novel_application, :context_window_overrides)
    end)

    enable_auto_maintenance()
    :ok
  end

  test "T1：真实压力下安全点自动整理更早交换并投影作者安全记录" do
    run_id = unique_run_id()
    transcript = multi_turn_transcript(run_id, earlier: 5, current: 1)

    insert_provider_usage(run_id, @due_tokens)
    assert {:ok, ^run_id} = start_run(run_id, [step_with_transcript(transcript)])
    wait_until(fn -> terminal_run?(run_id) end, 5_000)

    assert [record] = checkpoint_events(run_id)
    assert record.visibility == "author"
    assert record.payload["covered_counts"]["tool_exchanges"] == 2
    assert record.payload["retained_items"] == 4
    assert record.payload["scope"] == "earlier_work_turns"
    assert record.payload["sources"] == []

    payload_text = inspect(record.payload)
    refute payload_text =~ "token"
    refute payload_text =~ "call-"
    refute Enum.any?(Map.values(record.payload), &(is_binary(&1) and &1 =~ "%"))

    run = AgentRunLog.get_run(run_id)
    restored = TestAgenticLoopFixtures.persisted_transcript(run)
    assert Enum.any?(restored.messages, &(&1.role == "checkpoint"))
    # 原文保留：被整理 exchange 的 observation 仍在 canonical 记录中。
    assert inspect(restored.messages) =~ "call-1"
    assert {:ok, _state} = AgentRunService.state(run_id)
  end

  test "T2b：跨 run 会话历史在安全点被维护（checkpoint covers 更早 run 的交换）" do
    # 更早 run 的 canonical 历史直接播种到会话存储（不启动执行）。
    prior_id = unique_run_id()
    prior = multi_turn_transcript(prior_id, earlier: 5, current: 0, second_turn: false)
    assert :ok = TestAgenticLoopFixtures.append_segment!(prior, status: "completed")

    run_id = unique_run_id()

    transcript =
      AuthoringTranscript.new(transcript_identity(run_id),
        base_text: "作者保留最终裁决",
        author_text: "第二轮",
        author_turn_ref: "input:maintenance-second:#{run_id}"
      )
      |> AuthoringTranscript.append_author_turn("继续。", "author_turn:turn-2b")

    insert_provider_usage(run_id, @due_tokens)
    parent = self()

    next_step = fn _run, _sequence, snapshot ->
      request = AuthoringSession.request_ir(snapshot)
      send(parent, {:professional_request, Projection.project(request, "chat_completions")})
      {:ok, %{stage_state: AuthoringSession.provider_metadata(%{request_ir: request})}}
    end

    assert {:ok, ^run_id} = start_run(run_id, [step_with_transcript(transcript), next_step])
    assert_receive {:professional_request, {:ok, %{messages: wire_messages}}}, 2_000

    assert Enum.any?(wire_messages, &(Map.get(&1, :content) == "第一回合"))
    assert Enum.any?(wire_messages, &(&1.role == "tool" and &1.tool_call_id == "call-2"))
    refute Enum.any?(wire_messages, &(&1.role == "tool" and &1.tool_call_id == "call-1"))
    wait_until(fn -> terminal_run?(run_id) end, 5_000)

    assert [record] = checkpoint_events(run_id)

    # 会话视图：prior 5 个已完成交换在更早回合，keep=4 → 只整理最早 1 个。
    assert record.payload["covered_counts"]["tool_exchanges"] == 1

    persisted = TestAgenticLoopFixtures.persisted_transcript(run_id)
    checkpoint = Enum.find(persisted.messages, &(&1.role == "checkpoint"))
    assert checkpoint
    assert checkpoint.blocks |> hd() |> Map.get(:covers) |> Map.get(:call_ids) == ["call-1"]
    assert Enum.reject(persisted.messages, &(&1.role == "checkpoint")) == transcript.messages
    assert persisted.call_ids == []
  end

  test "T3：压力未到维护线时不触发" do
    run_id = unique_run_id()
    transcript = multi_turn_transcript(run_id, earlier: 5, current: 1)

    insert_provider_usage(run_id, @low_tokens)
    assert {:ok, ^run_id} = start_run(run_id, [step_with_transcript(transcript)])
    wait_until(fn -> terminal_run?(run_id) end, 5_000)

    assert checkpoint_events(run_id) == []
    assert_no_checkpoint(run_id)
  end

  test "T4：usage 未知时不猜测、不触发" do
    run_id = unique_run_id()
    transcript = multi_turn_transcript(run_id, earlier: 5, current: 1)

    assert {:ok, ^run_id} = start_run(run_id, [step_with_transcript(transcript)])
    wait_until(fn -> terminal_run?(run_id) end, 5_000)

    assert checkpoint_events(run_id) == []
  end

  test "T5：只有当前工作回合时不整理" do
    run_id = unique_run_id()
    transcript = multi_turn_transcript(run_id, earlier: 1, current: 1, second_turn: false)

    insert_provider_usage(run_id, @due_tokens)
    assert {:ok, ^run_id} = start_run(run_id, [step_with_transcript(transcript)])
    wait_until(fn -> terminal_run?(run_id) end, 5_000)

    assert checkpoint_events(run_id) == []
  end

  test "T6：保留最近 K 项（K=2），只整理更早的已完成交换" do
    Application.put_env(:novel_application, :auto_maintenance, %{
      enabled: true,
      keep_recent_items: 2
    })

    run_id = unique_run_id()
    transcript = multi_turn_transcript(run_id, earlier: 5, current: 1)

    insert_provider_usage(run_id, @due_tokens)
    assert {:ok, ^run_id} = start_run(run_id, [step_with_transcript(transcript)])
    wait_until(fn -> terminal_run?(run_id) end, 5_000)

    assert [record] = checkpoint_events(run_id)
    assert record.payload["covered_counts"]["tool_exchanges"] == 4
    assert record.payload["retained_items"] == 2
  end

  test "T7：未完成交换不计入整理范围" do
    run_id = unique_run_id()
    transcript = multi_turn_transcript(run_id, earlier: 5, current: 1, pending_exchange: true)

    insert_provider_usage(run_id, @due_tokens)
    assert {:ok, ^run_id} = start_run(run_id, [step_with_transcript(transcript)])
    wait_until(fn -> terminal_run?(run_id) end, 5_000)

    assert [record] = checkpoint_events(run_id)

    # 当前完整交换计入全会话最近 4 项；更早 5 项整理最旧 2 项，未完成交换不选。
    assert record.payload["covered_counts"]["tool_exchanges"] == 2

    run = AgentRunLog.get_run(run_id)
    restored = TestAgenticLoopFixtures.persisted_transcript(run)

    assert Enum.any?(restored.messages, fn message ->
             Enum.any?(message.blocks, &(Map.get(&1, :call_id) == "call-pending"))
           end)
  end

  test "T8：test 环境默认关闭时不触发（即使压力已到）" do
    Application.put_env(:novel_application, :auto_maintenance, %{enabled: false})
    run_id = unique_run_id()
    transcript = multi_turn_transcript(run_id, earlier: 5, current: 1)

    insert_provider_usage(run_id, @due_tokens)
    assert {:ok, ^run_id} = start_run(run_id, [step_with_transcript(transcript)])
    wait_until(fn -> terminal_run?(run_id) end, 5_000)

    assert checkpoint_events(run_id) == []
  end

  test "T9：同批交换幂等，后续安全点不重复插入" do
    run_id = unique_run_id()
    transcript = multi_turn_transcript(run_id, earlier: 5, current: 1)

    insert_provider_usage(run_id, @due_tokens)

    assert {:ok, ^run_id} =
             start_run(run_id, [step_with_transcript(transcript), plain_step()])

    wait_until(fn -> terminal_run?(run_id) end, 5_000)

    assert [record] = checkpoint_events(run_id)
    assert record.payload["covered_counts"]["tool_exchanges"] == 2
    run = AgentRunLog.get_run(run_id)
    restored = TestAgenticLoopFixtures.persisted_transcript(run)
    assert Enum.count(restored.messages, &(&1.role == "checkpoint")) == 1
  end

  test "T10：持久失败静默、不推进内存，下一安全点重试成功" do
    run_id = unique_run_id()
    transcript = multi_turn_transcript(run_id, earlier: 5, current: 1)
    parent = self()

    insert_provider_usage(run_id, @due_tokens)

    # 只让整理记录事件写入失败（维护提交含 agent_events INSERT）；普通 step delivery
    # 不写事件/不写会话 canonical，保持成功，从而隔离出维护失败路径。
    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_b71_auto_maintenance BEFORE INSERT ON agent_events
    WHEN NEW.event_type = 'checkpoint_created'
    BEGIN SELECT RAISE(ABORT, 'maintenance unavailable'); END
    """)

    try do
      assert {:ok, ^run_id} =
               start_run(run_id, [step_with_transcript(transcript), gated_step(parent)])

      # 第一步完成后的安全点维护失败：静默、无事件、run 继续进入第二步。
      assert_receive {__MODULE__, :step_two_waiting, step_two_pid}, 5_000
      assert checkpoint_events(run_id) == []
      assert {:ok, %{run: %{status: :running}}} = AgentRunService.state(run_id)

      SQL.query!(Repo, "DROP TRIGGER reject_b71_auto_maintenance")
      send(step_two_pid, :continue)

      # 第二步完成后的下一安全点重试成功。
      wait_until(fn -> terminal_run?(run_id) end, 5_000)
      assert [record] = checkpoint_events(run_id)
      assert record.payload["covered_counts"]["tool_exchanges"] == 2
    after
      SQL.query(Repo, "DROP TRIGGER IF EXISTS reject_b71_auto_maintenance")
    end
  end

  test "T11：整理记录 payload 只含作者安全事实" do
    run_id = unique_run_id()
    transcript = multi_turn_transcript(run_id, earlier: 5, current: 1)

    insert_provider_usage(run_id, @due_tokens)
    assert {:ok, ^run_id} = start_run(run_id, [step_with_transcript(transcript)])
    wait_until(fn -> terminal_run?(run_id) end, 5_000)

    assert [record] = checkpoint_events(run_id)

    assert record.payload |> Map.keys() |> Enum.sort() == [
             "covered_counts",
             "history_target",
             "retained_items",
             "scope",
             "sources"
           ]

    assert record.reason_codes == ["transcript_compaction"]
    assert record.summary == "较早的 2 项创作过程已整理"
  end

  test "T12：取消请求后的迟到结果不触发维护" do
    run_id = unique_run_id()
    parent = self()

    insert_provider_usage(run_id, @due_tokens)
    assert {:ok, ^run_id} = start_run(run_id, [gated_step(parent)])

    assert_receive {__MODULE__, :step_two_waiting, step_pid}, 5_000
    assert :ok = AgentRunService.cancel(run_id)
    send(step_pid, :continue)

    wait_until(fn -> terminal_run?(run_id) end, 5_000)
    assert checkpoint_events(run_id) == []
  end

  for action <- [:complete, :cancel] do
    @finish_action action
    test "业务回应已交付而摘要在途，运行仍可取消；随后 #{@finish_action} 才进入真实终态" do
      parent = self()
      dependency = gated_reply_execution(parent)
      input = reply_input()
      enable_auto_maintenance(keep_recent_items: 0)

      {:ok, spec} =
        NovelApplication.DialoguePlanningService.plan_agent_run(input, nil, dependency)

      prior =
        AuthoringTranscript.new(
          %{spec.run_attrs | run_id: spec.run_id <> "-prior", parent_turn_ref: "turn-prior"},
          base_text: "作者保留最终裁决",
          author_text: "先讨论方向。",
          author_turn_ref: "turn-prior"
        )
        |> AuthoringTranscript.append_assistant("早期建议。稍后我会确认动机。", [])

      :ok = TestAgenticLoopFixtures.append_segment!(prior, status: "completed")

      observe = fn event ->
        send(
          parent,
          {:reply_event, event, MemoryLog.transcript(input.session_id),
           AgentRunLog.get_run(spec.run_id)}
        )
      end

      assert {:ok, run_id} =
               AgentRunService.start_bounded(
                 NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, observe),
                 next_step_planner: spec.next_step_planner,
                 provider_execution: dependency,
                 interaction_input: spec.interaction_input,
                 interaction_store: &InteractionLifecycle.call/2
               )

      NovelApplication.TestAgentRunCleanup.register_run(run_id)

      assert_receive {:reply_event,
                      %{event_type: :turn_result_ready, payload: %{turn_result: reply}} = event,
                      rows, persisted},
                     2_000

      assert NovelApplication.ContextPressure.maintenance_due?(run_id),
             inspect(NovelPersistence.ProviderRunLog.list_usage_summaries(run_id))

      assert_receive {:summary_waiting, worker}, 2_000

      try do
        assert {:ok, %{run: active, current_task?: true}} = AgentRunService.state(run_id)
        assert active.status == :running
        assert persisted.status == "running"
        assert reply.assistant_message.text == "业务回应已经生成，未决动机仍保留。"
        assert reply.agent_run.status == :running
        assert Atom.to_string(reply.agent_run.phase) == persisted.phase
        assistant = Enum.find(rows, &(&1.role == "assistant"))
        assert assistant.content["turn_result"]["agent_run"]["status"] == "running"

        if @finish_action == :cancel do
          assert :ok = AgentRunService.cancel(run_id)

          assert {:ok, %{run: %{status: :cancelling}, current_task?: true}} =
                   AgentRunService.state(run_id)
        end

        send(worker, :release_summary)
        expected = if @finish_action == :cancel, do: :cancelled, else: :completed
        terminal_event = if @finish_action == :cancel, do: :run_cancelled, else: :run_completed
        assert_receive {:reply_event, %{event_type: ^terminal_event}, _, _}, 2_000
        assert {:ok, %{run: %{status: ^expected}} = settled} = AgentRunService.state(run_id)
        assert Enum.find(settled.events, &(&1.event_id == event.event_id)) == event
        assert settled.final_turn_result == reply
        historical = Enum.find(MemoryLog.transcript(input.session_id), &(&1.id == assistant.id))
        assert historical.content["turn_result"]["agent_run"]["status"] == "running"
        assert {:ok, page} = WorkSessionService.transcript_page(input.work_id, input.session_id)
        restored = Enum.find(page.transcript, &(&1.role == "assistant"))
        assert restored.turn_result.agent_run.status == Atom.to_string(expected)

        assert TestAgenticLoopFixtures.persisted_transcript(prior.run.run_id).messages ==
                 prior.messages
      after
        send(worker, :release_summary)
      end
    end
  end

  test "最终运行摘要二次写失败回滚整个交付，不发布预测终态" do
    input = reply_input()
    parent = self()
    run_id = unique_run_id()

    attrs =
      Map.merge(base_run(run_id), Map.take(input, [:work_id, :workspace_id, :session_id]))
      |> Map.put(:parent_turn_ref, input.turn_id)
      |> Map.put(:trigger, %{kind: "user_message"})

    store = fn operation, payload ->
      if operation == :result do
        result = payload.turn_result |> Jason.encode!() |> Jason.decode!()
        send(parent, {:result_attempt, result["agent_run"]["status"]})
      end

      InteractionLifecycle.call(operation, payload)
    end

    step = fn run, sequence ->
      {:ok,
       %{
         turn_result: %{
           turn_id: run.parent_turn_ref,
           assistant_message: %{text: "不能发布的业务结果"},
           agent_run: %{run_id: run.run_id, status: :completed}
         },
         loop_status: :completed,
         loop_decision: complete_decision(run, sequence)
       }}
    end

    planner = fn run, sequence, _ ->
      {:execute, step, execute_decision(run, sequence), %{provider_call_count: 0}}
    end

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_final_run_summary BEFORE UPDATE OF content ON interactions
    WHEN OLD.role = 'assistant'
      AND json_extract(OLD.content, '$.turn_result.agent_run.status') = 'running'
      AND json_extract(NEW.content, '$.turn_result.agent_run.status') = 'completed'
    BEGIN SELECT RAISE(ABORT, 'final run summary unavailable'); END
    """)

    try do
      assert {:ok, ^run_id} =
               AgentRunService.start_bounded(
                 NovelApplication.TestAgentEventRelay.observe(attrs, event_forward(parent)),
                 next_step_planner: planner,
                 interaction_input: %{text: input.text},
                 interaction_store: store
               )

      NovelApplication.TestAgentRunCleanup.register_run(run_id)
      wait_until(fn -> terminal_run?(run_id) end, 2_000)
      assert_receive {:result_attempt, "running"}
      assert_receive {:result_attempt, "completed"}
      assert AgentRunLog.get_run(run_id).status == "failed"
      refute_receive {:agent_event, :turn_result_ready, _}
      refute_receive {:agent_event, :run_completed, _}

      refute Enum.any?(
               MemoryLog.transcript(input.session_id),
               &(&1.content["text"] == "不能发布的业务结果")
             )

      refute Enum.any?(
               AgentRunLog.list_author_events(run_id),
               &(&1.event_type in ["turn_result_ready", "run_completed"])
             )
    after
      SQL.query!(Repo, "DROP TRIGGER reject_final_run_summary")
    end
  end

  # ── run 构造 ───────────────────────────────────────────────────────────

  defp start_run(run_id, steps) do
    planner = fn run, sequence, _snapshot ->
      case Enum.at(steps, sequence - 1) do
        nil ->
          {:complete, complete_decision(run, sequence), %{provider_call_count: 0}}

        step ->
          {:execute, step, execute_decision(run, sequence), %{provider_call_count: 0}}
      end
    end

    case AgentRunService.start_bounded(
           NovelApplication.TestAgentEventRelay.observe(base_run(run_id), event_forward(self())),
           next_step_planner: planner
         ) do
      {:ok, started_id} = ok ->
        _run_pid = NovelApplication.TestAgentRunCleanup.register_run(started_id)
        ok

      other ->
        other
    end
  end

  defp step_with_transcript(transcript) do
    fn _run, _sequence -> {:ok, %{stage_state: %{judgment_transcript: transcript}}} end
  end

  defp plain_step do
    fn _run, _sequence -> {:ok, %{}} end
  end

  defp gated_step(parent) do
    fn _run, _sequence ->
      send(parent, {__MODULE__, :step_two_waiting, self()})

      receive do
        :continue -> :ok
      after
        5_000 -> :ok
      end

      {:ok, %{}}
    end
  end

  # ── 断言/等待 helper ───────────────────────────────────────────────────

  defp checkpoint_events(run_id) do
    run_id
    |> AgentRunLog.list_author_events()
    |> Enum.filter(&(&1.event_type == "checkpoint_created"))
  end

  defp assert_no_checkpoint(run_id) do
    run = AgentRunLog.get_run(run_id)
    restored = TestAgenticLoopFixtures.persisted_transcript(run)
    refute Enum.any?(restored.messages, &(&1.role == "checkpoint"))
  end

  defp terminal_run?(run_id) do
    case AgentRunService.state(run_id) do
      {:ok, %{run: %{status: status}}} -> status in [:completed, :failed, :cancelled]
      _ -> false
    end
  end

  defp wait_until(fun, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_wait_until(fun, deadline)
  end

  defp do_wait_until(fun, deadline) do
    if fun.() do
      true
    else
      if System.monotonic_time(:millisecond) >= deadline do
        flunk("condition was not met before timeout")
      else
        Process.sleep(10)
        do_wait_until(fun, deadline)
      end
    end
  end

  # ── fixture ────────────────────────────────────────────────────────────

  defp multi_turn_transcript(run_id, opts) do
    earlier = Keyword.get(opts, :earlier, 5)
    current = Keyword.get(opts, :current, 1)
    second_turn? = Keyword.get(opts, :second_turn, true)
    pending_exchange? = Keyword.get(opts, :pending_exchange, false)

    transcript =
      AuthoringTranscript.new(transcript_identity(run_id),
        base_text: "作者保留最终裁决",
        author_text: "第一回合",
        author_turn_ref: "input:maintenance-first:#{run_id}"
      )
      |> append_completed_exchanges(1, earlier)

    transcript =
      if second_turn? do
        transcript
        |> AuthoringTranscript.append_author_turn("继续。", "author_turn:turn-2")
        |> append_completed_exchanges(earlier + 1, current)
      else
        transcript
      end

    if pending_exchange? do
      AuthoringTranscript.append_assistant(transcript, "", [
        RequestIR.tool_call_block("read_character", %{}, "call-pending")
      ])
    else
      transcript
    end
  end

  defp append_completed_exchanges(transcript, from, count) when is_integer(count) do
    if count <= 0 do
      transcript
    else
      Enum.reduce(from..(from + count - 1), transcript, fn index, acc ->
        call_id = "call-#{index}"

        acc
        |> AuthoringTranscript.append_assistant("", [
          RequestIR.tool_call_block("read_character", %{}, call_id)
        ])
        |> AuthoringTranscript.append_observation(call_id, %{
          status: "ok",
          source_refs: [],
          content: %{summary: "已读取角色"}
        })
      end)
    end
  end

  defp insert_provider_usage(run_id, tokens) do
    run_ref = "prun_#{System.unique_integer([:positive, :monotonic])}"
    call_ref = "pcall_#{System.unique_integer([:positive, :monotonic])}"
    now = DateTime.utc_now()

    Repo.insert!(%ProviderRunRecord{
      id: run_ref,
      provider_call_ref: call_ref,
      agent_run_id: run_id,
      purpose: "writer",
      execution_mode: "event_stream",
      status: "completed",
      provider_id: @provider,
      model: "stub-model",
      started_at: now,
      completed_at: now
    })

    Repo.insert!(%ProviderOutputRecord{
      provider_run_id: run_ref,
      provider_call_ref: call_ref,
      agent_run_id: run_id,
      status: "ok",
      output_type: "text",
      usage: %{"input_tokens" => tokens, "output_tokens" => 120}
    })

    :ok
  end

  defp enable_auto_maintenance(opts \\ []) do
    Application.put_env(:novel_application, :auto_maintenance, %{
      enabled: true,
      keep_recent_items: Keyword.get(opts, :keep_recent_items, 4)
    })
  end

  defp execute_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_auto_maintenance",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :execute_step,
        summary: "执行测试步骤 #{sequence}。",
        target_tool_ref: run.authority_scope.allowed_tools |> List.first(),
        write_intent: :none,
        risk_hint: :low,
        reason_codes: ["auto_maintenance_test_step"]
      })

    decision
  end

  defp complete_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_auto_maintenance_complete",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "测试 AgentRun 已完成。",
        reason_codes: ["auto_maintenance_test_complete"]
      })

    decision
  end

  defp transcript_identity(run_id) do
    %{
      run_id: run_id,
      workspace_id: "ws_1",
      work_id: "work_1",
      session_id: "sess_1",
      parent_turn_ref: "turn_1"
    }
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

  defp event_forward(parent) do
    fn event -> send(parent, {:agent_event, event.event_type, event.summary}) end
  end

  defp reply_input do
    {:ok, work} = WorkRepo.create(%{title: "业务回应与运行状态"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})

    %{
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      turn_id: "reply-#{System.unique_integer([:positive])}",
      text: "继续讨论，不要写正文。"
    }
  end

  defp gated_reply_execution(parent) do
    prior = RuntimeConfig.provider_config(:strata)
    on_exit(fn -> RuntimeConfig.put_provider_config(:strata, prior) end)

    summary =
      Jason.encode!(%{
        version: "authoring-discussion-summary/v2",
        entries: [
          %{source_index: 0, summary: "早期AI提出建议，动机待确认。", retained_fragment_indices: [0]}
        ]
      })

    stream = fn _url, body, _options, emit ->
      text =
        if Jason.encode!(body.messages) =~ "quoted_discussion_sources" do
          send(parent, {:summary_waiting, self()})

          receive do
            :release_summary -> summary
          after
            5_000 -> flunk("summary barrier was not released")
          end
        else
          "业务回应已经生成，未决动机仍保留。"
        end

      emit.(
        "data: " <>
          Jason.encode!(%{
            model: body.model,
            choices: [%{delta: %{content: text}}],
            usage: %{prompt_tokens: @due_tokens, completion_tokens: 20}
          }) <> "\n\n"
      )

      emit.("data: [DONE]\n\n")
      {:ok, 200, ""}
    end

    RuntimeConfig.put_provider_config(:strata,
      endpoint: "http://summary-state.test/v1",
      model: "reply-state-test",
      eventsource_fn: stream,
      log_fn: nil
    )

    Execution.dependency(provider: :strata)
  end

  defp unique_run_id do
    "run_auto_maintenance_#{System.unique_integer([:positive, :monotonic])}"
  end
end
