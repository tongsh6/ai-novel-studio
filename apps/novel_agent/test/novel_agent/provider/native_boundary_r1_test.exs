defmodule NovelAgent.Provider.NativeBoundaryR1Test do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.Anthropic
  alias NovelAgent.Provider.DeepSeek
  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.OpenAI
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.RuntimeConfig
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Operation
  alias NovelCommon.SystemIdentity

  @author_text "作者原话：沈砚\n\t\"引号\" \\ 反斜杠"
  @raw_arguments ~s({
  "query" : "沈砚", "limit": 1
})
  @tool %{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}

  defmodule ModelCapsProvider do
    @behaviour NovelAgent.Provider

    alias NovelAgent.Provider.AdapterExecution
    alias NovelAgent.Provider.Result
    alias NovelCommon.RequestIR

    defstruct [:model, :http_fn, :log_fn]

    @impl true
    def execute(%__MODULE__{} = state, _model, %RequestIR{} = ir, _params, ctx) do
      send(self(), {:adapter_ir, ir, state.model})
      AdapterExecution.materialize_result({:ok, Result.new("ok")}, ctx)
    end

    def execute(_state, _model, _prompt, _params, _ctx), do: raise("IR only fixture provider")

    @impl true
    def complete(%__MODULE__{}, _model, _prompt, _params), do: raise("use execute/5")

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def list_models(_state), do: {:ok, []}

    @impl true
    def name, do: "model_caps"

    @impl true
    def capabilities(%__MODULE__{model: model})
        when model in ["writer-model", "inventory-model"],
        do: full_capabilities()

    def capabilities(%__MODULE__{}), do: %{native_multi_turn: true, usage: true}

    @impl true
    def projection_target(_state), do: "chat_completions"

    def from_config(config \\ []) do
      model = Keyword.get(config, :model)
      send(self(), {:route_state_resolved, model})

      %__MODULE__{
        model: model,
        http_fn: Keyword.get(config, :http_fn),
        log_fn: Keyword.get(config, :log_fn)
      }
    end

    defp full_capabilities do
      Map.new(RequestIR.required_capabilities(), &{&1, true})
    end
  end

  setup do
    old_extra = Application.get_env(:novel_agent, :extra_providers)
    old_provider = Application.get_env(:novel_agent, :provider)
    old_model_caps = Application.get_env(:novel_agent, ModelCapsProvider)
    old_openai = Application.get_env(:novel_agent, OpenAI)
    old_anthropic = Application.get_env(:novel_agent, Anthropic)
    old_deepseek = Application.get_env(:novel_agent, DeepSeek)

    RuntimeConfig.reset()

    Application.put_env(:novel_agent, :extra_providers, %{model_caps: ModelCapsProvider})
    Application.put_env(:novel_agent, :provider, default: :model_caps)

    Application.put_env(:novel_agent, ModelCapsProvider,
      model: "text-model",
      purpose_models: %{writer: "writer-model", fact_inventory: "inventory-model"},
      log_fn: nil
    )

    on_exit(fn ->
      RuntimeConfig.reset()

      restore_env(:extra_providers, old_extra)
      restore_env(:provider, old_provider)
      Application.put_env(:novel_agent, ModelCapsProvider, old_model_caps || [])
      Application.put_env(:novel_agent, OpenAI, old_openai || [])
      Application.put_env(:novel_agent, Anthropic, old_anthropic || [])
      Application.put_env(:novel_agent, DeepSeek, old_deepseek || [])
    end)

    :ok
  end

  describe "RequestIR.prepare_request/2 与真实路由能力" do
    test "默认 route 缺能力、writer route 完整时构造不查默认 route，实际执行使用 writer" do
      assert {:ok, ir} = operation_ir()
      refute_received {:route_state_resolved, _model}

      assert {:ok, prepared} = RequestIR.prepare_request(ir, tool_names: ["agent_plan_draft"])
      refute_received {:route_state_resolved, _model}

      assert {:ok, %{provider_run: run}} =
               Gateway.execute(prepared, nil, InferenceParams.new(),
                 provider: :model_caps,
                 purpose: :writer
               )

      assert run.model == "writer-model"
      assert_receive {:route_state_resolved, "writer-model"}
      assert_receive {:adapter_ir, ^prepared, "writer-model"}
      refute_receive {:route_state_resolved, _other}
    end

    test "实际 route 缺能力时 HTTP/adapter 零调用，错误沿 AdapterExecution 返回" do
      Application.put_env(:novel_agent, ModelCapsProvider,
        model: "text-model",
        purpose_models: %{writer: "weak-model"},
        log_fn: nil
      )

      assert {:ok, ir} = operation_ir()
      assert {:ok, prepared} = RequestIR.prepare_request(ir)

      assert {:error, %{error: error}} =
               Gateway.execute(prepared, nil, InferenceParams.new(),
                 provider: :model_caps,
                 purpose: :writer
               )

      assert error.type == :invalid_request
      assert :tool_calls in error.details.missing_capabilities
      assert_receive {:route_state_resolved, "weak-model"}
      refute_receive {:adapter_ir, _ir, _model}
    end

    test "route_hint 优先 purpose，能力/HTTP/model 与同一次实际 state 解析同源" do
      Application.put_env(:novel_agent, ModelCapsProvider,
        model: "text-model",
        purpose_models: %{writer: "weak-model", fact_inventory: "inventory-model"},
        log_fn: nil
      )

      assert {:ok, ir} = operation_ir()
      assert {:ok, prepared} = RequestIR.prepare_request(ir)

      assert {:ok, %{provider_run: run}} =
               Gateway.execute(prepared, nil, InferenceParams.new(),
                 provider: :model_caps,
                 purpose: :writer,
                 route_hint: :fact_inventory
               )

      assert run.model == "inventory-model"
      assert_receive {:route_state_resolved, "inventory-model"}
      assert_receive {:adapter_ir, ^prepared, "inventory-model"}
      refute_receive {:route_state_resolved, _model}
    end

    test "有限模式声明进入 ProviderRun metadata；完整模式不写键（VS-00L §6.4）" do
      assert {:ok, ir} = operation_ir()
      assert {:ok, prepared} = RequestIR.prepare_request(ir)

      mode = %{name: "standalone_operation", durable_recovery: false}
      finite = %{prepared | projection: Map.put(prepared.projection, :finite_mode, mode)}

      assert {:ok, %{provider_run: run}} =
               Gateway.execute(finite, nil, InferenceParams.new(),
                 provider: :model_caps,
                 purpose: :writer
               )

      assert run.metadata.finite_mode == mode

      assert {:ok, %{provider_run: full_run}} =
               Gateway.execute(prepared, nil, InferenceParams.new(),
                 provider: :model_caps,
                 purpose: :writer
               )

      refute Map.has_key?(full_run.metadata, :finite_mode)
    end
  end

  describe "Gateway 到 HTTP 的原生 body 保真" do
    test "Chat Completions：作者字节、原始参数、call_id、工具选择与系统身份一次" do
      test_pid = self()

      Application.put_env(:novel_agent, OpenAI,
        api_key: "sk-native",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-native-model",
        log_fn: nil,
        eventsource_fn: chat_stream_mock(test_pid)
      )

      ir = native_ir(%{tool_choice: "required"})
      assert :ok = RequestIR.validate(ir)

      assert {:ok, prepared} =
               RequestIR.prepare_request(ir,
                 tool_names: ["read_character"],
                 tool_choice: "required"
               )

      assert prepared.messages == ir.messages
      refute Enum.any?(prepared.messages, &(&1.role == "system"))

      assert {:ok, %{provider_run: run}} =
               Gateway.execute(prepared, nil, InferenceParams.new(),
                 provider: :openai,
                 purpose: :writer
               )

      assert run.model == "gpt-native-model"
      assert run.metadata.system_identity_ref == SystemIdentity.identity_ref()
      assert_receive {:chat_body, body}

      assert body.model == "gpt-native-model"
      assert body.stream == true
      refute Map.has_key?(body, :ir_version)
      refute Map.has_key?(body, :capability_profile)
      refute Map.has_key?(body, :provider_route)

      system = Enum.find(body.messages, &(&1.role == "system"))
      assert is_binary(system.content)
      assert String.contains?(system.content, SystemIdentity.content())
      assert String.contains?(system.content, "角色规则")
      assert identity_occurrences(system.content) == 1

      author = Enum.find(body.messages, &(&1.role == "user" and &1.content == @author_text))
      assert author, "作者原话必须保持原字节并独立投影"

      assistant = Enum.find(body.messages, &(&1.role == "assistant"))

      assert [%{id: "call-1", function: %{name: "read_character", arguments: @raw_arguments}}] =
               assistant.tool_calls

      tool = Enum.find(body.messages, &(&1.role == "tool"))
      assert tool.tool_call_id == "call-1"

      assert body.tools == [
               %{
                 type: "function",
                 function: %{
                   name: "read_character",
                   description: "读取角色",
                   parameters: %{"type" => "object"}
                 }
               }
             ]

      assert body.tool_choice == "required"
    end

    test "Anthropic Messages：原生 system/tool_use/tool_result，相邻 user 不合并（1:1 投影）" do
      test_pid = self()

      Application.put_env(:novel_agent, Anthropic,
        api_key: "anthropic-key",
        model: "claude-native-model",
        log_fn: nil,
        eventsource_fn: anthropic_stream_mock(test_pid)
      )

      ir = native_ir(%{tool_choice: "auto"})
      assert {:ok, prepared} = RequestIR.prepare_request(ir, tool_choice: "auto")

      assert {:ok, %{provider_run: run}} =
               Gateway.execute(prepared, nil, InferenceParams.new(),
                 provider: :anthropic,
                 purpose: :writer
               )

      assert run.model == "claude-native-model"
      assert_receive {:anthropic_body, body}

      assert body.model == "claude-native-model"
      assert [%{type: "text", text: system_text}] = body.system
      assert String.contains?(system_text, SystemIdentity.content())
      assert String.contains?(system_text, "角色规则")
      assert identity_occurrences(system_text) == 1

      # 1:1 投影：application_base 与作者消息是两条独立 user 条目；连续同 role 的合并
      # 由 Anthropic 服务端按其官方语义执行，客户端不重排、不合并（I-ART-2 / G7）。
      roles = Enum.map(body.messages, & &1.role)
      assert Enum.chunk_every(roles, 2, 1, :discard) |> Enum.any?(fn [a, b] -> a == b end)

      assistant = Enum.find(body.messages, &(&1.role == "assistant"))
      tool_use = Enum.find(assistant.content, &(&1.type == "tool_use"))
      assert tool_use.id == "call-1"
      assert tool_use.name == "read_character"
      assert tool_use.input == %{"query" => "沈砚", "limit" => 1}

      tool_result =
        body.messages
        |> Enum.flat_map(& &1.content)
        |> Enum.find(&(&1.type == "tool_result"))

      assert tool_result.tool_use_id == "call-1"
      assert Jason.decode!(tool_result.content)["call_id"] == "call-1"

      assert [%{name: "read_character", input_schema: %{"type" => "object"}}] = body.tools
      assert body.tool_choice == %{type: "auto"}
    end

    test "Anthropic canonical system 消息只进入顶层 system，作者与工具交换保持" do
      test_pid = self()

      Application.put_env(:novel_agent, Anthropic,
        api_key: "anthropic-key",
        model: "claude-native-model",
        log_fn: nil,
        eventsource_fn: anthropic_stream_mock(test_pid)
      )

      system_text = "系统约束原字节：不得采纳、不得写 canon。"
      ir = native_ir(%{tool_choice: "auto"})

      ir = %{
        ir
        | messages: [
            RequestIR.message(:system, :product, [RequestIR.text_block(system_text)])
            | ir.messages
          ]
      }

      assert :ok = RequestIR.validate(ir)
      assert {:ok, prepared} = RequestIR.prepare_request(ir, tool_choice: "auto")

      assert {:ok, %{provider_run: _run}} =
               Gateway.execute(prepared, nil, InferenceParams.new(),
                 provider: :anthropic,
                 purpose: :writer
               )

      assert_receive {:anthropic_body, body}

      assert Enum.any?(body.system, fn block ->
               block.type == "text" and String.contains?(block.text, system_text)
             end)

      user_blocks =
        body.messages
        |> Enum.filter(&(&1.role == "user"))
        |> Enum.flat_map(& &1.content)

      refute Enum.any?(user_blocks, &String.contains?(Map.get(&1, :text, ""), "系统约束原字节"))
      assert Enum.any?(user_blocks, &(Map.get(&1, :text) == @author_text))

      assert Enum.map(body.messages, & &1.role) == ["user", "user", "assistant", "user"]

      assistant = Enum.find(body.messages, &(&1.role == "assistant"))

      assert [%{type: "tool_use", id: "call-1", name: "read_character"}] =
               Enum.filter(assistant.content, &(&1.type == "tool_use"))

      tool_result =
        body.messages
        |> Enum.flat_map(& &1.content)
        |> Enum.find(&(&1.type == "tool_result"))

      assert tool_result.tool_use_id == "call-1"
    end

    test "Responses API：原生 instructions/input/tools 经 SSE 流式传输，能力完整正常放行" do
      test_pid = self()

      Application.put_env(:novel_agent, OpenAI,
        api_key: "sk-native",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-responses-model",
        wire_api: :responses,
        log_fn: nil,
        eventsource_fn: responses_stream_mock(test_pid)
      )

      ir = native_ir(%{tool_choice: "required"})

      assert {:ok, prepared} =
               RequestIR.prepare_request(ir,
                 tool_names: ["read_character"],
                 tool_choice: "required"
               )

      assert {:ok, %{provider_run: run}} =
               Gateway.execute(prepared, nil, InferenceParams.new(),
                 provider: :openai,
                 purpose: :writer
               )

      assert run.model == "gpt-responses-model"
      assert_receive {:responses_body, body}

      assert body.model == "gpt-responses-model"
      assert body.stream == true
      assert String.contains?(body.instructions, SystemIdentity.content())
      assert identity_occurrences(body.instructions) == 1

      author =
        Enum.find(body.input, fn item ->
          item.type == "message" and item.role == "user" and
            Enum.any?(item.content, &(&1.text == @author_text))
        end)

      assert author, "作者原话必须作为原生 input 消息保留"

      call = Enum.find(body.input, &(&1.type == "function_call"))
      assert call.call_id == "call-1"
      assert call.arguments == @raw_arguments

      output = Enum.find(body.input, &(&1.type == "function_call_output"))
      assert output.call_id == "call-1"

      assert [%{type: "function", name: "read_character", parameters: %{"type" => "object"}}] =
               body.tools

      assert body.tool_choice == "required"
    end

    test "未声明 streaming 的 route 仍在能力门被拒绝且零 adapter 调用（R2 不放松能力门）" do
      assert {:ok, ir} = operation_ir()
      assert {:ok, prepared} = RequestIR.prepare_request(ir)

      assert {:error, %{error: error}} =
               Gateway.execute(prepared, nil, InferenceParams.new(), provider: :model_caps)

      # default route 只声明 native_multi_turn/usage：完整 AgentRun 必备能力缺失，
      # R2 的 streaming 实现不改变「adapter 未声明即不可证」的 fail-closed 语义。
      assert :streaming in error.details.missing_capabilities
      refute_received {:adapter_ir, _ir, _model}
    end

    test "Anthropic 遇到不可表示的原生工具参数时在 HTTP 之前失败" do
      test_pid = self()

      Application.put_env(:novel_agent, Anthropic,
        api_key: "anthropic-key",
        model: "claude-native-model",
        log_fn: nil,
        http_fn: fn _url, body, _opts ->
          send(test_pid, {:anthropic_body, body})
          {:ok, 200, %{"content" => [%{"type" => "text", "text" => "不应发生"}]}}
        end
      )

      bad_call =
        RequestIR.tool_call_block("read_character", %{}, "bad-call")
        |> Map.put(:raw_arguments, "{\"query\":}")

      ir = native_ir(%{tool_choice: "auto", call: bad_call})
      assert {:ok, prepared} = RequestIR.prepare_request(ir, tool_choice: "auto")

      assert {:error, %{error: error}} =
               Gateway.execute(prepared, nil, InferenceParams.new(),
                 provider: :anthropic,
                 purpose: :writer
               )

      assert error.type == :invalid_request
      refute_receive {:anthropic_body, _body}
    end
  end

  describe "DeepSeek 私有状态只按真实 provider/model 回投" do
    defp deepseek_ir do
      provider_state = %{
        "provider" => "deepseek",
        "model" => "deepseek-native-model",
        "payload" => %{"reasoning_content" => "仅来源模型可见"}
      }

      foreign_state = %{
        "provider" => "other",
        "model" => "deepseek-native-model",
        "payload" => %{"reasoning_content" => "不得泄漏"}
      }

      RequestIR.new(%{
        run: %{run_id: "run-deepseek-native", work_id: "work-native"},
        system: RequestIR.system_envelope(instructions: "角色规则"),
        messages: [
          RequestIR.message(:application_base, :application, [RequestIR.text_block("base")]),
          RequestIR.message(:user, :author, [RequestIR.text_block(@author_text)]),
          RequestIR.message(:assistant, :model, [RequestIR.text_block("第一轮")], %{
            provider_state: provider_state
          }),
          RequestIR.message(:user, :author, [RequestIR.text_block("第二轮")]),
          RequestIR.message(:assistant, :model, [RequestIR.text_block("外来")], %{
            provider_state: foreign_state
          }),
          RequestIR.message(:user, :author, [RequestIR.text_block("第三轮")])
        ],
        projection: %{},
        refs: %{base_refs: [], observation_refs: [], used_refs: []}
      })
    end

    test "同 provider/model 回投 reasoning_content，跨来源与默认不泄漏" do
      test_pid = self()

      state = %DeepSeek{
        api_key: "deepseek-key",
        endpoint: "https://api.deepseek.com",
        model: "deepseek-native-model",
        timeout: 100,
        max_tokens: 1024,
        json_mode: false,
        thinking: :disabled,
        log_fn: nil,
        http_fn: fn _url, body, _opts ->
          send(test_pid, {:deepseek_body, body})
          {:ok, 200, %{"choices" => [%{"message" => %{"content" => "ok"}}]}}
        end
      }

      assert {:ok, prepared} = RequestIR.prepare_request(deepseek_ir())
      assert {:ok, _result} = DeepSeek.complete(state, nil, prepared, InferenceParams.new())

      assert_receive {:deepseek_body, body}
      [first | _rest] = Enum.filter(body.messages, &(&1.role == "assistant"))
      assert first.reasoning_content == "仅来源模型可见"

      refute Enum.any?(body.messages, &Map.has_key?(&1, :provider_state))
      refute Enum.any?(body.messages, &(Map.get(&1, :reasoning_content) == "不得泄漏"))
    end

    test "同一私有状态换模型不误回投" do
      test_pid = self()

      state = %DeepSeek{
        api_key: "deepseek-key",
        endpoint: "https://api.deepseek.com",
        model: "other-model",
        timeout: 100,
        max_tokens: 1024,
        json_mode: false,
        thinking: :disabled,
        log_fn: nil,
        http_fn: fn _url, body, _opts ->
          send(test_pid, {:deepseek_body, body})
          {:ok, 200, %{"choices" => [%{"message" => %{"content" => "ok"}}]}}
        end
      }

      assert {:ok, prepared} = RequestIR.prepare_request(deepseek_ir())
      assert {:ok, _result} = DeepSeek.complete(state, nil, prepared, InferenceParams.new())

      assert_receive {:deepseek_body, body}
      refute Enum.any?(body.messages, &Map.has_key?(&1, :reasoning_content))
      refute Enum.any?(body.messages, &Map.has_key?(&1, :provider_state))
    end
  end

  # B71 R2：三 wire 的工具调用/普通请求都走 SSE 流式传输；body 保真测试必须
  # 用 eventsource mock 捕获真实 HTTP body，并返回最小合法 SSE 帧。
  defp sse_event(event, payload),
    do: "event: " <> event <> "\ndata: " <> Jason.encode!(payload) <> "\n\n"

  defp sse_data(payload), do: "data: " <> Jason.encode!(payload) <> "\n\n"

  defp chat_stream_mock(test_pid) do
    fn _url, body, _opts, on_data ->
      send(test_pid, {:chat_body, body})

      on_data.(
        sse_data(%{
          "model" => "gpt-native-model",
          "choices" => [%{"delta" => %{"content" => "已读取"}}]
        })
      )

      on_data.("data: [DONE]\n\n")
      {:ok, 200, ""}
    end
  end

  defp anthropic_stream_mock(test_pid) do
    fn _url, body, _opts, on_data ->
      send(test_pid, {:anthropic_body, body})

      on_data.(
        sse_event("message_start", %{
          "type" => "message_start",
          "message" => %{
            "model" => "claude-native-model",
            "usage" => %{"input_tokens" => 1}
          }
        })
      )

      on_data.(
        sse_event("content_block_delta", %{
          "type" => "content_block_delta",
          "index" => 0,
          "delta" => %{"type" => "text_delta", "text" => "已完成"}
        })
      )

      on_data.(
        sse_event("message_delta", %{
          "type" => "message_delta",
          "usage" => %{"output_tokens" => 3}
        })
      )

      {:ok, 200, ""}
    end
  end

  defp responses_stream_mock(test_pid) do
    fn _url, body, _opts, on_data ->
      send(test_pid, {:responses_body, body})

      on_data.(
        sse_data(%{
          "type" => "response.created",
          "response" => %{"model" => "gpt-responses-model"}
        })
      )

      on_data.(
        sse_data(%{
          "type" => "response.output_text.delta",
          "item_id" => "msg_1",
          "output_index" => 0,
          "delta" => "完成"
        })
      )

      on_data.(
        sse_data(%{
          "type" => "response.completed",
          "response" => %{
            "model" => "gpt-responses-model",
            "usage" => %{"input_tokens" => 2, "output_tokens" => 1}
          }
        })
      )

      {:ok, 200, ""}
    end
  end

  defp operation_ir do
    Operation.prepare(
      nil,
      %{run_id: "run-native-boundary", work_id: "work-native"},
      %{
        role: "planner",
        instructions: "计划规则",
        scope: "计划范围",
        tool: %{
          name: "agent_plan_draft",
          description: "计划",
          input_schema: %{type: "object"}
        }
      }
    )
  end

  defp native_ir(opts) do
    call =
      case Map.get(opts, :call) do
        nil ->
          RequestIR.tool_call_block("read_character", %{"query" => "沈砚"}, "call-1")
          |> Map.put(:raw_arguments, Map.get(opts, :raw_arguments, @raw_arguments))

        call ->
          call
      end

    call_id = Map.fetch!(call, :call_id)

    messages = [
      RequestIR.message(:application_base, :application, [
        RequestIR.text_block("run goal: 读取角色事实")
      ]),
      RequestIR.message(:user, :author, [RequestIR.text_block(@author_text)]),
      RequestIR.message(:assistant, :model, [
        RequestIR.text_block("先读取角色事实。"),
        call
      ]),
      RequestIR.message(:tool, :tool_result, [
        RequestIR.observation_block(call_id, %{
          status: "ok",
          source_refs: [%{ref: "character:1", version: 2}],
          content: %{"narrative_role" => "ENSEMBLE_POV"}
        })
      ])
    ]

    projection =
      %{usage_streaming: false}
      |> maybe_put(:tool_choice, Map.get(opts, :tool_choice))
      |> maybe_put(:finite_mode, Map.get(opts, :finite_mode))

    RequestIR.new(%{
      run: %{run_id: "run-native", work_id: "work-native"},
      system:
        RequestIR.system_envelope(
          instructions: "角色规则：只读作品事实并提交 tentative 候选。",
          run_role: "creation_run"
        ),
      messages: messages,
      tools: [@tool],
      projection: projection,
      refs: %{
        base_refs: [],
        observation_refs: [%{ref: "character:1", version: 2}],
        used_refs: []
      }
    })
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp identity_occurrences(text) when is_binary(text) do
    text |> :binary.matches(SystemIdentity.content()) |> length()
  end

  defp restore_env(key, nil), do: Application.delete_env(:novel_agent, key)
  defp restore_env(key, value), do: Application.put_env(:novel_agent, key, value)
end
