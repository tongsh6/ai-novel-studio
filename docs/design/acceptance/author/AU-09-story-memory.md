# AU-09 管理故事设定

> 作者视角：我的小说有大量设定、角色关系、伏笔线索、世界观规则。我需要能管理这些设定，并且 AI 在后续对话中能自动、可追溯地引用已确认设定。
>
> 2026-06-21 文件级重算结论：AU-09 当前为 **文件级可交付 / P1 后续登记**。14 个场景中，10/14 已验收、1/14 已测试、3/14 部分实现；P0 缺口已关闭，当前可进入 AU-10。当前“已验收”只以 `scripts/tauri_slice_verify.sh --list` 中可复跑的 AU-09 入口和 quality manifest 为准：`au09-memory-create-recall`、`au09-memory-management-entry`、`au09-memory-trace-roundtrip`、`au09-adopt-setting-recall`、`au09-character-dossier-roundtrip`、`au09-validity-window-recall`、`au09-cross-work-memory-isolation`、`au09-au03-session-memory-layering`。历史 `au09-archive-real-data` / `au09-memory-recall-context` artifact 只作为演进背景，不再单独支撑当前 runnable truth。
>
> 2026-06-22 二轮缺口收敛结论：不回退 2026-06-21 文件级可交付判断。8 个当前 AU-09 quality/Tauri 入口已串行复跑通过；未发现需要在 AU-09 本轮先改生产代码才能继续 AU-10 的新增 P0/P1。剩余 P1 仍是 SC-AU09-A1 完整 archive stats current driver、SC-AU09-A3 持久 adoption inbox / pending archive view、SC-AU09-B2 筛选分页真实页面矩阵、SC-AU09-D2 developer replay / 历史旧 turn 查询 / 完整 MemoryTrace-StateTrace 聚合；它们继续作为后续 checkpoint 或 AU-05/AU-07 cross-owner 登记。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 打开作品档案面板 | 看到当前作品的真实大纲、角色、伏笔、规则；概览统计已接真实 read model，但完整统计矩阵仍是 P1 |
| 浏览大纲/角色/伏笔/规则 | 每个分类从当前 Work 的持久化事实读取，不展示固定 mock，跨作品切换不串数据 |
| 看到待采纳设定 | 待采纳内容不自动污染已确认记忆；持久待处理箱和恢复矩阵仍是 P1 |
| 采纳伏笔/规则设定 | 采纳后进入 confirmed recallable governed memory，并能在后续对话和 why 中出现 |
| 打开记忆管理页面 | 从真实工作台进入当前作品记忆管理页，创建、确认、锁定、废弃、归档记忆 |
| 管理记忆生命周期 | 状态流转受后端 guard 保护，terminal memory 不再进入普通 recall |
| 设置章节有效期 | 章节级 `valid_from` / `valid_until` 参与普通 recall，窗口外记忆不进入 context/why |
| 和 AI 聊天时自动引用设定 | 已确认、可召回、当前 Work 且在有效窗口内的设定进入 context/prompt |
| 查看 AI 为什么引用设定 | why 面板和记忆详情展示 author-safe 来源/治理追溯；developer replay 与历史旧 turn 查询仍是 P1 |

明确不能做：

- 把 UI 中选中的 candidate 当成已采纳记忆；
- 把草稿、废弃、归档、不可召回或过期设定默认塞进 prompt；
- 在历史会话重入时，用旧会话里的设定覆盖当前 Work 最新作品背景；
- 没有来源时让 AI 声称“你的作品已经设定了”。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU09-I1 / `00c` #5 | 记忆引用和状态变更必须可追溯 | `au09-memory-trace-roundtrip`、SC-AU09-D2 |
| AU09-I2 / `00c` #11 | selection 不等于 adoption | `au09-adopt-setting-recall`、AU-05 adoption boundary 证据、SC-AU09-A3 |
| AU09-I3 | 只有 confirmed/stabilized 且 recallable 的记忆可进入普通召回 | `au09-memory-create-recall`、`au09-memory-management-entry`、SC-AU09-C1/C2 |
| AU09-I4 | locked 设定可引用但不可被 AI 自动改写 | `au09-memory-management-entry`、`au09-memory-trace-roundtrip`、schema/service guard 测试 |
| AU09-I5 | 记忆召回必须按当前 Work 隔离，并与 AU-03 最新作品背景分层 | `au09-cross-work-memory-isolation`、`au09-au03-session-memory-layering` |
| AU09-I6 | 有效期窗口必须影响召回 | `au09-validity-window-recall` |

---

