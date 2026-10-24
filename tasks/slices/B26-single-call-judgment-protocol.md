# B26-single-call-judgment-protocol：移除 call1→call2 两段式，单调用 `tool_choice: auto` 成为唯一判断/规划协议

> **2026-10-24 联合修订已接受**：作者确认“确定 开工”，接受 B26/B27 联合设计及 ADR-0001 普通回复来源修订，并授权共享入口实现与验证。下文历史“待 Accepted / 本轮只改文档”描述保留当时语境，不再构成本次实施阻塞；实现和验收仍按各 slice 逐项留证。

**状态**：**done（2026-10-24，B26 自身范围 CP0–CP5 全部通过）**。单调用 auto 为唯一判断/计划协议，两段式实现与测试死脚手架删除；普通回复/方向/原文登记/能力缺口/ask_author 问题回传/计划矩阵/CP0 隔离对照/门禁证据见 §11–§14。与 B27 专业调用完成后的生命周期/自然表达回归按 §2「共享页面证据、分别判断」由 B27 CP4 承接，B27 §6.1 语义门槛独立判定，B26 不代替 B27。作者“确定 开工”已授权本轮实现和验证，既有原作品数据不在本轮修复范围。
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
| CP0 对照基线 | 保存旧协议/旧规则请求与版本；补齐四断点的基线与超时分母；旧脚本仅作为隔离证据，不成为生产降级 | 无（旧实现只在隔离 worktree 运行；双工具组合/续行批量不在本批，由 CP3/CP4 与 B27 分别承接） | done（§14.1：12 例两臂真实 provider 对照，固定分母/版本 hash/超时单列） |
| CP1 联合设计 | UA-01 J1–J4、F1 问题 wire/空选项回复与恢复、F2 状态矩阵、F3 trace；与 B27 CP0 固化语义标准与实际消费者 | §10 总体设计对账、ADR-0001 来源修订、UA-01 schema/消费者映射 | done（作者已接受；B27 CP0 案例/快照已冻结） |
| CP2 共享入口迁移 | 删除两段式；初始/续行/计划 auto；业务输出/ask_author；来源/去重、动作分派、UI 与共同输入同批接线 | 实现见 §11；完整 slice 仍受 CP0/CP3/CP4 约束 | done（实现 checkpoint） |
| CP3 协议和业务保留检查 | QA/OUT、profile/来源/计数/重放/原子性、普通回复 trace；I-CACHE/N-NARR/唯一性守卫 | 见 §14.4/§14.5/§14.6：测试死脚手架清理、静态守卫、QA/OUT 映射、I-CACHE 5 profiles、N-NARR、协议失败分类与重放 | done |
| CP4 页面与集成 | J1–J4 全部真实 Tauri；与 B27 专业调用完成后的生命周期/自然表达回归；原 Q3B/Q3C/Q3D/方向/计划可用 | 自身范围见 §13/§14.2/§14.6（问答/方向/登记/缺口/计划矩阵原生通过）；联合回归由 B27 CP4 承接，不在本 slice 重复挂账 | done（自身范围） |
| CP5 文档与任务收口 | ADR/UA/消息契约/索引/NEXT/journey/ledger；明确模型质量、协议失败、能力缺口与未验收项 | §14 记录文档/门禁/索引/台账与真实边界；B27 按自身范围独立收口 | done |

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
- [x] CP0 按新矩阵补对照；保留旧报告分母/超时/模型与上下文版本，不当总体胜率。证据见 §14.1。
- [x] CP1 联合修订 Accepted；与 B27 CP0 核定最小 schema 映射，作者已明确授权开工。
- [x] CP2 共享入口一次迁移＋两段式删除＋明确业务输出＋初始/续行统一提问＋回传与旧业务链；实现与证据见 §11，完整验收不随此项打勾。
- [x] CP3 协议/来源/无副作用/计数/缓存/唯一性及旧业务保留检查（§14.4/§14.5/§14.6）。
- [x] CP4 J1–J4、既有业务回归与计划矩阵原生页面（§13/§14.2/§14.6）；与 B27 专业调用的联合生命周期回归由 B27 CP4 承接。
- [x] CP5 全门禁及各自台账收口（§14.5；静态扫描记录见收尾）。

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

全门禁按 AGENTS：编译零警告、后端全量、xref/arch、前端 typecheck/lint/test/audit/design trace、构建；I1/I2/I3/N-NARR、I-CACHE 与生产协议唯一性守卫；ai_static_scan --top 10 处置与复跑。实施结果见 §11；下文早期日志保留其只读/文档阶段语境。

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

先读 NEXT、项目愿景 `00` §2、总体交互 `01`、主链 `00b`、运行时 `00d` 与 `08` 的要素/探索规则，再读 UA-01 §2.2、VS-00D §11、B27 §2/§3.3 和本文 §13；核对唯一单调用实现及工作区 WIP。从共同设计/输入契约和新矩阵基线恢复，不把旧探针的“替换输出要求”直接复制到生产。联合修订已由作者确认；真实作品修复和其他明确条件项不因任务排期而自动获得授权。


## 9. 六项补齐后的文档交叉审查（2026-10-24）

本表是规格审查记录，不是代码/真实模型/页面通过记录；实现状态仍未开始。

| 项 | 逐路径核对 | 文档结论 / 实施验收 |
|---|---|---|
| F1 | options=[] → 持久问题/系统free_text动作 → 真实source回传 → receipt/goal一次推进 → 刷新/断线/失活；answered优先投影、重复回执先于当前disabled检查 | 规格闭合；QA01–QA12待实施执行；B26不依赖B31 |
| F2 | reply/方向/登记新增或已有对象/初始与续行gap → 对应run/TurnResult → 持久/终止；失败、提交后发布丢失、取消串行顺序逐项有后果 | 规格闭合；OUT01–OUT09待执行；不再默认goal_satisfied |
| F3 | 无工具自然答复 → primary frame/原话/真实提供证据/覆盖 → 模型未输出字段未知；结构业务仍具备字段来源 | §10 补 ADR-0001 上游修订提案；与 VS-00D §11.4 联合待 Accepted，无额外分类调用，待实际 trace 断言 |
| F4 | 本slice/UA-01要求web接线，对照ADR-0025边界 | 旧“透传不改”已替换，HTTP/Channel恢复与校验归B26 |
| F5 | 单调用profile/schema/计数与语义门槛，对照I-CACHE-3 | 新口径明确，旧none检查仅历史；新守卫必须实施复跑，未放行代码 |
| F6 | 固定案例/rubric/分母/关键集/阈值/失败处置，对照B27 §6.1与NEXT | 可判通过/失败，不再只收指标；全部真实数据待采集 |

