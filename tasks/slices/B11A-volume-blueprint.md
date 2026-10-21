# B11A-volume-blueprint：卷结构与卷级蓝图（大周期）

**状态**：**done（2026-10-22，CP0–CP5 全落，门禁全绿，真实 Tauri `au08-volume-structured-planning` 三轮扩展 PASS）**。契约 VS-00J 冻结的全部 CP（E14-E17 蓝图 / 卷身份 / 规划产出 / 采纳物化 / 开新卷动作 / 消费面 / 卷级收束 / 负债规则）均已实现并由外部自动化驱动真实页面证明；长尾缺口（R10/R11 finding 真实触发验收、design_ref 接线、卷蓝图编辑 UI、45 §4.2 完整方向候选流）已诚实登记于 §2b 与 ADR-0028 `## enforcement_gaps`，不在本 slice 声称完成。ADR-0028 已 Accepted。作者拍板主线顺序 B13a → B11③ → B11①，本 slice 即 B11①。**未写 done**：开新卷动作（CP3）、卷级收束/负债规则（CP5）、CP4 完整消费面与真实页面验收仍未闭环（见 §2b 诚实边界与 ADR-0028 enforcement_gaps）。
**来源**：`docs/design/08-novel-element-model.md` §8 序位 6 / §6.2 NEM-GAP-07；`tasks/NEXT.md` B11 台账；契约 `docs/design/contracts/VS-00J-volume-structure-and-blueprint-contract-pack.md`；ADR `docs/design/adr/ADR-0028-volume-structure-and-open-volume-action-v3.md`。
**前置**：`tasks/slices/AU08-volume-structured-planning.md`（done：卷容器/逐章卷归属/目录分层）与 `tasks/slices/B11C-scene-craft-completion.md`（场级 craft；与卷块共用 parser 单趟抽取纪律）。

## 0. 现状核查（2026-10-22 只读侦察，证据抽样）

| 环节 | 实况 | 结论 |
|---|---|---|
| `volumes` schema | 只有 `work_id/title/seq/status/timestamps`；全仓无 `alter table(:volumes)` | E14-E17 零字段（VS-00J §2 新增 `blueprint` map 列） |
| 写路径 | 仅 `AdoptionRepository.find_or_create_volume` 两处：章计划物化（可带卷标题）+ 正文采纳（规范单卷）；幂等键 `(work_id,title)`；`insert_volume` 恒写 `status=COMPLETED` | 卷身份=标题（改名雷）、卷状态假值（VS-00J §2.2/§2.3 冻结修复） |
| prompt | `plot_outline` provider 模板零卷概念；卷指令只来自 `WorkSkeleton.volume_directive/1`（逐章「所属卷」） | 卷级蓝图无产出路径（VS-00J §3.1 补） |
| parser | 只解析逐章 `所属卷/卷归属/所属分卷` 单值；卷标注行被排除章起始行 | 需新增卷蓝图块抽取（先抽后解析，防假章） |
| 投影/UI | TOC 已按卷嵌套；`volumes_by_id` 只 select `id/title/seq`；结构面板卷头只有「卷名 · N章」；阅读目录按卷；导出按卷 H1 | 消费面骨架已在，蓝图内容面需 CP4 |
| 开新卷动作 | **不存在**：判断目录 6 项无卷能力；18 个 Channel handler 无写卷；步骤目录固定 `context_assemble → plot_outline`；UI 无入口。留位三处：capability `volume_plan` write scope（零消费者）、judgment 文案「卷纲」（无产出）、UI 45 §4.2 设计稿 + Pencil `sEYft` | VS-00J §3.2 定义动作形态 A（复用 plot_outline + volume_scope） |
| 五本账/坐标 | 账面无卷维度；`design_ref` 的「卷蓝图」无对象；`WritingCoordinate.target_unit` 含 `:volume` 但代码只产 work/chapter，struct 无 `volume_ref`；工作台头部「当前卷」硬编码「未定卷」 | CP4 兑现消费面 + 修假坐标 |
| ADR 背书 | 27 份 ADR 全文无 `volume|卷`；`21`/`34` 引用的「ADR-0004 冻结 volume→arc」是**失效引用**（ADR-0004 实为 OrchestratorDecision） | ADR-0028 补齐；顺带修失效引用 |

