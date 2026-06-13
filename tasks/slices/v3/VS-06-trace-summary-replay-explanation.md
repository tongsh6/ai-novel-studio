# VS-06 Trace Summary and Replay Explanation

- 状态：docs-ready
- 类型：Memory Slice
- 启动日期：2026-05-07
- 所属 DAG：`tasks/slices/v3/DAG.md` B7

> 本文件是 VS-06 的具体 slice 入口，不是 implementation plan，不授权代码实现。当前文档 blocker 已关闭；进入代码实现仍需用户明确批准。

---

## 1. 用户 / 系统目标

打实 v3 replay surface：系统可以基于 DecisionTrace、ToolTrace、BehaviorTrace、StateTrace 和 TurnResultViewModel 生成 author-safe trace summary 与 developer replay report，并证明 replay 默认不重新调用 provider。

本 slice 证明 trace 不是日志堆，replay 不是重新问一次 LLM。

---

## 2. 开工检查

- Contract: `DecisionTrace`、`ToolTrace`、`BehaviorTrace`、`StateTrace`、`TraceSummaryView`、`ReplayCase`、`ReplayReport`
- Invariant: `00c` §7 #5、#9、#13、#14：工具调用 trace 完整；TurnResult 是 canonical 输出；trace summary 脱敏；replay 默认不重新调用 LLM
- Boundary: 切过 trace store/read model / replay / API redaction / developer report；不暴露 raw prompt 给作者主流程；不让 replay 修改 production state
- Consumer: Replay console、UI trace summary 或 audit test
- Proof: 同一个 turn 可生成 author-safe summary 和 developer ReplayReport，replay 不调用 provider

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-06 使用方式 |
|---|---|---|
| `tasks/slices/v3/VS-02-tool-request-result-trace-loop.md` | docs-ready | 提供 ToolTrace / DecisionTrace 起点 |
| `tasks/slices/v3/VS-03-clarification-confirmation-behavior-lifecycle.md` | docs-ready | 提供 BehaviorState lifecycle trace 起点 |
| `tasks/slices/v3/VS-04-candidate-selection-adoption-boundary.md` | docs-ready | 提供 StateTrace / adoption explanation 起点 |
| `tasks/slices/v3/VS-05-ui-available-action-roundtrip.md` | docs-ready | 提供 TraceSummaryView redaction 和 UI truthfulness 起点 |
| `docs/design/adr/ADR-0013-decision-trace-v3.md` | Accepted | 固化 DecisionTrace / ToolTrace 最小语义 |
| `docs/design/adr/ADR-0014-trace-redaction-v3.md` | Accepted | 固化 author-visible trace redaction |
| `docs/design/adr/ADR-0017-replay-report-v3.md` | Accepted | 固化 ReplayCase / ReplayReport 和 no-provider rule |
| `docs/design/contracts/VS-06-replay-surface-contract-pack.md` | Draft contract pack | 关闭 VS-06 replay / summary / proof 文档 blocker |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| ADR-0013 / ADR-0014 / ADR-0017 Accepted | closed | 三条 ADR 已标记 Accepted |
| TraceSummaryView VS-06 subset 明确 | closed | `docs/design/contracts/VS-06-replay-surface-contract-pack.md` §2 |
| ReplayCase 最小 schema 明确 | closed | `docs/design/contracts/VS-06-replay-surface-contract-pack.md` §3 |
| ReplayReport 最小 schema 明确 | closed | `docs/design/contracts/VS-06-replay-surface-contract-pack.md` §4 |
| required replay questions 明确 | closed | `docs/design/contracts/VS-06-replay-surface-contract-pack.md` §5 |
| replay proof 明确 | closed | `docs/design/contracts/VS-06-replay-surface-contract-pack.md` §6 |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 可承接通用 id、Result/Error、validation helper |
| novel_domain | no | VS-06 不新增领域规则 |
| novel_agent | no | structural replay 不调用 provider 或 agent |
| novel_application | yes | 负责读取 trace、生成 summary / ReplayReport、校验 no-provider replay |
| novel_persistence | no | VS-06 不要求新增 Repo、DB schema 或 migration |
| novel_web | yes | 可暴露 redacted summary 或 developer report endpoint；不暴露 raw trace 给作者主流程 |
| frontend | yes | 只消费 author-safe trace summary；不消费 raw developer report 作为主界面数据 |
| docs/design | yes | 本 slice 消费 ADR-0013、ADR-0014、ADR-0017 和 VS-06 contract pack |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 评审 ADR-0013 是否满足 DecisionTrace 输入门槛 | done | ADR-0013 已进入 Accepted |
| T2 | 评审 ADR-0014 是否满足 trace redaction 输入门槛 | done | ADR-0014 已进入 Accepted |
| T3 | 评审 ADR-0017 是否满足 ReplayReport 输入门槛 | done | ADR-0017 已进入 Accepted |
| T4 | 补 VS-06 contract pack | done | `docs/design/contracts/VS-06-replay-surface-contract-pack.md` |

---

## 7. 验证

设计阶段验证：

- [ ] `rg -n "ADR-0017.*Pro""posed|ReplayReport.*Pro""posed|ReplayCase.*Pro""posed|VS-06.*plan""ned" docs/design tasks/slices/v3`
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

- 2026-05-07 — 从 `tasks/slices/v3/DAG.md` B7 建立 VS-06 文件。当前只授权 slice 设计和评审，不进入 implementation plan / code。
- 2026-05-07 — 新增 `docs/design/contracts/VS-06-replay-surface-contract-pack.md`，关闭 VS-06 文档 blocker，并将 ADR-0017 标记为 Accepted。仍不授权代码实现。

---

## 9. 试行反馈

- VS-06 的关键不是做 debug UI，而是证明系统能不用 provider 重建“为什么发生”。
- VS-06 结束后，首批 v3 承重竖切面已经具备完整文档输入；下一步应由用户决定是否开始 implementation plan。

---
