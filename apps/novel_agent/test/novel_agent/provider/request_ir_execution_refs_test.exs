defmodule NovelAgent.Provider.RequestIRExecutionRefsTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.{NativeToolExchange, RequestIR, Result}
  alias NovelAgent.Provider.RequestIR.Projection

  @tool "read_character"
  @author_text "作者要求：标题里保留 provider_call_ref 原样，不改字节。"
  @targets ["chat_completions", "anthropic_messages", "responses_api"]

  defp ir do
    RequestIR.new(%{
      run: %{
        run_id: "run-execution-refs",
        work_id: "work-execution-refs",
        session_id: "session-execution-refs",
        parent_turn_ref: "turn-execution-refs"
      },
      system: RequestIR.system_envelope(),
      messages: [
        RequestIR.message(:user, :author, [RequestIR.text_block(@author_text)])
      ],
      tools: [%{name: @tool, input_schema: %{type: "object"}}],
      projection: %{}
    })
  end

  defp result(content, calls, call_ref, run_ref) do
    %Result{
      content: content,
      tool_calls: calls,
      provider_call_ref: call_ref,
      provider_run_ref: run_ref
    }
  end

  defp native_result(content, id, arguments, call_ref, run_ref),
    do: result(content, [%{id: id, name: @tool, arguments: arguments}], call_ref, run_ref)

  defp assistants(ir), do: Enum.filter(ir.messages, &(&1.role == "assistant"))

  defp refs(message),
    do: {Map.get(message, :provider_call_ref), Map.get(message, :provider_run_ref)}

  defp tool_calls(message), do: Enum.filter(message.blocks, &(&1.type == "tool_call"))

  defp projection_ir do
    {ir, _result} =
      RequestIR.append_assistant_result(
        ir(),
        native_result(
          "先读取角色。",
          "read-1",
          %{"character_ref" => "character:1"},
          "pcall-projection",
          "prun-projection"
        )
      )

    RequestIR.append_validation_result(ir, "read-1", "passed", "input_validated")
  end

  defp drop_execution_refs(ir) do
    messages =
      Enum.map(ir.messages, fn
        %{role: "assistant"} = message ->
          Map.drop(message, [:provider_call_ref, :provider_run_ref])

        message ->
          message
      end)

    %{ir | messages: messages}
  end

  defp scripted_provider(responses) do
    agent = start_supervised!({Agent, fn -> responses end}, id: make_ref())

    fn _prompt ->
      Agent.get_and_update(agent, fn
        [response | rest] -> {response, rest}
        [] -> {{:error, :unexpected_extra_call}, []}
      end)
    end
  end

  defp error_result(code, reason), do: %{status: :error, error: %{code: code, reason: reason}}

  test "重复原生工具 id 的两个真实响应各自保留执行引用，canonical 后缀保留原 id 映射" do
    first = native_result("第一轮", "dup", %{"query" => "沈砚"}, "pcall-first", "prun-first")
    second = native_result("第二轮", "dup", %{"query" => "顾青"}, "pcall-second", "prun-second")

    {ir, normalized_first} = RequestIR.append_assistant_result(ir(), first)
    ir = RequestIR.append_validation_result(ir, "dup", "passed", "input_validated")
    {ir, normalized_second} = RequestIR.append_assistant_result(ir, second)

    assert :ok = RequestIR.validate(ir)
    assert [first_assistant, second_assistant] = assistants(ir)
    assert refs(first_assistant) == {"pcall-first", "prun-first"}
    assert refs(second_assistant) == {"pcall-second", "prun-second"}

    assert [%{call_id: "dup"}] = tool_calls(first_assistant)
    assert [%{call_id: "dup:2", provider_call_id: "dup"}] = tool_calls(second_assistant)

    assert normalized_first.provider_call_ref == "pcall-first"
    assert %{id: "dup:2", provider_call_id: "dup"} = hd(normalized_second.tool_calls)
    assert normalized_second.provider_call_ref == "pcall-second"

    refute hd(normalized_second.tool_calls).provider_call_id ==
             normalized_second.provider_call_ref
  end

  test "多工具响应共享引用，纯文本保留引用，未绑定 Result 不补造引用" do
    multi =
      result(
        "并行读取",
        [
          %{id: "a", name: @tool, arguments: %{"query" => "一"}},
          %{id: "b", name: @tool, arguments: %{"query" => "二"}}
        ],
        "pcall-multi",
        "prun-multi"
      )

    {ir, _result} = RequestIR.append_assistant_result(ir(), multi)

    ir =
      ir
      |> RequestIR.append_validation_result("a", "passed", "input_validated")
      |> RequestIR.append_validation_result("b", "passed", "input_validated")

    shared = List.last(assistants(ir))
    assert refs(shared) == {"pcall-multi", "prun-multi"}
    assert Enum.map(tool_calls(shared), & &1.call_id) == ["a", "b"]

    text = result("只回复文本。", [], "pcall-text", "prun-text")
    {ir, _result} = RequestIR.append_assistant_result(ir, text)
    text_assistant = List.last(assistants(ir))
    assert refs(text_assistant) == {"pcall-text", "prun-text"}
    assert [%{type: "text", text: "只回复文本。"}] = text_assistant.blocks

    unbound = result("未经过执行边界。", [], nil, nil)
    {ir, _result} = RequestIR.append_assistant_result(ir, unbound)
    unbound_assistant = List.last(assistants(ir))
    assert refs(unbound_assistant) == {nil, nil}
    assert :ok = RequestIR.validate(ir)
  end

  test "执行引用元数据不改变三种 Provider 投影，也不删除作者原文中的同名字样" do
    with_refs = projection_ir()
    assert refs(List.last(assistants(with_refs))) == {"pcall-projection", "prun-projection"}
    without_refs = drop_execution_refs(with_refs)

    for target <- @targets do
      assert {:ok, body} = Projection.project(with_refs, target)
      assert {:ok, expected} = Projection.project(without_refs, target)
      assert body == expected

      encoded = Jason.encode!(body)
      assert encoded =~ @author_text
      refute encoded =~ "pcall-projection"
      refute encoded =~ "prun-projection"
    end
  end

  test "协议首轮拒绝后的末轮成功仍逐次保留各自 Result 执行引用" do
    first =
      native_result("第一版", "attempt-1", %{"plan" => nil}, "pcall-attempt-1", "prun-attempt-1")

    second =
      native_result("第二版", "attempt-2", %{"plan" => "恢复"}, "pcall-attempt-2", "prun-attempt-2")

    provider = scripted_provider([{:ok, first}, {:ok, second}])

    parse = fn
      _response, 1 -> error_result("plan_invalid", %{required: "plan"})
      _response, _attempt -> %{status: :ok, value: "恢复"}
    end

    assert {%{status: :ok, value: "恢复"}, session} =
             NativeToolExchange.run(ir(), provider, @tool, parse, &error_result/2)

    assert session.provider_call_count == 2
    assert [first_assistant, second_assistant] = assistants(session.request_ir)
    assert refs(first_assistant) == {"pcall-attempt-1", "prun-attempt-1"}
    assert refs(second_assistant) == {"pcall-attempt-2", "prun-attempt-2"}
  end
