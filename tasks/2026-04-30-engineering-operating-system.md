# Engineering Operating System

- 启动日期：2026-04-30
- 范围依据：`docs/engineering/architecture-operating-system.md`
- 当前状态：doing

## 范围

本事项把以下工程方法作为项目级能力推进：

- DRY / OCP / 正交 / 切面治理
- 承重竖切面
- 大任务 DAG 化
- 线性批次执行
- 深模块架构
- 复杂时序与性能边界
- 前沿范式业务建模

本事项不直接实现业务功能；它负责建立任务组织和架构治理的承重框架。

## 任务清单

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | 建立工程操作系统蓝图 | done | pending | `docs/engineering/architecture-operating-system.md` |
| T2 | 建立承重竖切面试行规则 | done | pending | `docs/engineering/vertical-slice.md` |
| T3 | 建立 slice 执行目录和首批 VS backlog | done | pending | `tasks/slices/` |
| T4 | 建立当前 slice DAG 与线性批次 | done | pending | `tasks/slices/DAG.md` |
| T5 | 试行 VS-001 | done | `7536d03` | TurnResult Contract Spine |
| T6 | 试行 VS-006 | done | pending | Turn Memory Write-Through |
| T7 | 试行 VS-002 | todo | — | Clarification Card Loop |
| T8 | 回收试行反馈，决定是否进入 Phase 2/3 | todo | — | 更新蓝图和 slice README |

## 阶段规划

| Phase | 目标 | 产物 | 状态 |
|---|---|---|---|
| Phase 0 | 固化蓝图与试行入口 | blueprint / vertical-slice / DAG / task | done |
| Phase 1 | 用 2-3 个 slice 验证规则 | VS-001 / VS-006 / VS-002 完成记录 | in_progress (2/3 done) |
| Phase 2 | DAG 化任务系统 | slice front matter / DAG 检查候选 | todo |
| Phase 3 | 深模块图谱 | `docs/engineering/deep-modules.md` | todo |
| Phase 4 | 正交切面治理 | `docs/engineering/cross-cutting-concerns.md` | todo |
| Phase 5 | 适应度函数脚本化 | `scripts/check_*` 候选 | todo |
| Phase 6 | 性能与时序压测 | budget / benchmark / checkpoint 策略 | todo |

## 决策日志

- 2026-04-30 — 将本次讨论固化为正式工程事项，避免信息只留在对话中。采用“蓝图 + task + slice DAG”的三层记录方式。
- 2026-04-30 — 暂不把规则直接加入 CI。先通过 2-3 个 slice 试行，等规则稳定后再脚本化。
- 2026-04-30 — 大任务组织采用 DAG 表达依赖，执行采用线性批次推进。DAG 节点必须是承重竖切面，不是横向技术层。

## 卡点 / TBD

- 需要在 VS-001 / VS-006 / VS-002 试行后判断哪些规则过重、哪些规则需要脚本化。
- 需要后续补 `docs/engineering/deep-modules.md`，把 TurnService、AdoptionBoundary、MemoryRecallService 等模块建成深模块图谱。

## 下次会话恢复指引

接手者按以下顺序读取：

1. `docs/engineering/architecture-operating-system.md`
2. `tasks/2026-04-30-engineering-operating-system.md`
3. `tasks/slices/DAG.md`
4. 当前准备施工的 `tasks/slices/VS-*.md`

如果要开始实际代码工作，优先从 VS-001、VS-006、VS-002 中选择一个，并先补齐该 slice 的开工检查。

