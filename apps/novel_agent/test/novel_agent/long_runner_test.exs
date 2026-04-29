defmodule NovelAgent.LongRunnerTest do
  use ExUnit.Case, async: false

  alias NovelAgent.LongRunner
  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TaskPhase

  describe "create/4 + get/1" do
    test "creates and retrieves a task with ADR-0002 enum values" do
      task = LongRunner.create("ws-1", "task-1", "continue_writing", "继续写第三章")

      assert task.workspace_id == "ws-1"
      assert task.task_type == "continue_writing"
      assert task.status == Status.ready()
      assert task.phase == TaskPhase.planned()
      assert task.estimated_budget == %{}
      assert task.consumed_budget == %{}

      fetched = LongRunner.get("task-1")
      assert fetched.task_id == "task-1"
    end

    test "accepts canonical budget fields" do
      task =
        LongRunner.create("ws-budget", "task-budget", "batch_generate", "生成十章",
          estimated_budget: %{"token" => 1000},
          consumed_budget: %{"token" => 0},
          parent_turn_ref: "turn-1"
        )

      assert task.estimated_budget == %{"token" => 1000}
      assert task.consumed_budget == %{"token" => 0}
      assert task.parent_turn_ref == "turn-1"
    end
  end

  describe "confirm/1 + start/1 + checkpoint/2 + resume/1" do
    test "follows planned -> confirmed -> running -> checkpoint -> resuming -> running" do
      LongRunner.create("ws-2", "task-2", "batch_generate", "批量生成场景")

      assert {:ok, confirmed} = LongRunner.confirm("task-2")
      assert confirmed.status == Status.ready()
      assert confirmed.phase == TaskPhase.confirmed()

      assert {:ok, running} = LongRunner.start("task-2")
      assert running.status == Status.running()
      assert running.phase == TaskPhase.running()

      assert {:ok, task} = LongRunner.checkpoint("task-2", %{progress: "3/10 scenes done"})
      assert task.status == Status.paused()
      assert task.phase == TaskPhase.checkpoint()
      assert task.checkpoint_data.progress == "3/10 scenes done"

      assert {:ok, resumed} = LongRunner.resume("task-2")
      assert resumed.status == Status.waiting_system()
      assert resumed.phase == TaskPhase.resuming()

      assert {:ok, running_again} = LongRunner.start("task-2")
      assert running_again.status == Status.running()
      assert running_again.phase == TaskPhase.running()
    end

    test "rejects invalid transitions" do
      LongRunner.create("ws-invalid", "task-invalid", "test", "invalid")

      assert {:error, :invalid_transition} = LongRunner.checkpoint("task-invalid", %{})
      assert {:error, :invalid_transition} = LongRunner.complete("task-invalid")
    end
  end

  describe "complete/1" do
    test "completes a task" do
      LongRunner.create("ws-3", "task-3", "test", "test task")
      LongRunner.confirm("task-3")
      LongRunner.start("task-3")

      assert {:ok, task} = LongRunner.complete("task-3")
      assert task.status == Status.done()
      assert task.phase == TaskPhase.completed()
      assert %DateTime{} = task.completed_at
    end

    test "terminal states are irreversible" do
      LongRunner.create("ws-terminal", "task-terminal", "test", "terminal")
      LongRunner.confirm("task-terminal")
      LongRunner.start("task-terminal")
      assert {:ok, _} = LongRunner.complete("task-terminal")

      assert {:error, :terminal} = LongRunner.resume("task-terminal")
      assert {:error, :terminal} = LongRunner.cancel("task-terminal")
      assert {:error, :terminal} = LongRunner.fail("task-terminal")
    end
  end

  describe "cancel/2 + fail/2" do
    test "cancels and fails non-terminal tasks" do
      LongRunner.create("ws-cancel", "task-cancel", "test", "cancel")
      assert {:ok, cancelled} = LongRunner.cancel("task-cancel", "user_cancelled")
      assert cancelled.status == Status.cancelled()
      assert cancelled.phase == TaskPhase.cancelled()
      assert cancelled.failure_ref == "user_cancelled"

      LongRunner.create("ws-fail", "task-fail", "test", "fail")
      assert {:ok, failed} = LongRunner.fail("task-fail", "provider_error")
      assert failed.status == Status.error()
      assert failed.phase == TaskPhase.failed()
      assert failed.failure_ref == "provider_error"
    end
  end

  describe "list_active/1 with workspace isolation" do
    test "only returns active tasks for the specified workspace" do
      id_a = "list-a-#{System.unique_integer()}"
      id_b = "list-b-#{System.unique_integer()}"
      id_c = "list-c-#{System.unique_integer()}"

      LongRunner.create("ws-10", id_a, "test", "a")
      LongRunner.create("ws-10", id_b, "test", "b")
      LongRunner.confirm(id_b)
      LongRunner.start(id_b)
      LongRunner.checkpoint(id_b, %{})
      LongRunner.create("ws-10", id_c, "test", "c")
      LongRunner.confirm(id_c)
      LongRunner.start(id_c)
      LongRunner.complete(id_c)

      # Should find a, b but not c (completed is terminal)
      active_ws10 = LongRunner.list_active("ws-10")
      ids_ws10 = Enum.map(active_ws10, & &1.task_id)
      assert id_a in ids_ws10
      assert id_b in ids_ws10
      refute id_c in ids_ws10

      # Other workspace should see nothing
      assert LongRunner.list_active("ws-99") == []
    end

    test "workspace isolation: tasks in ws-a don't leak to ws-b" do
      id_x = "iso-x-#{System.unique_integer()}"
      id_y = "iso-y-#{System.unique_integer()}"

      LongRunner.create("ws-alpha", id_x, "test", "x")
      LongRunner.create("ws-beta", id_y, "test", "y")

      active_alpha = LongRunner.list_active("ws-alpha")
      active_beta = LongRunner.list_active("ws-beta")

      assert length(active_alpha) == 1
      assert hd(active_alpha).task_id == id_x
      assert length(active_beta) == 1
      assert hd(active_beta).task_id == id_y
    end
  end
end
