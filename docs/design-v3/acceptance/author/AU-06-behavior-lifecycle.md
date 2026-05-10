# AU-06 对话行为生命周期

> 作者视角：当 AI 不确定我的意图，或者需要我确认某个操作时，系统会进入一个"等待我"的状态。这种状态有完整的生命周期——打开、等待、回答、解决、关闭。我能清楚看到系统在等什么，以及有哪些选择。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 看到系统提示"需要你确认" | 界面显示"等待作者"状态 + 确认/取消按钮 |
| 点击"确认执行" | 系统接收 action，关闭等待状态，重新裁决 |
| 点击"取消" | 系统关闭等待状态，不产生副作用 |
| 尝试点一个已过期的确认 | 系统提示"该操作已处理" |
| 先聊点别的，不理会确认 | 确认状态仍存在，我可以普通对话 |

明确不能做的：
- 系统不应在我没确认的情况下假装理解并继续执行
- 同一时刻不应出现两个互相冲突的"主等待态"

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #7 | durable behavior 必须有 open/close/resolution | A1 → E1 — 完整 open → await → resolve → close 链路 |
| #8 | 缺 slot 不自动等于表单 | A2 — 降级不打开 behavior |
| #10 | UI 只能提交 available actions | D1 — 操作已关闭 behavior 被拒绝 |
| #12 | 确认回答重新 gate | C1 — confirm 后重新跑 Orchestrator |
| #14 | replay 不调 LLM | E1 — behavior trace 完整可回放 |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0006 | TurnPhase / TurnStatus 定义 |
| ADR-0007 | NextAction / AvailableAction 定义 |
| ADR-0008 | BehaviorState 生命周期（7 种状态） |
| ADR-0009 | ConfirmationBinding 和 re-gate 策略 |
| VS-03 Contract Pack §2 | TurnPhase / TurnStatus 最小集合 |
| VS-03 Contract Pack §3 | AvailableAction 集合（8 种 action） |
| VS-03 Contract Pack §4 | BehaviorState 最小 schema（17 字段） |
| VS-03 Contract Pack §5 | ConfirmationBinding 最小 policy（9 字段） |
| VS-03 Contract Pack §7 | Proof 草案（10 条） |

---

## 4. 验收场景

### 场景组 A：BehaviorState 数据模型

#### A1 — 17 字段完整性

**作为作者**，每个 BehaviorState 有 17 个字段保证其可追踪、可审计、可回放。

**核心字段**：
| 字段 | 类型 | 含义 | VS-03 要求 |
|------|------|------|-----------|
| `behavior_id` | string | 稳定 ID | `@enforce_keys` |
| `behavior_type` | `:clarification \| :confirmation \| :recovery` | 行为类型 | `@enforce_keys` |
| `lifecycle_status` | 7 种状态之一 | 当前状态 | `@enforce_keys` |
| `blocking_actor` | `:author \| :system \| :tool \| :none` | 阻塞方 | 默认 `:author` |
| `opened_at_turn_ref` | string | 开立 turn | `@enforce_keys` |
| `opened_by_decision_ref` | string | 开立 decision | `@enforce_keys` |
| `frame_ref` | string | 关联 frame | 必填 |
| `plan_ref` | string or nil | 关联 plan | 可为 nil |
| `target_ref` | string or nil | 操作目标 | confirmation 必填 |
| `required_next_action` | string | 主 NextAction | 必填 |
| `available_actions` | array | 可选 action | 来自 Orchestrator |
| `prompt_contract` | object | 问题/影响描述 | 必填 |
| `constraints` | object | 权限/预算/风险摘要 | 必填 |
| `resolution` | object or null | 关闭时必须 | closed → 必填 |
| `closed_at_turn_ref` | string or null | 关闭 turn | closed → 必填 |
| `trace_ref` | string | DecisionTrace 引用 | 必填 |

**验证点**：
- [ ] `@enforce_keys` 缺失 → 编译失败
- [ ] `lifecycle_status` 不在 7 种枚举中 → 类型错误

