# B33 真实模型下创作动作判断路由可靠性（P1 复验暴露）

- 状态：pending / CP0 设计登记（2026-10-25，P1 canonical 暴露）
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
