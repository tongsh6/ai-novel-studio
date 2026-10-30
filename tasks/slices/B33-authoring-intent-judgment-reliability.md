# B33 真实模型下创作动作判断路由可靠性（P1 复验暴露）

- 状态：**done（2026-10-25，CP0–CP4；canonical-3e 验证路由修复）**：H2 上下文膨胀/冗余强贡献（`## 消息处置与已有产物` 字节级重复 2 次；ch02 裁剪后恢复 execute）、H3 规则/目录不足以绑定 execute、H4 模型边界非唯一根因、design_character 另有能力映射缺口；冻结 CP1 上下文去重/裁剪 + CP2 动作意图有界纠错 gate/prompt 规则 + CP3 诊断事件 + CP4 scoped 复验。CP1/CP2 进行中。
- 类型：判断/上下文可靠性承重 slice（不新增产品能力；修正既有判断链在真实模型长上下文下的路由）
- 来源：P1-AUTHORING-DOGFOOD canonical（`artifacts/novel-output/p1-authoring-dogfood-2026-10-25/`，2026-10-25，Strata `iq3_s`）24 次 wrong-route + 维护 2/5
- 关联：[VS00D 真实创作复验](VS00D-G-GAP-RECONCILIATION.md#真实创作复验)（P1）、B27 判断/上下文矩阵、B26 单调用判断协议、D15

## 1. 问题事实（P1 canonical，非 patch 式重跑）

- 10 章连续创作中，同一类自然输入「第N章正文还没写，帮我写出来吧」在前期章成功（01–04/06/07/10 最终成功），但在第02/05/07/08/09/10 章共 **24 次**被 judgment 判成 `reply`/`creative_directions`/`await_author`（返回章计划说明/写作建议/讨论），runner fail-fast 后重试；部分章耗尽重试被跳过（08/09 空章）。
- 维护请求同样误路由：design_character → `creative_directions`（3 方向）而非 `execute+character_design`；content_revision → `await_author`（runner 未给具体段，属真实歧义需消歧，由 P1 runner 修复明确目标段）。
- 判断调用输入约 70k chars；judgment input token 中位：execute 23.3k、reply **32.4k**（range 11.8k–37.9k）、creative 25.1k、await 27.0k；temperature=0.2（`judgment_protocol.ex:41`）。正文本身无失控/32k 截断（重复段 0），writer 11 次、26 重试均为路由失败。
- 无错对象/错绑/越权写入/虚报完成证据；B9 确认 3 次均显式。

## 2. 待验证假设（CP0）

- H1 模型随机性：temperature 0.2 下同一失败 prompt 重放是否仍误路由（分布）。
- H2 上下文膨胀/冗余：judgment prompt 含约 70k chars（含重复 `## 消息处置与已有产物`、plan track/观察/候选等）；截断/去重/按任务裁剪后是否恢复 execute。
- H3 能力目录/规则不可达：`## 当前可用操作`/决策契约对「写某章正文」的映射是否被模型正确消费（同 prompt 小上下文试）。
- H4 模型能力边界：iq3_s（IQ3_S 量化 MoE）在长上下文的指令遵循退化；决策不是模型适合性结论，但产品须对可解释失败收敛。

## 3. 拟冻结契约（CP0 后细化）

- 作者明确要求创作动作（写/续写某章正文、设计角色、修订某章内容）时，judgment 必须 **execute 且绑定 capabilities/对象**；无法绑定时只能 `ask_author`（具体缺口/对象）或 `report_capability_gap`，**不得**用 reply/creative_directions/await_author 吞掉动作意图。
- 机械校验/有界纠错（复用 B29/B30 字段级纠错模式；不做关键词路由器）：检测「作者动作意图 + 无 execute/无候选」→ 一次纠错；仍失败则诚实 ask/gap 并记录 trace/事件（可计数、可诊断）。
- 判断上下文预算/选择：按任务裁剪/去重，不把完整 plan track/候选/历史无差别塞入；上下文长度与所选段可 trace。
- 目标：P1 scoped 复验（同输入类型/维护拍）wrong-route 显著下降且无新增错对象/越权；不复跑整批换分。

## 4. CP 计划

| CP | 工作 | 证据 |
|---|---|---|
| CP0 | 读 P1 证据 + 真实模型受控重放（H1–H4，单槽、模型已常驻不额外加载；≤15 calls），冻结根因/契约 | `artifacts/model-contracts/b33-cp0/` |
| CP1 | 上下文裁剪/去重（判断输入）与 trace；确定性测试 | 后端测试/记录 |
| CP2 | 有界纠错/校验 gate（动作意图无 execute → 纠错/ask/gap），不降级 schema | 后端测试 + trace |
| CP3 | 消费者/计数/诊断（wrong-route 事件、P1 runner 语义对齐） | 测试 + 场景 |
| CP4 | 真实模型 scoped 复验（P1 记录输入类型 + 维护拍）+ P1 runner 修复后维护回放 | 模型证据 + `artifacts/slice-verify` |
| CP5 | 门禁/台账/P1 收口判定 | 全门禁 |

## 5. 边界

- 不改 frontend/src、novel_common、验收 hook；不做关键词路由器/模型分档；不降低 schema 校验；不服务端补字段。
- 真实模型调用单槽、既有 native iq3_s 常驻（不新增加载）；LM Studio 不得加载。
- 禁止用「重跑整批」替代根因修复；复验仅针对已登记失败类型。

## 6. CP0 记录与契约冻结（2026-10-25）

- **诊断证据**：`artifacts/model-contracts/b33-cp0/{diagnosis.md,cases/*.json,replay-summary.json,p1-input-stats.json}`；15 calls（P1 记录 request body、temp 0.2、单槽 iq3_s）。
- **H1 纯随机：不成立（部分现象）**：同 prompt 2/2 不 execute；action 类型有漂移但「非 execute」稳定，不能靠重试解释/修复。
- **H2 上下文膨胀/冗余：成立（强贡献非充分）**：`## 消息处置与已有产物` 精确重复 2 次（双份 7.6k–38.6k chars）；ch02 裁剪 prompt 11,825→6,849 tokens 后恢复 execute prose_writing；ch07/ch09 裁剪后仍 explore。
- **H3 规则/目录不可达：成立（不足）**：极简版（~4.9k tokens：作者输入+能力目录+契约）3 写章全 explore、design ask_author，无 execute。
- **H4 模型边界：部分成立（背景非唯一）**：同章成功/失败 prompt 长度相近（ch07 33.7k vs 32.0–33.4k）；极端裁剪仍不 execute。
- **design_character 额外缺口**：original→creative_directions、trim→explore、minimal→ask_author；上下文裁剪不能修复，属能力/动作映射缺口。
- **综合根因**：过长/重复判断上下文 + 模型在缺省事实下保守（explore/ask/reply）+ 产品无「动作意图必须 execute/ask/gap」机械约束；design 另有映射缺口。

### 冻结契约（B33 v1，2026-10-25）

1) 作者明确动作意图（写/续写/重写某章正文、设计角色、修订某章内容）时，judgment 终局只允许：`execute + 对应 capability + 真实对象 ref`；`ask_author`（缺对象/段/范围，问题含具体候选/缺口）；`report_capability_gap`（能力确实不支持）。**reply / propose_creative_directions / await_author 不得作为终局**。
2) 违反时允许**一次**有界纠错（要求 execute/ask/gap + 契约骨架，原 task/输入/对象范围不变；不做关键词路由、不扩范围）；仍违反 → 转 ask_author 具体澄清或 capability_gap，并记录 `judgment.wrong_route`（字段 author_intent/action/capability/target_ref/prompt_tokens/correction_attempted/terminal_reason，可计数）。
3) 上下文：判断 prompt 必须去重（同一 section 字节级重复=0）；按 profile/任务裁剪（写作判断保留作品事实+章节列表+作者输入+能力目录+契约，去掉完整 plan track/全量候选/会话摘要/无关观察）；记录 prompt_chars/prompt_tokens/selected_sections。
4) 不增加服务端补字段、不降 schema 校验、不换模型/不提高温度/不以重跑整批替代根因；不新增验收钩子。
5) 设计角色→execute character_design（作者明确要方向讨论除外）；内容修订缺目标段→ask_author 具体消歧；已有章计划足够时写正文直接 execute，需要计划事实可 explore 但随后必须 execute，不得以 reply/creative/await 结束。

