defmodule NovelApplication.AgentRunFlows.AuthoringSessionProviderCallCountTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR

  @run %{
    run_id: "run-session",
    work_id: "work-session",
    workspace_id: "workspace-session",
    session_id: "session-session",
    parent_turn_ref: "turn-session",
    goal: %{text: "共用真实会话", version: 1}
  }

  @tool %{
    name: "submit_tentative_artifact",
    description: "提交候选，不采纳",
    input_schema: %{type: "object"}
  }

  # 作者中文、全角空格、制表符、行尾空格都必须逐字保留。
  @author_text "　第一章\t \n  连续  空格与结尾空格  \n"

  defp transcript do
    AuthoringTranscript.new(@run,
      base_text: "角色规则：只在授权边界内提出候选。",
      author_text: @author_text,
      author_turn_ref: "turn-session",
      tools: [@tool]
    )
  end

  defp base_ir do
    {:ok, ir} = AuthoringTranscript.to_request_ir(transcript())
    ir
  end

  defp append_assistant_result(ir, tool_calls) do
    RequestIR.append_assistant_result(ir, %{content: "候选内容。", tool_calls: tool_calls})
  end

  defp validation_blocks(ir) do
    Enum.flat_map(ir.messages, fn message ->
      Enum.filter(message.blocks, &(&1.type == "validation_result"))
    end)
  end

  defp validation_blocks(ir, call_id) do
    Enum.filter(validation_blocks(ir), &(&1.call_id == call_id))
  end

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

  describe "validate_provider_result/4 exchange window" do
    test "R07 最终校验从本次 session 记录交换窗口，不从剩余额度另开纠错" do
      for {status, reason} <- [
            {"passed", "tentative_artifact_validated"},
            {"failed", "creative_result_rejected"}
          ] do
        {ir, provider_result} =
          append_assistant_result(base_ir(), [
            %{id: "result-window", name: "submit_tentative_artifact", arguments: %{"items" => []}}
          ])

        session = %{
          request_ir: ir,
          provider_result: provider_result,
          provider_call_budget: 2,
          provider_call_count: 1,
          tool_call_count: 1
        }

        validated =
          AuthoringSession.validate_provider_result(session, status, reason, %{
            adoption_required: true,
            canon_written: false
          })

        assert [block] = validation_blocks(validated.request_ir, "result-window")
        assert block.status == status
        assert block.retryable == false

        assert block.budget_after == %{
                 "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}
               }

        assert block.detail == %{"adoption_required" => true, "canon_written" => false}
        assert validated.provider_call_count == 1
        assert validated.provider_call_budget == 2
        assert {:ok, []} = RequestIR.pending_call_ids(validated.request_ir)
      end
    end

    test "R07 session 缺当时上限或次数时预算为 null，不借 Scope 或默认 0 补造" do
      initial =
        RequestIR.append_scope_update(base_ir(), %{
          work_id: @run.work_id,
          operation: %{
            runtime: %{budget: %{provider_calls: 99}, consumed_budget: %{provider_calls: 98}}
          }
        })

      assert :ok = RequestIR.validate(initial)

      {ir, provider_result} =
        append_assistant_result(initial, [
          %{id: "unknown-window", name: "submit_tentative_artifact", arguments: %{"items" => []}}
        ])

      for counts <- [%{provider_call_count: 1}, %{provider_call_budget: 2}, %{}] do
        session = Map.merge(counts, %{request_ir: ir, provider_result: provider_result})

        validated =
          AuthoringSession.validate_provider_result(
            session,
            "failed",
            "creative_result_rejected",
            %{}
          )

        assert [block] = validation_blocks(validated.request_ir, "unknown-window")
        assert block.retryable == false
        assert block.budget_after == nil
        assert {:ok, []} = RequestIR.pending_call_ids(validated.request_ir)
      end
    end
  end
end
