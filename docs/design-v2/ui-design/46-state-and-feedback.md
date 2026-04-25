# 46 State and Feedback

> 状态：草案
>
> 角色：定义工作台和长跑任务的各级反馈状态来源及表现要求。

---

## 1. 语义来源

本文所处理的状态及反馈信息投影自：

- `../02-turn-and-task-state-machines.md`：核心交互轮次与任务状态机。
- `../03-conversation-behaviors.md`：对话行为模式。
- `../adr/0002-state-enums.md`：统一的状态枚举值。
- `../adr/0003-authority-budget-escalation.md`：预算与权限升级规则。
- `../adr/0012-quality-finding-ui-projection.md`：质量检查状态投影。
- `../adr/0013-approval-policy-record-ui-projection.md`：审批状态投影。

---

## 2. 不负责范围

- 不自造新的运行状态（如自定义一个不在状态机内的 `semi-paused`）。
- 绝不使用仅靠颜色表达状态的 UI 设计（必须有清晰文字标签或图标）。

---

## 3. 基础交互状态

这些属于即时反馈，对应 Turn State Machine。

- **Loading / Thinking**：等待系统处理。展示明确的 Agent 正在思考的提示。
- **Streaming**：结果逐步返回中。文本应当打字机式平滑输出。
- **Waiting User (Clarification/Confirmation required)**：交互挂起，等待用户决策。对话流应当停留在对应的 Card 处，并可能在界面底部输入区给予强提示。

---

## 4. 长跑与产物状态 (Task & Artifact States)

长跑任务和生成产物的状态对应 Task/Artifact State Machine 和 Adoption State。

- **Adoption Pending (待采纳)**：产物生成完毕，等待作者决定。使用 Adoption Card 展现。
- **Checkpoint (中断点)**：任务执行中遇到阈值限制（预算用尽、关键决策点、严重质量警告等）自动暂停。
  - **UI 必须**：在主区域和上下文栏显著提示。
  - 必须提供清晰的 **Checkpoint 原因**（如：预算超支 / 遇到逻辑冲突）。
  - 必须列出正在 pending 的 artifacts。
  - 必须提供清晰的恢复（Resume）、取消（Cancel）或调整（Branch）动作。
- **Failed / Retry (失败/重试)**：
  - 必须区分失败的性质：是需要作者补充信息的 `ask user`？是需要微调指示的 `correction`？是直接废弃的 `discard`？还是系统级的允许原样 `retry`？
- **Resumed / Completed (已恢复/已完成)**：正常结束。

---

## 5. 风险与警告反馈

系统主动暴露的问题，不可忽视。

- **Budget Warning (预算预警)**：当达到警戒线（基于 ADR-0003）时，触发 Warning Card 或顶部提示，明确指出剩余可用 budget 份额。
- **Quality Warning (质量预警)**：当触发 ADR-0012 定义的 Finding 时：
  - 若为致命级：直接进入 Checkpoint 或失败。
  - 若为普通警告：以 Warning Card 形式列出影响范围（例如“第二卷的时间线可能与第三章矛盾”），并提供可选的修正（Correction）操作入口。

---

## 6. 验收标准约束

1. 本文列出的每个状态都已说明来源于哪个底层的 Contract 字段。
2. 约束视觉表现：不能仅靠颜色区分状态（如红绿灯），必须附带文案。
3. 长跑任务的卡片必须显式包含：进度、预算、当前风险及 Checkpoint 原因。
4. 失败状态的处理必须给作者提供明确的下一步分类（重试/修正/废弃/求助）。

---

## 7. 状态来源矩阵

| UI 状态 | canonical 来源字段 | 允许 action | 禁止误用 |
| --- | --- | --- | --- |
| Loading / Thinking | turn phase `RECEIVED` / `ROUTED` 或 status `WAITING_SYSTEM` | none / `dismiss`（只读提示） | 不得伪造 `RUNNING` task |
| Streaming | turn phase `EXECUTING` + streaming event | none / `cancel`（若 task context 允许） | 不得把 partial text 当 accepted artifact |
| Waiting User - Clarification | `behavior_state.active.type=clarification` + `next_action=ASK_USER` | `answer`, `dismiss` | 不得绕过 required slot 执行 |
| Waiting User - Confirmation | `behavior_state.active.type=confirmation` + `next_action=CONFIRM_BEFORE_EXECUTE` | `confirm`, `reject`, `revise`, `dismiss` | 不得用 adoption 文案表达方向确认 |
| Adoption Pending | `adoption_state.pending[]` + artifact lifecycle `TENTATIVE` | `accept`, `edit_then_accept`, `discard`, `branch` | 不得显示为 authoritative |
| Checkpoint | task phase `CHECKPOINT` / status `PAUSED` | `resume`, `cancel`, `branch` | 不得在纯 `RUNNING` 中直接 branch |
| Failed / Retry | turn/task status `ERROR` 或 projection status `FAILED` | `retry`, `revise`, `dismiss` | 不得静默回退成 completed |
| Resumed | task phase `RESUMING` -> `RUNNING` | none / `dismiss` | 不得当作新 task |
| Completed | turn/task status `DONE` | `dismiss`, `open_replay` | 不得继续显示 blocking action |
| Budget Warning | budget guard decision / ADR-0003 threshold | `confirm`, `cancel`, `revise`（按 policy） | 不得只用颜色警示 |
| Quality Warning | `quality_finding.severity` + `quality_finding.action` | 由 ADR-0012 映射：`revise`, `retry`, `confirm`, `accept`, `resume` 等 | 不得把 `quality_finding.action` 当 `NextAction` |
| Projection Stale | `reading_projection_root.status=STALE` | 触发 `intent.REFRESH_READING_PROJECTION` 的入口 | 不得让 UI 自己比较字段猜 stale |

所有状态都必须有中文文案解释，不能只依赖颜色、图标或英文枚举。
