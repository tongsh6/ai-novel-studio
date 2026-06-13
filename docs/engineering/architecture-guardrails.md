# v3 技术架构护栏

> 状态：试行护栏（2026-05-08）
>
> 角色：把 v3 的最终愿景落到工程边界，作为后续 slice implementation plan 的架构入口。本文不是新的产品设计，不替代 `docs/design/`；它只说明实现 v3 时哪些边界必须守住、哪些现有规则必须复用。

---

## 1. 目标

v3 的最终目标是：

```text
作者面对 LLM 创作伙伴；
工作台退到后台，成为工具箱、记忆、执行和审计系统；
AI 可以生成小说材料，但正式作品事实必须经作者和系统门禁采纳。
```

因此 v3 技术架构必须保护三件事：

1. **创作体验不退回表单**：每个 turn 先形成 `DialogueFrame`，而不是先跑 intent / slot 表。
2. **执行权不交给模型**：`MicroPlan` 只是建议，`Execution Orchestrator` 才能裁决工具调用、确认、采纳和降级。
3. **产物不自动变事实**：AI 生成草稿、候选、工具结果，默认只进入待采纳状态；正式作品事实只能经过采纳边界。

---

## 2. 必须复用的上游规则

| 来源 | 本文如何复用 |
|---|---|
| `AGENTS.md` | 复用 umbrella 依赖方向、各 app 职责、前后端检查命令、AI 静态扫描闭环 |
| `docs/engineering/architecture-operating-system.md` | 复用承重竖切面、DAG、深模块、横切能力、性能边界 |
| `docs/engineering/vertical-slice.md` | 复用 Contract / Invariant / Boundary / Consumer / Proof 五问 |
| `docs/coding-standards/` | 复用模块边界、测试、前端、文档与注释规范 |
| `docs/design/foundation/00e-architecture.md` | 复用控制面 / 数据面 / 横切层的架构表达方式 |
| `docs/design/foundation/09-observability-and-audit.md` | 复用 trace、audit、replay 分层原则 |
| `docs/design/foundation/10-security-and-budget.md` | 复用 authority、budget、guard、高风险动作确认原则 |
| `docs/design/quality/31-novel-quality-gates.md` | 复用小说内容质量门禁目录，但不把全部门禁塞进 v3 首批 slice |
| `docs/design/quality/32-human-approval-policy.md` | 复用作者确认、采纳、检查点、阻断的业务原则 |
| `tasks/slices/` | 复用 v2 已闭环 slice 的证明方式和实现经验，不复用 Router-first 交互拓扑 |
| `docs/design/00d-runtime-architecture.md` | 作为 v3 运行时结构的主要来源 |
| `docs/design/00c-state-and-contract-atlas.md` | 作为 v3 contract、不变量、slice 入口总账 |

本文不复用 v2 的 Router-first 拓扑。v2 中可复用的是工程分层和质量经验，不是第一认知节点。

---

## 3. v3 主链

实现计划必须围绕以下主链切 slice：

```text
AuthorInput
→ Dialogue Gateway
→ DialogueContext
→ Dialogue Planner
→ DialogueFrame
→ MicroPlan（按需）
→ Execution Orchestrator
→ OrchestratorDecision
→ ToolRequest / ToolResult（按需）
→ TentativeArtifactSet / BehaviorState / AdoptionBoundary（按需）
→ TurnResult
→ TurnResultViewModel
→ DecisionTrace / ReplayReport
```

读法：

1. `DialogueFrame` 是每个 turn 的认知锚点。
2. `MicroPlan` 不能包含批准语义。
3. `ToolRequest` 只能由执行裁决产生。
4. `ToolResult` 和 `TentativeArtifactSet` 不能直接变成正式作品事实。
5. `TurnResult` 是 UI 和外部入口的稳定出口。
6. `DecisionTrace` 记录为什么做、为什么没做、为什么降级。

任何 v3 slice 如果不能说明自己覆盖这条链上的哪一段，就不应进入实现计划。

---

## 4. Umbrella 落位规则

### 4.1 app 职责

| App / Area | v3 可承接内容 | 禁止内容 |
|---|---|---|
| `novel_foundation` | Result / Error、ID、时间、通用校验、小型纯函数工具 | GenServer、Supervisor、Registry、Ecto、Phoenix、Provider、小说业务概念 |
| `novel_domain` | 纯 struct、纯函数领域规则、领域事件、小说质量规则的纯判断 | I/O、Repo、Ecto、Phoenix、GenServer、Provider、Application 编排 |
| `novel_agent` | Provider Gateway、agent runtime、toolbox runtime、工具执行、模型调用适配 | 引用 `NovelDomain` / `NovelApplication`，直接写作品事实 |
| `novel_application` | DialogueContext 组装、Prompt 构建、执行裁决、采纳边界编排、TurnResult 组装、trace 协调 | 引用 `NovelWeb`，把领域规则写成 I/O 副作用 |
| `novel_persistence` | Repo、DB schema、migration、repository、read model、trace store | 引用 `NovelWeb` / `NovelApplication` / `NovelAgent` |
| `novel_web` | Router、Controller、Channel、JSON 序列化、ActionInput 入口适配 | 直接调用 Repo、直接写 Ecto.Query、直接调用 `NovelAgent` 内部模块 |
| `frontend` | Workbench 展示、TurnResultViewModel 消费、AuthorActionInput 提交 | 发明 action、修改 BehaviorState、调用 toolbox、把草稿当正式事实 |

