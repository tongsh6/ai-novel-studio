defmodule NovelAgent.Provider.Gemini do
  @moduledoc """
  Gemini provider adapter（Google Generative Language 的 OpenAI 兼容 endpoint，Bearer API Key）。

  使用 `https://generativelanguage.googleapis.com/v1beta/openai` 的 OpenAI 兼容层，
  统一走 `/chat/completions` 与 `/models`，与其它供应商共用 Provider Gateway 与脱敏边界。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "gemini",
    label: "Gemini",
    default_endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    default_model: "gemini-2.0-flash",
    env_key: "GEMINI_API_KEY"
end
