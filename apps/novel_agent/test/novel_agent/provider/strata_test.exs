defmodule NovelAgent.Provider.StrataTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Strata

  @endpoint "http://127.0.0.1:47831/v1"
  @model "iq3_s"

  describe "identity and defaults" do
    test "reports strata vendor identity and exposes the provider contract" do
      assert Strata.name() == "strata"
      assert function_exported?(Strata, :complete, 4)
      assert function_exported?(Strata, :execute, 5)
      assert function_exported?(Strata, :health_check, 1)
      assert function_exported?(Strata, :list_models, 1)
    end

    test "from_config/1 defaults to the unified Strata App endpoint and follows the app-managed model" do
      state = Strata.from_config([])

      assert %Strata{} = state
      assert state.endpoint == @endpoint

      # 统一后台由 Strata App 管理当前模型；未显式配置模型时不发 model 字段。
      assert state.model == nil
      assert state.timeout > 0
      assert state.max_tokens == 16_000
      # 默认关思考：thinking 归一为 :disabled，reasoning_effort 未配置。
      assert state.thinking == :disabled
      assert state.reasoning_effort == nil
    end

    test "from_config/1 reads endpoint/model/thinking/reasoning_effort overrides" do
      state =
        Strata.from_config(
          api_key: "sk-strata",
          endpoint: "http://127.0.0.1:9999/v1",
          model: "custom-model",
          thinking: "enabled",
          reasoning_effort: "high",
          max_tokens: 4321,
          timeout: 1234
        )

      assert state.api_key == "sk-strata"
      assert state.endpoint == "http://127.0.0.1:9999/v1"
      assert state.model == "custom-model"
      assert state.thinking == :enabled
      assert state.reasoning_effort == "high"
      assert state.max_tokens == 4321
      assert state.timeout == 1234
    end

    test "from_config/0 builds a usable unified state from application config" do
      state = Strata.from_config()

      assert %Strata{} = state
      assert is_binary(state.endpoint) and String.starts_with?(state.endpoint, "http")
      # 模型跟随 Strata App：未显式配置时为 nil（请求体不带 model）。
      assert state.model == nil or is_binary(state.model)
      assert is_integer(state.timeout) and state.timeout > 0
    end
  end

  describe "complete/4 auth" do
    test "keyless (api_key_required: false) sends HTTP without an authorization header" do
      test_pid = self()

      mock = fn url, body, opts ->
        send(test_pid, {:request, url, body, opts})
        {:ok, 200, success_body("ok")}
      end

      state = base_state(http_fn: mock)

      assert {:ok, result} = Strata.complete(state, nil, "prompt", %InferenceParams{})
      assert result.content == "ok"

      assert_receive {:request, url, body, opts}
      assert url == @endpoint <> "/chat/completions"
      assert body.model == @model
      assert body.messages == [%{role: "user", content: "prompt"}]
      assert body.stream == false
      # keyless：不发 Authorization 头，也不发 thinking 对象。
      assert Keyword.fetch!(opts, :headers) == []
      refute Map.has_key?(body, :thinking)
    end

    test "with an optional API key configured sends Bearer auth" do
      test_pid = self()

      mock = fn url, body, opts ->
        send(test_pid, {:request, url, body, opts})
        {:ok, 200, success_body("ok")}
      end

      state = base_state(api_key: "sk-strata-secret", http_fn: mock)

      assert {:ok, _result} = Strata.complete(state, nil, "prompt", %InferenceParams{})

      assert_receive {:request, _url, _body, opts}
      assert {"authorization", "Bearer sk-strata-secret"} in Keyword.fetch!(opts, :headers)
    end

    test "unconfigured model is omitted so Strata App routes to its loaded model" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:request_body, body})
        {:ok, 200, success_body("ok")}
      end

      state = base_state(model: nil, http_fn: mock)

      assert {:ok, _result} = Strata.complete(state, nil, "prompt", %InferenceParams{})
      assert_receive {:request_body, body}
      refute Map.has_key?(body, :model)
    end
  end

  describe "thinking control via top-level reasoning_effort" do
    test "thinking disabled sends reasoning_effort none and never a thinking object" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:request_body, body})
        {:ok, 200, success_body("ok")}
      end

      state = base_state(thinking: :disabled, http_fn: mock)

      assert {:ok, _result} = Strata.complete(state, nil, "prompt", %InferenceParams{})
      assert_receive {:request_body, body}
      assert body.reasoning_effort == "none"
      refute Map.has_key?(body, :thinking)
    end

    test "thinking enabled with explicit effort passes the effort through" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:request_body, body})
        {:ok, 200, success_body("ok")}
      end

      state = base_state(thinking: :enabled, reasoning_effort: "high", http_fn: mock)

      assert {:ok, _result} = Strata.complete(state, nil, "prompt", %InferenceParams{})
      assert_receive {:request_body, body}
      assert body.reasoning_effort == "high"
      refute Map.has_key?(body, :thinking)
    end

    test "thinking enabled without an explicit effort sends no reasoning_effort" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:request_body, body})
        {:ok, 200, success_body("ok")}
      end

      state = base_state(thinking: :enabled, reasoning_effort: nil, http_fn: mock)

      assert {:ok, _result} = Strata.complete(state, nil, "prompt", %InferenceParams{})
      assert_receive {:request_body, body}
      refute Map.has_key?(body, :reasoning_effort)
      refute Map.has_key?(body, :thinking)
    end
  end

  describe "health_check/1 (keyless real network probe)" do
    test "keyless health check issues GET /models without an authorization header" do
      test_pid = self()

      get = fn url, opts ->
        send(test_pid, {:models_request, url, opts})
        {:ok, 200, %{"data" => [%{"id" => @model}]}}
      end

      state = base_state(get_fn: get)

      assert Strata.health_check(state) == :ok

      assert_receive {:models_request, url, opts}
      assert url == @endpoint <> "/models"
      assert Keyword.fetch!(opts, :headers) == []
    end

    test "keyless health check still probes when an optional API key is configured" do
      test_pid = self()

      get = fn _url, opts ->
        send(test_pid, {:models_request, opts})
        {:ok, 200, %{"data" => [%{"id" => @model}]}}
      end

      state = base_state(api_key: "sk-strata-optional", get_fn: get)

      assert Strata.health_check(state) == :ok

      assert_receive {:models_request, opts}
      assert {"authorization", "Bearer sk-strata-optional"} in Keyword.fetch!(opts, :headers)
    end

    test "maps connection refused to an author-readable Chinese error" do
      get = fn _url, _opts -> {:error, :connection_refused, 0, "tcp connect refused"} end

      state = base_state(get_fn: get)

      assert {:error, error} = Strata.health_check(state)
      assert error.type == :connection_refused
      assert error.message == "无法连接 Strata"
    end

    test "maps timeout to an author-readable Chinese error" do
      get = fn _url, _opts -> {:error, :timeout, 0, "timeout"} end

      state = base_state(get_fn: get)

      assert {:error, error} = Strata.health_check(state)
      assert error.type == :timeout
      assert error.message == "Strata 请求超时"
    end
  end

  describe "list_models/1" do
    test "parses /models without requiring a key" do
      test_pid = self()

      get = fn url, opts ->
        send(test_pid, {:models_request, url, opts})
        {:ok, 200, %{"data" => [%{"id" => @model, "owned_by" => "strata"}]}}
      end

      state = base_state(get_fn: get)

      assert {:ok, [%{id: @model, label: @model, owned_by: "strata"}]} =
               Strata.list_models(state)

      assert_receive {:models_request, url, opts}
      assert url == @endpoint <> "/models"
      assert Keyword.fetch!(opts, :headers) == []
    end

    test "uses the unified backend's meta.label for the visible model label" do
      get = fn _url, _opts ->
        {:ok, 200,
         %{
           "data" => [
             %{
               "id" => "iq3_s",
               "owned_by" => "strata",
               "meta" => %{
                 "instanceId" => "instance-1",
                 "label" => "Qwen3.8-Flash-Next IQ3_S",
                 "aliases" => ["qwen3.8-flash-next-iq3_s", "iq3_s"]
               }
             }
           ]
         }}
      end

      state = base_state(get_fn: get)

      assert {:ok, [model]} = Strata.list_models(state)
      assert model.id == "iq3_s"
      assert model.label == "Qwen3.8-Flash-Next IQ3_S"
      assert model.owned_by == "strata"
    end
  end

  describe "execute/5 (streaming)" do
    test "streams SSE chunks through provider execution facts keyless" do
      test_pid = self()

      eventsource = fn url, body, opts, on_data ->
        send(test_pid, {:stream_request, url, body, opts})

        on_data.(sse_delta("本", @model))

        on_data.(sse_delta("地", @model, %{"prompt_tokens" => 3, "completion_tokens" => 2}))

        on_data.("data: [DONE]\n\n")

        {:ok, 200, ""}
      end

      state = base_state(thinking: :disabled, eventsource_fn: eventsource)

      assert {:ok, %{events: events, result: result, output: output}} =
               Strata.execute(state, nil, "prompt", %InferenceParams{}, provider_ctx())

      assert result.content == "本地"
      assert result.usage.input_tokens == 3
      assert result.usage.output_tokens == 2
      assert output.content.text == "本地"

      assert_receive {:stream_request, url, body, opts}
      assert url == @endpoint <> "/chat/completions"
      assert body.stream == true
      assert body.reasoning_effort == "none"
      assert Keyword.fetch!(opts, :headers) == []

      chunk_events = Enum.filter(events, &(&1.event_type == :chunk))
      assert length(chunk_events) == 2
    end
  end

  describe "execute/5 (tool call)" do
    test "tool_call prompt stays non-streaming and keeps the named tool_choice object" do
      test_pid = self()

      mock = fn url, body, opts ->
        send(test_pid, {:request, url, body, opts})

        {:ok, 200,
         %{
           "choices" => [
             %{
               "message" => %{
                 "content" => nil,
                 "tool_calls" => [
                   %{
                     "id" => "call_1",
                     "type" => "function",
                     "function" => %{
                       "name" => "judgment_decision",
                       "arguments" => ~s({"decision":"approve"})
                     }
                   }
                 ]
               }
             }
           ],
           "usage" => %{}
         }}
      end

      state = base_state(thinking: :disabled, http_fn: mock)

      prompt = %{
        messages: [%{role: "user", content: "请给出判断"}],
        tools: [
          %{
            name: "judgment_decision",
            description: "给出叙事判断",
            input_schema: %{
              type: "object",
              properties: %{decision: %{type: "string"}},
              required: ["decision"]
            }
          }
        ],
        tool_choice: "judgment_decision"
      }

      assert {:ok, %{result: result}} =
               Strata.execute(state, nil, prompt, %InferenceParams{}, provider_ctx())

      assert [%{"name" => "judgment_decision", "arguments" => %{"decision" => "approve"}}] =
               result.tool_calls

      assert_receive {:request, url, body, opts}
      assert url == @endpoint <> "/chat/completions"
      assert body.stream == false
      assert body.reasoning_effort == "none"
      assert Keyword.fetch!(opts, :headers) == []

      # Strata 接受 OpenAI 具名 tool_choice 对象，绝不能像 LM Studio 那样降级成
      # "required"（那会丢掉调用方指定的工具名）。
      assert body.tool_choice == %{type: "function", function: %{name: "judgment_decision"}}

      assert [%{type: "function", function: %{name: "judgment_decision"}} | _] = body.tools
    end
  end

  defp base_state(overrides \\ []) do
    struct!(
      Strata,
      Keyword.merge(
        [endpoint: @endpoint, model: @model, timeout: 100, log_fn: nil],
        overrides
      )
    )
  end

  defp success_body(content) do
    %{
      "choices" => [%{"message" => %{"content" => content}}],
      "model" => @model,
      "usage" => %{"prompt_tokens" => 3, "completion_tokens" => 1}
    }
  end

  defp provider_ctx do
    %{
      provider_name: :strata,
      model_name: @model,
      provider_call_ref: "pcall_strata_test",
      provider_run_id: "prun_strata_test",
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