### CP 计划（更新）

| CP | 工作 | 状态 |
|---|---|---|
| CP0 | 受控重放诊断 + 契约冻结 | done（2026-10-25，15 calls） |
| CP1 | 判断上下文去重/按 profile 裁剪 + trace（消除 `## 消息处置与已有产物` 双份；记录 prompt tokens/sections） | **done（2026-10-25，`33077f0e`）**：根因 dialogue_planning_service 双处渲染；去重后默认 profile 1 次；写作判断 keep-list 20,056→10,633 chars（约 −47%）；`judgment.prompt_diagnostics` |
| CP2 | 动作意图有界纠错 gate + prompt 规则补强 + `judgment.wrong_route` 事件；不降 schema | **done（2026-10-25，`33077f0e`）**：AuthoringTaskPolicy 规则补强；JudgmentProtocol 一次有界纠错（仅 :judgment profile，D7 provider_calls=3 保持）；失败转具体 ask_author + wrong_route 事件；测试全绿 |
| CP3 | 诊断事件/计数 + P1 runner 对齐 + 确定性测试 | todo |
| CP4 | scoped 真实模型复验（S1 写章长上下文/S2 design/S3 content revision/S4 负例/S5 回归；不整批重跑） | **完成（2026-10-25，FAIL：路由修复 PASS，内容修订数据完整性 FAIL）**：design→character_seed、role→character_profile_revision SUPPORTING→PROTAGONIST、S1 第08章 0→1514 字、wrong_route 事件 **24→0**、重试 0；但 content_revision 采纳把整章 1002→116 字（仅 126 字片段被当 complete replace_scope，其他段落丢失）→ 新开 B35；S4 歧义负例 runner 不可构造，留确定性测试。证据 `artifacts/novel-output/p1-b33-cp4-replay-2026-10-25/` |
| CP5 | 全门禁/台账/P1 收口判定 | todo |

