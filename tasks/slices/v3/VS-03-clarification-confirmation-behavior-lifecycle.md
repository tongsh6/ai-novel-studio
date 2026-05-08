# VS-03 Clarification / Confirmation Behavior Lifecycle

- 状态：docs-ready
- 类型：Behavior Slice
- 启动日期：2026-05-07
- 所属 DAG：`tasks/slices/v3/DAG.md` B4

> 本文件是 VS-03 的具体 slice 入口，不是 implementation plan，不授权代码实现。当前文档 blocker 已关闭；进入代码实现仍需用户明确批准。

---

## 1. 用户 / 系统目标

打实 v3 durable behavior 主链：当系统确实需要作者补充 blocking 信息或确认具体动作时，必须打开可追踪 BehaviorState；作者回答、确认、拒绝或取消后，系统重新进入 Orchestrator gate，而不是让 UI 或 Planner 直接关闭状态并执行。

本 slice 证明 clarification / confirmation 是系统裁决后的 durable behavior，不是 slot 表单，也不是前端弹窗。

---

## 2. 开工检查

- Contract: `TurnPhase`、`TurnStatus`、`NextAction`、`AvailableAction`、`BehaviorState`、`ConfirmationBinding`、`DecisionTrace`
- Invariant: `00c` §7 #7、#8、#10、#12、#14：durable behavior 必须 open / close / resolution；缺 slot 不自动等于表单；UI 只能提交 available action；confirmation answer 重新 gate；replay 默认不重新调用 LLM
- Boundary: 切过 application behavior lifecycle / TurnResult / UI action ingestion / trace；不写 production state；不让 frontend 直接改 BehaviorState
- Consumer: Workbench action roundtrip 或 application behavior test
- Proof: 作者回答 clarification / confirmation 后，behavior 关闭或推进，并留下 decision / behavior trace

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-03 使用方式 |
|---|---|---|
| `tasks/slices/v3/VS-01-micro-plan-downgrade-confirmation.md` | docs-ready | 提供 `require_clarification` / `require_confirmation` decision 起点 |
| `docs/design-v3/adr/ADR-0006-turn-phase-status-v3.md` | Accepted | 固化 phase/status subset |
| `docs/design-v3/adr/ADR-0007-next-action-available-action-v3.md` | Accepted | 固化 next action / available action subset |
| `docs/design-v3/adr/ADR-0008-behavior-state-v3.md` | Accepted | 固化 BehaviorState lifecycle subset |
| `docs/design-v3/adr/ADR-0009-confirmation-binding-v3.md` | Accepted | 固化 confirmation binding 和 re-gate policy |
| `docs/design-v3/contracts/VS-03-behavior-lifecycle-contract-pack.md` | Draft contract pack | 关闭 VS-03 phase / action / behavior / confirmation / proof 文档 blocker |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| ADR-0006 / ADR-0007 / ADR-0008 / ADR-0009 Accepted | closed | 四条 ADR 已标记 Accepted |
| TurnPhase / TurnStatus subset 明确 | closed | `docs/design-v3/contracts/VS-03-behavior-lifecycle-contract-pack.md` §2 |
| NextAction / AvailableAction subset 明确 | closed | `docs/design-v3/contracts/VS-03-behavior-lifecycle-contract-pack.md` §3 |
| BehaviorState 最小 schema 与 lifecycle 明确 | closed | `docs/design-v3/contracts/VS-03-behavior-lifecycle-contract-pack.md` §4 |
| ConfirmationBinding policy 明确 | closed | `docs/design-v3/contracts/VS-03-behavior-lifecycle-contract-pack.md` §5 |
| TurnResult truthfulness 和 behavior proof 明确 | closed | `docs/design-v3/contracts/VS-03-behavior-lifecycle-contract-pack.md` §6-7 |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 可承接通用 enum、id、Result/Error、validation helper |
| novel_domain | yes | 可承接纯 BehaviorState struct / lifecycle validation；不做 I/O |
| novel_agent | no | VS-03 不要求新 agent runtime；confirmation 不进入 agent |
| novel_application | yes | 负责 behavior open / update / close、confirmation binding、re-gate、TurnResult assembly、trace coordination |
| novel_persistence | no | VS-03 不要求新增 Repo、DB schema 或 migration |
| novel_web | yes | 只提交 AuthorInput / ActionInput 并返回 TurnResult；不直接改 BehaviorState |
| frontend | yes | 作为 AvailableAction 消费者；不实现最终 UI 组件前仍只消费 contract |
| docs/design-v3 | yes | 本 slice 消费 ADR-0006 至 ADR-0009 和 VS-03 contract pack |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 评审 ADR-0006 是否满足 phase/status 输入门槛 | done | ADR-0006 已进入 Accepted |
| T2 | 评审 ADR-0007 是否满足 next action / available action 输入门槛 | done | ADR-0007 已进入 Accepted |
| T3 | 评审 ADR-0008 是否满足 BehaviorState lifecycle 输入门槛 | done | ADR-0008 已进入 Accepted |
| T4 | 评审 ADR-0009 是否满足 confirmation binding 输入门槛 | done | ADR-0009 已进入 Accepted |
| T5 | 补 VS-03 contract pack | done | `docs/design-v3/contracts/VS-03-behavior-lifecycle-contract-pack.md` |

---

## 7. 验证

设计阶段验证：

- [ ] `rg -n "ADR-0006.*Pro""posed|ADR-0007.*Pro""posed|ADR-0008.*Pro""posed|ADR-0009.*Pro""posed|BehaviorState.*Pro""posed|ConfirmationBinding.*Pro""posed|VS-03.*plan""ned" docs/design-v3 tasks/slices/v3`
- [ ] `rg -n "TO""DO|TB""D|占位""符|下一步需要冻""结|仍未进入 Pro""posed" docs/design-v3 tasks/slices/v3`
- [ ] `git diff --check`

实现阶段验证入口：

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix xref graph --format cycles --label compile-connected --fail-above 0`
- [ ] `mix run scripts/arch_check.exs`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

---

## 8. 决策日志

- 2026-05-07 — 从 `tasks/slices/v3/DAG.md` B4 建立 VS-03 文件。当前只授权 slice 设计和评审，不进入 implementation plan / code。
- 2026-05-07 — 新增 `docs/design-v3/contracts/VS-03-behavior-lifecycle-contract-pack.md`，关闭 VS-03 文档 blocker，并将 ADR-0006 至 ADR-0009 标记为 Accepted。仍不授权代码实现。

---

## 9. 试行反馈

- VS-03 的关键不是做 UI，而是证明 UI 提交的是作者动作，系统状态转换仍由 Orchestrator 裁决。
- VS-03 刻意不冻结 candidate adoption；否则会把 VS-04 的 production write boundary 提前拉进来。

---
