# ADR-0014：Trace Redaction v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §6, §7, §8, §9, §11
  - `../06-memory-context-and-trace.md` §12, §13
  - `../07-workbench-ui-contract.md` §3, §11
  - `../contracts/VS-05-ui-roundtrip-contract-pack.md`
- 影响范围：Trace / UI / Replay / TurnResult / Slice
- 相关不变量：`00c` §7 #5、#9、#13、#14
- 首个证明 slice：VS-05 UI AvailableAction roundtrip
- 取代：无
- 取代者：无

---

## 背景

UI 需要解释为什么系统确认、拒绝、降级或刷新，但不能展示 raw prompt、hidden policy、敏感 memory 或未脱敏工具输入输出。

## 决策范围

本 ADR 冻结 VS-05 所需的 author-visible TraceSummaryView redaction policy。

## 非目标

- 不冻结 developer replay report。
- 不冻结 audit-only raw trace store。
- 不定义最终 debug console。
- 不冻结完整敏感信息分类。

## 考虑过的方案

### 方案 A：UI 直接展示 DecisionTrace

- 优点：实现简单，信息完整。
- 缺点：泄露内部 prompt、policy 和敏感 memory。

### 方案 B：UI 不展示任何解释

- 优点：隐私风险低。
- 缺点：作者无法理解为什么系统等待、拒绝或降级。

### 方案 C：TraceSummaryView redaction

- 优点：保留解释能力，同时保护内部和敏感信息。
- 缺点：需要维护 redaction policy。

## 最终决策

采用方案 C。VS-05 只冻结 author-safe summary：可展示 reason codes 和 redacted visible steps，不展示 raw trace。

## 决策理由

v3 的工作台需要可解释，但解释不是 debug dump。Redaction 让 UI 能帮助作者理解系统边界，而不暴露实现细节。

## Contract 影响

- 新增 VS-05 最小 `TraceSummaryView`。
- `TurnResultViewModel.trace_summary` 必须是 redacted view。
- raw DecisionTrace 不能成为 UI 主数据源。

## Umbrella 边界影响

application 负责生成或协调 redacted summary；web/frontend 只消费；persistence 可以保存 trace 事实但不决定可见性；agent provider logs 不直接进入 UI。

## UI / Trace / Replay 影响

UI 展示 author-safe summary。Replay 可以在 developer path 使用更完整材料，但 VS-05 不开放给普通作者视图。

## 垂直切面证明

VS-05 必须证明 author-visible summary 不包含 provider prompt、hidden policy、sensitive memory、unredacted tool I/O。

## 迁移与兼容

v2 debug log 或 provider transcript 不能直接迁移为 UI trace panel。

## 后续工作

- VS-06 冻结 ReplayReport 和 developer replay explanation。
- 后续安全 ADR 可扩展敏感信息分类。

---
