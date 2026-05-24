# P1 Chapter Plan Minimum / 10 万字最小长篇章节计划

- 状态：done
- 类型：Product Slice / Novel Output Milestone P1
- 来源：`docs/product/novel-output-milestones.md` §6-§7；`docs/product/user-journeys.md` Journey D7
- 当前目标：从真实工作台生成并采纳一份可支撑 P1 10 万字最小长篇的章节计划，作为后续逐章正文、字数统计、阅读投影和导出的产品主链起点。

---

## 1. 产品目标

作者输入长篇创作目标后，系统应产出结构化章节计划。章节计划不是一段聊天建议，而是后续正文生成、连续性治理、字数统计和导出的正式路线图；它默认是 tentative，必须经采纳边界后才成为作品事实或章节规划事实。

---

## 2. 开工检查

- Contract: 章节计划 artifact / candidate contract、`TentativeArtifactSet`、`AdoptionDecision`、阅读/章节 projection 的最小引用；如已有 schema/ADR 不足，先补设计文档。
- Invariant: 章节计划必须与作品 work/session/canon 绑定；未采纳计划不能被正文生成、阅读模式或导出当成正式章节目录。
- Boundary: 预期切过 `novel_application`、必要的 `novel_domain` 纯规则、`novel_web` Channel、前端真实工作台；不应让前端自行发明章节结构或绕过 adoption boundary。
- Consumer: 真实工作台的章节计划卡、采纳入口、后续正文生成入口或章节计划只读视图。
- Proof: application/channel 回归 + 外部 Tauri 自动化；真实 UI 证明作者从创作目标得到章节计划并经 adoption boundary 采纳。
- Acceptance Driver: 新增或扩展 `bash scripts/tauri_slice_verify.sh <slice-id>`，由外部 Playwright 操作真实页面，不新增产品验收 hook。

---

## 3. 最小闭环候选

```text
作者输入 P1 长篇创作目标
→ AI 生成 10-20 章最小章节计划草稿
→ 章节计划以待采纳 artifact/card 展示
→ 作者点击真实采纳入口
→ AdoptionBoundary 返回 accepted/tentative decision
→ 章节计划进入作品事实或可查询的章节计划视图
→ UI 明确显示已采纳计划
→ 外部验收记录章节数量、章节标题/目标、work/session scope 和 trace
```

---

## 4. 非目标

- 不要求本 checkpoint 直接产出 10 万字正文。
- 不实现完整导出、全书质量检查或 100 章批量生成。
- 不用旁路脚本直接写章节计划来冒充产品能力。
- 不降低 P1 最终验收标准；本任务只是 P1 主链的第一个最小 checkpoint。

---

## 5. 闭环结果（2026-05-24）

- 真实工作台作品档案的“大纲与结构”空态入口会发起章节规划 MicroPlan。
- `plot_outline` 生成 12 章 `outline_draft` 章节计划，并以 `adoption_card` 展示为待采纳产物。
- 作者点击真实“采纳”后进入 `AdoptionBoundary`，采纳结果持久化为 confirmed `MemoryItem`，标签包含 `outline_draft`。
- `outline_draft` 不进入 Reading Projection；阅读模式仍只消费正文类 artifact。
- 作品档案新增章节计划读取视图，采纳后可显示 12 个章节标题和目标。

证据：

- `artifacts/slice-verify/p1-chapter-plan-minimum-tauri/summary.json`
- `bash scripts/tauri_slice_verify.sh p1-chapter-plan-minimum`
