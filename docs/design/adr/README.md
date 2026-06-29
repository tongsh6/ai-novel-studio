# v3 ADR 目录

> 状态：草案（2026-05-06）
>
> 角色：定义 v3 ADR 的编号、状态、模板、评审门槛和首批 ADR 顺序。本文是 `00c-state-and-contract-atlas.md` 之后、`tasks/slices/v3/DAG.md` 之前的决策治理入口；它不冻结任何具体 schema，也不授权代码实现。

---

## 1. 定位

v3 ADR 记录会影响系统长期演化的架构决策。

它的职责是：

```text
把草案中的关键 contract
→ 升级为可评审决策
→ 明确冻结范围、替代方案、影响和证明方式
→ 供后续垂直切面引用
```

ADR 不是设计备忘录，也不是实现计划。

| 文档类型 | 作用 | 是否冻结决策 | 是否授权实现 |
|---|---|---:|---:|
| `notes/` | 讨论材料、对照分析、后续输入 | 否 | 否 |
| `00-07` | 方向、架构、contract 草案 | 否 | 否 |
| `00c` | contract / 状态 / ADR / slice atlas | 否 | 否 |
| `adr/*.md` Proposed | 决策草案，等待评审 | 否 | 仅可作为 DAG planning input |
| `adr/*.md` Accepted | 已冻结决策 | 是 | 可作为 implementation plan / code 输入，仍需 slice |
| `tasks/slices/v3/DAG.md` | 承重切面排序和依赖图 | 否 | 否；仍需 slice 文件和 Accepted ADR |

核心原则：

```text
没有 ADR 的 C1 contract 不能被当成冻结 schema；
没有垂直切面的 Accepted ADR 也不能单独成为实现计划。
```

---

## 2. v3 与 v2 ADR 的关系

v3 ADR 目录独立于 v2：

```text
docs/design/adr/
```

v2 ADR 可以作为材料引用，但不能直接作为 v3 的冻结约束。

| v2 资产 | v3 处理方式 |
|---|---|
| v2 ADR 编号 | 不继承，不复用 |
| v2 Accepted 决策 | 可作为背景和反例 |
| v2 schema / enum | 可引用、比较、迁移，但需 v3 ADR 重新冻结 |
| v2 Router-first 相关决策 | 不能作为 v3 目标拓扑 |
| v2 TurnResult 思路 | 保留 canonical output 原则，字段重新评估 |

v3 ADR 应显式说明是否引用 v2 决策，以及引用的是“保留原则”“重命名迁移”“废弃约束”还是“反例”。

---

## 3. 何时必须写 ADR

满足以下任一条件，必须写 v3 ADR：

1. 改变主链对象：`DialogueFrame`、`MicroPlan`、`OrchestratorDecision`、`BehaviorState`、`TurnResult`。
2. 改变执行权：Planner / Orchestrator / Toolbox / UI 谁能推进下一步。
3. 改变状态机：phase、status、next action、behavior lifecycle、terminal state。
4. 改变写入边界：tentative、adoption、confirmation、projection refresh、production write。
5. 改变 trace / replay / redaction 语义。
6. 改变 UI 可提交 action 或 UI 可见 contract。
7. 改变 umbrella app 边界或依赖方向。
8. 某个 C1 contract 准备被垂直切面消费。
9. 需要拒绝一个有吸引力但会偏离 v3 愿景的方案。

以下情况通常不需要 ADR：

- 纯措辞修订。
- 不改变 contract 的阅读地图调整。
- notes 中的探索材料。
- 只补充示例，不改变语义。
- 实现阶段的局部代码组织选择，且不改变边界和 contract。

---

## 4. 文件命名与编号

v3 ADR 文件名使用：

```text
ADR-NNNN-<slug>.md
```

规则：

1. `NNNN` 是四位自增编号，从 `0001` 开始。
2. `<slug>` 使用小写 kebab-case。
3. 编号一旦占用，不再重排。
4. 被 Superseded 的 ADR 保留原文件。
5. 新 ADR 必须更新本 README 的索引区。

