# AU-03 AI 了解我的作品

> 作者视角：AI 应该了解当前作品的最新背景、设定、角色、记忆和当前创作状态；同时，一个作品里会有多次会话，每次会话都有自己的历史 transcript。历史会话可以搜索、查看、归档，但重新进入历史会话时应是退出/只读状态，作品背景仍显示最新版本。
>
> 2026-06-21 文件级对账结论：当前 checkout 已有 WorkSession、sessions API、会话搜索/只读/归档 UI、最新 Work snapshot、active session transcript、memory recall 和上下文来源摘要基础。当前可从 `bash scripts/tauri_slice_verify.sh --list` 直接复跑的 AU-03 证据包括 `au03-session-new-active`、`au03-session-history-readonly`、`au03-branch-from-history`、`au03-archive-session-filter`、`au03-current-work-context-ssot`、`au03-context-source-ui`、`au03-long-session-compression`，以及跨 AU-09 的 `au09-au03-session-memory-layering`。本轮已复跑上述 8 条默认 Tauri driver、7 条 AU-03 quality acceptance 入口，并补 `au03-current-work-context-ssot --real-lmstudio` / `quality_accept --provider lmstudio` 当前证据；`tasks/slices/AU03-file-level-closure.md` 已补文件级收口记录。剩余文件级缺口集中在搜索命中 turn 定位/高亮、显式引用 archived source、open behavior summary、完整 replay 页面和 AU-07 developer trace 视图。
>
> 2026-06-22 二轮复核结论：本轮按剩余 P1/P2、external blocker 与 cross-reference 重新核对，不回退第一轮 file-level deliverable。已串行复跑 `au03-session-new-active`、`au03-session-history-readonly`、`au03-branch-from-history`、`au03-archive-session-filter`、`au03-current-work-context-ssot`、`au03-context-source-ui`、`au03-long-session-compression`、`au09-au03-session-memory-layering` 的 quality acceptance 入口，以及 `au03-current-work-context-ssot --provider lmstudio`；全部通过。后续依赖复核确认 `au11-missing-workstate-policy` 可作为 SC-AU03-B1 的 missing WorkState cross evidence：真实 Tauri 工作台在仅有标题、缺章节/正文/人物状态的 work 下显式记录 missing 且不编造当前章。依赖 checkpoint 已关闭 SC-AU03-A4：`WorkspaceContext` 现在从最新 assistant TurnResult 的 active behavior 生成 author-safe `behavior_summary`，`DialogueContext.to_prompt_text/1` 写入“当前待处理动作”，`au06-single-active-confirmation` 真实 Tauri driver 证明第二个高风险 confirmation turn 消费了上一轮开放 confirmation context ref，且不泄漏 behavior/action id。显式 archived source、developer trace 与 replay 仍归 AU-07/AU-09，完整 empty/work-only/failure UI/LLM 矩阵仍登记为 AU-03 后续或 AU-11 missing-context robustness checkpoint。

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
| `works` / `WorkService` | 当前作品实体与最新作品背景入口 | 已接入 `WorkspaceContext.fetch_workspace_info/1`；snapshot 进入 `DialogueContext.current_work_snapshot` 与 provider prompt，并由 `au03-current-work-context-ssot` / `--real-lmstudio` 复跑证明 |
| `workspaces` | 旧 UI workspace 表 | 仅保留 legacy 非 UUID `workspace_id` fallback；正式 work/session 主链使用 VS-09 `works.id` |
| `interactions` | turn 级 user/assistant 日志 | 已实现；可作为 transcript 底层材料 |
| `WorkspaceContext.context_fetcher/0` / `context_fetcher_with_query/0` | 真实 persistence context fetcher | 返回最新 Work snapshot、会话 summary、memory summary、章节结构和最新 active behavior summary；active session 按 `session_id` 取最近 transcript，默认排除 archived session；已测试 latest-turn-cleared 和 archived session 不复活旧等待态 |
| `ContextAssembler` | 组装 DialogueContext | 已有 `safe_fetch` 降级为空上下文，支持 `current_work` / `session_transcript` / `memory` / `behavior` context refs 和 author-safe summary |
| `DialogueContext.to_prompt_text/1` | 把上下文写入 LLM prompt | 有单测覆盖非空段落和当前待处理动作段落 |
| `TraceWriter` / `TraceSummaryView` | 记录和展示 context_refs | 已记录 author-safe context refs；`au03-context-source-ui` 证明 why 面板可展示 current work / session or recent dialogue / memory，并排除 raw prompt/provider debug |
| 会话 Session / Conversation 表 | 作品内多会话、会话状态、归档、搜索 | 已补 `WorkSession`、resume/show/search/create/archive API 和工作台 UI；`au03-session-history-readonly`、`au03-session-new-active`、`au03-branch-from-history`、`au03-archive-session-filter` 已接当前可复跑入口；仍缺搜索命中 turn 定位/高亮、显式引用 archived source 和完整 replay 页面 |
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

