# B83：`stream_options.include_usage` vendor 接受度矩阵

- 状态：**todo（2026-11-13 作者选 A：Splash 作为本地 vendor 补测 include_usage；OpenAI/Anthropic 官方凭证仍缺，未测项登记为未验证）**
- 来源：
  - 作者 2026-11-08 同意：B71 后续候选「`stream_options.include_usage` vendor 接受度矩阵」需独立任务文档、新冻结预注册/窗口后执行（见 [B71](B71-provider-message-fidelity.md) 后续节与 [NEXT](../NEXT.md)）。
  - B71 审核轮实现：Chat 流式请求声明 `stream_options.include_usage`（OpenAI 官方语义，usage 回收）。
- 已有事实（只读保留）：
  - Strata（本地，`qwen3.8-flash-next@iq4_nl`）：接受 `stream_options.include_usage` 并返回 usage chunk、`[DONE]`（2026-11-08 探测，`q4_0` 变体曾 engine SIGSEGV 属环境问题）。
  - LM Studio：接受 `stream_options.include_usage`（已探测；见 B71 vendor 矩阵记录）。
  - Splash（本地，`local/Q4-PLE4`）：2026-11-12 冒烟接受 `stream_options.include_usage` 并返回 usage（含 `cached_tokens`）；正式矩阵证据待补。
  - OpenAI/Anthropic 官方：无凭证，未测；不得代签。
- 范围：逐 vendor 记录能力（接受/忽略/拒绝）、usage 回收形态、流式终止、错误语义；形成可复跑矩阵；与 `CapabilityProfile` 的能力事实派生边界保持一致（不为矩阵在 prompt/产品里加 vendor 专属分支）。
- 非目标：不引入 vendor 专属产品分支、不伪造凭证、不用矩阵结论修改真实能力声明（能力仍由 adapter 声明派生）。
- 验收：矩阵证据（请求/响应/usage 片段）+ 复跑说明；未测项明确登记为未验证；矩阵结论进入 00f/能力事实文档的对应缺口。
- 阻塞条件：OpenAI/Anthropic 官方凭证、其它本地 vendor 窗口；解除后按预注册执行。
- 恢复入口：本任务；证据在 `artifacts/model-contracts/`。

### 2026-11-13 作者选 A：Splash 本地 vendor 补测

- **决策**：作者选择 A——把 Splash（`local/Q4-PLE4`）作为待测本地 vendor 补 `stream_options.include_usage` 证据；OpenAI/Anthropic 官方凭证仍缺，未测项登记为未验证。
- **已有初步证据**：2026-11-12 冒烟请求 `include_usage` 返回 usage（含 `cached_tokens`），但非正式矩阵批次。
- **边界**：不引入 vendor 专属产品分支；矩阵结论不改真实能力声明；失败/未测如实登记。
- **下一步**：冻结 Splash 的 include_usage 预注册，再跑正式探测批次。

## 变更记录

- 2026-11-08：立项（承接 B71 后续候选；首批 Strata/LM Studio 结论登记为既有事实）。
- 2026-11-13：作者选 A，Splash 加入待测本地 vendor；OpenAI/Anthropic 仍缺凭证。
