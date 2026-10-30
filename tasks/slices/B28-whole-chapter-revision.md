# B28：完整章节修订、排版范围与采纳身份闭环

- 状态：**done（2026-10-27，CP0–CP5 + 2026-10-25 完成审计后原生补验收口）**。原 CP2/CP3 浏览器产品链证据保留；完成审计要求补齐的**原生 Tauri 交互**已由 R3（真实模型排版计划新增分段→采纳→阅读/重开）、R3-resume（真实模型内容修订→采纳→阅读/检索）、R4（阅读投影刷新修复）、R11（T4 缺目标修复后真实模型单次 scoped 复验 13/13）与迁移后的确定性 48 项 driver 验证（见下）共同覆盖；T4 产品根因（观察分类/no_progress 具体澄清）已系统性修复并合入 `028b6231`。残余：原生 48 项单批全矩阵（A3）未重跑，按“产品修复后只做失败类型 scoped replay”分别归档，不冒充单批全量原生通过；stage 历史数据修复仍未授权。
- 原收口记录：**done（2026-10-25，CP0–CP5；真实 Tauri 场景 PASS 48/48 checks，CP4 真实模型意图/材料覆盖 PASS，writer 生产端 known-gap 如实记录）** / CP0（2026-10-25，真实 Tauri 隔离复现 + 契约冻结）：当前版本已阻止 stage 式「单片段冒充整章」候选（honest failure），但整章只排版仍不可完成；内容修订采纳仍会因 target 空而新建章（stage 21:58 失败链可复现）。CP0 复现证据 `artifacts/slice-verify/b28-whole-chapter-revision-tauri/`、记录 `artifacts/model-contracts/b28-cp0/{ui-repro.md,code-chain.md,contract-proposal.md,stage-impact.md}`；CP1 契约与实现已按 §7 冻结。
- 登记日期：2026-10-23；来源：stage“整理第1章正文”只处理初稿、采纳后新增第17章。
- 上游：[Q1c](Q1C-adopted-content-revision.md)、[B24](B24-exploration-chapter-full-read.md)、[B25](B25-chapter-identity-unification.md)、[Q1Cb](Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md)。提示词统一归 [B27](B27-systematic-prompt-and-intent-integration.md)，不在此追加局部提示词补丁。
- 初始登记阶段只授权文档；后续实施依各节作者裁决推进。stage历史数据未修改。

## 1. 问题与证据

2026-10-23，session 5d618f06-f41c-46bc-aa55-5056a2fa5612：原第一章 dd888519-deef-47ba-931c-fb5978316149 含两个 accepted draft，初稿2517字符、续写1075字符；续写换行数为0。21:22 作者要求整理第一章，判断绑定 as_mvjscqql_8sq，writer 只收到初稿；结果2518字符，与初稿只有四处措辞差异。21:58 采纳时 target_chapter/target_chapter_ref 均为空，新增 chapter 6547c233-d291-40ec-bedb-c8ba33f353e6（seq=17，标题“罪碑之下”），原章和无分段续写仍在。

证据：[模型日志](../../log/llm-calls/stage/2026-10-23.jsonl) 第77–78行；[业务日志](../../log/app/stage/2026-10-23.jsonl) 第1092–1135行；源码 [PendingArtifactWorkflow](../../apps/novel_application/lib/novel_application/pending_artifact_workflow.ex)、[AdoptionRepository](../../apps/novel_persistence/lib/novel_persistence/adoption_repository.ex)。这些证明历史失败，不能据此推断所有新版本路径都失败；实施前须隔离复现。

完整目标：作者用自然语言要求修订一章 → 解析真实章身份与范围 → 读取全部当前正文 → 生成待采纳修订候选 → 审阅/确认 → 同章替代 → 阅读、摘要、检索、后续上下文消费新版本，历史可查。

## 2. 开工七问

1. **Contract**：[VS-04](../../docs/design/contracts/VS-04-adoption-boundary-contract-pack.md)、[VS-00E](../../docs/design/contracts/VS-00E-prose-execution-quality-contract-pack.md)、ADR-0019、B25 chapter_ref，扩 Q1c 的修订目标从单 artifact 到明确章节覆盖范围；具体字段/schema 在 CP0 冻结，不假设现有单 ref 能表达多片段。
2. **Invariant**：同一章身份不变、章数不变；全文输入覆盖全部当前片段；保留原稿历史；确认前零 canon 写入；越界/缺失/过期拒绝；排版不改内容；结果与实际写入一致；模型正文遵守 I1 字节来源。
3. **Boundary**：application 目标/材料/修订/采纳/摘要触发；domain 纯范围/版本契约；persistence 全章读取、事务替代和投影；web/frontend 复用候选/差异/覆盖确认入口。agent 仅消费 B27 统一的操作与输出契约，不承担章节寻址。UI 实现前读设计章节和 Pencil，不新建旁路页面。
4. **Consumer**：WorkspaceChat → 修订候选 → 作者采纳 → 阅读模式及下一轮 chapter_read；不是只验证 writer 返回 JSON。
5. **Proof**：多片段覆盖、同名章隔离、缺 ref 恢复、stale/跨作品/幂等/回滚单测；真实页面与实模意图场景、I1/I2/I3/N-NARR、全门禁。
6. **Acceptance Driver**：拟新增 b28-whole-chapter-revision，外部驱动真实 Tauri 工作台发“整理第一章”→审阅→确认→阅读→刷新→追问；产品新增验收感知逻辑：**no**。
7. **Exploration**：chapter_read、session_adoptions、阅读/摘要/检索按同一 chapter_ref 暴露当前版本与修订来源；覆盖片段/是否完整可机械验证，不能只把第一份 artifact 的预览称为整章。

## 3. 契约提案与实现约束

### 3.1 目标、完整输入和范围

- 目标表达 chapter_ref + 当前被覆盖的 scene/draft 身份与版本 + 修改范围；单片段修订仍是单片段，作者说“全章”不能默默降为第一份产物。字段名与 card payload 通过既有 schema 流程确定。
- 原话、模型对指代的解释、实际绑定对象、可读取范围分别保留。阅读焦点只是上下文证据，不是隐式修改授权。
- 材料由当前 accepted reading projection 按顺序组装；核验覆盖集合与版本。超过模型预算时按完整任务分段处理并保留覆盖账，或者诚实说明限制；不得截断后宣称全章完成。
- 旧 artifact 缺 ref 时，优先沿 adoption mutation/projection/draft 来源恢复唯一真实身份；无法唯一恢复则停止并列出作者可辨认的候选。修订既有章禁止走“标题0命中→新建章”；新章创作独立保留。
- CP0 必须选定多场景替代策略：沿现有 draft/version 事务化处理完整覆盖范围，保持场景边界或显式说明整章合并的变更范围。不能只 supersede 第一场、让未处理片段重复留在当前阅读投影，也不能无契约新建平行正文存储。

### 3.2 排版与内容修订分开

- 首个场景限定“只分段和排版、不改字句”；去除约定空白后的源正文与候选必须相等。约定空白规则在 CP0 固化，不用过宽归一化掩盖删字。
- 作者要求统一标点时另列允许的转换和差异，不能顺带润色、删环境或删情节。普通内容修订不使用“仅排版字节相等”验收。
- writer 按 B27 操作语义渲染，不能同时接到“继续往后写”和“返回完整修订”的命令。
- 应用检查完整性与变更范围，失败后按既有有界重试/诚实失败；不得在服务端补写、拼接或修补模型的 artifact 正文来凑通过 I1。

### 3.3 采纳、后果与存量

- 候选带 base revision、覆盖范围及旧/新对比；沿 Q1c 的覆盖确认与重过门禁，不因 authoring_intent 缺省而落入 append。
- 一次采纳事务：验证源版本与作用域 → 范围内旧稿退为历史 → 新稿成为当前正文 → state trace/projection hint 完整。失败回滚，重放不重复写。
- 采纳后 chapter_id/章数不变；旧版本可查，阅读、摘要、检索和下一轮上下文只消费当前版本；摘要失败按现有机制诚实标记，不能让旧摘要冒充新稿。
- stage 存量另做只读清单：第1章与第17章的来源、差异、依赖引用、保留/回退方案。实际修复需备份、可审阅差异及单独数据写入授权；本 slice 登记不授权自动删除/合并。

## 4. Checkpoint

| CP | 工作与完成标准 | 状态 |
|---|---|---|
| CP0 | 隔离复现旧 ref 缺失/初稿+续写；冻结目标范围、格式保真、覆盖和历史身份恢复契约；列 stage 只读影响清单 | **done（2026-10-25，`e8ad1fad`）**：真实 Tauri 复现 T0–T3（同章 2 accepted、writer 只初稿、format 忠实失败、单处修订 target 空→新建章、同标题歧义拒绝、缺 ref 误路由但零写入）；契约冻结见 §7；stage 存量只读清单见 `stage-impact.md`（修复需另行授权） |
| CP1 | 完整章节基线、版本/覆盖检查和旧来源恢复；失败路径不新建章；与 B27 共用操作语义 | **done（2026-10-25，`655220d6`）**：共享契约（`7950437c`）落地；AuthoringTaskBuilder.for_chapter_revision/1、判断章级绑定规则、Real format_only/content_revision 渲染；persistence replace_scope 多片段原子事务 + accepted_chapter_scopes、application validate_b28_contract/chapter_revision_context；全后端 2098/0 全绿。CP1.5 wiring 已提交（`1dea5ed3`）：章级目标进判断上下文、writer 全章覆盖顺序文本、候选顶层/payload provenance、采纳回执 superseded refs；全后端 2111/0。CP2 真实页面复验（task-51）进行中 |
| CP2 | 修订候选/差异/确认→原章事务替代；旧版本与 trace 留存、幂等/回滚 | **done（2026-10-25，`29f9a03d`）**：真实 Tauri `b28-whole-chapter-revision` PASS（35/35 checks、6 trials、log_noise ok）；T0a 同名澄清阻断、T0b ref 绑同章、T1 整章排版 replace_scope（章数 2→2、旧 2 稿 superseded、归一字节等价）、T2 只改指定处其余逐字、T3 幂等、T4 缺 ref 澄清零写入；回归 b25/judgment-explore-chapter-full-read/p1/q1c 全 PASS；场景已注册 nightly |
| CP3 | 阅读/摘要/检索/探索/后续问答同批消费新值，UI 保留作者来源和范围 | **done（2026-10-25，`4d1cf3eb`）**：真实 Tauri PASS（48/48 checks、10 trials、log_noise ok）；T5 阅读/投影 hash/字数==新 accepted 全文、刷新一致、旧 3 稿 SUPERSEDED 历史可查；T6 摘要指向新 draft 不引用旧源；T7 真实主输入→prose_search 命中新值/旧值不命中、上下文含新整章正文；T8 档案可见章身份+范围；边界（无页面搜索入口/摘要 UI 不渲染）已登记 |
| CP4 | 新真实 Tauri 场景＋Q1c/B24/B25/续写回归；真实模型原始问法与改述验证 | **done（2026-10-25，`2095b9a3` + CP5 记录）**：`strata/iq3_s` 单槽 3 轮（original canonical/retry1/paraphrase canonical）：两 phrasing 判断均绑 `chapter:<uuid>`+format_only、writer prompt 覆盖两片段（model_behavior PASS）；writer 生成系统性 `invalid_response` 退化（~260s 低信息熵重复）→ 无候选、零写入、诚实失败（writer known-gap，记 §7.8）；CP4 driver 证据分支已提交；正例候选契约/format_only_violation 负例待 writer 生产端修复后回归 |
| CP5 | 全门禁、静态扫描、NEXT/journey D5/ledger；数据修复未授权时如实单列，不能称 stage 数据已恢复 | **done（2026-10-25，CP5 收口）**：后端 2122 tests/0、前端 603 tests、I1/I2/I3、adr/credo/enum/xref/arch/format、frontend audit/design、manifest、静态扫描、task_done；stage 数据修复保持只读清单未授权；B28 done（CP4 writer known-gap 如实登记） |

CP1/CP2 是执行检查点，不缩小完整闭环；CP3/CP4 未完成不能标 done。可先完成数据边界修复，不依赖先重写所有提示词；新增提示词资产必须遵循 B27 整合决定。

## 5. 验收矩阵与命令

