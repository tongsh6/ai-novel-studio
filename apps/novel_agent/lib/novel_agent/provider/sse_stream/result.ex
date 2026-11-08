defmodule NovelAgent.Provider.SSEStream.Result do
  @moduledoc """
  SSE 流的终止物化与错误分类（B71 R2，`NovelAgent.Provider.SSEStream` 的协作模块）。

  统一三 wire 的终止语义：
  - 成功：正文/工具调用/usage 来自同一 decoder 的 finalized 事实；
  - 失败：解析失败、provider 显式错误、空内容、退化内容、HTTP/连接错误；
  - 取消与总时长兜底在 `SSEStream` 主流程分流后进入这里；
  - 诊断字段只用于 JSONL/业务日志，不进入作者可见面。
  """

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelAgent.Provider.Usage
  alias NovelFoundation.UpstreamError

  @doc false
  @spec materialize(map()) :: AdapterExecution.execution_result()
  def materialize(%{
        opts: opts,
        decoder: decoder,
        initial_events: initial_events,
        acc: acc,
        request_result: request_result,
        started: started,
        duration: duration,
        response_ms: response_ms,
        deadline_ms: deadline_ms,
        cancelled?: cancelled?
      }) do
    %{ctx: ctx, url: url, body: body, log_vendor: log_vendor} = opts
    state = opts.state
    all_events = initial_events ++ Enum.reverse(acc.events)
    timeouts = %{response_ms: response_ms, deadline_ms: deadline_ms}

    cond do
      cancelled? ->
        AdapterExecution.materialize_cancelled(ctx,
          initial_events: all_events,
          emit: :terminal
        )

      Map.get(acc, :deadline_exceeded?, false) ->
        provider_result = timeout_error(opts, acc, :deadline, duration, timeouts)

        log_stream_result(state, log_vendor, url, body, provider_result, started)

        AdapterExecution.materialize_result(provider_result.result, ctx,
          initial_events: all_events,
          emit: :terminal
        )

      true ->
        provider_result = provider_result(opts, decoder, acc, request_result, duration, timeouts)

        log_stream_result(state, log_vendor, url, body, provider_result, started)

        AdapterExecution.materialize_result(provider_result.result, ctx,
          initial_events: all_events,
          emit: :terminal
        )
    end
  end

  # ── 结果归一与错误分类 ─────────────────────────────────────────────────────

  defp provider_result(opts, decoder, acc, {:ok, status, _body}, duration, _timeouts)
       when status in 200..299 do
    finalized = decoder.finalize(acc.decoder_state)
    usage = usage_from_stream(finalized, decoder, duration) |> Usage.put_ttft(acc.ttft_ms)
    content = Map.get(finalized, :content) || ""
    tool_calls = Map.get(finalized, :tool_calls) || []

    cond do
      is_map(finalized.error) ->
        error_result(
          opts,
          finalized.error.type,
          "#{opts.label}: #{finalized.error.message}",
          status,
          usage,
          duration
        )

      acc.parse_error? ->
        error_result(opts, :parse, "#{opts.label} 事件流解析失败", status, usage, duration)

      content == "" and tool_calls == [] ->
        error_result(
          opts,
          :invalid_response,
          "#{opts.label} 响应内容为空",
          status,
          usage,
          duration
        )

      NovelAgent.Provider.degenerate_content?(content) ->
        # 缺陷十：采样退化（同一字符/极小循环刷满输出），HTTP 层是正常 200，
        # 只能靠内容层判定拦下，归类可重试——防止低熵垃圾冒充成功结果下传。
        error_result(
          opts,
          :invalid_response,
          "#{opts.label} 响应内容退化（低信息熵重复）",
          status,
          usage,
          duration
        )

      true ->
        result = success_result(opts, finalized, content, usage, tool_calls)

        %{
          result: {:ok, result},
          log_result:
            {:ok, result,
             %{status: status, usage: usage, duration: duration, resp_body: "event_stream"}}
        }
    end
  end

  defp provider_result(opts, _decoder, _acc, {:error, :http_error, status, message}, duration, _t) do
    error_result(
      opts,
      http_error_type(status),
      "#{opts.label}: #{message}",
      status,
      %{},
      duration
    )
  end

  # 流式"超时"只可能来自 wire 静默窗口（Req receive_timeout）；总时长兜底走
  # deadline 分支。诊断必须区分"从未出字"与"出字后中断"。
  defp provider_result(
         opts,
         _decoder,
         acc,
         {:error, :timeout, _status, _message},
         duration,
         timeouts
       ) do
    timeout_error(opts, acc, timeout_kind(acc), duration, timeouts)
  end

  defp provider_result(opts, _decoder, _acc, {:error, reason, _status, message}, duration, _t) do
    error_result(
      opts,
      connection_error_type(reason),
      connection_error_message(opts, reason, message),
      0,
      %{},
      duration
    )
  end

  defp provider_result(opts, _decoder, _acc, other, duration, _timeouts) do
    error_result(
      opts,
      :provider_internal,
      "unexpected event stream result: #{inspect(other)}",
      0,
      %{},
      duration
    )
  end

  # provider 私有状态（如 DeepSeek reasoning_content）由 adapter 通过
  # provider_state_fun 从 decoder 的私有增量绑定成 provider_state；本模块不解释
  # 供应商字段，也不把它写入正文或作者可见事件。
  defp success_result(opts, finalized, content, usage, tool_calls) do
    case Map.get(opts, :provider_state_fun) do
      fun when is_function(fun, 2) ->
        case fun.(finalized, opts.state) do
          %{} = provider_state when map_size(provider_state) > 0 ->
            ProviderResult.new(content, usage,
              tool_calls: tool_calls,
              provider_state: provider_state
            )

          _other ->
            ProviderResult.new(content, usage, tool_calls: tool_calls)
        end

      _other ->
        ProviderResult.new(content, usage, tool_calls: tool_calls)
    end
  end

  defp usage_from_stream(%{usage: usage, model: model}, decoder, duration)
       when is_map(usage) do
    decoder.usage(usage, model, duration)
  end

  defp usage_from_stream(%{model: model}, _decoder, duration) do
    Usage.new(0, 0, model, duration)
  end

  defp usage_from_stream(_finalized, _decoder, duration), do: Usage.new(0, 0, nil, duration)

  # ── 超时诊断 ───────────────────────────────────────────────────────────────

  defp timeout_error(opts, acc, kind, duration, timeouts) do
    details = diagnostics(acc, kind, duration, timeouts)
    message = timeout_message(opts, acc, kind, timeouts)

    # usage 字段在这里只承载诊断（供 llm-calls JSONL / 业务日志），不是计费用量。
    error_result(opts, :timeout, message, 0, details, duration, details)
  end

  defp timeout_kind(acc) do
    if acc.ttft_ms == nil and acc.accumulated_content_length == 0,
      do: :connection_stall,
      else: :stream_interrupted
  end

  defp timeout_message(opts, acc, :deadline, timeouts),
    do:
      "#{opts.label} 生成超过配置的总时长兜底 #{format_duration(timeouts.deadline_ms)}（已产出 #{acc.accumulated_content_length} 字）"

  defp timeout_message(opts, _acc, :connection_stall, timeouts),
    do: "#{opts.label} 在 #{format_duration(timeouts.response_ms)} 内没有返回任何生成内容（可能仍在排队、预填充或思考）"

  defp timeout_message(opts, acc, :stream_interrupted, timeouts),
    do:
      "#{opts.label} 输出中断：已生成 #{acc.accumulated_content_length} 字后 #{format_duration(timeouts.response_ms)} 无新内容"

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

  defp error_result(opts, type, message, status, usage, duration, details \\ %{}) do
    {:error, error} =
      type
      |> UpstreamError.new(message, opts.provider, details)
      |> UpstreamError.to_error_tuple()

    %{
      result: {:error, error},
      log_result:
        {:error, {:error, error},
         %{status: status, usage: usage, duration: duration, resp_body: "event_stream"}}
    }
  end

  defp log_stream_result(%{log_fn: nil}, _vendor, _url, _body, _provider_result, _started),
    do: :ok

  defp log_stream_result(state, vendor, url, body, provider_result, started) do
    state.log_fn.(vendor, url, body, provider_result.log_result, started)
  rescue
    _error -> :ok
  end

  defp http_error_type(status) when status in [401, 402, 403], do: :auth
  defp http_error_type(429), do: :rate_limit
  defp http_error_type(status) when status in [400, 422], do: :invalid_request
  defp http_error_type(_status), do: :provider_internal

  defp connection_error_type(:connection_refused), do: :connection_refused
  defp connection_error_type(:timeout), do: :timeout
  defp connection_error_type(_reason), do: :provider_internal

  defp connection_error_message(opts, :connection_refused, _message),
    do: "无法连接 #{opts.label}"

  defp connection_error_message(opts, :timeout, _message), do: "#{opts.label} 请求超时"
  defp connection_error_message(_opts, _reason, message), do: message
end
