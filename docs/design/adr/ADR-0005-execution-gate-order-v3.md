# ADR-0005：Execution Gate Order v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00b-end-to-end-dialogue-flow.md` §5-7
  - `../00c-state-and-contract-atlas.md` §5.3 / §6.2 / §6.3 / §7 / §8 / §9 / §11
  - `../03-capability-toolbox-contract.md` §3 / §7 / §8 / §10
  - `../04-execution-orchestrator.md` §6 / §8-14 / §17-18
  - `../05-turn-behavior-and-state-model.md` §6 / §9 / §11
  - `../06-memory-context-and-trace.md` §5-7 / §10
  - `../07-workbench-ui-contract.md` §3-5
  - `../contracts/VS-01-execution-authority-contract-pack.md`
  - `ADR-0002-micro-plan-v3.md`
  - `ADR-0003-planner-authority-boundary.md`
  - `ADR-0004-orchestrator-decision-v3.md`
- 影响范围：Execution / Toolbox / Behavior / Adoption / TurnResult / Trace / UI / Umbrella / Slice
- 相关不变量：`00c` §7 #2、#3、#4、#5、#6、#7、#9、#10、#11、#12、#14、#15
- 首个证明 slice：`tasks/slices/v3/VS-01-micro-plan-downgrade-confirmation.md`
- 取代：无
- 取代者：无

> Accepted 范围：冻结 Execution Orchestrator 形成 decision 前的最小 gate order，以及 VS-01 所需的 action scope、authority、budget、write boundary、trace readiness、TurnResult compatibility 证明子集。本文不授权代码实现；代码实现仍需用户明确开始。

---

## 背景

ADR-0004 已经提出把 `OrchestratorDecision` 作为 v3 的执行裁决 envelope。

但只有 decision envelope 还不够。系统还必须稳定回答：

```text
Orchestrator 按什么顺序审查 MicroPlan？
哪个门禁失败会产生 clarification、confirmation、downgrade、reject 或 recovery？
哪些门禁必须在 ToolRequest dispatch 或 state adoption 之前完成？
```

如果 gate 顺序不冻结，v3 会出现几类长期风险：

1. 先检查工具可用性，再发现 plan 本身越过下一步边界，导致工具层承担语义判断。
2. 先打开新的 confirmation，再处理旧 open behavior，导致等待态交错不可回放。
3. 先派发工具，再补 authority / budget / policy，导致执行权后置。
4. 先采纳 ToolResult，再检查 write / adoption boundary，导致 tentative-first 被绕过。
5. 先组装 TurnResult，再补 trace，导致输出说了系统无法审计的事实。

`Execution Gate Order` 解决的是这个问题：

```text
执行裁决必须按稳定、可解释、可测试的门禁顺序形成。
```

它不是一个万能 policy engine，也不是每个 gate 的最终实现模块。它冻结的是 v3 第一批执行 slice 必须遵守的审查顺序、失败类别和 trace 纪律。

---

## 决策范围

本 ADR 决定以下内容：

1. Execution Orchestrator 在形成 `OrchestratorDecision` 前必须按稳定顺序审查输入、行为、动作、权限、策略、预算、工具、写入、trace 和 TurnResult 兼容性。
2. gate order 是 `OrchestratorDecision` 的前置形成规则，不是 Planner 或 Toolbox 的职责。
3. gate order 必须记录 `GateResult` 或等价 trace 节点，供 DecisionTrace / replay 使用。
4. 硬失败、软降级、等待作者、幂等复用必须产生可解释 decision。
5. ToolRequest dispatch 必须发生在相关 gate 通过之后。
6. state adoption 必须发生在 write / adoption boundary 和 trace readiness 通过之后。
7. TurnResult compatibility 是最后一道防线，防止输出宣称未发生事实。
8. gate 顺序允许后续 ADR 扩展 gate 细节，但不能随意重排会改变安全语义的相对顺序。

