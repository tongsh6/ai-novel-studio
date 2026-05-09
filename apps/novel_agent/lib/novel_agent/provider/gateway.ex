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

  alias NovelAgent.Provider
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result
  alias NovelFoundation.UpstreamError

  @provider_modules %{
    stub: Provider.Stub,
    lmstudio: Provider.LMStudio,
    anthropic: Provider.Anthropic
  }

  @type result :: {:ok, Result.t()} | {:error, map()}

  @doc """
  调用当前默认 provider 执行 complete。

  可传入 InferenceParams 覆盖默认推理参数（temperature / max_tokens 等）。
  返回 `{:ok, %Result{content: content, usage: usage}}`。
  LLM 不可用时返回 `{:error, error}`——不做降级，让上层告知用户。
  """
  @spec complete(String.t(), String.t() | nil, InferenceParams.t()) :: result()
  def complete(prompt, model \\ nil, params \\ %InferenceParams{}) do
    provider_name = default_provider()

    case do_complete(provider_name, model || default_model(), prompt, params) do
      {:ok, %Result{} = result} ->
        {:ok, result}

      {:ok, content} when is_binary(content) ->
        {:ok, Result.new(content)}

      {:error, error} ->
        Logger.warning("[提供者网关] #{provider_name} 调用失败：#{get_in(error, [:message]) || inspect(error)}")
        {:error, if(is_map(error), do: error, else: %{message: inspect(error)})}
    end
  end

  @doc "返回当前已注册的 provider 列表。"
  @spec registered_providers() :: [atom()]
  def registered_providers, do: Map.keys(@provider_modules)

  # ---- private ----

  defp do_complete(provider_name, model, prompt, params) do
    case Map.fetch(@provider_modules, provider_name) do
      {:ok, module} ->
        state = build_state(module)
        module.complete(state, model, prompt, params)

      :error ->
        err = UpstreamError.new(:provider_internal, "unknown provider: #{provider_name}", "gateway")
        UpstreamError.to_error_tuple(err)
    end
  end

  defp build_state(module) do
    if function_exported?(module, :from_config, 0) do
      module.from_config()
    else
      module.__struct__()
    end
  end

  defp default_provider do
    Application.get_env(:novel_agent, :provider, [])
    |> Keyword.get(:default, :stub)
  end

  defp default_model do
    Application.get_env(:novel_agent, :provider, [])
    |> Keyword.get(:model, "qwen/qwen3.6-35b-a3b")
  end
end
