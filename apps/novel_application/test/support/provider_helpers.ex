defmodule NovelApplication.Test.ProviderHelpers do
  @moduledoc """
  真实 provider 集成测试的辅助函数。

  使用直接 adapter 调用（不经过 Gateway 路由和 Application env），
  保证测试隔离，不会污染其他并发测试。
  """

  alias NovelAgent.Provider.LMStudio
  alias NovelAgent.Provider.Result

  @doc """
  创建 LM Studio 的 complete_fn，供 Planner 注入使用。
  直接调用 adapter，不修改全局 Application env。
  """
  @spec lmstudio_complete_fn(String.t(), String.t(), pos_integer()) :: function()
  def lmstudio_complete_fn(endpoint \\ "http://localhost:1234/v1",
                           model \\ "openai/gpt-oss-120b",
                           timeout \\ 60_000) do
    fn prompt ->
      state = %LMStudio{endpoint: endpoint, model: model, timeout: timeout}

      case LMStudio.complete(state, nil, prompt) do
        {:ok, %Result{content: content}} -> {:ok, %{content: content}}
        {:error, error} when is_map(error) -> {:error, error}
        {:error, reason} -> {:error, %{message: inspect(reason)}}
      end
    end
  end

  @doc """
  检查 LM Studio 是否可用。使用探活 ping。
  """
  @spec lmstudio_available?(String.t(), String.t(), pos_integer()) :: boolean()
  def lmstudio_available?(endpoint \\ "http://localhost:1234/v1",
                          model \\ "openai/gpt-oss-120b",
                          timeout \\ 5_000) do
    state = %LMStudio{endpoint: endpoint, model: model, timeout: timeout}

    case LMStudio.complete(state, nil, "ping") do
      {:ok, %{content: content}} when is_binary(content) and byte_size(content) > 0 -> true
      _ -> false
    end
  end
end
