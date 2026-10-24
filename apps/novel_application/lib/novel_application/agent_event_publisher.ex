defmodule NovelApplication.AgentEventPublisher do
  @moduledoc """
  应用层事件通知边界，运行时不持有 Phoenix socket。

  通知失败只记录投递错误，不改变已提交的业务结果，也不能让监督树重启并重复执行。
  客户端从持久 Interaction / AgentEvent / run 快照恢复；通知不是执行成功的提交点。
  """

  alias NovelCommon.Contracts.AgentEvent
  require NovelCommon.LogEmit, as: LogEmit

  @type sink :: (AgentEvent.t() -> any())

  @spec publish(AgentEvent.t(), sink() | nil) :: :ok
  def publish(%AgentEvent{} = event, sink) when is_function(sink, 1) do
    case sink.(event) do
      {:error, _reason} -> delivery_failed(event)
      _ -> :ok
    end
  rescue
    _ -> delivery_failed(event)
  catch
    _, _ -> delivery_failed(event)
  end

  def publish(%AgentEvent{}, _sink), do: :ok

  defp delivery_failed(event) do
    LogEmit.emit(:agent_run, :delivery, :error, %{
      run_id: event.run_ref,
      event_ref: event.event_id,
      event_type: event.event_type,
      reason_code: :event_sink_unavailable
    })

    :ok
  end
end
