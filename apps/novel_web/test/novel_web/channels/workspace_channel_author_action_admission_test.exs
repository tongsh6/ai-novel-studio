defmodule NovelWeb.AuthorActionAdmissionTestProvider do
  @moduledoc false
  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.Stub
  alias NovelCommon.RequestIR

  defstruct []

  @impl true
  def name, do: "admission_test"

  @impl true
  def health_check(_state), do: :ok

  # 测试 provider 自己声明能力事实，委托 Stub 的确定性输出；不要求生产 registry
  # 为 fake 注册兜底，也不把测试替身伪装成「未声明能力」而被 Gateway 门槛拒绝。
  @impl true
  def capabilities(_state),
    do: Map.new(RequestIR.required_capabilities(), &{&1, true})

  @impl true
  def projection_target(_state), do: "chat_completions"

  @impl true
  def execute(_state, _model, prompt, params, ctx) do
    if pid = Application.get_env(:novel_agent, :author_action_admission_test_pid) do
      send(pid, :provider_executed)

      if Application.get_env(:novel_agent, :author_action_admission_block_provider, false) do
        send(pid, {:provider_waiting, self()})

        receive do
          :provider_release -> :ok
        after
          10_000 -> :ok
        end
      end
    end

    if Application.get_env(:novel_agent, :author_action_admission_fail_provider, false) do
      {:error, :injected_provider_failure}
    else
      Stub.execute(%Stub{}, nil, prompt, params, ctx)
    end
  end
end

