defmodule NovelAgent.Provider.Strata do
  @moduledoc """
  Strata 本地推理 provider adapter。

  [Strata](https://strata.ai)（strata-engine）在桌面端提供 OpenAI 兼容的本地
  推理服务：默认监听 `http://127.0.0.1:8081/v1`，经 `/chat/completions` 暴露
  流式/非流式生成、tool calls 与顶层 `reasoning_effort`，经 `/models` 暴露当前
  已加载模型。默认模型为 `qwen3.8-flash-next-q2_0`（随 Strata 应用加载的模型
  可经 `NOVEL_STRATA_MODEL` 覆盖）。

  ## 认证

  Strata 的 serving API key 是**可选项**：本地回环服务默认无鉴权，也可在 Strata
  设置里配置 `serving.apiKey`。因此本 adapter 声明 `api_key_required: false`：

  - 配置了 `NOVEL_STRATA_API_KEY`（或运行时 provider 配置 api_key）→ 请求带
    `Authorization: Bearer <key>`；
  - 未配置 → 不发 Authorization 头，直接请求本地服务。

  与 LM Studio 不同，Strata 是 keyless 但仍支持 `/models` 真实探活：
  `health_check/1` 会 GET `/models` 验证服务可达，而不是只看本地配置。

  ## 本机模型发现

  strata-engine 一进程一模型，单端点 `/v1/models` 只能看到当前引擎自己的模型。
  `local_models/0,1` 读本机 Strata 安装目录里的 `strata-*.json` profile 配置并对每个
  profile 端点探活，列出本机已安装的全部 Strata 模型（实现与目录优先级见
  `NovelAgent.Provider.Strata.LocalModels`）。

  ## 思考控制

  Qwen3.8 的思考开关走**请求级顶层 `reasoning_effort`**（`"none"` 关闭思考，
  `low`/`medium`/`high` 显式选择深度），不是 DeepSeek/Anthropic 风格的
  `thinking` 对象——本 adapter 声明 `thinking_style: :reasoning_effort`，任何
  情况下都不向 body 发送 `thinking` 字段。作者关思考（默认）→ 发 `"none"`。

  tool 调用沿用 OpenAI 兼容协议原样透传：`tools` + 具名 `tool_choice` 对象，
  不做 LM Studio 式的 `"required"` 降级（Strata 接受具名对象）。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "strata",
    label: "Strata",
    default_endpoint: "http://127.0.0.1:8081/v1",
    default_model: "qwen3.8-flash-next-q2_0",
    env_key: "NOVEL_STRATA_API_KEY",
    supports_thinking: true,
    api_key_required: false,
    thinking_style: :reasoning_effort

  alias NovelAgent.Provider.Strata.LocalModels

  @doc """
  列出本机 Strata 安装目录里的 profile 模型并探活（SU01 本机模型发现）。

  目录优先级（opts > `NOVEL_STRATA_MODELS_DIR` > 应用配置 > 平台默认）与探活/容错
  语义见 `NovelAgent.Provider.Strata.LocalModels`：探活失败只标 `running: false`，
  目录/配置错误返回 `[]`，绝不 raise。
  """
  @spec local_models(keyword()) :: [LocalModels.model()]
  def local_models(opts \\ []), do: LocalModels.list(opts)
end
