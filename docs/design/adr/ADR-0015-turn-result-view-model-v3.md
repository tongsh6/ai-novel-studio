# ADR-0015：TurnResultViewModel v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §6, §7, §8, §9, §11
  - `../05-turn-behavior-and-state-model.md` §12, §13
  - `../07-workbench-ui-contract.md` §2-§13
  - `../contracts/VS-05-ui-roundtrip-contract-pack.md`
- 影响范围：UI / TurnResult / Behavior / Trace / Projection / Slice
- 相关不变量：`00c` §7 #9、#10、#13、#15
- 首个证明 slice：VS-05 UI AvailableAction roundtrip
- 取代：无
- 取代者：无

---

## 背景

Workbench UI 必须有一个 canonical 主消费对象。否则 UI 会直接读取 BehaviorState、ToolResult、Trace 或 projection internals，并逐渐变成第二个 Orchestrator。

## 决策范围

本 ADR 冻结 VS-05 所需的 TurnResultViewModel 和 UI action roundtrip 最小 contract。

## 非目标

- 不冻结最终前端组件。
- 不定义 CSS、布局或交互动效。
- 不冻结 streaming final/draft 分界。
- 不冻结完整 API schema。

## 考虑过的方案

### 方案 A：UI 直接消费内部对象

- 优点：后端聚合少。
- 缺点：UI 容易发明 contract 并绕过 Orchestrator。

### 方案 B：每种卡片独立 API

- 优点：局部简单。
- 缺点：状态一致性分散，stale action 难统一校验。

### 方案 C：TurnResultViewModel 作为主 envelope

- 优点：UI 有唯一主出口，action roundtrip 可统一校验。
- 缺点：需要后端组装一致性。

## 最终决策

采用方案 C。VS-05 使用 `contracts/VS-05-ui-roundtrip-contract-pack.md` §2-4 的 TurnResultViewModel、AvailableAction roundtrip 和 UI card type subset。

核心规则：

1. UI 主渲染只依赖 TurnResultViewModel。
2. UI 只能提交 available actions 或自由文本。
3. invented / stale / disabled action 必须被拒绝或恢复。
4. valid action 必须回到主链并产生新的 TurnResultViewModel。

## 决策理由

TurnResultViewModel 让 UI 维持作者体验，不承担业务裁决。它是 v3 将 LLM 对话、行为状态、候选、trace summary 和 projection hints 统一给前台的稳定 envelope。

## Contract 影响

- 新增 VS-05 最小 `TurnResultViewModel`。
- 复用 ADR-0007 `AvailableAction` 并增加 roundtrip validation。
- 复用 ADR-0014 `TraceSummaryView`。
- 复用 ADR-0016 `ProjectionHint`。

## Umbrella 边界影响

application 组装 TurnResultViewModel；web/API 只序列化；frontend 只消费和提交动作；agent/domain/persistence 不直接服务 UI action。

## UI / Trace / Replay 影响

UI 不读取 raw trace 或 ToolResult 作为主渲染数据。Trace summary 是 redacted。Replay 由后续 VS-06 冻结，不影响 VS-05 主路径。

## 垂直切面证明

VS-05 必须证明 invented / stale / disabled action 被拒绝，合法 action 回到主链并产生新 TurnResultViewModel。

## 迁移与兼容

v2 的前端状态拼装需要迁移为消费 TurnResultViewModel，而不是按内部对象自行拼装。

## 后续工作

- VS-06 冻结 replay explanation。
- 实现阶段再将本文 contract 转为 schema / API payload。

---
