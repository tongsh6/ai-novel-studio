defmodule NovelAgent.Provider.DeepSeekTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.DeepSeek
  alias NovelAgent.Provider.InferenceParams

  describe "name/0" do
    test "returns deepseek identifier" do
      assert DeepSeek.name() == "deepseek"
    end
  end

  describe "from_config/0" do
    test "returns struct with defaults" do
      state = DeepSeek.from_config()

      assert %DeepSeek{} = state
      assert state.endpoint == "https://api.deepseek.com"
      assert state.model == "deepseek-v4-flash"
      assert state.timeout == 300_000
      assert state.thinking == :disabled
    end
  end

  describe "health_check/1" do
    test "checks API key configuration without calling the model" do
      assert DeepSeek.health_check(%DeepSeek{api_key: "key"}) == :ok

      assert {:error, %{type: :unauthorized}} = DeepSeek.health_check(%DeepSeek{api_key: nil})
    end
  end

  describe "complete/4" do
    test "sends OpenAI-compatible chat completion request" do
      test_pid = self()

      mock = fn url, body, opts ->
        send(test_pid, {:request, url, body, opts})

        {:ok, 200,
         %{
           "choices" => [%{"message" => %{"content" => "完成"}}],
           "model" => "deepseek-v4-flash",
           "usage" => %{"prompt_tokens" => 11, "completion_tokens" => 7}
         }}
      end

      state = %DeepSeek{
        api_key: "secret",
        endpoint: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        timeout: 100,
        http_fn: mock,
        log_fn: nil,
        thinking: :disabled
      }

      assert {:ok, result} = DeepSeek.complete(state, nil, "prompt", %InferenceParams{})
      assert result.content == "完成"
      assert result.usage.input_tokens == 11
      assert result.usage.output_tokens == 7
      assert result.usage.model == "deepseek-v4-flash"

      assert_receive {:request, url, body, opts}
      assert url == "https://api.deepseek.com/chat/completions"
      assert body.model == "deepseek-v4-flash"
      assert body.messages == [%{role: "user", content: "prompt"}]
      assert body.stream == false
      assert body.thinking == %{type: "disabled"}
      assert {"authorization", "Bearer secret"} in Keyword.fetch!(opts, :headers)
    end

    test "can enable thinking mode explicitly" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:request_body, body})

        {:ok, 200,
         %{
           "choices" => [%{"message" => %{"content" => "完成"}}],
           "usage" => %{}
         }}
      end

      state = %DeepSeek{
        api_key: "secret",
        endpoint: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        timeout: 100,
        http_fn: mock,
        log_fn: nil,
        thinking: :enabled,
        reasoning_effort: "high"
      }

      assert {:ok, _result} = DeepSeek.complete(state, nil, "prompt", %InferenceParams{})
      assert_receive {:request_body, body}
      assert body.thinking == %{type: "enabled"}
      assert body.reasoning_effort == "high"
    end

    test "forced tool_choice request downgrades thinking to disabled (DeepSeek capability constraint)" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:request_body, body})

        {:ok, 200,
         %{
           "choices" => [
             %{
               "message" => %{
                 "content" => "计划推理",
                 "tool_calls" => [
                   %{
                     "id" => "t1",
                     "function" => %{"name" => "agent_plan_draft", "arguments" => "{}"}
                   }
                 ]
               }
             }
           ],
           "usage" => %{}
         }}
      end

      state = %DeepSeek{
        api_key: "secret",
        endpoint: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        timeout: 100,
        http_fn: mock,
        log_fn: nil,
        thinking: :enabled,
        reasoning_effort: "high"
      }

      prompt = %{
        messages: [%{role: "user", content: "起草计划"}],
        tools: [
          %{name: "agent_plan_draft", description: "draft", input_schema: %{type: "object"}}
        ],
        tool_choice: "agent_plan_draft"
      }

      assert {:ok, _result} = DeepSeek.complete(state, nil, prompt, %InferenceParams{})
      assert_receive {:request_body, body}

      # thinking 模式不支持强制具名 tool_choice（HTTP 400），该请求必须整形为 disabled
      assert body.thinking == %{type: "disabled"}
      refute Map.has_key?(body, :reasoning_effort)
      assert body.tool_choice == %{type: "function", function: %{name: "agent_plan_draft"}}
    end

    test "returns auth error before HTTP when API key is missing" do
      mock = fn _url, _body, _opts ->
        send(self(), :unexpected_http)
        {:ok, 200, %{}}
      end

      state = %DeepSeek{
        api_key: nil,
        endpoint: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      assert {:error, error} = DeepSeek.complete(state, nil, "prompt", %InferenceParams{})
      assert error.type == :auth
      refute_received :unexpected_http
    end

    test "maps auth and rate limit HTTP errors" do
      auth_mock = fn _url, _body, _opts -> {:error, :http_error, 401, "Unauthorized"} end

      state = %DeepSeek{
        api_key: "secret",
        endpoint: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        timeout: 100,
        http_fn: auth_mock,
        log_fn: nil,
        thinking: :disabled
      }

      assert {:error, auth_error} = DeepSeek.complete(state, nil, "prompt", %InferenceParams{})
      assert auth_error.type == :auth

      rate_limit_mock = fn _url, _body, _opts -> {:error, :http_error, 429, "Too Many"} end
      state = %{state | http_fn: rate_limit_mock}

      assert {:error, rate_limit_error} =
               DeepSeek.complete(state, nil, "prompt", %InferenceParams{})

      assert rate_limit_error.type == :rate_limit
      assert rate_limit_error.retryable == true
    end

    test "maps HTTP 400 invalid request to :invalid_request (not empty response)" do
      # DeepSeek 因非法参数（如 reasoning_effort=0.7）返回 400，必须区分于上游空响应
      bad_request_mock = fn _url, _body, _opts ->
        {:error, :http_error, 400,
         "invalid_request_error: reasoning_effort: unknown variant `0.7`"}
      end

      state = %DeepSeek{
        api_key: "secret",
        endpoint: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        timeout: 100,
        http_fn: bad_request_mock,
        log_fn: nil,
        thinking: :enabled,
        reasoning_effort: "0.7"
      }

      assert {:error, error} = DeepSeek.complete(state, nil, "prompt", %InferenceParams{})
      assert error.type == :invalid_request
      assert error.retryable == false
    end
  end

  describe "execute/5" do
    test "streams DeepSeek chunks and keeps thinking request fields" do
      test_pid = self()

      eventsource = fn url, body, opts, on_data ->
        send(test_pid, {:stream_request, url, body, opts})

        on_data.(sse_delta("深", "deepseek-v4-pro"))

        on_data.(
          sse_delta("思", "deepseek-v4-pro", %{
            "prompt_tokens" => 8,
            "completion_tokens" => 2
          })
        )

        on_data.("data: [DONE]\n\n")

        {:ok, 200, ""}
      end

      state = %DeepSeek{
        api_key: "secret",
        endpoint: "https://api.deepseek.com",
        model: "deepseek-v4-pro",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil,
        thinking: :enabled,
        reasoning_effort: "high"
      }

      assert {:ok, %{events: events, result: result}} =
               DeepSeek.execute(state, nil, "prompt", %InferenceParams{}, provider_ctx())

      assert result.content == "深思"
      assert result.usage.input_tokens == 8
      assert result.usage.output_tokens == 2

      assert_receive {:stream_request, url, body, opts}
      assert url == "https://api.deepseek.com/chat/completions"
      assert body.stream == true
      assert body.thinking == %{type: "enabled"}
      assert body.reasoning_effort == "high"
      assert {"authorization", "Bearer secret"} in Keyword.fetch!(opts, :headers)

      chunk_events = Enum.filter(events, &(&1.event_type == :chunk))
      assert length(chunk_events) == 2
      refute Enum.any?(chunk_events, &Map.has_key?(&1.payload, :text_delta))
    end
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(DeepSeek, :complete, 4)
      assert function_exported?(DeepSeek, :execute, 5)
      assert function_exported?(DeepSeek, :name, 0)
      assert function_exported?(DeepSeek, :from_config, 0)
    end
  end

  defp provider_ctx do
    %{
      provider_name: :deepseek,
      model_name: "deepseek-v4-pro",
      provider_call_ref: "pcall_deepseek_stream_test",
      provider_run_id: "prun_deepseek_stream_test",
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
