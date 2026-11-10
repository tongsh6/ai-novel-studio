defmodule NovelPersistence.AgentRunAuthoringTranscriptTest do
  @moduledoc """
  B81 CP1：run 提交与**会话级 canonical 历史**的持久化事务边界。

  `AgentRunLog.commit_snapshot/2` 现在是 run 行、可选 step/事件、durable checkpoint
  与 `authoring_segment`（段头 + 消息）的唯一事务入口；canonical 消息落在
  `authoring_session_messages`（按会话 append-only），段头落在
  `authoring_run_segments`。旧的 `agent_runs.authoring_transcript` 私有列已按未发布
  原则退役，本文件不再断言该列。

  保留的旧断言强度（不得弱化为「不抛错」）：
  - 一次事务内 run/段/消息/step/event 同时可读，任一失败全部不可见；
  - 会话级前缀不可变（回退/改写既有消息被拒绝且原行不变）；
  - run 身份不可错绑（五元组：run_id/workspace_id/work_id/session_id/parent_turn_ref）；
  - 未知版本/未知形状 fail-closed，不猜测不补造；
  - 无 canonical 增量的状态更新不得清空既有历史与 durable 段引用。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox

  alias NovelPersistence.{
    AgentRunLog,
    AuthoringSessionLog,
    LongRunTaskLog,
    Repo
  }

  alias NovelPersistence.Schemas.AuthoringRunSegment

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  # ── run 提交与状态更新 ──────────────────────────────────────────────────

  test "commit_snapshot 同事务写入 run、执行段与消息，并允许同 run 合法追加" do
    run_id = unique("run-segment")
    segment = segment(run_id, ["m1"])

    assert {:ok, run} = AgentRunLog.commit_snapshot(run_attrs(run_id), authoring_segment: segment)
    assert run.id == run_id

    assert %{header: header, messages: [m1]} = fetch_segment!(run_id)
    assert header["version"] == AuthoringSessionLog.segment_format_version()
    assert m1 == message("m1")
    assert AuthoringSessionLog.segment_present?(run_id)

    # 同 run 追加：保留前缀，只追加新消息，段范围更新。
    appended = %{header: header, messages: [message("m1"), message("m2")]}

    assert {:ok, _run} =
             AgentRunLog.commit_snapshot(run_attrs(run_id), authoring_segment: appended)

    assert %{messages: [m1, m2]} = fetch_segment!(run_id)
    assert m1 == message("m1")
    assert m2 == message("m2")
    assert Enum.map(session_messages(session_id(run_id)), & &1.sequence) == [1, 2]
  end

  test "无段增量的状态更新不清空既有段头与消息" do
    run_id = unique("run-state-only")
    assert {:ok, _run} = commit_with_segment(run_id, ["m1"])

    assert {:ok, updated} =
             AgentRunLog.commit_snapshot(
               %{
                 id: run_id,
                 workspace_id: workspace_id(run_id),
                 work_id: work_id(run_id),
                 session_id: session_id(run_id),
                 parent_turn_ref: parent_turn(run_id),
                 origin_frame_ref: "frame",
                 run_mode: "bounded",
                 profile_ref: "character_design_with_context_v1",
                 status: "completed",
                 phase: "stopped"
               },
               []
             )

    assert updated.status == "completed"
    assert %{messages: [m1]} = fetch_segment!(run_id)
    assert m1 == message("m1")
    assert length(session_messages(session_id(run_id))) == 1
  end

  test "会话级前缀不可变：回退与改写既有消息被拒绝且原行不变" do
    run_id = unique("run-prefix")
    assert {:ok, _run} = commit_with_segment(run_id, ["m1", "m2"])

    assert {:error, :authoring_history_rollback_rejected} =
             AgentRunLog.commit_snapshot(run_attrs(run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    assert {:error, :authoring_history_prefix_mismatch} =
             AgentRunLog.commit_snapshot(run_attrs(run_id),
               authoring_segment: segment(run_id, ["m1", "changed"])
             )

    assert %{messages: [m1, m2]} = fetch_segment!(run_id)
    assert m1 == message("m1")
    assert m2 == message("m2")
    assert Enum.map(session_messages(session_id(run_id)), & &1.sequence) == [1, 2]
  end

  test "可变 goal/profile 更新不影响段与消息，段身份保持不可变" do
    run_id = unique("run-mutable")
    assert {:ok, _run} = commit_with_segment(run_id, ["m1"])

    assert {:ok, updated} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id)
               |> Map.put(:profile_ref, "other_profile_v2")
               |> Map.put(:goal, %{"text" => "changed goal", "version" => 2})
               |> Map.put(:goal_version, 2),
               authoring_segment: segment(run_id, ["m1", "m2"])
             )

    assert updated.profile_ref == "other_profile_v2"
    assert updated.goal_version == 2
    assert %{messages: [m1, m2]} = fetch_segment!(run_id)
    assert [m1, m2] == [message("m1"), message("m2")]
  end

  test "段头身份与 run 行不一致时拒绝，且 run/段/消息全不可见" do
    run_id = unique("run-identity")
    tampered = segment(run_id, ["m1"]) |> put_in([:header, "run", "session_id"], "other-session")

    assert {:error, :authoring_segment_identity_mismatch} =
             AgentRunLog.commit_snapshot(run_attrs(run_id), authoring_segment: tampered)

    assert AgentRunLog.get_run(run_id) == nil
    assert Repo.get(AuthoringRunSegment, run_id) == nil
    assert session_messages(session_id(run_id)) == []
  end

  test "run 行身份缺失时提交被拒绝，且不写任何行" do
    run_id = unique("run-missing-identity")
    attrs = Map.delete(run_attrs(run_id), :session_id)

    # 提交边界先 upsert run 行，required 校验在此拦截（append_run 的
    # :authoring_run_identity_missing 由 AuthoringSessionLogTest 直接覆盖）。
    assert {:error, %Ecto.Changeset{}} =
             AgentRunLog.commit_snapshot(attrs, authoring_segment: segment(run_id, ["m1"]))

    assert Repo.get(AuthoringRunSegment, run_id) == nil
    assert session_messages(session_id(run_id)) == []
  end

  # ── durable checkpoint 段引用 ───────────────────────────────────────────

  test "commit_snapshot 同事务写 run/step/event/段/消息/durable checkpoint" do
    run_id = unique("run-snapshot")
    task = create_task(run_id)
    attrs = durable_run_attrs(run_id, task.id)

    assert {:ok, run} =
             AgentRunLog.commit_snapshot(attrs,
               steps: [step_attrs(run_id)],
               events: [event_attrs(run_id)],
               checkpoint: checkpoint(task.id, run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    assert run.id == run_id
    assert [%{status: "completed"}] = AgentRunLog.list_steps(run_id)
    assert [%{summary: "step done"}] = AgentRunLog.list_events(run_id)

    assert %{messages: [m1]} = fetch_segment!(run_id)
    assert m1 == message("m1")

    task_data = LongRunTaskLog.get(task.id).checkpoint_data
    assert task_data["agent_run"]["checkpoint_version"] == 3
    assert task_data["agent_run"]["authoring_segment_ref"] == segment_ref(run_id)
    refute Map.has_key?(task_data, "authoring_transcript")
  end

  test "durable checkpoint task 缺失时 run/段/消息/step/event 全回滚" do
    run_id = unique("run-missing-task")

    assert {:error, :checkpoint_task_missing} =
             AgentRunLog.commit_snapshot(durable_run_attrs(run_id, "missing"),
               steps: [step_attrs(run_id)],
               events: [event_attrs(run_id)],
               checkpoint: %{task_ref: "missing", attrs: %{status: "PAUSED"}},
               authoring_segment: segment(run_id, ["m1"])
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert Repo.get(AuthoringRunSegment, run_id) == nil
    assert session_messages(session_id(run_id)) == []
    assert AgentRunLog.list_steps(run_id) == []
    assert AgentRunLog.list_events(run_id) == []
  end

  test "checkpoint SQL 拒绝时既有会话历史与段引用都不前进" do
    run_id = unique("run-rejected")
    task = create_task(run_id)
    attrs = durable_run_attrs(run_id, task.id)

    assert {:ok, _run} =
             AgentRunLog.commit_snapshot(attrs,
               checkpoint: checkpoint(task.id, run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    before_task = LongRunTaskLog.get(task.id)
    before_segment = fetch_segment!(run_id)

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_private_history BEFORE UPDATE OF checkpoint_data
    ON long_run_tasks BEGIN SELECT RAISE(ABORT, 'checkpoint rejected'); END
    """)

    try do
      changed_checkpoint = %{
        task_ref: task.id,
        attrs: %{
          status: "PAUSED",
          phase: "CHECKPOINT",
          checkpoint_data: %{
            "agent_run" => %{
              "run_id" => run_id,
              "checkpoint_version" => 3,
              "authoring_segment_ref" => segment_ref(run_id)
            },
            "progress" => 51
          }
        }
      }

      assert {:error, _reason} =
               AgentRunLog.commit_snapshot(attrs,
                 checkpoint: changed_checkpoint,
                 authoring_segment: segment(run_id, ["m1", "m2"])
               )

      # 段/消息与 task 都回到提交前状态（新消息未落库）。
      assert fetch_segment!(run_id) == before_segment
      assert LongRunTaskLog.get(task.id).checkpoint_data == before_task.checkpoint_data
      assert length(session_messages(session_id(run_id))) == 1
    after
      SQL.query!(Repo, "DROP TRIGGER reject_private_history")
    end
  end

  test "段引用错绑/缺失/悬空都拒绝并回滚" do
    run_id = unique("run-segment-ref")
    task = create_task(run_id)
    attrs = durable_run_attrs(run_id, task.id)

    # 悬空引用：run 有引用但本 run 没有段。
    assert {:error, :authoring_segment_missing} =
             AgentRunLog.commit_snapshot(attrs, checkpoint: checkpoint(task.id, run_id))

    assert AgentRunLog.get_run(run_id) == nil
    assert Repo.get(AuthoringRunSegment, run_id) == nil

    # 先写入真实段与引用。
    assert {:ok, _run} =
             AgentRunLog.commit_snapshot(attrs,
               checkpoint: checkpoint(task.id, run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    # 错绑：引用指向另一 run。
    other_ref = %{
      "run_id" => "other-run",
      "version" => AuthoringSessionLog.segment_format_version()
    }

    assert {:error, :authoring_segment_ref_mismatch} =
             AgentRunLog.commit_snapshot(attrs,
               checkpoint: checkpoint(task.id, run_id, other_ref),
               authoring_segment: %{
                 header: header(run_id),
                 messages: [message("m1"), message("m2")]
               }
             )

    # 缺失：v3 header 不带引用，但会话已有段。注意 preserve_segment_ref 会为
    # 「task 已有旧 ref 的状态更新」补回旧引用，因此用新 task（尚无旧 ref）复现。
    ref_missing_task = create_task(run_id)

    assert {:error, :authoring_segment_ref_missing} =
             AgentRunLog.commit_snapshot(
               Map.put(attrs, :long_run_task_ref, ref_missing_task.id),
               checkpoint: checkpoint(ref_missing_task.id, run_id, :drop),
               authoring_segment: %{
                 header: header(run_id),
                 messages: [message("m1"), message("m2")]
               }
             )

    # 三次失败都没有前进既有历史。
    assert %{messages: [m1]} = fetch_segment!(run_id)
    assert m1 == message("m1")
  end

  test "无段增量的状态更新保留既有 durable 段引用" do
    run_id = unique("run-preserve-ref")
    task = create_task(run_id)
    attrs = durable_run_attrs(run_id, task.id)

    assert {:ok, _run} =
             AgentRunLog.commit_snapshot(attrs,
               checkpoint: checkpoint(task.id, run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    assert {:ok, _updated} =
             AgentRunLog.commit_snapshot(
               %{
                 attrs
                 | status: "paused",
                   phase: "stopped"
               },
               checkpoint: %{task_ref: task.id, attrs: %{status: "PAUSED", phase: "CHECKPOINT"}}
             )

    assert %{messages: [m1]} = fetch_segment!(run_id)
    assert m1 == message("m1")

    assert LongRunTaskLog.get(task.id).checkpoint_data["agent_run"]["authoring_segment_ref"] ==
             segment_ref(run_id)
  end

  # ── step/event/task 绑定 ────────────────────────────────────────────────

  test "step/event 错 run 时全回滚（run/段/消息/step/event 都不可见）" do
    run_id = unique("run-step-mismatch")
    task = create_task(run_id)
    attrs = durable_run_attrs(run_id, task.id)

    assert {:error, :step_run_mismatch} =
             AgentRunLog.commit_snapshot(attrs,
               steps: [Map.put(step_attrs(run_id), :run_id, "other-run")],
               events: [],
               checkpoint: checkpoint(task.id, run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert Repo.get(AuthoringRunSegment, run_id) == nil
    assert session_messages(session_id(run_id)) == []
    assert AgentRunLog.list_steps(run_id) == []

    assert {:error, :event_run_mismatch} =
             AgentRunLog.commit_snapshot(attrs,
               steps: [],
               events: [Map.put(event_attrs(run_id), :run_id, "other-run")],
               checkpoint: checkpoint(task.id, run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert Repo.get(AuthoringRunSegment, run_id) == nil
    assert session_messages(session_id(run_id)) == []
    assert AgentRunLog.list_events(run_id) == []
  end

  test "错 task 引用与 task/run 绑定不符时全回滚" do
    run_id = unique("run-task-binding")
    task = create_task(run_id)
    other_task = create_task(unique("run-other-task"))

    assert {:error, :checkpoint_task_mismatch} =
             AgentRunLog.commit_snapshot(durable_run_attrs(run_id, task.id),
               checkpoint: checkpoint(other_task.id, run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert Repo.get(AuthoringRunSegment, run_id) == nil
    assert session_messages(session_id(run_id)) == []

    wrong_workspace = create_task(run_id, %{workspace_id: "other-workspace"})

    assert {:error, :checkpoint_task_workspace_mismatch} =
             AgentRunLog.commit_snapshot(durable_run_attrs(run_id, wrong_workspace.id),
               checkpoint: checkpoint(wrong_workspace.id, run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    assert AgentRunLog.get_run(run_id) == nil

    wrong_parent = create_task(run_id, %{parent_turn_ref: "other-turn"})

    assert {:error, :checkpoint_task_parent_mismatch} =
             AgentRunLog.commit_snapshot(durable_run_attrs(run_id, wrong_parent.id),
               checkpoint: checkpoint(wrong_parent.id, run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    assert AgentRunLog.get_run(run_id) == nil
  end

  test "同作品同父轮次的另一 run 不能接管已绑定 task" do
    run_id = unique("run-bound")
    hijack_id = unique("run-hijack")
    task = create_task(run_id)

    hijack_attrs = %{
      id: hijack_id,
      workspace_id: workspace_id(run_id),
      work_id: work_id(run_id),
      session_id: session_id(run_id),
      parent_turn_ref: parent_turn(run_id),
      origin_frame_ref: "frame",
      run_mode: "durable",
      profile_ref: "character_design_with_context_v1",
      status: "running",
      phase: "executing",
      long_run_task_ref: task.id
    }

    # 段头身份必须与 hijack run 行一致，才能越过 append 身份校验、命中 task 绑定冲突。
    hijack_segment = %{
      header:
        header(hijack_id, %{}, %{
          "workspace_id" => workspace_id(run_id),
          "work_id" => work_id(run_id),
          "session_id" => session_id(run_id),
          "parent_turn_ref" => parent_turn(run_id)
        }),
      messages: [message("m1")]
    }

    assert {:error, :checkpoint_task_run_mismatch} =
             AgentRunLog.commit_snapshot(hijack_attrs,
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{
                     "agent_run" => %{"run_id" => hijack_id, "checkpoint_version" => 3}
                   }
                 }
               },
               authoring_segment: hijack_segment
             )

    assert AgentRunLog.get_run(hijack_id) == nil
    assert Repo.get(AuthoringRunSegment, hijack_id) == nil
    assert session_messages(session_id(run_id)) == []
    assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data
  end

  test "checkpoint header 的 run_id 必须与当前 run 一致" do
    run_id = unique("run-header")
    task = create_task(run_id)

    assert {:error, :checkpoint_run_mismatch} =
             AgentRunLog.commit_snapshot(durable_run_attrs(run_id, task.id),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{
                     agent_run: %{run_id: "other-run", checkpoint_version: 3}
                   }
                 }
               },
               authoring_segment: segment(run_id, ["m1"])
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert Repo.get(AuthoringRunSegment, run_id) == nil
  end

  test "拒绝新写入 v2 header 或空 agent_run" do
    run_id = unique("run-v2-write")
    task = create_task(run_id)

    assert {:error, :checkpoint_version_not_writable} =
             AgentRunLog.commit_snapshot(durable_run_attrs(run_id, task.id),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{
                     "agent_run" => %{"run_id" => run_id, "checkpoint_version" => 2}
                   }
                 }
               },
               authoring_segment: segment(run_id, ["m1"])
             )

    assert AgentRunLog.get_run(run_id) == nil

    assert {:error, :checkpoint_header_missing} =
             AgentRunLog.commit_snapshot(durable_run_attrs(run_id, task.id),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{}
                 }
               },
               authoring_segment: segment(run_id, ["m1"])
             )

    assert AgentRunLog.get_run(run_id) == nil
  end

  test "只更新 task 状态且不提供 checkpoint_data 时保留既有 v3 header" do
    run_id = unique("run-status-only")
    task = create_task(run_id)
    attrs = durable_run_attrs(run_id, task.id)

    assert {:ok, _run} =
             AgentRunLog.commit_snapshot(attrs,
               checkpoint: checkpoint(task.id, run_id),
               authoring_segment: segment(run_id, ["m1"])
             )

    before = LongRunTaskLog.get(task.id).checkpoint_data

    assert {:ok, _updated} =
             AgentRunLog.commit_snapshot(%{attrs | status: "paused", phase: "stopped"},
               checkpoint: %{task_ref: task.id, attrs: %{status: "PAUSED", phase: "CHECKPOINT"}}
             )

    assert LongRunTaskLog.get(task.id).checkpoint_data == before
  end

  # ── 未知版本 / 写失败回滚 ───────────────────────────────────────────────

  test "未知段版本与空历史经 commit_snapshot 传导为错误且全回滚" do
    run_id = unique("run-bad-version")
    task = create_task(run_id)
    attrs = durable_run_attrs(run_id, task.id)

    bad_version =
      segment(run_id, ["m1"])
      |> put_in([:header, "version"], "authoring-run-segment/v0")

    assert {:error, :authoring_segment_version_unsupported} =
             AgentRunLog.commit_snapshot(attrs,
               checkpoint: checkpoint(task.id, run_id),
               authoring_segment: bad_version
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert Repo.get(AuthoringRunSegment, run_id) == nil
    assert session_messages(session_id(run_id)) == []

    assert {:error, :authoring_segment_empty_history} =
             AgentRunLog.commit_snapshot(attrs,
               checkpoint: checkpoint(task.id, run_id),
               authoring_segment: %{header: header(run_id), messages: []}
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert session_messages(session_id(run_id)) == []
  end

  test "消息写入 SQL 拒绝时整个提交回滚（run/段/消息/step/event 都不可见）" do
    run_id = unique("run-message-reject")
    task = create_task(run_id)

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_authoring_message BEFORE INSERT ON authoring_session_messages
    BEGIN SELECT RAISE(ABORT, 'message rejected'); END
    """)

    try do
      # RAISE(ABORT) 在 Ecto 侧表现为异常（commit_snapshot 的 rescue 边界），
      # 因此断言「失败」而不绑定 changeset 原子；回滚语义仍是强断言。
      assert {:error, _reason} =
               AgentRunLog.commit_snapshot(durable_run_attrs(run_id, task.id),
                 steps: [step_attrs(run_id)],
                 events: [event_attrs(run_id)],
                 checkpoint: checkpoint(task.id, run_id),
                 authoring_segment: segment(run_id, ["m1"])
               )

      assert AgentRunLog.get_run(run_id) == nil
      assert Repo.get(AuthoringRunSegment, run_id) == nil
      assert session_messages(session_id(run_id)) == []
      assert AgentRunLog.list_steps(run_id) == []
      assert AgentRunLog.list_events(run_id) == []

      assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data
    after
      SQL.query!(Repo, "DROP TRIGGER reject_authoring_message")
    end
  end

  test "段头写入 SQL 拒绝时整个提交回滚（已插入消息一并回滚）" do
    run_id = unique("run-segment-reject")
    task = create_task(run_id)

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_authoring_segment BEFORE INSERT ON authoring_run_segments
    BEGIN SELECT RAISE(ABORT, 'segment rejected'); END
    """)

    try do
      assert {:error, _reason} =
               AgentRunLog.commit_snapshot(durable_run_attrs(run_id, task.id),
                 checkpoint: checkpoint(task.id, run_id),
                 authoring_segment: segment(run_id, ["m1"])
               )

      assert AgentRunLog.get_run(run_id) == nil
      assert Repo.get(AuthoringRunSegment, run_id) == nil
      assert session_messages(session_id(run_id)) == []
    after
      SQL.query!(Repo, "DROP TRIGGER reject_authoring_segment")
    end
  end

  # ── helpers ─────────────────────────────────────────────────────────────

  defp commit_with_segment(run_id, texts) do
    AgentRunLog.commit_snapshot(run_attrs(run_id), authoring_segment: segment(run_id, texts))
  end

  defp fetch_segment!(run_id) do
    assert {:ok, %{} = segment} = AuthoringSessionLog.fetch_run_segment(run_id)
    segment
  end

  defp session_messages(session_id) do
    assert {:ok, %{rows: rows}} = AuthoringSessionLog.fetch_session(session_id)
    rows
  end

  defp run_attrs(run_id, overrides \\ %{}) do
    Map.merge(
      %{
        id: run_id,
        workspace_id: workspace_id(run_id),
        work_id: work_id(run_id),
        session_id: session_id(run_id),
        parent_turn_ref: parent_turn(run_id),
        origin_frame_ref: "frame",
        run_mode: "bounded",
        profile_ref: "character_design_with_context_v1",
        status: "running",
        phase: "executing",
        goal: %{"text" => "goal", "version" => 1},
        goal_version: 1
      },
      overrides
    )
  end

  defp durable_run_attrs(run_id, task_id) do
    run_attrs(run_id, %{run_mode: "durable", long_run_task_ref: task_id})
  end

  defp segment(run_id, texts) do
    %{header: header(run_id), messages: Enum.map(texts, &message/1)}
  end

  defp header(run_id, header_overrides \\ %{}, run_overrides \\ %{}) do
    Map.merge(
      %{
        "version" => AuthoringSessionLog.segment_format_version(),
        "run" =>
          Map.merge(
            %{
              "run_id" => run_id,
              "workspace_id" => workspace_id(run_id),
              "work_id" => work_id(run_id),
              "session_id" => session_id(run_id),
              "parent_turn_ref" => parent_turn(run_id)
            },
            Map.new(run_overrides)
          ),
        "system" => %{},
        "tools" => [],
        "projection" => %{},
        "base_refs" => [],
        "observation_refs" => [],
        "used_refs" => [],
        "call_ids" => []
      },
      Map.new(header_overrides)
    )
  end

  defp message(text) do
    %{
      "role" => "user",
      "provenance" => "author",
      "blocks" => [%{"type" => "text", "text" => text}],
      "source_refs" => [%{"ref" => text}]
    }
  end

  defp segment_ref(run_id) do
    %{
      "run_id" => run_id,
      "version" => AuthoringSessionLog.segment_format_version()
    }
  end

  defp checkpoint(task_id, run_id, ref \\ :default) do
    agent_run =
      %{
        "run_id" => run_id,
        "checkpoint_version" => 3
      }
      |> maybe_put_segment_ref(run_id, ref)

    %{
      task_ref: task_id,
      attrs: %{
        status: "PAUSED",
        phase: "CHECKPOINT",
        checkpoint_data: %{"agent_run" => agent_run}
      }
    }
  end

  defp maybe_put_segment_ref(agent_run, _run_id, :drop), do: agent_run

  defp maybe_put_segment_ref(agent_run, run_id, :default),
    do: Map.put(agent_run, "authoring_segment_ref", segment_ref(run_id))

  defp maybe_put_segment_ref(agent_run, _run_id, ref),
    do: Map.put(agent_run, "authoring_segment_ref", ref)

  defp step_attrs(run_id) do
    %{
      id: "step-#{run_id}",
      run_id: run_id,
      sequence: 1,
      status: "completed",
      goal: "step",
      idempotency_key: "#{run_id}:1"
    }
  end

  defp event_attrs(run_id) do
    %{
      id: "evt-#{run_id}",
      run_id: run_id,
      sequence: 1,
      event_type: "run_started",
      visibility: "author",
      summary: "step done"
    }
  end

  defp create_task(run_id, overrides \\ %{}) do
    attrs =
      Map.merge(
        %{
          workspace_id: work_id(run_id),
          task_type: "agent_run",
          status: "PAUSED",
          phase: "CHECKPOINT",
          goal: "private history task",
          scope_ref: work_id(run_id),
          created_by: "agent_run",
          parent_turn_ref: parent_turn(run_id),
          checkpoint_data: %{
            "agent_run" => %{"run_id" => run_id, "checkpoint_version" => 3}
          }
        },
        overrides
      )

    {:ok, task} = LongRunTaskLog.create(attrs)
    task
  end

  defp workspace_id(run_id), do: "ws-#{run_id}"
  defp work_id(run_id), do: "work-#{run_id}"
  defp session_id(run_id), do: "sess-#{run_id}"
  defp parent_turn(run_id), do: "turn-#{run_id}"

  defp unique(prefix), do: "#{prefix}-#{System.unique_integer([:positive, :monotonic])}"
end