**代码**：`behavior_state.ex:33-35`（@enforce_keys）、`behavior_state.ex:9-10`（类型定义）✅

---

### 场景组 B：状态机

#### B1 — 7 种生命周期状态

**作为作者**，一个 behavior 经历完整的状态流转：

```
open → awaiting_author → resolving → resolved
                                     → cancelled
                                     → failed
                        → superseded
```

| 状态 | 含义 | open? | closed? | 代码路径 |
|------|------|-------|---------|---------|
| `:open` | 初始创建 | true | false | 预留，当前跳过 |
| `:awaiting_author` | 等待作者操作 | true | false | `open_behavior/6` 直接设为此状态 |
| `:resolving` | 作者已回答，重新 gate 中 | true | false | **未实现** ❌ |
| `:resolved` | 已成功解决 | false | true | **未实现** ❌ |
| `:cancelled` | 被作者取消 | false | true | **未实现** ❌ |
| `:failed` | 无法解决 | false | true | **未实现** ❌ |
| `:superseded` | 被新 behavior 替代 | false | false | **未实现** ❌ |

**当前实现**：只有 `:awaiting_author` 被设置。`open?/1` 和 `closed?/1` 函数已定义但从未被 transition 逻辑调用。❌

**测试**：`behavior_lifecycle_test.exs` — `"open? returns true for :awaiting_author"` ✅、`"closed? returns true for resolved/cancelled/failed"` ✅（但测试的 struct 是手动构造的，不是真实流转）

---

#### B2 — 状态转换的合法性

**作为作者**，系统必须保证状态的合法转换，拒绝非法跳转。

**合法转换路径**：
```
awaiting_author → resolving   (作者提交 action)
resolving       → resolved    (gate pass → 确认成功)
resolving       → failed      (gate fail → 确认失败)
awaiting_author → cancelled   (作者取消)
awaiting_author → superseded  (新 behavior 取代)
```

**禁止转换**：
- `resolved → awaiting_author`（已解决不能回退）
- `cancelled → resolving`（已取消不能重新激活）
- `superseded → awaiting_author`（已被取代不能回退）

**验证点**：
- [ ] 非法转换被 guard 拦截
- [ ] 拦截时记录 warning 日志
- [ ] **当前实现：无状态机 guard——任何代码都可以直接设置 status** ❌

---

#### B3 — 单一活跃 behavior

**作为作者**，同一 workstream 最多一个 primary author-blocking behavior。

**验证点**：
- [ ] 已有 active behavior（`open? = true`）时，再 open 新 behavior → 旧 behavior 被标记为 `:superseded` 或新 behavior 被拒绝
- [ ] 检查范围限定在同一个 `workspace_id` 内
- [ ] **当前实现：无检查——可以同时打开多个 behavior** ❌

---

### 场景组 C：完整流转

#### C1 — 确认 → 解决 → 关闭 的完整路径

**作为作者**，完整的确认流程包括 4 个步骤：

```
Step 1: 高风险请求 → Orchestrator 产生 :require_confirmation → open_behavior
  → BehaviorState{lifecycle_status: :awaiting_author, behavior_type: :confirmation}
  → TurnResult.available_actions = [confirm_before_execute, reject_or_cancel_confirmation]

Step 2: 作者提交 confirm_before_execute action
  → ActionValidator.validate(action, source_turn_result) → :ok
  → BehaviorState.lifecycle_status → :resolving
  → 基于确认后的上下文重新生成 MicroPlan
  → 重新跑 Gate Order → 可能 :allow_tool

Step 3: gate 通过 → 执行工具
  → Toolbox.execute → ToolResult{status: :succeeded}
  → BehaviorState.lifecycle_status → :resolved
  → BehaviorState.resolution → %{outcome: "confirmed_and_executed", ...}

Step 4: TurnResult 反映执行结果
  → TurnResult.available_actions = []（没有更多 action）
  → TurnResult.phase = :completed
```

