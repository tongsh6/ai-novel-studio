# B26-single-call-judgment-protocol：移除 call1→call2 两段式，单调用 `tool_choice: auto` 成为唯一判断/规划协议

**状态**：**doing（文档设计阶段；2026-10-24 与 B27 联合修订已落档，CP1 待 Accepted；CP0 仅旧规则下 LM Studio 局部探针，CP2–CP5 未实现/未验收）**。本轮作者仅授权文档更新，不自动接受修订或启动代码/实模调用。
**来源**：2026-10-22 作者追问「为什么存在 call1→call2、当时取舍现在还适用吗」+「Codex / Claude Code / OpenCode / dsh 如何解决」；2026-10-23 作者拍板：**决定移除 call1→call2 的模式和相关实现，不做兼容**（推翻本 slice 前稿的「探针分档 + 两段式降级」设计）。
**关联 slice**：`B23-awaiting-author-reason-and-exit-surface.md`（B23 治停等理由 / 文案 / 死 run；B26 治停等无选项的协议根因；并行）；`SI-model-behavior-contracts.md`（MBC 探针体系：B26 用它做**切换前后对照**与**切换后回归守卫**，不再用它做分档）；`UA01-agentic-loop-prompt-hardening.md`（prompt 资产）；`Q3A`（语义对账，对账对象迁移）；`T6-AB / VS-00I`（缓存纪律：调用对守卫改为单调用守卫）。
**设计真源**：`docs/design/adr/ADR-0025-judgment-driven-interactive-loop-v3.md` §5（修订：方案 A/B/C 全部作废，唯一协议 = 单调用 auto）；`ADR-0023` 修订注记（2026-07-05 两段式起因，本 slice 追加「已被 B26 撤销」注记）；`docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md`；`docs/design/contracts/VS-00I-prompt-prefix-stability-contract-pack.md`（Frozen；§3「call1 带同 tools + tool_choice none」条款随两段式消失，需修订为单调用口径，缓存纪律 L0–L4 不变）；`VS-00H`；`ADR-0024` S7；`46` §9、`47`；`00c` N-NARR / N-PLAN。

## 0. 现状核查与取舍回溯（2026-10-22/23 只读）

### 0.1 两段式是怎么来的

| 步 | 出处 | 决策 | 当时前提 |
|---|---|---|---|
| ① | ADR-0023 CP4（2026-07-05） | 计划起草改 `tools + forced tool_choice`，只读 native tool call arguments | 地板模型 JSON-tail 不可靠 |
| ② | ADR-0023 修订注记（同日，作者拍板） | 强制 tool call 期间 content 无字节可流 → 拆 call1 无 tools 流叙事 / call2 forced 出结构；自承「明知与调用经济学冲突后的体验优先决策」 | forced 时 content 不可流；叙事必须模型原话 |
| ③ | ADR-0025 §5 | 推广为判断循环默认（方案 B）；方案 C 单调用仅作降级 | 同上 |

### 0.2 前提现状与新代价

- 经济学反对理由已被 VS-00I 消解（DeepSeek 命中 2048/2057、LM Studio TTFT 195s→6.6s），**成本不再是理由**。
- **语义分叉**（`notes/2026-10-08` BIZ 审计真实证据；B23 stage 样本 `run_mviedcoi_5ta`）：call1 对作者说一套，call2 做另一套，app 只要求 call2 自行消解。
- **停等无出口**：`awaiting_author` 是 app 状态机终态，模型只能选、不能装选项；仅预算缺口路径带 `available_actions`。
- **call2 被迫关 thinking**（`deep_seek.ex:160-165`）：最终裁决那次调用反而不思考。
- **判断质量靠 prompt 位置托**（VS-00I「call2 登记误判靠映射置尾修复」）。

### 0.3 harness 对照

Codex / Claude Code / OpenCode（有把握）、dsh（API 能力推断）：**没有 call2**。单调用、`tool_choice: auto`；同一响应流里 text/reasoning = 叙事、tool call = 动作、不调工具 = 回合结束、需裁决时**调提问工具并自带选项**（Claude Code `AskUserQuestion`）、计划也是工具（`update_plan` / `todowrite`）。形态判断隐式化。能这样做因为：从不 forced、结构由 API/SDK 或 grammar 约束兜、「该调不调」归模型质量而非协议。

### 0.4 作者裁决（2026-10-23）

**移除两段式，不做兼容。** 含义：
- 单调用 auto 是判断步与计划起草/修订的**唯一**协议；不保留两段式作为降级路径、不按模型分档、不留开关。
- 「本地小模型在 auto 下该调不调」不再由协议兜，而是：切换前用 MBC 探针**对照记录**现状（证据，不是门槛），切换后用探针与真实页面场景作**回归守卫**；达不到的模型是模型质量问题，按既有「地板档是 forcing function 不是设计基准」纪律处理，不反向把协议复杂化。
- 两段式的全部实现（prompt 资产、解析分支、替身双态应答、调用对缓存守卫、相关测试与脚本）在本 slice 内**删除**，不留死代码。

