# B11D-QUALITY-FIELD-GRANULARITY：质量场粒度 / 多场正文（待开工，七问待补）

- 状态：**pending（2026-10-24 登记；B13b §4.1 11 项处理后顺序项）**
- 来源：`tasks/NEXT.md` MAINLINE-RESET-2 / MAINLINE-RESET-4 候选清单；B11C（多场正文）与 VS-00E（质量评估）之间的场粒度缺口
- 类型：承重竖切面（多场正文 + 质量评估粒度）

---

## 0. 开工前须知

本 slice 尚未开工。按 `docs/engineering/vertical-slice.md` 与 AGENTS.md 要求，开工前必须先补齐 **七问**（Contract / Invariant / Boundary / Consumer / Proof / Acceptance Driver / Exploration）并做现状侦察：

1. **现状侦察**：当前质量评估（`run_prose_quality`）与修订候选（`prose_revision_from_findings`）是否只按整章/单场粒度；`ArtifactAssembler` / `scene_draft` / 多场计划（`scene_plans`）的场级数据形态；B11C 多场正文落地程度（`p1-chapter-expansion-multichapter` 等场景证据）。
2. **契约**：VS-00E 质量评估契约、VS-00G 事实完整度、ADR-0004（场景/章）与 B11C 多场正文 slice 的场级语义。
3. **作者裁决点**：场级质量评估是否进入采纳边界（场级 candidate vs 章级 candidate）、修订候选粒度、质量 finding 的场 ref 表达；默认按审计建议拍板并登记。
4. **验收载体**：优先扩既有 Tauri 场景（如 `p1-chapter-expansion-multichapter` 或 `p1-chapter-adoption-reading`），或新增多场正文质量场场景；必须真实 Tauri 外部自动化 + 全门禁。

## 1. 参考

- `tasks/slices/B11C-multi-scene-prose.md`（若存在；多场正文现状）
- `tasks/slices/VS-00E-prose-quality.md` / `docs/design/contracts/VS-00E-*`
- `docs/design/acceptance/author/AU-08-reading-mode.md`（阅读投影场粒度）
- `tasks/NEXT.md` B11D 行（本 slice 的队列口径）

## 2. 下一步

下一轮 goal round 从本文件开始：先侦察 + 补七问 + CP0 裁决，再进入实现与真实 Tauri 验收。
