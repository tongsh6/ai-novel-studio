# B11A-volume-blueprint：卷结构与卷级蓝图（大周期）

**状态**：**doing（2026-10-22，CP0 + CP1 + CP2 + CP4-lite 已落地，门禁全绿，且该链真实 Tauri `au08-volume-structured-planning` PASS；CP3 开新卷动作、CP5 卷级收束/负债、CP4 完整消费面 queued）**。ADR-0028 已 Accepted。作者拍板主线顺序 B13a → B11③ → B11①，本 slice 即 B11①。**未写 done**：开新卷动作（CP3）、卷级收束/负债规则（CP5）、CP4 完整消费面与真实页面验收仍未闭环（见 §2b 诚实边界与 ADR-0028 enforcement_gaps）。
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
| **CP3** | 开新卷动作形态 A：判断意图 + `volume_scope`（机械上下文给当前卷数与末章位置）+ planner 产下一卷蓝图/首批章计划 + 采纳落卷 | 单测（意图判定/作用域绑定）；真实页面「开第二卷」→候选→采纳 | queued |
| **CP4** | 卷蓝图消费面：档案卷头只读块（**CP4-lite done，真实页面可见已 PASS**）；planner「当前卷蓝图+进度」注入；`chapter_mission_inputs` 卷坐标；探索面当前卷；`WritingCoordinate.volume_ref`；修工作台「未定卷」假坐标；`design_ref` 形状 | 单测（在场/缺席逐字节）；组件测试；真实页面可见 | **CP4-lite done（2026-10-22，au08 Tauri PASS）；余项 queued** |
| **CP5** | 卷级收束守则（全书优先）+ 计划卷数/事实卷数负债规则 + 真实页面验收（扩 au08 场景） | 域单测 + 真实 Tauri PASS + I1/I2/I3 | queued（与 CP4 同批验收） |

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

**诚实边界（未闭环，不得写 done）**：CP3 开新卷动作无代码；CP5 卷级收束/负债规则无代码；CP4 完整消费面（planner 注入/坐标/探索面/design_ref）未接线；卷蓝图编辑/作者裁决 UI 未做；重采纳时若蓝图改名而逐章 `所属卷` 仍用旧名会按标题落成另一个卷（契约字面：章标注定章挂哪卷，未加模糊匹配）；其它多卷场景（au13/au14/ca04）未回归 blueprint 兼容（桩已会产蓝图行，断言未加）。

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
