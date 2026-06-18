# AU-09 管理故事设定

> 作者视角：我的小说有大量设定、角色关系、伏笔线索、世界观规则。我需要能管理这些设定，并且 AI 在后续对话中能自动、可追溯地引用已确认设定。
>
> 2026-05-20 对账结论：作品档案面板的固定样例数据已被最小真实链路替换，真实 Tauri 工作台可打开当前 Work 的档案并读取已采纳角色、confirmed/stabilized 且 recallable 的伏笔/规则、卷章/草稿/记忆统计；档案 L2 列表到 L3 详情的只读查看 checkpoint 已补齐，角色/伏笔/规则可在 `StructurePanel` 中选中查看详情。记忆召回主链也已有最小真实前端闭环：confirmed/stabilized + recallable 记忆会按当前 Work 与本轮作者输入召回进 `memory_summary`，写入引用日志，并进入 Planner context。`locked=true` 的核心事实字段改写已在 persistence update 边界被拒绝；`MemoryItem.update_changeset/2` 已消费领域状态机规则，拒绝 DRAFT 直接跳 STABILIZED、DEPRECATED/ARCHIVED 复活，并在进入 DEPRECATED/ARCHIVED 时同步清理 `locked=false`、`recallable=false`。本轮补齐 `frontend/src/lib/memoryApi.ts` 对应的后端 REST 最小入口：按当前 Work list/create/show 记忆、确认/锁定/解锁/废弃/归档、更新权重/有效期、recall 和 references；create 入口忽略 caller-provided status，统一从 DRAFT 开始，生命周期动作继续经 schema/domain guard。后续已由 2026-05-30 / 2026-06-18 checkpoint 补齐真实工作台入口、基础生命周期验收、lifecycle/reference author-safe 追溯、有效期窗口召回、跨作品记忆隔离，以及和 AU-03 “作品内多会话 + 最新作品背景”的分层闭环；AU-09 仍缺 Channel 管理入口、正式 UI 设计追溯、完整独立 MemoryTrace/StateTrace 表、developer replay 和历史旧 turn 查询。
>
> 2026-06-18 CP2 checkpoint：`tasks/slices/AU09-archive-memory-roundtrip.md` 已补 `world_building` 专用 prompt，以及显式伏笔/规则 artifact 采纳后的 governed memory 归类。`foreshadowing_seed` 会写为 `FORESHADOWING`，`world_rule_seed` / `style_rule_seed` / `constraint_seed` 会写为 `WORLD_RULE` / `STYLE_RULE` / `CONSTRAINT`，从而能被作品档案伏笔/规则 tab 读模型读取；外部 Tauri 验收复用并收紧 `au09-adopt-setting-recall`，已证明真实工作台从「新增伏笔」「新建规则」入口生成显式 artifact、作者采纳后进入 governed memory、重开对应 tab 可见，并在下一轮 recall/why 中展示“已确认设定”。
>
> 2026-06-18 CP3 checkpoint：`tasks/slices/AU09-memory-management-workbench-entry.md` 已证明作者可从真实工作台头部「记忆」入口进入管理页，创建 DRAFT 记忆、确认成 CONFIRMED、锁定后仍被召回并在 why 中显示 author-safe 来源；锁定时废弃/归档按钮禁用，解锁后废弃一条记忆、归档另一条记忆，后续相关对话的 memory context / why 不再包含这两条 terminal memory 内容。证据：`artifacts/slice-verify/au09-memory-management-entry-tauri/summary.json`。注意：`world_building` 保持工具能力名，但伏笔/规则不再默认归入 `world_setting`；伏笔入口生成 `foreshadowing_seed`，规则入口生成 `world_rule_seed` / `style_rule_seed` / `constraint_seed`，采纳后由 governed memory type 归类为 `FORESHADOWING` / `WORLD_RULE` / `STYLE_RULE` / `CONSTRAINT`。
>
> 2026-06-18 CP4 checkpoint：`tasks/slices/AU09-memory-trace-roundtrip.md` 已把记忆生命周期动作接入 author-safe reference/trace 读模型。create/confirm/lock/unlock/deprecate/archive 会写入 `memory_reference_logs.reference_scene=memory_lifecycle`；locked terminal attempt 在 service/schema 边界被拒绝，并写入 `memory_lifecycle_blocked`；`MemoryDetailDrawer` 通过正式 references API 展示“引用与治理追溯”。外部 Tauri `au09-memory-trace-roundtrip` 已证明真实工作台可见 lifecycle trace，locked 记忆仍可召回且 trace 解释锁定，deprecated/archived 记忆不进入后续 context/why。证据：`artifacts/slice-verify/au09-memory-trace-roundtrip-tauri/summary.json`。本 CP 复用现有 reference log 作为最小 trace read model；完整独立 MemoryTrace/StateTrace 表、developer replay、历史旧 turn 查询仍待后续。
>
> 2026-06-18 CP5 checkpoint：`tasks/slices/AU09-cross-work-memory-isolation.md` 已证明跨作品记忆隔离。外部 Tauri `au09-cross-work-memory-isolation` seed 两个作品，真实工作台从作品 A 切到作品 B 后，作品档案伏笔/规则、记忆管理页、ordinary recall 和 why 只消费 B 的 governed memory；输入同时命中 A/B 关键词时，`trace_summary.context_refs` 和 why 均排除 A 的记忆摘要。证据：`artifacts/slice-verify/au09-cross-work-memory-isolation-tauri/summary.json`。
>
> 2026-06-18 CP6 checkpoint：`tasks/slices/AU09-AU03-session-memory-layering.md` 已证明同一作品内 active session、historical session、current work snapshot 与 governed memory 分层。外部 Tauri `au09-au03-session-memory-layering` 从真实工作台打开含 `旧稿赤塔` 的历史只读会话，确认输入禁用，再返回 active session 发送同时命中当前会话 `当前蓝桥计划` 与 confirmed memory `银槐誓约` 的消息；`trace_summary.context_refs` 包含 `current_work` / `session_transcript` / `memory`，排除泛化 `conversation` fallback 和历史 transcript，why 面板分别展示“当前作品背景”“当前会话记录”“已确认设定”。证据：`artifacts/slice-verify/au09-au03-session-memory-layering-tauri/summary.json`。

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
| `docs/design/06-memory-context-and-trace.md` | MemoryType/Scope/Status/SourceType 与字段语义 | 设计冻结，枚举和 schema 有局部实现 |
| `NovelFoundation.Enums.Memory*` | 编译期冻结记忆枚举 | 已实现并被 schema/domain 测试覆盖 |
| `NovelDomain.MemoryItem` | 纯领域对象，提供 confirm/lock/deprecate/archive 等函数 | 已提供状态流转 allowlist 与 terminal 状态 side effect；已由 REST 管理入口通过 `MemoryItem.update_changeset/2` 间接消费 |
| `NovelPersistence.Schemas.MemoryItem` | `memory_items` Ecto schema 与字段校验 | schema/changeset 局部已测；`locked=true` 时 persistence update 已拒绝改写 content/summary/type/scope；update changeset 已拒绝跳级和 terminal 状态复活，并对 DEPRECATED/ARCHIVED 自动清理 locked/recallable |
| `NovelPersistence.MemoryManagementRepo` | 记忆管理持久化入口 | 已实现 current-work list/create/get/update/recall/references；过滤先于分页，references 按 work 过滤 |
| `NovelApplication.MemoryManagementService` | 记忆管理用例边界 | 已实现 JSON-safe DTO、work 存在性检查、create 默认 DRAFT、confirm/lock/deprecate/archive 等治理动作 |
| `NovelPersistence.MemoryReferenceLog` | 记忆引用日志 | 表和写入/查询 helper 已测；召回主链已写入 reference log，仍缺 trace/replay 聚合与作者可见来源 UI |
| `NovelPersistence.WorkspaceContext.context_fetcher_with_query/0` | DialogueGateway 真实上下文 fetcher | 已按当前 Work + 作者输入召回 confirmed/stabilized 且 recallable 的记忆，返回 `memory_summary` 并写引用日志；`context_fetcher/0` 保留兼容 |
| `NovelApplication.ContextAssembler` / `DialogueContext.to_prompt_text/1` | 接收 `memory_summary` 并写入 prompt | stub 单测和真实 fetcher 最小闭环均证明字段可用 |
| `apps/novel_web/lib/novel_web/router.ex` / `NovelWeb.MemoriesController` | HTTP API 入口 | 已新增 `/api/works/:work_id/memories...` REST 路由，响应对齐 `memoryApi.ts` 的 `{ok,data,error,count}`；仍未提供正式工作台 UI 入口 |
| `WorkspaceChannel` structure handlers | 作品档案面板数据 | `get_toc`、角色、伏笔、规则和统计已接当前 Work 的真实 archive/read model；仍缺管理入口 |
| `frontend/src/lib/memoryApi.ts` | 记忆管理前端 API client | client 存在，后端 REST 契约已补；真实页面已通过 `App.tsx` / `WorkspaceChat` 入口可达 |
| `MemoryListPage` / `MemoryCreateDialog` / `MemoryDetailDrawer` | Phase 0 记忆管理 UI | 组件存在并已形成真实前端入口与生命周期 checkpoint；仍缺正式设计原型/追溯与筛选/分页深矩阵 |
| `StructurePanel` | 作品档案 UI | 面板存在，archive 列表已来自真实 Channel/read model；待采纳区仍来自当前 turn 的 pendingAdoptions |
| `docs/design/domain/21-novel-object-model.md` §7.2/§12.5 | character 资产层核心对象 / 主档案层（相对稳定人物档案 + 时序变化走连续性对象） | 设计冻结；CP1 已收口 `character_seed` 采纳写 `Character` 主档案且不写 memory |
| `NovelPersistence.Schemas.Character` / `WorkArchiveRepo.characters` | 角色主档案表（写/读路径）+ 角色 tab 展示 | `AdoptionRepository` 已写入 accepted Character；角色 tab 可通过真实工作台读取；CP2 待做字段级结构化与演化层 |
| `tasks/slices/AU09-character-dossier-roundtrip.md` | 角色主档案采纳回写 + AI 引导设计样板 | CP1 已闭环（两层模型 + 专用 capability，非独立 Agent）；证据 `artifacts/slice-verify/au09-character-dossier-roundtrip-tauri/summary.json` |
| `tasks/slices/AU09-archive-memory-roundtrip.md` | 伏笔/规则通过显式 artifact type 采纳后进入 governed memory 与档案 tab | CP2 已闭环：代码 + `au09-adopt-setting-recall` 外部 Tauri adoption/recall + 伏笔/规则 tab 重开可见 |
| `tasks/slices/AU09-memory-management-workbench-entry.md` | 正式记忆管理入口与状态治理 | checkpoint closed：工作台入口、创建/确认/锁定/废弃/归档与基础 recall/why 一致性已补 |
| `tasks/slices/AU09-memory-trace-roundtrip.md` | 记忆治理 trace / replay 闭环 | checkpoint closed：lifecycle/reference trace 到记忆详情 + recall/terminal why 证据已补 |
| `tasks/slices/AU09-validity-window-recall.md` | 有效期窗口参与普通召回 | checkpoint closed：章节窗口外记忆不进入普通 recall/context/why |
| `tasks/slices/AU09-cross-work-memory-isolation.md` | 跨作品记忆隔离 | checkpoint closed：真实工作台 A→B 切换后，记忆管理、档案和 recall/why 不串作品 |
| `tasks/slices/AU09-AU03-session-memory-layering.md` | 与 AU-03 active/historical session 分层对齐 | checkpoint closed：真实工作台已证明历史 transcript、active session 和 governed memory 在 context/why 中分层且不互相伪装 |

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

