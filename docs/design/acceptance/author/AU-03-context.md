# AU-03 AI 了解我的作品

> 作者视角：AI 应该了解当前作品的最新背景、设定、角色、记忆和当前创作状态；同时，一个作品里会有多次会话，每次会话都有自己的历史 transcript。历史会话可以搜索、查看、归档，但重新进入历史会话时应是退出/只读状态，作品背景仍显示最新版本。
>
> 2026-05-13 对账结论：当前已有 `interactions` 作为 turn 级日志、`conversation_summary` 最近对话、ContextAssembler 抽象和部分测试；但缺独立的作品内会话模型、会话列表、搜索、归档、历史会话只读状态，以及“历史 transcript + 最新作品背景”的产品闭环。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 在当前作品里继续创作 | AI 使用最新作品背景、角色、设定和最近对话 |
| 查看作品内多次会话 | 左侧/面板展示该作品下 N 个会话 |
| 搜索历史会话 | 按标题、摘要、关键词、角色名搜索会话和 transcript |
| 重复查看历史会话 | 打开历史 transcript，但不恢复旧的 loading、pending action 或确认状态 |
| 归档旧会话 | 归档后默认不进入日常上下文，仍可搜索/回放 |
| 从历史会话继续 | 明确创建新会话或分支，并引用旧会话，不篡改旧历史 |
| 询问作品事实 | AI 基于最新作品背景回答，不拿旧会话状态冒充当前事实 |
| 信息不足时提不确定 | AI 诚实说明“不知道/当前没有记录”，不编造主角、地点或进度 |

明确不能做：
- 把当前活跃会话和历史会话混成一个无限聊天流；
- 重新打开历史会话时恢复旧 pending confirmation / loading / task running；
- 用历史会话里的旧作品背景覆盖当前最新作品背景；
- 把归档会话默认塞进日常 prompt；
- 把没有来源的事实说成“你的作品里已经设定了”。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU03-I1 / `00c` #1 | 有上下文时也必须产生有效 DialogueFrame | SC-AU03-A1、SC-AU03-A2 |
| AU03-I2 / `00c` #8 | 信息不足不自动表单化，也不编造 | SC-AU03-B1、SC-AU03-B2 |
| AU03-I3 / `00c` #13 | 作者可见的引用摘要必须脱敏、可解释 | SC-AU03-E1、SC-AU03-E2 |
| AU03-I4 | Work 最新背景与 Session 历史 transcript 必须分层 | SC-AU03-C4、SC-AU03-D1 |
| AU03-I5 | 历史会话重新进入时是 exited/read-only，不恢复旧运行态 | SC-AU03-C4 |
| AU03-I6 | 归档会话默认不参与普通上下文召回 | SC-AU03-C5、SC-AU03-D2 |
| AU03-I7 | 从历史会话继续必须显式创建新 active session 或 branch | SC-AU03-C6 |

---

## 3. 契约引用

| 契约 / 实现 | 用途 | 当前证据判断 |
|---|---|---|
| `works` / `WorkService` | 当前作品实体与最新作品背景入口 | 已有基础 CRUD，但未接入 Context snapshot |
| `workspaces` | 旧 UI workspace 表 | 仍被 `WorkspaceContext.fetch_workspace_info/1` 查询，和 VS-09 Work 未对齐 |
| `interactions` | turn 级 user/assistant 日志 | 已实现；可作为 transcript 底层材料 |
| `WorkspaceContext.context_fetcher/0` | 真实 persistence context fetcher | 返回 snapshot + conversation_summary，但 snapshot 查旧 workspace，memory/behavior 仍 nil |
| `ContextAssembler` | 组装 DialogueContext | 有测试；fetcher 异常无保护；ContextSourceRef summary 仍是占位 |
| `DialogueContext.to_prompt_text/1` | 把上下文写入 LLM prompt | 有单测覆盖非空段落 |
| `TraceWriter` | 记录 context_refs | 有结构化 refs，但作者可见来源摘要不足 |
| 会话 Session / Conversation 表 | 作品内多会话、会话状态、归档、搜索 | 已补 `WorkSession`、resume/show/search/create/archive API 和工作台最小 UI；仍缺搜索命中定位和完整 replay 页面 |
| `memory_items.conversation_id` | 记忆可关联 conversation 的设计痕迹 | 存在字段迹象，但会话管理闭环未接入 |

---

## 4. 验收场景

### 场景组 A：AI 使用当前作品最新背景

