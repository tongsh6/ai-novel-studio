# VS-005 Accepted Artifact Marks Projection Stale

- 状态：done
- 类型：Projection Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

当作者采纳 artifact 并导致权威内容变化时，相关 reading projection 必须被显式标记为 `STALE`，后续 rebuild 后才能重新变为 `FRESH`。

本 slice 打实"权威源变化 → 派生投影失效"的承重链路。

## 2. 开工检查

- Contract: `docs/design-v2/adr/0009-projection-object-schema.md`；`docs/design-v2/adr/0011-projection-refresh-state-triggers.md`；`docs/design-v2/30-contract-glossary.md` §2.3 / §8.3
- Invariant: accepted source revision 变化后，旧 projection 不得继续声明 `FRESH`；tentative artifact 不得进入 reading projection
- Boundary: 涉及 `novel_application` mutation 编排、`novel_domain` projection 规则、可能涉及 `novel_persistence` projection state；不应让 frontend 本地推断 stale
- Consumer: Reading mode / projection refs in TurnResult / projection rebuild worker
- Proof: accepted mutation 标记 stale 测试、tentative 不影响 projection 测试、source_revision_refs 测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | 新增 ProjectionRefreshStatus 枚举 |
| novel_domain | no | 不引入领域 projection 对象 |
| novel_agent | no | Agent 不管理 projection 状态 |
| novel_application | yes | handle_adopt + handle_discard 产出 projection_refs |
| novel_persistence | no | 不新增 projection 持久化 |
| novel_web | no | Channel 透传，不改 |
| frontend | yes | ReadingMode 从 store 消费 projectionStatus |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 明确当前最小 projection state 存放位置 | done | 新增 ProjectionRefreshStatus 枚举 (FRESH/STALE/REBUILDING/FAILED)；状态通过 TurnResult.projection_refs 传递 |
| T2 | adoption accepted 后写出 `projection_refs` 或标记 stale | done | handle_adopt + handle_discard 均产出 projection_refs，refresh_status=STALE |
| T3 | 测试 tentative artifact 不进入 projection | done | 确认 handle_message 产出 tentative 时 projection_refs 为空 |
| T4 | 若涉及 UI，ReadingMode 只消费后端 projection status | done | ReadingMode 从 Zustand store 读 projectionStatus；WorkspaceChat 在收到 TurnResult 时推送 |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 290 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `cd frontend && pnpm typecheck` — 零错误
- [x] `cd frontend && pnpm test` — 12 tests, 0 failures

## 6. 决策日志

- 2026-04-30 — 建立 projection stale slice，确保 reading projection 从一开始就是显式派生状态，而不是 UI 缓存。
- 2026-04-30 — projection_refs 当前通过 TurnResult 即时传递（非持久化到 DB），ReadingMode 通过 Zustand store 跨组件消费。完整 projection engine（rebuild worker、TOC/chapter 对象、持久化）超出本 slice 范围。
- 2026-04-30 — `ProjectionRefreshStatus` 作为 novel_foundation 枚举落地，为后续 ADR-0011 full engine 提供类型基础。

## 7. 试行反馈

- VS-005 是 6 个 slice 中改动最小的——只在已有 adoption/discard 路径上加 projection_refs 产出 + 前端 Zustand store 消费。
- 完整 projection engine（rebuild/refresh/toc/chapter 对象）需要后续 slice 或 Phase 3 深模块建设。
- 当前 `source_revision_refs` 使用 `"rev-work-<id>-r<revision>"` 格式——后续应与 ADR-0011 的 revision ref schema 对齐。