### 0.5 两段式爆炸半径（只读盘点，供 CP2/CP3 删除清单）

| 层 | 文件 | 两段式痕迹 |
|---|---|---|
| 判断协议 | `apps/novel_application/lib/novel_application/judgment_protocol.ex` | `request_narrative/2`（call1）、`narrative_prompt/decision_prompt`、`continuation_narrative_prompt/continuation_decision_prompt`、`bind_narrative` 的 call1 优先 / arguments 回退分岔、`request.narrative` / `corrected_narrative` |
| 计划起草 | `apps/novel_application/lib/novel_application/agentic_plan_draft_planner.ex` | `draft_reasoning_prompt`（第一段）/ `draft_structure_prompt`（第二段）、`:147-149` `:303-304` 两段叙事绑定、revision 同构 |
| 调用点 | `dialogue_planning_service.ex:648`（判断）；`prose_drafting_with_quality.ex:192`（续行判断②）；`judgment_plan.ex:85/138`、`fact_inventory.ex:48`、`provider_progress.ex:47/91`、`readonly_batch_context.ex:48/92`、`ledger_reconciliation.ex:44`、`plot_outline_with_context.ex`、`prose_drafting_with_quality.ex:72`（起草/修订） | 接口签名含 `narrative_fn` / 两次 provider 调用计数 |
| 叙事源 | `agent_narrative_source.ex`、`agent_run_server.ex`（`reasoning_visibility`、`provider_call_count` 按 2 计）、`turn_interaction_service.ex`、`provider_activity_projector.ex` | `provider_output_tool_narrative` 源类型保留（单调用空 content 回退仍需要）；按调用对计数的地方改 1 |
| novel_agent | `adapter_execution.ex`、`anthropic_stream.ex`、`openai_compatible_stream.ex`、`deep_seek.ex:160-165`（thinking × forced 整形） | 流解析本就支持 content + tool_calls 同流；forced 整形在 auto 下不再触发，**保留**（非两段式专属，是 provider 能力整形） |
| 替身 | `apps/novel_agent/lib/novel_agent/provider/stub.ex:89-98,117`、`apps/novel_agent/test/support/provider/slice_verify.ex:424-541` | 按「有无 tools / 是否 forced」分双态应答（叙事段 / 结构段）→ 改为单态：一次返回 content + tool_calls |
| 不变量守卫 | `scripts/scenario_invariants/run_icache_prefix.exs`（`pair/4`、`judgment_call_pair_prod`、I-CACHE-2「call1/call2 tools differ」）、`run_n_narr.exs:128` | 调用对守卫改为单调用前缀守卫；I-CACHE-2 的「调用对 tools 恒定」条款随之作废 |
| 探针 | `scripts/model_contracts/{judgment_protocol,continuation_judgment,prompt_prefix_probe,prompt_prefix_probe_test,execution_self_eval}.exs`、`scripts/replay_call2_wrong_route.exs`、`scripts/model_contracts/README.md`、`scripts/README.md` | 改单调用口径；`replay_call2_wrong_route.exs` 删除（其判例迁入单调用对账测试） |
| 测试 | `judgment_protocol_test`、`agentic_plan_draft_planner_test`、`dialogue_planning_service_test`、`judgment_exploration_loop_test`、`agent_run_judgment_plan_flow_test`、`agent_run_prose_drafting_flow_test`、`agent_run_runtime_test`、`ledger_reconciliation_run_test`、`b11a_cp3_volume_scope_test`、`creative_facts_context_test`、`gateway_test`、`anthropic_test`、`adoption_repository_test` | 凡断言两次 provider 调用 / 叙事段匹配 / `provider_call_count=2` 处改写 |
| 验收 | `frontend/slice-verify/{external-ui-driver,native-tauri-verifier,dogfood-runner}.mjs`、`quality/acceptance/scenarios/{agent-conversation-turn,agentic-loop-no-deviation-direct}.yml`、`scripts/tauri_slice_verify.sh` | 凡按 provider 调用次数 / 调用对帧数断言处改写 |
| 文档 | ADR-0025 §5、ADR-0023 修订注记、VS-00I §3/§9、UA-01、`46` §9.4 叙事体裁说明、`notes/2026-07-15`、`08-provider-abstraction.md` 若有调用对口径 | 修订注记 + 口径替换 |

## 0.6 B27 联合修订：四断点与唯一真源（2026-10-24）