## 1. 开工检查（七问）

1. **Contract**：`VS-00J`（Frozen，2026-10-22 作者开工授权按建议默认拍板；§9 四项可翻案）+ `ADR-0028`（Proposed，Accepted 前不授权 CP1 代码）。消费已冻结的 `structure_status` 枚举、ADR-0010/0019 采纳边界、VS-00C `WritingCoordinate` 形状、VS-00F `design_ref` 形状。
2. **Invariant**：VS-00J §5 I-VOL-1～8：章归属唯一；章号 work 级全局；卷身份 `(work_id,seq)`（改名不建重复卷）；无蓝图逐字节等价；蓝图只经采纳；意图/事实分离不静默改写；全书收束优先于卷级；蓝图是设计态不写作品事实。
3. **Boundary**：允许改 `novel_domain`（VolumeBlueprint/WorkSkeleton/坐标）、`novel_persistence`（migration/Volume schema/AdoptionRepository/reading_projection）、`novel_agent`（real.ex plot_outline 模板）、`novel_application`（采纳/规划注入/章使命/坐标）、`novel_web`（TOC 透传）、`frontend`（卷蓝图只读 + 当前卷坐标）。**明确不改**：五本账对象与对账规则、阅读链结构、arc 对象、`memory_items.volume_id` 召回、依赖方向。
4. **Consumer**：档案「大纲与结构」卷头（作者核对）；planner「当前卷蓝图 + 本卷进度」注入；`chapter_mission_inputs` 卷坐标；探索面当前卷；`WorkSkeleton` 卷级守则；`design_ref` 形状。
5. **Proof**：CP0 文档 + 门禁绿；CP1/CP2 domain/parser/物化单测 + 无蓝图/无卷块字节等价 + 全量回归；CP3 真实页面开新卷；CP4/CP5 扩 `au08-volume-structured-planning` 真实 Tauri + I1/I2/I3。
6. **Acceptance Driver**：扩既有 `au08-volume-structured-planning`（`scripts/tauri_slice_verify.sh au08-volume-structured-planning`；外部 driver 只用用户可见文本断言卷蓝图/当前卷，不新增 `data-*`/env/自动点击）。产品代码新增验收感知逻辑：**no**。
7. **Exploration**：探索面 profile/卷分布与 `chapter_read` 同批暴露当前卷蓝图（08 §8 探索面同步律，CP4 收口）。

## 2. CP 路线（详细契约见 VS-00J §6）

| CP | 内容 | 证明 | 状态 |
|---|---|---|---|
| **CP0** | VS-00J Frozen + ADR-0028 Proposed + 本 slice 七问 + 设计文档留位修订（08 NEM-GAP-07/§8/§10、21 失效引用、34 指针、VS-00G 非目标、contracts/ADR 索引）+ NEXT 拆分 | 文档落档；`adr_trace` 绿（Proposed 不参与门禁）；`next_task_check` 绿 | **done（2026-10-22）** |
| **CP1** | `volumes.blueprint` map 列 migration + `Volume` schema/domain `VolumeBlueprint`（归一/渲染/三态白名单）+ 卷状态修复（规划物化 PLANNED / 正文规范单卷 COMPLETED）+ `upsert_volume_blueprint` 采纳写入 + `reading_projection` 暴露 blueprint | domain/persistence 单测；无蓝图 TOC 字节等价；全量后端回归 | **done（2026-10-22）** |
| **CP2** | 卷蓝图行产出指令（经 `WorkSkeleton.volume_directive`）+ `ChapterPlanParser.parse_with_volumes/1`（先于章块，防假章）+ 物化 + 改名去重 | parser 单测（卷块/无卷块/混排/ASCII 冒号负例/续行丢弃）；物化单测（幂等/改名不重复建卷/单卷退化）；采纳回归 | **done（2026-10-22）** |
| **CP3** | 开新卷动作形态 A：`plan_next_volume` Channel（机械读 TOC 推导 scope）+ planner 只产下一卷蓝图/开篇章 + 既有采纳物化 | 单测（Channel/scope/透传/stub）+ 真实 Tauri（按钮→scoped 候选→采纳→三卷 TOC） | **done（2026-10-22，au08 第三阶段 PASS）** |
| **CP4** | 卷蓝图消费面（全部）：档案卷头只读块；planner/prose「当前卷蓝图+本卷进度」注入（carry 登记门）；`chapter_mission_inputs` 卷坐标；探索面 `chapter_read` 所属卷+卷蓝图；`WritingCoordinate.volume_ref`（JSONL 可证据）；`design_ref` 形状 helper | 单测（在场/缺席逐字节）+ 真实 Tauri writer prompt/坐标证据 | **done（2026-10-22，au08 Tauri 两轮扩展 PASS）** |
| **CP5** | 卷级收束守则（全书优先）+ 计划卷数/事实卷数负债规则 + 真实页面验收（扩 au08 场景） | 域单测 + 服务集成 + 真实 Tauri（收束守则进 writer prompt） | **done（2026-10-22；负债规则 finding 真实触发验收未做，见 §2b 诚实边界）** |

