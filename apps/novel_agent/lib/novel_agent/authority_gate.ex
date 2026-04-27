defmodule NovelAgent.AuthorityGate do
  @moduledoc """
  Authority Gate — 权限检查。

  Phase 0 Week 3：全放行模式，为后续 authority policy 留骨架。
  满足完成标准：`authorize/2` 可返回 `:denied`，capability 据此拒绝执行。
  """

  use GenServer

  # ---- Client API ----

  def start_link(_opts \\ []) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @doc """
  检查给定 action 是否被授权。

  返回 `:allowed` 或 `:denied`。
  """
  @spec authorize(atom(), map()) :: :allowed | :denied
  def authorize(action, context \\ %{}) do
    GenServer.call(__MODULE__, {:authorize, action, context})
  end

  # ---- Server Callbacks ----

  @impl true
  def init(:ok) do
    {:ok, :ok}
  end

  @impl true
  def handle_call({:authorize, action, context}, _from, state) do
    # Phase 0: 全放行
    :telemetry.execute(
      [:novel_agent, :authority, :check],
      %{},
      %{action: action, context: context, result: :allowed}
    )

    {:reply, :allowed, state}
  end
end