## 3. 契约引用

| 契约 / 实现 | 用途 | 当前判断 |
|---|---|---|
| `docs/design/06-memory-context-and-trace.md` | MemoryType / Scope / Status / SourceType、recall、reference log、trace 语义 | 已被 schema、service、recall、why 和 AU-09 drivers 消费 |
| `NovelFoundation.Enums.Memory*` / `NovelDomain.MemoryItem` | 编译期枚举和纯领域生命周期 guard | 已由 schema/service 测试和真实管理页生命周期消费 |
| `NovelPersistence.Schemas.MemoryItem` / `MemoryManagementRepo` / `MemoryRecallRepo` | current-work list/create/show/lifecycle/recall/references、validity window | 局部测试覆盖过滤、分页、状态机、locked guard、窗口过滤；真实 Tauri 覆盖核心 recall |
| `NovelApplication.MemoryManagementService` / `WorkspaceContext.context_fetcher_with_query/0` | 用例边界和对话上下文 fetcher | 已将 confirmed recallable memory 接入 `memory_summary` / `trace_summary.context_refs` |
| `NovelApplication.ContextAssembler` / `DialogueContext.to_prompt_text/1` | 接收 `memory_summary` 并写入 prompt | 应用测试和 Tauri recall drivers 均证明可用 |
| `NovelWeb.MemoriesController` / Router REST routes | 记忆管理 HTTP API | 工作台管理页已通过真实入口消费；Channel 管理入口仍是 P1 |
| `WorkspaceChannel` structure handlers / `WorkArchiveService` | 作品档案大纲、角色、伏笔、规则、统计 read model | 固定 mock 已移除；角色、伏笔、规则和 TOC 有当前 Tauri 证据；完整 stats/detail matrix 是 P1 |
| `MemoryListPage` / `MemoryCreateDialog` / `MemoryDetailDrawer` | 记忆管理 UI | 当前工作台入口、创建确认、生命周期、引用追溯已验收；正式 Pencil 追溯是 P2 |
| `docs/design/domain/21-novel-object-model.md` §7.2 / `NovelPersistence.Schemas.Character` | 角色主档案层 | `au09-character-dossier-roundtrip` 证明 `character_seed` 采纳写 Character 主档案且进入后续上下文 |
| `tasks/slices/AU09-*.md` | checkpoint 历史、开工检查和证据记录 | 当前以 `AU09-file-level-closure.md` 作为文件级收口入口 |
| `quality/acceptance/scenarios/au09-*.yml` | 当前可复跑质量入口 | 8 个 AU-09 driver 已登记为 nightly Tauri acceptance |

---

## 4. 场景对账矩阵

