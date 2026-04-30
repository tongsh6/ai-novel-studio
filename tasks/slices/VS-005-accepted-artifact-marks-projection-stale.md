# VS-005 Accepted Artifact Marks Projection Stale

- 状态：todo
- 类型：Projection Slice
- 启动日期：2026-04-30

## 1. 用户 / 系统目标

当作者采纳 artifact 并导致权威内容变化时，相关 reading projection 必须被显式标记为 `STALE`，后续 rebuild 后才能重新变为 `FRESH`。

本 slice 打实“权威源变化 → 派生投影失效”的承重链路。

## 2. 开工检查

- Contract: `docs/design-v2/adr/0009-projection-object-schema.md`；`docs/design-v2/adr/0011-projection-refresh-state-triggers.md`；`docs/design-v2/30-contract-glossary.md` §2.3 / §8.3
- Invariant: accepted source revision 变化后，旧 projection 不得继续声明 `FRESH`；tentative artifact 不得进入 reading projection
- Boundary: 涉及 `novel_application` mutation 编排、`novel_domain` projection 规则、可能涉及 `novel_persistence` projection state；不应让 frontend 本地推断 stale
- Consumer: Reading mode / projection refs in TurnResult / projection rebuild worker
- Proof: accepted mutation 标记 stale 测试、tentative 不影响 projection 测试、source_revision_refs 测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | yes | shared status enum |
| novel_domain | yes | projection/domain rule |
| novel_agent | no | Agent 不管理 projection 状态 |
| novel_application | yes | adoption 后编排 projection invalidation |
| novel_persistence | optional | projection state 持久化如果当前 slice 需要 |
| novel_web | optional | 只暴露 application 结果 |
| frontend | optional | ReadingMode 消费 projection status |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 明确当前最小 projection state 存放位置 | todo | 不提前实现完整 rebuild engine |
| T2 | adoption accepted 后写出 `projection_refs` 或标记 stale | todo | `source_revision_refs` 使用 canonical 字段 |
| T3 | 测试 tentative artifact 不进入 projection | todo | 保护 adoption boundary |
| T4 | 若涉及 UI，ReadingMode 只消费后端 projection status | todo | 不在前端猜 stale |

## 5. 验证

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test`
- [ ] `mix run scripts/arch_check.exs`
- [ ] frontend checks（如果涉及 frontend）

## 6. 决策日志

- 2026-04-30 — 建立 projection stale slice，确保 reading projection 从一开始就是显式派生状态，而不是 UI 缓存。

## 7. 试行反馈

- 待记录。
