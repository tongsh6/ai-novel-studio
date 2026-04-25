# UI Design Freeze Review v2

> 状态：冻结前评审记录
>
> 角色：记录 `ui-design/` 本轮 UI 文档、Pencil 原型、PNG 导出物与追溯材料的冻结前检查结果。
>
> Source of truth：`novel-studio-v2.pen`

---

## 1. 评审结论

本轮 UI 设计已达到 **可进入冻结评审** 状态，但尚不直接标记为最终冻结。

当前可以作为评审依据的材料包括：

1. `40-ui-overview.md` 到 `47-ui-copy-guidelines.md`
2. `novel-studio-v2.pen`
3. `exports/png/` 下的 8 张最小 screen PNG
4. `traceability/screen-to-doc-map.md`

本轮不把 PDF 评审包作为冻结条件；原因见 §6。

---

## 2. 已覆盖的最小 screen

| Screen | 原型 ID | PNG 导出 | 冻结前状态 |
| --- | --- | --- | --- |
| `41§3-main-workbench` | ZOwOi | `exports/png/ZOwOi.png` | 已修订：结构入口默认折叠 |
| `42§4-adoption-card-states` | PZAVY | `exports/png/PZAVY.png` | 已修订：采纳 / 废弃 / 修改文案对齐 |
| `43§5-structure-panel-expanded` | ATnmR | `exports/png/ATnmR.png` | 已修订：frame 已启用，可导出 |
| `44§3-reading-mode-stale` | hEGz0 | `exports/png/hEGz0.png` | 已导出：阅读态与 stale 提示可见 |
| `45§2-work-seed-guided-flow` | 6NI2I | `exports/png/6NI2I.png` | 已导出：立项引导流可见 |
| `45§3-new-volume-chapter-flow` | sEYft | `exports/png/sEYft.png` | 已导出：新卷 / 新章规划流可见 |
| `45§4-long-run-confirmation` | NJnuz | `exports/png/NJnuz.png` | 已修订：confirmation card 语义对齐 |
| `46§6-checkpoint-feedback` | feymL | `exports/png/feymL.png` | 已修订：checkpoint 文案本地化 |

---

## 3. 本轮关键修订记录

### 3.1 Structure Panel 默认隐藏

`41§3-main-workbench` 及 Workbench 派生流程页已从完整右侧结构面板改为窄栏入口。

设计意图：

- 默认首屏仍以对话和卡片为视觉中心。
- 结构能力作为“作品档案”入口存在，但不压迫创作流。
- 完整结构面板只在 `43§5-structure-panel-expanded` 中展示。

### 3.2 Structure Panel 展开态修复

`43§5-structure-panel-expanded` 对应 frame 已启用，并已成功导出 `exports/png/ATnmR.png`。

### 3.3 Confirmation / Adoption / Checkpoint 语义分离

已完成以下修订：

- `45§4-long-run-confirmation` 使用 confirmation card 语义。
- `46§6-checkpoint-feedback` 保留 checkpoint 语义。
- `42§4-adoption-card-states` 使用“废弃候选 / 提出修改 / 采纳设定”等面向作者的中文动作文案。
- 普通作者界面不再直接暴露内部英文枚举、英文状态组合或半英文风险等级表达。

---

## 4. 冻结前验收检查

| 检查项 | 当前结果 | 说明 |
| --- | --- | --- |
| `40`-`47` UI 文档存在 | 通过 | 文档已齐备 |
| `.pen` 覆盖最小 8 个 screen | 通过 | 见 §2 |
| 8 个 screen 均有 PNG 导出 | 通过 | 见 `exports/png/README.md` |
| screen 能回链到文档和 ADR | 通过 | 见 `traceability/screen-to-doc-map.md` |
| Structure Panel 默认隐藏 | 通过 | 默认态改为窄栏入口 |
| Reading Mode 不混入 tentative | 通过 | `44§3-reading-mode-stale` 仍为 accepted projection 消费面 |
| Confirmation / Adoption / Checkpoint 可区分 | 通过 | 已修订卡片命名与可见文案 |
| 原型无布局裁剪问题 | 通过 | `pencil_snapshot_layout` 复核无问题 |
| PDF 评审包 | 暂缓 | Pencil MCP PDF 批量导出超时；PNG 为本轮评审依据 |

---

## 5. 仍需人工确认的问题

冻结前建议人工查看 `exports/png/` 下 8 张图，重点确认：

1. 默认工作台是否足够“对话优先”。
2. 结构窄栏是否既可发现又不压迫主区。
3. 采纳、确认、暂停三类卡片是否一眼能区分。
4. 中文文案是否像可靠的网文编辑搭档，而不是后台系统提示。
5. 阅读模式是否足够干净，且 stale 提示不破坏阅读体验。

---

## 6. Deferred / 暂缓项

### 6.1 PDF 评审包

当前 Pencil MCP 在批量 PDF 导出时超时。本轮不以 PDF 作为冻结条件，改以 8 张 PNG 作为静态评审依据。

后续如果导出链路恢复，可补充：

```text
exports/pdf/novel-studio-v2-review.pdf
```

### 6.2 更强视觉 polish

当前原型已满足语义与交付评审，但如果目标升级为外部展示稿，建议另起一轮视觉 polish：

- 强化标题字体和阅读排版。
- 提升卡片主次层级。
- 增加更明确的 editorial cockpit 记忆点。
- 优化长时间创作场景下的视觉舒适度。

---

## 7. 冻结建议

若人工评审确认 §5 无阻塞问题，则可以将本目录状态推进为：

```text
UI 功能设计冻结 / 视觉 polish 可后续迭代
```

进入前端实现阶段时，应以以下材料作为输入边界：

1. `40-ui-overview.md` 到 `47-ui-copy-guidelines.md`
2. `novel-studio-v2.pen`
3. `exports/png/` 8 张 PNG
4. `traceability/screen-to-doc-map.md`

任何新增 intent、状态、card type、action type 或对象语义，仍必须回到 ADR 流程，不能由 UI 实现阶段直接补造。
