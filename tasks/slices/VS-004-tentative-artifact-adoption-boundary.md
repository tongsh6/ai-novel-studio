# VS-004 Tentative Artifact Adoption Boundary

- 状态：todo
- 类型：Artifact Slice
- 启动日期：2026-04-30

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
| novel_foundation | yes | adoption enum / schema validation |
| novel_domain | optional | 仅当本 slice 接入真实 domain mutation |
| novel_agent | optional | 只作为 tentative artifact 来源 |
| novel_application | yes | adoption boundary |
| novel_persistence | optional | 仅当记录 mutation/adoption log |
| novel_web | yes | adoption action 入口 |
| frontend | yes | adoption card |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审核现有 tentative artifact 产出路径 | todo | 确认是否已有 pending adoption_state |
| T2 | 固化 accept/discard/edit_then_accept application 入口 | todo | action_type 使用 ADR-0006 |
| T3 | 校验 `revision_base` 与当前目标 revision | todo | mismatch 应 INVALIDATED 或失败 |
| T4 | 前端 adoption card 不直接写状态，只回传 action | todo | UI 不是授权本身 |

## 5. 验证

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix run scripts/arch_check.exs`
- [ ] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`

## 6. 决策日志

- 2026-04-30 — 建立 adoption boundary slice，作为 AI 产物进入权威状态的首个承重边界。

## 7. 试行反馈

- 待记录。
