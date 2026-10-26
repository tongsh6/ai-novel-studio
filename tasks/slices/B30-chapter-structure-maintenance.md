# B30：已有章节重编号、结构修订与卷章类型边界

- 状态：**done（2026-10-27，原生补验收口：确定性矩阵 + 真实模型 scoped 原生）**。作者要求保留原生标准补验：场景1 原生确定性 30/30 + 类型边界 T8 6/6、场景2 原生 12/12；真实模型经原生入口 scoped 批次 26/26（T1 重编号判断/候选/采纳/消费者 + T2 越界澄清零写入，provider=strata/iq3_s，模型生命周期 before loaded=null/after unload=loaded=null）。档案类型边界缺陷（B28 A2 转入）已修（`e83c06c5`）并原生 T8 复验。全门禁与文档收口在最终批次统一记录。
- 原收口记录：**done（2026-10-25，CP0–CP5；两真实 Tauri 场景注册 PASS 30/30 + 12/12，实模 POST-FIX PASS，回归全绿）** / CP0（2026-10-25，真实 Tauri 隔离复现 + 契约冻结）：当前版本无结构维护能力（结构意图→reply/target_not_available/plot_outline 误路由），采纳物化按 title 新建章（无按 chapter_ref 改 seq 路径）；标准 B11A 规划路径蓝图类型安全但持久层无防护。CP0 冻结见 §7，CP1/CP2 进行中。
- 登记日期：2026-10-23；本轮只授权写 slice / 登记 NEXT。
- 归属：[AU08 卷结构规划](AU08-volume-structured-planning.md)、[B11A 卷蓝图](B11A-volume-blueprint.md)、[B25 章节身份](B25-chapter-identity-unification.md)、[VS-00J](../../docs/design/contracts/VS-00J-volume-structure-and-blueprint-contract-pack.md)；提示词统一消费 [B27](B27-systematic-prompt-and-intent-integration.md)。这是新增维护能力，不把 plot_outline 生成冒充重编号。

## 1. 历史失败与完整目标

stage session 5d618f06-f41c-46bc-aa55-5056a2fa5612，2026-10-23 凌晨：第2卷规划产生两份“第11章”；作者要求“只修正列表编号，不改变章节内容定位”，系统生成另一份大纲并采纳。旧“第11章：外门名册上的空白”“第12章：旧钱与旧名”保留，同时新增“第12章：外门名册上的空白”“第13章：旧钱与旧名”。“第2卷：卷蓝图”还被写成 seq=11 的 Chapter。

证据：[模型日志](../../log/llm-calls/stage/2026-10-23.jsonl) 第33–45行；[业务日志](../../log/app/stage/2026-10-23.jsonl) 第579–582行；[AdoptionRepository.ensure_planned_chapter](../../apps/novel_persistence/lib/novel_persistence/adoption_repository.ex) 按标题查找，不存在则新建。标题中的编号、真正 seq、卷/章类型不能继续混为一体。

完整目标：作者提出对既有章节的维护 → 读取结构/基线 → 按 ID 列出拟变更映射 → 作者裁决/采纳 → 原子更新原对象 → 目录、阅读、使命/进度引用、探索与后续创作一致；不增加章节、不改正文。

## 2. 开工七问

1. **Contract**：B25 chapter_ref 为身份、seq 为作品内序号、title 为非唯一展示；VS-00J/ADR-0028 卷蓝图与 ChapterPlanDirection；VS-04/ADR-0019 采纳；新增维护操作契约在 CP0 冻结。
2. **Invariant**：只重编号时 chapter_id 集合/章数/归卷/正文hash 不变；seq 唯一；变化有作者来源、基线与审计；卷蓝图不物化为章；关联索引/账本不因换号指向其他章；失败全回滚。
3. **Boundary**：application 结构读取、候选变更计划、采纳和引用刷新；domain 纯映射/约束；persistence 事务顺序/唯一性/并发；web/frontend 复用结构面和采纳/差异展示。agent 生成建议，不直接执行编号 SQL；不改 provider adapter、不建平行大纲系统。
4. **Consumer**：作者从 WorkspaceChat 说“编号理顺，内容不要动”，审阅原编号→新编号，采纳后目录/阅读/后续问答一致。
5. **Proof**：重排/交换/并发冲突/跨作品/循环引用/幂等/回滚测试；全关联引用审计与真实页面；零正文变化、零新增章节硬断言。
6. **Acceptance Driver**：拟新增 b30-chapter-renumber-roundtrip、b30-volume-blueprint-kind-boundary；外部驱动真实 Tauri 操作/刷新/追问，产品验收感知逻辑：**no**；UI 实现前读当前设计和 Pencil。
7. **Exploration**：TOC/chapter_read/章使命/卷蓝图按稳定 ref 同批消费新序号；旧序号引用的迁移或有效失效策略明确、可查询，不把编号当身份。

