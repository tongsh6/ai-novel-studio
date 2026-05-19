# AU-09 管理故事设定

> 作者视角：我的小说有大量设定、角色关系、伏笔线索、世界观规则。我需要能管理这些设定，并且 AI 在后续对话中能自动、可追溯地引用已确认设定。
>
> 2026-05-20 对账结论：作品档案面板的固定样例数据已被最小真实链路替换，真实 Tauri 工作台可打开当前 Work 的档案并读取已采纳角色、confirmed/stabilized 且 recallable 的伏笔/规则、卷章/草稿/记忆统计；档案 L2 列表到 L3 详情的只读查看 checkpoint 已补齐，角色/伏笔/规则可在 `StructurePanel` 中选中查看详情。记忆召回主链也已有最小真实前端闭环：confirmed/stabilized + recallable 记忆会按当前 Work 与本轮作者输入召回进 `memory_summary`，写入引用日志，并进入 Planner context。`locked=true` 的核心事实字段改写已在 persistence update 边界被拒绝；`MemoryItem.update_changeset/2` 已消费领域状态机规则，拒绝 DRAFT 直接跳 STABILIZED、DEPRECATED/ARCHIVED 复活，并在进入 DEPRECATED/ARCHIVED 时同步清理 `locked=false`、`recallable=false`。但 AU-09 仍缺可用 REST/Channel 管理入口、面板内采纳进入 governed memory、作者可见溯源 UI、locked 修改尝试 trace、有效期窗口，以及和 AU-03 “作品内多会话 + 最新作品背景”的分层闭环。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 打开作品档案面板 | 看到当前作品的真实统计、角色、设定、规则和待采纳项 |
| 浏览大纲/角色/伏笔/规则 | 每个分类从当前 Work 的持久化事实读取，不展示 mock |
| 看到待采纳设定 | 待采纳内容独立于已确认记忆，不自动污染作品事实 |
| 采纳或要求修改设定 | 采纳后进入可治理记忆，修改仍回到对话/确认流程 |
| 打开记忆管理页面 | 看到当前作品所有设定，可筛选、搜索、查看详情 |
| 新建一条设定 | 作者创建的设定保存到当前 Work，带类型、范围、来源和状态 |
| 确认、锁定、废弃、归档设定 | 状态流转受后端 guard 保护，并留下可追溯记录 |
| 设置章节/场景有效期 | 超出有效窗口的设定不进入普通召回，或明确降权/标注过期 |
| 和 AI 聊天时自动引用设定 | 已确认且可召回的相关设定进入 `memory_summary` 和 prompt |
| 查看 AI 为什么引用某条设定 | trace/replay 能显示 memory 来源、引用原因和脱敏摘要 |

明确不能做：
- 把 UI 中选中的 candidate 当成已采纳记忆；
- 把草稿、废弃、归档、不可召回或过期设定默认塞进 prompt；
- 在历史会话重入时，用旧会话里的设定覆盖当前 Work 的最新作品背景；
- 没有来源时让 AI 声称“你的作品已经设定了”。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU09-I1 / `00c` #5 | 记忆引用和状态变更必须可追溯 | SC-AU09-D1、SC-AU09-D2 |
| AU09-I2 / `00c` #11 | selection 不等于 adoption | SC-AU09-A3、SC-AU09-C1 |
| AU09-I3 | 只有 confirmed/stabilized 且 recallable 的记忆可进入普通召回 | SC-AU09-C2、SC-AU09-C4 |
| AU09-I4 | locked 设定可引用但不可被 AI 自动改写 | SC-AU09-C3 |
| AU09-I5 | 记忆召回必须按当前 Work 隔离，并与 AU-03 最新作品背景分层 | SC-AU09-D1、SC-AU09-D3 |
| AU09-I6 | 有效期窗口必须影响召回 | SC-AU09-C4 |

---

## 3. 契约引用

