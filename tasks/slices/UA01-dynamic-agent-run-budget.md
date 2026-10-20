# UA01 动态 AgentRun 预算：计划派生 + 硬上限

- 状态：**active / CP2c 执行步分账 + CP3 N-step 选择 PASS（2026-10-21）；CP4b legacy 不可达**
- 类型：AgentRun Runtime / Execution Authority / Budget Policy Slice
- 来源：B18/B19 排查；`agentic-loop-budget-deviation-replan` 失败；用户拍板“核心是预算写死”
- 父决策：ADR-0023（计划驱动执行 / D5 预算偏离）、VS-01（执行授权）、ADR-0027（作者义务）

## 1. 问题

当前每个 profile 的 AgentRun 预算在 `DialoguePlanningService.run_budget/2` 里是硬编码常量：

```elixir
# judgment_plan
max_steps: 6
max_tool_calls: 5
max_provider_calls: 12
max_replans: 1

# prose_drafting_with_quality
max_steps: 5
max_tool_calls: 2
max_provider_calls: 6
```

但 AgentPlan 是运行时由模型起草的，步数和工具/provider 成本事先未知。结果是：

- 4 步计划可能刚好够；
- 7 步计划在 6 步预算下必然不足；
- 计划起草/判断/入场也计入 `steps`，进一步挤压执行预算；
- `judgment_plan` 忽略作者步数约束的 `one_step_budget?`；
- 预算不足先撞 `budget_exhausted` 硬停，D5/判断②没有机会收缩或向作者解释。

**这不是“6 太小”，而是“预算没有从计划派生”。** 把 6 改成 10 仍是硬编码，只是移动失败点。

## 2. 七问

- **Contract**：ADR-0023 D5；VS-01 执行授权；AgentRun budget/consumed_budget；不新增 agent command、不新增作者可见协议。
- **Invariant**：
  - 合法计划必须获得足以执行其 step/tool/provider 成本的执行预算（在硬上限内）。
  - 规划开销与执行步数分账，不得让判断/计划起草挤掉执行预算。
  - 作者显式预算（结构化 `author_limits`）优先于 profile 默认值。
  - D5 只在“计划 > 硬上限”或“作者声明预算不足”时触发；正常计划不得因写死常量误杀。
  - 任何情况下保留绝对硬上限与 `max_replans`，禁止无限绕预算。
- **Boundary**：`novel_application`（`DialoguePlanningService` budget、`AgentRunServer` 预算接线、`AgenticDeviationSignal` D5、`ExecutionOrchestrator` gate）；`novel_domain` 如需新增预算纯结构；测试与 scenario。**不动** provider、prompt、web 协议、前端（作者可见预算预览归 CP3）。
- **Consumer**：`AgentRunServer` 实际执行；`AgentRunBudget` 纯函数被所有 agent_run profile 消费；作者收益通过既有 await/plan 事件体现。
- **Proof**：`AgentRunBudget` 纯函数单测（4/7/11 步、工具/provider 成本、显式一步约束、硬上限、规划开销分账）；prose/judgment flow 测试；重做 `agentic-loop-budget-deviation-replan` 真实 Tauri 场景；不得用产品验收钩子。
- **Acceptance Driver**：外部 Playwright/Tauri 驱动真实工作台；场景改为“计划超过硬上限/作者声明预算不足”，不再人工塞 7 步绕过产品语义。产品代码零验收感知。
- **Exploration**：不适用；本 slice 不物化小说要素。

## 3. 目标模型

```text
AgentRun 启动
→ 规划阶段小预算（judgment + plan draft）
→ 计划起草完成
→ AgentRunBudget.for_plan(plan, profile, author_constraints, hard_caps)
   = 固定开销 + Σ step 成本
→ 与作者约束 / 硬上限对账
→ 够：执行
→ 不够：D5 → 收缩计划 / await_author 说明真实差异
→ 硬上限始终兜底
```

成本模型至少区分：

- `context_assemble` / `chapter_mission`：1 step，0 tool；
- `prose_writing`：1 step，1 tool，writer + evaluator 2 provider calls；
- 其它 act：1 step，1 tool，1 provider call（按 profile 实际 registry 校准）；
- 判断②续行：2 provider calls + 重产出步成本；
- `max_replans` 保持小值，不进“按计划放大”范围。

## 4. Checkpoints

