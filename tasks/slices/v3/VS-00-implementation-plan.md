# VS-00 Implementation Plan

> 状态：Ready for review（2026-05-08）
>
> 角色：VS-00 reply-only 最小主链的代码实现计划。本文不是设计文档——设计依据见 `contracts/VS-00-reply-only-contract-pack.md` 和 `adr/ADR-0001-dialogue-frame-v3.md`。

---

## 1. 目标

用最少代码证明 v3 核心假设：**每个 turn 都能产生 DialogueFrame，TurnResult 是 canonical 出口，DecisionTrace 能解释为什么不调工具。**

不调用工具、不写 production state、不引入 durable behavior、不涉及前端。

---

## 2. 五问

| 问题 | 回答 |
|------|------|
| **Contract** | `AuthorInput`、`DialogueContext`、`DialogueFrame`（reply-only 子集）、`TurnResult` v3、`DecisionTrace`。字段规格见 `contracts/VS-00-reply-only-contract-pack.md` §2-4。 |
| **Invariant** | `00c` §7 #1（每 turn 必有 frame）、#9（TurnResult 是 canonical 输出）、#14（replay 默认不重新调用 LLM） |
| **Boundary** | 切过 `novel_domain`（新增 struct）、`novel_application`（新增 Gateway/Planner/Builder/Trace）、`novel_agent`（复用 Provider Gateway）。不碰 `novel_persistence`（零 DB 写入）、不碰 `novel_web`（先通过 ExUnit 证明）、不碰 `frontend`。 |
| **Consumer** | ExUnit contract test（第一个真实消费者） |
| **Proof** | 4 个 contract test：frame-exists、no-microplan、turnresult-truthfulness、trace-explains-non-execution |

---

## 3. 模块变更清单

### 3.1 删除的 v2 模块
```
novel_agent/lib/novel_agent/
  - router.ex, router/result.ex
  - orchestrator.ex
  - intent_registry.ex (含 SlotSchema)
  - clarification_store.ex
  - authority_gate.ex
  - budget_meter.ex
  - agent.ex, agent/writer.ex
  - capabilities/simple_complete.ex
  - runtime/ (全部)
  - memory/store.ex
  - audit_log.ex
  - llm_log.ex
  - long_runner.ex

novel_application/lib/novel_application/
  - turn_service.ex
  - adoption_boundary.ex
  - memory_service.ex
  - memory_recall_service.ex
  - reading_service.ex
  - memory_policy/ (全部)
  - intent_handlers/ (全部)
```

### 3.2 新建的 v3 模块

```
novel_domain/
  + dialogue_frame.ex          — DialogueFrame struct + validate/1
  + decision_trace.ex          — DecisionTrace struct

novel_application/
  + dialogue_gateway.ex        — 对话入口：AuthorInput → Context → Planner → Frame → TurnResult
  + planner.ex                 — Dialogue Planner：调用 LLM 形成 Frame
  + turn_result_builder.ex     — TurnResult v3 构建
  + trace_writer.ex            — DecisionTrace 记录（内存，不落库）
```

### 3.3 保留并适配的模块
```
novel_agent/
  provider/gateway.ex          — 保留，v3 Planner 通过它调用 LLM
  provider/anthropic.ex        — 保留
  provider/lm_studio.ex        — 保留
  provider/stub.ex             — 保留（测试用）
  provider/result.ex           — 保留
  provider/usage.ex            — 保留
  telemetry.ex                 — 保留

novel_foundation/
  全部保留，按 v3 ADR 扩展枚举值
```

---

## 4. 模块设计

### 4.1 NovelDomain.DialogueFrame

```elixir
defmodule NovelDomain.DialogueFrame do
  @moduledoc """
  v3 每 turn 必有的认知帧。VS-00 只覆盖 reply-only 子集。
  """

  @type frame_type :: :casual_reply | :creative_exploration | :question_answer | :meta_discussion
  @type reason_code :: :no_tool_needed | :exploratory_only | :insufficient_execution_target | :user_requested_discussion
  @type execution_readiness :: :not_applicable | :not_ready

  @type t :: %__MODULE__{
    schema_version: String.t(),
    frame_id: String.t(),
    turn_id: String.t(),
    workspace_id: String.t(),
    primary: boolean(),
    frame_type: frame_type(),
    source_refs: %{author_input_ref: String.t(), dialogue_context_ref: String.t() | nil},
    dialogue_goal: %{summary: String.t()},
    tool_need: %{needs_tool: boolean(), reason_code: reason_code()},
    execution_readiness: execution_readiness(),
    author_visible_draft: %{message: String.t()},
    evidence_summary: map(),
    uncertainty: [map()]
  }

  defstruct [
    :schema_version, :frame_id, :turn_id, :workspace_id,
    :primary, :frame_type, :source_refs, :dialogue_goal,
    :tool_need, :execution_readiness, :author_visible_draft,
    evidence_summary: %{},
    uncertainty: []
  ]

  @doc "Validate reply-only frame. Returns :ok or {:error, reasons}."
  @spec validate(t()) :: :ok | {:error, [String.t()]}
  def validate(frame)
end
```

