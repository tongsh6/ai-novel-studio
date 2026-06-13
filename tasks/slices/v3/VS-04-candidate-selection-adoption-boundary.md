# VS-04 Candidate Selection and Adoption Boundary

- 状态：docs-ready
- 类型：Artifact Slice
- 启动日期：2026-05-07
- 所属 DAG：`tasks/slices/v3/DAG.md` B5

> 本文件是 VS-04 的具体 slice 入口，不是 implementation plan，不授权代码实现。当前文档 blocker 已关闭；进入代码实现仍需用户明确批准。

---

## 1. 用户 / 系统目标

打实 v3 候选到采纳的边界：系统可以展示候选，作者可以选择候选，但只有 Orchestrator 重新 gate 并形成 AdoptionDecision 后，候选才可能成为 adopted state。ProjectionHint 只告诉 UI 刷新相关读视图，不授权 UI 写入。

本 slice 证明 candidate presented、candidate selected、candidate adopted 是三种不同事实。

---

## 2. 开工检查

- Contract: `CandidateSet`、`AuthorActionInput.choose_candidate`、`AvailableAction`、`AdoptionDecision`、`AdoptionBoundary`、`ProjectionHint`、`DecisionTrace`、`StateTrace`
- Invariant: `00c` §7 #6、#10、#11、#12、#14、#15：写入 tentative-first；UI 只能提交 available action；candidate selection 不等于 adoption；confirmation answer 重新 gate；replay 默认不重新调用 LLM；projection hints 只触发刷新
- Boundary: 切过 UI action / application adoption boundary / domain pure validation / projection read model / trace；不让 frontend 直接写 production；不让 agent ToolResult 直接变 canon
- Consumer: Workbench candidate card 或 projection refresh test
- Proof: 选择候选后只产生 adoption evaluation、confirmation 或 adopted state trace；未授权不写 production fact

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-04 使用方式 |
|---|---|---|
| `tasks/slices/v3/VS-02-tool-request-result-trace-loop.md` | docs-ready | 提供 ToolResult / ToolTrace provenance 起点 |
| `tasks/slices/v3/VS-03-clarification-confirmation-behavior-lifecycle.md` | docs-ready | 提供 AvailableAction / confirmation binding 起点 |
| `docs/design/adr/ADR-0010-state-adoption-boundary-v3.md` | Accepted | 固化 candidate selection 和 adoption boundary |
| `docs/design/adr/ADR-0016-projection-hint-ui-v3.md` | Accepted | 固化 ProjectionHint 只触发刷新 |
| `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` | Draft contract pack | 关闭 VS-04 candidate / adoption / projection / proof 文档 blocker |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| ADR-0010 / ADR-0016 Accepted | closed | 两条 ADR 已标记 Accepted |
| CandidateSet 最小 schema 明确 | closed | `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` §2 |
| AuthorActionInput choose_candidate subset 明确 | closed | `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` §3 |
| AdoptionBoundary / AdoptionDecision policy 明确 | closed | `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` §4 |
| ProjectionHint schema 和 UI write boundary 明确 | closed | `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` §5 |
| TurnResult truthfulness 和 adoption proof 明确 | closed | `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` §6-7 |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 可承接通用 id、Result/Error、validation helper |
| novel_domain | yes | 可承接纯 candidate / adopted state validation；不做 I/O |
| novel_agent | yes | 只返回 candidate / ToolResult；不写 production canon |
| novel_application | yes | 负责 action validation、adoption gate、AdoptionDecision、TurnResult assembly、projection hints、trace coordination |
| novel_persistence | no | VS-04 不要求新增 Repo、DB schema 或 migration |
| novel_web | yes | 只提交 AuthorActionInput 并返回 TurnResult；不直接写 adopted state |
| frontend | yes | 作为 candidate card / projection hint 消费者；不反向发明 action 或写入 |
| docs/design | yes | 本 slice 消费 ADR-0010、ADR-0016 和 VS-04 contract pack |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 评审 ADR-0010 是否满足 adoption boundary 输入门槛 | done | ADR-0010 已进入 Accepted |
| T2 | 评审 ADR-0016 是否满足 projection hint 输入门槛 | done | ADR-0016 已进入 Accepted |
| T3 | 补 VS-04 contract pack | done | `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` |

---

## 7. 验证

设计阶段验证：

- [ ] `rg -n "ADR-0010.*Pro""posed|ADR-0016.*Pro""posed|AdoptionBoundary.*Pro""posed|ProjectionHint.*Pro""posed|VS-04.*plan""ned" docs/design tasks/slices/v3`
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

- 2026-05-07 — 从 `tasks/slices/v3/DAG.md` B5 建立 VS-04 文件。当前只授权 slice 设计和评审，不进入 implementation plan / code。
- 2026-05-07 — 新增 `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md`，关闭 VS-04 文档 blocker，并将 ADR-0010、ADR-0016 标记为 Accepted。仍不授权代码实现。

---

## 9. 试行反馈

- VS-04 的关键不是完成写入实现，而是证明候选选择无法绕过 adoption boundary。
- VS-04 刻意不冻结完整 TurnResultViewModel；否则会把 VS-05 的 UI roundtrip 提前拉进来。

---
