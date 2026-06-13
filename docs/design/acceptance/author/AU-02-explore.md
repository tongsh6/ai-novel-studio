# AU-02 探索创作方向

> 作者视角：我有一个模糊的创作想法但还没想清楚，AI 应该像创作伙伴一样帮我展开思路、给出几个可能方向，并允许我选择某个方向继续探索。候选方向是灵感入口，不应自动写入作品事实；若要采纳为正式方向，必须经过明确的 adoption boundary。
>
> 2026-05-12 对账结论：后端 creative exploration、candidate fallback、malformed candidate 修复已有较强证据；`WorkspaceChat` 已能渲染候选卡。但按真实用户场景看，候选卡曾缺“点选继续探索/明确采纳”的操作闭环，且真实入口曾有默认 MicroPlan 风险。后续已补 `au02-candidate-continuation` 与 `au02-candidate-adoption-bridge` 真实 Tauri 证据；历史旁路 `历史旁路工作台` 已退役删除，不再作为当前证据。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 说“我想写赛博修仙但没想好” | AI 用自然语言展开几个可能方向，不弹字段表单 |
| 看到候选方向卡片 | 每张卡有标题、简介、风格标签，状态是未采纳 |
| 点一个候选继续聊 | 系统把这个选择作为“沿此方向继续探索”的上下文，不自动写入作品事实 |
| 明确采纳候选方向 | 系统经过 adoption boundary，把采纳结果和来源记录清楚 |
| 不想选也能继续输入 | 输入框始终可用，不被 action 按钮卡住 |
| LLM 候选缺失或格式坏 | 系统补可用 fallback 候选，不让体验断裂 |

明确不能做：
- 把模糊输入变成“作品类型、主角身份、目标读者”的必填表单；
- 候选方向自动成为作品设定；
- 点卡片就静默写入正文、设定或阅读投影；
- 探索阶段默认进入执行计划或工具调用。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU02-I1 / `00c` #1 | exploration turn 也必须产生 primary DialogueFrame | SC-AU02-A1 |
| AU02-I2 / `00c` #8 | 缺 slot 不自动等于表单 | SC-AU02-A2 |
| AU02-I3 / `00c` #9 | TurnResult 是候选卡的 canonical 输出 | SC-AU02-B1、SC-AU02-B3 |
| AU02-I4 / `00c` #11 | selection 不等于 adoption | SC-AU02-B4、SC-AU02-B5 |
| AU02-I5 / `00c` #12 | 采纳候选必须经过 authority / adoption boundary | SC-AU02-B5 |
| AU02-I6 | 探索阶段不得默认触发 MicroPlan / action / 工具调用 | SC-AU02-C2、SC-AU02-C3 |

---

## 3. 契约引用

| 契约 / 实现 | 用途 | 当前证据判断 |
|---|---|---|
| `DialogueFrame.frame_type == :creative_exploration` | 标记探索型对话 | 已有后端测试 |
| `CandidateDirection` | 候选方向结构：title / pitch / tone_tags / adoption_status | 已有后端构造和 fallback 测试 |
| `TurnResultBuilder.maybe_add_candidates/3` | 把 candidates 写入 TurnResult，并为每个候选生成服务端授权 `choose_candidate` action | `au02-candidate-adoption-bridge` Tauri 证据 |
| `WorkspaceChat.tsx` candidate panel | 当前真实入口渲染候选方向、继续探索和授权采纳按钮 | `au02-candidate-continuation` / `au02-candidate-adoption-bridge` Tauri 证据 |
| `turn_result_candidates.test.ts` | 前端候选字段契约测试 | 有测试，但样例 `adoption_status: "tentative"` 与业务期望 `not_adopted` 存在口径风险 |
| `AdoptionBoundary.evaluate/3` | 候选采纳边界 | 已接入 AU-02 候选卡授权采纳闭环；后续需补高风险/stale/conflict/cross-work |
| `frontend/src/lib/socket.ts` `sendMessage` | 当前真实入口发送 user_message | 普通探索默认不生成 MicroPlan；候选继续探索携带 `candidate_selection` |

---

## 4. 验收场景

### 场景组 A：自然探索

#### SC-AU02-A1 — 模糊想法得到自然探索回应

**作为作者**，我输入“我想写赛博修仙但没想好方向”，AI 像创作伙伴一样展开可能性。

**触发**：在真实工作台输入模糊创意并发送。

