# 04a 规划与长跑任务（Planning & Long-run Task）

> 角色：把"高预算、多单元、可恢复的后台批量/推演任务"这一散落概念**收口为单一权威文档**。
>
> 整合声明（2026-06-17）：本文取代历史上被多处引用却**从未落地**的 `06-planning-and-long-run.md`
> （`schemas/long_run_task` moduledoc 等引用的旧路径，现归本文）。本文是**综合既有冻结决策的
> consolidation**，不发明新契约：生命周期来自 `ADR-0002 §4`，持久化来自 `schemas/long_run_task`，
> 状态来自 `05-turn-behavior-and-state-model.md`，触发/预算来自 `domain/...`、`00d` 与
> `ui/45/47/43`，作者体验来自 `acceptance/author/AU-10-workbench-ui.md`。凡本文未表述的细节，按
> 这些来源；凡来源也未定的，本文 §10 标为缺口，不臆造。

---

## 1. 这是什么 / 不是什么

**长跑任务（long-run task）= 高预算、需多次工具/LLM 调用、逐单元推进、可检查点恢复的后台创作任务。**
作者触发后**不被阻塞**，任务在后台跑，工作台实时显示进度，作者可随时取消；任务逐单元产出
**待采纳 artifact**，最终仍走采纳边界进入作品事实。

它**不是**：

- 每轮的下一步建议 —— 那是 `MicroPlan`（`02-dialogue-frame-and-micro-plan.md` §3 明确："MicroPlan 不是 long-run task plan"）。
- 同步阻塞动作 —— 单轮内完成的工具调用（如单章首稿、导出）走普通 turn 主链，不必是长跑任务。
- 绕过采纳/门禁的自动写入 —— 长跑产出仍是 tentative，写入与高风险仍由 Execution Orchestrator / 采纳边界裁决。

**典型场景**：批量生成多章初稿、批量续写、整卷剧情推演（`ui/45-guided-conversation-flows.md` §"触发意图：
启动批量生成、推演等高预算操作"；`ui/47` `long-run`=长跑任务/批量续写；`ui/43` §5.7 长跑任务监控台"如批量推演"）。

---

## 2. 触发与规划入口

1. 作者自然语言表达批量/推演意图（"把第 3-10 章初稿都生成出来" / "推演这条线后续走向"）。
2. Planner 在 DialogueFrame 判定需要长跑（高预算、多单元），产出 `MicroPlan`，其中包含 **long-run task plan**
   引用（`02` §3.1 列举的 MicroPlan 非自身承载项之一）。
3. **预算闸**：高成本 / 长跑 / 批量工具在执行前由 Budget Meter 估算，触发 `CONFIRMATION_REQUIRED`
   （`00d-runtime-architecture.md` §"Budget Meter：高成本 LLM / 长跑 / 批量工具 → 触发 confirmation / checkpoint"）。
4. 作者确认后，Execution Orchestrator 放行，任务进入 `RUNNING`（`04-execution-orchestrator.md` 唯一门禁；
   `ADR-0005` Gate Order）。

> 边界：Planner 只**建议**长跑；批准长跑、预算、写入仍属 Execution Orchestrator（`01` §3.6）。

---

## 3. 生命周期（TaskPhase 11 态，ADR-0002 §4）

冻结点：`schemas/foundation/enums/task_phase.json` → `NovelFoundation.Enums.TaskPhase`。

```text
PLANNED → ESTIMATED → CONFIRMATION_REQUIRED → CONFIRMED → RUNNING ⇄ CHECKPOINT
                                                              │
                                              RESUMING ───────┘（断线/失败后从检查点恢复）
RUNNING/CHECKPOINT/RESUMING → COMPLETED | CANCELLED | FAILED | BRANCHED
```

| 阶段 | 含义 |
|---|---|
| `PLANNED` | 已规划，未估算 |
| `ESTIMATED` | 已估算预算 |
| `CONFIRMATION_REQUIRED` | 高预算需作者确认 |
| `CONFIRMED` | 作者已确认，待放行 |
| `RUNNING` | 后台执行中 |
| `CHECKPOINT` | 已落检查点（可恢复点） |
| `RESUMING` | 从检查点恢复中 |
| `COMPLETED` | 全部单元完成 |
| `CANCELLED` | 作者取消（`05` §取消等待态/长跑） |
| `FAILED` | 执行失败（带 `failure_ref`） |
| `BRANCHED` | 派生新任务（带 `branch_parent_ref`） |

