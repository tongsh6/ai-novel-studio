# 设计导出文件

> 状态：PNG 评审包已导出

这里存放 `novel-studio.pen` 的静态导出物，以便快速预览设计效果。

## PNG 评审包

当前 screen 已导出到 `png/`：

| 文件 | Screen frame | 用途 |
| --- | --- | --- |
| `png/ZOwOi.png` | `41§3-main-workbench` | 主工作台默认态，结构入口为折叠窄栏 |
| `png/PZAVY.png` | `42§4-adoption-card-states` | 待采纳产物与采纳动作 |
| `png/ATnmR.png` | `43§5-structure-panel-expanded` | 结构面板展开态 |
| `png/hEGz0.png` | `44§3-reading-mode-stale` | 阅读模式与过期投影提示 |
| `png/6NI2I.png` | `45§2-work-seed-guided-flow` | 立项引导流 |
| `png/sEYft.png` | `45§3-new-volume-chapter-flow` | 新卷 / 新章规划流 |
| `png/NJnuz.png` | `45§4-long-run-confirmation` | 长跑启动前确认 |
| `png/feymL.png` | `46§6-checkpoint-feedback` | 长跑暂停 / checkpoint 反馈 |
| `png/xIVE9.png` | `46§7-inline-interaction-states` | 按钮交互后的即时反馈 |
| `png/kg4wN.png` | `46§8-agent-run-dialogue-flow-v4` | 当前 CP5 视觉依据：非卡片式对话流，沿同一 assistant 回复展示理解、依据、计划、执行记录与修订候选 |

备注：`46§8-agent-run-dialogue-flow-v4` 已在当前 Pencil 会话生成并导出 `png/kg4wN.png`，`snapshot_layout(parentId=kg4wN, problemsOnly=true)` 返回 `No layout problems`；`novel-studio.pen` 已出现 Git diff，可与 PNG 一起评审。

## PDF 评审包

PDF 批量导出当前在 Pencil MCP 中超时，暂未作为冻结交付物。评审以 `png/` 下单屏 PNG 为准。