### CP4 通过门槛（预注册）

- S1 写正文（长上下文）：execute prose_writing 或 explore 一次后 execute；wrong-route 终局=0。
- S2 设计角色：execute character_design 候选，不得 creative_directions。
- S3 指定目标内容修订：execute revise_adopted_content 或 ask_author 明确目标段，不得无目标 await。
- S4 负例：ask_author 具体缺口、零写入。
- S5 回归：B28/B29/B30 不回归；无新增错对象/越权/虚报；上下文 token 显著下降且重复 section=0；诊断事件可计数。

## 7. CP4 结果记录（2026-10-25）

- 环境：native iq3_s 常驻、canonical DB 副本、不新增加载；维护拍 replay + S1 单章（第08章）。
- **路由/动作修复 PASS**：design_character → `character_seed`（林默）采纳；character_role_revision → `character_profile_revision` SUPPORTING→PROTAGONIST；S1 第08章 0→647→1514 字（explore→execute prose_writing 正常），wrong-route 事件 **24→0**、重试 0。
- **内容修订数据完整性 FAIL**：content_revision 候选仅 126 chars，但采纳 `replace_scope complete` 覆盖整章旧 draft（1198 chars）→ 章节有效字数 1002→116，其他段落丢失；**B35** 修复候选范围声明+采纳覆盖完整性校验；P1 canonical-2 暂停至 B35 scoped replay PASS。
- S4 歧义负例：runner 现有路径无法在不改产品下稳定构造；留确定性测试覆盖，不伪造。
- 不重跑整批、不覆盖 P1 canonical 原证据。

## 8. CP5/完成记录（2026-10-25）

- CP1/CP2 提交 `33077f0e`；CP4 scoped replay：design/role/S1 写章/判断路由 PASS（wrong-route 24→0），content revision 数据完整性缺陷转 B35/B36；CP5 由 P1 canonical-3e final 覆盖：真实连续创作 10 章 wrong-route 终局 0、failures=0、retries=0（canonical 阶段），判断可达性/上下文裁剪/有界纠错成立。
- 剩余限制：纯讨论 route drift 在 2 次模型级 replay 中出现（不影响写库/候选；B33 gate 不强制 discussion reply）；B34 CP3 记录。