### 4.2 NovelDomain.DecisionTrace

```elixir
defmodule NovelDomain.DecisionTrace do
  @moduledoc """
  v3 决策追溯。VS-00 只记录 reply-only 决策。
  """

  @type t :: %__MODULE__{
    trace_id: String.t(),
    turn_id: String.t(),
    frame_ref: String.t(),
    decision_type: :reply_only,
    no_tool_reason: String.t(),
    no_behavior_reason: String.t(),
    no_write_reason: String.t(),
    turn_result_ref: String.t(),
    replay_policy: %{use_recorded_frame: true, recall_provider: false},
    redaction_level: :author_safe | :developer,
    event_order: [atom()]
  }

  defstruct [
    :trace_id, :turn_id, :frame_ref, :decision_type,
    :no_tool_reason, :no_behavior_reason, :no_write_reason,
    :turn_result_ref, :replay_policy, :redaction_level,
    event_order: []
  ]
end
```

### 4.3 NovelApplication.DialogueGateway

```elixir
defmodule NovelApplication.DialogueGateway do
  @moduledoc """
  v3 对话入口。接收 AuthorInput，协调 Context → Planner → Frame → TurnResult → Trace。
  """

  @doc """
  处理一次作者输入，返回 TurnResult v3 map + DecisionTrace。
  """
  @spec handle_input(map()) :: {:ok, map(), NovelDomain.DecisionTrace.t()} | {:error, term()}
  def handle_input(%{text: text, workspace_id: ws_id} = input)
end
```

流程：
1. 分配 `turn_id`
2. 组装 `DialogueContext`（VS-00 可为空）
3. 调用 `Planner.form_frame/2`
4. 校验 `DialogueFrame`
5. 调用 `TurnResultBuilder.build_reply_only/2`
6. 调用 `TraceWriter.record_reply_only/3`

### 4.4 NovelApplication.Planner

```elixir
defmodule NovelApplication.Planner do
  @moduledoc """
  v3 Dialogue Planner。调用 LLM（通过 Provider Gateway）形成 DialogueFrame。
  """

  @doc """
  根据 AuthorInput 和 DialogueContext 生成 DialogueFrame。
  Provider 不可用时返回 safe fallback frame。
  """
  @spec form_frame(map(), map() | nil) :: {:ok, NovelDomain.DialogueFrame.t()} | {:error, term()}
  def form_frame(author_input, dialogue_context)
end
```

实现要点：
- 构建 structured output prompt，要求 LLM 输出 JSON
- JSON 解析成功后构造成 `DialogueFrame` struct
- LLM 不可用或解析失败时，生成 safe fallback frame（`frame_type: :casual_reply, needs_tool: false`）
- 不在此模块做执行批准——那是 Orchestrator 的职责

### 4.5 NovelApplication.TurnResultBuilder

```elixir
defmodule NovelApplication.TurnResultBuilder do
  @moduledoc """
  从 DialogueFrame 构建 v3 TurnResult。VS-00 只构建 reply-only。
  """

  @doc """
  构建 reply-only TurnResult。不包含 tool/adoption/write/behavior claim。
  """
  @spec build_reply_only(NovelDomain.DialogueFrame.t(), map()) :: map()
  def build_reply_only(frame, trace_summary)
end
```

### 4.6 NovelApplication.TraceWriter

```elixir
defmodule NovelApplication.TraceWriter do
  @moduledoc """
  v3 trace 写入。VS-00 只在内存中记录，不落库。
  """

  @doc """
  记录 reply-only DecisionTrace。返回 trace struct + author-safe summary。
  """
  @spec record_reply_only(NovelDomain.DialogueFrame.t(), map(), keyword()) :: {NovelDomain.DecisionTrace.t(), map()}
  def record_reply_only(frame, turn_result, opts)
end
```

---

## 5. 任务清单