交付检查还须验证新增链接、章节编号、NEXT 唯一 next、B26/B27/B31依赖无环及实际修改均为Markdown。下一次开工仍先核对当前代码/WIP，不把本表的“规格闭合”当作任务done或自动编码授权。

## 10. 按 NEXT 推进的总体设计核查（2026-10-24）

作者要求按 NEXT 执行，并补充先探查项目愿景和总体设计。本次先完成 CP1 的上游核对和现有承载映射；保留既有未提交改动，未开始 CP2，未调用模型、修改作品数据或声称页面验收。

| 上游要求 | B26 / B27 应产生的用户结果 | 本次核查结论 |
|---|---|---|
| `00` §2 / `01` §3：作者自然表达，LLM 创作伙伴，工作台退到工具箱 | 普通问答自然；有事实可读时先取证；只在需要作者裁决时提问 | 共享判断与共同任务语义同时迁移，不能只把两次调用减成一次或追加一段 prompt |
| `00b` / ADR-0001：每轮认知锚点、唯一 TurnResult、可回放 | 普通回复仍能解释输入/材料/输出来源及实际是否执行 | 发现 F3 尚未对齐上游 Accepted 决策；已补 ADR-0001 修订提案与 VS-00D §11.4，保留 primary frame、未知认知和逐字段来源，待联合 Accepted |
| `00d` / ADR-0003–0005：理解、建议与执行分权 | 提问回答不能当作采纳授权；结构工具也须过门禁 | UA-01 §2.2.8 明确 web/application/domain/persistence/前端的真实消费者，不能仅注册工具名 |
| `08`：要素 × 层级 × 设计/实现/进度三态、探索同批可达 | 计划不等于正文，片段不等于整章，读到什么就据什么判断 | 复用 B24/B25 读取与身份，B27 传递范围/省略；B28–B30 的维护能力仍由对应任务承接 |
| 产品旅程 C/D/F/I 与产出目标：连续创作、采纳、事实库、透明度 | 原文登记、方向选择、缺口说明与刷新后继续创作仍可用 | QA/OUT、20例语义矩阵和真实 Tauri 各自验收；局部协议正确不代表完整创作体验改善 |

**本次可评审结果**：ADR-0001 的普通回复来源语义修订；UA-01 §2.2.8 的现有载体/最小 schema 与消费者映射；VS-00D §11.4/§11.4.1 的认知留痕与共同输入承载。三者与既有 J1–J4 一并接受；不取消已拍板的单调用 auto、无双协议兼容及作者主权。

**尚未闭环**：联合修订 Accepted；CP0 新矩阵/请求版本与超时分母；CP2–CP5 的生产删建、事务恢复、schema/codegen/UI、确定性门禁、真实模型和真实 Tauri。文档审查不能把任一项标完成。验证记录见本节下方。

### 本次验证与恢复点

- `mix compile`：通过，当前基线无输出/告警；仅说明现有代码可编译。
- `node scripts/next_task_check.mjs`、`git diff --check`：通过；NEXT 未改序，B26/B27 仍为联合设计。
- 按 `docs/engineering/quality-gates.md` §2.4 执行两组 `rg` 文档检索：21 个既有待完成标记匹配、0 个旧批次范围匹配；本轮新增行没有新增匹配，未擅自清理历史文档。
- 新增相对链接/索引、schema 与实际消费者定位、本轮改动边界检查：通过；本轮仅修改 7 个 Markdown。未修改生产代码、schema JSON、依赖、原作品数据、HEAD 或暂存区；其他 WIP 哈希保持不变。
- 原 `bash scripts/gap_ledger.sh` 在隔离的源文件快照上执行：通过，20 个开放 ID 与现有快照相同，新增/减少均为 0；本仓差距源行和派生快照均未改变。
- 文档证据：`artifacts/design-review/b26-b27-20261024/`；开始前 WIP 与哈希：`artifacts/wip-backups/b26-b27-design-20261024-020954/`。恢复以逐文件/逐差异为单位，不覆盖既有未提交改动。
- 证据边界：未执行功能全测、I1/I2/I3、功能静态扫描、真实模型或真实 Tauri；本次没有功能实现，未以文档检查替代这些后续门禁。


## 11. 共享入口实施 checkpoint（2026-10-24）

### 已实现的链路

- JudgmentProtocol 与 AgenticPlanDraftPlanner 使用唯一 `tool_choice: auto` 请求，content 与动作来自同一响应；允许至多一次纠错，整组 native calls 先校验后执行。同响应计划可直接消费，不再另起叙事调用；删除旧 call2 重放脚本与 envelope/字符串计划修补入口。
- `AuthoringTaskPolicy` 由判断、续行与计划真实调用点消费；能力效果取自 registry，探索仅由 judgment 封装。普通回复保留 primary frame、原话/材料/覆盖来源与 `not_provided`，展示默认不冒充模型认知。
- ask_author → 持久问题与源动作 → Channel author_choice → application 校验 → 同 run 串行事务 → receipt/输入/goal/event/checkpoint → UI 关闭与续行。先持久后发布，候选/问题不因后续失败覆盖；迟到模型结果不能复活已取消运行。
- schema/codegen 与前端同批更新；选项、模型自由文本、通用自由回复均使用既有不可变 outbox，保留原文字节与 submission 身份。恢复独立于最近聊天分页；明确问题未答时，未绑定主输入开始新讨论，问题卡仍指向原 run。
- 原文登记按明确 source_ref 保真；提交时重验 pending/accepted 版本与已放弃状态，避免旧上下文重复物化。方向、能力缺口和已有探索读取链仍由真实主链消费。

### 证据分层

