defmodule NovelAgent.Provider.Strata do
  @moduledoc """
  Strata 本地推理 provider adapter（Strata App 统一推理后台）。

  [Strata App](https://strata.ai) 负责本机推理引擎的启动、模型加载/切换与卸载，
  并对外提供一个**统一的 OpenAI 兼容入口**：`http://127.0.0.1:47831/v1`。本
  adapter 只连接这一个入口，不解析 Strata 安装目录 profile、不扫描端口、不管理
  引擎生命周期——模型由 Strata App 决定，接口经 `/models` 暴露当前已加载模型
  （`id` + `meta.label` + `aliases`）。

  产品只保留这一套 Strata 推理后台连接（用户 2026-10-22 方案修正）：端点不再由
  作者在设置页逐 profile 配置（Gateway descriptor `supports_endpoint: false`），
  需要换地址时由部署侧用 `NOVEL_STRATA_ENDPOINT` 覆盖。

  ## 模型

  `NOVEL_STRATA_MODEL` 未配置时 adapter **不向请求体发送 `model` 字段**，由 Strata
  App 把请求路由到当前已加载模型（统一后台的 `/models` 是真实模型来源）；设置页
  刷新模型列表后由作者选择并保存显式模型 id（`iq3_s` 等）。Strata App 之后若切换
  了加载模型，作者重新刷新/选择即可；陈旧模型 id 会被统一后端的
  `400 Choose a loaded model ID.` 如实拒绝，不静默改写。

  ## 认证

  Strata App 的统一入口默认无鉴权；如部署侧配置了访问 Key，可经
  `NOVEL_STRATA_API_KEY`（或运行时 provider 配置 api_key）携带
  `Authorization: Bearer <key>`。因此本 adapter 声明 `api_key_required: false`。

  与 LM Studio 不同，Strata 是 keyless 但仍支持 `/models` 真实探活：
  `health_check/1` 会 GET `/models` 验证统一后台可达，而不是只看本地配置。

  ## 思考控制

  Qwen3.8 的思考开关走**请求级顶层 `reasoning_effort`**（`"none"` 关闭思考，
  `low`/`medium`/`high` 显式选择深度），不是 DeepSeek/Anthropic 风格的
  `thinking` 对象——本 adapter 声明 `thinking_style: :reasoning_effort`，任何
  情况下都不向 body 发送 `thinking` 字段。作者关思考（默认）→ 发 `"none"`。

  tool 调用沿用 OpenAI 兼容协议原样透传：`tools` + 具名 `tool_choice` 对象，
  不做 LM Studio 式的 `"required"` 降级（统一后台接受具名对象）。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "strata",
    label: "Strata",
    default_endpoint: "http://127.0.0.1:47831/v1",
    # 统一后台默认跟随 Strata App 当前已加载模型（请求体不带 model）。
    default_model: nil,
    env_key: "NOVEL_STRATA_API_KEY",
    supports_thinking: true,
    api_key_required: false,
    thinking_style: :reasoning_effort

  @doc """
  Strata App 统一推理后台的 OpenAI 兼容 base URL。

  产品侧唯一连接入口；远端/测试可用 `NOVEL_STRATA_ENDPOINT` 覆盖（见
  `NovelAgent.Provider.Strata.from_config/1`）。
  """
  @spec unified_base_url() :: String.t()
  def unified_base_url, do: "http://127.0.0.1:47831/v1"
end
