# B29：已有角色叙事身份修订与主角事实一致性

- 状态：**done（2026-10-27，原生确定性矩阵 23/23 PASS + 真实模型 scoped T1 全链 PASS）**。作者保留原生标准补验：确定性原生批次 23/23 checks/5 trials PASS（驱动 ax-native-system-ui）；strata/iq3_s scoped 原生批次 T1 真实判断→候选→原生采纳→receipt/DB 不变式 PASS（19 项），T2 同名澄清未复现（真实模型跨轮上下文消歧→no-op 候选，DB 零写入）如实登记为模型行为 known-gap，不冒充通过、未放弃守卫。新发现 no-op 角色修订候选与同名澄清硬化点列残余待裁决。全门禁与台账收口在最终批次统一记录。
- 原收口记录：**done（2026-10-25，CP0–CP5；真实 Tauri 23/23 checks 注册 PASS，AU09/AU12 回归 PASS，实模 canonical PASS）** / CP0（2026-10-25，真实 Tauri 隔离复现 + 契约冻结）：当前版本无「已有角色主档案字段修订」能力——自然原话被 reply 吞掉、显式措辞才诚实 capability_gap；character_evolution 只写演化记忆、character_design 只新建角色；Character.narrative_role 未变且未用 memory 冒充。CP0 冻结见 §6，CP1/CP2 进行中。
- 登记日期：2026-10-23；本轮只写任务，不修改代码或业务数据。
- 归属：[AU09 角色类型/主角策略 §7 CP2](AU09-character-role-taxonomy-protagonist-policy.md) 已登记的“把已有角色指定/改判为主角”；衔接 [AU12 身份归并](AU12-character-identity-merge.md)、[Q1c](Q1C-adopted-content-revision.md)、[B27 系统提示词整合](B27-systematic-prompt-and-intent-integration.md)。

## 1. 实锤与目标

stage session 5d618f06-f41c-46bc-aa55-5056a2fa5612，2026-10-23 01:41 作者说“指定沈砚为主角”；判断选 character_evolution，01:50 采纳“沈砚：确立为本作主角”。结果仅生成 CHARACTER_PROFILE 记忆，Character.narrative_role 仍为 ENSEMBLE_POV。角色主档案、记忆文字、后续查询出现相互矛盾的事实。

证据：[模型日志](../../log/llm-calls/stage/2026-10-23.jsonl) 第55–56行；[业务日志](../../log/app/stage/2026-10-23.jsonl) 第700/715–718行；artifact as_mvjtwlfi_g0o，memory 9e4266e1-4ccd-4a63-81d9-05bbab1dadca。当前生产支持设计期写 narrative_role，不等于支持修改已确认角色。

完整链路：自然语言指定已有角色 → 绑定角色 ID 与当前值 → 字段修订候选 → 作者采纳 → 更新同一角色 → 档案、花名册、探索、判断/写作上下文一致；不以一段演化记忆代替主档案更新。

## 2. 开工七问

1. **Contract**：AU09 NarrativeRole、Character 身份、VS-04/ADR-0019 采纳、ADR-0027 来源与结果；为已有角色字段修订冻结最小输入/输出/版本契约，能力名和卡类型按当前 contract 注册，不由前端自造。
2. **Invariant**：同 character_id 更新、角色数不增加；指定主角只改变获准字段；未采纳零修改；不自动取消其他主角（现契约允许多主角）；字段、投影、问答一致；保留旧值/来源与回滚证据。
3. **Boundary**：application 语义目标、对象消歧与采纳编排；domain 字段白名单/合法值/变更规则；persistence 带基线校验的更新和审计；web/frontend 复用候选/确认/档案展示；agent 消费 B27 操作契约，不替代主档案写入。不得借机实现角色全部生命周期或更换存储体系。
4. **Consumer**：WorkspaceChat 中“把沈砚设成主角”→候选→采纳，StructurePanel 与“主角是谁”追问及后续创作消费真实字段。
5. **Proof**：身份/字段/多主角/基线/幂等/回滚测试，真实页面从自然输入走到再次查询与刷新；检查角色、记忆、上下文的相同来源。
6. **Acceptance Driver**：拟新增 b29-existing-character-role-revision，外部驱动真实 Tauri；产品验收感知逻辑：**no**；UI 改动前核对设计文档/Pencil 当前角色档案和采纳卡。
7. **Exploration**：archive_read 的角色面、人物读取端口和下一轮上下文同批显示新 narrative_role；旧值可在 history/trace 追溯，不继续把旧值作为当前事实。