- 正例：一章两份已采纳正文（第二份零换行）→“只整理整章排版”→候选含两份独有末句→确认→原章完整分段；chapter_count 不变，旧稿可回溯，刷新/再读一致。
- 对照：同标题两章，只改指定 ref；只改某段时其余正文逐字不变；普通续写仍 append、不覆盖旧正文。
- 拒绝：目标来源缺失、歧义、跨作品、基线被并行修改、重复采纳、持久化中途失败；拒绝零写入、错误可解释。
- 实模判断与确定性状态链分别留证；外部 driver 使用可见语义，证据含截图/WS/app JSONL/持久化与正文hash。
- 场景实施时注册 quality/acceptance；拟命令 bash scripts/quality_accept.sh b28-whole-chapter-revision --surface tauri。回归 b25-chapter-identity-unification、judgment-explore-chapter-full-read、p1-chapter-adoption-reading，并补 Q1c 的原生 Tauri 正文覆盖证据。
- 实施前后按 [AGENTS](../../AGENTS.md) 完成 app 依赖阅读、compile、后端/前端/架构/静态扫描门禁；主链 I3/I1/I2、N-NARR 必跑。当前仅文档，不声明任何功能检查通过。

## 6. 决策与恢复

- 2026-10-23 — 将 stage 修订失败登记为 Q1c/B25 的真实业务补口，保留其历史已通过证据，不把单场景 done 外推为全章修订完成。
- 先读 NEXT、B27 整合矩阵、Q1c/B25 实态与当前 WIP；从 CP0 隔离复现恢复，不直接修 stage 数据。

## 7. CP0 契约冻结与 CP1 拆解（2026-10-25）

### 7.1 CP0 真实复现结论（详见 `artifacts/model-contracts/b28-cp0/ui-repro.md`）

- 真实 UI 构造同章 **2 场景/2 accepted draft**（初稿 2517 字符 + 零换行续写 1075，章内容 3593）；同标题两章隔离作品对照。
- **T1 整章只排版**：judgment `execute/revise_adopted_content` 但只绑单个 artifact；writer prompt 两次只含初稿锚点/首段，**续写未进材料**；无候选，honest failure `{:pending_artifact_invalid, :revision_scope_violation}`，零写入。→ 当前版本已阻止 stage 式误导候选，但仍无法完成整章只排版。
- **T2 明确改一处**：单片段候选（2516 字符、无续写），`target_chapter/target_chapter_ref=null`、`supersedes_ref=null`；采纳成功但 **chapter_count 2→3、新增章 seq=3**，原章未变、旧稿仍可读、投影过期提示、刷新幂等。→ stage 21:58 失败链同构，仍可复现。
- **T0 同标题两章**：真实 UI 生成→修改后采纳被结构化拒绝 `ambiguous_chapter_title`（edit_then_accept 持久化未贯通 target_chapter_ref），零写入。
- **T3 缺 ref**：judgment 误路由 `prose_writing`，但 missing policy 兜底停止、零写入/不新建章。
- 根因：①材料按单 artifact 组装、无章级 accepted 片段/版本账；②无 format_only 操作语义（只能事后守卫）；③prose 修订候选 `target_chapter_ref=null`/`supersedes_ref=null`；④采纳按 title 回退（同名→歧义拒绝、异名→新建章），edit_then_accept 未贯通 ref；⑤缺 ref 意图落到 prose_writing。

### 7.2 CP0 冻结决策（Q01–Q08）

- **Q01 目标作用域（additive 到 `AuthoringTask.scope`，已落 `novel_common`）**：`modification_scope: :format_only | :target_segments | :whole_chapter`、`expected_base_versions: [%{ref, version}]`；复用 `refs/coverage/base_ref/base_hash/target_chapter_ref`。章级修订（`:whole_chapter`/`:format_only` + `target_chapter_ref`）以章身份+期望版本为基线，不强制单 artifact `base_ref`；`:whole_chapter` 要求 `coverage: :complete`。
- **Q02 材料覆盖账**：整章/多片段修订必须组装全部当前 accepted 片段（阅读投影顺序）+ 每片段 version；`materials(kind/ref/version/complete?/omission_note)` 缺片段且未声明 omission → 拒绝 `incomplete_scope`；超预算分段保留覆盖账，不得截断称整章。
- **Q03 旧全文 format_only 归一规则（兼容保留；新计划采用 ADR-0029）**：①逐行删除行尾空白；②换行形式归一（CRLF/CR→LF）；③文末连续空行折叠为单换行；④其余字节必须完全相等。判定在应用层机械执行，异常 `format_only_violation`（附首处差异 offset/行号），不自动降级 rewrite；旧机制证据不等于真实模型完成分段；新计划以 ADR-0029 实际改变换行且非换行字节完全不变为判据，真实闭环仍由本任务承接。
- **Q04 采纳 effect 显式**：候选/采纳回执携带 `adoption_effect: replace_scope | append | new_chapter`；`replace_scope` 只替换覆盖范围内当前 accepted draft（旧的 supersede、历史保留、chapter_id/seq/章数不变）；target 缺失默认 `target_missing`，`new_chapter` 必须作者显式确认（禁止静默新建章）；edit_then_accept 必须贯通 `target_chapter_ref`。
- **Q05 错误码（8 类，已落 `AuthoringSemantics.revision_error_codes/0`）**：`target_missing/target_ambiguous/stale_base_version/cross_work_scope/duplicate_apply/incomplete_scope/format_only_violation/partial_failure`；拒绝零写入、可解释。
- **Q06 契约/持久化边界**：复用 B25 `chapter_ref`、Q1c `revision_base`/覆盖确认、VS-04 provenance、B27 `AuthoringTask` scope/materials；无 DB 表/列变更；`adoption_effect`/错误码落 TurnResult/adoption receipt payload（additive JSON），schema/codegen 若有增量在 CP2 前登记并同步 docs。
- **Q07 stage 存量**：只读清单见 `stage-impact.md`（ch1 两份 accepted + ch17 新章）；修复需作者单独授权（备份+sha256、replace_scope 目标 ch1、ch17 保留历史），本 slice 不自动删除/合并。
- **Q08 边界**：不改 provider/创作工具/采纳语义之外的体系；粘贴正文/摘要/检索按同一当前版本消费；模型意图原话/改述验证归 CP4；真实模型不得承担章节寻址。

### 7.3 CP1/CP1.5 实施记录（2026-10-25）

- **CP1 已提交 `655220d6`**：`AuthoringTaskBuilder.for_chapter_revision/1`（target_chapter_ref/covered_refs/modification_scope/expected_base_versions/coverage=complete + 可解释错误）；判断 prompt 章级绑定规则；`CreativeProvider.Real` format_only（覆盖顺序完整稿/只排版/禁续写）与 content_revision（指定范围/其余逐字/完整替换稿）；`AdoptionRepository.persist` replace_scope 分支（target/版本/覆盖校验→旧 accepted supersede→新 accepted→同章同 seq/章数不变→投影，失败整体回滚）+ `accepted_chapter_scopes/2`；`AdoptionWorkflow.validate_b28_contract/1`（target_missing/format_only 归一/差异拒绝）与 `chapter_revision_context/2`。测试：application 869/0、agent 258/0、persistence 869/0；compile/format/credo/enum/xref/arch 全绿。
- **CP1.5 wiring（已提交 `1dea5ed3`）**：aux `chapter_revision_context` 增 materials[].text/base_text + `chapter_revision_targets/1` 章目标列表；replace_scope 结果回显 `adoption_effect`/`superseded_draft_refs`；prose 章级目标进 `accepted_targets`/judgment prompt（「可选章级修订目标」+modification_scope）、chapter:* 经 `revise_chapter` 注入全章覆盖顺序正文、候选 artifact 顶层 `target_chapter_ref` + payload `modification_scope`/`adoption_effect`/format_only `base_text`、候选标题「<章标题>（整章排版/内容修订稿）」、slice_verify 章修订 fixture（format_only 基线 / content_revision 明确 X→Y 其余逐字）。测试：application 881/0、persistence 306/0、agent 258/0；全后端 2111/0；compile/format/credo/enum/xref/arch 全绿。CP2 真实页面（task-51）进行中。

### 7.5 同名章目标歧义守卫（2026-10-25，`392c45e9`）

- CP2 首跑发现：planner 未给 `chapter_ref` 且目标标题命中多个同名章时，生成期按 title 唯一映射失败（ref=nil）仍生成 title-only 候选，edit 采纳落入 title 回退 `ambiguous_chapter_title`。
- 修复：`TurnExecutionService.execute` 在 provider 调用前检测「ref=nil 且同标题章 >1」→ `MissingPolicyResult.ambiguous_chapter/1` hard block，作者可见澄清（用章卡片/章序号确认），零写入、不生成候选、不新建章；`blocked_message` 区分 ambiguous/not_found。B28 Q01「歧义不猜」落地；CP2 T0 期望按此修订（T0a 阻断澄清 + before/after 对照；T0b ref 绑定成功用主作品唯一标题候选）。
- 测试：domain `ambiguous_chapter/1`、resolver 同名两章 ref=nil、全后端 2113/0；compile/format/credo/enum/xref/arch 全绿。

### 7.6 CP2 完成记录（2026-10-25，`29f9a03d`）

- **真实 Tauri PASS**：`bash scripts/quality_accept.sh b28-whole-chapter-revision --surface tauri` → 35/35 checks、6 trials（T0a/T0b/T1/T2/T3/T4）、`log_noise.ok=true`、tauri 窗口；证据 `artifacts/slice-verify/b28-whole-chapter-revision-tauri/`（保护副本 `...-cp2-registered-pass-20261025T0400/`），历史失败批次全部保留。
- **实测**：T0a 同名两章 title-only → 澄清阻断、章数不变零写入；T0b 唯一标题候选顶层 `target_chapter_ref=chapter:<uuid>`、edit_then_accept 同章绑定；T1 整章只排版候选 3594 字符覆盖两片段、format_only/replace_scope、归一后字节等价、章数 2→2、旧 2 稿 superseded 历史、阅读/刷新新值；T2 只改二十五→三十其余逐字、同章不新建；T3 刷新/重复采纳幂等；T4 缺 ref 澄清、零写入、不路由新写作。
- **注册**：scenarios.yml（nightly/tauri）、manifest active、README、runner；`quality_manifest_check.sh` passed；回归 b25-chapter-identity-unification、judgment-explore-chapter-full-read、p1-chapter-adoption-reading、q1c-adopted-content-revision 全 PASS。
- **本轮修复的真实缺口**：同名章歧义守卫（`392c45e9`）、章级 execute 工具绑定（`83f1452a`）、replace_scope 后 coverage 语义（`b014c5db`）、判断/writer fixture（`09d477a1`/`1f2f8121`）；driver 仅证据解析/时序适配，未降级断言。
- **边界**：真实模型原话/改述与排版质量归 CP4；format_only violation 端到端负例由 CP1 单测 + CP4 覆盖（known_not_closed 已登记）。

### 7.7 CP3 完成记录（2026-10-25，`4d1cf3eb`）

- **真实 Tauri PASS**：`quality_accept b28-whole-chapter-revision --surface tauri` → 48/48 checks、10 trials（T0a/T0b/T1–T8）、log_noise ok；证据 `artifacts/slice-verify/b28-whole-chapter-revision-tauri/`（保护副本 `...-cp3-pass-final-20261025T0400/`、CP3 失败批次保留）。
- **消费面实测**：阅读投影正文 hash==新候选 DB accepted 全文（3593 字符）、有效字数 3127==正文；刷新/重进一致；当前 accepted 仅 1 条新整章稿（含三十岁、无二十五岁），旧 3 条（初稿/续写/T1 合并稿）全部 SUPERSEDED 且历史可查；摘要 2 条（maintenance ok×2），当前 ACCEPTED `revision_base=draft:3dc1fe35…` 指向新 draft、不引用旧源；真实主输入「三十岁」→prose_search 命中、「二十五岁」→未检索到，判断/post-explore prompt 含新整章正文、旧独特句不在当前上下文（pre-explore 会话历史旧正文已分级注明）；档案可见章身份、T1 候选可见目标/范围。
- **边界/known_not_closed**：无独立页面搜索入口（真实主输入+prose_search+DB 对账）；摘要失败诚实标记归 d3-summary 场景；档案不渲染摘要正文；真实模型/排版观感归 CP4；format_only violation 端到端负例由 CP1 单测+CP4。
- **回归**：p1/q1c 复用 CP2 PASS（其后产品/frontend 无变更）；B24/B25/judgment 已 CP2 PASS 且未被触及。
- manifest/README 已同步（48 checks、T5–T8 断言、边界），quality_manifest_check passed；未改产品代码。

