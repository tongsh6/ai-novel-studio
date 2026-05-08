defmodule NovelTest.ProviderHelpers do
  @moduledoc """
  跨 umbrella app 共享的 Provider 测试辅助函数。

  避免 novel_application 和 novel_web 的 test/support 重复代码。
  """

  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.LMStudio
  alias NovelAgent.Provider.Result

  @doc """
  创建 LM Studio 的 complete_fn，供 Planner 等模块注入使用。
  直接调用 adapter，不修改全局 Application env。
  """
  @spec lmstudio_complete_fn(String.t(), String.t(), pos_integer()) :: function()
  def lmstudio_complete_fn(endpoint \\ "http://localhost:1234/v1",
                           model \\ "qwen/qwen3.5-122b-a10b",
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

  @doc """
  检查 LM Studio 是否可用。使用 GET /v1/models 轻量探测，不发起推理。
  """
  @spec lmstudio_available?(String.t(), pos_integer()) :: boolean()
  def lmstudio_available?(endpoint \\ "http://localhost:1234/v1",
                          timeout \\ 5_000) do
    url = Path.join(endpoint, "models")

    case HTTP.get(url, receive_timeout: timeout) do
      {:ok, _, _} -> true
      _ -> false
    end
  end
end