## 3. 实现方案（CP0 待冻结）

- 以当前作品内 character_id、base revision 或等效版本指纹、字段旧值/新值表达修订；名字/别名只用来消歧，不能按名称新建同名角色。复用既有版本/审计机制，若缺必要版本保护再最小扩展。
- 主角、反派、配角等合法值来自 NarrativeRole schema。模型提出修改值，应用校验字段与作用域；候选明确展示对象和变更，不要求作者写 JSON。
- “设定主角”在已有上下文能明确对象时提出对应候选；真正有多个合理对象时给必要选择。“设计一个新主角”仍走角色设计，不能全部改派已有角色更新。
- 只有“唯一主角/替代原主角”等明确要求才可能涉及其他角色；应另列这些角色的变化供作者裁决，不用全局清空旧主角的默认逻辑。
- 采纳后原子更新角色主档案并留 state trace；如果同时维护角色记忆，必须与字段事实同源，不能留下新旧同时有效的矛盾声明。历史错误记忆只做影响清单，清理须遵守数据授权。
- available_operations 和 registry 效果说明与实际能力同批上线；未上线前复用 Q3B 诚实说明缺口，不把 character_evolution 当近似替代。提示词角色边界统一由 B27 投影。
- 新建/修改/演化/归并是不同效果，分别保留授权与回执；不为本修复新增关键词路由。

## 4. Checkpoint 与验收

| CP | 完整工作 | 状态 |
|---|---|---|
| CP0 | 按 AU09 CP2 核对主档案/记忆/角色身份，冻结字段修订与版本保护、采纳/确认语义、旧值留存契约 | **done（2026-10-25，`201b42cb`）**：真实 Tauri 17/17 checks/6 trials（自然原话 reply 零写入、显式措辞 capability_gap、多主角不清空、同名/别名不新建、讨论/放弃/跨作品零写入、「谁是主角」消费缺口）；契约冻结 §6（Q01–Q08）；aux 代码链/消费者/记忆审计/stage 只读 `artifacts/model-contracts/b29-cp0/` |
| CP1 | 应用可调用的已有角色修订候选与领域校验；模型看见真实操作和对象，旧能力缺口保持诚实 | **done（2026-10-25，`601518e9`）**：`revise_character_profile` 能力（provider none/write_scopes character_dossier）+ judgment character_ref 绑定/机械 gate（同名别名歧义 ask、设计新主角仍 character_design、设计/演化不冒充）+ CharacterProfile 零写库候选（object_kind/character_ref/base_fingerprint/changes old→new/effects/other_character_changes=[] + display-only suggestions） |
| CP2 | 作者采纳→同一角色更新→审计/投影/记忆一致；幂等/并发/失败回滚 | **done（2026-10-25，`601518e9`）**：`character_profile_context/1,2`（同名分组/base_fingerprint）+ `revise_character_narrative_role/5` 原子更新（同 id 只改 narrative_role、角色数/其它角色/正文不变、失败回滚、幂等 duplicate）+ AdoptionWorkflow `character_field_update` effect（回执 committed_changes/old+new fingerprint；不调 writer/不新建角色/不写 memory）；persistence 318/0、application 921/0 |
| CP3 | 档案、花名册、探索、后续判断/写作同批消费；真实 Tauri 自然输入、采纳、刷新、再问闭环 | **done（2026-10-25，`65ef9f8f`）**：判断/写作上下文事实优先级（主档案 narrative_role 为当前事实、旧 memory 不覆盖、多主角/无主角诚实）、roster/档案后端读主档案、`CharacterRosterNarration`「谁是主角」单/多/无主角/无索引确定性回答、memory 查询追加主档案为准注记（不清理历史）；application 924/0、agent 275/0；真实 Tauri 刷新/再问由 CP4 验证 |
| CP4 | 实模改述/必要澄清对照、全门禁；同步 AU09 CP2/NEXT/journey/ledger | **done（2026-10-25，`81fb7f0e`）**：`b29-existing-character-role-revision` 注册 nightly PASS 23/23 checks/5 trials；AU09/AU12 回归 PASS（AU09 契约按 CP3 后角色索引只读回答/异步 design run 更新、AU12 修 fact_inventory 动态 atom、AU09 fixture 三连）；实模 `iq3_s` original/paraphrase/discussion canonical + before 对照；失败批次全保留 |
| CP5 | 全门禁、静态扫描、NEXT/journey/ledger 收口；未获授权的存量清理单列后续 | **done（2026-10-25，CP5 收口）**：后端 2194 tests/0、前端 603 tests、compile/format/credo 0/enum/xref/arch/adr、I1/I2/I3；静态扫描/task-done；journey D14 closed、slices README/NEXT/ledger 同步；stage 历史矛盾 memory/角色事实只读清单、清理需授权 |

