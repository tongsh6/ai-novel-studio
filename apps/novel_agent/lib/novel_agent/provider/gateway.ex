defmodule NovelAgent.Provider.Gateway do
  @moduledoc """
  Provider Gateway — 统一的 provider 路由入口。

  所有 caller（Router / Executor / LongRunner）通过 Gateway 调用 LLM，
  不直接依赖具体 adapter。Gateway 负责：

  1. 按配置选择 adapter
  2. 调用失败时直接返回错误——不切换到替代执行路径（产品不应在 LLM 不可用时冒充可用）
  3. 将旧版 `{:ok, content_string}` 自动包装为 `{:ok, %Result{}}`

  ## 配置

      config :novel_agent, :provider,
        default: :lmstudio

      config :novel_agent, NovelAgent.Provider.LMStudio,
        endpoint: "http://localhost:1234/v1",
        model: "qwen/qwen3.8-27b"
  """

  require Logger
  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider
  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.RuntimeConfig
  alias NovelCommon.Contracts.ProviderEvent
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.Contracts.ProviderRun
  alias NovelFoundation.UpstreamError

  @provider_modules %{
    stub: Provider.Stub,
    lmstudio: Provider.LMStudio,
    anthropic: Provider.Anthropic,
    deepseek: Provider.DeepSeek,
    openai: Provider.OpenAI,
    openai_subscription: Provider.OpenAISubscription,
    minimax: Provider.Minimax,
    minimax_cn: Provider.MinimaxCN,
    zhipu: Provider.Zhipu,
    kimi: Provider.Kimi,
    gemini: Provider.Gemini
  }

  @provider_descriptors %{
    stub: %{
      label: "Stub",
      requires_api_key: false,
      supports_api_key: false,
      supports_endpoint: false,
      supports_thinking: false,
      supports_streaming: true,
      supports_cancellation: true
    },
    lmstudio: %{
      label: "LM Studio",
      requires_api_key: false,
      supports_api_key: false,
      supports_endpoint: true,
      supports_thinking: false,
      supports_streaming: true,
      supports_cancellation: true
    },
    anthropic: %{
      label: "Anthropic",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: false,
      supports_thinking: false,
      supports_streaming: true,
      supports_cancellation: true
    },
    deepseek: %{
      label: "DeepSeek",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: true,
      supports_thinking: true,
      supports_streaming: true,
      supports_cancellation: true
    },
    openai: %{
      label: "OpenAI（API Key）",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: true,
      supports_thinking: false,
      supports_streaming: true,
      supports_cancellation: true
    },
    openai_subscription: %{
      label: "OpenAI（订阅）",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: true,
      supports_thinking: false,
      supports_streaming: true,
      supports_cancellation: true
    },
    minimax: %{
      label: "Minimax (国际版)",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: true,
      supports_thinking: false,
      supports_streaming: true,
      supports_cancellation: true
    },
    minimax_cn: %{
      label: "Minimax (国内版)",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: true,
      supports_thinking: false,
      supports_streaming: true,
      supports_cancellation: true
    },
    zhipu: %{
      label: "智谱",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: true,
      supports_thinking: false,
      supports_streaming: true,
      supports_cancellation: true
    },
    kimi: %{
      label: "Kimi",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: true,
      supports_thinking: false,
      supports_streaming: true,
      supports_cancellation: true
    },
    gemini: %{
      label: "Gemini",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: true,
      supports_thinking: false,
      supports_streaming: true,
      supports_cancellation: true
    }
  }

  @type result :: {:ok, Result.t()} | {:error, map()}
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
  @type provider_config :: %{
          optional(:provider) => atom() | String.t(),
          optional(:model) => String.t() | nil,
          optional(:endpoint) => String.t() | nil,
          optional(:api_key) => String.t() | nil,
          optional(:clear_api_key) => boolean() | String.t() | nil,
          optional(:thinking) => String.t() | atom() | nil,
          optional(:reasoning_effort) => String.t() | nil
        }

  @doc """
  通过统一 provider execution stream 执行一次 provider 调用。

  Gateway 只负责选择 adapter、生成 provider execution context、记录入口日志。
  底层 adapter 目前仍可能只提供一次性 `complete/4` 回调，但 final-only 结果由
  adapter execution boundary 物化为同一套 ProviderRun / ProviderEvent /
  ProviderOutput 事实。应用层不得在这里之外再新增 complete-vs-stream 分支。
  """
  # 缺陷九（2026-07-20）：默认值必须走 InferenceParams.new/1（带 max_tokens 止血阀），
  # 不能是裸 %InferenceParams{}（defstruct 字段全 nil=无界）。全仓 3 处默认值funnel
  # 之一——Execution.execute/2、Gateway.complete/3 同类，三处必须同步，否则任一处漏改
  # 就有调用路径绕过止血阀（实测：正文起草 purpose: :writer 走的正是 execution.ex 那处，
  # 曾经真实跑到 36000+ token 未停）。
  @spec execute(Provider.prompt(), String.t() | nil, InferenceParams.t(), keyword()) ::
          execution_result()
  def execute(prompt, model \\ nil, params \\ InferenceParams.new(), opts \\ []) do
    provider_name = Keyword.get(opts, :provider, default_provider())
    model_name = model || Keyword.get(opts, :model) || default_model(provider_name)
    provider_call_ref = Keyword.get(opts, :provider_call_ref) || provider_call_ref()
    provider_run_id = Keyword.get(opts, :provider_run_id) || provider_run_id()
    purpose = Keyword.get(opts, :purpose, :conversation)
    owner_refs = Keyword.get(opts, :owner_refs, %{})
    event_sink = Keyword.get(opts, :event_sink)
    cancellation_token = Keyword.get(opts, :cancellation_token)
    started = System.monotonic_time(:millisecond)

    LogEmit.emit(:provider_gateway, :complete, :start, %{
      provider: provider_name,
      model: model_name
    })

    execution =
      execute_provider(provider_name, model_name, prompt, params, %{
        provider_name: provider_name,
        model_name: model_name,
        provider_call_ref: provider_call_ref,
        provider_run_id: provider_run_id,
        purpose: purpose,
        owner_refs: owner_refs,
        event_sink: event_sink,
        cancellation_token: cancellation_token
      })

    emit_provider_execution_result(provider_name, model_name, execution, started)
    execution
  end

  @doc """
  调用当前默认 provider 执行 complete。

  可传入 InferenceParams 覆盖默认推理参数（temperature / max_tokens 等）。
  返回 `{:ok, %Result{content: content, usage: usage}}`。
  LLM 不可用时返回 `{:error, error}`——不切换到替代执行路径，让上层告知用户。
  """
  @spec complete(String.t(), String.t() | nil, InferenceParams.t()) :: result()
  def complete(prompt, model \\ nil, params \\ InferenceParams.new()) do
    case execute(prompt, model, params) do
      {:ok, %{result: %Result{} = result}} ->
        {:ok, result}

      {:error, %{error: error}} ->
        Logger.warning(
          "[提供者网关] #{default_provider()} 调用失败：#{get_in(error, [:message]) || inspect(error)}"
        )

        {:error, if(is_map(error), do: error, else: %{message: inspect(error)})}
    end
  end

  @doc """
  当前 provider 的轻量健康检查——不发送 LLM 请求，不消耗 token。
  各 adapter 自行实现：LM Studio 查 /v1/models，Anthropic 检查 API key。
  """
  @spec health_check() :: :ok | {:error, map()}
  def health_check do
    provider_name = default_provider()

    case Map.fetch(provider_modules(), provider_name) do
      {:ok, module} ->
        state = build_state(provider_name, module)
        module.health_check(state)

      :error ->
        {:error, %{message: "unknown provider: #{provider_name}"}}
    end
  end

  @doc """
  返回当前默认 provider 的可展示元数据。

  这是 health/status UI 的契约来源；上层不需要知道具体 adapter 的配置模块。
  """
  @spec provider_metadata() :: %{provider: atom(), model: String.t() | nil}
  def provider_metadata do
    provider_name = default_provider()

    model =
      case Map.fetch(provider_modules(), provider_name) do
        {:ok, module} ->
          provider_name
          |> build_state(module)
          |> Map.get(:model)
          |> normalize_model()

        :error ->
          nil
      end

    %{provider: provider_name, model: model}
  end

  @doc "返回当前已注册的 provider 列表。"
  @spec registered_providers() :: [atom()]
  def registered_providers, do: provider_modules() |> Map.keys()

  @doc "返回当前 provider 对 AgentRun runtime 可声明的执行能力。"
  @spec provider_capabilities() :: map()
  def provider_capabilities do
    provider = default_provider()
    descriptor = provider_descriptor(provider)

    %{
      provider: provider,
      supports_streaming: Map.get(descriptor, :supports_streaming, false),
      supports_cancellation: Map.get(descriptor, :supports_cancellation, false),
      cancel_strategy:
        if(Map.get(descriptor, :supports_cancellation, false),
          do: :provider_execution_cancel,
          else: :not_available
        )
    }
  end

  @doc "返回 provider 设置页所需的只读选项；不会返回 secret。"
  @spec provider_options() :: %{current_provider: atom(), providers: [map()]}
  def provider_options do
    current_provider = default_provider()

    providers =
      provider_modules()
      |> Map.keys()
      |> Enum.sort()
      |> Enum.map(&provider_option(&1, current_provider))

    %{current_provider: current_provider, providers: providers}
  end

  @doc "保存当前运行时 provider 选择与配置。"
  @spec configure_provider(provider_config()) ::
          {:ok, %{provider: atom(), model: String.t() | nil}} | {:error, map()}
  def configure_provider(attrs) when is_map(attrs) do
    with {:ok, provider} <- fetch_provider(attrs),
         {:ok, module} <- fetch_module(provider),
         {:ok, config} <- normalize_provider_config(provider, attrs) do
      merged_config =
        merged_config(provider, module, config, clear_api_key?: clear_api_key?(attrs))

      RuntimeConfig.put_provider_config(provider, merged_config)
      RuntimeConfig.put_current_provider(provider)

      state = build_state(provider, module)
      {:ok, %{provider: provider, model: normalize_model(Map.get(state, :model))}}
    end
  end

  @doc """
  使用传入配置做一次真实连接探测（GET /models），不改变当前运行时选择。

  与轻量的 `health_check/0`（顶栏被动轮询用，仅查本地配置）不同，这里是用户
  主动点击"测试连接"触发的真实网络请求：验证端点可达 + API key 有效 + 网络通。
  走 `list_models`（GET /models），不消耗生成 token。无 `list_models` 的 provider
  （如 stub）回退到本地 `health_check`。
  """
  @spec test_provider(provider_config()) ::
          {:ok, %{provider: atom(), model: String.t() | nil}} | {:error, map()}
  def test_provider(attrs) when is_map(attrs) do
    with {:ok, provider} <- fetch_provider(attrs),
         {:ok, module} <- fetch_module(provider),
         {:ok, config} <- normalize_provider_config(provider, attrs) do
      state = build_state(provider, module, config, clear_api_key?: clear_api_key?(attrs))
      metadata = %{provider: provider, model: normalize_model(Map.get(state, :model))}

      case probe_connection(module, state) do
        :ok -> {:ok, metadata}
        {:error, error} -> {:error, Map.put(metadata, :error, error)}
      end
    end
  end

  # 真实连接探测：优先用 list_models（GET /models）发一次真实网络请求，验证
  # 端点/key/网络且不消耗生成 token。无 list_models 的 provider 回退到 health_check。
  defp probe_connection(module, state) do
    if Code.ensure_loaded?(module) and function_exported?(module, :list_models, 1) do
      case module.list_models(state) do
        {:ok, _models} -> :ok
        {:error, error} -> {:error, error}
      end
    else
      module.health_check(state)
    end
  end

  @doc "使用传入配置实时拉取 provider 当前可用模型列表，不改变当前运行时选择。"
  @spec provider_models(provider_config()) ::
          {:ok, %{provider: atom(), models: [map()]}} | {:error, map()}
  def provider_models(attrs) when is_map(attrs) do
    with {:ok, provider} <- fetch_provider(attrs),
         {:ok, module} <- fetch_module(provider) do
      provider_models(provider, module, attrs)
    end
  end

  # ---- private ----

  defp provider_models(provider, module, attrs) do
    if Code.ensure_loaded?(module) and function_exported?(module, :list_models, 1) do
      with {:ok, config} <- normalize_provider_config(provider, attrs) do
        state = build_state(provider, module, config, clear_api_key?: clear_api_key?(attrs))
        provider_models_result(provider, module.list_models(state))
      end
    else
      {:ok, %{provider: provider, models: []}}
    end
  end

  defp provider_models_result(provider, {:ok, models}) do
    {:ok, %{provider: provider, models: normalize_model_options(models)}}
  end

  defp provider_models_result(provider, {:error, error}) do
    {:error,
     %{
       provider: provider,
       error: normalize_error(error),
       message: error_message(error, "模型列表加载失败")
     }}
  end

  defp execute_provider(provider_name, model, prompt, params, ctx) do
    case Map.fetch(provider_modules(), provider_name) do
      {:ok, module} ->
        state = build_state(provider_name, module)
        execute_adapter(module, state, model, prompt, params, ctx)

      :error ->
        err =
          UpstreamError.new(:provider_internal, "unknown provider: #{provider_name}", "gateway")

        err
        |> UpstreamError.to_error_tuple()
        |> AdapterExecution.materialize_result(ctx)
    end
  end

  defp execute_adapter(module, state, model, prompt, params, ctx) do
    if Code.ensure_loaded?(module) and function_exported?(module, :execute, 5) do
      module.execute(state, model, prompt, params, ctx)
    else
      AdapterExecution.execute(module, state, model, prompt, params, ctx)
    end
  end

  defp provider_run_id, do: NovelFoundation.ID.unique("prun")
  defp provider_call_ref, do: NovelFoundation.ID.unique("pcall")

  defp emit_provider_execution_result(provider_name, model, execution, started) do
    duration = System.monotonic_time(:millisecond) - started

    case execution do
      {:ok, %{result: %Result{} = provider_result}} ->
        LogEmit.emit(:provider_gateway, :complete, :done, %{
          provider: provider_name,
          model: result_model(provider_result, model),
          duration_ms: duration
        })

      {:error, %{error: error}} ->
        LogEmit.emit(:provider_gateway, :complete, :error, %{
          provider: provider_name,
          model: model,
          duration_ms: duration,
          reason_code: Map.get(error, :type, :provider_error),
          outcome_detail: Map.get(error, :message)
        })

      _ ->
        LogEmit.emit(:provider_gateway, :complete, :error, %{
          provider: provider_name,
          model: model,
          duration_ms: duration,
          reason_code: :provider_error
        })
    end
  end

  defp result_model(%Result{usage: %{model: provider_model}}, _fallback)
       when is_binary(provider_model) and provider_model != "",
       do: provider_model

  defp result_model(%Result{}, fallback), do: fallback

  defp provider_option(provider, current_provider) do
    module = Map.fetch!(provider_modules(), provider)
    state = build_state(provider, module)

    descriptor =
      %{
        label: to_string(provider),
        requires_api_key: false,
        supports_api_key: false,
        supports_endpoint: false,
        supports_thinking: false,
        supports_streaming: false,
        supports_cancellation: false
      }
      |> Map.merge(Map.get(@provider_descriptors, provider, %{}))

    descriptor
    |> Map.merge(%{
      id: provider,
      current: provider == current_provider,
      model: normalize_model(Map.get(state, :model)),
      endpoint: normalize_endpoint(Map.get(state, :endpoint)),
      api_key_configured: api_key_configured?(state)
    })
  end

  defp build_state(provider, module, override_config \\ [], opts \\ []) do
    if Code.ensure_loaded?(module) and function_exported?(module, :from_config, 0) do
      if function_exported?(module, :from_config, 1) do
        module.from_config(merged_config(provider, module, override_config, opts))
      else
        module.from_config()
      end
    else
      module.__struct__()
    end
  end

  defp provider_modules do
    extra =
      Application.get_env(:novel_agent, :extra_providers, [])
      |> Map.new()

    Map.merge(@provider_modules, extra)
  end

  defp provider_descriptor(provider) do
    %{
      supports_streaming: false,
      supports_cancellation: false
    }
    |> Map.merge(Map.get(@provider_descriptors, provider, %{}))
  end

  defp default_provider do
    case RuntimeConfig.current_provider() do
      provider when is_atom(provider) and not is_nil(provider) ->
        provider

      _ ->
        Application.get_env(:novel_agent, :provider, [])
        |> Keyword.get(:default, :stub)
    end
  end

  # M5 狗粮排查（2026-08-25）：此处原为陈腐硬编码回落（"qwen/qwen3.6-35b-a3b"）——
  # adapter 实际忽略该参数、按自身配置发 HTTP，于是 start/error 日志与 provider 事件
  # 记的是一个从未被请求的模型名，直接误导排查（M4 B8b 同源病灶的日志变体）。
  # 诚实解析：运行时配置 → 该 provider 的应用配置 → 全局 :provider 配置 →
  # 明示 "unconfigured"（没人声明过就说没声明，不编造）。
  defp default_model(provider_name) do
    runtime_model = RuntimeConfig.provider_config(provider_name)[:model]

    runtime_model ||
      provider_app_config_model(provider_name) ||
      Application.get_env(:novel_agent, :provider, [])[:model] ||
      "unconfigured"
  end

  defp provider_app_config_model(provider_name) do
    case Map.get(provider_modules(), provider_name) do
      nil -> nil
      module -> Application.get_env(:novel_agent, module, [])[:model]
    end
  end

  defp fetch_provider(attrs) do
    provider = Map.get(attrs, :provider) || Map.get(attrs, "provider")

    cond do
      is_atom(provider) and Map.has_key?(provider_modules(), provider) ->
        {:ok, provider}

      is_atom(provider) ->
        unknown_provider_error(provider)

      is_binary(provider) ->
        with {:ok, provider} <- safe_existing_atom(provider),
             true <- Map.has_key?(provider_modules(), provider) do
          {:ok, provider}
        else
          _ -> unknown_provider_error(provider)
        end

      true ->
        {:error, %{message: "provider is required", type: :invalid_provider}}
    end
  end

  defp fetch_module(provider) do
    case Map.fetch(provider_modules(), provider) do
      {:ok, module} -> {:ok, module}
      :error -> unknown_provider_error(provider)
    end
  end

  defp unknown_provider_error(provider) do
    {:error, %{message: "unknown provider: #{provider}", type: :invalid_provider}}
  end

  defp safe_existing_atom(value) do
    {:ok, String.to_existing_atom(value)}
  rescue
    ArgumentError -> {:error, :invalid_provider}
  end

  defp normalize_provider_config(provider, attrs) do
    endpoint = optional_string(attrs, :endpoint)

    with :ok <- validate_endpoint(provider, endpoint) do
      config =
        [
          model: optional_string(attrs, :model),
          endpoint: endpoint,
          api_key: optional_string(attrs, :api_key),
          thinking: normalize_thinking(optional_string(attrs, :thinking)),
          reasoning_effort: optional_string(attrs, :reasoning_effort)
        ]
        |> Enum.reject(fn
          {_key, nil} -> true
          _entry -> false
        end)

      {:ok, config}
    end
  end

  defp validate_endpoint(_provider, nil), do: :ok

  defp validate_endpoint(provider, endpoint) do
    descriptor = Map.get(@provider_descriptors, provider, %{})

    if Map.get(descriptor, :supports_endpoint, false) do
      case URI.parse(endpoint) do
        %URI{scheme: scheme, host: host} when scheme in ["http", "https"] and is_binary(host) ->
          :ok

        _ ->
          {:error,
           %{
             message: "端点必须是完整的 http(s) URL。",
             type: :invalid_endpoint
           }}
      end
    else
      :ok
    end
  end

  defp optional_string(attrs, key) do
    value = Map.get(attrs, key) || Map.get(attrs, Atom.to_string(key))

    case value do
      value when is_binary(value) ->
        trimmed = String.trim(value)
        if trimmed == "", do: nil, else: trimmed

      _ ->
        nil
    end
  end

  defp normalize_thinking(value) when value in ["enabled", "disabled"], do: value
  defp normalize_thinking(_value), do: nil

  defp clear_api_key?(attrs) do
    value = Map.get(attrs, :clear_api_key) || Map.get(attrs, "clear_api_key")
    value == true or value == "true"
  end

  defp merged_config(provider, module, override_config, opts) do
    base_config = Application.get_env(:novel_agent, module, [])
    runtime_config = RuntimeConfig.provider_config(provider)

    base_config
    |> Keyword.merge(runtime_config)
    |> maybe_clear_api_key(opts)
    |> Keyword.merge(override_config)
  end

  defp maybe_clear_api_key(config, opts) do
    if Keyword.get(opts, :clear_api_key?, false) do
      Keyword.delete(config, :api_key)
    else
      config
    end
  end

  defp normalize_model(model) when is_binary(model) and model != "", do: model
  defp normalize_model(_model), do: nil

  defp normalize_endpoint(endpoint) when is_binary(endpoint) and endpoint != "", do: endpoint
  defp normalize_endpoint(_endpoint), do: nil

  defp normalize_model_options(models) when is_list(models) do
    models
    |> Enum.flat_map(&normalize_model_option/1)
    |> Enum.uniq_by(& &1.id)
  end

  defp normalize_model_options(_models), do: []

  defp normalize_model_option(model) when is_map(model) do
    id = Map.get(model, :id) || Map.get(model, "id")
    label = Map.get(model, :label) || Map.get(model, "label") || id
    owned_by = Map.get(model, :owned_by) || Map.get(model, "owned_by")

    if is_binary(id) and String.trim(id) != "" do
      [
        %{
          id: String.trim(id),
          label: normalize_model_label(label, id),
          owned_by: normalize_optional_value(owned_by)
        }
      ]
    else
      []
    end
  end

  defp normalize_model_option(_model), do: []

  defp normalize_model_label(label, fallback) when is_binary(label) do
    trimmed = String.trim(label)
    if trimmed == "", do: fallback, else: trimmed
  end

  defp normalize_model_label(_label, fallback), do: fallback

  defp normalize_optional_value(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_optional_value(_value), do: nil

  defp normalize_error(error) when is_map(error), do: error
  defp normalize_error(error), do: %{message: inspect(error)}

  defp error_message(error, fallback) when is_map(error) do
    Map.get(error, :message) || Map.get(error, "message") || fallback
  end

  defp error_message(_error, fallback), do: fallback

  defp api_key_configured?(state) do
    case Map.get(state, :api_key) do
      key when is_binary(key) -> String.trim(key) != ""
      _ -> false
    end
  end
end