**期望结果**：
- AI 回复是自然创作讨论，不是字段表单；
- `frame_summary.frame_type` 是 `creative_exploration` 或被归一化为 exploration；
- `trace.decision_type` 是 `:exploration`；
- 前端显示自然回复；
- 不出现执行、确认、工具结果卡。

**当前证据**：`dialogue_gateway_test.exs` fuzzy creative idea / natural exploration tests；`creative_exploration_loop_test.exs` partner-like exploration。

**当前状态**：后端已测试，缺真实工作台 UI 验收。

---

#### SC-AU02-A2 — 不弹机械表单

**作为作者**，我还没想好方向时，系统不能要求我填必填字段表。

**触发**：发送“我想写小说但没想好”。

**期望结果**：
- TurnResult 不含 `required_slots` / `missing_slots` / `slot_schema` / `slot_form`；
- 不打开 durable clarification；
- 前端不渲染机械表单；
- 输入框保持可用。

**当前证据**：`dialogue_gateway_test.exs` “does not open mechanical slot form”；`workspace_channel_v3_test.exs` “does not contain forbidden form fields”。

**当前状态**：后端/Channel 已测试，缺真实 UI 验收。

---

### 场景组 B：候选方向与选择

#### SC-AU02-B1 — 看到候选方向卡片

**作为作者**，AI 给出几个方向后，我能在工作台看到候选方向卡片。

**触发**：一次 exploration turn 返回 `candidate_directions`。

**期望结果**：
- 每个候选有 title、pitch、tone_tags；
- 卡片展示在 AI 回复附近或明确候选区域；
- 候选数量合理，通常 2-3 个；
- 卡片不被误显示为正式设定或已采纳内容。

**当前证据**：`WorkspaceChat.tsx` 渲染 `msg.turnResult.candidate_directions`；`turn_result_candidates.test.ts` 覆盖字段存在时可渲染。

**当前状态**：部分实现。前端有渲染代码，缺真实 UI walkthrough。

---

#### SC-AU02-B2 — 候选方向只是灵感，不自动采纳

**作为作者**，AI 给出的候选方向不会自动进入作品设定、正文或阅读模式。

**触发**：探索 turn 返回候选方向。

**期望结果**：
- 候选 `adoption_status == not_adopted`；
- `truthfulness.artifact_adopted == false`；
- `truthfulness.production_write_performed == false`；
- 阅读模式 / 作品事实中看不到未采纳候选；
- 前端文案不暗示“已采用”。

**当前证据**：`dialogue_gateway_test.exs` candidate directions marked not_adopted；ledger 记录 GAP-WT-01 后端闭环。

**当前状态**：后端已测试，缺 UI/阅读模式反证验收。

---

#### SC-AU02-B3 — 候选缺失或格式坏时 fallback

**作为作者**，即使 LLM 没按格式给候选，系统仍能给出可用方向，不让探索断掉。

**触发**：LLM 返回 exploration 但 `candidate_directions` 为空、缺失或格式错误。

**期望结果**：
- 系统生成 fallback candidates；
- 每个 fallback candidate 有非空 title 和 pitch；
- adoption_status 仍为 `not_adopted`；
- 前端能正常渲染这些候选。

**当前证据**：`dialogue_gateway_test.exs` 覆盖 casual reply 归一化、missing candidates fallback、malformed candidates fallback。

**当前状态**：后端已测试，缺真实 UI 验收。

---

#### SC-AU02-B4 — 点选候选方向继续探索

**作为作者**，我看到“赛博公司垄断流”这个候选后，点击它，AI 应沿这个方向继续展开。

**触发**：点击候选卡片上的“继续聊这个方向”或卡片本身。

**期望结果**：
- 前端发送结构化 action 或带 candidate_ref 的 follow-up message；
- 后端知道用户选择的是哪个 candidate；
- 本轮 selection 不等于 adoption；
- AI 继续自然探索，不写入作品事实；
- trace 记录 candidate selection 来源。

**当前证据**：`artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` 与 `artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json` 均证明真实工作台候选卡可点击继续探索，并发送带 `candidate_selection` 的 user_message。

**当前状态**：已闭环。

---

#### SC-AU02-B5 — 明确采纳候选方向

**作为作者**，如果我明确说“就采用这个方向作为主线”，系统应通过采纳边界处理，而不是静默写入。

**触发**：点击候选卡“采纳为方向”或发送明确采纳指令。