| CP | 内容 | Proof | 状态 |
|---|---|---|---|
| CP0 | 本设计 + 七问 + 现有预算/成本盘点 | 文档；B18/B19 证据引用 | **done（2026-10-21）** |
| CP1 | 纯 `AgentRunBudget` 模块 + 成本模型 + 单测 | `agent_run_budget_test.exs` 6/6：4/7 步、硬上限、显式 author_limits、执行开销、prose 双 provider 成本 | **done（2026-10-21）** |
| CP2 | 运行时接线：plan 后派生执行预算；规划/执行分账；D5 语义 | **CP2a/CP2b-1/CP2b-2 done**；**CP2c done（2026-10-21）**：`execution_steps` 从 `stage_state.agent_plan_cursor` 同步，规划/判断不计执行步；计划 patch 预留 1 个收束 token；pure 13/13、runtime 49/0 | **done** |
| CP3 | 作者约束与预算可见性 | **done（2026-10-21）**：输入区提供“本次只做一步”结构化 `author_limits`，不再解析文本口令；shortfall TurnResult 列出剩余步骤，并携带“下一步 / 只执行第 N 步 / 剩余全部”选择 | **done** |
| CP4 | 重做 D5 场景 + 真实 Tauri | `agentic-loop-budget-deviation-replan` PASS：规划 3 步、执行 1 步后 shortfall；作者选“只执行第 2 步” → `budget_expanded` single_step/1，同一 run running，max_steps=2 | **step-choice PASS（2026-10-21）** |
| CP4b | D5 `plan_revised` 余量可收缩路径 | 调查结果：该路径属于已删除的 conversation flow；当前 D5 只在 prose continuation 中，且 plan-derived budget + “只做一步”约束下不存在“仍有剩余但不足”的可达情形 | **blocked / superseded（2026-10-21）** |

### 4.1 CP2b-2 最小设计（待确认后动代码）

**问题**：`AgentRunServer.run_next_step` 在 `AgentRun.budget_exhausted?` 时先硬停，D5/作者裁决没有入口。

**约束**：

- 不绕过硬上限；不在预算耗尽后再执行工具；
- 不在预算耗尽后无界调用 provider；
- 作者“只做一步”与硬上限是作者决策点，不自动扩预算。

**推荐方案（安全优先）**：

1. 预算耗尽时先算“计划 pending vs 剩余”，若存在缺口：
   - 发 `awaiting_author`，reason codes 增加 `plan_budget_shortfall`；
   - summary 说明真实差异：“计划 N 步 / 剩余 M 步”；
   - 不调用 planner/provider，不执行工具。
2. 只有 **provider/tool 预算仍有余量且 plan 还有 pending** 时，才允许一次 D5 探测：
   - D5 → 判断②；
   - `continue` 仅允许在收缩后的计划能装进剩余预算时执行；
   - 装不进 → 仍走作者裁决，不自动扩预算。
3. “扩大预算”作为作者动作（CP3），不在 CP2b-2 自动发生。
4. D5 场景改为断言“真实预算缺口 → awaiting_author + shortfall + writer 未派发”；`plan_revised` 只在收缩计划可执行时断言。

**为什么不是直接调大或自动 replan**：作者约束/硬上限是主权边界；自动扩预算会绕过作者，自动 replan 可能在 0 剩余预算下仍执行。

**待确认**：是否接受“预算缺口先诚实停等，扩大预算由作者动作”作为 CP2b-2 的语义。

### 4.2 CP3 作者恢复面（已实现）

`plan_budget_shortfall` 不再只有事件；同一 `awaiting_author` 事件携带带 `available_actions` 的 TurnResult：

```text
plan_budget_shortfall
→ TurnResult(status=awaiting_author)
   ├─ agent_run_budget_next_step        “只执行下一步”
   ├─ agent_run_budget_next_steps_2     “接下来 2 步”
   ├─ agent_run_budget_single_step_N    “只执行第 N 步”
   └─ agent_run_budget_remaining_plan   “允许执行剩余计划”
→ 作者点击其中一个（author_action）
→ 服务端校验 run scope + awaiting_author
→ AgentRunBudget.authorized_expand/4
   ├─ next_step: execution_steps + 1 执行步 + 1 收束 token
   ├─ next_steps_N: execution_steps + N 执行步 + 1 收束 token
   └─ remaining_plan: execution_steps + 计划步数 + 1 收束 token
→ 绝对硬上限检查（50 步 / 50 tool / 100 provider）
→ 同一 run 恢复；budget_expanded 事件 + agent_run_state
```