验收至少包含：已有角色从 ENSEMBLE_POV→PROTAGONIST（ID/数量不变）；已有多个主角只改目标；同名不同人/别名消歧；“只讨论是否合适”不改字段；放弃候选原值不变；stale/跨作品/失效目标/重复采纳拒绝或幂等；故障注入只在 test/support。

拟命令：bash scripts/quality_accept.sh b29-existing-character-role-revision --surface tauri（实现时注册）；回归 au09-character-role-taxonomy-protagonist-policy 与 au12 身份归并相关当前场景。测试和门禁按 [AGENTS](../../AGENTS.md)：后端全量、架构、前端有改动时全检查、静态扫描闭环、I1/I2/I3/N-NARR。页面结构证据与真实模型语义证据分开记录，不能仅以 memory 行出现“主角”判通过。

## 5. 决策日志与恢复

- 2026-10-23 — 按作者要求登记，承接已有 AU09 CP2，不重新定义主角概念，不把角色记忆视为叙事身份字段。
- 恢复时先查 NEXT、B27/B26 状态及 WIP；按 CP0 确认真实消费者和版本链，再实现，不能自动回填 stage 的主角身份。

## 6. CP0 记录与契约冻结（2026-10-25）

### 6.1 CP0 真实复现结论（证据 `artifacts/slice-verify/b29-existing-character-role-revision-tauri/`）

- 真实 Tauri（17/17 证据 checks、6 trials；保护副本 `...-b29-cp0-pass-final-20261025T0730/`；记录 `artifacts/model-contracts/b29-cp0/ui-repro.md`）：
  - seed：沈砚 `ENSEMBLE_POV`/别名老沈、顾青 `PROTAGONIST`、同名沈砚 `MINOR`/别名小沈、阿鸢 `SUPPORTING` + accepted 正文。
  - **A1「指定沈砚为主角」**（两个同名沈砚）→ judgment 仅 `reply`（无 capability/对象绑定）、pending=0、零写入；Character 4 角色字段不变（沈砚仍 ENSEMBLE_POV）、无 CHARACTER_PROFILE 记忆。
  - **A2「指定老沈为主角」** → 同样 reply，别名未用于绑定。
  - **A3 显式「把已有角色的叙事身份从配角改为主角」** → `capability_gap` 诚实说明「当前工具没有修改已有角色主档案叙事身份的能力；角色演化只写演化记录，不能代替身份修改…原档案保持不变」，零写入、无候选、无 memory 替代。
  - **B 多主角**：顾青仍 PROTAGONIST、角色数 4、无全局清空；**C 同名/别名**：两个沈砚原 id 均在（同名 2→2、新增 0、aliases 老沈/小沈），未新建/错绑；**D 负例**：讨论/跨作品均 reply 零写入、无 accept 入口；**E 消费者**：档案角色面板显示类型标签，但「现在谁是主角？」仍通用 reply（消费者缺口）；protagonist memory=0（未用 memory 冒充）。
- 与 stage 对照：stage 判断 character_evolution→采纳仅写 CHARACTER_PROFILE 记忆、主档案仍 ENSEMBLE_POV；当前确定性链路未复现 memory 冒充，但也无字段修订效果（自然原话连缺口都未识别）。
- 根因：①无「修改已有 Character.narrative_role」能力/registry；②自然语言未绑定 character_ref/别名消歧；③无字段修订候选契约（character_ref+base version+旧/新值+采纳/审计）；④消费者（「谁是主角」）无字段事实可用。

