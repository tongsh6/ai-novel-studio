defmodule NovelAgent.Provider.OpenAICompatibleStream do
  @moduledoc """
  Adapter-owned OpenAI-compatible event-stream execution.

  This module is intentionally below `Provider.Gateway`: it handles wire-level
  SSE chunks for adapters, while Gateway and application callers still consume
  the single ProviderExecution fact stream.
  """

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage
  alias NovelFoundation.UpstreamError

  @type meta :: %{
          required(:vendor) => String.t(),
          required(:label) => String.t()
        }

  @type eventsource_fn ::
          (String.t(), map(), keyword(), (binary() -> term()) -> HTTP.event_stream_result())

  @doc false
  @spec execute(meta(), struct(), String.t(), map(), keyword(), AdapterExecution.context()) ::
          AdapterExecution.execution_result()
  def execute(meta, state, url, body, request_opts, ctx) do
    if AdapterExecution.cancelled?(ctx) do
      AdapterExecution.materialize_cancelled(ctx)
    else
      execute_uncancelled(meta, state, url, body, request_opts, ctx)
    end
  end

  defp execute_uncancelled(meta, state, url, body, request_opts, ctx) do
    started = System.monotonic_time(:millisecond)
    initial_events = AdapterExecution.initial_events(ctx)
    AdapterExecution.emit_events(ctx, initial_events, :running)

    # B22（2026-10-22 作者拍板）：只要模型还在稳定出字就不杀。
    #
    # 旧实现用 `state.timeout` 做总挂钟杀灭（缺陷九止血阀，2026-07-20），在
    # "本机模型慢、思考型调用可合法跑 10–60 分钟"的场景下会误杀健康长调用
    # （实测 300s 挂钟已误杀 3 次）。现在：
    #   * 流式请求的 `receive_timeout` 只承担"最长 wire 静默窗口"（有数据就续命）；
    #   * 总时长兜底默认关闭，只有部署侧显式配置 deadline 才启用；
    #   * "该停不停"由 provider 的 max_tokens 预算兜住，不再靠挂钟。
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
      meta: meta,
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

      "[DONE]" ->
        acc

      payload ->
        case Jason.decode(payload) do
          {:ok, decoded} when is_map(decoded) ->
            acc
            |> update_usage(decoded)
            |> mark_ttft(decoded)
            |> append_delta(ctx, delta_content(decoded))

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

  defp update_usage(acc, decoded) do
    acc
    |> maybe_put_usage(decoded["usage"])
    |> maybe_put_model(decoded["model"])
  end

  defp maybe_put_usage(acc, usage) when is_map(usage), do: %{acc | usage: usage}
  defp maybe_put_usage(acc, _usage), do: acc

  defp maybe_put_model(acc, model) when is_binary(model) and model != "",
    do: %{acc | model: model}

  defp maybe_put_model(acc, _model), do: acc

  defp delta_content(%{"choices" => choices}) when is_list(choices) do
    Enum.map_join(choices, "", &choice_delta/1)
  end

  defp delta_content(_decoded), do: ""

  defp mark_ttft(acc, decoded) do
    if acc.ttft_ms == nil and (delta_content(decoded) != "" or tool_call_delta?(decoded)) do
      %{acc | ttft_ms: System.monotonic_time(:millisecond) - acc.started}
    else
      acc
    end
  end

  defp tool_call_delta?(%{"choices" => choices}) when is_list(choices) do
    Enum.any?(choices, fn
      %{"delta" => %{"tool_calls" => calls}} -> is_list(calls) and calls != []
      _ -> false
    end)
  end

  defp tool_call_delta?(_decoded), do: false

  defp choice_delta(%{"delta" => %{"content" => content}}) when is_binary(content), do: content
  defp choice_delta(%{"message" => %{"content" => content}}) when is_binary(content), do: content
  defp choice_delta(_choice), do: ""

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
         meta: meta,
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
        provider_result = timeout_error(meta, acc, :deadline, duration, timeouts)

        log_stream_result(meta, state, url, body, provider_result, started)

        AdapterExecution.materialize_result(provider_result.result, ctx,
          initial_events: all_events,
          emit: :terminal
        )

      true ->
        provider_result = provider_result(meta, acc, request_result, duration, timeouts)

        log_stream_result(meta, state, url, body, provider_result, started)

        AdapterExecution.materialize_result(provider_result.result, ctx,
          initial_events: all_events,
          emit: :terminal
        )
    end
  end

  defp provider_result(meta, acc, {:ok, status, _body}, duration, _timeouts)
       when status in 200..299 do
    usage = usage_from_stream(acc.usage, acc.model, duration) |> Usage.put_ttft(acc.ttft_ms)
    content = acc.content |> Enum.reverse() |> Enum.join()

    cond do
      acc.parse_error? ->
        error_result(meta, :parse, "#{meta.label} 事件流解析失败", status, usage, duration)

      content == "" ->
        error_result(meta, :invalid_response, "#{meta.label} 响应内容为空", status, usage, duration)

      NovelAgent.Provider.degenerate_content?(content) ->
        # 缺陷十：采样退化（同一字符/极小循环刷满输出），HTTP 层是正常 200，
        # 只能靠内容层判定拦下，归类可重试——防止低熵垃圾冒充成功结果下传。
        error_result(
          meta,
          :invalid_response,
          "#{meta.label} 响应内容退化（低信息熵重复）",
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

  defp provider_result(meta, _acc, {:error, :http_error, status, message}, duration, _timeouts) do
    error_result(
      meta,
      http_error_type(status),
      "#{meta.label}: #{message}",
      status,
      %{},
      duration
    )
  end

  # 流式请求的"超时"只可能来自 wire 静默窗口（Req receive_timeout）；总时长兜底
  # 走上面的 deadline 分支。诊断必须区分"从未出字"与"出字后中断"。
  defp provider_result(meta, acc, {:error, :timeout, _status, _message}, duration, timeouts) do
    timeout_error(meta, acc, timeout_kind(acc), duration, timeouts)
  end

  defp provider_result(meta, _acc, {:error, reason, _status, message}, duration, _timeouts) do
    error_result(
      meta,
      connection_error_type(reason),
      connection_error_message(meta, reason, message),
      0,
      %{},
      duration
    )
  end

  defp provider_result(meta, _acc, other, duration, _timeouts) do
    error_result(
      meta,
      :provider_internal,
      "unexpected event stream result: #{inspect(other)}",
      0,
      %{},
      duration
    )
  end

  # ── B22 timeout diagnostics ─────────────────

  defp timeout_error(meta, acc, kind, duration, timeouts) do
    details = diagnostics(acc, kind, duration, timeouts)
    message = timeout_message(meta, acc, kind, timeouts)

    # usage 字段在这里只承载诊断（供 llm-calls JSONL / 业务日志），不是计费用量。
    error_result(meta, :timeout, message, 0, details, duration, details)
  end

  # 区分两种"没有进展"：一次都没出过生成内容（排队/预填充/静默思考），
  # 还是出过内容之后 wire 静默（流中断）。作者文案与 reason code 都依赖这个分类。
  defp timeout_kind(acc) do
    if acc.ttft_ms == nil and acc.accumulated_content_length == 0,
      do: :connection_stall,
      else: :stream_interrupted
  end

  defp timeout_message(meta, acc, :deadline, timeouts),
    do:
      "#{meta.label} 生成超过配置的总时长兜底 #{format_duration(timeouts.deadline_ms)}（已产出 #{acc.accumulated_content_length} 字）"

  defp timeout_message(meta, _acc, :connection_stall, timeouts),
    do: "#{meta.label} 在 #{format_duration(timeouts.response_ms)} 内没有返回任何生成内容（可能仍在排队、预填充或思考）"

  defp timeout_message(meta, acc, :stream_interrupted, timeouts),
    do:
      "#{meta.label} 输出中断：已生成 #{acc.accumulated_content_length} 字后 #{format_duration(timeouts.response_ms)} 无新内容"

  defp timeout_message(meta, _acc, _kind, _timeouts), do: "#{meta.label} 请求超时"

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

  defp error_result(meta, type, message, status, usage, duration, details \\ %{}) do
    {:error, error} =
      type
      |> UpstreamError.new(message, meta.vendor, details)
      |> UpstreamError.to_error_tuple()

    %{
      result: {:error, error},
      log_result:
        {:error, {:error, error},
         %{status: status, usage: usage, duration: duration, resp_body: "event_stream"}}
    }
  end

  defp usage_from_stream(usage, model, duration) when is_map(usage) do
    Usage.from_openai_response(%{"usage" => usage, "model" => model}, model, duration)
  end

  defp usage_from_stream(_usage, model, duration), do: Usage.new(0, 0, model, duration)

  defp log_stream_result(_meta, %{log_fn: nil}, _url, _body, _provider_result, _started), do: :ok

  defp log_stream_result(meta, state, url, body, provider_result, started) do
    state.log_fn.(meta.vendor, url, body, provider_result.log_result, started)
  rescue
    _error -> :ok
  end

  defp normalize_newlines(value) do
    value
    |> String.replace("\r\n", "\n")
    |> String.replace("\r", "\n")
  end

  defp http_error_type(status) when status in [401, 402, 403], do: :auth
  defp http_error_type(429), do: :rate_limit
  defp http_error_type(status) when status in [400, 422], do: :invalid_request
  defp http_error_type(_status), do: :provider_internal

  defp connection_error_type(:connection_refused), do: :connection_refused
  defp connection_error_type(:timeout), do: :timeout
  defp connection_error_type(_reason), do: :provider_internal

  defp connection_error_message(meta, :connection_refused, _message), do: "无法连接 #{meta.label}"
  defp connection_error_message(meta, :timeout, _message), do: "#{meta.label} 请求超时"
  defp connection_error_message(_meta, _reason, message), do: message
end