**当前证据**：`WorkspaceContext.fetch_workspace_info/1` 从 `works` 读取 title / genre / core_selling_point / target_reader / tone_preference；`dialogue_gateway_real_loop_test.exs` 覆盖最新 Work snapshot 与 active session transcript 分层；`bash scripts/tauri_slice_verify.sh au03-current-work-context-ssot` 与 `bash scripts/tauri_slice_verify.sh --real-lmstudio au03-current-work-context-ssot` 证明真实工作台打开历史只读会话后返回 active session，下一轮 provider prompt 使用最新 Work 背景和当前 active session transcript，未带入历史旧设定。

**当前状态**：已验收。剩余仅是作品档案侧栏展示更细粒度最新背景的 AU-12/档案视图联动，不阻塞本场景的上下文主链。

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

**当前证据**：`WorkspaceContext.interaction_recorder/0` 写入 `interactions`；`WorkspaceContext.context_fetcher_with_query/0` 按 active `session_id` 读取最近 transcript；`dialogue_gateway_real_loop_test.exs` 覆盖同 session 第二轮 prompt 历史 messages、跨 session transcript 不串、长会话最近窗口；`au03-current-work-context-ssot` 真实 Tauri/LMStudio 证明 active session transcript 进入 provider request 且历史 session transcript 未泄漏。

**当前状态**：已验收。搜索命中 turn 定位不属于本场景，仍登记在 SC-AU03-C3。

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

**当前证据**：`WorkspaceContext.context_fetcher_with_query/0` 调用 `MemoryRecallRepo.recall/3` 并写 `MemoryReferenceLog`；`workspace_context_test.exs` / `dialogue_gateway_real_loop_test.exs` 覆盖 confirmed recallable memory 进入 prompt 和 trace；`au03-context-source-ui` 证明真实工作台 why 面板展示 memory 来源；跨 AU-09 的 `au09-au03-session-memory-layering` 证明 active session / historical session / governed memory 分层且历史 transcript 不伪装成 memory。

**当前状态**：已验收（AU-03 视角的 recall-to-context 与来源可见）。完整记忆生命周期、状态机和 developer replay 归 AU-09/AU-07 继续闭环。

---

#### SC-AU03-A4 — AI 能感知当前开放行为

**作为作者**，如果系统正在等我确认某个计划，AI 下一轮应知道“有等待中的确认”，而不是当作普通聊天忘掉它。

**触发**：存在 open behavior / pending confirmation 时继续对话。

**期望结果**：
- `behavior_summary` 非空；
- prompt 中包含开放行为摘要；
- AI 不丢失等待态；
- 历史会话中的旧 waiting 状态不会在重新查看时恢复。

**当前证据**：`WorkspaceContext.context_fetcher/0` / `context_fetcher_with_query/0` 会从最新 assistant TurnResult 的 `behavior_state.active` 生成 author-safe `behavior_summary`，只暴露“当前有待作者确认的操作/章节正文草稿/确认或取消前不能执行工具或写入作品事实”这类作者可读摘要，不暴露 behavior_id/action_id；`DialogueContext.to_prompt_text/1` 会写入 `## 当前待处理动作`。`workspace_context_test.exs` 覆盖 latest active behavior、latest turn cleared 后不复用旧 behavior、archived session active behavior 不进入 fallback；`context_grounding_test.exs` 覆盖 behavior summary 进入 prompt 和 author-safe context refs；`au06-single-active-confirmation` 真实 Tauri / quality acceptance 已证明第二个高风险 confirmation turn 的 `trace_summary.context_refs` 包含 behavior source，且 summary 不泄漏上一轮 behavior/action id。

**当前状态**：已验收。该证据关闭 AU-03 A4 当前开放行为上下文；完整 confirmation terminal replay、blocking clarification 和持久 BehaviorBinding ledger 仍归 AU-06/AU-07 后续 owner。

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

**当前证据**：`ContextAssembler.safe_fetch/4` 捕获异常、非 ok 返回和 throw，降级到 empty context 并发出 `context.assemble.error`，避免整轮崩溃。

**当前状态**：已实现未验收。缺真实 UI/LLM 故障注入验收来证明作者可见恢复文案和下一轮继续能力。

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

**当前证据**：`WorkSession` / `WorkSessionService.resume/1` / `WorkSessionsController.resume/2` 已提供 work-scoped active session 列表；`WorkspaceChat` 右侧会话区可显示当前 Work 的会话标题与状态。`WorkSessionRepo.list_by_work/2` 默认隐藏 archived session。

**当前状态**：部分实现。已有列表、只读、分支和归档基础；仍缺完整状态操作矩阵、搜索命中 turn 定位/高亮，以及 AU-03 专属跨作品会话列表矩阵。

---

#### SC-AU03-C2 — 新建作品内会话

