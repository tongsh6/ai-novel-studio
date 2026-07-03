defmodule NovelAgent.Provider.AdapterExecution do
  @moduledoc """
  Adapter-side materializer for the unified provider execution stream.

  Provider APIs may still be final-only at the wire level, but their adapter
  boundary must publish the same ProviderRun / ProviderEvent / ProviderOutput
  facts. Gateway selects the adapter; this module owns the projection from
  adapter callback result to execution facts.
  """

  alias NovelAgent.Provider
  alias NovelAgent.Provider.CancellationToken
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage
  alias NovelCommon.Contracts.ProviderEvent
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.Contracts.ProviderRun

  @author_reasoning_delta_chunk_size 8

  @type context :: %{
          required(:provider_name) => atom(),
          required(:model_name) => String.t() | nil,
          required(:provider_call_ref) => String.t(),
          required(:provider_run_id) => String.t(),
          required(:purpose) => ProviderRun.purpose(),
          required(:owner_refs) => map(),
          optional(:cancellation_token) => CancellationToken.t() | nil,
          optional(:event_sink) => (execution_result() -> term()) | nil
        }

  @type execution_success :: %{
          provider_run: ProviderRun.t(),
          events: [ProviderEvent.t()],
          output: ProviderOutput.t(),
          result: Result.t()
        }

  @type execution_error :: %{
          provider_run: ProviderRun.t(),
          events: [ProviderEvent.t()],
          output: ProviderOutput.t(),
          error: map()
        }

  @type execution_result :: {:ok, execution_success()} | {:error, execution_error()}

  @spec execute(
          module(),
          term(),
          String.t() | nil,
          Provider.prompt(),
          InferenceParams.t(),
          context()
        ) :: execution_result()
  def execute(module, state, model, prompt, params, ctx) do
    if cancelled?(ctx) do
      materialize_cancelled(ctx)
    else
      execute_uncancelled(module, state, model, prompt, params, ctx)
    end
  end

  defp execute_uncancelled(module, state, model, prompt, params, ctx) do
    initial_events = initial_events(ctx)
    emit_events(ctx, initial_events, :running)

    result = module.complete(state, model, prompt, params)

    if cancelled?(ctx) do
      materialize_cancelled(ctx, initial_events: initial_events, emit: :terminal)
    else
      materialize_result(result, ctx, initial_events: initial_events, emit: :terminal)
    end
  end

  @doc "Initial provider execution facts shared by all adapters."
  @spec initial_events(context()) :: [ProviderEvent.t()]
  def initial_events(ctx) do
    [
      start_event!(ctx),
      progress_event!(ctx, 2, :request_prepared, "Provider request prepared."),
      progress_event!(ctx, 3, :request_dispatched, "Provider request dispatched.")
    ]
  end

  @doc """
  Build author-safe text chunk events for an adapter-owned execution.

  Chunk payloads intentionally carry only sequence/length metadata. The final
  provider output remains the only place where generated text is materialized.
  """
  @spec text_chunk_events(context(), String.t(), pos_integer()) :: [ProviderEvent.t()]
  def text_chunk_events(ctx, content, first_sequence) when is_integer(first_sequence) do
    content
    |> text_chunks(ctx)
    |> Enum.with_index(1)
    |> Enum.reduce({[], 0, true}, fn {chunk, index}, {events, accumulated, author_open?} ->
      length = String.length(chunk)
      next_accumulated = accumulated + length
      {author_delta, next_author_open?} = author_reasoning_delta(ctx, chunk, author_open?)

      event =
        chunk_event!(ctx, first_sequence + index - 1,
          chunk_index: index,
          content_length: length,
          accumulated_content_length: next_accumulated,
          author_narrative_delta: author_delta
        )

      {[event | events], next_accumulated, next_author_open?}
    end)
    |> elem(0)
    |> Enum.reverse()
  end

  @doc "Build one author-safe chunk event without carrying raw generated text."
  @spec chunk_event!(context(), pos_integer(), keyword()) :: ProviderEvent.t()
  def chunk_event!(ctx, sequence, attrs \\ []) do
    chunk_index = Keyword.get(attrs, :chunk_index, sequence)
    content_length = Keyword.get(attrs, :content_length, 0)
    accumulated_content_length = Keyword.get(attrs, :accumulated_content_length, content_length)

    payload =
      %{
        provider: ctx.provider_name,
        model: ctx.model_name,
        output_type: :text,
        chunk_index: chunk_index,
        content_length: content_length,
        accumulated_content_length: accumulated_content_length
      }
      |> maybe_put_payload(:author_narrative_delta, Keyword.get(attrs, :author_narrative_delta))

    provider_event!(
      event_id: provider_event_id(),
      provider_run_ref: ctx.provider_run_id,
      sequence: sequence,
      event_type: :chunk,
      summary: "Provider output chunk received.",
      payload: payload,
      refs: [ctx.provider_call_ref]
    )
  end

  @doc """
  Extract the author-visible reasoning delta from an `:author_reasoning` chunk.

  Agentic next-step provider output is a two-part stream: author-visible prose
  followed by a JSON tail. Only prose before the first JSON object boundary may
  be projected to the UI while the provider is still streaming.
  """
  @spec author_reasoning_delta(context(), String.t(), boolean()) ::
          {String.t() | nil, boolean()}
  def author_reasoning_delta(ctx, content, author_open?) when is_binary(content) do
    if author_reasoning_purpose?(ctx) and author_open? do
      split_author_reasoning_delta(content)
    else
      {nil, author_open?}
    end
  end

  def author_reasoning_delta(_ctx, _content, author_open?), do: {nil, author_open?}

  @doc "Emit a batch of execution events to the optional adapter event sink."
  @spec emit_events(context(), [ProviderEvent.t()], atom(), ProviderOutput.t() | nil, map() | nil) ::
          :ok
  def emit_events(ctx, events, status, output \\ nil, error \\ nil),
    do: emit_event_batch(ctx, events, status, output, error)

  @doc "Returns true when the current provider execution token has been cancelled."
  @spec cancelled?(context()) :: boolean()
  def cancelled?(%{cancellation_token: token}), do: CancellationToken.cancelled?(token)
  def cancelled?(_ctx), do: false

  @doc """
  Materialize provider cancellation into ProviderExecution facts.

  This is the only terminal cancellation shape adapters should return. It keeps
  cancellation in the same ProviderRun / ProviderEvent / ProviderOutput stream
  as normal success and failure.
  """
  @spec materialize_cancelled(context(), keyword()) :: execution_result()
  def materialize_cancelled(ctx, opts \\ []) do
    initial_events = Keyword.get(opts, :initial_events, [start_event!(ctx)])
    emit_mode = Keyword.get(opts, :emit, :all)
    error = cancellation_error(ctx)

    execution_result =
      {:error,
       %{
         provider_run: provider_run!(ctx, :cancelled),
         events: initial_events ++ cancellation_events!(ctx, length(initial_events), error),
         output: provider_cancelled_output!(ctx, error),
         error: error
       }}

    emit_materialized_events(ctx, execution_result, emit_mode, length(initial_events))
    execution_result
  end

  @doc """
  Materialize an adapter callback result into the unified provider execution facts.

  Custom adapters that already own lower-level execution callbacks should call
  this function for their terminal result instead of returning a separate shape.
  """
  @spec materialize_result(Provider.result() | term(), context()) :: execution_result()
  def materialize_result(result, ctx, opts \\ []) do
    initial_events = Keyword.get(opts, :initial_events, [start_event!(ctx)])
    emit_mode = Keyword.get(opts, :emit, :all)

    execution_result =
      case normalize_provider_result(result) do
        {:ok, %Result{} = provider_result} ->
          {:ok,
           %{
             provider_run: provider_run!(ctx, :completed),
             events:
               initial_events ++ success_events!(ctx, provider_result, length(initial_events)),
             output: provider_output!(ctx, provider_result),
             result: provider_result
           }}

        {:error, error} ->
          normalized = normalize_error_map(error)

          {:error,
           %{
             provider_run: provider_run!(ctx, :failed),
             events:
               initial_events ++ [error_event!(ctx, length(initial_events) + 1, normalized)],
             output: provider_error_output!(ctx, normalized),
             error: normalized
           }}
      end

    emit_materialized_events(ctx, execution_result, emit_mode, length(initial_events))
    execution_result
  end

  defp normalize_provider_result({:ok, %Result{} = result}), do: {:ok, result}

  defp normalize_provider_result({:ok, content}) when is_binary(content),
    do: {:ok, Result.new(content)}

  defp normalize_provider_result({:error, error}), do: {:error, error}

  defp normalize_provider_result(other),
    do: {:error, %{message: inspect(other), type: :provider_error}}

  defp start_event!(ctx) do
    provider_event!(
      event_id: provider_event_id(),
      provider_run_ref: ctx.provider_run_id,
      sequence: 1,
      event_type: :started,
      summary: "Provider execution started.",
      payload: %{provider: ctx.provider_name, model: ctx.model_name},
      refs: [ctx.provider_call_ref]
    )
  end

  defp progress_event!(ctx, sequence, phase, summary) do
    provider_event!(
      event_id: provider_event_id(),
      provider_run_ref: ctx.provider_run_id,
      sequence: sequence,
      event_type: :progress,
      summary: summary,
      payload: %{
        phase: phase,
        provider: ctx.provider_name,
        model: ctx.model_name
      },
      refs: [ctx.provider_call_ref]
    )
  end

  defp provider_run!(ctx, status) do
    {:ok, run} =
      ProviderRun.new(%{
        provider_run_id: ctx.provider_run_id,
        provider_call_ref: ctx.provider_call_ref,
        purpose: ctx.purpose,
        execution_mode: :event_stream,
        provider_id: to_string(ctx.provider_name),
        model: ctx.model_name,
        status: status,
        owner_refs: ctx.owner_refs
      })

    run
  end

  defp success_events!(ctx, %Result{} = result, initial_count) do
    usage = Usage.to_map(result.usage)
    response_sequence = initial_count + 1
    usage_sequence = response_sequence + 1
    final_sequence = if map_size(usage) > 0, do: usage_sequence + 1, else: usage_sequence

    [
      response_received_event!(ctx, response_sequence, result)
    ] ++
      usage_recorded_events!(ctx, usage_sequence, usage) ++
      [final_output_event!(ctx, final_sequence, result, usage)]
  end

  defp response_received_event!(ctx, sequence, %Result{} = result) do
    provider_event!(
      event_id: provider_event_id(),
      provider_run_ref: ctx.provider_run_id,
      sequence: sequence,
      event_type: :progress,
      summary: "Provider response received.",
      payload: %{
        phase: :response_received,
        output_type: :text,
        content_length: result.content |> to_string() |> String.length()
      },
      refs: [ctx.provider_call_ref]
    )
  end

  defp usage_recorded_events!(_ctx, _sequence, usage) when map_size(usage) == 0, do: []

  defp usage_recorded_events!(ctx, sequence, usage) do
    [
      provider_event!(
        event_id: provider_event_id(),
        provider_run_ref: ctx.provider_run_id,
        sequence: sequence,
        event_type: :usage_recorded,
        summary: "Provider usage recorded.",
        payload: %{usage: usage},
        refs: [ctx.provider_call_ref]
      )
    ]
  end

  defp final_output_event!(ctx, sequence, %Result{} = result, usage) do
    provider_event!(
      event_id: provider_event_id(),
      provider_run_ref: ctx.provider_run_id,
      sequence: sequence,
      event_type: :final_output,
      visibility: :developer,
      summary: "Provider final output materialized.",
      payload: %{
        content_length: result.content |> to_string() |> String.length(),
        usage: usage
      },
      refs: [ctx.provider_call_ref]
    )
  end

  defp error_event!(ctx, sequence, error) do
    provider_event!(
      event_id: provider_event_id(),
      provider_run_ref: ctx.provider_run_id,
      sequence: sequence,
      event_type: :error,
      visibility: :developer,
      summary: "Provider execution failed.",
      payload: %{
        reason_code: Map.get(error, :type, :provider_error),
        message: Map.get(error, :message)
      },
      refs: [ctx.provider_call_ref]
    )
  end

  defp cancellation_events!(ctx, initial_count, error) do
    [
      cancel_requested_event!(ctx, initial_count + 1, error),
      cancelled_event!(ctx, initial_count + 2, error)
    ]
  end

  defp cancel_requested_event!(ctx, sequence, error) do
    provider_event!(
      event_id: provider_event_id(),
      provider_run_ref: ctx.provider_run_id,
      sequence: sequence,
      event_type: :cancel_requested,
      summary: "Provider cancellation requested.",
      payload: %{
        provider: ctx.provider_name,
        model: ctx.model_name,
        reason_code: Map.get(error, :type, :cancelled),
        reason: Map.get(error, :reason)
      },
      refs: [ctx.provider_call_ref]
    )
  end

  defp cancelled_event!(ctx, sequence, error) do
    provider_event!(
      event_id: provider_event_id(),
      provider_run_ref: ctx.provider_run_id,
      sequence: sequence,
      event_type: :cancelled,
      summary: "Provider execution cancelled.",
      payload: %{
        provider: ctx.provider_name,
        model: ctx.model_name,
        reason_code: Map.get(error, :type, :cancelled),
        reason: Map.get(error, :reason)
      },
      refs: [ctx.provider_call_ref]
    )
  end

  defp emit_materialized_events(ctx, execution_result, :all, _initial_count) do
    execution_result
    |> execution_facts()
    |> case do
      nil ->
        :ok

      facts ->
        emit_event_batch(
          ctx,
          facts.events,
          facts.provider_run.status,
          Map.get(facts, :output),
          Map.get(facts, :error)
        )
    end

    execution_result
  end

  defp emit_materialized_events(ctx, execution_result, :terminal, initial_count) do
    execution_result
    |> execution_facts()
    |> case do
      nil ->
        :ok

      facts ->
        emit_event_batch(
          ctx,
          Enum.drop(facts.events, initial_count),
          facts.provider_run.status,
          Map.get(facts, :output),
          Map.get(facts, :error)
        )
    end

    execution_result
  end

  defp emit_materialized_events(_ctx, execution_result, _mode, _initial_count),
    do: execution_result

  defp execution_facts({:ok, facts}) when is_map(facts), do: facts
  defp execution_facts({:error, facts}) when is_map(facts), do: facts
  defp execution_facts(_), do: nil

  defp emit_event_batch(ctx, events, status, output, error)

  defp emit_event_batch(%{event_sink: event_sink} = ctx, events, status, output, error)
       when is_function(event_sink, 1) do
    Enum.each(events, fn event ->
      event_sink.(single_event_execution(ctx, event, status, output, error))
    end)
  rescue
    _error -> :ok
  end

  defp emit_event_batch(_ctx, _events, _status, _output, _error), do: :ok

  defp author_reasoning_purpose?(ctx) when is_map(ctx),
    do: Map.get(ctx, :purpose) in [:author_reasoning, "author_reasoning"]

  defp author_reasoning_purpose?(_ctx), do: false

  defp split_author_reasoning_delta(content) do
    case String.split(content, "{", parts: 2) do
      [before_json, _after_json] -> {non_empty_string(before_json), false}
      [delta] -> {non_empty_string(delta), true}
    end
  end

  defp non_empty_string(""), do: nil
  defp non_empty_string(value), do: value

  defp maybe_put_payload(payload, _key, nil), do: payload
  defp maybe_put_payload(payload, _key, ""), do: payload
  defp maybe_put_payload(payload, key, value), do: Map.put(payload, key, value)

  defp safe_text_chunks(content) do
    text = to_string(content)
    length = String.length(text)
    chunk_size = max(ceil_div(length, 3), 1)

    text
    |> String.graphemes()
    |> Enum.chunk_every(chunk_size)
    |> Enum.map(&Enum.join/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp text_chunks(content, ctx) do
    text = to_string(content)

    if author_reasoning_purpose?(ctx) do
      author_reasoning_text_chunks(text)
    else
      safe_text_chunks(text)
    end
  end

  defp author_reasoning_text_chunks(content) do
    {author_prefix, json_tail} = split_before_json_tail(content)

    fixed_text_chunks(author_prefix, @author_reasoning_delta_chunk_size) ++
      safe_text_chunks(json_tail)
  end

  defp split_before_json_tail(content) do
    case String.split(content, "{", parts: 2) do
      [before_json, after_json] -> {before_json, "{" <> after_json}
      [text] -> {text, ""}
    end
  end

  defp fixed_text_chunks("", _chunk_size), do: []

  defp fixed_text_chunks(text, chunk_size) do
    text
    |> String.graphemes()
    |> Enum.chunk_every(chunk_size)
    |> Enum.map(&Enum.join/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp ceil_div(value, divisor) when value <= 0, do: divisor
  defp ceil_div(value, divisor), do: div(value + divisor - 1, divisor)

  defp single_event_execution(ctx, event, status, output, error) do
    facts =
      %{
        provider_run: provider_run!(ctx, status),
        events: [event]
      }
      |> maybe_put(:output, output)
      |> maybe_put(:error, error)

    if status in [:failed, :cancelled], do: {:error, facts}, else: {:ok, facts}
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp provider_event!(attrs) do
    {:ok, event} = ProviderEvent.new(attrs)
    event
  end

  defp provider_output!(ctx, %Result{} = result) do
    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: ctx.provider_run_id,
        provider_call_ref: ctx.provider_call_ref,
        status: :ok,
        output_type: :text,
        content: %{text: result.content},
        usage: Usage.to_map(result.usage),
        refs: [ctx.provider_call_ref]
      })

    output
  end

  defp provider_error_output!(ctx, error) do
    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: ctx.provider_run_id,
        provider_call_ref: ctx.provider_call_ref,
        status: :error,
        output_type: :empty,
        error: error,
        refs: [ctx.provider_call_ref]
      })

    output
  end

  defp provider_cancelled_output!(ctx, error) do
    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: ctx.provider_run_id,
        provider_call_ref: ctx.provider_call_ref,
        status: :cancelled,
        output_type: :empty,
        error: error,
        refs: [ctx.provider_call_ref]
      })

    output
  end

  defp cancellation_error(ctx) do
    reason =
      ctx
      |> Map.get(:cancellation_token)
      |> CancellationToken.reason()
      |> normalize_cancel_reason()

    %{
      type: :cancelled,
      message: "Provider execution cancelled.",
      reason: reason,
      retryable: false
    }
  end

  defp normalize_cancel_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp normalize_cancel_reason(reason) when is_binary(reason), do: reason
  defp normalize_cancel_reason(_reason), do: "author_cancelled"

  defp normalize_error_map(error) when is_map(error), do: error
  defp normalize_error_map(error), do: %{message: inspect(error), type: :provider_error}

  defp provider_event_id, do: NovelFoundation.ID.unique("pevt")
end
