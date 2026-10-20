# UA01 Agentic Loop Prompt 设计收口（六方向）

- 状态：registered / 未开工；T1 为正确性回归修复优先
- 类型：AgentRun Loop Prompt/协议收口 Slice
- 登记日期：2026-07-05
- 来源：2026-07-05 Agentic Loop prompt 设计与实现 review（对话记录）；`docs/design/adr/ADR-0023-agentic-loop-plan-driven-execution-v3.md` CP4 后形态

## 1. 背景

ADR-0023 CP4 后，loop 的模型调用收敛为五类：profile 路由（strict-JSON）、计划起草/修订（native tool call，`AgenticPlanDraftPlanner`）、writer、evaluator。review 确认骨架健康（schema 枚举约束、纠错重试、叙事/结构双通道、目录带 kind），但 CP4 快速迁移留下六个方向的问题：

1. **起草信息饥饿（正确性回归）**：起草 prompt（`agentic_plan_draft_planner.ex:290-320`）无作品章节列表、无意图判定规则；07-04 移植的「续写/重写/首稿」规则块（含 rewrite→risk_hint high）在迁移中丢失，target_chapter 无列表可精确复制，全靠 `resolve_target_chapter` 确定性兜底；rewrite 的计划层确认门被削弱。
2. **双通道假设未经真实 provider 检验**：强制 `tool_choice` + 非空 reasoning content（`require_reasoning`，`:513`）是非典型组合；OpenAI-compatible 模型常在强制 tool call 时返回空 content → live provider 上系统性烧重试或硬失败。当前证据全部来自 stub/slice_verify。
3. **修订协议历史完整性**：修订要求模型复写完整计划，「保留已完成前缀」只是提示词请求；`normalize_plan_step` 把全部步骤硬编码 `status: :pending`（`:219`），cursor 按位置索引——模型漏抄前缀即错位执行错误步骤，无按 step_id 对账。
4. **观察保真回退**：CP0 的 structured_payload 保真落在已退役的旧 planner；修订器 `observation_line`（`:676-684`）只渲染一行 summary，D2 质量偏离修订时模型看不到 finding 明细。
5. **N-NARR 计划面板缺口**：`PlanStep.description` 是作者可见模型叙事（ADR-0022 决策 1），但活在 tool arguments 里而 ProviderRunLog 刻意不存 arguments（仅 count/names）→ 计划面板叙事无法字节审计；N-NARR driver 只验 reasoning 前缀。
6. **一致性与工程细节**：路由是全链唯一无重试模型调用（`dialogue_planning_service.ex:415-424`）且仍 strict-JSON；step_catalog 三处真源（PlanDraftPlanner/旧 planner/AgentTaskProfileRegistry）；success_criteria 必填但运行时零消费；修订路径 `evaluation_of_last` 从模型判悄变为 app 盖章（`revision_meta` 硬编码）未在 contract 注明；prompt 动态段前置不利 KV/prefix cache（本地推理）；I3 回显指令常驻 writer prompt 有已知污染成本。

## 2. 边界（六问）

- **Contract**: ADR-0023 planner 协议（T3 修订 tool schema 变更需 `contracts/UA-01` 同步）；ADR-0022 N-NARR（T5 provenance 小扩展）；VS-00C 写作坐标语义（T1 在计划层恢复完整）；`evaluation_of_last` 语义注记（T6）。
- **Invariant**: N-NARR 延伸覆盖计划面板叙事（T5）；N-PLAN 不动；「rewrite 高风险须过确认门」（T1 恢复 risk_hint 引导）；「一次坏输出不灭 run」延伸到路由（T6）。
- **Boundary**: `novel_application`（prompt/planner/修订合并逻辑）＋ `novel_agent`（T2 双通道 provider 策略）＋ `novel_persistence`（T5 description 哈希持久化）＋ `scripts/scenario_invariants`（N-NARR driver 扩展）；不改 `novel_web` 协议与前端产品代码。
- **Consumer**: 全部 9 个 profile 的计划起草/修订调用；计划面板作者叙事；live LM Studio/DeepSeek 用户（T2）。
- **Proof**: focused planner/flow tests；既有真实 Tauri 场景复跑（起草含章节列表/意图字段断言）；T2 需 live LM Studio 单场景（与 ADR-0023 审计的 live tool calling 验证缺口**合并为同一次经用户批准的 live 验证**）；T5 需 N-NARR driver 计划面板断言。
- **Acceptance Driver**: 既有 `quality_accept` 场景 + `--provider lmstudio` live 变体；产品代码零验收感知。