`phase` 与运行 `status` 的映射由 `ADR-0002 §4` 收束；`status` 取 `NovelFoundation.Enums.Status`。

---

## 4. 处理模型：逐单元 + artifact 累积

长跑任务**逐单元**推进（单元 = 一章 / 一场 / 一个推演步）：

- `current_unit_ref`：当前正在处理的单元。
- `completed_unit_refs`：已完成单元（推进进度的事实来源）。
- 每完成一个单元 → 产 **tentative artifact** → 进 `pending_artifact_refs`。
- 作者采纳后 → 进 `accepted_artifact_refs`（经采纳边界，§8）。
- `checkpoint_policy_ref` 决定何时落 `CHECKPOINT`（如每单元 / 每 N 单元）。

进度 = `length(completed_unit_refs) / 计划单元数`；这正是工作台任务条 RUNNING→CHECKPOINT 实时更新的依据（§6）。

---

## 5. Task 最小模型（24 字段）

冻结点：`apps/novel_persistence/lib/novel_persistence/schemas/long_run_task.ex`（本节是其权威设计出处，
取代旧 `06-planning-and-long-run.md §5` 引用）。

| 分组 | 字段 | 说明 |
|---|---|---|
| 身份 | `id` / `workspace_id` / `task_type` / `status` / `phase` / `goal` | 任务标识、归属、类型、运行状态、生命周期阶段、目标 |
| 范围与来源 | `scope_ref` / `created_by` / `parent_turn_ref` / `parent_task_ref` | 作用域、发起者、来源 turn、父任务（派生链） |
| 规划 | `plan_ref` / `checkpoint_policy_ref` | 关联计划、检查点策略 |
| 预算 | `estimated_budget` / `consumed_budget` | 估算与已耗预算（§9） |
| 权限 | `authority_scope` | 授权范围（`ADR-0003`） |
| 执行跟踪 | `current_unit_ref` / `completed_unit_refs` | 当前/已完成单元（进度事实源，§4） |
| 产物跟踪 | `pending_artifact_refs` / `accepted_artifact_refs` | 待采纳 / 已采纳产物（§8） |
| 风险与恢复 | `warning_refs` / `failure_ref` / `resume_ref` / `branch_parent_ref` | 警告、失败、恢复点、派生父 |
| 检查点 | `checkpoint_data` / `completed_at` | 检查点快照、完成时间 |

---

## 6. 作者体验（task_state，AU-10 SC-AU10-D2）

- 长任务运行时，工作台顶部任务条 / 状态从 `RUNNING → CHECKPOINT → COMPLETED / FAILED` **实时变化**，
  且**不阻塞**作者继续对话（AU-10 SC-AU10-D2 / AU10-I5：真实入口必须消费 `task_state`）。
- 不变量：后台已 `RUNNING` 时不得显示"待机"（AU-10 §不变量）。
- 长跑产物监控台见 `ui/43-structure-panel.md` §5.7。
- 取消：作者可取消等待态 / 长跑任务（`05` §取消；`02` `cancel_task_or_behavior`）。

实现侧：`WorkspaceChannel` 广播 `"task_state"`（RUNNING/CHECKPOINT/COMPLETED/FAILED）；前端
`workspaceRuntimeState.deriveTaskState` 消费。导出动作的同步 task_state 生命周期已闭环
（`AU10-workbench-recovery-taskstate`）。

---

## 7. 恢复与检查点

- `CHECKPOINT` 落 `checkpoint_data` + `completed_unit_refs`；断线 / 进程重启 / 失败后由
  `TaskRunner.resume/1` → `RESUMING` → 从最近检查点继续未完成单元，不重跑已完成单元。
- 与 AU-10 recovery 的关系：provider 失败 / WebSocket 断线 / timeout / 取消等待已分别由
  `au10-workbench-recovery-*` 覆盖**单轮**恢复；**长跑任务跨多单元的 streaming 进度 + 断点续跑**
  是 AU-10 recovery 的后续 checkpoint（依赖本文落地 + §10 的真实消费者）。

---

