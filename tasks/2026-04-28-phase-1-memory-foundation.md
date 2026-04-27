# Phase 1 · Memory Retention（hot/warm/cold 三层）

- 启动日期：2026-04-28
- 范围依据：`docs/design-v2/tech-stack/14-roadmap.md` §6（Phase 1 启动推荐顺序第 1 项）
- 设计依据：`docs/design-v2/05-memory-retention-and-retrieval.md`
- 上一阶段：`tasks/2026-04-28-phase-0-week-4-e2e-smoke.md`（8/8 done，Phase 0 收官）

## 任务清单

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | Interaction Log — DB 表 + Ecto Schema | done | (pending) | `interactions` 表（uuid PK / workspace_id / turn_id / role / content JSONB / memory_class / retention_tier / timestamps）；按 05-memory §5 最小 source 字段 |
| T2 | Memory.Store GenServer（hot tier） | done | (pending) | ETS ordered_set + seq 序列号防碰撞；API（record/recent/by_turn）；纳入 Agent 监督树；2 tests |
| T3 | TurnService 集成 Memory | done | (pending) | 每条 turn 自动 record 到 Memory.Store (hot) + MemoryLog (warm)；workspace_id 分区；WorkspaceChannel 传 workspace_id |
| T4 | Memory retention policy（摘要 + 降级） | todo | — | hot → warm 降级规则 + summary 触发；按 05-memory §6 |
| T5 | Memory retrieval API（多消费者） | todo | — | Router / Executor / Reader 各自的 context assembly 策略；按 05-memory §2.4 |

## 决策日志

倒序，最新在上。

- **2026-04-28** — T1-T3 完成。关键决策：
  - **Memory.Store 与 MemoryLog 分离**：Store 在 novel_agent（ETS hot tier），MemoryLog 在 novel_persistence（DB warm/cold tier）。不交叉依赖，由 TurnService（novel_application）做双写编排。
  - **ETS key 加 seq 序列号**：`{workspace_id, timestamp_ms, seq, turn_id}` 四元组，防止同毫秒内多条记录 key 碰撞导致覆盖。
  - **workspace_id 从 Channel topic 提取**：`join("workspace:<id>")` 将 suffix assign 到 socket，后续 handle_in 中传给 TurnService 用于 memory 分区。
  - **MemoryLog 复用 Sandbox 模式**：与 novel_persistence 其他测试一致，使用 `Ecto.Adapters.SQL.Sandbox` + `:manual` mode。

- **2026-04-28** — Phase 1 启动。首项实施 Memory retention（14-roadmap.md §6 推荐顺序第 1 项）。关键决策：
  - 先落地 Interaction Log（episodic memory 基础），再建 Memory.Store，最后集成 TurnService
  - ETS 做 hot tier（低延迟），DB 做 warm/cold tier（可检索、可回放）
  - interactions 表字段对齐 05-memory §5.1 最小 source 字段集

## 卡点 / TBD

- （暂无）

## 下次会话恢复指引

接手者按以下顺序读取上下文：

1. `docs/design-v2/tech-stack/14-roadmap.md` §6（Phase 1 启动顺序）
2. `docs/design-v2/05-memory-retention-and-retrieval.md`（Memory contract）
3. 本文件 §任务清单 + §决策日志
