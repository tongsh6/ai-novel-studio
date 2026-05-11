defmodule NovelApplication.TaskRunner do
  @moduledoc """
  v3 Long-run Task Runner. 负责长跑任务的生命周期调度与持久化同步。

  依托 Persistence.LongRunTaskLog 实现 SQLite 状态保存与恢复。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelCommon.LogContext
  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TaskPhase
  alias NovelPersistence.LongRunTaskLog

  @doc "启动一个新任务。"
  def start(attrs) do
    with {:ok, task} <- LongRunTaskLog.create(attrs) do
      LogEmit.emit(:task_runner, :start, :done, %{task_id: task.id, task_type: task.task_type})

      meta_snapshot = LogContext.snapshot()
      Task.start(fn ->
        LogContext.restore(meta_snapshot)
        perform_execution(task.id)
      end)

      {:ok, task}
    end
  end

  @doc "从持久化层恢复任务。"
  def resume(task_id) do
    with %{} = task <- LongRunTaskLog.get(task_id),
         {:ok, resumed} <- LongRunTaskLog.resume(task) do
      LogEmit.emit(:task_runner, :resume, :done, %{task_id: task_id})

      meta_snapshot = LogContext.snapshot()
      Task.start(fn ->
        LogContext.restore(meta_snapshot)
        perform_execution(task_id)
      end)

      {:ok, resumed}
    else
      nil ->
        LogEmit.emit(:task_runner, :resume, :error, %{reason_code: :not_found})
        {:error, :not_found}
      error ->
        LogEmit.emit(:task_runner, :resume, :error, %{reason_code: :persistence_error})
        error
    end
  end

  # ── Execution Core ────────────────────────────

  defp perform_execution(id) do
    case LongRunTaskLog.get(id) do
      nil ->
        :ok

      task ->
        LogEmit.emit(:task_runner, :execute, :start, %{task_id: id})

        {:ok, task} =
          LongRunTaskLog.update(task, %{status: Status.running(), phase: TaskPhase.running()})

        Process.sleep(100)

        {:ok, task} =
          LongRunTaskLog.checkpoint(task, %{"progress" => 50, "step" => "world_gen"})

        Process.sleep(100)

        {:ok, task} =
          LongRunTaskLog.update(task, %{status: Status.running(), phase: TaskPhase.running()})

        Process.sleep(100)
        {:ok, _task} = LongRunTaskLog.complete(task)
        LogEmit.emit(:task_runner, :execute, :done, %{task_id: id})
    end
  end
end