本 ADR 同时冻结最小 gate 语义组：

| 顺序 | Gate | 目的 | 失败或阻断时常见 decision |
|---:|---|---|---|
| 0 | Correlation / idempotency | 防重复执行，确认 turn / frame / plan / action / author action 关联 | `fail_with_recovery` / replay existing decision |
| 1 | Envelope validation | 校验 `DialogueFrame`、`MicroPlan`、PlannerOutput boundary 和引用关系 | `fail_with_recovery` |
| 2 | Behavior compatibility | 先处理当前 open behavior 是否匹配本轮输入 | `require_clarification` / `cancel_or_close` |
| 3 | Action scope | 确认 plan 没有越过下一步边界或伪装成长计划 | `downgrade_to_dialogue` |
| 4 | Slot / contract validation | 检查关键 slot、schema、目标对象、confirmation target 合法性 | `require_clarification` |
| 5 | Authority | 检查作者、工作区、写入范围和工具权限 | `require_confirmation` / `reject` |
| 6 | Policy / safety | 检查内容策略、风险等级、禁止操作和安全降级 | `reject` / `downgrade_to_dialogue` |
| 7 | Budget | 检查 token、时间、成本、并发、工具调用和长跑预算 | `require_confirmation` / `fail_with_recovery` |
| 8 | Toolbox availability | 检查 capability 是否存在、启用、版本兼容、输入可构造 | `fail_with_recovery` |
| 9 | Write / adoption boundary | 确认 tentative / production / adoption / projection 边界 | `require_confirmation` / `allow_next_action` |
| 10 | Trace readiness | 确认本轮执行或不执行都能被记录和回放 | `fail_with_recovery` |
| 11 | TurnResult compatibility | 确认输出不会宣称未执行、未采纳或不可审计事实 | `reply_only` / `fail_with_recovery` |

---

## 非目标

本 ADR 不冻结：

1. 每个 gate 的最终模块名、函数名或实现位置。
2. `GateResult` 的最终 JSON Schema 字段全集。
3. `reason_codes` 的完整编码表。
4. 具体 authority / policy / safety 规则。
5. 具体 budget 计算模型。
6. Capability Registry、ToolRequest、ToolResult 的最终 schema。
7. BehaviorState、ConfirmationBinding、CancellationSemantics 的字段全集。
8. State Adoption Boundary 的所有 production write 条件。
9. TurnPhase / TurnStatus / NextAction 兼容矩阵。
10. Trace redaction 层级和存储实现。
11. 并发锁、数据库事务和幂等存储的实现细节。
12. UI 组件结构或前端交互视觉。

这些内容由后续 Batch B / Batch C ADR、schema 草案和垂直切面实现阶段承接。

---

## 考虑过的方案

### 方案 A：不冻结顺序，只要求所有 gate 都通过

实现可以任意排序 gate，只要最终检查完整。

- 优点：实现弹性最大，可以按当前代码便利程度推进。
- 缺点：失败原因不稳定；不同路径会产生不同 decision；trace/replay 难以解释；容易在工具 dispatch 或状态采纳之后才发现前置 gate 失败。

### 方案 B：按风险高低动态排序 gate

Orchestrator 根据 MicroPlan 的 risk hint、capability 和目标对象动态选择 gate 顺序。

- 优点：表面上更智能，低风险路径更短。
- 缺点：风险等级本身需要 gate 判断，不能由 Planner 自己宣布；动态顺序让 replay 和测试变复杂；低风险例外容易膨胀成绕过 authority / budget / trace 的路径。

### 方案 C：冻结最小稳定顺序，允许 gate 内部扩展

Orchestrator 采用固定的外层顺序：先关联和 envelope，再处理 open behavior，再检查 scope / contract，再 authority / policy / budget，再 toolbox / write / trace / TurnResult。每个 gate 内部可以由后续 ADR 或实现扩展。