> 角色 CP1（2026-06-17）：`get_characters` 读 `Character` 表；真实角色创建已改为 `character_seed → Character(accepted)`，创建阶段不写 `MemoryItem(CHARACTER_PROFILE)`。外部 Tauri 验收 `au09-character-dossier-roundtrip` 已证明：作品档案角色 tab 可见已采纳角色，且下一次角色设计 turn 可收到 Character 主档案上下文。字段级拆列、关系对象和角色演化 memory 仍属 CP2。

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

**当前证据**：`StructurePanel` 的伏笔/规则 tab 已有“新建伏笔 / 新建规则”入口，发起真实对话并走 `generateMicroPlan=true`；`world_building` 按作者意图生成 `foreshadowing_seed` / `world_rule_seed` / `style_rule_seed` / `constraint_seed` tentative artifact；`AdoptionRepository` 直接按显式 artifact type 归为 `FORESHADOWING` / `WORLD_RULE` / `STYLE_RULE` / `CONSTRAINT`，并能被 `WorkArchiveRepo.foreshadowing/1` / `rules/1` 读取。局部测试已覆盖 agent prompt 与 persistence/read-model；外部 Tauri driver `au09-adopt-setting-recall` 已从真实工作台「新增伏笔」「新建规则」入口分别生成显式伏笔/规则 artifact，通过真实 `author_action` 采纳，重开伏笔/经验规则 tab 均可见，随后证明 recall 轮 `context.assemble.done has_memory=true` 且 why 面板展示“已确认设定”。