**依赖**：CP0 →（CP1+CP2 同批）→ CP3 → CP4 → CP5。CP1+CP2 不单独算 done；CP4+CP5 必须真实页面闭环。

## 2b. 交付结果（2026-10-22 CP0 + CP1 + CP2 + CP4-lite）

**CP0（done）**：VS-00J Frozen、ADR-0028 Accepted（`## enforced_by` 19 refs + `## enforcement_gaps` 诚实登记）、slice 七问/CP 路线、设计文档留位修订。

**CP1 存储/domain（done）**：`volumes.blueprint` map 列 migration（nullable，零新业务列）+ `Volume` schema cast + `NovelDomain.Volume` blueprint 字段/`put_blueprint/2`；`NovelDomain.VolumeBlueprint` 纯函数（12 设计槽 + status/source_ref 白名单、`slot_key/1` 与存储同源、`render_lines/1`、`empty?/1`）；`VolumeBlueprintStatus` enum（JSON SSOT → `mix codegen.enums`，`--check` in sync）；`insert_volume` 恒 COMPLETED 修复（计划物化 PLANNED / 正文规范单卷 COMPLETED / 已有卷不改）；TOC 卷节点暴露 `blueprint`（无蓝图时其余字段与旧形状一致）。

**CP2 规划产出（done）**：`WorkSkeleton.volume_directive/1` 多卷时增补卷蓝图行指令（单行、`｜` 分隔、序号从 1、高潮/缓冲章只写章标题；`render_for_prose` 不含）；`ChapterPlanParser.parse_with_volumes/1`（卷蓝图行先于章块整趟抽离防假章、单行解析/续行丢弃、标题必填、序号缺省按行序、子槽词表唯一来源 `VolumeBlueprint.slot_key/1`；`parse/1` 委托不变、无卷块 chapters 逐字节等价）；`AdoptionRepository` 先按 `(work_id,seq)` upsert 卷（改名不重复建卷、existing status 不动、blueprint 补 `CONFIRMED`+`source_ref=artifact:<id>`、无设计槽不伪造）再逐章物化（章 `所属卷` 命中复用；无标注落规范单卷）。

**CP4-lite 档案只读可见（done，真实页面验收下一 checkpoint）**：`TocVolume.blueprint` 类型 + `volumeBlueprintView.ts` 纯函数（6 组行、缺字段不造行、全空 null、三态徽标、未知 status 不暴露）；档案「大纲与结构」多卷卷头后 / 单卷唯一卷章节列表前渲染只读「卷蓝图」块（文案全进 copy.ts；无 author_action/data-testid/新请求；无 blueprint 不渲染）；`43-structure-panel.md` §5.0.6。

**验证（全部实跑）**：后端全量 **1,683 tests / 0 failures**（CP1+CP2 新增 45）、dev/test `compile --warnings-as-errors`、`mix format --check-formatted`、`mix codegen.enums --check`、xref 无环、arch_check 通过、I1/I2/I3/N-NARR/I-CACHE-1 绿；前端 **33 files / 508 tests**、audit 27/0/0、design trace 16/0/0；`adr_trace` **27/27 Accepted（236 refs / 0 pending）**。