#### SC-AU03-A1 — AI 知道当前作品的最新基础背景

**作为作者**，我在《灵源纪元》里问“主角现在的核心动机是什么”，AI 应基于当前作品最新背景回答。

**触发**：打开作品并发送关于作品事实的问题。

**期望结果**：
- context snapshot 来自当前 Work，而不是旧 Workspace 名称；
- prompt 中包含作品 title / genre / 当前设定摘要；
- AI 回答引用当前作品事实；
- trace 标记 `current_work` 来源；
- 若作品背景更新，下一轮使用最新背景。

**当前证据**：`ContextAssembler` 支持 `current_work_snapshot`；`context_grounding_test.exs` 使用 stub snapshot 证明 prompt 能包含作品信息。

**当前状态**：部分实现。真实 persistence 仍查 `workspaces.name == workspace_id`，和 VS-09 `work_id` / `works` 未对齐。

---

#### SC-AU03-A2 — 当前活跃会话能引用最近对话

**作为作者**，我在同一个当前会话第一轮说“主角叫林烬”，第二轮问“他叫什么”，AI 应能引用最近对话。

**触发**：在同一 active session 连续对话。

**期望结果**：
- 第一轮 user/assistant 写入 transcript；
- 第二轮 `conversation_summary` 包含第一轮；
- prompt 包含最近对话段；
- AI 回复可引用最近对话；
- 这只作用于当前 active session 或明确选定的上下文范围。

**当前证据**：`WorkspaceContext.interaction_recorder/0` 写入 `interactions`；`dialogue_gateway_real_loop_test` 证明第二轮可读取 conversation_summary；`workspace_context_test.exs` 覆盖 recent interactions。

**当前状态**：局部已实现。底层按 `workspace_id` 汇总最近 interactions，不是独立 session transcript。

---

#### SC-AU03-A3 — AI 能引用已确认记忆/伏笔

**作为作者**，我确认过“林烬的妹妹林瑶失踪”，之后问“林烬为什么要冒险”，AI 应引用这条已确认伏笔。

**触发**：已有 confirmed memory 后发送相关问题。

**期望结果**：
- memory recall 返回相关已确认记忆；
- `memory_summary` 非空并进入 prompt；
- trace 标记 `memory` 来源；
- AI 回复引用来源，而不是编造；
- 已归档/不可召回记忆默认不进入普通上下文。

**当前证据**：`ContextAssembler` 支持 memory_summary；memory 管理相关 API/页面存在一定基础。

**当前状态**：未闭环。真实 `WorkspaceContext.context_fetcher/0` 当前返回 `memory_summary = nil`。

---

#### SC-AU03-A4 — AI 能感知当前开放行为

**作为作者**，如果系统正在等我确认某个计划，AI 下一轮应知道“有等待中的确认”，而不是当作普通聊天忘掉它。

**触发**：存在 open behavior / pending confirmation 时继续对话。

**期望结果**：
- `behavior_summary` 非空；
- prompt 中包含开放行为摘要；
- AI 不丢失等待态；
- 历史会话中的旧 waiting 状态不会在重新查看时恢复。

**当前证据**：`ContextAssembler` 字段支持 `open_behavior_summary`。

**当前状态**：未实现。真实 fetcher 返回 `behavior_summary = nil`。

---

### 场景组 B：空上下文与部分上下文

#### SC-AU03-B1 — 空作品里诚实说不知道

**作为作者**，我新建空作品，问“主角现在在哪里”，AI 不能编造主角或地点。

**触发**：空作品、无记忆、无会话历史时询问作品事实。

**期望结果**：
- `DialogueContext.has_context? == false`；
- trace 记录 empty context；
- AI 回复表达不确定或请求作者提供信息；
- 前端不显示虚假的引用来源。

**当前证据**：`context_grounding_test.exs` 覆盖 without context 不包含 stub 作品事实。

**当前状态**：后端局部已测试，缺真实 UI/LLM 验收。

---

#### SC-AU03-B2 — 有作品背景但无会话历史

**作为作者**，我给作品填了基础设定但还没开始聊天，问“这个类型适合什么开头”，AI 应基于作品背景回答，但不声称“根据我们刚才讨论”。

**触发**：snapshot 非空，conversation_summary / memory_summary 为空。

**期望结果**：
- prompt 包含作品背景；
- 不包含最近对话段；
- 回复不伪造历史讨论；
- context_refs 只有当前作品来源。

