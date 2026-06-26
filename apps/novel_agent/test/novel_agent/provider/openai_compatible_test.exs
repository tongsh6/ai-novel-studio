defmodule NovelAgent.Provider.OpenAICompatibleTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Gemini
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Kimi
  alias NovelAgent.Provider.Minimax
  alias NovelAgent.Provider.MinimaxCN
  alias NovelAgent.Provider.OpenAI
  alias NovelAgent.Provider.OpenAISubscription
  alias NovelAgent.Provider.Zhipu

  describe "vendor identity and defaults" do
    test "each vendor reports its own name and OpenAI-compatible defaults" do
      assert OpenAI.name() == "openai"
      assert OpenAI.from_config().endpoint == "https://api.openai.com/v1"

      assert OpenAISubscription.name() == "openai_subscription"
      assert OpenAISubscription.from_config().endpoint == "https://api.openai.com/v1"

      assert Minimax.name() == "minimax"
      assert Minimax.from_config().endpoint == "https://api.minimax.io/v1"

      assert MinimaxCN.name() == "minimax_cn"
      assert MinimaxCN.from_config().endpoint == "https://api.minimaxi.com/v1"

      assert Zhipu.name() == "zhipu"
      assert Zhipu.from_config().endpoint == "https://open.bigmodel.cn/api/paas/v4"

      assert Kimi.name() == "kimi"
      assert Kimi.from_config().endpoint == "https://api.moonshot.cn/v1"

      assert Gemini.name() == "gemini"
      assert Gemini.from_config().endpoint == "https://generativelanguage.googleapis.com/v1beta/openai"
    end
  end

  describe "health_check/1" do
    test "is keyed on the configured API key, never calls the model" do
      assert OpenAI.health_check(%OpenAI{api_key: "sk-test"}) == :ok
      assert {:error, %{type: :unauthorized}} = OpenAI.health_check(%OpenAI{api_key: nil})

      assert OpenAISubscription.health_check(%OpenAISubscription{api_key: "tok"}) == :ok
    end
  end

  describe "complete/4" do
    test "sends OpenAI-compatible chat completion with Bearer auth" do
      test_pid = self()

      mock = fn url, body, opts ->
        send(test_pid, {:request, url, body, opts})

        {:ok, 200,
         %{
           "choices" => [%{"message" => %{"content" => "完成"}}],
           "model" => "gpt-4o-mini",
           "usage" => %{"prompt_tokens" => 5, "completion_tokens" => 3}
         }}
      end

      state = %OpenAI{
        api_key: "sk-secret",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      assert {:ok, result} = OpenAI.complete(state, nil, "prompt", %InferenceParams{})
      assert result.content == "完成"
      assert result.usage.input_tokens == 5

      assert_receive {:request, url, body, opts}
      assert url == "https://api.openai.com/v1/chat/completions"
      assert body.model == "gpt-4o-mini"
      assert body.messages == [%{role: "user", content: "prompt"}]
      assert body.stream == false
      # 非 thinking 供应商不发送 thinking 字段（OpenAI/Minimax/智谱/Kimi/Gemini）。
      refute Map.has_key?(body, :thinking)
      assert {"authorization", "Bearer sk-secret"} in Keyword.fetch!(opts, :headers)
    end

    test "returns auth error before HTTP when API key is missing" do
      mock = fn _url, _body, _opts ->
        send(self(), :unexpected_http)
        {:ok, 200, %{}}
      end

      state = %Minimax{
        api_key: nil,
        endpoint: "https://api.minimaxi.com/v1",
        model: "MiniMax-Text-01",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      assert {:error, error} = Minimax.complete(state, nil, "prompt", %InferenceParams{})
      assert error.type == :auth
      refute_received :unexpected_http
    end

    test "normalizes HTTP auth and rate-limit errors with vendor label" do
      state = %Zhipu{
        api_key: "key",
        endpoint: "https://open.bigmodel.cn/api/paas/v4",
        model: "glm-4",
        timeout: 100,
        http_fn: fn _url, _body, _opts -> {:error, :http_error, 401, "Unauthorized"} end,
        log_fn: nil
      }

      assert {:error, %{type: :auth, message: message}} =
               Zhipu.complete(state, nil, "prompt", %InferenceParams{})

      assert message =~ "智谱"

      state = %{state | http_fn: fn _url, _body, _opts -> {:error, :http_error, 429, "Too Many"} end}

      assert {:error, %{type: :rate_limit, retryable: true}} =
               Zhipu.complete(state, nil, "prompt", %InferenceParams{})
    end
  end

  describe "list_models/1" do
    test "parses OpenAI-compatible /models list and requires a key" do
      get = fn url, opts ->
        send(self(), {:models_request, url, opts})
        {:ok, 200, %{"data" => [%{"id" => "gpt-4o-mini", "owned_by" => "openai"}]}}
      end

      state = %OpenAI{
        api_key: "sk-secret",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        timeout: 100,
        get_fn: get
      }

      assert {:ok, [%{id: "gpt-4o-mini", owned_by: "openai"}]} = OpenAI.list_models(state)
      assert_receive {:models_request, "https://api.openai.com/v1/models", opts}
      assert {"authorization", "Bearer sk-secret"} in Keyword.fetch!(opts, :headers)

      assert {:error, %{type: :unauthorized}} = OpenAI.list_models(%OpenAI{api_key: nil})
    end
  end
end
