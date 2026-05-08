defmodule NovelAgent.Telemetry do
  @moduledoc """
  Telemetry 事件处理。

  Phase 0 Week 3：将关键事件写到 stdout + audit log。
  完整 OpenTelemetry 集成留待后续 Phase。
  """

  require Logger

  @events [
    [:novel_agent, :capability, :invoke],
    [:novel_agent, :authority, :check],
    [:novel_agent, :budget, :record]
  ]

  @doc """
  附加所有 telemetry handlers。在 Application.start 中调用。
  """
  @spec attach_all() :: :ok
  def attach_all do
    handler_id = {__MODULE__, :event_handler}

    Enum.each(@events, fn event ->
      :telemetry.attach_many(
        {handler_id, event},
        [event],
        &__MODULE__.handle_event/4,
        :ok
      )
    end)

    :ok
  end

  @doc false
  def handle_event(event, measurements, metadata, _config) do
    entry = %{
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601(),
      event: event,
      measurements: measurements,
      metadata: metadata
    }

    Logger.info("[遥测] #{Jason.encode!(entry)}")
  end
end
