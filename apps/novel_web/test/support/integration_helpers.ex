defmodule NovelWeb.Test.IntegrationHelpers do
  @moduledoc """
  VS-08 集成测试辅助函数。

  LM Studio 相关 helper 委托给 NovelTest.ProviderHelpers（共享源）。
  仅保留 trace_persister（web 层专用，依赖 Persistence）。
  """

  @doc "创建 LM Studio 的 complete_fn。委托给 NovelTest.ProviderHelpers。"
  defdelegate lmstudio_complete_fn(endpoint \\ "http://localhost:1234/v1",
                                   model \\ "openai/gpt-oss-120b",
                                   timeout \\ 60_000),
    to: NovelTest.ProviderHelpers

  @doc "检查 LM Studio 是否可用。委托给 NovelTest.ProviderHelpers。"
  defdelegate lmstudio_available?(endpoint \\ "http://localhost:1234/v1",
                                  timeout \\ 5_000),
    to: NovelTest.ProviderHelpers

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