## 元原则整改：语义判断与机械守卫分工

- 状态：**doing（2026-10-30 CP0–CP2 done：现役链路核实/契约冻结、词法后置约束移除与矩阵回归完成；CP3 待外部原生驱动 + 真实模型执行窗口）**。本节为 B29/B30/B33 后置词法路由机制族的唯一执行入口。
- 本节承接新的现役机制问题，不重开或改写 2026-10-25 的历史交付。上方 v1“明确动作终局只许 execute/ask/gap”与“一次 explore 后必须 execute”的旧判据不能直接作为本轮目标；当前恢复顺序以本节、[B39](B39-evidence-seeking-authoring.md)、[ADR-0030](../../docs/design/adr/ADR-0030-evidence-seeking-authoring-v3.md) 和 [ADR-0031](../../docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md) 为准。请求必须真实推进、权限与作者采纳边界继续保留。

### 问题与整改方向

当前 `AuthoringTaskPolicy.explicit_action_intent/1`、`ChapterStructureMaintenance.intent?/1`、`CharacterProfile.revision_intent?/1` 的词法识别结果进入 `JudgmentProtocol` 后置守卫；某些仅讨论、条件性无变化或已有证据支持普通回复的输入，会被拒绝并要求指定能力。把该逻辑放在模型输出之后，仍可能由 APP 预定创作语义；注释“不直接路由”不是边界证明。

已保存的 三条纯规则反例（`../../artifacts/task-audit/2026-10-30-principles/b33-probe.json`） 只证明当前谓词/guard 行为，未调用模型、数据库或页面，不能替代正式回归。`application_wrong_route_fallback` 明确标记应用来源，本次不将它指控为伪造 provider 字节；要修的是词法分类失败后，应用又替作者推断缺口并发出通用澄清的认知分工。

- **模型负责**：在现有判断调用中理解完整原话、上下文、否定/条件及实际观察，判断该讨论、继续求证、执行、说明无需修改、问作者或诚实结束。不得另加前置分类模型或第二控制循环。
- **APP 负责**：提供真实身份/坐标/能力/权限/预算/版本与已取得观察；检查输出结构、真实目标、来源、参数范围、执行许可、幂等、状态和实际结果；不单凭动作词或话题词替模型选能力、否决有依据的回复或把未执行说成完成。
- **作者负责**：作品方向与权威采纳、高影响取舍，以及确实无法通过现有材料解决的歧义。不能因为系统词法门失败，就要求作者重复已给出的目标或用工具名重述原话。

整改不是删除全部守卫：必须保留合法输出组合、原文/观察来源、真实目标/跨作品隔离、能力可用性、权限与预算、版本/幂等、已发布未答问题的保护、采纳与 I1/I2/I3/N-NARR。无效结构仍可有界纠正；纠正只针对实际违反的契约，不以纠正提示重新预定作者语义。模型错判也不能因格式合法就被算作通过，须有真实语义反例与实际效果证明。

### CP0 记录（2026-10-30 done）

- 证据：`artifacts/task-audit/2026-10-30-b33-semantics-cp0/cp0-map.json`（现役链路、三反例当前行为、冻结契约、CP3 预注册）；纯规则反例 `artifacts/task-audit/2026-10-30-principles/b33-probe.json` 的 6 份源码 sha256 已逐一复算，与当前工作树一致（probe 证据仍对应当前代码）。本节只读核实，未调用 provider/模型/数据库/页面。

#### 现役链路映射（语义责任 → 实际输入/观察 → 结果 → 机械检查）

