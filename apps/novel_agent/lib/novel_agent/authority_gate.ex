defmodule NovelAgent.AuthorityGate do
  @moduledoc """
  Authority Gate — 权限检查 + 执行前确认。

  Phase 1：当 intent 标记 requires_confirmation 或 risk_class=high 时，
  返回 `{:confirm_required, reason}`，由 TurnService 转入 NEEDS_CONFIRMATION。

  Pending confirmation 上下文存在 ETS `:authority_pending` 中，
  由 handle_confirm / handle_reject 消费后清除。
  """

  use GenServer

  @table :authority_pending

  # ---- Client API ----

  def start_link(_opts \\ []) do
    GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  end

  @doc """
  检查 action 是否需要执行前确认。

  返回 `:allowed` 或 `{:confirm_required, reason}`。
  """
  @spec authorize(atom() | String.t(), map()) :: :allowed | {:confirm_required, String.t()}
  def authorize(action, context \\ %{}) do
    GenServer.call(__MODULE__, {:authorize, action, context})
  end

  @doc """
  存储 pending confirmation 上下文，返回唯一的 behavior_id。
  TurnService 用此 id 构建 confirmation_card 和 behavior_state。
  """
  @spec request_confirmation(map()) :: String.t()
  def request_confirmation(context) when is_map(context) do
    GenServer.call(__MODULE__, {:request_confirmation, context})
  end

  @doc "根据 behavior_id 获取并删除 pending confirmation 上下文。"
  @spec take_pending(String.t()) :: map() | nil
  def take_pending(behavior_id) when is_binary(behavior_id) do
    GenServer.call(__MODULE__, {:take_pending, behavior_id})
  end

  # ---- Server Callbacks ----

  @impl true
  def init(:ok) do
    :ets.new(@table, [:set, :public, :named_table, {:read_concurrency, true}])
    {:ok, %{seq: 0}}
  end

  @impl true
  def handle_call({:authorize, action, context}, _from, state) do
    requires = Map.get(context, :requires_confirmation, false)
    risk = Map.get(context, :risk_class, "low")

    result =
      cond do
        requires -> {:confirm_required, "此操作需要确认后执行"}
        risk == "high" -> {:confirm_required, "高风险操作需要确认后执行"}
        true -> :allowed
      end

    telemetry_result =
      case result do
        :allowed -> %{decision: "allowed"}
        {:confirm_required, reason} -> %{decision: "confirm_required", reason: reason}
      end

    :telemetry.execute(
      [:novel_agent, :authority, :check],
      %{},
      %{action: action, context: context, result: telemetry_result}
    )

    {:reply, result, state}
  end

  @impl true
  def handle_call({:request_confirmation, context}, _from, state) do
    seq = state.seq + 1
    behavior_id = "confirm_#{:os.system_time(:millisecond)}_#{seq}"

    entry = Map.merge(context, %{
      behavior_id: behavior_id,
      stored_at: :os.system_time(:millisecond)
    })

    :ets.insert(@table, {behavior_id, entry})
    {:reply, behavior_id, %{state | seq: seq}}
  end

  @impl true
  def handle_call({:take_pending, behavior_id}, _from, state) do
    result =
      case :ets.lookup(@table, behavior_id) do
        [{^behavior_id, entry}] ->
          :ets.delete(@table, behavior_id)
          entry

        [] ->
          nil
      end

    {:reply, result, state}
  end
end
