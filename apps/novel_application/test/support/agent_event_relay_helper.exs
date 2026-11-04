defmodule NovelApplication.TestAgentEventRelay do
  @moduledoc """
  测试用真实订阅者：通过公共 `AgentRunService.subscribe_events/2` 订阅
  work/session 作用域，把 Registry 投递的真实 `AgentEvent` 交给测试转发函数。

  - `observe/2` 只订阅并原样返回 run attrs，供测试写成
    `AgentRunService.start_bounded(TestAgentEventRelay.observe(attrs, forward), opts)`；
    它不镜像服务 API，也不向生产代码传入测试选项。
  - `subscribe/4` 供 recover/confirmation 等非启动路径先显式订阅，再调用真实服务。
  - `run_id` 为 nil 时转发该作用域的全部事件；否则只转发该 run 的事件。
  - 订阅注册在 relay 进程中，随 relay 退出自动清理；转发函数异常会让 relay 退出，
    测试进程因此失败——这里不吞掉观察者的真实失败。
  """

  alias NovelApplication.AgentRunService
  alias NovelCommon.Contracts.AgentEvent

  @doc """
  订阅 `run_attrs` 的真实 work/session 作用域，并原样返回 `run_attrs`。

  `run_attrs` 没有可用 work_id 时不订阅，保持测试 attrs 不变。
  """
  @spec observe(map(), (AgentEvent.t() -> any())) :: map()
  def observe(run_attrs, forward) when is_map(run_attrs) and is_function(forward, 1) do
    work_id = fetch(run_attrs, :work_id)
    session_id = fetch(run_attrs, :session_id)
    run_id = fetch(run_attrs, :run_id)

    if is_binary(work_id) do
      subscribe(work_id, session_id, run_id, forward)
    end

    run_attrs
  end

  @doc """
  在 relay 进程中注册一次真实订阅，返回 relay pid。

  relay 与调用者 link；调用者退出时 relay 退出，Registry 条目随之清理。
  """
  @spec subscribe(String.t(), String.t() | nil, String.t() | nil, (AgentEvent.t() -> any())) ::
          pid()
  def subscribe(work_id, session_id, run_id, forward)
      when is_binary(work_id) and (is_binary(session_id) or is_nil(session_id)) and
             (is_binary(run_id) or is_nil(run_id)) and is_function(forward, 1) do
    caller = self()

    relay =
      spawn_link(fn ->
        caller_ref = Process.monitor(caller)
        :ok = AgentRunService.subscribe_events(work_id, session_id)
        send(caller, {:agent_event_relay_ready, self()})
        relay(run_id, forward, caller_ref)
      end)

    receive do
      {:agent_event_relay_ready, ^relay} -> relay
    after
      1_000 -> raise "agent event relay did not subscribe in time"
    end
  end

  defp relay(run_id, forward, caller_ref) do
    receive do
      {:agent_event, %AgentEvent{run_ref: run_ref} = event} ->
        if is_nil(run_id) or run_ref == run_id, do: forward.(event)
        relay(run_id, forward, caller_ref)

      {:DOWN, ^caller_ref, :process, _caller, _reason} ->
        :ok
    end
  end

  defp fetch(attrs, key) when is_map(attrs),
    do: Map.get(attrs, key) || Map.get(attrs, to_string(key))

  defp fetch(_attrs, _key), do: nil
end