| 场景 ID / 名称 | 设计期望 | Contract / invariant | 实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint / slice |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU09-A1 打开档案看到真实作品全貌 | 当前作品名、卷数、已采纳草稿数、角色数、设定数、待审核数按当前 `work_id` 展示，无数据诚实空态 | Work archive read model；AU09-I5 | `StructurePanel`、`WorkspaceChannel.get_work_stats`、`WorkArchiveService` | archive service / persistence 相关测试；历史 `au09-archive-real-data` 仅作背景 | 当前可复跑 driver 只覆盖角色/伏笔/规则/跨作品隔离，未覆盖完整 stats 矩阵 | 部分实现 | 概览 stats 曾有历史 artifact，但未挂回当前 driver/quality | 验收缺口 | P1 | `AU09-file-level-closure.md` 后续：archive stats current driver |
| SC-AU09-A2 分类浏览大纲、角色、伏笔、规则 | 大纲、角色、伏笔、规则均按当前 Work 读取，跨作品隔离，空态不冒充事实 | Work archive read model；AU09-I5 | `get_toc`、`get_characters`、`get_foreshadowing`、`get_rules`、`StructurePanel` | WorkArchive / adoption / reading projection 测试 | `au09-character-dossier-roundtrip`、`au09-adopt-setting-recall`、`au09-cross-work-memory-isolation`、AU-08 reading drivers | 已验收 | 无；大纲证据 cross-reference AU-08 | 无 | done | 已挂入 AU-09 / AU-08 quality |
| SC-AU09-A3 待采纳设定不混入已确认设定 | pending adoption 与 confirmed memory 分离；采纳前不进入 context recall；刷新恢复或丢失要诚实 | AU09-I2；AU-05 adoption boundary | `StructurePanel.pendingAdoptions`、`AdoptionWorkflow`、`AdoptionRepository` | AU-05 adoption boundary、pending no-write、reading no-fact 测试 | `au09-adopt-setting-recall` 证明采纳后才进入 governed memory；AU-05 drivers 证明未采纳不入事实 | 部分实现 | pending 仍是当前 turn/resume 视图，缺持久 adoption inbox 和恢复矩阵 | 产品/验收缺口 | P1 | Owner: AU-05 持久 adoption inbox + AU-09 pending archive view |
| SC-AU09-A4 面板内采纳设定进入真实记忆 | 伏笔/规则从档案入口生成 tentative artifact，经 adoption 写入 confirmed memory，后续可 recall/why | AU09-I2/I3；AU-05 adoption boundary | `world_building` prompt、`foreshadowing_seed` / `*_rule_seed`、`AdoptionRepository`、`WorkArchiveRepo` | provider prompt、adoption persistence/read-model 测试 | `au09-adopt-setting-recall` | 已验收 | `world_building` 仍是工具能力名，但 artifact type 已显式化；属文档同步而非代码偏差 | 无 | done | `AU09-archive-memory-roundtrip.md` |
| SC-AU09-B1 打开记忆管理页面并读取当前作品记忆 | 从真实工作台可发现入口进入当前 Work 记忆列表，失败可恢复 | Memory REST；AU09-I3/I5 | `WorkspaceChat` 记忆入口、`MemoryListPage`、`MemoriesController.index` | controller/service/repo list tests | `au09-memory-create-recall`、`au09-memory-management-entry` | 已验收 | Phase 0 UI 缺正式 Pencil 追溯 | 设计追溯 | P2 | UI design trace follow-up |
| SC-AU09-B2 筛选、搜索、排序当前作品设定 | 类型、范围、状态、锁定、关键词 AND 过滤，枚举一致，分页/limit 生效 | Memory REST；AU09-I5 | `memoryApi.listMemories`、`MemoryManagementRepo.list/2` | repo 测试覆盖 keyword 先过滤再分页、work 隔离、filter query | 无完整真实页面筛选/分页矩阵 | 已测试 | 前端 filter UI 可用但未做深矩阵验收 | 验收缺口 | P1 | `AU09-memory-management-filter-matrix` |
| SC-AU09-B3 作者新建一条设定 | 必填/enum/weight 校验；写入当前 work；默认 DRAFT；动作可追溯 | Memory REST；AU09-I1/I3/I5 | `MemoryCreateDialog`、`MemoriesController.create`、`MemoryManagementService.create` | create/list response、schema validation、cross-work tests | `au09-memory-management-entry`、`au09-memory-create-recall` | 已验收 | 字段校验错误 UX 深矩阵未覆盖 | 验收缺口 | P2 | 管理页错误态矩阵 |
| SC-AU09-C1 草稿确认后才成为可召回设定 | `DRAFT -> CONFIRMED` 受控；draft 不召回；确认留下来源 | AU09-I1/I3 | `MemoryItem.confirm`、`POST /confirm`、recall fetcher | domain/schema/service tests | `au09-memory-create-recall`、`au09-memory-management-entry`、`au09-memory-trace-roundtrip` | 已验收 | 无 | 无 | done | 已挂入 AU-09 quality |
| SC-AU09-C2 废弃/归档设定不再召回 | `DEPRECATED` / `ARCHIVED` 同步 `recallable=false`；后续 context/why 排除 | AU09-I1/I3 | `MemoryItem.deprecate/archive`、repo recall filter | domain/schema/repo/service tests | `au09-memory-management-entry`、`au09-memory-trace-roundtrip` | 已验收 | 无 | 无 | done | 已挂入 AU-09 quality |
| SC-AU09-C3 锁定设定可引用但不可自动改写 | locked 仍可 recall；内容字段不可静默改写；失败原因可追溯 | AU09-I4 | `MemoryItem.lock/unlock`、locked protected fields、service guard、detail references | locked protected fields、blocked lifecycle tests | `au09-memory-management-entry`、`au09-memory-trace-roundtrip` | 已验收 | 自动内容改写生产链路当前不存在，等真实消费者出现再补反证 | 后续深化 | P2 | 自动治理链路出现后补 locked overwrite driver |
| SC-AU09-C4 章节/场景有效期影响召回 | 当前叙事位置参与 recall，窗口外记忆不召回或降权并解释 | AU09-I6 | `MemoryRecallRepo.recall/3`、accepted chapter seq | `memory_recall_repo_test.exs` | `au09-validity-window-recall` | 已验收 | 当前是章节级过滤；scene-level 和降权策略未做 | 产品深化 | P2 | validity window CP2 |
| SC-AU09-D1 已确认设定进入主链 context 和 prompt | confirmed/stabilized recallable memory 进入 `memory_summary` / prompt / trace refs，不编造来源 | AU09-I3/I5 | `WorkspaceContext.context_fetcher_with_query/0`、`ContextAssembler`、`DialogueContext`、`TraceWriter` | context grounding、workspace context、dialogue gateway tests | `au09-memory-create-recall`、`au09-adopt-setting-recall`、`au09-validity-window-recall`、`au09-cross-work-memory-isolation` | 已验收 | 无 | 无 | done | 已挂入 AU-09 quality |
| SC-AU09-D2 记忆引用可溯源 | recall 写 reference log；作者视图可见脱敏来源；开发者视图可看完整 source/reason | AU09-I1；AU-07 trace | `MemoryReferenceLog`、`TraceWriter`、why panel、`MemoryDetailDrawer` references | reference log、trace summary、service tests | `au09-memory-trace-roundtrip`；why 证据来自 `au09-memory-create-recall` / `au09-adopt-setting-recall` | 部分实现 | author-safe 追溯已闭环；developer replay、历史旧 turn 查询、完整独立 MemoryTrace/StateTrace 表未闭环 | Trace/replay 缺口 | P1 | Owner: AU-07 replay + AU-09 trace follow-up |
| SC-AU09-D3 与 AU-03 最新作品背景和作品内会话分层一致 | Work 最新背景、active session、historical session、memory 分层；archived/history 不污染普通 context | AU09-I5；AU-03 context SSOT | work session resume/show、context fetcher、TraceWriter why refs | AU-03 context tests、session tests | `au09-au03-session-memory-layering`；cross-reference `au03-current-work-context-ssot` | 已验收 | 无 | 无 | done | `AU09-AU03-session-memory-layering.md` |

