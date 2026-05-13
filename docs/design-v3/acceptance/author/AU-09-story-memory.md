# AU-09 管理故事设定

> 作者视角：我的小说有大量设定、角色关系、伏笔线索、世界观规则。我需要能管理这些设定，并且 AI 在后续对话中能自动、可追溯地引用已确认设定。
>
> 2026-05-13 对账结论：当前已有 `MemoryItem` schema/enums、记忆管理 Phase 0 前端组件、作品档案面板壳、引用日志表和 `DialogueContext.memory_summary` 字段；但缺可用 REST/Channel 管理入口、真实作品档案数据、记忆召回到主链 context、引用日志写入、作者可见溯源，以及和 AU-03 “作品内多会话 + 最新作品背景”的分层闭环。

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
| `NovelDomain.MemoryItem` | 纯领域对象，提供 confirm/lock/deprecate/archive 等函数 | 局部已测试，但未接真实管理入口 |
| `NovelPersistence.Schemas.MemoryItem` | `memory_items` Ecto schema 与字段校验 | schema/changeset 局部已测；无状态流转 guard、locked 内容保护 |
| `NovelPersistence.MemoryReferenceLog` | 记忆引用日志 | 表和写入/查询 helper 已测；未接召回主链 |
| `NovelPersistence.WorkspaceContext.context_fetcher/0` | DialogueGateway 真实上下文 fetcher | 当前返回 `{:ok, snapshot, conv_summary, nil, nil}`，memory 未接入 |
| `NovelApplication.ContextAssembler` / `DialogueContext.to_prompt_text/1` | 接收 `memory_summary` 并写入 prompt | stub 单测证明字段可用；真实 fetcher 不提供 memory |
| `apps/novel_web/lib/novel_web/router.ex` | HTTP API 入口 | 仅有 health/provider/works；无 memory REST 路由 |
| `WorkspaceChannel` structure handlers | 作品档案面板数据 | `get_toc`/`get_characters`/`get_foreshadowing`/`get_rules`/`get_work_stats` 仍返回 mock |
| `frontend/src/lib/memoryApi.ts` | 记忆管理前端 API client | client 存在，但后端路由缺失，真实页面不可用 |
| `MemoryListPage` / `MemoryCreateDialog` / `MemoryDetailDrawer` | Phase 0 记忆管理 UI | 组件存在，无设计原型、无 app 路由入口、依赖不存在的 REST API |
| `StructurePanel` | 作品档案 UI | 面板存在，数据主要来自 mock Channel handler 和当前 turn 的 pendingAdoptions |

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

**当前证据**：`StructurePanel` 有统计 UI；`WorkspaceChannel.get_work_stats` 返回固定 mock。

**当前状态**：部分实现。

---

#### SC-AU09-A2 — 分类浏览大纲、角色、伏笔、规则

**作为作者**，我切换档案面板的四个分类，每个分类都展示当前作品的真实内容。

**期望结果**：
- 大纲、角色、伏笔、规则均按当前 `work_id` 读取；
- 伏笔/规则来自已确认记忆或作品事实；
- 不同作品内容隔离；
- 空态不冒充已有作品事实。

**当前证据**：`StructurePanel` 有四个 tab；Channel handler 返回固定 `mock_work`、`char_1`、`mem_1`、`rule_1`。

**当前状态**：部分实现。

---

#### SC-AU09-A3 — 待采纳设定不混入已确认设定

**作为作者**，AI 刚生成一条设定时，我在伏笔 tab 看到“待采纳”卡片；它在我采纳前不能出现在“已确认设定”。

**期望结果**：
- pending adoption 与 confirmed memory 两个列表分离；
- pending 项有 source turn / artifact id；
- 刷新或重新打开作品时，pending 来源仍可恢复或明确丢失；
- 采纳前不会进入 context recall。

**当前证据**：`StructurePanel` 用 `pendingAdoptions` 单独渲染“待采纳内容”；但 pending 来自当前前端内存，不是持久化待处理箱，已确认列表来自 mock handler。

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

**当前证据**：`NovelDomain.MemoryItem.confirm/1` 和 `MemoryDetailDrawer.confirmMemory` 存在；`MemoryItem.update_changeset/2` 允许直接改 `status`，无状态机 guard；后端 API 缺失。

**当前状态**：部分实现。

---

#### SC-AU09-C2 — 废弃/归档设定不再召回