| 层级 | 命令 / 产物 | 已证明的范围 |
|---|---|---|
| 原生系统 UI | `TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_SLICE_VERIFY_TIMEOUT_SECONDS=1200 CARGO_NET_OFFLINE=true bash scripts/quality_accept.sh b26-author-question-roundtrip --surface tauri`；`artifacts/slice-verify/b26-author-question-roundtrip-tauri-native/summary.json` | CUA 直接点击 Tauri 原生窗口：模型选项、无选项问题自由回复；回答各进入同一源 run 一次，首尾空格保留，问题持久关闭；关闭并重开原生窗口后可见历史回复。模型为 test/support 的 slice_verify，不能证明真实模型语义质量。 |
| 浏览器前后端集成 | `b26-author-question-roundtrip` 默认 driver、`agent-conversation-turn`、`q3c-author-content-materialization`、`judgment-explore-chapter-full-read` | 三种回复、多个 open run、未绑定新请求、16轮后独立恢复；普通回复单调用/public stream/无伪造认知；原文采纳；7000字分页及 chapter_ref 同名隔离。 |
| 局部确定性 | protocol/plan/source/author_question tests；I1/I2/I3、N-NARR、I-CACHE、single_call_compliance | 原生工具互斥、一次纠错、来源字节、重传/冲突/并发/取消/事务失败/失活/历史禁用、固定 schema 与计数。具体报告位于 `artifacts/slice-verify/b26-single-call-judgment/`。 |
| 真实 provider 探针 | `artifacts/model-contracts/prefix-live/b26-single-strata-v2/strata.json` | 现场只读核对 stage 选择为 Strata / iq3_s；合成输入一次 auto 请求选择 explore，无纠错，来源同响应；显式 cache=0，非流式耗时5863ms。此前一轮纠错计入2次请求，不能删失败分母。不是20例语义评估，也不是 TTFT。 |

**验收口径纠正**：既有 `--surface tauri` runner 启动了 Tauri，但默认交互由无头 Chromium 驱动；本轮上述默认 driver 报告按浏览器集成解释，即使旧产物文件夹/字段带 tauri。runner 已将新默认 summary 标为 `surface=browser / driver=headless-chromium`。只有 native 专用模式绕过 Chromium，通过原生窗口截图、源动作 JSONL 与持久数据对账，才计原生证据。不据此重写其他历史验收结论。

### 当时未闭环的计划内后果（最新状态见 §13）

- CP0：新协议等价旧规则的隔离对照、完整案例版本/请求快照与固定分母仍缺；备份旧生产实现可供后续隔离对照，不能重新接回产品。
- CP3/CP4 最新证据见 §12：初始三种回复、QA04/QA05/QA12、QA08 跨 run 已补原生；QA09 双向取消、QA11 live durable 重连就绪/死 runtime 禁用、OUT06/OUT07 问题交付/回答事务及发布故障已有局部证明。续行提问与跨 work/session 的原生历史动作禁用、非问题业务结果的完整故障窗口仍需补，不能把问题事务证明泛化到所有结果。
- OUT01–OUT04 的方向/登记重复/缺口原生矩阵、OUT07 原生回执重放及剩余既有业务场景回归继续归本任务；原文采纳与全文读取的浏览器 PASS 不替代这些原生要求。
- B27 CP0 的20例×2次/臂 snapshot/保留集及 CP3 全专业调用迁移、CP4 语义门槛未完成；协议探针不声称 stage 自然表达问题已关闭。NEXT 保持 B26/B27，不进入 B31。

### 验证与恢复

实施前备份 `artifacts/wip-backups/b26-b27-implementation-20261024-021818/` 包含既有 WIP 哈希/patch、旧协议源码和未跟踪探针、旧 sidecar 压缩包。仅按本轮差异恢复；不覆盖作者既有 B23 等改动。未新增/升级依赖，未提交或推送，未修复真实作品。


最终门禁（2026-10-24 04:40–04:46，本地 Asia/Shanghai）：

- `mix compile --warnings-as-errors`、`mix test`、`mix xref graph --format cycles --label compile-connected --fail-above 0`、`mix run scripts/arch_check.exs`：通过；后端合计1925 tests / 0 failures，compile零警告，xref无环。测试文件仍输出既有 unused helper/alias 警告，未扩大本轮范围清理。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`bash scripts/check_design_trace.sh`：通过；36文件584前端 tests。`CARGO_NET_OFFLINE=true NPM_CONFIG_OFFLINE=true bash scripts/frontend_audit.sh` 全量27 pass / 0 warn / 0 fail。
- `MIX_ENV=prod mix release sidecar --overwrite`＋现有依赖重新打包 sidecar；`CARGO_NET_OFFLINE=true pnpm tauri build`：通过，生成 .app/.dmg。一次未提权的全量 audit 在 DMG 打包阶段失败，授权本机打包后复跑通过；未下载或升级依赖。未提供 Apple notarization 凭据，因此是本地 ad-hoc 签名构建，不是已公证发行包。
- `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`：决定性3/3；`run_i1_causal.exs`：4/4；`run_i2_variation.exs`：3组/3对不相交、0违规。I1/I2/I3 规则脚本未改。N-NARR字节/流式通过，I-CACHE五个 profile 都 covered/enforced。
- `TASK_DONE_MANIFEST=artifacts/slice-verify/b26-single-call-judgment/manifest.json bash scripts/ai_static_scan.sh --top 10`：复跑退出0；20检查中19通过，gitleaks仍报告2条既有项，blocking=0、本轮触及文件发现=0。已修复冗余 with、复杂分支/嵌套和旧前端调用计数断言，manifest引用本次真实原生证据；未修改扫描 baseline/disposition 或豁免规则。
- 剩余 Top 10 实际仅2项：`docs/design/ui/novel-studio.pen:5739` 为已有 `false_positive`（Pencil fileToken 元数据）；`tools/company-console/server/config.mjs:4` 为已有 `accepted_risk`（其他历史分支凭据，由所有者处置，当前工作树无该文件）。保留现有处置原因与后续建议，未重写历史、未泄露匹配值。报告：`artifacts/static-scan/{top10.md,disposition.md,report.json}`。
- `node scripts/next_task_check.mjs`、`git diff --check`、备份哈希/依赖边界核对通过：B23原有WIP不变，HEAD/暂存区不变，依赖清单/lockfile不变；本次临时原生 profile 已可逆移入验收产物，验收进程退出。


## 12. 目标续推：问题事务与原生故障矩阵（2026-10-24）

本轮完整目标为按 NEXT 结合愿景推进直到队列清空；当前先完成 B26/B27，未把上一 checkpoint 当作整体结束。重新核对 `00`/`01`/设计入口的方向：会话结构与真实作品事实优先，作者回复不丢失、不重复、不改投，系统守住执行与采纳边界。