**作为作者**，我可以在同一作品里新开一次会话讨论另一个主题。

**触发**：点击“新建会话”。

**期望结果**：
- 创建新的 session id；
- 新会话属于当前 Work；
- 新会话开始时可读取最新作品背景；
- 不自动带入其他会话 transcript，除非被明确引用。

**当前证据**：`WorkSessionService.create/2` / `WorkSessionsController.create/2` 可创建新的 work-scoped active session；`WorkSessionRepo.create_active/1` 会把同作品旧 active session 标为 `EXITED`，保持单 active 语义；`WorkspaceChat` 右侧会话区已有“新建会话”图标入口，创建后复用 `openWork` 重新 join 新 active session。当前有 persistence/application/controller/frontend 组件测试，并有 `bash scripts/tauri_slice_verify.sh au03-session-new-active` 真实 Tauri 证据：作者从真实工作台点击“新建会话”，新 session 以 `transcript_count=0` rejoin，旧 active session 变为 `EXITED` 且可作为只读历史打开，下一轮 `user_message` 绑定到新 session，`context.assemble.done.has_conversation=false`。

**当前状态**：已验收。仍缺搜索命中 turn 定位/高亮和完整 replay 页面，登记在 SC-AU03-C3/F2。

---

#### SC-AU03-C3 — 搜索历史会话

**作为作者**，我想找之前聊过“妹妹林瑶”的会话，可以搜索关键词并打开结果。

**触发**：在会话列表输入关键词搜索。

**期望结果**：
- 搜索会话标题、摘要、transcript；
- 结果限定当前 Work；
- 可打开匹配 turn 的位置；
- 归档会话默认也可被搜索，除非过滤关闭。

**当前证据**：`WorkSessionRepo.search/2` 搜索会话 title/summary/transcript，并限定当前 Work；`WorkSessionsController.index/2` 暴露 query API；`WorkspaceChat` 会话搜索框会刷新会话列表；`au03-session-history-readonly` 已用真实 Tauri 搜索历史会话并打开只读 transcript。

**当前状态**：部分实现。搜索到 session 并打开已可用；“匹配 turn 的位置/高亮”和搜索结果解释仍未实现。

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

**当前证据**：`WorkSessionService.show/2` / `WorkSessionsController.show/2` 可返回 scoped transcript 和 `read_only`；`WorkspaceChat` 会话搜索可打开 exited session 并显示只读提示；`bash scripts/tauri_slice_verify.sh au03-session-history-readonly` 由外部 driver 搜索“林瑶旧线索”、打开历史 transcript、证明旧 pending adoption 不恢复、输入/发送禁用，并可返回当前 active session。

**当前状态**：最小真实前端闭环已接入当前验收入口。仍缺搜索命中 turn 定位、高亮和完整 replay 页面。

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

**当前证据**：`WorkSessionService.archive/2` / `WorkSessionsController.archive/2` 已提供 work-scoped 归档入口；`WorkspaceChat` 会话列表具备归档历史会话能力；`WorkspaceContext` 默认排除 archived session transcript。`bash scripts/tauri_slice_verify.sh au03-archive-session-filter` 当前可复跑：真实工作台搜索并打开历史会话，点击可见“归档会话”入口，后端记录 `work_session.archive.done` 与 `status=ARCHIVED`，默认会话列表隐藏 archived，会话仍可通过显式搜索找回并以只读 transcript 打开，trace/transcript 未删除；普通 context 默认排除 archived transcript 由 `workspace_context_test.exs` 覆盖。

**当前状态**：已验收。仍缺搜索命中定位/高亮、显式引用 archived source 进入 prompt 的产品路径，以及完整会话 replay 页面。

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

**当前证据**：`WorkspaceChat.handleBranchFromReadOnlySession/0` 会在历史只读视图点击“从这里继续”时调用 `createWorkSession/2`，传入 `source_session_ref` 和可得的 `source_turn_ref`；`WorkSessionService.create/2` 会创建新的 active session 并退出旧 active session，旧历史 session 不被篡改。`bash scripts/tauri_slice_verify.sh au03-branch-from-history` 已通过真实 Tauri 验收：从真实工作台搜索并打开“林瑶旧线索讨论”历史只读会话，点击“从这里继续”，`work_session.create.done` 携带历史 `source_session_ref` 与 `source_turn_ref=turn_history_1`，工作台 rejoin 新 active session，且新 session 首屏为空、不复制旧历史 transcript。

**当前状态**：已验收。仍缺 trace 对“引用了哪段历史”的作者可见说明和完整 replay 页面。

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

**当前证据**：`au03-session-history-readonly` 证明历史 transcript 原样只读展示、旧 pending adoption 不恢复；`au03-current-work-context-ssot` 证明从历史只读会话返回 active session 后，下一轮 provider prompt 使用最新 Work snapshot 和 active session transcript，历史旧 transcript 未替代当前事实。尚未完成的是同屏作品背景/结构面板的显式最新状态展示，以及会话 replay 页面。

