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
    result = judgment_response("请提供需要保留的原文，收到后再按原文登记。", [gap_call(refs)], "gap-current")

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
               "prun-judgment-operation-1" => %{
                 result.provider_output
                 | provider_call_ref: "pcall-judgment-operation-1",
                   provider_run_ref: "prun-judgment-operation-1"
               }
             })
  end

  test "不存在或带描述的替代操作必须纠错，原始参数与实际来源不被删改" do
    for bad_ref <- ["make_magic", "chapter_read(查正文)"] do
      invalid = gap_call([bad_ref, "chapter_read"])
      corrected = %{gap_call(["chapter_read"]) | id: "tool-gap-corrected"}
      first = judgment_response("请提供需要保留的原文，收到后再按原文登记。", [invalid], "gap-invalid")
      second = judgment_response("请提供需要保留的原文，收到后再按原文登记。", [corrected], "gap-corrected")

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
                 "prun-judgment-operation-2" => %{
                   second.provider_output
                   | provider_call_ref: "pcall-judgment-operation-2",
                     provider_run_ref: "prun-judgment-operation-2"
                 }
               })

      assert_receive {:provider_request, first_request}
      assert_receive {:provider_request, corrected_request}
      assert corrected_request.run == first_request.run
      assert corrected_request.tools == first_request.tools

      assert blocks(corrected_request, "validation_result")
             |> Enum.any?(&(&1.call_id == original.call_id and &1.status == "failed"))
    end
  end

  test "固定目录中的作者称谓不授予当前 Scope 未开放的能力" do
    assert_capability_correction("plot_outline", "character_design")
  end

  test "作者称谓不能替代 capability 机器标识且仍在原两次预算内纠正" do
    assert_capability_correction("大纲规划", "plot_outline")
  end

  test "已列名但未开放的探索操作不能作为当前替代路径" do
    invalid = gap_call(["chapter_read"])
    corrected = %{gap_call(["ask_author"]) | id: "tool-gap-current-profile"}

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([
                 judgment_response("请提供需要保留的原文，收到后再按原文登记。", [invalid], "gap-closed"),
                 judgment_response("请提供需要保留的原文，收到后再按原文登记。", [corrected], "gap-open")
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
                 judgment_response("请提供需要保留的原文，收到后再按原文登记。", [invalid], "continuation-invalid"),
                 judgment_response("请提供需要保留的原文，收到后再按原文登记。", [corrected], "continuation-corrected")
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
                 judgment_response("请提供需要保留的原文，收到后再按原文登记。", [first], "gap-bad-1"),
                 judgment_response("请提供需要保留的原文，收到后再按原文登记。", [second], "gap-bad-2")
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
        {value, reason} <- [
          {"foreign-ref", "target_ref_field_conflict"},
          {nil, "invalid_tool_arguments"}
        ] do
      invalid = execute_call(Map.put(%{"capability" => "character_design"}, field, value))
      corrected = %{execute_call(%{"capability" => "character_design"}) | id: "target-clean"}

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([
                   judgment_response("按作者要求提出候选。", [invalid], "target-invalid"),
                   judgment_response("按作者要求提出候选。", [corrected], "target-clean")
                 ]),
                 %{},
                 judgment_input(capabilities: ["character_design"])
               )

      assert judgment.action == "execute"
      assert judgment.pending_artifact_ref == nil
      assert judgment.adopted_content_ref == nil
      assert judgment.character_ref == nil
      assert_target_correction(judgment, invalid, corrected, reason)
    end
  end

  test "候选修订只接受所属目标字段，其他两类引用及 null 都必须纠错" do
    for extra <- ["adopted_content_ref", "character_ref"],
        {value, reason} <- [
          {"as_real", "target_ref_field_conflict"},
          {nil, "invalid_tool_arguments"}
        ] do
      args = %{"capability" => "revise_pending_artifact", "pending_artifact_ref" => "as_real"}
      invalid = execute_call(Map.put(args, extra, value))
      corrected = %{execute_call(args) | id: "pending-corrected"}

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([
                   judgment_response("按作者要求提出候选。", [invalid], "pending-invalid"),
                   judgment_response("按作者要求提出候选。", [corrected], "pending-corrected")
                 ]),
                 %{},
                 judgment_input(
                   capabilities: ["revise_pending_artifact"],
                   pending_artifact_targets: %{"as_real" => ["revise_pending_artifact"]}
                 )
               )

      assert judgment.action == "execute"
      assert judgment.pending_artifact_ref == "as_real"
      assert_target_correction(judgment, invalid, corrected, reason)
    end
  end

  test "多余旧章引用不能把普通候选或新建能力纠错成已采纳内容修订" do
    for args <- [
          %{"capability" => "revise_pending_artifact", "pending_artifact_ref" => "as_real"},
          %{"capability" => "character_design"}
        ] do
      invalid = execute_call(Map.put(args, "target_chapter_ref", "chapter:foreign"))
      corrected = %{execute_call(args) | id: "legacy-target-removed"}

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([
                   judgment_response("按作者要求提出候选。", [invalid], "legacy-target-invalid"),
                   judgment_response("按作者要求提出候选。", [corrected], "legacy-target-removed")
                 ]),
                 %{},
                 judgment_input(
                   capabilities: [args["capability"]],
                   pending_artifact_targets: %{"as_real" => ["revise_pending_artifact"]}
                 )
               )

      assert judgment.capability == args["capability"]
      assert judgment.pending_artifact_ref == args["pending_artifact_ref"]
      assert [failed, _passed] = blocks(judgment.transcript, "validation_result")
      refute failed.detail["message"] =~ "必须用 adopted_content_ref"
      assert_target_correction(judgment, invalid, corrected, "invalid_tool_arguments")
    end
  end

  test "错误引用后仅补正确引用并留 null 仍失败，两次交换后不得第三次调用" do
    first =
      execute_call(%{
        "capability" => "revise_pending_artifact",
        "adopted_content_ref" => "as_real"
      })

    second =
      %{
        execute_call(%{
          "capability" => "revise_pending_artifact",
          "pending_artifact_ref" => "as_real",
          "adopted_content_ref" => nil
        })
        | id: "pending-null"
      }

    assert {:error, {:judgment_protocol_violation, :invalid_tool_arguments}, state} =
             JudgmentProtocol.request_judgment(
               execution([
                 judgment_response("按作者要求提出候选。", [first], "pending-wrong-field"),
                 judgment_response("按作者要求提出候选。", [second], "pending-null"),
                 judgment_response("第三次调用不应发生。", [], "unexpected-third")
               ]),
               %{},
               judgment_input(
                 capabilities: ["revise_pending_artifact"],
                 pending_artifact_targets: %{"as_real" => ["revise_pending_artifact"]}
               )
             )

    assert state.provider_call_count == 2

    assert Enum.map(blocks(state.judgment_transcript, "tool_call"), & &1.arguments) ==
             [first.arguments, second.arguments]

    assert [failed, terminal] = blocks(state.judgment_transcript, "validation_result")
    assert failed.reason_code == "target_ref_field_conflict"
    assert failed.retryable == true
    assert failed.budget_after == exchange_budget(1)
    assert terminal.reason_code == "invalid_tool_arguments"
    assert terminal.status == "failed"
    assert terminal.retryable == false
    assert terminal.budget_after == exchange_budget(2)
    assert_target_guidance(terminal.detail["message"])
    assert_receive {:provider_request, first_request}
    assert_receive {:provider_request, second_request}
    assert second_request.tools == first_request.tools
    refute_receive {:provider_request, _third}, 10
  end

  test "省略、未知或带空白的引用不能自动绑定唯一真实候选" do
    for ref <- [nil, "as_missing", " as_real\n"] do
      args = %{"capability" => "revise_pending_artifact"}
      args = if is_nil(ref), do: args, else: Map.put(args, "pending_artifact_ref", ref)
      first = execute_call(args)
      second = %{first | id: "unbound-second"}

      assert {:error, {:pending_artifact_invalid, :target_not_available}, state} =
               JudgmentProtocol.request_judgment(
                 execution([
                   judgment_response("按作者要求提出候选。", [first], "unbound-first"),
                   judgment_response("按作者要求提出候选。", [second], "unbound-second"),
                   judgment_response("第三次调用不应发生。", [], "unexpected-third")
                 ]),
                 %{},
                 judgment_input(
                   capabilities: ["revise_pending_artifact"],
                   pending_artifact_targets: %{"as_real" => ["revise_pending_artifact"]}
                 )
               )

      assert state.provider_call_count == 2

      assert Enum.map(blocks(state.judgment_transcript, "tool_call"), & &1.arguments) ==
               [first.arguments, second.arguments]

      assert_receive {:provider_request, _first}
      assert_receive {:provider_request, _second}
      refute_receive {:provider_request, _third}, 10
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

    assert [first, terminal] =
             Enum.filter(state.judgment_transcript.messages, fn message ->
               Enum.any?(message.blocks, &(&1.type == "validation_result"))
             end)

    for notice <- [first, terminal] do
      assert notice.role == "application_notice"
      assert [%{type: "validation_result", status: "failed"} = receipt] = notice.blocks
      refute Map.has_key?(notice, :call_id)
      refute Map.has_key?(receipt, :call_id)
    end

    refute Enum.any?(state.judgment_transcript.messages, &(&1.role == "tool"))
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

  defp assert_capability_correction(unavailable, allowed) do
    author = "  先给出候选。\n原文中的 plot_outline 保持原样。  "
    reasoning = "  我会按当前材料提出候选。\n由你决定是否采纳。  "
    invalid = execute_call(%{"capability" => unavailable})

    corrected = %{
      execute_call(%{"capability" => allowed})
      | id: "tool-capability-corrected"
    }

    second = judgment_response(reasoning, [corrected], "capability-corrected")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([judgment_response(reasoning, [invalid], "capability-invalid"), second]),
               %{},
               judgment_input(capabilities: [allowed]) |> Map.put(:author_text, author)
             )

    assert judgment.action == "execute"
    assert judgment.capability == allowed
    assert judgment.provider_call_count == 2
    assert judgment.narrative == reasoning
    assert judgment.narrative_source.source_type == "provider_output"

    assert judgment.narrative_source.source_byte_range == %{
             start: 0,
             length: byte_size(reasoning)
           }

    assert [original, accepted] = blocks(judgment.transcript, "tool_call")
    assert original.arguments == invalid.arguments
    assert accepted.arguments == corrected.arguments
    assert [failed, passed] = blocks(judgment.transcript, "validation_result")
    assert failed.call_id == original.call_id
    assert failed.status == "failed"
    assert failed.reason_code == "capability_not_available"
    assert failed.retryable == true
    assert failed.budget_after == exchange_budget(1)
    assert passed.call_id == accepted.call_id
    assert passed.status == "passed"
    assert passed.retryable == false
    assert passed.budget_after == exchange_budget(2)

    assert_receive {:provider_request, first_request}
    assert_receive {:provider_request, corrected_request}
    assert corrected_request.run == first_request.run
    assert corrected_request.tools == first_request.tools
    assert [correction] = blocks(corrected_request, "validation_result")
    assert correction == failed
    refute_receive {:provider_request, _third}, 10

    assert [scope] = blocks(first_request, "scope")
    assert scope.content["operation"]["available_operations"] == [allowed]
    base = Enum.find(first_request.messages, &(&1.role == "application_base"))
    assert [%{type: "text", text: base_text}] = base.blocks
    assert base_text == NovelCommon.RequestIR.application_base_text()
    assert first_request.system.run_role == "judgment"

    [_, definitions_and_output] =
      String.split(
        first_request.system.instructions,
        "判断角色固定定义（不是当前许可；当前允许集、目标、权限和预算以最新 Scope 为准）：\n",
        parts: 2
      )

    definitions =
      definitions_and_output |> String.split("\n", parts: 2) |> hd() |> Jason.decode!()

    assert Enum.any?(definitions["capabilities"], fn entry ->
             entry["name"] == "plot_outline" and entry["display_name"] == "大纲规划"
           end)

    user = Enum.find(first_request.messages, &(&1.role == "user"))
    assert [%{type: "text", text: ^author}] = user.blocks

    assert :ok =
             AgentNarrativeSource.verify(judgment.narrative, judgment.narrative_source, %{
               "prun-judgment-operation-2" => %{
                 second.provider_output
                 | provider_call_ref: "pcall-judgment-operation-2",
                   provider_run_ref: "prun-judgment-operation-2"
               }
             })
  end

  defp assert_target_correction(judgment, invalid, corrected, reason) do
    assert judgment.provider_call_count == 2
    assert [original, accepted] = blocks(judgment.transcript, "tool_call")
    assert original.arguments == invalid.arguments
    assert accepted.arguments == corrected.arguments
    assert [failed, passed] = blocks(judgment.transcript, "validation_result")
    assert failed.call_id == original.call_id
    assert failed.status == "failed"
    assert failed.reason_code == reason
    assert failed.retryable == true
    assert failed.budget_after == exchange_budget(1)
    assert passed.call_id == accepted.call_id
    assert passed.status == "passed"
    assert passed.retryable == false
    assert passed.budget_after == exchange_budget(2)
    assert_target_guidance(failed.detail["message"])
    assert_receive {:provider_request, first_request}
    assert_receive {:provider_request, corrected_request}
    assert corrected_request.run == first_request.run
    assert corrected_request.tools == first_request.tools
    assert [correction] = blocks(corrected_request, "validation_result")
    assert correction.call_id == original.call_id
    assert correction.detail["message"] == failed.detail["message"]
    refute_receive {:provider_request, _third}, 10
  end

  defp assert_target_guidance(message) do
    for {field, capabilities} <- [
          {"pending_artifact_ref", ["revise_pending_artifact", "discard_pending_artifact"]},
          {"adopted_content_ref", ["revise_adopted_content"]},
          {"character_ref", ["revise_character_profile"]}
        ] do
      assert message =~ field
      for capability <- capabilities, do: assert(message =~ capability)
    end

    assert message =~ "非空字符串"
    assert message =~ "不提供此字段，包括 null"
    refute message =~ "必须用 adopted_content_ref"
  end

  defp gap_call(refs) do
    judgment_call("report_capability_gap", %{
      "dialogue_goal" => "按作者要求保留原文登记",
      "missing_effect" => "当前没有可逐字登记的原文",
      "alternative_operation_refs" => refs
    })
  end

  defp execute_call(overrides) do
    judgment_call(
      "judgment_decision",
      Map.merge(
        %{
          "action" => "execute",
          "dialogue_goal" => "按已确认对象创作"
        },
        overrides
      )
    )
  end

  defp execution(results) do
    test = self()
    key = make_ref()
    Process.put(key, {results, 0})

    %Execution{
      result_fn: fn request ->
        send(test, {:provider_request, request})
        {[result | remaining], previous} = Process.get(key)
        sequence = previous + 1
        Process.put(key, {remaining, sequence})

        case result do
          {:error, _reason} = error ->
            error

          response ->
            refs = %{
              provider_call_ref: "pcall-judgment-operation-#{sequence}",
              provider_run_ref: "prun-judgment-operation-#{sequence}"
            }

            response =
              response
              |> Map.merge(refs)
              |> Map.update!(:provider_output, &Map.merge(&1, refs))

            {:ok, response}
        end
      end
    }
  end

  defp blocks(%{messages: messages}, type) do
    for message <- messages, block <- message.blocks, block.type == type, do: block
  end

  defp exchange_budget(count),
    do: %{"exchange" => %{"provider_call_budget" => 2, "provider_call_count" => count}}
end