## 3. 设计提案与待冻结项

- 提供已有结构维护操作，输入现存 chapter_ref、base version、变更映射及作者范围；不经“先重写大纲标题再按 title 插入”的路径。能力具体名字/输出类型进入现有 registry/schema，不能在前端发明卡类型。
- 明确区分四类效果：只改展示编号、调整章节顺序、迁移所属卷、修改章节内容。当前首个闭环只重编号；其他效果不得被默认捆入。对不唯一的编号解释先提出可审阅方案，必要时只问会影响顺序的决定。
- CP0 冻结 seq 与标题文本中历史章号的展示口径：界面真实章号来自 seq；旧标题前缀如何呈现/兼容须显式决定，不在保存时用宽泛正则改掉真实标题。title 不参与身份选择。
- 采纳在一个事务里校验当前对象/版本/唯一约束并更新；交换编号要处理临时冲突，不能逐行半成功。正文和未授权卷归属不能变化。
- 枚举全部以 seq 建索引/引用的消费者（章使命、章摘要、计划信息条目、伏笔回收时机、进度账、检索、写作坐标等），按稳定 ref 解析或明确迁移；不能只改 TOC 后宣布完成。新状态与 trace 足以回放旧→新映射。
- 卷蓝图与章节条目在生成、解析、采纳间具备明确类型语义，复用 VS-00J。非法混排应拒绝/纠正，不通过“标题看起来像一章”误建 Chapter；是否需 schema 增量在 CP0 决定。
- 操作完成回执基于已提交映射/实际对象数；生成了大纲候选不能说编号已修改。B27 能力目录必须说明该区别。
- 历史重复章节和误建卷蓝图行只做只读来源/依赖/差异清单；不是重复 title 就可合并。数据清理单独备份、审阅、授权，不混入 migration 静默删除。

## 4. Checkpoint

| CP | 工作 | 状态 |
|---|---|---|
| CP0 | 隔离复现两份第11章与卷蓝图误建；冻结身份/序号/展示、维护操作、卷章类型和下游引用处理契约 | **done（2026-10-25，`0f756e2b`）**：真实 Tauri 22/22 checks/5 trials（A1 reply 零写入/标题号与 seq 错位保留；A2/A2b target_not_available run failed；C1 越界误路由 plot_outline 候选；B 蓝图仅存 volumes.blueprint 不占 seq）；契约冻结见 §7（Q01–Q08）；aux 代码链/消费者审计/stage 只读清单 `artifacts/model-contracts/b30-cp0/` |
| CP1 | 按现有 ID/版本生成可审阅变更映射；模型可用操作与 registry/结果一致；无关内容不重写 | **done（2026-10-25，`a5581f35`）**：registry `maintain_chapter_structure`（provider none、既有结构维护、与 plot_outline 区分）；JudgmentProtocol prompt+机械 gate（维护意图不得回退 reply/plot_outline/prose_writing，有界纠错）；ChapterStructureMaintenance 读 context 生成 old→new change_plan（密集重编号/对调/越界/无目标/歧义、effects=display_number_only、base_versions、warnings）；PendingArtifactWorkflow 零 provider/零写入候选 |
| CP2 | 采纳后事务更新、唯一约束、幂等/并发/回滚；禁止生成路径冒充维护，卷章类型校验落边界 | **done（2026-10-25，`a5581f35`）**：`chapter_structure_context/2` 读端口；`renumber_chapters/4` 两阶段临时 seq 单一事务（同 work/卷、stale、唯一、幂等 duplicate 回执、失败整体回滚、只改 seq）；AdoptionWorkflow renumber effect（回执基于已提交映射/object_count/warnings，不调 writer/不建章/不写正文）；`ensure_planned_chapter` object_kind 蓝图 type_mismatch 防护；测试 application 896/0、persistence 310/0 |
| CP3 | 所有编号消费者/账本/探索/阅读/写作坐标同步与 trace；完成历史影响清单 | **done（2026-10-25，`dbdb7770`+`2497e793`）**：ChapterDisplay（身份=ref/章号=当前 seq）、TEC 目标章/写作坐标/章使命/探索别名/判断计划上下文 ref-first；账本/伏笔历史 seq 按 ref 解析当前值（LogEmit remap）；检索/TOC/阅读审计无需迁移；计划物化 ref-first 成对补已提交（`2497e793`）：ChapterPlanParser/物化链 chapter_ref 透传、do_ensure_planned_chapter ref-first（同 work ref 只补 summary/plan_direction、不新建/不改 seq/title/归卷/正文）、plot_outline 输出契约复制已存在章 ref + adapter/TEC 校验 |
| CP4 | 两个新真实 Tauri 场景＋AU08/B25/B24 回归；实模自然语言正反例 | **done（2026-10-25，`9b309fd5`）**：`b30-chapter-renumber-roundtrip` PASS 30/30 checks/6 trials（重编号/对调/幂等/刷新/消费者/负例作者可见澄清零写入）；`b30-volume-blueprint-kind-boundary` PASS 12/12（蓝图仅 volumes.blueprint、无蓝图章/不占 seq、非法混排 type_mismatch 回滚）；双场景注册 nightly；实模 `strata/iq3_s` 单槽 original/paraphrase/negative POST-FIX 均 PASS（修复前 badkey/内部错误已留 before-after）；回归 au08/b25/judgment-explore-chapter-full-read/b28 PASS；`judgment-explore-chapter-plan` 可复现回归待诊断（task-68） |
| CP5 | 全门禁、静态扫描、NEXT/journey/ledger 收口；未获授权的存量清理单列后续 | **done（2026-10-25，CP5 收口）**：全后端 2165 tests/0、前端 603 tests、compile/format/credo 0/enum/xref/arch/adr、I1/I2/I3；静态扫描/task-done；journey D13 closed、slices README/ledger/NEXT 同步；stage 存量清理只读清单未授权单列 |

