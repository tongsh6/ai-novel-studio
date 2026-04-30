# VS-002 Clarification Card Loop

- 状态：done
- 类型：Behavior Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

当作者输入缺少 required slot 时，系统必须进入 clarification 等待态，并返回可被 UI 消费的 `clarification_card` 与 `answer` action。

本 slice 打实"系统等待用户补充信息"的基础闭环。

## 2. 开工检查

- Contract: `docs/design-v2/02-turn-and-task-state-machines.md` §5.1-§5.3；`docs/design-v2/30-contract-glossary.md` §6.1；`docs/design-v2/adr/0006-card-action-schema.md`
- Invariant: 缺 required slot 不得直接执行；`NEEDS_CLARIFICATION` 必须映射 `WAITING_USER`；UI action 必须结构化为 canonical `answer`
- Boundary: 涉及 `novel_foundation`、`novel_application`、`novel_web`、`frontend`；不应修改 `novel_persistence` 或引入新 DB 表
- Consumer: Workspace Channel 返回的 TurnResult；前端 card renderer
- Proof: TurnService clarification 测试、TurnResult validator 测试、前端 card/action schema 或渲染测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 只引用既有 enum |
| novel_domain | no | 不引入领域对象 |
| novel_agent | no | 不改 Router/IntentRegistry |
| novel_application | yes | clarification_card helper + 两个 builder |
| novel_persistence | no | 不持久化 |
| novel_web | no | Channel 透传，不改 |
| frontend | yes | UICards handleAction 支持 answer + 卡片测试 |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 找出现有 intent/slot 缺失判断入口 | done | `handle_message/4` → Router → SlotSchema.blocking_slots。已有链路无需改动 |
| T2 | 产出 `phase=NEEDS_CLARIFICATION` 的合法 TurnResult | done | 已有两条 builder 产出合规 TurnResult |
| T3 | 返回 `clarification_card` + `answer` action | done | 新增 `clarification_card/2` helper，card_type/action_type 使用 ADR-0006 集合 |
| T4 | 前端消费该 card，不硬编码非 canonical 类型 | done | ClarificationCard 使用 copy.ts；handleAction 处理 answer 类型；新增 cards.test.ts |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 279 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `cd frontend && pnpm typecheck` — 零错误
- [x] `cd frontend && pnpm test` — 12 tests, 0 failures
- [ ] `bash scripts/check_design_trace.sh` — 3 个预存缺追溯（StructurePanel, ReadingMode + UICards 本次已补）

## 6. 决策日志

- 2026-04-30 — 建立 clarification 等待态 slice，作为所有 durable behavior 的第一个闭环样板。
- 2026-04-30 — T3: 新增 `clarification_card/2` helper，遵循 ADR-0006 canonical card_type `clarification_card` 和 action_type `answer`。card 结构复用现有简化格式 (body 而非 summary)，与 adoption_card 保持一致。
- 2026-04-30 — T4: handleAction 对 `answer` action type 的处理是聚焦输入框让用户自由输入，而不是预设答案模板。这保持当前 keyword-based router 的灵活性。

## 7. 试行反馈

- 当前只有一个 intent (CREATE_WORK_SEED) 注册，其余 19 个 ADR-0008 intent 未注册。Router keyword-based 实现只能识别作品创建关键词。
- `missing_slots` 存储在 `behavior_state.active` 的 ad-hoc key 中，未进入 ADR-0005 behavior_ui_hint。后续多 intent 场景需要结构化传达 slot 缺失信息。
- clarification_card 当前只有一个通用 `answer` action。后续可扩展为每个 missing slot 一个独立 answer action（per-slot clarification）。
