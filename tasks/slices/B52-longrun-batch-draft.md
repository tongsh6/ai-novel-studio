# B52：LongRunner 批量初稿与逐单元恢复（条件触发）

- 状态：**deferred（仅作者重新开放批量初稿需求时启动；当前不排期）**。
- 登记日期：2026-10-27；来源：`04a-planning-and-long-run` 的批量愿景与当前 `TaskRunner` 仅 sleep/checkpoint/complete 的桩实现存在差距，当前真实消费者只有导出。
- 上游：`docs/design/04a-planning-and-long-run.md`、[B39](B39-evidence-seeking-authoring.md)、[UA01-CP5-durable-agent-run-resume](UA01-CP5-durable-agent-run-resume.md)、[P1-word-count-audit](P1-word-count-audit.md)。

## 1. 为什么只登记触发任务

批量多章初稿确实需要 LongRunner 的逐单元执行、checkpoint 和恢复，但当前没有开放的批量生产入口。UA01 durable AgentRun、动态预算、B39 求证和 P1 单章主链都不能替代“批量初稿”这一产品能力，也不能为现有桩补无消费者功能。

只有作者重新开放批量需求时，才应把本任务转为 todo，并先冻结真实用户场景与最小单元范围。

## 2. 启动条件与开工七问

### 启动条件

- 作者明确需要一次生成多章初稿，而非单章/导出任务；
- 单章 P1 主链和恢复已证明可复用；
- 若每单元要求模型求证，先完成 B39/ADR-0030 的通用求证链，不为批量复制固定 packet。

### 七问

1. **Contract**：04a 的 LongRunTask 生命周期、逐单元 artifact、checkpoint/resume、AdoptionBoundary；复用现有 durable，不新造 LongRunner 框架。
2. **Invariant**：逐单元 tentative；跨重启从 checkpoint 继续且不重复已完成单元；未采纳不写 canon；失败/取消有作者可见原因；恢复不重复执行。
3. **Boundary**：application LongRunTask/TaskRunner/逐单元编排、persistence checkpoint、web/frontend 任务状态与档案；单章生成复用现有链，不新 provider runtime。
4. **Consumer**：作者批量生成多章初稿、逐章采纳和任务恢复。
5. **Proof**：多单元后台执行、逐章 task_state、跨重启继续且不重复、逐章 tentative→采纳；外部真实页面证明恢复与零未采纳 canon。
6. **Acceptance Driver**：真实 Tauri 启动批量任务，模拟后台重启并逐章处理；产品验收感知逻辑 **no**，不为验收造批量功能。
7. **Exploration**：每单元输入/输出/版本/状态可查；恢复可区分已完成、待处理和失败单元，不把 pending 当 canon。

## 3. 预计 Checkpoint（启动后细化）

| CP | 范围 | 状态 |
|---|---|---|
| CP0 | 冻结真实批量场景、最小单元数、预算、恢复与取消语义 | deferred |
| CP1 | 逐单元执行与 checkpoint：非桩真实生产、逐章 task_state 与 tentative artifact | deferred |
| CP2 | 跨重启恢复：从最近有效 checkpoint 继续，不重复已完成单元、不重复派发 | deferred |
| CP3 | 逐章采纳、失败/取消/重试与外部真实页面全链；P1 字数/缺章/重复审计复用 | deferred |

## 4. 非目标

- 不因 04a 或 tech-stack 的批量愿景就直接实现，不把 UA01 durable/动态预算当 LongRunner 已完成。
- 不为现有 sleep 桩补无消费者功能，不另造第二 runtime。
- 不把 B39 求证或 P1 单章能力改名为批量完成，也不要求每单元都固定携带整本书。
- 不在本任务提前吞并 P2 500K 里程碑（B53）或 Multi-Agent（B50）。

## 5. 验证与恢复

- 启动前必须有真实批量用户场景与预算，否则保持 deferred。
- 启动后必须证明多单元真实执行、逐章 tentative、跨重启不重复和作者采纳边界。
- 恢复时先读 04a、B39、UA01-CP5 与 P1 审计，确认当前是否已有真实批量消费者，再决定是否启动。
