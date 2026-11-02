defmodule NovelApplication.AgentRunHistoryBindingTest do
  @moduledoc """
  B71 §16.8 行为红测试：source run、修订 child、旧历史回查与 WorkSession 重载
  必须按真实持久身份绑定，不能按 parent_turn_ref 的最新一条猜测。

  本文件只从既有公开消费者进入，不新增生产 helper：
  - `NovelApplication.TraceReplayService.fetch_turn_report/3`
  - `NovelApplication.ProviderActivityService.fetch_turn_activity/3`
  - `NovelApplication.WorkSessionService.show/2` 与 `resume/1`

  AgentRun 记录使用既有持久 schema 可直接写入的 attrs；`authoring_transcript`
  是 §16.8 冻结的私有列。schema 与 v3 引用已落地，但回查消费者尚未消费私有列/v3
  引用，涉及私有历史、冲突与错绑的用例因此保持红；跨 session/work 隔离、旧数据唯一
  parent/step 回查是回归保护。

  边界：本文件只证明身份绑定与 fail-closed，不是 fresh/restore 或投影等价证据。
  `db_json_roundtrip/1` 只模拟数据库 JSON 边界，不用来归一请求 IR，也不断言恢复后
  投影逐字相同。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.{
    AuthoringTranscript,
    ProviderActivityService,
    TraceReplayService,
    WorkService,
    WorkSessionService
  }

  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}

  alias NovelPersistence.{
    AgentRunLog,
    LongRunTaskLog,
    MemoryLog,
    ProviderRunLog,
    Repo,
    TraceRepository,
    WorkSessionRepo
  }

  # Provider 执行入口与其底层 adapter。回查消费者同步执行；任何入口被调用都会
  # 在测试进程收到 call trace，避免只盯 Gateway 而漏掉直接/底层调用。
  @provider_entry_modules [
    NovelAgent.Provider.Execution,
    NovelAgent.Provider.Gateway,
    NovelAgent.Provider.AdapterExecution,
    NovelAgent.Provider.HTTP,
    NovelAgent.Provider.NativeToolExchange,
    NovelAgent.Provider.OpenAICompatible,
    NovelAgent.Provider.OpenAICompatibleStream,
    NovelAgent.Provider.AnthropicStream,
    NovelAgent.Provider.Stub,
    NovelAgent.Provider.LMStudio,
    NovelAgent.Provider.Strata,
    NovelAgent.Provider.Anthropic,
    NovelAgent.Provider.DeepSeek,
    NovelAgent.Provider.OpenAI,
    NovelAgent.Provider.OpenAISubscription,
    NovelAgent.Provider.Minimax,
    NovelAgent.Provider.MinimaxCN,
    NovelAgent.Provider.Zhipu,
    NovelAgent.Provider.Kimi,
    NovelAgent.Provider.Gemini
  ]

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "B71 历史绑定作品"})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)
    %{work: work, session: session}
  end

  test "source 与修订 child 共用 parent_turn_ref 时，各自由真实 run 身份定位", %{
    work: work,
    session: session
  } do
    source_turn = unique("turn_source")
    child_turn = unique("turn_rev")
    source_run = unique("run_source")
    child_run = unique("run_revision_child")
    source_summary = unique("源稿历史")
    child_summary = unique("修订历史")

    seed_run!(work, session, source_run, source_turn, source_summary)
    seed_run!(work, session, child_run, source_turn, child_summary)

    assert [%{id: ^source_run}, %{id: ^child_run}] =
             AgentRunLog.list_by_parent_turn(work.id, session.id, source_turn)

    record_assistant!(work, session, source_turn,
      agent_run_id: source_run,
      agent_run: %{run_id: source_run}
    )

    record_assistant!(work, session, child_turn,
      agent_run_id: child_run,
      agent_run: %{run_id: child_run},
      parent_turn_id: source_turn
    )

    insert_trace!(work, session, source_turn)
    insert_trace!(work, session, child_turn)

    source_provider =
      seed_provider_run!(work, session, source_run, unique("provider_source"), source_turn)

    child_provider =
      seed_provider_run!(work, session, child_run, unique("provider_child"), source_turn)

    assert {:ok, source_report} =
             TraceReplayService.fetch_turn_report(work.id, session.id, source_turn)

    assert [%{summary: ^source_summary}] = source_report.trace_summary[:authoring_history]
    refute inspect(source_report) =~ child_summary

    assert {:ok, child_report} =
             TraceReplayService.fetch_turn_report(work.id, session.id, child_turn)

    assert [%{summary: ^child_summary}] = child_report.trace_summary[:authoring_history]
    refute inspect(child_report) =~ source_summary

    assert {:ok, source_activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, source_turn)

    assert Enum.map(source_activity.agent_runs, & &1.run_id) == [source_run]
    assert source_activity.totals.provider_call_refs == [source_provider.provider_call_ref]
    refute inspect(source_activity) =~ child_provider.provider_call_ref

    assert {:ok, child_activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, child_turn)

    assert Enum.map(child_activity.agent_runs, & &1.run_id) == [child_run]
    assert child_activity.totals.provider_call_refs == [child_provider.provider_call_ref]

    assert {:ok, snapshot} = WorkSessionService.show(work.id, session.id)
    summaries = agent_run_summaries_by_turn(snapshot)

    assert field(summaries[source_turn], :run_id) == source_run
    assert field(summaries[child_turn], :run_id) == child_run
  end

  test "相同 turn_id 跨 session/work 时严格隔离", %{work: work, session: session} do
    {:ok, sibling_session} =
      WorkSessionRepo.create(%{work_id: work.id, title: "同作品另一会话"})

    {:ok, other_work} = WorkService.create(%{title: "另一个作品"})

    {:ok, other_session} =
      WorkSessionRepo.create(%{work_id: other_work.id, title: "另一个会话"})

    shared_turn = unique("turn_shared")

    scopes = [
      {work, session, unique("run_scope_a"), unique("历史甲")},
      {work, sibling_session, unique("run_scope_b"), unique("历史乙")},
      {other_work, other_session, unique("run_scope_c"), unique("历史丙")}
    ]

    for {scope_work, scope_session, run_id, summary} <- scopes do
      # 隔离用例用可被当前读路径消费的 v2 旧副本，避免把“私有列未读”混进隔离结论。
      seed_run!(scope_work, scope_session, run_id, shared_turn, summary, checkpoint_version: 2)

      record_assistant!(scope_work, scope_session, shared_turn,
        agent_run_id: run_id,
        agent_run: %{run_id: run_id}
      )

      insert_trace!(scope_work, scope_session, shared_turn)
    end

    for {scope_work, scope_session, run_id, summary} <- scopes do
      assert {:ok, report} =
               TraceReplayService.fetch_turn_report(
                 scope_work.id,
                 scope_session.id,
                 shared_turn
               )

      assert [%{summary: ^summary}] = report.trace_summary[:authoring_history]

      assert {:ok, activity} =
               ProviderActivityService.fetch_turn_activity(
                 scope_work.id,
                 scope_session.id,
                 shared_turn
               )

      assert Enum.map(activity.agent_runs, & &1.run_id) == [run_id]

      assert {:ok, snapshot} = WorkSessionService.show(scope_work.id, scope_session.id)
      assert field(agent_run_summaries_by_turn(snapshot)[shared_turn], :run_id) == run_id
    end
  end

  test "Interaction 绑定与 TurnResult 冲突时 fail closed，不指定任一 run 胜出", %{
    work: work,
    session: session
  } do
    source_turn = unique("turn_conflict")
    source_run = unique("run_bound")
    later_run = unique("run_later_parent")
    bound_summary = unique("绑定历史")
    later_summary = unique("最新历史")

    seed_run!(work, session, source_run, source_turn, bound_summary)
    seed_run!(work, session, later_run, source_turn, later_summary)

    assert [%{id: ^source_run}, %{id: ^later_run}] =
             AgentRunLog.list_by_parent_turn(work.id, session.id, source_turn)

    # 持久 Interaction 的 row run_id 指向 source；TurnResult 内的 run_id 故意冲突。
    # 两个身份都不可信：不得选 source 胜出，也不得回退最近 parent 的 later。
    record_assistant!(work, session, source_turn,
      agent_run_id: source_run,
      agent_run: %{run_id: later_run}
    )

    insert_trace!(work, session, source_turn)
    seed_provider_run!(work, session, source_run, unique("provider_bound"), source_turn)
    seed_provider_run!(work, session, later_run, unique("provider_later"), source_turn)

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(work.id, session.id, source_turn)

    assert report.replay_report.result_status == "partial"
    assert "authoring_transcript" in report.replay_report.missing_trace_refs
    refute Map.has_key?(report.trace_summary, :authoring_history)
    refute inspect(report) =~ bound_summary
    refute inspect(report) =~ later_summary

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, source_turn)

    assert activity.agent_runs == []
    assert activity.provider_runs == []
    assert activity.totals.provider_run_count == 0
    assert activity.totals.provider_call_refs == []
    assert activity.totals.total_tokens == 0
    assert activity.totals.content_length == 0

    assert {:ok, snapshot} = WorkSessionService.show(work.id, session.id)
    run_summary = agent_run_summaries_by_turn(snapshot)[source_turn]

    # 允许保留原始已提交 TurnResult（其 run_id 是 later_run），但不得回填任一
    # run 的 DB 运行事实；删除未经验证的 agent_run 摘要同样合法。
    assert is_nil(run_summary) or is_nil(field(run_summary, :run_id)) or
             field(run_summary, :run_id) == later_run

    if is_map(run_summary) do
      refute has_key?(run_summary, :status)
      refute has_key?(run_summary, :phase)
      refute has_key?(run_summary, :run_mode)
      refute has_key?(run_summary, :profile_ref)
      refute has_key?(run_summary, :trigger)
      refute has_key?(run_summary, :long_run_task_ref)
      refute has_key?(run_summary, :plan_ref)
      refute has_key?(run_summary, :plan_version)
      refute has_key?(run_summary, :provider_run_count)
      refute field(run_summary, :activity_loaded) == true
      refute has_key?(run_summary, :events)
      refute has_key?(run_summary, :provider_runs)
    end

    refute inspect(snapshot) =~ bound_summary
    refute inspect(snapshot) =~ later_summary
  end

  test "run scope 不符时不得回退最近 parent", %{work: work, session: session} do
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: work.id, title: "绑定到别处"})
    source_turn = unique("turn_scope_mismatch")
    foreign_run = unique("run_foreign_scope")
    local_latest = unique("run_local_latest")
    foreign_summary = unique("别处历史")
    local_summary = unique("本地最新历史")

    seed_run!(work, other_session, foreign_run, source_turn, foreign_summary)
    seed_run!(work, session, local_latest, source_turn, local_summary)

    assert [%{id: ^local_latest}] =
             AgentRunLog.list_by_parent_turn(work.id, session.id, source_turn)

    record_assistant!(work, session, source_turn,
      agent_run_id: foreign_run,
      agent_run: %{run_id: foreign_run}
    )

    insert_trace!(work, session, source_turn)
    seed_provider_run!(work, session, local_latest, unique("provider_local"), source_turn)

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(work.id, session.id, source_turn)

    assert report.replay_report.result_status == "partial"
    assert "authoring_transcript" in report.replay_report.missing_trace_refs
    refute Map.has_key?(report.trace_summary, :authoring_history)
    refute inspect(report) =~ local_summary
    refute inspect(report) =~ foreign_summary

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, source_turn)

    assert activity.agent_runs == []
    assert activity.provider_runs == []

    assert {:ok, snapshot} = WorkSessionService.show(work.id, session.id)
    run_summary = agent_run_summaries_by_turn(snapshot)[source_turn]

    # 可保留原始已提交 TurnResult（foreign_run），但不得把本地最近 run 或任何
    # DB 运行事实回填成“已核实摘要”。
    assert is_nil(run_summary) or is_nil(field(run_summary, :run_id)) or
             field(run_summary, :run_id) == foreign_run

    if is_map(run_summary) do
      refute has_key?(run_summary, :status)
      refute has_key?(run_summary, :phase)
      refute has_key?(run_summary, :run_mode)
      refute has_key?(run_summary, :profile_ref)
      refute has_key?(run_summary, :trigger)
      refute has_key?(run_summary, :long_run_task_ref)
      refute has_key?(run_summary, :plan_ref)
      refute has_key?(run_summary, :plan_version)
      refute has_key?(run_summary, :provider_run_count)
      refute field(run_summary, :activity_loaded) == true
      refute has_key?(run_summary, :events)
      refute has_key?(run_summary, :provider_runs)
    end

    refute inspect(snapshot) =~ local_summary
    refute inspect(snapshot) =~ foreign_summary
  end

  test "旧数据无显式绑定时，唯一 parent 或已记录 step 可回查", %{
    work: work,
    session: session
  } do
    parent_turn = unique("turn_legacy_unique")
    step_turn = parent_turn <> ":agent:1"
    run_id = unique("run_legacy_unique")
    summary = unique("旧数据唯一历史")

    legacy =
      seed_run!(work, session, run_id, parent_turn, summary, checkpoint_version: 2)

    assert %{"agent_run" => %{"checkpoint_version" => 2, "run_id" => ^run_id}} =
             legacy.task.checkpoint_data

    record_assistant!(work, session, parent_turn, [])
    insert_trace!(work, session, parent_turn)

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(work.id, session.id, parent_turn)

    assert [%{summary: ^summary}] = report.trace_summary[:authoring_history]

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, parent_turn)

    assert Enum.map(activity.agent_runs, & &1.run_id) == [run_id]

    assert {:ok, snapshot} = WorkSessionService.show(work.id, session.id)
    assert field(agent_run_summaries_by_turn(snapshot)[parent_turn], :run_id) == run_id

    insert_step!(run_id, 1)
    insert_trace!(work, session, step_turn)

    assert {:ok, step_report} =
             TraceReplayService.fetch_turn_report(work.id, session.id, step_turn)

    assert [%{summary: ^summary}] = step_report.trace_summary[:authoring_history]

    assert {:ok, step_activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, step_turn)

    assert Enum.map(step_activity.agent_runs, & &1.run_id) == [run_id]
  end

  test "旧数据多义时不猜最新 parent，也不显示错误 run", %{
    work: work,
    session: session
  } do
    parent_turn = unique("turn_legacy_ambiguous")
    first_run = unique("run_legacy_first")
    second_run = unique("run_legacy_second")
    first_summary = unique("旧数据历史一")
    second_summary = unique("旧数据历史二")

    seed_run!(work, session, first_run, parent_turn, first_summary, checkpoint_version: 2)
    seed_run!(work, session, second_run, parent_turn, second_summary, checkpoint_version: 2)
    record_assistant!(work, session, parent_turn, [])
    insert_trace!(work, session, parent_turn)

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(work.id, session.id, parent_turn)

    assert report.replay_report.result_status == "partial"
    refute Map.has_key?(report.trace_summary, :authoring_history)
    refute inspect(report) =~ first_summary
    refute inspect(report) =~ second_summary

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, parent_turn)

    assert activity.agent_runs == []
    assert activity.provider_runs == []

    assert {:ok, snapshot} = WorkSessionService.show(work.id, session.id)
    run_summary = agent_run_summaries_by_turn(snapshot)[parent_turn]
    assert is_nil(run_summary) or is_nil(field(run_summary, :run_id))
  end

  test "旧数据多义但已记录 step 时只回查匹配 run", %{work: work, session: session} do
    parent_turn = unique("turn_legacy_step")
    step_turn = parent_turn <> ":agent:1"
    first_run = unique("run_step_match")
    second_run = unique("run_step_other")
    first_summary = unique("step 匹配历史")
    second_summary = unique("step 不匹配历史")

    seed_run!(work, session, first_run, parent_turn, first_summary, checkpoint_version: 2)
    seed_run!(work, session, second_run, parent_turn, second_summary, checkpoint_version: 2)
    insert_step!(first_run, 1)
    insert_trace!(work, session, step_turn)

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(work.id, session.id, step_turn)

    assert [%{summary: ^first_summary}] = report.trace_summary[:authoring_history]
    refute inspect(report) =~ second_summary

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, step_turn)

    assert Enum.map(activity.agent_runs, & &1.run_id) == [first_run]
  end

  test "WorkSession 重载 child 使用实际 DB 状态与计数，不用过期 TurnResult 摘要", %{
    work: work,
    session: session
  } do
    source_turn = unique("turn_reload_source")
    child_turn = unique("turn_rev_reload")
    source_run = unique("run_reload_source")
    child_run = unique("run_reload_child")
    source_summary = unique("重载源历史")
    child_summary = unique("重载修订历史")

    seed_run!(work, session, source_run, source_turn, source_summary)
    seed_run!(work, session, child_run, source_turn, child_summary)

    seed_provider_run!(work, session, child_run, unique("reload_child_a"), source_turn)
    seed_provider_run!(work, session, child_run, unique("reload_child_b"), source_turn)

    record_assistant!(work, session, source_turn,
      agent_run_id: source_run,
      agent_run: %{run_id: source_run}
    )

    stale_agent_run = %{
      run_id: child_run,
      status: "running",
      phase: "executing",
      provider_run_count: 9,
      activity_loaded: true,
      events: [%{summary: "过期事件"}],
      provider_runs: [%{provider_run_ref: "过期 ProviderRun"}]
    }

    record_assistant!(work, session, child_turn,
      agent_run_id: child_run,
      agent_run: stale_agent_run,
      parent_turn_id: source_turn
    )

    assert {:ok, snapshot} = WorkSessionService.resume(work.id)
    summaries = agent_run_summaries_by_turn(snapshot)
    reloaded = summaries[child_turn]

    assert field(reloaded, :run_id) == child_run
    assert field(reloaded, :status) == "completed"
    assert field(reloaded, :phase) == "stopped"
    assert field(reloaded, :activity_loaded) == false
    refute has_key?(reloaded, :events)
    refute has_key?(reloaded, :provider_runs)
    refute field(reloaded, :provider_run_count) in [9, "9"]

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, child_turn)

    assert activity.totals.provider_run_count == 2
    assert Enum.map(activity.agent_runs, & &1.run_id) == [child_run]
  end

  test "私有 canonical 历史按完整 run 身份回查，错绑时不落回旧 child 副本", %{
    work: work,
    session: session
  } do
    source_turn = unique("turn_private_identity")
    source_run = unique("run_private_source")
    child_run = unique("run_private_child")
    source_summary = unique("私有源历史")
    child_summary = unique("旧 child 副本")

    source_checkpoint =
      checkpoint_for(work, session, source_run, source_turn, source_summary)

    assert_complete_run_identity(
      source_checkpoint,
      work,
      session,
      source_run,
      source_turn
    )

    private_run =
      seed_run!(work, session, source_run, source_turn, source_summary,
        checkpoint: source_checkpoint,
        checkpoint_version: 3
      )

    # 私有 v3 fixture 只带引用，不内嵌 canonical；旧 child 是真正 v2 内嵌副本。
    assert %{
             "agent_run" => %{
               "checkpoint_version" => 3,
               "authoring_transcript_ref" => %{
                 "run_id" => ^source_run,
                 "version" => "authoring-transcript/v1"
               }
             }
           } = private_run.task.checkpoint_data

    refute Map.has_key?(private_run.task.checkpoint_data, "authoring_transcript")
    assert private_run.run.authoring_transcript == source_checkpoint

    seed_run!(work, session, child_run, source_turn, child_summary, checkpoint_version: 2)

    assert [%{id: ^source_run}, %{id: ^child_run}] =
             AgentRunLog.list_by_parent_turn(work.id, session.id, source_turn)

    record_assistant!(work, session, source_turn,
      agent_run_id: source_run,
      agent_run: %{run_id: source_run}
    )

    insert_trace!(work, session, source_turn)
    seed_provider_run!(work, session, source_run, unique("provider_private"), source_turn)

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(work.id, session.id, source_turn)

    assert [%{summary: ^source_summary}] = report.trace_summary[:authoring_history]
    refute inspect(report) =~ child_summary

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, source_turn)

    assert Enum.map(activity.agent_runs, & &1.run_id) == [source_run]
  end

  test "私有 canonical 身份损坏时报告 partial，不回退旧副本", %{
    work: work,
    session: session
  } do
    source_turn = unique("turn_private_corrupt")
    run_id = unique("run_private_corrupt")
    old_run = unique("run_legacy_copy")
    private_summary = unique("损坏前私有历史")
    legacy_summary = unique("旧副本历史")

    checkpoint = checkpoint_for(work, session, run_id, source_turn, private_summary)

    private_run =
      seed_run!(work, session, run_id, source_turn, private_summary,
        checkpoint: checkpoint,
        checkpoint_version: 3
      )

    assert %{
             "agent_run" => %{
               "checkpoint_version" => 3,
               "authoring_transcript_ref" => %{"run_id" => ^run_id}
             }
           } = private_run.task.checkpoint_data

    refute Map.has_key?(private_run.task.checkpoint_data, "authoring_transcript")

    # 明确故障注入：私有 canonical 的 parent_turn_ref 与记录不一致；另放一份
    # summary 不同的真正 v2 旧副本，并让它成为 parent 回退的“最新”候选。
    mismatched =
      put_in(
        checkpoint,
        ["transcript", "run", "parent_turn_ref"],
        unique("turn_private_corrupt_other")
      )

    SQL.query!(
      Repo,
      "UPDATE agent_runs SET authoring_transcript = ? WHERE id = ?",
      [Jason.encode!(mismatched), run_id]
    )

    old_copy =
      seed_run!(work, session, old_run, source_turn, legacy_summary, checkpoint_version: 2)

    assert %{"agent_run" => %{"checkpoint_version" => 2, "run_id" => ^old_run}} =
             old_copy.task.checkpoint_data

    # 旧副本必须真的带不同 summary，后面的排除断言才不是空断言。
    assert inspect(old_copy.checkpoint) =~ legacy_summary
    refute legacy_summary == private_summary

    SQL.query!(
      Repo,
      "UPDATE agent_runs SET inserted_at = ? WHERE id = ?",
      [DateTime.utc_now() |> DateTime.add(1, :second) |> DateTime.to_iso8601(), old_run]
    )

    assert [%{id: ^run_id}, %{id: ^old_run}] =
             AgentRunLog.list_by_parent_turn(work.id, session.id, source_turn)

    record_assistant!(work, session, source_turn,
      agent_run_id: run_id,
      agent_run: %{run_id: run_id}
    )

    insert_trace!(work, session, source_turn)

    assert {:ok, report} =
             TraceReplayService.fetch_turn_report(work.id, session.id, source_turn)

    assert report.replay_report.result_status == "partial"
    assert "authoring_transcript" in report.replay_report.missing_trace_refs
    refute Map.has_key?(report.trace_summary, :authoring_history)
    refute inspect(report) =~ private_summary
    refute inspect(report) =~ legacy_summary
  end

  test "作者回查不含 private marker，且回查 Provider 零调用", %{
    work: work,
    session: session
  } do
    source_turn = unique("turn_private_marker")
    run_id = unique("run_private_marker")
    marker = "B71_PRIVATE_MARKER_" <> unique("secret")

    checkpoint =
      AuthoringTranscript.new(
        %{
          run_id: run_id,
          work_id: work.id,
          workspace_id: work.id,
          session_id: session.id,
          parent_turn_ref: source_turn,
          profile_ref: "conversation_turn_v1"
        },
        base_text: "应用 Base",
        author_text: "作者原话"
      )
      |> AuthoringTranscript.append_assistant(
        "模型可见叙事 " <> marker,
        [],
        %{reasoning_content: "推理原文 " <> marker}
      )
      |> AuthoringTranscript.append_checkpoint(
        %{turn_range: "本轮"},
        [],
        %{},
        ["旧细节已省略"],
        "作者安全历史摘要"
      )
      |> AuthoringTranscript.checkpoint()
      |> db_json_roundtrip()

    seed_run!(work, session, run_id, source_turn, "作者安全历史摘要",
      checkpoint: checkpoint,
      checkpoint_version: 3
    )

    record_assistant!(work, session, source_turn,
      agent_run_id: run_id,
      agent_run: %{run_id: run_id}
    )

    insert_trace!(work, session, source_turn)

    {:ok, _event} =
      AgentRunLog.insert_event(%{
        id: unique("evt_private_marker"),
        run_id: run_id,
        step_id: "step-private-marker",
        sequence: 1,
        event_type: "run_resumed",
        visibility: "author",
        summary: "恢复可查历史。",
        reason_codes: ["durable_recovered"],
        refs: [],
        payload: %{
          "checkpoint_data" => %{
            "authoring_transcript" => %{"private" => marker}
          }
        }
      })

    {report, activity, snapshot} =
      refute_provider_called(fn ->
        assert {:ok, report} =
                 TraceReplayService.fetch_turn_report(work.id, session.id, source_turn)

        assert {:ok, activity} =
                 ProviderActivityService.fetch_turn_activity(work.id, session.id, source_turn)

        assert {:ok, snapshot} = WorkSessionService.show(work.id, session.id)

        {report, activity, snapshot}
      end)

    assert [%{summary: "作者安全历史摘要"}] = report.trace_summary[:authoring_history]
    assert report.replay_report.provider_called == false
    refute inspect(report) =~ marker
    refute inspect(activity) =~ marker
    refute inspect(snapshot) =~ marker
  end

  defp seed_run!(work, session, run_id, parent_turn, summary, opts \\ []) do
    checkpoint =
      Keyword.get_lazy(opts, :checkpoint, fn ->
        checkpoint_for(work, session, run_id, parent_turn, summary)
      end)

    checkpoint_version = Keyword.get(opts, :checkpoint_version, 3)

    facts = %{
      run_mode: Keyword.get(opts, :run_mode, "durable"),
      profile_ref: Keyword.get(opts, :profile_ref, "conversation_turn_v1"),
      status: Keyword.get(opts, :status, "completed"),
      phase: Keyword.get(opts, :phase, "stopped")
    }

    task =
      seed_task!(work, run_id, parent_turn, checkpoint, checkpoint_version, facts)

    attrs = %{
      id: run_id,
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      parent_turn_ref: parent_turn,
      origin_frame_ref: "frame-#{run_id}",
      run_mode: facts.run_mode,
      profile_ref: facts.profile_ref,
      status: facts.status,
      phase: facts.phase,
      plan_ref: "ap-#{run_id}",
      plan_version: 1,
      long_run_task_ref: task.id
    }

    attrs =
      if checkpoint_version == 3,
        do: Map.put(attrs, :authoring_transcript, checkpoint),
        else: attrs

    {:ok, run} = AgentRunLog.upsert_run(attrs)
    %{run: run, checkpoint: checkpoint, task: task}
  end

  defp seed_task!(work, run_id, parent_turn, checkpoint, checkpoint_version, facts) do
    agent_run = %{
      "run_id" => run_id,
      "run_mode" => facts.run_mode,
      "status" => facts.status,
      "phase" => facts.phase,
      "profile_ref" => facts.profile_ref,
      "goal_version" => 1,
      "checkpoint_version" => checkpoint_version
    }

    checkpoint_data =
      case checkpoint_version do
        3 ->
          %{
            "agent_run" =>
              Map.put(agent_run, "authoring_transcript_ref", %{
                "run_id" => run_id,
                "version" => "authoring-transcript/v1"
              }),
            "progress" => 100,
            "step" => "AgentRun 已提交私有历史"
          }

        2 ->
          %{
            "agent_run" => agent_run,
            "progress" => 100,
            "step" => "AgentRun 旧版内嵌历史",
            "authoring_transcript" => checkpoint
          }
      end

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: work.id,
        task_type: "agent_run",
        parent_turn_ref: parent_turn,
        status: "READY",
        phase: "PLANNED",
        checkpoint_data: checkpoint_data
      })

    task
  end

  defp checkpoint_for(work, session, run_id, parent_turn, summary) do
    AuthoringTranscript.new(
      %{
        run_id: run_id,
        work_id: work.id,
        workspace_id: work.id,
        session_id: session.id,
        parent_turn_ref: parent_turn,
        profile_ref: "conversation_turn_v1"
      },
      base_text: "应用 Base",
      author_text: "作者原话"
    )
    |> AuthoringTranscript.append_checkpoint(
      %{turn_range: "本轮"},
      [],
      %{},
      ["旧细节已省略"],
      summary
    )
    |> AuthoringTranscript.checkpoint()
    |> db_json_roundtrip()
  end

  defp assert_complete_run_identity(checkpoint, work, session, run_id, parent_turn) do
    run = get_in(checkpoint, ["transcript", "run"])

    assert run["run_id"] == run_id
    assert run["work_id"] == work.id
    assert run["workspace_id"] == work.id
    assert run["session_id"] == session.id
    assert run["parent_turn_ref"] == parent_turn
  end

  # 只模拟数据库 JSON 列的编解码；不在这里做请求 IR/投影归一，也不作为
  # fresh 与 restore 等价证据。
  defp db_json_roundtrip(value), do: value |> Jason.encode!() |> Jason.decode!()

  defp record_assistant!(work, session, turn_id, opts) do
    turn_result =
      %{turn_id: turn_id, assistant_message: %{text: "回复 #{turn_id}"}}
      |> maybe_put(:parent_turn_id, opts[:parent_turn_id])
      |> maybe_put(:agent_run, opts[:agent_run])

    content =
      %{text: "回复 #{turn_id}", turn_result: turn_result}
      |> maybe_put(:agent_run_id, opts[:agent_run_id])

    {:ok, interaction} =
      MemoryLog.record(%{
        workspace_id: work.id,
        session_id: session.id,
        turn_id: turn_id,
        role: "assistant",
        content: content,
        source_ref: turn_id,
        scope_ref: work.id
      })

    interaction
  end

  defp insert_trace!(work, session, turn_id) do
    trace_id = unique("trace")

    {:ok, _trace} =
      TraceRepository.insert(%{
        workspace_id: work.id,
        session_id: session.id,
        trace_id: trace_id,
        turn_id: turn_id,
        frame_ref: "frame-#{turn_id}",
        decision_type: "reply_only",
        no_tool_reason: "no_tool_needed",
        no_behavior_reason: "reply_only",
        no_write_reason: "no production write",
        turn_result_ref: turn_id,
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        event_order: ["author_input_received", "turn_result_emitted"]
      })

    trace_id
  end

  defp insert_step!(run_id, sequence) do
    {:ok, _step} =
      AgentRunLog.insert_step(%{
        id: "#{run_id}:step:#{sequence}",
        run_id: run_id,
        sequence: sequence,
        status: "completed",
        goal: "已记录步骤",
        idempotency_key: "#{run_id}:#{sequence}"
      })

    :ok
  end

  defp seed_provider_run!(work, session, run_id, tag, parent_turn) do
    provider_run_id = "prun-#{tag}"
    provider_call_ref = "pcall-#{tag}"

    {:ok, provider_run} =
      ProviderRun.new(%{
        provider_run_id: provider_run_id,
        provider_call_ref: provider_call_ref,
        purpose: :conversation,
        execution_mode: :event_stream,
        status: :completed,
        provider_id: "stub",
        model: "stub-model"
      })

    {:ok, provider_event} =
      ProviderEvent.new(%{
        event_id: "pevt-#{tag}",
        provider_run_ref: provider_run_id,
        sequence: 1,
        event_type: :final_output,
        visibility: :author,
        summary: "Provider final output materialized.",
        payload: %{content_length: 12},
        refs: [provider_call_ref]
      })

    {:ok, provider_output} =
      ProviderOutput.new(%{
        provider_run_ref: provider_run_id,
        provider_call_ref: provider_call_ref,
        status: :ok,
        output_type: :text,
        content: %{text: "模型输出"},
        usage: %{total_tokens: 12},
        refs: [provider_call_ref]
      })

    assert :ok =
             ProviderRunLog.record_execution(
               {:ok,
                %{
                  provider_run: provider_run,
                  events: [provider_event],
                  output: provider_output
                }},
               %{
                 agent_run_id: run_id,
                 workspace_id: work.id,
                 work_id: work.id,
                 session_id: session.id,
                 parent_turn_ref: parent_turn,
                 step_id: "step-#{tag}",
                 purpose: :conversation
               }
             )

    %{provider_run_id: provider_run_id, provider_call_ref: provider_call_ref}
  end

  defp agent_run_summaries_by_turn(snapshot) do
    Map.new(snapshot.transcript, fn entry ->
      {entry.turn_id, entry.turn_result[:agent_run]}
    end)
  end

  defp field(map, key) when is_map(map) do
    case Map.fetch(map, key) do
      {:ok, value} -> value
      :error -> Map.get(map, Atom.to_string(key))
    end
  end

  defp field(_map, _key), do: nil

  defp has_key?(map, key) when is_map(map),
    do: Map.has_key?(map, key) or Map.has_key?(map, Atom.to_string(key))

  defp has_key?(_map, _key), do: false

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp unique(prefix), do: "#{prefix}_#{System.unique_integer([:positive, :monotonic])}"

  defp refute_provider_called(fun) do
    register_provider_trace_cleanup!()
    enable_provider_trace!()

    result =
      try do
        fun.()
      after
        :erlang.trace(self(), false, [:call])
        disable_provider_trace!()
      end

    receive do
      {:trace, _pid, :call, {module, function, _args}} ->
        flunk("历史回查不得调用 Provider：#{inspect(module)}.#{function}")
    after
      50 -> result
    end
  end

  defp register_provider_trace_cleanup! do
    unless Process.get(:b71_provider_trace_cleanup_registered) do
      Process.put(:b71_provider_trace_cleanup_registered, true)
      on_exit(fn -> disable_provider_trace!() end)
    end
  end

  defp enable_provider_trace! do
    for module <- @provider_entry_modules do
      Code.ensure_loaded(module)
      :erlang.trace_pattern({module, :_, :_}, true, [:local])
    end

    :erlang.trace(self(), true, [:call])
  end

  defp disable_provider_trace! do
    for module <- @provider_entry_modules do
      :erlang.trace_pattern({module, :_, :_}, false, [:local])
    end
  end
end
