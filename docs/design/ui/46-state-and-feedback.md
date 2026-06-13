# 46 State and Feedback

> 状态：草案
>
> 角色：定义工作台和长跑任务的各级反馈状态来源及表现要求。

---

## 1. 语义来源

本文所处理的状态及反馈信息投影自：

- `../05-turn-behavior-and-state-model.md`：核心交互轮次、等待作者状态与恢复路径。
- `../07-workbench-ui-contract.md`：TurnResultViewModel、`ui_cards`、`available_actions`、projection hints。
- `../contracts/VS-03-behavior-lifecycle-contract-pack.md`：clarification / confirmation / recovery lifecycle。
- `../contracts/VS-05-ui-roundtrip-contract-pack.md`：当前 UI card type 与 action roundtrip 边界。
- `../quality/31-novel-quality-gates.md`：质量检查状态投影。
- `../quality/32-human-approval-policy.md`：审批与人工确认策略。

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

- **Candidate Presented (候选待选择)**：候选方向或暂态产物生成完毕，使用 `candidate_set` 展示；是否产生采纳由后端 adoption boundary 裁决。
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

- **Budget Warning (预算预警)**：当达到 budget guard 阈值时，触发 `confirmation_request`、`recovery_prompt` 或顶部提示，明确指出剩余可用 budget 份额。
- **Quality Warning (质量预警)**：当触发 Quality Finding 时：
  - 若为致命级：直接进入 Checkpoint 或失败。
  - 若为普通警告：以 `recovery_prompt`、`trace_summary` 或 `confirmation_request` 列出影响范围（例如“第二卷的时间线可能与第三章矛盾”），并提供可选的修正操作入口。

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
| Loading / Thinking | turn phase / status in TurnResultViewModel | none | 不得伪造 running task |
| Streaming | streaming event + current turn ref | none / `cancel_behavior`（若 available action 明确提供） | 不得把 partial text 当 accepted artifact |
| Waiting User - Clarification | active behavior clarification + `primary_next_action=answer_clarification` | `answer_clarification`, `revise_candidate`, `cancel_behavior` | 不得绕过 required slot 执行；也不得把 clarification 简化为必填表单 |
| Waiting User - Confirmation | active behavior confirmation + `primary_next_action=confirm_before_execute` | `confirm_before_execute`, `cancel_behavior` | 不得用 adoption 文案表达方向确认 |
| Candidate Presented | `candidate_set` card + candidate available actions | `choose_candidate`, `revise_candidate`, `continue_dialogue` | 不得显示为 authoritative；不得把选择当作采纳 |
| Checkpoint / Recovery | task state / `recovery_prompt` card | `retry_action`, `narrow_scope`, `continue_dialogue`, `cancel_behavior` | 不得在纯 running 中直接分叉 |
| Failed / Retry | turn/task status error 或 projection status failed | `retry_action`, `narrow_scope`, `continue_dialogue` | 不得静默回退成 completed |
| Resumed | task resumes into running through new TurnResultViewModel | none | 不得当作新 task |
| Completed | completed TurnResultViewModel | `open_trace_summary`（若 available action 明确提供） | 不得继续显示 blocking action |
| Budget Warning | budget guard decision / policy summary | `confirm_before_execute`, `cancel_behavior`, `narrow_scope`（按 available action） | 不得只用颜色警示 |
| Quality Warning | `quality_finding.severity` + policy decision | `revise_candidate`, `retry_action`, `narrow_scope`, `confirm_before_execute`（按 available action） | 不得把 `quality_finding.action` 当 `primary_next_action` |
| Projection Stale | `reading_projection_root.status=STALE` | 触发 `intent.REFRESH_READING_PROJECTION` 的入口 | 不得让 UI 自己比较字段猜 stale |

所有状态都必须有中文文案解释，不能只依赖颜色、图标或英文枚举。

Clarification 等待态还必须解释“为什么需要这一步”，并在作者可能不知道答案时提供候选方向或编辑建议。例如：立项、新卷、新章规划不应只提示“请填写核心目标”，而应说明系统可基于上下文先给几种推进方向供作者选择。
