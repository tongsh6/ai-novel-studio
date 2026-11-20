defmodule NovelApplication.AgentRunFlows.AuthoringSessionProviderCallCountTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunFlows.AuthoringSession

  describe "provider_call_count/1" do
    test "真实 0/1/2 次消耗独立于各阶段调用上限，JSON 往返不改变计数" do
      for count <- [0, 1, 2] do
        turn_result = %{
          trace_summary: %{
            execution_counts: %{provider_calls: count, tool_calls: 1},
            provider_call_budget: %{writer: 2, evaluator: 2, revision_writer: 0}
          }
        }

        assert AuthoringSession.provider_call_count(turn_result) == count

        restored = turn_result |> Jason.encode!() |> Jason.decode!()
        assert AuthoringSession.provider_call_count(restored) == count
      end
    end

    test "缺失或非法执行计数不得用预算或工具名称补造消耗" do
      budget_only = %{
        tool_result: %{tool_name: "character_design"},
        trace_summary: %{
          provider_call_budget: %{writer: 2, evaluator: 2, revision_writer: 0}
        }
      }

      for turn_result <- [nil, %{}, budget_only, Jason.decode!(Jason.encode!(budget_only))] do
        assert AuthoringSession.provider_call_count(turn_result) == 0
      end

      for count <- [nil, -1, "2", 2.0, false] do
        turn_result =
          put_in(budget_only, [:trace_summary, :execution_counts], %{provider_calls: count})

        assert AuthoringSession.provider_call_count(turn_result) == 0
      end

      assert AuthoringSession.provider_call_count(%{trace_summary: %{execution_counts: []}}) == 0
    end
  end
end
