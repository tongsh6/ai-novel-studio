defmodule NovelAgent.BudgetMeter do
  @moduledoc """
  Budget Meter — 使用计量。

  Phase 0 Week 3：简单计数器 + telemetry 事件。
  后续 Phase 加 budget limit / escalation。
  """

  use GenServer

  defstruct total: 0, actions: %{}

  # ---- Client API ----

  def start_link(_opts \\ []) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @doc "记录一次 capability 调用。"
  @spec record(atom(), pos_integer()) :: :ok
  def record(action, cost \\ 1) do
    GenServer.cast(__MODULE__, {:record, action, cost})
  end

  @doc "查询当前累计用量。"
  @spec usage() :: %{total: non_neg_integer(), actions: %{atom() => non_neg_integer()}}
  def usage do
    GenServer.call(__MODULE__, :usage)
  end

  # ---- Server Callbacks ----

  @impl true
  def init(:ok) do
    {:ok, %__MODULE__{}}
  end

  @impl true
  def handle_cast({:record, action, cost}, state) do
    :telemetry.execute(
      [:novel_agent, :budget, :record],
      %{cost: cost},
      %{action: action}
    )

    new_total = state.total + cost
    new_actions = Map.update(state.actions, action, cost, &(&1 + cost))

    {:noreply, %{state | total: new_total, actions: new_actions}}
  end

  @impl true
  def handle_call(:usage, _from, state) do
    {:reply, %{total: state.total, actions: state.actions}, state}
  end
end