| 契约 / 实现 | 用途 | 当前证据判断 |
|---|---|---|
| `docs/design-v2/05-memory-retention-and-retrieval.md` | MemoryType/Scope/Status/SourceType 与字段语义 | 设计冻结，枚举和 schema 有局部实现 |
| `NovelFoundation.Enums.Memory*` | 编译期冻结记忆枚举 | 已实现并被 schema/domain 测试覆盖 |
| `NovelDomain.MemoryItem` | 纯领域对象，提供 confirm/lock/deprecate/archive 等函数 | 已提供状态流转 allowlist 与 terminal 状态 side effect；仍未接真实管理入口 |
| `NovelPersistence.Schemas.MemoryItem` | `memory_items` Ecto schema 与字段校验 | schema/changeset 局部已测；`locked=true` 时 persistence update 已拒绝改写 content/summary/type/scope；update changeset 已拒绝跳级和 terminal 状态复活，并对 DEPRECATED/ARCHIVED 自动清理 locked/recallable |
| `NovelPersistence.MemoryReferenceLog` | 记忆引用日志 | 表和写入/查询 helper 已测；召回主链已写入 reference log，仍缺 trace/replay 聚合与作者可见来源 UI |
| `NovelPersistence.WorkspaceContext.context_fetcher_with_query/0` | DialogueGateway 真实上下文 fetcher | 已按当前 Work + 作者输入召回 confirmed/stabilized 且 recallable 的记忆，返回 `memory_summary` 并写引用日志；`context_fetcher/0` 保留兼容 |
| `NovelApplication.ContextAssembler` / `DialogueContext.to_prompt_text/1` | 接收 `memory_summary` 并写入 prompt | stub 单测和真实 fetcher 最小闭环均证明字段可用 |
| `apps/novel_web/lib/novel_web/router.ex` | HTTP API 入口 | 仅有 health/provider/works；无 memory REST 路由 |
| `WorkspaceChannel` structure handlers | 作品档案面板数据 | `get_toc`、角色、伏笔、规则和统计已接当前 Work 的真实 archive/read model；仍缺管理入口 |
| `frontend/src/lib/memoryApi.ts` | 记忆管理前端 API client | client 存在，但后端路由缺失，真实页面不可用 |
| `MemoryListPage` / `MemoryCreateDialog` / `MemoryDetailDrawer` | Phase 0 记忆管理 UI | 组件存在，无设计原型、无 app 路由入口、依赖不存在的 REST API |
| `StructurePanel` | 作品档案 UI | 面板存在，archive 列表已来自真实 Channel/read model；待采纳区仍来自当前 turn 的 pendingAdoptions |

---

## 4. 验收场景

### 场景组 A：作品档案面板

#### SC-AU09-A1 — 打开作品档案看到真实作品全貌

**作为作者**，我在当前作品工作台打开作品档案面板，能看到作品名、卷数、已采纳草稿数、角色数、设定数、待审核数。

**期望结果**：
- 统计按当前 `work_id` 查询；
- 数据来自真实 persistence 或明确的 application 入口；
- 切换作品后统计随当前 Work 改变；
- 无数据时显示真实空态，不显示固定样例。

**当前证据**：`StructurePanel` 有统计 UI；`WorkspaceChannel.get_work_stats` 通过 `NovelApplication.WorkArchiveService` 读取当前 `work_id` 的真实卷章、角色、confirmed/stabilized 且 recallable 的记忆和草稿统计；`au09-archive-real-data` 原生 Tauri 验证会从真实工作台打开档案并校验 UI 计数与 Channel 日志一致。

**当前状态**：部分实现 / 最小真实前端闭环已补。仍缺切换作品后的 UI 隔离验收和完整记忆管理入口。

---

#### SC-AU09-A2 — 分类浏览大纲、角色、伏笔、规则

**作为作者**，我切换档案面板的四个分类，每个分类都展示当前作品的真实内容。

**期望结果**：
- 大纲、角色、伏笔、规则均按当前 `work_id` 读取；
- 伏笔/规则来自已确认记忆或作品事实；
- 不同作品内容隔离；
- 空态不冒充已有作品事实。

**当前证据**：`StructurePanel` 有四个 tab；大纲 `get_toc` 已在 AU-08 改为真实读取 accepted draft 投影；`get_characters` / `get_foreshadowing` / `get_rules` 已改为通过 `WorkArchiveService` 读取当前 Work 的已采纳角色和已确认可召回记忆；`lobby` / 无效 Work 返回空态，不再返回固定 `char_1`、`mem_1`、`rule_1`。2026-05-19 补充：角色/伏笔/规则 DTO 已携带只读详情字段，`StructurePanel` 使用 Radix Tabs，列表项可选中显示 L3 详情，且 Memory enum 在 UI 中映射为作者可读标签。