- 优点：安全语义稳定；测试可写；trace/replay 可解释；不会把工具或 UI 推到裁决前面。
- 缺点：低风险路径也要经过完整外层顺序；早期实现需要保留 GateResult trace。

### 方案 D：让 Tool / Policy service 自己拒绝不合法请求

Orchestrator 只负责粗略 dispatch，具体工具、policy、authority、budget service 在执行时自行拒绝。

- 优点：各 service 可以独立保护自己；Orchestrator 变薄。
- 缺点：执行权分散；ToolRequest 可能已经产生或开始执行；TurnResult 和 trace 无法统一解释“为什么不执行”；违背 ADR-0004 的 decision source of truth。

---

## 最终决策

采用 **方案 C：冻结最小稳定顺序，允许 gate 内部扩展**。

具体决策：

1. Execution Orchestrator 必须按本 ADR 的 0-11 顺序审查行动建议。
2. gate 可以在内部调用 helper、纯规则模块、工具或 registry 查询，但不能把裁决权交给 Planner、Toolbox、UI 或 persistence。
3. 每个关键 gate 必须产生 `GateResult` 或等价 trace 材料，至少包含 gate identity、input refs、outcome、reason code、author-visible summary eligibility。
4. `Correlation / idempotency` 必须先于 envelope 之后的业务判断，防止重复 confirmation、retry 或 write。
5. `Envelope validation` 必须先于所有业务 gate；无 primary `DialogueFrame`、plan 引用错误、Planner 越权语义必须在此阶段拦截或恢复。
6. `Behavior compatibility` 必须先于新 action scope；当前 open clarification / confirmation / cancellation / recovery 先被解析，不能被新 plan 覆盖。
7. `Action scope` 必须先于 slot / authority / budget；多步、长跑、写入链路过宽的 plan 先降级或切断。
8. `Slot / contract validation` 必须先于 authority；目标对象和关键参数不合法时不进入权限判断假装“可执行”。
9. `Authority` 必须先于 policy / budget / toolbox；没有权限的动作不能消耗后续工具或预算。
10. `Policy / safety` 必须先于 budget / toolbox；被禁止或需降级的动作不能先执行成本估算或工具 dispatch。
11. `Budget` 必须先于 toolbox dispatch；长跑、高成本、并发敏感动作必须先被确认或恢复。
12. `Toolbox availability` 必须先于 write / adoption；不存在、禁用、版本不兼容或输入无法构造的 tool 不能进入写入边界。
13. `Write / adoption boundary` 必须先于 trace readiness 和 dispatch 写入；ToolResult 或 MicroPlan 候选变化不能直接成为 production fact。
14. `Trace readiness` 必须先于产生不可逆写入或对外声称结果；无法记录 trace 时必须 fail with recovery 或降级。
15. `TurnResult compatibility` 必须在最后检查输出事实一致性。
16. `allow_bounded_read_batch` 只允许在所有相关只读动作共享同一 gate 结果、无 production write、无 high-risk policy、trace 可完整记录时使用。
17. confirmation answer 必须重新经过 gate；作者说“确认”不能跳过 scope、authority、policy、budget、write boundary 或 trace readiness。
18. 幂等 replay 只能复用同一 gate lineage 的已完成 decision；输入内容不一致时必须 reject 或 recovery。

### Gate outcome 语义

每个 gate 的 outcome 至少需要覆盖以下语义族：

| Outcome | 含义 |
|---|---|
| `pass` | gate 通过，可进入下一个 gate |
| `pass_with_note` | 通过但留下风险、降级或 trace note |
| `soft_block` | 不能执行，但可以通过 clarification / confirmation / dialogue 继续 |
| `hard_block` | 权限、策略、schema 或不可恢复约束阻断 |
| `replay_existing` | 幂等命中，复用已有 decision / TurnResult |
| `recoverable_failure` | 系统、工具、预算、trace 或状态冲突可恢复 |

### Gate 与 decision 的映射

