defmodule NovelApplication.BlockedDecisionTrace do
  @moduledoc """
  GATE-ORDER-CLOSURE（ADR-0005）：被 gate 阻断的决策也必须写 DecisionTrace。

  allow_tool 路径由 `TraceWriter.record_with_tool/7` 写 trace；阻断路径此前只有
  作者可见 agent event（`gate_decided`）而没有持久 DecisionTrace，违反
  ADR-0005「每个不可逆动作逐门可解释 / validation failure 不得被吞掉」。

  本模块在 agent run 的 tool step 被 gate 阻断时，把同一份
  `OrchestratorDecision`（含 `gate_order_version` 与逐门 `GateResult`）投影成
  DecisionTrace 并走既有 `DialogueGateway.persist_turn_trace/4` 通道落库，不改变
  AgentRun 的失败/停等语义。
  """

  alias NovelApplication.DialogueGateway
  alias NovelApplication.TraceWriter
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @doc """
  持久化阻断决策的 DecisionTrace。

  `run` 提供 workspace/session 作用域；`trace_persister` 为 nil 时只生成内存 trace
  （与既有 allow 路径同语义：无持久化注入则不伪造落库事实）。
  """
  @spec record(DialogueFrame.t(), MicroPlan.t(), OrchestratorDecision.t(), map(), term()) :: :ok
  def record(
        %DialogueFrame{} = frame,
        %MicroPlan{} = plan,
        %OrchestratorDecision{} = decision,
        run,
        trace_persister
      )
      when is_map(run) do
    turn_result = %{turn_id: frame.turn_id}

    {trace, _summary} = TraceWriter.record_with_decision(frame, plan, decision, turn_result, nil)

    DialogueGateway.persist_turn_trace(
      {:ok, turn_result, trace, [], nil},
      workspace_id(run),
      session_id(run),
      trace_persister
    )
  end

  defp workspace_id(run), do: Map.get(run, :workspace_id) || Map.get(run, "workspace_id")
  defp session_id(run), do: Map.get(run, :session_id) || Map.get(run, "session_id")
end
