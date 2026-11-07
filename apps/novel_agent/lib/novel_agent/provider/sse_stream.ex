defmodule NovelAgent.Provider.SSEStream do
  @moduledoc """
  Provider 无关的 SSE 流式执行骨架（B71 R2）。

  三个 wire（Chat Completions / Anthropic Messages / Responses API）共用同一套
  传输生命周期（VS-00L §6.4/§19.1）：

  - 取消：调用方取消时立即 halt，并以 `materialize_cancelled` 结束，不伪造成功；
  - 最长 wire 静默窗口：`receive_timeout` 只约束"多久没有 wire 数据"，有数据就续命；
  - 总时长兜底：只有部署侧显式配置 deadline 才启用（默认关闭，见 `TimeoutPolicy`）；
  - SSE 帧分割、data payload 提取、JSON 解码失败标记；
  - 文本增量事件（ProviderEvent chunk）与作者叙事增量；
  - 终止物化：成功 / 解析失败 / provider 显式错误 / 空内容 / 退化内容 / 超时 /
    连接错误，统一错误分类与诊断字段。

  每个 wire 只提供 `decoder` 模块：解析自己的事件帧（文本增量、工具参数增量、
  usage、provider 错误），并在 `finalize/1` 给出与该 provider 非流式响应一致的
  content/tool_calls。本模块不解释 provider 私有字段，也不把工具参数增量作为
  作者可见事件——工具参数在流结束前只作内部增量事实，结束后归一成
  canonical `Result.tool_calls`（保留 call_id 与 raw_arguments）。
  """

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.SSEStream.Result

  @type eventsource_fn ::
          (String.t(), map(), keyword(), (binary() -> term()) -> HTTP.event_stream_result())

  @doc "decoder 初始化：只持有该 wire 的流式累积状态。"
  @callback init(state :: term()) :: term()

  @doc """
  解码一条已成功 JSON 解码的 SSE data 帧。

  返回 `{decoder_state, %{text: binary, activity?: boolean}}`：
  - `text` 是本次需要进入 ProviderEvent chunk 的正文增量（可为空）；
  - `activity?` 标记本帧是真实生成活动（文本或工具参数增量），用于 TTFT 诊断；
  - 工具参数增量由 decoder 自行累积，不进入 `text`。
  """
  @callback decode(decoder_state :: term(), decoded :: map()) ::
              {term(), %{text: binary(), activity?: boolean()}}

  @doc """
  归一最终结果，与非流式解析保持同一事实边界：

  - `content`：作者可见正文（来自 provider done 事实或同一文本增量）；
  - `tool_calls`：canonical 工具调用（call_id 为 canonical id，raw_arguments 保原字节）；
  - `usage` / `model`：原始 usage map 与模型名，供 `usage/3` 统一换算；
  - `error`：provider 显式错误事实（nil 表示无）；由本模块转换为统一错误。
  """
  @callback finalize(decoder_state :: term()) :: %{
              content: binary(),
              tool_calls: list(),
              usage: map() | nil,
              model: binary() | nil,
              error: nil | %{type: atom(), message: binary()}
            }

  @doc "把 provider usage 原始事实换算为 `Usage.t()`；缺 usage 时返回零用量。"
  @callback usage(usage :: map() | nil, model :: binary() | nil, duration_ms :: integer()) ::
              Usage.t()

  @doc false
  @spec execute(map(), module()) :: AdapterExecution.execution_result()
  def execute(opts, decoder) do
    %{state: state, ctx: ctx} = opts

    if AdapterExecution.cancelled?(ctx) do
      AdapterExecution.materialize_cancelled(ctx)
    else
      execute_uncancelled(opts, decoder, state)
    end
  end

  defp execute_uncancelled(opts, decoder, state) do
    %{ctx: ctx, body: body, url: url, request_opts: request_opts} = opts
    started = System.monotonic_time(:millisecond)
    initial_events = AdapterExecution.initial_events(ctx)
    AdapterExecution.emit_events(ctx, initial_events, :running)

    deadline_ms = AdapterExecution.deadline_timeout(ctx)
    response_ms = AdapterExecution.response_timeout(ctx, Map.get(state, :timeout) || 300_000)

    {:ok, acc} =
      Agent.start_link(fn ->
        %{
          buffer: "",
          events: [],
          next_sequence: length(initial_events) + 1,
          chunk_index: 0,
          wire_chunks: 0,
          accumulated_content_length: 0,
          author_narrative_open?: true,
          started: started,
          ttft_ms: nil,
          parse_error?: false,
          deadline_exceeded?: false,
          decoder: decoder,
          decoder_state: decoder.init(state)
        }
      end)

    on_data = &handle_wire_chunk(ctx, acc, started, deadline_ms, &1)

    request_result =
      state
      |> eventsource_fn()
      |> invoke_eventsource(url, body, request_opts, on_data)

    Agent.update(acc, &flush_buffer(ctx, &1))
    final_acc = Agent.get(acc, & &1)
    Agent.stop(acc)

    duration = System.monotonic_time(:millisecond) - started

    Result.materialize(%{
      opts: opts,
      decoder: decoder,
      initial_events: initial_events,
      acc: final_acc,
      request_result: request_result,
      started: started,
      duration: duration,
      response_ms: response_ms,
      deadline_ms: deadline_ms,
      cancelled?: AdapterExecution.cancelled?(ctx)
    })
  end

  defp eventsource_fn(state) do
    Map.get(state, :eventsource_fn) || (&HTTP.post_event_stream/4)
  end

  defp invoke_eventsource(eventsource, url, body, request_opts, on_data) do
    eventsource.(url, body, request_opts, on_data)
  rescue
    exception ->
      {:error, :provider_internal, 0, Exception.message(exception)}
  catch
    kind, reason ->
      {:error, :provider_internal, 0, "#{kind}: #{inspect(reason)}"}
  end

  defp handle_wire_chunk(ctx, acc, started, deadline_ms, chunk) do
    cond do
      AdapterExecution.cancelled?(ctx) ->
        :halt

      deadline_exceeded?(started, deadline_ms) ->
        Agent.update(acc, &Map.put(&1, :deadline_exceeded?, true))
        :halt

      true ->
        Agent.update(acc, &consume_wire_chunk(ctx, &1, chunk))
        continue_or_halt(ctx, acc, started, deadline_ms)
    end
  end

  defp continue_or_halt(ctx, acc, started, deadline_ms) do
    cond do
      AdapterExecution.cancelled?(ctx) ->
        :halt

      deadline_exceeded?(started, deadline_ms) ->
        Agent.update(acc, &Map.put(&1, :deadline_exceeded?, true))
        :halt

      true ->
        :cont
    end
  end

  # 总时长兜底默认关闭（nil）；只有部署侧显式配置 deadline 才杀。
  defp deadline_exceeded?(_started, nil), do: false

  defp deadline_exceeded?(started, deadline_ms)
       when is_integer(deadline_ms) and deadline_ms > 0,
       do: System.monotonic_time(:millisecond) - started > deadline_ms

  defp deadline_exceeded?(_started, _deadline_ms), do: false

  defp consume_wire_chunk(ctx, acc, chunk) when is_binary(chunk) do
    buffer =
      (acc.buffer <> chunk)
      |> normalize_newlines()

    {frames, rest} = split_complete_frames(buffer)

    acc =
      acc
      |> Map.put(:buffer, rest)
      |> Map.update!(:wire_chunks, &(&1 + 1))

    frames
    |> List.wrap()
    |> Enum.reduce(acc, fn frame, current -> consume_frame(ctx, current, frame) end)
  end

  defp consume_wire_chunk(ctx, acc, chunk), do: consume_wire_chunk(ctx, acc, to_string(chunk))

  defp flush_buffer(ctx, %{buffer: buffer} = acc) do
    case String.trim(buffer) do
      "" ->
        %{acc | buffer: ""}

      _ ->
        consume_frame(ctx, %{acc | buffer: ""}, buffer)
    end
  end

  defp split_complete_frames(buffer) do
    parts = String.split(buffer, "\n\n")

    if String.ends_with?(buffer, "\n\n") do
      {Enum.reject(parts, &(&1 == "")), ""}
    else
      rest = List.last(parts) || ""

      frames =
        parts
        |> Enum.drop(-1)
        |> Enum.reject(&(&1 == ""))

      {frames, rest}
    end
  end

  defp consume_frame(ctx, acc, frame) do
    case data_payload(frame) do
      "" ->
        acc

      "[DONE]" ->
        acc

      payload ->
        case Jason.decode(payload) do
          {:ok, decoded} when is_map(decoded) ->
            consume_decoded(ctx, acc, decoded)

          _other ->
            %{acc | parse_error?: true}
        end
    end
  end

  defp consume_decoded(ctx, acc, decoded) do
    {decoder_state, update} = acc.decoder.decode(acc.decoder_state, decoded)

    acc =
      acc
      |> Map.put(:decoder_state, decoder_state)
      |> mark_ttft(update)

    append_delta(acc, ctx, Map.get(update, :text, ""))
  end

  defp normalize_newlines(value) do
    value
    |> String.replace("\r\n", "\n")
    |> String.replace("\r", "\n")
  end

  defp data_payload(frame) do
    frame
    |> normalize_newlines()
    |> String.split("\n")
    |> Enum.flat_map(fn line ->
      trimmed = String.trim_leading(line)

      if String.starts_with?(trimmed, "data:") do
        [
          trimmed
          |> String.replace_prefix("data:", "")
          |> String.trim_leading()
        ]
      else
        []
      end
    end)
    |> Enum.join("\n")
    |> String.trim()
  end

  defp mark_ttft(acc, %{activity?: true}) do
    %{acc | ttft_ms: acc.ttft_ms || System.monotonic_time(:millisecond) - acc.started}
  end

  defp mark_ttft(acc, _update), do: acc

  defp append_delta(acc, _ctx, ""), do: acc

  defp append_delta(acc, ctx, content) when is_binary(content) do
    content_length = String.length(content)
    accumulated = acc.accumulated_content_length + content_length
    chunk_index = acc.chunk_index + 1

    {author_delta, author_open?} =
      AdapterExecution.author_reasoning_delta(ctx, content, acc.author_narrative_open?)

    event =
      AdapterExecution.chunk_event!(ctx, acc.next_sequence,
        chunk_index: chunk_index,
        content_length: content_length,
        accumulated_content_length: accumulated,
        author_narrative_delta: author_delta
      )

    AdapterExecution.emit_events(ctx, [event], :running)

    %{
      acc
      | events: [event | acc.events],
        next_sequence: acc.next_sequence + 1,
        chunk_index: chunk_index,
        accumulated_content_length: accumulated,
        author_narrative_open?: author_open?,
        ttft_ms: acc.ttft_ms || System.monotonic_time(:millisecond) - acc.started
    }
  end
end