**当前状态**：部分实现。

---

#### SC-AU03-D2 — 归档会话不进入默认上下文召回

**作为作者**，我归档了旧会话后，日常创作不应继续被旧讨论影响，除非我主动引用它。

**触发**：归档一个会话后发起新会话。

**期望结果**：
- 默认 context 不包含 archived session transcript；
- 搜索/手动引用仍能找到 archived session；
- trace 说明是否引用了 archived source。

**当前证据**：`WorkspaceContext.context_fetcher/0` 和 `context_fetcher_with_query/0` 默认排除 `ARCHIVED` work session 的 transcript；`workspace_context_test.exs` 覆盖 fallback 和显式 session 两种路径。`au03-archive-session-filter` 当前真实 Tauri 验收证明归档后默认列表隐藏 archived，显式搜索仍能找回并只读打开，且 verifier 断言普通 context 过滤由 app test 覆盖。

**当前状态**：已验收。显式引用 archived source 进入 prompt 的产品路径和 trace 来源说明仍未实现，登记为 AU-07/AU-09 cross-reference。

---

#### SC-AU03-D3 — 切换作品时会话和上下文不串作品

**作为作者**，我从作品 A 切换到作品 B，B 的会话列表和 context 不应出现 A 的历史会话。

**触发**：切换作品。

**期望结果**：
- 会话列表按 Work 隔离；
- context 按 Work 隔离；
- 最近对话 summary 只来自当前 Work/session；
- pending 引用不串作品。

**当前证据**：SU-02 已有作品运行时切换、消息流隔离、慢回复迟到归属、artifact/projection/trace 隔离真实 Tauri 证据；跨 AU-09 的 `au09-cross-work-memory-isolation` 证明真实工作台跨作品切换后档案、记忆页、ordinary recall 和 why 不串作品；`au09-au03-session-memory-layering` 证明同一作品内 active/historical session 与 governed memory 分层。

**当前状态**：已验收。AU-03 专属剩余是会话列表跨作品状态矩阵的细化，不再作为 P0 阻塞。

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

**当前状态**：最小真实前端闭环已补。证据：`artifacts/slice-verify/au03-context-source-ui-tauri/summary.json`。普通旧 turn scoped query 已由 AU-07 `au07-persisted-trace-query` 回填，partial replay 作者提示已由 `au07-partial-replay-ui` 回填；剩余未覆盖：显式引用 archived source、完整会话级 replay / developer / 多类型 UI。

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

**当前状态**：已验收。`au03-long-session-compression` 证明长会话最近窗口进入 prompt 且旧 transcript 可查看；完整 session summary/压缩策略/会话级配置为 P2 后续。

---

#### SC-AU03-F2 — 历史会话可回放但不重新调用 LLM

**作为作者/开发者**，我回放历史会话时，系统解释当时发生了什么，而不是用当前模型重新生成一遍。

**触发**：打开历史会话 replay。

**期望结果**：
- replay 使用历史 TurnResult / trace；
- 不调用 provider；
- 如果缺历史数据，明确说明缺哪一层；
- 不改变当前作品状态。

**当前证据**：`ReplayService` 和 E2E reply-only replay 证明“不重新调用 provider”的后端基础；`au07-persisted-trace-query` 证明真实 Tauri reload 后旧 turn “为什么”可按 work/session/turn scope 查询持久 trace 并渲染 no-provider replay；`au07-trace-query-scope-negative-matrix` 证明跨 work、跨 session、same-work other session 和 missing turn replay 查询均返回 404 且不泄露 trace。

**当前状态**：普通旧 turn 最小 UI/API、partial replay 作者提示和 scoped negative matrix 证据已由 AU-07 回填；会话级完整 replay、developer view、多类型 UI 仍未闭环。

---

## 5. 场景对账矩阵