### 新的证据与修复

- `AuthorQuestionRoundtripTest` 新增真实事务后段故障：问题交付/回答在已写 Interaction/run/events 后因 checkpoint 失败而整笔回滚，随后可按原身份重新提交；另覆盖提交后事件发布丢失、回复后取消、bounded runtime 消失后的回执重放、durable live 重连和死 runtime 禁用。
- 测试复现 `AuthorQuestion.project` 仅凭进程存活就启用动作。现要求运行确处于 `awaiting_author`，运行中/暂停/取消中保留原问题但不可提交，状态投影与实际执行校验一致。
- 原生扩大矩阵首批揭露 test/support 方向投影把 atom 键经字符串 Map.take 清成空对象。保留失败批次 `artifacts/slice-verify/b26-single-call-judgment/native-closure-attempt-1/`，修复键规范化及替身明确只讨论不出候选语义，并增加契约验证测试。浏览器分页 driver 也加强为检查每轮成功且不出候选，不能只收到 TurnResult 就算通过。此修复仅替身，不声称真实模型语义改善。
- 新 `scripts/native_question_transport_proxy.mjs` 是外部 HTTP/WebSocket 代理，复用已安装 Playwright 的公开 ws 导出。只有 scripts 读取 `transport-control.json`；产品代码、schema、provider runtime 均不识别故障开关。记录完整真实帧，可丢回执/断线或改绑负例，不合成成功回执。

### 本轮原生验收

命令：`TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_NATIVE_TRANSPORT_PROXY=1 TAURI_SLICE_VERIFY_TIMEOUT_SECONDS=1800 CARGO_NET_OFFLINE=true bash scripts/quality_accept.sh b26-author-question-roundtrip --surface tauri`。

产物：`artifacts/slice-verify/b26-author-question-roundtrip-tauri-native/summary.json`、`native-transport.jsonl`、`native-paged-session.json`、`native-rejected-session.json`、5张原生截图及恢复 AX 状态。上一轮核心证据另存 `artifacts/slice-verify/b26-single-call-judgment/native-core-20261024-0439/`。

| QA / 不变量 | 实际证据 |
|---|---|
| QA01 初始空选项 / QA02 choice / QA03 模型自由文本及通用回复 | 三种入口均由 CUA 操作原生窗口；原话首尾空格/换行保真，机器选项与源 label 对应；未自动提交推荐项。 |
| QA04 / QA12 | 两个未答问题来自不同 run；再从原生主输入发送16轮成功普通讨论；重开窗口时问题已不在最近30条 transcript，仍由独立恢复集合显示对应讨论。答较早问题仅关闭它，另一个仍开放。 |
| QA05 / OUT07 问题回复回执 | 外部代理丢弃第一个 accepted ack 并断线；客户端重传完整相同 action/payload/submission，服务端 duplicate=true、goal.version仍2。三次合法答复每个 run 都只2次 provider（提问1+回复1）、0业务工具，输入持久各1条。 |
| QA08 跨 run | 原生点击源问题选项后，代理把 target 改为另一 run；真实 Channel 拒绝，原问题仍open/version1，错误提交未落输入。恢复正常选择后仅推进正确源 run；重开仍保留被拒输入提示，不静默改投。 |
| QA09 / QA10 / QA11 / OUT06 | 真正的事务/进程/发布边界由上述 application+repository 测试证明；与原生结果分别报告，不把后端调用称为页面验收。 |

`native_question_evidence_check.mjs` 逐页读取真实历史结果并检查分页无重复，再核对源问题、唯一输入、源动作 accepted、open集合关闭、断线重传、跨run拒绝与provider计数。证据依赖本次启动 nonce 和新截图；没有 Chromium driver 文件。

### 当时下一步（本批新增覆盖见 §13）

补续行 ask_author 的原生链路、OUT01–OUT04（方向可点击、当前/历史原文登记与重复/放弃后重登记、诚实缺口）以及跨 work/session 的可见禁用与非问题结果故障窗口。随后完成 B26 CP0 隔离对照、B27 固定20例语义案例和全专业调用迁移；NEXT 候选顺序保持不变，目标继续 active。


本轮收尾验证：`mix compile --warnings-as-errors` 与 `mix test` 通过（1934 tests / 0 failures）；问题回传19例＋协议11例定向复跑30/30。前端36文件584项、typecheck/lint、xref/arch、I1/I2/I3/N-NARR/I-CACHE、design trace均通过。现有依赖重新构建 sidecar 后执行全量 `frontend_audit.sh`：27 pass / 0 warn / 0 fail，.app/.dmg 成功；仍为未公证的本地 ad-hoc 签名包。

统一扫描 `TASK_DONE_MANIFEST=artifacts/slice-verify/b26-single-call-judgment/manifest.json bash scripts/ai_static_scan.sh --top 10` 先发现5项本轮问题（代理宽泛字段赋值、替身判断复杂度、测试别名3项），均修复并复跑退出0。最新19检查通过、1个 gitleaks 原始检查失败，发现仅剩 §11 列明的2条历史项（false_positive / accepted_risk），touched=0、blocking=0；未改台账或豁免。证据日志为 `closure-*.log`、`closure-credo.json` 与 `artifacts/static-scan/`。

本轮恢复点：`artifacts/wip-backups/b26-closure-20261024-054658/`。HEAD、暂存区、B23原有WIP及依赖清单未变；新原生临时 profile 可逆归档至各批证据，服务进程已退出。上一个目标轮次归类为 progress；本轮继续增加实现和真实验收证据，完整队列目标保持 active，未执行完成/阻塞状态变更。

## 13. 业务结果、原子 trace 与源问题回传（2026-10-24）

### 实现与原因