**当前状态**：CP2 checkpoint closed；伏笔/规则已有显式 tentative artifact type，`world_setting` 只保留普通世界观设定和历史兼容；CP4 已补最小 lifecycle/reference author-safe trace，`au09-validity-window-recall` 已补章节有效期窗口过滤，`au09-cross-work-memory-isolation` 已补跨作品隔离，`au09-au03-session-memory-layering` 已补同一作品内会话/记忆分层。AU09 整体仍缺完整独立 MemoryTrace/StateTrace 表、developer replay 和历史旧 turn 查询。

---

### 场景组 B：记忆管理页面

#### SC-AU09-B1 — 打开记忆管理页面并读取当前作品记忆

**作为作者**，我打开记忆管理页面，看到当前作品的所有设定。

**期望结果**：
- App 内有可发现入口；
- 页面按当前 `work_id` 调真实 API；
- 后端存在 `GET /api/works/:id/memories`；
- 失败时显示可恢复错误。

**当前证据**：`MemoryListPage` 组件存在；`App.tsx` 已在 `mode === "memory"` 时挂载该页，`WorkspaceChat` 头部「记忆」按钮可从真实工作台进入。`NovelWeb.MemoriesController.index/2` 与 Router 已提供 `GET /api/works/:work_id/memories`，通过 `NovelApplication.MemoryManagementService` 按当前 Work 查询并返回 `{ok, data, count}`；controller 测试覆盖缺失 work 的可恢复错误。`au09-memory-create-recall` 与 `au09-memory-management-entry` 均已从真实工作台打开管理页。