**作为作者**，我废弃或归档旧设定后，AI 后续普通对话不能再引用它。

**期望结果**：
- `DEPRECATED` / `ARCHIVED` 同步设置 `recallable = false`；
- recall 查询过滤不可召回设定；
- trace 显示它未被引用或被排除；
- 手动查看历史仍保留记录。

**当前证据**：`NovelDomain.MemoryItem.deprecate/1` / `archive/1` 会设 `recallable: false`；真实 persistence update 和 recall 查询未接入。

**当前状态**：部分实现。

---

#### SC-AU09-C3 — 锁定设定可引用但不可被自动改写

**作为作者**，我锁定核心世界观设定后，AI 仍可引用，但不能自动修改其内容。

**期望结果**：
- `locked = true` 后仍可召回；
- 自动更新/AI 提取流程不能改 content/summary/type/scope；
- 作者主动解锁或显式确认后才可改；
- 修改尝试有失败原因和 trace。

**当前证据**：domain 有 `lock/1` 和 `modifiable?/1`；persistence `update_changeset/2` 仍允许修改 locked item 的 content；无主链自动更新 guard。

**当前状态**：未实现。

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

**当前证据**：`ContextAssembler` 和 `DialogueContext` 支持 `memory_summary`；`ContextGroundingTest` 用 stub 证明 prompt 可包含 memory；真实 `WorkspaceContext.context_fetcher/0` 仍返回 `nil` memory。

**当前状态**：未闭环。

---

#### SC-AU09-D2 — 记忆引用可溯源

**作为作者**，我能查看 AI 本轮引用了哪条设定、为什么引用、来自哪次确认。

**期望结果**：
- recall 后写入 `memory_reference_logs`；
- trace/replay 聚合 memory source refs；
- 作者视图显示脱敏中文摘要；
- 开发者视图可看到完整 source id 和引用原因。

**当前证据**：`MemoryReferenceLog` helper 和测试存在；未发现 recall 主链调用它，也没有前端引用来源入口。

**当前状态**：部分实现。

---

#### SC-AU09-D3 — 与 AU-03 最新作品背景和作品内会话分层一致

**作为作者**，我打开历史会话回看旧讨论时，AI/界面不能用旧会话状态覆盖当前作品最新设定；新会话继续创作时应使用当前 Work 最新背景和 confirmed memory。

**期望结果**：
- Work 最新背景、active session transcript、historical session、memory_summary 分层；
- memory 按当前 Work 隔离；
- archived session 默认不参与普通 context；
- trace 标明 memory 与 conversation 的不同来源。

**当前证据**：AU-03 已确认缺独立作品内会话模型；`WorkspaceContext` 目前按 `workspace_id` 汇总 recent interactions，并返回 memory nil。

**当前状态**：未实现。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 证据等级 |
|---|---|---|---|
| SC-AU09-A1 | 打开档案看真实统计 | 部分实现 | UI + mock Channel |
| SC-AU09-A2 | 分类浏览真实作品内容 | 部分实现 | UI + mock Channel |
| SC-AU09-A3 | 待采纳不混入已确认 | 部分实现 | 前端当前 turn 内存 |
| SC-AU09-A4 | 面板内采纳进入真实记忆 | 未闭环 | 依赖 AU-05 采纳缺口 |
| SC-AU09-B1 | 打开记忆管理页 | 部分实现 | 组件存在，未挂路由，API 缺失 |
| SC-AU09-B2 | 筛选搜索设定 | 部分实现 | 前端 query client，后端 API 缺失 |
| SC-AU09-B3 | 新建作者设定 | 部分实现 | 前端表单 + schema 局部校验，后端 API 缺失 |
| SC-AU09-C1 | 草稿确认后可召回 | 部分实现 | domain 函数，后端 guard/API 缺失 |
| SC-AU09-C2 | 废弃/归档不召回 | 部分实现 | domain 函数，recall 主链缺失 |
| SC-AU09-C3 | 锁定设定不可自动改写 | 未实现 | schema update 仍可改 locked content |
| SC-AU09-C4 | 有效期影响召回 | 未实现 | 字段存在，召回未使用 |
| SC-AU09-D1 | 已确认设定进入主链 prompt | 未闭环 | stub 支持，真实 fetcher memory nil |
| SC-AU09-D2 | 记忆引用可溯源 | 部分实现 | reference log helper，主链未接 |
| SC-AU09-D3 | 与 AU-03 会话/最新背景分层一致 | 未实现 | AU-03 会话模型缺口 |

