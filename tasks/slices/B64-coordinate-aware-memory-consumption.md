# B64：按真实写作坐标消费记忆有效窗

- 状态：**todo（2026-11-13 作者选 B：用 Splash 重跑一次 B64 CP3 真实模型消费；预注册已冻结，待执行；CP0–CP2 done、CP3 确定性矩阵 PASS；B64 未 done）**。
- 来源：有效期已在普通 recall 路径验证，但 CA02 的专业创作事实读端口没有目标章或有效窗输入；本轮只读代码核对发现消费边界不一致，尚未运行数据库、真实模型或页面反例。
- 上游：[AU09 有效窗原任务](AU09-validity-window-recall.md)、[CA02](CA02-writing-facts-context.md)、[VS-00C](../../docs/design/contracts/VS-00C-creative-context-assembly-contract-pack.md)、[B39](B39-evidence-seeking-authoring.md)。本项保护既有章节级窗口，不等待 B54 新建故事时间读模型，也不重复建设 B39 的求证循环。

## 1. 作者场景与静态缺口

作品已写到第 10 章，作者回到第 3 章续写或重写。设定 A 仅在第 2–4 章有效，设定 B 从第 8 章生效。模型必须知道本轮作用位置与材料适用范围，不能把“全书写到哪里”当作每次创作的目标，也不能把所有确认记忆一律标成当前必须遵守的事实。

该场景已有设计依据：

