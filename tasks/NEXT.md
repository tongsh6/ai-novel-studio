# NEXT / 当前推进队列

> 最后更新：2026-06-17
>
> 角色：本文件是 AI 和人类维护者选择下一项工作的唯一入口。台账记录事实，acceptance 记录验收口径，用户旅行图记录连续体验；本文件把它们压缩成当前可执行队列。

---

## 1. Current Focus

**AU10 工作台恢复态与 task_state：VS-00C CP0-CP5 已闭环，当前队首回到 AU10 recovery**

P1 主链已在 2026-06-12 达成 10 万字狗粮里程碑。2026-06-17 `au10-workbench-matrix-layout` baseline 已闭环，但此前把队首推进到 AU10 recovery 过早；用户明确要求先做完 VS-00C 所有 CP 再转下一个任务。VS-00C 现已完成 CP0（缺章 block）、CP1（策略化省略/同源组装）、CP2（已采纳章节摘要窗口，`AssemblyPolicy.summary_window=15`）、CP3（结构化章节条目进入 prose_writing L2）、CP4（章计划方向结构化，E18-E22 进入 L2）、CP5（ReaderEffectBrief + 非权威 self_report）。当前队首恢复到 AU10：补工作台长任务 RUNNING/CHECKPOINT/COMPLETED/FAILED、WebSocket 断线重连、LLM 超时/失败后恢复与 task_state 可见生命周期。

## 2. Why This Focus

P1 的 10 万字狗粮证明了长篇主链可以跑通；VS-00C CP0-CP5 已把“写第 N 章首稿”的上下文质量前置补齐到当前设计要求：CP2 解决“前面已写了什么”，CP3 解决“目标章在计划结构中的位置和摘要”，CP4 解决“目标章承担什么叙事功能和伏笔动作”，CP5 补“希望读者获得什么效果”与非权威自报告质量线索。现在应回到 AU10 recovery，因为工作台是所有作者旅程的主消费者，baseline matrix 仍缺长任务、断线、超时和失败恢复。

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
| P1 chapter draft generation | checkpoint closed | `artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json` |
| AU10 workbench matrix/layout baseline | checkpoint closed | `artifacts/slice-verify/au10-workbench-matrix-layout-tauri/summary.json` |
| VS-00C CP3 structured context | checkpoint closed | `artifacts/slice-verify/vs00c-cp3-structured-context-tauri/summary.json` |
| VS-00C CP4 chapter plan structure | checkpoint closed | `artifacts/slice-verify/vs00c-cp4-chapter-plan-structure-tauri/summary.json` |
| VS-00C CP5 reader effect brief | checkpoint closed | `artifacts/slice-verify/vs00c-cp5-reader-effect-brief-tauri/summary.json` |

## 3. Active Journey

来源：`docs/product/user-journeys.md` Journey J；`docs/design/acceptance/author/AU-10-workbench-ui.md`；`tasks/slices/v3/AU10-workbench-matrix-layout.md`。

```text
作者在真实工作台执行长任务或遇到失败/断线
→ task_state 生命周期可见且不误导
→ WebSocket 断线/重连后恢复当前 work/session/turn 状态
→ LLM 超时或 provider 失败后给出可恢复 UI
→ 旧 action/card 不重复执行，pending/resolved 状态一致
→ 外部 Tauri driver 用真实页面、业务日志和截图验证恢复态
```