本稿按作者要求整合，不另建平行协议。模型侧 schema/profile/合法组合真源为 [UA-01 §2.2](../../docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md)，任务输入/规则归属真源为 [VS-00D §11](../../docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md)，全调用点整合由 [B27](B27-systematic-prompt-and-intent-integration.md) 负责。以下决定替代 2026-10-23 草案中仍有冲突的口径，历史日志不作为实现规范：

| 断点 | 本稿决定 | 必须保留的业务能力 |
|---|---|---|
| J1 回复靠空行/文本抽结构 | 普通回复整段 content，零工具/零默认动作；方向与缺口分别由 propose_creative_directions / report_capability_gap 同次工具响应表达 | 自然问答、方向卡与真实选择来源、Q3B 缺口；不为普通回复再调用模型分类 |
| J2 原文登记字段失去通路 | register_author_content 携明确 source_ref，应用按来源保真物化；撤销旧 reply/capability_gap 组合条件 | 当前/历史来源、字节复制、版本去重、先收下不物化、作者采纳；不让模型提供替代正文 |
| J3 初始/续行两种停等 | 仅 ask_author；每次独立持久 author_question/TurnResult，始终有系统 free_text 动作；按 UA-01 A1–A3 校验/恢复 | 空选项也有真实动作、原话/提交身份/receipt、旧问题拒绝；B26 不依赖 B31 |
| J4 原生探索与封装双入口 | 仅 judgment_decision.explore + explore_request；探索工具不另暴露 native tool | B24/B25 的读取/分页/ref/权限/观察；目录仍可见且与实现同源 |

三个明确业务输出工具不是第二个 reply 结构化调用，也不是创作能力扩容；B26 负责将既有 Q3B/Q3C/Q3D/方向链接入新协议。B28–B30 的实际对象维护能力不在本 slice 冒充实现。

共享入口只迁移一次：共同设计（B26 CP1＋B27 CP0）→ B26 CP2＋B27 CP1/CP2 接同一生产判断/计划入口 → 协议与业务保留检查 → B27 其他专业调用 → 联合真实页面/语义评估。没有“B26 用旧机械规则先上线、B27 再重写入口”的中间交付。

## 1. 开工检查（七问）

1. **Contract**：ADR-0025 §5 与 UA-01 §2.2 的单调用 auto 唯一协议；B27 / VS-00D §11 的共同任务语义；ADR-0027 D4 的作者源字节/来源/去重。模型工具输入 schema、profile 可用工具、归一操作、输出/回传逐项冻结；不从 content 抽业务授权。修订 Accepted 前不进入 CP2，本轮只更新 Markdown。
2. **Invariant**：UA-01 I-SC-1～7（同响应来源、ask_author 唯一模型停等、生产唯一协议、实际计数、前缀稳定、明确结构输出、唯一探索与整组验证）＋N-NARR/I1/I2/I3；auto 不越过 GateOrder/ActionValidator/Adoption。模型私有 thinking 不作为必须展示内容。
3. **Boundary**：application 判断/续行/计划/登记/方向/缺口 handler 与来源校验；domain/common 必要协议 DTO；web 的 author_action 来源恢复/分派/作用域/receipt 接线；frontend 选项/自由文本/当前问题投影；scripts、test/support、quality 与文档。新增 wire schema/codegen 在实施阶段同批，不在本轮改 JSON。保留 provider adapter/流解析的已有能力，只有证据证明不足时另列最小修复；不重写 writer/evaluator/inventory 模板（归 B27），复用 persistence 的 Interaction/AgentEvent/AuthorActionReceipt 保存问题、结果和回执，允许必要仓储/事务接线但不新增表；不实现 B28–B30 的作品操作。
4. **Consumer**：当前真实工作台的普通回应、创作方向、原文登记、能力缺口、初始/续行提问、探索与计划；ask_author 的点击/自由文本沿同一个 author_action/steer 通路，最终可刷新/回放。
5. **Proof**：profile/合法组合/字段与来源矩阵、非法组合零部分副作用、计数/重试/同源断言；J1–J4 全链真实页面与原 Q3B/Q3C/Q3D/方向/计划回归；§5 三组对照不能混报。
6. **Acceptance Driver**：外部驱动当前真实 Tauri 工作台，问题/选项使用可见语义；故障 provider 只在 test/support，产品新增验收感知逻辑 no。拟新增场景须在 quality/acceptance 正式登记，不用本文件代替注册。
7. **Exploration**：不新增小说要素；保留封装读取唯一入口，观察、分页、合法 refs 与实际权限仍同源。作者源候选/方向沿既有探索和采纳读投影可达。

## 2. CP 路线、依赖与验收顺序