**当前状态**：部分实现 / 最小真实前端闭环已补。仍缺跨作品切换的 UI 级隔离验收和记忆管理页。

---

#### SC-AU09-A3 — 待采纳设定不混入已确认设定

**作为作者**，AI 刚生成一条设定时，我在伏笔 tab 看到“待采纳”卡片；它在我采纳前不能出现在“已确认设定”。

**期望结果**：
- pending adoption 与 confirmed memory 两个列表分离；
- pending 项有 source turn / artifact id；
- 刷新或重新打开作品时，pending 来源仍可恢复或明确丢失；
- 采纳前不会进入 context recall。

**当前证据**：`StructurePanel` 用 `pendingAdoptions` 单独渲染“待采纳内容”；但 pending 来自当前前端内存，不是持久化待处理箱，已确认列表已来自真实 archive/read model。

**当前状态**：部分实现。

---

#### SC-AU09-A4 — 面板内采纳设定进入真实记忆

**作为作者**，我在作品档案面板点击“采纳设定”，这条设定应变成当前 Work 的 confirmed memory，并能在后续对话中召回。

**期望结果**：
- 前端 action 与后端 Channel/API handler 匹配；
- AdoptionBoundary 或等价主流程执行 selection -> adoption；
- 写入 `memory_items` 或作品事实；
- 产生 StateTrace/MemoryTrace；
- 后续 `memory_summary` 可引用。

**当前证据**：`StructurePanel` 有按钮，调用 `WorkspaceChat` 的 `onAdopt`；AU-05 已记录真实采纳入口和 Channel handler 仍未闭环。

**当前状态**：未闭环。

---

### 场景组 B：记忆管理页面

#### SC-AU09-B1 — 打开记忆管理页面并读取当前作品记忆

**作为作者**，我打开记忆管理页面，看到当前作品的所有设定。

**期望结果**：
- App 内有可发现入口；
- 页面按当前 `work_id` 调真实 API；
- 后端存在 `GET /api/works/:id/memories`；
- 失败时显示可恢复错误。

**当前证据**：`MemoryListPage` 组件存在；`App.tsx` 未挂载该页面；Router 无 memory 路由。

**当前状态**：部分实现。

---

#### SC-AU09-B2 — 筛选、搜索、排序当前作品设定

**作为作者**，我按类型、范围、状态、锁定状态和关键词筛选设定。

**期望结果**：
- 多筛选条件以 AND 组合；
- 查询只返回当前 Work；
- 11 种类型、6 种范围、6 种状态与后端枚举一致；
- 大量记忆时分页/limit 生效。

**当前证据**：`MemoryListPage` 维护 filter state，`memoryApi.listMemories` 会拼 query string；后端无对应 API。

**当前状态**：部分实现。

---

#### SC-AU09-B3 — 作者新建一条设定

**作为作者**，我新建“林瑶失踪与灵源矿区有关”，选择类型、范围、来源和权重，保存后它出现在当前作品列表。

**期望结果**：
- 必填字段校验；
- enum 非法值后端拒绝；
- 写入当前 `work_id`；
- 新设定默认 status 明确；
- 新建动作可追溯。

**当前证据**：`MemoryCreateDialog` 与 `memoryApi.createMemory` 存在；`MemoryItem.changeset/2` 覆盖必填、枚举、weight 范围；后端无 create API。

**当前状态**：部分实现。

---

### 场景组 C：设定生命周期治理

#### SC-AU09-C1 — 草稿确认后才成为可召回设定

**作为作者**，AI 或我创建的草稿设定必须经确认后才进入普通对话召回。

**期望结果**：
- `DRAFT -> CONFIRMED` 有后端受控动作；
- 非法状态跳转被拒绝；
- draft 不进入普通 `memory_summary`；
- 确认动作留下来源。

**当前证据**：`NovelDomain.MemoryItem.confirm/1` 和 `MemoryDetailDrawer.confirmMemory` 存在；`MemoryItem.update_changeset/2` 已拒绝 DRAFT 直接跳 STABILIZED、DEPRECATED/ARCHIVED 复活，并由 `NovelDomain.MemoryItem.status_transition_allowed?/2` 统一维护领域规则；后端 API 缺失。