**真实页面验收（done，2026-10-22，真实 Tauri）**：扩既有 `au08-volume-structured-planning`（不新建场景），`PHOENIX_PORT=4656 VITE_DEV_PORT=5770 bash scripts/tauri_slice_verify.sh au08-volume-structured-planning` → **exit 0 / passed**（默认 5769 被用户 stage 占用，用脚本官方 env 端口；未杀用户进程）。证据 `artifacts/slice-verify/au08-volume-structured-planning-tauri/summary.json`：
- 规划 turn_result pending payload 带**2 条独立卷蓝图 content 行**（顺序=规划卷序；高潮/缓冲章只引用本卷真实章标题），桩只认真实产品 prompt 文本「卷蓝图要求」（负例：无该文本 → 0 条蓝图）；
- 档案「大纲与结构」重开后逐卷可见只读「卷蓝图」块：`目标冲突：查清灵气账单被篡改的第一条线索` / `支线：启动：旧友重逢` / `高潮与节奏：` / `新要素：新人物：灯街守夜人`（第二卷内容不同；逐卷 DOM 行序 = 卷头之后、章卡片之前；两卷不串卷）；截图 `au08-volume-structured-planning-volume-blueprint.png`；
- 真实 `get_toc` 回复帧两卷各带 blueprint：`status=CONFIRMED`、`source_ref=artifact:<本次采纳 artifact_id>`、goal/climaxes/buffers 与规划行一致；卷章归属不变（5/7、合计 12）；既有卷分组/阅读目录/采纳边界断言零回归；behavior 14 条断言全过。
- 诚实边界：本 harness 无 persistence snapshot 通道，持久化证据=真实 `get_toc` 回复帧（后端从 `volumes.blueprint` 投影 + source_ref 精确绑定本次采纳 artifact），非原始 DB dump；blueprint 无新增专用日志事件，required-events 表未改；桩对其它 `planned_volumes>1` 场景（au13/au14/ca04）也会带蓝图（无 blueprint 断言，后续顺手回归留意）。

**CP4 完整消费面（done，2026-10-22）**：
- 真实链路：`WorkspaceContext` structured chapter additive 卷键（volume_id/volume_seq/volume_title/volume_blueprint）+ `ContextAssembler` 白名单透传 → `DialogueContext.structured_chapters`；
- 上下文：`WorkSkeleton.volume_blueprint_section/3` 渲染「## 当前卷蓝图（设计态）/卷/本卷进度/E14-E17 行」；`CarryRegistry` 登记 `:current_volume_blueprint`（prose_writing/plot_outline 门控）；`TurnExecutionService` 解析当前卷（写作用目标章所在卷、规划取章序最大者）+ 段注入在 work_skeleton 之后 + `emit_carry` 三分日志；无卷/无蓝图空段（退化等价）；
- 坐标：`WritingCoordinate.volume_ref` + derive 归一 + build_coordinate 接线 + `turn_execution.writing_coordinate.done` JSONL additive `volume_ref`；
- 写前推理：`ChapterMissionInputs` 可选 `:volume`/自推导 + `volume:blueprint` item + prompt 组标签（无卷字节等价）；
- 探索面：`chapter_read` 计划行追加「所属卷/当前卷蓝图」摘要（缺蓝图不渲染）；
- `VolumeBlueprint.design_ref/1` + `summary_lines/1`（design_ref 只定形状、不接五笔账）。

**CP4 真实页面验收（done，2026-10-22，真实 Tauri 第二轮扩展）**：`au08` 在既有规划/采纳/阅读流程后追加真实正文草稿 turn——阅读返回工作台→档案大纲按可见卷表头+章标题定位第一卷章卡「生成正文草稿」→真实 `prose_writing`/`prose_fragment` pending + 草稿卡可见；**writer prompt（llm-calls 外部证据）恰 1 条含「## 当前卷蓝图（设计态）」段**，命中卷标题/本卷进度「已写 0 / 共 5 章」/目标冲突/高潮章/支线启动/- 目标章，段仅 1 份、不串第二卷目标冲突、蓝图不进草稿正文；`turn_execution.writing_coordinate.done` 的 `volume_ref` 精确等于 get_toc 第一卷 id（authoring_mode=first_draft、matched_chapter=第01章：觉醒）；既有 14 条断言零回归、behavior 18 条。证据 `artifacts/slice-verify/au08-volume-structured-planning-tauri/summary.json` + 截图 `au08-volume-structured-planning-prose-volume-context.png`。

