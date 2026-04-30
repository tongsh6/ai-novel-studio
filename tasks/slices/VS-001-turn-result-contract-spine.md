# VS-001 TurnResult Contract Spine

- 状态：todo
- 类型：Turn Slice
- 启动日期：2026-04-30

## 1. 用户 / 系统目标

打实最基础的 TurnResult 合同主干：Application 产出的每个 turn 结果都必须符合 `turn_result_v2`，并能被 Web/Channel 与前端 schema 消费。

本 slice 不是新增业务能力，而是把“系统一次回应”的承重出口钉牢。

## 2. 开工检查

- Contract: `docs/design-v2/schemas/foundation/turn_result_v2.json`；`docs/design-v2/adr/0001-turn-result-v2-schema.md`；`docs/design-v2/02-turn-and-task-state-machines.md` §5
- Invariant: 所有 TurnResult 必须包含 canonical 必填字段；`phase` / `status` / `next_action` 必须来自冻结枚举；无效 TurnResult 不得离开 application 出口
- Boundary: 涉及 `novel_foundation`、`novel_application`、`novel_web`、`frontend`；不应修改 `novel_agent` runtime 或 `novel_persistence` 表结构
- Consumer: `NovelApplication.TurnService`、`NovelWeb.WorkspaceChannel`、`frontend/src/lib/schemas.ts`
- Proof: `TurnResultValidator` 测试、`TurnService` 测试、Channel 测试、前端 Zod schema 测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | TurnResult validator / enum contract |
| novel_domain | no | 本 slice 不引入领域对象 |
| novel_agent | no | 只消费已有 agent 输出，不改 runtime |
| novel_application | yes | TurnService 出口强校验 |
| novel_persistence | no | 不新增持久化 |
| novel_web | yes | Channel 返回 TurnResult |
| frontend | yes | Zod schema 消费 TurnResult |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审核现有 TurnResult 生成路径是否全部经过 validator | todo | 不新增抽象，只补缺口 |
| T2 | 补齐 phase/status/next_action 组合测试 | todo | 覆盖非法枚举和不兼容组合 |
| T3 | 确认 Channel 返回结构不绕过 application 出口 | todo | Web 保持薄适配 |
| T4 | 确认前端 schema 测试覆盖非空 ui_cards/adoption_state/projection_refs | todo | 避免 UI 猜字段 |

## 5. 验证

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix run scripts/arch_check.exs`
- [ ] `cd frontend && pnpm typecheck && pnpm test`

## 6. 决策日志

- 2026-04-30 — 建立首批承重 slice。VS-001 作为 TurnResult 出口合同主干，优先做“固化现有链路”而不是新增功能。

## 7. 试行反馈

- 待记录。
