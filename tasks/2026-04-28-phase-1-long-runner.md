# Phase 1 · Planning & Long-Run（LongRunner + checkpoint）

- 启动日期：2026-04-28
- 范围依据：`docs/design-v2/tech-stack/14-roadmap.md` §6（Phase 1 推荐顺序第 3 项）
- 设计依据：`docs/design-v2/06-planning-and-long-run.md`
- 上一阶段：`tasks/2026-04-28-phase-1-memory-foundation.md`（T1-T3 done）

## 任务清单

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | LongRunTask DB 表 + Ecto Schema | done | (pending) | `long_run_tasks` 表（uuid PK / workspace_id / task_type / status / phase / goal / checkpoint_data / timestamps）；Ecto schema + changeset helpers |
| T2 | LongRunner GenServer | done | (pending) | ETS-based 运行时；API: create/checkpoint/resume/complete/get/list_active；纳入 Agent 监督树；4 tests |
| T3 | TurnService 集成 LongRunner | todo | — | 用户消息识别 long-run 指令（"继续写"等），通过 LongRunner 管理任务 |

## 决策日志

倒序，最新在上。

- **2026-04-28** — Phase 1 Step 2 启动。实施 Planning & Long-Run。关键决策：
  - 先做最小状态机（RUNNING / CHECKPOINT / COMPLETED），跳过 PLANNED/ESTIMATED/CONFIRMED（Phase 1 后续补）
  - checkpoint 存 JSONB 字段（flexible schema），包含 task summary + pending artifacts
  - LongRunner 在 novel_agent，持久化在 novel_persistence，编排在 novel_application