### 7.8 CP4 真实模型验证记录（2026-10-25，`2095b9a3`）

- **环境**：HEAD `a64810e4`（CP3 `4d1cf3eb`；产品代码 `1f2f8121`）；Strata 单槽独占 `iq3_s`（preflight `/v1/models` 就绪、无其它 agent 调用）；窗口 03:45–04:20；预算 ≤2 phrasing×≤2 轮，实际 3 轮（original canonical + original retry1（provider invalid_response 允许重试）+ paraphrase canonical），无因结果重跑。
- **model_behavior（3/3 一致 PASS）**：原话「把第一章正文整理一下，只调整分段和排版，不要改字句。」与改述「第一章正文帮我统一下排版和分段，文字别动。」→ judgment `execute/revise_adopted_content`，reason 明确绑定 `chapter:<uuid>`（第01章：夜潮，2 片段、coverage complete）+ `modification_scope=format_only`；writer prompt 同时含两片段独有锚点、chapter ref/title、整章覆盖/format_only 证据。
- **writer 生成系统性失败（known-gap）**：provider 259–271s 后 `invalid_response`「Strata 响应内容退化（低信息熵重复）」→ `prose_writing` provider_error → run failed；无候选。original 两轮复现→系统性模型/provider 退化（非瞬时）；paraphrase 未再重试（预算诚实）。
- **product_state_chain**：无候选→无采纳、零写入；章数/章身份/旧 accepted refs/内容字符与 baseline 完全一致；作者可见诚实失败文案「修订未能生成有效的新稿…本次没有改变原稿或写入作品事实」。CP4 正例候选契约/归一等价/replace_scope 与 `format_only_violation` 负例未被真实模型触发，依赖 writer 生产端修复后回归（known-gap 2）。
- **证据**：`artifacts/slice-verify/b28-whole-chapter-revision-tauri-strata-cp4-{original,original-retry1,paraphrase}/`（ui-frames/app-log/llm-calls raw/截图/`b28-cp4-strata-evidence.json`）；汇总 `artifacts/slice-verify/b28-cp4-strata-validation-20261025-042020/`（report.md/summary.json/console/preflight/driver.patch）。CP4 run 不产出 CP2/CP3 场景 checks（runner exit 1 属预期），不以 runner PASS 代替语义结论；未注册新场景。
- **边界**：未改产品/frontend/src/tasks/cases/snapshots；未调提示词/未放宽守卫/未重跑换分；Strata 槽已释放、无残留。

### 7.9 CP5 收口记录（2026-10-25）

