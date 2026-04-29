defmodule NovelAgent.LongRunner do
  @moduledoc """
  LongRunner — 跨 turn 长跑任务运行时 (ETS hot tier)。

  Phase 1：内存态 long-run task 状态机。
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
  def create(workspace_id, task_id, task_type, goal),
    do: create(workspace_id, task_id, task_type, goal, [])

  @doc "创建一个 long-run task，可传 estimated_budget / consumed_budget 等初始字段。"
  @spec create(String.t(), String.t(), String.t(), String.t(), keyword()) :: map()
  def create(workspace_id, task_id, task_type, goal, opts) do
    GenServer.call(__MODULE__, {:create, workspace_id, task_id, task_type, goal, opts})
  end

  @doc "确认一个 planned task。"
  @spec confirm(String.t()) ::
          {:ok, map()} | {:error, :not_found | :terminal | :invalid_transition}
  def confirm(task_id) do
    GenServer.call(__MODULE__, {:transition, task_id, :confirm, %{}})
  end

  @doc "启动一个 confirmed/resuming task。"
  @spec start(String.t()) :: {:ok, map()} | {:error, :not_found | :terminal | :invalid_transition}
  def start(task_id) do
    GenServer.call(__MODULE__, {:transition, task_id, :start, %{}})
  end

  @doc "暂停任务到 checkpoint。"
  @spec checkpoint(String.t(), map()) ::
          {:ok, map()} | {:error, :not_found | :terminal | :invalid_transition}
  def checkpoint(task_id, data) when is_map(data) do
    GenServer.call(__MODULE__, {:transition, task_id, :checkpoint, %{checkpoint_data: data}})
  end

  @doc "从 checkpoint 恢复。"
  @spec resume(String.t()) ::
          {:ok, map()} | {:error, :not_found | :terminal | :invalid_transition}
  def resume(task_id) do
    GenServer.call(__MODULE__, {:transition, task_id, :resume, %{}})
  end

  @doc "完成任务。"
  @spec complete(String.t()) ::
          {:ok, map()} | {:error, :not_found | :terminal | :invalid_transition}
  def complete(task_id) do
    GenServer.call(__MODULE__, {:transition, task_id, :complete, %{}})
  end

  @doc "取消任务。"
  @spec cancel(String.t(), String.t() | nil) :: {:ok, map()} | {:error, :not_found | :terminal}
  def cancel(task_id, reason \\ nil) do
    GenServer.call(__MODULE__, {:transition, task_id, :cancel, %{failure_ref: reason}})
  end

  @doc "标记任务失败。"
  @spec fail(String.t(), String.t() | nil) :: {:ok, map()} | {:error, :not_found | :terminal}
  def fail(task_id, failure_ref \\ nil) do
    GenServer.call(__MODULE__, {:transition, task_id, :fail, %{failure_ref: failure_ref}})
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
  def handle_call({:create, workspace_id, task_id, task_type, goal, opts}, _from, state) do
    now = DateTime.utc_now()

    task = %{
      workspace_id: workspace_id,
      task_id: task_id,
      task_type: task_type,
      status: Status.ready(),
      phase: TaskPhase.planned(),
      goal: goal,
      estimated_budget: Keyword.get(opts, :estimated_budget, %{}),
      consumed_budget: Keyword.get(opts, :consumed_budget, %{}),
      scope_ref: Keyword.get(opts, :scope_ref),
      created_by: Keyword.get(opts, :created_by),
      parent_turn_ref: Keyword.get(opts, :parent_turn_ref),
      parent_task_ref: Keyword.get(opts, :parent_task_ref),
      completed_unit_refs: [],
      pending_artifact_refs: [],
      accepted_artifact_refs: [],
      warning_refs: [],
      created_at: now,
      updated_at: now
    }

    :ets.insert(state.tid, {task_id, task})
    {:reply, task, state}
  end

  @impl true
  def handle_call({:transition, task_id, action, attrs}, _from, state) do
    case lookup(state.tid, task_id) do
      nil ->
        {:reply, {:error, :not_found}, state}

      task ->
        case transition(task, action, attrs) do
          {:ok, updated} ->
            :ets.insert(state.tid, {task_id, updated})
            {:reply, {:ok, updated}, state}

          {:error, reason} ->
            {:reply, {:error, reason}, state}
        end
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

  defp transition(task, action, attrs) do
    cond do
      terminal?(task) ->
        {:error, :terminal}

      valid_transition?(task.phase, action) ->
        {:ok, apply_transition(task, action, attrs)}

      true ->
        {:error, :invalid_transition}
    end
  end

  defp terminal?(%{phase: phase}),
    do: phase in [TaskPhase.completed(), TaskPhase.cancelled(), TaskPhase.failed()]

  defp valid_transition?(phase, :confirm),
    do: phase in [TaskPhase.planned(), TaskPhase.estimated(), TaskPhase.confirmation_required()]

  defp valid_transition?(phase, :start),
    do: phase in [TaskPhase.confirmed(), TaskPhase.resuming()]

  defp valid_transition?(phase, :checkpoint), do: phase == TaskPhase.running()
  defp valid_transition?(phase, :resume), do: phase == TaskPhase.checkpoint()
  defp valid_transition?(phase, :complete), do: phase == TaskPhase.running()
  defp valid_transition?(_phase, action) when action in [:cancel, :fail], do: true
  defp valid_transition?(_phase, _action), do: false

  defp apply_transition(task, :confirm, attrs) do
    merge_task(task, attrs, status: Status.ready(), phase: TaskPhase.confirmed())
  end

  defp apply_transition(task, :start, attrs) do
    merge_task(task, attrs, status: Status.running(), phase: TaskPhase.running())
  end

  defp apply_transition(task, :checkpoint, attrs) do
    merge_task(task, attrs, status: Status.paused(), phase: TaskPhase.checkpoint())
  end

  defp apply_transition(task, :resume, attrs) do
    merge_task(task, attrs, status: Status.waiting_system(), phase: TaskPhase.resuming())
  end

  defp apply_transition(task, :complete, attrs) do
    merge_task(task, attrs,
      status: Status.done(),
      phase: TaskPhase.completed(),
      completed_at: DateTime.utc_now()
    )
  end

  defp apply_transition(task, :cancel, attrs) do
    merge_task(task, attrs, status: Status.cancelled(), phase: TaskPhase.cancelled())
  end

  defp apply_transition(task, :fail, attrs) do
    merge_task(task, attrs, status: Status.error(), phase: TaskPhase.failed())
  end

  defp merge_task(task, attrs, transition_attrs) do
    task
    |> Map.merge(attrs)
    |> Map.merge(Map.new(transition_attrs))
    |> Map.put(:updated_at, DateTime.utc_now())
  end
end
