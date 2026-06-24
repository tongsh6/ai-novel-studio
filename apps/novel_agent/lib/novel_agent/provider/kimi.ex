defmodule NovelAgent.Provider.Kimi do
  @moduledoc """
  Kimi（Moonshot）provider adapter（OpenAI 兼容 `/chat/completions`，Bearer API Key）。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "kimi",
    label: "Kimi",
    default_endpoint: "https://api.moonshot.cn/v1",
    default_model: "moonshot-v1-8k",
    env_key: "KIMI_API_KEY"
end
