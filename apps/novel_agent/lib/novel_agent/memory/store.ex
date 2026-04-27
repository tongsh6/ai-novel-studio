defmodule NovelAgent.Memory.Store do
  @moduledoc """
  Memory Store — ETS-based hot tier。

  Phase 1：ETS ordered_set，按 workspace 分区，存最近 N 条 interaction。
  warm/cold tier 持久化由 NovelPersistence.MemoryLog 负责。
  """

  use GenServer

  @max_hot_entries 1000

  # ---- Client API ----

  def start_link(_opts \\ []) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @doc "记录一条 interaction 到 hot tier。"
  @spec record(map()) :: :ok
  def record(entry) when is_map(entry) do
    GenServer.cast(__MODULE__, {:record, entry})
  end

  @doc "返回 workspace 的最近 N 条 interaction。"
  @spec recent(String.t(), pos_integer()) :: [map()]
  def recent(workspace_id, n \\ 20) when is_binary(workspace_id) and n > 0 do
    GenServer.call(__MODULE__, {:recent, workspace_id, n})
  end

  @doc "返回 workspace 某条 turn 的所有 interaction。"
  @spec by_turn(String.t(), String.t()) :: [map()]
  def by_turn(workspace_id, turn_id) when is_binary(workspace_id) and is_binary(turn_id) do
    GenServer.call(__MODULE__, {:by_turn, workspace_id, turn_id})
  end

  # ---- Server Callbacks ----

  @impl true
  def init(:ok) do
    tid =
      :ets.new(:memory_hot, [
        :ordered_set,
        :public,
        :named_table,
        {:read_concurrency, true},
        {:write_concurrency, true}
      ])

    {:ok, %{tid: tid, count: 0, seq: 0}}
  end

  @impl true
  def handle_cast({:record, entry}, state) do
    seq = state.seq + 1
    key = {entry.workspace_id, :os.system_time(:millisecond), seq, entry.turn_id}
    :ets.insert(state.tid, {key, entry})

    new_count = state.count + 1
    if new_count > @max_hot_entries, do: evict_oldest(state.tid)

    {:noreply, %{state | count: min(new_count, @max_hot_entries), seq: seq}}
  end

  @impl true
  def handle_call({:recent, workspace_id, n}, _from, state) do
    results =
      state.tid
      |> :ets.tab2list()
      |> Enum.filter(fn {{ws, _ts, _seq, _tid}, _entry} -> ws == workspace_id end)
      |> Enum.take(-n)
      |> Enum.map(fn {_key, entry} -> entry end)

    {:reply, results, state}
  end

  @impl true
  def handle_call({:by_turn, workspace_id, turn_id}, _from, state) do
    results =
      state.tid
      |> :ets.match_object({{workspace_id, :_, :_, turn_id}, :_})
      |> Enum.map(fn {_key, entry} -> entry end)

    {:reply, results, state}
  end

  # ---- Internal ----

  defp evict_oldest(tid) do
    case :ets.first(tid) do
      :"$end_of_table" -> :ok
      key -> :ets.delete(tid, key)
    end
  end
end
