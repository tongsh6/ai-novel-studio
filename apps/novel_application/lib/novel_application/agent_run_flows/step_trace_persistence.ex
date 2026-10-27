defmodule NovelApplication.AgentRunFlows.StepTracePersistence do
  @moduledoc """
  B59：把 AgentRun 内部步的 `DecisionTrace` 落库。

  判断纪元起，工作台工具 turn 由 AgentRun flow 执行；每个内部步经
  `TurnExecutionService.execute/1` 产生 `TurnResult` 与 `DecisionTrace`
  （`TraceWriter.record_with_tool/7` 携带 registry snapshot / contract refs /
  grant summary / redacted request-result summaries）。此前 5 个 flow 只取
  `TurnResult`、丢弃 trace，step trace 从未进 `TraceRepository`，导致 AU-07
  的 ToolTrace 持久回查与 ReplayReport 对 AgentRun step 不可达。

  本模块只做「既有 trace 走既有持久化通道」的接线，不重建 ReplayService、
  不改变 trace 内容/redaction/tool 语义。落库通道复用
  `DialogueGateway.persist_turn_trace/4`（与顶层 turn、prose writer、blocked
  decision 同一条），持久化失败按既有语义只记 developer 日志、不阻塞 run。

  产品代码不读取验收专用开关；`spec[:trace_persister]` 由生产 Channel 注入
  （`inject_real_persistence` 开时），测试可注入同形回调。
  """

  alias NovelApplication.DialogueGateway

  @doc """
  把 `turn_result` 对应的 step trace 交给既有 persister。

  - `run` 提供 `workspace_id` / `session_id` 作用域（AgentRun 必须有）；
  - `context` 与 `TurnExecutionService.execute/1` 的入参一致，允许 `nil`；
  - `trace` 为 `nil` 时 no-op（例如测试/无 trace 的执行替身）；
  - `trace_persister` 缺省时由 `DialogueGateway` 回退到应用级 persister。

  返回 `:ok`（持久化失败已在既有通道内收敛为 developer 日志）。
  """
  @spec persist(map(), map(), struct() | nil, map() | nil, map()) :: :ok
  def persist(run, turn_result, trace, context, spec) when is_map(run) and is_map(spec) do
    if is_nil(trace) do
      :ok
    else
      DialogueGateway.persist_turn_trace(
        {:ok, turn_result, trace, [], context},
        Map.get(run, :workspace_id),
        Map.get(run, :session_id),
        Map.get(spec, :trace_persister)
      )
    end
  end
end
