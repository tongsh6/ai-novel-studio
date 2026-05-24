# NEXT / 当前推进队列

> 最后更新：2026-05-24
>
> 角色：本文件是 AI 和人类维护者选择下一项工作的唯一入口。台账记录事实，acceptance 记录验收口径，用户旅行图记录连续体验；本文件把它们压缩成当前可执行队列。

---

## 1. Current Focus

**P1 10 万字最小长篇闭环：单章正文草稿生成**

AU-02 / AU-05 候选方向到采纳边界已闭环；P1 章节计划最小闭环也已闭环：真实 Tauri 工作台可从作品档案“大纲与结构”生成 12 章章节计划，采纳后通过作品档案章节计划视图读取，且不污染 Reading Projection。下一阶段沿 Journey D 继续推进，把已采纳章节计划作为输入，生成第一章正文草稿。

## 2. Why This Focus

P1 的最终目标不是一次性生成 10 万字，而是让真实工作台具备可审计的长篇生产链路。章节计划现在已经成为可采纳、可持久化、可消费的作品档案对象；最高杠杆缺口转为“按章节计划生成正文草稿”。如果正文仍只是聊天文本，后续正文采纳、阅读投影、字数统计和导出都无法建立真实产品主链。

已闭环的最近 checkpoint：

| Checkpoint | 状态 | 证据 |
|---|---|---|
| AU03 long session compression | closed | `artifacts/slice-verify/au03-long-session-compression-tauri-lmstudio/summary.json` |
| AU03 current work context SSOT | closed | `artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json` |
| AU03 archive session filter | closed | `artifacts/slice-verify/au03-archive-session-filter-tauri/summary.json` |
| AU03 branch from history | closed | `artifacts/slice-verify/au03-branch-from-history-tauri/summary.json` |
| AU03 active session resume | closed | `artifacts/slice-verify/au03c-work-session-resume-tauri/summary.json` |
| AU03 context source UI | closed | `artifacts/slice-verify/au03-context-source-ui-tauri/summary.json` |
| AU02 candidate adoption bridge | closed | `artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json` |
| AU05 high-risk adoption confirmation | closed | `artifacts/slice-verify/au05-adoption-safety-freshness-tauri/summary.json` |
| AU05 stale restored candidate rejection | checkpoint closed | `artifacts/slice-verify/au05-stale-conflict-cross-work-freshness-tauri/summary.json` |
| AU05 cross-work candidate recovery failure | checkpoint closed | `artifacts/slice-verify/au05-conflict-cross-work-recovery-tauri/summary.json` |
| AU05 canon conflict recovery failure | checkpoint closed | `artifacts/slice-verify/au05-canon-conflict-recovery-tauri/summary.json` |
| P1 chapter plan minimum | checkpoint closed | `artifacts/slice-verify/p1-chapter-plan-minimum-tauri/summary.json` |

## 3. Active Journey

来源：`docs/product/user-journeys.md` 的 Journey D；`docs/product/novel-output-milestones.md` 的 P1。

```text
作者输入长篇创作目标
→ AI 生成章节计划草稿
→ 草稿以待采纳 artifact/card 展示
→ 作者明确采纳
→ adoption boundary 裁决
→ 章节计划进入可消费作品事实或章节计划视图
→ 作者基于章节计划生成单章正文草稿
→ 后续正文生成、字数统计、阅读和导出以该计划为路线图
```

当前断点：**P1 单章正文草稿生成**。

## 4. Queue

除非出现阻塞 P0 bug，下一次功能推进必须从队首开始。

