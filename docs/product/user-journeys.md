# Product User Journeys / 用户旅行图

> 最后更新：2026-05-21
>
> 角色：按真实用户连续流程组织 AU/SU 验收状态。本文不是台账，也不是完整 acceptance；它负责回答“用户现在卡在哪一步，以及下一步为什么应该补这里”。
>
> 输入来源：
> - `docs/design-v3/acceptance/SCENARIO-BLUEPRINT.md`
> - `docs/design-v3/acceptance/README.md`
> - `docs/project-ledger.md`
> - `tasks/NEXT.md`

---

## 1. 状态定义

| Status | 含义 |
|---|---|
| `closed` | 已有真实前端入口或自动化验收闭环证据。 |
| `partial` | 有代码或局部测试，但真实用户链路不完整。 |
| `gap` | 设计存在，缺关键实现或入口。 |
| `next` | 当前推进队列的下一断点。 |
| `blocked` | 已确认需要前置条件，暂不能推进。 |

证据优先级：

```text
真实 Tauri/前端发起验证 > 浏览器 slice 验证 > Channel/API 自动化 > Application/Persistence 单测 > 文档描述
```

## 2. Journey A：长期创作会话与上下文分层

目标：作者能长期围绕一个作品创作，系统稳定区分当前作品、当前 active session、历史会话、已确认记忆和可解释上下文来源。

关联验收：AU-03、AU-07、AU-09、SU-02。

| Step | 用户动作 / 体验节点 | Status | Evidence | Gap / Next |
|---:|---|---|---|---|
| A1 | 启动应用并恢复真实工作台上下文 | closed | `artifacts/slice-verify/stage-startup-context-contract-tauri/summary.json` | 后续生产 sidecar lifecycle 仍另行推进。 |
| A2 | 选择/切换作品，保证作品隔离 | closed | `artifacts/slice-verify/su02-work-switching-tauri/summary.json` | 不可用作品降级、完整作品管理面板仍未闭环。 |
| A3 | 恢复当前 active session transcript 和 pending adoption | closed | `artifacts/slice-verify/au03c-work-session-resume-tauri/summary.json` | 历史会话治理仍需补。 |
| A4 | 在当前 active session 连续聊天，近期对话进入 Planner context | closed | `artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri/summary.json`，LMStudio 旧证据见台账 | messages 契约后的真实 LMStudio 复验证据仍需补。 |
| A5 | 搜索历史会话 | partial | `WorkSessionService.search/2`、`WorkSessionsController.index/2`、右侧 session list | 搜索命中高亮、打开指定 turn 位置仍缺。 |
| A6 | 只读查看历史 transcript，不恢复旧 pending/action/loading | closed | `artifacts/slice-verify/au03-session-history-readonly-tauri/summary.json` | 只读回看已闭环；下一步是分支继续。 |
| A7 | 从历史会话继续，显式创建新 active session / branch | next | 无 | `tasks/NEXT.md` 队首：`AU03-branch-from-history`。 |
| A8 | 归档旧会话，默认不进入日常 context，仍可搜索/回放 | gap | 会话状态字段存在 | 需要归档入口、过滤规则和 UI 验收。 |
| A9 | 最新 Work 背景与当前 session transcript 分层进入 context | partial | active session transcript 注入已实现；memory recall 最小闭环已实现 | 需证明历史 session 不覆盖最新 Work 背景。 |
| A10 | 作者能在 why 面板看到上下文来源摘要 | partial | `artifacts/slice-verify/au07-trace-why-entry-tauri/summary.json`、`au09-memory-recall-context` | 需要 AU-03 context source UI 与 trace 聚合更完整。 |
| A11 | 长会话压缩，旧 turn 进入 summary，最新 turn 保持顺序 | gap | recent transcript 顺序修复已记录在台账 | 缺 session summary 压缩策略和验收。 |

当前连续断点：

```text
A6 closed → A7 next
```

因此下一项功能推进应是 `AU03-branch-from-history`，除非出现 P0 bug。

## 3. Journey B：创作候选到采纳再到阅读

目标：作者从模糊创意开始，与 AI 探索方向，生成待采纳草稿，确认采纳后能在阅读模式看到真实作品内容。

关联验收：AU-02、AU-05、AU-08、AU-10。