- **门禁**：compile -Werror、**2122 tests/0**（common 96/domain 378/agent 265/persistence 306/application 884/web 133）、test -Werror、repo format、credo strict 0、enum/xref/arch/adr；前端 typecheck/lint/**603 tests**、frontend_audit、check_design_trace；quality_manifest_check；**I1/I2/I3 全 PASS**。
- **真实页面**：`b28-whole-chapter-revision` 注册 nightly，canonical PASS **48/48 checks/10 trials**（CP0 复现批次与 CP2/CP3 失败批次全保留）。
- **台账/排期**：本 slice CP0–CP5 记录、slices README、NEXT→B30、project-ledger 已更新；B27 M07 known-gap 按 B28 format_only 机制落地更新（机制+确定性场景关闭，真实模型语义受 strata known-gap 限制，不宣称模型已通过）。
- **未授权项（如实单列）**：stage 存量数据（ch1 两份 accepted + ch17 新章）保持只读清单 `stage-impact.md`，不删除/不合并/不写数据；实际修复需作者单独授权（备份+sha256、replace_scope 目标 ch1、ch17 保留历史）。
- **known limits**：① CP4 writer 生产端 known-gap（strata/iq3_s 长整章生成退化）→ 正例候选契约/format_only_violation 负例待修复后回归；② 无独立页面搜索入口（prose_search 工具链+DB 对账）；摘要失败机制归 d3；档案不渲染摘要；③ CP4 证据为非注册 harness 分支（env 门控），真实模型语义不进入 nightly 判定。

### 2026-10-25 完成审计与原生补验

当前只重开原生交互证明，未回滚已验证的实现或浏览器结果。证据对账与作者裁决见 [既有对账任务](VS00D-G-GAP-RECONCILIATION.md) 的队列完成审计；机器证据 `artifacts/completion-audit/20261025-1817/surface-audit.json`。后续复用本 slice 原验收矩阵，以外部系统 UI 驱动真实窗口，保留源操作/WS/持久状态和截图；原批次只读，不修改判据。

### 原生补验CP0与首批预注册（2026-10-25 21:00）

- 已核对项目愿景、原任务§7、quality B28矩阵及现有driver的48个checks/10个trial；此次补证不修改原接受范围，旧浏览器/实模结果与writer known-gap保留。
- Contract/Invariant：消费原chapter_ref、覆盖账、replace_scope及冻结format_only归一；同章身份/章数不变，未采纳零写入，完整替换与旧稿历史保留。
- Boundary/Consumer：新增外部原生证据适配，复用已有seed/原输入/合成正文；产品frontend/src与apps/lib默认不改。真实消费者仍为工作台、阅读投影、摘要及下一轮prose_search。
- Proof：native脚本只读核验UI发送帧、候选与采纳回执、独立DB/投影/模型材料；48项原检查逐项有对应证据，不能仅输出成功标记。浏览器与原生共用原正文fixture和归一算法，避免复制成另一口径。
- Acceptance Driver：CUA操作真实Tauri菜单/档案/生成草稿/修改后保存/修订采纳/阅读/重开/检索；确定性provider，真实模型0。只有章节计划与同名干扰章沿原seed，accepted正文必须真实UI编辑采纳。原生调用不新增产品验收钩子。
- Exploration：采纳后chapter_ref下当前正文由阅读、摘要、prose_search及判断上下文同批消费；本次需要原生采纳后的实证，不凭旧结果外推。
- 单批目录 `artifacts/slice-verify/b28-native-20261025-a1/`；开始前完成适配的语法/检查器验证。复用B37 detached、10秒心跳及input/ack30、turn/candidate120、adoption90、maintenance180、restore30、idle120秒；任一步异常即时保留首因并停止，不重复发送刷结果。同因两次失败按作者规则升级。
- 负例中的同名/缺目标澄清是冻结验收终点，不自动回答改变其零写入前提。正常流程若另有问题，按原预算源绑定应答最多2次；重复/空问题立即失败。作者手动模型保持，不加载/卸载；不改stage历史数据。

#### 启动前发现B36契约覆盖冲突（2026-10-25 21:08）

- 首批尚未启动；48项适配未获得最终启用判定。源码核对发现：旧T2要求整章候选含两段且按replace_scope采纳；B36已冻结target_segments只产目标段replacement并确定性apply，现生产输出replace_segments。直接沿旧候选全文断言会与已接受设计冲突。
- 另有真实能力疑点：`target_ids_from_author_text`仅解析开头/第一段/第N段/结尾，原T2“二十五岁改成三十岁”未提供段号，可能产生空target_segment_ids；现有wiring测试只验证候选及validate_b28_contract，没有采纳事务证明。此处尚属源码定位，下一步独立离线CP0验证，不称已复现页面失败。
- 已按愿景先判断：保留作者原话和最终全文仅年龄变化/其余字节不变/同章/历史/消费断言，采用B36目标段+锚点/版本检查，补齐原话定位，不回退确定性保护。因涉及候选验收判据变化，依作者升级规则提请裁决；待决期间不启动A1、不改生产目标解析、不修改旧T2断言。

- 离线CP0预注册：仅一次原T2输入→PendingArtifactWorkflow→AdoptionRepository链路，复用现有B28测试的合成双片段和Sandbox事务；slice_verify真实模型0。证据 `artifacts/slice-verify/b28-native-preflight-20261025/`；只检查候选effect/目标段及持久化结果，不改产品/断言，不作为原生证明。

- 作者已接受（2026-10-25）：“按B36对齐候选检查，保留原话与全部最终断言”。T2仍用原输入，候选验目标段原始输出、segment_id/hash/base版本；采纳后完整正文精确等于原全文仅二十五岁→三十岁的结果，其余字节/章身份/历史/阅读摘要检索断言不减。旧全文候选判据仅保留为历史，不回退B36。
- 离线CP0已证实：候选effect=replace_segments但target_segment_ids/hash均空；替身仍返回完整两段；validate_b28_contract返回ok，真实持久化返回 `segment_mismatch`，旧drafts逐字/状态/版本不变。probe退出1源于预期错误码写成incomplete_scope而实际为segment_mismatch；原report/log不修改、不重跑。此为应用/持久化局部证据，不是原生页面失败。
- 实现设计：在writer调用前一次性解析目标；保留段序号定位，新增作者明确字词替换的精确源文本匹配。源文本必须仅出现一次且落在唯一段，缺失/重复或范围冲突有界拒绝、零候选/零写入；不根据近似后缀猜目标。将同一目标段id/hash/原文字节交给writer和候选payload；writer只产目标段，持久化继续由既有replace_segments确定性合并。test-support按同一真实目标材料生成替身输出；不放宽采纳校验、不服务端修补模型正文。
- Boundary/Proof补充：生产只改application PendingArtifactWorkflow的范围解析与writer材料，复用persistence分段/事务（不改其守卫）；agent仅test/support适配。先原T2正例与缺失/重复负例red，再green与实际采纳全章字节/历史检查；最后一次scoped原生复验，预算沿前述注册。

- 实现首轮回归：原T2与缺失/重复/冲突负例先red，修复后agent53+application9=62/0；原话目标唯一命中→目标段原样候选→真实replace_segments事务，最终全章仅指定年龄变化、旧两稿SUPERSEDED、章数不变。额外第0/99段不得被文字命中绕过，正在回归。B28外部矩阵保留48检查：content候选检查改为目标段绑定，阅读T2检查改为采纳后完整正文；其他48项意图/最终约束不减。

- A1启动条件已满足：作者判据裁决已落实；后端2248/0、前端614/0、Credo0、xref/arch/I1–I3通过；证据校验器3组边界测试通过。保留48检查总数，T2按目标段锚点/版本+最终全文对账；原生批次只检验测量期间生产源码指纹不变，不再错误宣称本轮未修产品。首批预算/目录仍按21:00预注册，仅一次。

#### A1原生部分证据与只读收束失败（2026-10-25 21:38）

- A1已停止并保留：T0同名澄清零候选；原生编辑采纳2517+1075两段；T1排版采纳后旧两稿SUPERSEDED/current3594字符/章数2；T2原输入→目标段候选→replace_segments后current3593字符，全文精确等于仅二十五岁→三十岁，旧3稿历史保留；重开后阅读3127有效字一致，无重复采纳入口。
- T7新旧查询均正确检索当前正文（新值命中/旧值未命中），但随后都额外execute/prose_writing，生成了未请求候选。两份额外候选未采纳；A1因同类异常两次保留failure并停止，EXIT/1；独立DB/profile/截图/网络日志保留，未运行T8档案及T4缺目标，未写summary通过。目录 `artifacts/slice-verify/b28-native-20261025-a1/`。
- 另一观察：目标段候选标题仍显示整章内容修订稿，范围文案需对齐；阅读投影旧标记在重开后清除，内容hash与当前稿仍需最终独立对账，不能仅用UI字数判完成。
- 只读定位：实际judge日志为explore→execute/prose_writing；替身regular_judgment_result同调用构造叙事和动作，但动作选择仍以prompt包含“依据如下”这个旧两调用回声作为reply条件，第二判只有“探索观察”，因此返回引用叙事同时误带写作动作。先做test/support红绿及原prompt重放，不据此修改生产策略/推断真实模型缺陷。
- 后续范围：修复替身读取观察后的只读收束，保留明确写作请求正例；目标段标题按现有B36范围对齐。A1失败批只读；新的原生复验需明确scoped预算，不擅自整批重跑。

- 2026-10-25 21:49修复：替身只读收束测试red复现execute/prose_writing，修复后55/0（包括明确要求取证后写作的正例）。另以A1两条原观察prompt做一次离线文本重放，真实模型0，证据 `b28-native-repair-20261025/readonly-actual-*`。
- 标题修复设计依据：已读42-card-system §3/§4和47-ui-copy §2.3，已查看索引确认的Pencil静态导出 `exports/png/PZAVY.png`（42§4-adoption-card-states）；Pencil实时连接transport closed、编辑器空白，不虚称看到IIPsi最新画布。此次只修后端第3层系统事实标题，使target_segments显示“指定段落修订稿”；不改前端布局/按钮/交互/动作，模型原始正文不改字节。

#### A2 scoped原生复验预注册（作者已授权）

- 授权：“授权一次scoped原生复验”。仅一次，真实模型0，沿原分型预算与10秒心跳；任何同类失败立即保留并停止，不扩大预算。
- 目录 `artifacts/slice-verify/b28-native-20261025-a2/`；源为A1的 `database-before-failure-close.sqlite3`，复制到新的独立DB，启动不reset/不重新seed。源/副本初始sha256一致，原库前后sha不变；没有对A1或stage存量写入。
- 测量：T7两条原输入重放（必须explore→reply、无新候选/无写入）；T4原缺目标请求与T8真实档案入口补齐；范围标题用反向年龄请求只生成未采纳候选（验证指定段落标题），不采纳/不丢弃，当前canon保持三十岁全文不变。
- 证据拼接边界：A1失败状态保留，继承T0/T1/T2数据/T3/T5/T6原生证据；A2只提供T2标题/T4/T7/T8。校验460个生产源码指纹，只允许相对A1新增系统标题分支，其他生产字节一致；每项来源在summary列明，不冒充A2重新执行全矩阵。
- A1部分证据离线对账已通过：format/content共22项target/scope/effect/covered/version/base/完整性/字节变化/身份/历史/当前稿均真，两个采纳source_turn与候选一致，原阅读投影回执8条；见 `b28-native-repair-20261025/parent-data-audit.json`。

预注册记录时间：2026-10-25T14:03:39.330216+00:00。

#### 验收重心校正（2026-10-25，作者反馈）

- 作者指出“验证场景不让模型真实参与没有意义”。已接受其对核心业务验收的判断：确定性替身只能证明绑定/版本/范围/事务等工程规则，不能替代创作伙伴的意图理解、能力选择、必要提问、生成及纠错能力。停止继续扩展替身主验收；下一步固定真实模型/输入/预算，以原生入口走完整任务，失败如实记录，沿既有B27不再全量retest的边界做B28 scoped案例。
- A2实际进展：两条原T7输入已原生explore→引用答复，未新增候选；新范围标题已原生显示“指定段落修订稿”；T8档案显示同章3127有效字。T4尚未执行、独立汇总尚未完成，不能写整批PASS。讨论验收方向期间driver_idle_timeout到期，监督EXIT/1，窗口已关闭；此为交互中断，不算又一次产品失败或重试。原failure未覆盖。
- 中止后只读快照/窗口/profile另存 `artifacts/slice-verify/b28-native-repair-20261025/post-A2-switch/`，不混作批次完成证据；A1/A2保留。下一真实模型验证沿原自然输入及数据完整性要求，不要求模型复制替身预设调用路线。
- 工程节奏调整：已有授权内的定位/替身修复/限定复验由AI推进；同一批中多个样例暴露同一问题，不机械等同于多次失败重试。中途定向回归、稳定后统一全门禁；真正的契约取舍、作者创作裁决、破坏性数据变更与实际重试预算耗尽再升级。

#### R1真实模型原生局部修订预注册

- 范围：只验证本轮新修复的字词定位/目标段生成/真实采纳/阅读与后续查询；保留原T2“把已保存的第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。”。整章format_only原实模失败未修，不重复刷该批，不据此标B28整项完成。
- 前提：复制A1已由真实UI建立的测试库；目前canon为三十岁。先经真实模型+原生UI提出“三十岁改成二十五岁”并审阅采纳，恢复原T2前提；这是独立测试准备输入，不修改源库、不手工改canon。然后只发一次原T2请求。若准备无法完成，终止本批，不能绕过。
- 后续：真实模型接受原T2→自行选能力/必要追问→目标段候选→原生采纳→全文精确仅年龄变化/其它字节不变→阅读及两条原查询（新值命中、旧值未命中且无多余写作）。不预设模型内部调用顺序，不改模型回答来过断言。
- 模型与参数：使用作者现有Strata实例iq3_s（Qwen3.8-Flash-Next IQ3_S），endpoint=127.0.0.1:47831/v1，thinking disabled，max_tokens=4096；具体各purpose参数及实际HTTP请求以日志为证，不与旧format_only延迟作跨条件比较。真实初始输入至多4条（准备1、原T2 1、查询2），每run问题回复≤2条不同具体回复，单槽串行；本批失败不自动重跑。
- 预算：复用B37实测input120/turn360/candidate300/adoption180/maintenance300秒，ack30/restore30/export60秒，10秒心跳；超时不重发。证据 `artifacts/slice-verify/b28-real-native-20261025-r1/`。本轮是有独立结论的real-model scoped证据，不调用确定性48项汇总来冒充实模结案。
- 资源：加载前记录现有模型/内存；不新增模型加载，保留作者手动实例，结束仅回收本批进程。使用者所有权与早先全局清空要求的后续澄清一致，不谎称LM/Strata全局空。
注册时间：2026-10-25T14:19:22.083460+00:00。

#### R1真实失败与能力说明同步（2026-10-25）

- R1：原生Strata iq3_s，真实HTTP两调用8.1s/7.3s，temperature0.2/max_tokens4096/reasoning_effort none/tool_choice auto。准备输入“三十岁改成二十五岁”进入prose_search；第二判已收到命中第一章的原文片段，仍重复同工具同query，触发no_progress。无明确作者问题、无候选、无采纳、draft行逐字段不变，原T2未开始。批次EXIT/1，进程端口已清理，作者实例idle/queued0保留。
- 证据：`b28-real-native-20261025-r1/run/`保存原生AX/截图/完整请求响应；有界两请求分析与canon对照在 `b28-native-repair-20261025/real-r1-audit/`。R1失败不覆盖，不使用替身复演来替代真实失败。
- 已确认的说明缺口：现operation目录仍只有“修订产候选”通用描述，未公开已实现的精确文字唯一匹配/目标段替换/原范围保护；判断规则还声称排版能力属于未来B28任务。模型重复查询是实测事实；补齐说明是否足以消除停滞仍须R2实测，不预断因果。
- Contract/Invariant：B27统一任务输入消费B28/B36现有执行契约；能力说明必须与真实处理能力一致，作者原话/章ref/范围/采纳边界不变，不为该样例预定工具调用。Boundary：仅application AuthoringTaskPolicy及测试，不改runtime/Provider/采纳守卫/搜索结果。Consumer：JudgmentProtocol与计划的operation目录。Proof：策略渲染局部回归＋相同模型/参数/原输入原生复验。Acceptance Driver：既有CUA/代理/真实HTTP日志；产品验收感知逻辑no。Exploration：把已实现的文字定位能力同步到当前判断可见目录，chapter_read/prose_search仍由模型选择；不新增要素数据或工具schema。

#### R2修复后真实模型scoped复验预注册

- 仅一次R1同输入/同模型/同参数复验；修复内容仅把实际已实现的文字定位、目标段合并和排版守卫同步到当前能力说明，未改工具schema、runtime路由或通过判据。仍允许模型自主选取证/执行/具体追问。
- 数据源仍是A1测试库备份副本，真实模型只借用其canon基线，不继承替身业务结论；先真实模型执行“三十岁→二十五岁”并原生采纳，再执行原T2“二十五岁→三十岁”，最后查询。所有新请求均从UI进入，不改返回内容。模型iq3_s/temperature0.2/max_tokens4096/reasoning_effort none保持；等待/作者回复预算沿R1。再次同因失败停止，保留R1/R2，不自动重跑。
- 证据 `artifacts/slice-verify/b28-real-native-20261025-r2/`；原生代码指纹含AuthoringTaskPolicy。R2结束后按实际结果决定后续，不先声明修复成功。
注册时间：2026-10-25T14:26:19.507456+00:00。

#### R2发现范围授权来源缺陷（真实模型）

- R2跨过R1停滞：模型自行prose_search→execute/revise_adopted_content（7.8s/8.3s），writer真实生成25.2s。模型dialogue_goal明确“指定片段替换，非整章重写”。应用把author_text与dialogue_goal拼接后按“整章”关键字判whole_chapter，导致请求writer全文重写，候选3421字符而预期3594字符（少173字符），未采纳，原正文保留。
- CP0证据 `b28-real-native-20261025-r2/run/candidate-audit.json`、原HTTP请求响应、原生候选截图；结果为failed_application_scope_expansion，不能归结为模型不懂局部任务。R1能力目录修改已在本次被实际消费，scope错误是下一条独立失败类型。
- 修复契约：修改范围属于作者授权；模型dialogue_goal是解释材料，不能扩大或缩小作者范围。以当前run的作者goal原话决定format_only/target_segments/whole_chapter，目标定位/版本/原文hash/采纳完整性沿既有守卫。无schema/ADR/通过标准变化。
- Boundary/Consumer：仅application PendingArtifactWorkflow的范围来源；真实Judgment→writer→候选首先消费。Proof：用本次模型“非整章”原文和主动扩大范围反例做red→green，保留作者明确整章正例；后续一次同条件原生scoped复验。Acceptance Driver仍CUA，真实模型自行判断；无新增验收感知逻辑。Exploration不产生新元素，现有目录/事实源继续可达。
记录时间：2026-10-25T14:32:46.191637+00:00。

- 范围来源回归：真实“非整章”解释及主动扩大解释两项在修复前失败，移除模型说明对scope的决定权后通过；作者明确整章正例保持。后续writer材料仍包含模型解释供参考，但授权scope只消费作者goal原话。
#### R3作者范围修复后原生scoped复验预注册
- 一次R2范围来源缺陷修复后的同条件复验，目录 `artifacts/slice-verify/b28-real-native-20261025-r3/`；模型/参数/输入/等待预算/作者应答与R2相同。R1停滞已在R2跨过，R3只验证新的范围授权缺陷修复及其后果；保留全部失败，不做语义换分。真实模型继续自行取证/执行/提问。若该批失败，不自动再启下一批。
注册时间：2026-10-25T14:34:18.643981+00:00。

#### R3驱动日志误绑定与不重生成恢复
- R3真实判断execute、writer生成指定段落候选，已在原生窗口可见正确年龄与范围，尚未采纳。随后发现CUA跨调用辅助闭包保留R1目录：R2/R3等待指令误追加到R1，R3监督仍处在prepare maintenance计时，因而到期退出。该错误属于驱动，不是模型失败。R2产品范围缺陷有独立HTTP/TurnResult证据，但其failure.json曾被稍后的产品诊断覆盖；wait-stats维护了原maintenance_timeout，不能声称其计时完全正常。
- 完整污染审计在 `b28-native-repair-20261025/real-r3-driver-audit/journal-routing-audit.json`；不回填或伪造先前计时。原HTTP/网络帧和DB保持，canon逐字段未变。后续CUA等待函数使用显式目录/等待ID参数，不再复用捕获旧批次变量的闭包。
- 恢复目录 `artifacts/slice-verify/b28-real-native-20261025-r3-resume/`，只读SQLite backup复制已终止R3库（保留WAL一致快照与已有模型候选），启动不reset/不重生成。继续已有候选审阅/采纳，再发原T2及查询。仍是R3当前复验的生命周期恢复，不增加一次模型重试；模型/参数/剩余输入预算不变。源库前后hash与canonical快照可核对，实际copy哈希单列（SQLite backup页头可能不同）。

#### 真实模型局部修订与消费已取得证据（R3＋恢复批）

- `b28-real-native-20261025-r3-resume/run/real-model-proof.json`：20项事实对账全部通过，10次新增HTTP调用全部Strata/iq3_s。R3真实模型先生成三十→二十五目标段，恢复其既有候选后原生采纳；再由真实模型执行**原始T2输入**二十五→三十，原生采纳后全文精确只变该处，其他字节/章ID/章数不变；当前1份ACCEPTED，旧版本保留，摘要revision_base指向当前稿。
- 后续两条原查询均真实prose_search→reply：新值命中、旧值未命中，零新候选/零canon写入；重开后阅读仍3127有效字、投影全文等于当前canon。无作者追问，author_question_events=[]。没有回填模型正文、没有为通过改用替身。
- 证据边界：HTTP streaming日志只记录event_stream标记，另有真实ProviderRun/用量/候选/采纳/DB/原生截图；不声称可从该HTTP日志离线重建全部SSE字节。文学质量、所有自然表达和整章format_only均不由此代签。
- 监督实态：恢复批UI测量的13个等待均已完成，模型/采纳/恢复均未触发对应等待超时；随后离线分析期间driver_idle_timeout自动清理，实际EXIT/1而非原计划stop。源failure与退出记录保留；`scoped-case-finished.json`是稍后的测量结论，不能替换实际退出原因。测试端口已释放。后续在最后一个UI动作后立即停止本批服务，再离线分析，不增加新的等待层。

#### 整章排版的契约差异与待裁决方案

**当前事实**：任务目标包含“只调整分段和排版，不要改字句”，但§7.2 Q03冻结归一只忽略行尾空白、换行形式和文末空行。纯函数实证：原文“第一句。第二句。”保持原样通过；仅插入段落换行“第一句。\n\n第二句。”返回format_only_violation。证据 `b28-native-repair-20261025/real-closeout/format-contract-probe.log`。因此旧确定性T1把全文原样返回能过，却不能证明真正完成重新分段；整章排版不能按旧结论关闭。

**推荐方案：模型提出换行计划，算法应用到原文。**
1. 原文以chapter_ref、完整基线版本及source_hash绑定；提供机器生成的合法换行边界标识和对应原文片段，模型选择在哪些边界分段，不让模型重新复制整章。
2. 允许的效果仅为插入/移除段落换行、统一换行形式；所有非换行字节（含标点、空格、文字）必须逐字保留。未知边界/过期基线/非换行修改均零写入拒绝。
3. 模型原始计划和理由保留因果来源；预览明确标为从原文与计划计算的排版结果。作者审阅并采纳后才应用，章身份不变、旧稿历史保留、阅读/摘要/检索同批更新。
4. 沿现有B36的“模型提议＋确定性apply＋receipt”边界落地；不放宽或豁免I1/I2/I3。设计阶段明确模型计划与机器投影的契约/来源，再按既有schema/ADR流程实现；不把机器计算文本伪装成模型原文。
5. 真模型验收必须实际改变至少一处分段，同时所有非换行字节严格相同；仅原样返回不算成功。使用原B28自然输入，不给模型预设分段答案。

**较小改动方案**：仍要求模型返回整章候选，仅把格式守卫改为允许换行差异、保留全部非换行字节。优点是沿用当前输出形态；缺点是仍依赖模型逐字复制长正文，R2已实测出现漏字，难以稳定完成长章排版。

以上是待裁决提案，尚未修改Q03、schema、排版守卫或排版验收判据。推荐首方案，理由是满足真实作者的分段目标，同时把字句保真交给算法，避免继续把“没损坏”当成“排版已完成”。
记录时间：2026-10-25T15:23:04.461304+00:00。

#### 格式计划实施契约（作者已接受）
- 作者选择“模型换行计划＋确定性应用”，冻结决策落[ADR-0029](../../docs/design/adr/ADR-0029-prose-formatting-plan-v3.md)。新artifact_type=prose_formatting_plan，模型item原文与line_break_changes保留；formatting_preview为机器投影，不能改写item.body。ui_card仍candidate_set。
- Contract：VS-02A/VS-04及ADR-0029；Invariant：所有非换行字节一致、源hash/全部版本/同章、tentative-first与原始模型字段因果绑定。Boundary：domain纯算法、common/agent输出契约、application源材料/预览、persistence原子apply、frontend既有卡片消费；不新增生产验收开关/新Channel事件/依赖。
- Consumer：原生“只调整分段和排版”→真实判断/格式计划→作者预览采纳→阅读/摘要/检索。Proof：算法属性/非法操作/stale/回滚、模型字段保真、真实模型实际新增分段的原生链、全门禁/I1–I3。Driver：现有detached＋CUA实际入口，真实模型自主选边界，不预设答案。Exploration：当前正文与版本沿chapter_read/prose_search/摘要继续可达，源边界视图与模型计划同批提供给格式执行者。
- 先完成完整链路再结案；当前域算法只是实现checkpoint，不替代计划/预览/采纳/实模验收。旧Q03仅保留对旧全文候选的兼容约束，新计划按ADR-0029保真规则验收。


#### ADR-0029实现与原生实模预注册（2026-10-26）
- 完成计划类型/Provider字段保真、合法边界视图、独立预览、accept/discard、对话调整计划、同章事务重算与摘要完整章来源。后端2261项、前端615项、typecheck/lint通过；全扫描与真实原生链待验证。证据目录 `artifacts/slice-verify/b28-format-plan-20261026/checks/`。
- 计划R1：使用已终止R3-resume隔离库的一致备份，只继承数据，不继承其验收结论。真实Strata iq3_s、max_tokens4096/thinking disabled，单槽串行，保留作者手动实例；不加载/卸载模型，不用替身产业务结果。
- 原输入一次：把已保存的第一章正文整理修订一下，只调整分段和排版，不要改字句。模型自行选择边界；没有候选不得重发，最多2次来源明确的作者问题回复。同因失败总预算2，失败记录保留。
- 判据：真实Tauri输入/候选/采纳/阅读/重开；模型说明字段不被计算正文覆盖；至少新增一个段落边界；预览与采纳全文所有非CR/LF字节逐字相等；章身份/章数、历史、当前唯一稿、摘要revision_base、读取投影一致。另补真实新会话/空作品缺目标请求，最多1次原输入，零canon写入。T2既有实模结果不重复跑。
- 等待沿现native_ui_wait：input120/turn360/candidate300/adoption180/maintenance300/restore30秒，10秒心跳；最后UI动作后立即停止测试服务再离线对账。原生运行目录 `artifacts/slice-verify/b28-format-native-20261026-r1/`，不写旧失败批次。

- R1实模失败：原输入只提交一次，判断正确绑定chapter/format_only，writer HTTP200/3655tokens/8660字符后被Provider全局低多样性守卫拒绝（38.8s），无候选；DB全量draft行与R3-resume源一致。监督读取external failure及时清理，EXIT1；原首因与截图保留。
- CP0产品缺陷：Provider.degenerate_content?使用全文unique/length；合法90边界JSON的旧判定值0.0141486 < 0.05，旧算法拒绝、新算法接受（entropy-comparison.log；最初测试的长度断言错误记录保留，不作为误判证据）。修复为固定256字符窗口检测短周期重复，保留原单字符/AB重复拒绝，不对JSON、供应商或slice开豁免。原始SSE未留全文，R1不能断言其余字段有效。格式/版本/原子采纳不变量保持。
- R2 scoped复验：针对上述产品修复，用R1已终止库副本（canon未变），原输入和分型预算不变；本失败类型剩余一次实模复验，若仍失败保留已查根因与原始失败后升级，不以替身顶替。

- R2原话已产有效实模方案：守卫修复后计划进入真实预览，所有非换行字节不变，实际取消了部分重复段之间的换行；没有新增段落边界。因此“实际调整”成立，但本次预注册的新增分段子判据未过，不能删去该事实或算全部通过。保留原候选不采纳。
- 按CP4改述与ADR-0029对话调整计划继续一个子场景（只一次、无重试）：输入“调整这份分段方案：把后半章连在一起的正文按情节节奏分成几段，只调整分段和排版，别改字句。”模型仍自主选边界；检查生成新独立计划、原计划保留、至少新增边界、字节保真后再采纳。此处验证作者调整能力，不把原话结果改写为成功新增分段。

- R2结果：原话与追加调整均真实Strata调用，得到两个独立计划但预览完全相同；均非换行字节保真、零canon写入，新增分段未通过。结果见 `b28-format-plan-20261026/checks/native-preview-proof.json`，原生截图/网络/模型记录在R2/run。没有采纳不符合拆分目标的方案，未将预览成功算成完整B28。
- 产品修复：调整原计划时，把旧计划明确标为历史材料；在新候选生成前比较计算后的实际预览，仅标题/说明变化或预览完全相同返回no_formatting_changes。14项章级接线测试通过，包含真实不同计划可生成、原计划保留、canon不变；该补充修复尚无实模验证。
- 资源：两批监督均按首因failure退出；失败目录不改写，测试实例停止，作者手动模型保留。后续原生复验需要新增预算：聚焦一次自然对话调整→真实新增分段→采纳/读取/重开；成功后补缺目标。不得重跑原T2或B27全量换分。
- 剩余工程项：旧全矩阵driver的format_only全文候选断言尚需迁移到计划/预览；实模新增分段、排版采纳后的阅读/摘要/检索/恢复、T4缺目标仍不能结案。新的门禁清单只证明代码与已测原生预览，不代表队列清空。

- 调整材料同时纠正：实模复制了旧方案的说明、理由与全部92条换行选择。调整任务只传旧方案的结构化换行选择，不再把旧“合段”说明/理由混入新的“拆段”任务；明确最终计划仍基于canon，不是差量。原模型字段继续保留于原候选与trace。本轮不宣称此语义整理已经解决模型执行能力，仍需获预算后的真实验证。

- 本批检查点：后端2264/0、前端615/0、typecheck/lint通过；`CARGO_NET_OFFLINE=true pnpm tauri build`生成.app与.dmg（保留既有identifier/chunk-size/未公证提示，不改冻结配置）。统一扫描命令`bash scripts/ai_static_scan.sh --top 10`已修复本次fixture复杂度与过期manifest，剩余Top项仅Pencil fileToken误报、ProjectGod历史凭据接受风险；compile/xref/arch/I1–I3/N-NARR/I-CACHE/前端audit/design trace/task_done/NEXT均验证。最终证据目录 `artifacts/slice-verify/b28-format-plan-20261026/checks/`，清单明确native_business_complete=false/slice_complete=false。未提交或推送。


#### R3授权后的单次scoped原生复验（2026-10-26）
- 作者明确授权一次scoped原生复验。来源为已终止R2隔离库，旧库只读保留；目录 `artifacts/slice-verify/b28-format-native-20261026-r3/`。
- 只提交一次调整原话：“调整这份分段方案：把后半章连在一起的正文按情节节奏分成几段，只调整分段和排版，别改字句。”若模型明确询问目标，回复最近那份“按情节节奏分段”方案；最多2次来源明确的作者问题回答，不重发原请求。
- 模型自主选择合法边界；至少新增一处段落边界、与R2旧预览不同，且非CR/LF字节完整相等，才点击对应新方案采纳。之后核对同章/唯一当前稿/旧稿历史、摘要revision_base、阅读和重开。任一失败保留首因、停止，不再调用模型重试；不推进B28完成、不销B27 known-gap。
- Strata现有iq3_s，max_tokens4096/thinking disabled，单槽串行；原等待预算不变（input120/turn360/candidate300/adoption180/maintenance300/restore30秒）。本次不装载/卸载作者实例；最后UI动作后立即停止本批服务。


#### R3单次授权复验结果（2026-10-26）
- **本次scope通过，B28整体仍doing。** 外部CUA原生入口只发送一次调整请求，真实Strata iq3_s调用3次（judgment 12.491s、格式writer 42.785s、完整章summary 6.477s），没有重试或作者追问。模型绑定最近R2计划，生成新候选`as_mvo26rab_2q3`，24项对账通过；证据 `artifacts/slice-verify/b28-format-native-20261026-r3/run/real-model-proof.json`。
- 实际新增30处单换行，阅读消费者75→105段；所有非CR/LF字节严格相同，预览与R2不同。初次只读probe误将“新增段落”写成“必须新增空行”；`ReadingMode.tsx:419`原有实现按单换行渲染独立段落，故以实际消费者验证。原`r3-candidate-check.json`（新增空行0）及`r3-reading-boundary-check.json`均保留，不改模型输出、不改产品或既有换行契约。
- 原生仅采纳这份新计划一次：同chapter_id/章数/seq，唯一新ACCEPTED draft版本17，原v14内容原样保留为SUPERSEDED。canon精确等于预览；摘要收到完整排版后正文，revision_base指向v17。所有阅读响应全文等于canon，有效字3127不变；原生关闭/重开后再读仍105段，未产生重复写入。模型item说明与计算预览保持分离。
- 观察到的未闭环显示问题：采纳后阅读提示“投影已过期”，点击刷新后仍保留，重开后消失；实际读取始终为新稿。阅读还显示仅剩历史稿的空scene提示。登记为本任务后续CP0展示/投影状态核对，不把数据正确外推界面全部正确。
- 本批8个分型等待全部结束、0超时，无failure.json；最后UI动作后stop，TERM/143。重开产生的launchd归属原生PID未随原detached树退出，核对完整本批可执行路径后单独TERM，115ms退出；该监督缺口已转B37，不能宣称自动清理完全通过。作者Strata与LM embedding实例保留空闲，测试端口清空。
- 本轮只验证与归档，生产源码hash与启动快照完全一致；沿用上一检查点后端2264/前端615/I1–I3/全静态扫描/Tauri构建结果，不重复全套刷验。未执行T4缺目标、排版后额外检索或旧全矩阵driver，未推进B30或标整个goal完成。


#### 阅读刷新CP0与实施边界（2026-10-26）
- R3真实点击刷新后没有刷新请求；源码证实App保留隐藏WorkspaceChat常驻，ReadingMode只写pendingBuildAction，消费effect未订阅该值且不以其为依赖。读取目录/章节成功也未清除global STALE；局部章节读取失败被catch吞掉。
- 消费既有ADR-0016/44§3–4：hint只刷新read model，不调用模型或production write。用已锁定TanStack Query统一目录+当前正文读取；hint失效对应work查询，整组成功/失败决定FRESH/FAILED，刷新/重试只重读。删除pendingBuildAction自然语言转发，不增加后端事件/schema/能力。
- 首消费者ReadingMode；不物化创作要素，探索面不变。查询刷新/整组失败与真实原生采纳→阅读取证，产品验收感知no。空历史scene不进入成品阅读，未成章仍提示待补足。

- driver迁移：原生/浏览器证据消费者按prose_formatting_plan取独立preview，保留模型items；验证source/preview hash、计划绑定、非换行字节等价及实际新段落。仅原样返回、只增首尾空行、改字、错类型/计划均不通过。采纳入口改为可见“应用分段方案”；内容修订仍精确目标段＋最终全文逐字。旧归一函数仅供legacy兼容测试。尚未将局部测试当作全矩阵运行。

#### 阅读/缺目标与监督收尾复验预注册
- 范围：一次R4 scoped原生运行，复用已终止R2真实模型候选的隔离副本。采纳其最近待采纳计划仅验证读取刷新（不重跑创作生成、不替代R3新增分段证明）；阅读应自动读取新canon并显示FRESH，不出现空历史scene提示。关闭/重开后读数与canon不变；测试结束自动清理重开的本批.app进程。
- T4：切换到既有空作品，原请求“把已保存的第一章正文整理修订一下，只调整分段和排版，不要改字句。”只提交一次。真实模型回复必须澄清/拒绝，无正文候选与写入；若有来源明确的作者问题，最多2次回答，按当前事实明确“目前没有正文，暂不创作新正文”。不得取消或重发原请求。
- 真实模型沿既有Strata iq3_s、单槽串行、max4096/thinking disabled；最多1次采纳后摘要与T4一个输入的判断链，不重试。input120/turn360/candidate300/adoption180/maintenance300/restore30秒及10秒心跳不变。新证据目录 `artifacts/slice-verify/b28-reading-native-20261026-r4/`；失败保留只读，不回写R2/R3。模型仍为作者手动实例，保留并核验idle。

- R4局部已证：真实采纳后不需重启，阅读直接读取新canon；原生AX无STALE/FAILED提示，空历史scene提示消失，模型只调用采纳摘要。恢复阶段工具已返回工作台，但驱动没有及时写finish，30秒restore_timeout触发清理；T4尚未输入。保留R4 failure/termination，不能算全批成功。
- R5恢复预注册：复制已终止R4库，不重做采纳/生成；只核对既有阅读结果，实际关闭/重开时在同一次CUA调用中getApp→getAXState→写finish，避免模型思考间隙占恢复预算。然后首次执行T4原输入一次、至多2次来源明确的作者回复；不重试模型。旧预算不扩大。证据 `artifacts/slice-verify/b28-reading-native-20261026-r5/`。

- R5 T4首次实模：原输入一次，真实judgment两调用；第一次chapter_read已返回“没有找到第一章；当前作品还没有章节”，第二次仍相同查询，run转awaiting_author且无明确问题/候选。原Tauri开发进程随后失活，监督以owned_process_exited停止，不能把此次视为T4通过。没有重发输入或用替身覆盖结果。
- CP0提示词契约冲突：AuthoringTaskPolicy同时要求材料不足诚实说明，却无条件写“取证后必须回到execute，不能reply/await_author”；判断共享段还保留“排版完整稿＋冻结空白归一”的旧协议。按既有B27语义和ADR-0029统一修正：只有目标/必要材料齐备才执行；明确不存在是已完成的核查，可据实reply或提出具体材料问题，禁止重复同查询与新建冒充修订；排版统一为模型计划＋确定性预览。无schema/验收标准变更。


#### T4规则修复后的单次复验预注册
- 范围：原生R6，源为已终止R4隔离库（T4从未输入，避免继承R5失败对话）；使用独立嵌入前端资源的Tauri程序，生产入口与代码不改成旁路。证据`artifacts/slice-verify/b28-missing-native-20261026-r6/`。
- 只切换既有空作品并发送原排版请求一次；真实Strata iq3_s、max4096/thinking disabled，原分型预算不变。需要明确问题时至多2次来源绑定回答“当前没有已保存正文，暂不新写”，不取消、不重发、不创建正文。核查应结束为具体缺目标澄清/拒绝，零候选、零正文/章节写入。若仍相同查询停滞，保留known-gap，不再追加重试。
- 不重跑已通过的R3分段与R4阅读修复；最后UI完成即停止服务，自动清理本批原生进程并核验作者模型仍idle。B37退出故障验证已先通过。

- R6尚未执行任何UI或模型调用即因driver_idle_timeout退出（准备调度未及时接入）。保留失败批；产品缺目标复验预算未使用。R7沿同一源与原判据执行，启动脚本在ready出现后立即登记准备等待，原生UI操作连续执行，避免后台已启动却等待调度。目录`b28-missing-native-20261026-r7`。

- R7未发送用户输入：原生应用已显示，但工具的菜单控制未生效，准备预算到期退出，模型调用0。重置仅自动化工具的JS会话（不改应用/数据/模型），R8沿相同源和同一业务预算继续首次T4修复复验，菜单控制先依据当前可见状态确认；不修改验收判据。

- 作者已确认桌面解锁且可操作。R8同样未提交业务输入/模型调用；保留控制异常记录。R9继续原已授权的单次T4修复复验，源仍R4，原输入/零写入判据/分型预算不变；不重跑分段或采纳。

- R9未进入业务输入，仍停在原生控制层。R10使用Tauri生成的完整.app（保留产品入口/identifier），继续同一未使用的T4修复复验预算；证据目录`b28-missing-native-20261026-r10`。所有旧批次保留。

#### R4/R10结果与T4产品根因记录（2026-10-26 夜间，承接 R6–R9 驱动故障）

- **R4（阅读/投影刷新）局部已证**：真实采纳后无需重启，阅读直接读取新 canon；原生 AX 无 STALE/FAILED 提示，历史空 scene 提示消失。恢复阶段 restore 等待到期（30s）而未能写 finish，T4 未输入；R4 failure/termination 保留，不冒充全批成功。后续 R5 用复制库恢复并首次执行 T4。
- **R10（T4 缺目标，产品修复前最后一次）实模结果**：源为 R4 隔离库副本，只发送一次原请求。真实 Strata iq3_s 两次 judgment 均 `explore/chapter_read("第一章")`，第二次观察已含“当前作品还没有章节”，但仍重复同一查询；产品 no_progress 停止，作者可见文案为“章节检索未完成，可换个章名再试。”+“AgentRun 未取得新进展，已停止等待作者回复。”+通用输入提示。零写入、无候选、不新建章（无 failure 之外的副作用）。证据 `artifacts/slice-verify/b28-missing-native-20261026-r10/run/`（failure.json、real-model-proof.json、t4-no-progress.ax.txt/.jpg、native-transport.jsonl、llm-calls）。
- **CP0 产品根因（两处，非单句补丁）**：① 探索观察分类把“检索完成且目标不存在”当成 activity 失败，显示“检索未完成”，与观察事实相反；② no_progress 终止只给泛化提示，不把最后一次观察的事实转成具体作者澄清，导致作者不知道缺少什么、下一步能做什么。模型重复查询是模型行为，但产品必须在不依赖模型配合时仍诚实可解释。
- **修复边界**：仅在既有 ADR-0025/B27/VS-00 语义内修正观察分类与 no_progress 终止的作者可见澄清（由最后观察派生），保持零写入、无候选、不路由 prose_write、无 schema/ADR/验收判据变更；不新增验收感知逻辑。

#### R11 T4 产品修复后单次 scoped 原生复验预注册（2026-10-26）

- 范围：只复验 T4 缺目标失败类型；源为已终止 R4 隔离库副本（canon 未变），真实 Strata iq3_s（thinking disabled、max_tokens 4096、单槽串行），一次原请求：“把已保存的第一章正文整理修订一下，只调整分段和排版，不要改字句。”不重跑 R3 分段/采纳、R4 阅读、R2 内容修订或 B27 全量矩阵换分。
- 初始状态：隔离副本中把缺目标作品标为最近打开（测试数据准备，等价于经作品菜单切换），应用启动即进入该作品；源库只读、不改 stage 数据。
- 判据（沿用 native_b28_evidence 冻结断言同一文本/条件，不改判据）：唯一一次输入；T4 作者可见澄清含缺失事实与可行后续（命中冻结正则 `/裁决|澄清|无法|需要你|多个标题|确认目标/`）；零章/零草稿/零 scene 写入；无候选、无 prose_writing 新创作执行、`production_write_performed != true`；真实模型调用与来源记录齐全。
- 预算：真实模型最多 1 次原输入 + ≤2 次来源明确的作者问题回复；等待沿用 B37 分型预算（input 120s / turn 360s / candidate 300s / adoption 180s / maintenance 300s / restore 30s，10s 心跳）；超时不重发；若同因失败，保留首因、记录 known-gap 并升级，不自动再启下一批。
- 资源：运行前记录 `lms ps`/内存与 Strata `loaded=null`；单槽串行；结束（成功/失败/中断）卸载 Strata 并验证 `loaded=null`；不加载第二模型。
- 证据目录 `artifacts/slice-verify/b28-missing-native-20261026-r11/`；外部驱动为外部系统 UI（AX/CGEvent，非产品钩子），失败批次只读保留。
- 预注册时间：2026-10-26T16:2x+00:00（执行前写入）。

#### T4 产品修复实现记录（2026-10-26，`028b6231`）

- **观察分类**：`ExplorationService` 为每类探索观察增加结构化 `outcome`/`facts`；空结果/目标不存在/歧义/非法参数/空正文均为“已完成观察”并给事实文案（如“已检索章节「第一章」：作品当前还没有章节。”），只有真实工具错误用失败文案；`observation_metadata/1` 进入 developer 面，两条探索链（judgment loop / judgment_plan）同源传播。
- **停等澄清**：新增 `NoProgressClarification`，由最后可用观察机械派生“缺什么/为何不能执行/可做什么”，无观察时退回既有诚实兜底句；`agent_run_server` no_progress 分支 emit 派生句并带 `reason_codes`（`no_progress_repeated_exploration`/`exploration_outcome_*`）与 `clarification_source`。不调 provider、不生成创作内容、状态/零写入/零候选/不路由写能力不变。
- **测试**：先 red 后 green；新增/扩展 17 条（含空作品→判断两次重复 chapter_read→runtime 停等的全链路，断言具体澄清/零候选/零写入/profile 仍 judgment_loop_v1）。application 981/0、umbrella 2282/0；compile/format/credo/xref/arch/I1–I3/N-NARR 全绿；证据 `artifacts/t4-fix-20261027/`。
- **边界**：不伪造模型 author_question（B31 来源绑定），系统机械澄清只用于 runtime 停等；模型自身是否提问仍由模型行为记录，不以产品兜底冒充模型能力。

#### R11 结果（2026-10-26，真实 Strata/iq3_s 原生单次 scoped 复验）

- 批次 `artifacts/slice-verify/b28-missing-native-20261026-r11/`：原生窗口由外部系统 UI 驱动（AX/CGEvent），启动即进入缺目标作品（隔离副本测试数据准备），只发送一次原请求。真实模型 4 次 HTTP 调用（judgment explore archive_read → explore chapter_read → output_validation retry → capability_gap reply），第一次检索后观察已含“已检索章节「第一章」：作品当前还没有章节。”，后续未再陷入重复检索停等，而由模型给出**能力缺口诚实答复**（说明章级仅排版能力存在但当前没有可作用对象，正文统计 0 章）——产品观察分类修复后模型不再复现 R10 的重复查询。
- **scoped 核验**（`scripts/native_b28_t4_check.mjs`，沿用冻结 T4 意图/文本条件，不改验收判据）**13/13 PASS**：唯一输入、结果绑定、零候选、无隐式采纳、`production_write_performed=false`、DB 零写入（章/草稿/scene 与 before 完全一致）、作者可见澄清、无写执行（判断无 execute、reply coverage 不含写能力、无 ui_card）、无 author_action、真实模型调用 4 次 provider=strata、原生截图/AX 新鲜、打开缺目标作品。结果 `run/t4-scoped-check.json`、`run/r11-t4-proof.json`、`run/T4-missing.ax.txt`。
- **判据边界（如实）**：T4 严格语义“真实模型回复必须澄清/拒绝”本轮由模型自身 capability_gap 答复满足；runtime 机械澄清作为不依赖模型配合的兜底（本批未触发停等路径，由确定性集成测试覆盖）。R11 批次末 runner 因缺 48 项全矩阵证据 `native_evidence_verification_failed`（scoped 批次预期，未删改），失败只读保留。资源：运行前后 `lms ps` 仅作者 embedding IDLE、Strata `loaded=null`/engine stopped，结束后显式 unload 仍为 null；无模型常驻。
- **残余**：旧全矩阵 driver 的浏览器面 48 项迁移验证另行执行记录；原生全 48 项单批（A3）未重跑，依“产品修复后只做失败类型 scoped replay”规则以 R3/R4/R11 native scoped 证据 + 浏览器 deterministic 全矩阵证据分别归档，不冒充单批全量原生通过。

#### 旧全矩阵 driver 迁移验证（2026-10-27）

- **迁移目标**：把原“format_only 全文候选/旧归一”断言迁移到 ADR-0029 的「prose_formatting_plan + 独立 formatting_preview + 实际新增分段」；T1 采纳改为“应用分段方案”按钮、非换行字节保真、阅读/摘要/检索消费新稿；T2 仍按 B36 目标段+确定性合并。判据条件不变，只改证据解析与驱动路径。
- **验证批次**：`bash scripts/quality_accept.sh b28-whole-chapter-revision --surface tauri`（确定性 slice_verify；Tauri dev 窗口 + Playwright 驱动真实工作台 DOM；证据 honest 标注 `surface=browser / driver=headless-chromium`，不冒充原生）。**PASS 48/48 checks、10 trials（T0a/T0b/T1/T2/T3/T4/T5/T6/T7/T8）、log noise ok**；证据 `artifacts/slice-verify/b28-whole-chapter-revision-tauri/`（保护副本 `...-cp6-driver-migration-pass-20261027/`）。
- **迁移验证过程发现并修复的 2 个 driver 缺陷（非产品缺陷，均已留证并修复）**：① `adoptRevisionCandidate` 迁移只改了按钮文案三元，未把待采纳查找从 `prose_fragment` 放宽到 `prose_formatting_plan`，导致 T1 找不到“应用分段方案”→ 8 项下游断言假失败（失败批次 `...-failed-driver-pending-filter-20261027T0045/`）；② 阅读快照在投影“重建中”时采集，3 项消费断言读到旧投影（失败批次 `...-failed-consumption-timing-20261027T0105/`）——修复为等投影 FRESH（无“重建中/正在读取/已过期”标记）后再采证；③ 另将 T7“下一轮上下文读新章”从整条 prompt 收紧为“当前作品事实段”（B27 上下文结构中历史段合法含旧文本），判据意图不变且更精确。修复仅动 `frontend/slice-verify/external-ui-driver.mjs`，未改产品代码/未放宽任何产品断言；另一次批次失败为并发前端编辑导致的 HMR 干扰（`...-failed-concurrent-frontend-edit-20261027T0028/`），保留只读。
- **边界**：本批次是确定性机制/契约回归证据；原生交互由 R3/R3-resume/R4/R11 的实模 scoped 证据承担；不声称单批原生 48 项通过。

#### 收口门禁记录（2026-10-27，commit `bbf31209`，干净 worktree）

- **门禁方式**：`git worktree add /tmp/b28-gates-... bbf31209`（隔离 worktree，phoenix 端口 4799/4798，未占原生批次端口）；证据 `artifacts/gates/2026-10-27-b28-final/`（report.md + 各 gate 日志 + exit TSV）。
- **PASS**：compile -Werror、mix test **2282/0**（首跑在高负载下有 1 个 2s assert_receive 时序 flake，单文件重跑 3/3 + 全量重跑 2/2 绿，已证伪非回归）、format、credo（602 files/0）、xref 无环、arch、codegen.enums、enum lint、**adr_trace 28/28（含 ADR-0029 enforced_by 裸路径修复）**、log-noise 17/17、I3/I1/I2/I-CACHE 全 PASS、前端 typecheck/lint/**621 tests**/build、codegen drift 0、frontend_audit --quick 27/27（全量 tauri build 按约束 NOT-RUN）、design trace 19/0/0、quality manifest、next_task_check、**ai_static_scan --top 10 exit 0（blocking 0，2 条历史 gitleaks disposition）**、task_done --slice b28-whole-chapter-revision exit 0（manifest git_head=bbf31209）。
- **已知非本批新增红（如实登记，不冒充绿）**：① `mix dialyzer` 39 errors 为 HEAD `a60c9024` 既有基线（本批未新增；上轮 WIP 的 +1 已消除）；② `pnpm format:check` 19 文件 prettier 不符为既有（CI workflow 不跑该项）；③ 上述 load 下 2s 测试超时建议后续放宽/去 flake（不属本批产品回归）。
- **task_done 口径**：干净树上 `touched_files=[]` 走 “UI evidence not required”，不核验原生 Tauri；StructurePanel 类型边界修复的原生证据由 B30 原生批次提供，final 队列清空时带 diff 再跑一次 task_done 闭环。

