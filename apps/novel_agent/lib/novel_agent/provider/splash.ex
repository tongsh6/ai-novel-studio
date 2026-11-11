defmodule NovelAgent.Provider.Splash do
  @moduledoc """
  Splash 本地推理 provider adapter（Splash App / `splash serve` 管理的本机服务）。

  Splash 负责本机模型的加载与卸载，并对外提供一个 **OpenAI 兼容入口**（默认
  `http://127.0.0.1:8000/v1`，`splash serve --port` 可改）。本 adapter 只连接这一个
  OpenAI 兼容入口：`/chat/completions` 与 `/models`，不管理引擎生命周期。

  ## 模型

  `NOVEL_SPLASH_MODEL` 未配置时 adapter **不向请求体发送 `model` 字段**，由 Splash 把
  请求路由到当前已加载模型（Splash 的 `/models` 是真实模型来源）；设置页刷新模型列表
  后由作者显式选择并保存模型 id。Splash 之后若切换加载模型，陈旧模型 id 会被 Splash 的
  `404 model ... not found` 如实拒绝，不静默改写。

  ## 认证

  Splash 默认无鉴权；如部署侧配置了访问 Key（`splash serve --api-key`），可经
  `NOVEL_SPLASH_API_KEY`（或运行时 provider 配置 api_key）携带
  `Authorization: Bearer <key>`。因此本 adapter 声明 `api_key_required: false`，且
  `health_check/1` 走真实 GET `/models` 探活，而不是只看本地配置。

  ## 思考控制

  Splash 接受请求级顶层 `reasoning_effort`（`"none"` 关闭思考，`low`/`medium`/`xhigh`
  等显式选择深度），不接受 `thinking` 对象——本 adapter 声明
  `thinking_style: :reasoning_effort`，任何情况下都不向 body 发送 `thinking` 字段。
  作者关思考（默认）→ 发 `"none"`。

  ## 端点

  与 Strata App 的固定统一入口不同，Splash 端口由本机 `splash serve --port`（或 Splash
  App）决定，因此端点可由作者在设置页配置（默认 `http://127.0.0.1:8000/v1`），部署侧
  也可用 `NOVEL_SPLASH_ENDPOINT` 覆盖。
  """

  use NovelAgent.Provider.OpenAICompatible,
    vendor: "splash",
    label: "Splash",
    default_endpoint: "http://127.0.0.1:8000/v1",
    # 模型由 Splash 管理：未配置时请求体不带 model，由服务路由当前加载模型。
    default_model: nil,
    env_key: "NOVEL_SPLASH_API_KEY",
    supports_thinking: true,
    api_key_required: false,
    thinking_style: :reasoning_effort
end
