defmodule NovelAgent.Provider.Minimax do
  @moduledoc """
  Minimax provider adapter（OpenAI 兼容 `/chat/completions`，Bearer API Key）。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "minimax",
    label: "Minimax",
    default_endpoint: "https://api.minimaxi.com/v1",
    default_model: "MiniMax-Text-01",
    env_key: "MINIMAX_API_KEY"
end
