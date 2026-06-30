defmodule NovelAgent.Provider.OpenAICompatibleTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
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

      assert Gemini.from_config().endpoint ==
               "https://generativelanguage.googleapis.com/v1beta/openai"
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

      state = %{
        state
        | http_fn: fn _url, _body, _opts -> {:error, :http_error, 429, "Too Many"} end
      }

      assert {:error, %{type: :rate_limit, retryable: true}} =
               Zhipu.complete(state, nil, "prompt", %InferenceParams{})
    end
  end

  describe "execute/5" do
    test "streams OpenAI-compatible SSE chunks through provider execution facts" do
      test_pid = self()

      eventsource = fn url, body, opts, on_data ->
        send(test_pid, {:stream_request, url, body, opts})

        on_data.(sse_delta("你", "gpt-4o-mini"))

        split_frame =
          sse_delta("好", "gpt-4o-mini", %{
            "prompt_tokens" => 5,
            "completion_tokens" => 2
          })

        {first_half, second_half} = String.split_at(split_frame, div(byte_size(split_frame), 2))
        on_data.(first_half)
        on_data.(second_half)

        on_data.("data: [DONE]\n\n")

        {:ok, 200, ""}
      end

      state = %OpenAI{
        api_key: "sk-secret",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }

      assert {:ok, %{events: events, result: result, output: output}} =
               OpenAI.execute(state, nil, "prompt", %InferenceParams{}, provider_ctx(:openai))

      assert result.content == "你好"
      assert result.usage.input_tokens == 5
      assert result.usage.output_tokens == 2
      assert output.content.text == "你好"

      assert_receive {:stream_request, url, body, opts}
      assert url == "https://api.openai.com/v1/chat/completions"
      assert body.stream == true
      assert body.messages == [%{role: "user", content: "prompt"}]
      assert {"authorization", "Bearer sk-secret"} in Keyword.fetch!(opts, :headers)

      chunk_events = Enum.filter(events, &(&1.event_type == :chunk))
      assert length(chunk_events) == 2
      assert Enum.map(chunk_events, & &1.payload[:content_length]) == [1, 1]
      assert Enum.map(chunk_events, & &1.payload[:accumulated_content_length]) == [1, 2]
      refute Enum.any?(chunk_events, &Map.has_key?(&1.payload, :text_delta))
      refute Enum.any?(chunk_events, &Map.has_key?(&1.payload, :content))
    end

    test "returns auth error before opening an event stream when API key is missing" do
      eventsource = fn _url, _body, _opts, _on_data ->
        send(self(), :unexpected_eventsource)
        {:ok, 200, ""}
      end

      state = %OpenAI{
        api_key: nil,
        endpoint: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }

      assert {:error, %{error: %{type: :auth}, events: events}} =
               OpenAI.execute(state, nil, "prompt", %InferenceParams{}, provider_ctx(:openai))

      assert Enum.map(events, & &1.event_type) == [:started, :error]
      refute_received :unexpected_eventsource
    end

    test "halts stream consumption when provider execution token is cancelled" do
      test_pid = self()
      {:ok, token} = Execution.start_cancellation_token(%{run_id: "run_openai_cancel_test"})

      eventsource = fn _url, _body, _opts, on_data ->
        assert :cont == on_data.(sse_delta("先", "gpt-4o-mini"))
        send(test_pid, :first_chunk_consumed)
        assert :ok = Execution.cancel(token, :author_cancelled)
        assert :halt == on_data.(sse_delta("后", "gpt-4o-mini"))
        {:ok, 200, ""}
      end

      state = %OpenAI{
        api_key: "sk-secret",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }

      ctx =
        :openai
        |> provider_ctx()
        |> Map.put(:cancellation_token, token)

      assert {:error, %{events: events, output: output, provider_run: run, error: error}} =
               OpenAI.execute(state, nil, "prompt", %InferenceParams{}, ctx)

      assert_receive :first_chunk_consumed
      assert run.status == :cancelled
      assert output.status == :cancelled
      assert output.output_type == :empty
      assert error.type == :cancelled

      event_types = Enum.map(events, & &1.event_type)

      assert event_types == [
               :started,
               :progress,
               :progress,
               :chunk,
               :cancel_requested,
               :cancelled
             ]

      refute :final_output in event_types
      assert length(Enum.filter(events, &(&1.event_type == :chunk))) == 1
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

  defp provider_ctx(provider) do
    %{
      provider_name: provider,
      model_name: "gpt-4o-mini",
      provider_call_ref: "pcall_openai_compatible_test",
      provider_run_id: "prun_openai_compatible_test",
      purpose: :conversation,
      owner_refs: %{}
    }
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
