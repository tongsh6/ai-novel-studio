# P1 Chapter Adoption Reading / 10 万字最小长篇单章正文采纳与阅读

- 状态：next
- 类型：Product Slice / Novel Output Milestone P1
- 来源：`docs/product/novel-output-milestones.md` §6-§7；`docs/product/user-journeys.md` Journey D9；`tasks/slices/P1-chapter-draft-generation.md`
- 当前目标：作者采纳单章正文草稿后，正文进入作品事实和 Reading Projection；阅读模式能从真实 Channel 读取该章正文，未采纳草稿仍不得进入阅读投影。

---

## 1. 产品目标

P1 已证明章节计划能生成待采纳正文草稿。下一步要证明正文草稿不是只停留在聊天卡片里：作者明确采纳后，系统必须通过 adoption boundary 将 `prose_fragment` 写入正式作品事实，并让 ReadingMode 从投影读取该章正文。

---

## 2. 开工检查

- Contract: `prose_fragment` tentative artifact、`AdoptionDecision`、accepted draft / reading projection read model、`ProjectionHint`。
- Invariant: 只有采纳后的正文可以进入 ReadingMode；未采纳正文、章节计划和摘要都不得成为正文事实。
- Boundary: 预期切过 `novel_application`、`novel_persistence`、`novel_web` Channel、真实 Tauri 工作台；不应让前端直接写阅读投影。
- Consumer: ReadingMode 目录和章节正文视图；后续正文有效字数统计。
- Proof: application/persistence/channel 回归 + 外部 Tauri 自动化；真实 UI 证明作者采纳后可阅读正文。
- Acceptance Driver: 扩展 `bash scripts/tauri_slice_verify.sh p1-chapter-adoption-reading`，由外部 Playwright 操作真实页面，不新增产品验收 hook。

---

## 3. 最小闭环候选

```text
已采纳章节计划
→ 作者生成第 1 章正文草稿
→ 正文草稿以 prose_fragment tentative artifact 展示
→ 作者点击采纳
→ adoption boundary 接受并持久化
→ Reading Projection materialized
→ ReadingMode 目录出现第 1 章
→ 点击章节可看到正文
```

---

## 4. 非目标

- 不要求一次完成 10 万字。
- 不要求本 checkpoint 完成章节正文扩写到 1000 字以上；若未达标，必须保留到后续字数统计 / 扩写 checkpoint。
- 不实现全书导出。
- 不绕过 adoption boundary 直接写 projection。