**CP5 卷级收束 + 负债规则（done，2026-10-22）**：
- `WorkSkeleton.volume_closure_directive/3`：全书收束优先（书进度≥85% → 空，I-VOL-7）；本卷计划章已写完/≥80%（新卷级策略阈值 0.8）/一般卷三档确定性指令；0/0 与缺值不伪造完成；book_progress 未知不抑制卷级守则（骨架未立时全书守则本就缺席）。
- `TurnExecutionService`：卷级收束文本以空行附在「当前卷蓝图」段之后，仅卷有设计态蓝图时注入；空指令时与 CP4 输出逐字节等价（有测试）；全书进度复用既有 `WorkSkeleton.progress` 口径（无新公式）。
- `LedgerReconciliation` R10 `volume_plan_mismatch_finding/2`（计划 N 卷 vs 实际 M 卷，design_debt/warn/revise_design，事实优先不静默改写）与 R11 `volume_blueprint_missing_finding/1`（多卷逐卷缺蓝图，元数据-only 视为缺，单卷不判）；`LedgerReconciliationService.scan` 增卷结构负债 + 最小只读 volumes 端口（复用 TOC，可选端口缺席/读失败诚实跳过不阻断）。
- **真实 Tauri 验收（第三轮扩展）PASS**：au08 正文草稿 turn 的 writer prompt（llm-calls 原始字节）含默认分支收束段「本卷为「第一卷·觉醒」：允许在本卷内做小收束…但不得写全书终局/大结局/完结章…」，3/3 片段命中、位于卷蓝图段之后（空行分隔、仅 1 次）、非默认分支计数 0、不入草稿正文；既有 CP4/CP1-CP2 断言零回归，behavior 19 条。证据 `artifacts/slice-verify/au08-volume-structured-planning-tauri/summary.json` + `llm-calls/*.jsonl`。

**CP3 开新卷动作（done，2026-10-22）**：
- 新 Channel 事件 `plan_next_volume`：服务端校验 work → 读真实 TOC → `NovelDomain.VolumeScope.from_toc/1` 机械推导 scope（`next_seq=max(seq)+1`、当前卷 seq/title、`next_chapter_seq=全书章 seq max+1`、卷/章计数）→ 复用既有 user_message AgentRun 提交路径（`generate_micro_plan=true`，input 带 `volume_scope`）；reply ok 带 turn_id/scope，error `invalid_work` / `no_volume_to_extend`；LogEmit 三态只落 scope 计数。
- scope 透传：DialoguePlanningService 的 judgment/plot_outline planner spec → 两 flow → `TurnExecutionService.execute`；仅 `plot_outline` 动作注入 `VolumeScope.render_section/1`「## 本轮规划范围（机械给定，不得改）」段（work_skeleton 之后、current_volume_blueprint 之前）+ carry 通道 `planning_scope`；`WorkSkeleton.render/3` 用 scope 版分卷指令替换旧「全书分 planned_volumes 卷」指令（nil/非法逐字节回退）；无 scope 时 prompt 文本字节等价。
- 前端：大纲 tab「后续卷规划」区块 +「规划下一卷」按钮（仅已采纳卷结构非空时渲染；loading/disabled；失败按 reason 诚实文案；复用既有 refreshToc）；`planNextVolume` 通道 helper 7 单测。
- **真实 Tauri au08 第三阶段 PASS**：按钮→真实 `plan_next_volume` push/ok（scope next_seq=3/next_chapter_seq=13 等）→ scoped 候选恰 1 条「卷蓝图：第三卷·归墟｜序号：3｜…」+ 3 章（第13/14/15章、所属卷第三卷）→ 采纳 → get_toc 三卷（5/7/3、第三卷 blueprint CONFIRMED 且 source_ref 绑定本次 artifact、章 seq 连续 1..15、前两卷不变、阅读 TOC 三卷同序）；planner prompt（llm-calls）恰 1 条机械范围段、5/5 片段、旧「全书分 2 卷」0 次；app JSONL `channel.plan_next_volume.done` 机械 scope 独立复核；既有 CP1/CP2/CP4/CP5 断言零回归，behavior 22 条。证据 `artifacts/slice-verify/au08-volume-structured-planning-tauri/summary.json` + 新截图 `au08-...-plan-next-volume.png`。