**当前状态**：checkpoint closed / 最小真实前端入口闭环已补；正式 UI 设计追溯仍待补。

---

#### SC-AU09-B2 — 筛选、搜索、排序当前作品设定

**作为作者**，我按类型、范围、状态、锁定状态和关键词筛选设定。

**期望结果**：
- 多筛选条件以 AND 组合；
- 查询只返回当前 Work；
- 11 种类型、6 种范围、6 种状态与后端枚举一致；
- 大量记忆时分页/limit 生效。

**当前证据**：`MemoryListPage` 维护 filter state，`memoryApi.listMemories` 会拼 query string；`MemoryManagementRepo.list/2` 已支持 type/scope/status/source_type/locked/recallable/keyword/limit/offset，AND 过滤并按 work 隔离，测试覆盖 keyword 先过滤再分页。

**当前状态**：部分实现 / 后端 REST checkpoint 已补；真实前端入口已闭环，但筛选/分页深矩阵未做真实页面验收。

---

#### SC-AU09-B3 — 作者新建一条设定

**作为作者**，我新建“林瑶失踪与灵源矿区有关”，选择类型、范围、来源和权重，保存后它出现在当前作品列表。

**期望结果**：
- 必填字段校验；
- enum 非法值后端拒绝；
- 写入当前 `work_id`；
- 新设定默认 status 明确；
- 新建动作可追溯。

**当前证据**：`MemoryCreateDialog` 与 `memoryApi.createMemory` 存在；`NovelWeb.MemoriesController.create/2` 已接 `POST /api/works/:work_id/memories`。`MemoryManagementService.create/2` 只接 allowlist 字段，忽略 caller-provided status，让新设定从 schema 默认 DRAFT 开始；必填、enum、weight 仍由 `MemoryItem.changeset/2` 拦截。测试覆盖 create/list response shape 与跨 Work 隔离。`au09-memory-management-entry` 已从真实管理页创建 DRAFT 记忆并在详情中回读。

**当前状态**：checkpoint closed / 创建最小真实前端闭环已补；字段校验错误 UX 与跨作品 UI 矩阵未闭环。

---

### 场景组 C：设定生命周期治理

#### SC-AU09-C1 — 草稿确认后才成为可召回设定

**作为作者**，AI 或我创建的草稿设定必须经确认后才进入普通对话召回。

**期望结果**：
- `DRAFT -> CONFIRMED` 有后端受控动作；
- 非法状态跳转被拒绝；
- draft 不进入普通 `memory_summary`；
- 确认动作留下来源。

**当前证据**：`NovelDomain.MemoryItem.confirm/1` 和 `MemoryDetailDrawer.confirmMemory` 存在；`MemoryItem.update_changeset/2` 已拒绝 DRAFT 直接跳 STABILIZED、DEPRECATED/ARCHIVED 复活，并由 `NovelDomain.MemoryItem.status_transition_allowed?/2` 统一维护领域规则；`POST /api/works/:work_id/memories/:id/confirm` 已通过 application service 接入该 guard，并把 source_type 更新为 AUTHOR_CONFIRMED。`au09-memory-management-entry` 已证明真实页面确认后该记忆可召回，why 面板显示“已确认设定”来源。

**当前状态**：checkpoint closed / 最小真实前端确认与召回闭环已补；CP4 已补 lifecycle/reference author-safe 追溯。

