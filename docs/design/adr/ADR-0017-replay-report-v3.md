# ADR-0017：ReplayReport v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §6, §7, §8, §9, §11
  - `../06-memory-context-and-trace.md` §11, §13, §17
  - `../contracts/VS-06-replay-surface-contract-pack.md`
- 影响范围：Replay / Trace / UI / Audit / Slice
- 相关不变量：`00c` §7 #5、#13、#14
- 首个证明 slice：VS-06 Trace summary 与 replay explanation
- 取代：无
- 取代者：无

---

## 背景

v3 需要在不重新调用 LLM 的情况下解释历史 turn 为什么这样执行、为什么没有执行、为什么等待、为什么采纳或没有采纳。

DecisionTrace 是事实链，ReplayReport 是读取事实链后的解释报告。二者不能混同。

## 决策范围

本 ADR 冻结 VS-06 所需的 ReplayCase / ReplayReport 最小 contract：

- structural replay 默认不调用 provider。
- replay 绑定 trace refs、contract versions、registry snapshots。
- report 可以指出 missing trace。
- report 解释历史事实，不改变 production state。

## 非目标

- 不冻结完整 replay UI。
- 不定义 trace store。
- 不冻结 LLM-assisted replay。
- 不定义 observability 平台。

## 考虑过的方案

### 方案 A：重新调用 LLM 解释历史 turn

- 优点：解释自然。
- 缺点：不可重复，可能编造原因，成本和隐私风险高。

### 方案 B：只展示原始 DecisionTrace

- 优点：忠实。
- 缺点：普通开发和审计读者难以快速理解主链。

### 方案 C：Structural ReplayReport

- 优点：不调用 provider，可重复，可检测 trace 缺失。
- 缺点：解释自然度依赖 trace 质量。

## 最终决策

采用方案 C。VS-06 使用 `contracts/VS-06-replay-surface-contract-pack.md` §3-4 的 ReplayCase / ReplayReport contract。

核心规则：

1. structural replay 不调用 provider。
2. ReplayReport 必须绑定 DecisionTrace 和 contract versions。
3. missing critical trace 必须显式暴露。
4. ReplayReport 不改变 production state。

## 决策理由

Replay 的价值是解释和验证，不是重新创作。Structural replay 保护 v3 的可审计性，也避免用新的模型输出覆盖历史事实。

## Contract 影响

- 新增 VS-06 最小 `ReplayCase`。
- 新增 VS-06 最小 `ReplayReport`。
- `TraceSummaryView` 可引用 ReplayReport，但普通 UI 不消费 raw developer report。

## Umbrella 边界影响

application 或 debug tooling 读取 trace 并生成 ReplayReport；web/frontend 只消费 redacted summary；agent 不参与 structural replay；persistence 不根据 replay report 改业务状态。

## UI / Trace / Replay 影响

UI 可展示 author-safe summary。Developer path 可查看 ReplayReport。ReplayReport 必须说明 provider 未被调用。

## 垂直切面证明

VS-06 必须证明 replay no provider、complete chain replay、missing trace detected、truthfulness check。

## 迁移与兼容

v2 的 debug logs 可以作为参考材料，但不能替代 ReplayReport。

## 后续工作

- 实现阶段再决定 replay report 是否持久化。
- 后续可增加 LLM-assisted explanation，但必须标记为非 structural replay。

---