**当前实现**：Step 1 完整。Step 2 中 `handle_action` 只做 validation，不做 behavior transition。Steps 3-4 在 Step 2 缺失的前提下无法验证。❌

**测试**：无端到端测试覆盖完整流转。

---

### 场景组 D：健壮性

#### D1 — 操作已关闭 behavior 被拒绝

**作为作者**，我点击一个已处理的确认按钮。系统拒绝并提示"已处理"。

**验证点**：
- [ ] ActionValidator 检查 source_turn_result 的 available_actions（间接通过 invented/stale 检查）
- [ ] 返回明确错误（不是静默丢弃）

**测试**：`action_roundtrip_test.exs` — `"stale action rejected by gateway"` ✅

---

#### D2 — Behavior TTL 过期

**作为作者**，一个确认等待了 2 小时我都没处理。系统应该标记为过期或至少提示。

**验证点**：
- [ ] BehaviorState 有 `opened_at_turn_ref` 可计算存活时间
- [ ] 超过 TTL 后 `available_actions` 中标注已过期
- [ ] **当前实现：无 TTL 逻辑** ❌

---

### 场景组 E：溯源性

#### E1 — Behavior trace 完整性

**作为作者**，behavior 的 open → await → resolve → close 全流程应该被 DecisionTrace 记录。

**验证点**：
- [ ] `opened_by_decision_ref` → 指向创建 behavior 的 decision
- [ ] resolution 操作 → 产生新的 DecisionTrace
- [ ] behavior trace 可被 ReplayReport 引用（不调 LLM）

**代码**：`trace_ref` 字段定义了但从未被填写。❌

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 17 字段完整性 | ✅ 类型定义完整 |
| B1 | 7 状态定义 | ⚠️ 类型定义完整，流转未实现 |
| B2 | 状态转换合法性 | ❌ 无 guard |
| B3 | 单一活跃 behavior | ❌ 无检查 |
| C1 | 确认→解决→关闭完整路径 | ❌ Step 2-4 未实现 |
| D1 | 已关闭 behavior 拒绝 | ✅ |
| D2 | TTL 过期 | ❌ 无实现 |
| E1 | Behavior trace | ❌ trace_ref 未填写 |

**通过率：2/8 完整 + 1/8 部分 = 约 31%** — Behavior 的创建侧完整，但解决侧（resolve/close）全链路缺失。

---

## 6. 缺口

| 缺口 | 发现位置 | 影响 | 建议处理 |
|------|---------|------|---------|
| GAP-01 — Behavior resolution 未实现 | `dialogue_gateway.ex:179-193` | 作者确认后 behavior 永不 close——永远是 awaiting_author | `handle_action` 中增加 behavior resolution 分支：→ resolving → re-gate → resolved/cancelled |
| GAP-02 — 状态机 guard 缺失 | `behavior_state.ex` | 任何代码可随意改 status | 增加 `transition/2` 函数，拒绝非法状态转换 |
| GAP-03 — 单一活跃 behavior 未强制 | `execution_orchestrator.ex:56` | 可能同时出现两个确认弹窗 | open_behavior 前检查是否有现存 active behavior |
| GAP-04 — TTL 未实现 | BehaviorState | 确认可以永远挂着 | 增加 `expires_at` 字段 + 到期检查 |
| GAP-05 — trace_ref 未填写 | `behavior_state.ex:47` | behavior 无法从 trace 中回放 | `open_behavior` 时从 DecisionTrace 获取 trace_ref 并填入 |
| GAP-06 — ConfirmationBinding 未使用 | ADR-0009 | 确认绑定（防止绑定错误 target）的设计未在代码中出现 | 实现 `ConfirmationBinding` struct + 校验 |

---

## 7. 验收命令

```bash
mix test apps/novel_application/test/novel_application/behavior_lifecycle_test.exs
mix test apps/novel_application/test/novel_application/action_roundtrip_test.exs
```
