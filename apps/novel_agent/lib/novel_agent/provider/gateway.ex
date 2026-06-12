defmodule NovelAgent.Provider.Gateway do
  @moduledoc """
  Provider Gateway — 统一的 provider 路由入口。

  所有 caller（Router / Executor / LongRunner）通过 Gateway 调用 LLM，
  不直接依赖具体 adapter。Gateway 负责：

  1. 按配置选择 adapter
  2. 调用失败时直接返回错误——不做降级（产品不应在 LLM 不可用时冒充可用）
  3. 将旧版 `{:ok, content_string}` 自动包装为 `{:ok, %Result{}}`

  ## 配置

      config :novel_agent, :provider,
        default: :lmstudio

      config :novel_agent, NovelAgent.Provider.LMStudio,
        endpoint: "http://localhost:1234/v1",
        model: "qwen/qwen3.6-35b-a3b"
  """

  require Logger
  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.RuntimeConfig
  alias NovelFoundation.UpstreamError

  @provider_modules %{
    stub: Provider.Stub,
    lmstudio: Provider.LMStudio,
    anthropic: Provider.Anthropic,
    deepseek: Provider.DeepSeek
  }

  @provider_descriptors %{
    stub: %{
      label: "Stub",
      requires_api_key: false,
      supports_api_key: false,
      supports_endpoint: false,
      supports_thinking: false
    },
    lmstudio: %{
      label: "LM Studio",
      requires_api_key: false,
      supports_api_key: false,
      supports_endpoint: true,
      supports_thinking: false
    },
    anthropic: %{
      label: "Anthropic",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: false,
      supports_thinking: false
    },
    deepseek: %{
      label: "DeepSeek",
      requires_api_key: true,
      supports_api_key: true,
      supports_endpoint: true,
      supports_thinking: true
    }
  }

  @type result :: {:ok, Result.t()} | {:error, map()}
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
  调用当前默认 provider 执行 complete。

  可传入 InferenceParams 覆盖默认推理参数（temperature / max_tokens 等）。
  返回 `{:ok, %Result{content: content, usage: usage}}`。
  LLM 不可用时返回 `{:error, error}`——不做降级，让上层告知用户。
  """
  @spec complete(String.t(), String.t() | nil, InferenceParams.t()) :: result()
  def complete(prompt, model \\ nil, params \\ %InferenceParams{}) do
    provider_name = default_provider()
    model_name = model || default_model()

    case do_complete(provider_name, model_name, prompt, params) do
      {:ok, %Result{} = result} ->
        {:ok, result}

      {:ok, content} when is_binary(content) ->
        {:ok, Result.new(content)}

      {:error, error} ->
        Logger.warning(
          "[提供者网关] #{provider_name} 调用失败：#{get_in(error, [:message]) || inspect(error)}"
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
         {:ok, module} <- fetch_module(provider) do
      config = normalize_provider_config(provider, attrs)

      merged_config =
        merged_config(provider, module, config, clear_api_key?: clear_api_key?(attrs))

      RuntimeConfig.put_provider_config(provider, merged_config)
      RuntimeConfig.put_current_provider(provider)

      state = build_state(provider, module)
      {:ok, %{provider: provider, model: normalize_model(Map.get(state, :model))}}
    end
  end

  @doc "使用传入配置做一次轻量连接测试，不改变当前运行时选择。"
  @spec test_provider(provider_config()) ::
          {:ok, %{provider: atom(), model: String.t() | nil}} | {:error, map()}
  def test_provider(attrs) when is_map(attrs) do
    with {:ok, provider} <- fetch_provider(attrs),
         {:ok, module} <- fetch_module(provider) do
      config = normalize_provider_config(provider, attrs)
      state = build_state(provider, module, config, clear_api_key?: clear_api_key?(attrs))
      metadata = %{provider: provider, model: normalize_model(Map.get(state, :model))}

      case module.health_check(state) do
        :ok -> {:ok, metadata}
        {:error, error} -> {:error, Map.put(metadata, :error, error)}
      end
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
      config = normalize_provider_config(provider, attrs)
      state = build_state(provider, module, config, clear_api_key?: clear_api_key?(attrs))
      provider_models_result(provider, module.list_models(state))
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

  defp do_complete(provider_name, model, prompt, params) do
    started = System.monotonic_time(:millisecond)

    LogEmit.emit(:provider_gateway, :complete, :start, %{
      provider: provider_name,
      model: model
    })

    case Map.fetch(provider_modules(), provider_name) do
      {:ok, module} ->
        state = build_state(provider_name, module)
        result = module.complete(state, model, prompt, params)
        emit_provider_complete_result(provider_name, model, result, started)
        result

      :error ->
        err =
          UpstreamError.new(:provider_internal, "unknown provider: #{provider_name}", "gateway")

        result = UpstreamError.to_error_tuple(err)
        emit_provider_complete_result(provider_name, model, result, started)
        result
    end
  end

  defp emit_provider_complete_result(provider_name, model, result, started) do
    duration = System.monotonic_time(:millisecond) - started

    case result do
      {:ok, %Result{} = provider_result} ->
        LogEmit.emit(:provider_gateway, :complete, :done, %{
          provider: provider_name,
          model: result_model(provider_result, model),
          duration_ms: duration
        })

      {:ok, _content} ->
        LogEmit.emit(:provider_gateway, :complete, :done, %{
          provider: provider_name,
          model: model,
          duration_ms: duration
        })

      {:error, error} ->
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
        supports_thinking: false
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

  defp default_provider do
    case RuntimeConfig.current_provider() do
      provider when is_atom(provider) and not is_nil(provider) ->
        provider

      _ ->
        Application.get_env(:novel_agent, :provider, [])
        |> Keyword.get(:default, :stub)
    end
  end

  defp default_model do
    Application.get_env(:novel_agent, :provider, [])
    |> Keyword.get(:model, "qwen/qwen3.6-35b-a3b")
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

  defp normalize_provider_config(_provider, attrs) do
    [
      model: optional_string(attrs, :model),
      endpoint: optional_string(attrs, :endpoint),
      api_key: optional_string(attrs, :api_key),
      thinking: normalize_thinking(optional_string(attrs, :thinking)),
      reasoning_effort: optional_string(attrs, :reasoning_effort)
    ]
    |> Enum.reject(fn
      {_key, nil} -> true
      _entry -> false
    end)
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