### 6.2 CP0 冻结决策（Q01–Q08）

- **Q01 能力**：registry 新增 `revise_character_profile`（`provider_dependency: :none`、`write_scopes: ["character_dossier"]`、effect_summary「修订既有角色主档案字段，不新建角色、不写正文/不冒充演化记忆」）；与 `character_design`（新建）、`character_evolution`（演化记忆）严格区分；judgment 目录可见；能力未上线/对象不明时保持诚实 gap/澄清，不得用 evolution memory 冒充主档案修订。
- **Q02 输入/身份/版本**：输入 `character_ref`（id，必需）+ 旧值/新值 + `base_fingerprint`（updated_at+关键字段 hash；Character 无 revision 列，先应用层 fingerprint）+ author scope；name/aliases 仅展示与同名消歧、不参与身份；同名/别名歧义 → `target_ambiguous` 澄清（列出候选 ref+name+summary）；跨作品 → `cross_work_scope`；不存在 → `target_missing`。
- **Q03 候选**：`character_profile_revision` 候选（复用既有候选/差异/采纳卡，不新增前端卡）payload：`object_kind/character_ref/character_name/base_fingerprint/changes[{field,old,new}]/effects:["character_field_update"]/other_character_changes/adoption_effect`；候选可见对象与旧→新；未采纳零写入。
- **Q04 effects 白名单**：首闭环只允许 `narrative_role`（值来自 AU09 NarrativeRole；允许多主角）；`role/summary/aliases` 等后续扩展；非法字段 `unsupported_field`、非法值 `invalid_character_role`；「唯一主角/替换原主角」不得默认清空/改其它角色，必须把其它角色变化放入 `other_character_changes` 供作者逐项裁决，未裁决只改目标。
- **Q05 采纳 effect**：同一 `Ecto.Multi` 内 update 同 `character_id`（角色数不增、不改其它角色/work），失败整体回滚；审计/trace 记录 `character_ref/field/old/new/base_fingerprint/effects`，receipt 保留旧值供回滚（不新增字段历史表，除非后续证明不足）；幂等（同 char+changes+fingerprint → `duplicate_apply` 已提交回执）；stale fingerprint → `stale_base` 零写入；错误码 `target_missing/target_ambiguous/stale_base/unsupported_field/invalid_character_role/cross_work_scope/duplicate_apply/partial_failure/unsupported_effect`。
- **Q06 记忆一致性**：Character 主档案为唯一事实源；首版**不写** CHARACTER_PROFILE 记忆（避免双事实源）；若后续同步，必须同一次采纳同源写入并 supersede 旧 profile memory（同 source_ref），禁止 memory-only 冒充；历史矛盾 memory（stage `9e4266e1…`）只读影响清单、清理需另行授权。
- **Q07 消费者**：StructurePanel/角色档案、roster、archive_read characters、判断/写作 character facts、memory_recall、摘要/问答（「谁是主角」）以 Character.narrative_role 为当前事实；采纳后刷新/再问一致；旧值只留 history/trace；memory 不再作为主角当前事实。
- **Q08 证据/回归**：新真实 Tauri 场景（自然原话/别名/同名消歧/多主角/负例/刷新再问）+ 实模原话/改述（CP4）+ 回归 AU09/AU12 当前场景；不得仅以 memory 行出现“主角”判通过；stage 存量修复需单独授权。

### 6.3 CP1/CP2 实施记录（2026-10-25，`601518e9`）