CP3 的引用与投影后果属于完整范围，不能在 CP1/CP2 后改写为“范围外”。若关联过广，拆执行 checkpoint，保持上述不变量。

## 5. 验收与恢复

- 正例：三章有稳定 ID、不同正文及关联账目→自然语言只重编号→审阅→采纳→刷新/按章查询；章数/ID集合/正文hash/归卷不变，编号与下游引用一致。
- 负例：同名章不合并；无目标/越界/重复 seq/基线过期/数据库失败不半写；未采纳零变更；重复确认不再次移动。
- 卷类型：规划下一卷含卷蓝图和开篇章，采纳后蓝图仅属 Volume，Chapter 只包含真实章节；不降低既有 B11A 规划范围。
- 拟命令：bash scripts/quality_accept.sh b30-chapter-renumber-roundtrip --surface tauri；b30-volume-blueprint-kind-boundary 同口径（实施时登记 quality）。回归 au08-volume-structured-planning、b25-chapter-identity-unification、B24 两个读章场景。
- 完成 [AGENTS](../../AGENTS.md) 后端/前端/架构/静态扫描要求，主链 I3/I1/I2/N-NARR；场景证据与模型语义对照分别记录。当前文档不代表测试已执行。
- 2026-10-23 — 作者授权登记；承接 AU08/B11A/B25 的维护缺口。下次先读 NEXT、B27、VS-00J 与真实消费者，从 CP0 开始，不直接重排 stage。

## 7. CP0 记录与契约冻结（2026-10-25）

### 7.1 CP0 真实复现结论

- 真实 Tauri 隔离复现（22/22 证据 checks、5 trials；证据 `artifacts/slice-verify/b30-chapter-renumber-roundtrip-tauri/`、保护批次 `...-cp0-pass-20261025T0455/`、失败批次保留；记录 `artifacts/model-contracts/b30-cp0/ui-repro.md`）：
  - **A1 自然原话**「把第2卷章节编号理顺，内容不要动」→ judgment `reply`、无 pending、零写入；章节 4→4，id/seq/归卷/正文 hash/摘要引用不变，标题号（11/12/13）与真实 seq（3/4/5）的 3 处错位原样保留。
  - **A2/A2b**（大纲措辞 / stage 原话）→ `target_not_available`×2 → run failed，零写入、无候选；历史「生成另一份大纲并采纳」在当前确定性链路**未复现**（失败早于候选生成）。
  - **C1 越界目标** → judgment 误路由 `execute/plot_outline` 并生成 outline_draft 候选（未采纳本 trial 零写入；若采纳会误增章）。
  - **B 卷蓝图边界**：标准 B11A 规划路径（含「规划下一卷」）蓝图仅存 `volumes.blueprint`，**无 Chapter 标题含蓝图、未占 seq**；持久层 `ensure_planned_chapter` 无 object_kind 防护（历史误建根因未在当前链路复现）。