| 场景 ID / 名称 | 设计期望 | contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint / slice |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU03-A1 最新基础背景 | 使用当前 Work 最新 title/genre/设定，不用旧 Workspace | `WorkService`；`WorkspaceContext`；AU03-I4 | `WorkspaceContext.fetch_workspace_info/1` | `dialogue_gateway_real_loop_test.exs` | `au03-current-work-context-ssot`；`--real-lmstudio` 同 slice | 已验收 | 无 | 无 | closed | `AU03-current-work-archive-evidence-entry` |
| SC-AU03-A2 当前会话最近对话 | active session 第二轮可引用第一轮 | `interactions`；`session_id` transcript；AU03-I4 | `context_fetcher_with_query/0` | `dialogue_gateway_real_loop_test.exs` | `au03-current-work-context-ssot` | 已验收 | 无 | 无 | closed | 同上 |
| SC-AU03-A3 已确认记忆/伏笔 | confirmed memory 进入 prompt/trace，历史 transcript 不伪装成 memory | `MemoryRecallRepo`；`ContextSourceRef`；AU03-I3 | `WorkspaceContext.context_fetcher_with_query/0` | `workspace_context_test.exs` | `au03-context-source-ui`；`au09-au03-session-memory-layering` | 已验收 | 无 | 无 | closed | AU-09 lifecycle 继续覆盖完整记忆状态机 |
| SC-AU03-A4 当前开放行为 | open behavior / pending confirmation 进入上下文 | `behavior_summary`；AU03-I4 | `WorkspaceContext.fetch_behavior_summary/2`；`DialogueContext.to_prompt_text/1` | `workspace_context_test.exs`；`context_grounding_test.exs` | `au06-single-active-confirmation` | 已验收 | 完整 terminal replay/ledger 归 AU-06/AU-07 | closed / cross-reference | closed | 保持 AU-06 回归；terminal replay 走 AU-07 owner |
| SC-AU03-B1 空作品诚实不知道 | 无 context 时不编造事实 | AU03-I2 | `ContextAssembler` / prompt builder | `context_grounding_test.exs` | `au11-missing-workstate-policy` 作为 missing WorkState cross evidence | 已测试 | 完整 empty/no-facts 真实 UI/LLM 反证仍不足 | 补验收（完整矩阵） | P1 | 空作品真实 LLM 反证 |
| SC-AU03-B2 有背景无会话 | 只引用 Work 背景，不伪造“刚才讨论” | `current_work_snapshot`；AU03-I2 | `WorkspaceContext.fetch_workspace_info/1` | 无专属测试 | 无 | 不确定 | 证据不足 | 补测试 | P1 | Work-only context test + Tauri 验收 |
| SC-AU03-B3 fetcher 异常降级 | context 读取失败时 empty context + warning，不阻断 turn | `ContextAssembler.safe_fetch/4` | `ContextAssembler` | safe_fetch 单元覆盖 | 无 | 已实现未验收 | 无 | 补验收 | P1 | 真实 UI/LLM 故障注入 |
| SC-AU03-C1 会话列表 | work-scoped N 个会话、状态可见、不串作品 | `WorkSession`；AU03-I5/I7 | `WorkSessionService.resume/1`；`WorkspaceChat` 会话区 | service/controller/component tests | `au03-session-new-active`；`au03-session-history-readonly`；`au03-archive-session-filter` | 部分实现 | 状态矩阵和跨作品细化不足 | 补验收 | P2 | 会话列表状态矩阵 |
| SC-AU03-C2 新建作品内会话 | 创建新 active session，旧 active 退出，新会话不带旧 transcript | `WorkSessionService.create/2`；AU03-I4/I7 | `createWorkSession` / `openWork` | persistence/application/controller/frontend tests | `au03-session-new-active` | 已验收 | 无 | 无 | closed | `AU03-session-new-active.md` |
| SC-AU03-C3 搜索历史会话 | 搜索 title/summary/transcript，可定位匹配 turn | `WorkSessionRepo.search/2` | `WorkSessionsController.index/2`；`WorkspaceChat` 搜索框 | repo/controller tests | `au03-session-history-readonly` 搜索并打开 session | 部分实现 | 缺 turn 定位/高亮 | 补实现 | P2 | 搜索结果 turn 定位/高亮 |
| SC-AU03-C4 历史只读回看 | 退出会话只读，不恢复 loading/action/confirmation | `show/2` read_only；AU03-I5 | `WorkSessionService.show/2`；`WorkspaceChat` 只读视图 | service/controller/component tests | `au03-session-history-readonly` | 已验收 | 无 | 无 | closed | `AU03-session-history-readonly.md` |
| SC-AU03-C5 归档会话 | archived 默认隐藏，不删 transcript，可搜索回看 | `archive/2`；AU03-I6 | `WorkSessionService.archive/2`；会话列表归档按钮 | `workspace_context_test.exs` 覆盖 archived context filter | `au03-archive-session-filter` | 已验收 | 无 | 无 | closed | `AU03-current-work-archive-evidence-entry` |
| SC-AU03-C6 从历史继续 | 创建新 active branch，记录 source refs，不改旧 transcript | `source_session_ref` / `source_turn_ref`；AU03-I7 | `handleBranchFromReadOnlySession` | service/controller/component tests | `au03-branch-from-history` | 已验收 | 无 | 无 | closed | `AU03-branch-from-history.md` |
| SC-AU03-D1 历史 transcript 冻结，背景最新 | 历史内容不被重写，当前背景仍取最新 Work | AU03-I4/I5 | read-only session + context fetcher | `dialogue_gateway_real_loop_test.exs` | `au03-session-history-readonly`；`au03-current-work-context-ssot` | 部分实现 | 同屏作品背景面板/完整 replay 未闭环 | 补验收 | P2 | AU-12 profile + AU-07 replay 联动 |
| SC-AU03-D2 archived 不默认进 context | archived transcript 不进普通 prompt，显式引用另行标明 | AU03-I6 | `context_fetcher_with_query/0` | `workspace_context_test.exs` | `au03-archive-session-filter` | 已验收 | 显式引用 archived source 还缺产品路径 | 补实现 | P1 | AU-07/AU-09 source reference checkpoint |
| SC-AU03-D3 切换作品不串上下文 | work/session/context 均按当前 Work 隔离 | SU-02 isolation；AU03-I4 | work switch runtime + `WorkspaceContext` | SU-02/AU-09 tests | SU-02 隔离 slices；`au09-cross-work-memory-isolation`；`au09-au03-session-memory-layering` | 已验收 | AU-03 会话列表专属矩阵可细化 | 补验收 | P2 | 会话列表 cross-work matrix |
| SC-AU03-E1 作者可见来源 | why 中区分 Work/session/memory/archived/behavior 来源 | `ContextSourceRef`；AU03-I3 | `TraceWriter` / `TraceSummaryView` | trace summary tests | `au03-context-source-ui` | 已验收 | archived/behavior 来源未覆盖 | 补实现 | P1 | AU-07 source detail |
| SC-AU03-E2 author-safe 摘要 | 不暴露 raw prompt/provider/debug/跨作品数据 | `redaction_level`；AU03-I3 | `TraceSummaryView` | author-safe 过滤测试 | `au03-context-source-ui` | 已验收 | developer 双视图未闭环 | 补验收 | P1 | AU-07 developer trace |
| SC-AU03-F1 长会话压缩 | 最近必要上下文进入 prompt，原 transcript 可查看 | `fetch_conversation_summary/1` | `WorkspaceContext` | context tests | `au03-long-session-compression` | 已验收 | 还没有完整 session summary 策略 | 补实现 | P2 | session summary / compression strategy |
| SC-AU03-F2 replay 不调 LLM | 历史回放使用 TurnResult/trace，不重新创作 | Replay contract；AU03-I5 | `ReplayService`；`TraceReplayService` | E2E reply-only replay；AU-07 scoped query tests | `au07-persisted-trace-query` 作为普通旧 turn scoped query / no-provider replay cross evidence；`au07-partial-replay-ui` 作为 partial replay 诚实提示 cross evidence；`au07-trace-query-scope-negative-matrix` 作为 scoped negative matrix cross evidence | 已测试 | 完整会话级 replay、developer view、多类型 UI 未闭环 | 补实现 | P1 | owner: AU-07 replay |