| Gate 阶段 | 常见 outcome | 常见 `decision_type` |
|---|---|---|
| Correlation / idempotency | replay_existing | replay existing decision |
| Envelope validation | hard_block / recoverable_failure | `fail_with_recovery` |
| Behavior compatibility | soft_block | `require_clarification` / `cancel_or_close` |
| Action scope | soft_block | `downgrade_to_dialogue` |
| Slot / contract validation | soft_block | `require_clarification` |
| Authority | soft_block / hard_block | `require_confirmation` / `reject` |
| Policy / safety | soft_block / hard_block | `downgrade_to_dialogue` / `reject` |
| Budget | soft_block / recoverable_failure | `require_confirmation` / `fail_with_recovery` |
| Toolbox availability | recoverable_failure | `fail_with_recovery` |
| Write / adoption boundary | soft_block / pass | `require_confirmation` / `allow_next_action` |
| Trace readiness | recoverable_failure | `fail_with_recovery` |
| TurnResult compatibility | recoverable_failure / pass | `reply_only` / `fail_with_recovery` / original decision |

---

## 决策理由

选择方案 C 的原因：

1. **保护执行权**：Orchestrator 先审查再 dispatch，Toolbox 不承担批准责任。
2. **保护下一步边界**：scope 早于 slot、authority 和 budget，防止长计划被逐项合理化。
3. **保护 durable behavior**：当前 open behavior 先解析，避免 confirmation、clarification、cancellation 交错。
4. **保护 tentative-first**：write / adoption boundary 在 dispatch 写入和 TurnResult 声称前完成。
5. **保护成本和权限**：authority、policy、budget 都在 toolbox 前完成，避免无权或高风险动作消耗工具。
6. **保护 trace/replay**：每个 gate 都有可记录 outcome，失败路径也能被解释。
7. **保护 UI canonical 出口**：TurnResult compatibility 最后检查，不让 UI 看到不真实状态。
8. **适合垂直切面**：VS-01 可以用多步和高风险 MicroPlan 证明 scope、authority、budget、write boundary 的不同输出。

拒绝方案 A，是因为“都检查了”无法保证安全语义和 replay 一致。
拒绝方案 B，是因为风险等级不能由 Planner 自己决定，动态顺序不利于审计。
拒绝方案 D，是因为它把执行权分散到工具和 service 内部。

---

## Contract 影响

### 新增 contract

`Execution Gate Order` 成为 v3 execution contract。

最小语义组：

| 语义组 | 说明 |
|---|---|
| gate identity | gate 可被 trace、test、reason code 引用 |
| sequence index | gate 顺序稳定 |
| input refs | gate 引用 turn / frame / plan / decision draft / behavior / registry / snapshot |
| outcome | pass、soft block、hard block、replay、recoverable failure 等 |
| reason code | 机器可读原因 |
| author visibility | 是否可进入 author-visible reason |
| trace link | GateResult 必须进入 DecisionTrace 或 decision trace summary |
| decision mapping | gate outcome 如何影响 `OrchestratorDecision` |

### 对 OrchestratorDecision 的影响

`OrchestratorDecision` 必须能承接：

- gate summary
- first blocking gate
- approved gate lineage
- soft downgrade reason
- hard reject reason
- required author action reason
- replay existing decision reason
- recoverable failure reason

ADR-0004 中的 `reason_codes` 不再只是自由原因集合，必须能追溯到 gate identity 和 outcome。

### 对 MicroPlan 的影响

`MicroPlan` 仍然只是建议。

`risk hint`、`requires_confirmation_hint`、`required_capabilities`、`state_changes_requested` 都只是 gate input，不是 gate result。

### 对 ToolRequest 的影响

ToolRequest 只能在相关 gate 通过后产生或派发。

至少必须满足：

1. envelope / behavior / scope / contract 没有阻断。
2. authority / policy / budget 允许该动作。
3. toolbox availability 确认可用。
4. write / adoption boundary 允许该 write scope 或明确只读。
5. trace readiness 允许记录 provenance。

