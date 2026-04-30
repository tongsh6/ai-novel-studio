# Engineering Operating System

- 启动日期：2026-04-30
- 范围依据：`docs/engineering/architecture-operating-system.md`
- 当前状态：Phase 1 done，Phase 2 done，Phase 3 done（VS-001~012 全部闭环）

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
| T6 | 试行 VS-006 | done | `a3563dd` | Turn Memory Write-Through |
| T7 | 试行 VS-002 | done | `3e54be8` | Clarification Card Loop |
| T8 | 回收试行反馈，决定是否进入 Phase 2/3 | done | — | 3 个 slice 试行反馈已记录在各 slice 文件中 |
| T9 | 追行 VS-003 | done | `a5c6111` | Confirmation Before Execute Loop |
| T10 | 追行 VS-004 | done | `8627f9b` | Tentative Artifact Adoption Boundary |
| T11 | 追行 VS-005 | done | `ed9710f` | Accepted Artifact Marks Projection Stale |
| T12 | Phase 2 项目态势分析 | done | — | 产出 Top 3 优先级 + VS-007/VS-008/VS-009 规划 |
| T13 | 建立 VS-007/VS-008/VS-009 slice 文件 + DAG 更新 | done | — | 三个新 slice 已写入 tasks/slices/ |
| T14 | 施工 VS-009 | done | `c87d09c` | Governed Memory Recall Pipeline Close |
| T15 | 施工 VS-008 | done | `c87d09c` | Provider Gateway Real Adapter (LM Studio) |
| T16 | 施工 VS-007 | done | `c87d09c` | Intent Registry Expansion + Router LLM 升级 |
| T17 | 施工 VS-010 | done | `7dbbb24` | Novel Domain Core Objects |
| T18 | 施工 VS-011 | done | `a5bad12` | Real Provider Gateway (Anthropic API) |
| T19 | 施工 VS-012 | done | `11d2055` | End-to-End Creative Turn Pipeline |

## 阶段规划

| Phase | 目标 | 产物 | 状态 |
|---|---|---|---|
| Phase 0 | 固化蓝图与试行入口 | blueprint / vertical-slice / DAG / task | done |
| Phase 1 | 用 2-3 个 slice 验证规则 | VS-001 / VS-006 / VS-002 完成记录 | done (3/3 done) |
| Phase 2 | VS-007/VS-008/VS-009 承重扩张 | Intent Registry + Provider + Memory Recall 收束 | done |
| Phase 3 | VS-010/VS-011/VS-012 功能竖切面 | Domain 核心对象 + Anthropic Provider + 端到端链路 | done |
| Phase 4 | 深模块图谱 | `docs/engineering/deep-modules.md` | todo |
| Phase 5 | 正交切面治理 | `docs/engineering/cross-cutting-concerns.md` | todo |
| Phase 6 | 适应度函数脚本化 | `scripts/check_*` 候选 | todo |
| Phase 7 | 性能与时序压测 | budget / benchmark / checkpoint 策略 | todo |

## 决策日志

- 2026-04-30 — 将本次讨论固化为正式工程事项，避免信息只留在对话中。采用“蓝图 + task + slice DAG”的三层记录方式。
- 2026-04-30 — 暂不把规则直接加入 CI。先通过 2-3 个 slice 试行，等规则稳定后再脚本化。
- 2026-04-30 — 大任务组织采用 DAG 表达依赖，执行采用线性批次推进。DAG 节点必须是承重竖切面，不是横向技术层。

## 卡点 / TBD

- VS-001~VS-012 全部闭环，试行反馈记录在各 slice 文件中。
- VS-012 自认缺口：modify_draft 未实现、ReadingMode 真内容未渲染、StructurePanel 真实数据未接入、arch_check 1 个预存违规。
- 需要后续补 `docs/engineering/deep-modules.md`，把 TurnService、AdoptionBoundary、MemoryRecallService 等模块建成深模块图谱。

## 下次会话恢复指引

接手者按以下顺序读取：

1. `docs/engineering/architecture-operating-system.md`
2. `tasks/2026-04-30-engineering-operating-system.md`
3. `tasks/slices/DAG.md`
4. 当前施工优先级：静态扫描 → VS-013（modify_draft 闭环）→ VS-014（ReadingMode 真内容投影）

