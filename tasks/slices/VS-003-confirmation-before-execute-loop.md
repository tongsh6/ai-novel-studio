# VS-003 Confirmation Before Execute Loop

- 状态：done
- 类型：Behavior Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

当操作涉及高风险、预算超阈或 `production_write` 时，系统必须先进入 confirmation 等待态，由作者确认或拒绝后再推进。

本 slice 打实"执行前确认"的权限和状态边界。

## 2. 开工检查

- Contract: `docs/design-v2/02-turn-and-task-state-machines.md` §5；`docs/design-v2/30-contract-glossary.md` §5；`docs/design-v2/adr/0003-authority-budget-escalation.md`；`docs/design-v2/adr/0006-card-action-schema.md`
- Invariant: 高风险操作不得从 `ROUTED` 直接进入 `READY_TO_EXECUTE`；confirm 才能推进，reject 必须取消或结束当前路径
- Boundary: 涉及 `novel_agent` policy/gate、`novel_application` 编排、`novel_web` action 回传、`frontend` confirmation card；不应让 Web 直接判断 authority
- Consumer: Authority gate / TurnService / frontend confirmation card
- Proof: authority gate 测试、TurnService confirmation 分支测试、Channel action 测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 只引用既有 enum |
| novel_domain | no | 不引入领域 mutation |
| novel_agent | yes | AuthorityGate 扩展：risk check + ETS pending store |
| novel_application | yes | confirmation 分支 + handle_confirm + handle_reject |
| novel_persistence | no | 试行期不先做 audit persistence |
| novel_web | yes | confirm / reject Channel handlers |
| frontend | yes | confirmation card 修 + confirm/reject action 处理 |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 识别现有 authority/budget gate 能力边界 | done | AuthorityGate 从全放行扩展为检查 requires_confirmation + risk_class=high |
| T2 | 产出 `NEEDS_CONFIRMATION` TurnResult | done | build_confirmation/4 产出合规 TurnResult + confirmation_card |
| T3 | 实现 confirm/reject action 的 application 入口 | done | handle_confirm/2 取回 pending context 重执行；handle_reject/2 返回 CANCELLED |
| T4 | 前端渲染 confirmation card 并回传结构化 action | done | ConfirmationCard 使用 copy.ts；handleAction 处理 confirm/reject；socket.ts 新增 confirm()/rejectAction() |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 288 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `cd frontend && pnpm typecheck` — 零错误
- [x] `cd frontend && pnpm test` — 12 tests, 0 failures

## 6. 决策日志

- 2026-04-30 — 建立 confirmation slice，明确高风险路径由 policy/application 决定，Web 和 UI 不承担授权判断。
- 2026-04-30 — Pending confirmation 上下文存在 AuthorityGate 的 ETS `:authority_pending` 表中，由前端传 behavior_id 回取。选择 ETS 而非 DB 的原因：confirmation 是瞬态的，不需要持久化。
- 2026-04-30 — 当前仅有一个 intent (CREATE_WORK_SEED) 且 risk_class=low，正常路径不触发 confirmation。测试通过 AuthorityGate.request_confirmation/1 手动注入 pending context 覆盖。
- 2026-04-30 — `handle_confirm` 重执行原 intent（重新调用 build_create_work_tentative），而非缓存首次 TurnResult。这样保证 execution 是最新状态的。
- 2026-04-30 — AuthorityGate telemetry 从 tuple 结果改为 map，避免 AuditLog JSON encode 失败。

## 7. 试行反馈

- 确认-拒绝闭环打通后，VS-004 (Tentative Artifact Adoption Boundary) 和 VS-005 (Projection Stale) 的基础设施已就位。
- `requires_confirmation` 和 `risk_class` 当前不在 Router.Result struct 中——通过 Map.get 兜底读取。后续 Router 应新增这两个字段。
- 目前仅 CREATE_WORK_SEED 注册，未来高风险 intent（如 production_write、长跑清理）注册后自动触发 confirmation。
