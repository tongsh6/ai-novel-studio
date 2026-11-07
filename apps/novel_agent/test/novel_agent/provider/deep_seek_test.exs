defmodule NovelAgent.Provider.DeepSeekTest do
  use ExUnit.Case, async: false

  alias NovelTest.TestRequestIR

  # adapter 只接受 canonical IR；测试用作者原话构造最小请求，文字保持原字节。
  defp ir(%NovelCommon.RequestIR{} = ir), do: ir
  defp ir(text) when is_binary(text), do: TestRequestIR.ir([TestRequestIR.author(text)])

  defp ir(messages) when is_list(messages),
    do: TestRequestIR.ir(Enum.map(messages, &canonical_message/1))

  defp canonical_message(%{role: "system", content: content}), do: TestRequestIR.system(content)

  defp canonical_message(%{role: "assistant", content: content}),
    do: TestRequestIR.assistant(content)

  defp canonical_message(%{role: "user", content: content}), do: TestRequestIR.author(content)

  alias NovelAgent.Provider.DeepSeek
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.OpenAI
  alias NovelCommon.RequestIR

  describe "name/0" do
    test "returns deepseek identifier" do
      assert DeepSeek.name() == "deepseek"
    end
  end

  test "私有推理从真实响应保留并只向同一 provider/model 回投，作者输出不携带它" do
    private_text = "仅供协议回放的私有状态\n  保留空白。"

    response = %{
      "choices" => [
        %{
          "message" => %{
            "content" => "先读角色。",
            "reasoning_content" => private_text,
            "tool_calls" => [
              %{
                "id" => "private-call",
                "function" => %{"name" => "read_character", "arguments" => "{}"}
              }
            ]
          }
        }
      ],
      "usage" => %{}
    }

    parent = self()

    http = fn _, body, _ ->
      send(parent, {:private_wire, body})
      {:ok, 200, response}
    end

    # R2：execute/5 走 SSE 流式传输；私有 reasoning 作为流内私有增量由 adapter
    # 绑定 provider_state。complete/4 仍保留 final-only 非流式路径（http mock）。
    eventsource = fn _url, body, _opts, on_data ->
      send(parent, {:private_wire, body})

      on_data.(
        "data: " <>
          Jason.encode!(%{
            "choices" => [%{"delta" => %{"reasoning_content" => private_text}}],
            "model" => "fixture-model"
          }) <> "\n\n"
      )

      on_data.(
        "data: " <>
          Jason.encode!(%{
            "choices" => [%{"delta" => %{"content" => "先读角色。"}}],
            "model" => "fixture-model"
          }) <> "\n\n"
      )

      on_data.("data: [DONE]\n\n")
      {:ok, 200, ""}
    end

    state = %DeepSeek{
      api_key: "test",
      endpoint: "https://example.invalid/v1",
      model: "fixture-model",
      timeout: 100,
      http_fn: http,
      eventsource_fn: eventsource,
      log_fn: nil,
      thinking: :enabled
    }

    assert {:ok, result} = DeepSeek.complete(state, nil, ir("读取角色"), %InferenceParams{})
    assert_receive {:private_wire, _initial}

    private_state = %{
      "provider" => "deepseek",
      "model" => "fixture-model",
      "payload" => %{"reasoning_content" => private_text}
    }

    assert Map.get(result, :provider_state) == private_state

    ir =
      RequestIR.new(%{
        run: %{run_id: "private-replay"},
        system: RequestIR.system_envelope(),
        projection: %{},
        tools: [%{name: "read_character", input_schema: %{type: "object"}}],
        messages: [RequestIR.message(:user, :author, [RequestIR.text_block("读取角色")])]
      })

    {ir, _} = RequestIR.append_assistant_result(ir, result)
    ir = RequestIR.append_validation_result(ir, "private-call", "passed", "read_complete")
    assert {:ok, prepared} = RequestIR.prepare_request(ir)

    assert {:ok, execution} =
             DeepSeek.execute(state, nil, ir(prepared), %InferenceParams{}, provider_ctx())

    assert_receive {:private_wire, replay}
    assistant = Enum.find(replay.messages, &(&1.role == "assistant"))
    assert assistant.reasoning_content == private_text
    refute Map.has_key?(assistant, :provider_state)
    assert execution.result.provider_state == private_state
    refute inspect(execution.output) =~ private_text
    refute inspect(execution.events) =~ private_text

    other = %OpenAI{
      api_key: "test",
      endpoint: "https://example.invalid/v1",
      model: "fixture-model",
      timeout: 100,
      http_fn: http,
      log_fn: nil
    }

    assert {:ok, _} = OpenAI.complete(other, nil, prepared, %InferenceParams{})
    assert_receive {:private_wire, other_wire}
    refute inspect(other_wire) =~ private_text
    refute inspect(other_wire) =~ "provider_state"

    assert {:ok, _} =
             DeepSeek.complete(
               %{state | model: "another-model"},
               nil,
               prepared,
               %InferenceParams{}
             )

    assert_receive {:private_wire, changed_model_wire}
    refute inspect(changed_model_wire) =~ private_text
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

      assert {:ok, result} = DeepSeek.complete(state, nil, ir("prompt"), %InferenceParams{})
      assert result.content == "完成"
      assert result.usage.input_tokens == 11
      assert result.usage.output_tokens == 7
      assert result.usage.model == "deepseek-v4-flash"

      assert_receive {:request, url, body, opts}
      assert url == "https://api.deepseek.com/chat/completions"
      assert body.model == "deepseek-v4-flash"
      assert [%{role: "system"} | rest] = body.messages
      assert rest == [%{role: "user", content: "prompt"}]
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

      assert {:ok, _result} = DeepSeek.complete(state, nil, ir("prompt"), %InferenceParams{})
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

      prompt =
        TestRequestIR.ir(
          [TestRequestIR.author("起草计划")],
          tools: [TestRequestIR.tool("agent_plan_draft", %{type: "object"})],
          projection: %{tool_choice: "agent_plan_draft"}
        )

      assert {:ok, _result} = DeepSeek.complete(state, nil, ir(prompt), %InferenceParams{})
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

      assert {:error, error} = DeepSeek.complete(state, nil, ir("prompt"), %InferenceParams{})
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

      assert {:error, auth_error} =
               DeepSeek.complete(state, nil, ir("prompt"), %InferenceParams{})

      assert auth_error.type == :auth

      rate_limit_mock = fn _url, _body, _opts -> {:error, :http_error, 429, "Too Many"} end
      state = %{state | http_fn: rate_limit_mock}

      assert {:error, rate_limit_error} =
               DeepSeek.complete(state, nil, ir("prompt"), %InferenceParams{})

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

      assert {:error, error} = DeepSeek.complete(state, nil, ir("prompt"), %InferenceParams{})
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
               DeepSeek.execute(state, nil, ir("prompt"), %InferenceParams{}, provider_ctx())

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