| Step | 用户动作 / 体验节点 | Status | Evidence | Gap / Next |
|---:|---|---|---|---|
| B1 | 普通聊天不误触发 MicroPlan | closed | `artifacts/slice-verify/au10-ordinary-chat-no-micro-plan-tauri/summary.json` | 完整 AU-01 场景覆盖仍需重算。 |
| B2 | 模糊创意产生候选方向 | closed | `artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` | 真人 UI 观感复验仍可补。 |
| B3 | 点选候选继续探索，不等于采纳 | closed | `artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` | 候选明确采纳桥接仍缺。 |
| B4 | 生成待采纳创作草稿 | closed | `artifacts/slice-verify/au05-adoption-boundary-tauri/summary.json` | 完整 StateTrace 仍不足。 |
| B5 | 采纳/放弃/修改后采纳从真实工作台触发 | closed | `au05-adoption-boundary`、`au05-discard-boundary`、`au05-modify-draft-boundary` Tauri summaries | 高风险确认和冲突/freshness 仍缺。 |
| B6 | 采纳章节片段后阅读模式看到 TOC/正文 | closed | `artifacts/slice-verify/au08-adoption-reading-projection-tauri/summary.json` | projection refresh 状态机仍缺。 |
| B7 | 从候选方向明确桥接到 adoption boundary | gap | 无完整证据 | 候选选择到采纳边界仍是 AU-02/AU-05 交界缺口。 |

## 4. Journey C：故事设定与记忆治理

目标：作者能管理作品设定，AI 只召回 confirmed/stabilized 且 recallable 的记忆，并能解释引用来源。

关联验收：AU-09、AU-03、AU-07。

| Step | 用户动作 / 体验节点 | Status | Evidence | Gap / Next |
|---:|---|---|---|---|
| C1 | 打开作品档案看到真实角色/伏笔/规则/统计 | closed | `artifacts/slice-verify/au09-archive-real-data-tauri/summary.json` | 跨作品 UI 隔离复验仍可补。 |
| C2 | 档案 L2 列表到 L3 详情只读查看 | closed | `artifacts/slice-verify/au09-archive-real-data-tauri/summary.json` | L4 lineage 未闭环。 |
| C3 | 记忆 REST 管理入口 | partial | controller/service/repo 测试和台账记录 | 正式工作台入口未挂。 |
| C4 | 已确认记忆召回进 context/prompt | closed | `artifacts/slice-verify/au09-memory-recall-context-tauri/summary.json` | 有效期窗口、locked 修改尝试 trace 未闭环。 |
| C5 | 作者查看某条记忆为何被引用 | partial | why 面板可显示 memory summary | 缺 memory reference log 到 replay/UI 的完整聚合。 |
| C6 | 面板内采纳设定进入 governed memory | gap | pending adoption 与 confirmed memory 已分离 | 仍需 adoption -> memory governance 主链。 |

## 5. Journey D：透明度、回放与诊断

目标：作者能理解 AI 为什么这样回复/不执行/要求确认，开发者能用保存 trace 离线复盘。

关联验收：AU-07、VS-10。

| Step | 用户动作 / 体验节点 | Status | Evidence | Gap / Next |
|---:|---|---|---|---|
| D1 | 当前消息旁打开“为什么”入口 | closed | `artifacts/slice-verify/au07-trace-why-entry-tauri/summary.json` | 旧 turn 查询入口仍缺。 |
| D2 | author-safe trace summary 脱敏 | partial | `TraceRedactor` 测试、why UI 最小证据 | developer 双视图权限边界未闭环。 |
| D3 | replay 不调 LLM | partial | `ReplayService` 单测 | 缺持久化 trace 查询到 UI/API 的闭环。 |
| D4 | ToolTrace / BehaviorTrace / StateTrace 聚合 | gap | DecisionTrace 摘要级字段存在 | 完整六问 ReplayReport 未闭环。 |

## 6. 使用规则

1. 每次开工先读 `tasks/NEXT.md`，再用本文确认队首任务属于哪个 journey step。
2. 如果要改变 Current Focus，必须先更新本文对应 journey 状态，再更新 `tasks/NEXT.md` 的 `Decision Log`。
3. 每完成一个 checkpoint，必须把对应 step 的 `Status` 和 `Evidence` 更新到本文。
4. 本文只维护跨 AU/SU 的连续用户流程；单场景细节仍以 `docs/design-v3/acceptance/` 为准。