- **CP1**：`CapabilityRegistry` additive `revise_character_profile`（provider none、write_scopes ["character_dossier"]、effect_summary「修订既有角色主档案字段，不新建角色、不写正文、不冒充角色演化记忆」）；`JudgmentToolContract` nullable `character_ref`；判断 prompt「角色索引（已有角色）」+ 修订规则 + `validate_character_profile_route` 机械 gate（身份修订意图必须 execute+该能力并绑定唯一 character_ref；回退 reply/character_evolution/character_design → 纠错；同名/别名歧义 → ask_author 列候选；设计/创建新主角仍 character_design）；`CharacterProfile` 读 `character_profile_context`（仅 ACCEPTED/EDITED_ACCEPTED）→ `PendingArtifactWorkflow` 零写库/零 provider 候选 `character_profile_revision`（payload object_kind/character_ref/character_name/base_fingerprint/changes 单条 old→new/effects/other_character_changes=[]/adoption_effect + display-only `suggested_other_character_changes`）。
- **CP2**：`character_profile_context/1,2` 读端口（角色索引/同名分组/base_fingerprint=sha256(id|name|aliases|narrative_role|role|summary|status|updated_at)；target_missing/cross_work_scope）；`revise_character_narrative_role/5` 原子更新（NarrativeRole 合法值、同 work、fingerprint stale、同 id 只改 narrative_role、角色数/其它角色/正文不变、失败回滚、幂等 duplicate）；`AdoptionWorkflow` `character_profile_revision`/`adoption_effect.mode="character_field_update"`（校验单 change/old+new/effects/other_character_changes=[]；回执 `committed_changes`/`character_ref`/`base_fingerprint`(旧)/`current_fingerprint`(新)/`object_count`；不调 writer、不新建角色、不写 CHARACTER_PROFILE memory）。
- **测试/门禁**：application 921/0、persistence 318/0、agent 273/0，全后端 2179/0；compile/test -Werror/format/credo 0/enum/xref/arch/adr、I1/I2/I3 全绿。CP3 消费者（task-73）进行中。

### 6.4 CP3 实施记录（2026-10-25，`65ef9f8f`）

- **判断/写作上下文**：`AuthoringTaskPolicy` 判断规则新增事实优先级「角色叙事身份以 Character.narrative_role 为当前事实；记忆/摘要旧主角描述只是历史，不覆盖当前字段；多主角照实全列、无主角诚实」；writer/使命 character reader 与判断同源（WorkArchiveRepo.characters）。
- **roster/档案/StructurePanel**：后端读取者直接读 Character 主档案；integration test 证明采纳 ENSEMBLE_POV→PROTAGONIST 后同 ref/角色数不变，CharacterProfile 读端口、WorkArchiveRepo.characters、CharacterRosterNarration 同批返回新值。
- **「谁是主角」问答**：`slice_verify` 新增确定性回答（从判断 prompt 角色索引当前 narrative_role）：单主角姓名、多主角全列、无主角诚实、无索引不猜；正式产品走判断模型基于同一索引。
- **memory_recall/摘要**：角色身份类记忆查询追加「当前角色主档案为准：主角=…；旧身份描述属历史」注记；不清理历史 memory（只读影响清单）。
- 测试：application 924/0、agent 275/0；全后端 2184/0；compile/test -Werror/format/credo 0/enum/xref/arch、I1/I2/I3 全绿。CP4 真实 Tauri/实模（task-74）进行中。

### 6.5 CP4 完成记录（2026-10-25，`81fb7f0e`）

- **确定性真实 Tauri（注册）**：`b29-existing-character-role-revision` `quality_accept --surface tauri` PASS，**23/23 checks/5 trials**；实测：judgment `execute/revise_character_profile` + `character_ref`；候选「沈砚 · 叙事身份修订」`narrative_role: ENSEMBLE_POV→PROTAGONIST`；保存后同 `character_id`、角色数 4→4、ID 集合不变、其它角色（顾青 PROTAGONIST）/正文 hash/记忆不变；receipt `committed_changes[{field:narrative_role,old,new}]` + `character_ref` + base/current fingerprint；同名「指定沈砚为主角」→ await_author 列老沈/小沈零写入；讨论→reply 零候选；刷新/重开档案主角标签；追问「现在谁是主角？」→「当前作品有 2 位主角（群像）：沈砚、顾青（以角色主档案为准）」；放弃原值不变、重复采纳幂等、跨作品零写入。证据 `artifacts/slice-verify/b29-existing-character-role-revision-tauri/`（保护副本 `...-b29-cp4-det-pass-20261025T0740/`）。
- **注册**：scenarios.yml（nightly/tauri）+ b29 manifest active + README + runner；`B29_CP4_PHRASING` strata model-only 证据分支（env 门控，不注册判据）；quality_manifest_check passed。
- **回归**：AU12 PASS（`45ff2997` 修 `fact_inventory` 动态 atom badarg）；AU09 PASS（`0f02f1c9`/`11e96d8c`/`05e83706` fixture 三连 + `81fb7f0e` 契约更新：主角查询改为只读判断基于 Character.narrative_role 角色索引/主档案事实（允许无 tool）+ 零生产写入；design `character_design` 按 run 关联 turn_ids 匹配；保留 adoption/archive/character_count/新主角/no-write 断言）；B28/B30 不回归。
- **实模**（`strata/iq3_s` 单槽，POST-FIX）：original「指定沈砚为主角」（同名）→ await_author 澄清零写入；paraphrase「让老沈当这部书的主角吧，别改动其他角色」→ judgment revise_character_profile + `character_profile_revision` 候选 + 零写入；discussion「老沈适合当主角吗？只讨论」→ reply 零候选；before 对照（trace bug 修复前）保留；未调提示词/未放宽守卫/未重跑换分。
- **CP4 期间修复**：`deaad520` 角色修订候选 trace 完整构造（badkey frame_ref）；AU12 产品 atom bug；AU09 三处 test-support 缺口。