### 4.2 允许穿过的边界

v3 slice 可以切过多个 app，但只能按以下方向推进：

```text
frontend / novel_web
→ novel_application
→ novel_agent
→ novel_foundation

novel_application
→ novel_domain
→ novel_foundation

novel_application
→ novel_persistence
→ {novel_domain, novel_foundation}
```

说明：

- `novel_web` 是薄入口，只把请求转成 application 调用。
- `novel_application` 是 v3 主链编排中心。
- `novel_agent` 可以执行 provider / toolbox，但不能理解小说领域对象的权威语义。
- `novel_domain` 只表达规则，不做调用。
- `novel_persistence` 保存事实和读模型，不反向调用 application。

### 4.3 禁止的捷径

| 捷径 | 为什么禁止 |
|---|---|
| Frontend 直接拼 action_type 并修改状态 | UI 会变成状态机发明者 |
| Web 直接调用 Repo 或 Agent 内部模块 | 破坏薄网关和审计边界 |
| Agent 直接写 production state | 绕过采纳边界和作者确认 |
| Domain 调 provider / Repo | 领域层失去纯函数和可测试性 |
| Persistence schema 决定领域语义 | 数据库会反向绑架设计 |
| 为未来能力先建空 service / repository / behaviour | 违反承重竖切面和 YAGNI |

---

## 5. v3 深模块候选

后续实现计划应优先把复杂性收进深模块，而不是散在 controller、component 或 provider 里。

| 深模块候选 | 所在层 | 应拥有的复杂性 | 不应拥有 |
|---|---|---|---|
| Dialogue Gateway | application / web boundary | AuthorInput 标准化、幂等键、入口 trace | 领域裁决、provider 调用 |
| Dialogue Context Assembler | application | 当前作品上下文、记忆摘要、上下文引用 | 直接由 agent 读 Repo |
| Dialogue Planner Adapter | application ↔ agent | Prompt 构建、Planner 调用、Frame 输出校验 | 执行批准 |
| Execution Orchestrator | application | gate 顺序、降级、确认、工具批准、TurnResult 裁决依据 | 自己发明领域规则 |
| Toolbox Runtime | agent | provider 调用、工具执行、ToolRequest / ToolResult 规范 | 采纳正式作品事实 |
| Adoption Boundary | application + domain pure rule | tentative 到正式事实的评估、确认、trace | UI 本地写入 |
| TurnResult Builder | application | 对外出口一致性、可见动作、trace 摘要引用 | 暴露内部 raw trace |
| Replay / Trace Reader | application / persistence | 脱敏、回放、开发报告 | 重新调用 provider 补历史 |

深模块必须有小接口、强不变量和测试。不能因为一个 slice 用不上，就提前把候选模块全部创建出来。

---

## 6. 横切能力挂载点

| 横切能力 | 挂载点 | 禁止散落位置 |
|---|---|---|
| 权限 / 预算 | Execution Orchestrator、Toolbox Runtime | controller、React 组件、provider adapter 内部临时判断 |
| 采纳边界 | Application Adoption Boundary + Domain pure validation | Agent ToolResult、Frontend action handler |
| trace / replay | TurnResult Builder、Trace Writer、Toolbox Runtime、Behavior lifecycle | UI 文案、普通 Logger 字符串 |
| 记忆写入 | Application turn 收尾或明确 Memory Slice | Planner prompt 拼接处隐式写入 |
| 投影刷新 | ProjectionHint + projection read model | UI 根据按钮点击猜测刷新 |
| 小说质量门禁 | Domain pure rule + Application policy mapping | Provider prompt 内独立判断 |

横切能力如果在两个 slice 中重复出现，先记录重复；只有当它有相同 contract 和真实消费者时，才抽成公共模块。

---

## 7. v2 复用边界

### 7.1 可以复用

- 控制面 / 数据面 / 横切层的表达方式。
- authority、budget、audit、trace、replay 的分层原则。
- tentative artifact、adoption boundary、human approval 的业务原则。
- 小说质量门禁目录，例如设定冲突、人物逻辑、时间线、伏笔、节奏、爽点、hook。
- Tauri-first 前端技术栈和设计追溯规则。
- JSON Schema / Zod / Ecto changeset 的单一来源原则。