- 复现普通结果已经落库后，event sink 抛错会使运行进程重启并再次执行。`AgentEventPublisher` 统一隔离 sink 的异常、退出及错误返回，记录 `event_sink_unavailable`，已提交结果继续按原身份恢复；问题交付不再自建另一套发布兜底。
- 复现续行能力缺口有 trace_ref 却无法回放。普通结果与 decision_trace 现由同一个 `InteractionLifecycle` 事务提交；去掉初始判断提前写 trace，trace 落库失败回滚结果、候选投影和输入状态。Replay 只按相同 work/session/turn/trace 读取持久结果的来源元数据，保留 `reply_record`、supplied evidence 与 `model_interpretation_status=not_provided`，不新增认知抽取或重调模型。
- 结构纠错与传输重试共用两次请求上限；传输重试保持原请求，结构纠错才追加校验原因。终局以 `judgment_protocol_violation` / `agent_plan_protocol_violation` 分类，UI/trace 不再将已知契约拒绝笼统称为内部故障；原文来源缺失保持明确拒绝。
- 空自由回复此前仅由 Zod 拦截，但发送按钮仍显示可用。按 46 §9.7 和原型 dxUhh，按钮现随空白输入禁用，非空输入不 trim；旧停等场景改为源问题 `author_choice` 回传。旧问题是否重复以持久 question_ref/answered 判定，审计区保留历史叙事不当作新问题。
- 原生业务验收暴露 test/support 的方向键转换、历史来源状态、计划必填 reasoning 及续行目标处理问题，已修复并保留失败批次。工具失败不能由替身虚构正文，续行缺口不能伪装成待答问题；这些修复不构成真实模型质量证据。

### 新增证据

| 层级 | 产物 / 场景 | 结论 |
|---|---|---|
| 原生 Tauri | `artifacts/slice-verify/b26-business-output-roundtrip-tauri-native-trace/` | 普通回复、方向选择、当前与历史原文登记、pending/accepted复用、全放弃后重登记、显式采纳、提交后断线恢复同产物；初始/续行能力缺口诚实终止。续行提问可从真实问题卡回答、同 run 重试产出草稿；“为什么”真实点击触发 replay 200，来源/未知字段保留，无模型重放。覆盖 OUT01–04/07、QA01 续行。 |
| 原生 Tauri | `b26-author-question-roundtrip-tauri-native-scope/` | 历史会话问题只读、跨作品错绑拒绝、随后正确作用域答复；拒绝不改变任一作品问题/版本/输入。补 QA08 work/session；跨 run、分页、丢回执仍引用 §12。 |
| 原生 Tauri | `b26-author-question-roundtrip-tauri-native-empty/` | 选择与自由回复各一次；空输入/空格换行禁用且网络零作者请求；带首尾空格及换行的有效回复逐字落库，关窗重开后两个问题均 answered、输入各一条。使用本次 nonce、5张截图、原始 AX/WS 与持久结果对账。 |
| 浏览器集成 | `agentic-loop-tool-failure-replan`、`agentic-loop-quality-deviation-replan`、`agentic-loop-gate-deviation-replan`、`agentic-loop-deterministic-gap-replan`、`q3b`、`q3c`、`q3d`、`agent-plan-native-tool-calling-protocol`、两个 `agent-awaiting-author-*` | 均通过；旧双调用计数改为实际请求计数，有界纠错、原文来源拒绝、提问后同 run 回传及刷新持久通过。目录仍带 tauri，summary 明确 `surface=browser / driver=headless-chromium`，不冒充原生证明。 |
| 后端局部 | `TurnInteractionServiceTest`、`AuthorQuestionRoundtripTest`、协议/计划测试 | 普通结果与 trace 的真实事务后段失败全回滚；发布失败不重复执行；既有候选后失败/缺口保留；同源 replay 不虚构认知；问题冲突/并发/取消/失活等沿 §12。QA11 只证明 live durable 重连与 dead 禁用，未实现/宣称冷启动执行调度。 |

浏览器 D1/D2/D4/D7 的实际 steps/tool_calls/provider_calls/replans 分别为 `5/1/6/0`、`6/2/8/1`、`5/0/4/0`、`5/0/4/0`。`business-regressions.tsv` 保留失败与复跑结果；原生业务前两次失败在 `native-business-attempt-{1,2}/`，最终 trace 批次独立保留。证据根除表中完整路径外均为 `artifacts/slice-verify/`；汇总日志在 `b26-single-call-judgment/`。

### 仍未闭环及恢复顺序

1. CP0：从既有备份导出旧协议/旧规则请求，在隔离探针中完成等价新协议对照，冻结完整输入、版本和超时分母；不得把旧代码重新接回生产。
2. CP3/CP4：确认同响应 `judgment_decision.plan + agent_plan_draft` 的真实页面消费，以及独立起草/修订实际路径；已通过的 D6 native-tool 场景不自动等于两者全部覆盖。再次按 §5 核查旧协议残留与 QA/OUT 证据映射。
3. B27：冻结20例×2次/臂与保留措辞、必验 stage 模型；专业调用逐项迁移后共享完整生命周期/语义验收。当前替身与单个 Strata 探针不能关闭自然表达质量问题。
4. 后续 B31/B28/B30/B29 顺序不变。问答事务 checkpoint 不能提前代替一般输入归属、整章修订、结构维护或角色主档案能力。

本批恢复点 `artifacts/wip-backups/b26-business-20261024-061350/`。验收只用隔离作品和独立桌面 profile，完整 session、待采纳草稿和 profile 均归档；未修复作者原作品。HEAD/暂存区、B23原有WIP、依赖清单/lockfile保持不变，未 commit/push。

### 本批门禁（09:29–09:32）

- `mix compile --warnings-as-errors`、`mix test`：1945 tests / 0 failures；`mix credo suggest --strict --format json` 无问题。编译零警告；测试仍有旧 unused helper/alias 警告及异步 Sandbox 结束日志，未冒充无日志噪声。
- `pnpm typecheck && pnpm lint && pnpm test`：36文件584 tests通过；设计追溯19项通过。`MIX_ENV=prod mix release sidecar --overwrite` 后以现有依赖重新打包，`CARGO_NET_OFFLINE=true NPM_CONFIG_OFFLINE=true bash scripts/frontend_audit.sh`：27 pass / 0 warn / 0 fail，原生 .app/.dmg 成功。仍为本地签名包，不是公证发行证明。
- `TASK_DONE_MANIFEST=artifacts/slice-verify/b26-single-call-judgment/manifest.json bash scripts/ai_static_scan.sh --top 10` 退出0；含 xref/arch、I3/I1/I2、N-NARR、I-CACHE、前端约束与完成证据检查。原始结果19通过/1个 gitleaks失败，发现2项、touched=0、blocking=0；本次无新增扫描问题。剩余 Top10 实际只有 §11 已记的 Pencil fileToken `false_positive` 和历史 ProjectGod凭据 `accepted_risk`，沿原台账由凭据所有者处理，未改豁免/历史/原型文件。
- 原始日志 `final-{compile,backend-tests,frontend-tests,release,frontend-audit,static-scan}.log`、`final-credo.json`；扫描双维度在 `artifacts/static-scan/{top10.md,disposition.md,report.json}`。最终证据清单引用最新 `b26-author-question-roundtrip-tauri-native-empty/summary.json`；文档记录门禁后仅刷新清单哈希并检查，不重新制造页面证据。