- 根因：①无结构维护能力（registry/judgment）；②采纳物化按 `(work_id,title)` 查找→不存在新建章，无按 chapter_ref 更新 seq 路径；③标题号≠身份/序号，展示口径未冻结；④卷蓝图类型边界未下沉持久层；⑤缺差异/基线/回执契约。

### 7.2 CP0 冻结决策（Q01–Q08）

- **Q01 维护能力**：新增 registry capability `maintain_chapter_structure`（operation `renumber_chapters` 为首闭环；不新增前端卡，复用既有候选/差异/采纳卡与回执）；judgment 目录必须可见且与 `plot_outline` 明确区分（结构维护 ≠ 生成大纲）；维护意图不得回退 reply/plot_outline/prose_writing；缺目标/越界/歧义→澄清或 gap。
- **Q02 维护操作契约**：输入 `chapter_ref` 列表 + 每章 `expected_seq`/`expected_version` + `mapping(ref→new_seq)` + work/volume scope + `source.author_input_ref` + base revision；输出可审阅 `change_plan`（mapping old→new、object_count、effects、warnings）作为候选 payload；未采纳零写入；回执基于已提交映射/实际对象数，不得用「大纲已采纳」冒充编号已改。
- **Q03 四类效果严格分离**：`display_number_only`（首闭环，只重编号）/`reorder`/`move_volume`/`content_modify`；契约显式 `effects`，不得默认捆入；非法效果 → `unsupported_effect`；只重编号不变量：chapter_id 集合/章数/归卷/正文 hash/title 文本不变，仅 seq 与展示章号变化。
- **Q04 seq 交换事务**：`unique_index(:chapters,[:work_id,:seq])` 已存在；交换/重排用**两阶段临时 seq**（保留区间）在同一 `Ecto.Multi` 内完成，失败整体回滚；幂等（同 operation+mapping+submission → 已提交回执 `duplicate_apply`）；stale base → `stale_base_version`；错误码：`no_target/target_ambiguous/out_of_range/duplicate_seq/stale_base_version/cross_work_scope/type_mismatch/unsupported_effect/partial_failure/duplicate_apply`。
- **Q05 卷蓝图类型边界**：蓝图仅属 `volumes.blueprint`（VS-00J）；plan→adoption 全链携带 `object_kind`，`ensure_planned_chapter/reduce_planned_chapters` 拒绝 blueprint 行/非法混排（`type_mismatch` 拒绝或纠正提示），不得静默成章/占 seq；标准 B11A 路径保持安全；schema 增量暂不提（先证解析歧义/需显式 kind 时再增）。
- **Q06 标题展示口径**：身份=`chapter_ref`；真实章号=`seq`；`title` 仅展示、不参与身份/选择/匹配；历史「第NN章：」前缀不改写存储 title；UI/TOC/回执用当前 seq 生成章号展示，旧 title 前缀仅作历史文本。
- **Q07 下游消费者迁移**：按 `artifacts/model-contracts/b30-cp0/consumer-audit.md` 5 项必做——①计划条目 title 幂等 → chapter_ref；②写作坐标/章使命/进度账/伏笔回收窗口 → ref 优先 + 动态展示 seq；③TOC/探索 chapter_read/检索展示用当前 seq、title 前缀不参与匹配；④阅读投影/章摘要/计划方向（id 消费）验证无需迁移；⑤历史重复章/误建蓝图行只读清单保留（修复另行授权）。重编号后旧 seq 引用迁移或明确失效，trace 保留 old→new。
- **Q08 证据/回归**：两个真实 Tauri 场景（b30-chapter-renumber-roundtrip/b30-volume-blueprint-kind-boundary）+ AU08/B25/B24 回归 + 实模原话/改述正反例；CP3 引用/投影后果不得写“范围外”；stage 存量清理需单独备份/审阅/授权，不混入 migration。

### 7.3 CP1/CP2 实施记录（2026-10-25，`a5581f35`）

