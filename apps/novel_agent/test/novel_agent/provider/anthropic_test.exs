defmodule NovelAgent.Provider.AnthropicTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Anthropic
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.TimeoutPolicy

  describe "name/0" do
    test "returns anthropic identifier" do
      assert Anthropic.name() == "anthropic"
    end
  end

  describe "from_config/0" do
    test "returns struct with defaults" do
      state = Anthropic.from_config()
      assert state.model == "claude-sonnet-4-6"
      assert state.timeout == 300_000
    end
  end

  describe "complete/4" do
    test "returns auth error on 401" do
      mock = fn _url, _body, _opts -> {:error, :http_error, 401, "Unauthorized"} end
      state = %Anthropic{api_key: nil, model: "c", timeout: 100, http_fn: mock, log_fn: nil}

      assert {:error, error} = Anthropic.complete(state, nil, "prompt", %InferenceParams{})
      assert error.type == :auth
    end

    test "returns connection_refused" do
      mock = fn _url, _body, _opts -> {:error, :connection_refused, 0, "拒绝"} end
      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}

      assert {:error, error} = Anthropic.complete(state, nil, "prompt", %InferenceParams{})
      assert error.type == :connection_refused
    end

    test "returns timeout" do
      mock = fn _url, _body, _opts -> {:error, :timeout, 0, "超时"} end
      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}

      assert {:error, error} = Anthropic.complete(state, nil, "prompt", %InferenceParams{})
      assert error.type == :timeout
    end

    test "marks a long system prompt with Anthropic cache_control" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:anthropic_body, body})
        {:error, :http_error, 401, "Unauthorized"}
      end

      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}
      long_system = String.duplicate("规则", 2100)

      prompt = [
        %{role: "system", content: long_system},
        %{role: "user", content: "hi"}
      ]

      assert {:error, _error} = Anthropic.complete(state, nil, prompt, %InferenceParams{})
      assert_receive {:anthropic_body, body}

      assert [
               %{
                 type: "text",
                 text: ^long_system,
                 cache_control: %{type: "ephemeral"}
               }
             ] = body.system
    end
  end

  describe "execute/5" do
    # provider 能力整形：同一工具集分别映射原生 none 与具名 tool_choice，供不同调用族按需使用。
    test "同一工具集在 none 与具名强制调用下分别映射原生 none / 具名 tool_choice" do
      test_pid = self()

      eventsource = fn _url, body, _opts, on_data ->
        send(test_pid, {:tool_choice_none_body, body})

        on_data.(
          anthropic_sse("content_block_delta", %{
            "type" => "content_block_delta",
            "index" => 0,
            "delta" => %{"type" => "text_delta", "text" => "判断说明"}
          })
        )

        {:ok, 200, ""}
      end

      http = fn _url, body, _opts ->
        send(test_pid, {:tool_choice_named_body, body})

        {:ok, 200,
         %{
           "content" => [
             %{
               "type" => "tool_use",
               "id" => "tool-1",
               "name" => "judgment_decision",
               "input" => %{"action" => "reply"}
             }
           ]
         }}
      end

      state = %Anthropic{
        api_key: "test-key",
        model: "claude-sonnet-4-6",
        timeout: 100,
        eventsource_fn: eventsource,
        http_fn: http,
        log_fn: nil
      }

      prompt = %{
        messages: [%{role: "user", content: "判断"}],
        tools: [%{name: "judgment_decision", description: "判断", input_schema: %{type: "object"}}],
        tool_choice: "none"
      }

      assert {:ok, %{provider_run: run}} =
               Anthropic.execute(state, nil, prompt, %InferenceParams{}, provider_ctx())

      refute Map.has_key?(run.metadata, :tool_constancy)

      assert {:ok, _} =
               Anthropic.execute(
                 state,
                 nil,
                 %{prompt | tool_choice: "judgment_decision"},
                 %InferenceParams{},
                 provider_ctx()
               )

      assert_receive {:tool_choice_none_body, first}
      assert_receive {:tool_choice_named_body, second}
      assert first.tools == second.tools
      assert first.tool_choice == %{type: "none"}
      assert second.tool_choice == %{type: "tool", name: "judgment_decision"}
    end

    test "streams Anthropic SSE chunks through provider execution facts" do
      test_pid = self()

      eventsource = fn url, body, opts, on_data ->
        send(test_pid, {:stream_request, url, body, opts})

        on_data.(
          anthropic_sse("message_start", %{
            "type" => "message_start",
            "message" => %{
              "model" => "claude-sonnet-4-6",
              "usage" => %{"input_tokens" => 7, "output_tokens" => 0}
            }
          })
        )

        split_frame =
          anthropic_sse("content_block_delta", %{
            "type" => "content_block_delta",
            "index" => 0,
            "delta" => %{"type" => "text_delta", "text" => "你"}
          })

        {first_half, second_half} = String.split_at(split_frame, div(byte_size(split_frame), 2))
        on_data.(first_half)
        on_data.(second_half)

        on_data.(
          anthropic_sse("content_block_delta", %{
            "type" => "content_block_delta",
            "index" => 0,
            "delta" => %{"type" => "text_delta", "text" => "好"}
          })
        )

        on_data.(
          anthropic_sse("message_delta", %{
            "type" => "message_delta",
            "usage" => %{"output_tokens" => 2}
          })
        )

        on_data.(anthropic_sse("message_stop", %{"type" => "message_stop"}))

        {:ok, 200, ""}
      end

      state = %Anthropic{
        api_key: "sk-ant-secret",
        model: "claude-sonnet-4-6",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }

      prompt = [
        %{role: "system", content: "系统规则"},
        %{role: "user", content: "写一句问候"}
      ]

      assert {:ok, %{events: events, result: result, output: output}} =
               Anthropic.execute(state, nil, prompt, %InferenceParams{}, provider_ctx())

      assert result.content == "你好"
      assert result.usage.input_tokens == 7
      assert result.usage.output_tokens == 2
      assert result.usage.model == "claude-sonnet-4-6"
      assert is_integer(result.usage.ttft_ms)
      assert result.usage.ttft_ms >= 0
      assert output.content.text == "你好"

      assert_receive {:stream_request, url, body, opts}
      assert url == "https://api.anthropic.com/v1/messages"
      assert body.stream == true
      assert body.system == "系统规则"
      assert body.messages == [%{role: "user", content: "写一句问候"}]
      assert {"x-api-key", "sk-ant-secret"} in Keyword.fetch!(opts, :headers)
      assert {"anthropic-version", "2023-06-01"} in Keyword.fetch!(opts, :headers)

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

      state = %Anthropic{
        api_key: nil,
        model: "claude-sonnet-4-6",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }

      assert {:error, %{error: %{type: :auth}, events: events}} =
               Anthropic.execute(state, nil, "prompt", %InferenceParams{}, provider_ctx())

      assert Enum.map(events, & &1.event_type) == [:started, :error]
      refute_received :unexpected_eventsource
    end

    test "maps Anthropic stream error events into provider execution errors" do
      eventsource = fn _url, _body, _opts, on_data ->
        on_data.(
          anthropic_sse("error", %{
            "type" => "error",
            "error" => %{"type" => "overloaded_error", "message" => "busy"}
          })
        )

        {:ok, 200, ""}
      end

      state = %Anthropic{
        api_key: "sk-ant-secret",
        model: "claude-sonnet-4-6",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }

      assert {:error, %{error: %{type: :rate_limit, message: message}, events: events}} =
               Anthropic.execute(state, nil, "prompt", %InferenceParams{}, provider_ctx())

      assert message =~ "Anthropic API: busy"
      assert Enum.any?(events, &(&1.event_type == :error))
    end

    test "B22: non-stream tool calls use the non-stream wait window" do
      test_pid = self()

      mock = fn _url, _body, opts ->
        send(test_pid, {:http_opts, opts})

        {:ok, 200,
         %{
           "content" => [%{"type" => "text", "text" => "判断完成"}],
           "usage" => %{"input_tokens" => 5, "output_tokens" => 2}
         }}
      end

      state = %Anthropic{
        api_key: "sk-ant-secret",
        model: "claude-sonnet-4-6",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      prompt = %{
        messages: [%{role: "user", content: "判断"}],
        tools: [
          %{name: "judgment_decision", description: "decision", input_schema: %{type: "object"}}
        ],
        tool_choice: "judgment_decision"
      }

      policy = %TimeoutPolicy{
        provider: :anthropic,
        profile: :hosted,
        connect_ms: 15_000,
        response_ms: 300_000,
        non_stream_ms: 1_234_000,
        deadline_ms: nil
      }

      assert {:ok, _result} =
               Anthropic.execute(
                 state,
                 nil,
                 prompt,
                 %InferenceParams{},
                 provider_ctx(timeout_policy: policy)
               )

      assert_receive {:http_opts, opts}
      assert Keyword.fetch!(opts, :receive_timeout) == 1_234_000
      assert Keyword.fetch!(opts, :connect_timeout) == 15_000
    end
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(Anthropic, :complete, 4)
      assert function_exported?(Anthropic, :execute, 5)
      assert function_exported?(Anthropic, :name, 0)
      assert function_exported?(Anthropic, :from_config, 0)
    end
  end

  defp provider_ctx(overrides \\ []) do
    Map.merge(
      %{
        provider_name: :anthropic,
        model_name: "claude-sonnet-4-6",
        provider_call_ref: "pcall_anthropic_test",
        provider_run_id: "prun_anthropic_test",
        purpose: :conversation,
        owner_refs: %{}
      },
      Map.new(overrides)
    )
  end

  defp anthropic_sse(event, payload) do
    "event: #{event}\ndata: #{Jason.encode!(payload)}\n\n"
  end
end