**诚实边界（长尾登记，不在本 slice 声称完成）**：卷蓝图编辑/作者裁决 UI 与工作台「当前卷」硬编码未做（CP4/CP3 只接线坐标、上下文与规划入口，未改 UI 假坐标）；`VolumeBlueprint.design_ref/1` 只给形状，未接五本账写入（VS-00J §4 item6 原文）；探索面所属卷/蓝图行按 I-VOL-4 门控在「卷有蓝图」；profile 面未加（无稳定当前卷事实）；**R10/R11 负债规则的 finding 触发真实验收未做**（需「计划卷数≠实际卷数/多卷缺蓝图」的作品，登记后续场景；现有域单测+服务集成测试+au08 负向无 false positive）；CP5 无法在 au08 触发 85% 全书阈值，「全书优先」只证默认分支+禁终局措辞；开新卷形态 A 是最小入口（45 §4.2 完整方向候选流/确认卡未做，沿用既有采纳管道）；`next_seq` 采用 max(seq)+1（VS-00J append-only，连续数据下等价「卷数+1」）；重采纳时若蓝图改名而逐章 `所属卷` 仍用旧名会按标题落成另一个卷（契约字面）；其它多卷场景（au13/au14/ca04）未回归 blueprint 兼容。

## 3. 明确不做（YAGNI / 登记）

- arc 对象化（NEM-GAP-02 余项）；
- 五本账按卷聚合、`memory_items.volume_id` 召回接线；
- 卷内章号局部序列（维持全局 `chapter.seq`）；
- 卷改名/重排/删除 UI、卷蓝图作者手编；
- E14-E17 完整枚举；
- 独立 `volume_planning` capability / 新 artifact 类型 / 新卡型（默认形态 A；翻案条件见 VS-00J §9①）；
- 批量写该卷前强制确认门（VS-00J §9③）。

## 4. 风险与返工点（侦察 2026-10-22）

| 风险 | 处置（契约已冻结） |
|---|---|
| 卷身份=标题，改名会重复建卷 | 卷身份 `(work_id,seq)`；卷块带序号按 seq 解析；旧格式按标题兼容 |
| `insert_volume` 恒 COMPLETED（假状态） | CP1 修复：规划物化 PLANNED；正文规范单卷保持 COMPLETED |
| 章号口径：蓝图说"本卷第 3 章" | 蓝图只允许章标题引用；卷内序号是派生值不落列 |
| `planned_volumes` vs 事实卷数无对账 | 事实优先 + 不静默改写 + CP5 负债提示，不阻断写作 |
| 卷块标题劈出假章（`第二卷：裂变`） | parser 单趟抽取：卷蓝图行 → 场次行 → 章块；CS 负例测试 |
| 与 B11C parser 改动互相吞噬 | 共用「行块先抽取后解析」纪律；B11C 先落 |
| 卷级收束与全书禁终局冲突 | 全书守则优先（I-VOL-7） |
| 工作台「未定卷」假坐标 | CP4 用真实写作坐标替换；文案进 copy.ts |

## 5. 决策日志

