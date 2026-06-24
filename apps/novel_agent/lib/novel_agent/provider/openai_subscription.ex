defmodule NovelAgent.Provider.OpenAISubscription do
  @moduledoc """
  OpenAI（订阅认证）provider adapter。

  与 `NovelAgent.Provider.OpenAI`（API Key 认证）是同一供应商的两种认证方式，但以独立
  vendor id `openai_subscription` 接入：独立 secret、独立 endpoint、独立 redaction，
  在 UI / config / runtime / 日志中与 API Key 方式清晰区分。

  当前实现复用 OpenAI 兼容传输：订阅 access token 作为 Bearer secret 持久化、脱敏、
  重启读回与「测试连接失败不切换 runtime」均与 API Key 路径一致并可离线验收。其真实
  OAuth 登录（浏览器授权换取 ChatGPT 订阅 access token）与 ChatGPT backend 专用传输，
  需要真实订阅账号与浏览器流程，登记为 SU-01 SC-SU01-B3 的 live vendor 后续缺口，
  本 adapter 不冒充其 live 可用性。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "openai_subscription",
    label: "OpenAI（订阅）",
    default_endpoint: "https://api.openai.com/v1",
    default_model: "gpt-4o-mini",
    env_key: "OPENAI_SUBSCRIPTION_TOKEN"
end
