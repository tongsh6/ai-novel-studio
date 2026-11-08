defmodule NovelAgent.Provider.OpenAICompatible do
  @moduledoc """
  OpenAI 兼容 Chat Completions 适配器共享实现。

  OpenAI、Minimax、智谱（GLM）、Kimi（Moonshot）、Gemini 等供应商都暴露 OpenAI 兼容的
  `/chat/completions` 与 `/models` 接口，认证为 `Authorization: Bearer <key>`。各 vendor
  adapter 通过 `use NovelAgent.Provider.OpenAICompatible` 注入统一的 `complete/health_check/
  list_models/from_config`，只声明自己的 vendor 名、展示标签、默认 endpoint/model 与可选能力。

  DeepSeek / LMStudio / Anthropic 保留各自独立 adapter（历史实现 + 各自 thinking/鉴权差异），
  不在本基类范围内；本基类只服务新增的 OpenAI 兼容供应商矩阵，避免 N 份近重复 adapter。

  vendor 之间仍有两处真实差异需要参数化，而不是靠复制 adapter 解决：

    - **鉴权**：托管 API 矩阵必须带 Key；本地 Strata 服务允许无 Key（可选 Key），
      对应 `:api_key_required` 选项（默认 true，保持托管矩阵行为不变）。
    - **思考控制**：多数 vendor 用 `thinking` 对象；本地 Strata/Qwen3.8 用请求级
      顶层 `reasoning_effort`（`"none"` 关思考），对应 `:thinking_style` 选项
      （默认 `:thinking_object`）。

  注意：OpenAI 订阅（subscription）认证方式以独立 vendor id 接入，结构上与 API Key 区分
  （独立 secret、独立 endpoint、独立 redaction）；其真实 OAuth 登录与 ChatGPT backend 传输
  需要真实账号与浏览器流程，登记为 SU-01 SC-SU01-B3 的 live vendor 后续缺口，本基类不冒充其
  live 可用性。
  """

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.OpenAICompatibleStream
  alias NovelAgent.Provider.ResponsesStream
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelFoundation.UpstreamError

  @type meta :: %{
          vendor: String.t(),
          label: String.t(),
          supports_thinking: boolean(),
          api_key_required: boolean(),
          thinking_style: :thinking_object | :reasoning_effort
        }

  @doc """
  注入 OpenAI 兼容 adapter 的统一实现。

  ## 选项

    - `:vendor`（必填）— provider id（即 `name/0`，用于路由/日志/audit）
    - `:label`（必填）— 错误文案用的中文展示名
    - `:default_endpoint`（必填）— OpenAI 兼容 base（不含 `/chat/completions`）
    - `:default_model`（必填）— 未配置或未实时拉取时的兜底模型
    - `:env_key`（可选）— 从环境变量回退读取 API Key
    - `:supports_thinking`（可选，默认 false）— 是否透传 thinking/reasoning_effort
    - `:api_key_required`（可选，默认 true）— Key 是否必填。false 时无 Key 也发请求
      （headers 为 `[]`，配置了 Key 仍带 Bearer），且 `health_check/1` 改为真实
      GET `/models` 网络探测
    - `:thinking_style`（可选，默认 `:thinking_object`）— 思考控制协议：
      `:thinking_object` 发送 `thinking` 对象；`:reasoning_effort` 发送顶层
      `reasoning_effort`（`"none"` 关思考），绝不发 `thinking` 字段
  """
  defmacro __using__(opts) do
    quote bind_quoted: [opts: opts] do
      @behaviour NovelAgent.Provider

      alias NovelAgent.Provider.HTTP
      alias NovelAgent.Provider.OpenAICompatible

      @oac_vendor Keyword.fetch!(opts, :vendor)
      @oac_label Keyword.fetch!(opts, :label)
      @oac_default_endpoint Keyword.fetch!(opts, :default_endpoint)
      @oac_default_model Keyword.fetch!(opts, :default_model)
      @oac_env_key Keyword.get(opts, :env_key)
      @oac_supports_thinking Keyword.get(opts, :supports_thinking, false)
      @oac_api_key_required Keyword.get(opts, :api_key_required, true)
      @oac_thinking_style Keyword.get(opts, :thinking_style, :thinking_object)
      @oac_wire_api Keyword.get(opts, :wire_api, :chat_completions)

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
        :reasoning_effort,
        :wire_api
      ]

      @type t :: %__MODULE__{
              api_key: String.t() | nil,
              endpoint: String.t(),
              model: String.t() | nil,
              timeout: pos_integer(),
              max_tokens: pos_integer() | nil,
              http_fn: (String.t(), map(), keyword() -> HTTP.http_result()) | nil,
              eventsource_fn:
                (String.t(), map(), keyword(), (binary() -> term()) ->
                   HTTP.event_stream_result())
                | nil,
              get_fn: (String.t(), keyword() -> HTTP.http_result()) | nil,
              log_fn: (String.t(), String.t(), map(), term(), integer() -> :ok) | nil,
              json_mode: boolean(),
              thinking: :enabled | :disabled,
              reasoning_effort: String.t() | nil,
              wire_api: :chat_completions | :responses
            }

      @impl true
      def name, do: @oac_vendor

      @impl true
      def execute(state, model, prompt, params, ctx),
        do: OpenAICompatible.execute(oac_meta(), state, model, prompt, params, ctx)

      # 协议差异由具体 adapter 覆盖；共享传输不判断 vendor 名称。
      defoverridable execute: 5

      @impl true
      def health_check(state), do: OpenAICompatible.health_check(oac_meta(), state)

      @impl true
      def list_models(state), do: OpenAICompatible.list_models(oac_meta(), state)

      @doc """
      本 adapter 在当前 state（含 wire_api/model）下真实可证的传输能力。

      来源是共享传输实现本身：Chat Completions wire 支持流式、原生工具与 usage；
      Responses wire 当前只提供非流式真实传输，因此 streaming 如实为 false。
      """
      @impl true
      def capabilities(state), do: OpenAICompatible.capabilities(oac_meta(), state)

      @doc "本次 route 的真实 wire 投影目标（Responses API 路由不再停在投影层）。"
      @impl true
      def projection_target(state), do: OpenAICompatible.projection_target(state)

      @doc "从应用配置构建 state struct，可经 `:env_key` 从环境变量回退读取 API Key。"
      @spec from_config(keyword()) :: t()
      def from_config(config \\ Application.get_env(:novel_agent, __MODULE__, [])) do
        %__MODULE__{
          api_key: Keyword.get(config, :api_key) || OpenAICompatible.env(@oac_env_key),
          endpoint: Keyword.get(config, :endpoint, @oac_default_endpoint),
          model: Keyword.get(config, :model, @oac_default_model),
          timeout: Keyword.get(config, :timeout, 300_000),
          # 缺陷九跟进（2026-07-20）：托管 API 矩阵，风险低于本地可换模型，但止血阀
          # 是系统不变量——见 InferenceParams moduledoc、NovelAgent.Provider.DeepSeek
          # 同名字段。
          max_tokens: Keyword.get(config, :max_tokens, 16_000),
          http_fn: Keyword.get(config, :http_fn, &HTTP.post/3),
          eventsource_fn: Keyword.get(config, :eventsource_fn, &HTTP.post_event_stream/4),
          get_fn: Keyword.get(config, :get_fn, &HTTP.get/2),
          log_fn: Keyword.get(config, :log_fn, &NovelTelemetry.LLMLog.record/5),
          json_mode: Keyword.get(config, :json_mode, false),
          thinking:
            OpenAICompatible.normalize_thinking(Keyword.get(config, :thinking, :disabled)),
          reasoning_effort: Keyword.get(config, :reasoning_effort),
          wire_api:
            OpenAICompatible.normalize_wire_api(Keyword.get(config, :wire_api, @oac_wire_api))
        }
      end

      defp oac_meta do
        %{
          vendor: @oac_vendor,
          label: @oac_label,
          supports_thinking: @oac_supports_thinking,
          api_key_required: @oac_api_key_required,
          thinking_style: @oac_thinking_style
        }
      end
    end
  end

  # ── 共享运行时实现（对任意 OpenAI 兼容 struct 生效，按字段读取）────────────

  @doc false
  @spec capabilities(meta(), struct()) :: %{required(atom()) => boolean()}
  def capabilities(_meta, _state) do
    %{
      native_multi_turn: true,
      tool_calls: true,
      tool_results: true,
      # B71 R2：Chat/Responses 两类 wire 都提供真实 SSE 流式解析与工具参数无损累积；
      # 能力声明按 adapter 实际实现，未实现的 adapter 仍按 §6.4 显式拒绝路由。
      streaming: true,
      structured_output: true,
      usage: true
    }
  end

  @doc false
  @spec projection_target(struct()) :: String.t()
  def projection_target(state) do
    case normalize_wire_api(Map.get(state, :wire_api)) do
      :responses -> "responses_api"
      :chat_completions -> "chat_completions"
    end
  end

  @doc false
  @spec normalize_wire_api(term()) :: :chat_completions | :responses
  def normalize_wire_api(value) when value in [:responses, "responses"], do: :responses
  def normalize_wire_api(_value), do: :chat_completions

  @doc false
  @spec execute(meta(), struct(), String.t() | nil, term(), term(), AdapterExecution.context()) ::
          AdapterExecution.execution_result()
  def execute(meta, %{api_key: key} = state, _model, prompt, params, ctx)
      when is_binary(prompt) or is_list(prompt) or is_map(prompt) do
    case auth_headers(meta, key) do
      {:ok, headers} ->
        case normalize_wire_api(Map.get(state, :wire_api)) do
          :responses ->
            execute_responses(meta, state, headers, prompt, params, ctx)

          :chat_completions ->
            execute_chat(meta, state, headers, prompt, params, ctx)
        end

      {:error, :auth_required} ->
        missing_key_error(meta)
        |> AdapterExecution.materialize_result(ctx)
    end
  end

  def execute(meta, _state, _model, _prompt, _params, ctx) do
    missing_key_error(meta)
    |> AdapterExecution.materialize_result(ctx)
  end

  # B71 R2：工具调用不再隐式选择非流式——Chat Completions 的 tool_calls 同样走
  # SSE 流式传输，由 adapter-owned decoder 无损累积参数后在结束时归一。
  defp execute_chat(meta, state, headers, prompt, params, ctx) do
    body =
      state
      |> request_body(prompt, params, true)
      |> maybe_thinking(meta, state)
      |> put_stream_usage_options()

    url = endpoint_url(state.endpoint)

    # B22：流式请求只设"最长静默窗口"（有数据就续命），总时长兜底默认关闭。
    request_opts = [
      headers: headers,
      receive_timeout: AdapterExecution.response_timeout(ctx, state.timeout),
      connect_timeout: AdapterExecution.connect_timeout(ctx, 15_000)
    ]

    OpenAICompatibleStream.execute(meta, state, url, body, request_opts, ctx)
  end

  # VS-00L §6.4 usage recovery：OpenAI Chat Completions 流式默认不返回 usage，
  # 必须显式 stream_options.include_usage，才会在 [DONE] 前追加带 usage 的 chunk
  # （OpenAI 官方 create chat completion 文档：stream_options.include_usage "If set,
  # an additional chunk will be streamed before the data: [DONE] message"，
  # https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create）。
  # DeepSeek 官方文档同样声明 stream_options 必须与 stream:true 同用（
  # https://api-docs.deepseek.com/api/create-chat-completion），LM Studio 按 OpenAI
  # 兼容协议接受该字段。项目没有任何 provider 级「不支持 stream_options」的可证事实
  # （capabilities/2 只声明必备能力，descriptor 只描述配置），因此对所有 Chat wire
  # 流式请求统一声明；非流式 complete 路径不发送。
  defp put_stream_usage_options(body),
    do: Map.put(body, :stream_options, %{include_usage: true})

  # B71 R2：Responses wire 走真实 SSE 流式传输（stream: true）。取消/静默/总时长
  # 与 Chat/Anthropic 共用 SSEStream 生命周期；输出事实由 ResponsesStream/ResponsesWire 归一。
  defp execute_responses(meta, state, headers, prompt, params, ctx) do
    body = responses_request_body(state, prompt, params, true)
    url = responses_url(state.endpoint)

    request_opts = [
      headers: headers,
      receive_timeout: AdapterExecution.response_timeout(ctx, state.timeout),
      connect_timeout: AdapterExecution.connect_timeout(ctx, 15_000)
    ]

    ResponsesStream.execute(meta, state, url, body, request_opts, ctx)
  end

  @doc false
  @spec health_check(meta(), struct()) :: :ok | {:error, map()}
  def health_check(meta, %{api_key: key} = state) do
    cond do
      # 本地 keyless provider 只看本地配置无法证明服务可用（Strata 无 Key 也能
      # 启动失败/未加载模型），必须做一次真实 GET /models 探测。
      not meta.api_key_required ->
        case list_models(meta, state) do
          {:ok, _models} -> :ok
          {:error, error} -> {:error, error}
        end

      is_binary(key) and key != "" ->
        :ok

      true ->
        {:error, %{message: "#{meta.label} API key 未配置", type: :unauthorized}}
    end
  end

  @doc false
  @spec list_models(meta(), struct()) :: {:ok, [map()]} | {:error, map()}
  def list_models(meta, %{api_key: key} = state) do
    case auth_headers(meta, key) do
      {:ok, headers} ->
        fetch_models(meta, state, headers)

      {:error, :auth_required} ->
        {:error, %{message: "#{meta.label} API key 未配置", type: :unauthorized}}
    end
  end

  defp fetch_models(meta, state, headers) do
    url = models_url(state.endpoint)
    get = state.get_fn || (&HTTP.get/2)

    get.(url, headers: headers, receive_timeout: AdapterExecution.probe_timeout(state.timeout))
    |> models_result(meta)
  end

  # Credo CyclomaticComplexity（2026-10-21 静态扫描 P2，触达文件必清）：错误族映射
  # 从 list_models 抽出，保持分支数与 `GET /models` 结果形态一一对应。
  defp models_result({:ok, _status, body}, _meta), do: {:ok, models_from_openai_list(body)}

  defp models_result({:error, :http_error, status, message}, meta),
    do: {:error, %{message: "#{meta.label}: #{message}", type: http_error_type(status)}}

  defp models_result({:error, :connection_refused, _status, _message}, meta),
    do: {:error, %{message: "无法连接 #{meta.label}", type: :connection_refused}}

  defp models_result({:error, :timeout, _status, _message}, meta),
    do: {:error, %{message: "#{meta.label} 请求超时", type: :timeout}}

  defp models_result({:error, reason, _status, message}, _meta),
    do: {:error, %{message: message, type: reason}}

  @doc false
  @spec env(String.t() | nil) :: String.t() | nil
  def env(nil), do: nil
  def env(key) when is_binary(key), do: System.get_env(key)

  @doc false
  @spec normalize_thinking(term()) :: :enabled | :disabled
  def normalize_thinking(value) when value in [:enabled, "enabled", true], do: :enabled
  def normalize_thinking(_value), do: :disabled

  # ── private ──────────────────────────────────

  defp endpoint_url(endpoint) do
    endpoint
    |> String.trim_trailing("/")
    |> Kernel.<>("/chat/completions")
  end

  defp responses_url(endpoint) do
    endpoint
    |> String.trim_trailing("/")
    |> Kernel.<>("/responses")
  end

  # canonical IR → Responses API body：system 进 instructions、消息/工具调用按原生
  # input items 投影（VS-00L §6.3/§19.1）。Responses SSE 由 R2 承接，当前显式非流式。
  defp responses_request_body(state, %RequestIR{} = ir, params, stream?) do
    {:ok, projected} = Projection.project(ir, "responses_api")

    projected
    |> Map.put(:stream, stream?)
    |> maybe_put_model(state.model)
    |> responses_max_output_tokens(state.max_tokens, Map.get(params, :max_tokens))
    |> maybe_put_response_param(Map.get(params, :temperature), :temperature)
    |> maybe_put_response_param(Map.get(params, :top_p), :top_p)
  end

  defp maybe_put_response_param(body, nil, _key), do: body
  defp maybe_put_response_param(body, value, key), do: Map.put(body, key, value)

  defp responses_max_output_tokens(body, _default, max) when is_integer(max) and max > 0,
    do: Map.put(body, :max_output_tokens, max)

  defp responses_max_output_tokens(body, default, _max) when is_integer(default) and default > 0,
    do: Map.put(body, :max_output_tokens, default)

  defp responses_max_output_tokens(body, _default, _max), do: body

  defp request_body(state, %RequestIR{} = ir, params, stream?) do
    {:ok, projected} = Projection.project(ir, "chat_completions")

    projected
    |> Map.put(:stream, stream?)
    |> Map.put(:max_tokens, state.max_tokens)
    |> maybe_put_model(state.model)
    |> HTTP.apply_params(params)
    |> maybe_json_mode(state.json_mode, ir)
  end

  defp maybe_put_model(body, model) when is_binary(model) and model != "",
    do: Map.put(body, :model, model)

  defp maybe_put_model(body, _model), do: body

  defp models_url(endpoint) do
    endpoint
    |> String.trim_trailing("/")
    |> Kernel.<>("/models")
  end

  defp maybe_json_mode(body, true, prompt) do
    if RequestIR.Tools.tool_call_prompt?(prompt) do
      body
    else
      Map.put(body, :response_format, %{type: "json_object"})
    end
  end

  defp maybe_json_mode(body, _enabled, _prompt), do: body

  # 仅 supports_thinking 的供应商透传；其余供应商不发送 thinking 字段，避免被拒绝。
  defp maybe_thinking(body, false, _style, _thinking, _effort), do: body

  # :reasoning_effort 风格（本地 Strata / Qwen3.8）：思考开关走请求级顶层
  # reasoning_effort——"none" 完全关思考，显式 effort 透传，绝不发 thinking 对象。
  defp maybe_thinking(body, true, :reasoning_effort, :disabled, _effort),
    do: Map.put(body, :reasoning_effort, "none")

  defp maybe_thinking(body, true, :reasoning_effort, :enabled, effort)
       when is_binary(effort) and effort != "",
       do: Map.put(body, :reasoning_effort, effort)

  defp maybe_thinking(body, true, :reasoning_effort, _thinking, _effort), do: body

  # :thinking_object 风格（既有托管 API 矩阵）：保持三段行为不变。
  defp maybe_thinking(body, true, _style, :enabled, effort)
       when is_binary(effort) and effort != "" do
    body
    |> Map.put(:thinking, %{type: "enabled"})
    |> Map.put(:reasoning_effort, effort)
  end

  defp maybe_thinking(body, true, _style, :enabled, _effort),
    do: Map.put(body, :thinking, %{type: "enabled"})

  defp maybe_thinking(body, true, _style, _thinking, _effort),
    do: Map.put(body, :thinking, %{type: "disabled"})

  defp maybe_thinking(body, meta, state),
    do:
      maybe_thinking(
        body,
        meta.supports_thinking,
        meta.thinking_style,
        state.thinking,
        state.reasoning_effort
      )

  # key 必填：缺失即 auth 错误，绝不发 HTTP；keyless（本地 Strata）：无 Key 也
  # 允许请求（headers 为 []），配置了 Key 仍按 Bearer 发送。
  defp auth_headers(meta, key) do
    cond do
      is_binary(key) and key != "" -> {:ok, [{"authorization", "Bearer #{key}"}]}
      meta.api_key_required -> {:error, :auth_required}
      true -> {:ok, []}
    end
  end

  defp missing_key_error(meta) do
    err = UpstreamError.new(:auth, "#{meta.label} API key 未配置", meta.vendor)
    UpstreamError.to_error_tuple(err)
  end

  defp http_error_type(status) when status in [401, 402, 403], do: :auth
  defp http_error_type(429), do: :rate_limit
  defp http_error_type(status) when status in [400, 422], do: :invalid_request
  defp http_error_type(_status), do: :provider_internal

  defp models_from_openai_list(%{"data" => models}) when is_list(models) do
    models
    |> Enum.flat_map(&model_from_openai_entry/1)
    |> Enum.uniq_by(& &1.id)
  end

  defp models_from_openai_list(_body), do: []

  defp model_from_openai_entry(%{"id" => id} = model) when is_binary(id) and id != "" do
    [%{id: id, label: model_label(id, model), owned_by: normalize_owned_by(model["owned_by"])}]
  end

  defp model_from_openai_entry(_entry), do: []

  # OpenAI 兼容 /models 的标准字段只有 id；本地统一后台（Strata App）额外回传
  # meta.label（“Qwen3.8-Flash-Next IQ3_S”）。有可读 label 时用于设置页展示，
  # 否则回退 id（既有 vendor 行为不变）。
  defp model_label(_id, %{"meta" => %{"label" => label}})
       when is_binary(label) and label != "",
       do: label

  defp model_label(id, _model), do: id

  defp normalize_owned_by(owner) when is_binary(owner) and owner != "", do: owner
  defp normalize_owned_by(_owner), do: nil
end
