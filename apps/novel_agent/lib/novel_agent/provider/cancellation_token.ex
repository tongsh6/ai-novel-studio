defmodule NovelAgent.Provider.CancellationToken do
  @moduledoc """
  Execution-owned cancellation state and monitored, one-shot observer notifications.
  Transport ownership remains with the adapter; this module never owns a socket.
  """
  use GenServer
  @type reason :: atom() | String.t()
  @type t :: pid()

  def start_link(metadata \\ %{}) when is_map(metadata),
    do: GenServer.start_link(__MODULE__, metadata)

  def cancel(token, reason \\ :author_cancelled)
  def cancel(nil, _reason), do: :ok
  def cancel(token, reason), do: call(token, {:cancel, reason}, :ok)
  def cancelled?(token), do: Map.get(snapshot(token), :cancelled?, false)
  def snapshot(nil), do: %{}
  def snapshot(token), do: call(token, :snapshot, %{})
  def reason(token), do: Map.get(snapshot(token), :reason)

  @doc "Atomically subscribe the calling process, or report cancellation before dispatch."
  def subscribe(nil), do: {:ok, nil}
  def subscribe(token), do: call(token, {:subscribe, self()}, {:error, :token_unavailable})
  def unsubscribe(_token, nil), do: :ok
  def unsubscribe(token, ref), do: call(token, {:unsubscribe, ref}, :ok)

  @impl true
  def init(metadata) do
    {:ok,
     %{cancelled?: false, reason: nil, requested_at: nil, metadata: metadata, subscribers: %{}}}
  end

  @impl true
  def handle_call(:snapshot, _from, state), do: {:reply, Map.delete(state, :subscribers), state}

  def handle_call({:subscribe, _pid}, _from, %{cancelled?: true} = state),
    do: {:reply, {:error, :cancelled}, state}

  def handle_call({:subscribe, pid}, _from, state) do
    ref = Process.monitor(pid)
    {:reply, {:ok, ref}, %{state | subscribers: Map.put(state.subscribers, ref, pid)}}
  end

  def handle_call({:unsubscribe, ref}, _from, state) do
    Process.demonitor(ref, [:flush])
    {:reply, :ok, %{state | subscribers: Map.delete(state.subscribers, ref)}}
  end

  def handle_call({:cancel, _reason}, _from, %{cancelled?: true} = state),
    do: {:reply, :ok, state}

  def handle_call({:cancel, reason}, _from, state) do
    next = %{state | cancelled?: true, reason: reason, requested_at: DateTime.utc_now()}
    {:reply, :ok, next, {:continue, :notify}}
  end

  @impl true
  def handle_continue(:notify, state) do
    for {ref, pid} <- state.subscribers do
      send(pid, {:provider_cancelled, ref})
      Process.demonitor(ref, [:flush])
    end

    {:noreply, %{state | subscribers: %{}}}
  end

  @impl true
  def handle_info({:DOWN, ref, :process, _pid, _reason}, state),
    do: {:noreply, %{state | subscribers: Map.delete(state.subscribers, ref)}}

  defp call(token, message, fallback) do
    GenServer.call(token, message)
  catch
    :exit, _ -> fallback
  end
end
