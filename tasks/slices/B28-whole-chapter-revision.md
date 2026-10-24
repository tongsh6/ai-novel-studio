# B28：完整章节修订、排版范围与采纳身份闭环

- 状态：**doing / CP0 已完成（2026-10-25，真实 Tauri 隔离复现 + 契约冻结）**：当前版本已阻止 stage 式「单片段冒充整章」候选（honest failure），但整章只排版仍不可完成；内容修订采纳仍会因 target 空而新建章（stage 21:58 失败链可复现）。CP0 复现证据 `artifacts/slice-verify/b28-whole-chapter-revision-tauri/`、记录 `artifacts/model-contracts/b28-cp0/{ui-repro.md,code-chain.md,contract-proposal.md,stage-impact.md}`；CP1 契约与实现已按 §7 冻结。
- 登记日期：2026-10-23；来源：stage“整理第1章正文”只处理初稿、采纳后新增第17章。
- 上游：[Q1c](Q1C-adopted-content-revision.md)、[B24](B24-exploration-chapter-full-read.md)、[B25](B25-chapter-identity-unification.md)、[Q1Cb](Q1CB-ADOPTION-TRANSITION-ENFORCEMENT.md)。提示词统一归 [B27](B27-systematic-prompt-and-intent-integration.md)，不在此追加局部提示词补丁。
- 本轮只授权任务登记，不修改代码或 stage 数据。

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
| CP4 | 新真实 Tauri 场景＋Q1c/B24/B25/续写回归；真实模型原始问法与改述验证 | in_progress（task-57：真实模型 `iq3_s` 原话/改述各一，验证判断绑章+format_only→同章替代；串行、Lead 批准） |
| CP5 | 全门禁、静态扫描、NEXT/journey D5/ledger；数据修复未授权时如实单列，不能称 stage 数据已恢复 | todo |

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
- **Q03 format_only 归一规则（冻结）**：①逐行删除行尾空白；②换行形式归一（CRLF/CR→LF）；③文末连续空行折叠为单换行；④其余字节必须完全相等。判定在应用层机械执行，异常 `format_only_violation`（附首处差异 offset/行号），不自动降级 rewrite；B28 落地后 **B27 M07 known-gap 关闭**，B27 §6.1 不另造规则。
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