## 14. CP3/CP4 计划矩阵原生证据、旧实现清理与 CP5 门禁（2026-10-24 续推）

本轮按 NEXT 继续 B26：补计划矩阵原生三路径（CP4 最后一项页面证明）、清理测试侧两段式死脚手架、修复过程中暴露的最小产品可观测性问题与两处既有基线门禁，并完成 CP5 本地门禁；CP0 隔离对照见 §14.1。所有证据来自真实 Tauri 窗口、真实 Channel 帧、持久结果或隔离 provider 请求快照，不用后端直推冒充页面。

### 14.1 CP0 隔离对照（旧两段式 vs 单调用）

以 `git worktree add --detach /tmp/b26-old-cp0 60f7c553` 隔离运行旧两段式 `JudgmentProtocol.request_judgment/3`，与当前工作区单调用 `tool_choice:auto` 生产入口，在**同一冻结 12 例案例集**（历史 8 例 + J1–J4 四断点；`cases.json` sha256 `40271349…`）、同一 LM Studio `qwen/qwen3.8-27b`、同一超时口径（provider 请求 300s / 单例挂钟 600s）下逐例对照。两臂使用同一探针源码（`scripts/model_contracts/b26_cp0_arm_probe.exs`，sha256 `91a56b79…`），旧臂只在隔离 worktree 运行、测后 `git worktree remove`，未把旧协议接回生产。

| 臂 | ok | 超时 | 协议拒绝 | 其他失败 | 已完成 provider 请求 | ok 均耗时 |
|---|---|---|---|---|---|---|
| 旧两段式（隔离 worktree） | 11/12 | 1（J2 挂钟 600s） | 0 | 0 | 24 次（固定 2 次/例） | 153.9s |
| 新单调用 auto（当前工作树） | 10/12 | 1（continuation 挂钟） | 1（multi_step 用尽纠错） | 0 | 15 次（1 次/例） | 116.7s |

**协议事实**：① 调用结构：旧每例固定 2 次（call1 流式叙事 `tool_choice=none` + call2 forced `judgment_decision`，wire 降级 `required`）；新 1 次 auto（content+tool_calls 同响应），仅纠错/传输错误有界重试。② 工具集合：旧 call1/call2 各 1 个；新单次 6 个（`judgment_decision`/`ask_author`/`agent_plan_draft`/`register_author_content`/`propose_creative_directions`/`report_capability_gap`），业务结构从 judgment_decision 字段拆为独立工具。③ 输出形态：旧 reply 正文内联在 call1 content（判断说明+空行+回复，需文本抽结构）；新整段 content 即回复、零工具。④ 停等：旧 `await_author` 无 options 载体；新 `ambiguous_intent` 实测 `ask_author` 自带 3 个选项（含 free_text）；J3 空选项场景模型改判 explore，属形态差异非协议失败。⑤ 来源：J2 新 `register_author_content` + `source_ref=current` 47.2s 合法；旧 call2 返回 registration/source 但 `frame_type=meta_discussion`，旧校验要求 `capability_gap` → operation_conflict 重试，第 3 次在途时挂钟终止（超时机制已记录）。⑥ 探索：J4 两臂均 `explore_request{tool:prose_search}` 在目录内，未把探索目录工具作为 native tool 暴露。⑦ 流式/TTFT：旧 call1 流式 TTFT 可观测（18.4–136.5s）；新单调用在 LM Studio adapter 走非流式 `execute_tool_call`，TTFT 不可观测（adapter 事实，不代表其他 vendor）。⑧ 新臂 3/12 例模型把 nullable capability 写成字符串 `"null"`，新入口严格校验触发有界纠错（J1/J4 恢复、multi_step 用尽后 protocol_reject）；旧协议 plan/explore 不做该互斥校验。

**产物**：`artifacts/model-contracts/b26-cp0/`（`report.md` 345 行自动生成逐例对比/hash/命令/环境/分母/未决风险；`old-arm.json` `19f6fe6b…`、`new-arm.json` `a47f12c0…`，含每次真实请求体去密钥与响应/耗时/usage/TTFT；`harness/` 探针、报告生成器、两臂运行脚本与原始日志；`smoke-new-real.json` 预热管道验证不计入分母）。

**边界**：本对照只证明协议通路、工具/profile/合法组合、实际计数、形态与超时口径，不据此宣布总体更准（单例单次、temperature 协议属性不同、无 rubric/盲评）；两臂顺序执行未 ABBA 平衡且与并行原生验收重叠，耗时不作 benchmark；300s 覆盖 B22 local 默认口径，不能读作生产可用性；续行判断批量、计划起草/修订双工具组合与真实页面消费不在本批（由 B26 CP3/CP4 与 B27 分别承接）。质量结论归 B27 §6.1；新入口严格校验导致的协议拒绝属于真实行为，不以放宽校验换通过。

### 14.2 计划矩阵原生三路径（CP4）

命令：`TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_NATIVE_TRANSPORT_PROXY=1 TAURI_SLICE_VERIFY_TIMEOUT_SECONDS=1800 CARGO_NET_OFFLINE=true bash scripts/quality_accept.sh judgment-plan-multi-step --surface tauri`

证据目录：`artifacts/slice-verify/judgment-plan-multi-step-tauri-native/`（`quality-accept.log` 记录 `ACCEPT_EXIT:0`；`summary.json`、`native-ui-complete.json`、5 张真实界面截图、`native-transport.jsonl`、`app-log/`、`llm-calls/`、`verified-session.json`、`fixes/`）。

驱动：`scripts/macos_cgevent_plan_matrix_driver.swift`（外部 CGEvent/AX 操作真实窗口：稳定窗口、点击聚焦校验、NSPasteboard+Cmd+V、Enter 或真实发送按钮、turn_id 取自真实 `channel.user_message.start`；产品代码无验收感知逻辑）。失败批次全部保留：attempt-1（09:39 原批次）、attempt-2（provider 调用关联 NULL，check 110/111）、driver-failure-1（窗口过渡位置导致焦点丢失）、attempt-3-hmr-interference（并发 HMR 白屏）。