---

#### SC-AU09-C2 — 废弃/归档设定不再召回

**作为作者**，我废弃或归档旧设定后，AI 后续普通对话不能再引用它。

**期望结果**：
- `DEPRECATED` / `ARCHIVED` 同步设置 `recallable = false`；
- recall 查询过滤不可召回设定；
- trace 显示它未被引用或被排除；
- 手动查看历史仍保留记录。

**当前证据**：`NovelDomain.MemoryItem.deprecate/1` / `archive/1` 会设 `recallable: false` 并清理 `locked=false`；`MemoryItem.update_changeset/2` 在进入 DEPRECATED/ARCHIVED 时同步写入 `recallable=false`，召回查询只读取 confirmed/stabilized 且 recallable 的记忆；`POST /deprecate` 与 `POST /archive` 已接 REST 管理入口，controller/service/repo 测试覆盖 terminal side effect。`au09-memory-management-entry` 已从真实管理页废弃一条记忆、归档另一条记忆，并证明后续相关对话的 memory context / why 不再包含这两条 terminal memory 内容。

**当前状态**：checkpoint closed / 最小真实前端生命周期与 recall 过滤闭环已补；CP4 已补 terminal 排除在记忆详情追溯和后续 why 内容隔离中的证据。

---

#### SC-AU09-C3 — 锁定设定可引用但不可被自动改写

**作为作者**，我锁定核心世界观设定后，AI 仍可引用，但不能自动修改其内容。

**期望结果**：
- `locked = true` 后仍可召回；
- 自动更新/AI 提取流程不能改 content/summary/type/scope；
- 作者主动解锁或显式确认后才可改；
- 修改尝试有失败原因和 trace。

**当前证据**：domain 有 `lock/1`、`modifiable?/1` 和 `locked_protected_fields/0`；persistence `update_changeset/2` 已按领域字段集合拒绝改写 locked item 的 content/summary/type/scope，同时允许权重、置信度、召回开关等治理元数据维护；`POST /lock` / `POST /unlock` 已接 REST 管理入口。`au09-memory-management-entry` 已证明真实页面锁定后终端动作按钮禁用、locked 记忆仍能进入后续 recall/why；主链自动更新 guard 和修改尝试 trace 仍缺。

**当前状态**：checkpoint closed / locked 可召回与 UI guard 已补；locked terminal 后端尝试已被拒绝并记录 blocked trace。自动改写内容字段的真实生产尝试仍待后续自动治理链路出现后补。

---

#### SC-AU09-C4 — 章节/场景有效期影响召回

**作为作者**，一条只在第一章有效的设定，在第二章之后不应继续被普通对话引用。

**期望结果**：
- 作者可设置 `valid_from` / `valid_until`；
- 当前叙事位置参与 recall；
- 窗口外记忆不召回或降权并标注原因；
- 历史会话引用不覆盖当前 Work 最新状态。

**当前证据**：`MemoryRecallRepo.recall/3` 会先计算当前作品已采纳正文的最大章节序号，并把 `valid_from` / `valid_until` 的 chapter UUID 解析到同一 seq 空间；窗口外记忆在普通召回前被过滤。后端 `memory_recall_repo_test.exs` 覆盖窗口外排除、窗口内保留、无窗口保留、无已采纳章节不限制和无效边界不约束；外部 Tauri `au09-validity-window-recall` 已证明真实工作台发送同时命中两条记忆的消息时，只召回无窗口/当前窗口内记忆，why 面板不显示窗口外记忆。

**当前状态**：checkpoint closed；scene-level 窗口、降权而非排除策略和乱序采纳 story-order 字段仍属后续深化。

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

**当前状态**：部分实现 / 最小真实前端闭环已补。章节有效期窗口已由 `au09-validity-window-recall` 证明，跨作品隔离已由 `au09-cross-work-memory-isolation` 证明；同一作品 active/historical session 与 governed memory 分层已由 `au09-au03-session-memory-layering` 证明。AI 自动改写 locked 内容的生产链路反证待对应能力出现后补。

---

#### SC-AU09-D2 — 记忆引用可溯源

**作为作者**，我能查看 AI 本轮引用了哪条设定、为什么引用、来自哪次确认。

**期望结果**：
- recall 后写入 `memory_reference_logs`；
- trace/replay 聚合 memory source refs；
- 作者视图显示脱敏中文摘要；
- 开发者视图可看到完整 source id 和引用原因。