defmodule NovelWeb.WorkspaceChannelAuthorActionAdmissionTest do
  use NovelPersistence.DataCase, async: false

  import Ecto.Query
  import Phoenix.ChannelTest

  alias NovelAgent.Provider.RuntimeConfig
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.WorkService
  alias NovelApplication.WorkSessionService
  alias NovelDomain.AgentNextStepDecision
  alias NovelDomain.AuthorActionInput
  alias NovelPersistence.AgentRunLog
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Schemas.AgentEventRecord
  alias NovelPersistence.Schemas.AgentRunRecord
  alias NovelPersistence.Schemas.AuthorActionReceipt
  alias NovelWeb.AuthorActionAdmissionTestProvider
  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint
  @artifact "as-prose-admission"
  @action_id "revise_from_findings:as-prose-admission"
  @idempotency_key "idem:author-action-admission"

  setup do
    previous_persistence = Application.fetch_env(:novel_web, :persistence)
    previous_provider = Application.fetch_env(:novel_agent, :provider)
    previous_extra = Application.fetch_env(:novel_agent, :extra_providers)
    previous_test_pid = Application.fetch_env(:novel_agent, :author_action_admission_test_pid)
    previous_fail = Application.fetch_env(:novel_agent, :author_action_admission_fail_provider)

    Application.put_env(
      :novel_web,
      :persistence,
      Keyword.put(prior_value(previous_persistence, []), :inject_real_persistence, true)
    )

    Application.put_env(
      :novel_agent,
      :provider,
      Keyword.put(prior_value(previous_provider, []), :default, :admission_test)
    )

    Application.put_env(
      :novel_agent,
      :extra_providers,
      Map.put(
        Map.new(prior_value(previous_extra, [])),
        :admission_test,
        AuthorActionAdmissionTestProvider
      )
    )

    Application.put_env(:novel_agent, :author_action_admission_test_pid, self())
    RuntimeConfig.put_current_provider(:admission_test)

    on_exit(fn ->
      restore_env(:novel_web, :persistence, previous_persistence)
      restore_env(:novel_agent, :provider, previous_provider)
      restore_env(:novel_agent, :extra_providers, previous_extra)
      restore_env(:novel_agent, :author_action_admission_test_pid, previous_test_pid)
      restore_env(:novel_agent, :author_action_admission_fail_provider, previous_fail)
      RuntimeConfig.reset()
    end)

    :ok
  end

  test "two independent Channels with the same key admit one run and execute once" do
    {work, session} = create_scope()
    persist_source!(work, session, "turn-admission-concurrent")
    socket_a = join!(work, session)
    socket_b = join!(work, session)
    params = revision_params("turn-admission-concurrent")

    assert socket_a.channel_pid != socket_b.channel_pid

    push_a = push(socket_a, "author_action", params)
    push_b = push(socket_b, "author_action", params)

    assert_reply(push_a, :ok, %{received: true, run_id: run_id_a}, 15_000)
    assert_reply(push_b, :ok, %{received: true, run_id: run_id_b}, 15_000)
    assert run_id_a == run_id_b
    NovelApplication.TestAgentRunCleanup.register_run(run_id_a)
    run_id = run_id_a

    assert receipt_count(work) == 1
    assert run_count(work) == 1

    # 成功受理必须真的发布 run_started；否则后面的“拒写零 run_started”断言
    # 会因为没有观察通道而假绿。
    assert_push(
      "agent_event",
      %{event_type: "run_started", run_id: ^run_id},
      5_000
    )

    assert_receive :provider_executed, 5_000
    refute_receive :provider_executed, 500

    await_terminal!(run_id)
  end

  test "same key with different complete action semantics is a conflict without a second run" do
    {work, session} = create_scope()
    persist_source!(work, session, "turn-admission-conflict")
    socket = join!(work, session)

    assert {:reply, {:ok, %{run_id: run_id}}, socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               revision_params("turn-admission-conflict"),
               socket
             )

    NovelApplication.TestAgentRunCleanup.register_run(run_id)

    changed =
      revision_params("turn-admission-conflict", %{
        "payload" => %{"quality_finding_refs" => ["validator.other_finding"]}
      })

    assert {:reply, {:error, %{reason: :idempotency_payload_conflict}}, _socket} =
             WorkspaceChannel.handle_in("author_action", changed, socket)

    assert run_count(work) == 1
    assert receipt_count(work) == 1
    assert {:ok, %{run: %{run_id: ^run_id}}} = AgentRunService.state(run_id)

    await_terminal!(run_id)
  end

  test "a rejected receipt insert executes nothing and publishes no start" do
    {work, session} = create_scope()
    persist_source!(work, session, "turn-admission-receipt-sql")
    socket = join!(work, session)
    events_before = event_count()

    Repo.query!("""
    CREATE TRIGGER reject_author_action_receipt_insert
    BEFORE INSERT ON author_action_receipts
    BEGIN SELECT RAISE(ABORT, 'injected receipt rejection'); END
    """)

    try do
      ref = push(socket, "author_action", revision_params("turn-admission-receipt-sql"))

      assert_reply(ref, :error, %{reason: reason}, 15_000)

      assert is_binary(reason)
      assert_no_admission_persisted(work, session)
      assert event_count() == events_before
      refute_receive :provider_executed, 500

      # 不只是 action_result：真实 topic 上不能出现启动事件/状态快照。
      refute_broadcast("action_result", _, 200)
      refute_push("agent_event", %{event_type: "run_started"}, 200)
      refute_push("agent_run_state", _, 200)
    after
      Repo.query!("DROP TRIGGER reject_author_action_receipt_insert")
    end
  end

  test "a rejected initial run insert rolls the receipt back and executes nothing" do
    {work, session} = create_scope()
    persist_source!(work, session, "turn-admission-run-sql")
    socket = join!(work, session)
    events_before = event_count()

    Repo.query!("""
    CREATE TRIGGER reject_admission_run_insert
    BEFORE INSERT ON agent_runs
    BEGIN SELECT RAISE(ABORT, 'injected run rejection'); END
    """)

    try do
      ref = push(socket, "author_action", revision_params("turn-admission-run-sql"))

      assert_reply(ref, :error, %{reason: reason}, 15_000)

      assert is_binary(reason)
      assert_no_admission_persisted(work, session)
      assert event_count() == events_before
      refute_receive :provider_executed, 500

      refute_broadcast("action_result", _, 200)
      refute_push("agent_event", %{event_type: "run_started"}, 200)
      refute_push("agent_run_state", _, 200)
    after
      Repo.query!("DROP TRIGGER reject_admission_run_insert")
    end
  end

  test "retrying after a terminal run returns the same receipt/run with the real status and child turn" do
    {work, session} = create_scope()
    persist_source!(work, session, "turn-admission-terminal")
    socket = join!(work, session)

    assert {:reply, {:ok, %{action_status: "running", run_id: run_id, receipt_id: receipt_id}},
            socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               revision_params("turn-admission-terminal"),
               socket
             )

    NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive :provider_executed, 5_000
    status = await_terminal!(run_id)
    assert status in ["completed", "failed"]

    child_turn =
      session.id
      |> MemoryLog.transcript()
      |> Enum.find_value(fn interaction ->
        content = interaction.content || %{}

        if interaction.role == "assistant" and content["agent_run_id"] == run_id do
          get_in(content, ["turn_result", "turn_id"])
        end
      end)

    assert {:reply,
            {:ok,
             %{
               duplicate: true,
               action_status: ^status,
               run_id: ^run_id,
               receipt_id: ^receipt_id,
               turn_id: duplicate_turn_id
             }}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               revision_params("turn-admission-terminal"),
               socket
             )

    if is_binary(child_turn) do
      assert duplicate_turn_id == child_turn
    else
      assert is_nil(duplicate_turn_id)
    end

    assert run_count(work) == 1
    assert receipt_count(work) == 1
    refute_receive :provider_executed, 500
  end

  test "a receipt whose run is missing or mis-bound fails closed" do
    {work, session} = create_scope()
    persist_source!(work, session, "turn-admission-broken-run")
    socket = join!(work, session)

    assert {:reply, {:ok, %{run_id: run_id, receipt_id: receipt_id}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               revision_params("turn-admission-broken-run"),
               socket
             )

    NovelApplication.TestAgentRunCleanup.register_run(run_id)

    await_terminal!(run_id)
    terminate_run_server!(run_id)

    Repo.update_all(
      from(r in AgentRunRecord, where: r.id == ^run_id),
      set: [trigger: %{"receipt_id" => "wrong-receipt-" <> receipt_id}]
    )

    assert {:reply, {:error, %{reason: misbound_reason}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               revision_params("turn-admission-broken-run"),
               socket
             )

    assert misbound_reason == "receipt_run_receipt_mismatch"

    source_mismatch_trigger = %{
      "kind" => "author_action",
      "receipt_id" => receipt_id,
      "action_id" => @action_id,
      "action_type" => "revise_from_findings",
      "source_turn_ref" => "turn-admission-broken-source",
      "target_artifact_ref" => @artifact
    }

    Repo.update_all(
      from(r in AgentRunRecord, where: r.id == ^run_id),
      set: [trigger: source_mismatch_trigger]
    )

    assert {:reply, {:error, %{reason: misbound_source_reason}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               revision_params("turn-admission-broken-run"),
               socket
             )

    assert misbound_source_reason == "receipt_run_source_mismatch"

    Repo.delete_all(from(r in AgentRunRecord, where: r.id == ^run_id))

    assert {:reply, {:error, %{reason: missing_reason}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               revision_params("turn-admission-broken-run"),
               socket
             )

    assert missing_reason == "receipt_run_missing"
    assert receipt_count(work) == 1
    assert run_count(work) == 0
  end

  test "wrong work/session, expired action, and wrong target are rejected without admission" do
    {work, session} = create_scope()
    {other_work, other_session} = create_scope()
    events_before = event_count()
    source = persist_source!(other_work, other_session, "turn-admission-other-scope")
    socket = join!(work, session)

    assert {:reply, {:error, %{reason: wrong_scope_reason}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               revision_params("turn-admission-other-scope", %{
                 "source_turn_ref" => source.turn_id
               }),
               socket
             )

    assert is_binary(wrong_scope_reason)
    assert_no_admission_persisted(work, session)
    assert_no_admission_persisted(other_work, other_session)

    {expired_work, expired_session} = create_scope()

    persist_source!(expired_work, expired_session, "turn-admission-expired",
      expires_at: DateTime.add(DateTime.utc_now(), -60, :second)
    )

    expired_socket = join!(expired_work, expired_session)
    expired_params = revision_params("turn-admission-expired")

    assert {:reply, {:error, %{reason: expired_reason}}, _socket} =
             WorkspaceChannel.handle_in("author_action", expired_params, expired_socket)

    assert is_binary(expired_reason)
    assert_no_admission_persisted(expired_work, expired_session)

    {target_work, target_session} = create_scope()
    persist_source!(target_work, target_session, "turn-admission-target")
    target_socket = join!(target_work, target_session)

    wrong_target =
      revision_params("turn-admission-target", %{"target_ref" => "as-something-else"})

    assert {:reply, {:error, %{reason: target_reason}}, _socket} =
             WorkspaceChannel.handle_in("author_action", wrong_target, target_socket)

    assert is_binary(target_reason)
    assert_no_admission_persisted(target_work, target_session)
    assert event_count() == events_before
    refute_receive :provider_executed, 500
  end

  test "the source run authority does not expand the new revision run" do
    {work, session} = create_scope()
    source_run_id = "run_source_authority_#{System.unique_integer([:positive])}"

    {:ok, _record} =
      AgentRunLog.upsert_run(%{
        id: source_run_id,
        workspace_id: work.id,
        work_id: work.id,
        session_id: session.id,
        parent_turn_ref: "turn-admission-authority-source",
        origin_frame_ref: "frame-admission-authority-source",
        run_mode: "bounded",
        profile_ref: "source_run_profile",
        status: "completed",
        phase: "stopped",
        authority_scope: %{
          "production_write" => true,
          "allowed_tools" => ["prose_writing", "production_write"]
        }
      })

    persist_source!(work, session, "turn-admission-authority", source_run_id: source_run_id)

    socket = join!(work, session)

    assert {:reply, {:ok, %{run_id: run_id}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               revision_params("turn-admission-authority"),
               socket
             )

    NovelApplication.TestAgentRunCleanup.register_run(run_id)

    refute run_id == source_run_id
    assert {:ok, %{run: run}} = AgentRunService.state(run_id)

    assert run.trigger.source_turn_ref == "turn-admission-authority"
    assert run.authority_scope.allowed_tools == ["prose_writing"]
    assert run.authority_scope.production_write == false

    assert %{authority_scope: %{"allowed_tools" => ["prose_writing", "production_write"]}} =
             AgentRunLog.get_run(source_run_id)

    await_terminal!(run_id)
  end

  test "正式：已受理 bounded 运行丢失后不能重放旧 running" do
    {work, session} = create_scope()
    source = "turn-admission-runtime-lost"
    persist_source!(work, session, source)
    {run_id, _receipt} = admit_idle_author_action!(work, session, source)
    await_status!(run_id, "awaiting_author")

    socket = join!(work, session)
    params = revision_params(source)

    # 真实终止一个已受理、当前没有 step task 的 owned bounded run；随后按原
    # receipt 回执必须读取到 runtime-lost 收口事实，而不是 DB 里的旧 awaiting_author。
    terminate_run_server!(run_id)
    refute match?({:ok, _}, AgentRunService.state(run_id))

    assert {:reply, {:ok, ack}, _socket} =
             WorkspaceChannel.handle_in("author_action", params, socket)

    assert ack.duplicate
    assert ack.action_status == "failed"
    assert ack.agent_run_state.status == "failed"
    assert ack.agent_run_state.runtime_live == false
    assert ack.source_turn_ref == source
    assert is_nil(Map.get(ack, :turn_id))
    assert ack.turn_results == []
    assert_author_safe(ack)

    assert_broadcast("action_result", %{duplicate: true, status: "failed"} = payload, 5_000)
    assert payload.agent_run_state.runtime_live == false
    assert_author_safe(payload)

    assert run_count(work) == 1
    assert receipt_count(work) == 1

    run = AgentRunLog.get_run(run_id)
    assert run.status == "failed"
    assert run.failure_ref == "runtime_lost_on_restart"
    assert run.parent_turn_ref == source

    receipt = Repo.get!(AuthorActionReceipt, ack.receipt_id)
    assert receipt.result["run_id"] == run_id

    assert {:ok, preserved_source} =
             NovelApplication.AuthorActionAdmission.source_turn_result(
               work.id,
               session.id,
               source
             )

    assert source_candidate_preserved?(preserved_source)
    refute_receive :provider_executed, 100
  end

  test "正式：已受理 bounded owner 异常退出不重启旧 Provider，也不拖垮其他运行" do
    previous = Application.fetch_env(:novel_agent, :author_action_admission_block_provider)
    Application.put_env(:novel_agent, :author_action_admission_block_provider, true)

    on_exit(fn ->
      restore_env(:novel_agent, :author_action_admission_block_provider, previous)
    end)

    {work, session} = create_scope()
    source = "turn-admission-abnormal-kill"
    persist_source!(work, session, source)
    socket = join!(work, session)
    params = revision_params(source)

    assert {:reply, {:ok, %{run_id: run_id}}, _socket} =
             WorkspaceChannel.handle_in("author_action", params, socket)

    NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive :provider_executed, 5_000
    assert_receive {:provider_waiting, provider_pid}, 5_000
    assert_broadcast("action_result", %{run_id: ^run_id, status: "running"}, 5_000)

    {other_work, other_session} = create_scope()
    other_source = "turn-admission-abnormal-kill-sibling"
    persist_source!(other_work, other_session, other_source)
    {other_run_id, _receipt} = admit_idle_author_action!(other_work, other_session, other_source)
    await_status!(other_run_id, "awaiting_author")

    [{other_server, _}] = Registry.lookup(NovelApplication.AgentRunRegistry, other_run_id)
    [{server, _}] = Registry.lookup(NovelApplication.AgentRunRegistry, run_id)
    supervisor = Process.whereis(NovelApplication.AgentRunSupervisor)
    owner_monitor = Process.monitor(server)
    supervisor_monitor = Process.monitor(supervisor)
    provider_monitor = Process.monitor(provider_pid)

    try do
      Process.exit(server, :kill)

      assert_receive {:DOWN, ^owner_monitor, :process, ^server, :killed}, 2_000
      refute_receive {:DOWN, ^supervisor_monitor, :process, ^supervisor, _}, 1_000
      refute_receive :provider_executed, 200

      assert Process.whereis(NovelApplication.AgentRunSupervisor) == supervisor
      assert Registry.lookup(NovelApplication.AgentRunRegistry, run_id) == []

      assert [{^other_server, _}] =
               Registry.lookup(NovelApplication.AgentRunRegistry, other_run_id)

      assert Process.alive?(other_server)

      assert {:ok, %{run: %{run_id: ^other_run_id, status: :awaiting_author}}} =
               AgentRunService.state(other_run_id)
    after
      send(provider_pid, :provider_release)
      await_process_down(provider_monitor, provider_pid)
      restore_env(:novel_agent, :author_action_admission_block_provider, previous)
      terminate_run_server!(other_run_id)
    end
  end

  test "正式：runtime-lost 写入被拒绝时 Channel 明确失败且不广播成功" do
    previous = Application.fetch_env(:novel_agent, :author_action_admission_block_provider)
    Application.put_env(:novel_agent, :author_action_admission_block_provider, true)

    on_exit(fn ->
      restore_env(:novel_agent, :author_action_admission_block_provider, previous)
    end)

    {work, session} = create_scope()
    source = "turn-admission-runtime-lost-write-failure"
    persist_source!(work, session, source)
    socket = join!(work, session)
    params = revision_params(source)

    assert {:reply, {:ok, %{run_id: run_id, receipt_id: receipt_id}}, socket} =
             WorkspaceChannel.handle_in("author_action", params, socket)

    NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive :provider_executed, 5_000
    assert_receive {:provider_waiting, provider_pid}, 5_000
    assert_broadcast("action_result", %{run_id: ^run_id, status: "running"}, 5_000)

    [{server, _}] = Registry.lookup(NovelApplication.AgentRunRegistry, run_id)
    owner_monitor = Process.monitor(server)
    provider_monitor = Process.monitor(provider_pid)
    Process.exit(server, :kill)
    assert_receive {:DOWN, ^owner_monitor, :process, ^server, :killed}, 2_000

    trigger = "reject_runtime_lost_#{System.unique_integer([:positive, :monotonic])}"

    Repo.query!("""
    CREATE TRIGGER #{trigger}
    BEFORE UPDATE ON agent_runs
    WHEN NEW.id = '#{run_id}' AND NEW.status = 'failed' AND OLD.status = 'running'
    BEGIN SELECT RAISE(ABORT, 'leader runtime lost write rejected'); END
    """)

    try do
      assert {:reply, {:error, %{reason: reason}}, _socket} =
               WorkspaceChannel.handle_in("author_action", params, socket)

      assert reason == "receipt_run_write_failed"
      refute_broadcast("action_result", _, 300)

      run = AgentRunLog.get_run(run_id)
      assert run.status == "running"
      assert run.failure_ref == nil
      assert Repo.get!(AuthorActionReceipt, receipt_id).result["run_id"] == run_id
      assert run_count(work) == 1
      assert receipt_count(work) == 1

      refute Enum.any?(AgentRunLog.list_events(run_id), &(&1.event_type == "run_failed"))
    after
      Repo.query!("DROP TRIGGER #{trigger}")
      send(provider_pid, :provider_release)
      await_process_down(provider_monitor, provider_pid)
      Application.put_env(:novel_agent, :author_action_admission_block_provider, false)
    end
  end

  test "正式：未知新版 receipt 不能降为无摘要旧记录重放" do
    ctx = completed_action!("unknown-version")
    receipt = Repo.get!(AuthorActionReceipt, ctx.receipt_id)

    result =
      receipt.result
      |> Map.put("admission_version", 999)
      |> Map.delete("payload_digest")

    receipt |> Ecto.Changeset.change(result: result) |> Repo.update!()

    assert {:reply, {:error, %{reason: reason}}, _socket} =
             WorkspaceChannel.handle_in("author_action", ctx.params, ctx.socket)

    assert reason =~ "unsupported_admission_version"
    assert run_count(ctx.work) == 1
    assert receipt_count(ctx.work) == 1
    assert AgentRunLog.get_run(ctx.run_id).session_id == ctx.session.id
    refute_receive :provider_executed, 100
  end

  test "缺少 admission_version 的旧 receipt 仍按历史边界回放" do
    ctx = completed_action!("legacy-version")
    receipt = Repo.get!(AuthorActionReceipt, ctx.receipt_id)

    result =
      Map.drop(receipt.result, [
        "admission_version",
        "semantic_digest",
        "source_agent_run_id",
        "payload_digest"
      ])

    receipt |> Ecto.Changeset.change(result: result) |> Repo.update!()

    assert {:reply, {:ok, ack}, _socket} =
             WorkspaceChannel.handle_in("author_action", ctx.params, ctx.socket)

    assert ack.duplicate
    assert_author_safe(ack)
    assert run_count(ctx.work) == 1
    assert receipt_count(ctx.work) == 1
    refute_receive :provider_executed, 100
  end

  test "正式：子结果内部 run 归属冲突必须失败" do
    ctx = completed_action!("child-binding")

    rows =
      NovelPersistence.WorkSessionRepo.assistant_entries_by_run(
        ctx.work.id,
        ctx.session.id,
        ctx.run_id
      )

    assert rows != []

    Enum.each(rows, fn row ->
      result = row.content["turn_result"]
      assert is_map(result)

      bad =
        Map.put(result, "agent_run", %{
          "run_id" => "foreign-run",
          "parent_turn_ref" => "foreign-parent"
        })

      content = Map.put(row.content, "turn_result", bad)
      row |> Ecto.Changeset.change(content: content) |> Repo.update!()
    end)

    assert {:reply, {:error, %{reason: reason}}, _socket} =
             WorkspaceChannel.handle_in("author_action", ctx.params, ctx.socket)

    assert reason =~ "receipt_child_binding_conflict"
    refute_receive :provider_executed, 100
  end

  test "正式：合法 JSON 的未知 goal 扩展键不能使回执崩溃" do
    ctx = completed_action!("goal-keys")
    run = AgentRunLog.get_run(ctx.run_id)
    key = "metadata_#{System.unique_integer([:positive])}_not_an_existing_atom"
    goal = Map.put(run.goal, key, %{"source note" => "记录事实"})

    Repo.update_all(from(r in AgentRunRecord, where: r.id == ^ctx.run_id), set: [goal: goal])

    assert {:reply, {:ok, ack}, _socket} =
             WorkspaceChannel.handle_in("author_action", ctx.params, ctx.socket)

    assert ack.action_status in ["completed", "failed"]
    assert run_count(ctx.work) == 1
    refute_receive :provider_executed, 100
  end

  test "完成回执携带真实 agent_run_state、已提交 turn_results 与来源/子结果分离" do
    ctx = completed_action!("ack-completed")

    assert ctx.initial_ack.agent_run_state.runtime_live == true
    assert ctx.initial_ack.turn_results == []
    assert is_nil(Map.get(ctx.initial_ack, :turn_id))
    assert ctx.initial_ack.source_turn_ref == ctx.source
    assert_author_safe(ctx.initial_ack)

    ack = duplicate_ack!(ctx)
    child_turn_id = ack.turn_id

    assert is_binary(child_turn_id)
    refute child_turn_id == ctx.source
    assert ack.source_turn_ref == ctx.source
    assert ack.action_status == ctx.status
    assert ack.agent_run_state.status == ctx.status
    assert ack.agent_run_state.runtime_live == true
    assert ack.agent_run_state.parent_turn_ref == ctx.source
    assert_author_safe(ack)

    assert [turn_result] = ack.turn_results
    assert turn_result["turn_id"] == child_turn_id
    assert get_in(turn_result, ["agent_run", "run_id"]) == ctx.run_id
    assert get_in(turn_result, ["agent_run", "parent_turn_ref"]) == ctx.source

    run = AgentRunLog.get_run(ctx.run_id)
    assert run.parent_turn_ref == ctx.source
    assert run.status == ctx.status

    run_id = ctx.run_id
    assert_broadcast("action_result", %{duplicate: true, run_id: ^run_id} = payload, 5_000)
    assert payload.agent_run_state == ack.agent_run_state
    assert payload.turn_results == ack.turn_results
    assert_author_safe(payload)
  end

  test "失败回执不把旧 accepted/running 当执行真相" do
    previous = Application.fetch_env(:novel_agent, :author_action_admission_fail_provider)
    Application.put_env(:novel_agent, :author_action_admission_fail_provider, true)

    on_exit(fn ->
      restore_env(:novel_agent, :author_action_admission_fail_provider, previous)
    end)

    ctx = completed_action!("ack-failed")
    assert ctx.status == "failed"

    ack = duplicate_ack!(ctx)

    assert ack.action_status == "failed"
    assert ack.agent_run_state.status == "failed"
    refute ack.action_status == "running"
    assert ack.source_turn_ref == ctx.source
    assert is_nil(Map.get(ack, :turn_id))
    assert ack.turn_results == []
    assert_author_safe(ack)
    assert run_count(ctx.work) == 1
    assert receipt_count(ctx.work) == 1
    refute_receive :provider_executed, 100
  end

  test "跨作用域迟到 receipt 不进入当前视图" do
    ctx = completed_action!("ack-late")
    {other_work, other_session} = create_scope()
    other_run_id = "run_late_#{System.unique_integer([:positive])}"

    {:ok, _record} =
      AgentRunLog.upsert_run(%{
        id: other_run_id,
        workspace_id: other_work.id,
        work_id: other_work.id,
        session_id: other_session.id,
        parent_turn_ref: "turn-late-other",
        origin_frame_ref: "frame-late-other",
        run_mode: "bounded",
        profile_ref: "prose_revision_from_findings_v1",
        status: "completed",
        phase: "stopped"
      })

    receipt = Repo.get!(AuthorActionReceipt, ctx.receipt_id)
    result = Map.put(receipt.result, "run_id", other_run_id)
    receipt |> Ecto.Changeset.change(result: result) |> Repo.update!()

    assert {:reply, {:error, %{reason: reason}}, _socket} =
             WorkspaceChannel.handle_in("author_action", ctx.params, ctx.socket)

    assert reason =~ "receipt_run_scope_mismatch"
    assert run_count(ctx.work) == 1
    assert receipt_count(ctx.work) == 1
    refute_broadcast("action_result", _, 200)
    refute_receive :provider_executed, 100
  end

  defp admit_idle_author_action!(work, session, source) do
    assert {:ok, source_turn_result} =
             NovelApplication.AuthorActionAdmission.source_turn_result(
               work.id,
               session.id,
               source
             )

    action_input = %AuthorActionInput{
      input_id: NovelFoundation.ID.unique("in"),
      source_turn_ref: source,
      action_id: @action_id,
      action_type: "revise_from_findings",
      target_ref: @artifact,
      idempotency_key: @idempotency_key,
      payload: %{"quality_finding_refs" => ["validator.prose_pattern_repetition"]}
    }

    trigger = %{
      kind: "author_action",
      action_id: @action_id,
      action_type: "revise_from_findings",
      source_turn_ref: source,
      source_surface_ref: "quality_review:#{source}",
      target_artifact_ref: @artifact,
      quality_finding_refs: ["validator.prose_pattern_repetition"]
    }

    input = %{
      text: "按质量发现重写正文草稿",
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      turn_id: source,
      origin_frame_ref: "frame_#{source}_revision",
      source_turn_result: source_turn_result,
      action_input: action_input,
      memory_recorder: NovelApplication.persistence_interaction_recorder(),
      trigger: trigger
    }

    spec = DialoguePlanningService.run_spec_for_profile(:prose_revision_from_findings, input, nil)

    admission = %{
      action_input: action_input,
      work_id: work.id,
      session_id: session.id,
      source_turn_ref: source,
      source_turn_result: source_turn_result
    }

    planner = fn run, sequence, _snapshot ->
      {:ok, decision} =
        AgentNextStepDecision.new(%{
          decision_id: "and_#{run.run_id}_#{sequence}_await_author",
          run_ref: run.run_id,
          sequence: sequence,
          decision_type: :await_author,
          summary: "等待作者补充具体方向。",
          reason_codes: ["test_idle_runtime_loss"]
        })

      {:await_author, decision, %{provider_call_count: 0}}
    end

    assert {:ok, %{run_id: run_id, receipt: receipt}} =
             AgentRunService.start_author_action(
               spec.run_attrs,
               [next_step_planner: planner],
               admission
             )

    NovelApplication.TestAgentRunCleanup.register_run(run_id)
    {run_id, receipt}
  end

  defp await_status!(run_id, expected, timeout \\ 5_000) do
    deadline = System.monotonic_time(:millisecond) + timeout
    do_await_status!(run_id, expected, deadline)
  end

  defp do_await_status!(run_id, expected, deadline) do
    case AgentRunLog.get_run(run_id) do
      %{status: ^expected} = record ->
        record

      _other ->
        if System.monotonic_time(:millisecond) >= deadline do
          flunk("run #{run_id} did not reach status #{expected}")
        else
          Process.sleep(20)
          do_await_status!(run_id, expected, deadline)
        end
    end
  end

  defp completed_action!(suffix) do
    {work, session} = create_scope()
    source = "turn-admission-#{suffix}"
    persist_source!(work, session, source)
    socket = join!(work, session)
    params = revision_params(source)

    assert {:reply, {:ok, initial_ack}, socket} =
             WorkspaceChannel.handle_in("author_action", params, socket)

    run_id = initial_ack.run_id
    NovelApplication.TestAgentRunCleanup.register_run(run_id)
    assert_broadcast("action_result", %{run_id: ^run_id, status: "running"}, 5_000)
    assert_receive :provider_executed, 5_000
    status = await_terminal!(initial_ack.run_id)

    %{
      work: work,
      session: session,
      source: source,
      socket: socket,
      params: params,
      run_id: initial_ack.run_id,
      receipt_id: initial_ack.receipt_id,
      status: status,
      initial_ack: initial_ack
    }
  end

  defp duplicate_ack!(ctx) do
    assert {:reply, {:ok, ack}, _socket} =
             WorkspaceChannel.handle_in("author_action", ctx.params, ctx.socket)

    assert ack.duplicate
    assert ack.run_id == ctx.run_id
    assert ack.receipt_id == ctx.receipt_id
    ack
  end

  defp source_candidate_preserved?(source_result) do
    adoption_state =
      Map.get(source_result, :adoption_state, Map.get(source_result, "adoption_state", %{}))

    pending = Map.get(adoption_state, :pending, Map.get(adoption_state, "pending", []))

    Enum.any?(pending, fn item ->
      (Map.get(item, :artifact_id) || Map.get(item, "artifact_id")) == @artifact
    end)
  end

  defp assert_author_safe(payload) do
    Enum.each(
      [
        :semantic_digest,
        :admission_version,
        :source_agent_run_id,
        "semantic_digest",
        "admission_version",
        "source_agent_run_id"
      ],
      fn key ->
        refute Map.has_key?(payload, key), "receipt 私有字段泄漏到作者 payload: #{inspect(key)}"
      end
    )
  end

  defp create_scope do
    {:ok, work} =
      WorkService.create(%{
        "title" => "Author action admission #{System.unique_integer([:positive])}",
        "genre" => "赛博修仙",
        "core_selling_point" => "原子受理"
      })

    {:ok, %{active_session: session}} = WorkSessionService.resume(work.id)
    {work, session}
  end

  defp persist_source!(work, session, turn_id, opts \\ []) do
    turn_result = %{
      turn_id: turn_id,
      frame_ref: "frame-#{turn_id}",
      available_actions: [
        %{
          action_id: @action_id,
          action_type: "revise_from_findings",
          target_ref: opts[:target_ref] || @artifact,
          enabled: true,
          idempotency_key: @idempotency_key,
          expires_at: opts[:expires_at],
          quality_finding_refs: ["validator.prose_pattern_repetition"]
        }
      ],
      adoption_state: %{
        pending: [
          %{
            artifact_id: opts[:target_ref] || @artifact,
            artifact_type: :prose_fragment,
            adoption_status: "TENTATIVE",
            requires_adoption: true,
            payload: %{
              items: [
                %{item_id: "scene-1", title: "废弃高架追逐", body: "他向前跑。他回头看。"}
              ]
            }
          }
        ],
        resolved: []
      },
      quality_review: %{
        status: "warnings",
        policy_action: "proceed_with_warning",
        review_status: "completed",
        findings: [
          %{
            validator: "validator.prose_pattern_repetition",
            quality_gate: "quality_gate.style_fit",
            severity: "warn",
            action: "warn",
            summary: "句式节奏单一"
          }
        ]
      }
    }

    content =
      %{text: "回复 #{turn_id}", turn_result: turn_result}
      |> then(fn content ->
        case opts[:source_run_id] do
          nil -> content
          run_id -> Map.put(content, :agent_run_id, run_id)
        end
      end)

    {:ok, _interaction} =
      MemoryLog.record(%{
        workspace_id: work.id,
        session_id: session.id,
        turn_id: turn_id,
        role: "assistant",
        content: content,
        source_ref: turn_id,
        scope_ref: work.id
      })

    turn_result
  end

  defp join!(work, session) do
    {:ok, _reply, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session.id
      })

    NovelApplication.TestAgentRunCleanup.register_task_caller(socket.channel_pid)
    socket
  end

  defp revision_params(source_turn_ref, overrides \\ %{}) do
    %{
      "action" =>
        %{
          "action_id" => @action_id,
          "action_type" => "revise_from_findings",
          "target_ref" => @artifact,
          "source_turn_ref" => source_turn_ref,
          "idempotency_key" => @idempotency_key,
          "payload" => %{
            "quality_finding_refs" => ["validator.prose_pattern_repetition"]
          }
        }
        |> Map.merge(overrides)
    }
  end

  defp assert_no_admission_persisted(work, _session) do
    assert receipt_count(work) == 0
    assert run_count(work) == 0
    assert Repo.get_by(AgentRunRecord, work_id: work.id) == nil
  end

  defp event_count do
    Repo.aggregate(AgentEventRecord, :count, :id)
  end

  defp run_count(work) do
    AgentRunRecord
    |> where([r], r.work_id == ^work.id)
    |> Repo.aggregate(:count, :id)
  end

  defp receipt_count(work) do
    AuthorActionReceipt
    |> where([r], r.work_id == ^work.id)
    |> Repo.aggregate(:count, :id)
  end

  defp prior_value({:ok, value}, _default), do: value
  defp prior_value(:error, default), do: default

  defp restore_env(module, key, :error), do: Application.delete_env(module, key)
  defp restore_env(module, key, {:ok, value}), do: Application.put_env(module, key, value)

  defp await_terminal!(run_id) do
    deadline = System.monotonic_time(:millisecond) + 10_000
    do_await_terminal!(run_id, deadline)
  end

  defp terminate_run_server!(run_id) do
    case Registry.lookup(NovelApplication.AgentRunRegistry, run_id) do
      [{pid, _}] ->
        :ok = DynamicSupervisor.terminate_child(NovelApplication.AgentRunSupervisor, pid)

      [] ->
        :ok
    end
  end

  defp await_process_down(monitor, pid, timeout \\ 2_000) do
    receive do
      {:DOWN, ^monitor, :process, ^pid, _reason} -> :ok
    after
      timeout -> :ok
    end
  end

  defp do_await_terminal!(run_id, deadline) do
    case AgentRunLog.get_run(run_id) do
      %{status: status} when status in ["completed", "failed", "cancelled"] ->
        status

      _ ->
        if System.monotonic_time(:millisecond) >= deadline do
          flunk("run #{run_id} did not reach a terminal status")
        else
          Process.sleep(50)
          do_await_terminal!(run_id, deadline)
        end
    end
  end
end