## 元原则整改：作者范围与否定约束

- 状态：**doing（2026-10-30 CP0–CP2 done：授权范围重写、集成/采纳保护、B28 真实页面确定性回归通过；CP3 外部原生 Tauri + 真实模型验收待执行）**。原整章修订/排版业务与历史完成记录保留。
- 来源：元原则业务补核（`../../artifacts/task-audit/2026-10-30-principles/b-business-supplement.json`） 对现役范围选择与采纳校验的静态核对；本节是“否定整章词被 whole_chapter 误授权”的唯一执行入口，不重新启动旧 CP0–CP5。

### 当前缺口与目标链

`PendingArtifactWorkflow.chapter_modification_scope/1` 从 `run.goal.text` 按词选择范围：未命中排版分支后，只要出现“整章/全章/整篇/全文/通读”即选 `whole_chapter`，没有处理否定或条件。常规章级修订采用这个默认值，并写入 AuthoringTask/输出契约；`LocalizedRevision.validate_scope/4` 对 `whole_chapter` 不执行目标段集合外的差异保护。因此“不要整章重写，只改第一段”等原话不能只因仍在 prompt 中，就被认为权限范围已正确。

上述结论来自代码分支阅读，不是数据库、页面或真实模型误写复现。参数解析本身可以属于 APP；问题是把语义上明确否定的范围当作正面授权。整改须形成：