示例：

```text
ADR-0001-dialogue-frame-v3.md
ADR-0002-micro-plan-v3.md
ADR-0003-planner-authority-boundary.md
ADR-0004-orchestrator-decision-v3.md
ADR-0005-execution-gate-order-v3.md
```

---

## 5. ADR 状态

| 状态 | 含义 | 是否冻结 | 是否可被 slice 消费 |
|---|---|---:|---:|
| Proposed | 已成文，等待评审 | 否 | 仅 DAG planning |
| Accepted | 已接受，为当前有效决策 | 是 | 是 |
| Superseded | 已被新 ADR 替代 | 否 | 否 |
| Deferred | 暂缓，等待实现反馈或更多探索 | 否 | 否 |

状态规则：

1. 新 ADR 默认是 Proposed。
2. Proposed 可以作为 `tasks/slices/v3/DAG.md` 的 planning input，用来排序 slice 和暴露 blockers；不授权 implementation plan 或代码实现。
3. Accepted 才能作为 implementation plan / code 的稳定输入。
4. Superseded 必须写明替代 ADR 编号。
5. Deferred 必须写明暂缓原因和重新触发条件。
6. ADR 历史不删除，只改状态并追加说明。

---

## 6. ADR 与 `00c` 的关系

`00c-state-and-contract-atlas.md` 是 ADR backlog 的来源。

每个 v3 ADR 必须能回连 `00c` 中至少一个条目：

| `00c` 章节 | ADR 必须引用什么 |
|---|---|
| §4 主链对象索引 | 本 ADR 冻结哪个对象 |
| §5 状态族索引 | 本 ADR 影响哪个状态族 |
| §6 Contract Registry | 本 ADR 冻结哪个 contract |
| §7 全局不变量总账 | 本 ADR 保护哪个不变量 |
| §8 ADR Backlog | 本 ADR 属于哪个 batch |
| §9 垂直切面入口候选 | 哪个 slice 会首先证明它 |
| §10 Umbrella 边界索引 | 对 app 边界有什么影响 |
| §11 Truth Boundary | 谁是事实来源 |

如果一个 ADR 无法映射到 `00c`，应先更新来源设计文档和 `00c`，再写 ADR。

---

## 7. ADR 模板

```markdown
# ADR-NNNN：<决策标题>

- 状态：Proposed / Accepted / Superseded / Deferred
- 日期：YYYY-MM-DD
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §x
  - `../02-dialogue-frame-and-micro-plan.md` §x
- 影响范围：Dialogue / Execution / Toolbox / Behavior / Trace / UI / Umbrella / Slice
- 相关不变量：引用 `00c` §7 的编号
- 首个证明 slice：VS-xx 或待创建 slice 名
- 取代：无 / ADR-XXXX
- 取代者：无 / ADR-XXXX

---

## 背景

说明为什么需要冻结这个决策，以及如果不冻结会造成什么长期风险。

## 决策范围

本 ADR 冻结什么。

## 非目标

本 ADR 明确不冻结什么。

## 考虑过的方案

### 方案 A：<名称>

- 优点：
- 缺点：

### 方案 B：<名称>

- 优点：
- 缺点：

## 最终决策

说明选择哪个方案，以及最终 contract / 状态 / 规则的核心内容。

## 决策理由

解释为什么该方案最符合 v3 愿景和工程约束。

## Contract 影响

列出被新增、修改或冻结的 contract。

## Umbrella 边界影响

说明影响哪些 app，哪些 app 明确不应修改。

## UI / Trace / Replay 影响

说明 UI 如何消费、trace 如何记录、replay 如何证明。

## 垂直切面证明

说明第一个真实消费者和 proof 命令或测试方向。

## 迁移与兼容

说明是否引用、替换或废弃 v2 约束。

## 后续工作

- 需要更新的设计文档
- 需要创建的 schema
- 需要进入的 slice
- 仍需 Deferred 的问题
```

