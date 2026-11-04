defmodule NovelAgent.Provider.NativeToolExchangeTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.NativeToolExchange
  alias NovelAgent.Provider.RequestIR

  @tool "agent_plan_draft"
  @author "先核对已有材料，再给我计划。"

  test "run/5 保持具名工具调用兼容，并报告一次真实调用" do
    {provider, calls} = scripted_provider([{:ok, native_result("first", %{plan: "草案"})}])

    assert {%{status: :ok, value: "草案"}, session} =
             NativeToolExchange.run(request_ir(), provider, @tool, &parse_plan/1, &error_result/2)

    assert session.provider_call_count == 1
    assert [prompt] = calls.()
    assert NovelAgent.Provider.tool_choice(prompt) == @tool
    assert {:ok, ["first"]} = RequestIR.pending_call_ids(session.request_ir)
    assert session.provider_result.tool_calls |> hd() |> Map.get(:id) == "first"
  end

  test "发送前校验失败不消耗 Provider 调用，也不发重试通知" do
    parent = self()
    {provider, calls} = scripted_provider([{:ok, native_result("unused", %{plan: "草案"})}])
    ir = %{request_ir() | tools: []}

    assert {%{status: :error, error: %{code: "invalid_request_ir"}}, session} =
             exchange(ir, provider,
               on_retry: fn kind, reason, attempt ->
                 send(parent, {:retry, kind, reason, attempt})
               end
             )

    assert session.provider_call_count == 0
    assert session.provider_result == nil
    assert calls.() == []
    refute_receive {:retry, _, _, _}, 10
  end

  test "规划可显式使用 auto，成功响应仍由调用集合和业务契约校验" do
    {provider, calls} = scripted_provider([{:ok, native_result("plan", %{plan: "先读再写"})}])

    assert {%{status: :ok, value: "先读再写"}, session} =
             exchange(request_ir(), provider, tool_choice: "auto")

    assert session.provider_call_count == 1
    assert [prompt] = calls.()
    assert NovelAgent.Provider.tool_choice(prompt) == "auto"
  end

  test "二参数解析器获得真实调用序号，同时保持一次校验重试的上限" do
    parent = self()
    result = native_result("attempt", %{plan: "可恢复的计划"})
    {provider, _calls} = scripted_provider([{:ok, result}, {:ok, result}])

    parser = fn response, attempt ->
      send(parent, {:parse_attempt, attempt})

      if attempt == 1,
        do: error_result("optional_metadata_missing", :first_attempt),
        else: parse_plan(response)
    end

    assert {%{status: :ok, value: "可恢复的计划"}, session} =
             NativeToolExchange.run(request_ir(), provider, @tool, parser, &error_result/2, [])

    assert session.provider_call_count == 2
    assert_receive {:parse_attempt, 1}
    assert_receive {:parse_attempt, 2}
    refute_receive {:parse_attempt, _}, 10
  end

  test "启用传输重试时原请求逐字重发，只记录真实成功响应" do
    parent = self()
    reason = %{type: :timeout, message: "连接等待超时"}

    {provider, calls} =
      scripted_provider([{:error, reason}, {:ok, native_result("retry", %{plan: "恢复后的计划"})}])

    initial = request_ir()

    parser = fn response, attempt ->
      assert attempt == 2
      parse_plan(response)
    end

    assert {%{status: :ok, value: "恢复后的计划"}, session} =
             NativeToolExchange.run(initial, provider, @tool, parser, &error_result/2,
               retry_transport: true,
               on_retry: fn kind, failure, attempt ->
                 send(parent, {:retry, kind, failure, attempt})
               end
             )

    assert session.provider_call_count == 2
    assert [first, second] = calls.()
    assert first == second
    assert_receive {:retry, :provider, ^reason, 1}
    refute_receive {:retry, _, _, _}, 10
    assert Enum.take(session.request_ir.messages, length(initial.messages)) == initial.messages
    assert Enum.count(session.request_ir.messages, &(&1.role == "assistant")) == 1
    refute Enum.any?(session.request_ir.messages, &(&1.role == "application_notice"))
  end

  test "默认不重试传输错误，保持 writer 与 quality 的现有错误边界" do
    reason = %{type: :timeout}

    {provider, calls} =
      scripted_provider([{:error, reason}, {:ok, native_result("unused", %{plan: "不该出现"})}])

    initial = request_ir()

    assert {%{status: :error, error: %{code: "provider_error", reason: ^reason}}, session} =
             NativeToolExchange.run(initial, provider, @tool, &parse_plan/1, &error_result/2)

    assert session.provider_call_count == 1
    assert length(calls.()) == 1
    assert session.request_ir == initial
  end

  test "传输错误与校验错误共享最多一次重试，不因错误种类切换而额外调用" do
    timeout = {:error, %{type: :timeout}}
    invalid = {:ok, native_result("invalid", %{plan: nil})}

    for failures <- [[timeout, invalid], [invalid, timeout]] do
      {provider, calls} =
        scripted_provider(failures ++ [{:ok, native_result("third", %{plan: "不该出现"})}])

      assert {%{status: :error}, session} =
               exchange(request_ir(), provider, retry_transport: true)

      assert session.provider_call_count == 2
      assert length(calls.()) == 2
      assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)
      assert Enum.any?(session.request_ir.messages, &(&1.role == "assistant"))
      assert Enum.any?(session.request_ir.messages, &(&1.role == "tool"))
    end
  end

  test "自定义反馈逐个拒绝并行调用，最终错误也保留原响应和失败结果" do
    parent = self()

    result = %{
      content: "两个动作一起提出。",
      tool_calls: [
        %{id: "a", name: @tool, arguments: %{plan: "不得选中第一项"}},
        %{id: "b", name: "canon_write", arguments: %{}}
      ]
    }

    {provider, calls} = scripted_provider([{:ok, result}, {:ok, result}])

    feedback = fn parsed ->
      assert parsed.error.code == "unexpected_tool_calls"

      %{
        reason_code: "plan_schema_rejected",
        detail: %{schema_ref: "plan/v1"},
        message: "请只提出一个计划。"
      }
    end

    assert {%{status: :error, error: %{reason: rejection}}, session} =
             exchange(request_ir(), provider,
               feedback: feedback,
               on_retry: fn kind, reason, attempt ->
                 send(parent, {:retry, kind, reason, attempt})
               end
             )

    assert session.provider_call_count == 2
    assert rejection.received_count == 2
    assert Enum.map(rejection.received_calls, & &1.name) == [@tool, "canon_write"]
    assert length(calls.()) == 2
    assert_receive {:retry, :validation, %{code: "unexpected_tool_calls"}, 1}
    refute_receive {:retry, _, _, _}, 10
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)

    results =
      for %{role: "tool", blocks: blocks} <- session.request_ir.messages,
          block <- blocks,
          do: block

    assert Enum.map(results, & &1.call_id) == ["a", "b", "a:2", "b:2"]

    assert Enum.all?(
             results,
             &(&1.status == "failed" and &1.reason_code == "plan_schema_rejected")
           )

    assert Enum.all?(
             results,
             &(&1.detail == %{"schema_ref" => "plan/v1", "message" => "请只提出一个计划。"})
           )

    assert Enum.count(session.request_ir.messages, &(&1.role == "assistant")) == 2
  end

  test "纯文本响应留为真实 assistant，严格模式拒绝并按应用反馈纠错" do
    first = "第一版文本\n  原样保留。"
    last = "第二版文本\n  仍然没有工具。"
    {provider, calls} = scripted_provider([{:ok, first}, {:ok, last}])
    parser = fn _ -> flunk("完整原生模式不能把无工具文本交给业务解析器") end

    feedback = fn _ ->
      %{reason_code: "native_plan_required", detail: %{}, message: "请使用计划工具。"}
    end

    assert {%{status: :error, error: %{code: "native_tool_call_required"}}, session} =
             NativeToolExchange.run(request_ir(), provider, @tool, parser, &error_result/2,
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
    assert Enum.all?(notices, &(&1.blocks == [RequestIR.text_block("请使用计划工具。")]))
    [_original, retry] = calls.()

    assert Enum.any?(retry.messages, fn message ->
             message.role == "assistant" and message_text(message) == first
           end)
  end

  test "validate_result 非 nil 坏类型或错误 arity 在调用前拒绝且历史不新增 assistant" do
    initial = request_ir()

    for bad <- [:not_a_function, fn _a, _b -> :ok end] do
      {provider, calls} = scripted_provider([{:ok, native_result("unused", %{plan: "不该出现"})}])

      assert {%{status: :error, error: %{code: "invalid_validate_result_option"}}, session} =
               exchange(initial, provider, validate_result: bad)

      assert session.provider_call_count == 0
      assert session.provider_result == nil
      assert session.request_ir == initial
      assert calls.() == []
      refute Enum.any?(session.request_ir.messages, &(&1.role == "assistant"))
    end
  end

  test "validator 执行后返回坏形状：保留真实响应、闭合原 call、固定安全原因且不重试" do
    real = native_result("first-call", %{plan: "第一版"})

    {provider, calls} =
      scripted_provider([{:ok, real}, {:ok, native_result("second", %{plan: "不该出现"})}])

    validator = fn _parsed -> fn -> :private_state end end

    assert {%{
              status: :error,
              error: %{code: "invalid_validation_callback_result", reason: reason}
            }, session} = exchange(request_ir(), provider, validate_result: validator)

    assert reason == "validate_result callback returned an unsupported result"
    refute reason =~ "#Function"
    assert session.provider_call_count == 1
    assert length(calls.()) == 1
    assert session.provider_result == real
    assert Enum.count(session.request_ir.messages, &(&1.role == "assistant")) == 1
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)

    assert [
             %{
               call_id: "first-call",
               status: "failed",
               reason_code: "invalid_validation_callback_result",
               detail: detail
             }
           ] = tool_results(session.request_ir, "first-call")

    assert detail["message"] == reason
    refute Map.has_key?(detail, "returned")
    refute contains_function?(session)
  end

  test "feedback.message 写入原 call 结果，atom/string 同名键冲突只保留唯一 message" do
    guidance = "第二次必须只保留指定目标段：GUIDANCE_ONLY_FIELD"
    first = native_result("first-call", %{plan: "第一版"})
    second = native_result("second-call", %{plan: "第二版"})
    {provider, calls} = scripted_provider([{:ok, first}, {:ok, second}])

    validator = fn parsed ->
      if parsed.value == "第一版" do
        {:error,
         %{
           reason_code: "revision_scope_mismatch",
           detail: %{:target => "chapter:1", :message => "旧 atom", "message" => "旧 string"},
           message: guidance
         }}
      else
        :ok
      end
    end

    assert {%{status: :ok, value: "第二版"}, session} =
             exchange(request_ir(), provider, validate_result: validator)

    assert [
             %{
               call_id: "first-call",
               detail: %{"target" => "chapter:1", "message" => ^guidance}
             }
           ] = tool_results(session.request_ir, "first-call")

    [_first_prompt, retry_prompt] = calls.()

    assert Enum.any?(retry_prompt.messages, fn message ->
             if message.role == "tool" do
               Enum.any?(message.blocks, fn block ->
                 block.type == "validation_result" and block.call_id == "first-call" and
                   block.detail["target"] == "chapter:1" and
                   block.detail["message"] == guidance
               end)
             else
               false
             end
           end)

    assert Enum.count(session.request_ir.messages, &(&1.role == "user")) == 1

    refute Enum.any?(
             session.request_ir.messages,
             &(&1.role in ["scope_update", "application_notice"])
           )
  end

  test "应用校验拒绝后用原 call_id 回流并在同一交换内成功，不新增 user 消息" do
    parent = self()
    first = native_result("first-call", %{plan: "第一版"})
    second = native_result("second-call", %{plan: "第二版"})
    {provider, calls} = scripted_provider([{:ok, first}, {:ok, second}])

    validator = fn parsed ->
      send(parent, {:validated, parsed})

      if parsed.value == "第一版" do
        {:error,
         %{
           reason_code: "revision_scope_mismatch",
           detail: %{target: "chapter:1"},
           message: "修订范围不匹配：只允许修改目标段。"
         }}
      else
        :ok
      end
    end

    initial = request_ir()

    assert {%{status: :ok, value: "第二版"}, session} =
             exchange(initial, provider, validate_result: validator)

    assert session.provider_call_count == 2
    assert_receive {:validated, %{status: :ok, value: "第一版"}}
    assert_receive {:validated, %{status: :ok, value: "第二版"}}
    refute_receive {:validated, _}, 10

    [first_prompt, retry_prompt] = calls.()

    assert Enum.take(retry_prompt.messages, length(first_prompt.messages)) ==
             first_prompt.messages

    assert Enum.count(session.request_ir.messages, &(&1.role == "user")) == 1
    assert Enum.take(session.request_ir.messages, length(initial.messages)) == initial.messages

    assert [
             %{
               call_id: "first-call",
               status: "failed",
               reason_code: "revision_scope_mismatch",
               detail: %{
                 "target" => "chapter:1",
                 "message" => "修订范围不匹配：只允许修改目标段。"
               }
             }
           ] = tool_results(session.request_ir, "first-call")

    assert {:ok, ["second-call"]} = RequestIR.pending_call_ids(session.request_ir)

    assert Enum.any?(retry_prompt.messages, fn message ->
             if message.role == "tool" do
               Enum.any?(message.blocks, fn block ->
                 block.type == "validation_result" and block.call_id == "first-call" and
                   block.reason_code == "revision_scope_mismatch" and
                   block.detail == %{
                     "target" => "chapter:1",
                     "message" => "修订范围不匹配：只允许修改目标段。"
                   }
               end)
             else
               false
             end
           end)

    first_assistant = Enum.find(session.request_ir.messages, &(&1.role == "assistant"))

    assert [%{call_id: "first-call", arguments: %{"plan" => "第一版"}}] =
             Enum.filter(first_assistant.blocks, &(&1.type == "tool_call"))

    refute contains_function?(session)
  end

  test "协议错不执行应用校验；其后应用拒绝仍共两次调用并闭合末次" do
    parent = self()
    invalid = multi_call_result()
    valid = native_result("second-call", %{plan: "第二版"})
    {provider, calls} = scripted_provider([{:ok, invalid}, {:ok, valid}])

    validator = fn parsed ->
      send(parent, {:validated, parsed})

      {:error,
       %{
         reason_code: "scope_rejected",
         detail: %{reason: "outside_scope"},
         message: "范围不匹配"
       }}
    end

    assert {%{status: :error, error: %{code: "scope_rejected", reason: "范围不匹配"}}, session} =
             exchange(request_ir(), provider, validate_result: validator)

    assert session.provider_call_count == 2
    assert length(calls.()) == 2
    assert_receive {:validated, %{status: :ok, value: "第二版"}}
    refute_receive {:validated, _}, 10
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)

    results = validation_results(session.request_ir)
    assert Enum.map(results, & &1.call_id) == ["a", "b", "second-call"]
    assert Enum.all?(results, &(&1.status == "failed"))

    assert Enum.map(results, & &1.reason_code) == [
             "unexpected_tool_calls",
             "unexpected_tool_calls",
             "scope_rejected"
           ]
  end

  test "应用拒绝后协议错不执行应用校验，仍共两次调用且末次闭合" do
    parent = self()

    valid = native_result("first-call", %{plan: "第一版"})
    invalid = multi_call_result()
    {provider, calls} = scripted_provider([{:ok, valid}, {:ok, invalid}])

    validator = fn parsed ->
      send(parent, {:validated, parsed})

      {:error,
       %{
         reason_code: "scope_rejected",
         detail: %{reason: "outside_scope"},
         message: "范围不匹配"
       }}
    end

    assert {%{status: :error, error: %{code: "unexpected_tool_calls"}}, session} =
             exchange(request_ir(), provider, validate_result: validator)

    assert session.provider_call_count == 2
    assert length(calls.()) == 2
    assert_receive {:validated, %{status: :ok, value: "第一版"}}
    refute_receive {:validated, _}, 10
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)

    results = validation_results(session.request_ir)
    assert Enum.map(results, & &1.call_id) == ["first-call", "a", "b"]

    assert Enum.map(results, & &1.reason_code) == [
             "scope_rejected",
             "unexpected_tool_calls",
             "unexpected_tool_calls"
           ]
  end

  test "末次应用拒绝也闭合原调用并返回应用错误" do
    first = native_result("first-call", %{plan: "第一版"})
    second = native_result("second-call", %{plan: "第二版"})
    {provider, calls} = scripted_provider([{:ok, first}, {:ok, second}])

    validator = fn parsed ->
      message = if parsed.value == "第一版", do: "第一次拒绝", else: "第二次拒绝"

      {:error,
       %{reason_code: "revision_scope_mismatch", detail: %{attempt: message}, message: message}}
    end

    assert {%{status: :error, error: %{code: "revision_scope_mismatch", reason: "第二次拒绝"}},
            session} = exchange(request_ir(), provider, validate_result: validator)

    assert session.provider_call_count == 2
    assert length(calls.()) == 2
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)

    results = validation_results(session.request_ir)
    assert Enum.map(results, & &1.call_id) == ["first-call", "second-call"]

    assert Enum.all?(
             results,
             &(&1.status == "failed" and &1.reason_code == "revision_scope_mismatch")
           )

    assert Enum.map(results, & &1.detail["attempt"]) == ["第一次拒绝", "第二次拒绝"]
  end

  test "非法多工具响应逐 call 拒绝且绝不执行应用校验" do
    parent = self()
    invalid = multi_call_result()
    {provider, calls} = scripted_provider([{:ok, invalid}, {:ok, invalid}])

    validator = fn _parsed ->
      send(parent, :validated)
      :ok
    end

    assert {%{status: :error, error: %{code: "unexpected_tool_calls"}}, session} =
             exchange(request_ir(), provider, validate_result: validator)

    assert session.provider_call_count == 2
    assert length(calls.()) == 2
    refute_receive :validated, 10

    assert Enum.map(validation_results(session.request_ir), & &1.call_id) == [
             "a",
             "b",
             "a:2",
             "b:2"
           ]
  end

  test "max_provider_calls=0 返回预算错误且零调用、保留原 IR" do
    {provider, calls} = scripted_provider([{:ok, native_result("unused", %{plan: "不该出现"})}])
    initial = request_ir()

    assert {%{
              status: :error,
              error: %{
                code: "provider_call_budget_exhausted",
                reason: %{max_provider_calls: 0}
              }
            }, session} = exchange(initial, provider, max_provider_calls: 0)

    assert session.provider_call_count == 0
    assert session.provider_result == nil
    assert session.request_ir == initial
    assert calls.() == []
  end

  test "max_provider_calls=1 不允许第二次调用，末次拒绝仍闭合" do
    parent = self()
    first = native_result("first-call", %{plan: "第一版"})
    second = native_result("second-call", %{plan: "第二版"})
    {provider, calls} = scripted_provider([{:ok, first}, {:ok, second}])

    validator = fn parsed ->
      send(parent, {:validated, parsed.value})
      {:error, %{reason_code: "scope_rejected", detail: %{}, message: "范围不匹配"}}
    end

    assert {%{status: :error, error: %{code: "scope_rejected"}}, session} =
             exchange(request_ir(), provider,
               validate_result: validator,
               max_provider_calls: 1
             )

    assert session.provider_call_count == 1
    assert length(calls.()) == 1
    assert_receive {:validated, "第一版"}
    refute_receive {:validated, _}, 10
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)
    assert Enum.map(validation_results(session.request_ir), & &1.call_id) == ["first-call"]
  end

  test "max_provider_calls 大于 2 时有效上限仍为 2" do
    first = native_result("first-call", %{plan: "第一版"})
    second = native_result("second-call", %{plan: "第二版"})
    third = native_result("third-call", %{plan: "第三版"})
    {provider, calls} = scripted_provider([{:ok, first}, {:ok, second}, {:ok, third}])

    validator = fn _parsed ->
      {:error, %{reason_code: "scope_rejected", detail: %{}, message: "范围不匹配"}}
    end

    assert {%{status: :error, error: %{code: "scope_rejected"}}, session} =
             exchange(request_ir(), provider,
               validate_result: validator,
               max_provider_calls: 99
             )

    assert session.provider_call_count == 2
    assert length(calls.()) == 2
  end

  test "max_provider_calls 负数或坏类型明确拒绝且零调用" do
    for bad <- [-1, "2", 2.0, nil] do
      {provider, calls} = scripted_provider([{:ok, native_result("unused", %{plan: "x"})}])
      initial = request_ir()

      assert {%{status: :error, error: %{code: "invalid_max_provider_calls"}}, session} =
               exchange(initial, provider, max_provider_calls: bad)

      assert session.provider_call_count == 0
      assert session.provider_result == nil
      assert session.request_ir == initial
      assert calls.() == []
    end
  end

  defp exchange(ir, provider, opts),
    do: NativeToolExchange.run(ir, provider, @tool, &parse_plan/1, &error_result/2, opts)

  defp multi_call_result do
    %{
      content: "两个动作一起提出。",
      tool_calls: [
        %{id: "a", name: @tool, arguments: %{plan: "不得选中第一项"}},
        %{id: "b", name: "canon_write", arguments: %{}}
      ]
    }
  end

  defp validation_results(ir) do
    for %{role: "tool", blocks: blocks} <- ir.messages,
        %{type: "validation_result"} = block <- blocks,
        do: block
  end

  defp message_text(%{blocks: blocks}) do
    blocks
    |> Enum.filter(&(&1.type == "text"))
    |> Enum.map_join("", & &1.text)
  end

  defp tool_results(ir, call_id) do
    for %{role: "tool", blocks: blocks} <- ir.messages,
        %{type: "validation_result", call_id: ^call_id} = block <- blocks,
        do: block
  end

  defp contains_function?(term) when is_function(term), do: true

  defp contains_function?(term) when is_map(term) do
    Enum.any?(Map.to_list(term), fn {key, value} ->
      contains_function?(key) or contains_function?(value)
    end)
  end

  defp contains_function?(term) when is_list(term), do: Enum.any?(term, &contains_function?/1)

  defp contains_function?(term) when is_tuple(term),
    do: term |> Tuple.to_list() |> contains_function?()

  defp contains_function?(_term), do: false

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