- **CP1**：`CapabilityRegistry` additive `maintain_chapter_structure`（provider none、read/write chapter_structure、effect_summary 明确只维护既有结构）；JudgmentProtocol prompt 维护规则 + `validate_maintenance_route/3` 机械 gate（维护意图只放行 execute+maintain/capability_gap/await_author/explore；reply/plot_outline/prose_writing → `maintenance_capability_required` 有界纠错）；`ChapterStructureMaintenance.load_context/2` + `change_plan/2`（密集重编号/点名对调/越界/无目标/多卷歧义、object_count、effects=["display_number_only"]、base_versions、warnings）；PendingArtifactWorkflow 维护分支零 provider/零写入产出候选 artifact（`chapter_structure_change_plan`，复用既有卡，不新增前端卡）。
- **CP2**：`AdoptionRepository.chapter_structure_context/2`（卷/章 refs/seq/title/版本/hash/摘要/同名分组）；`renumber_chapters/4` 两阶段负临时 seq 单一事务（同 work/卷、expected_seq/stale、new_seq 唯一/>=1、幂等 duplicate 回执、失败整体回滚、只改 seq 不写 title/正文/归卷）；`AdoptionWorkflow` renumber effect（action_result 顶层 adoption_effect/committed_mapping/object_count/warnings/persistence；不调 writer/不建章/不写正文）；`ensure_planned_chapter` 前置 object_kind/蓝图校验（type_mismatch 随 Multi 回滚，不静默成章/占 seq，无 schema 增量）。
- **测试/门禁**：新增 b30 service 6、读端口集成 2、judgment 2、renumber persistence 4、renumber adoption 2（含交换/幂等/stale/越界/零写入/蓝图拒绝）；application 896/0、persistence 310/0、agent 265/0，全后端 2138/0；compile/test -Werror/format/credo/enum/xref/arch/adr、I1/I2/I3 全绿。CP3 消费者迁移（task-62/63）进行中。

### 7.4 CP3 实施记录（2026-10-25，`dbdb7770`）

- **展示单一真源**：新 `NovelApplication.ChapterDisplay`——身份 chapter_ref、章号当前 seq；title 历史编号与 seq 一致保留原文，重编号不一致时展示层剥旧编号用当前 seq+core，不重写存储 title。
- **写作坐标/章使命/探索/判断上下文**：TEC 目标章按结构化章条目当前 seq/展示标题匹配（旧 title 编号不参与身份，ref 优先）；章使命 ref-first + mission 材料带 chapter_ref/当前 seq/core；chapter_read title 别名展示/core 精确优先→唯一包含、显式第 N 章按当前 seq（旧 seq not_found）、多候选歧义；章节事实/索引行展示当前 seq+core+ref。
- **账本/伏笔**：历史账目 payload 的 `last_seen_seq/last_advanced_seq/emotion seq` 在停滞/休眠窗口计算前按 chapter_ref（emotion 用 subject_ref）从当前 chapter_index 解析当前 seq，变更发 `LogEmit ledger.seq_remapped`（old→new）；旧 seq 不再静默错位；新账用当前 seq。
- **检索/TOC/阅读**：prose_search 观察只展示 title、refs 有效 → 审计无需改；TOC/阅读投影按当前 DB seq 排序；chapter_id 消费路径无需迁移。
- **测试/门禁**：b30 consumer migration 4/0、ledger seq migration 1/0、exploration seq 1/0；application 902/0、domain 378/0、persistence 310/0、agent 265/0，全后端 2144/0；compile/format/credo/enum/xref/arch、I1/I2/I3 全绿。
- **计划物化残留（成对补）**：`ensure_planned_chapter` 仍 `(work_id,title)` 幂等、`ChapterPlanParser` 章 map 无 chapter_ref；已按 Lead 裁决 **B** 派 task-65（aux parser/物化 ref-first）+ task-66（prose plot_outline 输出契约复制已存在章 ref），完成后 CP4。

### 7.5 CP3 补尾：计划物化 ref-first（2026-10-25，`2497e793`）