```text
完整作者原话与有效上下文（含否定、条件、明确保留项）
→ 模型提出与该意图一致的修订范围/效果
→ APP绑定真实章/片段、基线版本与可验证范围约束
→ writer按同一任务生成候选/patch
→ diff与采纳事务校验范围、字节、版本及作者批准
→ 真实回执、阅读/后续请求与回放
```

不能只补一个“不要整章”关键词例外，也不能把原先机械守卫全部删除或无条件相信模型自报的扩大范围。全章输入覆盖是材料完整性，不等于获准改动整章；未知作用范围须先利用真实材料消歧，只有作者才能决定的部分再询问，不能靠默认值扩大写入。

### 本轮开工七问

1. **Contract**：原 B28 的稳定章节身份、完整材料、format_only/内容修订与采纳边界，B35 覆盖完整性、B36 分段/patch/版本契约，以及 ADR-0030/0031 的模型判断、真实来源与统一裁决。CP0 先明确既有载体如何表达授权范围与保留要求，不在本节新增枚举、字段或长度阈值。
2. **Invariant**：否定/条件和局部限制不被扩成全章授权；材料读全不等于可全改；目标段外非授权字节保留；未知/歧义/过期/错误引用不得写入；候选正文/patch 保留实际模型来源；同请求幂等、失败无额外权威变更，真实无变化可以据证说明而非生成伪改稿。
3. **Boundary**：application 的共享语义、章级修订任务/范围形成与候选绑定；domain 的纯范围契约；persistence 的 LocalizedRevision/diff、基线读取与采纳事务；web/frontend 消费原候选、预览、范围/回执。模型产建议和替换内容，APP核真实目标与效果；不新建正文存储或第二修订引擎，不改作者存量数据。
4. **Consumer**：真实主输入发起的章级修订、writer与质量复核、候选预览/采纳、ReadingMode/Why，以及后续上下文读取；必须共用同一作用范围与真实基线，不能只改生成提示。
5. **Proof**：正式回归“不要整章重写，只改第一段”“通读全文后只修第二段”“不是仅排版，需要修改指定句子”等否定/条件输入，并对照整章内容修订、仅排版、局部修订和证据支持的无变化；覆盖输入→scope→目标→diff→采纳→阅读/回放。先锁住当前错误选择，再验证目标外不变及越界拒绝，不以结果未写坏推定范围本来正确。
6. **Acceptance Driver**：复用外部原生 Tauri 的 B28/B36 修订入口，在隔离作品中输入自然原话→必要取证→候选/patch→作者查看并采纳→阅读/刷新/重开/回放，捕获任务范围、真实请求、diff、receipt与持久事实。具体 driver/用例在 CP0 预注册；产品验收感知逻辑 **no**，机制与真实模型语义分别留证。
7. **Exploration**：模型通过现有章节读取获得真实目标材料、范围/版本/覆盖；观察进入后续请求。若无变化或条件不成立，依据必须可追；不预装反例答案，不把全章读取权限变成整章修改权限。