**覆盖率重算**：0/14 完整真实前后端验收；9/14 有局部证据或基础设施；5/14 未实现/未闭环。

---

## 6. 缺口

| 缺口 | 具体表现 | 类型 | 优先级 |
|---|---|---|---|
| AU09-GAP-01 — 记忆 REST/Channel 管理入口缺失 | 前端 `memoryApi.ts` 调 `/api/works/:id/memories...`，Router 无对应路由 | 补实现/补集成 | P0 |
| AU09-GAP-02 — 作品档案仍是 mock 数据 | `get_toc` / `get_characters` / `get_foreshadowing` / `get_rules` / `get_work_stats` 返回固定样例 | 补集成/补验收 | P0 |
| AU09-GAP-03 — 面板采纳未进入真实记忆 | pendingAdoptions 是当前前端内存，采纳链路未写入 governed memory | 补集成 | P0 |
| AU09-GAP-04 — `memory_summary` 未接主链 | `WorkspaceContext.context_fetcher/0` 返回 memory nil | 补集成 | P0 |
| AU09-GAP-05 — recall 查询和 ranking 缺失 | 未发现按 work/status/type/validity/query 召回 MemoryItem 的 application/persistence 入口 | 补实现 | P0 |
| AU09-GAP-06 — 状态机后端 guard 缺失 | `update_changeset/2` 可直接写 `status`，非法跳转无法被统一拒绝 | 补实现/补测试 | P0 |
| AU09-GAP-07 — locked 保护未落地 | locked item 的 content 仍可经 schema update 修改 | 补实现/补测试 | P0 |
| AU09-GAP-08 — 有效期窗口未参与召回 | `valid_from` / `valid_until` 字段存在但未接 current narrative position | 补实现/补集成 | P1 |
| AU09-GAP-09 — 引用日志未接 recall | `MemoryReferenceLog` 有 helper，但 recall/prompt 主链未写入 | 补集成 | P1 |
| AU09-GAP-10 — 作者可见溯源缺失 | 无 UI 展示本轮引用了哪些记忆、为何引用 | 补实现/补验收 | P1 |
| AU09-GAP-11 — 管理页面无正式设计与路由入口 | Phase 0 组件未挂到 App，设计原型为 N/A | 修设计偏差/补实现 | P2 |
| AU09-GAP-12 — 与 AU-03 会话模型未对齐 | 无作品内 session，记忆无法按 active/historical session 分层 | 补集成/新增 | P0/P1 |

---

## 7. 已知限制 / 现有基础设施

| 基础设施 | 可复用点 | 不能算已验收的原因 |
|---|---|---|
| `MemoryItem` schema + migration | 字段、枚举、索引基本存在 | 没有管理 API、状态 guard、recall pipeline |
| `NovelDomain.MemoryItem` | 纯函数表达生命周期动作 | 未被 persistence/API 主流程消费 |
| `MemoryReferenceLog` | 可写引用日志 | 没有 recall 调用和 UI/replay 聚合 |
| `ContextAssembler` / `DialogueContext` | `memory_summary` 能进入 prompt | 真实 fetcher 不提供 memory，只有 stub 测试 |
| `StructurePanel` | 档案面板视觉壳和 pending 分区 | 数据是 mock 或当前前端内存 |
| `MemoryListPage` 系列组件 | Phase 0 管理表格/表单/详情 | 无 App 入口、无设计规范、无后端路由 |

---

## 8. 验收命令

```bash
# 当前只能证明局部基础设施，不证明 AU-09 完整验收
mix test apps/novel_persistence/test/novel_persistence/schemas/memory_item_test.exs
mix test apps/novel_persistence/test/novel_persistence/memory_reference_log_test.exs
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
mix test apps/novel_persistence/test/novel_persistence/workspace_context_test.exs
```

后续真正闭环后至少需要新增：
- memory REST/Channel 管理 API 测试；
- recall -> `memory_summary` -> prompt -> trace/reference log 集成测试；
- confirmed/deprecated/archived/locked/validity 的主链召回测试；
- 当前 Work 与历史会话分层的 AU-03/AU-09 联合验收；
- 工作台/记忆管理 UI 自动化或真人 walkthrough。