| CP | 内容与交付 | 依赖 / 完整闭环尚缺 | 状态 |
|---|---|---|---|
| CP0 对照基线 | 保存旧协议/旧规则请求与版本；补齐四断点的基线与超时分母；旧脚本仅作为隔离证据，不成为生产降级 | 现有 LM Studio 8 用例不能覆盖最终工具集；缺新协议/业务保留与页面 | doing（历史局部证据；新矩阵待跑） |
| CP1 联合设计 | UA-01 J1–J4、F1 问题 wire/空选项回复与恢复、F2 状态矩阵、F3 trace；与 B27 CP0 固化语义标准与实际消费者 | 2026-10-24 文档已对齐，修订 Accepted 与必要 schema 映射确认后进入 CP2 | 文档完成，待 Accepted |
| CP2 共享入口迁移 | 删除两段式；初始/续行/计划 auto；三个业务输出/ask_author handler；Q3D 来源/去重；web 动作分派、UI 选项/自由文本；接 B27 CP1/CP2 的共同输入，一次改造 | 删建同批；不能先搬旧机械报形态/空行解析规则再改第二遍；缺守卫与全链证明 | todo |
| CP3 协议和业务保留检查 | QA/OUT 矩阵全部通过；profile/来源/计数/重放/原子性、普通回复 trace；新 I-CACHE-3/N-NARR/唯一性守卫；旧输入联合条件迁移 | 先过这一层，再跑 B27 语义质量；所有实际请求（含补计划/纠错）计数 | todo |
| CP4 页面与集成 | J1–J4 全部真实 Tauri；与 B27 专业调用完成后的生命周期/自然表达回归；原 Q3B/Q3C/Q3D/方向/计划可用 | 必须保留作者业务功能，不只测一次返回 tool_calls；缺最终门禁/台账 | todo |
| CP5 文档与任务收口 | ADR/UA/消息契约/索引/NEXT/journey/ledger；明确模型质量、协议失败、能力缺口与未验收项 | B26 与 B27 分别按各自完整范围收口，不互相代替 | todo |

执行关系：B26 CP1 与 B27 CP0 共同定稿；B26 CP2 与 B27 CP1/CP2 同一入口实施；B26 CP3 先证明协议与旧业务仍成立；B27 CP3 专业调用整合；两者 CP4 共享真实页面证据但分别判断通过。B27 不能因 B26 单调用通过就标全应用整合完成。

B26 仍要求生产删建同批、无双协议并存/模型分档/开关；离线历史对照可用导出的旧请求或隔离 checkout，不把旧协议重新链接进生产。普通回复、探索后再判断、补起草与纠错的调用总数各按实测，不定义“整个作者回合恒一次”。

## 3. 实施范围增量

除 §0.5 删除清单外，CP2 必须覆盖：
- register_author_content / propose_creative_directions / report_capability_gap 的模型 schema、响应解析、已验证操作到现有业务结果的映射；撤销 judgment_decision 中旧回复/登记字段。
- TurnInteractionService 的公共来源/组合校验：不再要求原文登记 action=reply/frame_type=capability_gap，但来源、字节、去重、先收下与重新登记保护全部保留。
- novel_web author_action 的 author_choice 接线；问题/当前 goal version/旧动作的验证；已有 receipt 与稳定投递身份，不新增 Channel 事件。
- 方向/缺口结构不由普通 content 推导；既有 Q3B/Q3C/Q3D 与 candidate continuation 测试、场景同批迁移。
- 生产唯一性守卫只禁止旧生产构造/派发路径，历史文档/隔离探针不是误报豁免式兼容；不得通过删验收规则掩盖残留。
- B27 负责跨调用点规则去重与操作互斥；B26 不在本 slice 内把全应用写作规则重写一遍。

### 3.1 六项复审补口与责任（2026-10-24，文档目标）

| 缺口 | 唯一规格 | 实施责任 / 通过条件 |
|---|---|---|
| F1 空选项回传/恢复 | UA-01 §2.2.2 A1–A4 | B26 wire/schema、系统回复动作、提交/receipt、持久恢复；QA 全过，不依赖 B31 |
| F2 新工具收尾/失败/重放 | UA-01 §2.2.3a | B26；OUT 全过，gap 结束但 goal_unfulfilled；不新增 run 状态枚举、不伪造 goal_satisfied |
| F3 普通回复认知记录 | VS-00D §11.4 | B27 定语义、B26 共享出口接线；原话/supplied refs/覆盖有源，模型未输出字段保持未知 |
| F4 web 范围冲突 | ADR-0025 Umbrella 边界 + UA-01 | B26 明确接线 author_choice/来源/恢复校验，旧“透传不改”已被替代 |
| F5 旧缓存门禁 | VS-00I §7 I-CACHE-3 | B26 改单调用门禁、B27 语义回归；none/call1 断言仅历史，不靠跳过测试通过 |
| F6 语义验收不明确 | B27 §6.1 | B27；20例×2次/臂，关键集全过、整体≥90%且不低基线、无谓追问≤10%、不可用≤5%、零容忍项为0 |