**覆盖结论：20 个用户场景；当前 13/20 已验收，2/20 已测试，3/20 部分实现，1/20 已实现未验收，0/20 未实现，1/20 不确定。新增当前可复跑证据并补 `tasks/slices/AU03-file-level-closure.md` 后，AU-03 的 P0 缺口已关闭；`au11-missing-workstate-policy` 已补 SC-AU03-B1 的 missing WorkState cross evidence，`au06-single-active-confirmation` 已补 SC-AU03-A4 的开放 behavior context evidence，`au07-persisted-trace-query` 已补 SC-AU03-F2 普通旧 turn no-provider replay cross evidence，`au07-partial-replay-ui` 已补 partial replay 诚实提示 cross evidence，`au07-trace-query-scope-negative-matrix` 已补 scoped negative matrix cross evidence；这些不等同完整 empty/work-only/failure、terminal replay 或会话级完整 replay/developer/多类型矩阵闭环。剩余 P1 主要是 Work-only/empty/failure 真实验收、显式 archived source、AU-07 完整 trace/replay，P2 是搜索 turn 高亮、完整状态矩阵和压缩策略细化。**

当前可复跑证据入口（2026-06-21）：

```bash
bash scripts/tauri_slice_verify.sh au03-session-new-active
bash scripts/tauri_slice_verify.sh au03-session-history-readonly
bash scripts/tauri_slice_verify.sh au03-branch-from-history
bash scripts/tauri_slice_verify.sh au03-archive-session-filter
bash scripts/tauri_slice_verify.sh au03-current-work-context-ssot
bash scripts/tauri_slice_verify.sh --real-lmstudio au03-current-work-context-ssot
bash scripts/tauri_slice_verify.sh au03-context-source-ui
bash scripts/tauri_slice_verify.sh au03-long-session-compression
bash scripts/tauri_slice_verify.sh au09-au03-session-memory-layering
```

其中 `au03-current-work-context-ssot` 对应 SC-AU03-A1/A2/D1：真实 Tauri 工作台打开历史只读会话后返回 active session，发送关于主角动机的问题，provider prompt 使用最新 Work snapshot 与 active session transcript；`--real-lmstudio` 变体验证真实 LM Studio 请求链路。

其中 `au03-archive-session-filter` 对应 SC-AU03-C5/D2：真实 Tauri 工作台搜索历史会话、点击“归档会话”、验证默认列表隐藏 archived，再显式搜索找回并只读打开；verifier 同时核对普通 context filter 的局部测试覆盖。

