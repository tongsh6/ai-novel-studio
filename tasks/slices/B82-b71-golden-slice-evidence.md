# B82：B71 G2/G3/G5 黄金切片证据补证（Responses/Anthropic 实模 + 逐片真实证据）

- 状态：**todo（2026-11-08 立项；B71 剩余黄金切片证据承接；未获窗口/凭证前不启动批次）**
- 来源：
  - 作者 2026-11-08 同意：B71 后续候选「G2–G6 切片补证」需独立任务文档、新冻结预注册后执行（原记录见 [B71](B71-provider-message-fidelity.md) 与 [NEXT](../NEXT.md)）。
  - B71 2026-11-08 实模批次 `b71-first-consumer-live-cp4b2-iq3s-01` required_mechanism 8/8 通过，但 G2/G3/G5 未触发、G6 未取证（如实登记）。
- 边界与承接：
  - **G6 不由本任务承接**：ADR-0035/B81 落地后，压缩后真实请求应在真实多轮会话中取证（[B81](B81-session-canonical-authoring-history.md) CP5）；本任务不构造异常路径或单 run 多回合场景。
  - 本任务承接 G2/G3/G5 的真实证据补证，以及 Responses/Anthropic 官方凭证到位后的实模矩阵（与[B83](B83-vendor-stream-options-matrix.md)区分：B83 是 `stream_options.include_usage` 接受度矩阵，本任务是黄金切片请求字节/流式/缓存/多轮证据）。
- 范围（每个切片独立预注册、独立批次、如实登记）：
  - G2：多轮请求体保真与工具观察回流（真实模型、真实页面）；
  - G3：能力/有限模式/拒绝路由的真实请求证据；
  - G5：pending/adoption 上下文进入后续请求的真实字节（已有确定性证据，需实模或页面级补证）；
  - Responses/Anthropic 实模：凭证到位后按冻结预注册执行，记录真实 body/usage/流式终止。
- 非目标：不重跑换分、不调判据/窗口/K、不把确定性证据冒充实模、不代签 I10；不在本任务修改产品代码（若发现问题另立修复）。
- 验收：每个切片有冻结预注册 + 批次证据 + PASS/FAIL 判定；失败按纪律只读保留并登记根因；真实模型/页面/机制分层报告。
- 依赖/阻塞：G2/G3/G5 需要可用的真实模型窗口与页面驱动窗口；Responses/Anthropic 需要官方凭证。未获授权前状态保持 todo，不启动批次。
- 恢复入口：`tasks/NEXT.md` → 本任务；批次证据在 `artifacts/`；B71 原任务保留历史上下文。

## 变更记录

- 2026-11-08：立项（承接 B71 后续候选；G6 明确移交 B81 CP5）。
