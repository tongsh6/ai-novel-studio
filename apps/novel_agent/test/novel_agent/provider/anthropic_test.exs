defmodule NovelAgent.Provider.AnthropicTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Anthropic
  alias NovelAgent.Provider.InferenceParams

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
  end

  describe "execute/5" do
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
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(Anthropic, :complete, 4)
      assert function_exported?(Anthropic, :execute, 5)
      assert function_exported?(Anthropic, :name, 0)
      assert function_exported?(Anthropic, :from_config, 0)
    end
  end

  defp provider_ctx do
    %{
      provider_name: :anthropic,
      model_name: "claude-sonnet-4-6",
      provider_call_ref: "pcall_anthropic_test",
      provider_run_id: "prun_anthropic_test",
      purpose: :conversation,
      owner_refs: %{}
    }
  end

  defp anthropic_sse(event, payload) do
    "event: #{event}\ndata: #{Jason.encode!(payload)}\n\n"
  end
end
