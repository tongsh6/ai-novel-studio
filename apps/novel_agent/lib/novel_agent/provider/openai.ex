defmodule NovelAgent.Provider.OpenAI do
  @moduledoc """
  OpenAI（API Key 认证）provider adapter。

  使用平台 API Key（`Authorization: Bearer sk-...`）走 OpenAI 兼容 `/chat/completions`。
  与 `NovelAgent.Provider.OpenAISubscription`（订阅认证）是同一供应商的两种认证方式，
  以独立 vendor id 区分，互不共享 secret。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "openai",
    label: "OpenAI",
    default_endpoint: "https://api.openai.com/v1",
    default_model: "gpt-4o-mini",
    env_key: "OPENAI_API_KEY"
end
