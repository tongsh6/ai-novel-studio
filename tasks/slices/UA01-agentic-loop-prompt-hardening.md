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
| T6 | 一致性打包 | P2 | 路由迁 native tool call＋一次重试；step_catalog 收敛 AgentTaskProfileRegistry 单源；success_criteria 决定消费（参与步骤完成核对/D 系信号）或 schema 降级可选；`evaluation_of_last` app 盖章语义注记进 contract pack；prompt 静态段前置（KV cache 友好）；I3 回显指令作用域收窄评估。 |

## 4. 验收

- [ ] T1：focused tests＋`agent-prose-drafting-with-quality` 等既有 Tauri 场景加严复跑（计划步坐标断言）
- [ ] T2：live LM Studio 单场景（经用户批准）＋策略落地后的 focused tests
- [ ] T3：修订合并 focused tests＋D6/steer Tauri 场景复跑＋contract pack 同步
- [ ] T4：D2 场景复跑（修订 prompt 含 finding 明细断言可经 developer 视图/trace 验证）
- [ ] T5：N-NARR driver 扩展后 `run_n_narr.exs` PASS 含计划面板断言
- [ ] T6：逐项 focused tests；路由重试有单测
- [ ] 全量门禁：`mix compile --warnings-as-errors`、`mix test`、xref、arch_check、I1/I2/I3、N-NARR、静态扫描

## 5. 决策记录

- 2026-07-05 — 六方向由 prompt review 产出并登记；T1 为正确性回归（CP4 迁移丢失意图规则），优先于其余项。T2 与 ADR-0023 审计的「live provider tool calling 未验证」缺口合并为同一次经批准的 live 验证，不单独触发重型验证。