所有新增 wire 字段（author_question、open_author_question_turn_results 恢复集合、动作 label/question_ref/expected_goal_version/response_kind、回复 payload）须在实施时做 schema/codegen/Channel/UI 同批检查；本次只更新文档，不把现有 schema 当作已支持。

## 4. 任务清单

- [x] 2026-10-24 联合文档：J1–J4、分工、依赖、验收顺序落到 UA-01 / VS-00D / ADR / NEXT。
- [ ] CP0 按新矩阵补对照；保留旧报告分母/超时/模型与上下文版本，不当总体胜率。
- [ ] CP1 联合修订 Accepted；与 B27 CP0 核定最小 schema 映射。本文档完成不等于授权本轮编码。
- [ ] CP2 共享入口一次迁移＋两段式删除＋明确业务输出＋初始/续行统一提问＋回传与旧业务链。
- [ ] CP3 协议/来源/无副作用/计数/缓存/唯一性及旧业务保留检查。
- [ ] CP4 J1–J4、既有业务回归与 B27 联合真实页面/自然表达。
- [ ] CP5 全门禁及各自台账收口。

## 5. 验证

| 阶段 | 验证对象 | 通过条件 |
|---|---|---|
| A 协议对照 | 隔离旧协议＋旧规则 vs 单调用＋等价规则 | 工具/profile/合法组合/来源与计数正确；超时/失败单列，不用分母不同的比例宣布质量提升 |
| B 语义对照 | 同一单调用协议，旧规则 vs B27 整合规则/上下文 | 同模型/同上下文版本，改述与保留集；必要取证、正确范围、少无谓追问，不以少调用替代正确性 |
| C 产品验收 | 自然输入→取证/候选/问题→作者动作→持久化/刷新/追问 | 正确对象、来源、状态、无越权；确定性链与真实模型质量分别留证 |

拟新增：
- agent-single-call-judgment-turn：普通回复无工具、无空行协议、零默认动作；合法业务结构仍可用。
- agent-ask-author-options-roundtrip：初始/续行有选项与空选项、自由文本、刷新、过期/重复/跨 run。
- agent-single-call-business-outputs：方向可点击；当前/历史原文登记逐字、去重/放弃后再登记/仅收下；缺口报告不派发近似工具。
- agent-single-call-explore-roundtrip：封装探索、分页、观察后二次判断；拒绝 native 探索第二入口与非法组合的部分副作用。

回归：q3b-capability-gap-honest-reply、q3c-author-content-materialization、Q3D 来源/候选/重传当前注册场景、au02-candidate-continuation、agent-awaiting-author-input-required、agent-awaiting-author-steer-resume、agent-plan-native-tool-calling-protocol。计划双工具同返与缺计划后补起草均验证实际调用次数。

正式实施时以 scripts/slice_verify.sh --list / quality manifest 校准并登记拟场景；外部驱动真实 Tauri 使用用户可见语义，产截图/WS/app JSONL/来源/usage，不能只直接 push Channel 或调用后端 helper。

全门禁按 AGENTS：编译零警告、后端全量、xref/arch、前端 typecheck/lint/test/audit/design trace、构建；I1/I2/I3/N-NARR、I-CACHE 与生产协议唯一性守卫；ai_static_scan --top 10 处置与复跑。本轮仅文档检查，不运行上述功能门禁或实模探针。

### 5.1 必须逐条执行的问答与结果矩阵

| ID | 场景 | 不可省略的断言 |
|---|---|---|
| QA01 | 初始/续行 ask_author.options=[] | 独立问题 TurnResult/source、系统 free_text action 存在；非空回复推进同 run 一次 |
| QA02 | 有模型 choice 选项 | 原话标签/机器值来自同一选项，源动作/问题/版本一致，不直接执行采纳/确认 |
| QA03 | 模型 free_text 与系统通用回复 | 输入字节保真，未输入只打开 composer 不发送，不用 label 替代原文 |
| QA04 | 问题超出聊天窗口后刷新 | 从持久投影恢复问题/动作，ID不重铸，不重调模型；绑定丢失不猜最新 run |
| QA05 | ack 丢失、同身份重传 | 原语义回执＋当前run/runtime状态，goal.version只加1；无重复推理/副作用、不复活历史running快照 |
| QA06 | 同身份异内容 / 修正重发 | submission_conflict；新身份且问题仍有效时才可新提交，原输入保留 |
| QA07 | 同问题两个不同提交并发 | 至多一个 accepted，另一个已回答/过期拒绝，不双 steer |
| QA08 | 旧问题/旧版本/跨 work/session/run | 拒绝且不改其他任务；旧记录仍可回看 |
| QA09 | 取消与回答两种串行先后 | 取消先到则拒答；回复先到保留输入/receipt，再取消后续执行 |
| QA10 | bounded 重启失活 | 不复活/不改投；保留输入/已提交回执并诚实显示失败 |
| QA11 | durable 恢复未就绪/就绪 | 未就绪禁用，校验恢复后才允许同问题回复，不丢版本 |
| QA12 | 多个 open run + 显式回复卡 / 新请求 | 回复卡绑定指定问题；清除绑定后新请求不 steer 旧 run；B26 可独立验证 |

