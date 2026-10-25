# B29：已有角色叙事身份修订与主角事实一致性

- 状态：**done（2026-10-25，CP0–CP5；真实 Tauri 23/23 checks 注册 PASS，AU09/AU12 回归 PASS，实模 canonical PASS）** / CP0（2026-10-25，真实 Tauri 隔离复现 + 契约冻结）：当前版本无「已有角色主档案字段修订」能力——自然原话被 reply 吞掉、显式措辞才诚实 capability_gap；character_evolution 只写演化记忆、character_design 只新建角色；Character.narrative_role 未变且未用 memory 冒充。CP0 冻结见 §6，CP1/CP2 进行中。
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