end

defmodule NovelAgent.Provider.RequestIRExecutionRefsValidationTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.{RequestIR, Result}
  alias NovelAgent.Provider.RequestIR.Projection

  @tool "read_character"

  defp ir do
    RequestIR.new(%{
      run: %{
        run_id: "run-execution-refs-validation",
        work_id: "work-execution-refs-validation",
        session_id: "session-execution-refs-validation",
        parent_turn_ref: "turn-execution-refs-validation"
      },
      system: RequestIR.system_envelope(),
      messages: [RequestIR.message(:user, :author, [RequestIR.text_block("作者原话")])],
      tools: [%{name: @tool, input_schema: %{type: "object"}}],
      projection: %{}
    })
  end

  defp result(content, calls, call_ref, run_ref) do
    %Result{
      content: content,
      tool_calls: calls,
      provider_call_ref: call_ref,
      provider_run_ref: run_ref
    }
  end

  defp append(ir, result) do
    {ir, normalized} = RequestIR.append_assistant_result(ir, result)
    {ir, normalized, List.last(Enum.filter(ir.messages, &(&1.role == "assistant")))}
  end

  test "非法执行引用在进入 IR 时拒绝，不用 to_string 兜底或静默吞掉" do
    for invalid <- ["", :pcall_atom, 123, ""] do
      assert_raise ArgumentError, fn ->
        RequestIR.append_assistant_result(
          ir(),
          result("非法引用", [], invalid, "prun-valid")
        )
      end
    end

    assert_raise ArgumentError, fn ->
      RequestIR.append_assistant_result(ir(), result("非法引用", [], "pcall-valid", ""))
    end

    malformed = [
      RequestIR.message(:assistant, :model, [RequestIR.text_block("非法")], %{
        provider_call_ref: "",
        provider_run_ref: "prun-valid"
      })
    ]

    assert {:error, {:invalid_execution_ref, :provider_call_ref}} =
             RequestIR.validate(%{ir() | messages: malformed})
  end

  test "全空白与非法 UTF8 执行引用被拒绝，错误只含固定原因和字段名" do
    for invalid <- ["   ", "\t\n", " \u00A0 ", <<0xFF>>, <<0xC3>>] do
      assert_raise ArgumentError, fn ->
        RequestIR.append_assistant_result(ir(), result("非法引用", [], invalid, "prun-valid"))
      end
    end

    sentinel = "SENTINEL_WORKER_EXECUTION_REFS_DO_NOT_LOG"

    error =
      assert_raise ArgumentError, fn ->
        RequestIR.append_assistant_result(
          ir(),
          result("非法引用", [], %{private: sentinel}, "prun-valid")
        )
      end

    message = Exception.message(error)
    refute message =~ sentinel
    refute message =~ "private"
    assert message =~ "provider_call_ref"
  end

  test "validate 拒绝全空白/非法 UTF8 引用时返回固定 reason，不回显任意 payload" do
    sentinel = "SENTINEL_VALIDATE_EXECUTION_REFS_DO_NOT_LOG"

    for {invalid, expected} <- [
          {"   ", {:invalid_execution_ref, :provider_call_ref}},
          {"\t\n", {:invalid_execution_ref, :provider_call_ref}},
          {<<0xFF>>, {:invalid_execution_ref, :provider_call_ref}},
          {%{private: sentinel}, {:invalid_execution_ref, :provider_call_ref}}
        ] do
      assistant =
        RequestIR.message(:assistant, :model, [RequestIR.text_block("非法")], %{
          provider_call_ref: invalid
        })

      assert {:error, ^expected} = RequestIR.validate(%{ir() | messages: [assistant]})
    end

    assistant =
      RequestIR.message(:assistant, :model, [RequestIR.text_block("非法")], %{
        provider_call_ref: %{private: sentinel}
      })

    assert {:error, {:invalid_execution_ref, :provider_call_ref} = reason} =
             RequestIR.validate(%{ir() | messages: [assistant]})

    refute inspect(reason) =~ sentinel
  end

  test "合法的非空白引用保留原始字节，不 trim 或改写" do
    ref = " pcall-legal-with-spaces "
    run_ref = "\tprun-legal-with-tab\t"

    {ir, _normalized, assistant} = append(ir(), result("保留原始引用", [], ref, run_ref))

    assert assistant.provider_call_ref == ref
    assert assistant.provider_run_ref == run_ref
    assert :ok = RequestIR.validate(ir)
  end

  test "缺失即不写入 key，单个引用可独立存在，未绑定 Result 不补造" do
    {ir, _normalized, assistant} = append(ir(), result("未绑定", [], nil, nil))

    refute Map.has_key?(assistant, :provider_call_ref)
    refute Map.has_key?(assistant, :provider_run_ref)
    assert :ok = RequestIR.validate(ir)

    {ir, _normalized, assistant} = append(ir, result("只有调用引用", [], "pcall-only", nil))

    assert assistant.provider_call_ref == "pcall-only"
    refute Map.has_key?(assistant, :provider_run_ref)
    assert :ok = RequestIR.validate(ir)
  end

  test "执行引用不改变原始参数与 provider_state，重复原生 id 仍按 canonical 映射" do
    raw = ~s({"query":"沈砚","limit":2})

    first =
      result(
        "第一次",
        [%{id: "dup", name: @tool, arguments: %{}, raw_arguments: raw}],
        "pcall-raw-1",
        "prun-raw-1"
      )

    second =
      result(
        "第二次",
        [%{id: "dup", name: @tool, arguments: %{"query" => "顾青"}}],
        "pcall-raw-2",
        "prun-raw-2"
      )
      |> Map.put(:provider_state, %{reasoning_content: "保留私有推理"})

    {ir, normalized_first, first_assistant} = append(ir(), first)
    ir = RequestIR.append_validation_result(ir, "dup", "passed", "input_validated")
    {ir, normalized_second, second_assistant} = append(ir, second)

    assert [%{call_id: "dup", raw_arguments: ^raw}] =
             Enum.filter(first_assistant.blocks, &(&1.type == "tool_call"))

    assert [%{call_id: "dup:2", provider_call_id: "dup"}] =
             Enum.filter(second_assistant.blocks, &(&1.type == "tool_call"))

    assert first_assistant.provider_state == %{}
    assert second_assistant.provider_state == %{"reasoning_content" => "保留私有推理"}

    assert refs(first_assistant) == {"pcall-raw-1", "prun-raw-1"}
    assert refs(second_assistant) == {"pcall-raw-2", "prun-raw-2"}
    assert hd(normalized_first.tool_calls).raw_arguments == raw
    assert hd(normalized_second.tool_calls).provider_call_id == "dup"

    assert :ok = RequestIR.validate(ir)

    for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
      assert {:ok, body} = Projection.project(ir, target)

      refute Jason.encode!(body) =~ "pcall-raw"
      refute Jason.encode!(body) =~ "prun-raw"
    end
  end

  defp refs(message),
    do: {Map.get(message, :provider_call_ref), Map.get(message, :provider_run_ref)}
