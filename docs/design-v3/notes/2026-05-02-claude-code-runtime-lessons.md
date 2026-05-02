# Claude Code Runtime Lessons for v3

> 状态：讨论备忘录（2026-05-02）
>
> 角色：沉淀一次关于 Claude Code 与 AI 小说创作工作台 v3 的对照讨论。本文不是 ADR，不冻结 schema，不要求立即实现；它为后续 v3 ADR、承重垂直切面和 runtime 产品化设计提供输入。
>
> 资料边界：本文只参考 Claude Code 的公开产品能力与官方文档，不基于任何疑似泄露源码。

---

## 1. 结论摘要

v3 不是从头开始，也不应改造成 Claude Code。

更准确的定位是：

```text
v3 先定小说创作工作台的主权结构；
再吸收 Claude Code 式 agent runtime 的可运行性和扩展性。
```

v3 已经回答了小说工作台自己的根问题：

- 作者面对 LLM 创作伙伴，而不是 slot 表单。
- 工作台退到后台，作为 LLM 与执行系统背后的工具箱。
- Dialogue Planner 负责理解和表达。
- Execution Orchestrator 保留执行权和门禁。
- Toolbox 提供能力边界。
- TurnResult 是 UI 与外部入口的 canonical 输出。
- tentative / adoption / confirmation 保护权威创作状态。
- DialogueFrame / MicroPlan / DecisionTrace 提供可审计链路。

Claude Code 值得学习的不是 coding-agent 领域对象，而是它把 agent loop、工具、权限、hooks、subagents、MCP、skills、session 等能力产品化的方式。

---

## 2. v3 是否吸收了 v2

v3 不是白纸重来。

v3 明确继承 v2 已验证的工程骨架：

- TurnResult 合同出口
- intent registry 与 slot schema
- provider gateway
- memory / trace 初步能力
- clarification / confirmation / adoption 基础链路
- authority / budget / audit 横切约束
- 承重垂直切面执行纪律

v3 真正重置的是交互拓扑。

v2 的问题不是 contract 本身，而是 `Router-first` 容易把作者体验变成“工作台柜员式补槽”：

```text
User
→ Router
→ TurnService / Orchestrator
→ Executor / LLM
→ TurnResult
```

v3 改为 Dialogue-first / Agent-native：

```text
AuthorInput
→ Dialogue Planner
→ DialogueFrame
→ MicroPlan
→ Execution Orchestrator
→ Toolbox / ToolRequest / ToolResult
→ TurnResult + DecisionTrace
```

因此，v3 的判断可以概括为：

```text
保留 v2 的 contract、状态、门禁和审计；
废弃 v2 的 Router-first 作者前台心智。
```

---

## 3. Claude Code loop 与 v3 loop 的相同点

Claude Code 官方文档没有把内部实现正式命名为“统一 agent loop”。本文所说的 Claude Code loop，是从公开能力推断出的产品形态：模型可读写文件、运行命令、搜索代码、调用 MCP 工具，并通过 permissions、hooks、subagents、sessions 等机制控制执行。

两者的共同点：

| 维度 | Claude Code | v3 小说工作台 |
|---|---|---|
| LLM 位置 | 主动理解任务并决定下一步 | Dialogue Planner 是作者可见理解与引导层 |
| 工具调用 | Read / Edit / Bash / Grep / WebFetch / MCP | Toolbox / ToolRequest / ToolResult |
| 执行门禁 | permissions / hooks / sandbox | Execution Orchestrator / authority / budget / confirmation |
| 扩展能力 | MCP / subagents / skills / plugins | Capability Toolbox / multi-agent / future capability packages |
| 会话留痕 | session transcript / tool history | DecisionTrace / BehaviorTrace / ToolTrace / TurnResult trace |
| 长任务 | agent 持续推进 coding task | long-run task / checkpoint / tentative artifacts |

两者都不是传统“先分类再执行”的固定 Router 系统，而是：

```text
用户输入
→ 模型理解 / 规划
→ 工具或能力调用
→ 工具结果回流
→ 最终输出
→ session / trace 留痕
```

---

## 4. Claude Code loop 与 v3 loop 的关键差异

最大的差异是：

```text
Claude Code 更偏“模型驱动工具循环”；
v3 更偏“契约驱动创作状态机”。
```

| 维度 | Claude Code | v3 小说工作台 |
|---|---|---|
| 核心对象 | 文件、命令、diff、测试、PR | 作品、设定、人物、章节、正文、artifact、projection |
| 任务闭环 | 看代码、改文件、跑测试、修失败 | 探索、候选、tentative、adoption、projection |
| 工具副作用 | 可以直接编辑文件 | 默认不能直接写 production domain object |
| 事实采纳 | 工具结果常可直接成为下一步事实 | ToolResult 只是候选事实，需 Orchestrator/author adoption |
| 输出对象 | 最终消息 + 文件系统变化 + transcript | TurnResult + ui_cards + behavior/adoption/projection/trace |
| 安全重点 | 文件、命令、网络、工具权限 | 权威作品状态、预算、确认、连续性、阅读投影 |
| 用户心智 | 开发者交付 coding task | 作者与 LLM 创作伙伴共创 |