### 禁止语义

GateResult 不应包含：

- raw private reasoning
- provider raw response
- unvalidated PlannerOutput
- UI local state
- Repo / DB implementation detail
- ToolResult as production fact
- final TurnResult copy

### 后续 ADR 依赖

| 后续 ADR | 依赖方式 |
|---|---|
| ADR-0006 TurnPhase / TurnStatus v3 | gate outcome 到 phase/status 的映射 |
| ADR-0007 NextAction / AvailableAction v3 | soft block / confirmation / retry 如何产生 action |
| ADR-0008 BehaviorState v3 | Behavior compatibility gate 如何 open / close / resolve behavior |
| ADR-0009 Confirmation Binding v3 | confirmation answer 如何重新经过 gate |
| ADR-0010 State Adoption Boundary v3 | Write / adoption boundary gate 的细节 |
| ADR-0011 Toolbox Registry v3 | Toolbox availability gate 的 registry 语义 |
| ADR-0012 ToolRequest / ToolResult v3 | ToolRequest gate provenance |
| ADR-0013 DecisionTrace v3 | GateResult trace 结构 |
| ADR-0014 Trace Redaction v3 | gate reason 的 author/debug 可见性 |

---

## Umbrella 边界影响

本文不冻结最终模块名，但冻结责任边界。

| App | Gate order 边界 |
|---|---|
| `novel_foundation` | 可承接通用 Result/Error、id、validation helpers；不承接业务 gate 顺序 |
| `novel_domain` | 可承接纯领域规则、adoption 纯校验；不调用 Planner、Toolbox、Repo 或 provider |
| `novel_agent` | 可承接 Planner runtime、provider gateway、tool runtime；不形成 GateResult 的最终裁决 |
| `novel_application` | 负责 gate 顺序编排、GateResult 聚合、OrchestratorDecision 形成、TurnResult assembly |
| `novel_persistence` | 只能存储已决定记录的 gate trace / decision / state；不决定 gate outcome |
| `novel_web` | 只提交 AuthorInput / AuthorActionInput 并返回 TurnResult；不运行 gate |
| `frontend` | 只消费 TurnResultViewModel / available actions；不判断 gate 是否通过 |

首个证明 slice 不需要一次冻结所有 gate 模块归属，但必须证明：

1. `novel_application` 控制 gate 顺序。
2. `novel_agent` 的 Planner hint 不会跳过 gate。
3. Toolbox dispatch 之前能看到 approving decision / gate lineage。
4. Web 和 frontend 不拥有 authority、budget、policy 或 adoption 判断。

---

## UI / Trace / Replay 影响

### UI

UI 可以看到：

- TurnResult 中的 assistant_message
- available_actions
- phase / status / next_action
- author-visible reason summary
- trace_summary 中经过脱敏的 gate summary

UI 不可以：

- 根据本地状态判断 gate 是否通过
- 自行重试被 gate 阻断的 ToolRequest
- 根据 Planner 的 confirmation hint 打开 confirmation
- 把 budget / authority / policy 失败解释成可执行状态
- 绕过 TurnResult 提交 stale 或 invented action

### Trace

DecisionTrace 必须记录：

- gate order version
- gate identity
- input refs
- outcome
- reason code
- first blocking gate
- soft downgrade path
- required author action reason
- approved ToolRequest provenance
- write / adoption boundary result
- TurnResult compatibility result

Trace 不应记录 raw private reasoning。

### Replay

Replay 至少能回答：

```text
这一轮按哪个 gate order 审查？
第一个阻断 gate 是什么？
哪些 gate 通过、软阻断、硬阻断或触发 recovery？
为什么产生这个 OrchestratorDecision？
ToolRequest 或 TurnResult 是否在 gate 完成后才产生？
```

Replay 默认不重新调用 LLM，也不重新动态排序 gate。

---

## 垂直切面证明

