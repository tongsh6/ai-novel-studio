defmodule NovelAgent.Provider.LMStudio do
  @moduledoc """
  LM Studio Adapter — 用于本地测试和轻量推理。
  """

  @behaviour NovelAgent.Provider

  require Logger

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.OpenAICompatibleStream
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage
  alias NovelFoundation.UpstreamError

  defstruct [
    :endpoint,
    :model,
    :timeout,
    :max_tokens,
    :http_fn,
    :eventsource_fn,
    :get_fn,
    :log_fn,
    :json_mode
  ]

  @type http_fn :: (String.t(), map(), keyword() -> {:ok, integer(), map()} | {:error, atom()})
  @type eventsource_fn ::
          (String.t(), map(), keyword(), (binary() -> term()) -> HTTP.event_stream_result())
  @type get_fn :: (String.t(), keyword() -> HTTP.http_result())
  @type log_fn :: (String.t(), String.t(), map(), term(), integer() -> :ok)

  @type t :: %__MODULE__{
          endpoint: String.t(),
          model: String.t(),
          timeout: pos_integer(),
          max_tokens: pos_integer() | nil,
          http_fn: http_fn(),
          eventsource_fn: eventsource_fn(),
          get_fn: get_fn(),
          log_fn: log_fn(),
          json_mode: boolean()
        }

  @impl true
  def complete(%__MODULE__{endpoint: endpoint} = state, _model, prompt, params)
      when (is_binary(prompt) or is_list(prompt) or is_map(prompt)) and not is_nil(endpoint) do
    start_time = System.monotonic_time(:millisecond)

    body = request_body(state, prompt, params, false)

    url = Path.join(endpoint, "chat/completions")
    post = state.http_fn || (&HTTP.post/3)

    result =
      case post.(url, body, receive_timeout: state.timeout) do
        {:ok, status, resp_body} when status in 200..299 ->
          handle_success(state, resp_body, start_time)

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

  @impl true
  def execute(%__MODULE__{endpoint: endpoint} = state, _model, prompt, params, ctx)
      when (is_binary(prompt) or is_list(prompt) or is_map(prompt)) and not is_nil(endpoint) do
    if NovelAgent.Provider.tool_call_prompt?(prompt) do
      execute_tool_call(state, endpoint, prompt, params, ctx)
    else
      body = request_body(state, prompt, params, true)
      url = Path.join(endpoint, "chat/completions")
      request_opts = [receive_timeout: state.timeout]

      OpenAICompatibleStream.execute(stream_meta(), state, url, body, request_opts, ctx)
    end
  end

  def execute(%__MODULE__{}, _model, _prompt, _params, ctx) do
    err = UpstreamError.new(:provider_internal, "LM Studio endpoint not configured", name())

    err
    |> UpstreamError.to_error_tuple()
    |> AdapterExecution.materialize_result(ctx)
  end

  # ── response handlers ────────────────────────

  defp handle_success(state, resp_body, start_time) do
    message = get_in(resp_body, ["choices", Access.at(0), "message"]) || %{}
    content = Map.get(message, "content") || ""
    tool_calls = NovelAgent.Provider.extract_openai_tool_calls(message)
    duration = System.monotonic_time(:millisecond) - start_time
    usage = Usage.from_openai_response(resp_body, state.model, duration)
    attrs = %{status: 200, usage: usage, duration: duration, resp_body: Jason.encode!(resp_body)}

    content
    |> classify_content(tool_calls)
    |> build_success_result(content, tool_calls, usage, attrs)
  end

  # 缺陷十（2026-07-20）：采样退化时 HTTP 层仍是正常 200，只能靠内容判定拦下
  # （见 NovelAgent.Provider.degenerate_content?/1 与流式路径同名判定）。
  defp classify_content(_content, tool_calls) when tool_calls != [], do: :ok

  defp classify_content(content, _tool_calls) when content in ["", nil], do: :empty

  defp classify_content(content, _tool_calls) do
    if NovelAgent.Provider.degenerate_content?(content), do: :degenerate, else: :ok
  end

  defp build_success_result(:ok, content, tool_calls, usage, attrs) do
    Logger.debug("[LMStudio] 调用成功，返回 #{byte_size(content)} 字节#{tool_calls_suffix(tool_calls)}")
    {:ok, Result.new(content, usage, tool_calls: tool_calls), attrs}
  end

  defp build_success_result(:degenerate, _content, _tool_calls, _usage, attrs),
    do: error_result_tuple("响应内容退化（低信息熵重复）", attrs)

  defp build_success_result(:empty, _content, _tool_calls, _usage, attrs),
    do: error_result_tuple("响应内容为空", attrs)

  defp tool_calls_suffix([]), do: ""
  defp tool_calls_suffix(_tool_calls), do: " + tool_calls"

  defp error_result_tuple(message, attrs) do
    err = UpstreamError.new(:invalid_response, message, name())
    Logger.warning("[LMStudio] #{err.message}")
    {:error, UpstreamError.to_error_tuple(err), attrs}
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

  defp request_body(state, prompt, params, stream?) do
    HTTP.apply_params(
      %{
        model: state.model,
        messages: NovelAgent.Provider.normalize_messages(prompt),
        stream: stream?,
        # 缺陷九跟进：provider 自己的安全上限先垫底，params.max_tokens 非 nil
        # 时 apply_params 会覆盖（调用方显式偏好优先于 provider 默认兜底）。
        max_tokens: state.max_tokens
      },
      params
    )
    |> maybe_json_mode(state.json_mode, prompt)
    |> NovelAgent.Provider.put_openai_tools(prompt)
    |> downgrade_named_tool_choice()
  end

  # LM Studio API 约束：tool_choice 只接受字符串 none/auto/required，不支持
  # OpenAI 具名对象形式（HTTP 400 "Invalid tool_choice type: 'object'"）。
  # 请求只携带单个 tool 时 "required" 等效强制；解析层仍校验「恰一个匹配名」。
  defp downgrade_named_tool_choice(%{tool_choice: %{}} = body),
    do: Map.put(body, :tool_choice, "required")

  defp downgrade_named_tool_choice(body), do: body

  defp execute_tool_call(state, endpoint, prompt, params, ctx) do
    start_time = System.monotonic_time(:millisecond)
    body = request_body(state, prompt, params, false)
    url = Path.join(endpoint, "chat/completions")
    post = state.http_fn || (&HTTP.post/3)
    initial_events = AdapterExecution.initial_events(ctx)
    AdapterExecution.emit_events(ctx, initial_events, :running)

    result =
      case post.(url, body, receive_timeout: state.timeout) do
        {:ok, status, resp_body} when status in 200..299 ->
          handle_success(state, resp_body, start_time)

        {:error, reason, _status, message} ->
          handle_error(reason, message, start_time)
      end

    if log = state.log_fn, do: log.(name(), url, body, result, start_time)

    result
    |> strip_attrs()
    |> AdapterExecution.materialize_result(ctx, initial_events: initial_events, emit: :terminal)
  end

  defp maybe_json_mode(body, true, prompt) do
    if NovelAgent.Provider.tool_call_prompt?(prompt) do
      body
    else
      Map.put(body, :response_format, %{type: "json_object"})
    end
  end

  defp maybe_json_mode(body, _enabled, _prompt), do: body

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
      model: Keyword.get(config, :model, "qwen/qwen3.8-27b"),
      timeout: Keyword.get(config, :timeout, 300_000),
      # 缺陷九跟进（2026-07-20）：本地可换模型，安全上限归这里配置，不归
      # InferenceParams 通用默认值——见该模块 moduledoc。32000 是保守生成值，
      # 换模型/换量化后应按 scripts/probe_run.sh 实测复核。
      max_tokens: Keyword.get(config, :max_tokens, 32_000),
      http_fn: Keyword.get(config, :http_fn, &HTTP.post/3),
      eventsource_fn: Keyword.get(config, :eventsource_fn, &HTTP.post_event_stream/4),
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

  defp stream_meta, do: %{vendor: name(), label: "LM Studio"}
end