**期望结果**：
- 系统校验 candidate_id / candidate_set_ref 是否来自当前 TurnResult；
- selection 经 `AdoptionBoundary`；
- 低风险候选可进入已采纳方向或 tentative artifact；
- 高风险候选要求确认；
- trace 记录采纳来源；
- 阅读模式/作品事实只展示已采纳结果，不展示未采纳候选。

**当前证据**：`artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json` 证明真实工作台点击“采用这个方向”后发送服务端授权 `author_action.choose_candidate`，`AdoptionBoundary` 返回 `adopt_tentative`，UI 显示采纳结果且 `production_write_performed=false`。

**当前状态**：最小闭环已完成。该场景和 AU-05 有交叉，AU-02 负责“候选方向的用户入口”，AU-05 后续继续负责高风险、stale/conflict/cross-work 采纳安全，以及真正进入作品事实/投影的完整链路。

---

### 场景组 C：持续探索与自由输入

#### SC-AU02-C1 — 追问一个方向后继续自然展开

**作为作者**，我对某个方向感兴趣，追问“公司垄断灵气这个方向能再展开一下吗？”，AI 继续围绕它讨论。

**触发**：在看到候选后发送追问。

**期望结果**：
- 后续回复引用前一轮候选或上下文；
- 每轮仍有独立 turn/frame/trace；
- 不打开 durable behavior；
- 不强迫我点击 action。

**当前证据**：`dialogue_gateway_test.exs` 只覆盖多输入每轮有 frame；缺基于 candidate 的多轮上下文验证。

**当前状态**：未完整验收。

---

#### SC-AU02-C2 — 探索阶段始终可自由输入

**作为作者**，即使系统给了候选卡，我仍然可以直接输入自己的想法，不被按钮或 action 卡住。

**触发**：候选卡出现后继续打字。

**期望结果**：
- 输入框保持可用；
- `available_actions` 为空或不会禁用输入；
- 候选卡不是强制选择；
- 不选择候选也能继续对话。

**当前证据**：`creative_exploration_loop_test.exs` 断言 `available_actions` 为空；前端输入框是否受影响缺 walkthrough。

**当前状态**：后端已测试，缺真实 UI 验收。

---

#### SC-AU02-C3 — 探索阶段不误触发执行计划

**作为作者**，我只是探索方向，系统不该因为前端默认参数就生成 MicroPlan、工具调用或确认卡。

**触发**：在真实工作台发送模糊探索消息。

**期望结果**：
- 普通探索默认 `generate_micro_plan: false` 或由 intent 明确控制；
- 后端不生成 MicroPlan；
- 不出现工具/确认/采纳卡；
- truthfulness 仍显示未调用工具、未写入。

**当前证据**：后端支持 reply-only/exploration；但真实入口 `WorkspaceChat -> socket.ts sendMessage` 默认 `generate_micro_plan: true`。

**当前状态**：存在真实入口偏差风险。

---

### 场景组 D：真实 LLM 与契约一致性

#### SC-AU02-D1 — 本地 LM Studio 产生质量可用的中文探索

**作为作者**，使用本地 LM Studio 时，我希望看到中文、可理解、有小说创作价值的方向。

**触发**：LM Studio 正常运行，发送模糊创意。

**期望结果**：
- 回复是中文自然语言；
- 若产生候选，候选有标题、简介、风格标签；
- 不输出 JSON 代码块；
- 候选语义与输入相关。

**当前证据**：`planner_real_llm_test.exs` 覆盖 creative exploration real LLM；ledger 记录 LM Studio real_llm 13 tests / 0 failures。

**当前状态**：real LLM 局部测试存在，缺人工体验验收。

---

#### SC-AU02-D2 — 前后端候选契约一致

**作为工程验收者**，候选字段和状态在后端、TS 类型、前端渲染之间必须一致。

**触发**：后端返回 `candidate_directions`。

**期望结果**：
- 字段名为 `direction_id/title/pitch/tone_tags/adoption_status`；
- `adoption_status` 默认 `not_adopted`；
- 前端卡片按这些字段渲染；
- 测试样例不能使用与业务语义冲突的状态。

**当前证据**：后端构造 `adoption_status: :not_adopted`；`turn_result_candidates.test.ts` 有字段契约测试，但样例写 `adoption_status: "tentative"`。