**当前证据**：旧 AU-03 已记录 partial context 缺口。

**当前状态**：缺测试/验收。

---

#### SC-AU03-B3 — context fetcher 异常时不阻断聊天

**作为作者**，即使本地数据库暂时读上下文失败，我仍应收到降级后的可用回复，而不是整个 turn 崩溃。

**触发**：context fetcher 抛错或返回非 `{:ok, ...}`。

**期望结果**：
- 系统记录上下文读取失败；
- fallback 到 empty context；
- AI 诚实说明当前无法读取作品背景；
- 前端不白屏，下一轮可继续。

**当前证据**：`ContextAssembler.assemble/2` 当前直接匹配 `{:ok, ...} = fetcher.(workspace_id)`。

**当前状态**：未实现保护。

---

### 场景组 C：作品内多会话管理

#### SC-AU03-C1 — 一个作品下有 N 个会话列表

**作为作者**，我打开《灵源纪元》，能看到这个作品下的多个会话，例如“角色动机讨论”“第三章节奏”“伏笔回收”。

**触发**：进入作品工作台，打开会话列表。

**期望结果**：
- 会话列表按当前 Work 过滤；
- 显示标题、摘要、最后更新时间、状态；
- active / exited / archived 状态清楚；
- 不同作品的会话不混在一起。

**当前证据**：未发现 session/conversation 表、API 或 UI；`interactions` 只有 `workspace_id` 和 turn 级日志。

**当前状态**：未实现。

---

#### SC-AU03-C2 — 新建作品内会话

**作为作者**，我可以在同一作品里新开一次会话讨论另一个主题。

**触发**：点击“新建会话”。

**期望结果**：
- 创建新的 session id；
- 新会话属于当前 Work；
- 新会话开始时可读取最新作品背景；
- 不自动带入其他会话 transcript，除非被明确引用。

**当前证据**：当前 Channel topic 以 workspace/work_id 为边界，未见 session id。

**当前状态**：未实现。

---

#### SC-AU03-C3 — 搜索历史会话

**作为作者**，我想找之前聊过“妹妹林瑶”的会话，可以搜索关键词并打开结果。

**触发**：在会话列表输入关键词搜索。

**期望结果**：
- 搜索会话标题、摘要、transcript；
- 结果限定当前 Work；
- 可打开匹配 turn 的位置；
- 归档会话默认也可被搜索，除非过滤关闭。

**当前证据**：未发现会话搜索 API/UI。记忆管理页面有搜索能力，但不是会话搜索。

**当前状态**：未实现。

---

#### SC-AU03-C4 — 重新查看历史会话时是退出/只读状态

**作为作者**，我打开上周的“第三章节奏”会话，只想回看当时聊了什么。系统不能恢复当时的 loading、pending action 或确认态。

**触发**：从会话列表打开历史 session。

**期望结果**：
- transcript 按历史原样显示；
- 会话状态为 exited/read-only；
- 不恢复旧 active behavior / task / confirmation；
- 不能在原历史 turn 上继续写入；
- 当前作品侧栏仍显示最新作品背景。

**当前证据**：interactions 可作为 transcript 原始材料；未发现 session state 或 exited/read-only 视图。

**当前状态**：未实现。

---

#### SC-AU03-C5 — 归档会话

**作为作者**，我把旧会话归档，让它不再出现在默认会话列表或普通上下文里，但需要时还能找回。

**触发**：对历史会话点击“归档”。

**期望结果**：
- session 状态变为 archived；
- 默认会话列表可隐藏 archived；
- archived session 默认不进入日常 context；
- 搜索/回放仍可访问；
- 归档不删除 transcript 和 trace。

**当前证据**：`WorkSessionService.archive/2` / `WorkSessionsController.archive/2` 已提供 work-scoped 归档入口；`WorkspaceChat` 会话列表可从真实工作台归档历史会话；`WorkspaceContext` 默认排除 archived session transcript；`bash scripts/tauri_slice_verify.sh au03-archive-session-filter` 已通过。

**当前状态**：最小真实前端闭环已实现。仍缺搜索命中定位、高亮和完整会话 replay 页面。

---

#### SC-AU03-C6 — 从历史会话继续时创建新会话或分支

**作为作者**，我打开一段历史会话，觉得可以继续聊。系统应明确创建新会话/分支引用它，而不是篡改旧 transcript。

**触发**：在历史会话点击“从这里继续”。

