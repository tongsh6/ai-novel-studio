# Capability Toolbox 协议草案

> 状态：草案（2026-05-02）
>
> 角色：定义 v3 中 Capability Toolbox 的职责边界、工具分层、registry entry 候选字段、ToolRequest / ToolResult 协议、权限与 trace 规则。本文是 ADR 前的 contract 草案，不直接冻结最终 schema。
>
> 关联文档：
> - `00b-end-to-end-dialogue-flow.md` — v3 动态主链
> - `00d-runtime-architecture.md` — v3 运行时组件视图
> - `02-dialogue-frame-and-micro-plan.md` — DialogueFrame / MicroPlan 协议草案
>
> 不负责范围：
> - 不定义 Execution Orchestrator 的完整 API，留给 `04-execution-orchestrator.md`
> - 不定义 phase/status/next_action，由 `05-turn-behavior-and-state-model.md` 收束
> - memory/context 细节由 `06-memory-context-and-trace.md` 收束
> - 不定义具体工具实现代码或 umbrella app 归属，留给承重垂直切面规划

---

## 1. 核心定位

Capability Toolbox 是 v3 工作台的工具箱协议。

它回答：

```text
系统背后有哪些工具；
每个工具能做什么、不能做什么；
Planner 如何引用工具；
Execution Orchestrator 如何审查和调用工具；
工具结果如何进入 TurnResult 与 DecisionTrace。
```

Capability Toolbox 不是：

- 用户前台入口
- Router 的改名
- LLM 自由调用函数列表
- UI action 清单
- Repository / Service 抽象合集

Capability Toolbox 是：

- Dialogue Planner 可引用的能力目录
- Execution Orchestrator 可审查的工具注册表
- ToolRequest / ToolResult 的 contract authority
- 权限、预算、写入、trace 的边界材料

核心原则：

```text
Planner 可以提出需要工具；
Execution Orchestrator 决定是否允许调用工具；
Toolbox 执行被批准的工具；
ToolResult 只表达工具事实，不直接成为作者主消息。
```

---

## 2. 工具分层

v3 工具箱按职责分为五层。

| 层 | 目标 | 示例 |
|---|---|---|
| 认知工具 | 解释用户输入和对话状态 | `IntentInterpreter`, `SlotStateUpdater`, `UncertaintyAnalyzer` |
| 记忆工具 | 读取上下文、对象和历史 | `ContextReader`, `MemoryRecall`, `ObjectLookup` |
| 策略工具 | 判断是否允许推进 | `SlotValidator`, `AuthorityChecker`, `BudgetEstimator`, `SafetyPolicyChecker` |
| 创作工具 | 生成候选方向或正文内容 | `CandidateDirectionGenerator`, `OutlineGenerator`, `DraftGenerator` |
| 产物工具 | 管理 tentative、adoption、projection | `ArtifactValidator`, `AdoptionBoundary`, `ProjectionRefresher` |

分层约束：

1. 认知工具不执行创作，也不写状态。
2. 记忆工具默认 read-only。
3. 策略工具只判断，不生成作者主文案。
4. 创作工具可以生成内容，但不能直接 production write。
5. 产物工具涉及写入时必须经过 Execution Orchestrator 的权限和 trace。

---

## 3. 工具注册表

### 3.1 Registry 的作用

Toolbox registry 是程序记忆的一部分。

它必须让系统能回答：

- 有哪些工具。
- 每个工具属于哪一层。
- 输入输出是什么。
- 是否会调用 LLM。
- 是否会读取或写入状态。
- 是否可能触发预算、权限、确认。
- 是否支持 retry / cancellation / streaming。
- 失败如何表达。

### 3.2 registry entry 候选字段

| 字段 | 必填 | 含义 |
|---|---:|---|
| `tool_name` | 是 | 稳定工具名，如 `tool.IntentInterpreter` |
| `tool_version` | 是 | 工具 contract 版本 |
| `tool_layer` | 是 | 认知 / 记忆 / 策略 / 创作 / 产物 |
| `description` | 是 | 工具职责说明 |
| `input_contract_ref` | 是 | 输入 contract 引用 |
| `output_contract_ref` | 是 | 输出 contract 引用 |
| `read_scopes` | 是 | 可读取的状态范围，默认为空 list |
| `write_scopes` | 是 | 可写入的状态范围，默认为空 list |
| `authority_profile_ref` | 否 | 权限 profile |
| `budget_profile_ref` | 否 | 预算 profile |
| `risk_class` | 是 | `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` 候选 |
| `requires_confirmation_policy` | 是 | 是否可能需要 confirmation，由策略最终裁决 |
| `provider_dependency` | 是 | 是否需要 LLM provider 或外部工具 |
| `supports_retry` | 是 | 是否支持 retry |
| `supports_cancellation` | 是 | 是否支持 cancellation |
| `supports_streaming` | 是 | 是否支持 streaming |
| `trace_level` | 是 | 需要记录的 trace 粒度 |
| `status` | 是 | `ACTIVE` / `EXPERIMENTAL` / `DISABLED` / `DEPRECATED` |

