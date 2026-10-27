defmodule NovelApplication.AgentRunFlows.StepTracePersistenceTest do
  @moduledoc """
  B59 CP1：AgentRun 内部步 trace 持久化接线的单元回归。

  只验证「得到 trace 就交给既有 persister、按 run 作用域写 attrs、nil trace no-op」，
  不重建 ReplayService、不改变 trace 内容/redaction 语义。flow 级落库由各
  `agent_run_*_flow_test.exs` 的注入断言覆盖。
  """

  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunFlows.StepTracePersistence

  defp step_trace(attrs \\ %{}) do
    Map.merge(
      %{
        trace_id: "tr_step",
        turn_id: "message_1:agent:2",
        frame_ref: "frame_step",
        plan_ref: "mp_step",
        decision_type: :allow_tool,
        no_tool_reason: nil,
        no_behavior_reason: nil,
        no_write_reason: nil,
        turn_result_ref: "turn_result_step",
        replay_policy: "author_safe",
        redaction_level: :author_safe,
        gate_order_version: "adr-0005-v1",
        gate_result_refs: [],
        tool_trace_refs: [
          %{tool_name: "character_roster", tool_status: :succeeded}
        ],
        behavior_trace_refs: [],
        state_trace_refs: [],
        event_order: [:tool_started, :tool_completed]
      },
      attrs
    )
  end

  test "step trace 走既有 persister，以 run 的 workspace/session 作用域写 attrs" do
    parent = self()

    spec = %{
      trace_persister: fn work, attrs ->
        send(parent, {:persisted, work, attrs})
        :ok
      end
    }

    run = %{workspace_id: "work-b59", session_id: "session-b59"}
    turn_result = %{turn_id: "message_1:agent:2", status: :succeeded}

    assert :ok = StepTracePersistence.persist(run, turn_result, step_trace(), nil, spec)

    assert_receive {:persisted, "work-b59", attrs}
    assert attrs.workspace_id == "work-b59"
    assert attrs.session_id == "session-b59"
    assert attrs.turn_id == "message_1:agent:2"
    assert attrs.decision_type == "allow_tool"
    assert attrs.gate_order_version == "adr-0005-v1"
    assert [%{tool_name: "character_roster"}] = attrs.tool_trace_refs
  end

  test "nil trace 为 no-op，不调用 persister" do
    parent = self()

    spec = %{
      trace_persister: fn work, attrs ->
        send(parent, {:persisted, work, attrs})
        :ok
      end
    }

    assert :ok =
             StepTracePersistence.persist(
               %{workspace_id: "w", session_id: "s"},
               %{turn_id: "t"},
               nil,
               nil,
               spec
             )

    refute_receive {:persisted, _, _}, 20
  end
end
