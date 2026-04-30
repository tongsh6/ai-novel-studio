# VS-002 Clarification Card Loop

- 状态：todo
- 类型：Behavior Slice
- 启动日期：2026-04-30

## 1. 用户 / 系统目标

当作者输入缺少 required slot 时，系统必须进入 clarification 等待态，并返回可被 UI 消费的 `clarification_card` 与 `answer` action。

本 slice 打实“系统等待用户补充信息”的基础闭环。

## 2. 开工检查

- Contract: `docs/design-v2/02-turn-and-task-state-machines.md` §5.1-§5.3；`docs/design-v2/30-contract-glossary.md` §6.1；`docs/design-v2/adr/0006-card-action-schema.md`
- Invariant: 缺 required slot 不得直接执行；`NEEDS_CLARIFICATION` 必须映射 `WAITING_USER`；UI action 必须结构化为 canonical `answer`
- Boundary: 涉及 `novel_foundation`、`novel_application`、`novel_web`、`frontend`；不应修改 `novel_persistence` 或引入新 DB 表
- Consumer: Workspace Channel 返回的 TurnResult；前端 card renderer
- Proof: TurnService clarification 测试、TurnResult validator 测试、前端 card/action schema 或渲染测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | phase/status/action enum 校验 |
| novel_domain | no | 不引入领域对象 |
| novel_agent | optional | 仅当已有 router/capability 能返回 slot 缺失 |
| novel_application | yes | 缺 slot 到 clarification TurnResult 的编排 |
| novel_persistence | no | 不持久化 clarification |
| novel_web | yes | Channel 透传 TurnResult |
| frontend | yes | 渲染 clarification card 和 answer action |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 找出现有 intent/slot 缺失判断入口 | todo | 不能为了本 slice 新造大而全 slot 系统 |
| T2 | 产出 `phase=NEEDS_CLARIFICATION` 的合法 TurnResult | todo | status 必须是 `WAITING_USER` |
| T3 | 返回 `clarification_card` + `answer` action | todo | card/action 使用 ADR-0006 集合 |
| T4 | 前端消费该 card，不硬编码非 canonical 类型 | todo | 文案走 `copy.ts` |

## 5. 验证

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix run scripts/arch_check.exs`
- [ ] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`
- [ ] `bash scripts/check_design_trace.sh`

## 6. 决策日志

- 2026-04-30 — 建立 clarification 等待态 slice，作为所有 durable behavior 的第一个闭环样板。

## 7. 试行反馈

- 待记录。
