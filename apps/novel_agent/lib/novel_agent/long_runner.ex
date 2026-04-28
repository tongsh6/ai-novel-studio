defmodule NovelAgent.LongRunner do
  @moduledoc """
  LongRunner — 跨 turn 长跑任务运行时 (ETS hot tier)。

  Phase 1：最小状态机（running / checkpoint / completed）。
  ADR-0002 §4：status / phase 使用 Foundation.Enums 枚举值。

  持久化由 NovelPersistence.LongRunTaskLog 负责（warm tier）。
  """

  use GenServer

  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TaskPhase

  # ---- Client API ----

  def start_link(_opts \\ []) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @doc "创建一个 long-run task。"
  @spec create(String.t(), String.t(), String.t(), String.t()) :: map()
  def create(workspace_id, task_id, task_type, goal) do
    GenServer.call(__MODULE__, {:create, workspace_id, task_id, task_type, goal})
  end

  @doc "暂停任务到 checkpoint。"
  @spec checkpoint(String.t(), map()) :: {:ok, map()} | {:error, :not_found}
  def checkpoint(task_id, data) when is_map(data) do
    GenServer.call(__MODULE__, {:checkpoint, task_id, data})
  end

  @doc "从 checkpoint 恢复。"
  @spec resume(String.t()) :: {:ok, map()} | {:error, :not_found}
  def resume(task_id) do
    GenServer.call(__MODULE__, {:resume, task_id})
  end

  @doc "完成任务。"
  @spec complete(String.t()) :: {:ok, map()} | {:error, :not_found}
  def complete(task_id) do
    GenServer.call(__MODULE__, {:complete, task_id})
  end

  @doc "获取任务状态。"
  @spec get(String.t()) :: map() | nil
  def get(task_id) do
    GenServer.call(__MODULE__, {:get, task_id})
  end

  @doc "列出 workspace 下所有 active 任务（非终态）。"
  @spec list_active(String.t()) :: [map()]
  def list_active(workspace_id) do
    GenServer.call(__MODULE__, {:list_active, workspace_id})
  end

  # ---- Server Callbacks ----

  @impl true
  def init(:ok) do
    tid =
      :ets.new(:long_runner_tasks, [
        :set,
        :public,
        :named_table,
        {:read_concurrency, true}
      ])

    {:ok, %{tid: tid}}
  end

  @impl true
  def handle_call({:create, workspace_id, task_id, task_type, goal}, _from, state) do
    task = %{
      workspace_id: workspace_id,
      task_id: task_id,
      task_type: task_type,
      status: Status.running(),
      phase: TaskPhase.running(),
      goal: goal,
      created_at: DateTime.utc_now()
    }

    :ets.insert(state.tid, {task_id, task})
    {:reply, task, state}
  end

  @impl true
  def handle_call({:checkpoint, task_id, data}, _from, state) do
    case lookup(state.tid, task_id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      task ->
        task =
          task
          |> Map.merge(%{
            status: Status.paused(),
            phase: TaskPhase.checkpoint(),
            checkpoint_data: data
          })

        :ets.insert(state.tid, {task_id, task})
        {:reply, {:ok, task}, state}
    end
  end

  @impl true
  def handle_call({:resume, task_id}, _from, state) do
    case lookup(state.tid, task_id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      task ->
        task =
          Map.merge(task, %{
            status: Status.waiting_system(),
            phase: TaskPhase.resuming()
          })

        :ets.insert(state.tid, {task_id, task})
        {:reply, {:ok, task}, state}
    end
  end

  @impl true
  def handle_call({:complete, task_id}, _from, state) do
    case lookup(state.tid, task_id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      task ->
        task =
          Map.merge(task, %{
            status: Status.done(),
            phase: TaskPhase.completed(),
            completed_at: DateTime.utc_now()
          })

        :ets.insert(state.tid, {task_id, task})
        {:reply, {:ok, task}, state}
    end
  end

  @impl true
  def handle_call({:get, task_id}, _from, state) do
    {:reply, lookup(state.tid, task_id), state}
  end

  @impl true
  def handle_call({:list_active, workspace_id}, _from, state) do
    terminal = [Status.done(), Status.cancelled(), Status.error()]

    tasks =
      state.tid
      |> :ets.tab2list()
      |> Enum.filter(fn {_id, task} ->
        task[:workspace_id] == workspace_id and task[:status] not in terminal
      end)
      |> Enum.map(fn {_id, task} -> task end)

    {:reply, tasks, state}
  end

  # ---- Internal ----

  defp lookup(tid, task_id) do
    case :ets.lookup(tid, task_id) do
      [{^task_id, task}] -> task
      [] -> nil
    end
  end
end