其中 `au03-session-new-active` 对应 SC-AU03-C2：真实 Tauri 工作台点击“新建会话”后创建新 active session 并以空 transcript rejoin，旧 active session 变为 `EXITED` 且可只读打开，下一轮 `user_message` 绑定到新 session，旧 transcript 不进入新会话。

其中 `au03-session-history-readonly` 对应 SC-AU03-C4：真实 Tauri 工作台搜索“林瑶旧线索”，打开 exited 历史会话，展示历史 transcript 和只读提示，旧 pending adoption 不恢复，输入/发送禁用，可返回当前 active session。

其中 `au03-branch-from-history` 对应 SC-AU03-C6：真实 Tauri 工作台搜索“林瑶旧线索”，打开历史只读会话，点击“从这里继续”，创建新的 active branch session，`source_session_ref` 指向历史 session、`source_turn_ref=turn_history_1`，新 session 首屏为空，不复制旧历史 transcript。

---

## 6. 缺口分级

| 缺口 | 影响 | 当前处置 |
|---|---|---|
| AU03-GAP-01 — 作品内会话模型 | WorkSession、历史只读、新建空白会话、从历史继续分支、归档状态流均已形成真实入口 | closed；P2 后续补完整状态矩阵 |
| AU03-GAP-02 — 会话列表/搜索/归档 UI 与 API | 会话列表/搜索/打开历史/归档最小真实入口已补；匹配 turn 定位未闭环 | P2：补搜索结果定位和高亮 |
| AU03-GAP-03 — 历史会话退出/只读状态 | C4 只读回看、C6 从历史继续、C5 归档回看均已有真实 Tauri 证据；普通旧 turn scoped replay query 与 partial replay UI 已由 AU-07 回填 | closed；P1/P2：完整会话级 replay/developer/多类型 UI 由 AU-07 owner |
| AU03-GAP-04 — Work 最新背景接入 context snapshot | 已由 `WorkspaceContext.fetch_workspace_info/1` 和 `au03-current-work-context-ssot --real-lmstudio` 证明 | closed |
| AU03-GAP-05 — memory_summary 接入 | 已由 memory recall、why 面板与 AU09-AU03 layering 证明 AU-03 视角的 recall-to-context | closed；完整生命周期归 AU-09 |
| AU03-GAP-06 — behavior_summary 接入 | 最新 active behavior / 等待确认已进入 author-safe context summary 和 prompt | closed；由 AU-03 依赖 checkpoint + `au06-single-active-confirmation` 证明，terminal replay/ledger 仍归 AU-06/AU-07 |
| AU03-GAP-07 — ContextSourceRef.summary 占位 | Work / recent dialogue / memory author-safe summary 已由真实 Tauri why 面板验收，behavior context ref 已由 AU-06 driver 证明 | closed；显式 archived source 和 developer 双视图归 AU-07/AU-09 |
| AU03-GAP-08 — context fetcher 异常保护 | `ContextAssembler.safe_fetch/4` 已降级为空上下文并记录 error | 已实现未验收；P1 补真实故障 UI/LLM 验收 |
| AU03-GAP-09 — 归档会话过滤 | 默认列表隐藏和普通 context 排除 archived 已闭环 | closed；P1 补显式 archived source 引用与 trace |
| AU03-GAP-10 — 长会话只有最近 10 条硬截断 | 当前有真实 long-session checkpoint；完整 session summary 策略未补 | P2：session summary/压缩策略 |
| AU03-GAP-11 — 作品切换会话隔离 | SU-02/AU-09 已覆盖跨作品切换、artifact/projection/trace/memory 隔离 | closed；P2 可补 AU-03 专属会话列表矩阵 |

文件级完成计划：

| 类型 | 项目 | Owner / 恢复路径 |
|---|---|---|
| 必须关闭的 P0 | Work 最新背景 SSOT、归档过滤当前入口、active/historical session 分层 | 本轮关闭；证据为 `au03-current-work-context-ssot`、`--real-lmstudio`、`au03-archive-session-filter` |
| 应关闭的 P1 | empty/work-only/failure UI、显式 archived source、完整 replay/trace | `behavior_summary` 已由本轮依赖 checkpoint 关闭；其余登记为 AU-03 后续、AU-07、AU-09 cross-reference。SC-AU03-B1 的 missing WorkState 子证据已由 `au11-missing-workstate-policy` 补强，但完整 empty/work-only/failure 矩阵仍不阻塞 AU-03 文件级进入 AU-04 |
| 可登记 P2 | 搜索 turn 定位/高亮、会话列表状态矩阵、session summary 策略、AU-03 专属跨作品会话列表矩阵 | 后续 checkpoint 按对应 owner 文件恢复 |

---

## 7. 已有证据与限制

