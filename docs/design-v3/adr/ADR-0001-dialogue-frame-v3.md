# ADR-0001：DialogueFrame v3 语义与最小 Contract

- 状态：Proposed
- 日期：2026-05-06
- 来源文档：
  - `../00b-end-to-end-dialogue-flow.md` §1-3
  - `../00c-state-and-contract-atlas.md` §4 / §6 / §7 / §8 / §9
  - `../02-dialogue-frame-and-micro-plan.md` §1-2 / §4-5 / §7-9
- 影响范围：Dialogue / Trace / TurnResult / UI / Umbrella / Slice
- 相关不变量：`00c` §7 #1、#2、#8、#9
- 首个证明 slice：`00c` §9.1 VS-00 Reply-only DialogueFrame + TurnResult + Trace
- 取代：无
- 取代者：无

---

## 背景

v3 的核心方向是 Dialogue-first / Agent-native，不再让 Router 作为 turn 第一认知节点。

如果移除 Router-first 之后没有新的结构化认知锚点，系统会退回两种坏状态：

1. 只靠自然语言 prompt 解释本轮意图，无法审计、回放或测试。
2. 让 UI、工具或 Orchestrator 各自推断 intent / slot / next action，造成多个事实来源。

`DialogueFrame` 解决的是这个根问题：

```text
每个 turn 都必须留下一个结构化、可审计、可引用的认知帧。
```

它不是为了让系统回到表单式补槽，也不是为了把 LLM 的私有推理暴露出来。它是 v3 主链中连接作者输入、Planner、MicroPlan、TurnResult 和 DecisionTrace 的认知 contract。

---

## 决策范围

本 ADR 决定以下内容：

1. 每个作者 turn 必须产生一个 primary `DialogueFrame`。
2. `DialogueFrame` 是 turn 的结构化认知入口，取代 v2 Router-first 心智中的 `RouterResult` 顶层位置。
3. `DialogueFrame` 由 Dialogue Planner 生成，但必须经过系统 envelope 校验后才能进入 TurnResult / Trace。
4. `DialogueFrame` 可以触发 `MicroPlan`，但自身不包含执行授权。
5. reply-only turn 也必须有 `DialogueFrame`，并能解释为什么没有进入工具或写入。
6. `DialogueFrame` 必须能被 `DecisionTrace` 引用，并能被 `TurnResult` 通过摘要或 trace ref 间接引用。
7. UI 只能消费 `DialogueFrame` 的可见摘要或 TurnResultViewModel 中的引用，不能直接读取内部 frame schema 作为主渲染 contract。

本 ADR 同时提出 `DialogueFrame` 的最小 contract 语义：

| 语义 | 要求 |
|---|---|
| identity | 能稳定引用本 frame |
| turn binding | 能绑定所属 turn |
| frame type | 能表达本轮输入的认知类型 |
| dialogue goal | 能用作者语义描述本轮目标 |
| tool need | 能说明是否需要 MicroPlan / 工具 / 状态推进 |
| execution readiness | 能区分不适用、未准备好、执行候选 |
| author visible draft | 能提供给 TurnResult Builder 的自然语言回应草案 |
| uncertainty | 能说明不确定性和为什么没有执行 |
| trace link | 能进入 DecisionTrace |

---

## 非目标

本 ADR 不冻结：

1. `DialogueFrame` 的最终 JSON Schema。
2. `frame_type` 枚举全集。
3. `intent_hypothesis`、`slot_state_delta` 等内部字段的最终命名。
4. `MicroPlan` schema。
5. `OrchestratorDecision` schema。
6. TurnPhase / TurnStatus / NextAction 兼容矩阵。
7. UI card 类型和组件呈现方式。
8. persistence schema、数据库表或索引。
9. LLM prompt 格式。

这些内容分别由后续 ADR、schema 草案或垂直切面证明承接。

---

## 考虑过的方案

### 方案 A：保留 RouterResult 作为第一认知对象

继续使用类似 v2 的 RouterResult / intent / slot schema 作为 turn 第一站。

- 优点：迁移成本低，可以复用 v2 的 intent 和 slot 资产。
- 缺点：会让 v3 继续围绕 Router-first 拓扑演化，作者体验容易退回“系统要求我填表”的心智；LLM 创作伙伴被放在后台。

### 方案 B：只在需要工具时生成结构化 frame

普通对话不生成 frame，只有工具调用、写入或确认时才生成结构化对象。