**当前证据**：`MemoryReferenceLog` helper 和测试存在；`WorkspaceContext.context_fetcher_with_query/0` 在召回后批量写入 `memory_reference_logs` 并递增 `reference_count` / `last_referenced_at`；`TraceWriter` 已把 author-safe `ContextSourceRef.summary` 放入 `trace_summary.context_refs`；`WorkspaceChat` 的“为什么”面板展示来源标签与摘要；`bash scripts/tauri_slice_verify.sh au09-memory-recall-context` 已从真实工作台证明记忆摘要可见。

**当前状态**：部分实现 / 最小真实前端闭环已补。

---

#### SC-AU09-D3 — 与 AU-03 最新作品背景和作品内会话分层一致

**作为作者**，我打开历史会话回看旧讨论时，AI/界面不能用旧会话状态覆盖当前作品最新设定；新会话继续创作时应使用当前 Work 最新背景和 confirmed memory。

**期望结果**：
- Work 最新背景、active session transcript、historical session、memory_summary 分层；
- memory 按当前 Work 隔离；
- archived session 默认不参与普通 context；
- trace 标明 memory 与 conversation 的不同来源。

**当前证据**：`au03-current-work-context-ssot` 已证明打开历史只读 transcript 后返回 active session，下一轮 prompt 使用最新 Work 背景 + 当前 active session transcript，旧历史 session 未覆盖当前作品事实；`au09-cross-work-memory-isolation` 已证明 memory 按当前 Work 隔离；`au09-au03-session-memory-layering` 已在同一真实工作台场景中证明 historical read-only transcript 不进入普通 context、不伪装成 memory，下一轮 `trace_summary.context_refs` 同时包含 `current_work`、`session_transcript` 和 `memory`。

**当前状态**：checkpoint closed；证据 `artifacts/slice-verify/au09-au03-session-memory-layering-tauri/summary.json`。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 证据等级 |
|---|---|---|---|
| SC-AU09-A1 | 打开档案看真实统计 | 部分实现 / 最小真实前端闭环已补 | Tauri UI + Channel + persistence |
| SC-AU09-A2 | 分类浏览真实作品内容 | 部分实现 / 最小真实前端闭环已补 | Tauri UI + Channel + persistence |
| SC-AU09-A3 | 待采纳不混入已确认 | 部分实现 | 前端当前 turn 内存 |
| SC-AU09-A4 | 面板内采纳进入真实记忆 | CP2 checkpoint closed | `world_building` prompt + `foreshadowing_seed` / `*_rule_seed` governed memory 分类 + archive read-model 单测 + `au09-adopt-setting-recall-tauri`（伏笔/规则 tab 重开可见 + recall/why） |
| SC-AU09-B1 | 打开记忆管理页 | checkpoint closed | `MemoryListPage` 已经从 `App.tsx` / `WorkspaceChat` 真实入口可达；`au09-memory-management-entry-tauri` 复验入口。 |
| SC-AU09-B2 | 筛选搜索设定 | 部分实现 / 后端 REST checkpoint 已补 | 前端 query client + 后端过滤/分页测试；筛选/分页真实页面深矩阵未闭环 |
| SC-AU09-B3 | 新建作者设定 | checkpoint closed | `au09-memory-management-entry-tauri` 真实页面创建 DRAFT 并在详情回读；后端 schema 校验和跨 Work 隔离已有局部测试 |
| SC-AU09-C1 | 草稿确认后可召回 | checkpoint closed | 真实页面确认后召回，why 显示“已确认设定”；记忆详情可见确认 lifecycle trace |
| SC-AU09-C2 | 废弃/归档不召回 | checkpoint closed | 真实页面废弃/归档后，这两条 terminal memory 不再进入后续 memory context / why 内容；记忆详情可见 terminal lifecycle trace |
| SC-AU09-C3 | 锁定设定不可自动改写 | checkpoint closed | locked 记忆仍可召回；UI 禁用终端动作直到解锁；后端拒绝 locked terminal action 并记录 blocked trace |
| SC-AU09-C4 | 有效期影响召回 | checkpoint closed | `MemoryRecallRepo` 章节窗口过滤 + `au09-validity-window-recall-tauri`（窗口外记忆不进 context/why） |
| SC-AU09-D1 | 已确认设定进入主链 prompt | 部分实现 / 最小真实前端闭环已补 | Tauri UI + context assembler + real fetcher；跨作品隔离已由 `au09-cross-work-memory-isolation-tauri` 复验 |
| SC-AU09-D2 | 记忆引用可溯源 | checkpoint closed / 最小 trace read model 已补 | `memory_reference_logs` 已写入 recall 与 lifecycle trace；真实工作台“为什么”面板可展示本轮使用的记忆来源摘要，记忆详情展示 lifecycle/reference 追溯；完整 developer replay 和历史旧 turn 查询未闭环 |
| SC-AU09-D3 | 与 AU-03 会话/最新背景分层一致 | checkpoint closed | `au09-au03-session-memory-layering-tauri`：历史只读会话回看后返回 active session，context/why 区分 current work、session_transcript 和 memory，排除历史 transcript |

