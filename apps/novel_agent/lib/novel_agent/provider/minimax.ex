defmodule NovelAgent.Provider.Minimax do
  @moduledoc """
  Minimax (国际版) provider adapter（OpenAI 兼容 `/chat/completions`，Bearer API Key）。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "minimax",
    label: "Minimax (国际版)",
    default_endpoint: "https://api.minimax.io/v1",
    default_model: "MiniMax-Text-01",
    env_key: "MINIMAX_API_KEY"
end
