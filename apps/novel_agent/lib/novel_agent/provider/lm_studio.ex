defmodule NovelAgent.Provider.LMStudio do
  @moduledoc """
  LM Studio Adapter — 用于本地测试和轻量推理。
  """

  @behaviour NovelAgent.Provider

  require Logger

  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.Result
  alias NovelFoundation.UpstreamError

  defstruct [:endpoint, :model, :timeout, :http_fn, :log_fn, :json_mode]

  @type http_fn :: (String.t(), map(), keyword() -> {:ok, integer(), map()} | {:error, atom()})
  @type log_fn :: (String.t(), String.t(), map(), term(), integer() -> :ok)

  @type t :: %__MODULE__{
          endpoint: String.t(),
          model: String.t(),
          timeout: pos_integer(),
          http_fn: http_fn(),
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
          messages:
            prompt
            |> NovelAgent.Provider.normalize_messages()
            |> ensure_chat_starts_with_user()
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

  defp ensure_chat_starts_with_user(messages) do
    {system_messages, chat_messages} = Enum.split_with(messages, &(&1.role == "system"))

    case Enum.split_while(chat_messages, &(&1.role != "user")) do
      {[], _} ->
        messages

      {leading_context, []} ->
        merge_into_system(system_messages, leading_context)

      {leading_context, rest} ->
        merge_into_system(system_messages, leading_context) ++ rest
    end
  end

  defp merge_into_system([], leading_context), do: [%{role: "system", content: context_text(leading_context)}]

  defp merge_into_system(system_messages, leading_context) do
    context = context_text(leading_context)

    system_messages
    |> combine_system_messages()
    |> List.update_at(-1, fn message ->
      %{message | content: [message.content, context] |> Enum.reject(&(&1 == "")) |> Enum.join("\n\n")}
    end)
  end

  defp combine_system_messages(system_messages) do
    content =
      system_messages
      |> Enum.map(& &1.content)
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n\n")

    [%{role: "system", content: content}]
  end

  defp context_text(messages) do
    messages
    |> Enum.map(fn message -> "#{message.role}: #{message.content}" end)
    |> Enum.join("\n")
  end

  @impl true
  def name, do: "lmstudio"

  @impl true
  def health_check(%__MODULE__{endpoint: endpoint, timeout: timeout})
      when is_binary(endpoint) and endpoint != "" do
    url = Path.join(endpoint, "models")
    post = &HTTP.post/3

    case post.(url, %{}, receive_timeout: timeout || 5_000) do
      {:ok, status, _body} when status in 200..299 -> :ok
      {:error, reason, _status, msg} -> {:error, %{message: msg, reason: reason}}
    end
  end

  def health_check(%__MODULE__{}),
    do: {:error, %{message: "LM Studio endpoint 未配置", type: :config_error}}

  @doc "从应用配置构建 state struct。"
  @spec from_config() :: t()
  def from_config do
    config = Application.get_env(:novel_agent, __MODULE__, [])

    %__MODULE__{
      endpoint: Keyword.get(config, :endpoint, "http://localhost:1234/v1"),
      model: Keyword.get(config, :model, "qwen/qwen3.6-35b-a3b"),
      timeout: Keyword.get(config, :timeout, 60_000),
      http_fn: Keyword.get(config, :http_fn, &HTTP.post/3),
      log_fn: Keyword.get(config, :log_fn, &NovelCommon.LLMLog.record/5),
      json_mode: Keyword.get(config, :json_mode, false)
    }
  end
end
