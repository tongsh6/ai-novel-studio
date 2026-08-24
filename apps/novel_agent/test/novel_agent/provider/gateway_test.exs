defmodule NovelAgent.Provider.GatewayTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.RuntimeConfig
  alias NovelCommon.Contracts.ProviderEvent

  defmodule ExecuteOnlyProvider do
    @behaviour NovelAgent.Provider

    alias NovelAgent.Provider.AdapterExecution
    alias NovelAgent.Provider.Result

    defstruct []

    @impl true
    def execute(_state, _model, prompt, _params, ctx) do
      AdapterExecution.materialize_result({:ok, Result.new("adapter execute: #{prompt}")}, ctx)
    end

    @impl true
    def complete(_state, _model, _prompt, _params) do
      raise "Gateway must enter provider execution through execute/5 when the adapter exports it"
    end

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def name, do: "execute_only_provider"
  end

  setup do
    old_extra = Application.get_env(:novel_agent, :extra_providers)
    RuntimeConfig.reset()

    Application.put_env(:novel_agent, :extra_providers,
      slice_verify: NovelAgent.Test.Provider.SliceVerify
    )

    on_exit(fn ->
      RuntimeConfig.reset()

      if old_extra do
        Application.put_env(:novel_agent, :extra_providers, old_extra)
      else
        Application.delete_env(:novel_agent, :extra_providers)
      end
    end)
  end

  describe "registered_providers/0" do
    test "returns known providers" do
      providers = Gateway.registered_providers()
      assert :stub in providers
      assert :slice_verify in providers
      assert :lmstudio in providers
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
        assert {:ok, %{content: "runtime deepseek"}} = Gateway.complete("hello")
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
               Gateway.execute("hello novel", nil, %InferenceParams{},
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
      assert result.content =~ "[stub]"
    end

    test "execute materializes provider failures without using fallback event types" do
      assert {:error,
              %{
                provider_run: provider_run,
                events: events,
                output: output,
                error: error
              }} =
               Gateway.execute("hello novel", nil, %InferenceParams{},
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
               Gateway.execute("adapter boundary", nil, %InferenceParams{},
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
      assert {:ok, %{content: content}} = Gateway.complete("hello novel")
      assert content =~ "[stub]"
      assert content =~ "hello novel"
    end

    test "emits provider and model audit logs without prompt or secrets" do
      old_enabled = Application.get_env(:novel_common, :log_jsonl_enabled)
      old_dir = Application.get_env(:novel_common, :log_jsonl_dir)

      log_dir =
        Path.join(System.tmp_dir!(), "novel-provider-log-#{System.unique_integer([:positive])}")

      Application.put_env(:novel_common, :log_jsonl_enabled, true)
      Application.put_env(:novel_common, :log_jsonl_dir, log_dir)

      try do
        prompt = "hello novel secret-marker"

        assert {:ok, %{content: content}} = Gateway.complete(prompt)
        assert content =~ "[stub]"

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
      assert {:ok, %{content: content}} = Gateway.complete("")
      assert content =~ "[stub]"
    end

    test "completes without error" do
      assert {:ok, _} = Gateway.complete("should use stub in test env")
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

      assert {:ok, %{content: content}} = Gateway.complete(prompt)
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

      assert {:ok, %{content: content}} = Gateway.complete(prompt)
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
        assert {:ok, %{content: "deepseek ok"}} = Gateway.complete("hello")
        assert_receive {:deepseek_body, body}
        assert body.model == "deepseek-v4-flash"
        assert body.stream == true
        assert body.messages == [%{role: "user", content: "hello"}]
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
        assert {:ok, %{content: content}} = Gateway.complete("分析用户消息并返回 JSON")
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
        assert {:ok, %{content: content}} = Gateway.complete(prompt)
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
        assert {:ok, %{content: content}} = Gateway.complete(prompt)
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
        assert {:ok, %{content: content}} = Gateway.complete(messages)
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
        assert {:ok, %{content: content}} = Gateway.complete(prompt)
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
        assert {:ok, %{content: content}} = Gateway.complete(prompt)
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

  describe "complete error handling" do
    test "returns error map for unknown providers" do
      # Temporarily override provider config to trigger unknown provider path.
      # Restore after test to not affect other tests.
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :nonexistent)

      result = Gateway.complete("test")
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
    path = Path.join(log_dir, "#{NovelCommon.LogFileDate.today_iso8601()}.jsonl")

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