- **ChapterPlanParser**：章条目可选 `chapter_ref`（正文标签行 `章节引用:/章节ref:/chapter_ref:` 解析，抽出后不参与方向/摘要/卷归属；`label_line?` 防误判新章；非法格式原样透传由物化层回退）。
- **物化链**：`AdoptionWorkflow` 从 outline payload items 顺序提取 `chapter_ref` → persistence `attrs.chapter_refs` → materialize/reduce 与 parser 条目按索引 zip（parser 显式 ref 优先、item 字段兜底）。
- **`do_ensure_planned_chapter` ref-first**：合法 `chapter:<uuid>` 且同 work → 只补该章 summary/plan_direction（不改 seq/title/归卷/正文）；无 ref/null → 旧 title 幂等；合法但不存在/跨作品 → `target_missing` 零写入（不猜 title）；非法格式 → 回退 title 幂等（迁移兼容）。
- **plot_outline 输出契约**：已存在章逐字复制「作品章节」索引 `chapter_ref`、新章不填/留空、不编造/不改写/不拼进 title·body；AuthoringTask outline `optional_keys=["chapter_ref"]`；CreativeToolAdapter 从 provider raw item 按 item_id 无损重挂 ref（`invalid_chapter_ref`/`duplicate_chapter_ref` 可解释失败）；新 `PlotOutlineChapterRef` 按同 work 校验（跨作品/非法/重复 → failed ToolResult 零候选零写库，无章索引诚实跳过）。
- **测试**：persistence 315/0（parser 透传/改号 title+ref 不新建/同 title ref 精确/无 ref 兼容/非法回退/跨作品拒绝/item zip）、application 907/0（ref wiring）、agent 267/0；全后端 2156/0；compile/format/credo 0/enum/xref/arch、I1/I2/I3 全绿。

### 7.6 CP4 完成记录（2026-10-25，`9b309fd5`）

- **确定性 Tauri**（HEAD `00a63c11` + fixture `0c1203ec`）：`b30-chapter-renumber-roundtrip` `quality_accept` PASS **30/30 checks/6 trials**、log_noise ok；实测：维护能力→候选可见 old→new 映射（第3→2/第4→3/第5→4）→保存后 seq 按 committed_mapping 原子更新（含交换/两阶段临时 seq）→章数 4→4、ID 集合/归卷/正文 hash/title 文本/摘要引用不变、回执 committed_mapping(3)/object_count(3)/warnings(title_number_mismatch)、effects=display_number_only；刷新稳定/重复采纳无移动/TOC 顺序=seq/按章阅读可见；负例 3/3 零写入 + 作者可见澄清（duplicate→无法确定目标章节请确认；越界→超出当前作品结构；无目标→未找到目标章节）。证据 `artifacts/slice-verify/b30-chapter-renumber-roundtrip-tauri/`（副本 `...-cp4-canonical-pass-20261025T0625/`）。
- **卷蓝图类型边界**：`b30-volume-blueprint-kind-boundary` PASS **12/12 checks**；规划卷章+规划下一卷后 blueprint 仅存 `volumes.blueprint`、蓝图 Chapter=0/不占 seq；harness 非法「第02章：卷蓝图」章块 → `type_mismatch` 整体回滚（章/卷 0）。证据 `artifacts/slice-verify/b30-volume-blueprint-kind-boundary-tauri/`（副本 `...-cp4-canonical-blueprint-pass-20261025T0625/`）。
- **注册**：scenarios.yml 两场景（nightly/tauri/slice_verify）+ manifest active + README + runner allowlist/seed harness；quality_manifest_check passed；driver/verifier lint/node check、verifier 245/245。
- **实模**（`strata/iq3_s` 单槽；model_behavior 与 product_state_chain 分开）：修复前 original → judgment maintain 正确但产品 badkey `frame_ref` 崩溃无候选（before）；修复后 original → model_behavior PASS + product_state_chain PASS（pending `chapter_structure_change_plan` 候选、零写入、章 4→4）；paraphrase（「第二卷的章节序号有点乱…别改正文」）model+state PASS；negative（「第九卷」）→ capability_gap 作者可见解释、零写入、无候选/无回退。证据 `artifacts/slice-verify/b30-cp4-model-{original,original-postfix,paraphrase-postfix,negative-postfix}/`。
- **回归**：au08-volume-structured-planning、b25-chapter-identity-unification、judgment-explore-chapter-full-read、b28-whole-chapter-revision PASS；`judgment-explore-chapter-plan` 可复现失败（chapter_read 观察正确但最终回复引用 session_adoptions JSON），失败批次 `...-b30cp4-fail-20261025T0620/` 保留，task-68 诊断中。
- **CP4 期间修复的真实缺陷**：维护分支 trace 不完整 badkey（`f2ebf514`）、维护目标/范围错误未映射为作者可见拒绝（`00a63c11`）。

### 7.7 CP5 收口记录（2026-10-25）