Claude Code 的强项是 developer task closure：

```text
看代码 → 改文件 → 跑测试 → 修失败 → 总结
```

v3 应保护 authorial state integrity：

```text
理解作者 → 共同探索 → 形成候选 → 生成 tentative
→ 作者采纳 → 更新权威作品状态 → 刷新阅读投影
```

小说创作不能照搬 coding agent 的“直接改文件”心智。Git diff 和测试可以兜底代码变更；但作品设定、人物命运、伏笔、风格偏好一旦被错误写入长期上下文，会持续污染后续创作。

---

## 5. v3 已具备的同类能力

### 5.1 Tool / Capability Registry

v3 `Capability Toolbox` 已经具备 Claude Code 工具系统的核心 contract 映射：

- `tool_name`
- `tool_version`
- `tool_layer`
- input / output contract refs
- read / write scopes
- authority / budget profile refs
- risk class
- retry / cancellation / streaming support
- trace level
- status

这说明 v3 不缺“工具注册”概念，缺的是把 registry 产品化成可运行、可发现、可禁用、可版本迁移的 runtime 机制。

### 5.2 Permission / Profile Scope

v2/v3 对权限和预算已有完整设计基础：

- authority
- budget
- guard
- escalation
- confirmation
- write_scope
- authority_scope
- budget_profile
- prompt injection boundary

实现上也已有 `AuthorityGate`、`BudgetMeter`、pending confirmation、telemetry 等骨架。

因此，这部分不是空白。可学习 Claude Code 的点主要是配置层级和操作体验，例如：

```text
managed policy
user / author profile
project profile
work profile
local session override
```

这些层级要映射到小说工作台自己的概念，而不是照搬 coding project 的 `.claude/settings.json` 心智。

### 5.3 Multi-Agent / Agent Package

v2 已有 multi-agent contract：

- agent identity
- delegation envelope
- authority / budget inheritance
- artifact handoff
- parent-controlled adoption
- domain-registered agent roles
- role-specific capability profiles
- child result validation rules

这已经对应 Claude Code subagents 的一部分能力。

差异在于：Claude Code 的 subagents/skills 更接近可配置、可安装、可分发的“能力包”。v3 目前已有角色和委派 contract，但尚未定义“创作技法包 / agent package”的产品形态。

候选 v3 能力包可以包括：

- PlotArchitect
- CharacterEditor
- ContinuityAuditor
- StyleCoach
- WorldbuildingLibrarian
- ChapterDraftWriter
- QualityGateReviewer

关键限制：

```text
这些 agent/package 只能产出 ToolResult、tentative artifact、quality finding 或建议；
不能直接写 production object；
不能绕过 Execution Orchestrator 和 adoption。
```

### 5.4 Runtime Session / Replay

v3 `06-memory-context-and-trace.md` 已经定义：

- Memory
- DialogueContext
- ContextPacket
- DecisionTrace
- BehaviorTrace
- ToolTrace
- StateTrace
- MemoryTrace
- ReplayCase
- redaction / visibility

实现上也已有：

- workspace / author session 监督树与 registry
- interaction 表的 `replayable` / `retrievable`
- audit JSONL
- long-run task log
- checkpoint / resume 相关持久化骨架

因此这部分也不是空白。

真正缺的是完整运行闭环：

- DecisionTrace writer
- ReplayCase runner
- trace redaction engine
- debug/replay UI
- 基于 trace 的回归测试
- trace 缺失时阻断关键写入的 runtime enforcement

---

## 6. 值得从 Claude Code 吸收的能力

### 6.1 配置层级产品化

Claude Code 的配置有用户级、项目级、本地级、托管级等层次。v3 可吸收其思想，但映射成小说工作台语义：

| v3 层级 | 含义 |
|---|---|
| managed policy | 工作室、团队、不可绕过的安全/预算/版权规则 |
| author profile | 作者长期偏好、默认模型、语言风格 |
| project profile | 项目级策略，如类型、尺度、发布平台要求 |
| work profile | 单本书的风格、世界观、节奏和禁忌 |
| session override | 本次会话的临时实验设置 |

注意：这些配置不能绕过 authority / adoption / trace，只能作为 Orchestrator 和 context assembly 的输入。

### 6.2 Hook Lifecycle

v3 已有 quality gate、audit、trace、authority、budget 等概念，但还缺统一 hook 生命周期。

建议不要照搬“任意脚本到处跑”，而是定义 contract hook：

