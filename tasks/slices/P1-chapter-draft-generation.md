# P1 Chapter Draft Generation / 10 万字最小长篇单章正文草稿

- 状态：done
- 类型：Product Slice / Novel Output Milestone P1
- 来源：`docs/product/novel-output-milestones.md` §6-§7；`docs/product/user-journeys.md` Journey D7；`tasks/slices/P1-chapter-plan-minimum.md`
- 当前目标：从已采纳章节计划中选择一个章节目标，生成一章正文草稿，并证明正文草稿仍是 tentative，后续必须经过采纳边界才进入阅读投影。

---

## 1. 产品目标

P1 的下一步不是继续扩章节计划，而是让章节计划成为正文生产的真实输入。作者应能基于已采纳章节计划生成单章正文草稿；正文草稿必须区别于设定、大纲和聊天建议，后续字数统计只能统计正文有效字数。

---

## 2. 开工检查

- Contract: 已采纳章节计划读模型、正文草稿 `TentativeArtifactSet`、`AdoptionDecision`、Reading Projection materialization policy。
- Invariant: 未采纳正文不得进入阅读模式或正文有效字数；章节计划只能作为生成输入，不等于正文。
- Boundary: 预期切过 `novel_application`、`novel_persistence`、`novel_web` Channel、真实 Tauri 工作台；不应让前端自行拼正文或绕过 adoption boundary。
- Consumer: 真实工作台正文草稿卡、采纳入口、后续阅读模式和字数统计。
- Proof: application/persistence/channel 回归 + 外部 Tauri 自动化；真实 UI 证明作者从已采纳章节计划生成单章正文草稿。
- Acceptance Driver: 扩展 `bash scripts/tauri_slice_verify.sh p1-chapter-draft-generation`，由外部 Playwright 操作真实页面，不新增产品验收 hook。

---

## 3. 最小闭环候选

```text
已有已采纳 P1 章节计划
→ 作者选择或请求生成第 1 章正文
→ AI 读取章节计划目标并生成正文草稿
→ 正文草稿以待采纳 artifact/card 展示
→ 未采纳正文不进入阅读模式和正文字数统计
→ 外部验收记录章节计划输入、正文草稿长度、artifact type、work/session scope 和 trace
```

---

## 4. 非目标

- 不要求本 checkpoint 直接达到单章 1000 字下限；若无法一次达标，必须把缺口记录到后续 `P1-word-count-audit` 或正文扩写 checkpoint。
- 不实现全书批量生成。
- 不把大纲、设定、摘要或系统日志计入正文。
- 不降低 P1 最终 10 万字验收标准。

---

## 5. 已闭环范围（2026-05-24）

本 checkpoint 已完成最小产品闭环：

```text
已采纳章节计划
→ 作品档案“大纲与结构”读取章节计划
→ 作者点击第 1 章“生成正文草稿”
→ 工作台发送带 MicroPlan 的真实用户消息
→ application 调用 prose_writing
→ 生成 prose_fragment tentative artifact
→ UI 展示“正文草稿待采纳”采纳卡
→ 阅读模式在采纳前保持空投影
```

关键约束：

- `prose_fragment` 只作为待采纳草稿展示。
- 未点击采纳时，不发送 `adopt` 事件。
- 未采纳正文不会出现在 ReadingMode，也不应进入正文有效字数统计。
- 章节计划是正文生成输入，不被当作正文。

## 6. 验收证据

外部自动化驱动真实 Tauri 页面：

```bash
bash scripts/tauri_slice_verify.sh p1-chapter-draft-generation
```

证据路径：

- `artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json`
- `artifacts/slice-verify/p1-chapter-draft-generation-tauri/app-log.json`
- `artifacts/slice-verify/p1-chapter-draft-generation-tauri/ui-state.json`
- `artifacts/slice-verify/p1-chapter-draft-generation-tauri/ui-frames.json`
- `artifacts/slice-verify/p1-chapter-draft-generation-tauri/p1-chapter-draft-generation-external-ui.png`

局部回归：

- `mix test apps/novel_application/test/novel_application/creative_artifact_test.exs`
- `cd frontend && pnpm test -- slice-verify/native-tauri-verifier.test.mjs`

## 7. 未闭环缺口

- 本 checkpoint 生成的是短正文草稿，尚未达到 P1 单章正文有效字数 ≥1000 的最终口径；后续由正文扩写 / 字数统计 checkpoint 继续补齐。
- 正文采纳后写入作品事实、阅读投影和后续字数统计尚未在本 checkpoint 闭环；下一 checkpoint 为 `P1-chapter-adoption-reading`。
