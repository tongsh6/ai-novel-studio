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

    # Wait for the async tasks to finish
    Process.sleep(500)

    final_task = LongRunTaskLog.get(task.id)
    assert final_task.status == "DONE"
    assert final_task.phase == "COMPLETED"
    assert final_task.checkpoint_data != nil
  end

  test "resume a task" do
    {:ok, task} = LongRunTaskLog.create(@valid_attrs)
    {:ok, checkpointed} = LongRunTaskLog.checkpoint(task, %{"resume_from" => 1})

    {:ok, resumed} = TaskRunner.resume(checkpointed.id)
    assert resumed.phase == "RESUMING"

    Process.sleep(500)
    final_task = LongRunTaskLog.get(task.id)
    assert final_task.status == "DONE"
  end
end
