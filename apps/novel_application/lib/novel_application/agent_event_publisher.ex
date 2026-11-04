defmodule NovelApplication.AgentEventPublisher do
  @moduledoc """
  应用层 AgentRun 事件通知边界，按 run 的真实 work/session 作用域分发。

  订阅只注册一次，生命周期跟随订阅进程（`Registry` 自动清理）。事件投递失败只
  记录错误，不改变已提交的业务结果，也不能让监督树重启并重复执行。客户端从持久
  Interaction / AgentEvent / run 快照恢复；通知不是执行成功的提交点。
  """

  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentRun
  require NovelCommon.LogEmit, as: LogEmit

  @registry NovelApplication.AgentEventRegistry

  @doc """
  订阅一个 work 的事件作用域。

  - `session_id` 非 nil：只接收该 work/session 的精确事件。
  - `session_id` 为 nil：接收该 work 的 work-wide 事件。
  """
  @spec subscribe(String.t(), String.t() | nil) :: :ok
  def subscribe(work_id, session_id)
      when is_binary(work_id) and (is_binary(session_id) or is_nil(session_id)) do
    key = if is_nil(session_id), do: {work_id}, else: {work_id, session_id}
    {:ok, _owner} = Registry.register(@registry, key, :agent_event)
    :ok
  end

  @doc """
  按真实 run 的 work/session 分发一条持久 AgentEvent。

  `session_id` 为 nil 的 run 只分发一次 work-wide；非 nil 时分别分发 work-wide
  与 precise session 两个不同 scope。不按事件文本猜 scope，也不做全局 event_id 去重。

  `rescue/catch` 只兜住 Registry 通知总线自身不可用（进程/表资源故障），仍然返回
  `:ok`，因为通知不是执行成功的提交点。它不是给未知内部形状补默认：调用方必须
  传入真实 `%AgentRun{}`，结构不匹配会在函数入口直接失败。
  """
  @spec publish(AgentEvent.t(), AgentRun.t()) :: :ok
  def publish(%AgentEvent{} = event, %AgentRun{work_id: work_id, session_id: session_id}) do
    dispatch({work_id}, event)

    if is_binary(session_id) do
      dispatch({work_id, session_id}, event)
    end

    :ok
  rescue
    _ -> delivery_failed(event)
  catch
    _, _ -> delivery_failed(event)
  end

  defp dispatch(scope, event) do
    Registry.dispatch(@registry, scope, fn entries ->
      Enum.each(entries, fn {pid, _value} -> send(pid, {:agent_event, event}) end)
    end)
  end

  defp delivery_failed(event) do
    LogEmit.emit(:agent_run, :delivery, :error, %{
      run_id: event.run_ref,
      event_ref: event.event_id,
      event_type: event.event_type,
      reason_code: :event_dispatch_unavailable
    })

    :ok
  end
end
