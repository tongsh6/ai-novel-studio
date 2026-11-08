defmodule NovelAgent.Provider.GatewayTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.RuntimeConfig
  alias NovelAgent.Provider.Strata
  alias NovelCommon.Contracts.ProviderEvent
  alias NovelCommon.SystemIdentity

  defmodule ExecuteOnlyProvider do
    @behaviour NovelAgent.Provider

    alias NovelAgent.Provider.AdapterExecution
    alias NovelAgent.Provider.Result
    alias NovelCommon.RequestIR

    defstruct []

    @impl true
    def execute(_state, _model, prompt, _params, ctx) do
      content = NovelTest.TestProviderPrompt.author_text(prompt)

      AdapterExecution.materialize_result({:ok, Result.new("adapter execute: #{content}")}, ctx)
    end

    @impl true
    def capabilities(_state), do: Map.new(RequestIR.required_capabilities(), &{&1, true})

    @impl true
    def projection_target(_state), do: "chat_completions"

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def name, do: "execute_only_provider"
  end

  defmodule CapturingProvider do
    @behaviour NovelAgent.Provider

    alias NovelAgent.Provider.AdapterExecution
    alias NovelAgent.Provider.Result
    alias NovelCommon.RequestIR

    defstruct []

    @impl true
    def execute(_state, _model, prompt, _params, ctx) do
      send(self(), {:captured_prompt, prompt})
      AdapterExecution.materialize_result({:ok, Result.new("captured")}, ctx)
    end

    @impl true
    def capabilities(_state), do: Map.new(RequestIR.required_capabilities(), &{&1, true})

    @impl true
    def projection_target(_state), do: "chat_completions"

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def name, do: "capturing"
  end

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelTest.TestProviderPrompt
  alias NovelTest.TestRequestIR

  # 生产 Gateway 只接受 canonical RequestIR；旧测试的文本/messages 参数在这里
  # 转成等价 canonical 消息（文字内容保持原字节），不改任何产品行为。
  defp op_ir(text) when is_binary(text), do: TestRequestIR.ir([TestRequestIR.author(text)])

  defp op_ir(messages) when is_list(messages) do
    TestRequestIR.ir(Enum.map(messages, &canonical_message/1))
  end

  defp canonical_message(%{role: "system", content: content}), do: TestRequestIR.system(content)

  defp canonical_message(%{role: "assistant", content: content}),
    do: TestRequestIR.assistant(content)

  defp canonical_message(%{role: "user", content: content}), do: TestRequestIR.author(content)

  setup do
    old_extra = Application.get_env(:novel_agent, :extra_providers)

    # 全局 provider 选择/额外 provider 注册是跨 app 共享状态：本文件每个用例都
    # 在这里有兜底恢复，测试内部临时切换也必须回到进入时的真实值（app 段之间
    # 共用一个 BEAM，泄漏会把假 provider 带到 web/application 段）。
    old_provider = Application.get_env(:novel_agent, :provider)
    RuntimeConfig.reset()

    Application.put_env(
      :novel_agent,
      :extra_providers,
      Map.merge(Map.new(old_extra || []), %{
        slice_verify: NovelAgent.Test.Provider.SliceVerify,
        capturing: CapturingProvider
      })
    )

    on_exit(fn ->
      RuntimeConfig.reset()

      if old_extra do
        Application.put_env(:novel_agent, :extra_providers, old_extra)
      else
        Application.delete_env(:novel_agent, :extra_providers)
      end

      if old_provider do
        Application.put_env(:novel_agent, :provider, old_provider)
      else
        Application.delete_env(:novel_agent, :provider)
      end
    end)
  end

  describe "registered_providers/0" do
    test "returns production and explicitly test-registered providers" do
      providers = Gateway.registered_providers()
      assert :slice_verify in providers
      assert :lmstudio in providers
      assert :strata in providers
      assert :anthropic in providers
      assert :deepseek in providers
    end

    test "registers the OpenAI-compatible vendor matrix" do
      providers = Gateway.registered_providers()

      for vendor <- [:openai, :openai_subscription, :minimax, :minimax_cn, :zhipu, :kimi, :gemini] do
        assert vendor in providers
      end
    end
  end

  describe "system identity (VS-00H)" do
    test "投影只产出一条 system 身份前缀，并把引用写进 ProviderRun" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :capturing)

      try do
        assert {:ok, %{provider_run: run}} = Gateway.execute(op_ir("hello"))

        assert_receive {:captured_prompt, %RequestIR{} = captured}
        assert captured.system.identity_ref == SystemIdentity.identity_ref()
        assert TestProviderPrompt.author_text(captured) == "hello"

        # 身份文本只由唯一真源在投影时生成一次；请求历史里不存在第二条身份消息。
        assert {:ok, body} = Projection.project(captured, "chat_completions")
        [identity | rest] = body.messages
        assert identity.role == "system"
        assert String.starts_with?(identity.content, SystemIdentity.content())

        refute Enum.any?(rest, fn message ->
                 message.role == "system" and String.contains?(message.content, "AI Novel Studio")
               end)

        assert run.metadata[:system_identity_ref] == SystemIdentity.identity_ref()
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end

    test "连续两次调用共享同一身份前缀（前缀稳定性）" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :capturing)

      try do
        assert {:ok, _} = Gateway.execute(op_ir("第一次判断调用"))
        assert {:ok, _} = Gateway.execute(op_ir("第二次判断调用"))

        assert_receive {:captured_prompt, %RequestIR{} = first}
        assert_receive {:captured_prompt, %RequestIR{} = second}

        assert first.system.identity_ref == second.system.identity_ref

        assert {:ok, first_body} = Projection.project(first, "chat_completions")
        assert {:ok, second_body} = Projection.project(second, "chat_completions")

        [first_system | _] = first_body.messages
        [second_system | _] = second_body.messages

        assert first_system.content == second_system.content
        assert String.starts_with?(first_system.content, SystemIdentity.content())
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end
  end

  describe "provider_metadata/0" do
    test "returns adapter model from current provider configuration" do
      old_provider = Application.get_env(:novel_agent, :provider)
      old_lmstudio = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio)

      Application.put_env(:novel_agent, :provider, default: :lmstudio)

      Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio,
        endpoint: "http://127.0.0.1:1234/v1",
        model: "local-test-model"
      )

      try do
        assert Gateway.provider_metadata() == %{provider: :lmstudio, model: "local-test-model"}
      after
        Application.put_env(:novel_agent, :provider, old_provider)
        Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio, old_lmstudio)
      end
    end

    test "does not invent a model for providers without model configuration" do
      old_provider = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :stub)

      try do
        assert Gateway.provider_metadata() == %{provider: :stub, model: nil}
      after
        Application.put_env(:novel_agent, :provider, old_provider)
      end
    end

    test "returns DeepSeek model from provider configuration" do
      old_provider = Application.get_env(:novel_agent, :provider)
      old_deepseek = Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek)

      Application.put_env(:novel_agent, :provider, default: :deepseek)

      Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek,
        api_key: "key",
        model: "deepseek-v4-pro"
      )

      try do
        assert Gateway.provider_metadata() == %{provider: :deepseek, model: "deepseek-v4-pro"}
      after
        Application.put_env(:novel_agent, :provider, old_provider)
        Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek, old_deepseek)
      end
    end
  end

  describe "provider_options/0" do
    test "returns provider capabilities without leaking secrets" do
      old_deepseek = Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek)

      Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek,
        api_key: "secret",
        model: "deepseek-v4-flash"
      )

      try do
        options = Gateway.provider_options()
        deepseek = Enum.find(options.providers, &(&1.id == :deepseek))
        anthropic = Enum.find(options.providers, &(&1.id == :anthropic))
        slice_verify = Enum.find(options.providers, &(&1.id == :slice_verify))

        assert options.current_provider == :stub
        assert anthropic.label == "Anthropic"
        assert anthropic.supports_streaming == true
        assert deepseek.label == "DeepSeek"
        assert deepseek.supports_api_key == true
        assert deepseek.supports_streaming == true
        assert deepseek.api_key_configured == true
        refute Map.has_key?(deepseek, :api_key)
        assert slice_verify.label == "slice_verify"
        assert slice_verify.requires_api_key == false
        assert slice_verify.supports_endpoint == false
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek, old_deepseek)
      end
    end

    test "exposes Strata as the single keyless Strata-App-managed backend" do
      old_strata = Application.get_env(:novel_agent, Strata)

      Application.put_env(:novel_agent, Strata,
        endpoint: "http://127.0.0.1:47831/v1",
        model: nil
      )

      try do
        strata = Enum.find(Gateway.provider_options().providers, &(&1.id == :strata))

        assert strata.label == "Strata"
        assert strata.requires_api_key == false
        assert strata.supports_api_key == true

        # 2026-10-22 方案修正：产品只连 Strata App 统一推理后台，端点不在设置页配置。
        assert strata.supports_endpoint == false
        assert strata.supports_thinking == true
        assert strata.supports_streaming == true
        assert strata.supports_cancellation == true
        # 模型由 Strata App 管理：未显式选择时不下发模型。
        assert strata.model == nil
        assert strata.endpoint == "http://127.0.0.1:47831/v1"
        assert is_boolean(strata.api_key_configured)
        refute Map.has_key?(strata, :api_key)
      after
        if old_strata do
          Application.put_env(:novel_agent, Strata, old_strata)
        else
          Application.delete_env(:novel_agent, Strata)
        end
      end
    end

    test "ignores a caller-supplied endpoint for the unified Strata backend" do
      configured_endpoint =
        Application.get_env(:novel_agent, Strata, [])
        |> Keyword.get(:endpoint, "http://127.0.0.1:47831/v1")

      assert {:ok, %{provider: :strata}} =
               Gateway.configure_provider(%{
                 provider: "strata",
                 endpoint: "http://127.0.0.1:8081/v1",
                 model: "iq3_s"
               })

      # 旧版按 profile 保存的 8081 端点不得穿透运行时配置；运行时保持配置的
      # Strata App 统一入口。
      assert RuntimeConfig.provider_config(:strata)[:endpoint] == configured_endpoint

      strata = Enum.find(Gateway.provider_options().providers, &(&1.id == :strata))
      assert strata.endpoint == configured_endpoint
    end

    test "distinguishes OpenAI api_key vs subscription and never leaks their keys" do
      old_openai = Application.get_env(:novel_agent, NovelAgent.Provider.OpenAI)
      old_sub = Application.get_env(:novel_agent, NovelAgent.Provider.OpenAISubscription)

      Application.put_env(:novel_agent, NovelAgent.Provider.OpenAI, api_key: "sk-api-secret")

      Application.put_env(:novel_agent, NovelAgent.Provider.OpenAISubscription,
        api_key: "tok-sub-secret"
      )

      try do
        options = Gateway.provider_options()
        openai = Enum.find(options.providers, &(&1.id == :openai))
        subscription = Enum.find(options.providers, &(&1.id == :openai_subscription))

        assert openai.label == "OpenAI（API Key）"
        assert subscription.label == "OpenAI（订阅）"
        assert openai.api_key_configured == true
        assert subscription.api_key_configured == true
        refute Map.has_key?(openai, :api_key)
        refute Map.has_key?(subscription, :api_key)
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.OpenAI, old_openai)
        Application.put_env(:novel_agent, NovelAgent.Provider.OpenAISubscription, old_sub)
      end
    end
  end

  describe "purpose model routing (D6)" do
    test "用途路由必须同时决定真实 HTTP model 与运行记录" do
      capture_strata_wire(model: "global-model", purpose_models: %{writer: "writer-model"})

      assert {:ok, %{provider_run: run}} =
               Gateway.execute(routing_tool_ir(), nil, InferenceParams.new(),
                 provider: :strata,
                 purpose: :writer
               )

      assert_receive {:routing_wire_body, body}
      assert body.model == "writer-model"
      assert run.model == body.model
    end

    test "显式 model 优先于用途路由并进入真实 HTTP body" do
      capture_strata_wire(model: "global-model", purpose_models: %{writer: "writer-model"})

      assert {:ok, %{provider_run: run}} =
               Gateway.execute(routing_tool_ir(), "explicit-model", InferenceParams.new(),
                 provider: :strata,
                 purpose: :writer
               )

      assert_receive {:routing_wire_body, body}
      assert body.model == "explicit-model"
      assert run.model == body.model
    end

    test "route_hint 优先于粗粒度 purpose 且与真实请求一致" do
      capture_strata_wire(
        model: "global-model",
        purpose_models: %{writer: "writer-model", fact_inventory: "inventory-model"}
      )

      assert {:ok, %{provider_run: run}} =
               Gateway.execute(routing_tool_ir(), nil, InferenceParams.new(),
                 provider: :strata,
                 purpose: :writer,
                 route_hint: :fact_inventory
               )

      assert_receive {:routing_wire_body, body}
      assert body.model == "inventory-model"
      assert run.model == body.model
    end

    test "Strata 未选择模型时保留服务端路由，不发送日志占位名称" do
      capture_strata_wire(model: nil)

      assert {:ok, _execution} =
               Gateway.execute(routing_tool_ir(), nil, InferenceParams.new(),
                 provider: :strata,
                 purpose: :writer
               )

      assert_receive {:routing_wire_body, body}
      refute Map.has_key?(body, :model)
    end

    test "purpose hit routes to the configured model while others follow the global default" do
      RuntimeConfig.put_provider_config(:stub, purpose_models: %{writer: "m-d6-writer"})

      assert {:ok, %{provider_run: %{model: "m-d6-writer"}}} =
               Gateway.execute(op_ir("d6 route"), nil, InferenceParams.new(),
                 provider: :stub,
                 purpose: :writer
               )

      assert {:ok, %{provider_run: %{model: model}}} =
               Gateway.execute(op_ir("d6 route"), nil, InferenceParams.new(),
                 provider: :stub,
                 purpose: :conversation
               )

      refute model == "m-d6-writer"
    end

    test "route_hint takes precedence over the coarse purpose key" do
      RuntimeConfig.put_provider_config(:stub,
        purpose_models: %{writer: "m-d6-writer", fact_inventory: "m-d6-inventory"}
      )

      assert {:ok, %{provider_run: %{model: "m-d6-inventory"}}} =
               Gateway.execute(op_ir("d6 route"), nil, InferenceParams.new(),
                 provider: :stub,
                 purpose: :tool,
                 route_hint: :fact_inventory
               )
    end

    test "explicit model argument still wins over the routing table" do
      RuntimeConfig.put_provider_config(:stub, purpose_models: %{writer: "m-d6-writer"})

      assert {:ok, %{provider_run: %{model: "m-explicit"}}} =
               Gateway.execute(op_ir("d6 route"), "m-explicit", InferenceParams.new(),
                 provider: :stub,
                 purpose: :writer
               )
    end

    test "empty table and unrouted purposes follow the global default untouched" do
      assert {:ok, %{provider_run: %{model: unrouted}}} =
               Gateway.execute(op_ir("d6 route"), nil, InferenceParams.new(),
                 provider: :stub,
                 purpose: :writer
               )

      RuntimeConfig.put_provider_config(:stub, purpose_models: %{evaluator: "m-d6-eval"})

      assert {:ok, %{provider_run: %{model: ^unrouted}}} =
               Gateway.execute(op_ir("d6 route"), nil, InferenceParams.new(),
                 provider: :stub,
                 purpose: :writer
               )
    end

    test "configure_provider normalizes purpose_models with whitelist and trims" do
      assert {:ok, %{provider: :stub}} =
               Gateway.configure_provider(%{
                 "provider" => "stub",
                 "purpose_models" => %{
                   "writer" => " m-d6-writer ",
                   "planner" => "",
                   "bogus" => "m-x"
                 }
               })

      assert RuntimeConfig.provider_config(:stub)[:purpose_models] == %{writer: "m-d6-writer"}
    end

    test "configure_provider without purpose_models keeps the config free of the key" do
      assert {:ok, %{provider: :stub}} = Gateway.configure_provider(%{"provider" => "stub"})
      refute Keyword.has_key?(RuntimeConfig.provider_config(:stub), :purpose_models)
    end
  end

  describe "configure_provider/1" do
    test "changes the runtime provider and merges provider config" do
      old_deepseek = Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek)
      test_pid = self()

      mock = fn _url, body, _opts, on_data ->
        send(test_pid, {:body, body})

        on_data.(sse_delta("runtime ", "deepseek-v4-pro"))
        on_data.(sse_delta("deepseek", "deepseek-v4-pro", %{}))

        on_data.("data: [DONE]\n\n")

        {:ok, 200, ""}
      end

      Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek,
        endpoint: "https://api.deepseek.com",
        eventsource_fn: mock,
        log_fn: nil
      )

      try do
        assert {:ok, %{provider: :deepseek, model: "deepseek-v4-pro"}} =
                 Gateway.configure_provider(%{
                   "provider" => "deepseek",
                   "model" => "deepseek-v4-pro",
                   "api_key" => "key",
                   "thinking" => "enabled"
                 })

        assert Gateway.provider_metadata() == %{provider: :deepseek, model: "deepseek-v4-pro"}
        assert {:ok, %{content: "runtime deepseek"}} = Gateway.complete(op_ir("hello"))
        assert_receive {:body, body}
        assert body.model == "deepseek-v4-pro"
        assert body.stream == true
        assert body.thinking == %{type: "enabled"}
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek, old_deepseek)
      end
    end

    test "clears a previously configured runtime api key" do
      old_deepseek = Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek)
      old_env_key = System.get_env("DEEPSEEK_API_KEY")

      Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek,
        endpoint: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        log_fn: nil
      )

      System.delete_env("DEEPSEEK_API_KEY")

      try do
        assert {:ok, %{provider: :deepseek, model: "deepseek-v4-flash"}} =
                 Gateway.configure_provider(%{
                   "provider" => "deepseek",
                   "api_key" => "runtime-key"
                 })

        configured = Gateway.provider_options().providers |> Enum.find(&(&1.id == :deepseek))
        assert configured.api_key_configured == true

        assert {:ok, %{provider: :deepseek, model: "deepseek-v4-flash"}} =
                 Gateway.configure_provider(%{
                   "provider" => "deepseek",
                   "clear_api_key" => true
                 })

        cleared = Gateway.provider_options().providers |> Enum.find(&(&1.id == :deepseek))
        assert cleared.api_key_configured == false

        assert {:error, %{error: %{type: :unauthorized}}} =
                 Gateway.test_provider(%{
                   "provider" => "deepseek",
                   "clear_api_key" => true
                 })
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek, old_deepseek)

        if old_env_key do
          System.put_env("DEEPSEEK_API_KEY", old_env_key)
        else
          System.delete_env("DEEPSEEK_API_KEY")
        end
      end
    end

    test "rejects invalid endpoint without switching runtime provider" do
      assert {:error,
              %{
                type: :invalid_endpoint,
                message: "端点必须是完整的 http(s) URL。"
              }} =
               Gateway.configure_provider(%{
                 "provider" => "lmstudio",
                 "endpoint" => "localhost:1234/v1",
                 "model" => "local-model"
               })

      assert Gateway.provider_metadata() == %{provider: :stub, model: nil}
    end
  end

  describe "test_provider/1" do
    test "checks supplied provider config without changing current provider" do
      old_lmstudio = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio)

      mock = fn _url, _opts ->
        {:ok, 200, %{"data" => []}}
      end

      Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio,
        endpoint: "http://old.invalid/v1",
        model: "old-model",
        get_fn: mock
      )

      try do
        assert {:ok, %{provider: :lmstudio, model: "test-model"}} =
                 Gateway.test_provider(%{
                   "provider" => "lmstudio",
                   "endpoint" => "http://localhost:1234/v1",
                   "model" => "test-model"
                 })

        assert Gateway.provider_metadata() == %{provider: :stub, model: nil}
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio, old_lmstudio)
      end
    end

    test "rejects invalid endpoint before health check" do
      assert {:error,
              %{
                type: :invalid_endpoint,
                message: "端点必须是完整的 http(s) URL。"
              }} =
               Gateway.test_provider(%{
                 "provider" => "lmstudio",
                 "endpoint" => "localhost:1234/v1",
                 "model" => "test-model"
               })

      assert Gateway.provider_metadata() == %{provider: :stub, model: nil}
    end

    test "performs a real /models network probe instead of only checking key presence" do
      old_deepseek = Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek)
      test_pid = self()

      # 有 key 但端点返回 401：真实探测必须失败。
      # 旧逻辑（仅查 key 是否存在）会在这里误报"连接可用"——这正是被发现的假按钮。
      mock = fn url, _opts ->
        send(test_pid, {:models_probe, url})
        {:error, :http_error, 401, "Unauthorized"}
      end

      Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek,
        api_key: "configured-but-invalid",
        endpoint: "https://api.deepseek.com",
        get_fn: mock
      )

      try do
        assert {:error, %{provider: :deepseek, error: %{type: :auth}}} =
                 Gateway.test_provider(%{"provider" => "deepseek"})

        assert_received {:models_probe, "https://api.deepseek.com/models"}
        assert Gateway.provider_metadata() == %{provider: :stub, model: nil}
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek, old_deepseek)
      end
    end
  end

  describe "provider_models/1" do
    test "loads DeepSeek models from the provider API without changing current provider" do
      old_deepseek = Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek)
      test_pid = self()

      mock = fn url, opts ->
        send(test_pid, {:deepseek_models_request, url, opts})

        {:ok, 200,
         %{
           "data" => [
             %{"id" => "deepseek-chat", "owned_by" => "deepseek"},
             %{"id" => "deepseek-reasoner", "owned_by" => "deepseek"}
           ]
         }}
      end

      Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek,
        endpoint: "https://api.deepseek.com",
        get_fn: mock,
        log_fn: nil
      )

      try do
        assert {:ok, %{provider: :deepseek, models: models}} =
                 Gateway.provider_models(%{
                   "provider" => "deepseek",
                   "api_key" => "runtime-key"
                 })

        assert Enum.map(models, & &1.id) == ["deepseek-chat", "deepseek-reasoner"]
        assert_receive {:deepseek_models_request, "https://api.deepseek.com/models", opts}
        assert {"authorization", "Bearer runtime-key"} in Keyword.fetch!(opts, :headers)
        assert Gateway.provider_metadata() == %{provider: :stub, model: nil}
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek, old_deepseek)
      end
    end

    test "loads Anthropic models and preserves display names" do
      old_anthropic = Application.get_env(:novel_agent, NovelAgent.Provider.Anthropic)
      test_pid = self()

      mock = fn url, opts ->
        send(test_pid, {:anthropic_models_request, url, opts})

        {:ok, 200,
         %{
           "data" => [
             %{"id" => "claude-sonnet-4-6", "display_name" => "Claude Sonnet 4.6"}
           ]
         }}
      end

      Application.put_env(:novel_agent, NovelAgent.Provider.Anthropic,
        get_fn: mock,
        log_fn: nil
      )

      try do
        assert {:ok, %{provider: :anthropic, models: [model]}} =
                 Gateway.provider_models(%{
                   "provider" => "anthropic",
                   "api_key" => "anthropic-key"
                 })

        assert model.id == "claude-sonnet-4-6"
        assert model.label == "Claude Sonnet 4.6"
        assert model.owned_by == "anthropic"
        assert_receive {:anthropic_models_request, "https://api.anthropic.com/v1/models", opts}
        assert {"x-api-key", "anthropic-key"} in Keyword.fetch!(opts, :headers)
        assert {"anthropic-version", "2023-06-01"} in Keyword.fetch!(opts, :headers)
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.Anthropic, old_anthropic)
      end
    end

    test "loads LM Studio models from the configured local endpoint" do
      old_lmstudio = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio)
      test_pid = self()

      mock = fn url, _opts ->
        send(test_pid, {:lmstudio_models_request, url})

        {:ok, 200,
         %{
           "data" => [
             %{"id" => "qwen/qwen3.6-35b-a3b"},
             %{"id" => "mistral/local"}
           ]
         }}
      end

      Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio,
        endpoint: "http://127.0.0.1:1234/v1",
        get_fn: mock
      )

      try do
        assert {:ok, %{provider: :lmstudio, models: models}} =
                 Gateway.provider_models(%{
                   "provider" => "lmstudio",
                   "endpoint" => "http://127.0.0.1:1234/v1"
                 })

        assert Enum.map(models, & &1.id) == ["qwen/qwen3.6-35b-a3b", "mistral/local"]
        assert_receive {:lmstudio_models_request, "http://127.0.0.1:1234/v1/models"}
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio, old_lmstudio)
      end
    end

    test "rejects invalid endpoint without requesting provider models" do
      old_lmstudio = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio)
      test_pid = self()

      mock = fn url, _opts ->
        send(test_pid, {:unexpected_lmstudio_models_request, url})
        {:ok, 200, %{"data" => [%{"id" => "local-model"}]}}
      end

      Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio,
        endpoint: "http://127.0.0.1:1234/v1",
        get_fn: mock
      )

      try do
        assert {:error,
                %{
                  type: :invalid_endpoint,
                  message: "端点必须是完整的 http(s) URL。"
                }} =
                 Gateway.provider_models(%{
                   "provider" => "lmstudio",
                   "endpoint" => "localhost:1234/v1"
                 })

        refute_receive {:unexpected_lmstudio_models_request, _url}, 50
      after
        Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio, old_lmstudio)
      end
    end
  end

  describe "complete/2 with test env (stub default)" do
    test "execute materializes the unified provider execution stream" do
      assert {:ok,
              %{
                provider_run: provider_run,
                events: events,
                output: output,
                result: result
              }} =
               Gateway.execute(op_ir("hello novel"), nil, %InferenceParams{},
                 purpose: :writer,
                 provider_call_ref: "pcall_gateway_test",
                 owner_refs: %{"run_ref" => "run_gateway_test", "step_ref" => "step_gateway_test"}
               )

      assert provider_run.execution_mode == :event_stream
      assert provider_run.status == :completed
      assert provider_run.purpose == :writer
      assert provider_run.provider_call_ref == "pcall_gateway_test"
      assert provider_run.owner_refs["run_ref"] == "run_gateway_test"

      started_event = Enum.find(events, &(&1.event_type == :started))
      chunk_event = Enum.find(events, &(&1.event_type == :chunk))
      final_event = Enum.find(events, &(&1.event_type == :final_output))

      progress_phases =
        events
        |> Enum.filter(&(&1.event_type == :progress))
        |> Enum.map(& &1.payload[:phase])

      assert started_event
      assert final_event
      assert progress_phases == [:request_prepared, :request_dispatched, :response_received]
      assert ProviderEvent.author_safe?(started_event)
      assert ProviderEvent.author_safe?(chunk_event)
      assert chunk_event.payload[:chunk_index] == 1
      assert is_integer(chunk_event.payload[:content_length])
      assert is_integer(chunk_event.payload[:accumulated_content_length])
      refute Map.has_key?(chunk_event.payload, :text_delta)
      assert final_event.visibility == :developer

      assert output.status == :ok
      assert output.provider_run_ref == provider_run.provider_run_id
      assert output.provider_call_ref == "pcall_gateway_test"
      assert output.content.text == result.content
      assert result.content != ""
      refute result.content =~ "[stub]"
    end

    test "execute materializes provider failures without using fallback event types" do
      assert {:error,
              %{
                provider_run: provider_run,
                events: events,
                output: output,
                error: error
              }} =
               Gateway.execute(op_ir("hello novel"), nil, %InferenceParams{},
                 provider: :missing_provider,
                 provider_call_ref: "pcall_gateway_error"
               )

      assert provider_run.execution_mode == :event_stream
      assert provider_run.status == :failed
      started_event = Enum.find(events, &(&1.event_type == :started))
      error_event = Enum.find(events, &(&1.event_type == :error))
      assert started_event.event_type == :started
      assert error_event.event_type == :error
      refute error_event.event_type in [:streaming_unsupported, :fallback]

      assert output.status == :error
      assert output.output_type == :empty
      assert output.provider_call_ref == "pcall_gateway_error"
      assert error.type == :provider_internal
    end

    test "execute uses adapter execute/5 as the provider execution boundary when available" do
      Application.put_env(:novel_agent, :extra_providers,
        execute_only: __MODULE__.ExecuteOnlyProvider,
        slice_verify: NovelAgent.Test.Provider.SliceVerify
      )

      assert {:ok,
              %{
                provider_run: provider_run,
                events: events,
                output: output,
                result: result
              }} =
               Gateway.execute(op_ir("adapter boundary"), nil, %InferenceParams{},
                 provider: :execute_only,
                 purpose: :tool,
                 provider_call_ref: "pcall_execute_only"
               )

      assert result.content == "adapter execute: adapter boundary"
      assert provider_run.execution_mode == :event_stream
      assert provider_run.status == :completed
      assert provider_run.provider_id == "execute_only"
      assert provider_run.purpose == :tool

      started_event = Enum.find(events, &(&1.event_type == :started))
      final_event = Enum.find(events, &(&1.event_type == :final_output))

      assert started_event.event_type == :started
      assert ProviderEvent.author_safe?(started_event)
      assert final_event.event_type == :final_output
      assert final_event.visibility == :developer

      assert output.status == :ok
      assert output.provider_call_ref == "pcall_execute_only"
      assert output.content.text == result.content
    end

    test "returns echo content from stub" do
      assert {:ok, %{content: content}} = Gateway.complete(op_ir("hello novel"))
      assert content =~ "hello novel"
      refute content =~ "[stub]"
    end

    test "emits provider and model audit logs without prompt or secrets" do
      old_enabled = Application.get_env(:novel_telemetry, :log_jsonl_enabled)
      old_dir = Application.get_env(:novel_telemetry, :log_jsonl_dir)

      log_dir =
        Path.join(System.tmp_dir!(), "novel-provider-log-#{System.unique_integer([:positive])}")

      Application.put_env(:novel_telemetry, :log_jsonl_enabled, true)
      Application.put_env(:novel_telemetry, :log_jsonl_dir, log_dir)

      try do
        prompt = "hello novel secret-marker"

        assert {:ok, %{content: content}} = Gateway.complete(op_ir(prompt))
        assert content != ""
        refute content =~ "[stub]"

        records = eventually_read_provider_records(log_dir)
        start_record = Enum.find(records, &(&1["event"] == "provider_gateway.complete.start"))
        done_record = Enum.find(records, &(&1["event"] == "provider_gateway.complete.done"))

        assert start_record["provider"] == "stub"
        # M5 排查修（2026-08-25）：未声明模型时诚实记 "unconfigured"，
        # 不再回落陈腐硬编码模型名（日志谎报曾直接误导狗粮排查）。
        assert start_record["model"] == "unconfigured"
        assert done_record["provider"] == "stub"
        assert done_record["model"] == "unconfigured"
        assert is_integer(done_record["duration_ms"])

        encoded = Jason.encode!(records)
        refute encoded =~ prompt
        refute encoded =~ "secret-marker"
      after
        restore_common_env(:log_jsonl_enabled, old_enabled)
        restore_common_env(:log_jsonl_dir, old_dir)
        File.rm_rf(log_dir)
      end
    end

    test "works with empty prompt" do
      assert {:ok, %{content: content}} = Gateway.complete(op_ir(""))
      assert content != ""
      refute content =~ "[stub]"
    end

    test "stub creative items preserve nonce without leaking prompt headings" do
      prompt = """
      你是创作助手。请严格按 JSON 数组格式返回多个候选条目，不要附加任何额外文字。

      capability：prose_writing
      artifact_type：prose_fragment
      用户创作简述：请生成第01章：底层灵气账单正文草稿
      上下文：## 当前作品上下文
      - id: 8cde8315-0208-4308-8422-6a1a75a1234d

      重要：如果用户输入或上下文中出现任意随机标识符串（字母数字组合），
      必须在至少一个条目的 title/body/rationale 中原样保留。

      只返回 JSON 数组。
      """

      assert {:ok, %{content: content}} = Gateway.complete(op_ir(prompt))
      assert {:ok, [item]} = Jason.decode(content)
      assert item["body"] =~ "8cde8315"
      assert item["body"] =~ "灵气账单"
      refute item["body"] =~ "## 当前作品上下文"
      refute item["body"] =~ "用户创作简述"
    end

    test "stub character_seed returns a role dossier instead of prose-shaped filler" do
      prompt = """
      你是小说角色设计助手。请严格按 JSON 数组格式返回多个候选条目，不要附加任何额外文字。

      capability：character_design
      artifact_type：character_seed
      用户创作简述：请设计一个稽查官 CHAR9X7
      上下文：## 现有角色
      - 白露：黑市掮客

      重要：如果用户输入或上下文中出现任意随机标识符串（字母数字组合），
      必须在至少一个条目的 title/body/rationale 中原样保留。

      只返回 JSON 数组。
      """

      assert {:ok, %{content: content}} = Gateway.complete(op_ir(prompt))
      assert {:ok, [item]} = Jason.decode(content)
      assert item["title"] =~ "沈砚"
      assert item["body"] =~ "定位："
      assert item["body"] =~ "语言风格："
      assert item["body"] =~ "CHAR9X7"
      refute item["body"] =~ "夜色压在"
    end
  end

  describe "complete/2 with deepseek provider" do
    test "routes through the configured DeepSeek adapter" do
      old_provider = Application.get_env(:novel_agent, :provider)
      old_deepseek = Application.get_env(:novel_agent, NovelAgent.Provider.DeepSeek)
      test_pid = self()

      mock = fn _url, body, _opts, on_data ->
        send(test_pid, {:deepseek_body, body})

        on_data.(sse_delta("deepseek ", "deepseek-v4-flash"))
        on_data.(sse_delta("ok", "deepseek-v4-flash", %{}))

        on_data.("data: [DONE]\n\n")

        {:ok, 200, ""}
      end

      Application.put_env(:novel_agent, :provider, default: :deepseek)

      Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek,
        api_key: "key",
        endpoint: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        timeout: 100,
        eventsource_fn: mock,
        log_fn: nil
      )

      try do
        assert {:ok, %{content: "deepseek ok"}} = Gateway.complete(op_ir("hello"))
        assert_receive {:deepseek_body, body}
        assert body.model == "deepseek-v4-flash"
        assert body.stream == true

        # 身份前缀由唯一真源生成，作者原话保持独立 user 消息、字节不变。
        assert [
                 %{role: "system", content: system_content},
                 %{role: "user", content: "hello"}
               ] = body.messages

        assert String.starts_with?(system_content, SystemIdentity.content())
      after
        Application.put_env(:novel_agent, :provider, old_provider)
        Application.put_env(:novel_agent, NovelAgent.Provider.DeepSeek, old_deepseek)
      end
    end
  end

  describe "complete/2 with slice verify provider" do
    test "returns planner-compatible frame JSON" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      try do
        assert {:ok, %{content: content}} = Gateway.complete(op_ir("分析用户消息并返回 JSON"))
        assert {:ok, parsed} = Jason.decode(content)
        assert parsed["frame_type"] == "casual_reply"
        assert is_binary(parsed["assistant_message"])
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end

    test "classifies ordinary chat from author input instead of prompt instructions" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      prompt = """
      你是一个小说创作 AI。分析用户消息并返回 JSON。

      ## 输出格式（严格 JSON）
      {"candidate_directions": [{"title": "方向标题"}]}

      ## 规则
      - frame_type == "creative_exploration" 时，candidate_directions 必须包含 2-3 个方向对象

      用户消息：你好，先介绍一下你能如何协助我
      """

      try do
        assert {:ok, %{content: content}} = Gateway.complete(op_ir(prompt))
        assert {:ok, parsed} = Jason.decode(content)
        assert parsed["frame_type"] == "casual_reply"
        assert parsed["candidate_directions"] == []
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end

    test "keeps exploration candidates when the author asks for directions" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      prompt = """
      你是一个小说创作 AI。分析用户消息并返回 JSON。

      ## 输出格式（严格 JSON）
      {"candidate_directions": [{"title": "方向标题"}]}

      ## 规则
      - frame_type == "creative_exploration" 时，candidate_directions 必须包含 2-3 个方向对象

      用户消息：我想找一个赛博修仙方向
      """

      try do
        assert {:ok, %{content: content}} = Gateway.complete(op_ir(prompt))
        assert {:ok, parsed} = Jason.decode(content)
        assert parsed["frame_type"] == "creative_exploration"
        assert length(parsed["candidate_directions"]) == 2
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end

    test "classifies chat messages from the latest user message" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      messages = [
        %{role: "system", content: "candidate_directions 必须包含 2-3 个方向对象"},
        %{role: "user", content: "上一轮想找一个赛博修仙方向"},
        %{role: "assistant", content: "可以先给几个方向。"},
        %{role: "user", content: "你好，先介绍一下你能如何协助我"}
      ]

      try do
        assert {:ok, %{content: content}} = Gateway.complete(op_ir(messages))
        assert {:ok, parsed} = Jason.decode(content)
        assert parsed["frame_type"] == "casual_reply"
        assert parsed["candidate_directions"] == []
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end

    test "returns author-facing text for tool narration prompts" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      prompt = """
      ## 工具执行结果
      - 工具: character_design
      - 状态: succeeded

      ## 要求
      请用 1-2 句自然中文告诉作者你完成了什么。
      """

      try do
        assert {:ok, %{content: content}} = Gateway.complete(op_ir(prompt))
        assert content =~ "已生成角色设定草案"
        refute content =~ "\"frame_type\""
        refute content =~ "\"candidate_directions\""
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end

    test "returns product-shaped creative items without leaking prompt headings" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      prompt = """
      你是创作助手。请严格按 JSON 数组格式返回多个候选条目，不要附加任何额外文字。

      capability：prose_writing
      artifact_type：prose_fragment
      用户创作简述：请根据已采纳章节计划生成第01章：底层灵气账单正文草稿
      上下文：## 当前作品上下文
      - id: 8cde8315-0208-4308-8422-6a1a75a1234d
      - title: P1 单章正文草稿验证作品

      重要：如果用户输入或上下文中出现任意随机标识符串（字母数字组合），
      必须在至少一个条目的 title/body/rationale 中原样保留。

      只返回 JSON 数组。
      """

      try do
        assert {:ok, %{content: content}} = Gateway.complete(op_ir(prompt))
        assert {:ok, %{"items" => [item], "self_report" => self_report}} = Jason.decode(content)
        assert item["title"] =~ "底层灵气账单"
        assert item["body"] =~ "灵气账单"
        assert item["body"] =~ "8cde8315"
        refute item["body"] =~ "## 当前作品上下文"
        refute item["body"] =~ "用户创作简述"
        refute item["title"] =~ "候选内容"
        assert "reader_effect_brief" in self_report["used_context_refs"]
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end
  end

  describe "execution log scope" do
    setup do
      old_dir = Application.get_env(:novel_telemetry, :llm_log_dir)
      dir = Path.join(System.tmp_dir!(), "novel-llm-scope-#{System.unique_integer([:positive])}")
      Application.put_env(:novel_telemetry, :llm_log_dir, dir)
      Logger.reset_metadata([])

      on_exit(fn ->
        Logger.reset_metadata([])
        restore_common_env(:llm_log_dir, old_dir)
        File.rm_rf!(dir)
      end)

      %{dir: dir}
    end

    test "success log carries the same refs as ProviderRun and Result", %{dir: dir} do
      # R2：工具调用走 SSE 流式传输，日志记录来自真实流式请求/响应。
      eventsource = fn _url, _body, _opts, on_data ->
        on_data.(
          sse_delta("HTTP 替身成功正文", "stand-in-model", %{
            "prompt_tokens" => 3,
            "completion_tokens" => 4
          })
        )

        on_data.("data: [DONE]\n\n")
        {:ok, 200, ""}
      end

      RuntimeConfig.put_provider_config(:strata,
        eventsource_fn: eventsource,
        model: "stand-in-model",
        endpoint: "http://stand-in.test/v1"
      )

      assert {:ok, %{provider_run: run, output: output}} =
               Gateway.execute(tool_ir(), nil, %InferenceParams{},
                 provider: :strata,
                 provider_call_ref: "pcall-log-success",
                 provider_run_id: "prun-log-success"
               )

      assert run.provider_call_ref == "pcall-log-success"
      assert run.provider_run_id == "prun-log-success"
      assert output.provider_call_ref == "pcall-log-success"
      assert output.provider_run_ref == "prun-log-success"

      [record] = read_llm_records(dir)

      assert record["provider"] == "strata"
      assert record["provider_call_ref"] == "pcall-log-success"
      assert record["provider_run_ref"] == "prun-log-success"
      assert record["response"]["status"] == 200
      assert record["request"]["body"]["messages"] != []
      refute Map.has_key?(record["request"], "headers")
      refute Jason.encode!(record) =~ "authorization"

      refute Keyword.has_key?(Logger.metadata(), :provider_call_ref)
      refute Keyword.has_key?(Logger.metadata(), :provider_run_ref)
    end

    test "error log carries the same refs as the failed ProviderRun", %{dir: dir} do
      eventsource = fn _url, _body, _opts, _on_data ->
        {:error, :http_error, 503, "stand-in upstream failed"}
      end

      RuntimeConfig.put_provider_config(:strata,
        eventsource_fn: eventsource,
        model: "stand-in-model",
        endpoint: "http://stand-in.test/v1"
      )

      assert {:error, %{provider_run: run, output: output, error: error}} =
               Gateway.execute(tool_ir(), nil, %InferenceParams{},
                 provider: :strata,
                 provider_call_ref: "pcall-log-error",
                 provider_run_id: "prun-log-error"
               )

      assert error.type == :provider_internal
      assert run.provider_call_ref == "pcall-log-error"
      assert run.provider_run_id == "prun-log-error"
      assert run.status == :failed
      assert output.provider_call_ref == "pcall-log-error"
      assert output.provider_run_ref == "prun-log-error"

      [record] = read_llm_records(dir)

      assert record["provider_call_ref"] == "pcall-log-error"
      assert record["provider_run_ref"] == "prun-log-error"
      assert record["response"]["status"] == 503
      refute record["response"]["status"] == 200

      refute Keyword.has_key?(Logger.metadata(), :provider_call_ref)
      refute Keyword.has_key?(Logger.metadata(), :provider_run_ref)
    end

    defp tool_ir do
      TestRequestIR.ir([TestRequestIR.author("读取当前作品。")],
        tools: [TestRequestIR.tool("read_work")],
        projection: %{tool_choice: "read_work"}
      )
    end

    defp read_llm_records(dir) do
      path = Path.join(dir, "#{NovelTelemetry.LogFileDate.today_iso8601()}.jsonl")

      path
      |> File.read!()
      |> String.split("\n", trim: true)
      |> Enum.map(fn line ->
        [_prefix, json] = String.split(line, "] ", parts: 2)
        Jason.decode!(json)
      end)
    end
  end

  describe "complete error handling" do
    test "returns error map for unknown providers" do
      # Temporarily override provider config to trigger unknown provider path.
      # Restore after test to not affect other tests.
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :nonexistent)

      result = Gateway.complete(op_ir("test"))
      assert {:error, error} = result
      assert is_map(error)
      assert error.type == :provider_internal

      Application.put_env(:novel_agent, :provider, old)
    end
  end

  defp eventually_read_provider_records(log_dir, attempts \\ 40)

  defp eventually_read_provider_records(log_dir, 0) do
    records = read_records_if_present(log_dir)

    flunk(
      "timed out waiting for provider gateway JSONL events; got #{inspect(Enum.map(records, & &1["event"]))}"
    )
  end

  defp eventually_read_provider_records(log_dir, attempts) do
    records = read_records_if_present(log_dir)

    if provider_gateway_events_present?(records) do
      records
    else
      Process.sleep(25)
      eventually_read_provider_records(log_dir, attempts - 1)
    end
  end

  defp provider_gateway_events_present?(records) do
    Enum.any?(records, &(&1["event"] == "provider_gateway.complete.start")) and
      Enum.any?(records, &(&1["event"] == "provider_gateway.complete.done"))
  end

  defp read_records_if_present(log_dir) do
    path = Path.join(log_dir, "#{NovelTelemetry.LogFileDate.today_iso8601()}.jsonl")

    if File.exists?(path) do
      path
      |> File.read!()
      |> String.split("\n", trim: true)
      |> Enum.map(&Jason.decode!/1)
    else
      []
    end
  end

  defp restore_common_env(key, nil), do: Application.delete_env(:novel_common, key)
  defp restore_common_env(key, value), do: Application.put_env(:novel_common, key, value)

  # B71 R2：工具调用也走 SSE 流式传输；路由测试在 eventsource mock 中捕获真实
  # body（body.model 由 route 派发决定），并返回最小合法 Chat SSE 帧。
  defp capture_strata_wire(config) do
    recipient = self()

    eventsource = fn _url, body, _opts, on_data ->
      send(recipient, {:routing_wire_body, body})
      model = Map.get(body, :model, "server-selected-model")
      on_data.(sse_delta("路由探针已完成。", model))
      on_data.("data: [DONE]\n\n")
      {:ok, 200, ""}
    end

    RuntimeConfig.put_provider_config(:strata, Keyword.put(config, :eventsource_fn, eventsource))
  end

  defp routing_tool_ir do
    TestRequestIR.ir([TestRequestIR.author("读取当前作品。")],
      tools: [TestRequestIR.tool("read_work")],
      projection: %{tool_choice: "auto"}
    )
  end

  defp sse_delta(content, model, usage \\ nil) do
    payload =
      %{
        "choices" => [%{"delta" => %{"content" => content}}],
        "model" => model
      }
      |> maybe_put_usage(usage)

    "data: #{Jason.encode!(payload)}\n\n"
  end

  defp maybe_put_usage(payload, nil), do: payload
  defp maybe_put_usage(payload, usage), do: Map.put(payload, "usage", usage)
end