### 7.2 已实现经验如何复用

v2 已经完成过一批承重 slice。v3 可以复用它们的证明方式、测试组织和边界经验，但必须先改写成 Dialogue-first 语义。

| v2 已实现经验 | v3 可复用部分 | v3 必须改写部分 |
|---|---|---|
| `VS-001 TurnResult Contract Spine` | 对外出口要稳定、测试要保护 contract | 出口必须加入 DialogueFrame / DecisionTrace 语义 |
| `VS-002 Clarification Card Loop` | 等待用户输入必须有状态和 action 回传 | 缺信息不自动等于 clarification；模糊创作先自然探索 |
| `VS-003 Confirmation Before Execute Loop` | 高风险动作执行前确认 | confirmation 必须绑定 MicroPlan / OrchestratorDecision 后重新 gate |
| `VS-004 Tentative Artifact Adoption Boundary` | tentative 到正式事实的边界经验 | AI 创作草稿先进入 TentativeArtifactSet，再到 VS-04 采纳边界 |
| `VS-005 Accepted Artifact Marks Projection Stale` | 正式事实变化只触发投影刷新，不由 UI 猜测写入 | v3 通过 ProjectionHint 表达刷新，不把 refresh 当写权限 |
| `VS-006 Turn Memory Write-Through` | turn 留痕和记忆写入需要明确位置 | v3 记忆必须带 context refs / trace refs，不把 tentative 当 canon |
| `VS-008 / VS-011 Provider Gateway` | provider 调用统一入口、错误归一、真实 provider 适配 | provider 结果只能成为 ToolResult，不能直接越过执行裁决 |
| `VS-012 End-to-End Creative Turn Pipeline` | 端到端证明比横向铺层更有价值 | v3 端到端必须从 DialogueFrame 开始，而不是从 Router 开始 |

复用实现时要先回答：

1. 这个旧模块是否把 Router / intent 放在第一认知节点？
2. 这个旧模块是否默认消费 TurnResult，而缺少 v3 trace 依据？
3. 这个旧模块是否把 tentative / adopted 边界写死在旧 card/action 语义里？
4. 这个旧模块是否仍符合当前 `AGENTS.md` 的 app 边界？

只要任一答案为“是”，就只能复用经验，不能直接搬代码路径。

### 7.3 必须改写为 v3 语义

| v2 经验 | v3 改写 |
|---|---|
| Router 是第一认知节点 | Dialogue Planner + DialogueFrame 是第一认知节点 |
| intent / slot 驱动追问 | 模糊创作先自然探索，只有阻塞时才形成 durable behavior |
| TurnResult 作为出口 | v3 以 TurnResult + TurnResultViewModel + DecisionTrace 组合成出口 |
| ToolResult 之后进入 adoption | ToolResult / TentativeArtifactSet 必须先证明来源、上下文和待采纳状态 |
| 质量门禁面向 v2 artifact | v3 首批只接入最小质量证明，完整小说质量门禁后续按 slice 引入 |

### 7.4 不允许复用

- 不允许把 v2 Router-first 流程作为 v3 实现捷径。
- 不允许把 slot 缺失直接等同于 UI 表单。
- 不允许把 v2 card/action 集合扩展成前端可自由发明动作。
- 不允许为了复用旧代码绕过 v3 的 `DialogueFrame`、`MicroPlan`、`OrchestratorDecision`。

---

## 8. 实现计划入口标准

每个 v3 implementation plan 必须包含：

1. 引用的 v3 slice 文件。
2. 引用的 ADR 或 contract pack。
3. 本文 §4 的 app 边界表。
4. `docs/engineering/vertical-slice.md` 的五问。
5. 具体测试或命令，证明至少一个 `00c` 全局不变量。
6. 明确说明哪些 v2 经验被复用，哪些被禁止复用。

如果实现计划只写“先建模块”“先建表”“先做 UI 壳”，必须退回重切 slice。

---

## 9. 自审清单

进入代码前，评审者按以下顺序检查：

| 检查 | 通过标准 |
|---|---|
| 最终愿景 | 是否让作者面对创作伙伴，而不是回到表单 / Router 流程 |
| v3 设计 | 是否经过 DialogueFrame、MicroPlan、OrchestratorDecision、TurnResult、DecisionTrace |
| 复用现有内容 | 是否引用 AGENTS、engineering、coding standards、v2 相关文档，而不是重写一套规则 |
| app 边界 | 是否没有 web 直连 Repo、agent 直写作品事实、domain 做 I/O |
| 产物边界 | AI 生成内容是否默认待采纳 |
| 证明方式 | 是否有测试或命令，而不是人工感觉 |

任何一项不过，就不能进入代码实现。
