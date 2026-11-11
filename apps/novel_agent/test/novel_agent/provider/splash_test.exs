defmodule NovelAgent.Provider.SplashTest do
  use ExUnit.Case, async: true

  alias NovelTest.TestRequestIR

  # adapter 只接受 canonical IR；测试用作者原话构造最小请求，文字保持原字节。
  defp ir(text) when is_binary(text), do: TestRequestIR.ir([TestRequestIR.author(text)])

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Splash

  @endpoint "http://127.0.0.1:8000/v1"
  @model "local/Q4-PLE4"

  describe "identity and defaults" do
    test "reports splash vendor identity and exposes the provider contract" do
      assert Splash.name() == "splash"
      assert function_exported?(Splash, :execute, 5)
      assert function_exported?(Splash, :health_check, 1)
      assert function_exported?(Splash, :list_models, 1)
    end

    test "from_config/1 defaults to the local Splash endpoint and follows the Splash-managed model" do
      state = Splash.from_config([])

      assert %Splash{} = state
      assert state.endpoint == @endpoint

      # 模型由 Splash 管理：未显式配置模型时不发 model 字段。
      assert state.model == nil
      assert state.timeout > 0
      assert state.max_tokens == 16_000
      # 默认关思考：thinking 归一为 :disabled，reasoning_effort 未配置。
      assert state.thinking == :disabled
      assert state.reasoning_effort == nil
    end

    test "from_config/1 reads endpoint/model/api_key/thinking/reasoning_effort overrides" do
      state =
        Splash.from_config(
          api_key: "sk-splash",
          endpoint: "http://127.0.0.1:9999/v1",
          model: "custom-model",
          thinking: "enabled",
          reasoning_effort: "high",
          max_tokens: 4321,
          timeout: 1234
        )

      assert state.api_key == "sk-splash"
      assert state.endpoint == "http://127.0.0.1:9999/v1"
      assert state.model == "custom-model"
      assert state.thinking == :enabled
      assert state.reasoning_effort == "high"
      assert state.max_tokens == 4321
      assert state.timeout == 1234
    end

    test "from_config/0 builds a usable state from application config" do
      state = Splash.from_config()

      assert %Splash{} = state
      assert is_binary(state.endpoint) and String.starts_with?(state.endpoint, "http")
      # 模型跟随 Splash：未显式配置时为 nil（请求体不带 model）。
      assert state.model == nil or is_binary(state.model)
      assert is_integer(state.timeout) and state.timeout > 0
    end
  end

  # 请求整形断言（auth 头 / model 省略 / thinking 控制）在唯一执行入口
  # execute/5 的流式请求体上成立：request_body 是共享边界。
  describe "execute/5 request body" do
    test "keyless / 可选 Key / model 省略进入流式请求体" do
      {url, body, opts} = capture_stream_body(base_state([]))

      assert url == @endpoint <> "/chat/completions"
      assert body.model == @model
      assert body.stream == true
      assert [%{role: "system"} | rest] = body.messages
      assert rest == [%{role: "user", content: "prompt"}]
      # keyless：不发 Authorization 头，也不发 thinking 对象。
      assert Keyword.fetch!(opts, :headers) == []
      refute Map.has_key?(body, :thinking)

      {_url, _body, keyed_opts} =
        capture_stream_body(base_state(api_key: "sk-splash-secret"))

      assert {"authorization", "Bearer sk-splash-secret"} in Keyword.fetch!(keyed_opts, :headers)

      # 模型未配置时不发 model：由 Splash 路由到当前已加载模型。
      {_url, unconfigured_body, _opts} = capture_stream_body(base_state(model: nil))
      refute Map.has_key?(unconfigured_body, :model)
    end

    test "thinking 控制进入流式请求体（reasoning_effort，绝不发 thinking 对象）" do
      cases = [
        {[thinking: :disabled], {:effort, "none"}},
        {[thinking: :enabled, reasoning_effort: "high"], {:effort, "high"}},
        {[thinking: :enabled, reasoning_effort: nil], :absent}
      ]

      for {config, expected} <- cases do
        {_url, body, _opts} = capture_stream_body(base_state(config))

        case expected do
          {:effort, effort} -> assert body.reasoning_effort == effort
          :absent -> refute Map.has_key?(body, :reasoning_effort)
        end

        refute Map.has_key?(body, :thinking)
      end
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
               Splash.execute(state, nil, ir("prompt"), %InferenceParams{}, provider_ctx())

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

  describe "health_check/1 (keyless real network probe)" do
    test "keyless health check issues GET /models without an authorization header" do
      test_pid = self()

      get = fn url, opts ->
        send(test_pid, {:models_request, url, opts})
        {:ok, 200, %{"data" => [%{"id" => @model}]}}
      end

      state = base_state(get_fn: get)

      assert Splash.health_check(state) == :ok

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

      state = base_state(api_key: "sk-splash-optional", get_fn: get)

      assert Splash.health_check(state) == :ok

      assert_receive {:models_request, opts}
      assert {"authorization", "Bearer sk-splash-optional"} in Keyword.fetch!(opts, :headers)
    end

    test "maps connection refused to an author-readable Chinese error" do
      get = fn _url, _opts -> {:error, :connection_refused, 0, "tcp connect refused"} end

      assert {:error, error} = Splash.health_check(base_state(get_fn: get))
      assert error.type == :connection_refused
      assert error.message == "无法连接 Splash"
    end

    test "maps timeout to an author-readable Chinese error" do
      get = fn _url, _opts -> {:error, :timeout, 0, "timeout"} end

      assert {:error, error} = Splash.health_check(base_state(get_fn: get))
      assert error.type == :timeout
      assert error.message == "Splash 请求超时"
    end
  end

  describe "list_models/1" do
    test "parses /models without requiring a key" do
      test_pid = self()

      get = fn url, opts ->
        send(test_pid, {:models_request, url, opts})
        {:ok, 200, %{"data" => [%{"id" => @model, "owned_by" => "splash"}]}}
      end

      state = base_state(get_fn: get)

      assert {:ok, [%{id: @model, label: @model, owned_by: "splash"}]} =
               Splash.list_models(state)

      assert_receive {:models_request, url, opts}
      assert url == @endpoint <> "/models"
      assert Keyword.fetch!(opts, :headers) == []
    end

    test "falls back to the model id when the server returns only standard fields" do
      get = fn _url, _opts ->
        {:ok, 200, %{"data" => [%{"id" => @model, "object" => "model"}]}}
      end

      assert {:ok, [model]} = Splash.list_models(base_state(get_fn: get))
      assert model.id == @model
      assert model.label == @model
      assert model.owned_by == nil
    end
  end

  defp capture_stream_body(state, prompt \\ nil) do
    parent = self()

    eventsource = fn url, body, opts, on_data ->
      send(parent, {:captured_request, url, body, opts})
      on_data.(sse_delta("ok", @model))
      on_data.("data: [DONE]\n\n")
      {:ok, 200, ""}
    end

    state = %{state | eventsource_fn: eventsource}
    prompt = prompt || ir("prompt")

    assert {:ok, _} = Splash.execute(state, nil, prompt, %InferenceParams{}, provider_ctx())
    assert_receive {:captured_request, url, body, opts}
    {url, body, opts}
  end

  defp base_state(overrides) do
    struct!(
      Splash,
      Keyword.merge(
        [endpoint: @endpoint, model: @model, timeout: 100, log_fn: nil],
        overrides
      )
    )
  end

  defp provider_ctx do
    %{
      provider_name: :splash,
      model_name: @model,
      provider_call_ref: "pcall_splash_test",
      provider_run_id: "prun_splash_test",
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
