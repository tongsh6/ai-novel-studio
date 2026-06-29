defmodule NovelApplication.AgentEventPublisher do
  @moduledoc """
  Application-owned AgentEvent publishing boundary.

  The runtime emits AgentEvent values here; adapters can forward them to
  Phoenix/PubSub without AgentRunServer holding sockets.
  """

  alias NovelCommon.Contracts.AgentEvent

  @type sink :: (AgentEvent.t() -> any())

  @spec publish(AgentEvent.t(), sink() | nil) :: :ok
  def publish(%AgentEvent{} = event, sink) when is_function(sink, 1) do
    sink.(event)
    :ok
  end

  def publish(%AgentEvent{}, _sink), do: :ok
end
