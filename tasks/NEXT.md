# NEXT / 当前推进队列

> 最后更新：2026-05-21
>
> 角色：本文件是 AI 和人类维护者选择下一项工作的唯一入口。台账记录事实，acceptance 记录验收口径，用户旅行图记录连续体验；本文件把它们压缩成当前可执行队列。

---

## 1. Current Focus

**AU-03 作品内会话与上下文分层**

当前阶段先连续补齐“长期创作会话”这条旅行图，不再从所有 AU/SU 缺口里随机挑选。

## 2. Why This Focus

作品是小说工作台的基本隔离边界，session 是长期创作上下文的基本时间边界。若 work/session/history/context 分层不稳，后续 memory recall、trace replay、adoption provenance、reading projection 都会受到污染。

已闭环的最近 checkpoint：

| Checkpoint | 状态 | 证据 |
|---|---|---|
| AU03 active session resume | closed | `artifacts/slice-verify/au03c-work-session-resume-tauri/summary.json` |
| AU03 session history readonly | closed | `artifacts/slice-verify/au03-session-history-readonly-tauri/summary.json` |

## 3. Active Journey

来源：`docs/product/user-journeys.md` 的 Journey A。

```text
启动应用
→ 选择/创建作品
→ 恢复 active session
→ 搜索历史会话
→ 只读查看历史 transcript
→ 从历史会话分支继续
→ 归档旧会话
→ 当前作品最新背景 + 当前 session transcript 分层进入 context
→ AI 回复可解释引用来源
```

当前断点：**从历史会话分支继续**。

## 4. Queue

除非出现阻塞 P0 bug，下一次功能推进必须从队首开始。

| Order | Task ID | Status | Blocked By | Why Next | Proof Target |
|---:|---|---|---|---|---|
| 1 | AU03-branch-from-history | next | - | 历史会话已能只读回看，但作者还不能从旧讨论显式创建新 active session 继续创作。 | Tauri：搜索历史会话 -> 打开只读 transcript -> 点击继续 -> 创建新 active session，`source_session_ref/source_turn_ref` 指向旧会话，旧 transcript 不被篡改。 |
| 2 | AU03-archive-session-filter | queued | AU03-branch-from-history | 历史回看之后需要可治理地退出日常上下文；归档会话默认不应进入普通 context。 | Tauri：归档历史会话 -> 默认列表/上下文过滤 -> 搜索可找回 -> replay 仍可查。 |
| 3 | AU03-current-work-context-ssot | queued | AU03-branch-from-history | 多会话下必须证明最新 Work 背景与 session transcript 分层，不能用旧会话覆盖当前作品事实。 | Tauri/LMStudio：历史会话只读打开后返回当前会话，下一轮 prompt 使用最新 Work 背景 + 当前 active session transcript。 |
| 4 | AU03-long-session-compression | queued | AU03-current-work-context-ssot | 长会话已修 recent transcript 顺序，但还缺摘要压缩和 token 预算策略。 | Application + Tauri：超过窗口后旧 turn 进入 session summary，最新 N 轮仍保留顺序。 |
| 5 | AU03-context-source-ui | queued | AU03-current-work-context-ssot | 作者能看到“AI 参考了什么”，把 AU-03 与 AU-07 author-safe trace 连接起来。 | Tauri：普通回复 why 面板显示 current work / session transcript / memory 的来源摘要，不暴露 raw prompt。 |

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