- 2026-10-22 — 作者拍板主线顺序 B13a → B11③ → B11①，B11① 开工即 08 §8 序位 6 的"开新卷创作动作提出"触发条件。CP0 按作者开工授权与 VS-00F 先例（"开工授权按建议默认拍板、可在 CP 内翻案"）冻结 VS-00J；四项开放决策取建议默认（VS-00J §9）。
- 2026-10-22 — CP0 落档：VS-00J Frozen；ADR-0028 Proposed（Accepted 前不授权 CP1 代码——B13a 之后 ADR 门禁要求 Accepted 才有 enforced_by，本 ADR 在 CP1 落地后同批转 Accepted 并补真实引用）；发现并登记「21/34 引用的 ADR-0004 冻结 volume→arc」为失效引用，按"卷结构无 ADR 背书"处理（ADR-0028 补齐），同步修正引用。
- 2026-10-22 — **CP1+CP2+CP4-lite 落地（作者"做 B11①"开工授权即 ADR 接受）**：ADR-0028 由 Proposed 转 Accepted（按 VS-00F「开工授权按建议默认拍板、可翻案」先例；`## enforced_by` 引用本轮真实实现，CP3/CP5/真实页面验收列 `## enforcement_gaps`）。后端 1,683/0 + I1/I2/I3/N-NARR/I-CACHE-1 绿；前端 508/0 + audit/design trace 绿；adr_trace 27/27（236 refs/0 pending）。真实页面验收（扩 au08）延后到下一 checkpoint：2026-10-22 另一并发 DSH 会话正在改 `frontend/slice-verify/*`、`scripts/tauri_slice_verify.sh`、`quality/acceptance/*`，不能安全合并/复跑 Tauri；按场景化验收红线**不拿单测冒充真实页面 PASS**。
- 2026-10-22 — **B11A CP1+CP2+CP4-lite 真实页面验收 PASS**：扩展既有 `au08-volume-structured-planning`（不新建场景），外部 Playwright 驱动真实 Tauri 工作台：规划产 2 条卷蓝图行 → 采纳 → 重开档案逐卷可见只读卷蓝图块（目标冲突/支线启动/高潮与新要素，两卷内容不同、位置在卷头后章卡片前）→ 真实 `get_toc` 帧两卷 blueprint `CONFIRMED` 且 `source_ref` 精确绑定本次采纳 artifact、章归属不变；既有卷分组/阅读目录断言零回归。命令与证据见 §2b「真实页面验收」。未做仍为 CP3（开新卷动作）、CP5（卷级收束/负债规则）、CP4 完整消费面。
- 2026-10-22 — **CP4 完整消费面 + 真实页面验收 PASS**：卷蓝图经 structured_chapters additive 键 + ContextAssembler 透传进入 `DialogueContext`，以 `:current_volume_blueprint` carry 通道进入 prose/plot_outline 上下文（work_skeleton 之后），`WritingCoordinate.volume_ref` 与 `chapter_mission_inputs :volume`/`chapter_read` 同步消费；`VolumeBlueprint.design_ref/1` 只定形状。真实 Tauri au08 第二轮扩展 PASS：真实正文草稿 turn 的 writer prompt 恰一份卷蓝图段（7/7 片段、不串卷、不进草稿正文），`writing_coordinate.done.volume_ref` 精确等于 TOC 第一卷 id；既有断言零回归。诚实边界见上。CP3（开新卷动作）与 CP5（卷级收束/负债规则）仍 queued。
- 2026-10-22 — **CP5 后端 + 真实页面验收 PASS**：`WorkSkeleton.volume_closure_directive/3` 四分支（全书优先/本卷写完/接近收束/一般卷），以空行附在 CP4 当前卷蓝图段后（仅卷有蓝图；空指令字节等价）；`LedgerReconciliation` R10 计划卷数 vs 事实卷数、R11 多卷缺蓝图两条 design_debt 规则接入 `scan`（最小只读 volumes 端口，缺席/读失败不阻断）；真实 Tauri au08 第三轮扩展 PASS——writer prompt 含默认分支收束段（3/3 片段、卷蓝图段后空行、仅 1 次、非默认分支 0、不入草稿），behavior 19 条。诚实边界：R10/R11 finding 真实触发场景未跑（登记后续）；全书优先阈值未触发。B11① 仅剩 CP3 开新卷动作。
- 2026-10-22 — **CP3 开新卷动作 + 真实页面验收 PASS；B11A slice done**：新增 `plan_next_volume` Channel（机械读 TOC → VolumeScope，不靠模型/前端猜 scope）+ scope 透传（planner prompt 机械范围段、scope 版分卷指令、carry planning_scope）+ 前端档案「规划下一卷」入口；真实 Tauri au08 第三阶段 PASS——scoped 候选只产第三卷蓝图+3 章、采纳后三卷 TOC（5/7/3、第三卷 CONFIRMED/source_ref 绑定、章 seq 1..15、前两卷不变）、planner prompt 5/5 机械范围片段且旧全书卷数指令 0 次、既有断言零回归（behavior 22 条）。B11A CP0–CP5 全落；长尾（R10/R11 真实触发、design_ref 接线、卷蓝图编辑 UI、45 §4.2 完整流）诚实登记。