**期望结果**：
- 创建新的 active session；
- 新 session 记录 source_session_ref / source_turn_ref；
- 旧 session 保持 exited/read-only；
- 新 session 使用最新作品背景；
- trace 能说明引用了哪段历史。

**当前证据**：Replay/trace 有历史解释能力；未发现 session branch 入口。

**当前状态**：未实现。

---

### 场景组 D：历史会话与最新作品背景分离

#### SC-AU03-D1 — 历史 transcript 冻结，作品背景显示最新

**作为作者**，我打开一个月前的会话，当时主角还叫“林烬”，现在我已改名“林澈”。历史 transcript 应保留“林烬”，但作品背景面板应显示最新“林澈”。

**触发**：打开历史会话。

**期望结果**：
- transcript 不被最新背景重写；
- 作品背景/结构面板显示最新 Work 状态；
- UI 明确区分“历史会话内容”和“当前作品背景”；
- replay 使用历史 trace，不重新创作。

**当前证据**：设计文档有 replay 不改历史原则；当前缺 session UI。

**当前状态**：未实现。

---

#### SC-AU03-D2 — 归档会话不进入默认上下文召回

**作为作者**，我归档了旧会话后，日常创作不应继续被旧讨论影响，除非我主动引用它。

**触发**：归档一个会话后发起新会话。

**期望结果**：
- 默认 context 不包含 archived session transcript；
- 搜索/手动引用仍能找到 archived session；
- trace 说明是否引用了 archived source。

**当前证据**：`WorkspaceContext.context_fetcher/0` 和 `context_fetcher_with_query/0` 默认排除 `ARCHIVED` work session 的 transcript；`workspace_context_test.exs` 覆盖 fallback 和显式 session 两种路径；`au03-archive-session-filter` Tauri 证据覆盖真实工作台归档后默认列表隐藏与搜索找回。

**当前状态**：局部闭环。普通 context 过滤已测；显式引用 archived source 进入 prompt 的产品路径仍未实现。

---

#### SC-AU03-D3 — 切换作品时会话和上下文不串作品

**作为作者**，我从作品 A 切换到作品 B，B 的会话列表和 context 不应出现 A 的历史会话。

**触发**：切换作品。

**期望结果**：
- 会话列表按 Work 隔离；
- context 按 Work 隔离；
- 最近对话 summary 只来自当前 Work/session；
- pending 引用不串作品。

**当前证据**：SU-02 已记录作品切换隔离未闭环。

**当前状态**：依赖 SU-02，未完整验收。

---

### 场景组 E：来源可见与安全摘要

#### SC-AU03-E1 — 作者能看到 AI 引用了什么来源

**作为作者**，AI 给出建议后，我能看到它基于“当前作品背景”“当前会话最近对话”“已确认记忆”还是“历史会话引用”。

**触发**：查看 AI 回复的来源/决策详情。

**期望结果**：
- 每条来源有 source_type；
- 来源摘要是实际可读摘要，不是占位文本；
- 可区分 Work / active session / archived session / memory / behavior；
- 不暴露 raw prompt。

**当前证据**：`ContextSourceRef` 有 source_type；`ContextAssembler` 会从真实 Work snapshot、recent dialogue、memory summary 生成 author-safe summary；`TraceWriter` 输出 refs；真实 Tauri 工作台通过 `bash scripts/tauri_slice_verify.sh au03-context-source-ui` 证明普通回复 why 面板展示 current work / recent dialogue / memory 三类来源摘要。

**当前状态**：最小真实前端闭环已补。证据：`artifacts/slice-verify/au03-context-source-ui-tauri/summary.json`。剩余未覆盖：显式引用 archived source、历史旧 turn 查询和 developer 双视图。

---

#### SC-AU03-E2 — 引用摘要 author-safe

**作为作者**，我看到的上下文引用摘要不应包含系统 prompt、敏感 provider 原文或其他作品的数据。

**触发**：查看来源详情。

**期望结果**：
- author-safe 摘要不含 raw prompt；
- 不跨作品泄漏；
- sensitive / developer-only 信息不进入作者视图；
- developer trace 与 author trace 分层。

**当前证据**：`ContextSourceRef.redaction_level` 字段存在；AU-07 覆盖 trace 脱敏；`TraceWriter` / `TraceSummaryView` 均有 author-safe 过滤测试；`au03-context-source-ui` Tauri evidence 断言 why 面板不包含 raw prompt / provider raw / debug trace id。

