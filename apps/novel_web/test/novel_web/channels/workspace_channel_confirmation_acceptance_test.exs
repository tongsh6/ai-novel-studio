defmodule NovelWeb.WorkspaceChannelConfirmationAcceptanceTest do
  @moduledoc """
  B71 P3：VS-00L §16.14 非采纳确认交接的 Channel 级验收补齐。

  只从当前真实入口 `WorkspaceChannel.handle_in("author_action", ...)` 进入，
  使用独立持久库/Sandbox；覆盖竞争、写失败、离线来源、re-gate、恢复/Why、
  源子身份、作者字节与调用/预算。不启动 GUI、不注册生产验收 provider。
  """

  use NovelPersistence.DataCase, async: false

  import Phoenix.ChannelTest

  alias NovelApplication.{
    AgentRunService,
    WorkService,
    WorkSessionService
  }

  alias NovelDomain.AuthorActionInput

  alias NovelPersistence.{
    AgentRunLog,
    InteractionLifecycle,
    ProviderRunLog,
    WorkSessionRepo
  }

  alias NovelPersistence.Schemas.AuthorActionReceipt
  alias NovelPersistence.TraceRepository
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint

  @author_text "给陆沉舟设计一个底层散修人物设定，保持为待采纳草稿。"

  setup do
    previous_persistence = Application.fetch_env(:novel_web, :persistence)
    previous_facts = Application.fetch_env(:novel_application, :agent_run_fact_persistence_enabled)

    Application.put_env(
      :novel_web,
      :persistence,
      Keyword.put(prior_persistence(previous_persistence), :inject_real_persistence, true)
    )

    Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, true)

    on_exit(fn ->
      restore_persistence(previous_persistence)
      restore_fact_persistence(previous_facts)
    end)

    {:ok, work} =
      WorkService.create(%{
        "title" => "B71 confirmation acceptance",
        "genre" => "赛博修仙",
        "core_selling_point" => "非采纳确认必须形成真实运行事实"
      })

    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)

    %{work: work, session_id: session_id}
  end

  # B 线红测：channel 级 receipt 预查 miss 时，第二次请求真实走到
  # `AuthorActionAdmission.admit_handoff/3` 的 duplicate 分类；该分支不得把首次
  # 已提交的作者决定结果再次广播到 topic（重传只回查同一 receipt/run，回放走 ack/join）。
  test "duplicate admission through confirmation handoff replays committed result via ack without republishing topic turn_result",
       ctx do
    socket = join_socket(ctx.work.id, ctx.session_id)
    source = seed_source(ctx.work.id, ctx.session_id, "dup-admission")
    action = Map.put(source.confirm, "source_turn_ref", source.turn_id)

    assert {:reply, {:ok, %{received: true}}, socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    NovelApplication.TestAgentRunCleanup.register_run(receipt.result["run_id"])
    decision_turn_id = receipt.result["turn_id"]

    # 首次受理必须广播本次提交的作者决定结果（前端首次渲染需要）。
    assert_receive %Phoenix.Socket.Broadcast{
                     event: "turn_result",
                     payload: %{"turn_id" => ^decision_turn_id}
                   },
                   10_000

    # 模拟「channel 级 receipt 预查 miss → admission 判 duplicate」的真实竞态窗口：
    # 关闭 web persistence 注入后，重传不再命中首次的持久预查，而是真实走到
    # `AuthorActionAdmission.admit_handoff/3` 的 duplicate 分类。
    Application.put_env(:novel_web, :persistence, inject_real_persistence: false)

    assert {:reply, {:ok, %{received: true, duplicate: true} = duplicate_ack}, _socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    # 重传回执仍回查同一 receipt/run：run 状态投影与已提交结果都在 ack facts 里。
    assert duplicate_ack.run_id == receipt.result["run_id"]
    assert duplicate_ack.agent_run_state.run_id == receipt.result["run_id"]

    assert Enum.any?(
             duplicate_ack.turn_results,
             &((&1[:turn_id] || &1["turn_id"]) == decision_turn_id)
           )

    # 关键断言：duplicate 分支不得再向 topic 广播已提交的 turn_result。
    refute_receive %Phoenix.Socket.Broadcast{event: "turn_result"}, 200

    assert Repo.aggregate(AuthorActionReceipt, :count, :behavior_ref) == 1

    # 重传也没有第二次执行：仍是同一个 child run 的唯一一次 Provider 调用。
    assert await_record_status_any(receipt.result["run_id"], ["completed", "cancelled", "failed"])
    assert length(ProviderRunLog.list_runs(receipt.result["run_id"])) == 1

    assert length(AgentRunLog.list_by_parent_turn(ctx.work.id, ctx.session_id, source.turn_id)) ==
             1
  end

  test "two channels confirming the same action admit one receipt and one run, and execute provider once",
       ctx do
    source = seed_source(ctx.work.id, ctx.session_id, "concurrent")
    action = action_params(source, "confirm_before_execute")
    socket_a = join_socket(ctx.work.id, ctx.session_id)
    socket_b = join_socket(ctx.work.id, ctx.session_id)

    assert socket_a.channel_pid != socket_b.channel_pid

    push_a = push(socket_a, "author_action", %{"action" => action})
    push_b = push(socket_b, "author_action", %{"action" => action})

    reply_a = assert_reply(push_a, _, _, 20_000)
    reply_b = assert_reply(push_b, _, _, 20_000)

    statuses = Enum.sort([reply_a.status, reply_b.status])
    assert statuses == [:ok, :ok]

    run_id_a = reply_a.payload.run_id
    run_id_b = reply_b.payload.run_id
    NovelApplication.TestAgentRunCleanup.register_run(run_id_a)
    assert run_id_a == run_id_b
    refute is_nil(run_id_a)

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    assert receipt.result["run_id"] == run_id_a
    assert Repo.aggregate(AuthorActionReceipt, :count, :behavior_ref) == 1

    assert [child_run] =
             AgentRunLog.list_by_parent_turn(ctx.work.id, ctx.session_id, source.turn_id)

    assert child_run.id == run_id_a

    state = await_terminal(run_id_a)
    assert state.run.status == :completed

    # 一次执行：仅首次受理启动的 child run 真正调用 Provider；duplicate 不得重跑。
    assert length(ProviderRunLog.list_runs(run_id_a)) == 1
    assert length(ProviderRunLog.list_usage_summaries(run_id_a)) == 1
  end

  test "confirm and reject racing on the same behavior: exactly one consumes it", ctx do
    source = seed_source(ctx.work.id, ctx.session_id, "opposite-race")
    socket_a = join_socket(ctx.work.id, ctx.session_id)
    socket_b = join_socket(ctx.work.id, ctx.session_id)

    push_a =
      push(socket_a, "author_action", %{
        "action" => action_params(source, "confirm_before_execute")
      })

    push_b =
      push(socket_b, "author_action", %{
        "action" => action_params(source, "reject_or_cancel_confirmation")
      })

    reply_a = assert_reply(push_a, _, _, 20_000)
    reply_b = assert_reply(push_b, _, _, 20_000)

    assert Enum.sort([reply_a.status, reply_b.status]) == [:error, :ok]

    error_reply = if reply_a.status == :error, do: reply_a, else: reply_b
    assert error_reply.payload.reason == :author_action_behavior_already_consumed

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    assert Repo.aggregate(AuthorActionReceipt, :count, :behavior_ref) == 1

    assert [child_run] =
             AgentRunLog.list_by_parent_turn(ctx.work.id, ctx.session_id, source.turn_id)

    child_run_id = receipt.result["run_id"]

    if receipt.action_type == "confirm_before_execute" do
      NovelApplication.TestAgentRunCleanup.register_run(child_run_id)
    end

    assert child_run.id == child_run_id

    assert await_record_status_any(child_run_id, ["completed", "cancelled", "failed"])

    decision = WorkSessionRepo.turn_result(ctx.work.id, receipt.result["turn_id"])
    [closure] = decision["behavior_state"]["history"]
    assert closure["behavior_id"] == source.behavior_id
    assert closure["resolution"]["ref"] =~ "behavior_resolution:"
    assert closure["resolution"]["status"] in ["resolved", "cancelled"]

    case receipt.action_type do
      "confirm_before_execute" ->
        assert closure["status"] == "RESOLVED"
        assert closure["resolution"]["status"] == "resolved"
        assert length(ProviderRunLog.list_runs(child_run_id)) == 1

      "reject_or_cancel_confirmation" ->
        assert closure["status"] == "CANCELLED"
        assert closure["resolution"]["status"] == "cancelled"
        assert ProviderRunLog.list_runs(child_run_id) == []
    end
  end

  test "receipt persistence failure publishes no success, starts no provider and leaves source untouched",
       ctx do
    source = seed_source(ctx.work.id, ctx.session_id, "receipt-write-fail")
    socket = join_socket(ctx.work.id, ctx.session_id)
    source_before = AgentRunLog.get_run(source.run_id)

    Repo.query!("""
    CREATE TRIGGER reject_confirmation_receipt_insert
    BEFORE INSERT ON author_action_receipts
    BEGIN SELECT RAISE(ABORT, 'injected confirmation receipt rejection'); END
    """)

    try do
      assert {:reply, {:error, %{reason: reason}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{"action" => action_params(source, "confirm_before_execute")},
                 socket
               )

      assert is_binary(reason)
      assert Repo.aggregate(AuthorActionReceipt, :count, :behavior_ref) == 0

      assert AgentRunLog.list_by_parent_turn(ctx.work.id, ctx.session_id, source.turn_id) == []

      source_after = AgentRunLog.get_run(source.run_id)
      assert source_after.status == source_before.status
      assert source_after.trigger == source_before.trigger

      refute_broadcast("action_result", _, 200)
      refute_broadcast("turn_result", _, 200)
      refute_push("agent_event", %{event_type: "run_started"}, 200)
    after
      Repo.query!("DROP TRIGGER reject_confirmation_receipt_insert")
    end
  end

  test "author-decision persistence failure rolls back receipt/child run/behavior close", ctx do
    socket = join_socket(ctx.work.id, ctx.session_id)
    sync_channel(socket)
    source = seed_source(ctx.work.id, ctx.session_id, "decision-write-fail")
    events_before = event_count()

    Repo.query!("""
    CREATE TRIGGER reject_confirmation_decision_insert
    BEFORE INSERT ON interactions
    BEGIN SELECT RAISE(ABORT, 'injected confirmation decision rejection'); END
    """)

    try do
      assert {:reply, {:error, %{reason: reason}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{"action" => action_params(source, "confirm_before_execute")},
                 socket
               )

      assert is_binary(reason)
      assert Repo.aggregate(AuthorActionReceipt, :count, :behavior_ref) == 0
      assert AgentRunLog.list_by_parent_turn(ctx.work.id, ctx.session_id, source.turn_id) == []
      assert event_count() == events_before

      source_after = AgentRunLog.get_run(source.run_id)
      assert source_after.status == "awaiting_author"
      refute get_in(source_after.trigger || %{}, ["handoff_reason"])

      refute_broadcast("action_result", _, 200)
      refute_broadcast("turn_result", _, 200)
    after
      Repo.query!("DROP TRIGGER reject_confirmation_decision_insert")
    end
  end

  test "offline non-terminal source is closed by the handoff transaction without replaying its model",
       ctx do
    socket = join_socket(ctx.work.id, ctx.session_id)
    sync_channel(socket)

    source =
      seed_source(ctx.work.id, ctx.session_id, "offline-running",
        source_run_status: "running",
        source_budget: %{"max_provider_calls" => 3},
        source_consumed_budget: %{"provider_calls" => 3}
      )

    assert {:reply, {:ok, %{received: true}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{"action" => action_params(source, "confirm_before_execute")},
               socket
             )

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    child_run_id = receipt.result["run_id"]
    NovelApplication.TestAgentRunCleanup.register_run(child_run_id)
    await_terminal(child_run_id)

    source_after = AgentRunLog.get_run(source.run_id)
    assert source_after.status == "completed"
    assert get_in(source_after.trigger, ["handoff", "reason"]) == "author_action_handoff"
    assert get_in(source_after.trigger, ["handoff", "successor_run_id"]) == child_run_id
    assert get_in(source_after.trigger, ["handoff", "receipt_id"]) == receipt.id

    # 离线源不重建旧模型执行：旧 run 上没有任何新的 Provider 调用。
    assert ProviderRunLog.list_runs(source.run_id) == []
    assert source_after.budget == %{"max_provider_calls" => 3}
    assert source_after.consumed_budget == %{"provider_calls" => 3}
  end

  test "already-terminal source is not rewritten by the handoff", ctx do
    socket = join_socket(ctx.work.id, ctx.session_id)
    sync_channel(socket)

    source =
      seed_source(ctx.work.id, ctx.session_id, "offline-terminal", source_run_status: "completed")

    source_before = AgentRunLog.get_run(source.run_id)

    assert {:reply, {:ok, %{received: true}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{"action" => action_params(source, "confirm_before_execute")},
               socket
             )

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    NovelApplication.TestAgentRunCleanup.register_run(receipt.result["run_id"])
    await_terminal(receipt.result["run_id"])

    source_after = AgentRunLog.get_run(source.run_id)
    assert source_after.status == "completed"
    assert source_after.trigger == source_before.trigger
    assert source_after.completed_at == source_before.completed_at
    assert ProviderRunLog.list_runs(source.run_id) == []
  end

  test "reject produces zero-provider decision result with queryable Why and real replay status",
       ctx do
    socket = join_socket(ctx.work.id, ctx.session_id)
    sync_channel(socket)
    source = seed_source(ctx.work.id, ctx.session_id, "reject-why")

    assert {:reply, {:ok, %{received: true}}, socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{"action" => action_params(source, "reject_or_cancel_confirmation")},
               socket
             )

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    child_run_id = receipt.result["run_id"]
    decision_turn_id = receipt.result["turn_id"]
    assert await_record_status(child_run_id, "cancelled")
    assert ProviderRunLog.list_runs(child_run_id) == []

    decision = WorkSessionRepo.turn_result(ctx.work.id, decision_turn_id)
    assert decision["status"] == "cancelled"
    assert decision["behavior_state"]["active"] == nil
    assert [%{"status" => "CANCELLED"}] = decision["behavior_state"]["history"]

    assert [trace] = TraceRepository.list_by_turn(decision_turn_id)
    assert trace.decision_type == "cancel_waiting"
    assert trace.turn_id == decision_turn_id
    assert trace.replay_policy == %{"use_recorded_frame" => true, "recall_provider" => false}

    # 重传回执反映真实运行状态（同一 receipt/run），不重放 Provider。
    socket = Phoenix.Socket.assign(socket, :action_idempotency_ledger, %{})

    assert {:reply, {:ok, %{received: true, duplicate: true} = duplicate_ack}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{"action" => action_params(source, "reject_or_cancel_confirmation")},
               socket
             )

    assert duplicate_ack.action_status == "cancelled"
    assert duplicate_ack.run_id == child_run_id
    assert Enum.any?(duplicate_ack.turn_results, &(payload_turn_id(&1) == decision_turn_id))
    assert ProviderRunLog.list_runs(child_run_id) == []
  end

  test "confirm decision records Why with zero provider call; creative result keeps real calls and independent budget",
       ctx do
    source =
      seed_source(ctx.work.id, ctx.session_id, "calls-budget",
        source_authority_scope: %{"production_write" => false, "allowed_tools" => []},
        source_budget: %{
          "max_provider_calls" => 1,
          "max_tool_calls" => 0,
          "max_steps" => 1
        },
        source_consumed_budget: %{"provider_calls" => 1, "tool_calls" => 0, "steps" => 1}
      )

    socket = join_socket(ctx.work.id, ctx.session_id)

    assert {:reply, {:ok, %{received: true}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{"action" => action_params(source, "confirm_before_execute")},
               socket
             )

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    child_run_id = receipt.result["run_id"]
    NovelApplication.TestAgentRunCleanup.register_run(child_run_id)
    decision_turn_id = receipt.result["turn_id"]
    state = await_terminal(child_run_id)

    # 确认子 run 独立授权/预算：不继承源 run 已耗尽的预算，也不扩张源 run 授权。
    assert state.run.budget.max_provider_calls >= 14
    assert state.run.consumed_budget.provider_calls >= 1
    assert state.run.authority_scope[:production_write] == false

    assert state.run.authority_scope[:allowed_tools] ==
             ~w(prose_writing plot_outline character_design character_evolution world_building text_analysis)

    source_after = AgentRunLog.get_run(source.run_id)

    assert source_after.budget == %{
             "max_provider_calls" => 1,
             "max_tool_calls" => 0,
             "max_steps" => 1
           }

    assert source_after.consumed_budget == %{
             "provider_calls" => 1,
             "tool_calls" => 0,
             "steps" => 1
           }

    # 决定 Why 本身零 Provider；真实调用属于后续创作 step，pcall/prun 成对可查。
    assert [decision_trace] = TraceRepository.list_by_turn(decision_turn_id)
    assert decision_trace.decision_type == "author_confirmed_action"

    assert decision_trace.replay_policy == %{
             "use_recorded_frame" => true,
             "recall_provider" => false
           }

    provider_runs = ProviderRunLog.list_runs(child_run_id)
    assert length(provider_runs) == 1

    [provider_run] = provider_runs
    assert is_binary(provider_run.provider_call_ref)
    assert String.starts_with?(provider_run.provider_call_ref, "pcall_")
    assert provider_run.status == "completed"
    assert provider_run.purpose == "tool"
    assert provider_run.step_id != decision_turn_id

    [usage] = ProviderRunLog.list_usage_summaries(child_run_id)
    assert usage.provider_call_ref == provider_run.provider_call_ref
    assert usage.provider_run_ref == provider_run.id
    assert usage.purpose == "tool"

    creative = await_creative_result(child_run_id, ctx.work.id, ctx.session_id)
    assert creative["trace_summary"]["writer_provider_call_ref"] == provider_run.provider_call_ref
    assert creative["truthfulness"]["tool_called"] == true
    assert creative["truthfulness"]["production_write_performed"] == false
  end

  test "source and child identity stay separate across receipt, run, turn and decision", ctx do
    socket = join_socket(ctx.work.id, ctx.session_id)
    sync_channel(socket)
    source = seed_source(ctx.work.id, ctx.session_id, "identity")

    assert {:reply, {:ok, ack}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{"action" => action_params(source, "confirm_before_execute")},
               socket
             )

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    child_run_id = receipt.result["run_id"]
    NovelApplication.TestAgentRunCleanup.register_run(child_run_id)
    decision_turn_id = receipt.result["turn_id"]
    await_terminal(child_run_id)

    refute child_run_id == source.run_id
    assert receipt.source_turn_ref == source.turn_id

    child_run = AgentRunLog.get_run(child_run_id)
    assert child_run.parent_turn_ref == source.turn_id
    assert child_run.trigger["source_turn_ref"] == source.turn_id

    source_run = AgentRunLog.get_run(source.run_id)
    assert get_in(source_run.trigger, ["handoff", "successor_run_id"]) == child_run_id

    committed = committed_turn_results(child_run_id, ctx.work.id, ctx.session_id)
    committed_ids = Enum.map(committed, &payload_turn_id/1)

    assert decision_turn_id in committed_ids

    creative = Enum.find(committed, &(payload_turn_id(&1) != decision_turn_id))
    refute is_nil(creative)
    assert creative["parent_turn_id"] == source.turn_id
    assert creative["source_turn_ref"] == source.turn_id
    refute creative["turn_id"] == decision_turn_id
    refute creative["turn_id"] == source.turn_id

    # 回执的 turn_id 只指向已提交子结果；source_turn_ref 始终指向源轮次。
    duplicate_replay = replay_ack(ctx.work.id, ctx.session_id, source, receipt)
    assert duplicate_replay.turn_id == decision_turn_id
    assert duplicate_replay.source_turn_ref == source.turn_id
    assert Enum.all?(duplicate_replay.turn_results, &(payload_turn_id(&1) in committed_ids))

    assert ack.turn_id == decision_turn_id
  end

  test "new IR only carries the source author bytes and application scope, never replays old assistant/tool",
       ctx do
    source = seed_source(ctx.work.id, ctx.session_id, "author-bytes")
    socket = join_socket(ctx.work.id, ctx.session_id)

    assert {:reply, {:ok, %{received: true}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{"action" => action_params(source, "confirm_before_execute")},
               socket
             )

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    child_run_id = receipt.result["run_id"]
    NovelApplication.TestAgentRunCleanup.register_run(child_run_id)
    await_terminal(child_run_id)

    messages = child_transcript_messages(child_run_id)

    author_texts =
      messages
      |> Enum.filter(&(&1.role == "user" and &1.provenance == "author"))
      |> Enum.flat_map(&text_blocks/1)

    assert author_texts == [@author_text]

    refute Enum.any?(author_texts, &String.contains?(&1, "应用层操作"))
    refute Enum.any?(author_texts, &String.contains?(&1, "确认执行"))
    refute Enum.any?(author_texts, &String.contains?(&1, "已确认"))

    # 旧 source assistant/tool 执行不得作为会话消息回放进新 IR（上下文材料里的
    # 作者可见近期对话属于本次 re-gate 的应用材料，不是回放的消息角色）。
    refute Enum.any?(messages, fn message ->
             message.role in ["assistant", "tool"] and
               Enum.any?(text_blocks(message), &String.contains?(&1, "需要作者确认后才能生成角色设定"))
           end)

    # 应用生成的 scope/goal 事实与作者原字节分离，作者原话逐字可追溯。
    scope_message =
      Enum.find(messages, fn message ->
        message.role == "scope_update" and
          Enum.any?(text_blocks(message), &String.contains?(&1, @author_text))
      end)

    assert scope_message
    assert scope_message.provenance == "application"

    child_run = AgentRunLog.get_run(child_run_id)
    assert child_run.goal["text"] =~ "应用层操作"
    refute child_run.goal["text"] == @author_text
  end

  test "reconnect join replays committed decision and creative results from persistence", ctx do
    source = seed_source(ctx.work.id, ctx.session_id, "join-replay")
    socket = join_socket(ctx.work.id, ctx.session_id)

    assert {:reply, {:ok, %{received: true}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{"action" => action_params(source, "confirm_before_execute")},
               socket
             )

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    child_run_id = receipt.result["run_id"]
    NovelApplication.TestAgentRunCleanup.register_run(child_run_id)
    await_terminal(child_run_id)

    creative = await_creative_result(child_run_id, ctx.work.id, ctx.session_id)
    reconnect = join_socket(ctx.work.id, ctx.session_id)

    restored = reconnect.assigns.turn_results_by_id
    assert Map.has_key?(restored, receipt.result["turn_id"])
    assert Map.has_key?(restored, creative["turn_id"])

    restored_list = reconnect.assigns.turn_results_list
    assert payload_turn_id(List.last(restored_list)) == creative["turn_id"]
  end

  test "child async result is delivered exactly once through the normal agent path", ctx do
    source = seed_source(ctx.work.id, ctx.session_id, "async-broadcast")
    socket = join_socket(ctx.work.id, ctx.session_id)

    push_ref =
      push(socket, "author_action", %{
        "action" => action_params(source, "confirm_before_execute")
      })

    assert_reply(push_ref, :ok, %{received: true}, 20_000)

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    child_run_id = receipt.result["run_id"]
    NovelApplication.TestAgentRunCleanup.register_run(child_run_id)
    decision_turn_id = receipt.result["turn_id"]
    await_terminal(child_run_id)

    creative = await_creative_result(child_run_id, ctx.work.id, ctx.session_id)

    # 作者决定结果走确认事务的业务广播；创作结果走 AgentRun 事件派生的 per-socket
    # push。ChannelTest 会把同一次业务广播同时投到测试进程的 Broadcast 与 transport
    # Message 邮箱，因此按来源分别计数，避免把测试 transport 的回声当成第二次投递。
    broadcasts = collect_turn_result_broadcasts(500)
    assert Enum.count(broadcasts, &(payload_turn_id(&1) == decision_turn_id)) == 1
    refute Enum.any?(broadcasts, &(payload_turn_id(&1) == creative["turn_id"]))

    pushes = collect_turn_result_pushes(500)
    assert Enum.count(pushes, &(payload_turn_id(&1) == creative["turn_id"])) == 1
  end

  # ── helpers ────────────────────────────────────────────────────────────────

  defp prior_persistence({:ok, value}), do: value
  defp prior_persistence(:error), do: []

  defp restore_persistence({:ok, value}),
    do: Application.put_env(:novel_web, :persistence, value)

  defp restore_persistence(:error), do: Application.delete_env(:novel_web, :persistence)

  defp restore_fact_persistence(:error),
    do: Application.delete_env(:novel_application, :agent_run_fact_persistence_enabled)

  defp restore_fact_persistence({:ok, value}),
    do: Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, value)

  defp join_socket(work_id, session_id) do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work_id}", %{
        "work_id" => work_id,
        "session_id" => session_id
      })

    NovelApplication.TestAgentRunCleanup.register_task_caller(socket.channel_pid)
    socket
  end

  defp seed_source(work_id, session_id, label, opts \\ []) do
    opts = Map.new(opts)
    unique = System.unique_integer([:positive])
    user_turn_id = "message_source_#{label}_#{unique}"
    turn_id = "#{user_turn_id}:agent:1"
    behavior_id = "bh_source_#{label}_#{unique}"
    run_id = "run_source_#{label}_#{unique}"

    plan = %{
      "plan_id" => "mp_source_#{label}_#{unique}",
      "turn_id" => turn_id,
      "frame_ref" => "frame_source_#{label}",
      "plan_goal" => %{"summary" => "生成角色设定"},
      "risk_hint" => "high",
      "requires_confirmation_hint" => false,
      "proposed_actions" => [
        %{
          "action_id" => "act_creative_#{label}_#{unique}",
          "action_type" => "capability_invocation",
          "summary" => "生成角色设定",
          "target_ref" => "character_design",
          "write_intent" => "tentative",
          "risk_hint" => "low"
        }
      ],
      "state_changes_requested" => [],
      "required_capabilities" => ["character_design"],
      "fallback_strategy" => %{"downgrade_message" => "fallback"},
      "stop_after_next_action" => true,
      "primary" => true,
      "schema_version" => "3.0-draft"
    }

    confirm = %{
      "action_id" => "act_confirm_#{label}_#{unique}",
      "action_type" => "confirm_before_execute",
      "behavior_ref" => behavior_id,
      "target_ref" => "character_design",
      "idempotency_key" => "confirm_#{label}_#{unique}",
      "trace_ref" => "decision_trace:#{turn_id}"
    }

    reject = %{
      "action_id" => "act_reject_#{label}_#{unique}",
      "action_type" => "reject_or_cancel_confirmation",
      "behavior_ref" => behavior_id,
      "target_ref" => "character_design",
      "idempotency_key" => "reject_#{label}_#{unique}",
      "trace_ref" => "decision_trace:#{turn_id}"
    }

    active = %{
      "behavior_id" => behavior_id,
      "behavior_type" => "confirmation",
      "blocking_actor" => "author",
      "opened_at_turn_ref" => turn_id,
      "opened_by_decision_ref" => "decision_source_#{label}_#{unique}",
      "frame_ref" => "frame_source_#{label}",
      "plan_ref" => plan["plan_id"],
      "target_ref" => "character_design",
      "required_next_action" => "confirm_before_execute",
      "available_actions" => [confirm, reject],
      "prompt_contract" => %{"question" => "确认生成角色设定？"},
      "constraints" => %{"risk" => "high"},
      "lifecycle_status" => "awaiting_author",
      "status" => "WAITING_USER"
    }

    behavior_history = Map.get(opts, :behavior_history, [])

    turn_result =
      Map.merge(
        %{
          "schema_version" => "3.0-draft",
          "turn_id" => turn_id,
          "frame_ref" => "frame_source_#{label}",
          "status" => "needs_confirmation",
          "phase" => "awaiting_author",
          "assistant_message" => %{"text" => "需要作者确认后才能生成角色设定。"},
          "available_actions" => [confirm, reject],
          "behavior_state" => %{"active" => active, "history" => behavior_history},
          "plan" => plan,
          "ui_cards" => [],
          "trace_summary" => %{
            "trace_ref" => "trace:#{turn_id}",
            "source_turn_ref" => user_turn_id,
            "decision_type" => "confirmation_required"
          }
        },
        Map.get(opts, :turn_result_overrides, %{})
      )

    source_status = Map.get(opts, :source_run_status, "awaiting_author")

    {:ok, _} =
      InteractionLifecycle.call(:receive, %{
        workspace_id: work_id,
        session_id: session_id,
        run_id: run_id,
        turn_id: user_turn_id,
        text: @author_text
      })

    {:ok, _} =
      AgentRunLog.upsert_run(%{
        id: run_id,
        workspace_id: work_id,
        work_id: work_id,
        session_id: session_id,
        parent_turn_ref: user_turn_id,
        origin_frame_ref: "frame_source_#{label}",
        run_mode: "bounded",
        profile_ref: "prose_drafting_with_quality_v1",
        status: source_status,
        phase: "stopped",
        goal: %{"text" => @author_text, "version" => 1},
        trigger: %{"kind" => "user_message"},
        plan: plan,
        plan_ref: plan["plan_id"],
        plan_version: 1,
        authority_scope: Map.get(opts, :source_authority_scope, %{}),
        run_policy: %{},
        budget: Map.get(opts, :source_budget, %{}),
        consumed_budget: Map.get(opts, :source_consumed_budget, %{})
      })

    {:ok, _} =
      InteractionLifecycle.call(:result, %{
        workspace_id: work_id,
        session_id: session_id,
        run_id: run_id,
        turn_result: turn_result
      })

    %{
      run_id: run_id,
      turn_id: turn_id,
      user_turn_id: user_turn_id,
      behavior_id: behavior_id,
      plan: plan,
      confirm: confirm,
      reject: reject
    }
  end

  defp action_params(source, "confirm_before_execute"),
    do: Map.put(source.confirm, "source_turn_ref", source.turn_id)

  defp action_params(source, "reject_or_cancel_confirmation"),
    do: Map.put(source.reject, "source_turn_ref", source.turn_id)

  defp payload_turn_id(payload), do: payload[:turn_id] || payload["turn_id"]

  defp await_terminal(run_id, attempts \\ 200)

  defp await_terminal(run_id, attempts) when attempts > 0 do
    case AgentRunService.state(run_id) do
      {:ok, %{run: %{status: status}} = state} when status in [:completed, :cancelled, :failed] ->
        state

      _ ->
        Process.sleep(25)
        await_terminal(run_id, attempts - 1)
    end
  end

  defp await_terminal(_run_id, 0), do: flunk("child run did not reach terminal state")

  # join 后的恢复扫描（runtime-lost 收口）在 channel 进程内异步执行；用 :sys.get_state
  # 作为消息顺序屏障，确保先把 seed 前的恢复扫描收口，再构造离线 source 场景。
  defp sync_channel(socket) do
    _ = :sys.get_state(socket.channel_pid)
    :ok
  end

  defp await_record_status(run_id, expected, attempts \\ 200)

  defp await_record_status(run_id, expected, attempts) when attempts > 0 do
    case AgentRunLog.get_run(run_id) do
      %{status: ^expected} ->
        true

      _ ->
        Process.sleep(25)
        await_record_status(run_id, expected, attempts - 1)
    end
  end

  defp await_record_status(_run_id, expected, 0),
    do: flunk("run record never reached #{expected}")

  defp await_record_status_any(run_id, expected_statuses, attempts \\ 200)

  defp await_record_status_any(run_id, expected_statuses, attempts) when attempts > 0 do
    case AgentRunLog.get_run(run_id) do
      %{status: status} ->
        if status in expected_statuses do
          true
        else
          Process.sleep(25)
          await_record_status_any(run_id, expected_statuses, attempts - 1)
        end

      _ ->
        Process.sleep(25)
        await_record_status_any(run_id, expected_statuses, attempts - 1)
    end
  end

  defp await_record_status_any(_run_id, expected_statuses, 0),
    do: flunk("run record never reached one of #{inspect(expected_statuses)}")

  defp event_count do
    Repo.aggregate(NovelPersistence.Schemas.AgentEventRecord, :count, :id)
  end

  defp committed_turn_results(run_id, work_id, session_id) do
    work_id
    |> WorkSessionRepo.assistant_entries_by_run(session_id, run_id)
    |> Enum.map(& &1.content["turn_result"])
    |> Enum.reject(&is_nil/1)
  end

  defp await_creative_result(run_id, work_id, session_id, attempts \\ 200)

  defp await_creative_result(_run_id, _work_id, _session_id, 0),
    do: flunk("child creative result missing")

  defp await_creative_result(run_id, work_id, session_id, attempts) do
    result =
      committed_turn_results(run_id, work_id, session_id)
      |> Enum.find(&get_in(&1, ["trace_summary", "confirmation_binding"]))

    if result do
      result
    else
      Process.sleep(25)
      await_creative_result(run_id, work_id, session_id, attempts - 1)
    end
  end

  defp replay_ack(work_id, session_id, source, receipt) do
    input = %AuthorActionInput{
      input_id: receipt.id,
      source_turn_ref: source.turn_id,
      action_id: source.confirm["action_id"],
      action_type: "confirm_before_execute",
      target_ref: source.confirm["target_ref"],
      behavior_ref: source.behavior_id,
      idempotency_key: source.confirm["idempotency_key"]
    }

    {:duplicate, entry} =
      NovelApplication.ActionIdempotencyService.project(receipt, input, %{
        work_id: work_id,
        session_id: session_id
      })

    %{
      turn_id: entry.result.turn_id,
      source_turn_ref: entry.result.source_turn_ref,
      turn_results: entry.turn_results
    }
  end

  defp child_transcript_messages(run_id) do
    run = AgentRunLog.get_run(run_id)
    {:ok, transcript, :session_segment} = NovelApplication.AuthoringCheckpoint.restore(run, nil)
    transcript.messages
  end

  defp text_blocks(message) do
    message.blocks
    |> Enum.filter(&(&1.type == "text"))
    |> Enum.map(& &1.text)
  end

  defp collect_turn_result_broadcasts(timeout) do
    collect_turn_result_broadcasts([], timeout)
  end

  defp collect_turn_result_broadcasts(acc, timeout) do
    receive do
      %Phoenix.Socket.Broadcast{event: "turn_result", payload: payload} ->
        collect_turn_result_broadcasts([payload | acc], timeout)
    after
      timeout -> Enum.reverse(acc)
    end
  end

  defp collect_turn_result_pushes(timeout) do
    collect_turn_result_pushes([], timeout)
  end

  defp collect_turn_result_pushes(acc, timeout) do
    receive do
      %Phoenix.Socket.Message{event: "turn_result", payload: payload} ->
        collect_turn_result_pushes([payload | acc], timeout)
    after
      timeout -> Enum.reverse(acc)
    end
  end
end
