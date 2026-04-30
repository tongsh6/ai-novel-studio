defmodule NovelAgent.Provider.Gateway do
  @moduledoc """
  Provider Gateway — 统一的 provider 路由入口。

  所有 caller（Router / Executor / LongRunner）通过 Gateway 调用 LLM，
  不直接依赖具体 adapter。Gateway 负责：

  1. 按配置选择 adapter
  2. 调用失败时按降级策略切换（fallback to stub）
  3. 统一 provider 调用方的 experience

  ## 配置

      config :novel_agent, :provider,
        default: :lmstudio,
        fallback: :stub

      config :novel_agent, NovelAgent.Provider.LMStudio,
        endpoint: "http://localhost:1234/v1",
        model: "local-model",
        timeout: 60_000

  ## 成品阶段扩展

  Gateway 从第一天就设计为多 provider 可注册。成品阶段用户通过 UI 配置
  切换到 Anthropic / OpenAI 等云端 provider 时，只需：
  1. 实现对应 adapter（遵循 `NovelAgent.Provider` behaviour）
  2. 在 config 中注册
  3. 用户通过 UI 选择（config 写入前端设置持久化）
  """

  require Logger

  alias NovelAgent.Provider
  alias NovelFoundation.UpstreamError

  @provider_modules %{
    stub: Provider.Stub,
    lmstudio: Provider.LMStudio
  }

  @doc """
  调用当前默认 provider 执行 complete。

  返回 `{:ok, content}` 或 `{:error, %{type: ..., message: ...}}`。
  """
  @spec complete(String.t(), String.t()) :: {:ok, String.t()} | {:error, map()}
  def complete(prompt, model \\ "local-model") do
    provider_name = default_provider()

    case do_complete(provider_name, model, prompt) do
      {:ok, _content} = ok ->
        ok

      {:error, error} ->
        Logger.warning("[提供者网关] #{provider_name} 调用失败：#{error.message}")

        if provider_name == fallback_provider() do
          # 已经是降级 provider，不再递归
          {:error, Map.from_struct(error)}
        else
          attempt_fallback(model, prompt, error)
        end
    end
  end

  @doc "返回当前已注册的 provider 列表。"
  @spec registered_providers() :: [atom()]
  def registered_providers, do: Map.keys(@provider_modules)

  # ---- private ----

  defp do_complete(provider_name, model, prompt) do
    case Map.fetch(@provider_modules, provider_name) do
      {:ok, module} ->
        state = build_state(module)
        module.complete(state, model, prompt)

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

  defp attempt_fallback(model, prompt, original_error) do
    fallback = fallback_provider()
    Logger.info("[提供者网关] 降级至 #{fallback}")

    case do_complete(fallback, model, prompt) do
      {:ok, content} ->
        {:ok, content}

      {:error, fb_error} ->
        Logger.error("[提供者网关] 降级也失败了：#{fb_error.message}")
        {:error, Map.from_struct(original_error)}
    end
  end

  defp default_provider do
    Application.get_env(:novel_agent, :provider, [])
    |> Keyword.get(:default, :stub)
  end

  defp fallback_provider do
    Application.get_env(:novel_agent, :provider, [])
    |> Keyword.get(:fallback, :stub)
  end
end
