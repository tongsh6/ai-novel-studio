defmodule NovelPersistence.LongRunTaskLogTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelPersistence.LongRunTaskLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @valid_attrs %{
    workspace_id: "ws-task",
    task_type: "creative_generation",
    status: "READY",
    phase: "PLANNED",
    goal: "write chapter 1",
    authority_scope: "all"
  }

  describe "lifecycle" do
    test "create, get, and update" do
      assert {:ok, task} = LongRunTaskLog.create(@valid_attrs)
      assert task.workspace_id == "ws-task"
      assert task.status == "READY"

      assert fetched = LongRunTaskLog.get(task.id)
      assert fetched.goal == "write chapter 1"

      assert {:ok, updated} = LongRunTaskLog.update(task, %{status: "RUNNING"})
      assert updated.status == "RUNNING"
    end

    test "checkpoint, resume, and complete" do
      {:ok, task} = LongRunTaskLog.create(@valid_attrs)

      assert {:ok, task} = LongRunTaskLog.checkpoint(task, %{"current_scene" => 5})
      assert task.status == "PAUSED"
      assert task.phase == "CHECKPOINT"
      assert task.checkpoint_data == %{"current_scene" => 5}

      assert {:ok, task} = LongRunTaskLog.resume(task)
      assert task.status == "WAITING_SYSTEM"
      assert task.phase == "RESUMING"

      assert {:ok, task} = LongRunTaskLog.complete(task)
      assert task.status == "DONE"
      assert task.phase == "COMPLETED"
    end
  end

  describe "queries" do
    test "list_active returns non-terminal tasks" do
      LongRunTaskLog.create(%{@valid_attrs | goal: "t1", status: "READY"})
      LongRunTaskLog.create(%{@valid_attrs | goal: "t2", status: "RUNNING"})
      LongRunTaskLog.create(%{@valid_attrs | goal: "t3", status: "DONE"})

      active = LongRunTaskLog.list_active("ws-task")
      assert length(active) == 2
      goals = Enum.map(active, & &1.goal)
      assert "t1" in goals
      assert "t2" in goals
      refute "t3" in goals
    end

    test "recent returns tasks ordered by inserted_at desc" do
      # Use small sleep to ensure different inserted_at if needed,
      # but monotonic should be fine if timestamps are precise enough.
      LongRunTaskLog.create(%{@valid_attrs | goal: "t1"})
      :timer.sleep(10)
      LongRunTaskLog.create(%{@valid_attrs | goal: "t2"})

      recent = LongRunTaskLog.recent("ws-task")
      assert length(recent) == 2
      assert Enum.at(recent, 0).goal == "t2"
      assert Enum.at(recent, 1).goal == "t1"
    end
  end
end
