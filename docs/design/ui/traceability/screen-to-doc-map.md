# Screen to Doc Map

> 状态：功能画板已修订 / PNG 评审包已导出
>
> 角色：在 `novel-studio.pen` 创建 screen 后，记录每个 screen 与 UI 文档、ADR 来源的对应关系。

---

| Screen frame name (ID) | UI 文档章节 | 关键 contract 来源 | 状态 |
| --- | --- | --- | --- |
| `41§3-main-workbench` (ZOwOi) | `docs/design/ui/41-workbench-layout.md` §3 | `43-structure-panel.md` §4 / `07-workbench-ui-contract.md` / VS-05 / `ADR-0015` TurnResultViewModel | ✅ 已修订：用户/AI 双向文本轨道、128px 档案 rail、输入栏与档案 rail 无装饰分隔线；已导出 PNG |
| `41§3.1-candidate-discussion-collapsed` (oFt1j) | `docs/design/ui/41-workbench-layout.md` §4.2 | `07-workbench-ui-contract.md` §8 / AU-02 / VS-05 | ✅ 已新增：候选继续讨论成功后的单行折叠摘要与展开入口；布局检查通过 |
| `42§4-adoption-card-states` (PZAVY) | `docs/design/ui/42-card-system.md` §4 | `07-workbench-ui-contract.md` / VS-04 / VS-05 | ✅ 已修订：候选选择 / 修改 / 继续讨论文案对齐；已导出 PNG |
| `43§5-structure-panel-expanded` (ATnmR) | `docs/design/ui/43-structure-panel.md` §5 | `domain/34-novel-element-field-priority.md` / VS-04 | ✅ 已修订：frame 已启用；已导出 PNG |
| `44§3-reading-mode-stale` (hEGz0) | `docs/design/ui/44-reading-mode.md` §3 | `domain/27-reading-projection.md` / `ADR-0016` | ✅ 已导出 PNG |
| `45§2-work-seed-guided-flow` (6NI2I) | `docs/design/ui/45-guided-conversation-flows.md` §4.1 | `domain/24-novel-intent-catalog.md` / `03-capability-toolbox-contract.md` | ✅ 已修订：探索式方向候选已体现；已导出 PNG |
| `45§3-new-volume-chapter-flow` (sEYft) | `docs/design/ui/45-guided-conversation-flows.md` §4.2 | `domain/24-novel-intent-catalog.md` / `05-turn-behavior-and-state-model.md` | ✅ 已修订：探索式推进方向候选已体现；已导出 PNG |
| `45§4-long-run-confirmation` (NJnuz) | `docs/design/ui/45-guided-conversation-flows.md` §4 | `07-workbench-ui-contract.md` / `quality/32-human-approval-policy.md` | ✅ 已修订：confirmation request 语义对齐；已导出 PNG |
| `46§6-checkpoint-feedback` (feymL) | `docs/design/ui/46-state-and-feedback.md` §6 | VS-03 / VS-05 / `quality/31-novel-quality-gates.md` | ✅ 已修订：checkpoint 文案本地化；已导出 PNG |
| `46§7-inline-interaction-states` (xIVE9) | `docs/design/ui/46-state-and-feedback.md` §7 | `07-workbench-ui-contract.md` / VS-05 AvailableAction roundtrip | ✅ 已修订：按钮交互后的即时反馈；已导出 PNG |
| `46§9-agentic-loop-reasoning-flow` (DM8gx) | `docs/design/ui/46-state-and-feedback.md` §9 + `docs/design/notes/2026-07-01-agentic-loop-reasoning-stream-ui.md` | ADR-0022 Proposed：AgentPlan / plan_revised / author-safe reasoning + JSON tail / explore·act·evaluate | 🧭 UI 先行探索已回填正式章节：叙事措辞归模型、结构骨架归 app（浅色左橙边条=模型逐字输出，标签/状态/版本=app 骨架）；五态：探索中 / 执行中(进度条替代逐片段刷屏) / 受阻等待作者(author actions) / 重规划(v1→v2 hero) / 完成态(计划回顾)，含探索·评估·重规划推理流 + 遥测降级为开发者视图。ADR 仍为 Proposed |
| `46§9.7-agent-run-control-dock` (dxUhh) | `docs/design/ui/46-state-and-feedback.md` §9.7 | UA-01 AgentRun state / `agent_command pause/resume/cancel/steer`；不新增状态或命令 | active run 的状态、控制和调整输入合并为 880px 居中的一体化工作卡；运行中仅「发送调整」为主操作；终止任务独立并二次确认 |

备注：PDF 批量导出在当前 Pencil MCP 链路中超时，本轮静态评审以 `exports/png/` 的单屏 PNG 为准。