**覆盖率重算**：0/14 完整真实前后端验收；13/14 已有最小真实前端闭环但仍缺完整场景后果；14/14 有局部证据或基础设施；AU09 当前剩余 P0/P1 缺口转向 developer replay、历史旧 turn 查询、Channel 管理入口和完整独立 MemoryTrace/StateTrace 表。

---

## 6. 缺口

| 缺口 | 具体表现 | 类型 | 优先级 |
|---|---|---|---|
| AU09-GAP-01 — 记忆 REST/Channel 管理入口缺失 | REST 最小入口已补：`/api/works/:work_id/memories...` 支持 list/create/show/lifecycle/weight/validity/recall/references；真实工作台入口与创建/确认/锁定/废弃/归档前端发起验收已补；剩余 Channel 管理入口、正式 UI 设计追溯和筛选/分页深矩阵 | 前端管理入口 checkpoint closed / 继续补集成 | P0 |
| AU09-GAP-02 — 作品档案仍是 mock 数据 | `get_characters` / `get_foreshadowing` / `get_rules` / `get_work_stats` 固定样例已移除；`get_toc` 已由 AU-08 读取 accepted draft 投影；档案详情面已补最小只读 checkpoint；跨作品 UI 隔离已由 `au09-cross-work-memory-isolation` 证明；剩余是完整 AU-09 覆盖 | 最小闭环已补 / 继续补验收 | P0/P1 |
| AU09-GAP-03 — 面板采纳未进入真实记忆 | CP2 已补：显式伏笔/规则 artifact 采纳后会写入 governed memory，并能按伏笔/规则语义进入档案 read model；`au09-adopt-setting-recall` 已证明真实档案入口发起、采纳、伏笔/规则 tab 重开可见、recall/why | checkpoint closed | P0 |
| AU09-GAP-04 — `memory_summary` 未接主链 | 最小闭环已补：真实 fetcher 返回 `memory_summary` 并进入 Planner context；章节有效期窗口、跨作品隔离和 AU-03 会话分层已补；剩余 locked 自动改写反证与完整 replay | 最小闭环已补 / 继续补验收 | P0 |
| AU09-GAP-05 — recall 查询和 ranking 缺失 | 最小闭环已补：`MemoryRecallRepo` 按 work/status/recallable/query 做基础召回排序，并按当前章节位置过滤 `valid_from` / `valid_until`；剩余 scene-level 窗口、冲突/locked 策略和更细 ranking | 最小闭环已补 / 继续补实现 | P0 |
| AU09-GAP-06 — 状态机后端 guard 缺失 | `update_changeset/2` 已消费 `NovelDomain.MemoryItem` 状态流转规则，拒绝跳级、terminal 状态复活和 locked terminal 迁移；REST confirm/deprecate/archive 已接入；真实页面 confirm/deprecate/archive 与 recall 影响已补；lifecycle trace 已写入 reference log | checkpoint closed / 后续补完整 StateTrace table | P0 |
| AU09-GAP-07 — locked 保护未落地 | persistence update 已拒绝 locked item 的 content/summary/type/scope 改写，REST lock/unlock 已接入；真实页面 locked 可召回与终端动作禁用已补；locked terminal action 在后端被拒绝并记录 blocked trace | checkpoint closed / 自动内容改写尝试待后续生产链路出现后补 | P0 |
| AU09-GAP-08 — 有效期窗口未参与召回 | 章节级 checkpoint 已闭环：`valid_from` / `valid_until` 参与普通 recall，窗口外记忆不进入 context/why；剩余 scene-level 窗口、降权策略和 story-order 字段深化 | checkpoint closed / 后续深化 | P1 |
| AU09-GAP-09 — 引用日志未接 recall | 最小闭环已补：召回后写 `memory_reference_logs` 并更新引用计数；lifecycle trace 也进入同一 read model；剩余历史旧 turn 查询和独立 replay 聚合 | checkpoint closed / 继续补 replay | P1 |
| AU09-GAP-10 — 作者可见溯源缺失 | 最小闭环已补：真实工作台“为什么”面板展示本轮召回的记忆来源摘要；记忆详情展示 lifecycle/reference author-safe 追溯；剩余 developer replay 和历史旧 turn 查询 | checkpoint closed / 继续补 replay | P1 |
| AU09-GAP-11 — 管理页面缺正式设计追溯 | Phase 0 组件已挂到 App 并有真实入口/生命周期验收；仍无正式设计原型/追溯和筛选/分页深矩阵 | 修设计偏差/补验收 | P2 |
| AU09-GAP-12 — 与 AU-03 会话模型未对齐 | checkpoint closed：`au09-au03-session-memory-layering` 已证明 active session、historical session、current work snapshot 与 governed memory 在 context/why 中分层，历史 transcript 不覆盖当前作品事实，也不伪装成 memory | checkpoint closed / 后续补 replay | P0/P1 |
| AU09-GAP-13 — 角色主档案 roundtrip 断链 | **CP1 已闭环**：`character_seed` 采纳写 `Character` accepted 主档案并且不写 memory；角色 tab 可见；下一次角色设计/正文上下文可读 Character。证据：`bash scripts/tauri_slice_verify.sh au09-character-dossier-roundtrip`，summary 中 `archive_character_count=1`、`context_character_count=1`、`adopted_state_ref=<character_id>`。剩余 CP2：字段级结构化、关系对象、角色演化 memory 与双层上下文协同。 | CP1 done / CP2 待拆 | P0 |

