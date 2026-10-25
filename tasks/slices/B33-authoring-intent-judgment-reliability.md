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
