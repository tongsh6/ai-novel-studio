# NEXT / 当前推进队列

> 最后更新：2026-05-24
>
> 角色：本文件是 AI 和人类维护者选择下一项工作的唯一入口。台账记录事实，acceptance 记录验收口径，用户旅行图记录连续体验；本文件把它们压缩成当前可执行队列。

---

## 1. Current Focus

**AU-02 / AU-05 候选方向到采纳边界**

AU-03 作品内会话与上下文分层的当前连续旅行图已闭环到“AI 回复可解释引用来源”。下一阶段转入自然创作对话到作品事实的桥接：候选方向可以被继续探索，但明确采纳必须进入 adoption boundary，不能由前端直接写成作品事实。

## 2. Why This Focus

候选方向是作者从“聊想法”进入“形成作品事实”的第一道产品边界。若 candidate selection / adoption boundary 不稳，系统会把灵感、草稿、正式事实混在一起，后续作品档案、阅读投影、记忆治理和 trace replay 都会被污染。

已闭环的最近 checkpoint：

| Checkpoint | 状态 | 证据 |
|---|---|---|
| AU03 long session compression | closed | `artifacts/slice-verify/au03-long-session-compression-tauri-lmstudio/summary.json` |
| AU03 current work context SSOT | closed | `artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json` |
| AU03 archive session filter | closed | `artifacts/slice-verify/au03-archive-session-filter-tauri/summary.json` |
| AU03 branch from history | closed | `artifacts/slice-verify/au03-branch-from-history-tauri/summary.json` |
| AU03 active session resume | closed | `artifacts/slice-verify/au03c-work-session-resume-tauri/summary.json` |
| AU03 context source UI | closed | `artifacts/slice-verify/au03-context-source-ui-tauri/summary.json` |

## 3. Active Journey

来源：`docs/product/user-journeys.md` 的 Journey C / Journey F。

```text
输入模糊创意
→ AI 给出候选方向
→ 点选候选继续探索
→ 作者明确表示采用某个方向
→ 服务端校验候选来源和 available action
→ adoption boundary 重新 gate
→ 返回 AdoptionDecision / TurnResult
→ UI 显示采纳结果或等待确认
→ trace 解释 selection 与 adoption 的边界
```

当前断点：**候选方向明确采纳时进入 adoption boundary**。

## 4. Queue

除非出现阻塞 P0 bug，下一次功能推进必须从队首开始。

| Order | Task ID | Status | Blocked By | Why Next | Proof Target |
|---:|---|---|---|---|---|
| 1 | AU03-branch-from-history | done | - | 真实工作台已提供“从这里继续”入口，可创建并切换到新 active session，保留 `source_session_ref/source_turn_ref`。 | `artifacts/slice-verify/au03-branch-from-history-tauri/summary.json` |
| 2 | AU03-archive-session-filter | done | - | 真实工作台已提供历史会话归档入口；默认列表隐藏 archived，会话搜索仍可找回并只读打开；普通 context 默认排除 archived transcript。 | `artifacts/slice-verify/au03-archive-session-filter-tauri/summary.json` |
| 3 | AU03-current-work-context-ssot | done | - | 多会话下必须证明最新 Work 背景与 session transcript 分层，不能用旧会话覆盖当前作品事实。 | `artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json` |
| 4 | AU03-long-session-compression | done | - | 超过窗口的旧 turn 已进入 `work_sessions.summary`，最新 transcript 窗口保留自然顺序并进入 Planner prompt。 | `artifacts/slice-verify/au03-long-session-compression-tauri-lmstudio/summary.json` |
| 5 | AU03-context-source-ui | done | - | 作者能看到“AI 参考了什么”，把 AU-03 与 AU-07 author-safe trace 连接起来。 | `artifacts/slice-verify/au03-context-source-ui-tauri/summary.json` |
| 6 | AU02-candidate-adoption-bridge | next | - | 候选方向不能停在“继续探索”，也不能被前端直接写成事实；明确采纳必须经过 AU-05 adoption boundary。 | `tasks/slices/AU02-candidate-adoption-bridge.md`；Tauri：输入模糊创意生成候选，先点选继续探索不写事实，再明确采纳候选，服务端返回 adoption decision / trace，UI 不绕过 available action。 |

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
