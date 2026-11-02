defmodule NovelPersistence.AgentRunAuthoringTranscriptTest do
  use ExUnit.Case, async: true

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelPersistence.{AgentRunLog, LongRunTaskLog, Repo}
  alias NovelPersistence.Schemas.AgentRunRecord

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "persists authoring transcript, preserves it on state-only update and allows append/idempotent write" do
    run_id = unique("run-private")
    checkpoint = checkpoint(run_id, ["m1"])

    assert {:ok, run} = AgentRunLog.upsert_run(run_attrs(run_id, checkpoint))
    assert run.authoring_transcript["transcript"]["messages"] == [message("m1")]

    assert {:ok, status_updated} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: workspace_id(run_id),
               work_id: run_id,
               session_id: session_id(run_id),
               parent_turn_ref: parent_turn(run_id),
               origin_frame_ref: "frame",
               run_mode: "bounded",
               profile_ref: "character_design_with_context_v1",
               status: "completed",
               phase: "stopped"
             })

    assert status_updated.authoring_transcript == checkpoint

    assert {:ok, _same} = AgentRunLog.upsert_run(run_attrs(run_id, checkpoint))

    appended = checkpoint(run_id, ["m1", "m2"])
    assert {:ok, _appended} = AgentRunLog.upsert_run(run_attrs(run_id, appended))
    assert AgentRunLog.get_run(run_id).authoring_transcript == appended
  end

  test "rejects explicit clearing of existing private history" do
    run_id = unique("run-clear")

    assert {:ok, _run} =
             AgentRunLog.upsert_run(run_attrs(run_id, checkpoint(run_id, ["m1"])))

    assert {:error, changeset} =
             AgentRunLog.upsert_run(Map.put(run_attrs(run_id, nil), :authoring_transcript, nil))

    assert errors_on(changeset)[:authoring_transcript] == [
             "cannot clear existing private history"
           ]

    assert AgentRunLog.get_run(run_id).authoring_transcript["transcript"]["messages"] ==
             [message("m1")]
  end

  test "rejects truncation and overwriting of already persisted messages" do
    run_id = unique("run-prefix")

    assert {:ok, _run} =
             AgentRunLog.upsert_run(run_attrs(run_id, checkpoint(run_id, ["m1", "m2"])))

    assert {:error, truncated} =
             AgentRunLog.upsert_run(run_attrs(run_id, checkpoint(run_id, ["m1"])))

    assert errors_on(truncated)[:authoring_transcript] == [
             "must preserve existing private history"
           ]

    overwritten = checkpoint(run_id, ["m1", "changed"])
    assert {:error, replaced} = AgentRunLog.upsert_run(run_attrs(run_id, overwritten))

    assert errors_on(replaced)[:authoring_transcript] == [
             "must preserve existing private history"
           ]

    assert AgentRunLog.get_run(run_id).authoring_transcript["transcript"]["messages"] ==
             [message("m1"), message("m2")]
  end

  test "rejects run identity mismatch across session, parent, workspace, work and run" do
    for field <- [:run_id, :workspace_id, :work_id, :session_id, :parent_turn_ref] do
      run_id = unique("run-identity")
      checkpoint = checkpoint(run_id, ["m1"])

      mismatched =
        update_in(checkpoint, ["transcript", "run", Atom.to_string(field)], fn _ ->
          "other-#{field}"
        end)

      assert {:error, changeset} =
               AgentRunLog.upsert_run(run_attrs(run_id, mismatched)),
             "expected #{field} mismatch to be rejected"

      assert messages = errors_on(changeset)[:authoring_transcript]
      assert Enum.any?(messages, &(&1 =~ "identity"))
    end
  end

  test "allows mutable goal and profile changes while keeping immutable identity" do
    run_id = unique("run-mutable")

    assert {:ok, _run} =
             AgentRunLog.upsert_run(run_attrs(run_id, checkpoint(run_id, ["m1"])))

    assert {:ok, updated} =
             AgentRunLog.upsert_run(
               run_attrs(run_id, checkpoint(run_id, ["m1", "m2"]))
               |> Map.put(:profile_ref, "other_profile_v2")
               |> Map.put(:goal, %{"text" => "changed goal", "version" => 2})
               |> Map.put(:goal_version, 2)
             )

    assert updated.profile_ref == "other_profile_v2"
    assert updated.goal_version == 2

    assert updated.authoring_transcript["transcript"]["messages"] == [
             message("m1"),
             message("m2")
           ]
  end

  test "commit_snapshot writes run, step, event and durable checkpoint in one transaction" do
    run_id = unique("run-snapshot")
    task = create_task(run_id)
    checkpoint = checkpoint(run_id, ["m1"])

    assert {:ok, run} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint, %{run_mode: "durable", long_run_task_ref: task.id}),
               steps: [step_attrs(run_id)],
               events: [event_attrs(run_id)],
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{
                     "agent_run" => %{
                       "run_id" => run_id,
                       "checkpoint_version" => 3,
                       "authoring_transcript_ref" => transcript_ref(run_id)
                     }
                   }
                 }
               }
             )

    assert run.authoring_transcript == checkpoint
    assert [%{status: "completed"}] = AgentRunLog.list_steps(run_id)
    assert [%{summary: "step done"}] = AgentRunLog.list_events(run_id)
    assert LongRunTaskLog.get(task.id).checkpoint_data["agent_run"]["checkpoint_version"] == 3
  end

  test "commit_snapshot rolls back run, step and event when durable checkpoint task is missing" do
    run_id = unique("run-missing-task")
    checkpoint = checkpoint(run_id, ["m1"])

    assert {:error, :checkpoint_task_missing} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint, %{run_mode: "durable", long_run_task_ref: "missing"}),
               steps: [step_attrs(run_id)],
               events: [event_attrs(run_id)],
               checkpoint: %{task_ref: "missing", attrs: %{status: "PAUSED"}}
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert AgentRunLog.list_steps(run_id) == []
    assert AgentRunLog.list_events(run_id) == []
  end

  test "commit_snapshot does not advance run private history when checkpoint SQL rejects" do
    run_id = unique("run-rejected")
    task = create_task(run_id)
    before = checkpoint(run_id, ["m1"])

    assert {:ok, _run} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, before, %{run_mode: "durable", long_run_task_ref: task.id}),
               []
             )

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_private_history BEFORE UPDATE OF checkpoint_data
    ON long_run_tasks BEGIN SELECT RAISE(ABORT, 'checkpoint rejected'); END
    """)

    try do
      assert {:error, _reason} =
               AgentRunLog.commit_snapshot(
                 run_attrs(run_id, checkpoint(run_id, ["m1", "m2"]), %{
                   run_mode: "durable",
                   long_run_task_ref: task.id
                 }),
                 checkpoint: %{
                   task_ref: task.id,
                   attrs: %{
                     status: "PAUSED",
                     phase: "CHECKPOINT",
                     checkpoint_data: %{
                       "agent_run" => %{
                         "run_id" => run_id,
                         "checkpoint_version" => 3,
                         "authoring_transcript_ref" => transcript_ref(run_id)
                       }
                     }
                   }
                 }
               )

      assert AgentRunLog.get_run(run_id).authoring_transcript == before
      assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data
    after
      SQL.query!(Repo, "DROP TRIGGER reject_private_history")
    end
  end

  test "已有历史时普通更新不能改变不可变 row 身份" do
    run_id = unique("run-immutable-row")
    record = record_with_history(run_id)

    changeset = AgentRunRecord.changeset(record, %{session_id: "other-session"})

    refute changeset.valid?

    assert errors_on(changeset)[:session_id] == [
             "cannot change immutable run identity with existing private history"
           ]
  end

  test "同时重绑 row 和 canonical 也不能改变旧历史身份" do
    run_id = unique("run-immutable-both")
    old = record_with_history(run_id)

    rebound =
      put_in(old.authoring_transcript, ["transcript", "run", "session_id"], "other-session")

    changeset =
      AgentRunRecord.changeset(old, %{
        session_id: "other-session",
        authoring_transcript: rebound
      })

    refute changeset.valid?

    assert errors_on(changeset)[:session_id] == [
             "cannot change immutable run identity with existing private history"
           ]
  end

  test "缺字段/空 map/坏层级/非 list messages/未知版本都是 changeset error 而非异常" do
    run_id = unique("run-invalid-shape")
    record = %AgentRunRecord{}

    shapes = [
      {"empty", %{}},
      {"missing version", %{"transcript" => valid_transcript(run_id, ["m1"])}},
      {"nil transcript", %{"version" => "authoring-transcript/v1", "transcript" => nil}},
      {"nil run",
       %{
         "version" => "authoring-transcript/v1",
         "transcript" => %{"run" => nil, "messages" => []}
       }},
      {"non-list messages",
       %{
         "version" => "authoring-transcript/v1",
         "transcript" => %{"run" => identity(run_id), "messages" => %{}}
       }},
      {"unknown version",
       %{
         "version" => "unknown",
         "transcript" => valid_transcript(run_id, ["m1"])
       }}
    ]

    for {label, shape} <- shapes do
      changeset = AgentRunRecord.changeset(record, %{authoring_transcript: shape})
      refute changeset.valid?, "expected #{label} to be invalid"
      assert errors_on(changeset)[:authoring_transcript]
    end
  end

  test "commit_snapshot 拒绝 step/event 错 run 并完整回滚 run" do
    run_id = unique("run-step-mismatch")
    task = create_task(run_id)

    assert {:error, :step_run_mismatch} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               steps: [Map.put(step_attrs(run_id), :run_id, "other-run")],
               events: [],
               checkpoint: durable_checkpoint(task.id, run_id)
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert AgentRunLog.list_steps(run_id) == []
    assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data

    assert {:error, :event_run_mismatch} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               steps: [],
               events: [Map.put(event_attrs(run_id), :run_id, "other-run")],
               checkpoint: durable_checkpoint(task.id, run_id)
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert AgentRunLog.list_events(run_id) == []
    assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data
  end

  test "commit_snapshot 拒绝错 task 引用与 task/run 绑定不符并回滚" do
    run_id = unique("run-task-binding")
    task = create_task(run_id)
    other_task = create_task(unique("run-other-task"))

    assert {:error, :checkpoint_task_mismatch} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               checkpoint: durable_checkpoint(other_task.id, run_id)
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data
    assert LongRunTaskLog.get(other_task.id).checkpoint_data == other_task.checkpoint_data

    wrong_workspace = create_task(run_id, %{workspace_id: "other-workspace"})

    assert {:error, :checkpoint_task_workspace_mismatch} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: wrong_workspace.id
               }),
               checkpoint: durable_checkpoint(wrong_workspace.id, run_id)
             )

    assert AgentRunLog.get_run(run_id) == nil

    assert LongRunTaskLog.get(wrong_workspace.id).checkpoint_data ==
             wrong_workspace.checkpoint_data

    wrong_parent = create_task(run_id, %{parent_turn_ref: "other-turn"})

    assert {:error, :checkpoint_task_parent_mismatch} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: wrong_parent.id
               }),
               checkpoint: durable_checkpoint(wrong_parent.id, run_id)
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert LongRunTaskLog.get(wrong_parent.id).checkpoint_data == wrong_parent.checkpoint_data
  end

  test "commit_snapshot 拒绝 v3 引用错绑或缺失并回滚" do
    run_id = unique("run-v3-ref")
    task = create_task(run_id)

    assert {:error, :authoring_transcript_ref_mismatch} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{
                     "agent_run" => %{
                       "run_id" => run_id,
                       "checkpoint_version" => 3,
                       "authoring_transcript_ref" => transcript_ref("other-run")
                     }
                   }
                 }
               }
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data

    assert {:error, :authoring_transcript_ref_missing} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{
                     "agent_run" => %{"run_id" => run_id, "checkpoint_version" => 3}
                   }
                 }
               }
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data
  end

  test "无 transcript 增量的状态更新保留既有 v3 引用" do
    run_id = unique("run-preserve-ref")
    task = create_task(run_id)

    assert {:ok, _run} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               checkpoint: durable_checkpoint(task.id, run_id)
             )

    assert {:ok, _updated} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, nil, %{
                 run_mode: "durable",
                 long_run_task_ref: task.id,
                 status: "paused",
                 phase: "stopped"
               }),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{
                     "agent_run" => %{"run_id" => run_id, "checkpoint_version" => 3}
                   }
                 }
               }
             )

    assert AgentRunLog.get_run(run_id).authoring_transcript == checkpoint(run_id, ["m1"])

    assert LongRunTaskLog.get(task.id).checkpoint_data["agent_run"]["authoring_transcript_ref"] ==
             transcript_ref(run_id)
  end

  test "commit_snapshot 拒绝同作品同父轮次的另一 run 接管已绑定 task" do
    run_id = unique("run-bound")
    hijack_id = unique("run-hijack")
    task = create_task(run_id)

    hijack_identity = %{
      "workspace_id" => workspace_id(run_id),
      "work_id" => run_id,
      "session_id" => session_id(run_id),
      "parent_turn_ref" => parent_turn(run_id)
    }

    hijack_attrs = %{
      id: hijack_id,
      workspace_id: workspace_id(run_id),
      work_id: run_id,
      session_id: session_id(run_id),
      parent_turn_ref: parent_turn(run_id),
      origin_frame_ref: "frame",
      run_mode: "durable",
      profile_ref: "character_design_with_context_v1",
      status: "running",
      phase: "executing",
      long_run_task_ref: task.id,
      authoring_transcript: checkpoint(hijack_id, ["m1"], hijack_identity)
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
               }
             )

    assert AgentRunLog.get_run(hijack_id) == nil
    assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data
  end

  test "commit_snapshot 要求新 checkpoint header 的 run_id 与当前 run 一致" do
    run_id = unique("run-header")
    task = create_task(run_id)

    assert {:error, :checkpoint_run_mismatch} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{
                     agent_run: %{run_id: "other-run", checkpoint_version: 3}
                   }
                 }
               }
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data
  end

  test "commit_snapshot 拒绝新写入 v2 header 或空 agent_run" do
    run_id = unique("run-v2-write")
    task = create_task(run_id)

    assert {:error, :checkpoint_version_not_writable} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{
                     "agent_run" => %{"run_id" => run_id, "checkpoint_version" => 2}
                   }
                 }
               }
             )

    assert AgentRunLog.get_run(run_id) == nil

    assert {:error, :checkpoint_header_missing} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{}
                 }
               }
             )

    assert AgentRunLog.get_run(run_id) == nil
    assert LongRunTaskLog.get(task.id).checkpoint_data == task.checkpoint_data
  end

  test "旧 v2 canonical 在 snapshot 中只读，状态更新保留 header，新写入不覆盖" do
    run_id = unique("run-v2-readonly")
    legacy = checkpoint(run_id, ["legacy"])

    task =
      create_task(run_id, %{
        checkpoint_data: %{
          "agent_run" => %{"run_id" => run_id, "checkpoint_version" => 2},
          "authoring_transcript" => legacy
        }
      })

    assert {:ok, _run} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, nil, %{
                 run_mode: "durable",
                 long_run_task_ref: task.id,
                 status: "paused",
                 phase: "stopped"
               }),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{status: "PAUSED", phase: "CHECKPOINT"}
               }
             )

    preserved = LongRunTaskLog.get(task.id)
    assert preserved.checkpoint_data["agent_run"]["checkpoint_version"] == 2
    assert preserved.checkpoint_data["authoring_transcript"] == legacy

    assert {:error, :legacy_checkpoint_read_only} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{
                   status: "PAUSED",
                   phase: "CHECKPOINT",
                   checkpoint_data: %{
                     "agent_run" => %{
                       "run_id" => run_id,
                       "checkpoint_version" => 3,
                       "authoring_transcript_ref" => transcript_ref(run_id)
                     }
                   }
                 }
               }
             )

    assert AgentRunLog.get_run(run_id).authoring_transcript == nil
    assert LongRunTaskLog.get(task.id).checkpoint_data["authoring_transcript"] == legacy
  end

  test "只更新 task 状态且不提供 checkpoint_data 时保留既有 v3 header" do
    run_id = unique("run-status-only")
    task = create_task(run_id)

    assert {:ok, _run} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, checkpoint(run_id, ["m1"]), %{
                 run_mode: "durable",
                 long_run_task_ref: task.id
               }),
               checkpoint: durable_checkpoint(task.id, run_id)
             )

    before = LongRunTaskLog.get(task.id).checkpoint_data

    assert {:ok, _updated} =
             AgentRunLog.commit_snapshot(
               run_attrs(run_id, nil, %{
                 run_mode: "durable",
                 long_run_task_ref: task.id,
                 status: "paused",
                 phase: "stopped"
               }),
               checkpoint: %{
                 task_ref: task.id,
                 attrs: %{status: "PAUSED", phase: "CHECKPOINT"}
               }
             )

    assert LongRunTaskLog.get(task.id).checkpoint_data == before
  end

  defp run_attrs(run_id, checkpoint, overrides \\ %{}) do
    %{
      id: run_id,
      workspace_id: workspace_id(run_id),
      work_id: run_id,
      session_id: session_id(run_id),
      parent_turn_ref: parent_turn(run_id),
      origin_frame_ref: "frame",
      run_mode: "bounded",
      profile_ref: "character_design_with_context_v1",
      status: "running",
      phase: "executing",
      goal: %{"text" => "goal", "version" => 1},
      goal_version: 1
    }
    |> maybe_put_private(checkpoint)
    |> Map.merge(overrides)
  end

  defp maybe_put_private(attrs, nil), do: attrs
  defp maybe_put_private(attrs, checkpoint), do: Map.put(attrs, :authoring_transcript, checkpoint)

  defp record_with_history(run_id) do
    struct(AgentRunRecord, run_attrs(run_id, checkpoint(run_id, ["m1"])))
  end

  defp identity(run_id) do
    %{
      "run_id" => run_id,
      "workspace_id" => workspace_id(run_id),
      "work_id" => run_id,
      "session_id" => session_id(run_id),
      "parent_turn_ref" => parent_turn(run_id)
    }
  end

  defp valid_transcript(run_id, refs) do
    %{"run" => identity(run_id), "messages" => Enum.map(refs, &message/1)}
  end

  defp transcript_ref(run_id) do
    %{"run_id" => run_id, "version" => "authoring-transcript/v1"}
  end

  defp durable_checkpoint(task_id, run_id) do
    %{
      task_ref: task_id,
      attrs: %{
        status: "PAUSED",
        phase: "CHECKPOINT",
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "checkpoint_version" => 3,
            "authoring_transcript_ref" => transcript_ref(run_id)
          }
        }
      }
    }
  end

  defp checkpoint(run_id, refs, identity_overrides \\ %{}) do
    %{
      "version" => "authoring-transcript/v1",
      "transcript" => %{
        "run" => Map.merge(identity(run_id), identity_overrides),
        "messages" => Enum.map(refs, &message/1)
      }
    }
  end

  defp message(ref) do
    %{
      "role" => "user",
      "provenance" => "author",
      "blocks" => [%{"type" => "text", "text" => ref}],
      "source_refs" => [%{"ref" => ref}]
    }
  end

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
          workspace_id: run_id,
          task_type: "agent_run",
          status: "PAUSED",
          phase: "CHECKPOINT",
          goal: "private history task",
          scope_ref: run_id,
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
  defp session_id(run_id), do: "sess-#{run_id}"
  defp parent_turn(run_id), do: "turn-#{run_id}"

  defp unique(prefix), do: "#{prefix}-#{System.unique_integer([:positive, :monotonic])}"

  defp errors_on(changeset), do: Ecto.Changeset.traverse_errors(changeset, fn {msg, _} -> msg end)
end
