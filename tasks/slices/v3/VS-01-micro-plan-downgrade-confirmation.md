# VS-01 MicroPlan Downgrade / Confirmation

- 状态：docs-ready
- 类型：Turn Slice
- 启动日期：2026-05-07
- 所属 DAG：`tasks/slices/v3/DAG.md` B2

> 本文件是 VS-01 的具体 slice 入口，不是 implementation plan，不授权代码实现。当前文档 blocker 已关闭；进入代码实现仍需用户明确批准。

---

## 1. 用户 / 系统目标

打实 v3 执行权主链：Planner 可以提出 `MicroPlan`，但不能批准执行；Execution Orchestrator 必须按 gate order 审查 plan，并把多步、高风险或越权建议降级、确认、澄清、拒绝或恢复。

本 slice 证明 v3 不会把 LLM 的结构化建议误当系统事实。作者可以自然提出宽泛创作请求，但系统默认只放行下一步，且在确认、权限、预算、写入和 trace 之前不会执行真实工具或 production write。

---

## 2. 开工检查

- Contract: `MicroPlan`、`PlannerOutput Boundary`、`OrchestratorDecision`、`Execution Gate Order`、`GateResult`、`TurnResult`、`DecisionTrace`
- Invariant: `00c` §7 #2、#3、#4、#6、#12：MicroPlan 只是建议；Orchestrator 是唯一门禁；默认只放行下一步；写入 tentative-first；confirmation answer 重新 gate
- Boundary: 切过 agent draft / application gate orchestration / toolbox availability / trace；不执行真实 production write；不让 web 或 frontend 执行 gate
- Consumer: Orchestrator contract test 或 TurnResult Builder
- Proof: 多步或高风险 MicroPlan 产生 `downgrade_to_dialogue` 或 `require_confirmation`，trace 记录 first blocking gate

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-01 使用方式 |
|---|---|---|
| `tasks/slices/v3/VS-00-reply-only-dialogue-frame-turn-result-trace.md` | docs-ready | 提供 accepted `DialogueFrame` 起点 |
| `docs/design/adr/ADR-0002-micro-plan-v3.md` | Accepted | 固化 MicroPlan 只是建议 |
| `docs/design/adr/ADR-0003-planner-authority-boundary.md` | Accepted | 固化 Planner 不能批准执行 |
| `docs/design/adr/ADR-0004-orchestrator-decision-v3.md` | Accepted | 固化 execution decision envelope |
| `docs/design/adr/ADR-0005-execution-gate-order-v3.md` | Accepted | 固化 gate order 最小顺序 |
| `docs/design/contracts/VS-01-execution-authority-contract-pack.md` | Draft contract pack | 关闭 VS-01 最小 schema / gate / proof 文档 blocker |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| ADR-0002 / ADR-0003 / ADR-0004 / ADR-0005 Accepted | closed | 四条 ADR 已标记 Accepted |
| `MicroPlan` 最小 schema 和 action subset 明确 | closed | `docs/design/contracts/VS-01-execution-authority-contract-pack.md` §2 |
| PlannerOutput Boundary validation 明确 | closed | `docs/design/contracts/VS-01-execution-authority-contract-pack.md` §3 |
| VS-01 gate order subset 明确 | closed | `docs/design/contracts/VS-01-execution-authority-contract-pack.md` §4 |
| `OrchestratorDecision` 最小 schema 和 decision subset 明确 | closed | `docs/design/contracts/VS-01-execution-authority-contract-pack.md` §5 |
| TurnResult truthfulness 和 DecisionTrace proof 明确 | closed | `docs/design/contracts/VS-01-execution-authority-contract-pack.md` §6-8 |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 可承接通用 id、Result/Error、validation helper；不承接业务 gate 编排 |
| novel_domain | no | VS-01 不写 production domain state |
| novel_agent | yes | 只涉及 Planner draft / provider structured output 边界；不形成 final decision |
| novel_application | yes | 负责 PlannerOutput validation、gate orchestration、OrchestratorDecision、TurnResult assembly、trace coordination |
| novel_persistence | no | VS-01 不要求新增 Repo、DB schema 或 migration |
| novel_web | yes | 只提交 AuthorInput 并返回 TurnResult；不运行 gate |
| frontend | no | UI action schema 留给 VS-03 / VS-05 |
| docs/design | yes | 本 slice 消费 ADR-0002 至 ADR-0005 和 VS-01 contract pack |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 评审 ADR-0002 是否满足 VS-01 MicroPlan 输入门槛 | done | ADR-0002 已进入 Accepted |
| T2 | 评审 ADR-0003 是否满足 PlannerOutput Boundary 门槛 | done | ADR-0003 已进入 Accepted |
| T3 | 评审 ADR-0004 是否满足 OrchestratorDecision 输入门槛 | done | ADR-0004 已进入 Accepted |
| T4 | 评审 ADR-0005 是否满足 gate order 输入门槛 | done | ADR-0005 已进入 Accepted |
| T5 | 补 VS-01 contract pack | done | `docs/design/contracts/VS-01-execution-authority-contract-pack.md` |

---

## 7. 验证

设计阶段验证：

- [ ] `rg -n "ADR-0002.*Pro""posed|ADR-0003.*Pro""posed|ADR-0004.*Pro""posed|ADR-0005.*Pro""posed|下一步需要评审 VS-""01|进入代码实现" docs/design tasks/slices/v3`
- [ ] `rg -n "TO""DO|TB""D|占位""符|下一步需要冻""结|仍未进入 Pro""posed" docs/design tasks/slices/v3`
- [ ] `git diff --check`

实现阶段验证入口：

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix xref graph --format cycles --label compile-connected --fail-above 0`
- [ ] `mix run scripts/arch_check.exs`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

---

## 8. 决策日志

- 2026-05-07 — 从 `tasks/slices/v3/DAG.md` B2 建立 VS-01 文件。当前只授权 slice 设计和评审，不进入 implementation plan / code。
- 2026-05-07 — 新增 `docs/design/contracts/VS-01-execution-authority-contract-pack.md`，关闭 VS-01 文档 blocker，并将 ADR-0002 至 ADR-0005 标记为 Accepted。仍不授权代码实现。

---

## 9. 试行反馈

- VS-01 的关键不是执行第一个工具，而是证明“建议”和“裁决”之间有硬边界。
- VS-01 刻意不冻结 final UI action schema；否则会把 VS-03 / VS-05 的工作提前拉进来。
