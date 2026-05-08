# VS-00 Reply-only DialogueFrame + TurnResult + Trace

- 状态：docs-ready
- 类型：Turn Slice
- 启动日期：2026-05-07
- 所属 DAG：`tasks/slices/v3/DAG.md` B1

> 本文件是 VS-00 的具体 slice 入口，不是 implementation plan，不授权代码实现。当前文档 blocker 已关闭；进入代码实现仍需用户明确批准。

---

## 1. 用户 / 系统目标

打实 v3 最小对话主链：一次普通创作讨论即使不调用工具、不打开 durable behavior、不写 production state，也必须产生可追溯的 `DialogueFrame`、诚实的 `TurnResult` 和可回放的 `DecisionTrace`。

本 slice 证明 v3 不是 Router-first，也不是“只有执行时才有结构”。reply-only 是最小承重路径：系统理解作者输入，形成 frame，明确本轮只回复，并让 UI / Channel 能消费 canonical output。

---

## 2. 开工检查

- Contract: `AuthorInput`、`DialogueContext`、`DialogueFrame`、`TurnResult`、`DecisionTrace`
- Invariant: `00c` §7 #1、#9、#14：每 turn 必有 frame；TurnResult 是 canonical 输出；replay 默认不重新调用 LLM
- Boundary: 切过 web / application / agent planner draft / trace；不碰 tool dispatch、durable behavior、production write 或 projection refresh
- Consumer: Application contract test 或 Channel response
- Proof: 普通创作讨论输出 reply-only TurnResult，trace 能解释未调用工具、未打开 behavior、未写 production state

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-00 使用方式 |
|---|---|---|
| `docs/design-v3/adr/ADR-0001-dialogue-frame-v3.md` | Accepted | 作为 VS-00 稳定输入，确定每 turn 必有 primary `DialogueFrame` |
| `docs/design-v3/00b-end-to-end-dialogue-flow.md` | Draft design | 约束 reply-only 主链从 AuthorInput 到 TurnResult 的顺序 |
| `docs/design-v3/00c-state-and-contract-atlas.md` §9.1 | Draft design | 提供 VS-00 的 Contract / Invariant / Boundary / Consumer / Proof 来源 |
| `docs/design-v3/06-memory-context-and-trace.md` | Draft design | 提供最小 trace / replay 语义 |
| `docs/design-v3/07-workbench-ui-contract.md` | Draft design | 约束 UI 只消费 TurnResult 派生视图，不消费 raw planner output |
| `docs/design-v3/contracts/VS-00-reply-only-contract-pack.md` | Draft contract pack | 关闭 VS-00 最小 schema / trace / TurnResult / proof 文档 blocker |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| `ADR-0001-dialogue-frame-v3.md` 升级为 Accepted | closed | ADR-0001 已标记 Accepted |
| `DialogueFrame` 最小 schema 草案明确 primary frame identity、turn binding、frame type、evidence summary 和 replay refs | closed | `docs/design-v3/contracts/VS-00-reply-only-contract-pack.md` §2 |
| `DecisionTrace` 最小 trace policy 明确 reply-only turn 至少记录 frame ref、decision summary、no-tool reason 和 replay policy | closed | `docs/design-v3/contracts/VS-00-reply-only-contract-pack.md` §3 |
| `TurnResult v3` 最小出口规则明确 reply-only 不得宣称工具、写入、adoption 或 durable behavior 已发生 | closed | `docs/design-v3/contracts/VS-00-reply-only-contract-pack.md` §4 |
| Proof 必须能落成自动化测试或可运行命令 | closed | `docs/design-v3/contracts/VS-00-reply-only-contract-pack.md` §5 |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 可承接通用 id、Result/Error、schema validation helper；不承接业务 frame 语义 |
| novel_domain | no | reply-only 不引入领域对象或 production state transition |
| novel_agent | yes | 只涉及 Planner draft / provider structured output 边界；不涉及 tool runtime 或 supervision 变化 |
| novel_application | yes | 负责组装 DialogueContext、形成 primary frame、构造 reply-only TurnResult、协调 trace |
| novel_persistence | no | VS-00 不要求新增 Repo、DB schema 或 migration；trace 可先作为 TurnResult / application 层记录证明 |
| novel_web | yes | 只作为 AuthorInput / Channel response 边界；不直接构造 TurnResult 或读取 planner raw output |
| frontend | no | VS-00 可先由 Channel / API contract test 证明；前端消费留给 VS-05 |
| docs/design-v3 | yes | 本 slice 消费 v3 ADR / contract / DAG 文档，并反馈必要的 Accepted 门槛 |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 评审 ADR-0001 是否满足 VS-00 implementation 输入门槛 | done | ADR-0001 已进入 Accepted |
| T2 | 补 `DialogueFrame` 最小 schema 草案 | done | `docs/design-v3/contracts/VS-00-reply-only-contract-pack.md` §2 |
| T3 | 补 reply-only `DecisionTrace` 最小 policy | done | `docs/design-v3/contracts/VS-00-reply-only-contract-pack.md` §3 |
| T4 | 写 implementation plan 前的 contract test 草案 | done | `docs/design-v3/contracts/VS-00-reply-only-contract-pack.md` §5 |
| T5 | 评审是否将 ADR-0001 升级为 Accepted | done | Accepted 后仍不自动进入 code |

---

## 7. 验证

设计阶段验证：

- [ ] `rg -n "ADR-0004|ADR-0005|Pro""posed|Accepted|implementation plan|code" docs/design-v3 tasks/slices/v3`
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

- 2026-05-07 — 从 `tasks/slices/v3/DAG.md` B1 建立 VS-00 文件。当前只授权 slice 设计和评审，不进入 implementation plan / code。
- 2026-05-07 — 将 Proposed ADR 明确限制为 DAG planning input；VS-00 implementation blocker 首项设为 ADR-0001 Accepted。
- 2026-05-07 — 新增 `docs/design-v3/contracts/VS-00-reply-only-contract-pack.md`，关闭 VS-00 文档 blocker，并将 ADR-0001 标记为 Accepted。仍不授权代码实现。

---

## 9. 试行反馈

- VS-00 的价值在于先证明“无工具也有结构”，避免 v3 第一刀落成工具或 UI 横向任务。
- `DecisionTrace` 最小 policy 已进入 VS-00 contract pack；后续 VS-06 仍需要全量 DecisionTrace ADR / schema。
