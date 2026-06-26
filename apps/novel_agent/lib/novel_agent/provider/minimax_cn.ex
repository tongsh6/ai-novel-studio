defmodule NovelAgent.Provider.MinimaxCN do
  @moduledoc """
  Minimax (国内版) provider adapter（OpenAI 兼容 `/chat/completions`，Bearer API Key）。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "minimax_cn",
    label: "Minimax (国内版)",
    default_endpoint: "https://api.minimaxi.com/v1",
    default_model: "MiniMax-Text-01",
    env_key: "MINIMAX_CN_API_KEY"
end
