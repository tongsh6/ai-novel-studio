# ADR-0013：DecisionTrace v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §5, §6, §7, §8, §9, §11
  - `../06-memory-context-and-trace.md` §6, §9, §11
  - `../contracts/VS-02-tool-provenance-contract-pack.md`
- 影响范围：Trace / Replay / Execution / Toolbox / UI / Umbrella / Slice
- 相关不变量：`00c` §7 #5、#9、#13、#14
- 首个证明 slice：VS-02 ToolRequest / ToolResult / ToolTrace 闭环
- 取代：无
- 取代者：无

---

## 背景

v3 需要解释“为什么做了或没有做”。Provider logs、自然语言总结或普通应用日志都不能承担这个职责，因为它们无法稳定连接 frame、plan、decision、tool、result、TurnResult 和 replay。

VS-02 首先需要冻结 ToolTrace 与 DecisionTrace 的最小关系。

## 决策范围

本 ADR 冻结 VS-02 所需的最小 trace 语义：

- 每个 tool dispatch 必须有 ToolTrace。
- ToolTrace 必须引用 ToolRequest、ToolResult、registry snapshot 和 contract refs。
- DecisionTrace 必须引用 ToolTrace。
- TurnResult 不能宣称 trace 中不存在的工具事实。
- Structural replay 默认不重新调用 provider。

## 非目标

- 不冻结完整 redaction policy。
- 不冻结 durable trace store。
- 不冻结 BehaviorTrace lifecycle。
- 不冻结 UI trace summary view model。
- 不定义 provider raw log 保存策略。

## 考虑过的方案

### 方案 A：使用普通日志作为 trace

- 优点：落地快，可直接观察系统运行。
- 缺点：日志不是 contract，无法稳定被 replay 和测试消费。

### 方案 B：只在 TurnResult 中保存摘要

- 优点：UI 消费简单。
- 缺点：摘要无法证明内部 decision / tool / result 的真实链路。

### 方案 C：结构化 DecisionTrace + ToolTrace

- 优点：可解释、可测试、可回放，并能支持后续 redaction。
- 缺点：需要维护 trace schema 和版本。

## 最终决策

采用方案 C。VS-02 使用 `contracts/VS-02-tool-provenance-contract-pack.md` §5 的最小 trace policy 作为 Accepted 决策输入。

核心规则：

1. ToolRequest 和 ToolResult 必须进入 ToolTrace。
2. ToolTrace 必须进入 DecisionTrace。
3. ToolTrace 必须记录 registry version 和 contract refs。
4. Provider raw logs 不能替代 DecisionTrace。
5. Replay 默认读取结构化 trace，不重新调用 provider。

## 决策理由

结构化 trace 是 v3 的事实链。它让系统能证明执行权边界、工具 provenance 和 TurnResult truthfulness，而不是依赖事后自然语言解释。

## Contract 影响

- 冻结 VS-02 最小 `ToolTrace`。
- 冻结 VS-02 中 `DecisionTrace.tool_trace_refs` 的必需语义。
- `TurnResult.trace_refs` 必须能引用完成或失败的工具 trace。

## Umbrella 边界影响

- `novel_application` 负责协调 decision trace 和 TurnResult truthfulness。
- `novel_agent` 负责工具执行事实的 ToolTrace material。
- `novel_web` / frontend 只消费 author-safe trace summary，不读取内部 trace schema。
- `novel_persistence` 不根据 trace 字段反向裁决业务状态。
- `novel_domain` 不依赖 trace writer。

## UI / Trace / Replay 影响

UI 暂时只看到 TurnResult 中允许展示的摘要或 refs。VS-02 不开放 raw trace 给作者主流程。Replay 必须能在不调用 provider 的情况下重建 decision → request → result。

## 垂直切面证明

VS-02 必须证明：每个 ToolRequest / ToolResult 都有 ToolTrace；失败也有 trace；structural replay 能解释工具为什么被调用以及为什么结果没有被采纳为 production fact。

## 迁移与兼容

v2 的日志和调试输出只能作为附属材料，不能作为 v3 DecisionTrace 的替代。

## 后续工作

- VS-06 冻结 TraceSummaryView、ReplayReport 和 replay 等级。
- ADR-0014 冻结 redaction 与 UI 可见性。
- 后续 persistence 设计再决定 trace store 形态。

---