---

## 8. 首批 ADR 顺序

首批 ADR 不追求一次冻结所有 v3 contract。它只冻结足以支撑第一批垂直切面的最小决策链。

### 8.1 Batch A：主链与执行权

| 编号 | 文件 | 状态 | 主题 | 来源 | 阻塞内容 |
|---|---|---|---|---|---|
| ADR-0001 | `ADR-0001-dialogue-frame-v3.md` | Accepted | DialogueFrame v3 语义与 VS-00 最小 contract | `02`, `00c`, `contracts/VS-00-reply-only-contract-pack.md` | 所有 turn slice |
| ADR-0002 | `ADR-0002-micro-plan-v3.md` | Accepted | MicroPlan v3 语义与 VS-01 最小 contract | `02`, `04`, `00c`, `contracts/VS-01-execution-authority-contract-pack.md` | tool / behavior / confirmation slice |
| ADR-0003 | `ADR-0003-planner-authority-boundary.md` | Accepted | Planner Authority Boundary | `02`, `04`, `00c`, `contracts/VS-01-execution-authority-contract-pack.md` | 所有执行 slice |
| ADR-0004 | `ADR-0004-orchestrator-decision-v3.md` | Accepted | OrchestratorDecision v3 与 VS-01 最小裁决 subset | `04`, `00c`, `contracts/VS-01-execution-authority-contract-pack.md` | ToolRequest / TurnResult / trace slice |
| ADR-0005 | `ADR-0005-execution-gate-order-v3.md` | Accepted | Execution Gate Order v3 与 VS-01 gate subset | `04`, `00c`, `contracts/VS-01-execution-authority-contract-pack.md` | 高风险动作和 adoption slice |

### 8.2 Batch B：状态、行为与写入边界

| 编号 | 文件 | 状态 | 主题 | 来源 | 阻塞内容 |
|---|---|---|---|---|---|
| ADR-0006 | `ADR-0006-turn-phase-status-v3.md` | Accepted | TurnPhase / TurnStatus v3 | `05`, `00c`, `contracts/VS-03-behavior-lifecycle-contract-pack.md` | UI action / behavior slice |
| ADR-0007 | `ADR-0007-next-action-available-action-v3.md` | Accepted | NextAction / AvailableAction v3 | `05`, `07`, `00c`, `contracts/VS-03-behavior-lifecycle-contract-pack.md` | UI roundtrip slice |
| ADR-0008 | `ADR-0008-behavior-state-v3.md` | Accepted | BehaviorState v3 | `05`, `06`, `00c`, `contracts/VS-03-behavior-lifecycle-contract-pack.md` | clarification / confirmation slice |
| ADR-0009 | `ADR-0009-confirmation-binding-v3.md` | Accepted | Confirmation Binding v3 | `04`, `05`, `07`, `00c`, `contracts/VS-03-behavior-lifecycle-contract-pack.md` | confirmation execution slice |
| ADR-0010 | `ADR-0010-state-adoption-boundary-v3.md` | Accepted | State Adoption Boundary v3 | `03`, `04`, `05`, `07`, `00c`, `contracts/VS-04-adoption-boundary-contract-pack.md` | candidate adoption slice |

### 8.3 Batch C：工具、trace、UI 消费

