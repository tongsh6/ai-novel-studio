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

  @type state_callback :: (map() -> any())

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

  @doc """
  在正式 LongRunTaskLog 生命周期内执行一个同步产品动作。

  该入口用于已经有可见 UI 触发点、但仍需要向工作台广播任务生命周期的动作。
  调用方通过 `:on_state_change` 接收持久化后的 task 快照并负责转成所在边界的事件。
  """
  @spec track(map(), keyword(), (-> {:ok, term()} | {:error, term()})) ::
          {:ok, term()} | {:error, term()}
  def track(attrs, opts \\ [], fun) when is_function(fun, 0) do
    on_state_change = Keyword.get(opts, :on_state_change, fn _task -> :ok end)
    checkpoint_data = Keyword.get(opts, :checkpoint_data, %{"progress" => 50})

    with {:ok, task} <- LongRunTaskLog.create(attrs),
         {:ok, task} <-
           LongRunTaskLog.update(task, %{status: Status.running(), phase: TaskPhase.running()}),
         :ok <- notify_state_change(on_state_change, task),
         {:ok, task} <- LongRunTaskLog.checkpoint(task, checkpoint_data),
         :ok <- notify_state_change(on_state_change, task) do
      finalize_tracked_run(task, run_tracked_fun(fun), on_state_change)
    end
  end

  # ── Execution Core ────────────────────────────

  defp finalize_tracked_run(task, {:ok, result}, on_state_change) do
    with {:ok, task} <- LongRunTaskLog.complete(task),
         :ok <- notify_state_change(on_state_change, task) do
      {:ok, result}
    end
  end

  defp finalize_tracked_run(task, {:error, reason}, on_state_change) do
    with {:ok, task} <- LongRunTaskLog.fail(task, reason),
         :ok <- notify_state_change(on_state_change, task) do
      {:error, reason}
    end
  end

  defp run_tracked_fun(fun) do
    fun.()
  rescue
    error -> {:error, error}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp notify_state_change(on_state_change, task) when is_function(on_state_change, 1) do
    on_state_change.(task)
    :ok
  end

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
