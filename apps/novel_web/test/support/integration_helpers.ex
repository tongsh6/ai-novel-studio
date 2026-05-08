defmodule NovelWeb.Test.IntegrationHelpers do
  @moduledoc """
  VS-08 集成测试辅助函数 — 在 novel_web 层提供 LM Studio 真实调用能力。
  """

  alias NovelAgent.Provider.LMStudio
  alias NovelAgent.Provider.Result

  @doc "创建 LM Studio 的 complete_fn，供 Planner 注入。"
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

  @doc "检查 LM Studio 是否可用。"
  def lmstudio_available?(endpoint \\ "http://localhost:1234/v1",
                          model \\ "openai/gpt-oss-120b",
                          timeout \\ 5_000) do
    state = %LMStudio{endpoint: endpoint, model: model, timeout: timeout}

    case LMStudio.complete(state, nil, "ping") do
      {:ok, %{content: content}} when is_binary(content) and byte_size(content) > 0 -> true
      _ -> false
    end
  end

  @doc "创建 trace persister 回调。"
  def trace_persister do
    fn ws_id, attrs ->
      attrs = Map.put(attrs, :workspace_id, ws_id)

      case NovelPersistence.TraceRepository.insert(attrs) do
        {:ok, _record} -> :ok
        {:error, reason} -> {:error, reason}
      end
    end
  end
end