- **门禁**：compile -Werror、**2165 tests/0**（common 96/domain 378/agent 273/persistence 315/application 910/web 133）、test -Werror、repo format、credo strict 0、enum/xref/arch/adr；前端 typecheck/lint/**603 tests**、frontend_audit、check_design_trace；quality_manifest_check；**I1/I2/I3 全 PASS**；静态扫描 PASS（仅既有 gitleaks disposition/流程噪声）、task-done manifest。
- **真实页面**：`b30-chapter-renumber-roundtrip`（30/30 checks/6 trials）与 `b30-volume-blueprint-kind-boundary`（12/12 checks）注册 nightly 并 PASS；证据 canonical/保护副本/全部失败批次保留（CP0 批次、解释性缺口 batch1、verifier 阈值 batch2-3、轮询窗 batch4、蓝图 pre-fix、chapter-plan 失败两份 + 最终 PASS 副本）。
- **回归**：au08-volume-structured-planning、b25-chapter-identity-unification、judgment-explore-chapter-full-read、judgment-explore-chapter-plan（test-support fixture 修复后 PASS）、b28-whole-chapter-revision 全 PASS。
- **实模**（`strata/iq3_s` 单槽，POST-FIX）：original/paraphrase model_behavior+product_state_chain PASS（judgment 绑 maintain、候选产生、零写入）；negative（第九卷）capability_gap 作者可见解释、零写入；修复前 original badkey 崩溃证据保留 before/after。model-only runner exit 1 因 verifier 不消费 model-only ui record（B28 同现象），证据 JSON/app-log/截图齐全，不影响确定性场景。
- **known limits（如实登记）**：① `baseline stale/unsupported_effect` 在真实页面无自然语言注入入口，由 CP1/CP2 单测 + adoption 守卫覆盖（两 b30 yml known_not_closed 已登记）；② 结构维护首闭环只支持 `display_number_only`，reorder/move_volume/content_modify 未实现（契约已预留 effects 分离）；③ stage 历史存量（两份第11章/新增12·13章/「第2卷：卷蓝图」seq=11 Chapter）保持只读清单 `artifacts/model-contracts/b30-cp0/stage-impact.md`，不删除/不合并/不写数据，修复需作者单独授权；④ model-only harness 非注册入口、不作 CI 判据。
- **完成判定**：CP0 真实复现→CP1/CP2 能力+事务→CP3 消费者迁移→CP4 两场景+回归+实模→CP5 门禁/台账，均齐备；B30 done。后续结构深化（reorder/move_volume）与 stage 清理另立任务。

### 2026-10-25 完成审计与原生补验

当前只重开原生交互证明，未回滚已验证的实现或浏览器结果。证据对账与作者裁决见 [既有对账任务](VS00D-G-GAP-RECONCILIATION.md) 的队列完成审计；机器证据 `artifacts/completion-audit/20261025-1817/surface-audit.json`。后续复用本 slice 原验收矩阵，以外部系统 UI 驱动真实窗口，保留源操作/WS/持久状态和截图；原批次只读，不修改判据。

### B28原生复验转入的类型展示问题（2026-10-25）
- B28 A2的真实档案“大纲与结构”页，将两份prose_fragment正文候选及一份target_segments修订候选显示为“大纲草稿/保存到大纲”；章节当前canon仍2章、3127字，未点这些误标按钮。证据 `artifacts/slice-verify/b28-native-20261025-a2/run/T8-archive.ax.txt` / `.jpg`。归本slice已有类型边界范围，接手先查真实DTO/投影/selector再修复；不在B28测量中途扩大修改。

- 后续验收倾向按作者最新反馈同步：确定性替身仅作工程回归；主业务结案需要真实模型经原生入口完成判断/必要提问、候选、采纳和后续事实消费。沿原任务语义与数据断言，不以模型调用次数或脚本预设路线作为成功替代。

#### 2026-10-27 完成审计后的原生补验（确定性矩阵）

- **背景**：完成审计指出原 canonical summary 为 `surface=browser / driver=headless-chromium`，不能证明原生 Tauri 交互；作者选择保留原生标准，按原队列补验、不重跑真实模型矩阵换分。本地新增 `scripts/lib/native_ui/`（macOS AX/CGEvent 外部驱动）与 `scripts/native_b30_drive.mjs`、`scripts/native_b30_evidence.mjs`，由外部系统 UI 操作真实窗口。
- **批次**（provider=slice_verify 确定性，driver=`ax-native-system-ui`，`browser_driver_started=false`）：
  - `artifacts/slice-verify/b30-chapter-renumber-roundtrip-native/`：**原生 36/36 checks PASS**（浏览器 30 项 checks 1:1 + 档案类型边界 T8 6 项）。实测：T1 映射 3→2/4→3/5→4、committed_mapping 3/object_count 3/warnings 3 条 title_number_mismatch，章数/ID/归卷/正文 hash/title 文本/摘要引用不变、seq 唯一；T2 对调两阶段生效；T3 幂等无移动；T4 关闭重开刷新稳定、采纳按钮 0、TOC 顺序=seq、按章阅读可见对应正文；T5 三负例零写入+作者可见澄清/拒绝+无 outline/prose 候选；T6 work B 规划卷章→2 卷/12 章/2 条 `volumes.blueprint`、0 蓝图章；规划下一卷→3 卷/3 蓝图/0 蓝图章；harness type_mismatch 0 章 0 卷。
  - `artifacts/slice-verify/b30-volume-blueprint-kind-boundary-native/`：**原生 12/12 checks PASS**（与浏览器 canonical 逐项同名同语义）。
  - 证据含 25 组AX+截图+text、native-transport.jsonl、app-log、llm-calls、只读 DB、wait-events（场景1 64 条分型等待 begin/finish）；测量期间生产源码指纹未变（HEAD `7858faf0`）。全部失败批次（驱动自身缺陷/环境干扰：waitready/nested-wait/archive-return-typing/receipt-attribution/config-before-prepare/work-menu×2/verify-dedupe-t8/screenshot-flake/composer-interference/composer-readback）只读保留，不冒充通过。
- **档案类型边界修复（B28 A2 转入，`e83c06c5`）**：真实“大纲与结构→待保存大纲”曾把 prose_fragment/target_segments 修订候选显示为“大纲草稿/保存到大纲/提出修改”。根因为 `StructurePanel.pendingArtifactTab` 把 prose_fragment/scene_draft 映射到 outline tab；修复为内容类 artifact 不进入档案待采纳 section/计数（不改工作台候选卡/available_actions/schema/ADR/后端），前端测试 617→621（red→green）。**原生 T8 证据**：真实修订候选在工作台显示“保存修订稿”；档案“大纲与结构→待保存大纲”中 待保存大纲/大纲草稿/保存到大纲/提出修改 均为 0，已采纳章节计划=1 正常；真实 outline 候选仍显示 待保存大纲+大纲草稿+保存到大纲（6/6 checks）。
- **剩余（未闭环，不在本记录冒充）**：真实模型经原生入口的 scoped 证据（判断绑定/必要询问/候选/采纳/消费者）待补；全门禁与 NEXT/journey/ledger 收口待做。

#### 2026-10-27 原生真实模型 scoped 批次（strata/iq3_s）

- **范围**（不重跑全矩阵、不换分）：T1「把第2卷章节编号理顺，内容不要动」→ 真实模型判断/候选 → 原生「保存到作品」→ DB/消费者；T2「把第九卷章节编号理顺，内容不要动」→ 越界澄清零写入。
- **批次**：`artifacts/slice-verify/b30-chapter-renumber-roundtrip-native-strata/run/`；provider=strata、model=iq3_s、driver=`ax-native-system-ui`（原生窗口，非 Chromium）、`scope=scoped_real_model`、trials=T1/T2。
- **结果**：scoped checks **26/26 PASS**（`summary.json` + `b30-native-checks.json`）：真实调用 5 次全部 `POST /v1/chat/completions` 2xx 且 app-log `provider_gateway.complete.start` 全 strata；T1 真实 judgment `explore→execute capability=maintain_chapter_structure`，候选映射 3→2/4→3/5→4（display_number_only）原生可见，采纳回执 committed_mapping 3/object_count 3/warnings 3 条 title_number_mismatch，DB seq 按映射更新、章数/ID/归卷/正文 hash/title 文本/摘要引用不变、seq 唯一；T2 越界→await_author 作者可见澄清、零写入、无新章/无 outline/prose 候选；`author_question_events=[]`（本批模型未发交互式问题卡；失败批次中曾发选项问题，只读保留用于驱动修复回放）。
- **模型生命周期（硬规则）**：`model-lifecycle-before.json` 记录 lms ps/内存/Strata loaded=null//v1/models 含 iq3_s；`model-lifecycle-after.json` 记录 `POST /api/models/unload` 200 → 回读 loaded=null/unloaded=true（成功与失败路径都执行卸载，失败批次亦验证 loaded_after=null）。
- **失败批次（只读，驱动缺陷非产品缺陷）**：`...-native-strata-failed-driver-assert-20261027T0121`、`...-native-strata-failed-question-settle-20261027T0124`。
- **边界**：本批是 scoped 实模证据（T1/T2），不冒充确定性 36 项矩阵；全面板/全负例矩阵仍以原生确定性批次为准。
