defmodule NovelAgent.Provider.LMStudioTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.LMStudio
  alias NovelAgent.Provider.Usage

  describe "name/0" do
    test "returns lmstudio identifier" do
      assert LMStudio.name() == "lmstudio"
    end
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(LMStudio, :complete, 4)
      assert function_exported?(LMStudio, :execute, 5)
      assert function_exported?(LMStudio, :name, 0)
    end
  end

  describe "from_config/0" do
    test "returns struct with configured values" do
      state = LMStudio.from_config()

      assert %LMStudio{} = state
      assert state.endpoint =~ "localhost"
      assert state.endpoint =~ "/v1"
      assert is_binary(state.model) and byte_size(state.model) > 0
      assert is_integer(state.timeout) and state.timeout > 0
    end
  end

  describe "struct defaults" do
    test "struct has all required fields" do
      state = %LMStudio{}

      assert Map.has_key?(state, :endpoint)
      assert Map.has_key?(state, :model)
      assert Map.has_key?(state, :timeout)
      assert Map.has_key?(state, :http_fn)
      assert Map.has_key?(state, :eventsource_fn)
      assert Map.has_key?(state, :log_fn)
      assert Map.has_key?(state, :json_mode)
    end

    test "http_fn and log_fn default to nil when not set" do
      state = %LMStudio{}
      assert state.http_fn == nil
      assert state.eventsource_fn == nil
      assert state.log_fn == nil
    end
  end

  describe "complete/4 error handling" do
    test "sends chat messages without flattening history into one user prompt" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:request_body, body})

        {:ok, 200,
         %{
           "choices" => [%{"message" => %{"content" => "{\"ok\":true}"}}],
           "usage" => %{}
         }}
      end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      messages = [
        %{role: "system", content: "规则"},
        %{role: "user", content: "第一轮"},
        %{role: "assistant", content: "回应第一轮"},
        %{role: "user", content: "第二轮"}
      ]

      assert {:ok, _result} = LMStudio.complete(state, nil, messages, %InferenceParams{})
      assert_receive {:request_body, body}
      assert body.messages == messages
    end

    test "named tool_choice downgrades to required string (LM Studio capability constraint)" do
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

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      prompt = %{
        messages: [%{role: "user", content: "起草计划"}],
        tools: [
          %{name: "agent_plan_draft", description: "draft", input_schema: %{type: "object"}}
        ],
        tool_choice: "agent_plan_draft"
      }

      assert {:ok, _result} = LMStudio.complete(state, nil, prompt, %InferenceParams{})
      assert_receive {:request_body, body}

      # LM Studio 只接受字符串 none/auto/required；具名对象形式会 HTTP 400
      assert body.tool_choice == "required"
      assert [%{function: %{name: "agent_plan_draft"}} | _] = body.tools
    end

    test "returns connection_refused" do
      mock = fn _url, _body, _opts -> {:error, :connection_refused, 0, "拒绝"} end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      assert {:error, error_map} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert error_map.type == :connection_refused
    end

    test "returns timeout" do
      mock = fn _url, _body, _opts -> {:error, :timeout, 0, "超时"} end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      assert {:error, error_map} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert error_map.type == :timeout
    end

    test "returns provider_internal for unknown errors" do
      mock = fn _url, _body, _opts -> {:error, :unknown, 0, "异常"} end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      assert {:error, error_map} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert error_map.type == :provider_internal
    end
  end

  describe "complete/4 usage accounting" do
    test "success carries a %Usage{} with token counts (not dropped)" do
      mock = fn _url, _body, _opts ->
        {:ok, 200,
         %{
           "choices" => [%{"message" => %{"content" => "正文"}}],
           "model" => "local-model",
           "usage" => %{"prompt_tokens" => 42, "completion_tokens" => 9}
         }}
      end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      assert {:ok, result} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert %Usage{} = result.usage
      assert result.usage.input_tokens == 42
      assert result.usage.output_tokens == 9
      assert result.usage.model == "local-model"
    end

    test "usage handed to log_fn is JSON-encodable (no silent drop)" do
      test_pid = self()

      mock = fn _url, _body, _opts ->
        {:ok, 200,
         %{
           "choices" => [%{"message" => %{"content" => "正文"}}],
           "usage" => %{"prompt_tokens" => 3, "completion_tokens" => 1}
         }}
      end

      log_fn = fn _provider, _url, _body, result, _start ->
        send(test_pid, {:logged_result, result})
        :ok
      end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: log_fn
      }

      assert {:ok, _result} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert_receive {:logged_result, {:ok, _ok, attrs}}

      # %Usage{} 必须能被 JSON 序列化（@derive Jason.Encoder），否则日志会被静默丢弃。
      assert {:ok, _json} = Jason.encode(attrs.usage)
    end
  end

  describe "execute/5" do
    test "streams local OpenAI-compatible chunks through provider execution facts" do
      test_pid = self()

      eventsource = fn url, body, opts, on_data ->
        send(test_pid, {:stream_request, url, body, opts})

        on_data.(sse_delta("本", "local-model"))

        on_data.(
          sse_delta("地", "local-model", %{
            "prompt_tokens" => 3,
            "completion_tokens" => 2
          })
        )

        on_data.("data: [DONE]\n\n")

        {:ok, 200, ""}
      end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "local-model",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }

      assert {:ok, %{events: events, result: result}} =
               LMStudio.execute(state, nil, "prompt", %InferenceParams{}, provider_ctx())

      assert result.content == "本地"
      assert result.usage.input_tokens == 3
      assert result.usage.output_tokens == 2

      assert_receive {:stream_request, "http://localhost/v1/chat/completions", body, opts}
      assert body.stream == true
      assert body.messages == [%{role: "user", content: "prompt"}]
      assert Keyword.fetch!(opts, :receive_timeout) == 100

      chunk_events = Enum.filter(events, &(&1.event_type == :chunk))
      assert length(chunk_events) == 2
      refute Enum.any?(chunk_events, &Map.has_key?(&1.payload, :content))
    end
  end

  describe "health_check/1" do
    test "maps connection refused to an author-readable LM Studio message" do
      get = fn _url, _opts -> {:error, :connection_refused, 0, "tcp connect refused"} end

      state = %LMStudio{endpoint: "http://127.0.0.1:1/v1", timeout: 100, get_fn: get}

      assert {:error, error} = LMStudio.health_check(state)
      assert error.message == "LM Studio 未启动"
      assert error.type == :connection_refused
    end

    test "maps timeout to an author-readable LM Studio message" do
      get = fn _url, _opts -> {:error, :timeout, 0, "timeout"} end

      state = %LMStudio{endpoint: "http://127.0.0.1:1/v1", timeout: 100, get_fn: get}

      assert {:error, error} = LMStudio.health_check(state)
      assert error.message == "LM Studio 请求超时"
      assert error.type == :timeout
    end
  end

  defp provider_ctx do
    %{
      provider_name: :lmstudio,
      model_name: "local-model",
      provider_call_ref: "pcall_lmstudio_stream_test",
      provider_run_id: "prun_lmstudio_stream_test",
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
