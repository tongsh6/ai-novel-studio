defmodule NovelAgent.Provider.NativeToolExchangeResponseValidationTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.NativeToolExchange
  alias NovelCommon.RequestIR

  @tool "agent_plan_draft"
  @author "先核对已有材料，再给我计划。"

  @response_rejection_fact "本次响应未通过接收，未作为作者回复发布；仍在处理原作者输入。\n"

  @tag :r08_response_rejection
  test "R08 无工具拒收：原生交换的纯文本失败绑定真实响应且不伪造工具调用" do
    text = "  第一版说明仍未调用工具。\n"
    bad = response_result(text, "r08-text")
    good = Map.merge(native_result("r08-plan-call", %{plan: "合法计划"}), response_refs("r08-plan"))
    {provider, calls} = scripted_provider([{:ok, bad}, {:ok, good}])
    correction = "请使用计划工具，保留原目标。"

    feedback = fn _ ->
      %{reason_code: "native_plan_required", detail: %{expected_tool: @tool}, message: correction}
    end

    assert {%{status: :ok, value: "合法计划"}, session} =
             exchange(response_rejection_ir(), provider, feedback: feedback)

    assert session.provider_call_count == 2
    assert [first, retry] = calls.()
    assert Enum.take(retry.messages, length(first.messages)) == first.messages

    assert Enum.filter(retry.messages, &(&1.role == "user")) ==
             Enum.filter(first.messages, &(&1.role == "user"))

    assert [assistant] = Enum.filter(retry.messages, &(&1.role == "assistant"))
    assert assistant.blocks == [RequestIR.text_block(text)]
    assert assistant.provider_call_ref == "pcall-r08-text"
    assert [{notice, receipt}] = response_rejection_receipts(retry)
    assert List.last(retry.messages) == notice
    assert notice.blocks == [receipt]
    assert notice.provider_call_ref == assistant.provider_call_ref
    assert notice.provider_run_ref == assistant.provider_run_ref
    assert receipt.status == "failed"
    assert receipt.reason_code == "native_plan_required"
    assert receipt.detail["expected_tool"] == @tool
    assert receipt.detail["message"] == @response_rejection_fact <> correction
    assert receipt.retryable == true

    assert receipt.budget_after == %{
             "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}
           }

    refute Map.has_key?(receipt, :call_id)
    refute Map.has_key?(receipt, :provider_call_ref)
    refute Map.has_key?(receipt, :provider_run_ref)
    assert RequestIR.call_ids(retry.messages) == []
    assert {:ok, []} = RequestIR.pending_call_ids(retry)
    assert RequestIR.call_ids(session.request_ir.messages) == ["r08-plan-call"]
    assert {:ok, ["r08-plan-call"]} = RequestIR.pending_call_ids(session.request_ir)
    assert validation_results(session.request_ir) == []
    assert response_rejection_receipts(session.request_ir) == [{notice, receipt}]
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：两次同文不同响应分别拒收，末次回执保留真实终局预算" do
    text = "相同文本不是相同调用。"
    first = response_result(text, "r08-first")
    last = response_result(text, "r08-last")
    {provider, calls} = scripted_provider([{:ok, first}, {:ok, last}])

    assert {%{status: :error, error: %{code: "native_tool_call_required"}}, session} =
             exchange(response_rejection_ir(), provider, [])

    assert session.provider_call_count == 2
    assert length(calls.()) == 2

    assert Enum.map(
             Enum.filter(session.request_ir.messages, &(&1.role == "assistant")),
             & &1.blocks
           ) ==
             [[RequestIR.text_block(text)], [RequestIR.text_block(text)]]

    assert [{first_notice, first_receipt}, {last_notice, last_receipt}] =
             response_rejection_receipts(session.request_ir)

    assert first_notice.provider_call_ref == "pcall-r08-first"
    assert last_notice.provider_call_ref == "pcall-r08-last"
    assert first_receipt.retryable == true
    assert last_receipt.retryable == false
    assert first_receipt.budget_after["exchange"]["provider_call_count"] == 1
    assert last_receipt.budget_after["exchange"]["provider_call_count"] == 2
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)
    assert RequestIR.call_ids(session.request_ir.messages) == []
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：空响应和思考状态不被补成文本，仍有各自拒收身份" do
    for provider_state <- [%{}, %{"reasoning_content" => "保留但不当作作者正文"}] do
      empty = Map.put(response_result("", "r08-empty"), :provider_state, provider_state)

      good =
        Map.merge(native_result("empty-followup", %{plan: "合法计划"}), response_refs("r08-good"))

      {provider, calls} = scripted_provider([{:ok, empty}, {:ok, good}])

      assert {%{status: :ok}, session} = exchange(response_rejection_ir(), provider, [])
      assert session.provider_call_count == 2
      assert [_first, retry] = calls.()
      assert [assistant] = Enum.filter(retry.messages, &(&1.role == "assistant"))
      assert assistant.blocks == []
      assert assistant.provider_state == provider_state
      assert [{notice, receipt}] = response_rejection_receipts(retry)
      assert notice.provider_call_ref == "pcall-r08-empty"
      assert notice.provider_run_ref == "prun-r08-empty"
      assert receipt.status == "failed"
      refute Map.has_key?(receipt, :call_id)
      assert {:ok, []} = RequestIR.pending_call_ids(retry)
    end
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：运输失败零响应，不能生成拒收事实" do
    {provider, calls} = scripted_provider([{:error, %{type: :timeout}}])
    initial = response_rejection_ir()

    assert {%{status: :error, error: %{code: "provider_error"}}, session} =
             exchange(initial, provider, [])

    assert session.provider_call_count == 1
    assert length(calls.()) == 1
    assert session.request_ir == initial
    assert session.provider_result == nil
    assert response_rejection_receipts(session.request_ir) == []
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：已拒首稿后的运输错误不新增模型响应或第二回执" do
    text = "只有一次真正生成的首稿。"

    {provider, calls} =
      scripted_provider([
        {:ok, response_result(text, "r08-before-timeout")},
        {:error, %{type: :timeout}}
      ])

    assert {%{status: :error, error: %{code: "provider_error"}}, session} =
             exchange(response_rejection_ir(), provider, [])

    assert session.provider_call_count == 2
    assert length(calls.()) == 2
    assert [assistant] = Enum.filter(session.request_ir.messages, &(&1.role == "assistant"))
    assert assistant.blocks == [RequestIR.text_block(text)]
    assert [{notice, receipt}] = response_rejection_receipts(session.request_ir)
    assert notice.provider_call_ref == "pcall-r08-before-timeout"
    assert receipt.retryable == true
    assert receipt.budget_after["exchange"]["provider_call_count"] == 1
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：当前 Scope 引用拒收字样不把已有回复标成失败" do
    initial = response_rejection_ir()

    {initial, _} =
      RequestIR.append_assistant_result(initial, response_result("先前的正常讨论。", "r08-prior"))

    quotation = "材料中的「未通过接收」只是引用。"

    initial =
      RequestIR.append_scope_update(initial, %{
        work_id: initial.run.work_id,
        context: %{quoted_material: quotation}
      })

    good = Map.merge(native_result("r08-success", %{plan: "合法计划"}), response_refs("r08-success"))
    {provider, calls} = scripted_provider([{:ok, good}])

    assert {%{status: :ok}, session} = exchange(initial, provider, [])
    assert session.provider_call_count == 1
    assert length(calls.()) == 1
    assert response_rejection_receipts(session.request_ir) == []
    assert [] = Enum.filter(session.request_ir.messages, &(&1.role == "application_notice"))

    assert Enum.any?(session.request_ir.messages, fn message ->
             message.role == "scope_update" and
               Enum.any?(message.blocks, &(&1.content["context"]["quoted_material"] == quotation))
           end)
  end

  @tag :r08_response_rejection
  test "R08 无工具拒收：原生工具校验仍绑定原 call_id，不转成响应回执或改变工具分母" do
    bad = Map.merge(native_result("r08-native-bad", %{}), response_refs("r08-native-bad"))

    good =
      Map.merge(
        native_result("r08-native-good", %{plan: "合法计划"}),
        response_refs("r08-native-good")
      )

    {provider, calls} = scripted_provider([{:ok, bad}, {:ok, good}])

    assert {%{status: :ok}, session} = exchange(response_rejection_ir(), provider, [])
    assert session.provider_call_count == 2
    assert [_first, retry] = calls.()
    assert response_rejection_receipts(session.request_ir) == []
    assert [receipt] = validation_results(retry)
    assert receipt.call_id == "r08-native-bad"
    assert receipt.status == "failed"
    refute String.starts_with?(receipt.detail["message"], @response_rejection_fact)

    assert RequestIR.call_ids(session.request_ir.messages) == [
             "r08-native-bad",
             "r08-native-good"
           ]

    assert {:ok, ["r08-native-good"]} = RequestIR.pending_call_ids(session.request_ir)
  end

  test "纯文本响应留为真实 assistant，严格模式拒绝并按应用反馈纠错" do
    first = "第一版文本\n  原样保留。"
    last = "第二版文本\n  仍然没有工具。"

    {provider, calls} =
      scripted_provider([
        {:ok, response_result(first, "legacy-text-first")},
        {:ok, response_result(last, "legacy-text-last")}
      ])

    parser = fn _ -> flunk("完整原生模式不能把无工具文本交给业务解析器") end

    feedback = fn _ ->
      %{reason_code: "native_plan_required", detail: %{}, message: "请使用计划工具。"}
    end

    assert {%{status: :error, error: %{code: "native_tool_call_required"}}, session} =
             NativeToolExchange.run(
               response_rejection_ir(),
               provider,
               @tool,
               parser,
               &error_result/2,
               feedback: feedback
             )

    assert session.provider_call_count == 2
    assert session.provider_result.content == last

    assistant_texts =
      for %{role: "assistant", blocks: blocks} <- session.request_ir.messages,
          %{type: "text", text: text} <- blocks,
          do: text

    assert assistant_texts == [first, last]
    assert Enum.count(session.request_ir.messages, &(&1.role == "user")) == 1
    notices = Enum.filter(session.request_ir.messages, &(&1.role == "application_notice"))
    assert length(notices) == 2

    assert Enum.map(notices, &{&1.provider_call_ref, &1.provider_run_ref}) == [
             {"pcall-legacy-text-first", "prun-legacy-text-first"},
             {"pcall-legacy-text-last", "prun-legacy-text-last"}
           ]

    for {notice, count} <- Enum.with_index(notices, 1) do
      assert [%{type: "validation_result", status: "failed"} = receipt] = notice.blocks
      assert receipt.reason_code == "native_plan_required"
      assert receipt.detail == %{"message" => @response_rejection_fact <> "请使用计划工具。"}
      assert receipt.retryable == (count == 1)

      assert receipt.budget_after == %{
               "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => count}
             }

      refute Map.has_key?(receipt, :call_id)
    end

    [_original, retry] = calls.()

    assert Enum.any?(retry.messages, fn message ->
             message.role == "assistant" and message.blocks == [RequestIR.text_block(first)]
           end)
  end

  defp response_rejection_receipts(%{messages: messages}) do
    for %{role: "application_notice", provenance: "application", blocks: blocks} = notice <-
          messages,
        %{type: "validation_result"} = receipt <- blocks,
        do: {notice, receipt}
  end

  defp response_refs(ref),
    do: %{provider_call_ref: "pcall-" <> ref, provider_run_ref: "prun-" <> ref}

  defp response_result(text, ref),
    do: Map.merge(%{content: text, tool_calls: []}, response_refs(ref))

  defp response_rejection_ir do
    ir = request_ir()

    %{
      ir
      | run:
          Map.merge(ir.run, %{
            work_id: "work-r08",
            workspace_id: "workspace-r08",
            session_id: "session-r08",
            parent_turn_ref: "author-r08"
          }),
        messages: [
          RequestIR.message(:user, :author, [RequestIR.text_block(@author)], %{
            source_refs: [%{ref: "author-r08"}]
          })
        ]
    }
  end

  defp exchange(ir, provider, opts),
    do: NativeToolExchange.run(ir, provider, @tool, &parse_plan/1, &error_result/2, opts)

  defp validation_results(ir) do
    for %{role: "tool", blocks: blocks} <- ir.messages,
        %{type: "validation_result"} = block <- blocks,
        do: block
  end

  defp request_ir do
    RequestIR.new(%{
      run: %{run_id: "native-exchange"},
      system: RequestIR.system_envelope(),
      projection: %{},
      tools: [%{name: @tool, input_schema: %{type: "object"}}],
      messages: [RequestIR.message(:user, :author, [RequestIR.text_block(@author)])]
    })
  end

  defp native_result(id, arguments),
    do: %{content: "计划说明", tool_calls: [%{id: id, name: @tool, arguments: arguments}]}

  defp parse_plan(%{tool_calls: [call]}) do
    case call.arguments[:plan] || call.arguments["plan"] do
      plan when is_binary(plan) -> %{status: :ok, value: plan}
      _ -> error_result("plan_invalid", %{required: "plan"})
    end
  end

  defp error_result(code, reason), do: %{status: :error, error: %{code: code, reason: reason}}

  defp scripted_provider(responses) do
    agent = start_supervised!({Agent, fn -> {responses, []} end}, id: make_ref())

    provider = fn prompt ->
      Agent.get_and_update(agent, fn
        {[response | rest], calls} -> {response, {rest, calls ++ [prompt]}}
        {[], calls} -> {{:error, :unexpected_extra_call}, {[], calls ++ [prompt]}}
      end)
    end

    {provider, fn -> Agent.get(agent, fn {_responses, calls} -> calls end) end}
  end
end