| ID | 业务结果/错误 | 状态与副作用断言 |
|---|---|---|
| OUT01 | 普通 reply / 方向提案 | completed/stopped；原话与方向来源有据；无默认业务副作用 |
| OUT02 | 原文首次/全放弃后合法重登记 | 仅一个保真 pending、运行结束不假 awaiting；采纳仍独立 |
| OUT03 | 来源已有 pending / accepted | 原对象/实际版本返回、无新增候选或本次采纳，不伪造源动作 |
| OUT04 | 初始/续行 capability_gap | completed/stopped；capability_gap/goal_unfulfilled，零新派发、不自动再判断、不发 goal_satisfied |
| OUT05 | 结构/来源纠正一次仍失败 | failed/stopped，失败 TurnResult可解释；新请求才重试，无本次效果 |
| OUT06 | 结果提交前持久化失败 | 全提交回滚，不广播成功；不可落盘时不声称历史可恢复 |
| OUT07 | 已提交但发布/ack丢失，响应重放 | 复用结果/产物/问题ID；不再调用模型或重做物化 |
| OUT08 | 提交前/后取消及迟到 provider 响应 | 前取消零新效果；后取消不抹已提交结果；迟到输出只审计 |
| OUT09 | run先前已有候选，后续失败/缺口 | 前期合法结果保留；失败文案/trace不把历史成果错误宣称为零 |

QA/OUT 全部有局部断言且100%通过。QA01–QA05/QA08/QA12、OUT01–OUT04/OUT07须真实 Tauri；其余故障/并发边界可由外部 test/support 故障注入或领域/仓储测试证明，报告证据层级，不能直接后端调用冒充页面。新增失败类型不得重置有界纠错次数，统计 native工具/业务工具/provider 调用三种口径。

普通回复认知记录额外验证：无工具分析仅提供原话/supplied evidence，model_interpretation_status=not_provided；取证后回复可引用 upstream_judgment_ref，但不伪造本次焦点或 used_context_refs；无额外抽取调用。QA/OUT 与本条通过后才进行 B27 §6.1 语义验收。

## 6. 决策日志

- 2026-10-24 — 按六项复审补口：F1 固化每问必有持久问题及系统 free_text 动作、提交/恢复；F2 固化运行状态/结果/失败/取消/重放，gap完成报告但目标未完成；F3 普通回复留真实证据且不虚构认知；F4/F5 清理 web 边界与旧 none 门禁；F6 引用 B27 预注册阈值。增加 QA01–QA12/OUT01–OUT09 矩阵，明确 B26 不依赖 B31 才可验空选项。本轮只改文档，矩阵未执行、代码未开始。

- 2026-10-24 — 作者要求结合 B27 补齐四断点、分工/依赖/验收并同步 NEXT，仅改文档。UA-01 §2.2 为新协议唯一真源；普通文本无空行解析，三个业务工具保留方向/登记/缺口结构，模型停等统一 ask_author，探索仅封装入口。旧日志中“options 可选”“reply 字段原样保留”“novel_web 不改”等由本稿替代，不作为实施依据。共享入口随 B27 共同输入一次迁移；本次不自动标修订 Accepted。