字段原则：

1. `tool_name` 不使用 `intent.` namespace，避免和用户意图混淆。
2. `write_scopes` 非空的工具必须进入 authority / budget / trace 审查。
3. `provider_dependency` 不等于工具可以直接绕过 Provider Gateway。
4. `requires_confirmation_policy` 是策略引用，不是硬编码 boolean。
5. `status=EXPERIMENTAL` 的工具不能成为 production write 的唯一门禁。

### 3.3 tool_layer 候选枚举

| 值 | 含义 |
|---|---|
| `cognitive` | 认知工具 |
| `memory` | 记忆工具 |
| `policy` | 策略工具 |
| `creative` | 创作工具 |
| `artifact` | 产物工具 |
| `debug` | debug / replay 工具 |

`debug` 工具只能用于读取和解释 trace，不能参与正常写入主链。

---

## 4. ToolRequest

### 4.1 定义

ToolRequest 是 Execution Orchestrator 批准后形成的具体工具调用请求。

它回答：

```text
本轮允许调用哪个工具，带什么输入，以什么权限和 trace 要求调用？
```

ToolRequest 不是 MicroPlan。

```text
MicroPlan = Planner 的行动建议。
ToolRequest = Execution Orchestrator 批准后的工具调用。
```

### 4.2 候选字段

| 字段 | 必填 | 含义 |
|---|---:|---|
| `tool_request_id` | 是 | 请求 id |
| `turn_ref` | 是 | 所属 turn |
| `frame_ref` | 是 | 来源 DialogueFrame |
| `plan_ref` | 是 | 来源 MicroPlan |
| `tool_name` | 是 | 目标工具 |
| `tool_version` | 是 | 目标工具 contract 版本 |
| `input` | 是 | 工具输入 |
| `read_scope_grants` | 是 | 本次授予的读范围 |
| `write_scope_grants` | 是 | 本次授予的写范围 |
| `authority_decision_ref` | 否 | 权限裁决引用 |
| `budget_decision_ref` | 否 | 预算裁决引用 |
| `idempotency_key` | 是 | 幂等 key |
| `trace_policy` | 是 | 本次调用的 trace 要求 |
| `created_at` | 是 | 创建时间 |

约束：

1. `tool_name` 必须存在于 registry。
2. grant 范围不能超过 registry 声明。
3. 写入 grant 必须有 authority decision。
4. 高预算 grant 必须有 budget decision。
5. ToolRequest 必须进入 DecisionTrace。

---

## 5. ToolResult

### 5.1 定义

ToolResult 是工具返回的结构化事实。

它回答：

```text
工具实际做了什么，返回了什么，产生了哪些状态变化候选或产物？
```

ToolResult 不是：

- 作者主消息
- TurnResult
- 自动采纳结果
- Planner 的自由总结

### 5.2 候选字段

| 字段 | 必填 | 含义 |
|---|---:|---|
| `tool_result_id` | 是 | 结果 id |
| `tool_request_ref` | 是 | 来源 ToolRequest |
| `tool_name` | 是 | 工具名 |
| `status` | 是 | `SUCCEEDED` / `FAILED` / `PARTIAL` / `CANCELLED` |
| `output` | 是 | 结构化输出 |
| `state_delta` | 是 | 工具建议或实际产生的状态变化 |
| `artifact_refs` | 是 | 产生的 tentative artifacts 或候选产物引用 |
| `errors` | 是 | 错误列表 |
| `warnings` | 是 | 警告列表 |
| `usage` | 是 | LLM / token / budget / duration 使用 |
| `trace_refs` | 是 | 关联 trace |
| `completed_at` | 是 | 完成时间 |

约束：

1. `status=SUCCEEDED` 不代表状态已经被生产写入。
2. `state_delta` 必须由 Execution Orchestrator 决定是否采纳。
3. `artifact_refs` 默认指向 tentative 或 candidate，不默认 accepted。
4. `output` 必须满足工具的 `output_contract_ref`。
5. ToolResult 必须进入 DecisionTrace。

---

## 6. Toolbox 与 MicroPlan 的关系

MicroPlan 通过 `required_tools` 和 `proposed_actions` 引用 Toolbox。

约束：

| 规则 | 说明 |
|---|---|
| `required_tools` 必须存在 | Planner 不能引用未注册工具 |
| action 与 tool layer 必须兼容 | 例如 `validate_slots` 应指向 policy 工具 |
| 写入工具需要 authority | 任何 `write_scopes` 非空工具必须经过权限门禁 |
| 创作工具输出不直接写入 | 创作结果默认 candidate 或 tentative |
| 策略工具可否决行动 | `SlotValidator` / `AuthorityChecker` / `BudgetEstimator` 可以导致 downgrade / confirmation / rejection |
| ToolResult 反馈给 Planner | Planner 基于事实生成作者可见回应 |