| 证据 | 证明了什么 | 不能证明什么 |
|---|---|---|
| `context_grounding_test.exs` | ContextAssembler 可组装 snapshot/conversation/memory stub；空 context 不编造 stub 事实 | 真实 UI/LLM 空作品文案 |
| `au11-missing-workstate-policy` | 真实 Tauri 工作台在仅有标题、缺章节/正文/人物状态的 work 下显式记录 WorkState missing，assistant 要求补材料且不声称已读当前章，why 可见 missing，no tool/adoption/write | 完整 empty/no-facts、work-only 和 fetcher failure UI/LLM 矩阵 |
| `workspace_context_test.exs` | interactions 可形成 conversation_summary；active session transcript 隔离；archived session transcript 默认不进 ordinary context；memory recall 可进入 context | 显式引用 archived source 的产品路径 |
| `dialogue_gateway_real_loop_test.exs` | 最新 Work snapshot、同 session 最近对话和跨 session transcript 隔离进入 provider prompt | 会话级 replay UI |
| `ReplayService` / E2E replay | replay 可不调 provider | 会话级 UI 和 trace 页面 |
| `au03-current-work-context-ssot` | 真实工作台历史只读返回 active 后，最新 Work snapshot 与 active transcript 进入下一轮 prompt，历史 transcript 不替代当前事实；real LMStudio 变体验证真实 provider 请求 | 同屏作品背景面板和完整 replay |
| `au03-archive-session-filter` | 真实工作台可归档历史会话、默认列表隐藏 archived、显式搜索找回并只读打开，普通 context 默认排除 archived transcript 有局部测试 | 显式引用 archived source 进入 prompt 和 trace |
| `au03-session-new-active` | 真实工作台点击“新建会话”后，新 active 空 transcript rejoin，旧 active 变 exited 并可只读打开 | 搜索命中 turn 定位 |
| `au03-session-history-readonly` | 历史只读 transcript、旧 pending adoption 不恢复、输入/发送禁用、可返回 active session | 归档过滤和 branch 来源说明 |
| `au03-branch-from-history` | 从历史只读会话创建新 active branch，记录 `source_session_ref` / `source_turn_ref`，旧 transcript 不复制 | 作者 why 中解释引用历史 source |
| `au03-context-source-ui` | why 面板展示 current work / recent dialogue / memory 来源摘要，并排除 raw prompt/provider debug | archived/behavior/developer trace |
| `au06-single-active-confirmation` | 真实工作台连续两个高风险 confirmation 时，第二个 confirmation turn 消费上一轮开放 behavior context ref，summary author-safe 且不泄漏 behavior/action id | confirmation terminal replay、blocking clarification、持久 BehaviorBinding ledger |
| `au03-long-session-compression` | 长会话最近窗口与 transcript 可查看的真实工作台证据 | 完整 session summary/压缩策略 |

---

## 8. 验收命令

```bash
# 当前可复跑真实 Tauri checkpoint
bash scripts/tauri_slice_verify.sh au03-session-new-active
bash scripts/tauri_slice_verify.sh au03-session-history-readonly
bash scripts/tauri_slice_verify.sh au03-branch-from-history
bash scripts/tauri_slice_verify.sh au03-archive-session-filter
bash scripts/tauri_slice_verify.sh au03-current-work-context-ssot
bash scripts/tauri_slice_verify.sh --real-lmstudio au03-current-work-context-ssot
bash scripts/tauri_slice_verify.sh au03-context-source-ui
bash scripts/tauri_slice_verify.sh au03-long-session-compression
bash scripts/tauri_slice_verify.sh au09-au03-session-memory-layering

# 局部证据
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
mix test apps/novel_persistence/test/novel_persistence/workspace_context_test.exs
mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs
pnpm --dir frontend test -- native-tauri-verifier.test.mjs

# 文件级质量入口
bash scripts/quality_accept.sh au03-session-new-active --surface tauri
bash scripts/quality_accept.sh au03-session-history-readonly --surface tauri
bash scripts/quality_accept.sh au03-branch-from-history --surface tauri
bash scripts/quality_accept.sh au03-current-work-context-ssot --surface tauri
bash scripts/quality_accept.sh au03-archive-session-filter --surface tauri
bash scripts/quality_accept.sh au03-context-source-ui --surface tauri
bash scripts/quality_accept.sh au03-long-session-compression --surface tauri
bash scripts/quality_accept.sh au03-current-work-context-ssot --surface tauri --provider lmstudio
bash scripts/quality_accept.sh au06-single-active-confirmation --surface tauri
bash scripts/task_done.sh --skip-static-scan
bash scripts/ai_static_scan.sh --top 10
```

> 注意：AU-03 的完整验收必须证明“最新作品背景”和“历史会话 transcript”分层正确。仅证明 `conversation_summary` 进入 prompt，不等于 AI 真的按作品多会话模型理解作者的作品。
