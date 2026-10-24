# B29：已有角色叙事身份修订与主角事实一致性

- 状态：**doing / CP0 完成（2026-10-25，真实 Tauri 隔离复现 + 契约冻结）**：当前版本无「已有角色主档案字段修订」能力——自然原话被 reply 吞掉、显式措辞才诚实 capability_gap；character_evolution 只写演化记忆、character_design 只新建角色；Character.narrative_role 未变且未用 memory 冒充。CP0 冻结见 §6，CP1/CP2 进行中。
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
| CP1 | 应用可调用的已有角色修订候选与领域校验；模型看见真实操作和对象，旧能力缺口保持诚实 | todo |
| CP2 | 作者采纳→同一角色更新→审计/投影/记忆一致；幂等/并发/失败回滚 | todo |
| CP3 | 档案、花名册、探索、后续判断/写作同批消费；真实 Tauri 自然输入、采纳、刷新、再问闭环 | todo |
| CP4 | 实模改述/必要澄清对照、全门禁；同步 AU09 CP2/NEXT/journey/ledger | todo |

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
