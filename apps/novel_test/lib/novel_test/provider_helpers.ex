defmodule NovelTest.ProviderHelpers do
  @moduledoc """
  跨 umbrella app 共享的 Provider 测试辅助函数。

  模型通过环境变量 LLM_TEST_MODEL 控制，默认 qwen/qwen3.5-122b-a10b。
  端点通过 LLM_TEST_ENDPOINT 控制，默认 http://localhost:1234/v1。
  """

  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.LMStudio
  alias NovelAgent.Provider.Result

  @default_endpoint "http://localhost:1234/v1"
  @default_model "qwen/qwen3.5-122b-a10b"

  @doc """
  创建 LM Studio 的 complete_fn，供 Planner 等模块注入使用。
  """
  @spec lmstudio_complete_fn(String.t(), String.t(), pos_integer()) :: function()
  def lmstudio_complete_fn(endpoint \\ default_endpoint(),
                           model \\ default_model(),
                           timeout \\ 60_000) do
    fn prompt ->
      state = %LMStudio{endpoint: endpoint, model: model, timeout: timeout,
                        log_fn: &NovelAgent.LLMLog.record/5}

      case LMStudio.complete(state, nil, prompt, %InferenceParams{}) do
        {:ok, %Result{content: content}} -> {:ok, %{content: content}}
        {:error, error} when is_map(error) -> {:error, error}
        {:error, reason} -> {:error, %{message: inspect(reason)}}
      end
    end
  end

  @doc "返回当前配置的测试端点。"
  def default_endpoint, do: System.get_env("LLM_TEST_ENDPOINT", @default_endpoint)

  @doc "返回当前配置的测试模型名。"
  def default_model, do: System.get_env("LLM_TEST_MODEL", @default_model)

  @doc """
  检查 LM Studio 是否可用。使用 GET /v1/models 轻量探测，不发起推理。
  """
  @spec lmstudio_available?(String.t(), pos_integer()) :: boolean()
  def lmstudio_available?(endpoint \\ default_endpoint(),
                          timeout \\ 5_000) do
    url = Path.join(endpoint, "models")

    case HTTP.get(url, receive_timeout: timeout) do
      {:ok, _, _} -> true
      _ -> false
    end
  end
end
