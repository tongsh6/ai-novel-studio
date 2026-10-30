# ADR-0012：ToolRequest / ToolResult v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §4, §6, §7, §8, §9
  - `../03-capability-toolbox-contract.md` §4, §5
  - `../04-execution-orchestrator.md` §9
  - `../06-memory-context-and-trace.md` §9
  - `../contracts/VS-02-tool-provenance-contract-pack.md`
- 影响范围：Execution / Toolbox / Trace / Umbrella / Slice
- 相关不变量：`00c` §7 #3、#5、#6、#9、#14
- 首个证明 slice：VS-02 ToolRequest / ToolResult / ToolTrace 闭环
- 取代：无
- 取代者：无

---

## 背景

MicroPlan 可以建议调用 capability，但它不是可执行请求。工具返回结果后，也不能自动变成作者可见主消息或生产事实。

v3 需要把“批准调用”和“调用结果”拆成两个可追踪 contract：`ToolRequest` 与 `ToolResult`。

## 决策范围

本 ADR 冻结 VS-02 所需的最小语义：

- `ToolRequest` 只能由 accepted OrchestratorDecision 产生或批准。
- `ToolRequest` 必须引用 turn / frame / plan / decision / registry entry。
- `ToolResult` 必须引用 ToolRequest。
- `ToolResult.status=succeeded` 不表示 state adoption。
- failure / partial / cancelled 结果也必须结构化返回并进入 trace。

## 非目标

- 不冻结完整工具错误 taxonomy。
- 不冻结 retry / cancellation lifecycle。
- 不冻结 streaming tool result。
- 不冻结 production write adoption boundary。
- 不定义具体工具实现。

## 考虑过的方案

### 方案 A：MicroPlan action 直接 dispatch

- 优点：对象少，路径短。
- 缺点：Planner 建议会绕过 Orchestrator；无法证明 ToolRequest 得到批准。

### 方案 B：工具返回自然语言摘要

- 优点：便于直接拼接作者回复。
- 缺点：状态、错误、用量、产物和 trace 无法被稳定消费。

### 方案 C：ToolRequest / ToolResult 双 envelope

- 优点：批准、执行、结果、采纳边界清晰，适合 replay。
- 缺点：需要额外 contract mapping。

## 最终决策

采用方案 C。VS-02 使用 `contracts/VS-02-tool-provenance-contract-pack.md` §3-4 的最小字段作为 Accepted 决策输入。

核心规则：

1. 没有 accepted `decision_ref`，不能生成可 dispatch 的 ToolRequest。
2. ToolRequest grants 不能超过 registry scopes。
3. ToolResult 必须引用 ToolRequest。
4. ToolResult 的 output 必须满足 registry output contract。
5. ToolResult 不直接成为 production fact、canonical memory 或作者主消息。

## 决策理由

双 envelope 让工具调用从“内部副作用”变成可验证链路。它允许后续 slice 单独证明 adoption、UI action、replay 和 redaction，而不把这些边界提前混在一起。

## Contract 影响

- 新增并冻结 VS-02 最小 `ToolRequest`。
- 新增并冻结 VS-02 最小 `ToolResult`。
- `OrchestratorDecision.approved_actions` 可映射为 ToolRequest，但不能被 Planner 直接生成。
- `TurnResult` 必须遵守 ToolResult truth boundary。

## Umbrella 边界影响

- `novel_application` 负责 approved decision 到 ToolRequest 的转换和结果集成。
- `novel_agent` 负责执行被批准的 ToolRequest 并返回 ToolResult。
- `novel_domain` 不直接消费 ToolResult 成为生产事实。
- `novel_persistence` 不根据 ToolResult 字段反向决定业务裁决。
- `novel_web` / frontend 不能直接提交 ToolRequest。

## UI / Trace / Replay 影响

UI 只通过 TurnResult 看到工具结果摘要或候选，不直接读取 raw ToolResult。Trace 必须记录 request/result 对应关系。Replay 必须能从 ToolRequest / ToolResult 重建工具调用事实。

## 垂直切面证明

VS-02 必须证明：没有 decision 不 dispatch；disabled tool 不 dispatch；ToolResult succeeded 后仍不产生 production fact；失败结果仍有 trace。

## 迁移与兼容

v2 中已有 provider 调用、repository 调用或 service 结果可以迁移为 ToolResult 材料，但需要 v3 envelope 包装后才能进入主链。

## 后续工作

- VS-02 implementation plan 选择一个只读或 validation tool 作为第一消费者。
- VS-04 再冻结 ToolResult 到 adoption boundary 的生产写入规则。
- VS-06 再冻结 replay report 与 trace summary 的完整可见性。

---

## enforced_by

- apps/novel_common/lib/novel_common/contracts/tool_request.ex
- apps/novel_common/lib/novel_common/contracts/tool_result.ex
- apps/novel_common/lib/novel_common/contracts/tool_output_contract.ex
- apps/novel_agent/lib/novel_agent/toolbox.ex
- apps/novel_agent/lib/novel_agent/authorized_tool_executor.ex
- apps/novel_application/lib/novel_application/turn_execution_service.ex
- apps/novel_application/test/novel_application/tool_provenance_test.exs
- quality/acceptance/scenarios/au07-tooltrace-registry-redacted-io.yml

## enforcement_gaps

**2026-10-30 ADR-0031 承接说明**：[ADR-0031](ADR-0031-core-chain-semantics-narrowing-v3.md) 已由作者正式接受。输出按消费边界分层：创作 artifact 强 contract，内部读取明确类型/字段/错误及必要运行时检查，探索观察有来源/范围契约，wire 沿同源规则。opaque 不是免检，复用同一 schema 不等于第二真源。悬空引用、必要校验及失败矩阵仍由 B45 等闭合。 本文最终决策段保留为历史，以上是当前规范关系说明，不代表实现缺口关闭；执行来源见 [B49 收口](../../../tasks/slices/B49-core-semantics-and-adr-review.md#716-c02-实施基线收口)。

- B13b 裁决（2026-10-22，降级：契约缺失不可校验）：Toolbox 只校验 registry/dispatchable/grants（`toolbox.ex:31-55`）；`ToolOutputContract` 仅覆盖 creative 路径（`creative_tool_adapter.ex:107-112` 等）；`text_analysis`/`character_roster` 的 `output_contract_ref`（`capability_registry.ex:45,60`）没有冻结 schema 文件，adapter 返回内部 typed map（`text_analysis_adapter.ex:21-26`、`character_roster_adapter.ex:18-23`）。规则 4 应收窄为「creative/作者可见 artifact 工具必须校验；内部只读工具由 adapter typed output 保证」；若要统一校验，须先冻结两个 output schema 再开 slice（见 B13b 汇总「需要作者裁决的问题」）。

### B13b 裁决（2026-10-22）

> 依据 B13b 对账裁决（汇总见 `tasks/slices/B13B-adr-enforcement-reconciliation.md`）。本小节记录原 gap 的裁决痕迹，避免静默删除或静默降级；被 DELETE 的条目不回填历史文件内容，其原文摘要与证据保留在 B13b 汇总的逐条裁决台账中。

- 降级（契约缺失不可校验，改写见上方 gap）：只读工具无 output contract schema。后续动作：按 ADR README §11.4 另立新 ADR 收窄规则 4（creative/作者可见 artifact 工具必须校验；内部只读工具由 adapter typed output 保证；本批不新建 ADR）；若统一校验须先冻结两个 output schema 再开 slice。