### CP0 记录（2026-10-30 done）

- 证据：`artifacts/task-audit/2026-10-30-b28-semantics-cp0/{audit-map.json,scope-probe.json,scope-probe.exs}`（纯函数/静态审计；未启动服务、未调 provider/DB/页面）。当前源码 sha256 见 audit-map.json。

#### 现役链路（已核实）

| 环节 | 位置 | 事实 |
|---|---|---|
| author goal 来源 | `PendingArtifactWorkflow.revise_adopted`（:182 dispatch → :518 `revise_chapter/6`） | 常规章级修订只读 `run.goal.text`；作者常规路径不传 scope 覆盖 |
| scope 形成 | `chapter_modification_scope/1`（:657-672） | 先 format-only 正则；否则 `整章|全章|整篇|全文|通读` 命中即 `:whole_chapter`；否则 `:target_segments`。**不区分否定/条件/读取与修改** |
| 显式覆盖 | `revise/8`（:1252-1270） | 仅“排版计划再修订”内部路径传 `:format_only`；不是作者旁路 |
| 写入 AuthoringTask | :681-687 | scope 写入任务与输出契约，实际改变 writer 指令/候选标题，不是展示标签 |
| 目标段解析 | `b36_revision_scope/3`（:872-936） | whole/format 直接全段；**只有 target_segments 才按作者原话解析目标段**，解析不到返回 `:incomplete_scope/:target_missing/:target_ambiguous` |
| writer 契约 | :842-856 | target_segments 只输出目标段替换文本、其余逐字保留；whole_chapter 输出整章替换稿 |
| 采纳保护 | `AdoptionWorkflow.validate_b28_adoption`（:653-706）、`AdoptionRepository.persist_replace_scope`（:883-916）、`persist_replace_segments`（:628-700）、`LocalizedRevision.validate/3`（:149-171） | format_only 有字节保真；**whole_chapter 无目标段外差异保护**；target_segments 有 `out_of_scope_changes` 拒绝。错误 scope 直接改变保护面 |
| 验收替身 | `SliceVerify.chapter_revision_scope`（:4200-4214）与 `chapter_revision_intent?` | 镜像产品词法范围，但 CP0 探针 10 条输入中 4 条与产品不一致（“整章重写”“通读全文后只修第二段”“不是仅排版”等），部分返回 nil 不进入修订链；CP2 必须对齐 |