**当前状态**：最小真实前端闭环已补；完整 developer 双视图和旧 trace 查询仍未闭环。

---

### 场景组 F：长会话与上下文压缩

#### SC-AU03-F1 — 长会话只带必要最近上下文

**作为作者**，我在一个会话里聊了 50 轮，系统不能把全部历史都塞进 prompt，但也不能丢掉最近关键内容。

**触发**：长会话持续对话。

**期望结果**：
- active session 有滚动 transcript；
- prompt 使用最近 turn + session summary；
- 原始历史仍可查看；
- summary 是派生物，不替代原始 transcript；
- token 长度可控。

**当前证据**：`WorkspaceContext.fetch_conversation_summary/1` 取最近 10 条 interactions。

**当前状态**：部分实现。只有最近 interactions，无 session summary/压缩策略/会话级配置。

---

#### SC-AU03-F2 — 历史会话可回放但不重新调用 LLM

**作为作者/开发者**，我回放历史会话时，系统解释当时发生了什么，而不是用当前模型重新生成一遍。

**触发**：打开历史会话 replay。

**期望结果**：
- replay 使用历史 TurnResult / trace；
- 不调用 provider；
- 如果缺历史数据，明确说明缺哪一层；
- 不改变当前作品状态。

**当前证据**：`ReplayService` 和 E2E reply-only replay 证明“不重新调用 provider”的后端基础。

**当前状态**：后端局部有证据，缺会话级 UI/数据模型闭环。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否完整前后端闭环 |
|---|---|---|---|
| SC-AU03-A1 | AI 知道当前作品最新基础背景 | 部分实现 | 否 |
| SC-AU03-A2 | 当前活跃会话引用最近对话 | 局部已实现 | 否 |
| SC-AU03-A3 | 引用已确认记忆/伏笔 | 未闭环 | 否 |
| SC-AU03-A4 | 感知当前开放行为 | 未实现 | 否 |
| SC-AU03-B1 | 空作品诚实说不知道 | 后端局部已测试 | 否 |
| SC-AU03-B2 | 有作品背景但无会话历史 | 缺测试/验收 | 否 |
| SC-AU03-B3 | context fetcher 异常不阻断聊天 | 未实现 | 否 |
| SC-AU03-C1 | 一个作品下有 N 个会话列表 | active session 列表基础已实现；缺历史打开/状态操作完整体验 | 部分 |
| SC-AU03-C2 | 新建作品内会话 | 后端 API 已实现；缺前端按钮与切换验收 | 否 |
| SC-AU03-C3 | 搜索历史会话 | 会话搜索 API/UI 基础已实现；缺打开匹配 turn 位置 | 部分 |
| SC-AU03-C4 | 历史会话退出/只读查看 | 未实现 | 否 |
| SC-AU03-C5 | 归档会话 | 最小真实前端闭环已实现；缺搜索命中定位/完整 replay 页面 | 是（最小闭环） |
| SC-AU03-C6 | 从历史会话继续创建新会话/分支 | 未实现 | 否 |
| SC-AU03-D1 | 历史 transcript 冻结，作品背景最新 | 未实现 | 否 |
| SC-AU03-D2 | 归档会话不默认进入 context | 默认 context 过滤已由 persistence/application 测试覆盖；显式引用路径未实现 | 部分 |
| SC-AU03-D3 | 切换作品不串会话/上下文 | 依赖 SU-02 | 否 |
| SC-AU03-E1 | 作者能看到引用来源 | 最小真实前端闭环已补 | 是（最小闭环） |
| SC-AU03-E2 | 引用摘要 author-safe | 最小真实前端闭环已补 | 是（最小闭环） |
| SC-AU03-F1 | 长会话上下文压缩 | 部分实现 | 否 |
| SC-AU03-F2 | 历史会话可回放不调 LLM | 后端局部有证据 | 否 |

**覆盖结论：20 个用户场景；AU-03C active session 恢复、历史只读、从历史分支继续、归档过滤、最新 Work 背景 SSOT、长会话压缩和上下文来源 UI 均已有原生 Tauri 闭环证据；剩余 AU-03 缺口集中在搜索命中 turn 定位/高亮、显式引用 archived source、作品切换隔离联动和完整 replay 页面。**

新增证据（2026-05-15）：

```bash
bash scripts/tauri_slice_verify.sh au03c-work-session-resume
```