| # | 任务 | 产物 | 类型 |
|---|------|------|------|
| T0 | 删除 v2 Router-first 模块 | 删除 20+ 个 .ex 文件 | 清理 |
| T1 | 创建 `NovelDomain.DialogueFrame` + `validate/1` | `novel_domain/lib/novel_domain/dialogue_frame.ex` | 新增 |
| T2 | 创建 `NovelDomain.DecisionTrace` | `novel_domain/lib/novel_domain/decision_trace.ex` | 新增 |
| T3 | 创建 `NovelApplication.Planner` | `novel_application/lib/novel_application/planner.ex` | 新增 |
| T4 | 创建 `NovelApplication.TurnResultBuilder` | `novel_application/lib/novel_application/turn_result_builder.ex` | 新增 |
| T5 | 创建 `NovelApplication.TraceWriter` | `novel_application/lib/novel_application/trace_writer.ex` | 新增 |
| T6 | 创建 `NovelApplication.DialogueGateway` | `novel_application/lib/novel_application/dialogue_gateway.ex` | 新增 |
| T7 | 写 contract tests（4 个 proof） | `novel_application/test/novel_application/dialogue_gateway_test.exs` | 新增 |
| T8 | 删除 v2 旧测试文件，确保编译通过 | 清理 `_test.exs` | 清理 |
| T9 | 运行全部门禁 | `mix test`, `mix xref`, `arch_check` | 验证 |

---

## 6. Proof（4 个 contract test）

### Test 1: reply-only frame exists
```elixir
test "reply-only turn produces primary DialogueFrame" do
  input = %{text: "我想聊聊这个故事开头的气质，先别写正文", workspace_id: "ws-1"}
  {:ok, turn_result, trace} = NovelApplication.DialogueGateway.handle_input(input)

  assert turn_result.frame_summary != nil
  assert trace.decision_type == :reply_only
  assert trace.frame_ref != nil
end
```

### Test 2: no MicroPlan
```elixir
test "reply-only turn does not produce MicroPlan" do
  input = %{text: "帮我判断应该更悬疑还是更温柔", workspace_id: "ws-1"}
  {:ok, turn_result, _trace} = DialogueGateway.handle_input(input)

  refute Map.has_key?(turn_result, :micro_plan)
  refute turn_result[:tool_called] == true
end
```

### Test 3: TurnResult truthfulness
```elixir
test "reply-only TurnResult does not claim tool/adoption/write/behavior" do
  input = %{text: "先聊方向不写正文", workspace_id: "ws-1"}
  {:ok, turn_result, _trace} = DialogueGateway.handle_input(input)

  refute turn_result[:tool_called]
  refute turn_result[:artifact_adopted]
  refute turn_result[:production_write_performed]
  refute turn_result[:durable_behavior_opened]
end
```

### Test 4: trace explains non-execution
```elixir
test "DecisionTrace records no-tool, no-behavior, no-write reasons" do
  input = %{text: "聊聊风格", workspace_id: "ws-1"}
  {:ok, _turn_result, trace} = DialogueGateway.handle_input(input)

  assert trace.no_tool_reason != nil
  assert trace.no_behavior_reason != nil
  assert trace.no_write_reason != nil
  assert trace.replay_policy.recall_provider == false
  assert length(trace.event_order) >= 4
end
```

---

## 7. 验证门禁

- [ ] `mix compile --warnings-as-errors`
- [ ] `mix test` — 新增 4 个 contract test + 370 已有测试不退化
- [ ] `mix xref graph --format cycles --label compile-connected --fail-above 0`
- [ ] `mix run scripts/arch_check.exs` — 不新增违规
- [ ] `bash scripts/ai_static_scan.sh --top 10`

---

## 8. Safe Fallback 策略

Provider 不可用时（网络故障、API key 缺失等），Planner 必须返回 safe fallback frame：

```elixir
%DialogueFrame{
  frame_type: :casual_reply,
  tool_need: %{needs_tool: false, reason_code: :no_tool_needed},
  execution_readiness: :not_applicable,
  author_visible_draft: %{message: "抱歉，我现在无法连接到创作引擎。请稍后再试。"},
  uncertainty: []
}
```

这个 fallback 确保 v3 即使在 LLM 不可用时也不会崩溃，且 trace 诚实记录 fallback 原因。

---

## 9. 不实现的内容

- MicroPlan struct 和 builder
- Execution Orchestrator 和 gate order
- BehaviorState
- Capability Toolbox / ToolRequest / ToolResult
- DB persistence（trace 仅内存）
- Channel / API 集成（先通过 ExUnit 证明）
- 前端组件
- real context assembly（VS-00 允许空 context）

这些留给 VS-00A（创作探索）、VS-00B（上下文）、VS-01（执行权）。

---

## 10. 风险

| 风险 | 缓解 |
|------|------|
| LLM JSON 输出不稳定 | Safe fallback frame + 解析失败重试 |
| v3 新模块与 v2 编译冲突 | v3 用独立命名空间 `V3`，不改 v2 文件 |
| 测试相互干扰 | v3 测试用 stub provider，不依赖真实 API |
| 设计假设在代码中不可行 | VS-00 范围最小，失败成本低；回滚只需删除 6 个新文件 |
