# Phase 1 · Consistency & Concurrency（revision + 乐观锁）

- 启动日期：2026-04-28
- 范围依据：`docs/design-v2/tech-stack/14-roadmap.md` §6（Phase 1 推荐顺序第 4 项）
- 设计依据：`docs/design-v2/07-consistency-and-concurrency.md`
- 上一阶段：`tasks/2026-04-28-phase-1-long-runner.md`（T1-T2 done）

## 任务清单

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | works 表加 revision 字段 + 乐观锁 | done | (pending) | migration `revision :integer, default: 1`；Ecto schema `optimistic_lock(:revision)` on changeset + adopt_changeset |
| T2 | AdoptionBoundary 冲突检测 | done | (pending) | accept 返回 `{:error, :stale_revision}` 当乐观锁冲突；提取 build_attrs/adopt_if_ok 降低复杂度 |
| T3 | NovelFoundation.Revision 工具模块 | done | (pending) | `base_revision/1` + `stale?/2` 纯函数 |

## 决策日志

- **2026-04-28** — Phase 1 Step 3 启动。实施 Consistency & Concurrency。关键决策：
  - 先用 Ecto 内置 `optimistic_lock`（`lock_version` 字段），不造轮子。07-consistency §4 要求的 base_revision → compare → detect 路径由 changeset 的 `stale?` 检查自动完成。
  - revision 从 1 开始递增，每次 update 后 +1
  - 冲突时返回 `{:error, :stale_revision}` 而不是静默覆盖