| 模式 | provider_calls | 独立起草 | 修订 | tool_calls | replans | pending | 终态 |
|---|---|---|---|---|---|---|---|
| 同批计划 | 3 | 0 | 0 | 2 | 0 | 3 | completed / judgment_plan_v1 |
| 另行起草计划 | 4 | 1 | 0 | 2 | 0 | 3 | completed / judgment_plan_v1 |
| 先核对再补齐计划 | 5 | 1 | 1 | 2 | 1 | 3 | completed / judgment_plan_v1 |

同一 work/session、3 条真实 `user_message`、0 条 `author_action`、`resolved_adoptions=0`；同批计划的 `judgment_decided` 与 `plan_drafted` 同 `provider_call_ref`；修订保留已完成前缀的定义字段逐字节相同且 `status=done`；每个 act 步过编排门禁，多个候选只待采纳。

本批 UI 文档（`docs/design/ui/46-state-and-feedback.md`）在首次证据后仍有口径修订，按 task-done 的 UI 证据新鲜度规则，在上述 UI 文档最后编辑后用同一驱动/断言**重新生成了一次计划矩阵原生证据**（同一 `quality_accept.sh ... --surface tauri` 命令，`ACCEPT_EXIT:0`，summary/截图/帧/`verified-session.json` 覆盖为最新批次）；两轮均为真实原生窗口与真实 Channel 帧，不伪造 mtime。

### 14.3 最小产品可观测性修复（非验收逻辑）

问题：`AgentRunServer.start_step_task/3` 在 Task 中调用 next_step_planner，独立计划起草/修订的 provider 调用发生在该 step 的 `TurnBinding.bind` 之前，日志无 turn/work/session 关联（turn_id=NULL），无法把真实 provider 调用归因到 run。行为本身正确（consumed_budget 与真实调用一致），缺的是可观测关联。

修复：在该 Task 闭包内、executor 前执行 `NovelCommon.LogContext.put_turn(run.workspace_id, run.work_id, run.parent_turn_ref, run.session_id)`（ADR-0018 LogContext 单入口）。仅此一个 hunk；不改 prompt/协议/预算/行为语义，不加任何验收专用开关，属真实产品日志可观测性（回放/审计同样受益）。修复后本批 llm-calls 12/12 行全部带 work/session/turn 作用域，独立 `agent_plan_draft`/`agent_plan_revision` 行 turn_id 等于父 turn；`mix compile --warnings-as-errors` 与独立分区 770 tests / 0 failures 自检通过。

### 14.4 旧两段式死脚手架清理（CP3 旧实现清理审计）

- 生产 lib 检索：`request_narrative` / `narrative_fn` / `draft_reasoning_prompt` / `revision_reasoning_prompt` / `tool_choice: "none"` 零残留；遗留 call1/call2 仅为历史事件注释，已改写为当前单调用语义（planner/planning/turn server/stub/chapter budget 注释）。
- 测试侧净删 −310 行死脚手架：17 处 `tool_call_prompt?` 死 else/cond 分支、7 处其他死分支（`plan_draft_reasoning_prompt?`/`continuation_narrative_prompt?` 等）、11 个死 helper；删除失效测试「叙事段首调失败 → 原样重试成功（D4 双段覆盖）」（其覆盖由保留的单调用重试测试承担）；5 个测试名与约 30 处注释改为单调用 auto 口径；新增 `single_call_protocol_guard_test.exs` 静态守卫（扫描生产 lib 禁止旧构造回流），与 `scripts/model_contracts/single_call_compliance.exs` 行为守卫互补。
- 顺带清掉 18 条既有/清理后暴露的 unused test helper/alias 警告；`mix test --warnings-as-errors` 全 umbrella 1948 tests / 0 failures / 0 warning。
- `mix credo suggest --strict`：本轮扫描首次发现 `slice_verify.ex` 的 `agent_plan_draft_packet/1` 复杂度 11>9（触碰文件 blocking）；已把 fixture 分支拆为 `agent_plan_draft_packet_for_fixture/2`，行为不变，credo 0 issue、novel_agent test 编译通过。

### 14.5 CP5 本地门禁（2026-10-24）

| 门禁 | 结果 |
|---|---|
| `mix compile --warnings-as-errors` | 通过，零警告 |
| `mix codegen.enums --check` | in sync |
| `mix run --no-start scripts/lint_enum_literals.exs` | 通过（93 canonical values；修复 HEAD 即红的既有基线，见下） |
| `mix xref graph --format cycles --label compile-connected --fail-above 0` | 无环 |
| `mix run --no-start scripts/arch_check.exs` / `adr_trace.exs` | 通过 / 27 Accepted ADR enforced_by 有效 |
| `mix test` | 1948 tests / 0 failures |
| `mix test --warnings-as-errors`（独立分区） | 1948 tests / 0 failures / 0 warning |
| `pnpm typecheck && pnpm lint && pnpm test` | 36 文件 584 tests 通过 |
| `bash scripts/frontend_audit.sh` | 27 pass / 0 warn / 0 fail |
| `bash scripts/check_design_trace.sh` | 19 通过 / 0 警告 / 0 失败 |
| I3 / I1 / I2 | 3/3（Layer-A 3/3）/ 4/4 / 3 对全不相交、0 违规 |
| N-NARR / I-CACHE | PASS / 5 个 profile 全部 covered+enforced |
| `bash scripts/quality_manifest_check.sh` | 通过（补登记原生计划场景驱动与 anti_hooks，见下） |
| `mix credo suggest --strict` | 通过（0 issue；修复本次触碰文件的复杂度 blocking，见 §14.4） |
| `MIX_ENV=prod mix release sidecar --overwrite` + `CARGO_NET_OFFLINE=true pnpm tauri build` | 通过；生成 .app / .dmg（本地 ad-hoc 签名，未公证）；前端产品代码自 09:29 批次未再变更，后端改动已随 sidecar 重新打包 |
| `bash scripts/gap_ledger.sh` | 通过；20 项开放 ID 与既有快照一致（streak 45，无新增/减少，差距源未变） |
| `bash scripts/ai_static_scan.sh --top 10` | **退出 0**：19 passed / 1 failed（gitleaks 原始检查因 2 条既有登记项返回失败）；Findings 2、touched=0、blocking=0。第 1 次扫描曾因 credo 复杂度（已修复）与 UI 证据新鲜度失败，修复后复跑（附 UI 文档最后编辑后重新生成计划矩阵原生证据，见 §14.2 末）。 |
| `node scripts/next_task_check.mjs` | 通过（NEXT 更新后复跑） |