- 优点：表面上更轻量，reply-only turn 成本低。
- 缺点：无法解释“为什么没有执行”；自然对话、探索、澄清和拒绝都缺少可审计锚点；trace 会在最常见的 turn 上断裂。

### 方案 C：每个 turn 都生成 primary DialogueFrame

所有作者 turn 都有一个结构化认知帧。该 frame 可以是 reply-only、exploration、slot update、execution candidate、confirmation answer、correction、cancellation 等类型。

- 优点：主链统一；reply-only 也可回放；MicroPlan、BehaviorState、TurnResult 和 Trace 都有共同认知来源；符合 v3 Dialogue-first 目标。
- 缺点：需要定义 envelope 校验和 trace 写入纪律；如果字段过早冻结，会增加设计成本。

### 方案 D：让 DialogueFrame 同时包含 MicroPlan 和执行裁决

把认知、计划和执行批准放在一个大对象里，让 Planner 一次输出所有内容。

- 优点：对象数量少，demo 容易串起来。
- 缺点：Planner 会重新获得执行权；Execution Orchestrator 被架空；“理解、建议、批准、执行”边界被混在一起，违背 v3 主链不变量。

---

## 最终决策

采用 **方案 C：每个 turn 都生成 primary DialogueFrame**。

具体决策：

1. 每个作者 turn 必须有且至少有一个 primary `DialogueFrame`。
2. primary `DialogueFrame` 是本 turn 的认知来源，后续 `MicroPlan`、`BehaviorState`、`TurnResult`、`DecisionTrace` 必须能追溯到它。
3. 一个 primary `DialogueFrame` 可以没有 `MicroPlan`；reply-only turn 的 frame 必须说明 `needs_tool=false` 或等价语义。
4. 当 `DialogueFrame` 表达执行候选或需要工具、状态推进、durable behavior 时，才进入 `MicroPlan`。
5. `DialogueFrame` 不包含执行授权，不出现 `approved`、`ready_to_execute`、`production_write_allowed` 等语义。
6. `execution_readiness=ready_candidate` 只表示 Planner 认为可能可执行，必须经 Execution Orchestrator 裁决。
7. `DialogueFrame` 进入 trace；UI 只通过 TurnResult / TraceSummaryView 消费可见摘要或引用。
8. `DialogueFrame` 字段在本 ADR 中只冻结语义组，不冻结最终字段全集和 JSON Schema。

---

## 决策理由

选择方案 C 的原因：

1. **对齐 v3 愿景**：作者面对 LLM 创作伙伴，系统仍然拥有可审计结构，不退回 Router-first。
2. **保护主链完整性**：每个 turn 都能从 AuthorInput 追溯到认知解释，再到是否规划、是否执行、最终输出。
3. **支持 replay**：即使没有工具调用，也能解释为什么只是回复、为什么继续探索、为什么没有 durable clarification。
4. **防止 UI 反向定义 intent**：UI 不需要猜测 intent 或 slot，只消费 TurnResult 中经过处理的 frame 摘要和 action。
5. **给 MicroPlan 留出边界**：Frame 只负责理解，MicroPlan 负责建议，Orchestrator 负责裁决。

拒绝方案 A，是因为它延续 v2 的目标拓扑。
拒绝方案 B，是因为它让大量自然对话 turn 不可回放。
拒绝方案 D，是因为它混淆认知、建议和执行权。

---

## Contract 影响

### 新增 contract

`DialogueFrame` 成为 v3 主链一等 contract。

最小语义组：

| 语义组 | 说明 |
|---|---|
| identity | frame 可被 trace、plan、TurnResult 引用 |
| turn binding | frame 绑定一个 turn |
| type | frame 能表达本轮认知类型 |
| goal | frame 说明本轮对话目标 |
| tool need | frame 说明是否需要进入 MicroPlan |
| execution readiness | frame 只表达候选，不表达授权 |
| visible draft | frame 可以给 TurnResult Builder 提供自然语言回应草案 |
| uncertainty | frame 能解释不确定性和未执行原因 |
| traceability | frame 必须进入 DecisionTrace |

### 禁止语义

`DialogueFrame` 禁止包含：

- execution approval
- production write authorization
- final adopted state
- tool result
- UI local state
- raw private reasoning

### 后续 ADR 依赖