## 8. 与采纳 / 投影边界（不绕过）

长跑产出的 artifact 仍是 **tentative**：

- 进 `pending_artifact_refs`，逐个经采纳边界（`VS-04` / `AdoptionBoundary`）→ accepted → 写作品事实 / 投影。
- 长跑**不自动写 production fact**；高风险单元仍可触发逐单元 confirmation。
- 这与单章主链一致：生成→tentative→采纳→Character/Reading Projection（见 `AU09-character-dossier-roundtrip`、
  `P1-chapter-adoption-reading` 的逐章模式，长跑是其"批量 + 后台 + 检查点"的推广）。

---

## 9. 预算与确认

- 估算入 `estimated_budget`，执行中累加 `consumed_budget`。
- 高预算 → `CONFIRMATION_REQUIRED`（§2.3）；预算耗尽 / 超限 → 触发 checkpoint 或 confirmation
  （`00d` Budget Meter）。
- 预算结构最小形态见 `ADR-0003`。

---

## 10. 当前实现状态与缺口（诚实）

| 件 | 状态 |
|---|---|
| `TaskPhase` 11 态 / `Status` 枚举 | ✅ 冻结（codegen 自 schema json） |
| `long_run_tasks` 24 字段 schema + `LongRunTaskLog`（CRUD/checkpoint/complete/fail/resume/list_active） | ✅ 已实现 |
| `TaskRunner.track/3`（同步动作包生命周期 + task_state 广播） | ✅ 已实现；唯一真实消费者 = 导出 |
| `WorkspaceChannel` `task_state` 广播 + 前端消费 | ✅ 已实现（导出动作闭环） |
| `TaskRunner.start/resume` + `perform_execution/1`（异步后台执行） | ⚠️ **桩**：`perform_execution` 是 `Process.sleep` 占位，**无真实生产消费者**（仅测试调用） |
| **真实长跑触发**（批量生成多章 / 推演的产品入口） | ❌ **缺**：没有产品 UI/intent 真正发起一个逐单元后台任务 |
| 逐单元 streaming 进度 + 断点续跑的端到端 + 外部验收 | ❌ 缺：依赖上面两项先落地 |

**根因结论**：长跑的**生命周期与持久化已冻结/实现**，但**连接性设计**（"哪个 intent 触发、单元如何映射到章/场、
产物如何流回采纳"）此前散落且 schema 引的源文档缺失（已由本文收口）；**且没有真实触发它的产品入口**。

---

## 11. 落地建议（供 slice 规划，非本文冻结）

- 第一个真实消费者宜为 **批量生成多章初稿**：底层单章生成已由 P1 狗粮验证，正好填满本文 §4 的逐单元 +
  §8 的 tentative→采纳模型 + §2 的"批量生成"触发定义。让它作为承重竖切面驱动 `perform_execution` 的真实化，
  同时给 §6 task_state 进度与 §7 检查点恢复一个真实验收目标。
- 在此之前，不应单独实现"完整异步 LongRunner streaming 恢复"——会变成给桩加功能（YAGNI / 承重竖切面禁止
  "只创建未来会用的模块"）。
- **决策（用户 2026-06-17）**：批量生成在当前阶段价值不高，**先把产品功能广度铺起来，再回来做长跑/批量生成**。
  本文已把设计收口冻结，待广度就绪后按 §11 起承重竖切面，无需重新分析。

---

## 12. 来源与冻结点

| 来源 | 贡献 |
|---|---|
| `ADR-0002 §4` | TaskPhase 11 态与 status 映射（冻结） |
| `apps/novel_persistence/.../schemas/long_run_task.ex` | 24 字段持久化（实现） |
| `05-turn-behavior-and-state-model.md` | 后台任务等待态、取消长跑、workstream |
| `02-dialogue-frame-and-micro-plan.md` §3 | MicroPlan ≠ long-run task plan |
| `04-execution-orchestrator.md` / `ADR-0005` | 执行门禁、Gate Order |
| `00d-runtime-architecture.md` | Budget Meter 触发 confirmation/checkpoint |
| `ui/45 / 47 / 43` | 触发意图、文案、长跑监控台 |
| `acceptance/author/AU-10-workbench-ui.md` SC-AU10-D2 / AU10-I5 | 作者 task_state 实时进度验收 |
