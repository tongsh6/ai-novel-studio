defmodule NovelApplication.JudgmentProtocolResponseValidationTest do
  use ExUnit.Case, async: true

  import NovelApplication.TestAgenticLoopFixtures,
    only: [judgment_response: 3, judgment_input: 0]

  import NovelApplication.TestAssertions, only: [assert_bound_narrative: 3]

  alias NovelAgent.Provider.Execution
  alias NovelApplication.{AuthoringTranscript, JudgmentProtocol}
  alias NovelCommon.RequestIR

  defp execution(results) do
    parent = self()
    ref = make_ref()
    Process.put(ref, results)

    %Execution{
      result_fn: fn prompt ->
        send(parent, {:provider_request, prompt})
        [result | rest] = Process.get(ref)
        Process.put(ref, if(rest == [], do: [result], else: rest))

        case result do
          {:error, _} = error -> error
          _ -> {:ok, result}
        end
      end
    }
  end

  defp assistant_messages(%{messages: messages}),
    do: Enum.filter(messages, &(Map.get(&1, :role) == "assistant"))

  defp response_with_execution_refs(text, calls, call_ref, run_ref) do
    judgment_response(text, calls, call_ref)
    |> Map.put(:provider_call_ref, call_ref)
    |> Map.put(:provider_run_ref, run_ref)
  end

  @response_rejection_fact "本次响应未通过接收，未作为作者回复发布；仍在处理原作者输入。\n"

  # R08 §19.38：直接经过现接收门，不能以新 API 尚不存在代替实际 producer 反例。
  @tag :r08_response_rejection
  test "R08 无工具拒收：判断首稿的失败事实绑定原响应，纠正稿才成为回复" do
    original = "  角色目录 narrative_role = SUPPORTING。\n"
    final = "我只讨论人物安排，先不生成候选。"
    bad = response_with_execution_refs(original, [], "r08-bad", "run-r08-bad")
    good = response_with_execution_refs(final, [], "r08-good", "run-r08-good")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([bad, good]), %{}, judgment_input())

    assert judgment.provider_call_count == 2
    assert judgment.narrative == final
    assert judgment.narrative_source.provider_call_ref == "r08-good"
    assert_bound_narrative(judgment.narrative_source, final, good.provider_output)
    assert_receive {:provider_request, first}
    assert_receive {:provider_request, retry}
    refute_receive {:provider_request, _}, 10

    assert Enum.take(retry.messages, length(first.messages)) == first.messages

    assert Enum.filter(retry.messages, &(&1.role == "user" and &1.provenance == "author")) ==
             Enum.filter(first.messages, &(&1.role == "user" and &1.provenance == "author"))

    assert [assistant] = assistant_messages(retry)
    assert assistant.blocks == [RequestIR.text_block(original)]
    assert assistant.provider_call_ref == "r08-bad"
    assert assistant.provider_run_ref == "run-r08-bad"
    assert [{notice, receipt}] = response_rejection_receipts(retry)
    assert List.last(retry.messages) == notice
    assert notice.blocks == [receipt]
    assert notice.provider_call_ref == assistant.provider_call_ref
    assert notice.provider_run_ref == assistant.provider_run_ref
    assert receipt.status == "failed"
    assert receipt.reason_code == "author_visible_narrative_invalid"
    assert receipt.detail["reason"] == ":author_visible_narrative_invalid"
    assert String.starts_with?(receipt.detail["message"], @response_rejection_fact)
    assert receipt.detail["message"] =~ "作者叙述包含内部协议字段"
    assert receipt.retryable == true

    assert receipt.budget_after == %{
             "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}
           }

    refute Map.has_key?(receipt, :call_id)
    refute Map.has_key?(receipt, :provider_call_ref)
    refute Map.has_key?(receipt, :provider_run_ref)
    assert RequestIR.call_ids(retry.messages) == []
    assert {:ok, []} = RequestIR.pending_call_ids(retry)
    assert {:ok, final_ir} = AuthoringTranscript.to_request_ir(judgment.transcript)
    assert response_rejection_receipts(final_ir) == [{notice, receipt}]

    assert Enum.map(assistant_messages(final_ir), & &1.provider_call_ref) ==
             ["r08-bad", "r08-good"]
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：相同原文字节的两次真实响应各保留自己的失败终局" do
    text = "内部字段 narrative_role 不得成为作者说明。"
    first = response_with_execution_refs(text, [], "r08-first", "run-r08-first")
    last = response_with_execution_refs(text, [], "r08-last", "run-r08-last")

    assert {:error, {:judgment_protocol_violation, :author_visible_narrative_invalid}, state} =
             JudgmentProtocol.request_judgment(execution([first, last]), %{}, judgment_input())

    assert state.provider_call_count == 2
    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, _retry}
    refute_receive {:provider_request, _}, 10
    transcript = state.judgment_transcript

    assert Enum.map(assistant_messages(transcript), & &1.blocks) ==
             [[RequestIR.text_block(text)], [RequestIR.text_block(text)]]

    assert [{first_notice, first_receipt}, {last_notice, last_receipt}] =
             response_rejection_receipts(transcript)

    assert first_notice.provider_call_ref == "r08-first"
    assert last_notice.provider_call_ref == "r08-last"
    assert first_receipt.retryable == true
    assert last_receipt.retryable == false
    assert first_receipt.budget_after["exchange"]["provider_call_count"] == 1
    assert last_receipt.budget_after["exchange"]["provider_call_count"] == 2
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)
    assert RequestIR.call_ids(ir.messages) == []
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：空内容及仅思考响应保留空 blocks 和真实身份，不补正文" do
    for provider_state <- [%{}, %{"reasoning_content" => "仅供同源回放的内部过程"}] do
      empty =
        response_with_execution_refs("", [], "r08-empty", "run-r08-empty")
        |> Map.put(:provider_state, provider_state)

      good = response_with_execution_refs("材料不足，当前只能讨论。", [], "r08-final", "run-r08-final")

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(execution([empty, good]), %{}, judgment_input())

      assert judgment.provider_call_count == 2
      assert_receive {:provider_request, _first}
      assert_receive {:provider_request, retry}
      refute_receive {:provider_request, _}, 10
      assert [assistant] = assistant_messages(retry)
      assert assistant.blocks == []
      assert assistant.provider_state == provider_state
      assert assistant.provider_call_ref == "r08-empty"
      assert [{notice, receipt}] = response_rejection_receipts(retry)
      assert notice.provider_call_ref == "r08-empty"
      assert notice.provider_run_ref == "run-r08-empty"
      assert receipt.status == "failed"
      refute Map.has_key?(receipt, :call_id)
      assert {:ok, []} = RequestIR.pending_call_ids(retry)
    end
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：纯运输失败没有模型响应，不生成 assistant 或拒收回执" do
    assert {:error, %{type: :timeout}, state} =
             JudgmentProtocol.request_judgment(
               execution([{:error, %{type: :timeout}}, {:error, %{type: :timeout}}]),
               %{},
               judgment_input()
             )

    assert state.provider_call_count == 2
    assert assistant_messages(state.judgment_transcript) == []
    assert response_rejection_receipts(state.judgment_transcript) == []
    assert_receive {:provider_request, first}
    assert_receive {:provider_request, second}
    assert first == second
    refute_receive {:provider_request, _}, 10
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：首稿拒收后运输失败，保留首稿回执且不伪造第二份响应" do
    text = "角色内部字段 narrative_role。"
    bad = response_with_execution_refs(text, [], "r08-before-timeout", "run-r08-before-timeout")

    assert {:error, %{type: :timeout}, state} =
             JudgmentProtocol.request_judgment(
               execution([bad, {:error, %{type: :timeout}}]),
               %{},
               judgment_input()
             )

    assert state.provider_call_count == 2
    assert [assistant] = assistant_messages(state.judgment_transcript)
    assert assistant.blocks == [RequestIR.text_block(text)]
    assert [{notice, receipt}] = response_rejection_receipts(state.judgment_transcript)
    assert notice.provider_call_ref == "r08-before-timeout"
    assert receipt.retryable == true
    assert receipt.budget_after["exchange"]["provider_call_count"] == 1
    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, _retry}
    refute_receive {:provider_request, _}, 10
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：合法成功回复不产生失败事实" do
    text = "可以讨论这个人物的动机，但我还没有足够材料判断。"
    good = response_with_execution_refs(text, [], "r08-accepted", "run-r08-accepted")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([good]), %{}, judgment_input())

    assert judgment.provider_call_count == 1
    assert judgment.narrative == text
    assert response_rejection_receipts(judgment.transcript) == []
    assert [assistant] = assistant_messages(judgment.transcript)
    assert assistant.blocks == [RequestIR.text_block(text)]
    assert_receive {:provider_request, _}
    refute_receive {:provider_request, _}, 10
  end

  defp response_rejection_receipts(%{messages: messages}) do
    for %{role: "application_notice", provenance: "application", blocks: blocks} = notice <-
          messages,
        %{type: "validation_result"} = receipt <- blocks,
        do: {notice, receipt}
  end
end
