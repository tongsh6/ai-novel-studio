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

    # 与 OpenAICompatibleStream 同一道纵深防御（缺陷九跟进，2026-07-20）：
    # receive_timeout 对流式请求只挡"两个 chunk 之间的间隔"，挡不住模型持续
    # 吐字符但就是停不下来。这里补总时长判定，与各 provider 自己的 max_tokens
    # 无关——挂钟是唯一不随模型换代改变含义的尺子。Anthropic 托管模型失控概率
    # 远低于本地开权重模型，但止血阀是系统不变量，不因单个 provider 风险低就
    # 例外。
    deadline_ms = Map.get(state, :timeout) || 300_000

    {:ok, acc} =
      Agent.start_link(fn ->
        %{
          buffer: "",
          content: [],
          events: [],
          next_sequence: length(initial_events) + 1,
          chunk_index: 0,
          accumulated_content_length: 0,
          author_narrative_open?: true,
          usage: nil,
          model: Map.get(state, :model),
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

      System.monotonic_time(:millisecond) - started > deadline_ms ->
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

      System.monotonic_time(:millisecond) - started > deadline_ms ->
        Agent.update(acc, &Map.put(&1, :deadline_exceeded?, true))
        :halt

      true ->
        :cont
    end
  end

  defp consume_wire_chunk(ctx, acc, chunk) when is_binary(chunk) do
    buffer =
      (acc.buffer <> chunk)
      |> normalize_newlines()

    {frames, rest} = split_complete_frames(buffer)

    acc =
      acc
      |> Map.put(:buffer, rest)

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
    append_delta(acc, ctx, text_delta(decoded))
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
        author_narrative_open?: author_open?
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
         cancelled?: cancelled?
       }) do
    all_events = initial_events ++ Enum.reverse(acc.events)

    cond do
      cancelled? ->
        AdapterExecution.materialize_cancelled(ctx,
          initial_events: all_events,
          emit: :terminal
        )

      Map.get(acc, :deadline_exceeded?, false) ->
        provider_result =
          error_result(:timeout, "Anthropic API 生成超过挂钟时长上限", 0, %{}, duration)

        log_stream_result(state, url, body, provider_result, started)

        AdapterExecution.materialize_result(provider_result.result, ctx,
          initial_events: all_events,
          emit: :terminal
        )

      true ->
        provider_result = provider_result(acc, request_result, duration)

        log_stream_result(state, url, body, provider_result, started)

        AdapterExecution.materialize_result(provider_result.result, ctx,
          initial_events: all_events,
          emit: :terminal
        )
    end
  end

  defp provider_result(acc, {:ok, status, _body}, duration) when status in 200..299 do
    usage = usage_from_stream(acc.usage, acc.model, duration)
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

  defp provider_result(_acc, {:error, :http_error, status, message}, duration) do
    error_result(http_error_type(status), "Anthropic API: #{message}", status, %{}, duration)
  end

  defp provider_result(_acc, {:error, reason, _status, message}, duration) do
    error_result(
      connection_error_type(reason),
      connection_error_message(reason, message),
      0,
      %{},
      duration
    )
  end

  defp provider_result(_acc, other, duration) do
    error_result(
      :provider_internal,
      "unexpected event stream result: #{inspect(other)}",
      0,
      %{},
      duration
    )
  end

  defp provider_error_result(error, status, usage, duration) do
    type = error["type"] || "provider_error"
    message = error["message"] || inspect(error)
    error_result(provider_error_type(type), "Anthropic API: #{message}", status, usage, duration)
  end

  defp error_result(type, message, status, usage, duration) do
    {:error, error} =
      type
      |> UpstreamError.new(message, "anthropic")
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