两处既有基线问题（非本轮引入）与处置：① `lint_enum_literals.exs` 在 HEAD 即失败——`novel_domain/behavior_state.ex` 的 lifecycle 映射使用 `"RESOLVED"/"CANCELLED"/"EXPIRED"` 裸枚举字面量；本轮改为 `NovelFoundation.Enums.BehaviorStatus.*()`，lint 通过、domain 374 tests 通过。② `quality_manifest_check.sh` 对新增原生场景要求 driver 为仓库内真实路径、`anti_hooks.data_testid_required=false`；已将 `b26-business-output-roundtrip` 驱动登记为 `scripts/native_business_evidence_check.mjs`（原生 UI 由外部系统 CUA 驱动，脚本内说明），并补 anti_hooks 与 `driver_modes`，检查通过。这两项修复不改变产品行为。

### 14.6 QA01–QA12 / OUT01–OUT09 证据映射（B26 自身范围）

| 行 | 证据层级 | 证据位置 / 断言 |
|---|---|---|
| QA01 空选项提问 / QA02 选项 / QA03 自由文本与通用回复 | 原生 Tauri | `b26-author-question-roundtrip-tauri-native-empty`（选择/自由回复/空输入禁用+字节保真）、`-native` core 批次；`AuthorQuestionRoundtripTest` 事务断言 |
| QA04 刷新恢复 / QA12 多 open run 与显式回复卡 | 原生 Tauri | native core（16 轮后独立问题投影、两个 run 独立）、§12 QA04/QA12 记录 |
| QA05 ack 丢失重传 / OUT07 提交后发布丢失重放 | 原生 Tauri | `native-transport.jsonl` 外部代理丢 ack+断线重连；`AgentEventPublisher` 隔离与 `TurnInteractionServiceTest` 重放断言 |
| QA06 同身份异内容 / QA07 并发提交 | 局部确定性 | `AuthorQuestionRoundtripTest`（submission_conflict、并发仅一个 accepted） |
| QA08 旧问题/旧版本/跨 work/session/run | 原生 Tauri + 局部 | `b26-author-question-roundtrip-tauri-native-scope`、transport 跨 run 改绑拒绝、应用层作用域测试 |
| QA09 取消与回答串行 / QA10 bounded 失活 / QA11 durable | 局部确定性 | 事务测试覆盖取消先/后、bounded runtime 消失重放、durable live 重连与死 runtime 禁用；冷启动执行调度属既有条件项，不在本 slice 声称 |
| OUT01 普通 reply/方向 / OUT04 初始与续行缺口 | 原生 Tauri | `b26-business-output-roundtrip-tauri-native-trace`；浏览器 `q3b`/`agent-conversation-turn` 回归 |
| OUT02 原文首次/全放弃后重登记 / OUT03 已有 pending/accepted 复用 | 原生 Tauri | 同上业务批次（当前/历史来源、重复不新增、放弃后重登记、显式采纳） |
| OUT05 结构/来源纠正一次仍失败 | 局部确定性 | `judgment_protocol_test`/`agent_plan_*_test` 协议失败分类与终局 |
| OUT06 提交前持久化失败 / OUT08 取消与迟到响应 / OUT09 先前候选保留 | 局部确定性 | `TurnInteractionServiceTest` 真实事务后段失败回滚、取消前后、先前候选保留；§13 记录 |
| 普通回复认知记录 | 局部 + 原生 | `TurnInteractionServiceTest` 同源 replay 断言（reply_record/材料/`model_interpretation_status=not_provided`）；原生业务批次 why 入口 |

§5.1 要求真实 Tauri 的 QA01–QA05/QA08/QA12、OUT01–OUT04/OUT07 均有原生证据；其余故障/并发边界按 §5.1 允许由外部 test/support 或领域/仓储测试证明。续行提问与跨 work/session 历史动作禁用已在本轮原生矩阵（`b26-business-output-roundtrip`）与 scope 批次覆盖。

### 14.7 仍未闭环与风险（诚实边界）

1. 真实模型语义质量、B27 全专业调用与 20 例×双臂门槛仍归 B27 §6.1/CP4；本 slice 的原生证据使用 `slice_verify` 确定性替身，不证明真实模型语义质量。
2. 与 B27 专业调用完成后的生命周期/自然表达联合回归：按 §2「共享页面证据、分别判断通过」由 B27 CP4 承接；本 slice 不再有独立未完成代码项，B27 不得因本 slice 通过直接标完成。
3. durable 冷启动执行调度、CP6 外部探索翼等条件项不在 B26 范围，沿既有对账任务挂账。
4. 原生驱动依赖 macOS AX + Screen Recording 权限与安静前端窗口；任何 `frontend/src` 写入触发 Vite HMR 会整页 reload 造成白屏截图，原生验收 runbook 应约定安静窗口。
5. CP0 对照只比较协议/工具/profile/计数/耗时/超时事实，不用不同分母宣称质量提升；新协议真实模型语义按 B27 门槛判定。
6. 异步 Ecto Sandbox 结束日志仍存在（测试日志噪声，非门禁，不在本轮清理范围）。

### 14.8 恢复点与提交边界

- 本批恢复点：`artifacts/wip-backups/b26-closure-20261024-144626/`（tracked.patch、touched 文件 sha256、untracked 文件副本）。
- 本批改动范围：产品可观测性 1 个 hunk、测试死脚手架清理与静态守卫、原生驱动与证据检查脚本、计划场景登记、文档口径（ADR/contracts/README/本文件）。HEAD/暂存区、依赖清单/lockfile、其他 WIP 不变。
- B27 CP0 产物（`quality/acceptance/fixtures/b27-semantic-cases/`、`scripts/b27_case_freeze.exs`、`scripts/model_contracts/b27_semantic_eval.exs`）归属 B27 任务，提交时不得混入 B26 commit。

### CP0 记录（旧两段式 vs 单调用隔离对照）