---

## 7. 已知限制 / 现有基础设施

| 基础设施 | 可复用点 | 不能算已验收的原因 |
|---|---|---|
| `MemoryItem` schema + migration | 字段、枚举、索引基本存在；locked core fact rewrite 与状态机 guard 已在 update changeset 拦截，并被 REST 管理入口和真实管理页生命周期验收消费 | 最小 lifecycle trace 已补；仍缺完整 recall policy、正式 UI 设计追溯和独立 StateTrace/MemoryTrace 表 |
| `NovelDomain.MemoryItem` | 纯函数表达生命周期动作，并声明 locked 保护字段集合与状态流转 allowlist | 已由 REST 管理入口通过 schema update guard 消费；最小生命周期追溯已补，完整 StateTrace/replay 待后续 |
| `MemoryReferenceLog` | 可写引用日志，已由 recall 主链和 lifecycle 动作调用 | 最小作者可见 UI 聚合已补；仍缺 developer replay 和历史旧 turn 查询 |
| `ContextAssembler` / `DialogueContext` | `memory_summary` 能进入 prompt；真实 fetcher 已提供最小 memory summary，召回前会过滤章节窗口外记忆；session-scoped transcript 已用 `session_transcript` 与 generic conversation fallback 区分 | 仍缺完整 replay 和历史旧 turn 查询 |
| `StructurePanel` | 档案面板视觉壳、真实 archive 读模型和 pending 分区 | 已确认档案数据已有最小真实链路；pending 仍来自 adoption/resume 视图，记忆管理、召回和溯源未闭环 |
| `MemoryListPage` 系列组件 | Phase 0 管理表格/表单/详情 | App 入口和创建/确认/锁定/废弃/归档真实前端验收已补；仍无正式设计规范/原型追溯，筛选/分页深矩阵未闭环 |

---

## 8. 验收命令

```bash
# 当前只能证明局部基础设施，不证明 AU-09 完整验收
mix test apps/novel_persistence/test/novel_persistence/schemas/memory_item_test.exs
mix test apps/novel_domain/test/novel_domain/memory_item_test.exs
mix test apps/novel_persistence/test/novel_persistence/memory_reference_log_test.exs
mix test apps/novel_persistence/test/novel_persistence/memory_recall_repo_test.exs
mix test apps/novel_persistence/test/novel_persistence/memory_management_repo_test.exs
mix test apps/novel_application/test/novel_application/memory_management_service_test.exs
mix test apps/novel_web/test/novel_web/controllers/memories_controller_test.exs
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
mix test apps/novel_persistence/test/novel_persistence/workspace_context_test.exs
bash scripts/tauri_slice_verify.sh au09-memory-recall-context
bash scripts/tauri_slice_verify.sh au09-character-dossier-roundtrip
bash scripts/tauri_slice_verify.sh au09-cross-work-memory-isolation
bash scripts/tauri_slice_verify.sh au09-au03-session-memory-layering
```

后续真正闭环后至少需要新增：
- Channel 管理 API 测试与正式前端入口验收；
- recall -> `memory_summary` -> prompt -> trace/reference log 的完整场景覆盖；
- confirmed/deprecated/archived/locked/validity 的主链召回测试；
- 工作台/记忆管理 UI 自动化或真人 walkthrough。
