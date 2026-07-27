defmodule NovelWeb.WorkspaceChannelTaskStateTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AgentRunService
  alias NovelApplication.WorkService
  alias NovelApplication.WorkSessionService
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{AgentRunLog, LongRunTaskLog, MemoryLog, Repo, WorkSessionRepo}
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume
  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint

  setup do
    pid = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(pid) end)
    :ok
  end

  test "join restores turn results from the requested session rather than work-level resume" do
    {:ok, work} = WorkService.create(%{"title" => "会话绑定作品"})
    {:ok, requested} = WorkSessionRepo.create(%{work_id: work.id, title: "目标会话"})

    requested_turn_result = %{
      turn_id: "turn-requested",
      assistant_message: %{text: "目标会话回应"}
    }

    {:ok, _} =
      MemoryLog.record(%{
        workspace_id: work.id,
        session_id: requested.id,
        turn_id: "turn-requested",
        role: "assistant",
        content: %{text: "目标会话回应", turn_result: requested_turn_result}
      })

    Process.sleep(5)
    {:ok, other} = WorkSessionRepo.create(%{work_id: work.id, title: "另一个活动会话"})

    {:ok, _} =
      MemoryLog.record(%{
        workspace_id: work.id,
        session_id: other.id,
        turn_id: "turn-other",
        role: "assistant",
        content: %{
          text: "另一个会话回应",
          turn_result: %{turn_id: "turn-other", assistant_message: %{text: "另一个会话回应"}}
        }
      })

    {:ok, reply, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => requested.id
      })

    assert reply.session_id == requested.id
    assert socket.assigns.session_id == requested.id
    assert Map.has_key?(socket.assigns.turn_results_by_id, "turn-requested")
    refute Map.has_key?(socket.assigns.turn_results_by_id, "turn-other")
  end

  test "user_message makes the channel session the resume target" do
    {:ok, work} = WorkService.create(%{"title" => "作者输入绑定作品"})
    {:ok, requested} = WorkSessionRepo.create(%{work_id: work.id, title: "作者正在写的会话"})
    Process.sleep(5)
    {:ok, other} = WorkSessionRepo.create(%{work_id: work.id, title: "并发启动空会话"})

    {:ok, _reply, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => requested.id
      })

    ref = push(socket, "user_message", %{"text" => "继续讨论"})

    assert_reply(ref, :ok, %{received: true, run_id: run_id, run_mode: "bounded"})
    assert is_binary(run_id)
    assert WorkSessionRepo.get_by_work(work.id, requested.id).status == "ACTIVE"
    assert WorkSessionRepo.get_by_work(work.id, other.id).status == "EXITED"

    assert {:ok, %{active_session: %{id: active_id}}} = WorkSessionService.resume(work.id)
    assert active_id == requested.id

    cancel_and_wait_for_agent_run(run_id)
  end

  test "export_work broadcasts persisted task_state lifecycle for a real visible export action" do
    work = seed_exportable_work!()

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{"work_id" => work.id})

    ref = push(socket, "export_work", %{"work_id" => work.id})

    assert_reply(ref, :ok, %{format: "markdown"})

    assert_broadcast("task_state", %{
      task_id: task_id,
      task_type: "export_work",
      phase: "RUNNING",
      status: "RUNNING",
      progress: 10
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "CHECKPOINT",
      status: "PAUSED",
      progress: 10,
      step: "正在准备导出"
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "CHECKPOINT",
      progress: 25,
      step: "正在读取章节内容"
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "CHECKPOINT",
      progress: 60,
      step: "正在渲染全书 Markdown"
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "CHECKPOINT",
      progress: 80,
      step: "正在写入文件"
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "COMPLETED",
      status: "DONE",
      progress: 100
    })
  end

  test "export_work broadcasts FAILED task_state on real export failure" do
    {:ok, work} = WorkService.create(%{"title" => "空作品"})

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{"work_id" => work.id})

    ref = push(socket, "export_work", %{"work_id" => work.id})

    assert_reply(ref, :error, %{reason: "nothing_to_export"})

    assert_broadcast("task_state", %{task_id: task_id, task_type: "export_work", phase: "RUNNING"})

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "CHECKPOINT",
      progress: 10,
      step: "正在准备导出"
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "FAILED",
      status: "ERROR",
      progress: 100
    })
  end

  test "export_work uses the joined workspace instead of a mismatched payload work_id" do
    work = seed_exportable_work!()
    {:ok, other_work} = WorkService.create(%{"title" => "其它空作品"})

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{"work_id" => work.id})

    ref = push(socket, "export_work", %{"work_id" => other_work.id})

    assert_reply(ref, :ok, %{format: "markdown"})

    assert_broadcast("task_state", %{
      task_id: task_id,
      task_type: "export_work",
      phase: "RUNNING"
    })

    assert_broadcast("task_state", %{task_id: ^task_id, phase: "CHECKPOINT"})
    assert_broadcast("task_state", %{task_id: ^task_id, phase: "COMPLETED"})
  end

  test "export_work writes to the provided export_dir" do
    work = seed_exportable_work!()

    custom_dir =
      Path.join(System.tmp_dir!(), "channel_export_test_#{System.unique_integer([:positive])}")

    File.mkdir_p!(custom_dir)

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{"work_id" => work.id})

    ref = push(socket, "export_work", %{"work_id" => work.id, "export_dir" => custom_dir})

    assert_reply(ref, :ok, %{format: "markdown", path: path})
    assert String.starts_with?(path, custom_dir)

    File.rm_rf!(custom_dir)
  end

  test "join recovers active durable AgentRun state from LongRunTask checkpoint" do
    {:ok, work} = WorkService.create(%{"title" => "恢复中的作品"})
    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)
    run_id = "run-durable-channel-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: work.id,
        task_type: "agent_run",
        status: "PAUSED",
        phase: "CHECKPOINT",
        goal: "可恢复长任务",
        scope_ref: work.id,
        created_by: "agent_run",
        parent_turn_ref: "turn-durable-channel",
        checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
        completed_unit_refs: ["step-durable-channel-1"],
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "goal_version" => 1,
            "completed_step_refs" => ["step-durable-channel-1"],
            "checkpoint_version" => 2
          },
          "progress" => 50,
          "step" => "AgentRun 检查点"
        }
      })

    assert {:ok, _record} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: work.id,
               work_id: work.id,
               session_id: session_id,
               parent_turn_ref: "turn-durable-channel",
               origin_frame_ref: "frame-durable-channel",
               run_mode: "durable",
               profile_ref: "character_design_with_context_v1",
               status: "running",
               phase: "executing",
               goal: %{"text" => "作为可恢复长任务设计角色", "version" => 1},
               goal_version: 1,
               run_policy: %{"allowed_tool_refs" => ["character_roster"]},
               authority_scope: %{
                 "production_write" => false,
                 "allowed_tools" => ["character_roster"]
               },
               budget: %{
                 "max_steps" => 2,
                 "max_tool_calls" => 2,
                 "max_provider_calls" => 1,
                 "max_replans" => 1
               },
               consumed_budget: %{
                 "steps" => 1,
                 "tool_calls" => 1,
                 "provider_calls" => 0,
                 "replans" => 0
               },
               completed_step_refs: ["step-durable-channel-1"],
               interrupt_state: %{"status" => "none"},
               long_run_task_ref: task.id
             })

    task_id = task.id

    {:ok, _, _socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session_id
      })

    assert_broadcast(
      "agent_event",
      %{
        run_id: ^run_id,
        event_type: "run_resumed",
        reason_codes: reason_codes,
        payload: %{long_run_task_ref: long_run_task_ref}
      },
      1_000
    )

    assert "durable_recovered" in reason_codes
    assert "stale_resume" in reason_codes
    assert long_run_task_ref == task.id

    assert_broadcast(
      "agent_run_state",
      %{
        run_id: ^run_id,
        run_mode: "durable",
        status: "awaiting_author",
        long_run_task_ref: ^task_id,
        recovered: true,
        runtime_live: false,
        long_run_task: %{phase: "CHECKPOINT", status: "PAUSED"}
      },
      1_000
    )
  end

  # DS03：bounded runtime 已死时，join 必须广播 runtime_live: false 的只读快照
  # 明示失效；历史非终态记录不得授予实时命令权限（resume 一律 not_found）。
  test "join broadcasts runtime_live false for dead bounded runs and refuses commands" do
    {:ok, work} = WorkService.create(%{"title" => "失活任务作品"})
    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)
    run_id = "run-dead-bounded-#{System.unique_integer([:positive, :monotonic])}"

    assert {:ok, _record} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: work.id,
               work_id: work.id,
               session_id: session_id,
               parent_turn_ref: "turn-dead-bounded",
               origin_frame_ref: "frame-dead-bounded",
               run_mode: "bounded",
               profile_ref: "character_design_with_context_v1",
               status: "awaiting_author",
               phase: "stopped",
               goal: %{"text" => "在现有基础上扩写第一章", "version" => 1},
               goal_version: 1,
               run_policy: %{"allowed_tool_refs" => ["character_roster"]},
               authority_scope: %{
                 "production_write" => false,
                 "allowed_tools" => ["character_roster"]
               },
               budget: %{
                 "max_steps" => 2,
                 "max_tool_calls" => 2,
                 "max_provider_calls" => 1,
                 "max_replans" => 1
               },
               consumed_budget: %{
                 "steps" => 1,
                 "tool_calls" => 1,
                 "provider_calls" => 0,
                 "replans" => 0
               },
               completed_step_refs: ["step-dead-bounded-1"],
               interrupt_state: %{"status" => "none"}
             })

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session_id
      })

    assert_broadcast(
      "agent_run_state",
      %{
        run_id: ^run_id,
        run_mode: "bounded",
        status: "awaiting_author",
        recovered: false,
        runtime_live: false
      },
      1_000
    )

    ref = push(socket, "agent_command", %{"run_id" => run_id, "command" => "resume"})
    assert_reply(ref, :error, %{reason: "not_found"})
  end

  test "join marks durable AgentRun stale when work revision changed" do
    {:ok, work} = WorkService.create(%{"title" => "恢复前作品"})
    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)
    run_id = "run-durable-work-revision-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: work.id,
        task_type: "agent_run",
        status: "PAUSED",
        phase: "CHECKPOINT",
        goal: "可恢复长任务",
        scope_ref: work.id,
        created_by: "agent_run",
        parent_turn_ref: "turn-durable-work-revision",
        checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
        completed_unit_refs: ["step-durable-work-revision-1"],
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "goal_version" => 1,
            "work_revision" => work.revision,
            "completed_step_refs" => ["step-durable-work-revision-1"],
            "checkpoint_version" => 2
          },
          "progress" => 50,
          "step" => "AgentRun 检查点"
        }
      })

    assert {:ok, _record} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: work.id,
               work_id: work.id,
               session_id: session_id,
               parent_turn_ref: "turn-durable-work-revision",
               origin_frame_ref: "frame-durable-work-revision",
               run_mode: "durable",
               profile_ref: "character_design_with_context_v1",
               status: "running",
               phase: "executing",
               goal: %{"text" => "作为可恢复长任务设计角色", "version" => 1},
               goal_version: 1,
               run_policy: %{"allowed_tool_refs" => ["character_roster"]},
               authority_scope: %{
                 "production_write" => false,
                 "allowed_tools" => ["character_roster"],
                 "work_revision" => work.revision
               },
               budget: %{
                 "max_steps" => 2,
                 "max_tool_calls" => 2,
                 "max_provider_calls" => 1,
                 "max_replans" => 1
               },
               consumed_budget: %{
                 "steps" => 1,
                 "tool_calls" => 1,
                 "provider_calls" => 0,
                 "replans" => 0
               },
               completed_step_refs: ["step-durable-work-revision-1"],
               interrupt_state: %{"status" => "none"},
               long_run_task_ref: task.id
             })

    assert {:ok, changed_work} =
             WorkService.rename(work.id, %{
               "title" => "恢复前作品已变化",
               "revision" => work.revision
             })

    assert changed_work.revision == work.revision + 1

    {:ok, _, _socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session_id
      })

    assert_broadcast(
      "agent_event",
      %{
        run_id: ^run_id,
        event_type: "run_resumed",
        reason_codes: reason_codes
      },
      1_000
    )

    assert "durable_recovered" in reason_codes
    assert "stale_resume" in reason_codes
    assert "work_revision_mismatch" in reason_codes
    assert LongRunTaskLog.get(task.id).checkpoint_data["stale_reason"] == "work_revision_mismatch"
  end

  test "join recovers durable AgentRun for same work when current session changed" do
    {:ok, work} = WorkService.create(%{"title" => "恢复中的作品"})
    {:ok, %{active_session: %{id: original_session_id}}} = WorkSessionService.resume(work.id)
    changed_session_id = "session-after-reload-#{System.unique_integer([:positive, :monotonic])}"
    run_id = "run-durable-session-change-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: work.id,
        task_type: "agent_run",
        status: "PAUSED",
        phase: "CHECKPOINT",
        goal: "可恢复长任务",
        scope_ref: work.id,
        created_by: "agent_run",
        parent_turn_ref: "turn-durable-session-change",
        checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
        completed_unit_refs: ["step-durable-session-change-1"],
        checkpoint_data: %{
          "agent_run" => %{
            "run_id" => run_id,
            "goal_version" => 1,
            "completed_step_refs" => ["step-durable-session-change-1"],
            "checkpoint_version" => 2
          },
          "progress" => 50,
          "step" => "AgentRun 检查点"
        }
      })

    assert {:ok, _record} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: work.id,
               work_id: work.id,
               session_id: original_session_id,
               parent_turn_ref: "turn-durable-session-change",
               origin_frame_ref: "frame-durable-session-change",
               run_mode: "durable",
               profile_ref: "character_design_with_context_v1",
               status: "awaiting_author",
               phase: "stopped",
               goal: %{"text" => "作为可恢复长任务设计角色", "version" => 1},
               goal_version: 1,
               run_policy: %{"allowed_tool_refs" => ["character_roster"]},
               authority_scope: %{
                 "production_write" => false,
                 "allowed_tools" => ["character_roster"]
               },
               budget: %{
                 "max_steps" => 2,
                 "max_tool_calls" => 2,
                 "max_provider_calls" => 1,
                 "max_replans" => 1
               },
               consumed_budget: %{
                 "steps" => 1,
                 "tool_calls" => 1,
                 "provider_calls" => 0,
                 "replans" => 0
               },
               completed_step_refs: ["step-durable-session-change-1"],
               interrupt_state: %{"status" => "none"},
               long_run_task_ref: task.id
             })

    task_id = task.id

    {:ok, _, _socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => changed_session_id
      })

    assert_broadcast(
      "agent_event",
      %{
        run_id: ^run_id,
        event_type: "run_resumed",
        session_id: ^original_session_id,
        reason_codes: reason_codes
      },
      1_000
    )

    assert "durable_recovered" in reason_codes
    assert "runtime_not_live" in reason_codes

    assert_broadcast(
      "agent_run_state",
      %{
        run_id: ^run_id,
        run_mode: "durable",
        status: "awaiting_author",
        session_id: ^original_session_id,
        long_run_task_ref: ^task_id,
        recovered: true,
        runtime_live: false
      },
      1_000
    )
  end

  defp seed_exportable_work! do
    {:ok, work} = WorkService.create(%{"title" => "任务状态导出作品"})

    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work.id, title: "第一卷", seq: 1})
      |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work.id,
        volume_id: volume.id,
        title: "第01章：任务状态",
        seq: 1
      })
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "第一场", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work.id,
      scene_id: scene.id,
      content: "任务状态应该从导出动作广播到工作台。",
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    work
  end

  defp cancel_and_wait_for_agent_run(run_id) do
    _ = AgentRunService.cancel(run_id)

    wait_for(fn ->
      case AgentRunService.state(run_id) do
        {:ok, %{run: run, current_task?: false}}
        when run.status in [:completed, :cancelled, :failed, :awaiting_author] ->
          run.status

        {:error, :not_found} ->
          :not_found

        _ ->
          nil
      end
    end)
  end

  defp wait_for(fun, timeout_ms \\ 1_000) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_wait_for(fun, deadline)
  end

  defp do_wait_for(fun, deadline) do
    case fun.() do
      nil ->
        if System.monotonic_time(:millisecond) >= deadline do
          flunk("condition was not met before timeout")
        else
          Process.sleep(10)
          do_wait_for(fun, deadline)
        end

      result ->
        result
    end
  end
end
