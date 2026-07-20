defmodule NovelAgent.Provider.Execution do
  @moduledoc """
  Provider execution dependency boundary.

  Callers pass a `%Provider.Execution{}` dependency instead of a raw final-result
  callback. The dependency exposes a one-argument result callback only as an
  internal final-result consumer; public dependency inputs stay on the unified
  ProviderExecution runtime.
  """

  alias NovelAgent.Provider
  alias NovelAgent.Provider.CancellationToken
  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}

  defstruct [
    :result_fn,
    :execute_fn,
    :purpose,
    :gateway_opts,
    :cancellation_token,
    metadata: %{}
  ]

  @type execution_result :: Gateway.execution_result()
  @type result :: {:ok, Result.t()} | {:error, map()}
  @type result_fun :: (Provider.prompt() -> result())
  @type execute_fun :: (Provider.prompt() -> execution_result())

  @type t :: %__MODULE__{
          result_fn: result_fun(),
          execute_fn: execute_fun(),
          purpose: atom() | nil,
          gateway_opts: keyword() | nil,
          cancellation_token: CancellationToken.t() | nil,
          metadata: map()
        }

  @type dependency :: t() | nil

  # 缺陷九（2026-07-20）：这是全系统唯一一处不显式传 :params 就会用到的默认值
  # funnel——正文起草/质量评估/人物设计/情节大纲/世界观/角色演化/对话规划全部经此，
  # 全仓只有 judgment_protocol.ex 显式调过 with_params。默认值必须是 InferenceParams.new()
  # （带 max_tokens 止血阀），不能是裸 %InferenceParams{}（defstruct 字段全 nil=无界），
  # 否则止血阀形同虚设——实测过：写作调用能跑到 36000+ token 不停。
  @spec execute(Provider.prompt(), keyword()) :: execution_result()
  def execute(prompt, opts \\ []) do
    model = Keyword.get(opts, :model)
    params = Keyword.get(opts, :params, InferenceParams.new())
    gateway_opts = Keyword.drop(opts, [:model, :params])

    Gateway.execute(prompt, model, params, gateway_opts)
  end

  @spec complete(Provider.prompt(), keyword()) :: result()
  def complete(prompt, opts \\ []) do
    case execute(prompt, opts) do
      {:ok, %{result: %Result{} = result} = execution} ->
        {:ok, Result.with_execution(result, execution)}

      {:error, %{error: error}} ->
        {:error, error}
    end
  end

  @spec dependency(keyword()) :: t()
  def dependency(opts \\ []) do
    cancellation_token = Keyword.get(opts, :cancellation_token)

    %__MODULE__{
      result_fn: fn prompt -> complete(prompt, opts) end,
      execute_fn: fn prompt -> execute(prompt, opts) end,
      purpose: Keyword.get(opts, :purpose),
      gateway_opts: opts,
      cancellation_token: cancellation_token,
      metadata: Map.new(Keyword.drop(opts, [:model, :params, :event_sink, :cancellation_token]))
    }
  end

  @spec start_cancellation_token(map()) :: Agent.on_start()
  def start_cancellation_token(metadata \\ %{}), do: CancellationToken.start_link(metadata)

  @spec cancel(dependency() | CancellationToken.t(), CancellationToken.reason()) :: :ok
  def cancel(dependency_or_token, reason \\ :author_cancelled)

  def cancel(%__MODULE__{cancellation_token: token}, reason),
    do: CancellationToken.cancel(token, reason)

  def cancel(token, reason), do: CancellationToken.cancel(token, reason)

  @spec cancelled?(dependency() | CancellationToken.t()) :: boolean()
  def cancelled?(%__MODULE__{cancellation_token: token}), do: CancellationToken.cancelled?(token)
  def cancelled?(token), do: CancellationToken.cancelled?(token)

  @spec with_cancellation_token(dependency(), CancellationToken.t() | nil) :: dependency()
  def with_cancellation_token(%__MODULE__{gateway_opts: opts} = dependency, token)
      when is_list(opts) and is_pid(token) do
    dependency
    |> Map.put(:cancellation_token, token)
    |> rebuild_gateway_execution(Keyword.put(opts, :cancellation_token, token))
  end

  def with_cancellation_token(%__MODULE__{} = dependency, token) when is_pid(token),
    do: %{dependency | cancellation_token: token}

  def with_cancellation_token(dependency, _token), do: dependency

  @spec with_purpose(dependency(), ProviderRun.purpose()) :: dependency()
  def with_purpose(%__MODULE__{gateway_opts: opts} = dependency, purpose)
      when is_list(opts) do
    dependency
    |> Map.put(:purpose, purpose)
    |> rebuild_gateway_execution(Keyword.put(opts, :purpose, purpose))
  end

  def with_purpose(%__MODULE__{} = dependency, purpose),
    do: %{dependency | purpose: purpose}

  def with_purpose(dependency, _purpose), do: dependency

  @spec with_params(dependency(), InferenceParams.t()) :: dependency()
  def with_params(%__MODULE__{gateway_opts: opts} = dependency, %InferenceParams{} = params)
      when is_list(opts) do
    rebuild_gateway_execution(dependency, Keyword.put(opts, :params, params))
  end

  def with_params(dependency, _params), do: dependency

  @spec with_event_sink(dependency(), (execution_result() -> term())) :: dependency()
  def with_event_sink(%__MODULE__{gateway_opts: opts} = dependency, event_sink)
      when is_list(opts) and is_function(event_sink, 1) do
    gateway_opts = Keyword.put(opts, :event_sink, event_sink)
    rebuild_gateway_execution(dependency, gateway_opts)
  end

  def with_event_sink(%__MODULE__{} = dependency, event_sink) when is_function(event_sink, 1) do
    case dependency.execute_fn do
      execute_fn when is_function(execute_fn, 1) ->
        wrapped_execute_fn = fn prompt ->
          execute_fn.(prompt)
          |> tap_event_sink(event_sink)
        end

        %{
          dependency
          | execute_fn: wrapped_execute_fn,
            result_fn: fn prompt -> complete_from_execution(wrapped_execute_fn.(prompt)) end
        }

      _ ->
        wrap_result_fn_with_event_sink(dependency, event_sink)
    end
  end

  def with_event_sink(dependency, _event_sink), do: dependency

  @spec result_fn(dependency()) :: result_fun() | nil
  def result_fn(%__MODULE__{result_fn: result_fn}) when is_function(result_fn, 1),
    do: result_fn

  def result_fn(_dependency), do: nil

  defp complete_from_execution({:ok, %{result: %Result{} = result} = execution}) do
    {:ok, Result.with_execution(result, execution)}
  end

  defp complete_from_execution({:error, %{error: error}}), do: {:error, error}
  defp complete_from_execution({:error, error}), do: {:error, error}

  defp rebuild_gateway_execution(%__MODULE__{} = dependency, gateway_opts) do
    wrapped_execute_fn = fn prompt -> execute(prompt, gateway_opts) end

    %{
      dependency
      | gateway_opts: gateway_opts,
        cancellation_token: Keyword.get(gateway_opts, :cancellation_token),
        execute_fn: wrapped_execute_fn,
        result_fn: fn prompt -> complete_from_execution(wrapped_execute_fn.(prompt)) end
    }
  end

  defp tap_event_sink(execution_result, event_sink) do
    event_sink.(execution_result)
    execution_result
  rescue
    _error -> execution_result
  end

  defp wrap_result_fn_with_event_sink(%__MODULE__{result_fn: result_fn} = dependency, event_sink)
       when is_function(result_fn, 1) do
    wrapped_result_fn = fn prompt ->
      prompt
      |> result_fn.()
      |> synthesize_execution_result(dependency)
      |> tap_event_sink(event_sink)
      |> complete_from_execution()
    end

    %{dependency | result_fn: wrapped_result_fn}
  end

  defp wrap_result_fn_with_event_sink(dependency, _event_sink), do: dependency

  defp synthesize_execution_result(
         {:ok, %{provider_output: %ProviderOutput{}} = result},
         _dependency
       ) do
    output = result.provider_output

    {:ok,
     %{
       provider_run: provider_run!(output, :completed, :author_reasoning),
       events: provider_events!(output, :completed),
       output: output,
       result: ensure_result(result)
     }}
  end

  defp synthesize_execution_result({:ok, %{content: content} = result}, dependency)
       when is_binary(content) do
    output = provider_output!(result, dependency)

    {:ok,
     %{
       provider_run: provider_run!(output, :completed, dependency.purpose || :other),
       events: provider_events!(output, :completed),
       output: output,
       result: ensure_result(result)
     }}
  end

  defp synthesize_execution_result({:error, error}, dependency) do
    output = provider_error_output!(error, dependency)

    {:error,
     %{
       provider_run: provider_run!(output, :failed, dependency.purpose || :other),
       events: provider_events!(output, :failed),
       output: output,
       error: normalize_error(error)
     }}
  end

  defp synthesize_execution_result(other, _dependency), do: other

  defp ensure_result(%Result{} = result), do: result

  defp ensure_result(%{content: content} = result),
    do: Result.new(content, nil, tool_calls: map_get(result, :tool_calls))

  defp provider_output!(%{content: content} = result, dependency) do
    call_ref = existing_ref(result, :provider_call_ref) || existing_ref(result, :provider_call_id)
    call_ref = call_ref || provider_ref("pcall")
    ref = existing_ref(result, :provider_run_ref) || provider_ref("prun")

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: ref,
        provider_call_ref: call_ref,
        status: :ok,
        output_type: :text,
        content: provider_output_content(content, result),
        refs: [call_ref | metadata_refs(dependency.metadata)]
      })

    output
  end

  defp provider_output_content(content, result) do
    %{text: content}
    |> maybe_put_content(:tool_calls, map_get(result, :tool_calls))
  end

  defp maybe_put_content(map, _key, value) when value in [nil, []], do: map
  defp maybe_put_content(map, key, value), do: Map.put(map, key, value)

  defp map_get(map, key) when is_map(map) and is_atom(key),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp provider_error_output!(error, dependency) do
    ref = provider_ref("prun")
    call_ref = provider_ref("pcall")

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: ref,
        provider_call_ref: call_ref,
        status: :error,
        output_type: :empty,
        error: normalize_error(error),
        refs: [call_ref | metadata_refs(dependency.metadata)]
      })

    output
  end

  defp provider_run!(%ProviderOutput{} = output, status, purpose) do
    {:ok, run} =
      ProviderRun.new(%{
        provider_run_id: output.provider_run_ref,
        provider_call_ref: output.provider_call_ref,
        purpose: purpose,
        execution_mode: :event_stream,
        status: status,
        owner_refs: %{}
      })

    run
  end

  defp provider_events!(%ProviderOutput{} = output, :completed) do
    [
      provider_event!(output, 1, :started),
      provider_event!(output, 2, :final_output)
    ]
  end

  defp provider_events!(%ProviderOutput{} = output, :failed) do
    [
      provider_event!(output, 1, :started),
      provider_event!(output, 2, :error)
    ]
  end

  defp provider_event!(%ProviderOutput{} = output, sequence, type) do
    {:ok, event} =
      ProviderEvent.new(%{
        event_id: "#{output.provider_run_ref}:#{type}:#{sequence}",
        provider_run_ref: output.provider_run_ref,
        sequence: sequence,
        event_type: type,
        visibility: :developer,
        summary: "provider_event:#{type}",
        refs: [output.provider_call_ref],
        payload: %{}
      })

    event
  end

  defp provider_ref(prefix),
    do: NovelFoundation.ID.unique(prefix)

  defp existing_ref(map, key) when is_map(map) do
    case Map.get(map, key) || Map.get(map, Atom.to_string(key)) do
      value when is_binary(value) and value != "" -> value
      _ -> nil
    end
  end

  defp metadata_refs(metadata) when is_map(metadata) do
    metadata
    |> Map.get(:refs, Map.get(metadata, "refs", []))
    |> case do
      refs when is_list(refs) -> Enum.map(refs, &to_string/1)
      _ -> []
    end
  end

  defp metadata_refs(_metadata), do: []

  defp normalize_error(error) when is_map(error), do: error
  defp normalize_error(reason), do: %{type: :provider_error, message: inspect(reason)}
end