**当前状态**：部分实现 / 后端 guard 已补。

---

#### SC-AU09-C2 — 废弃/归档设定不再召回

**作为作者**，我废弃或归档旧设定后，AI 后续普通对话不能再引用它。

**期望结果**：
- `DEPRECATED` / `ARCHIVED` 同步设置 `recallable = false`；
- recall 查询过滤不可召回设定；
- trace 显示它未被引用或被排除；
- 手动查看历史仍保留记录。

**当前证据**：`NovelDomain.MemoryItem.deprecate/1` / `archive/1` 会设 `recallable: false` 并清理 `locked=false`；`MemoryItem.update_changeset/2` 在进入 DEPRECATED/ARCHIVED 时同步写入 `recallable=false`，召回查询只读取 confirmed/stabilized 且 recallable 的记忆。

**当前状态**：部分实现。

---

#### SC-AU09-C3 — 锁定设定可引用但不可被自动改写

**作为作者**，我锁定核心世界观设定后，AI 仍可引用，但不能自动修改其内容。

**期望结果**：
- `locked = true` 后仍可召回；
- 自动更新/AI 提取流程不能改 content/summary/type/scope；
- 作者主动解锁或显式确认后才可改；
- 修改尝试有失败原因和 trace。

**当前证据**：domain 有 `lock/1`、`modifiable?/1` 和 `locked_protected_fields/0`；persistence `update_changeset/2` 已按领域字段集合拒绝改写 locked item 的 content/summary/type/scope，同时允许权重、置信度、召回开关等治理元数据维护；无主链自动更新 guard 和修改尝试 trace。

**当前状态**：局部实现。

---

#### SC-AU09-C4 — 章节/场景有效期影响召回

**作为作者**，一条只在第一章有效的设定，在第二章之后不应继续被普通对话引用。

**期望结果**：
- 作者可设置 `valid_from` / `valid_until`；
- 当前叙事位置参与 recall；
- 窗口外记忆不召回或降权并标注原因；
- 历史会话引用不覆盖当前 Work 最新状态。

**当前证据**：schema 和 domain 字段存在；`MemoryDetailDrawer` 可展示有效期；没有 recall 查询和 current narrative position 集成。

**当前状态**：未实现。

---

### 场景组 D：AI 对话召回与溯源

#### SC-AU09-D1 — 已确认设定进入主链 context 和 prompt

**作为作者**，我确认“林瑶失踪与灵源矿区有关”后，下一轮问“林烬为什么要去矿区”，AI 自动引用这条设定。

**期望结果**：
- `WorkspaceContext.context_fetcher/0` 按当前 Work 召回相关 confirmed/stabilized memory；
- `ContextAssembler` 得到非空 `memory_summary`；
- `DialogueContext.to_prompt_text/1` 写入“相关记忆”；
- trace 包含 `source_type: :memory`；
- AI 回复体现设定内容且不编造来源。

**当前证据**：`ContextAssembler` 和 `DialogueContext` 支持 `memory_summary`；`WorkspaceContext.context_fetcher_with_query/0` 已接 `MemoryRecallRepo`，按当前 Work、confirmed/stabilized、`recallable=true` 和作者输入召回记忆；`DialogueGateway` 把本轮作者文本传入 `ContextAssembler.assemble_for_input/3`；`dialogue_gateway_real_loop_test.exs` 证明 memory 进入 prompt 与 `trace_summary.context_refs`；`au09-memory-recall-context` 原生 Tauri 验证证明真实工作台输入可触发 `context.assemble.done(has_memory=true)`。

**当前状态**：部分实现 / 最小真实前端闭环已补。仍缺有效期窗口、locked 修改尝试 trace、作者可见引用溯源 UI 和历史会话分层验收。

---

#### SC-AU09-D2 — 记忆引用可溯源

**作为作者**，我能查看 AI 本轮引用了哪条设定、为什么引用、来自哪次确认。

**期望结果**：
- recall 后写入 `memory_reference_logs`；
- trace/replay 聚合 memory source refs；
- 作者视图显示脱敏中文摘要；
- 开发者视图可看到完整 source id 和引用原因。

**当前证据**：`MemoryReferenceLog` helper 和测试存在；`WorkspaceContext.context_fetcher_with_query/0` 在召回后批量写入 `memory_reference_logs` 并递增 `reference_count` / `last_referenced_at`；仍没有前端引用来源入口。

