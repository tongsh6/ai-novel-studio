# Screen to Doc Map

> 状态：功能画板已修订 / PNG 评审包已导出
>
> 角色：在 `novel-studio.pen` 创建 screen 后，记录每个 screen 与 UI 文档、ADR 来源的对应关系。

---

| Screen frame name (ID) | UI 文档章节 | 关键 contract 来源 | 状态 |
| --- | --- | --- | --- |
| `41§3-main-workbench` (ZOwOi) | `docs/design/ui/41-workbench-layout.md` §3 | `43-structure-panel.md` §4 / `07-workbench-ui-contract.md` / VS-05 / `ADR-0015` TurnResultViewModel | ✅ 已修订：档案入口默认折叠；已导出 PNG |
| `42§4-adoption-card-states` (PZAVY) | `docs/design/ui/42-card-system.md` §4 | `07-workbench-ui-contract.md` / VS-04 / VS-05 | ✅ 已修订：候选选择 / 修改 / 继续讨论文案对齐；已导出 PNG |
| `43§5-structure-panel-expanded` (ATnmR) | `docs/design/ui/43-structure-panel.md` §5 | `domain/34-novel-element-field-priority.md` / VS-04 | ✅ 已修订：frame 已启用；已导出 PNG |
| `44§3-reading-mode-stale` (hEGz0) | `docs/design/ui/44-reading-mode.md` §3 | `domain/27-reading-projection.md` / `ADR-0016` | ✅ 已导出 PNG |
| `45§2-work-seed-guided-flow` (6NI2I) | `docs/design/ui/45-guided-conversation-flows.md` §4.1 | `domain/24-novel-intent-catalog.md` / `03-capability-toolbox-contract.md` | ✅ 已修订：探索式方向候选已体现；已导出 PNG |
| `45§3-new-volume-chapter-flow` (sEYft) | `docs/design/ui/45-guided-conversation-flows.md` §4.2 | `domain/24-novel-intent-catalog.md` / `05-turn-behavior-and-state-model.md` | ✅ 已修订：探索式推进方向候选已体现；已导出 PNG |
| `45§4-long-run-confirmation` (NJnuz) | `docs/design/ui/45-guided-conversation-flows.md` §4 | `07-workbench-ui-contract.md` / `quality/32-human-approval-policy.md` | ✅ 已修订：confirmation request 语义对齐；已导出 PNG |
| `46§6-checkpoint-feedback` (feymL) | `docs/design/ui/46-state-and-feedback.md` §6 | VS-03 / VS-05 / `quality/31-novel-quality-gates.md` | ✅ 已修订：checkpoint 文案本地化；已导出 PNG |

备注：PDF 批量导出在当前 Pencil MCP 链路中超时，本轮静态评审以 `exports/png/` 的 8 张 PNG 为准。