| 语义责任 | 当前实现与调用点 | 实际读取 | 结果/终局 | 问题 |
|---|---|---|---|---|
| 创作动作意图 | `AuthoringTaskPolicy.explicit_action_intent/1`（:58-71），唯一调用点 `JudgmentProtocol.validate_action_intent_route/3`（:333-352） | 仅 `author_text` 词法；不读 observations、否定/条件、真实结果 | reply/creative/await → `:action_intent_requires_execute` 一次纠错（:271-289）；第 2 次仍违反 → APP `fallback_action_intent_judgment/4`（:411-430）生成 `await_author` 澄清，`application_wrong_route_fallback`（:446-459）+ `judgment.wrong_route` | 词法命中即可否决有依据的回复；条件性 no-op/已取证无变化被当作“吞掉动作”；APP 代写澄清 |
| 章节结构维护 | `ChapterStructureMaintenance.intent?/1`（:16-24），唯一调用点 `validate_maintenance_route/3`（:834-852） | 仅 `author_text` 词法；不读 `discussion_only`/observations | reply → `:maintenance_capability_required` 纠错（:189-196）；耗尽 → `{:error,{:judgment_protocol_violation,...}}`（整轮失败） | “只解释”也被强制走维护能力 |
| 角色身份修订 | `CharacterProfile.revision_intent?/1`（:97-110），唯一调用点 `validate_character_profile_route/3`（:856-878） | 仅 `author_text` 词法；谓词内部讨论豁免会被“指定/确立/改判/设为/定为/调整为”抵消 | reply → `:character_profile_capability_required` 纠错（:167-176）；耗尽 → 整轮失败 | “讨论+先不要生成候选”被强制修订能力 |
| 讨论/否定/条件 | `TurnInteractionService.discussion_only?/1`（:249-253）→ options（:714-715） | 只被 action-intent guard 读取；维护/角色 guard 不读 | 讨论只豁免动作意图 guard；`discussion_only_violation` 仅约束 creative/author-registration（:942-950） | 豁免面不一致；否定/条件无任何机械读取 |
| 观察/取证 | `options.observation_count`（:709） | 只用于 `await_author` 的 anaphoric explore-before-ask（:960-970） | 三条词法 guard 不读观察 | “已读证明无错别字”无法改变 revise 拒绝 |
| 下游消费 | `dialogue_planning_service`（:1731/:1936/:1942） | judgment.action/capability/narrative/narrative_source | TurnResult/事件；非 provider output 的 fallback narrative 可见性降 developer；`judgment.wrong_route` 只走 LogEmit | APP 文本进入澄清通道，边界需在 CP1 清除 |

#### 三条反例当前行为（冻结）

1. **条件性错别字修订**：“帮我修改第3章正文中的错别字；如果没有错别字，就告诉我无需修改。”→ `:revise_content`；reply 在 0/1/3 个观察下均被 `action_intent_requires_execute` 拒绝，最终 APP fallback 反而要求作者指出章节/段落。
2. **只解释编号**：“这本书的章节编号为什么采用全书连续编号？只解释，不要修改。”→ 维护意图命中，reply 被 `maintenance_capability_required` 拒绝，耗尽后整轮失败。
3. **讨论主角**：“讨论一下把陆晨指定为主角是否合理，先不要生成候选。”→ “指定”抵消讨论豁免，reply 被 `character_profile_capability_required` 拒绝。
边界：probe 证明当前纯判定/纠偏路径；不证明真实模型已返回这些回复或线上发生事故。`application_wrong_route_fallback` 明确标记应用来源，不指控其伪造 provider 字节；要修的是 APP 从词法分类预定语义方向。

#### 冻结契约（CP1 实现依据）

1. **语义方向归模型**：单一判断调用内由模型理解完整原话、否定/条件、上下文与实际观察，选择 reply/discussion/execute/explore/plan/ask/gap；APP 不因词法命中否决有依据的 reply/讨论/条件性 no-op，也不替模型选能力。
2. **APP 保留客观机械检查**：tool/schema 合法组合；execute capability 在本轮真实目录；目标 ref 存在/唯一/版本/跨作品隔离；权限/预算/幂等；已发布未答问题保护（M06）；作者显式“只聊/先不要生成”对生成/写入操作的禁止；指代历史材料时 explore-before-ask；narrative 必须来自真实 provider 字节；采纳边界与 I1/I2/I3/N-NARR。
3. **删除项**：三个词法谓词 + 三处后置 guard、动作意图纠错/APP fallback 澄清、`judgment.wrong_route` 事件（整改后无生产者）；不新增关键词补丁、classifier、第二控制循环或 schema。
4. **合法终局不新增枚举**：沿用既有 reply/creative_directions/execute/explore/plan/await_author/capability_gap；条件不成立时 reply/no-op 合法且零候选零写入；讨论时 reply 合法且“先不要生成候选”保持。
5. **不减少既有守卫**：B29/B30/B48/B28 的 execute/目标/事务/采纳边界、B35/B36 的零写入与数据完整性不变；本轮只移除“由词法预定语义方向”的机械否决。
6. 交付顺序：CP1 在同一判断主链移除后置词法约束并修正纠错提示/提示词语义；CP2 确定性回归 + 无 provider replay + B43/TurnResult 同源；CP3 真实 Tauri + 真实模型 scoped 验收。