end

defmodule NovelAgent.Provider.RequestIRNativeIdProvenanceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.{RequestIR, Result}
  alias NovelAgent.Provider.RequestIR.Projection

  @tool "read_character"
  @author_text "作者原话：核对角色后再给候选。"

  defp ir do
    RequestIR.new(%{
      run: %{
        run_id: "run-native-id-provenance",
        work_id: "work-native-id-provenance",
        session_id: "session-native-id-provenance",
        parent_turn_ref: "turn-native-id-provenance"
      },
      system: RequestIR.system_envelope(),
      messages: [RequestIR.message(:user, :author, [RequestIR.text_block(@author_text)])],
      tools: [%{name: @tool, input_schema: %{type: "object"}}],
      projection: %{}
    })
  end

  defp result(calls) do
    %Result{
      content: "",
      tool_calls: calls,
      provider_call_ref: "pcall-native-id",
      provider_run_ref: "prun-native-id"
    }
  end

  defp call(name, extra \\ %{}) do
    Map.merge(%{name: name, arguments: %{"character_ref" => "character:1"}}, extra)
  end

  defp append(calls) do
    {ir, normalized} = RequestIR.append_assistant_result(ir(), result(calls))
    [assistant] = Enum.filter(ir.messages, &(&1.role == "assistant"))
    {ir, normalized, assistant}
  end

  defp tool_blocks(assistant), do: Enum.filter(assistant.blocks, &(&1.type == "tool_call"))

  test "缺失与 null 原生 id 显式保留 provider_call_id:nil，不静默变成缺 key" do
    for calls <- [
          [call(@tool)],
          [call(@tool, %{id: nil})]
        ] do
      {ir, normalized, assistant} = append(calls)
      [block] = tool_blocks(assistant)

      assert block.call_id == "call_read_character"
      assert Map.has_key?(block, :provider_call_id)
      assert block.provider_call_id == nil

      assert [%{id: "call_read_character"}] = normalized.tool_calls
      assert Map.has_key?(hd(normalized.tool_calls), :provider_call_id)
      assert hd(normalized.tool_calls).provider_call_id == nil

      assert :ok = RequestIR.validate(ir)
    end
  end

  test "原 id 与 canonical 一致时无映射；重复原 id 仍保留原 string 映射" do
    {ir, normalized, assistant} =
      append([call(@tool, %{id: "native-1"}), call(@tool, %{id: "native-1"})])

    [first, second] = tool_blocks(assistant)
    assert first.call_id == "native-1"
    refute Map.has_key?(first, :provider_call_id)

    assert second.call_id == "native-1:2"
    assert second.provider_call_id == "native-1"

    assert [%{id: "native-1"}, %{id: "native-1:2", provider_call_id: "native-1"}] =
             normalized.tool_calls

    assert :ok = RequestIR.validate(ir)
  end

  test "double normalize 与 append 的二次归一保留同一 provenance 与 canonical id" do
    original =
      result([call(@tool), call(@tool, %{id: "native-dup"}), call(@tool, %{id: "native-dup"})])

    once = RequestIR.normalize_provider_result([], original)
    twice = RequestIR.normalize_provider_result([], once)

    assert twice.tool_calls == once.tool_calls

    assert Enum.map(once.tool_calls, & &1.id) == [
             "call_read_character",
             "native-dup",
             "native-dup:2"
           ]

    assert Enum.map(once.tool_calls, &Map.get(&1, :provider_call_id)) == [nil, nil, "native-dup"]

    {ir, normalized, assistant} =
      append([call(@tool), call(@tool, %{id: "native-dup"}), call(@tool, %{id: "native-dup"})])

    assert normalized.tool_calls == once.tool_calls

    assert Enum.map(tool_blocks(assistant), & &1.call_id) == [
             "call_read_character",
             "native-dup",
             "native-dup:2"
           ]

    assert Enum.map(tool_blocks(assistant), &Map.get(&1, :provider_call_id)) == [
             nil,
             nil,
             "native-dup"
           ]

    assert :ok = RequestIR.validate(ir)
  end

  test "空白、非字符串与非法 UTF8 的原 id 明确拒绝，不能伪装成未提供" do
    for invalid <- ["", "   ", 123, :native, <<0xFF>>] do
      assert_raise ArgumentError, fn ->
        RequestIR.normalize_provider_result([], result([call(@tool, %{id: invalid})]))
      end
    end
  end

  test "手工 IR 的非法 provider_call_id 被校验拒绝，nil 仍是合法未提供标记" do
    block = RequestIR.tool_call_block(@tool, %{}, "native-1")
    invalid = Map.put(block, :provider_call_id, "   ")
    ir = %{ir() | messages: ir().messages ++ [RequestIR.message(:assistant, :model, [invalid])]}

    assert {:error, :invalid_provider_call_id} = RequestIR.validate(ir)

    explicit_missing = Map.put(block, :provider_call_id, nil)

    assert :ok =
             RequestIR.validate(%{
               ir()
               | messages:
                   ir().messages ++ [RequestIR.message(:assistant, :model, [explicit_missing])]
             })
  end

  test "既有 assistant 消息不被回填/重写；新增显式 nil 不改变三投影字节" do
    legacy_block =
      RequestIR.tool_call_block(@tool, %{"character_ref" => "character:1"}, "old-call")

    legacy =
      RequestIR.message(:assistant, :model, [legacy_block], %{
        provider_call_ref: "pcall-old",
        provider_run_ref: "prun-old"
      })

    ir =
      ir()
      |> Map.put(:messages, ir().messages ++ [legacy])
      |> RequestIR.append_validation_result("old-call", "passed", "input_validated")

    legacy_assistant = Enum.find(ir.messages, &(Map.get(&1, :provider_call_ref) == "pcall-old"))
    [still_legacy] = legacy_assistant.blocks
    assert still_legacy == legacy_block
    refute Map.has_key?(still_legacy, :provider_call_id)

    {ir, _normalized} = RequestIR.append_assistant_result(ir, result([call(@tool)]))
    assistant = List.last(Enum.filter(ir.messages, &(&1.role == "assistant")))
    [new_block] = tool_blocks(assistant)
    assert new_block.provider_call_id == nil

    ir = RequestIR.append_validation_result(ir, new_block.call_id, "passed", "input_validated")

    without_provenance = %{
      ir
      | messages:
          Enum.map(ir.messages, fn
            %{role: "assistant"} = message ->
              %{message | blocks: Enum.map(message.blocks, &Map.delete(&1, :provider_call_id))}

            message ->
              message
          end)
    }

    for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
      assert Projection.project(ir, target) == Projection.project(without_provenance, target)

      assert {:ok, body} = Projection.project(ir, target)
      refute Jason.encode!(body) =~ "provider_call_id"
    end
  end

  test "带来源标记的调用仍受既有 canonical 与同响应占用约束，原 id 不丢失" do
    {ir, _normalized, _assistant} =
      append([call(@tool, %{id: "local-id", provider_call_id: nil})])

    ir = RequestIR.append_validation_result(ir, "local-id", "passed", "input_validated")

    raw = %{
      "id" => "local-id",
      "provider_call_id" => "raw-original",
      "name" => @tool,
      "arguments" => %{"character_ref" => "character:1"}
    }

    {ir, normalized} = RequestIR.append_assistant_result(ir, result([raw]))

    [block] = tool_blocks(List.last(Enum.filter(ir.messages, &(&1.role == "assistant"))))
    assert block.call_id == "local-id:2"
    assert block.provider_call_id == "raw-original"

    assert [%{id: "local-id:2", provider_call_id: "raw-original"} = normalized_call] =
             normalized.tool_calls

    refute Map.has_key?(normalized_call, "id")
    refute Map.has_key?(normalized_call, "provider_call_id")
    assert :ok = RequestIR.validate(ir)
  end

  test "同批两个显式 nil 来源标记仍获唯一 canonical id 且都保留 nil" do
    raw = %{
      "id" => "local-id",
      "provider_call_id" => nil,
      "name" => @tool,
      "arguments" => %{"character_ref" => "character:1"}
    }

    normalized = RequestIR.normalize_provider_result([], result([raw, raw]))

    assert Enum.map(normalized.tool_calls, & &1.id) == ["local-id", "local-id:2"]
    assert Enum.map(normalized.tool_calls, &Map.fetch!(&1, :provider_call_id)) == [nil, nil]
    assert Enum.all?(normalized.tool_calls, &Map.has_key?(&1, :provider_call_id))
  end

  test "同一 used 集合下 double normalize 不改号，也不把 canonical 当原 id" do
    raw = %{
      "id" => "local-id",
      "provider_call_id" => nil,
      "name" => @tool,
      "arguments" => %{"character_ref" => "character:1"}
    }

    once = RequestIR.normalize_provider_result(["local-id", "local-id:2"], result([raw]))
    twice = RequestIR.normalize_provider_result(["local-id", "local-id:2"], once)

    assert twice.tool_calls == once.tool_calls
    assert [%{id: "local-id:3", provider_call_id: nil}] = once.tool_calls
  end

  test "JSON string-key 归一后无字段重影，保留原来源并可直接追加" do
    for original_id <- [nil, "provider-original-id"] do
      raw = %{
        "id" => "local-id",
        "provider_call_id" => original_id,
        "name" => @tool,
        "arguments" => %{"character_ref" => "character:1"}
      }

      normalized = RequestIR.normalize_provider_result([], result([raw]))
      [call] = normalized.tool_calls

      assert call.id == "local-id"
      assert Map.fetch(call, :provider_call_id) == {:ok, original_id}
      refute Map.has_key?(call, "id")
      refute Map.has_key?(call, "provider_call_id")

      encoded = Jason.encode!(call)
      assert length(Regex.scan(~r/"id":/, encoded)) == 1
      assert length(Regex.scan(~r/"provider_call_id":/, encoded)) == 1

      {ir, roundtrip} = RequestIR.append_assistant_result(ir(), normalized)
      [block] = tool_blocks(List.last(Enum.filter(ir.messages, &(&1.role == "assistant"))))

      assert block.call_id == "local-id"
      assert Map.fetch(block, :provider_call_id) == {:ok, original_id}
      assert roundtrip.tool_calls == normalized.tool_calls
      assert :ok = RequestIR.validate(ir)
    end
  end

  test "空白与非法 UTF8 的 canonical id/来源在写入与校验边界都拒绝" do
    for invalid <- ["   ", <<0xFF>>] do
      assert_raise ArgumentError, fn ->
        RequestIR.normalize_provider_result(
          [],
          result([call(@tool, %{id: invalid, provider_call_id: "raw-id"})])
        )
      end

      assert_raise ArgumentError, fn ->
        RequestIR.normalize_provider_result(
          [],
          result([call(@tool, %{id: "local-id", provider_call_id: invalid})])
        )
      end

      block = RequestIR.tool_call_block(@tool, %{}, invalid)
      ir = %{ir() | messages: ir().messages ++ [RequestIR.message(:assistant, :model, [block])]}
      assert {:error, :invalid_call_id} = RequestIR.validate(ir)
    end
  end
end