| Order | Task ID | Status | Blocked By | Why Next | Proof Target |
|---:|---|---|---|---|---|
| 1 | AU03-branch-from-history | done | - | 真实工作台已提供“从这里继续”入口，可创建并切换到新 active session，保留 `source_session_ref/source_turn_ref`。 | `artifacts/slice-verify/au03-branch-from-history-tauri/summary.json` |
| 2 | AU03-archive-session-filter | done | - | 真实工作台已提供历史会话归档入口；默认列表隐藏 archived，会话搜索仍可找回并只读打开；普通 context 默认排除 archived transcript。 | `artifacts/slice-verify/au03-archive-session-filter-tauri/summary.json` |
| 3 | AU03-current-work-context-ssot | done | - | 多会话下必须证明最新 Work 背景与 session transcript 分层，不能用旧会话覆盖当前作品事实。 | `artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json` |
| 4 | AU03-long-session-compression | done | - | 超过窗口的旧 turn 已进入 `work_sessions.summary`，最新 transcript 窗口保留自然顺序并进入 Planner prompt。 | `artifacts/slice-verify/au03-long-session-compression-tauri-lmstudio/summary.json` |
| 5 | AU03-context-source-ui | done | - | 作者能看到“AI 参考了什么”，把 AU-03 与 AU-07 author-safe trace 连接起来。 | `artifacts/slice-verify/au03-context-source-ui-tauri/summary.json` |
| 6 | AU02-candidate-adoption-bridge | done | - | 候选方向不能停在“继续探索”，也不能被前端直接写成事实；明确采纳必须经过 AU-05 adoption boundary。 | `artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json` |
| 7 | AU05-adoption-safety-freshness | checkpoint closed | - | 高风险候选不能静默采纳，必须进入 confirmation。 | `artifacts/slice-verify/au05-adoption-safety-freshness-tauri/summary.json` |
| 8 | AU05-stale-conflict-cross-work-freshness | checkpoint closed | - | 高风险 confirmation 后，优先证明恢复出的 stale candidate 不能静默采纳。 | `artifacts/slice-verify/au05-stale-conflict-cross-work-freshness-tauri/summary.json`；真实工作台恢复旧候选、点击“采用这个方向”，服务端返回 `reject`，UI 显示拒绝原因且 `production_write_performed=false`。 |
| 9 | AU05-conflict-cross-work-recovery | checkpoint closed | - | stale source 后，优先证明跨作品 action 不能静默采纳到当前作品。 | `artifacts/slice-verify/au05-conflict-cross-work-recovery-tauri/summary.json`；真实工作台恢复其它作品候选、点击“采用这个方向”，服务端返回 `fail_with_recovery`，UI 显示失败原因且 `production_write_performed=false`。 |
| 10 | AU05-canon-conflict-recovery | checkpoint closed | - | 与当前 canon/revision 冲突的候选不能静默采纳，必须进入恢复失败或后续覆盖确认。 | `artifacts/slice-verify/au05-canon-conflict-recovery-tauri/summary.json`；真实工作台触发 canon conflict 采纳，服务端返回 `fail_with_recovery`，UI 显示失败原因且不写 production fact。 |
| 11 | P1-chapter-plan-minimum | done | - | P1 10 万字最小长篇闭环需要先有可采纳、可追踪、可消费的章节计划；否则后续逐章正文、有效字数统计、阅读投影和导出都没有稳定路线图。 | `artifacts/slice-verify/p1-chapter-plan-minimum-tauri/summary.json`；Tauri：真实工作台生成并采纳 12 章章节计划，作品档案可读取，未采纳计划不进入作品事实。 |
| 12 | P1-chapter-draft-generation | next | - | 已采纳章节计划必须成为正文生产输入；下一步证明单章正文草稿从计划生成，且未采纳正文不进入阅读模式或正文有效字数。 | `tasks/slices/P1-chapter-draft-generation.md`；Tauri：真实工作台基于已采纳章节计划生成单章正文草稿，正文草稿以 tentative artifact 展示。 |

## 5. Selection Rule

1. 默认只能取 `Queue` 中第一个 `Status=next` 的任务。
2. 如果遇到 P0 bug，可以临时插队，但必须在本文件 `Decision Log` 写明 bug、影响范围和为什么高于队首任务。
3. 如果队首任务无法闭环，不能跳到别的 AU/SU；必须先把 blocker 写进该任务的 `Blocked By`，再选择同一 journey 内最小可闭环 checkpoint。
4. 完成任务后必须更新：
   - 本文件的 `Queue` 和 `Decision Log`
   - `docs/product/user-journeys.md` 对应 journey step 状态
   - `docs/project-ledger.md` 的事实与证据

## 6. Decision Log