## 3. 任务

| # | 任务 | 优先级 | 说明 |
|---|---|---|---|
| T1 | 起草/修订 prompt 补意图规则块＋章节列表注入 | P0（正确性回归） | 恢复 07-04 意图规则（none/continuation/rewrite + rewrite→risk_hint high）；章节列表从 `run_spec_for_profile` 已有的 `DialogueContext.current_chapters` 注入，零新读取；加严既有 prose Tauri 场景断言（plan step 携带正确坐标）。 |
| T2 | 双通道（content+forced tool call）live provider 兼容验证与策略 | **done（2026-07-05 拍板 A 并落地）** | adapter 能力整形（DeepSeek thinking 降级、LM Studio tool_choice→required）+ `author_reasoning` arguments 回退 + `provider_output_tool_narrative` 源绑定；live LM Studio 探针 pass_rate=1.0。T5 的 description 溯源基础已就位（运行时 output 携带 arguments），剩余为 driver 计划面板断言。 |
| T3 | 修订协议改「app 保留前缀＋模型只产尾部」 | P1 | tool schema 改 revised_tail＋可选废弃列表；app 按 step_id 确定性合并；contract pack 同步；消除 cursor 错位风险并省 token。 |
| T4 | 修订 prompt 观察保真移植 | P1 | 把 CP0 的紧凑 structured_payload 渲染（含 finding gate/severity/summary）移植进修订 prompt，字符预算随 AssemblyPolicy 档位。 |
| T5 | PlanStep.description 溯源哈希＋N-NARR driver 计划面板断言 | P1 | 持久化 per-description（或 arguments 整体）哈希进 `author_narrative_source` 同款 provenance；driver 补计划面板字节断言；不把 description 重新归类为结构（与 ADR-0022 冲突）。 |
| T6 | 一致性打包 + **前缀稳定性（`contracts/VS-00I`）** | P2 → 前缀部分 **P1** | 原项：路由迁 native tool call＋一次重试；step_catalog 收敛 AgentTaskProfileRegistry 单源；success_criteria 决定消费或 schema 降级可选；`evaluation_of_last` app 盖章语义注记进 contract pack；I3 回显指令作用域收窄评估。**前缀稳定性**（原"prompt 静态段前置"一句展开，依赖 T7 已完成的 L0）：按 VS-00I 五层模型 L0–L4 对各调用点重排与分块，只改排序不改语义；**L4 置尾与调用对工具恒定为硬规则**（2026-10-21 拍板）；厂商无关，adapter 只做断点 / 字段映射。分期 **CP-AB**（离线前缀共享度量 + 全厂商 TTFT + §5 矩阵待核实回填 + live 基线 + 工具恒定 + 续行调用对重排作首个对照 + 顺带修 VS-00H P1 activity 投影）→ CP-D 起草 / 修订 → CP-C 判断 call1 重排（**MBC A/B 硬门禁，失败即登记例外**）→ CP-E 厂商断点与基线复测 + I-CACHE-1 升 CI 阻断。**排期：Q1c 收口后首位、任何再碰 prompt 的工作之前。** VS-00I 待 CP-AB 实证后再 Frozen。 |
| T7 | 系统身份消息层（`contracts/VS-00H`） | P1 | **CP1–CP3 实现完成（2026-10-21）**。VS-00D §4.4 SYSTEM 块首次落地：身份文本唯一真源模块 + `Gateway.execute/4` 唯一注入（幂等、首位、不设 opt-out）+ ProviderRun 事实携带 `system_identity_ref`（不落原文）；CP2 去 18 处调用点产品自称 + I-SYS-2 静态守卫；CP3 `Usage.cached_tokens` + adapter 映射 + Anthropic `cache_control`。Boundary：CP1 只改 `novel_agent`；CP2 仅改 application/agent 调用点文本；web/frontend/persistence schema 不动。Proof：gateway focused tests + 全量 `mix test` + 一条既有 slice_verify 场景复跑（Stub 捕获帧或 developer activity API 中 `system_identity_ref`）+ I1/I2/I3。分期与风险见 VS-00H §8/§9。 |

