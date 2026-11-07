defmodule NovelAgent.Provider.StreamProsePreviewTest do
  @moduledoc """
  B71 R2 后续 checkpoint：真实流式正文预览的事实边界。

  写作类 Provider 的正文在 JSON 流的 `body` 字段里。SSEStream 必须把三 wire
  decoder 的正文增量喂给 `AuthorProseStream`，让流式路径产出与 final-only 路径
  一致的 `author_content_delta`（前端 `agentRunProseStream` 的唯一数据源）；
  非 author 用途不得携带该字段。预览只来自真实正文增量的 body 文本，不展示
  JSON 协议字节、工具参数或私有 reasoning。
  """

  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Anthropic
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.OpenAI
  alias NovelTest.TestRequestIR

  @json ~s([{"item_id":"i1","title":"标题","body":"正文第一句。正文第二句。"}])
  @body "正文第一句。正文第二句。"

  defp ir(text) when is_binary(text), do: TestRequestIR.ir([TestRequestIR.author(text)])

  defp provider_ctx(opts) do
    Map.merge(
      %{
        provider_name: :openai,
        model_name: "fixture-model",
        provider_call_ref: "pcall_stream_prose_test",
        provider_run_id: "prun_stream_prose_test",
        purpose: :writer,
        owner_refs: %{}
      },
      Map.new(opts)
    )
  end

  defp sse(payload), do: "data: #{Jason.encode!(payload)}\n\n"

  defp anthropic_sse(event, payload),
    do: "event: #{event}\ndata: #{Jason.encode!(payload)}\n\n"

  defp chunks_of(text, count) do
    size = div(String.length(text), count)

    text
    |> String.graphemes()
    |> Enum.chunk_every(size)
    |> Enum.map(&Enum.join/1)
  end

  defp author_content_deltas(events) do
    events
    |> Enum.filter(&(&1.event_type == :chunk))
    |> Enum.map(& &1.payload[:author_content_delta])
    |> Enum.reject(&is_nil/1)
  end

  test "Chat SSE：写作者 JSON 流的 body 提取为 author_content_delta，预览不含协议字节" do
    chunks = chunks_of(@json, 5)
    test_pid = self()

    eventsource = fn _url, _body, _opts, on_data ->
      send(test_pid, :streamed)

      Enum.each(chunks, fn chunk ->
        on_data.(
          sse(%{"model" => "fixture-model", "choices" => [%{"delta" => %{"content" => chunk}}]})
        )
      end)

      on_data.("data: [DONE]\n\n")
      {:ok, 200, ""}
    end

    state = %OpenAI{
      api_key: "sk-test",
      endpoint: "https://api.openai.com/v1",
      model: "fixture-model",
      timeout: 100,
      eventsource_fn: eventsource,
      log_fn: nil
    }

    ctx = provider_ctx(content_visibility: :author)

    assert {:ok, %{result: result, events: events}} =
             OpenAI.execute(state, nil, ir("写正文"), %InferenceParams{}, ctx)

    assert_receive :streamed
    assert result.content == @json

    deltas = author_content_deltas(events)
    assert Enum.any?(deltas, &(&1 != ""))
    assert Enum.join(deltas) == @body
    refute Enum.any?(deltas, &String.contains?(&1, "item_id"))
    refute Enum.any?(deltas, &String.contains?(&1, "body"))
  end

  test "Anthropic SSE：写作者 JSON 流的 body 同样提取为 author_content_delta" do
    chunks = chunks_of(@json, 4)
    test_pid = self()

    eventsource = fn _url, _body, _opts, on_data ->
      send(test_pid, :streamed)

      on_data.(
        anthropic_sse("message_start", %{
          "type" => "message_start",
          "message" => %{"model" => "fixture-model", "usage" => %{"input_tokens" => 1}}
        })
      )

      Enum.each(chunks, fn chunk ->
        on_data.(
          anthropic_sse("content_block_delta", %{
            "type" => "content_block_delta",
            "index" => 0,
            "delta" => %{"type" => "text_delta", "text" => chunk}
          })
        )
      end)

      on_data.(
        anthropic_sse("message_delta", %{
          "type" => "message_delta",
          "usage" => %{"output_tokens" => 1}
        })
      )

      {:ok, 200, ""}
    end

    state = %Anthropic{
      api_key: "sk-ant-test",
      model: "fixture-model",
      timeout: 100,
      eventsource_fn: eventsource,
      log_fn: nil
    }

    ctx = provider_ctx(provider_name: :anthropic, content_visibility: :author)

    assert {:ok, %{events: events}} =
             Anthropic.execute(state, nil, ir("写正文"), %InferenceParams{}, ctx)

    assert_receive :streamed
    assert Enum.join(author_content_deltas(events)) == @body
  end

  test "Responses SSE：写作者 JSON 流的 body 提取为 author_content_delta" do
    chunks = chunks_of(@json, 4)
    test_pid = self()

    eventsource = fn _url, _body, _opts, on_data ->
      send(test_pid, :streamed)

      on_data.(sse(%{"type" => "response.created", "response" => %{"model" => "fixture-model"}}))

      Enum.each(chunks, fn chunk ->
        on_data.(
          sse(%{
            "type" => "response.output_text.delta",
            "item_id" => "msg_1",
            "output_index" => 0,
            "delta" => chunk
          })
        )
      end)

      on_data.(
        sse(%{
          "type" => "response.completed",
          "response" => %{
            "model" => "fixture-model",
            "usage" => %{"input_tokens" => 1, "output_tokens" => 1}
          }
        })
      )

      {:ok, 200, ""}
    end

    state =
      %OpenAI{
        api_key: "sk-test",
        endpoint: "https://api.openai.com/v1",
        model: "fixture-model",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }
      |> Map.put(:wire_api, :responses)

    ctx = provider_ctx(content_visibility: :author)

    assert {:ok, %{events: events}} =
             OpenAI.execute(state, nil, ir("写正文"), %InferenceParams{}, ctx)

    assert_receive :streamed
    assert Enum.join(author_content_deltas(events)) == @body
  end

  test "非 author 用途不携带 author_content_delta（不把 JSON 正文泄漏给作者面）" do
    test_pid = self()

    eventsource = fn _url, _body, _opts, on_data ->
      send(test_pid, :streamed)

      on_data.(
        sse(%{"model" => "fixture-model", "choices" => [%{"delta" => %{"content" => @json}}]})
      )

      on_data.("data: [DONE]\n\n")
      {:ok, 200, ""}
    end

    state = %OpenAI{
      api_key: "sk-test",
      endpoint: "https://api.openai.com/v1",
      model: "fixture-model",
      timeout: 100,
      eventsource_fn: eventsource,
      log_fn: nil
    }

    ctx = provider_ctx(purpose: :conversation)

    assert {:ok, %{events: events}} =
             OpenAI.execute(state, nil, ir("普通请求"), %InferenceParams{}, ctx)

    assert_receive :streamed

    chunk_events = Enum.filter(events, &(&1.event_type == :chunk))
    refute Enum.any?(chunk_events, &Map.has_key?(&1.payload, :author_content_delta))
  end
end