MicroPlan 示例：

```json
{
  "plan_goal": "validate_and_create_tentative_work_seed",
  "proposed_actions": ["validate_slots", "create_tentative_artifact"],
  "required_tools": ["tool.SlotValidator", "tool.AuthorityChecker", "tool.AdoptionBoundary"],
  "stop_after_next_action": true
}
```

Execution Orchestrator 可以先只批准：

```json
{
  "tool_name": "tool.SlotValidator",
  "input": {
    "intent": "intent.CREATE_WORK_SEED",
    "slot_draft_ref": "slot_draft_..."
  }
}
```

只有 SlotValidator 通过后，才可能继续 AuthorityChecker 或 AdoptionBoundary。

---

## 7. 工具层协议示例

### 7.1 IntentInterpreter

| 项 | 值 |
|---|---|
| layer | `cognitive` |
| read_scopes | conversation summary, registry summary |
| write_scopes | none |
| provider_dependency | optional LLM |
| risk_class | LOW |

输入：

```json
{
  "author_input_ref": "input_...",
  "dialogue_context_ref": "ctx_...",
  "candidate_intents": ["intent.CREATE_WORK_SEED", "intent.DRAFT_SCENE"]
}
```

输出：

```json
{
  "intent_hypotheses": [
    {"intent": "intent.CREATE_WORK_SEED", "confidence": 0.76}
  ],
  "uncertainty_reasons": []
}
```

约束：

- 不能执行 intent。
- 不能生成作者主消息。
- 不能写 slot draft。

### 7.2 SlotValidator

| 项 | 值 |
|---|---|
| layer | `policy` |
| read_scopes | slot draft, slot schema, current object scope |
| write_scopes | none |
| provider_dependency | none |
| risk_class | LOW |

输出：

```json
{
  "valid": false,
  "blocking_missing": ["core_selling_point"],
  "optional_missing": ["tone_preference"],
  "execution_readiness": "not_ready"
}
```

约束：

- 只判断 slot 是否满足执行门槛。
- 不生成 clarification 文案。
- 不决定是否创建 durable clarification。

### 7.3 CandidateDirectionGenerator

| 项 | 值 |
|---|---|
| layer | `creative` |
| read_scopes | dialogue context, project preferences |
| write_scopes | none |
| provider_dependency | LLM |
| risk_class | LOW |

输出：

```json
{
  "candidates": [
    {
      "candidate_id": "candidate_1",
      "title": "赛博悬疑升级",
      "slot_suggestions": {
        "genre": "赛博朋克悬疑",
        "core_selling_point": "底层黑客破解城市记忆被篡改的阴谋",
        "target_reader": "喜欢快节奏悬疑和升级爽点的读者"
      }
    }
  ]
}
```

约束：

- 候选方向只是 draft，不是执行参数。
- slot_suggestions 必须经作者选择或后续 slot merge 才能进入 current parameters。
- 不创建作品。

### 7.4 AdoptionBoundary

| 项 | 值 |
|---|---|
| layer | `artifact` |
| read_scopes | tentative artifacts, target object revision |
| write_scopes | production object state |
| provider_dependency | none |
| risk_class | HIGH |

约束：

- 只能由 Execution Orchestrator 调用。
- 必须有 authority decision。
- 必须记录 mutation / trace。
- 不能由 Planner 或 UI 直接调用。

---

## 8. 权限、预算与风险

每个工具必须声明风险相关信息。

### 8.1 write_scopes

候选 write scope：

| write_scope | 含义 |
|---|---|
| `none` | 不写状态 |
| `dialogue_state` | 写 DialogueFrame / MicroPlan / slot draft |
| `behavior_state` | open / close durable behavior |
| `tentative_artifact` | 创建 tentative artifact |
| `production_object` | 写 accepted domain object |
| `projection_state` | 刷新阅读投影 |
| `trace_only` | 只写 trace |

规则：

- `production_object` 必须经过 authority。
- `tentative_artifact` 必须 trace，可按 risk_class 决定是否 confirmation。
- `dialogue_state` 也必须 trace，不能静默改 slot draft。
- `trace_only` 不应阻断主流程，但失败必须可发现。

### 8.2 risk_class

候选风险：

| risk_class | 说明 |
|---|---|
| `LOW` | 只读或低风险候选生成 |
| `MEDIUM` | 产生 tentative 内容或影响后续状态 |
| `HIGH` | 写入、采纳、长跑、高成本或影响核心结构 |
| `CRITICAL` | 不可逆、批量破坏或安全敏感动作 |