---

## 5. 文件级 review 和完成计划

**当前审计结论**

- 已验收：SC-AU09-A2、A4、B1、B3、C1、C2、C3、C4、D1、D3。
- 已测试：SC-AU09-B2。
- 部分实现：SC-AU09-A1、A3、D2。
- 未实现 / 不确定：无。
- 2026-06-22 二轮复核：上述分类保持不变；8 个当前 quality/Tauri 入口复跑通过，没有新增 AU-09 本文件内必须关闭的 blocker。

**P0**

- 当前无剩余 P0。核心 AU-09 风险已经有真实页面外部自动化：confirmed memory recall、terminal memory exclusion、locked guard、validity window、cross-work isolation、setting adoption into governed memory、character dossier roundtrip、session/memory/source layering。

**P1**

- SC-AU09-A1：完整档案概览 stats/detail current driver。现有历史 artifact 不再算当前 runnable evidence；恢复路径是新增 `au09-archive-stats-current` quality driver 或把 stats 断言并入现有 cross-work archive driver。
- SC-AU09-A3：持久 adoption inbox / pending archive view 恢复矩阵。Owner 应归 AU-05 adoption inbox + AU-09 archive pending view，不阻塞当前 governed memory 主链。
- SC-AU09-B2：筛选、搜索、分页真实页面深矩阵。已有后端测试，缺 Tauri UI driver。
- SC-AU09-D2：developer replay、历史旧 turn 查询、完整独立 MemoryTrace/StateTrace 表。Owner 与 AU-07 trace/replay 共管。
- 2026-06-22 二轮判断：以上 P1 均不是本轮进入 AU-10 前必须关闭项；不得把历史 artifact 补写成当前已验收，也不得把 developer replay 缺口误判为当前 AU-09 P0。

**P2**

- 管理页 Phase 0 UI 的正式 Pencil 追溯和更多错误态。
- scene-level validity window、降权策略、story-order 字段深化。
- locked 自动内容改写反证等未来生产能力出现后的专项验收。

**Cross-reference**

- AU-03：会话/作品背景分层由 `au09-au03-session-memory-layering` 和 `au03-current-work-context-ssot` 共同支撑。
- AU-05：pending/adoption boundary 和持久 adoption inbox 属跨文件 owner。
- AU-07：developer replay、历史旧 turn 查询和完整 trace 聚合属跨文件 owner。
- AU-08：大纲/TOC 和采纳正文读取证据为档案分类浏览提供 cross-reference。
- SU-02：跨作品切换/隔离语义由 `au09-cross-work-memory-isolation` 复用。

---

## 6. 文件级 checkpoint 记录

