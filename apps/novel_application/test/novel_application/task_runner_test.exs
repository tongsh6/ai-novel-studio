defmodule NovelApplication.TaskRunnerTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.TaskRunner
  alias NovelPersistence.LongRunTaskLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @valid_attrs %{
    workspace_id: "ws-runner-test",
    task_type: "world_building",
    status: "READY",
    phase: "PLANNED",
    goal: "generate sci-fi world"
  }

  test "start and run through lifecycle" do
    {:ok, task} = TaskRunner.start(@valid_attrs)
    assert task.id != nil

    final_task = await_finalized(task.id)
    assert final_task.status == "DONE"
    assert final_task.phase == "COMPLETED"
    assert final_task.checkpoint_data != nil
  end

  test "resume a task" do
    {:ok, task} = LongRunTaskLog.create(@valid_attrs)
    {:ok, checkpointed} = LongRunTaskLog.checkpoint(task, %{"resume_from" => 1})

    {:ok, resumed} = TaskRunner.resume(checkpointed.id)
    assert resumed.phase == "RESUMING"

    final_task = await_finalized(task.id)
    assert final_task.status == "DONE"
  end

  # 2026-11-04 测试提速：用轮询替代固定 500ms 等待。
  # perform_execution 内部有 3×100ms 进度模拟，正常路径约 300ms 完成；
  # 固定 sleep(500) 每次白等约 200ms，且负载高时会偶发读到未完成状态。
  defp await_finalized(task_id, attempts \\ 200) do
    case LongRunTaskLog.get(task_id) do
      %{status: "DONE"} = task ->
        task

      _ when attempts > 0 ->
        Process.sleep(10)
        await_finalized(task_id, attempts - 1)

      other ->
        other
    end
  end
end
