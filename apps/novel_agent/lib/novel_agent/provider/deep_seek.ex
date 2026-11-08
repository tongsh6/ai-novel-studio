defmodule NovelAgent.Provider.DeepSeek do
  @moduledoc """
  DeepSeek API provider adapter.

  DeepSeek exposes an OpenAI-compatible non-streaming chat completion API. This
  adapter keeps the project contract stable: callers still go through
  `Provider.Gateway` and receive `Provider.Result`.
  """

  @behaviour NovelAgent.Provider

  require Logger

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.OpenAICompatibleStream
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelFoundation.UpstreamError

  defstruct [
    :api_key,
    :endpoint,
    :model,
    :timeout,
    :max_tokens,
    :http_fn,
    :eventsource_fn,
    :get_fn,
    :log_fn,
    :json_mode,
    :thinking,
    :reasoning_effort
  ]

  @type http_fn :: (String.t(), map(), keyword() -> HTTP.http_result())
  @type eventsource_fn ::
          (String.t(), map(), keyword(), (binary() -> term()) -> HTTP.event_stream_result())
  @type get_fn :: (String.t(), keyword() -> HTTP.http_result())
  @type log_fn :: (String.t(), String.t(), map(), term(), integer() -> :ok)
  @type thinking :: :enabled | :disabled

  @type t :: %__MODULE__{
          api_key: String.t() | nil,
          endpoint: String.t(),
          model: String.t(),
          timeout: pos_integer(),
          max_tokens: pos_integer() | nil,
          http_fn: http_fn() | nil,
          eventsource_fn: eventsource_fn() | nil,
          get_fn: get_fn() | nil,
          log_fn: log_fn() | nil,
          json_mode: boolean(),
          thinking: thinking(),
          reasoning_effort: String.t() | nil
        }

  @default_endpoint "https://api.deepseek.com"
  @default_model "deepseek-v4-flash"

  @impl true
  # B71 R2：工具调用不再隐式选择非流式——tool_calls 同样走 SSE 流式传输，
  # 由 adapter-owned decoder 无损累积参数后在结束时归一。
  def execute(%__MODULE__{api_key: key} = state, _model, prompt, params, ctx)
      when (is_binary(prompt) or is_list(prompt) or is_map(prompt)) and is_binary(key) and
             key != "" do
    body =
      state
      |> request_body(prompt, params, true)
      |> maybe_thinking(state.thinking, state.reasoning_effort)

    url = endpoint_url(state.endpoint)
    headers = [{"authorization", "Bearer #{key}"}]

    # B22：流式只设"最长静默窗口"；总时长兜底默认关闭（见 TimeoutPolicy）。
    request_opts = [
      headers: headers,
      receive_timeout: AdapterExecution.response_timeout(ctx, state.timeout),
      connect_timeout: AdapterExecution.connect_timeout(ctx, 15_000)
    ]

    OpenAICompatibleStream.execute(
      stream_meta(),
      state,
      url,
      body,
      request_opts,
      ctx,
      provider_state_fun: &deepseek_provider_state/2
    )
  end

  def execute(%__MODULE__{}, _model, _prompt, _params, ctx) do
    err = UpstreamError.new(:auth, "DeepSeek API key 未配置", name())

    err
    |> UpstreamError.to_error_tuple()
    |> AdapterExecution.materialize_result(ctx)
  end

  defp endpoint_url(endpoint) do
    endpoint
    |> String.trim_trailing("/")
    |> Kernel.<>("/chat/completions")
  end

  defp request_body(state, %RequestIR{} = ir, params, stream?) do
    {:ok, projected} =
      Projection.project(ir, "chat_completions", include_provider_state: true)

    projected
    |> Map.put(:model, state.model)
    |> Map.put(:stream, stream?)
    |> Map.put(:max_tokens, state.max_tokens)
    |> Map.put(:messages, replay_projected(projected.messages, state.model))
    |> HTTP.apply_params(params)
    |> maybe_json_mode(state.json_mode, ir)
  end

  defp maybe_json_mode(body, true, prompt) do
    if RequestIR.Tools.tool_call_prompt?(prompt) do
      body
    else
      Map.put(body, :response_format, %{type: "json_object"})
    end
  end

  defp maybe_json_mode(body, _enabled, _prompt), do: body

  # 私有回放材料只回到产生它的 provider/model；共享层不解释供应商字段。
  defp replay_projected(messages, model), do: Enum.map(messages, &replay_message(&1, model))

  defp replay_message(%{role: "assistant"} = message, model) do
    {private, message} = Map.pop(message, :provider_state)

    case private do
      %{
        "provider" => "deepseek",
        "model" => ^model,
        "payload" => %{"reasoning_content" => reasoning}
      }
      when is_binary(reasoning) ->
        Map.put(message, :reasoning_content, reasoning)

      _ ->
        message
    end
  end

  defp replay_message(message, _model), do: Map.delete(message, :provider_state)

  # DeepSeek API 约束：thinking 模式不支持强制具名 tool_choice（HTTP 400
  # "Thinking mode does not support this tool_choice"）。规划类调用依赖强制
  # tool call 的结构确定性，thinking 对其非必需——该请求整形为 disabled 并留痕。
  defp maybe_thinking(%{tool_choice: %{}} = body, :enabled, _effort) do
    Logger.info(
      "[DeepSeek] 请求带强制 tool_choice，thinking 按能力约束降级为 disabled（thinking 模式不支持强制具名 tool_choice）"
    )

    Map.put(body, :thinking, %{type: "disabled"})
  end

  defp maybe_thinking(body, :enabled, effort) when is_binary(effort) and effort != "" do
    body
    |> Map.put(:thinking, %{type: "enabled"})
    |> Map.put(:reasoning_effort, effort)
  end

  defp maybe_thinking(body, :enabled, _effort), do: Map.put(body, :thinking, %{type: "enabled"})
  defp maybe_thinking(body, _thinking, _effort), do: Map.put(body, :thinking, %{type: "disabled"})

  @impl true
  def name, do: "deepseek"

  # 传输事实：OpenAI 兼容 Chat Completions 原生多轮、tools/tool 消息、SSE 流式、
  # tool schema 结构化输出与 usage 都由本 adapter 真实发送并解析。
  @impl true
  def capabilities(_state) do
    %{
      native_multi_turn: true,
      tool_calls: true,
      tool_results: true,
      streaming: true,
      structured_output: true,
      usage: true
    }
  end

  @impl true
  def projection_target(_state), do: "chat_completions"

  @impl true
  def health_check(%__MODULE__{api_key: key}) when is_binary(key) and key != "", do: :ok

  def health_check(%__MODULE__{}),
    do: {:error, %{message: "DeepSeek API key 未配置", type: :unauthorized}}

  @impl true
  def list_models(%__MODULE__{api_key: key} = state) when is_binary(key) and key != "" do
    url = models_url(state.endpoint)
    get = state.get_fn || (&HTTP.get/2)
    headers = [{"authorization", "Bearer #{key}"}]

    case get.(url,
           headers: headers,
           receive_timeout: AdapterExecution.probe_timeout(state.timeout)
         ) do
      {:ok, _status, body} ->
        {:ok, models_from_openai_list(body)}

      {:error, :http_error, status, message} ->
        {:error, %{message: "DeepSeek API: #{message}", type: http_error_type(status)}}

      {:error, :connection_refused, _status, _message} ->
        {:error, %{message: "无法连接 DeepSeek API", type: :connection_refused}}

      {:error, :timeout, _status, _message} ->
        {:error, %{message: "DeepSeek API 请求超时", type: :timeout}}

      {:error, reason, _status, message} ->
        {:error, %{message: message, type: reason}}
    end
  end

  def list_models(%__MODULE__{}),
    do: {:error, %{message: "DeepSeek API key 未配置", type: :unauthorized}}

  # list_models 的错误族映射（execute/5 唯一执行入口后，非流式 complete 分支不再
  # 共享该 helper，仍需要它把 GET /models 的 HTTP 状态映射成作者可读错误类型）。
  defp http_error_type(status) when status in [401, 402, 403], do: :auth
  defp http_error_type(429), do: :rate_limit
  defp http_error_type(status) when status in [400, 422], do: :invalid_request
  defp http_error_type(_status), do: :provider_internal

  @doc "从应用配置构建 state struct。支持环境变量 DEEPSEEK_API_KEY。"
  @spec from_config() :: t()
  def from_config(config \\ Application.get_env(:novel_agent, __MODULE__, [])) do
    %__MODULE__{
      api_key: Keyword.get(config, :api_key) || System.get_env("DEEPSEEK_API_KEY"),
      endpoint: Keyword.get(config, :endpoint, @default_endpoint),
      model: Keyword.get(config, :model, @default_model),
      timeout: Keyword.get(config, :timeout, 300_000),
      # 缺陷九跟进：托管 API，风险低于本地可换模型，但止血阀是系统不变量，
      # 不因单个 provider 风险低就例外——见 InferenceParams moduledoc。
      max_tokens: Keyword.get(config, :max_tokens, 16_000),
      http_fn: Keyword.get(config, :http_fn, &HTTP.post/3),
      eventsource_fn: Keyword.get(config, :eventsource_fn, &HTTP.post_event_stream/4),
      get_fn: Keyword.get(config, :get_fn, &HTTP.get/2),
      log_fn: Keyword.get(config, :log_fn, &NovelTelemetry.LLMLog.record/5),
      json_mode: Keyword.get(config, :json_mode, false),
      thinking: normalize_thinking(Keyword.get(config, :thinking, :disabled)),
      reasoning_effort: Keyword.get(config, :reasoning_effort)
    }
  end

  defp normalize_thinking(value) when value in [:enabled, "enabled", true], do: :enabled
  defp normalize_thinking(_value), do: :disabled

  defp stream_meta, do: %{vendor: name(), label: "DeepSeek"}

  # 私有推理只按真实 provider/model 绑定回放：流式 reasoning_content 作为
  # DeepSeek 私有状态，不进入正文、作者可见事件或其它 provider 的请求。
  defp deepseek_provider_state(finalized, state) do
    case Map.get(finalized, :private_reasoning) do
      text when is_binary(text) and text != "" ->
        %{
          "provider" => "deepseek",
          "model" => state.model,
          "payload" => %{"reasoning_content" => text}
        }

      _other ->
        %{}
    end
  end

  defp models_url(endpoint) do
    endpoint
    |> String.trim_trailing("/")
    |> Kernel.<>("/models")
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
end
