# ADR-0010：State Adoption Boundary v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §5, §6, §7, §8, §9, §11
  - `../03-capability-toolbox-contract.md` §5
  - `../04-execution-orchestrator.md` §10
  - `../05-turn-behavior-and-state-model.md` §8, §12
  - `../07-workbench-ui-contract.md` §8
  - `../contracts/VS-04-adoption-boundary-contract-pack.md`
- 影响范围：Execution / Artifact / Behavior / UI / Trace / Umbrella / Slice
- 相关不变量：`00c` §7 #6、#10、#11、#12、#14、#15
- 首个证明 slice：VS-04 Candidate selection 与 adoption 边界
- 取代：无
- 取代者：无

---

## 背景

候选被展示、被作者选择、被系统采纳，是三件不同的事。ToolResult 成功也不代表 production state 已写入。

如果不冻结 adoption boundary，UI 选择候选、工具返回 state_delta 或 Planner 建议都可能被误当成 project canon。

## 决策范围

本 ADR 冻结 VS-04 所需的 adoption boundary：

- CandidateSet / candidate item 是 tentative。
- AuthorActionInput `choose_candidate` 只表达 selection intent。
- AdoptionDecision 才能表达是否采纳、确认、拒绝或恢复。
- production write 必须有 StateTrace / DecisionTrace。

## 非目标

- 不冻结完整 domain event schema。
- 不定义数据库 migration。
- 不实现真实 production write。
- 不冻结所有 candidate 类型。
- 不冻结最终 UI card 视觉。

## 考虑过的方案

### 方案 A：选择即采纳

- 优点：交互短。
- 缺点：容易把灵感选择误写成 project canon，无法处理 stale action。

### 方案 B：ToolResult 成功即采纳

- 优点：工具链简单。
- 缺点：工具事实绕过作者确认、权限和 trace。

### 方案 C：显式 AdoptionBoundary

- 优点：presented / selected / adopted 分层清楚，production write 可回放。
- 缺点：需要额外 decision 和 trace。

## 最终决策

采用方案 C。VS-04 使用 `contracts/VS-04-adoption-boundary-contract-pack.md` §2-4 的 CandidateSet、AuthorActionInput subset 和 AdoptionDecision policy。

核心规则：

1. candidate selected 不等于 candidate adopted。
2. ToolResult.state_delta 不等于 adopted state。
3. production write 前必须通过 target、authority、confirmation、freshness、conflict 和 trace gates。
4. adoption failure 必须产生 TurnResult。

## 决策理由

v3 的作者体验需要保留自然候选探索，同时保护作品 canon 不被工具输出或 UI 点击污染。显式 adoption boundary 是两者之间的缓冲层。

## Contract 影响

- 新增 VS-04 最小 `CandidateSet`。
- 新增 VS-04 `AdoptionDecision` subset。
- `AuthorActionInput.choose_candidate` 被解释为 selection intent。
- `TurnResult` 必须区分 presented / selected / adopted。

## Umbrella 边界影响

- `novel_application` 负责 adoption gate、decision 和 TurnResult truthfulness。
- `novel_domain` 可承接纯 adopted state / candidate validation 规则。
- `novel_agent` 只返回 candidate / ToolResult，不写 canon。
- `novel_web` / frontend 只提交 AuthorActionInput，不执行 adoption。
- `novel_persistence` 只保存经 application / repository port 批准的事实。

## UI / Trace / Replay 影响

UI 可以展示 candidate card 和提交 choose action。Trace 必须记录 selection、gate、adoption decision 和 StateTrace。Replay 能解释为什么候选未被采纳或如何被采纳。

## 垂直切面证明

VS-04 必须证明 candidate not canon、selection not adoption、ToolResult not adoption、adopted state traced。

## 迁移与兼容

v2 中“选择卡片后立即更新状态”的路径需要迁移为 AuthorActionInput → AdoptionDecision。

## 后续工作

- VS-05 冻结 UI action roundtrip 的最终 payload。
- VS-06 冻结 adoption trace summary 和 replay explanation。

---
