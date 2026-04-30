# VS-001 TurnResult Contract Spine

- 状态：done
- 类型：Turn Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

打实最基础的 TurnResult 合同主干：Application 产出的每个 turn 结果都必须符合 `turn_result_v2`，并能被 Web/Channel 与前端 schema 消费。

本 slice 不是新增业务能力，而是把"系统一次回应"的承重出口钉牢。

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
| novel_application | no | 只验证已有路径，不改代码 |
| novel_persistence | no | 不新增持久化 |
| novel_web | no | 只验证已有路径，不改代码 |
| frontend | no | 只补齐测试覆盖，不改代码 |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审核现有 TurnResult 生成路径是否全部经过 validator | done | 全部 2 条生产路径都经过 validator，Channel 无绕过 |
| T2 | 补齐 phase/status/next_action 组合测试 | done | 新增 7 个组合测试覆盖全部 7 个 phase + rule 4 |
| T3 | 确认 Channel 返回结构不绕过 application 出口 | done | Channel 全量委托 TurnService，不直接构造 TurnResult |
| T4 | 确认前端 schema 测试覆盖非空 ui_cards/adoption_state/projection_refs | done | 新增非空 ui_cards 和非空 projection_refs 测试 |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 266 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles found
- [x] `cd frontend && pnpm typecheck && pnpm test` — 10 tests, 0 failures

## 6. 决策日志

- 2026-04-30 — 建立首批承重 slice。VS-001 作为 TurnResult 出口合同主干，优先做"固化现有链路"而不是新增功能。
- 2026-04-30 — T1 审核发现 `memory_context` 字段在 `TurnService.build_turn_result/2` 中产出，但不在 JSON Schema `properties` 中也不被 validator 检查。属于已知间隙，不在本 slice 范围内的功能，记入后续 card。

## 7. 试行反馈

- 竖切面 5 问检查有效提前界定了 scope：明确不应修改 novel_agent 和 novel_persistence。
- `PhaseNextActionCompat` 编译期读 JSON schema 的设计使组合测试天然与 SSOT 同步 — 好的实践。
- 实际修改范围比预想更小：只动了 2 个测试文件，没改生产代码。这验证了 VS-001 "固化而非新增"的定位。
- arch_check.exs 依赖应用启动，端口冲突时会假失败。建议后续将架构检查脚本化到编译期。