- 2026-10-22 作者拍板形态 B（对齐 harness 单调用）而非 A（call1 结论硬约束 call2）。
- **2026-10-23 作者拍板：移除 call1→call2 模式和相关实现，不做兼容。** 推翻前稿「探针分档 + 两段式降级」：不留降级路径、不按模型分档、不留开关；两段式实现全部删除。「小模型 auto 下该调不调」归模型质量债（地板档纪律），不反向复杂化协议。
- 取舍回溯定型：体验理由（流式叙事）由单调用 content 流继续满足；经济学反对理由已被 VS-00I 消解；一致性 / 停等出口 / thinking 误杀是现在的主要代价。
- CP2 必须删建同批：仓库不允许出现两协议并存的中间状态进入 develop（不变量 ④）。
- DeepSeek thinking × forced 整形**保留**：它是 provider 能力整形而非两段式专属；auto 下自然不触发。
- **2026-10-23 作者拍板三项**（原待拍板 ①②③ 全部关闭）：
  - **① `ask_author.options` 回传 = S7 `author_action` 通路，run 内命令 = steer。** 核实：`author_action` 是单一 Channel 入口 + 按 `action_type` 分派（采纳族 / 确认族 / 修订族 / 预算族 / 面板族），公共部分为 `ActionValidator` 四检 + receipt 幂等 + `action_result` 广播；预算族已证明「awaiting TurnResult `available_actions` → 点选 → `author_action` → `target_ref = run_id` scope 校验 → 同一 run 继续」通路可用。差异点：预算族每个选项一个 `action_type`（app 预知选项），`ask_author` 选项由模型当场生成，不能再按选项造类型。定型：`action_type` 固定 **`author_choice`**；选中项由既有字段 **`candidate_ref`** 携带 `option.value`；`target_ref = run_id` 沿用预算族 scope 校验；run 内落点复用 **steer**（`maybe_prepare_awaiting_author_steer` 清 `judgment_settled` 重入判断步，`option.label` 作为 steer 文本进入下一轮判断上下文），不给 `AgentRunServer` 新增公开命令、不新增 Channel 事件；`kind = free_text` 选项与主输入框打字汇合到同一 steer 语义。schema 中 `action_type` 为自由字符串（`turn_result_v3.json:64`），无需枚举变更，只需 UA-01 登记 `author_choice`。
  - **② VS-00I 修订批准**：§3「call1 携带同 tools + `tool_choice: none`」条款与 I-CACHE-2「调用对 tools 恒定」作废；L0–L4 分层、L4 置尾、I-CACHE-1 不变；§9 CP-AB 调用对样本降为历史证据。CP1 执行。
  - **③ 非判断入口的 bounded run 起草 = 单调用 auto 起草**：fact_inventory / ledger_reconciliation / readonly_batch_context / provider_progress 等由动作直接起的 run，`draft_plan_with_meta` / `revise_plan_with_meta` 改为一次 auto 调用（tools 仅 `agent_plan_draft` / `agent_plan_revision`），映射表对此类 run 只接受 plan tool call，缺失 = 带说明重试一次 → 诚实失败。不经判断步。
- **2026-10-23 作者拍板④：CP2 起的编码不由本会话（Claude）承接。** 本会话止于 CP0 探针 + CP1 契约文档；接手方入口 = 本文 §0.5 删除清单 + §2 CP 判据 + `contracts/UA-01` §2.2 契约细则 + `artifacts/model-contracts/single-call/lmstudio.md` 对照证据。CP1 Accepted 仍由作者给出，接手方据此开 CP2。
- **风险登记**：Anthropic auto 下 thinking 与 tool_use 交错流解析路径更常走，需 `AnthropicStream` 回归；本地小模型 CP0 数据若明显劣于两段式，按作者裁决仍切换并登记为模型质量债，不回退。

## 7. 试行反馈

### CP0 历史探针（2026-10-23，`scripts/model_contracts/single_call_compliance.exs`）

探针设计：单调用原型复用生产 `narrative_prompt/1` 的 L1 前缀 / 上下文 / 形态段 / 登记规则，只替换「输出要求」段为单调用口径；tools = 生产 `judgment_decision` + `ask_author` 草案 schema；`tool_choice: auto`。同一用例同时跑生产 `request_judgment/3` 两段式作基线。八用例 = judgment_protocol.exs 七用例 + 新增 `author_decision_with_options`（上下文含第04章双版本，期望 `ask_author` 带 ≥2 options）。

| 通道 | 单调用准确率 | 基线准确率 | content 非空 | 备注 |
|---|---|---|---|---|
| stub | 0.75 (6/8) | 0.875 (7/8) | 1.0 | 两处失败都是**替身债**而非协议结论：① `ambiguous_intent` 替身在 auto 下仍用 `judgment_decision{action: await_author}` 而不是 `ask_author`（替身不认识新工具，CP2 改单态时一并教）；② `author_decision_with_options` 替身按关键字判 execute（基线同样失败，替身无此用例语义）。stub 结果只证明探针管道通、JSON/MD 报告可生成。 |
| lmstudio（`qwen/qwen3.8-27b`，production 上下文形态，每用例 2 次） | **0.846 (11/13)** | 0.813 (13/16) | 1.0 | 单调用均耗时 **97.9s** vs 两段式 **144.7s**（同用例同模型，少一次往返约省 1/3）。3 次 blocked = 探针 300s 挂钟超时（`continuation_phrasing` 两次、`ambiguous_intent` 一次），非协议失败，见下。两处判定失败均为 `author_decision_with_options`，**基线同样失败**（两协议都选 explore，理由一致：要先读两版正文再让作者定），属用例期望过严而非协议退化。 |


