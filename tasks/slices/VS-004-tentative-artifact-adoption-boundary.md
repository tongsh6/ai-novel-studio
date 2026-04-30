# VS-004 Tentative Artifact Adoption Boundary

- 状态：done
- 类型：Artifact Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

当系统生成可采纳产物时，产物必须先以 tentative 状态进入 adoption boundary。作者可以 accept、edit_then_accept 或 discard，只有采纳后的结果才能进入权威状态。

本 slice 打实 AI 产物到作者权威状态之间的边界。

## 2. 开工检查

- Contract: `docs/design-v2/30-contract-glossary.md` §2.2 / §3；`docs/design-v2/schemas/foundation/artifact_adoption_entry.json`；`docs/design-v2/adr/0006-card-action-schema.md`
- Invariant: `requires_adoption=true` 的 artifact 不得直接写入 authoritative state；adoption 前必须校验 `revision_base`
- Boundary: 涉及 `novel_application` adoption boundary、可能涉及 `novel_domain` mutation、`novel_web` action、`frontend` adoption card；不应由 `novel_agent` 直接写 domain
- Consumer: Adoption card / TurnService adoption action / domain mutation entry
- Proof: adoption boundary 测试、revision mismatch 测试、TurnResult adoption_state 测试、前端 adoption action 测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 只引用既有 enum |
| novel_domain | no | 不引入新领域对象 |
| novel_agent | no | 不直接写 domain |
| novel_application | yes | discard 全链路 + adoption_card action_type |
| novel_persistence | yes | Work.discard_changeset + AdoptionBoundary.discard |
| novel_web | yes | discard Channel handler |
| frontend | yes | discard/edit_then_accept action 处理 + socket.ts |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审核现有 tentative artifact 产出路径 | done | 已有完整两步写入（create_tentative → accept），revision_base 检查已到位 |
| T2 | 固化 accept/discard/edit_then_accept application 入口 | done | discard 全链路新增：AdoptionBoundary.discard → TurnService.handle_discard → Channel → Frontend；adoption_card 新增 edit_then_accept action |
| T3 | 校验 `revision_base` 与当前目标 revision | done | AdoptionBoundary.accept 已有 revision mismatch → stale_revision + BLOCKED mutation |
| T4 | 前端 adoption card 不直接写状态，只回传 action | done | accept/discard/edit_then_accept 全部通过 Channel push 回传，前端不直接写状态 |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 290 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `cd frontend && pnpm typecheck` — 零错误
- [x] `cd frontend && pnpm test` — 12 tests, 0 failures

## 6. 决策日志

- 2026-04-30 — 建立 adoption boundary slice，作为 AI 产物进入权威状态的首个承重边界。
- 2026-04-30 — discard 实现为 `AdoptionBoundary.discard/2`：Work 状态 → DISCARDED，mutation 记录为 CANCELLED。与 accept 对称。
- 2026-04-30 — `edit_then_accept` 当前实现为前端输入聚焦（预填提示文本），用户修改后走正常消息流。后端暂不需要独立的 edit_then_accept endpoint。
- 2026-04-30 — adoption_card actions 新增 `action_type` 字段，与 ADR-0006 对齐：accept / edit_then_accept / discard。

## 7. 试行反馈

- discard 是 accept 的对称操作——代码可复用性高，AdoptionBoundary 的 Multi 模式直接应用于 discard。
- maintenance_artifact 类型尚未注册，当前仅支持 Work 类型 artifact。后续扩展 artifact 类型时 AdoptionBoundary 需要多态化。
- 前端 STALE_REVISION 错误仍然以通用"操作失败"显示——值得在后续 slice 中做差异化 UX。
