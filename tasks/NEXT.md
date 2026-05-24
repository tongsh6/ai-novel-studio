# NEXT / 当前推进队列

> 最后更新：2026-05-24
>
> 角色：本文件是 AI 和人类维护者选择下一项工作的唯一入口。台账记录事实，acceptance 记录验收口径，用户旅行图记录连续体验；本文件把它们压缩成当前可执行队列。

---

## 1. Current Focus

**AU-05 采纳安全与新鲜度：canon conflict recovery**

AU-02 / AU-05 候选方向到采纳边界已闭环：真实 Tauri 工作台可以先点选候选继续探索，再通过服务端授权的 `choose_candidate` action 进入 `AdoptionBoundary`。高风险候选 confirmation checkpoint、恢复自持久化 transcript 的 stale candidate rejection、以及 cross-work candidate recovery failure 都已闭环。下一阶段继续沿 Journey F 加固 canon conflict，避免与当前作品事实冲突的内容被静默采纳。

## 2. Why This Focus

采纳安全是作品事实可信度的第一道门禁。候选采纳桥接已经证明 UI 不能绕过 available action；高风险、stale restored candidate 和 cross-work checkpoint 已分别证明确认、拒绝与恢复失败路径不会写作品事实。现在需要继续证明 canon conflict 不会静默进入作品事实，否则后续作品档案、阅读投影、记忆治理和 trace replay 都会读到不可信状态。

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

## 3. Active Journey

来源：`docs/product/user-journeys.md` 的 Journey C / Journey F。

```text
候选或草稿已展示
→ 作者触发采纳
→ 服务端校验 source turn / available action / candidate ref / work boundary / freshness
→ adoption boundary 重新 gate
→ 高风险、过期、冲突或跨作品 action 进入 confirmation / rejection / recovery
→ UI 显示等待确认或拒绝原因
→ trace 解释为什么不能静默写入作品事实
```

当前断点：**canon conflict 采纳安全恢复**。

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
| 10 | AU05-canon-conflict-recovery | next | - | stale source 与 cross-work 已闭环；剩余最高风险是与当前 canon/revision 冲突的候选或草稿被静默采纳，污染作品事实与后续投影/记忆。 | `tasks/slices/AU05-canon-conflict-recovery.md`；Tauri：真实工作台触发 canon conflict 采纳，服务端返回 recovery/confirmation，UI 显示原因且不写 production fact。 |

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