| 编号 | 文件 | 状态 | 主题 | 来源 | 阻塞内容 |
|---|---|---|---|---|---|
| ADR-0011 | `ADR-0011-toolbox-registry-v3.md` | Accepted | Toolbox Registry v3 | `03`, `00c`, `contracts/VS-02-tool-provenance-contract-pack.md` | capability invocation slice |
| ADR-0012 | `ADR-0012-tool-request-result-v3.md` | Accepted | ToolRequest / ToolResult v3 | `03`, `04`, `06`, `00c`, `contracts/VS-02-tool-provenance-contract-pack.md` | tool trace slice |
| ADR-0013 | `ADR-0013-decision-trace-v3.md` | Accepted | DecisionTrace v3 | `06`, `00c`, `contracts/VS-02-tool-provenance-contract-pack.md` | replay / audit slice |
| ADR-0014 | `ADR-0014-trace-redaction-v3.md` | Accepted | Trace Redaction v3 | `06`, `07`, `00c`, `contracts/VS-05-ui-roundtrip-contract-pack.md` | UI trace summary slice |
| ADR-0015 | `ADR-0015-turn-result-view-model-v3.md` | Accepted | TurnResultViewModel v3 | `07`, `00c`, `contracts/VS-05-ui-roundtrip-contract-pack.md` | Workbench UI slice |
| ADR-0016 | `ADR-0016-projection-hint-ui-v3.md` | Accepted | Projection Hint UI v3 | `07`, `00c`, `contracts/VS-04-adoption-boundary-contract-pack.md` | projection refresh slice |
| ADR-0017 | `ADR-0017-replay-report-v3.md` | Accepted | ReplayReport v3 | `06`, `00c`, `contracts/VS-06-replay-surface-contract-pack.md` | replay explanation slice |
| ADR-0018 | `ADR-0018-business-log-schema-v3.md` | Accepted | 业务日志 Schema v3 | `06`, `engineering/quality-gates.md`, 既有 `llm_log.ex` / `trace_repository.ex` | VS-10 Observability Spine |
| ADR-0019 | `ADR-0019-adoption-status-transition-v3.md` | Accepted | Adoption Status 转换矩阵 v3 | `foundation/30 §3.2.1`, `domain/22`, ADR-0001/0002/0010 | adoption 状态流转 enforcement slice |
| ADR-0020 | `ADR-0020-prose-quality-finding-and-revision-candidate-boundary-v3.md` | Accepted | Prose Quality Finding 与 Revision Candidate 边界 v3 | `contracts/VS-00E`, `quality/31`, ADR-0010/0012/0017 | VS-00E CP1–CP3 prose 执行与质量闭环 slice |
| ADR-0021 | `ADR-0021-agent-run-and-turn-boundary-v3.md` | Accepted | AgentRun 与 Turn 边界、单步 re-gate、活动流、打断和 LongRunTask 关系 | `contracts/UA-01`, ADR-0001/0002/0004/0012/0017/0020 | UA-01 CP0–CP3 bounded AgentRun；CP4 正文 profile 迁移进行中 |

---

## 9. 首批写作建议

建议先写并接受 Batch A 的前 5 条 ADR：

1. 已完成并接受 `ADR-0001-dialogue-frame-v3.md`。
2. 已完成并接受 `ADR-0002-micro-plan-v3.md`。
3. 已完成并接受 `ADR-0003-planner-authority-boundary.md`。
4. 已完成并接受 `ADR-0004-orchestrator-decision-v3.md`。
5. 已完成并接受 `ADR-0005-execution-gate-order-v3.md`。

原因：

- `DialogueFrame` 决定每个 turn 的认知锚点。
- `MicroPlan` 决定 Planner 到 Orchestrator 的协议。
- `Planner Authority Boundary` 先于所有执行类 slice，否则容易把 Planner 写成新的执行器。
- `OrchestratorDecision` 让执行裁决本身具备稳定 contract。
- `Execution Gate Order` 提出 gate 顺序如何落实 decision。
- `tasks/slices/v3/DAG.md` 已创建，开始把首批承重垂直切面排成可执行 DAG。

这 5 条是主链与执行权的基础。ADR-0001 可作为 VS-00 稳定输入；ADR-0002 至 ADR-0005 可作为 VS-01 稳定输入。

随后已完成并接受 `ADR-0011-toolbox-registry-v3.md`、`ADR-0012-tool-request-result-v3.md`、`ADR-0013-decision-trace-v3.md`，作为 VS-02 的稳定设计输入。implementation plan / code 仍需具体 slice 文件、proof 和用户明确批准。