- [06 §4.5.4](../../docs/design/06-memory-context-and-trace.md#454-更新废弃与召回过滤) 要求当前 work、确认态、可召回且有效窗匹配的记忆进入普通 context/why；窗口外与失效记忆不能默认混入当前事实。
- [08 §7](../../docs/design/08-novel-element-model.md) 的 WritingCoordinate 限定写作与检索边界；坐标不是知识完备证明。
- [AU-09](../../docs/design/acceptance/author/AU-09-story-memory.md) 的 I6/C4 已有章节级过滤验收，原任务明确该证据针对普通 recall，不能外推全部专业模型消费路径。

本次核实的现状：

| 环节 | 代码证据 | 缺口或边界 |
|---|---|---|
| 普通 recall | [MemoryRecallRepo](../../apps/novel_persistence/lib/novel_persistence/memory_recall_repo.ex) 35–55、62–109 行 | 已按章节 UUID→seq 过滤，但当前位置取最大已采纳章 seq；尚未消费本轮明确目标章。未知位置/无效窗口当前为不约束，不能在本任务未经明确设计就改成一律拒绝 |
| 专业事实读取 | [WorkArchiveRepo](../../apps/novel_persistence/lib/novel_persistence/work_archive_repo.ex) 125–134、163–188 行 | `creative_facts/1` 仅传 work_id，查询和投影只有确认态、recallable、类型等条件，没有 `valid_from/valid_until` 或本轮位置 |
| 生产接线 | [NovelApplication](../../apps/novel_application/lib/novel_application.ex) 468–473 行、[正文 flow](../../apps/novel_application/lib/novel_application/agent_run_flows/prose_drafting_with_quality.ex) 1233–1271 行 | 生产 reader 指向 `creative_facts/1`，真实正文 flow 注入该端口，不只是测试 helper |
| 目标身份与消费 | [TurnExecutionService](../../apps/novel_application/lib/novel_application/turn_execution_service.ex) 99–150、208、1188–1196 行 | 已解析 `resolved_chapter_ref` 与 WritingCoordinate，后者传入执行；记忆读取仍只传 work_id。已有真实章身份可复用，不以新时间线表解决接线缺口 |
| writer / evaluator | [TurnExecutionService](../../apps/novel_application/lib/novel_application/turn_execution_service.ex) 363–374、1239、1281–1286 行 | 事实段标为作者已确认且写作须保持一致，并同源成为 evaluator 的事实基线；窗口适用性未随此段传入 |
| 现有测试 | [CA02 读端口测试](../../apps/novel_persistence/test/novel_persistence/work_archive_repo_creative_facts_test.exs) | 覆盖分组、确认态与 recallable，没有目标章/未来生效/过期窗口矩阵；已有普通 recall 测试仍须保留 |

这些证据证明存在静态接线缺口，**不证明某次线上生成已发生错误**。CP0 先用可重复反例验证实际影响；已有 AU09 普通召回通过记录不改写。

## 1.1 CP0 记录（2026-10-31）

- 复现证据（只读代码）：
  - `WorkArchiveRepo.creative_facts/1`（novel_persistence）只按 work/status/recallable/type 过滤，**未 select/消费 `valid_from/valid_until`，也没有目标章输入**；`MemoryRecallRepo.within_validity_window?/3` 已有章节 seq 窗口规则但为 private，仅普通 recall 使用。
  - `MemoryRecallRepo.recall/3` 当前位置取“已采纳正文最大 seq”，不能用调用方明确目标章替代；未知位置不约束。
  - 生产接线：`NovelApplication.persistence_memory_reader/0` 固定 `&WorkArchiveRepo.creative_facts/1`；`TurnExecutionService.creative_memory_sections/4` 只传 work_id；而同轮已有 `resolved_chapter_ref`（`chapter:<uuid>`）可用于目标章，writer 事实段与 evaluator 事实基线都消费同一 `creative_facts`。
- 反例（待红）：第 10 章回写第 3 章时，一个 `valid_from=第8章` 的 world_rule 会被 `creative_facts/1` 无条件注入 writer/evaluator；普通 recall 会按最大已采纳 seq=10 把它当“当前有效”。目标章第 3 章时应排除。
- CP0 冻结的最小契约（本次实现范围）：
  1. 新增 `WorkArchiveRepo.creative_facts/2`，可选 `:at_chapter_id`（章节 UUID）；提供目标时按该章 seq 过滤窗口，未提供时保持现状（不改变规划/旧消费者行为）。
  2. 窗口语义复用 AU09 章节 seq 规则：某侧无可解析 seq 则不约束；目标位置未知则不约束（未知不伪装确定，也不 fail-hard）。
  3. 抽取纯函数 `NovelDomain.MemoryValidity`，recall 与 creative_facts 共用；普通 recall 增加可选 `:at_chapter_id`（显式目标优先于最大已采纳），无目标保持回退。
  4. 应用层将 `resolved_chapter_ref`（去掉 `chapter:` 前缀）传入 memory reader；reader 保持 /1 兼容（旧测试注入），有 /2 时优先 /2。
  5. 不在本 CP 改 schema/时间线/历史查询；不把窗口外记忆从档案/探索删除。
- 驱动冻结（CP3 用）：外部原生 Tauri 通过产品入口建立章节与有效窗记忆 → 从主输入续写/重写第3章 → 核对 writer/evaluator 请求事实段与可见 Why；先用确定性 fixture 证明接线，再用真实模型观察行为，分开记录。

## 1.2 CP1 实现记录（2026-10-31）

- `NovelDomain.MemoryValidity.within_window?/4` + `window_seq/2`：从 recall 私有规则抽取的纯函数，3 条 domain 测试覆盖窗口内/外、未知位置、缺失边界。
- `WorkArchiveRepo.creative_facts/2`：`opts[:at_chapter_id]` 提供时查 work 章节 seq 映射并按目标 seq 过滤 `valid_from/valid_until`；未提供时保持原查询/分组；select 增加 valid_from/valid_until 供后续 trace 消费。测试覆盖第10章/第3章目标、无目标、未知章、缺失边界。
- `MemoryRecallRepo.recall/3`：`opts[:at_chapter_id]` 优先于“最大已采纳 seq”，未知目标 → position=nil 不约束；无目标保持旧回退。新增显式目标测试（目标第2章排除第4章才生效的设定）。
- `NovelApplication.persistence_memory_reader/0` 改为 arity-2 reader；`TurnExecutionService.creative_memory_sections/5` 接收 `resolved_chapter_ref`，`chapter:<uuid>` 合法时向 reader 传 `at_chapter_id`；/1 reader 旧注入继续兼容。新增应用测试断言目标章 UUID 被传入，writer/evaluator 同源使用该 facts。
- 边界：未改 schema、时间线、历史查询、规划消费或页面；未知/无效目标不 fail-hard；B39 最小供给方向不变。
- 门禁：`mix format --check-formatted`、`mix compile --warnings-as-errors`、全量 `mix test`（1039 tests, 0 failures）、credo/xref/arch、I1/I2/I3 均通过。
- 门禁残余：`task_done` UI evidence gate 因 B30 原生复跑连续 2 次在 `workbench_ready` AX 等待超时（app/backend app-log 已 ready、无产品异常；属 native AX harness 环境不稳，同因 2 次停止），当前无晚于本次代码改动的 Tauri summary；登记为环境/证据缺口，不用 B64 机制/单测替代 UI gate，也未改 task_done 规则。

## 1.3 CP2 进行中记录（2026-10-31）

- trace/why 同源：`TurnExecutionService` 在 `trace_summary.memory_window` 记录 `target_chapter_ref/target_chapter/applied/position`（不记录事实正文）；`TraceWriter` 写入 summary；前端 `traceSummaryView` 在 Why「补充说明」显示“作品事实已按目标章过滤：{章}”或“未定位目标章，未按有效窗过滤”；前后端测试各覆盖。规划轮不消费该 meta，保持“规划可看全书/历史”的边界。
- 窗口矩阵（persistence）：目标章窗口内/外、无目标保持旧行为、未知目标不约束、边界章节缺失、章序号重编号后按新 seq 重解析、跨作品隔离、记忆有效窗当前值更新后即时反映；均通过。
- writer/evaluator：既有“同源 facts_context”测试保留；B64 目标章传参测试同时断言 trace memory_window 与 reader opts；二者共同证明同一过滤事实进入两处消费，非两套读取。
- 规划边界：`plot_outline_with_context`/`judgment_plan` 仍注入 `memory_reader` 但不带目标章（/1 或显式空 opts），不因本轮修复把未来/历史材料机械过滤；保留既有规划语义。
- 独立修订路径：核对 `ProseRevisionService` 当前只消费原正文/finding/`target_chapter_ref`，**未注入 CA02 creative_facts**，不存在同一静态缺口；不按猜测新增事实包；后续若设计加入需另建切片验收。
- 门禁：全量 mix test 1039/0；前端 typecheck/test 通过；全量 lint 被并行作者未提交的 `frontend/slice-verify/author-behavior-corpus.mjs` unused var 阻塞（非本改动文件，已报告），本改动相关 lint 通过；task_done UI evidence 环境缺口延续。
- 残余：恢复/当前值变化在真实恢复路径的矩阵、独立修订路径的显式回归测试、CP3 真实 Tauri 页面矩阵。

## 1.4 CP2 完成记录（2026-10-31）

- “恢复/当前值变化”：读者每轮从 DB 重新读取（`creative_memory_sections` 每 turn 调 reader，无进程内事实缓存）；persistence 当前值更新测试证明修改 `valid_from` 后下一次读取立即按新窗口过滤；会话恢复没有独立事实缓存层。跨进程恢复未单独构造，作为 CP3 页面矩阵的一部分验证，不用单测替代。
- 独立修订路径：`vs00e_cp3_prose_revision_test` / `b28_chapter_revision_wiring_test` / `agent_run_prose_revision_flow_test` 共 26 tests 0 failures；代码核对 `ProseRevisionService` 未注入 CA02 creative_facts，故不存在同一静态缺口，不新增无消费者事实包。
- 边界保持：规划读者不带目标章；档案/探索未删除历史；未知/无效目标不约束；schema/timeline 未改。
- CP2 门禁：mix test 1039/0（CP2 后端改动后）、前端 typecheck/test 通过；全量前端 lint 仍被并行作者 WIP 阻塞；task_done UI evidence 环境缺口延续。

## 2. 消费者矩阵与待冻结语义

| 消费者 | 本任务处理 |
|---|---|
| 正文初写、续写、rewrite | 明确真实目标章/当前单元与有效窗关系，writer 与 evaluator 消费同一适用性事实；不能用最大已写章替代明确目标 |
| 规划 | 先区分全书/未来规划与当前章事实，允许按任务查看历史和未来材料；不得把过滤规则机械套成“未来信息都不可见” |
| 普通对话 recall | 保留无明确目标时的既有回退，明确有目标与无目标如何分工；跨作品和失效态保护不降低 |
| `revise_from_findings` | [ProseRevisionService](../../apps/novel_application/lib/novel_application/prose_revision_service.ex) 346–353、382–404 行当前主要消费原正文与 finding，未核实它存在同一 CA02 注入问题。只做调用矩阵核对，不按猜测新增事实包 |
| 已采纳正文修订 | 沿 B28/B36 的真实目标、基线与材料来源核查；不能把通用写作路径的静态发现直接宣称为独立修订路径的缺陷 |
| 档案、历史解释与探索 | 窗口外资料仍可因明确历史查询而读取，必须表达来源与适用范围；当前有效事实选择不等于删除历史或禁止模型取证 |

CP0 还须明确：未知当前位置、无窗口、无效章节引用、重编号、场级窗口尚未支持、跨章任务的作用范围；这些都不由本次排期直接冻结新默认策略。优先复用 AU09 的章节身份/有效窗规则与现有 `resolved_chapter_ref`；修复既有读取边界，不扩大固定携带内容。

## 3. 开工七问

1. **Contract**：AU09-I6、06 §4.5.4、VS-00C 的坐标/材料边界、既有 NarrativePosition 与 MemoryItem 有效窗、B39 Base/Requested Observation 与来源版本约束；不新增 timeline schema。
2. **Invariant**：真实作用位置决定材料适用性，明确目标不被全书进度覆盖；当前事实与历史/未来资料分开解释；writer/evaluator/why 同源，跨作品与确认/终态过滤不退化；未知不伪装成确定。
3. **Boundary**：application 的目标解析/消费者组装，domain 的纯适用性规则（如确需抽取），persistence 既有查询端口与窗口映射，必要的 trace/why 展示。复用 ProviderExecution；不新建记忆存储或修改作者数据。
4. **Consumer**：首个为真实正文 writer 及 evaluator；随后覆盖普通 recall、规划及按需观察。独立修订路径按 CP0 证据纳入，不能为“全覆盖”添加无消费者数据。
5. **Proof**：旧章/新章、窗口内外、无窗/未知、错误引用、重编号、跨作品的局部反例；检查真实模型请求中的事实、适用性与来源，并核对 why/trace。模型是否据此正确创作须有独立真实行为证据，stub 只证明接线。
6. **Acceptance Driver**：外部驱动真实 Tauri 建立章节和有有效窗的记忆，再从主输入续写/重写旧章、切换目标和新会话，核对实际请求与可见结果；原普通 recall 场景回归。具体 driver 在 CP0 冻结；产品验收感知逻辑 **no**。
7. **Exploration**：同一记忆仍沿既有探索面可达；观察带真实来源和适用范围，后续模型请求与 used refs 不越过实际材料。无需创建新要素，也不靠专用 prompt packet 修补遗漏。

## 4. Checkpoint

| CP | 完整范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 确认消费者矩阵、构造第 10 章回写第 3 章等反例；冻结目标/未知/规划/历史读取的最小适用性契约与驱动；核实缺口后才改代码 | done（2026-10-31，§1.1；反例红测先失败后转绿） |
| CP1 | 真实章身份/作用范围贯穿需要它的读取端口；统一既有有效窗规则，保留无目标回退与历史可查；只修实际消费者 | done（2026-10-31：`WorkArchiveRepo.creative_facts/2` + `MemoryRecallRepo.recall/3 :at_chapter_id` + `NovelDomain.MemoryValidity` 共享规则；TurnExecutionService 把 `resolved_chapter_ref` 传给 reader；无目标/未知保持旧回退；writer/evaluator 同源 facts） |
| CP2 | writer/evaluator、普通 recall、trace/why 及规划边界同源；覆盖窗口、重编号、错误引用、跨作品、恢复与当前值变化；回归独立修订路径 | **done**（2026-10-31：trace `memory_window` + Why 适用性行；窗口/重编号/未知目标/跨作品/当前值重读矩阵；writer/evaluator 同源 facts；普通 recall 显式目标；规划边界只核对；修订路径 26 测试回归且确认未注入 CA02；恢复矩阵=逐轮重读读者，无缓存，当前值变化测试覆盖） |
| CP3 | 外部真实 Tauri 完成旧章/新章与跨会话矩阵，分开记录确定性接线和真实模型消费；原 AU09 证据不外推，全部计划内后果齐备才关闭 | **doing/partial（2026-10-31）**：确定性真实 Tauri 矩阵 PASS（旧章/新会话旧章/新章三 turn，writer prompt 事实窗口 + Why 目标章行全成立，verifier passed）；真实模型同场景一次预注册运行在判断阶段 `judgment_protocol_violation` 失败（只读保留、未重试），真实模型消费未成立 |

## 4.1 CP3 记录（2026-10-31，partial）

- 外部真实 Tauri 场景 `b64-coordinate-memory` 已注册：
  - seed `scripts/seed_b64_coordinate_memory.exs`：第01–10章已采纳（第03章留空，当前位置=10），第11章计划；B64EARLY 仅1–4章有效、B64FUTURE 第8章后生效、B64CORE 无窗口。
  - driver `frontend/slice-verify/external-ui-driver.mjs`：真实页面主输入写第03章 → 新建会话再写第03章 → 写第11章；读取真实 `llm-calls` prompt 事实段与 Why 面板目标章行。
  - tauri_slice_verify 注册 + `native-tauri-verifier` 证据/行为函数；验收 manifest `quality/acceptance/scenarios/b64-coordinate-memory.yml`（nightly 只判确定性接线，真实模型另行预注册）。
- 确定性 provider 结果（PASS）：
  - 证据 `artifacts/slice-verify/b64-coordinate-memory-tauri/`：`b64-coordinate-memory.json` 三 turn 全为 `includes_early/future/core` 预期组合 + `why_line_present=true`；`summary.json` status done、verifier passed；截图 `b64-old-chapter.png`/`b64-new-chapter.png`。
  - 旧章：writer prompt 含 B64EARLY+B64CORE、不含 B64FUTURE；新会话旧章同；新章：含 B64FUTURE+B64CORE、不含过期 B64EARLY；三 turn Why 均显示“作品事实已按目标章过滤：…”。
- 真实模型（strata/iq3_s）一次预注册运行（`artifacts/model-contracts/b64-cp3/preregistration.json`，证据 `artifacts/slice-verify/b64-coordinate-memory-tauri-strata/`）：
  - 首个 turn 判断阶段连续两次输出被产品校验拒绝（`judgment_narrative_required` → `invalid_tool_arguments`），随后 `agent_run.run_failed: judgment_protocol_violation`；未进入 prose writer，自然无 writer prompt 事实段。
  - 失败只读保留、未重试；模型生命周期核验 `strata loaded=null`（无本任务模型残留）。
  - 该失败与 B39 AU15 A2-run2 的 `judgment_protocol_violation` 同属真实模型判断协议失败类，需 provider/prompt 侧系统处理，不在本 slice 盲修。
- 实现补充（Why replay 同源）：`memory_window` 进入 `DecisionTrace.state_trace_refs` + TraceReplayService 重建，修复广播 summary 有、Why replay 丢失的问题（trace replay 测试覆盖）。
- CP3 未关闭：真实模型消费未成立；待判断协议问题处理后再按预注册复验（不重试刷分）。

### 2026-11-13 作者选 B：Splash 重跑 B64 CP3

- **决策**：作者选择 B——用 Splash（`local/Q4-PLE4`）按新预注册重跑一次 B64 CP3 真实模型消费，失败只读保留、不重试刷分。
- **预注册**：`artifacts/model-contracts/b64-cp3/preregistration-splash-20261113.json`（1 批/0 重试；supersedes 2026-10-31 strata 版）。
- **证据目录**：`artifacts/slice-verify/b64-coordinate-memory-tauri-splash/`。
- **目的**：判断上次 `judgment_protocol_violation` 是判断协议普遍问题，还是 iq3_s 模型特有；不改变 B64 记忆过滤判据。
- **边界**：若仍失败，转 B39/B27 跨切面判断协议处理，不在本 slice 盲修。

## 5. 非目标与恢复

- 不重建故事时间线、历法、状态快照或风格对象，不提前启动 B54/B55；故事时间与章节有效窗仍是不同概念。
- 不把所有确认记忆固定预装给模型；B39 的最小供给/按需求证方向继续有效，旧供给尚在时仍须遵守正确适用性。
- 不全量过滤档案历史、不静默改作者记忆、不重放已采纳动作；未知/无效边界的新处理先设计，不借修复默认 fail-hard。
- 恢复时先读本任务消费者矩阵、AU09 与 CA02 当前代码，再看 B39 的实际接线；本次仅登记任务，无产品修复、数据库操作或新验收结论。
