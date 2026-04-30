# VS-003 Confirmation Before Execute Loop

- 状态：todo
- 类型：Behavior Slice
- 启动日期：2026-04-30

## 1. 用户 / 系统目标

当操作涉及高风险、预算超阈或 `production_write` 时，系统必须先进入 confirmation 等待态，由作者确认或拒绝后再推进。

本 slice 打实“执行前确认”的权限和状态边界。

## 2. 开工检查

- Contract: `docs/design-v2/02-turn-and-task-state-machines.md` §5；`docs/design-v2/30-contract-glossary.md` §5；`docs/design-v2/adr/0003-authority-budget-escalation.md`；`docs/design-v2/adr/0006-card-action-schema.md`
- Invariant: 高风险操作不得从 `ROUTED` 直接进入 `READY_TO_EXECUTE`；confirm 才能推进，reject 必须取消或结束当前路径
- Boundary: 涉及 `novel_agent` policy/gate、`novel_application` 编排、`novel_web` action 回传、`frontend` confirmation card；不应让 Web 直接判断 authority
- Consumer: Authority gate / TurnService / frontend confirmation card
- Proof: authority gate 测试、TurnService confirmation 分支测试、Channel action 测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | phase/status/next_action enum |
| novel_domain | no | 不引入领域 mutation |
| novel_agent | yes | authority / budget 判断来源 |
| novel_application | yes | confirmation turn 编排 |
| novel_persistence | no | 试行期不先做 audit persistence |
| novel_web | yes | action 回传入口 |
| frontend | yes | confirmation card / confirm reject action |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 识别现有 authority/budget gate 能力边界 | todo | 不新增未消费 scope |
| T2 | 产出 `NEEDS_CONFIRMATION` TurnResult | todo | next_action 应对齐 confirmation 语义 |
| T3 | 实现 confirm/reject action 的 application 入口 | todo | Web 只做适配 |
| T4 | 前端渲染 confirmation card 并回传结构化 action | todo | 不用 label 推断动作 |

## 5. 验证

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix run scripts/arch_check.exs`
- [ ] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`

## 6. 决策日志

- 2026-04-30 — 建立 confirmation slice，明确高风险路径由 policy/application 决定，Web 和 UI 不承担授权判断。

## 7. 试行反馈

- 待记录。