同时已完成并接受 `ADR-0006-turn-phase-status-v3.md`、`ADR-0007-next-action-available-action-v3.md`、`ADR-0008-behavior-state-v3.md`、`ADR-0009-confirmation-binding-v3.md`，作为 VS-03 的稳定设计输入。

随后已完成并接受 `ADR-0010-state-adoption-boundary-v3.md`、`ADR-0016-projection-hint-ui-v3.md`，作为 VS-04 的稳定设计输入。

随后已完成并接受 `ADR-0014-trace-redaction-v3.md`、`ADR-0015-turn-result-view-model-v3.md`，作为 VS-05 的稳定设计输入。

最后已完成并接受 `ADR-0017-replay-report-v3.md`，作为 VS-06 的稳定设计输入。

---

## 10. 接受门槛

ADR 从 Proposed 进入 Accepted，必须满足：

1. 冻结范围清楚，非目标清楚。
2. 至少比较 2 个方案。
3. 明确放弃方案的理由。
4. 指向 `00c` 的 contract、invariant 和 slice 入口。
5. 明确对 umbrella 边界的影响。
6. 明确 UI / trace / replay 的影响，或说明不涉及。
7. 明确后续测试或 proof 方向。
8. 没有未解释的临时空白项或开放项。

Accepted ADR 可以仍然保留 Deferred 问题，但这些问题不能影响当前冻结范围。

---

## 11. 维护规则

1. 新建 ADR 后，必须更新 §8 对应表格的状态或补充新条目。
2. ADR 改为 Accepted 后，必须更新 `00c` 的 ADR Backlog 状态。
3. ADR 被替代时，旧 ADR 状态改为 Superseded，并写明替代者。
4. 如果实现反馈改变 Accepted ADR，必须新增 ADR 替代，不直接改写历史。
5. 如果某条 ADR 被 Deferred，必须说明重新触发条件。
6. 如果一个垂直切面需要未列入 §8 的 ADR，先更新 `00c` 和本文，再写 slice DAG。

---

## 12. 下一步

本文完成后，当前阶段结论：

```text
VS-00 到 VS-06（含 VS-00A、VS-00B、VS-02A）首批文档输入已 docs-ready；VS-00D 作为后置 contract reconciliation 已 docs-ready
```

原因：

- `ADR-0001` 已经把每 turn 必有 DialogueFrame 升级为 Accepted 决策。
- `ADR-0002` 已经把 MicroPlan 升级为 Accepted 决策，明确它只是下一步行动建议 envelope。
- `ADR-0003` 已经把 Planner 权限边界升级为 Accepted 决策，明确它只有建议权、没有执行批准权。
- `ADR-0004` 已经把 OrchestratorDecision 升级为 Accepted 决策。
- `ADR-0005` 已经把 Execution Gate Order 升级为 Accepted 决策。
- `ADR-0006` 至 `ADR-0009` 已经把 phase/status、available action、BehaviorState 和 confirmation binding 升级为 Accepted 决策。
- `ADR-0010` 已经把 candidate selection 与 adoption boundary 升级为 Accepted 决策。
- `ADR-0011`、`ADR-0012`、`ADR-0013` 已经把工具 registry、ToolRequest / ToolResult 和 VS-02 trace 最小语义升级为 Accepted 决策。
- `ADR-0014`、`ADR-0015` 已经把 author-visible trace redaction 和 TurnResultViewModel 升级为 Accepted 决策。
- `ADR-0016` 已经把 ProjectionHint UI 写入边界升级为 Accepted 决策。
- `ADR-0017` 已经把 ReplayCase / ReplayReport 和 no-provider replay 升级为 Accepted 决策。
- VS-00 / VS-00A / VS-00B / VS-01 / VS-02 / VS-02A / VS-03 / VS-04 / VS-05 / VS-06 具体 slice 文件已经创建，文档 blocker 已关闭。
- 下一步需要用户明确批准后，才可创建 implementation plan 或进入代码实现。
