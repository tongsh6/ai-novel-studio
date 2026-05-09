defmodule NovelWeb.Test.IntegrationHelpers do
  @moduledoc """
  VS-08 集成测试辅助函数。所有实现委托给 NovelTest.ProviderHelpers（共享源）。
  """

  @doc "创建 LM Studio 的 complete_fn。"
  defdelegate lmstudio_complete_fn(endpoint \\ "http://localhost:1234/v1",
                                   model \\ "openai/gpt-oss-120b",
                                   timeout \\ 60_000),
    to: NovelTest.ProviderHelpers

  @doc "检查 LM Studio 是否可用。"
  defdelegate lmstudio_available?(endpoint \\ "http://localhost:1234/v1",
                                  timeout \\ 5_000),
    to: NovelTest.ProviderHelpers
end