**当前状态**：部分实现，存在测试样例语义偏差。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否完整前后端闭环 |
|---|---|---|---|
| SC-AU02-A1 | 模糊想法得到自然探索回应 | 后端已测试 | 否 |
| SC-AU02-A2 | 不弹机械表单 | 后端/Channel 已测试 | 否 |
| SC-AU02-B1 | 看到候选方向卡片 | Tauri 已验收 | 是 |
| SC-AU02-B2 | 候选方向只是灵感，不自动采纳 | Tauri 已验收 | 是 |
| SC-AU02-B3 | 候选缺失或格式坏时 fallback | 后端已测试 | 否 |
| SC-AU02-B4 | 点选候选方向继续探索 | Tauri 已验收 | 是 |
| SC-AU02-B5 | 明确采纳候选方向 | Tauri 最小闭环已验收 | 是 |
| SC-AU02-C1 | 追问一个方向后继续自然展开 | 未完整验收 | 否 |
| SC-AU02-C2 | 探索阶段始终可自由输入 | 后端已测试 | 否 |
| SC-AU02-C3 | 探索阶段不误触发执行计划 | 存在真实入口偏差风险 | 否 |
| SC-AU02-D1 | 本地 LM Studio 产生质量可用中文探索 | real LLM 局部测试 | 否 |
| SC-AU02-D2 | 前后端候选契约一致 | 部分实现 | 否 |

**覆盖结论：12 个用户场景；4/12 已有真实 Tauri 前后端验收；6/12 有后端/前端局部证据；剩余缺口集中在多轮追问、异常恢复、真实 LMStudio 质量复验和未采纳候选不进入阅读/事实的反证。**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| AU02-GAP-01 — 候选卡缺点选继续探索 | 已闭环：真实工作台可点击“继续聊这个方向”，发送 `candidate_selection` 且不采纳 | 证据：`artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` |
| AU02-GAP-02 — 候选采纳入口未接 adoption boundary | 已闭环：真实工作台点击“采用这个方向”后发送授权 `choose_candidate` action 并进入 `AdoptionBoundary` | 证据：`artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json`；后续转 AU05 safety/freshness |
| AU02-GAP-03 — 真实入口默认 `generate_micro_plan: true` | 探索可能误入执行计划，破坏“不强制 action”体验 | P0：与 AU-01 同源修正，普通聊天/探索默认不生成计划 |
| AU02-GAP-04 — 缺真实 UI walkthrough | 后端能产候选不等于作者能看到、理解、继续操作 | P1：补“输入模糊创意 -> 看到候选 -> 点选继续聊”的 UI 验收 |
| AU02-GAP-05 — 多轮追问缺验收 | 无法证明探索能持续，而不是一次性候选展示 | P1：补 candidate follow-up 多轮测试 |
| AU02-GAP-06 — 候选状态契约测试样例偏差 | 前端测试用 `"tentative"` 可能误导候选默认状态 | P1：改为 `not_adopted`，并补 UI 文案不暗示已采纳 |
| AU02-GAP-07 — 未采纳候选不进入阅读/事实缺反证 | 只证明后端状态，不证明 UI/投影没有误收录 | P1：与 AU-05/AU-08 联动补反证 |

---

## 7. 已有证据与限制

| 证据 | 证明了什么 | 不能证明什么 |
|---|---|---|
| `dialogue_gateway_test.exs` | exploration、candidate fallback、not_adopted、无表单 | 真实工作台是否可见/可点/可继续 |
| `creative_exploration_loop_test.exs` | partner-like exploration、available_actions 空 | 前端输入框和候选卡交互 |
| `planner_real_llm_test.exs` | LM Studio 下可解析 exploration | 人工体验质量和 UI 渲染 |
| `WorkspaceChat.tsx` | 候选卡渲染代码存在 | 选择/采纳候选的用户操作闭环 |
| `turn_result_candidates.test.ts` | TS 字段形状与渲染门禁 | adoption_status 语义样例目前不准 |
| `AdoptionBoundaryTest` | 候选采纳规则 | AU-02 候选卡是否能进入采纳边界 |

---

## 8. 验收命令

```bash
# 后端探索与候选证据
mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs
mix test apps/novel_application/test/novel_application/creative_exploration_loop_test.exs

# 前端候选字段契约
cd frontend && pnpm test -- turn_result_candidates.test.ts

# 真实 LM Studio 局部证据
mix test --include real_llm apps/novel_application/test/novel_application/planner_real_llm_test.exs

# 仍需补：真实 UI walkthrough
# 目标：输入模糊创意 -> 看到候选卡 -> 点选一个候选继续探索 -> 明确采纳时进入 adoption boundary
```

> 注意：AU-02 的完整验收不能停在“后端产生 candidate_directions”。必须证明作者在真实工作台能看到候选、操作候选，并且 selection / adoption 边界清楚。