#### CP3 预注册（不执行，先冻结）

- 场景：S1 条件性 no-op（“帮我修改第3章正文中的错别字；如果没有错别字，就告诉我无需修改。”→ 可先取证；条件不成立时 reply 说明无需修改、零候选零写入；若声称已检查必须有真实观察）；S2 只解释编号（reply 解释、零结构候选/零写入）；S3 讨论主角（reply 讨论、零候选/零角色写入、“先不要生成”保持）；S4 明确写章正例（execute prose_writing 或 explore 后 execute）；S5 明确重编号正例（execute maintain_chapter_structure，边界仅列表编号）；S6 讨论期违规候选负例（若模型生成候选/写入，`discussion_only` 机械守卫拒绝并只保留讨论）。
- 驱动：复用 `scripts/native_*` 外部原生 Tauri 驱动（AX/截图/网络帧/app-log/只读 DB 快照），真实产品入口，产品代码零验收感知。
- 证据：`artifacts/slice-verify/<scenario>-tauri/` 的 summary/verdict/native 证据/provider 请求响应/trace/DB 前后快照；失败只读保留，scoped 复验只针对失败类型。
- 资源：真实模型单槽串行；运行前记录 `lms ps`/内存，一次只加载一个；结束/失败/中断必须 unload 并验证为空（LM：`lms unload --all` + `lms ps` 空；Strata：POST `/api/models/unload` 后 `loaded=null`）。无可用资源窗口时 CP3 记 blocked，不伪造 PASS。
- 判定：越权写入、错误身份/版本、讨论期候选、无观察伪报已检查均 fail；stub/确定性只能证明机制，不能替代真实模型行为。

### CP1 记录（2026-10-30 done）

- 实现（同一判断主链；无新增 schema、枚举或调用）：
  - 删除 `AuthoringTaskPolicy.explicit_action_intent/1`、`action_intent_capability/1`、`action_intent_label/1`、`discussion_intent_text?/1` 及其词法正则；
  - 删除 `ChapterStructureMaintenance.intent?/1`；
  - 删除 `CharacterProfile.revision_intent?/1`、`design_new_protagonist_intent?/1` 与 `@role_assignment_re`（`narrative_role_from_text/1`、`resolve_target/3` 等客观绑定保留）；
  - `JudgmentProtocol` 移除 `validate_action_intent_route/3`、`validate_maintenance_route/3`、动作意图纠错、`fallback_action_intent_judgment/4`、`application_wrong_route_fallback`、`judgment.wrong_route` 事件与三条对应 `correction_content`；`validate_character_profile_route/3` 收窄为“execute revise_character_profile 的真实目标/角色值校验”；
  - `AuthoringTaskPolicy.judgment_rules` 只增加条件句/否定限定/讨论语境的语义指导（模型职责），不新增关键词路由或补丁集。
- 保留的机械检查：tool/schema 合法组合、execute capability 在本轮目录、目标 ref 存在/唯一/版本/跨作品隔离、M06 未答问题保护、`discussion_only` 显式限制守卫（仅生成/写入操作）、指代历史材料时的 explore-before-ask、narrative 必须来自真实 provider 字节、采纳与 I1/I2/I3/N-NARR。
- 正式回归：三条反例的 reply 直接通过（1 次 provider 调用、无纠错、无 `wrong_route`、`narrative_source=provider_output`）；明确写章/设计角色/修订/重编号正例仍 execute；讨论期违规候选仍有界纠错、耗尽结构化失败；工具参数错误仍一次纠错，纠错后普通回复由模型决定；reply narrative 仍可 verify 到真实 provider 字节。
- 测试与门禁：`judgment_protocol_test` 70/70；后端全量 **2344 tests / 0 failures**；`mix compile --warnings-as-errors`、`mix format --check-formatted`、`mix credo --strict`（no issues）、`mix xref`（No cycles）、`scripts/arch_check.exs` 通过。B29/B30 历史词法谓词用例已删除或改写成 CP2 矩阵；其 execute/目标/候选/事务测试保留。

