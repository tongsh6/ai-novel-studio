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

    {:ok, acc} =
      Agent.start_link(fn ->
        %{
          buffer: "",
          content: [],
          events: [],
          next_sequence: length(initial_events) + 1,
          chunk_index: 0,
          accumulated_content_length: 0,
          usage: nil,
          model: Map.get(state, :model),
          parse_error?: false
        }
      end)

    on_data = &handle_wire_chunk(ctx, acc, &1)

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

  defp handle_wire_chunk(ctx, acc, chunk) do
    if AdapterExecution.cancelled?(ctx) do
      :halt
    else
      Agent.update(acc, &consume_wire_chunk(ctx, &1, chunk))
      continue_or_halt(ctx)
    end
  end

  defp continue_or_halt(ctx) do
    if AdapterExecution.cancelled?(ctx), do: :halt, else: :cont
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

      "[DONE]" ->
        acc

      payload ->
        case Jason.decode(payload) do
          {:ok, decoded} when is_map(decoded) ->
            acc
            |> update_usage(decoded)
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

  defp choice_delta(%{"delta" => %{"content" => content}}) when is_binary(content), do: content
  defp choice_delta(%{"message" => %{"content" => content}}) when is_binary(content), do: content
  defp choice_delta(_choice), do: ""

  defp append_delta(acc, _ctx, ""), do: acc

  defp append_delta(acc, ctx, content) do
    content_length = String.length(content)
    accumulated = acc.accumulated_content_length + content_length
    chunk_index = acc.chunk_index + 1

    event =
      AdapterExecution.chunk_event!(ctx, acc.next_sequence,
        chunk_index: chunk_index,
        content_length: content_length,
        accumulated_content_length: accumulated
      )

    AdapterExecution.emit_events(ctx, [event], :running)

    %{
      acc
      | content: [content | acc.content],
        events: [event | acc.events],
        next_sequence: acc.next_sequence + 1,
        chunk_index: chunk_index,
        accumulated_content_length: accumulated
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
         cancelled?: cancelled?
       }) do
    all_events = initial_events ++ Enum.reverse(acc.events)

    if cancelled? do
      AdapterExecution.materialize_cancelled(ctx,
        initial_events: all_events,
        emit: :terminal
      )
    else
      provider_result = provider_result(meta, acc, request_result, duration)

      log_stream_result(meta, state, url, body, provider_result, started)

      AdapterExecution.materialize_result(provider_result.result, ctx,
        initial_events: all_events,
        emit: :terminal
      )
    end
  end

  defp provider_result(meta, acc, {:ok, status, _body}, duration) when status in 200..299 do
    usage = usage_from_stream(acc.usage, acc.model, duration)
    content = acc.content |> Enum.reverse() |> Enum.join()

    cond do
      acc.parse_error? ->
        error_result(meta, :parse, "#{meta.label} 事件流解析失败", status, usage, duration)

      content == "" ->
        error_result(meta, :invalid_response, "#{meta.label} 响应内容为空", status, usage, duration)

      true ->
        %{
          result: {:ok, Result.new(content, usage)},
          log_result:
            {:ok, Result.new(content, usage),
             %{status: status, usage: usage, duration: duration, resp_body: "event_stream"}}
        }
    end
  end

  defp provider_result(meta, _acc, {:error, :http_error, status, message}, duration) do
    error_result(
      meta,
      http_error_type(status),
      "#{meta.label}: #{message}",
      status,
      %{},
      duration
    )
  end

  defp provider_result(meta, _acc, {:error, reason, _status, message}, duration) do
    error_result(
      meta,
      connection_error_type(reason),
      connection_error_message(meta, reason, message),
      0,
      %{},
      duration
    )
  end

  defp provider_result(meta, _acc, other, duration) do
    error_result(
      meta,
      :provider_internal,
      "unexpected event stream result: #{inspect(other)}",
      0,
      %{},
      duration
    )
  end

  defp error_result(meta, type, message, status, usage, duration) do
    {:error, error} =
      type
      |> UpstreamError.new(message, meta.vendor)
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