## 4. 验收

- [ ] T1：focused tests＋`agent-prose-drafting-with-quality` 等既有 Tauri 场景加严复跑（计划步坐标断言）
- [ ] T2：live LM Studio 单场景（经用户批准）＋策略落地后的 focused tests
- [ ] T3：修订合并 focused tests＋D6/steer Tauri 场景复跑＋contract pack 同步
- [ ] T4：D2 场景复跑（修订 prompt 含 finding 明细断言可经 developer 视图/trace 验证）
- [ ] T5：N-NARR driver 扩展后 `run_n_narr.exs` PASS 含计划面板断言
- [ ] T6：逐项 focused tests；路由重试有单测
- [ ] T6 CP-AB：`run_icache_prefix.exs` 对续行调用对给出"改前≈L0 / 改后 call2≈call1 全长"可区分数字；I-CACHE-2 绿；MBC 不退化且 call1 在 `tool_choice: none` 下无工具调用倾向；TTFT 进 ProviderRun；VS-00I §5 矩阵"待核实"项回填；有凭据厂商各一条 `cached_tokens` / TTFT 基线落 `artifacts/`；activity API 可见 `system_identity_ref`（VS-00H P1 收口）
- [ ] T6 CP-D：起草 / 修订跨 run 共享前缀覆盖 L1；`run_id` 移出或置尾；N-PLAN 绿
- [ ] T6 CP-C：判断 call1 连续两轮共享前缀覆盖 L0–L2；**MBC A/B pass_rate 不降**；I1/I2/I3 绿；失败则该调用点登记例外并保留现顺序
- [ ] T6 CP-E：Anthropic live 一次 `cache_read_input_tokens > 0`；各厂商基线相对 CP-AB 有可解释改善；I-CACHE-1 登记进 `scenario-invariants.md` 升 CI 阻断；VS-00I 改 Frozen
- [x] T7 CP1：gateway focused tests（I-SYS-1 首位唯一 / 幂等 / Stub 兼容）＋全量 `mix test` 爆点逐条显式处理＋一条既有 slice_verify 对话场景复跑出 `system_identity_ref`＋I1/I2/I3
- [x] T7 CP2：18 处调用点产品自称清零＋I-SYS-2 静态守卫绿＋既有 MBC 探针 pass_rate 不退化（stub 1.0；live MBC 未测，见 VS-00H §11.1）
- [x] T7 CP3：`cached_tokens` 进 ProviderRun 与开发者视图；judgment call1/call2 前缀共享有实测数据（真实 vendor cache hit 未测，见 VS-00H §11.1）
- [x] 全量门禁：`mix compile --warnings-as-errors`、`mix test`、xref、arch_check、I1/I2/I3、N-NARR、静态扫描

## 5. 决策记录

- 2026-10-21 — **T6 CP-AB A2 TTFT**：`Usage.ttft_ms` 落地；OpenAI-compatible / Anthropic stream 在首个 text/tool delta 记录，非流式响应构造器以 `latency_ms` 回填；`Usage.to_map` 随 ProviderOutput 持久化并进入 activity usage。测试：`usage_test`、OpenAI/Anthropic stream 首 delta、`provider_activity_service_test`。未做真实厂商 live 基线（A3）。
- 2026-10-21 — **T6 CP-AB A1 基线**：新增 `scripts/scenario_invariants/run_icache_prefix.exs`，在 Gateway 边界捕获 identity 注入后的 structured prompt，用生产 `JudgmentProtocol` call1/call2 prompt builders 度量。改前数字：
  - `continuation call_pair: 523/1683 (0.3108)`
  - `conversation call_pair: 525/5282 (0.0994)`
  报告：`artifacts/scenario-invariants/icache-before.md`、`icache.md`。诚实边界：本步只覆盖两处判断调用点的 prompt builder → Gateway 帧，尚未驱动完整 AgentRun 偏离链；A2 TTFT、B1 工具恒定、B2 续行重排、B3 activity 投影、A3/A4 厂商/运行侧核实均未开工；本步无阈值断言（I-CACHE-1 按计划 CP-C 后升 CI 阻断）。
