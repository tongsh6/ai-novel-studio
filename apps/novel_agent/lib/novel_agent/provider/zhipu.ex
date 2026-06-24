defmodule NovelAgent.Provider.Zhipu do
  @moduledoc """
  智谱（GLM）provider adapter（OpenAI 兼容 `/api/paas/v4/chat/completions`，Bearer API Key）。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "zhipu",
    label: "智谱",
    default_endpoint: "https://open.bigmodel.cn/api/paas/v4",
    default_model: "glm-4",
    env_key: "ZHIPU_API_KEY"
end
