# VS-00A Creative Exploration Loop

- 状态：docs-ready
- 类型：Experience Slice
- 启动日期：2026-05-08
- 所属 DAG：`tasks/slices/v3/DAG.md` B2

> 本文件是 VS-00A 的具体 slice 入口，不是 implementation plan，不授权代码实现。它补足 v3 首批切面中“AI 像创作伙伴，而不是表单前台”的证明。

---

## 1. 用户 / 系统目标

打实 v3 的第一体验：当作者给出模糊创作想法时，系统应先像编辑和创作伙伴一样自然展开方向，而不是立刻把缺失信息变成表单或机械追问。

本 slice 证明 v3 不只是可审计的执行框架，也能让作者感到自己在和 AI 共同构思小说。

示例输入：

```text
我想写一个赛博修仙，但还没想好。
```

期望输出不是：

```text
请补充作品类型、主角身份、世界观、目标读者。
```

而是：

```text
这个方向可以有几种味道：公司垄断灵气、宗门搬进霓虹都市、修仙者被算法评级。你更想写热血、黑色幽默，还是压抑一点？
```

---

## 2. 开工检查

- Contract: `AuthorInput`、`DialogueContext`、`DialogueFrame.frame_type=exploration`、`ExplorationPolicy`、`CandidateDirectionSet`、`TurnResult`、`DecisionTrace`
- Invariant: `00c` §7 #1、#8、#9、#14：每 turn 必有 frame；缺 slot 不自动等于表单；TurnResult 是 canonical 输出；replay 默认不重新调用 LLM
- Boundary: 切过 web / application / agent planner draft / TurnResult / trace；不碰 tool dispatch、durable behavior、production write 或 adoption
- Consumer: Application contract test 或 Channel response
- Proof: 模糊创作输入产生自然探索回应和 2-3 个候选方向；不得打开机械 slot 表单；trace 能解释为什么停留在 exploration

---

## 3. Planning Depends On

| 输入 | 当前状态 | VS-00A 使用方式 |
|---|---|---|
| `tasks/slices/v3/VS-00-reply-only-dialogue-frame-turn-result-trace.md` | docs-ready | 提供每 turn 必有 frame、TurnResult 和 trace 的最小主链 |
| `docs/design/01-user-llm-workbench-interaction-model.md` | Draft design | 提供“AI 是创作伙伴、工作台退到后台工具箱”的体验目标 |
| `docs/design/adr/ADR-0001-dialogue-frame-v3.md` | Accepted | 固化 exploration turn 也必须有 primary DialogueFrame |
| `docs/design/adr/ADR-0015-turn-result-view-model-v3.md` | Accepted | 约束前台只消费 TurnResult / view model，不读取内部 planner 输出 |
| `docs/design/contracts/VS-00A-creative-exploration-contract-pack.md` | Draft contract pack | 关闭 VS-00A 探索回应、候选方向和 proof 文档 blocker |

---

## 4. Implementation Blockers

| Blocker | 状态 | 关闭依据 |
|---|---|---|
| exploration turn 的最小语义明确 | closed | `docs/design/contracts/VS-00A-creative-exploration-contract-pack.md` §2 |
| 候选方向不等于 adoption 的规则明确 | closed | `docs/design/contracts/VS-00A-creative-exploration-contract-pack.md` §3 |
| 缺 slot 不自动表单化的证明明确 | closed | `docs/design/contracts/VS-00A-creative-exploration-contract-pack.md` §4 |
| TurnResult truthfulness 和 trace proof 明确 | closed | `docs/design/contracts/VS-00A-creative-exploration-contract-pack.md` §5-6 |

当前没有声明 implementation 例外。代码实现仍需用户明确批准。

---

## 5. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 可承接通用 id、Result/Error、validation helper；不承接创作语义 |
| novel_domain | no | VS-00A 不引入领域对象或 production state transition |
| novel_agent | yes | 只涉及 planner draft / provider structured output；不调用工具 |
| novel_application | yes | 负责组装最小上下文、校验 exploration frame、构造 TurnResult、协调 trace |
| novel_persistence | no | VS-00A 不要求新增 Repo、DB schema 或 migration |
| novel_web | yes | 只作为 AuthorInput / Channel response 边界；不直接构造候选方向 |
| frontend | no | 可先用 Channel / API contract test 证明；最终 UI 消费留给 VS-05 |
| docs/design | yes | 本 slice 消费 v3 愿景、ADR-0001、ADR-0015 和 VS-00A contract pack |

---

## 6. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 补 exploration turn 最小 contract | done | `docs/design/contracts/VS-00A-creative-exploration-contract-pack.md` §2 |
| T2 | 补候选方向与系统事实边界 | done | `docs/design/contracts/VS-00A-creative-exploration-contract-pack.md` §3 |
| T3 | 补“缺信息不自动表单化”证明 | done | `docs/design/contracts/VS-00A-creative-exploration-contract-pack.md` §4 |
| T4 | 补 TurnResult 和 trace proof | done | `docs/design/contracts/VS-00A-creative-exploration-contract-pack.md` §5-6 |

---

## 7. 验证

设计阶段验证：

- [ ] `rg -n "VS-00A|Creative Exploration|自然探索|创作伙伴" docs/design tasks/slices/v3`
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

- 2026-05-08 — 根据 v3 愿景评审反馈新增 VS-00A。当前只授权 slice 设计和评审，不进入 implementation plan / code。

---

## 9. 试行反馈

- VS-00A 的关键不是多做一个“聊天回复”，而是防止 v3 第一批实现只证明安全执行，却没有证明 AI 创作伙伴体验。
- VS-00A 刻意不打开 durable clarification；它保护的是“先自然展开”，不是“永远不追问”。