**当前状态**：部分实现。

---

#### SC-AU09-D3 — 与 AU-03 最新作品背景和作品内会话分层一致

**作为作者**，我打开历史会话回看旧讨论时，AI/界面不能用旧会话状态覆盖当前作品最新设定；新会话继续创作时应使用当前 Work 最新背景和 confirmed memory。

**期望结果**：
- Work 最新背景、active session transcript、historical session、memory_summary 分层；
- memory 按当前 Work 隔离；
- archived session 默认不参与普通 context；
- trace 标明 memory 与 conversation 的不同来源。

**当前证据**：AU-03 已确认缺独立作品内会话模型；`WorkspaceContext` 已按当前 Work 召回 memory，但 recent interactions、active session 与 historical session 的分层仍未闭环。

**当前状态**：未实现。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 证据等级 |
|---|---|---|---|
| SC-AU09-A1 | 打开档案看真实统计 | 部分实现 / 最小真实前端闭环已补 | Tauri UI + Channel + persistence |
| SC-AU09-A2 | 分类浏览真实作品内容 | 部分实现 / 最小真实前端闭环已补 | Tauri UI + Channel + persistence |
| SC-AU09-A3 | 待采纳不混入已确认 | 部分实现 | 前端当前 turn 内存 |
| SC-AU09-A4 | 面板内采纳进入真实记忆 | 未闭环 | 依赖 AU-05 采纳缺口 |
| SC-AU09-B1 | 打开记忆管理页 | 部分实现 | 组件存在，未挂路由，API 缺失 |
| SC-AU09-B2 | 筛选搜索设定 | 部分实现 | 前端 query client，后端 API 缺失 |
| SC-AU09-B3 | 新建作者设定 | 部分实现 | 前端表单 + schema 局部校验，后端 API 缺失 |
| SC-AU09-C1 | 草稿确认后可召回 | 部分实现 / 后端 guard 已补 | domain 函数，update changeset 状态机 guard；后端 API 缺失 |
| SC-AU09-C2 | 废弃/归档不召回 | 部分实现 / 后端 guard 已补 | domain 函数、update changeset terminal side effect、recall 查询过滤；缺正式管理 API 与 trace/UI 验收 |
| SC-AU09-C3 | 锁定设定不可自动改写 | 部分实现 | schema update 已拒绝 locked core fact rewrite；缺主链 trace/API 验收 |
| SC-AU09-C4 | 有效期影响召回 | 未实现 | 字段存在，召回未使用 |
| SC-AU09-D1 | 已确认设定进入主链 prompt | 部分实现 / 最小真实前端闭环已补 | Tauri UI + context assembler + real fetcher |
| SC-AU09-D2 | 记忆引用可溯源 | 部分实现 | reference log helper，主链未接 |
| SC-AU09-D3 | 与 AU-03 会话/最新背景分层一致 | 未实现 | AU-03 会话模型缺口 |

**覆盖率重算**：0/14 完整真实前后端验收；3/14 已有最小真实前端闭环但仍缺完整场景后果；9/14 有局部证据或基础设施；4/14 未实现/未闭环。

---

## 6. 缺口

