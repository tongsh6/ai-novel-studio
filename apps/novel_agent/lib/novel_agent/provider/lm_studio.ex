defmodule NovelAgent.Provider.LMStudio do
  @moduledoc """
  LM Studio Adapter — 用于本地测试和轻量推理。
  """

  @behaviour NovelAgent.Provider

  require Logger

  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.Result
  alias NovelFoundation.UpstreamError

  defstruct [:endpoint, :model, :timeout, :http_fn, :get_fn, :log_fn, :json_mode]

  @type http_fn :: (String.t(), map(), keyword() -> {:ok, integer(), map()} | {:error, atom()})
  @type get_fn :: (String.t(), keyword() -> HTTP.http_result())
  @type log_fn :: (String.t(), String.t(), map(), term(), integer() -> :ok)

  @type t :: %__MODULE__{
          endpoint: String.t(),
          model: String.t(),
          timeout: pos_integer(),
          http_fn: http_fn(),
          get_fn: get_fn(),
          log_fn: log_fn(),
          json_mode: boolean()
        }

  @impl true
  def complete(%__MODULE__{endpoint: endpoint} = state, _model, prompt, params)
      when (is_binary(prompt) or is_list(prompt)) and not is_nil(endpoint) do
    start_time = System.monotonic_time(:millisecond)

    body =
      HTTP.apply_params(
        %{
          model: state.model,
          messages: NovelAgent.Provider.normalize_messages(prompt)
        },
        params
      )
      |> maybe_json_mode(state.json_mode)

    url = Path.join(endpoint, "chat/completions")
    post = state.http_fn || (&HTTP.post/3)

    result =
      case post.(url, body, receive_timeout: state.timeout) do
        {:ok, status, resp_body} when status in 200..299 ->
          handle_success(resp_body, start_time)

        {:error, reason, _status, message} ->
          handle_error(reason, message, start_time)
      end

    log_and_return(result, state, url, body, start_time, prompt)
  end

  def complete(%__MODULE__{} = _state, _model, _prompt, _params) do
    err = UpstreamError.new(:provider_internal, "LM Studio endpoint not configured", name())

    {:error,
     %{type: err.type, message: err.message, provider: err.provider, retryable: err.retryable}}
  end

  # ── response handlers ────────────────────────

  defp handle_success(resp_body, start_time) do
    content = get_in(resp_body, ["choices", Access.at(0), "message", "content"])
    duration = System.monotonic_time(:millisecond) - start_time
    usage = resp_body["usage"] || %{}

    if content && content != "" do
      Logger.debug("[LMStudio] 调用成功，返回 #{byte_size(content)} 字节")

      {:ok, Result.new(content),
       %{status: 200, usage: usage, duration: duration, resp_body: Jason.encode!(resp_body)}}
    else
      err = UpstreamError.new(:invalid_response, "响应内容为空", name())
      Logger.warning("[LMStudio] #{err.message}")

      attrs = %{
        status: 200,
        usage: usage,
        duration: duration,
        resp_body: Jason.encode!(resp_body)
      }

      {:error, UpstreamError.to_error_tuple(err), attrs}
    end
  end

  defp handle_error(:connection_refused, _msg, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:connection_refused, "LM Studio 未启动", name())
    Logger.warning("[LMStudio] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: "connection_refused"}}
  end

  defp handle_error(:timeout, _msg, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:timeout, "LM Studio 请求超时", name())
    Logger.warning("[LMStudio] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: "timeout"}}
  end

  defp handle_error(_reason, message, start_time) do
    duration = System.monotonic_time(:millisecond) - start_time
    err = UpstreamError.new(:provider_internal, message, name())
    Logger.warning("[LMStudio] #{err.message}")

    {:error, UpstreamError.to_error_tuple(err),
     %{status: 0, usage: %{}, duration: duration, resp_body: message}}
  end

  defp log_and_return(result, state, url, body, start_time, _prompt) do
    if log = state.log_fn, do: log.(name(), url, body, result, start_time)
    strip_attrs(result)
  end

  defp strip_attrs({:ok, result, _attrs}), do: {:ok, result}
  defp strip_attrs({:error, {:error, map}, _attrs}), do: {:error, map}

  defp maybe_json_mode(body, true), do: Map.put(body, :response_format, %{type: "json_object"})
  defp maybe_json_mode(body, _), do: body

  @impl true
  def name, do: "lmstudio"

  @impl true
  def health_check(%__MODULE__{endpoint: endpoint, timeout: timeout, get_fn: get})
      when is_binary(endpoint) and endpoint != "" do
    url = Path.join(endpoint, "models")
    get = get || (&HTTP.get/2)

    case get.(url, receive_timeout: timeout || 5_000) do
      {:ok, status, _body} when status in 200..299 -> :ok
      {:error, reason, _status, msg} -> {:error, health_error(reason, msg)}
    end
  end

  def health_check(%__MODULE__{}),
    do: {:error, %{message: "LM Studio endpoint 未配置", type: :config_error}}

  @impl true
  def list_models(%__MODULE__{endpoint: endpoint, timeout: timeout, get_fn: get})
      when is_binary(endpoint) and endpoint != "" do
    url = Path.join(endpoint, "models")
    get = get || (&HTTP.get/2)

    case get.(url, receive_timeout: timeout || 15_000) do
      {:ok, _status, body} ->
        {:ok, models_from_openai_list(body)}

      {:error, :connection_refused, _status, _message} ->
        {:error, %{message: "LM Studio 未启动", type: :connection_refused}}

      {:error, reason, _status, message} ->
        {:error, %{message: message, type: reason}}
    end
  end

  def list_models(%__MODULE__{}),
    do: {:error, %{message: "LM Studio endpoint 未配置", type: :config_error}}

  @doc "从应用配置构建 state struct。"
  @spec from_config() :: t()
  def from_config(config \\ Application.get_env(:novel_agent, __MODULE__, [])) do
    %__MODULE__{
      endpoint: Keyword.get(config, :endpoint, "http://localhost:1234/v1"),
      model: Keyword.get(config, :model, "qwen/qwen3.6-35b-a3b"),
      timeout: Keyword.get(config, :timeout, 300_000),
      http_fn: Keyword.get(config, :http_fn, &HTTP.post/3),
      get_fn: Keyword.get(config, :get_fn, &HTTP.get/2),
      log_fn: Keyword.get(config, :log_fn, &NovelCommon.LLMLog.record/5),
      json_mode: Keyword.get(config, :json_mode, false)
    }
  end

  defp models_from_openai_list(%{"data" => models}) when is_list(models) do
    models
    |> Enum.flat_map(&model_from_openai_entry/1)
    |> Enum.uniq_by(& &1.id)
  end

  defp models_from_openai_list(_body), do: []

  defp model_from_openai_entry(%{"id" => id} = model) when is_binary(id) and id != "" do
    [
      %{
        id: id,
        label: id,
        owned_by: normalize_owned_by(model["owned_by"])
      }
    ]
  end

  defp model_from_openai_entry(_entry), do: []

  defp normalize_owned_by(owner) when is_binary(owner) and owner != "", do: owner
  defp normalize_owned_by(_owner), do: nil

  defp health_error(:connection_refused, _message),
    do: %{message: "LM Studio 未启动", type: :connection_refused, reason: :connection_refused}

  defp health_error(:timeout, _message),
    do: %{message: "LM Studio 请求超时", type: :timeout, reason: :timeout}

  defp health_error(reason, message),
    do: %{message: message, type: reason, reason: reason}
end
