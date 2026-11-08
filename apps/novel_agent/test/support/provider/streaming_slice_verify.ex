defmodule NovelAgent.Test.Provider.StreamingSliceVerify do
  @moduledoc """
  B71 R2 后续 checkpoint 的 test-support provider（仅测试/页面批次显式注入，不进生产 registry）。

  确定性 fixture 结果与 `NovelAgent.Test.Provider.SliceVerify` 完全一致；当调用用途是
  写作（`purpose: :writer` 或 `content_visibility: :author`）时，把结果正文经
  OpenAI-compatible **真实 SSE 传输**（`OpenAICompatibleStream`）送出：decoder 逐帧
  累积正文、`AuthorProseStream` 提取作者可见正文增量（`author_content_delta`），
  从而让真实页面在生成过程中显示正文预览。其它用途委托 SliceVerify（保持既有行为）。

  该 provider 只用于证明「真实流式链路 → 页面预览」的确定性页面证据；不得据此
  签真实模型行为、Responses/Anthropic 实模或 I10 文学质量。
  """

  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.{OpenAI, OpenAICompatibleStream, Result}
  alias NovelAgent.Test.Provider.SliceVerify

  @default_delay_ms 25
  @chunk_graphemes 6

  # 与 SliceVerify 一致：Gateway/provider_metadata 期望 provider 模块可 struct 化。
  defstruct []

  @impl true
  def execute(state, model, prompt, params, ctx) do
    if author_purpose?(ctx) do
      case SliceVerify.fixture_result(state, model, prompt, params, ctx) do
        {:ok, %Result{content: content, tool_calls: calls} = result}
        when (is_binary(content) and content != "") or (is_list(calls) and calls != []) ->
          stream_result(model, ctx, result)

        _other ->
          SliceVerify.execute(state, model, prompt, params, ctx)
      end
    else
      SliceVerify.execute(state, model, prompt, params, ctx)
    end
  end

  @impl true
  def health_check(_state), do: :ok

  @impl true
  def list_models(_state),
    do: {:ok, [%{id: "slice-verify-streaming", display_name: "Slice Verify (streaming)"}]}

  @impl true
  def name, do: "streaming_slice_verify"

  @impl true
  def capabilities(_state) do
    %{
      native_multi_turn: true,
      tool_calls: true,
      tool_results: true,
      streaming: true,
      structured_output: true,
      usage: true
    }
  end

  @impl true
  def projection_target(_state), do: "chat_completions"

  defp author_purpose?(ctx) do
    Map.get(ctx, :purpose) in [:writer, "writer"] or
      Map.get(ctx, :content_visibility) == :author
  end

  defp stream_result(model, ctx, %Result{} = result) do
    endpoint = "http://streaming-slice-verify.invalid/v1"
    stream_model = model || "slice-verify-streaming"
    frames = sse_frames(result, stream_model)

    eventsource = fn _url, _body, _opts, on_data ->
      Enum.each(frames, &emit_frame(&1, on_data))
      {:ok, 200, ""}
    end

    adapter_state = %OpenAI{
      api_key: "streaming-slice-verify",
      endpoint: endpoint,
      model: stream_model,
      timeout: 300_000,
      eventsource_fn: eventsource,
      log_fn: nil
    }

    request_opts = [headers: [], receive_timeout: 300_000, connect_timeout: 15_000]
    body = %{model: stream_model, stream: true}

    OpenAICompatibleStream.execute(
      %{vendor: "slice_verify", label: "Streaming Slice Verify"},
      adapter_state,
      endpoint <> "/chat/completions",
      body,
      request_opts,
      ctx
    )
  end

  defp emit_frame({data, delay}, on_data) do
    if delay > 0, do: Process.sleep(delay)
    on_data.(data)
  end

  defp sse_frames(%Result{content: content, tool_calls: [], usage: usage}, model)
       when is_binary(content) and content != "" do
    content_frames =
      content
      |> String.graphemes()
      |> Enum.chunk_every(@chunk_graphemes)
      |> Enum.map(fn graphemes ->
        chunk = Enum.join(graphemes)

        payload = %{
          "model" => model,
          "choices" => [%{"delta" => %{"content" => chunk}}]
        }

        {"data: " <> Jason.encode!(payload) <> "\n\n", delay_ms()}
      end)

    content_frames ++ tail_frames(model, usage)
  end

  # 写作类 provider 的真实输出形态：submit_tentative_artifact 工具调用，
  # 正文在 arguments JSON 的 body 字段。工具参数按真实 SSE 分片发送，归一后
  # 保留 raw_arguments；预览由 SSEStream 从参数增量提取 body 后产出。
  defp sse_frames(%Result{tool_calls: calls, usage: usage}, model) when is_list(calls) do
    frames =
      calls
      |> Enum.with_index()
      |> Enum.flat_map(fn {call, index} -> tool_call_frames(call, index, model) end)

    frames ++ tail_frames(model, usage)
  end

  defp sse_frames(%Result{usage: usage}, model), do: tail_frames(model, usage)

  defp tail_frames(model, usage) do
    usage_frame =
      {"data: " <>
         Jason.encode!(%{"model" => model, "choices" => [], "usage" => usage_map(usage)}) <>
         "\n\n", 0}

    [usage_frame, {"data: [DONE]\n\n", 0}]
  end

  defp tool_call_frames(call, index, model) do
    {call_id, name, raw_arguments} = tool_call_parts(call, index)

    chunks =
      raw_arguments
      |> String.graphemes()
      |> Enum.chunk_every(@chunk_graphemes)
      |> Enum.map(&Enum.join/1)

    {first_chunk, rest} =
      case chunks do
        [first | rest] -> {first, rest}
        [] -> {"", []}
      end

    first_frame =
      {"data: " <>
         Jason.encode!(%{
           "model" => model,
           "choices" => [
             %{
               "delta" => %{
                 "tool_calls" => [
                   %{
                     "index" => index,
                     "id" => call_id,
                     "type" => "function",
                     "function" => %{"name" => name, "arguments" => first_chunk}
                   }
                 ]
               }
             }
           ]
         }) <> "\n\n", delay_ms()}

    rest_frames =
      Enum.map(rest, fn fragment ->
        {"data: " <>
           Jason.encode!(%{
             "model" => model,
             "choices" => [
               %{
                 "delta" => %{
                   "tool_calls" => [
                     %{"index" => index, "function" => %{"arguments" => fragment}}
                   ]
                 }
               }
             ]
           }) <> "\n\n", delay_ms()}
      end)

    [first_frame | rest_frames]
  end

  defp tool_call_parts(call, index) do
    {tool_call_id(call, index), call_name(call), raw_arguments(call)}
  end

  defp tool_call_id(call, index), do: call["id"] || call[:id] || "call_stream_#{index + 1}"
  defp call_name(call), do: call["name"] || call[:name]

  defp raw_arguments(call) do
    call["raw_arguments"] || call[:raw_arguments] ||
      encode_arguments(call["arguments"] || call[:arguments] || %{})
  end

  defp encode_arguments(value) when is_binary(value), do: value
  defp encode_arguments(value), do: Jason.encode!(value)

  defp usage_map(%{input_tokens: input, output_tokens: output} = usage) do
    %{
      "prompt_tokens" => input || 0,
      "completion_tokens" => output || 0,
      "cached_tokens" => Map.get(usage, :cached_tokens) || 0
    }
  end

  defp usage_map(_usage), do: %{"prompt_tokens" => 0, "completion_tokens" => 0}

  defp delay_ms do
    case Integer.parse(System.get_env("SLICE_VERIFY_STREAM_DELAY_MS", "")) do
      {value, ""} when value >= 0 -> value
      _other -> @default_delay_ms
    end
  end
end