#### 纯函数探针（当前行为）

| 输入 | 当前 product scope | 冻结期望（作者授权语义） |
|---|---|---|
| 不要整章重写，只改第一段。 | `whole_chapter` ❌ | 第一段局部；否定 + 局部限制不得扩为整章 |
| 通读全文后只修第二段。 | `whole_chapter` ❌ | 第二段；“通读/全文”是材料读取，不是修改授权 |
| 整章检查一遍，有问题告诉我，别改。 | `whole_chapter` ❌ | 只读/禁止写入；不得生成整章候选 |
| 如果第03章有明显问题就整章改一遍，没有问题就告诉我。 | `whole_chapter` ❌ | 条件未判定前不得自动授权整章（保守处理；条件成立需证据/作者确认） |
| 只读一遍第03章，不要改。 | `target_segments`（因无整章词） | 不得生成候选/写入（不能靠“恰好没命中整章词”） |
| 把第03章整章重写一遍，情节不变。 | `whole_chapter` ✅ | 正向整章授权 |
| 通读全文后整章润色，保留所有情节。 | `whole_chapter` ✅ | 正向整章授权（读取+修改） |
| 只调整第03章分段和排版，不要改字句。 | `format_only` ✅ | 仅排版授权 |
| 把第03章第一段改得更紧张，其他段落别动。 | `target_segments` ✅ | 局部授权 |
| 不是仅排版，需要修改第二段里的指定句子。 | `target_segments` ✅ | 否定“仅排版”后为局部内容修订 |

保护面证明（纯函数）：同一“仅改写第二段”的候选，`target_segments`（目标=第一段）返回 `{:error, :out_of_scope_changes}`；`whole_chapter` 返回 `{:ok, ...}`——错误 scope 会移除目标外字节保护。

#### 冻结契约（CP1 实现依据）

1. **scope 表达修改授权，不表达材料覆盖**：读取/通读/检查词与否定/条件词不得单独授予 `whole_chapter`；整章材料覆盖仍始终完整。
2. `whole_chapter` 仅用于作者明确、无条件的整章修改授权，且同一请求内没有局部/否定限制；否则保守为 `target_segments`。
3. `format_only` 仅用于明确正向的“只排版/只调分段/字句不变”限制；既有非换行字节保真校验不变。
4. `target_segments` 必须绑定真实章 ref、段 id/hash/版本；解析不到 → `:incomplete_scope/:target_missing/:target_ambiguous`，禁止回退整章、禁止猜段。
5. 显式 `opts[:modification_scope]` 只保留受信内部路径（排版计划再修订），不作为作者原话旁路。
6. 不新增 schema/枚举/字段/长度阈值；不删除 LocalizedRevision/B35 覆盖/B36 版本与 hash 守卫。
7. 模型负责语义判断/内容；APP 负责授权范围、真实目标、版本与范围保护；作者保留采纳权。
8. 测试替身（slice_verify）必须与产品同源；CP2 加一致性回归，不允许替身差异冒充通过。

#### CP3 预注册（不执行，先冻结）

- 场景：N1「不要整章重写，只改第一段。」→ target_segments 第一段、其余逐字节一致；N2「通读全文后只修第二段。」→ 第二段；N3「整章检查一遍，有问题告诉我，别改。」→ reply/ask、零候选零写入；N4 条件性整章 → 条件未判定前不自动整章授权；P1 整章重写正例；P2 仅排版正例（非换行字节保真）；P3 字面替换「二十五岁→三十岁」；X1 越界候选采纳拒绝 `out_of_scope_changes` 零写入。
- 驱动：优先复用 B28/B36 原生修订入口（`scripts/tauri_slice_verify.sh b28-whole-chapter-revision` + `native_b28_evidence.mjs`）；若现有 driver 不能参数化自然原话，CP2 冻结最小扩展（不改产品语义、不新增验收钩子）。
- 资源：真实模型单槽串行，结束 unload 核验；失败只读保留，不做整批重跑换分；文学质量不代签。
- 证据：`artifacts/slice-verify/<scenario>-tauri*/` 的任务范围、writer 输入、候选 payload、diff、receipt、DB 前后快照、阅读/刷新/回放与网络帧。

#### CP3 执行注册（2026-10-30，冻结后执行）

- 场景/slice id：`b28-scope-authorization`；驱动 `scripts/native_b28_scope_drive.mjs`；证据核验 `scripts/native_b28_scope_evidence.mjs`（prepare/capture/verify）；seed `scripts/seed_b28_scope_authorization.exs`（第01章对照章 + 第03章两段 accepted 正文，含「二十五岁」字面锚点）。
- 注册：`scripts/tauri_slice_verify.sh` implemented/allowlist/verify/seed/description 五处；`quality/acceptance/scenarios/b28-scope-authorization.yml` + `scenarios.yml`（209 scenarios）。
- 执行顺序（预注册细化，语义不变）：P3 字面替换 → N1 否定整章+局部 → N2 通读后局部 → N3 只读拒改 → N4 条件整章 → P1 整章重写 → P2 仅排版。P3 提前以保持「二十五岁」字面在 N1 生成前可精确定位；X1 越界采纳拒绝由 CP2/全量后端确定性测试覆盖，不在真实模型中伪造越界输入（避免验收钩子）。
- 输入以「第03章」显式锚定目标章（避免两章作品的指代歧义；语义与预注册 N1/N2 一致）。
- 失败只读保留；真实模型单槽、结束 unload 核验；不做整批重跑换分。

#### 残余

- CP0 仅为纯函数/静态证据，未运行页面/真实模型/数据库。
- 条件性整章授权的最终语义仍需真实模型与作者证据；APP 只做保守授权，不代签条件成立。
- 验收替身与产品范围语义不同源（4/10 不一致），必须在 CP2 对齐。

### 本轮 CP0–CP3

| CP | 完整工作与关闭证据 | 状态 |
|---|---|---|
| CP0 | 审计 scope 默认值、显式覆盖选项、原话/goal 来源、目标段解析、writer输出契约与采纳消费者；冻结正面/否定/条件/歧义及保留项的同源映射和反例矩阵，区分全章材料与修改授权 | **done（2026-10-30）**：审计映射/纯函数探针/保护面证明见下节“CP0 记录”；证据 `artifacts/task-audit/2026-10-30-b28-semantics-cp0/{audit-map.json,scope-probe.json,scope-probe.exs}` |
| CP1 | 修正范围形成与绑定，避免词面命中扩大作用域；沿现有判断链与真实目标/版本形成明确约束，条件未成立可据证无变化，范围不明不生成越权候选 | **done（2026-10-30）**：新增纯函数 `ChapterRevisionScope`（13 条反例矩阵/红测全绿）；`resolve_modification_scope` 接入 revise_chapter，明确只读不改→`author_scope_not_authorized` 零写入；视觉/局部/条件/正向对照与显式内部覆盖分流；slice_verify 替身镜像对齐并加回归。证据见下节 CP1 记录 |
| CP2 | 贯穿 AuthoringTask、writer/evaluator、preview、diff/patch与采纳事务；验证目标外保真、完整覆盖、stale/跨作品/歧义/重复/失败回滚，真实回执与后续读取一致 | **done（2026-10-30，确定性）**：B28 真实页面场景 `b28-whole-chapter-revision` 通过（format_only/字面替换/幂等/读取刷新）；新增 CP1 集成测试覆盖否定/读取/条件与采纳后逐字节保真；全量后端 0 失败；B35/B36 守卫未放宽。原生 Tauri+真实模型留给 CP3 |
| CP3 | 外部真实 Tauri与真实模型完成否定/条件和三个原范围的对照矩阵，含必要采纳、恢复与回放；保留失败与原生/browser/局部证据边界，完整后果齐备后关闭本节 | todo |

### CP1/CP2 记录（2026-10-30）

#### CP1：授权范围形成重写（提交见下）

- **新增纯函数** `apps/novel_application/lib/novel_application/chapter_revision_scope.ex`：按作者原话的**修改授权语义**判定 `:format_only | :whole_chapter | :target_segments`，返回 `{:error, :author_scope_not_authorized}` 表示明确只读/不改。
  - 决策顺序：正向仅排版 → 局部限制（只改第N段/开头/结尾/其余逐字不变…）→ 明确只读不改拒绝 → 否定整章不授整章（保守局部）→ 正向且无条件整章 → 默认局部。
  - 否定/条件/读取词不单独授予整章；“通读/全文/检查”只作材料语义；条件性整章保守为局部（目标解析不到即 `incomplete_scope`，不猜整章）。
- **接线**：`PendingArtifactWorkflow.revise_chapter` 改为 `resolve_modification_scope/2`（受信内部 `:format_only` 重排路径保留显式覆盖；作者原话路径无旁路）；`author_scope_not_authorized` 映射为 `{:pending_artifact_invalid, :author_scope_not_authorized}`，在调用 writer 前零写入拒绝。
- **测试**：`b28_scope_authorization_test.exs` 13 条矩阵（否定整章+局部、通读后局部、只读拒改、条件整章、整章重写、整章润色、仅排版、字面替换、否定仅排版等）全绿；`b28_chapter_revision_wiring_test.exs` 新增 4 条集成（否定+局部→target_segments 首段并采纳后其余逐字节不变；通读后只修第二段→第二段；只读拒改→不调用 writer、零候选零写入；条件整章→保守拒绝、不猜整章）。
- **替身对齐**：`novel_agent/test/support/provider/slice_verify.ex` 镜像同一决策树与意图门（读取/检查不算修改意图；明确修改信号才进入修订链）；`slice_verify_test.exs` 增加 CP1 镜像矩阵（13/13 产品结果与替身 scope 一致，拒绝类替身返回 nil 表示 reply 而非修订）。

#### CP2：端到端/采纳保护与真实页面确定性回归

- **真实页面证据**：`bash scripts/tauri_slice_verify.sh b28-whole-chapter-revision` **PASS**（`artifacts/slice-verify/b28-whole-chapter-revision-tauri/`）；覆盖 T0 同标题绑定、T1 format_only 分段计划/预览/采纳/阅读刷新、T2 字面替换只改一处、T3 幂等、T4 缺目标零写入。
- **首次失败与根因（保留在证据 log）**：`artifacts/task-audit/2026-10-30-b28-scope-cp12/b28-scenario-mirror-failure-then-pass.log` 记录确定性场景在 continuation 输入处失败，根因是替身意图门在新 formula 下把“继续往下写”误判为章修订 → 产品按 incomplete_scope 正确拒绝；修替身意图门（target 词或修改信号 + 修改动词/信号，读取/续写不进入修订链）后复跑 PASS。属验收替身接线修复，不是产品语义放宽。
- **采纳/消费者**：CP1 集成测试走真实 `AdoptionRepository.persist`（replace_segments）与阅读投影；目标外段落逐字节保留、旧稿 superseded、候选 scope/covered/hash 由任务事实派生。B35 覆盖完整、B36 版本/hash、format_only 非换行字节保真等既有守卫未改，全量后端测试 0 失败。
- **残余**：本 CP 的页面证据是 browser surface；原生 Tauri+真实模型对照矩阵属 CP3（预注册已冻结 N1–N4/P1–P3/X1）。

### 与 B33 / B35 / B36 的分工

- [B33 语义判断整改](B33-authoring-intent-judgment-reliability.md#元原则整改语义判断与机械守卫分工) 负责讨论/条件/执行等共享判断结果不被后置词法路由强迫；本节负责选定修订后，作者范围如何贯穿真实目标与写入保护。两处不能用各自局部测试代签另一链路。
- [B35](B35-revision-adoption-scope-integrity.md) 负责完整覆盖与防丢稿保护，包括长度风险和显式缩写的语义复核；本轮不以修复否定范围为名取消现有安全下限，也不擅自冻结新比例。长度不是范围的唯一证据，相关后果沿 B35 保留。
- [B36](B36-localized-revision-algorithm.md) 负责真实段身份、版本、目标外 diff 与确定性 patch 应用；正确的原文/目标不能由模型自报或另一套分段器替代。若需要调整 B36 实现，范围与回归仍由其既有契约约束，不重新实现局部编辑能力。
- B27 维护专业调用共同语义，B43 提供统一裁决/trace；采纳、原正文历史和前后版本关系继续保持。整改不授权 stage 修复，不把原生 scoped 历史改成新全矩阵 PASS；当前只补任务定义，未改代码或测试。