| 后续 ADR | 依赖方式 |
|---|---|
| ADR-0002 MicroPlan v3 | `MicroPlan.frame_ref` 必须引用 DialogueFrame |
| ADR-0003 Planner Authority Boundary | Planner 只能输出 frame / plan，不批准执行 |
| ADR-0004 OrchestratorDecision v3 | decision 必须记录来源 frame / plan |
| ADR-0013 DecisionTrace v3 | trace 必须记录 frame 节点 |
| ADR-0015 TurnResultViewModel v3 | UI 只消费 frame summary / trace ref |

---

## Umbrella 边界影响

本文不冻结最终模块归属，但给出边界方向：

| App | 影响 |
|---|---|
| `novel_foundation` | 可承接通用 id、Result/Error、schema validation helpers；不承接业务语义 |
| `novel_domain` | 不直接生成 DialogueFrame，不依赖 LLM，不读取 provider |
| `novel_agent` | 可承接 Planner runtime / provider gateway；不引用 `NovelDomain` / `NovelApplication` |
| `novel_application` | 负责 orchestration、context assembly、contract adapter、TurnResult assembly |
| `novel_persistence` | 后续只负责存储 frame / trace 相关 schema，不参与认知生成 |
| `novel_web` | 只序列化 TurnResult / view model，不直接调用 Planner 或 toolbox |
| `frontend` | 只消费 TurnResultViewModel，不直接读取内部 frame schema |

首个垂直切面可以先通过 application test 或 Channel response 证明，不需要立即落数据库表。

---

## UI / Trace / Replay 影响

### UI

UI 可以看到：

- assistant_message
- ui_cards
- trace_summary 中经过脱敏的 frame summary
- available_actions

UI 不可以：

- 根据 frame 内部字段自行打开 clarification
- 自行推导 intent / slot / behavior
- 把 `ready_candidate` 显示为“可执行”
- 绕过 TurnResult 读取内部 frame schema

### Trace

DecisionTrace 必须记录：

- frame identity
- frame type
- needs_tool / execution readiness
- 为什么进入或没有进入 MicroPlan
- uncertainty / reason summary

Trace 不应记录 raw private reasoning。

### Replay

Replay 至少能回答：

```text
这一轮作者输入为什么被理解成这个 frame？
为什么没有执行，或为什么进入 MicroPlan？
最终 TurnResult 如何引用这个 frame？
```

Replay 默认不重新调用 LLM。

---

## 垂直切面证明

首个证明 slice：`00c` §9.1 VS-00 Reply-only DialogueFrame + TurnResult + Trace。

该 slice 应证明：

| 问题 | 回答 |
|---|---|
| Contract | `AuthorInput`、`DialogueContext`、`DialogueFrame`、`TurnResult`、`DecisionTrace` |
| Invariant | 每 turn 必有 frame；reply-only 也必须可回放 |
| Boundary | 切过 web/application/agent trace 边界；不碰 persistence production write |
| Consumer | Application test 或 Channel response |
| Proof | 输入普通创作讨论，输出 TurnResult，trace 可解释未调用工具 |

建议测试方向：

1. reply-only turn 也生成 primary DialogueFrame。
2. `needs_tool=false` 时不生成 MicroPlan。
3. TurnResult 引用或包含 frame summary。
4. DecisionTrace 能解释未调用工具的原因。
5. UI 不需要读取内部 frame schema。

---

## 迁移与兼容

v3 不继承 v2 Router-first 拓扑。

可保留的 v2 原则：

- 对外仍需要 canonical result。
- 状态与 UI 消费需要结构化 contract。
- trace / replay 需要稳定引用。

需要废弃或重解释的 v2 资产：

| v2 资产 | v3 处理 |
|---|---|
| Router as first cognitive node | 废弃为目标拓扑 |
| RouterResult | 不作为 v3 主链对象；可作为迁移参考 |
| intent / slot schema | 可作为 frame 内部候选材料，不作为 UI 主流程 |
| TurnResult v2 | 保留 canonical output 原则，字段由 v3 ADR 重新评估 |

迁移时不能把 `Router` 改名为 `DialoguePlanner` 后继续保留原职责。

---

## 后续工作

1. 写 `ADR-0002-micro-plan-v3.md`，冻结 MicroPlan 与 DialogueFrame 的引用关系。
2. 写 `ADR-0003-planner-authority-boundary.md`，冻结 Planner 不能批准执行。
3. 后续 schema 草案再冻结 `DialogueFrame` 字段全集和 `frame_type` 枚举。
4. 在 `tasks/slices/v3/DAG.md` 中安排 VS-00。
5. 实现前补 contract test：每个 turn 必有 frame，reply-only 也可回放。