```text
BeforeDialogueContextAssembly
AfterDialogueFrame
BeforeMicroPlanReview
BeforeToolRequestDispatch
AfterToolResult
BeforeStateAdoption
BeforeTurnResultEmit
AfterProjectionRefresh
```

典型用途：

- 连续性检查
- 风格检查
- 版权/素材来源检查
- 敏感内容检查
- 成本阈值检查
- 伏笔/设定一致性检查

### 6.3 Skill / Agent Package

v3 已有 multi-agent 和 toolbox 的 contract，下一步可以讨论是否将它们产品化为能力包。

一个能力包不应只是 prompt，它至少应声明：

- package id / version
- 提供哪些 tools / agents / hooks
- 需要哪些 read scopes
- 是否请求 write scopes
- risk class
- budget profile
- input/output contract refs
- trace / redaction policy
- 适用作品类型或创作阶段
- 禁用、回滚、迁移策略

这会把“创作技法”从内置代码变成可治理能力。

### 6.4 MCP 风格外部连接

Claude Code 通过 MCP 连接外部工具。v3 可吸收为创作工具连接层：

- local files connector
- Obsidian / Notion / Scrivener connector
- web research connector
- publishing platform connector
- TTS / cover / asset connector
- private knowledge base connector

但小说工作台必须更严格处理：

- 作者隐私
- 版权来源
- 引用和素材 provenance
- 外部内容的 prompt injection
- 外部工具结果的 tentative/canonical 区分

### 6.5 Session / Replay 产品体验

Claude Code 的 session/transcript 体验给用户一种“任务一直在推进，可以恢复”的感觉。

v3 应形成自己的体验：

- 每次创作 turn 可解释
- 每个候选来源可追踪
- 每次采用/拒绝有记录
- 长跑任务可 checkpoint / resume
- debug/replay 能回答“为什么当时没有写入”
- 作者可见的是摘要，开发者可见的是结构化 trace

---

## 7. 不建议照搬的部分

v3 不应照搬以下 coding-agent 心智：

1. 把 Read/Edit/Bash 等文件工具作为第一等产品心智。
2. 让 agent/subagent 直接修改 production story state。
3. 让 tool result 直接成为 canonical memory。
4. 让 UI 直接调用工具或推进业务状态。
5. 把 transcript 当作 replay，而不建立 DecisionTrace。
6. 把 skill 当作一段 prompt，而不声明 scope、budget、risk、trace。
7. 用“agent 自己觉得可以”替代 Execution Orchestrator 裁决。

小说工作台的底线仍然是：

```text
默认 tentative；
作者 adoption；
高风险 confirmation；
写入有 authority；
执行有 trace；
阅读投影只读 accepted source。
```

---

## 8. 后续讨论建议

本备忘录建议后续单独展开三组设计讨论。

### 8.1 v3 Runtime Extension Model

问题：

- Toolbox registry、hook、agent package、external connector 是否统一为一种 extension model？
- extension 的安装、启用、禁用、版本迁移怎么表达？
- extension 能不能随作品/项目绑定？

可能产物：

- `ExtensionManifest v3`
- `CapabilityPackage v3`
- `HookLifecycle v3`

### 8.2 v3 Configuration Scope

问题：

- managed / author / project / work / session 五层是否合理？
- 冲突时谁覆盖谁？
- 哪些配置只能收缩权限，不能放大权限？
- 配置变更如何进入 trace？

可能产物：

- `ConfigurationScope v3`
- `PolicyProfile v3`
- `AuthorProfile / WorkProfile` contract

### 8.3 v3 Replay Productization

问题：

- L0-L2 replay 的最小可用产品是什么？
- Debug UI 和作者可见解释如何分层？
- Replay 是否进入承重垂直切面第一批？
- trace writer 失败时哪些动作必须阻断？

可能产物：

- `ReplayCase v3`
- `TraceRedaction v3`
- `DebugReplay UI contract`

---

## 9. 参考链接

Claude Code / Claude Agent SDK 公开文档：

- [Claude Code settings](https://code.claude.com/docs/en/configuration)
- [Claude Code permissions](https://code.claude.com/docs/en/permissions)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)

项目内相关文档：

- `docs/design-v3/00-vision-and-engineering-roadmap.md`
- `docs/design-v3/00b-end-to-end-dialogue-flow.md`
- `docs/design-v3/01-user-llm-workbench-interaction-model.md`
- `docs/design-v3/02-dialogue-frame-and-micro-plan.md`
- `docs/design-v3/03-capability-toolbox-contract.md`
- `docs/design-v3/04-execution-orchestrator.md`
- `docs/design-v3/05-turn-behavior-and-state-model.md`
- `docs/design-v3/06-memory-context-and-trace.md`
- `docs/design-v2/09-observability-and-audit.md`
- `docs/design-v2/10-security-and-budget.md`
- `docs/design-v2/12-multi-agent-composition.md`