当前断点：**AU10-workbench-recovery-taskstate**。

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
| 12 | P1-chapter-draft-generation | done | - | 已采纳章节计划已经成为正文生产输入；真实工作台可从章节计划生成 `prose_fragment` 待采纳正文草稿，且未采纳正文不进入阅读模式。 | `artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json`；Tauri：真实工作台基于已采纳章节计划生成单章正文草稿，正文草稿以 tentative artifact 展示，阅读模式在采纳前为空。 |
| 13 | P1-chapter-adoption-reading | done | - | 作者采纳正文后进入作品事实和 Reading Projection，ReadingMode 读取章节正文与有效字数。 | `artifacts/slice-verify/p1-chapter-adoption-reading-tauri{,-lmstudio}/summary.json` |
| 14 | P1-chapter-edit-then-accept / overwrite-confirm | done | - | 采纳三元组补齐（edit_then_accept 全文替换）+ 覆盖已有正文需确认重新 gate（AU-04/06 核心）。 | `artifacts/slice-verify/p1-chapter-edit-then-accept-tauri*/summary.json`；`artifacts/slice-verify/p1-chapter-overwrite-confirm-tauri*/summary.json` |
| 15 | P1-word-count-audit（checkpoint A）| done | - | 在有效字数之上补审计层：短章/空章判定 + P1 门槛；ReadingMode 目录标记短章/空章、顶栏达标进度。 | `artifacts/slice-verify/p1-word-count-audit-tauri/summary.json`；`tasks/slices/P1-word-count-audit.md` |
| 16 | P1-chapter-expansion | done | - | checkpoint 1：单章续写累积到达标（每章 ≥1000）。Planner（AI）从自然语言识别续写/重写意图+目标章；续写采纳为同章新场景累积。确定性 + `--real-lmstudio` 两 provider Tauri 验收通过。 | `artifacts/slice-verify/p1-chapter-expansion-tauri{,-lmstudio}/summary.json` |
| 17 | P1-chapter-expansion-continuity | done | - | checkpoint 2 续写连贯：prose_writing 续写/重写带入目标章已采纳正文（基于前文衔接）。AI 只识别意图，目标章由应用层用 current_chapters 确定性解析（命中用之，否则回退最新章），生成读前文与采纳归章一致。确定性 + `--real-lmstudio` 两 provider Tauri 通过（真实 prose_writing 请求含前文）。 | `artifacts/slice-verify/p1-chapter-expansion-tauri{,-lmstudio}/summary.json`（`prior_prose_context_events=2`） |
| 18 | P1-chapter-expansion-multichapter | done | - | checkpoint 3 连续多章：第 1/2/3 章逐章首稿各归各自计划章（target_chapter 精确/标题匹配）、不串、目录有序；确定性 + `--real-lmstudio` 两 provider Tauri 通过。 | `artifacts/slice-verify/p1-chapter-expansion-multichapter-tauri{,-lmstudio}/summary.json` |
| 19 | P1-word-count-audit-repetition-gaps | deferred | - | 重复段落/重复章检测（B）+ 缺章率与 word-count.json 完整版（C）。质量护栏，按「质量放后」延后为独立 creative-quality slice，收敛到 `quality_finding` + policy（v3-quality-gates §4.2「主链稳定后再铺开」），不再贴 reading projection（避免加深 F1 债）。 | `tasks/slices/P1-word-count-audit.md` §3/§6/§7 |
| 20 | P1-export-minimum | done | - | 阅读模式「导出全书」→ 后端从已采纳作品事实（阅读投影单一源）组装完整 Markdown 落盘：头部元信息 + 全章有序目录 + 已采纳正文 + 未写章诚实占位；确定性 + `--real-lmstudio` 通过（driver 读真实导出文件验证）。 | `artifacts/slice-verify/p1-export-minimum-tauri{,-lmstudio}/summary.json` |
| 21 | P1-100k-dogfood-run | done | - | **P1 里程碑达成**：真实工作台狗粮产出 **115,274 有效字 / 90 章全部 ≥1000**（min 1024），全程外部 Playwright 像作者一样操作（规划→逐章首稿/续写→采纳→增量扩章循环→导出）；多次 `--resume` 断点续跑实证「重启后继续」；抽查 0 系统泄漏 / 0 空章 / 0 重复开篇。狗粮还反哺两个产品健壮性修复（LLM 坏 JSON 重试、续写前文裁剪）。 | `artifacts/novel-output/p1-100k-dogfood/`（summary/word-count/chapter-quality/continuity/export/progress/work-snapshot.sqlite3） |
| 22 | AU10-workbench-matrix-layout | checkpoint closed | - | `WorkspaceChat` 已是唯一生产工作台入口；首条 AU-10 baseline matrix 已把分散证据归并到真实 1280×800 工作台：普通聊天 no-MicroPlan、why、候选授权 action、adoption、reading projection 与 task status 首屏基线。 | `artifacts/slice-verify/au10-workbench-matrix-layout-tauri/summary.json`；`bash scripts/tauri_slice_verify.sh au10-workbench-matrix-layout` |
| 23 | VS-00C-CP3-structured-context | done | - | 结构化章节条目已从 persistence/fetcher 进入 `DialogueContext.structured_chapters`，prose_writing L2 注入目标章计划摘要、seq 与前后章位置；planner 的 `current_chapters` 标题列表保持兼容。 | `artifacts/slice-verify/vs00c-cp3-structured-context-tauri/summary.json`；`apps/novel_application/test/novel_application/cp3_structured_context_test.exs` |
| 24 | VS-00C-CP4-chapter-plan-structure | done | - | CP4 已把章计划从自由文本摘要升级为 E18-E22 结构方向，并在 prose_writing L2 中优先渲染章功能、目标四件套、情绪定位、断章与字数场次。 | `artifacts/slice-verify/vs00c-cp4-chapter-plan-structure-tauri/summary.json`；`apps/novel_application/test/novel_application/cp4_chapter_plan_direction_test.exs` |
| 25 | VS-00C-CP5-reader-effect-brief | done | - | CP5 已在 CP4 的结构化方向上补 ReaderEffectBrief，把读者效果、钩子承诺、风险约束前移到写前；AI self_report 只作为质量线索，不进入作品事实。 | `artifacts/slice-verify/vs00c-cp5-reader-effect-brief-tauri/summary.json`；`apps/novel_application/test/novel_application/cp5_reader_effect_brief_test.exs` |
| 26 | AU10-workbench-recovery-taskstate | next | - | baseline matrix 尚未覆盖长任务 RUNNING/CHECKPOINT/COMPLETED/FAILED、WebSocket 断线重连、LLM 超时/失败后恢复；VS-00C CP0-CP5 已完成，现在回到 AU-10。 | `bash scripts/tauri_slice_verify.sh au10-workbench-recovery-taskstate`（待新增）；真实工作台恢复态 walkthrough + `task_state` 可见生命周期 + 断线/超时 UI 证据 |

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
| 2026-05-24 | `P1-chapter-draft-generation` 已闭环，队首推进到 `P1-chapter-adoption-reading`。 | 原生 Tauri 外部 UI driver 证明真实工作台从已采纳章节计划点击第 1 章“生成正文草稿”，发送带 micro plan 的正文请求，`prose_writing` 生成 `prose_fragment` 待采纳正文草稿；UI 显示“正文草稿待采纳”，未发送 adopt 事件，ReadingMode 在采纳前为空且未泄漏正文草稿。 |
| 2026-05-29 | `P1-chapter-adoption-reading` 闭环，并补齐 `edit_then_accept`、覆盖确认重新 gate（B1/B2）。 | 真实 accept 接通采纳持久化（纠正空兜底高估）；采纳三元组 + 覆盖确认；两 provider Tauri 通过。 |
| 2026-05-30 | AU-09 记忆召回端到端（create / adopt-setting / validity-window）闭环；code-review 回归（behavior_state 形状、章节身份 A2–A6）修复。 | 见 `docs/project-ledger.md` 对应条目。 |
| 2026-05-31 | `P1-word-count-audit` checkpoint A 闭环，队首推进到 checkpoint B/C（重复/缺章）。 | `NovelDomain.ProseAudit` + `NovelMilestone` 审计层；`ReadingProjectionRepo.toc` 附 audit；ReadingMode 标记短章/空章 + P1 达标进度；确定性 Tauri 验收 `short_chapter_marked=true`、`milestone_met=false`（168 字短章）。后端 631 + 全门禁绿。 |
| 2026-05-31 | 质量门禁收敛（word-count B/C）放后，新焦点 `P1-chapter-expansion`：单章续写累积到达标，数据流地基已就位。 | 字数审计暴露"全是短章"，根因是采纳把章/场景塌缩成单场景 + 缺续写产出。续写累积对齐 v2 21 §6.6/ADR-0004；意图识别走 v3 DialogueFrame/Planner（AI 非关键字），意图作为 artifact provenance 顺现有数据流。本轮完成数据流地基（plan→artifact provenance→采纳 append/overwrite），后端 635 绿；未闭环：Planner 真实 LLM 识别 + Tauri（队首仍为本 slice）。 |
| 2026-06-01 | `P1-chapter-expansion` checkpoint 1 闭环。 | Planner 现从自然语言识别续写/重写意图 + 目标章（章节上下文经 6 元组 fetcher 注入 plan prompt，LLM 精确复制已采纳章节标题），续写采纳为同章新场景累积、不 supersede；重写走覆盖确认兜底。确定性 Tauri：初稿 168 → 2 轮续写 → 单章累积 1302、短章翻达标。`--real-lmstudio`（gpt-oss-120b）：初稿 672 → 真实 LLM 两轮均识别 continuation → 单章累积 1509、4×POST 全 200。两证据 `artifacts/slice-verify/p1-chapter-expansion-tauri{,-lmstudio}/summary.json`。 |
| 2026-06-04 | 队列重排：质量护栏（repetition-gaps）从队首后移，**先做主链 checkpoint 2 续写连贯 + checkpoint 3 连续多章**。 | 用户决策 + 设计依据：repetition/短章审计属小说 `quality_gate`→`quality_finding`→policy（v2 31 / v3-quality-gates §4），当前短章审计已是错位的 reading-projection 派生字段（设计债 F1），repetition 若照搬会加深 F1。v3-quality-gates §4.2 明确「完整质量门禁应在主链稳定后才铺开」。且 checkpoint 1 暴露续写易重复/另起（确定性两轮近重复、真实 LLM 也会漂），根因是 prose_writing 不带本章前文——连贯性是 repetition 门会暴露的根因，应先治根（连贯），再立护栏（独立 creative-quality slice）。 |
| 2026-06-04 | `P1-chapter-expansion-continuity`（checkpoint 2）闭环，队首推进到 `P1-chapter-expansion-multichapter`（checkpoint 3）。 | prose_writing 续写/重写时上下文带入目标章已采纳正文（v2 28「基于前文」）：`ReadingProjectionRepo.accepted_chapter_prose/2` 读端口 + `persistence_chapter_prose_reader` 注入 + `TurnExecutionService` 拼前文 section + observability 事件 `turn_execution.continuation_context.done`。**关键健壮性修复**：真实 LLM 能识别 continuation 意图但常漏 `target_chapter`，故目标章改由应用层用 `DialogueContext.current_chapters` 确定性解析（命中用之，否则回退最新章），并把解析结果同时用于读前文与采纳归章，二者一致。确定性 Tauri 累积 1290、`--real-lmstudio`（gpt-oss-120b）491→1637，两者 `prior_prose_context_events=2`、真实 prose_writing 请求含「本章已采纳正文」。后端 216 测试绿 + 9 新测试。 |
| 2026-06-10 | `P1-chapter-expansion-multichapter`（checkpoint 3）闭环，队首推进到 `P1-export-minimum`；质量护栏（19）按「质量放后」延后。 | 新 slice `p1-chapter-expansion-multichapter`：作者对话框逐章自然语言推进第 1/2/3 章首稿，各章正文按 target_chapter（真实 LLM 从列表精确复制）/artifact 标题（确定性）归到各自计划章、不串，阅读目录显示完整 12 章计划且 3 章按 seq 有序有正文。确定性各 ~135 字、`--real-lmstudio`（gpt-oss-120b）各 537/477/571 字，两 provider Tauri 通过。**顺带修既有 P0**：require_confirmation 的 user turn 持久化时 `Interaction.content`（Ecto :map）内嵌 `MicroPlan` struct → `Ecto.ChangeError` 崩 GenServer（此前只有 author_action confirm 被测、user turn 直接 require_confirmation 未覆盖）；`DialogueGateway.jsonable/1` 深度 struct→map 规范化 + 回归单测。后端 223 测试绿 + I3/I1/I2 全过。 |
| 2026-06-10 | 插队工作（不在主队列，借「降 AI 味」提示词 + harness 修复）。 | plan-minimum 复活 + overwrite-confirm 对齐 toc 语义（`53c7d9b`）；prose_writing 写作质量约束 Slice A（`ceefa60`）；目标字数结构化创作槽 Slice B checkpoint 1（`4959943`，新 slice `p1-chapter-word-count-target`）。降 AI 味分析性验收结论见 memory：对白手法显著、反套话黑名单照搬截图未对准本地模型指纹，按「本地模型先聚焦功能」延后。 |
| 2026-06-12 | `P1-100k-dogfood-run`（Order 21）**P1 里程碑达成**：115,274 有效字 / 90 章全 ≥1000 / 审计全 ok / 导出 390KB 完整 90 章目录有序 / 抽查 0 泄漏 0 重复。 | 放大跑暴露并修复两个真实产品缺口：① 真实 LLM 长上下文偶发非法 JSON（字符串内裸换行）→ `CreativeProvider.Real` 增加坏 JSON 纠错重试（与 Planner frame retry 同模式，3 单测）；② **续写前文注入无长度上限** → LM Studio n_ctx=4096 下 ~1000 字章的续写请求 HTTP 400（`n_keep 4264 >= n_ctx 4096`），任何达标章永远无法续写 → `prior_prose_section` 裁剪到末尾 2000 字并标注省略（修复后 21 个滞留章连续零失败补齐）。运维教训：狗粮数据在共用 test DB，`tauri_slice_verify.sh` cleanup 会重置——长跑期间禁跑 slice 验收（基建改进项：狗粮独立 DB）；LM Studio 建议 n_ctx ≥8192；6 小时高负载后模型输出会暂时退化（停跑喘息可恢复）。质量观察（非阻断）：8/90 章标题无「第NN章」编号前缀（目录 seq 仍有序）；连续性/重复段自动检测归 Order 19（deferred）。 |
| 2026-06-12 | P0 插队：`AU10-workbench-matrix-layout` 成为当前 next。 | 用户指出 `WorkspaceChat` / `历史旁路工作台` 的问题并未解决。当前已退役删除 `历史旁路工作台` / `历史旁路 socket helper` 旁路，`WorkspaceChat` 成为唯一生产工作台入口；下一步补 AU-10 专属 matrix/layout Tauri 验收和截图暴露的真实 viewport 问题。 |
| 2026-06-17 | `AU10-workbench-matrix-layout` baseline checkpoint 已闭环，队首推进到 `AU10-workbench-recovery-taskstate`。 | 原生 Tauri 外部 driver 在 1280×800 真实工作台完成普通聊天 no-MicroPlan、why 弹窗、候选授权 action、正文草稿采纳、Reading Projection 与任务状态首屏基线；但仍未覆盖长任务全过程、断线、超时和失败恢复，因此 AU-10 整体不得标 complete。 |
| 2026-06-17 | 修正队首：AU10 recovery 延后，当前回到 VS-00C CP 序列，CP3 已闭环，队首为 CP4。 | 用户明确要求“做完所有 CP，才能转到下一个任务”。CP3 已有真实 Tauri 证据 `vs00c-cp3-structured-context`，证明第 2 章首稿从真实档案入口发起，prose_writing 前拿到目标章计划摘要、seq 和前后章位置；CP4/CP5 仍是首稿高质量方向层所需前置，不能被 AU10 recovery 插队。 |
| 2026-06-17 | `VS-00C-CP4-chapter-plan-structure` 已闭环，队首推进到 CP5 ReaderEffectBrief。 | CP4 已把 outline 规划产物解析并物化为 `chapters.plan_direction`，prose_writing 前的 `context.structure.done` 可证明 `has_plan_direction=true`；下一步补读者效果目标和自报告质量线索。 |
| 2026-06-17 | `VS-00C-CP5-reader-effect-brief` 已闭环，队首回到 `AU10-workbench-recovery-taskstate`。 | CP5 的 Tauri 证据证明 ReaderEffectBrief 在 provider 调用前形成，prose_writing 输出携带非权威 self_report 且不进入作品事实；VS-00C CP0-CP5 序列已完成，按用户要求转回下一个任务 AU10 recovery。 |
| 2026-06-11 | dogfood checkpoint 2：12 章全部跑满（16,734 字、12/12 ≥1000、0 失败、末跑 8 分钟）+ 增量规划 slice `p1-plan-incremental` 两 provider 闭环（**零产品代码**——物化层 title 幂等 + seq 续排本就支持追加，真实 gpt-oss-120b 从已有 12 章正确接续生成第13-19章、采纳追加、原章不动）。10 万字放大跑解锁。 | runner 修两个深层 bug：① 长会话**历史帧误匹配**（帧匹配不限起点 → 第08章误进第03章的确认分支）→ waitForFrame 加 fromIndex 限定本轮；② **waitForFunction(fn, arg, options) 参数顺序坑复发**（两参形式 timeout 被当 arg 从未生效、默认 30s）→ runner 全部改三参——该坑在所有 slice driver 的两参调用里潜伏（条件总在 30s 内满足未暴露），后续宜统一清理。狗粮还实证：覆盖确认/确认执行/失败重试-跳过/`--resume` 三次断点续跑全部工作；确定性 provider 的「改写」关键字误判（planner-keyword 债）只影响离线调试不影响真实跑。增量批量由 AI 自定（实测 7 章），验收下限放宽 >= 5。 |
| 2026-06-11 | `P1-100k-dogfood-run`（Order 21）checkpoint 1：狗粮长跑 runner 基建落地并真实试跑通过；放大到 10 万字前发现产品缺口「计划无法增量扩展」。 | 新增 `scripts/dogfood_run.sh` + `frontend/slice-verify/dogfood-runner.mjs`（外部 Playwright 像作者一样逐章推进真实工作台：读阅读投影找未达标章 → 首稿/续写自然语言指令 → 确认创建采纳 → 循环 → 导出全书；支持 `--resume` 断点续跑=「重启后继续生成下一章」真实演练、确认卡处理（消费 AU-04 链）、失败重试-跳过、progress.jsonl + milestones §8 产物）。真实试跑（gpt-oss-120b）：第01章 135→642→1101、第02章 137→804→1600，续写衔接自然（nonce 贯通）、~25s/轮。**缺口**：seed 计划仅一卷 12 章（≈1.8 万字），10 万字需 ~70-100 章；增量规划（「继续规划第二卷」→ outline 采纳追加到既有结构）未验证，疑似采纳物化（固定「第一卷」+ seq 从 1 重算）不支持追加——需先以独立 slice 闭环增量规划，或本轮先跑满 12 章并如实报告缺口。 |
| 2026-06-11 | `P1-export-minimum`（Order 20）闭环，队首推进到 `P1-100k-dogfood-run`。 | 阅读模式新增「导出全书」：channel `export_work` → `ExportService`（复用 `ReadingProjectionService.toc/chapter_content` 单一作品事实源，AU-08 口径——未采纳草稿天然不进导出）→ `NovelDomain.ExportDocument` 纯函数渲染（头部元信息 + 全章按 seq 目录 + 逐卷逐章正文 + 未写章「（本章暂无已采纳正文）」诚实占位）→ 写盘（`:export_dir` config，test=tmp/exports、默认 ~/Documents/AI Novel Studio）→ UI 显示「已导出到 <路径>」。验收 driver 复用采纳-阅读链后点真实导出按钮、从页面路径读真实文件断言 12 章目录有序、已采纳正文在文、占位恰 11；确定性 + `--real-lmstudio` 通过。后端 229+105 测试、I3/I1/I2、前端审计/设计追溯全过。 |
| 2026-06-10 | P0 插队（Selection Rule 2）：code review 发现 user-turn 高风险确认链两层断链，修复并以新 slice `au04-confirm-before-execute` 闭环（AU-04 首个真实页面验收）。 | ① turn_result 经 `Map.put(:plan, raw struct)` 旁挂 MicroPlan（契约外捷径），broadcast（Jason `Protocol.UndefinedError`）/persist 双崩——「作者直接说重写第X章→确认卡」从未在真实 wire 走通；② 确认后 re-gate `GateOrder` 无确认满足输入，高风险 plan 永 `confirmed_but_blocked`——ADR-0009「确认→重新 gate→执行」只实现了一半（ConfirmationBinding domain 壳零消费）。修复：plan 载体 JSON 安全化（`DialogueGateway.jsonable`，Jason 原生可编码标量 struct 保留）+ `MicroPlan.from_map` 反序列化（atom/string key 双形态，未知枚举落最保守）+ `ConfirmationBinding` 接入 `handle_action`→`ExecutionOrchestrator.decide/3`→`GateOrder.evaluate/2`（authority/write_boundary 感知确认，其余 gate 照常，VS-03 §6「确认不等于 gate 一定通过」）。验收：`au04-confirm-before-execute` 确定性 + `--real-lmstudio` 通过（确认卡过真实 wire、确认前 `tool_called=false`/`production_write_performed=false`、确认后同 turn 产 tentative prose）；回归 overwrite-confirm/adoption-reading/multichapter 全过；后端 227+102 测试、I3/I1/I2 全过。 |
