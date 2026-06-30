defmodule NovelAgent.Provider.Execution do
  @moduledoc """
  Compatibility boundary for provider execution.

  This module produces the legacy one-argument completion function shape still
  used by planner/tool callers, but it is not a second provider execution path.
  Every production call delegates to `Provider.Gateway.execute/4`, which
  materializes ProviderRun / ProviderEvent / ProviderOutput facts first.
  """

  alias NovelAgent.Provider
  alias NovelAgent.Provider.CancellationToken
  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result

  defstruct [
    :complete_fn,
    :execute_fn,
    :purpose,
    :gateway_opts,
    :cancellation_token,
    metadata: %{}
  ]

  @type execution_result :: Gateway.execution_result()
  @type complete_result :: {:ok, Result.t()} | {:error, map()}
  @type complete_fun :: (Provider.prompt() -> complete_result())
  @type execute_fun :: (Provider.prompt() -> execution_result())

  @type t :: %__MODULE__{
          complete_fn: complete_fun(),
          execute_fn: execute_fun(),
          purpose: atom() | nil,
          gateway_opts: keyword() | nil,
          cancellation_token: CancellationToken.t() | nil,
          metadata: map()
        }

  @type dependency :: t() | complete_fun() | nil

  @spec execute(Provider.prompt(), keyword()) :: execution_result()
  def execute(prompt, opts \\ []) do
    model = Keyword.get(opts, :model)
    params = Keyword.get(opts, :params, %InferenceParams{})
    gateway_opts = Keyword.drop(opts, [:model, :params])

    Gateway.execute(prompt, model, params, gateway_opts)
  end

  @spec complete(Provider.prompt(), keyword()) :: complete_result()
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
      complete_fn: complete_fn(opts),
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
            complete_fn: fn prompt -> complete_from_execution(wrapped_execute_fn.(prompt)) end
        }

      _ ->
        dependency
    end
  end

  def with_event_sink(dependency, _event_sink), do: dependency

  @spec complete_fn() :: complete_fun()
  def complete_fn, do: complete_fn([])

  @spec complete_fn(dependency() | keyword()) :: complete_fun() | nil
  def complete_fn(%__MODULE__{complete_fn: complete_fn}) when is_function(complete_fn, 1),
    do: complete_fn

  def complete_fn(complete_fn) when is_function(complete_fn, 1), do: complete_fn

  def complete_fn(opts) when is_list(opts) do
    fn prompt -> complete(prompt, opts) end
  end

  def complete_fn(_dependency), do: nil

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
        complete_fn: fn prompt -> complete_from_execution(wrapped_execute_fn.(prompt)) end
    }
  end

  defp tap_event_sink(execution_result, event_sink) do
    event_sink.(execution_result)
    execution_result
  rescue
    _error -> execution_result
  end
end