### 6.6 CP5 收口记录（2026-10-25）

- **门禁**：compile -Werror、**2194 tests/0**（common 96/domain 378/agent 285/persistence 318/application 928/web 133）、test -Werror、repo format、credo strict 0、enum/xref/arch/adr；前端 typecheck/lint/**603 tests**、frontend_audit、check_design_trace；quality_manifest_check；**I1/I2/I3 全 PASS**；静态扫描/task-done。
- **真实页面**：B29 场景注册 nightly PASS 23/23；AU09/AU12 回归 PASS；B28/B30 不回归；证据/保护副本/失败批次保留。
- **known limits（如实登记）**：① 首闭环仅 `narrative_role` 字段修订（role/summary/aliases 等后续）；② `other_character_changes` 首闭环在采纳侧拒绝（候选 display-only 建议），多角色同批/唯一主角替换需逐项确认另立任务；③ stale/并发竞争在真实页面无并行写入注入入口，由 CP2 单测/守卫覆盖；④ 历史 CHARACTER_PROFILE memory 不清理（只读影响清单），stage 矛盾记忆清理需作者单独授权；⑤ 实模只证判断绑定/候选或澄清（单轮），不证采纳后产品链（确定性场景覆盖）；model-only harness 非注册判据。
- **完成判定**：CP0 复现→CP1 能力/绑定/候选→CP2 原子更新/采纳→CP3 消费者→CP4 场景/回归/实模→CP5 门禁/台账齐备；B29 done。后续字段扩展/唯一主角替换/历史数据清理另立任务。

### 2026-10-25 完成审计与原生补验

当前只重开原生交互证明，未回滚已验证的实现或浏览器结果。证据对账与作者裁决见 [既有对账任务](VS00D-G-GAP-RECONCILIATION.md) 的队列完成审计；机器证据 `artifacts/completion-audit/20261025-1817/surface-audit.json`。后续复用本 slice 原验收矩阵，以外部系统 UI 驱动真实窗口，保留源操作/WS/持久状态和截图；原批次只读，不修改判据。

### B31原生补验发现的身份意图误判（2026-10-25，CP0→修复）

- CP0事实：A3的T3协议前提通过真实Channel进入生产判断，原生窗口显示失败；两次判断响应均为plan，生产拒绝原因为 `character_profile_capability_required`。原输入“先读完第01章正文，再调整章节大纲，最后更新主角当前状态”被 `CharacterProfile.revision_intent?` 的全句role AND verb误判为身份变更。证据 `artifacts/slice-verify/b31-native-20261025-a3/run/`（llm-calls、app-log、protocol-seed、CP0截图/AX、独立DB）。尚未进行被测UI输入，不把此证据当B31通过。
- 愿景裁定：自然语言由模型判断，确定性守卫只约束已证实的身份变更，不凭跨分句词语组合改写作者意图；这属于既有B29契约实现缺陷，不改验收判据。
- Contract：B29 §6.2 Q01/Q02及UA-01判断协议；区分叙事身份变更、状态演化和章节调整。Invariant：明确身份变更仍必须revise_character_profile+唯一ref；无身份变更不能误挡合法plan；不产生canon写入。
- Boundary：只调整application的CharacterProfile判定及测试；agent/domain/persistence/web/frontend生产路径不改。Consumer：JudgmentProtocol原有角色路由守卫及候选编排。
- Proof：先新增跨分句/同分句状态负例与身份正例，保留red；再跑生产JudgmentProtocol与真实AgentRun计划链回归、后端门禁/I1–I3/静态扫描。
- Acceptance Driver：已有native B31外部CUA+传输代理，保留原输入和完整矩阵；修复后一次scoped复验，仍失败按原预算升级。产品验收感知逻辑=no。
- Exploration：非要素物化，仅修正判定；既有角色探索与候选采纳边界保持。
- 离线预算：新增确定性测试red→green各一次，失败据日志定位；真实模型0。证据 `artifacts/slice-verify/b31-native-repair-20261025/character-route/`。旧A3保持只读。

- 修复/局部证据：新增两项回归先红（74 tests/2 failures，错误与A3一致），修复后角色/协议/计划82/0。新增真实AgentRun原话测试初次因测试DB沙箱归属失败，修正测试归属后9/0，原输入进入judgment_plan_v1、plan_exhausted_without_completion、goal v1、零候选；这条失败不归产品。实现限于同分句明确身份赋值关系，正向修订及歧义/错误能力纠正测试保留。

- 该误判修复已由B31 A4真实原生T1/T2输入及T3–T5前提贯通验证，后端2247/0、I1–I3、xref/arch和扫描闭环通过。只关闭本项角色意图误判，不替代B29完整角色采纳/后续消费的原生矩阵；B29仍按NEXT排期补证。

- 后续验收倾向按作者最新反馈同步：确定性替身仅作工程回归；主业务结案需要真实模型经原生入口完成判断/必要提问、候选、采纳和后续事实消费。沿原任务语义与数据断言，不以模型调用次数或脚本预设路线作为成功替代。

#### 2026-10-27 完成审计后的原生补验（确定性矩阵 + 真实模型 scoped）

- **背景**：完成审计指出原 canonical summary 为 `surface=browser / driver=headless-chromium`；作者保留原生标准补验、不重跑真实模型矩阵换分。新增 `scripts/native_b29_drive.mjs` / `scripts/native_b29_evidence.mjs`（外部 AX/CGEvent 操作真实窗口）与 runner 的 b29 native allowlist/verify 分支。
- **确定性原生批次**（`artifacts/slice-verify/b29-existing-character-role-revision-native/`，provider=slice_verify，scope=full_deterministic_matrix，canonical_registered=true）：**23/23 checks / 5 trials PASS**，check 键与浏览器 `driveB29ExistingCharacterRoleRevision` 同名同义。实测：judgment `execute + revise_character_profile`；候选 沈砚 `character:9e09a0d2…` ENSEMBLE_POV→PROTAGONIST、effects=["character_field_update"]、other_character_changes=[]；原生「保存到作品」receipt committed_changes/character_ref/base+current_fingerprint/state_trace 齐全；同 id 更新、角色数 4→4、ID 集合不变、顾青仍 PROTAGONIST、正文 hash/记忆不变；T2 同名 await_author 零写入；T3 讨论零候选零写入；T4 关闭重开+档案角色 tab+「现在谁是主角？」→ 2 位主角（沈砚、顾青，以主档案为准）；T5 放弃 receipt status=discarded 原值不变、重复采纳零写入、跨作品零写入；生产指纹测量期间不变。13 组原生截图/AX、transport/app-log/llm-calls、只读 DB checkpoint、45 条分型等待（0 timeout）。
- **驱动缺陷修复（如实登记，不改产品断言）**：① discard 的 `action_result.status` 实为 `discarded`（accept 才 accepted）——等待匹配改为 `accepted|discarded` 并保留 artifact_id/action_id 归属；② 关闭重开后前端通道会以**同一 turn_id 重放**本地待发 user_message（浏览器 canonical 亦有 8 frames vs 7 逻辑输入）——判据改为按不同 turn_id 计逻辑输入，重放帧记入 measured。失败批次（`...-failed-discard-receipt-status-20261027T0121`、`...-failed-verifier-logical-input-count-20261027T0131`）只读保留。
- **真实模型 scoped 批次**：待执行（T1 正例 + T2 同名零写入；strata/iq3_s，模型生命周期卸载验证；不冒充 23/23 矩阵）。

#### B29 strata scoped 真实模型结果（2026-10-27，三次尝试后收口）

- **批次**：`artifacts/slice-verify/b29-existing-character-role-revision-native-strata/run/`；provider=strata/iq3_s、driver=ax-native-system-ui、`scope=scoped_real_model`、`canonical_registered=false`、trials=T1/T2；明确不冒充 23 项确定性矩阵。
- **T1 正例 PASS（19 项相关 checks 全 true）**：真实调用（llm-calls provider=strata、usage.model=iq3_s、HTTP 200；Strata `/api/serving` 3 条真实推理）；judgment `execute + revise_character_profile`；候选 沈砚（老沈）`character:12e9d3df…` ENSEMBLE_POV→PROTAGONIST，原生卡面可见 old→new 与「保存到作品」；原生采纳 receipt committed_changes/character_ref/base+current fingerprint 齐全；DB 同 id、角色数 4→4、ID 集合不变、顾青仍 PROTAGONIST、正文 hash/记忆不变。
- **T2 同名澄清未复现（2 项冻结判据 false，按预算不重跑）**：输入「指定沈砚为主角」（存在两个同名「沈砚」）时，真实模型本轮**未走 await_author**，而是 `action=execute revise_character_profile`，沿用上一轮「老沈」上下文把 ref 绑到 `character:12e9d3df…`（已是 PROTAGONIST），产出 **old=PROTAGONIST → new=PROTAGONIST 的 no-op 候选** `as_mvpjqleg_15`。模型原文理由：“上一轮「老沈」已唯一指向…本轮「沈砚」沿用同一对象语境…不猜另一个同名角色”。`same_name_asks_author=false`、`same_name_zero_write=false`（判据要求 pending 为空；本条 pending 1 个 no-op 候选）；**DB 零写入仍成立**（t2-before==t2-after 角色/记忆/正文 hash 全同），未采纳/未 steer/未自动作答（author_question_events=[]）。
- **未改判据/未放宽守卫**。三次尝试（1st 作者问答误分类、2nd AXHelpTag 抖动、3rd 本结果）均只读保留；模型生命周期：跑前 loaded=null 记录、结束 POST unload 200 → GET loaded=null/current=null，lms ps 仅作者 embedding IDLE。
- **新发现（需作者/后续裁决，不在本 slice 擅自改产品）**：① 产品允许 `old==new` 的角色修订 no-op 候选（本轮真模触发）——是否在候选/采纳侧拒绝 no-op 属产品契约硬化项（候选 B41 类）；② 真实模型在多轮上下文中按前文实体绑定消歧，与 T2 冻结判据「同名必须澄清」存在行为差异（模型行为 known-gap，非 harness 失败）。B29 主业务闭环以确定性原生 23/23 + T1 真实模型全链证据承载；T2 真实模型行为差异如实登记，不冒充通过。

#### 2026-10-27 对账承接

- 上述 no-op 与同名歧义已单独立项为 [B48-character-revision-noop-and-ambiguity](B48-character-revision-noop-and-ambiguity.md)，状态为 blocked、待作者选择“拒绝无意义 no-op / 显式幂等回执 / 仅收紧歧义”后再实施。B29 主业务保持 done，不重开；T2 不记 PASS，裁决前不改产品。
- 2026-10-30 后续裁决：作者已明确 C04=A；选择、执行状态与四场景验收统一见 [B48](B48-character-revision-noop-and-ambiguity.md#6-c04-裁决记录)。本段仅追加承接事实，不改写上述历史 T2 结果。

## 2026-10-30 后置语义路由整改交接

“讨论一下把陆晨指定为主角是否合理，先不要生成候选。”在现役角色意图谓词/后置 guard 中仍可能被强制要求修订能力；这是共享语义判断与机械守卫分工的问题，不重开本任务已完成的主档案修订业务。该机制族统一交 [B33 元原则整改](B33-authoring-intent-judgment-reliability.md#元原则整改语义判断与机械守卫分工)，此处不另设状态或 CP。

B33 负责讨论/条件/合法回复与实际执行的共享入口；本任务继续提供真实角色身份、白名单字段、候选/采纳和现有回归边界。[B48](B48-character-revision-noop-and-ambiguity.md) 仍是 C04=A 的 no-op/同名消歧业务结果唯一 owner；不因允许普通回复而降低身份、权限或作者采纳保护，也不将历史 T2 改写为 PASS。