首个证明 slice：`00c` §9.2 VS-01 MicroPlan 被 Orchestrator 降级或要求确认。

该 slice 应证明：

| 问题 | 回答 |
|---|---|
| Contract | `MicroPlan`、`Execution Gate Order`、`GateResult`、`OrchestratorDecision`、`DecisionTrace`、`TurnResult` |
| Invariant | Orchestrator 是执行权唯一门禁；默认只放行下一步；高风险和写入必须经过门禁；confirmation answer 重新 gate |
| Boundary | 切过 application gate orchestration / agent planner hint / toolbox availability / trace；不让 web 或 frontend 执行 gate |
| Consumer | Orchestrator contract test、Toolbox dispatch boundary test 或 TurnResult Builder |
| Proof | 多步 plan 在 Action scope gate 降级；高风险写入在 Authority / Budget / Write boundary gate 产生 confirmation；trace 记录 first blocking gate |

建议测试方向：

1. 无 `DialogueFrame` 在 Envelope validation gate 失败，产生 recovery decision。
2. 多步写入 plan 在 Action scope gate 被 downgrade，不进入 toolbox availability。
3. 缺关键目标对象在 Slot / contract validation gate 产生 clarification。
4. 无权限写入在 Authority gate 产生 reject 或 confirmation，不产生 ToolRequest。
5. policy 禁止动作在 Policy / safety gate 产生 reject。
6. 高预算动作在 Budget gate 产生 confirmation 或 recovery。
7. disabled capability 在 Toolbox availability gate 产生 recovery。
8. production write 未满足 adoption 条件时在 Write / adoption boundary gate 产生 confirmation 或 downgrade。
9. trace 不可写时在 Trace readiness gate 阻断 production write。
10. TurnResult 文案宣称未发生事实时在 TurnResult compatibility gate 失败。
11. confirmation answer 重新经过 gate，而不是直接执行 pending action。
12. DecisionTrace 记录 gate order version、first blocking gate 和 reason code。

---

## 迁移与兼容

v3 不继承 v2 Router-first handler 顺序。

可保留的 v2 原则：

- authority、budget、policy、confirmation、adoption 都需要机器可测试。
- TurnResult 是 UI canonical 出口。
- UI action 回传必须重新校验。
- trace / replay 需要稳定引用。

需要废弃或重解释的 v2 资产：

| v2 资产 | v3 处理 |
|---|---|
| handler 内部 if/else 顺序 | 不能作为 v3 gate order；必须映射到本 ADR gate |
| intent matched 后执行 | 必须先经过 scope / contract / authority / policy / budget / write boundary |
| confirmation UI modal | 只是 author action 呈现；answer 必须重新 gate |
| tool 自己做权限判断 | 可以做局部保护，但 Orchestrator gate 才是裁决来源 |
| ToolResult 成功即写入 | 必须经过 write / adoption boundary |

迁移时不能把旧 handler 的检查顺序原样搬进 Orchestrator。需要先把它拆成 gate outcome、reason code 和 decision mapping。

---

## 后续工作

1. `../contracts/VS-01-execution-authority-contract-pack.md` 已补齐 VS-01 所需的 gate order subset、GateResult trace facts 和 proof 草案。
2. `tasks/slices/v3/VS-01-micro-plan-downgrade-confirmation.md` 已关闭 VS-01 文档 blocker。
3. 后续 schema 草案中补 `GateResult` 字段全集、gate order version 和 reason code registry。
4. 用户明确批准进入代码后，再为 VS-01 创建 implementation plan / contract test：多步 plan 降级、高风险 plan confirmation、first blocking gate trace。
5. 后续 ADR-0008 / ADR-0009 冻结 Behavior compatibility gate 与 confirmation binding 的字段。
6. 后续 ADR-0010 冻结 Write / adoption boundary gate 的 production write 条件。
7. 后续 ADR-0013 冻结 GateResult 如何进入 DecisionTrace 和 replay report。