### CP2 记录（2026-10-30 done）

- 扩展矩阵（`judgment_protocol_test.exs`）：条件性 no-op、条件修订、只解释编号、讨论主角、先别改再讨论、只分析共 6 条自然输入 × reply 直接通过；写章/设计角色/修订/重编号 4 组对照正例仍 execute；讨论期违规候选有界纠错 + 耗尽失败；工具参数错误一次纠错；reply narrative 绑定真实 provider 字节。
- 有界恢复：`discussion_only_violation` 连续两次 → `{:error, {:judgment_protocol_violation, ...}}`，不静默放行；结构错误纠错后由模型决定后续动作（不代写终局）。
- 决策/trace/结果同源：judgment `narrative_source` 仍为 provider output（测试 verify），`judgment.wrong_route` 字段/事件已无生产者且不进入 TurnResult；全量后端套件（含 B43/B41 等既有测试）0 失败。
- 历史读取与 no-provider replay：`ReplayService` 14/14（含“replay report does not call provider”）、`TraceReplayService` 6/6 通过；本轮不重跑真实模型。
- 证据：`artifacts/task-audit/2026-10-30-b33-semantics-cp12/{judgment-protocol-test.log,mix-test.log,replay-tests.log}`。
- 残余：`discussion_only?` 对“先不要生成候选”这类否定式物质化词仍会把“生成/候选”当作物质化而不触发守卫——该反例的机械兜底退化为模型自律，登记待 B34 语料/后续整改；明确动作请求若模型选择 reply，APP 不再机械否决，是否真正推进由 CP3 真实模型证据判定，不能用确定性测试代签。

### 本轮开工七问

1. **Contract**：ADR-0030/0031、UA-01 单调用/author_question/AgentRun、B27 共同任务语义、B29/B30 的真实维护能力契约，以及 C04=A 的普通无变化说明。CP0 先沿现有载体列清语义结果与机械检查，不在本文预造新枚举或 no-change 业务回执。
2. **Invariant**：条件、否定和讨论限制不因词汇命中被覆盖；模型判断所需作品事实可经授权探索获得；有依据的无变化/缺口回复不被强制变更；需要执行时确实调用匹配能力，不能用回复吞掉已明确可完成的请求。越权、错误身份、过期、未采纳写入、重复副作用与虚报完成仍被阻止。
3. **Boundary**：application 的共享语义、JudgmentProtocol 校验/纠错/终局、既有角色/结构 helper 与结果链；domain 仅纯身份/参数/版本规则，agent 复用 ProviderExecution；必要 web/frontend 只消费现役决策/问题/结果。不得为此恢复 Router-first、旧两段式、额外 classifier、另一套运行时或修改 provider 适配语义。
4. **Consumer**：真实工作台的普通讨论、章节内容修订、角色身份修订及章节编号问答/维护；后续 Orchestrator、B43 统一裁决、TurnResult/Why/replay 消费同一真实结果。
5. **Proof**：把下方三条纯规则反例落实为原实现会失败的正式测试，并补实际必须执行、真实缺目标/无权限/失效和纠错耗尽负例。局部机制证明与真实模型能否保留完整条件意图分开；观察须进入后续真实请求，不能只增加日志或一条“允许 reply”的白名单。
6. **Acceptance Driver**：复用外部驱动的当前原生 Tauri 工作台，输入普通自然语句并经历必要读取、回复/候选、明确采纳和刷新/回放；记录网络、provider 输入输出、trace 与持久事实。具体场景/driver 在 CP0 预注册；产品验收感知逻辑 **no**，真实模型按具体资源窗口执行。
7. **Exploration**：复用已有 chapter/character/结构读取与 B39 观察链；讨论不强迫读库，条件判断需证据时模型自主取证。来源/版本/覆盖与后续请求同源可查，不能用专用 packet 预装反例答案。

### 三条反例与正式回归要求

