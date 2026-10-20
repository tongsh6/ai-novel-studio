# UA01 动态 AgentRun 预算：计划派生 + 硬上限

- 状态：**registered / CP0 design（2026-10-21）**
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
- `judgment_plan` 忽略作者“最多一步”的 `one_step_budget?`；
- 预算不足先撞 `budget_exhausted` 硬停，D5/判断②没有机会收缩或向作者解释。

**这不是“6 太小”，而是“预算没有从计划派生”。** 把 6 改成 10 仍是硬编码，只是移动失败点。

## 2. 七问

- **Contract**：ADR-0023 D5；VS-01 执行授权；AgentRun budget/consumed_budget；不新增 agent command、不新增作者可见协议。
- **Invariant**：
  - 合法计划必须获得足以执行其 step/tool/provider 成本的执行预算（在硬上限内）。
  - 规划开销与执行步数分账，不得让判断/计划起草挤掉执行预算。
  - 作者显式预算（“最多一步”）优先于 profile 默认值。
  - D5 只在“计划 > 硬上限”或“作者声明预算不足”时触发；正常计划不得因写死常量误杀。
  - 任何情况下保留绝对硬上限与 `max_replans`，禁止无限绕预算。
- **Boundary**：`novel_application`（`DialoguePlanningService` budget、`AgentRunServer` 预算接线、`AgenticDeviationSignal` D5、`ExecutionOrchestrator` gate）；`novel_domain` 如需新增预算纯结构；测试与 scenario。**不动** provider、prompt、web 协议、前端（作者可见预算预览归 CP3）。
- **Consumer**：`AgentRunServer` 实际执行；`AgentRunBudget` 纯函数被所有 agent_run profile 消费；作者收益通过既有 await/plan 事件体现。
- **Proof**：`AgentRunBudget` 纯函数单测（4/7/11 步、工具/provider 成本、最多一步、硬上限、规划开销分账）；prose/judgment flow 测试；重做 `agentic-loop-budget-deviation-replan` 真实 Tauri 场景；不得用产品验收钩子。
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
| CP1 | 纯 `AgentRunBudget` 模块 + 成本模型 + 单测 | 4/7/11 步、最多一步、硬上限、规划开销分账 | todo |
| CP2 | 运行时接线：plan 后派生执行预算；规划/执行分账；D5 语义 | prose/judgment flow 测试；无作者可见协议变更 | todo |
| CP3 | 作者约束与预算可见性 | “最多一步”生效；预算不足时真实差异文案；可选扩大预算动作 | todo |
| CP4 | 重做 D5 场景 + 真实 Tauri | `agentic-loop-budget-deviation-replan` PASS；硬上限/无绕预算反例 | todo |

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
| 作者“最多一步”与计划冲突 | 直接 D5/await，说明“需要 N 步 / 你允许 1 步”，不静默扩预算 |
| 既有场景期望计数漂移 | CP4 重做场景，使用真实预算差异；不人工塞 step |

## 7. 与 CP-AB 的关系

- B20 优先于 CP-AB 收口：D5 场景是 CP-AB 的 deviation 证据之一，预算写死会让该证据长期失真。
- B20 不修 CP-AB 的 prompt/前缀；只修预算派生与 D5 语义。
- B18/D4 已修；B19/D5 由本 slice 收口。