| Checkpoint | 状态 | 证据 |
|---|---|---|
| AU09 archive memory roundtrip | 已完成 | `artifacts/slice-verify/au09-adopt-setting-recall-tauri/summary.json` |
| AU09 character dossier roundtrip CP1 | 已完成 | `artifacts/slice-verify/au09-character-dossier-roundtrip-tauri/summary.json` |
| AU09 memory management workbench entry | 已完成 | `artifacts/slice-verify/au09-memory-management-entry-tauri/summary.json` |
| AU09 memory create/recall | 已完成 | `artifacts/slice-verify/au09-memory-create-recall-tauri/summary.json` |
| AU09 memory trace roundtrip | 已完成 | `artifacts/slice-verify/au09-memory-trace-roundtrip-tauri/summary.json` |
| AU09 validity window recall | 已完成 | `artifacts/slice-verify/au09-validity-window-recall-tauri/summary.json` |
| AU09 cross-work memory isolation | 已完成 | `artifacts/slice-verify/au09-cross-work-memory-isolation-tauri/summary.json` |
| AU09 / AU03 session memory layering | 已完成 | `artifacts/slice-verify/au09-au03-session-memory-layering-tauri/summary.json` |
| AU09 quality manifest sync | 本轮完成 | `quality/acceptance/scenarios/au09-*.yml` |
| AU09 file-level closure | 本轮完成 | `tasks/slices/AU09-file-level-closure.md` |

---

## 7. 文件级验证

当前文件级闭环必须使用当前可复跑入口：

```bash
bash scripts/tauri_slice_verify.sh --list | rg au09
bash scripts/quality_accept.sh au09-memory-create-recall --surface tauri
bash scripts/quality_accept.sh au09-memory-management-entry --surface tauri
bash scripts/quality_accept.sh au09-memory-trace-roundtrip --surface tauri
bash scripts/quality_accept.sh au09-adopt-setting-recall --surface tauri
bash scripts/quality_accept.sh au09-character-dossier-roundtrip --surface tauri
bash scripts/quality_accept.sh au09-validity-window-recall --surface tauri
bash scripts/quality_accept.sh au09-cross-work-memory-isolation --surface tauri
bash scripts/quality_accept.sh au09-au03-session-memory-layering --surface tauri
bash scripts/quality_manifest_check.sh
bash scripts/task_done.sh --skip-static-scan && node scripts/task_done_check.mjs
bash scripts/ai_static_scan.sh --top 10
```

局部测试证据（按改动范围选择复跑）：

```bash
mix test apps/novel_domain/test/novel_domain/memory_item_test.exs
mix test apps/novel_persistence/test/novel_persistence/schemas/memory_item_test.exs
mix test apps/novel_persistence/test/novel_persistence/memory_reference_log_test.exs
mix test apps/novel_persistence/test/novel_persistence/memory_recall_repo_test.exs
mix test apps/novel_persistence/test/novel_persistence/memory_management_repo_test.exs
mix test apps/novel_application/test/novel_application/memory_management_service_test.exs
mix test apps/novel_web/test/novel_web/controllers/memories_controller_test.exs
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
mix test apps/novel_persistence/test/novel_persistence/workspace_context_test.exs
pnpm --dir frontend test -- --run frontend/slice-verify/native-tauri-verifier.test.mjs
```

本轮只改 docs/quality/tasks，不改 TurnResult / tool / artifact / adoption / 主链代码；因此 I1/I2/I3 scenario invariants 不新增为本 checkpoint 必跑项。若后续 AU-09 P1 改主链，再按项目规则补跑。

---

## 8. 文件级退出判断

- 场景对账矩阵：已覆盖 14/14，状态只使用“已验收 / 已测试 / 部分实现”等规范状态。
- P0：0 个剩余。
- P1：已登记 owner、证据缺口和恢复路径，不阻塞当前文件级交付。
- 已实现场景：均有局部测试或真实 Tauri/quality evidence；承重主链的 memory recall、adoption、lifecycle、trace、validity、cross-work 和 session layering 均有外部自动化驱动真实页面证据。
- 文档/台账：本文件、`SCENARIO-BLUEPRINT.md`、acceptance README、project ledger、tasks/slices、quality manifest 需同步到本口径。
- 静态扫描：以本轮最终 `ai_static_scan` 输出为准；既有 gitleaks accepted_risk 若仍出现，按 disposition 登记，不作为本轮 touched-file blocker。

结论：AU-09 在完成本轮 quality acceptance / task_done / static scan 后，可进入 AU-10。当前未关闭项是 P1/P2 后续，不应把历史 artifact 或缺 developer replay 误写成 AU-09 当前 P0 阻塞。