| Date | Decision | Why |
|---|---|---|
| 2026-05-21 | 建立 `tasks/NEXT.md` 作为唯一任务入口，当前 focus 锁定 AU-03。 | 解决 AI 每轮从台账随机挑任务的问题，把推进方式从“能闭环就做”改成“沿当前用户旅行图连续推进”。 |
| 2026-05-21 | 对账 `user-journeys.md` 与实际代码后，保持队首为 `AU03-branch-from-history`。 | `WorkSessionService.create/2` 和 `WorkSessionsController.create/2` 已提供 source refs 的 API 局部能力，但 `frontend/src/lib/sessions.ts` / `WorkspaceChat` 没有 create session helper 或“从这里继续”入口，且无 `au03-branch-from-history` Tauri 证据。 |
| 2026-05-21 | `AU03-branch-from-history` 已闭环，队首推进到 `AU03-archive-session-filter`。 | 原生 Tauri 证据证明真实工作台从历史 transcript 点击继续后创建新 active session，并保留旧会话/旧 turn 来源引用，旧 transcript 未复制到新 session。 |
| 2026-05-21 | `AU03-archive-session-filter` 已闭环，队首推进到 `AU03-current-work-context-ssot`。 | 原生 Tauri 证据证明真实工作台可归档历史会话、默认列表隐藏、显式搜索仍可找回并只读打开；persistence/application 测试证明普通 context 默认排除 archived session transcript。 |
| 2026-05-21 | `AU03-current-work-context-ssot` 已闭环，队首推进到 `AU03-long-session-compression`。 | 原生 Tauri + LMStudio 证据证明真实工作台先打开历史只读 transcript、返回 active session 后发送下一轮，Planner prompt 使用最新 Work 背景 + 当前 active session transcript，旧历史 session transcript 未覆盖当前作品事实。 |
| 2026-05-21 | `AU03-long-session-compression` 已闭环，队首推进到 `AU03-context-source-ui`。 | Persistence/Application 测试与原生 Tauri + LMStudio 证据证明超过窗口的旧 turn 进入 session summary，Planner request messages 只保留 early summary + 最新 transcript 窗口，未把旧 turn 原文塞入 prompt。 |
| 2026-05-24 | `AU03-context-source-ui` 已闭环，当前 focus 从 AU-03 转入 AU-02/AU-05 候选采纳桥接。 | 原生 Tauri 外部 UI driver 证明普通回复 why 面板显示 current work / recent dialogue / memory 三类 author-safe 来源摘要，且不暴露 raw prompt；Journey B 当前连续前缀已闭环到 B11，下一最高杠杆断点是 C6/F 的 selection/adoption 边界。 |
| 2026-05-24 | `AU02-candidate-adoption-bridge` 已闭环，队首推进到 `AU05-adoption-safety-freshness`。 | 原生 Tauri 外部 UI driver 证明真实工作台先点击候选继续探索，再点击服务端授权的“采用这个方向”，`author_action.choose_candidate` 进入 `AdoptionBoundary` 并返回 `adopt_tentative`；下一风险是高风险、stale、conflict、cross-work 采纳安全。 |
| 2026-05-24 | `AU05-adoption-safety-freshness` 的高风险 confirmation checkpoint 已闭环，队首推进到 stale / conflict / cross-work freshness。 | 原生 Tauri 外部 UI driver 证明真实工作台输入高风险候选并点击“采用这个方向”后，服务端授权 `choose_candidate` 进入 `AdoptionBoundary`，返回 `require_confirmation` / `needs_confirmation`，UI 显示“候选方向待确认”，`candidate_adopted=false` 且 `production_write_performed=false`。Application 回归已覆盖 cross-work rejection，但真实 UI 场景仍需后续闭环。 |
| 2026-05-24 | `AU05-stale-conflict-cross-work-freshness` 的 stale restored candidate checkpoint 已闭环，队首推进到 conflict / cross-work recovery。 | 原生 Tauri 外部 UI driver 证明真实工作台从持久化 transcript 恢复出 stale candidate 后，作者点击“采用这个方向”，服务端授权 `choose_candidate` 经 `AdoptionBoundary` 返回 `reject`，UI 显示“候选方向未采用”，`candidate_adopted=false` 且 `production_write_performed=false`。剩余 canon conflict 与跨作品旧 action 仍需真实 UI 验收。 |
| 2026-05-24 | `AU05-conflict-cross-work-recovery` 的 cross-work checkpoint 已闭环，队首推进到 canon conflict recovery。 | 原生 Tauri 外部 UI driver 证明真实工作台从当前作品 transcript 恢复出其它作品来源候选后，作者点击“采用这个方向”，服务端授权 `choose_candidate` 经 `AdoptionBoundary` 返回 `fail_with_recovery`，UI 显示“候选方向采用失败”，`candidate_adopted=false` 且 `production_write_performed=false`。剩余 canon/revision conflict 仍需真实 UI 验收。 |
| 2026-05-24 | `AU05-canon-conflict-recovery` 的 canon conflict checkpoint 已闭环，队首推进到 `P1-chapter-plan-minimum`。 | 原生 Tauri 外部 UI driver 证明真实工作台恢复出带结构化 `canon_conflicts` 的“年龄设定覆盖”候选后，作者点击“采用这个方向”，服务端授权 `choose_candidate` 经 `AdoptionBoundary` 返回 `fail_with_recovery`，reason_codes 包含 `canon_conflict_detected` / `conflict_recovery_required`，UI 显示“候选方向采用失败”，`candidate_adopted=false` 且 `production_write_performed=false`。下一步按 `docs/product/novel-output-milestones.md` 转向 P1 长篇产出主链的章节计划最小闭环。 |
| 2026-05-24 | `P1-chapter-plan-minimum` 已闭环，队首推进到 `P1-chapter-draft-generation`。 | 原生 Tauri 外部 UI driver 证明真实工作台从作品档案“大纲与结构”点击“开始规划”，发送带 micro plan 的章节大纲请求，`plot_outline` 生成 12 章 `outline_draft`，作者点击真实“采纳”后经 `AdoptionBoundary` 持久化为作品档案章节计划；`outline_draft` 不 materialize Reading Projection，作品档案 `get_chapter_plans` 可读取并显示首章和终章标题。 |
