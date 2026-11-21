defmodule NovelApplication.JudgmentOperationContractTest do
  use ExUnit.Case, async: true

  import NovelApplication.TestAgenticLoopFixtures,
    only: [
      judgment_response: 3,
      judgment_call: 2,
      judgment_input: 0,
      judgment_input: 1
    ]

  alias NovelAgent.Provider.Execution
  alias NovelApplication.{AgentNarrativeSource, JudgmentProtocol}

  test "能力缺口原样接受当前 capability、当前 profile 工具与开放探索目录中的引用" do
    refs = ["character_design", "register_author_content", "chapter_read"]
    result = judgment_response("", [gap_call(refs)], "gap-current")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([result]),
               %{},
               judgment_input(
                 capabilities: ["character_design"],
                 explore: true,
                 explore_tools: ["chapter_read"]
               )
             )

    assert judgment.action == "capability_gap"
    assert judgment.provider_call_count == 1
    assert [call] = blocks(judgment.transcript, "tool_call")
    assert call.arguments["alternative_operation_refs"] == refs

    assert :ok =
             AgentNarrativeSource.verify(judgment.narrative, judgment.narrative_source, %{
               "run-gap-current" => result.provider_output
             })
  end

  test "不存在或带描述的替代操作必须纠错，原始参数与实际来源不被删改" do
    for bad_ref <- ["make_magic", "chapter_read(查正文)"] do
      invalid = gap_call([bad_ref, "chapter_read"])
      corrected = %{gap_call(["chapter_read"]) | id: "tool-gap-corrected"}
      first = judgment_response("", [invalid], "gap-invalid")
      second = judgment_response("", [corrected], "gap-corrected")

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([first, second]),
                 %{},
                 judgment_input(explore: true, explore_tools: ["chapter_read"])
               )

      assert judgment.provider_call_count == 2
      assert [original, accepted] = blocks(judgment.transcript, "tool_call")
      assert original.arguments == invalid.arguments
      assert accepted.arguments == corrected.arguments
      assert [failed, passed] = blocks(judgment.transcript, "validation_result")
      assert failed.call_id == original.call_id
      assert failed.status == "failed"
      assert failed.reason_code == "invalid_alternative_operation_refs"
      assert failed.retryable == true
      assert failed.budget_after == exchange_budget(1)
      assert passed.call_id == accepted.call_id
      assert passed.status == "passed"
      assert passed.retryable == false
      assert passed.budget_after == exchange_budget(2)

      assert :ok =
               AgentNarrativeSource.verify(judgment.narrative, judgment.narrative_source, %{
                 "run-gap-corrected" => second.provider_output
               })

      assert_receive {:provider_request, first_request}
      assert_receive {:provider_request, corrected_request}
      assert corrected_request.run == first_request.run
      assert corrected_request.tools == first_request.tools

      assert blocks(corrected_request, "validation_result")
             |> Enum.any?(&(&1.call_id == original.call_id and &1.status == "failed"))
    end
  end

  test "已列名但未开放的探索操作不能作为当前替代路径" do
    invalid = gap_call(["chapter_read"])
    corrected = %{gap_call(["ask_author"]) | id: "tool-gap-current-profile"}

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([
                 judgment_response("", [invalid], "gap-closed"),
                 judgment_response("", [corrected], "gap-open")
               ]),
               %{},
               judgment_input(explore: false, explore_tools: ["chapter_read"])
             )

    assert judgment.provider_call_count == 2
    assert [failed, _passed] = blocks(judgment.transcript, "validation_result")
    assert failed.reason_code == "invalid_alternative_operation_refs"
    assert hd(blocks(judgment.transcript, "tool_call")).arguments == invalid.arguments
  end

  test "continuation 缺口只能引用当前 profile，不能借用 judgment 的计划工具" do
    invalid = gap_call(["agent_plan_draft"])
    corrected = %{gap_call(["continuation_decision"]) | id: "tool-gap-continuation"}

    assert {:ok, judgment} =
             JudgmentProtocol.request_continuation(
               execution([
                 judgment_response("", [invalid], "continuation-invalid"),
                 judgment_response("", [corrected], "continuation-corrected")
               ]),
               %{},
               Map.merge(judgment_input(), %{
                 deviation_summary: "还没有可逐字登记的原文",
                 observation_block: "已核对当前材料，尚缺作者原文"
               })
             )

    assert judgment.action == "capability_gap"
    assert judgment.provider_call_count == 2
    assert [failed, passed] = blocks(judgment.transcript, "validation_result")
    assert failed.reason_code == "invalid_alternative_operation_refs"
    assert passed.status == "passed"
  end

  test "无效替代操作连续两次即终止，不能过滤后报告成功" do
    args = gap_call(["invented_operation"]).arguments
    first = %{judgment_call("report_capability_gap", args) | id: "gap-bad-1"}
    second = %{judgment_call("report_capability_gap", args) | id: "gap-bad-2"}

    assert {:error, _reason, state} =
             JudgmentProtocol.request_judgment(
               execution([
                 judgment_response("", [first], "gap-bad-1"),
                 judgment_response("", [second], "gap-bad-2")
               ]),
               %{},
               judgment_input()
             )

    assert state.provider_call_count == 2

    assert Enum.map(blocks(state.judgment_transcript, "tool_call"), & &1.arguments) == [
             args,
             args
           ]

    assert [first_receipt, last_receipt] = blocks(state.judgment_transcript, "validation_result")
    assert first_receipt.reason_code == "invalid_alternative_operation_refs"
    assert first_receipt.retryable == true
    assert last_receipt.status == "failed"
    assert last_receipt.reason_code == "invalid_alternative_operation_refs"
    assert last_receipt.retryable == false
    assert last_receipt.budget_after == exchange_budget(2)
  end

  test "不使用目标引用的新建能力拒绝全部目标字段，包括 null" do
    for field <- ["pending_artifact_ref", "adopted_content_ref", "character_ref"],
        value <- ["foreign-ref", nil] do
      invalid = execute_call(Map.put(%{"capability" => "character_design"}, field, value))
      corrected = %{execute_call(%{"capability" => "character_design"}) | id: "target-clean"}

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([
                   judgment_response("", [invalid], "target-invalid"),
                   judgment_response("", [corrected], "target-clean")
                 ]),
                 %{},
                 judgment_input(capabilities: ["character_design"])
               )

      assert judgment.action == "execute"
      assert judgment.provider_call_count == 2
      assert judgment.pending_artifact_ref == nil
      assert judgment.adopted_content_ref == nil
      assert judgment.character_ref == nil
      assert [failed, passed] = blocks(judgment.transcript, "validation_result")
      assert failed.reason_code == "target_ref_field_conflict"
      assert passed.status == "passed"
      assert hd(blocks(judgment.transcript, "tool_call")).arguments == invalid.arguments
    end
  end

  test "候选修订只接受所属目标字段，其他两类引用及 null 都必须纠错" do
    for extra <- ["adopted_content_ref", "character_ref"], value <- ["as_real", nil] do
      args = %{"capability" => "revise_pending_artifact", "pending_artifact_ref" => "as_real"}
      invalid = execute_call(Map.put(args, extra, value))
      corrected = %{execute_call(args) | id: "pending-corrected"}

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([
                   judgment_response("", [invalid], "pending-invalid"),
                   judgment_response("", [corrected], "pending-corrected")
                 ]),
                 %{},
                 judgment_input(
                   capabilities: ["revise_pending_artifact"],
                   pending_artifact_targets: %{"as_real" => ["revise_pending_artifact"]}
                 )
               )

      assert judgment.action == "execute"
      assert judgment.pending_artifact_ref == "as_real"
      assert judgment.provider_call_count == 2
      assert [failed, passed] = blocks(judgment.transcript, "validation_result")
      assert failed.reason_code == "target_ref_field_conflict"
      assert passed.status == "passed"
      assert hd(blocks(judgment.transcript, "tool_call")).arguments == invalid.arguments
    end
  end

  test "空正文错误也只有两次实际调用，无工具调用时不伪造 tool result" do
    assert {:error, {:judgment_protocol_violation, :judgment_narrative_required}, state} =
             JudgmentProtocol.request_judgment(
               execution([
                 judgment_response("", [], "empty-1"),
                 judgment_response("", [], "empty-2"),
                 judgment_response("第三次调用不应发生。", [], "unexpected-third")
               ]),
               %{},
               judgment_input()
             )

    assert state.provider_call_count == 2
    assert blocks(state.judgment_transcript, "tool_call") == []
    assert blocks(state.judgment_transcript, "validation_result") == []
    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, _second}
    refute_receive {:provider_request, _third}, 10
  end

  test "探索不可用错误遵循同一两次窗口，最后失败不能再声称可重试" do
    args = %{
      "action" => "explore",
      "explore_request" => %{"tool" => "chapter_read", "query" => "第一章"}
    }

    first = %{judgment_call("judgment_decision", args) | id: "explore-disabled-1"}
    second = %{judgment_call("judgment_decision", args) | id: "explore-disabled-2"}

    assert {:error, {:judgment_protocol_violation, :exploration_not_available}, state} =
             JudgmentProtocol.request_judgment(
               execution([
                 judgment_response("", [first], "explore-disabled-1"),
                 judgment_response("", [second], "explore-disabled-2"),
                 judgment_response("第三次调用不应发生。", [], "unexpected-third")
               ]),
               %{},
               judgment_input(explore: false, explore_tools: ["chapter_read"])
             )

    assert state.provider_call_count == 2

    assert Enum.map(blocks(state.judgment_transcript, "tool_call"), & &1.arguments) == [
             args,
             args
           ]

    assert [failed, terminal] = blocks(state.judgment_transcript, "validation_result")
    assert failed.retryable == true
    assert failed.budget_after == exchange_budget(1)
    assert terminal.retryable == false
    assert terminal.budget_after == exchange_budget(2)
    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, _second}
    refute_receive {:provider_request, _third}, 10
  end

  defp gap_call(refs) do
    judgment_call("report_capability_gap", %{
      "dialogue_goal" => "按作者要求保留原文登记",
      "missing_effect" => "当前没有可逐字登记的原文",
      "author_reasoning" => "请提供需要保留的原文，收到后再按原文登记。",
      "alternative_operation_refs" => refs
    })
  end

  defp execute_call(overrides) do
    judgment_call(
      "judgment_decision",
      Map.merge(
        %{
          "action" => "execute",
          "dialogue_goal" => "按已确认对象创作",
          "author_reasoning" => "按作者要求提出候选。"
        },
        overrides
      )
    )
  end

  defp execution(results) do
    test = self()
    key = make_ref()
    Process.put(key, results)

    %Execution{
      result_fn: fn request ->
        send(test, {:provider_request, request})
        [result | remaining] = Process.get(key)
        Process.put(key, remaining)
        {:ok, result}
      end
    }
  end

  defp blocks(%{messages: messages}, type) do
    for message <- messages, block <- message.blocks, block.type == type, do: block
  end

  defp exchange_budget(count),
    do: %{"exchange" => %{"provider_call_budget" => 2, "provider_call_count" => count}}
end