| 缺口 | 具体表现 | 类型 | 优先级 |
|---|---|---|---|
| AU09-GAP-01 — 记忆 REST/Channel 管理入口缺失 | 前端 `memoryApi.ts` 调 `/api/works/:id/memories...`，Router 无对应路由 | 补实现/补集成 | P0 |
| AU09-GAP-02 — 作品档案仍是 mock 数据 | `get_characters` / `get_foreshadowing` / `get_rules` / `get_work_stats` 固定样例已移除；`get_toc` 已由 AU-08 读取 accepted draft 投影；档案详情面已补最小只读 checkpoint；剩余是跨作品 UI 隔离和完整 AU-09 覆盖 | 最小闭环已补 / 继续补验收 | P0/P1 |
| AU09-GAP-03 — 面板采纳未进入真实记忆 | pendingAdoptions 是当前前端内存，采纳链路未写入 governed memory | 补集成 | P0 |
| AU09-GAP-04 — `memory_summary` 未接主链 | 最小闭环已补：真实 fetcher 返回 `memory_summary` 并进入 Planner context；剩余有效期/locked/会话分层与完整 UI 溯源 | 最小闭环已补 / 继续补验收 | P0 |
| AU09-GAP-05 — recall 查询和 ranking 缺失 | 最小闭环已补：`MemoryRecallRepo` 按 work/status/recallable/query 做基础召回排序；剩余 current narrative position、有效期窗口、冲突/locked 策略 | 最小闭环已补 / 继续补实现 | P0 |
| AU09-GAP-06 — 状态机后端 guard 缺失 | `update_changeset/2` 已消费 `NovelDomain.MemoryItem` 状态流转规则，拒绝跳级和 terminal 状态复活；剩余是正式管理 API 入口接入与状态变化 trace | 局部已补 / 继续补集成 | P0 |
| AU09-GAP-07 — locked 保护未落地 | persistence update 已拒绝 locked item 的 content/summary/type/scope 改写；剩余主链 API、修改尝试 trace 和前端验收 | 局部已补 / 继续补集成 | P0 |
| AU09-GAP-08 — 有效期窗口未参与召回 | `valid_from` / `valid_until` 字段存在但未接 current narrative position | 补实现/补集成 | P1 |
| AU09-GAP-09 — 引用日志未接 recall | 最小闭环已补：召回后写 `memory_reference_logs` 并更新引用计数；剩余 trace/replay 聚合与作者可见来源 UI | 最小闭环已补 / 继续补集成 | P1 |
| AU09-GAP-10 — 作者可见溯源缺失 | 无 UI 展示本轮引用了哪些记忆、为何引用 | 补实现/补验收 | P1 |
| AU09-GAP-11 — 管理页面无正式设计与路由入口 | Phase 0 组件未挂到 App，设计原型为 N/A | 修设计偏差/补实现 | P2 |
| AU09-GAP-12 — 与 AU-03 会话模型未对齐 | 无作品内 session，记忆无法按 active/historical session 分层 | 补集成/新增 | P0/P1 |

---

## 7. 已知限制 / 现有基础设施

| 基础设施 | 可复用点 | 不能算已验收的原因 |
|---|---|---|
| `MemoryItem` schema + migration | 字段、枚举、索引基本存在；locked core fact rewrite 与状态机 guard 已在 update changeset 拦截 | 没有管理 API、状态变化 trace、完整 recall pipeline |
| `NovelDomain.MemoryItem` | 纯函数表达生命周期动作，并声明 locked 保护字段集合与状态流转 allowlist | 仍未被 API 主流程完整消费 |
| `MemoryReferenceLog` | 可写引用日志，且已由 recall 主链调用 | 仍没有 UI/replay 聚合 |
| `ContextAssembler` / `DialogueContext` | `memory_summary` 能进入 prompt；真实 fetcher 已提供最小 memory summary | 仍缺有效期、locked 修改尝试 trace、历史会话分层和作者可见溯源 |
| `StructurePanel` | 档案面板视觉壳、真实 archive 读模型和 pending 分区 | 已确认档案数据已有最小真实链路；pending 仍来自 adoption/resume 视图，记忆管理、召回和溯源未闭环 |
| `MemoryListPage` 系列组件 | Phase 0 管理表格/表单/详情 | 无 App 入口、无设计规范、无后端路由 |

---

## 8. 验收命令

```bash
# 当前只能证明局部基础设施，不证明 AU-09 完整验收
mix test apps/novel_persistence/test/novel_persistence/schemas/memory_item_test.exs
mix test apps/novel_domain/test/novel_domain/memory_item_test.exs
mix test apps/novel_persistence/test/novel_persistence/memory_reference_log_test.exs
mix test apps/novel_persistence/test/novel_persistence/memory_recall_repo_test.exs
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
mix test apps/novel_persistence/test/novel_persistence/workspace_context_test.exs
bash scripts/tauri_slice_verify.sh au09-memory-recall-context
```

后续真正闭环后至少需要新增：
- memory REST/Channel 管理 API 测试；
- recall -> `memory_summary` -> prompt -> trace/reference log 的完整场景覆盖；
- confirmed/deprecated/archived/locked/validity 的主链召回测试；
- 当前 Work 与历史会话分层的 AU-03/AU-09 联合验收；
- 工作台/记忆管理 UI 自动化或真人 walkthrough。
