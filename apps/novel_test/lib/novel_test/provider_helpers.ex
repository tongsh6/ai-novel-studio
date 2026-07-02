defmodule NovelTest.ProviderHelpers do
  @moduledoc """
  跨 umbrella app 共享的 Provider 测试辅助函数。

  模型和端点通过系统配置控制（config/config.exs），可用环境变量覆盖：
    LMSTUDIO_MODEL — 模型名
    LMSTUDIO_ENDPOINT — 端点地址
  """

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.LMStudio
  alias NovelAgent.Provider.Result

  @doc """
  创建 LM Studio 的 result_fn，供 Planner 等模块注入使用。
  读取系统配置的 model/endpoint，可 override。
  """
  @spec lmstudio_result_fn(String.t(), String.t(), pos_integer()) :: function()
  def lmstudio_result_fn(endpoint \\ nil, model \\ nil, timeout \\ 60_000) do
    base = LMStudio.from_config()

    fn prompt ->
      state = %LMStudio{
        endpoint: endpoint || base.endpoint,
        model: model || base.model,
        timeout: timeout,
        log_fn: &NovelCommon.LLMLog.record/5
      }

      case LMStudio.complete(state, nil, prompt, %InferenceParams{}) do
        {:ok, %Result{content: content}} -> {:ok, %{content: content}}
        {:error, error} when is_map(error) -> {:error, error}
        {:error, reason} -> {:error, %{message: inspect(reason)}}
      end
    end
  end

  @doc """
  Wraps a deterministic completion callback as a provider execution dependency for tests.
  """
  @spec provider_execution(function()) :: Execution.t()
  def provider_execution(result_fn) when is_function(result_fn, 1),
    do: %Execution{result_fn: result_fn}

  @doc "返回系统配置的模型名。"
  def default_model, do: LMStudio.from_config().model

  @doc """
  检查 LM Studio 是否可用。使用 GET /v1/models 轻量探测，不发起推理。
  """
  @spec lmstudio_available?(String.t(), pos_integer()) :: boolean()
  def lmstudio_available?(endpoint \\ nil, timeout \\ 5_000) do
    ep = endpoint || LMStudio.from_config().endpoint
    url = Path.join(ep, "models")

    case HTTP.get(url, receive_timeout: timeout) do
      {:ok, _, _} -> true
      _ -> false
    end
  end
end