- 动作只能来自 TurnResult `available_actions`；`ActionValidator` 拒绝 stale/invented action。
- 服务端校验 `work_id` / `session_id` / `run_id` 一致，且 run 必须处于 `awaiting_author`。
- 硬上限不足时不提供该动作；不自动扩预算，不自动 replan。
- 扩预算后写 `author_budget_override` 标记；后续计划 patch 不得再用旧文本口令把预算压回 1。
- 作者步数约束走 `UserMessageSubmission.author_limits` 结构化字段；文本“最多一步”等不再触发限制。
- `execution_steps` 只随 `stage_state.agent_plan_cursor` 增长；判断/计划起草不占执行步。
- 计划 patch 为收束判断预留 1 个 step/tool/provider token；它不占 execution_steps，但避免执行完后因预算检查无法收束。
- `budget_expanded` 是新的 author-visible AgentEvent 类型，触发 agent_run_state 快照。

### 4.3 CP4 证据（2026-10-21）

```bash
TAURI_SLICE_VERIFY_TIMEOUT_SECONDS=90 \
  PHOENIX_PORT=4673 VITE_DEV_PORT=5776 \
  bash scripts/tauri_slice_verify.sh --provider slice_verify agentic-loop-budget-deviation-replan
```

真实 Tauri PASS：

- 作者点击“本次只做一步”后发送（`author_limits.max_steps=1`，消息正文无口令）；
- `plan_drafted` 4 步，先执行 1 个执行步，再 `awaiting_author`；
- TurnResult status `awaiting_author`，actions 含 `agent_run_budget_next_step`、`agent_run_budget_single_step_2/3`、`agent_run_budget_remaining_plan`；
- 动作前：`consumed_steps=3`（规划+执行总账）、`execution_steps=1`、`consumed_tool_calls=0`、`consumed_replans=0`、无 `plan_revised`、无 completed TurnResult、无 tool dispatch；
- 点击“只执行第 2 步”：`budget_expanded` mode `single_step` / `step_count=1`，同一 run 状态 `running`，`max_steps=2`。

**CP4b 调查结论（2026-10-21）**：不能诚实补出“D5 `plan_revised` 余量可收缩”场景。

- `AgenticDeviationSignal` 的 D5 只被 `prose_drafting_with_quality` 引用；旧 conversation D5 路径已在帧纪元重构中删除。
- `AgentRunServer.run_next_step` 在调用 planner 之前先检查 `AgentRun.budget_exhausted?`，conversation 预算耗尽不会进入 D5。
- 计划预算现在按计划派生；作者“只做一步”会留下 0 步剩余，正常计划不会出现“仍有剩余但不足以走完”的可达情形。
- `max_steps` 仍按总 `consumed_budget.steps` 计算，规划/执行分账未真正落地；这也是“只做一步”看起来永远不够的根因。

**因此 CP4b 不应通过构造伪计划或伪 `plan_revised` 来收口。** 下一步应二选一：

1. 先做规划/执行分账（CP2c），让“只做一步”只限制执行步，再评估 D5；
2. 或直接做真正的“缩小计划/重规划”作者动作，替代 legacy D5 `plan_revised`。

## 5. 明确不做

- 不把 profile 预算常量简单调大。
- 不改 SystemIdentity / prompt / B1/B2 前缀工作。
- 不让模型自己声明“预算够”作为放行依据；预算由 app 机械计算。
- 不放开无限 replan / 无限 provider 调用。
- 不把规划开销算成可执行 step 预算。

## 6. 风险

| 风险 | 处置 |
|---|---|
| 计划成本估算过低，执行中仍超 | 成本模型保守 + 硬上限 + 执行中 D5 兜底 |
| 预算放大导致长跑/失控 | 绝对硬上限、max_replans 小值、provider/tool 维度同时设限 |
| 计划起草本身已消耗预算 | 规划/执行分账；规划阶段独立小预算 |
| 作者“只做一步”与计划冲突 | 直接 D5/await，说明“需要 N 步 / 你允许 1 步”，不静默扩预算 |
| 既有场景期望计数漂移 | CP4 重做场景，使用真实预算差异；不人工塞 step |

## 7. 与 CP-AB 的关系

- B20 优先于 CP-AB 收口：D5 场景是 CP-AB 的 deviation 证据之一，预算写死会让该证据长期失真。
- B20 不修 CP-AB 的 prompt/前缀；只修预算派生与 D5 语义。
- B18/D4 已修；B19/D5 由本 slice 收口。
