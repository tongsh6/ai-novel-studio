defmodule NovelAgent.ClarificationStore do
  @moduledoc """
  Pending clarification state store — 跨 turn 的 slot 累积与澄清生命周期管理。

  当 TurnService 产出 clarification 时，将待澄清上下文持久化到 ETS；
  下一轮用户回答到达时，读取并合并 slot，直至所有 blocking slot 被满足。

  ETS 表：
  - `:clarification_pending` — `{behavior_id, state_map}` 主表
  - `:clarification_ws_index` — `{workspace_id, behavior_id}` 反向索引
  """

  use GenServer

  @table :clarification_pending
  @index :clarification_ws_index

  # ---- Client API ----

  def start_link(_opts \\ []) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @doc """
  存储或更新 pending clarification 状态。返回 behavior_id。
  """
  @spec put_pending(map()) :: String.t()
  def put_pending(state) when is_map(state) do
    GenServer.call(__MODULE__, {:put_pending, state})
  end

  @doc """
  原子获取并移除 pending clarification。返回 map 或 nil。
  """
  @spec take_pending(String.t()) :: map() | nil
  def take_pending(behavior_id) when is_binary(behavior_id) do
    GenServer.call(__MODULE__, {:take_pending, behavior_id})
  end

  @doc """
  只读获取 pending clarification，不移除。
  """
  @spec peek_pending(String.t()) :: map() | nil
  def peek_pending(behavior_id) when is_binary(behavior_id) do
    GenServer.call(__MODULE__, {:peek_pending, behavior_id})
  end

  @doc """
  按 workspace_id 查找活跃的 behavior_id。
  用于检查 workspace 是否有未解决的澄清（supersede 等场景）。
  """
  @spec find_by_workspace(String.t()) :: String.t() | nil
  def find_by_workspace(workspace_id) when is_binary(workspace_id) do
    GenServer.call(__MODULE__, {:find_by_workspace, workspace_id})
  end

  # ---- Server Callbacks ----

  @impl true
  def init(:ok) do
    :ets.new(@table, [:set, :public, :named_table, {:read_concurrency, true}])
    :ets.new(@index, [:set, :public, :named_table, {:read_concurrency, true}])
    {:ok, %{seq: 0}}
  end

  @impl true
  def handle_call({:put_pending, state}, _from, s) do
    seq = s.seq + 1
    behavior_id = Map.get(state, :behavior_id) || "clarify_#{:os.system_time(:millisecond)}_#{seq}"

    entry =
      Map.merge(state, %{
        behavior_id: behavior_id,
        stored_at: :os.system_time(:millisecond)
      })

    :ets.insert(@table, {behavior_id, entry})

    if ws_id = Map.get(state, :workspace_id) do
      :ets.insert(@index, {ws_id, behavior_id})
    end

    {:reply, behavior_id, %{s | seq: seq}}
  end

  @impl true
  def handle_call({:take_pending, behavior_id}, _from, s) do
    result =
      case :ets.lookup(@table, behavior_id) do
        [{^behavior_id, entry}] ->
          :ets.delete(@table, behavior_id)

          if ws_id = Map.get(entry, :workspace_id) do
            :ets.delete(@index, ws_id)
          end

          entry

        [] ->
          nil
      end

    {:reply, result, s}
  end

  @impl true
  def handle_call({:peek_pending, behavior_id}, _from, s) do
    result =
      case :ets.lookup(@table, behavior_id) do
        [{^behavior_id, entry}] -> entry
        [] -> nil
      end

    {:reply, result, s}
  end

  @impl true
  def handle_call({:find_by_workspace, workspace_id}, _from, s) do
    result =
      case :ets.lookup(@index, workspace_id) do
        [{^workspace_id, behavior_id}] -> behavior_id
        [] -> nil
      end

    {:reply, result, s}
  end
end