- 2026-10-21 — **T6 前缀稳定性三项拍板 + 排期**（用户确认）：① L4 置尾为硬规则，前移须先有该调用点 MBC A/B 数据；L4 不再新增静态段，新增静态内容默认进 L1。② 调用对工具恒定默认开启，CP-AB 数据只决定是否按 adapter 回退；MBC 须专门断言 call1 在 `tool_choice: none` 下无工具调用倾向。③ CP-A 与 CP-B 合并为 CP-AB（度量无"改后"样本不可信；A 单独落是"只建工具不消费"的禁止形态），顺序 AB → D → C → E，C 带明确失败路径。附带：VS-00H 评审 P1（activity 投影 `system_identity_ref`）并入 CP-AB；I-CACHE-1 先报告、CP-C 后升 CI 阻断；VS-00I 待 CP-AB 实证后再 Frozen；身份文本保持 v1 不与 T6 捆绑。**排期：不插队 Q1c，CP-AB 排 Q1c 收口后首位、任何再碰 prompt 的工作之前。**
- 2026-10-21 — **T6 前缀稳定性契约落档（设计先行，不开工）**：T7 落地后实测身份 171 字符之后立即分叉——跨调用点分叉于角色句、同调用点跨轮分叉于首个动态字段（判断 context_block 把静态能力目录排在会话摘要之后；起草第 2 行即 run_id）、调用对分叉于工具集差异（call1 无 tools / call2 有）。契约 `contracts/VS-00I`：五层稳定度 L0–L4（厂商无关）、六段骨架映射与冲突裁决（⑤⑥置尾不动，有判例的位置要求优先于缓存）、调用对工具恒定、逐调用点映射表、十厂商适配矩阵、离线前缀共享度量为主 proof。用户明确：目标不只 LM Studio，厂商差异只进矩阵。顺序 A → B → D → C → E，判断 call1 重排放最后且以 MBC A/B 为硬门禁。队首不变。
- 2026-10-21 — **T7 CP1–CP3 实现完成**：`NovelAgent.Provider.SystemIdentity` 成为身份文本唯一真源；`Gateway.execute/4` 注入且幂等；ProviderRun metadata 携带 `system_identity_ref`（不落原文）；18 处调用点去产品自称 + I-SYS-2 守卫；`Usage.cached_tokens` 与 Anthropic `cache_control` 落地。证据：`system_identity_test.exs`、gateway I-SYS-1/幂等/共享前缀、全量 `mix test` 1570/0、`slice_verify au02-candidate-continuation` PASS + 测试库 ProviderRun ref、I1/I2/I3 全绿、MBC stub 1.0。诚实边界：真实 vendor cache hit 未测；`system_identity_ref` 的开发者 UI 展示未做。
- 2026-10-21 — 登记 T7 系统身份消息层：用户指出全 app 与 LLM 交互缺统一产品身份前提；代码核查证实零 `role: "system"`、18 处调用点三种产品自称、VS-00D §4.4 SYSTEM 块从未落地。契约落 `contracts/VS-00H`（Proposed）。关键裁决：注入点选 Gateway 而非 application 层（judgment_protocol 6 处 `[message | rest]` 首消息假设 + novel_agent 内部调用点可达性）；身份文本禁含输出格式/语言/角色名；trace 只落 `system_identity_ref` 不落原文（`system_prompt` 已是敏感键）；缓存是顺带收益不是动机，先让 `cached_tokens` 可测再谈前缀优化。T6 "静态段前置"改为依赖 T7。本次只落文档，不改代码，不改队首（Q1c 仍为唯一 next）。
- 2026-07-05 — 六方向由 prompt review 产出并登记；T1 为正确性回归（CP4 迁移丢失意图规则），优先于其余项。T2 与 ADR-0023 审计的「live provider tool calling 未验证」缺口合并为同一次经批准的 live 验证，不单独触发重型验证。
