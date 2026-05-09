defmodule NovelApplication.TracePersisterContractTest do
  use ExUnit.Case, async: false

  @moduledoc """
  验证 DialogueGateway.handle_input 正确调用注入的 trace_persister 回调。

  通过 Agent 捕获回调参数，不直接引用 persistence 模块。
  """

  alias NovelApplication.DialogueGateway

  @frame_json """
  {
    "frame_type": "casual_reply",
    "dialogue_goal_summary": "用户发来消息",
    "needs_tool": false,
    "no_tool_reason": "no_tool_needed",
    "execution_readiness": "not_applicable",
    "assistant_message": "收到你的消息。",
    "candidate_directions": [],
    "context_used": false,
    "uncertainty": []
  }
  """

  describe "trace persister callback contract" do
    test "trace_persister is called with workspace_id and trace attrs after handle_input" do
      complete_fn = fn _prompt -> {:ok, %{content: @frame_json}} end

      {:ok, agent} = Agent.start_link(fn -> [] end)
      ws_id = "ws-trace-#{System.unique_integer([:positive, :monotonic])}"

      persister = fn ws_id_arg, attrs ->
        Agent.update(agent, &[{ws_id_arg, attrs} | &1])
        :ok
      end

      {:ok, _turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "trace test", workspace_id: ws_id},
          nil, complete_fn, persister)

      captured = Agent.get(agent, & &1) |> Enum.reverse()
      assert length(captured) == 1
      [{captured_ws_id, captured_attrs}] = captured

      assert captured_ws_id == ws_id
      assert captured_attrs[:trace_id] == trace.trace_id
      assert captured_attrs[:turn_id] == trace.turn_id
      assert captured_attrs[:decision_type] != nil
      assert captured_attrs[:event_order] != nil
    end
  end
end