该验证从真实 Tauri 工作台发起：生成 pending artifact → 关闭/重开 Tauri → 自动回到同一 active session → 恢复完整 transcript 与右侧 pending adoption。证据产物：`artifacts/slice-verify/au03c-work-session-resume-tauri/summary.json`。

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| AU03-GAP-01 — 缺作品内会话模型 | 已补 `WorkSession` 最小实体、历史只读、分支继续和归档最小状态流 | P1：补搜索命中 turn 定位、显式引用 archived source 和完整 replay 页面 |
| AU03-GAP-02 — 缺会话列表/搜索/归档 UI 与 API | 会话列表/搜索/打开历史/归档最小真实入口已补；匹配 turn 定位未闭环 | P1：补搜索结果定位和高亮 |
| AU03-GAP-03 — 历史会话退出/只读状态缺失 | 重新打开旧会话可能误恢复旧 pending 状态或篡改历史 | P0：定义 exited/read-only 状态和“从此继续”分支 |
| AU03-GAP-04 — Work 最新背景未接入 context snapshot | AI 可能拿不到当前作品 title/genre/设定 | P0：把 Context fetcher 从旧 Workspace 对齐到 VS-09 Work |
| AU03-GAP-05 — memory_summary 未接入 | AI 无法基于已确认伏笔/规则回答 | P1：接 memory recall 到 context |
| AU03-GAP-06 — behavior_summary 未接入 | open behavior / 等待确认容易丢 | P1：接 behavior summary |
| AU03-GAP-07 — ContextSourceRef.summary 占位 | 已补真实 Work / recent dialogue / memory 的 author-safe 来源摘要，并由真实 Tauri why 面板验收 | closed：`artifacts/slice-verify/au03-context-source-ui-tauri/summary.json` |
| AU03-GAP-08 — context fetcher 异常无保护 | DB 抖动可导致整轮对话失败 | P1：ContextAssembler fallback empty context + trace warning |
| AU03-GAP-09 — 归档会话过滤缺失 | 默认 context 过滤已补；显式引用 archived session 进入 context 尚未设计 | P1：支持作者主动引用 archived session source，并在 trace 中说明来源 |
| AU03-GAP-10 — 长会话只有最近 10 条硬截断 | 可能丢关键上下文，且无 session summary | P2：补 session summary/压缩策略 |
| AU03-GAP-11 — 作品切换会话隔离未验收 | 跨作品会话/上下文污染风险 | P0/P1：与 SU-02 联动验收 |

---

## 7. 已有证据与限制

| 证据 | 证明了什么 | 不能证明什么 |
|---|---|---|
| `context_grounding_test.exs` | ContextAssembler 可组装 snapshot/conversation/memory stub；空 context 不编造 stub 事实 | 真实 Work、session、memory 是否接入 |
| `workspace_context_test.exs` | interactions 可形成 conversation_summary；active session transcript 可隔离；archived session transcript 默认不进 ordinary context | 显式引用 archived source 和最新 Work 背景 SSOT |
| `dialogue_gateway_real_loop_test.exs` | 同 workspace 两轮可读到上一轮 interaction | 作品下多会话、当前会话与历史会话分离 |
| `ReplayService` / E2E replay | replay 可不调 provider | 会话级 replay UI 和历史 transcript 管理 |
| `MemoryListPage` / memory API | 记忆管理有搜索/归档基础 | 会话搜索/归档不是同一能力 |
| `WorkspaceContext.context_fetcher/0` | 真实 persistence 注入点存在 | 当前只返回 conversation summary，memory/behavior nil，snapshot 查旧 workspace |
| `au03-archive-session-filter` | 真实工作台可归档历史会话；默认列表隐藏 archived；显式搜索仍可找回并只读打开；普通 context 默认排除 archived transcript 有局部测试 | 不证明最新 Work 背景 SSOT、显式引用 archived source、搜索命中 turn 定位或完整 replay 页面 |

---

## 8. 验收命令

```bash
# 现有上下文局部证据
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
mix test apps/novel_persistence/test/novel_persistence/workspace_context_test.exs
mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs

# 仍需补：作品内会话管理验收
# 目标：同一 Work 下新建多个 session -> 列表/搜索/归档 -> 打开历史 session 为只读 -> 当前作品背景仍为最新 -> 从历史继续创建新 session/branch
```

> 注意：AU-03 的完整验收必须证明“最新作品背景”和“历史会话 transcript”分层正确。仅证明 `conversation_summary` 进入 prompt，不等于 AI 真的按作品多会话模型理解作者的作品。
