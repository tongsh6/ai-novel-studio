defmodule NovelAgent.LongRunnerTest do
  use ExUnit.Case, async: false

  alias NovelAgent.LongRunner

  describe "create/3 + get/1" do
    test "creates and retrieves a task" do
      task = LongRunner.create("task-1", "continue_writing", "继续写第三章")

      assert task.task_type == "continue_writing"
      assert task.status == "running"
      assert task.phase == "running"

      fetched = LongRunner.get("task-1")
      assert fetched.task_id == "task-1"
    end
  end

  describe "checkpoint/2 + resume/1" do
    test "pauses and resumes a task" do
      LongRunner.create("task-2", "batch_generate", "批量生成场景")

      assert {:ok, task} = LongRunner.checkpoint("task-2", %{progress: "3/10 scenes done"})
      assert task.status == "checkpoint"
      assert task.checkpoint_data.progress == "3/10 scenes done"

      assert {:ok, resumed} = LongRunner.resume("task-2")
      assert resumed.status == "running"
    end
  end

  describe "complete/1" do
    test "completes a task" do
      LongRunner.create("task-3", "test", "test task")

      assert {:ok, task} = LongRunner.complete("task-3")
      assert task.status == "completed"
      assert %DateTime{} = task.completed_at
    end
  end

  describe "list_active/1" do
    test "lists running and checkpoint tasks" do
      id_a = "list-a-#{System.unique_integer()}"
      id_b = "list-b-#{System.unique_integer()}"
      id_c = "list-c-#{System.unique_integer()}"

      LongRunner.create(id_a, "test", "a")
      LongRunner.create(id_b, "test", "b")
      LongRunner.checkpoint(id_b, %{})
      LongRunner.create(id_c, "test", "c")
      LongRunner.complete(id_c)

      active = LongRunner.list_active("any")
      ids = Enum.map(active, & &1.task_id)
      assert id_a in ids
      assert id_b in ids
      refute id_c in ids
    end
  end
end