| 已确认的原话 | 当前纯规则行为 | 正式回归必须证明 |
|---|---|---|
| “帮我修改第3章正文中的错别字；如果没有错别字，就告诉我无需修改。” | 被识别为 revise_content；0/1/3 个观察的 reply 均被拒 | 无错字且取得真实必要材料时可据证说明无需修改、零候选/零 canon 变更；确有错字时按原请求产生正确范围候选并经作者采纳。不得无读取就伪报已检查 |
| “这本书的章节编号为什么采用全书连续编号？只解释，不要修改。” | 命中维护意图，reply 被 maintenance_capability_required 拒绝 | 模型解释现有事实/约定，必要时可只读取证；不要求重编号、不生成结构修改候选。对明确要求重编号的正例仍完成原 B30 能力与采纳边界 |
| “讨论一下把陆晨指定为主角是否合理，先不要生成候选。” | “指定”抵消讨论豁免，reply 被 character_profile_capability_required 拒绝 | 保留讨论和“不生成候选”限制；可查真实角色事实但不修改主档案。对明确修改的正例仍绑定唯一身份，并与 B48 的真实歧义/已消歧/no-op 规则一致 |

每类均补未参与实现调词的同义/否定/条件表达和对照正例；不得只给上述字面量加例外。失败、不可用和真实未覆盖结果完整留存，不做第七次 B27 全量 retest，不用工具调用次数或某条固定轨道代替语义成功。

### 本轮 CP0–CP3

| CP | 完整工作与关闭证据 | 状态 |
|---|---|---|
| CP0 | 核三个谓词/guard 的当前调用方、讨论与观察豁免、纠正提示和应用 fallback；形成语义责任→实际输入/观察→结果→机械检查映射，冻结正反例、合法终局及现役契约差异；没有新增 schema/调用则明确复用 | **done（2026-10-30）**：`cp0-map.json`；probe 源码 sha256 复核一致；契约 6 条与 CP3 预注册见上 |
| CP1 | 在同一判断主链修正词法后置约束与纠错提示；模型负责语义，APP保留真实结构/身份/权限/版本守卫；清除不再成立的能力强迫和伪缺口澄清，不新增关键词补丁集或静默默认 | **done（2026-10-30）**：三谓词/三后置 guard/APP fallback/wrong_route 事件移除；保留客观守卫；见上 CP1 记录 |
| CP2 | 贯穿已有探索、条件无变化/讨论/实际执行、真实失败与有界恢复；B43 决策/trace/TurnResult 同源，问题状态与采纳边界不回归；三条原反例及扩展矩阵正式测试、历史读取与 no-provider replay 通过 | **done（2026-10-30）**：矩阵/有界恢复/同源断言/replay 20/20；见上 CP2 记录 |
| CP3 | 外部真实 Tauri + 真实模型完成三类自然输入、对照执行及必要采纳/恢复/回放；分别核模型理解、实际观察、执行效果与零越权，保留失败分母；完整范围满足后关闭本节 | **todo（下一步）**：复用 `scripts/lib/native_ui` + 既有 native 驱动模式落地 6 场景外部驱动；真实模型单槽运行、结束卸载并核验为空；证据目录 `artifacts/slice-verify/<scenario>-tauri/` |

### 分工与恢复

- B29/B30 的后置词法语义路由归本节，不在两处重复维护状态；原角色修订、结构映射/事务与历史验收继续保留。
- [B48](B48-character-revision-noop-and-ambiguity.md) 负责角色 no-op/同名消歧的业务结果，本节让该合法结果可通过共享判断链；[B28](B28-whole-chapter-revision.md#元原则整改作者范围与否定约束) 负责内容修订范围的语义与执行约束，不能由本节“允许 execute”代签。
- B27 继续负责全调用点语义/known-gap，B39 负责通用求证，B43 负责统一裁决与 Gate。各自完整验收不互相代签；必要共同契约按现有 owner 协同。
- 真实 provider 的协议失败/能力缺口必须如实返回；应用安全提示可描述真实状态，但不能冒充模型过程叙事或编造作者未提供的缺口。恢复先核当前代码与本节，不按旧 v1 的绝对终局限制重新实现。本文仅规划整改，未修改产品、测试或历史证据。