LM Studio 逐用例观察（`artifacts/model-contracts/single-call/lmstudio.{json,md}`）：
- **七条既有用例单调用全对**（reply×2 / execute×2 / plan / explore / await_author，去除超时后 11/11）；基线在 `single_creative` 上还丢了一次。单调用下模型对「直接回复」确实**不调工具**，content 均非空且是作者可读的判断说明（644 / 549 / 292 / 205 字等），N-NARR 叙事源成立。
- **`ask_author` 一次成功样本**：`ambiguous_intent`「改一下」→ 模型调 `ask_author`，question 清楚，**自带 5 个 options**（上下文里的第01章 / 第04章两版 / 候选等）。这是 B26 不变量 ②「停等必有出口」在真实本地模型上的首个实证——两段式基线同样判 await_author 但只能给一句话，没有选项可渲染。
- **超时 3 次是探针口径问题**：`probe_run.sh` 给 LM Studio 300s 总挂钟，`continuation_phrasing`（续写）单调用两次都超时，基线均耗时也达 143s——模型在 auto 下可能开始内联起草正文（content 过长）。切换后 B22 的 liveness 策略（出字即续命、无总挂钟）才是生产口径，探针应改用 `TimeoutPolicy` 或把 `NOVEL_LMSTUDIO_TIMEOUT_MS` 提到 600s 重跑这两条；同时这是 prompt 需要钉的一条：**判断说明里不得开始写正文**（现 narrative_prompt 已有「其它形态：只输出判断说明，不要开始执行」，单调用口径段需保留并加强）。
- **`author_decision_with_options` 两协议都选 explore**：模型认为要先读两版正文才能让作者有依据地选。这合理——用例期望应放宽为 `await_author | explore`（与 `multi_step_creative` 接受 `plan | explore` 同理）；真正要测「带选项停等」的能力已由 `ambiguous_intent` 样本证明。CP0 收口时同步改用例期望。

**CP0 结论校准（2026-10-24）**：历史数据支持“单调用原型可行”，不能据 11/13 有效单调用样本与 13/16 基线断言总体更准；3 次超时须继续计入可用性报告。旧探针只携 judgment_decision/ask_author，仍保留复述意图/报形态，未覆盖本稿业务工具、计划组合、续行与 J1–J4 页面闭环；不能作为 B27 整合效果证据。

CP0 已经暴露的协议设计点（进 CP1 契约）：
- 「`judgment_decision{action: await_author}` 但没调 `ask_author`」在单调用下是**非法组合**——停等必须经 `ask_author` 才能带选项（不变量 ②）。映射表须把 `judgment_decision.action` 的枚举收窄为 `execute | plan | explore`（`reply` = 不调工具，`await_author` = 调 `ask_author`），而不是沿用五选一。


## 8. 恢复指引

先读 NEXT、UA-01 §2.2、VS-00D §11、B27 §2/§3.3，再看生产代码是否仍两段式及工作区并行 WIP。从共同设计/输入契约和新矩阵基线恢复，不直接把旧探针的“替换输出要求”复制到生产。作者本轮只授权文档，业务/实模/代码工作不得据文档已落档自动启动。


## 9. 六项补齐后的文档交叉审查（2026-10-24）

本表是规格审查记录，不是代码/真实模型/页面通过记录；实现状态仍未开始。

| 项 | 逐路径核对 | 文档结论 / 实施验收 |
|---|---|---|
| F1 | options=[] → 持久问题/系统free_text动作 → 真实source回传 → receipt/goal一次推进 → 刷新/断线/失活；answered优先投影、重复回执先于当前disabled检查 | 规格闭合；QA01–QA12待实施执行；B26不依赖B31 |
| F2 | reply/方向/登记新增或已有对象/初始与续行gap → 对应run/TurnResult → 持久/终止；失败、提交后发布丢失、取消串行顺序逐项有后果 | 规格闭合；OUT01–OUT09待执行；不再默认goal_satisfied |
| F3 | 无工具自然答复 → 原话/真实提供证据/覆盖 → 模型未输出字段未知；结构业务仍具备字段来源 | 与VS-00D §7/§11.4一致；无额外分类调用，待实际trace断言 |
| F4 | 本slice/UA-01要求web接线，对照ADR-0025边界 | 旧“透传不改”已替换，HTTP/Channel恢复与校验归B26 |
| F5 | 单调用profile/schema/计数与语义门槛，对照I-CACHE-3 | 新口径明确，旧none检查仅历史；新守卫必须实施复跑，未放行代码 |
| F6 | 固定案例/rubric/分母/关键集/阈值/失败处置，对照B27 §6.1与NEXT | 可判通过/失败，不再只收指标；全部真实数据待采集 |

交付检查还须验证新增链接、章节编号、NEXT 唯一 next、B26/B27/B31依赖无环及实际修改均为Markdown。下一次开工仍先核对当前代码/WIP，不把本表的“规格闭合”当作任务done或自动编码授权。