风险不直接等于 confirmation。最终确认策略由 Execution Orchestrator 和 policy 决定。

### 8.3 budget_profile

工具应声明预算特征：

| profile | 说明 |
|---|---|
| `free` | 本地纯函数或轻量读 |
| `low_llm` | 单次低成本 LLM |
| `high_llm` | 长 prompt 或高成本模型 |
| `batch` | 多次调用或批量处理 |
| `long_run` | 可能跨 turn / checkpoint |

预算敏感工具必须能被 Budget Meter 拦截。

---

## 9. Trace 要求

Toolbox trace 至少记录：

```text
ToolRequest
ToolResult
tool registry version
authority / budget decision refs
input / output contract refs
duration / usage
errors / warnings
state_delta summary
```

不同层的 trace 粒度：

| 工具层 | trace 要求 |
|---|---|
| 认知工具 | 输入摘要、候选、置信度、不确定性 |
| 记忆工具 | query、命中 refs、过滤原因 |
| 策略工具 | 被校验对象、规则、通过/失败原因 |
| 创作工具 | prompt refs、模型、候选摘要、usage |
| 产物工具 | mutation refs、revision、adoption/projection 状态 |

Trace 反模式：

- 只记录 LLM prompt，不记录工具裁决。
- 只记录成功结果，不记录被拒绝的 ToolRequest。
- 只记录自然语言摘要，不记录结构化 output。

---

## 10. 与 TurnResult / UI 的关系

ToolResult 不直接进入 UI 主渲染。

链路应该是：

```text
ToolResult
→ Dialogue Planner 解释
→ Execution Orchestrator 组装 TurnResult
→ UI 消费 assistant_message / ui_cards / behavior_state / trace_ref
```

UI 可以展示工具结果摘要，但必须来自 TurnResult 或 trace 引用。

禁止：

1. UI 直接调用工具。
2. UI 直接读取 ToolResult 当成主状态。
3. UI 绕过 TurnResult 自造 action 状态。
4. UI 将候选方向当成已执行产物。

---

## 11. 不变量

1. Planner 只能引用 registry 中存在的工具。
2. ToolRequest 必须由 Execution Orchestrator 产生或批准。
3. ToolResult 不能直接成为作者主消息。
4. 写入工具必须声明 write_scope 和 risk_class。
5. `production_object` 写入必须经过 authority。
6. 创作工具输出默认 candidate 或 tentative。
7. 策略工具只判断，不负责生成作者主文案。
8. 每次工具调用必须进入 DecisionTrace。
9. 工具 registry 版本必须可追踪。
10. disabled / deprecated 工具不能被 MicroPlan 正常引用。

---

## 12. 后续 ADR 候选

本文建议后续拆出以下 ADR：

| ADR | 冻结内容 |
|---|---|
| Toolbox Registry v3 | registry entry 字段、状态、版本规则 |
| ToolRequest / ToolResult v3 | 请求与结果 envelope |
| Tool Layer Boundary | 五层工具职责与禁止事项 |
| Tool Authority / Budget Hooks | write_scope、risk_class、budget_profile 与门禁 |

ADR 前置材料已经具备：

1. `00c-state-and-contract-atlas.md`

原因是 `04-execution-orchestrator.md` 已经承接 ToolRequest 的裁决边界，`05-turn-behavior-and-state-model.md` 已经承接 behavior 状态，`06-memory-context-and-trace.md` 已经承接 trace/replay，`07-workbench-ui-contract.md` 已经承接 UI 消费，`00c-state-and-contract-atlas.md` 已经完成全局 contract 索引和 ADR backlog 汇总。

---

## 13. 下一步

本文完成后，v3 已具备：

- DialogueFrame / MicroPlan 的协议草案。
- Toolbox / ToolRequest / ToolResult 的协议草案。
- 动态主链与运行时视图。
- Execution Orchestrator 的协议草案。
- Turn Behavior 与状态模型草案。
- Memory、Context、Trace 与 Replay 草案。
- Workbench UI 消费契约草案。
- 状态、contract、ADR 候选和 slice 入口总索引。

下一步建议写：

```text
docs/design-v3/adr/README.md
```

原因：

- `04` 已经定义 OrchestratorDecision、门禁顺序、dispatch 边界、状态推进和 TurnResult 组装职责。
- `05` 已经定义 clarification、confirmation、correction、cancellation、recovery 如何形成可持续 behavior lifecycle。
- `06` 已经定义 ToolRequest / ToolResult / BehaviorState 如何进入 trace 与 replay。
- `07` 已经定义 UI 如何展示工具结果摘要、trace 摘要和可用动作，但不直接调用工具。
- `00c` 已经把 toolbox contract 与其他状态、ADR 候选、slice 入口建立索引关系。
- 下一步需要建立 v3 ADR 编号、状态、模板和首批 Proposed ADR 顺序。
