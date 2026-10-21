defmodule NovelAgent.Provider.AnthropicStream do
  @moduledoc """
  Adapter-owned Anthropic event-stream execution.

  Anthropic Messages streaming uses named SSE events rather than the
  OpenAI-compatible `choices.delta` shape. This parser stays below Gateway so
  callers still consume the single ProviderExecution fact stream.
  """

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage
  alias NovelFoundation.UpstreamError

  @type eventsource_fn ::
          (String.t(), map(), keyword(), (binary() -> term()) -> HTTP.event_stream_result())

  @doc false
  @spec execute(struct(), String.t(), map(), keyword(), AdapterExecution.context()) ::
          AdapterExecution.execution_result()
  def execute(state, url, body, request_opts, ctx) do
    if AdapterExecution.cancelled?(ctx) do
      AdapterExecution.materialize_cancelled(ctx)
    else
      execute_uncancelled(state, url, body, request_opts, ctx)
    end
  end

  defp execute_uncancelled(state, url, body, request_opts, ctx) do
    started = System.monotonic_time(:millisecond)
    initial_events = AdapterExecution.initial_events(ctx)
    AdapterExecution.emit_events(ctx, initial_events, :running)

    # B22（2026-10-22 作者拍板）：只要模型还在稳定出字就不杀。旧实现用
    # `state.timeout` 做总挂钟杀灭（缺陷九止血阀），对合法长调用会误杀；现在
    # 流式只保留"最长 wire 静默窗口"，总时长兜底默认关闭，失控由 max_tokens 兜住。
    # 与 OpenAICompatibleStream 同构，见该模块 execute_uncancelled 注释。
    deadline_ms = AdapterExecution.deadline_timeout(ctx)
    response_ms = AdapterExecution.response_timeout(ctx, Map.get(state, :timeout) || 300_000)

    {:ok, acc} =
      Agent.start_link(fn ->
        %{
          buffer: "",
          content: [],
          events: [],
          next_sequence: length(initial_events) + 1,
          chunk_index: 0,
          wire_chunks: 0,
          accumulated_content_length: 0,
          author_narrative_open?: true,
          usage: nil,
          model: Map.get(state, :model),
          started: started,
          ttft_ms: nil,
          parse_error?: false,
          provider_error: nil,
          deadline_exceeded?: false
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

    materialize_stream_result(%{
      state: state,
      ctx: ctx,
      initial_events: initial_events,
      acc: final_acc,
      request_result: request_result,
      started: started,
      duration: duration,
      url: url,
      body: body,
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

    Enum.reduce(frames, acc, &consume_frame(ctx, &2, &1))
  end

  defp consume_wire_chunk(ctx, acc, chunk), do: consume_wire_chunk(ctx, acc, to_string(chunk))

  defp flush_buffer(ctx, %{buffer: buffer} = acc) do
    case String.trim(buffer) do
      "" ->
        %{acc | buffer: ""}

      _ ->
        ctx
        |> consume_frame(%{acc | buffer: ""}, buffer)
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

      payload ->
        case Jason.decode(payload) do
          {:ok, decoded} when is_map(decoded) ->
            acc
            |> consume_decoded(ctx, decoded)

          _ ->
            %{acc | parse_error?: true}
        end
    end
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

  defp consume_decoded(acc, _ctx, %{"type" => "message_start", "message" => message})
       when is_map(message) do
    acc
    |> maybe_merge_usage(message["usage"])
    |> maybe_put_model(message["model"])
  end

  defp consume_decoded(acc, ctx, %{"type" => "content_block_delta"} = decoded) do
    acc
    |> mark_ttft()
    |> append_delta(ctx, text_delta(decoded))
  end

  defp consume_decoded(acc, _ctx, %{
         "type" => "content_block_start",
         "content_block" => %{"type" => "tool_use"}
       }) do
    mark_ttft(acc)
  end

  defp consume_decoded(acc, _ctx, %{"type" => "message_delta"} = decoded) do
    maybe_merge_usage(acc, decoded["usage"])
  end

  defp consume_decoded(acc, _ctx, %{"type" => "error", "error" => error}) when is_map(error) do
    %{acc | provider_error: error}
  end

  defp consume_decoded(acc, _ctx, _decoded), do: acc

  defp maybe_merge_usage(acc, usage) when is_map(usage) do
    merged =
      acc.usage
      |> Kernel.||(%{})
      |> Map.merge(usage)

    %{acc | usage: merged}
  end

  defp maybe_merge_usage(acc, _usage), do: acc

  defp maybe_put_model(acc, model) when is_binary(model) and model != "",
    do: %{acc | model: model}

  defp maybe_put_model(acc, _model), do: acc

  defp text_delta(%{"delta" => %{"text" => text}}) when is_binary(text), do: text
  defp text_delta(_decoded), do: ""

  defp mark_ttft(acc) do
    if acc.ttft_ms == nil do
      %{acc | ttft_ms: System.monotonic_time(:millisecond) - acc.started}
    else
      acc
    end
  end

  defp append_delta(acc, _ctx, ""), do: acc

  defp append_delta(acc, ctx, content) do
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
      | content: [content | acc.content],
        events: [event | acc.events],
        next_sequence: acc.next_sequence + 1,
        chunk_index: chunk_index,
        accumulated_content_length: accumulated,
        author_narrative_open?: author_open?,
        ttft_ms: acc.ttft_ms || System.monotonic_time(:millisecond) - acc.started
    }
  end

  defp materialize_stream_result(%{
         state: state,
         ctx: ctx,
         initial_events: initial_events,
         acc: acc,
         request_result: request_result,
         started: started,
         duration: duration,
         url: url,
         body: body,
         response_ms: response_ms,
         deadline_ms: deadline_ms,
         cancelled?: cancelled?
       }) do
    all_events = initial_events ++ Enum.reverse(acc.events)
    timeouts = %{response_ms: response_ms, deadline_ms: deadline_ms}

    cond do
      cancelled? ->
        AdapterExecution.materialize_cancelled(ctx,
          initial_events: all_events,
          emit: :terminal
        )

      Map.get(acc, :deadline_exceeded?, false) ->
        # 只有部署侧显式配置总时长兜底时才会走到这里（默认关闭，见 TimeoutPolicy）。
        provider_result = timeout_error(acc, :deadline, duration, timeouts)

        log_stream_result(state, url, body, provider_result, started)

        AdapterExecution.materialize_result(provider_result.result, ctx,
          initial_events: all_events,
          emit: :terminal
        )

      true ->
        provider_result = provider_result(acc, request_result, duration, timeouts)

        log_stream_result(state, url, body, provider_result, started)

        AdapterExecution.materialize_result(provider_result.result, ctx,
          initial_events: all_events,
          emit: :terminal
        )
    end
  end

  defp provider_result(acc, {:ok, status, _body}, duration, _timeouts) when status in 200..299 do
    usage = usage_from_stream(acc.usage, acc.model, duration) |> Usage.put_ttft(acc.ttft_ms)
    content = acc.content |> Enum.reverse() |> Enum.join()

    cond do
      is_map(acc.provider_error) ->
        provider_error_result(acc.provider_error, status, usage, duration)

      acc.parse_error? ->
        error_result(:parse, "Anthropic API 事件流解析失败", status, usage, duration)

      content == "" ->
        error_result(:invalid_response, "Anthropic API 响应内容为空", status, usage, duration)

      NovelAgent.Provider.degenerate_content?(content) ->
        # 缺陷十：与 openai_compatible_stream 同一判定，托管 API 风险更低但
        # 不作为例外——见该模块同名分支注释。
        error_result(
          :invalid_response,
          "Anthropic API 响应内容退化（低信息熵重复）",
          status,
          usage,
          duration
        )

      true ->
        %{
          result: {:ok, Result.new(content, usage)},
          log_result:
            {:ok, Result.new(content, usage),
             %{status: status, usage: usage, duration: duration, resp_body: "event_stream"}}
        }
    end
  end

  defp provider_result(_acc, {:error, :http_error, status, message}, duration, _timeouts) do
    error_result(http_error_type(status), "Anthropic API: #{message}", status, %{}, duration)
  end

  # 流式"超时"只来自 wire 静默窗口；总时长兜底走 deadline 分支。
  defp provider_result(acc, {:error, :timeout, _status, _message}, duration, timeouts) do
    timeout_error(acc, timeout_kind(acc), duration, timeouts)
  end

  defp provider_result(_acc, {:error, reason, _status, message}, duration, _timeouts) do
    error_result(
      connection_error_type(reason),
      connection_error_message(reason, message),
      0,
      %{},
      duration
    )
  end

  defp provider_result(_acc, other, duration, _timeouts) do
    error_result(
      :provider_internal,
      "unexpected event stream result: #{inspect(other)}",
      0,
      %{},
      duration
    )
  end

  # ── B22 timeout diagnostics ─────────────────

  defp timeout_error(acc, kind, duration, timeouts) do
    details = diagnostics(acc, kind, duration, timeouts)
    message = timeout_message(acc, kind, timeouts)

    error_result(:timeout, message, 0, details, duration, details)
  end

  defp timeout_kind(acc) do
    if acc.ttft_ms == nil and acc.accumulated_content_length == 0,
      do: :connection_stall,
      else: :stream_interrupted
  end

  defp timeout_message(acc, :deadline, timeouts),
    do:
      "Anthropic API 生成超过配置的总时长兜底 #{format_duration(timeouts.deadline_ms)}（已产出 #{acc.accumulated_content_length} 字）"

  defp timeout_message(_acc, :connection_stall, timeouts),
    do: "Anthropic API 在 #{format_duration(timeouts.response_ms)} 内没有返回任何生成内容（可能仍在排队、预填充或思考）"

  defp timeout_message(acc, :stream_interrupted, timeouts),
    do:
      "Anthropic API 输出中断：已生成 #{acc.accumulated_content_length} 字后 #{format_duration(timeouts.response_ms)} 无新内容"

  defp diagnostics(acc, kind, duration, timeouts) do
    %{
      timeout_kind: kind,
      response_timeout_ms: timeouts.response_ms,
      deadline_ms: timeouts.deadline_ms,
      duration_ms: duration,
      ttft_ms: acc.ttft_ms,
      output_chars: acc.accumulated_content_length,
      output_chunks: acc.chunk_index,
      wire_chunks: Map.get(acc, :wire_chunks, 0)
    }
  end

  defp format_duration(ms) when is_integer(ms) and ms >= 60_000,
    do: "#{div(ms, 60_000)} 分钟"

  defp format_duration(ms) when is_integer(ms) and ms >= 1_000, do: "#{div(ms, 1_000)} 秒"

  defp format_duration(ms) when is_integer(ms) and ms > 0, do: "#{ms} 毫秒"
  defp format_duration(_ms), do: "未知时长"

  defp provider_error_result(error, status, usage, duration) do
    type = error["type"] || "provider_error"
    message = error["message"] || inspect(error)
    error_result(provider_error_type(type), "Anthropic API: #{message}", status, usage, duration)
  end

  defp error_result(type, message, status, usage, duration, details \\ %{}) do
    {:error, error} =
      type
      |> UpstreamError.new(message, "anthropic", details)
      |> UpstreamError.to_error_tuple()

    %{
      result: {:error, error},
      log_result:
        {:error, {:error, error},
         %{status: status, usage: usage, duration: duration, resp_body: "event_stream"}}
    }
  end

  defp usage_from_stream(usage, model, duration) when is_map(usage) do
    Usage.from_anthropic_response(%{"usage" => usage, "model" => model}, model, duration)
  end

  defp usage_from_stream(_usage, model, duration), do: Usage.new(0, 0, model, duration)

  defp log_stream_result(%{log_fn: nil}, _url, _body, _provider_result, _started), do: :ok

  defp log_stream_result(state, url, body, provider_result, started) do
    state.log_fn.("anthropic", url, body, provider_result.log_result, started)
  rescue
    _error -> :ok
  end

  defp normalize_newlines(value) do
    value
    |> String.replace("\r\n", "\n")
    |> String.replace("\r", "\n")
  end

  defp http_error_type(status) when status in [401, 403], do: :auth
  defp http_error_type(429), do: :rate_limit
  defp http_error_type(status) when status in [400, 422], do: :invalid_request
  defp http_error_type(_status), do: :provider_internal

  defp provider_error_type(type) when type in ["authentication_error", "permission_error"],
    do: :auth

  defp provider_error_type(type) when type in ["rate_limit_error", "overloaded_error"],
    do: :rate_limit

  defp provider_error_type("invalid_request_error"), do: :invalid_request
  defp provider_error_type(_type), do: :provider_internal

  defp connection_error_type(:connection_refused), do: :connection_refused
  defp connection_error_type(:timeout), do: :timeout
  defp connection_error_type(_reason), do: :provider_internal

  defp connection_error_message(:connection_refused, _message), do: "无法连接 Anthropic API"
  defp connection_error_message(:timeout, _message), do: "Anthropic API 请求超时"
  defp connection_error_message(_reason, message), do: message
end
