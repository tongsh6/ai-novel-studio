# AU-02 探索创作方向

> 作者视角：我有一个模糊的创作想法但还没想清楚，AI 应该像创作伙伴一样帮我展开思路、给出几个可能方向，并允许我选择某个方向继续探索。候选方向是灵感入口，不应自动写入作品事实；若要采纳为正式方向，必须经过明确的 adoption boundary。
>
> 2026-06-21 对账结论：后端 creative exploration、candidate fallback、malformed candidate 修复已有较强证据；真实 `WorkspaceChat` 已能渲染候选卡，并区分“继续讨论”“自由追问”和“设为后续方向”。`au02-natural-exploration-no-slot-form` 证明模糊创意从真实工作台进入 `creative_exploration`，自然回复和候选卡可见，且没有机械 slot form、MicroPlan、工具/确认/采纳卡或 production write；同一 driver 的 `--real-lmstudio` 变体进一步证明真实 LM Studio 请求成功，用户可见回复是中文自然语言、没有 JSON/代码块形态，候选方向语义贴合“赛博修仙”。`au02-candidate-fallback-ui` 证明上游候选坏格式时 Planner fallback 候选会以真实候选卡渲染，字段非空、`not_adopted`，且无 action/adoption/write；`au02-candidate-continuation` 证明继续讨论发送 `user_message.candidate_selection`，不提交 `author_action`、不触发 adoption、不写作品事实；`au02-candidate-multiturn-context` 证明点击继续讨论后，再发送不带候选引用的普通追问时，会话上下文仍能沿着已选候选方向继续，且无 action/adoption/write；`au02-freeform-followup-after-candidate` 证明候选卡出现后作者不点候选按钮也能直接手输自由追问，发送无 `candidate_selection` 的普通 `user_message`；`au02-candidate-adoption-bridge` 证明明确采纳才提交服务端授权 `author_action.choose_candidate` 并进入 `AdoptionBoundary`；`au02-unadopted-candidate-no-reading-fact` 证明未点击候选动作时阅读模式仍为空 TOC，候选标题/简介不进入阅读内容，且无 action/adoption/projection/write；7 个 AU-02 默认 quality acceptance 入口和 `au02-natural-exploration-no-slot-form --provider lmstudio` 均已复跑通过；`AU02-candidate-schema-codegen` 固化候选方向 schema/codegen，防止 `not_adopted` 再与 artifact adoption 7 态或旧 fixture 混淆。历史旁路工作台已退役删除，不再作为当前证据。
>
> 2026-06-22 二轮复核结论：本文件第一轮 file-level deliverable 不回退。已串行复跑 7 个 AU-02 默认 Tauri quality entry：`au02-natural-exploration-no-slot-form`、`au02-candidate-fallback-ui`、`au02-candidate-continuation`、`au02-candidate-multiturn-context`、`au02-freeform-followup-after-candidate`、`au02-unadopted-candidate-no-reading-fact`、`au02-candidate-adoption-bridge`，并复跑 `bash scripts/quality_accept.sh au02-natural-exploration-no-slot-form --surface tauri --provider lmstudio`。当前 evidence 继续证明模糊创意进入自然探索且无 slot form/MicroPlan/write，坏候选 fallback 可渲染为 `not_adopted` 候选卡，候选继续讨论与自由追问都不等于 adoption，未采纳候选不进入阅读/事实，明确采纳通过服务端授权 action 进入 `AdoptionBoundary`，真实 LM Studio 中文探索质量通过。D2 schema/codegen 回归也已用 `mix codegen.enums --check` 和前端候选契约测试复验。未发现 AU-02 内应关闭的新 P0/P1；高风险/stale/conflict/cross-work 采纳安全矩阵仍归 AU-05，已采纳投影完整矩阵仍归 AU-08。AU-02 满足二轮退出标准，可继续 AU-03。

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
| `WorkspaceChat.tsx` candidate panel | 当前真实入口渲染候选方向；继续讨论走 `user_message.candidate_selection`，自由追问走普通 `user_message`，明确采纳走授权 `author_action.choose_candidate`；未采纳候选不进入阅读模式 | `au02-candidate-continuation` / `au02-candidate-multiturn-context` / `au02-freeform-followup-after-candidate` / `au02-candidate-adoption-bridge` / `au02-unadopted-candidate-no-reading-fact` Tauri 证据 |
| `turn_result_candidates.test.ts` | 前端候选字段契约测试 | 样例已使用 `adoption_status: "not_adopted"` |
| `AdoptionBoundary.evaluate/3` | 候选采纳边界 | 已接入 AU-02 候选卡授权采纳闭环；后续需补高风险/stale/conflict/cross-work |
| `frontend/src/lib/socket.ts` `sendMessage` | 当前真实入口发送 user_message | 普通探索默认 `generate_micro_plan=false`；候选继续探索携带 `candidate_selection` 且不请求 MicroPlan；候选卡后自由追问不携带 `candidate_selection` |

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

**当前证据**：`dialogue_gateway_test.exs` fuzzy creative idea / natural exploration tests；`creative_exploration_loop_test.exs` partner-like exploration；`au02-natural-exploration-no-slot-form` 证明真实工作台发送模糊创意后，`planner.form_frame.done frame_type=creative_exploration`，自然 assistant 回复和候选卡可见。

**当前状态**：Tauri 已验收。

---

#### SC-AU02-A2 — 不弹机械表单

**作为作者**，我还没想好方向时，系统不能要求我填必填字段表。

**触发**：发送“我想写小说但没想好”。

**期望结果**：
- TurnResult 不含 `required_slots` / `missing_slots` / `slot_schema` / `slot_form`；
- 不打开 durable clarification；
- 前端不渲染机械表单；
- 输入框保持可用。

**当前证据**：`dialogue_gateway_test.exs` “does not open mechanical slot form”；`workspace_channel_v3_test.exs` “does not contain forbidden form fields”；`au02-natural-exploration-no-slot-form` 证明真实工作台 UI 不渲染机械 slot form，TurnResult 无 `required_slots` / `missing_slots` / `slot_schema` / `slot_form`，且没有 durable clarification、MicroPlan、工具/确认/采纳卡或 production write。

**当前状态**：Tauri 已验收。

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

**当前证据**：`WorkspaceChat.tsx` 渲染 `msg.turnResult.candidate_directions`；`turn_result_candidates.test.ts` 覆盖字段存在时可渲染；`au02-candidate-continuation` 和 `au02-candidate-adoption-bridge` 都从真实 Tauri 工作台观察到候选卡。

**当前状态**：Tauri 已验收。

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

**当前证据**：`dialogue_gateway_test.exs` candidate directions marked not_adopted；`au02-candidate-continuation` 证明点击继续讨论后 `candidate_adopted=false`、`production_write_performed=false` 且没有 adoption/action_result；`au02-unadopted-candidate-no-reading-fact` 证明未点击候选动作时阅读模式读取空 TOC（0 章 / 0 字），候选标题和简介不出现在阅读内容，且没有 `author_action` / `action_result` / adoption decision / projection / production write；ledger 记录 GAP-WT-01 后端闭环。

**当前状态**：Tauri 已验收。AU-02 范围内的“未采纳候选不进入阅读/事实”反证已闭环；高风险、stale/conflict/cross-work 与 adopted projection 的完整矩阵归 AU-05/AU-08。

---

#### SC-AU02-B3 — 候选缺失或格式坏时 fallback

**作为作者**，即使 LLM 没按格式给候选，系统仍能给出可用方向，不让探索断掉。

**触发**：LLM 返回 exploration 但 `candidate_directions` 为空、缺失或格式错误。

**期望结果**：
- 系统生成 fallback candidates；
- 每个 fallback candidate 有非空 title 和 pitch；
- adoption_status 仍为 `not_adopted`；
- 前端能正常渲染这些候选。

**当前证据**：`dialogue_gateway_test.exs` 覆盖 casual reply 归一化、missing candidates fallback、malformed candidates fallback；`au02-candidate-fallback-ui` 证明真实工作台发送坏候选 exploration 后，`planner.form_frame.done` 为 `creative_exploration` 且 `candidate_count=3`，TurnResult 候选为 Planner fallback 标题 `矛盾切入` / `人物切入` / `世界规则切入`，字段非空、`adoption_status=not_adopted`，候选卡可见，且没有 MicroPlan、author_action、action_result、tool_result、adoption decision 或 production write。

**当前状态**：Tauri 已验收。

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

**当前证据**：`artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` 证明真实工作台候选卡“继续聊这个方向”发送带 `candidate_selection` 的 `user_message`，`generate_micro_plan=false`，没有 `author_action` / `action_result` / adoption decision / production write。

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

**当前证据**：`artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json` 证明真实工作台点击“设为后续方向”后发送服务端授权 `author_action.choose_candidate`，`AdoptionBoundary` 返回 `adopt_tentative`，UI 显示采纳结果且 `production_write_performed=false`。

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

**当前证据**：`au02-candidate-continuation` 已覆盖“候选卡 -> 点击继续讨论 -> 下一轮自然回复”的一轮真实工作台 checkpoint；`au02-candidate-multiturn-context` 进一步证明三回合真实工作台链路：source candidate title 带 `AU02CTX` nonce，点击继续讨论后再发送不带 nonce 的普通追问，follow-up `context.assemble.done` 同时有 conversation 和 session summary，assistant reply 反映 prior candidate nonce，且无 MicroPlan、author_action、action_result、tool_result、adoption decision 或 production write；`dialogue_gateway_test.exs` 覆盖多输入每轮有 frame。

**当前状态**：Tauri 已验收；真实 LLM 中文质量已由 D1 provider 变体复验。

---

#### SC-AU02-C2 — 探索阶段始终可自由输入

**作为作者**，即使系统给了候选卡，我仍然可以直接输入自己的想法，不被按钮或 action 卡住。

**触发**：候选卡出现后继续打字。

**期望结果**：
- 输入框保持可用；
- `available_actions` 为空或不会禁用输入；
- 候选卡不是强制选择；
- 不选择候选也能继续对话。

**当前证据**：`creative_exploration_loop_test.exs` 断言探索阶段不需要强制 action；`WorkspaceCandidatePanel` 测试证明没有 matching `available_action` 时仍可继续讨论；`au02-freeform-followup-after-candidate` 证明真实工作台候选卡出现后输入框仍可用，作者不点击候选按钮时发送的是无 `candidate_selection` 的普通 `user_message`，没有 `author_action` / `action_result` / adoption / production write。

**当前状态**：Tauri 已验收；真实 LLM 中文探索质量已由 D1 provider 变体复验。

---

#### SC-AU02-C3 — 探索阶段不误触发执行计划

**作为作者**，我只是探索方向，系统不该因为前端默认参数就生成 MicroPlan、工具调用或确认卡。

**触发**：在真实工作台发送模糊探索消息。

**期望结果**：
- 普通探索默认 `generate_micro_plan: false` 或由 intent 明确控制；
- 后端不生成 MicroPlan；
- 不出现工具/确认/采纳卡；
- truthfulness 仍显示未调用工具、未写入。

**当前证据**：`frontend/src/lib/socket.ts` 默认 `generate_micro_plan=false`，`socket.test.ts` 覆盖默认 no-MicroPlan 和 candidate continuation no-MicroPlan；`au02-candidate-continuation` 证明真实候选继续路径发送 `generate_micro_plan=false` 且没有 planner micro plan 事件；`au02-freeform-followup-after-candidate` 证明候选卡后自由追问同样保持 `generate_micro_plan=false` 且没有 MicroPlan / action / adoption 事件。

**当前状态**：入口偏差已修正并有最小 Tauri 证据；D1 已补真实 LM Studio provider 质量复验。

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

**当前证据**：`planner_real_llm_test.exs` 覆盖 creative exploration real LLM；ledger 记录 LM Studio real_llm 13 tests / 0 failures；`artifacts/slice-verify/au02-natural-exploration-no-slot-form-tauri-lmstudio/summary.json` 记录 `provider=lmstudio`、`request_count=1`、`status_codes=[200]`、`candidate_count=3`、`lmstudio_quality_checks_required=true`、`natural_reply_chinese=true`、`natural_reply_no_json_code=true`、`candidates_no_json_code=true`、`candidate_semantically_relevant=true`，且同一真实页面链路没有 slot form、MicroPlan、author_action、action_result、adoption decision 或 production write。

**当前状态**：Tauri 已验收。

---

#### SC-AU02-D2 — 前后端候选契约一致

**作为工程验收者**，候选字段和状态在后端、TS 类型、前端渲染之间必须一致。

**触发**：后端返回 `candidate_directions`。

**期望结果**：
- 字段名为 `direction_id/title/pitch/tone_tags/adoption_status`；
- `adoption_status` 默认 `not_adopted`；
- 前端卡片按这些字段渲染；
- 测试样例不能使用与业务语义冲突的状态。

**当前证据**：后端 `NovelDomain.CandidateDirection` / `TurnResultBuilder.format_candidates/1` 构造 `adoption_status: :not_adopted`；`docs/design/schemas/foundation/candidate_direction.json` 固化 `direction_id/title/pitch/tone_tags/adoption_status`，且 `adoption_status` 只能是 `not_adopted`；`frontend/src/generated/foundation/candidate_direction.ts` 由 `pnpm --dir frontend codegen:schemas` 生成；`WorkspaceChat` 消费 generated `CandidateDirection` 类型；`schemas.test.ts` 拒绝 artifact adoption 状态 `TENTATIVE` 和缺失 `adoption_status`；`turn_result_candidates.test.ts` 要求候选样例通过 `CandidateDirectionSchema`；`WorkspaceChat.availableActions.test.tsx` 区分 continuation 与 adoption 按钮，旧 fixture 已从 `"candidate"` 修为 `"not_adopted"`。

**当前状态**：已测试。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否完整前后端闭环 |
|---|---|---|---|
| SC-AU02-A1 | 模糊想法得到自然探索回应 | Tauri 已验收 | 是 |
| SC-AU02-A2 | 不弹机械表单 | Tauri 已验收 | 是 |
| SC-AU02-B1 | 看到候选方向卡片 | Tauri 已验收 | 是 |
| SC-AU02-B2 | 候选方向只是灵感，不自动采纳 | Tauri 已验收 | 是 |
| SC-AU02-B3 | 候选缺失或格式坏时 fallback | Tauri 已验收 | 是 |
| SC-AU02-B4 | 点选候选方向继续探索 | Tauri 已验收 | 是 |
| SC-AU02-B5 | 明确采纳候选方向 | Tauri 最小闭环已验收 | 是 |
| SC-AU02-C1 | 追问一个方向后继续自然展开 | Tauri 已验收 | 是 |
| SC-AU02-C2 | 探索阶段始终可自由输入 | 最小 Tauri checkpoint 已验收 | 是（候选卡后自由追问） |
| SC-AU02-C3 | 探索阶段不误触发执行计划 | 最小 Tauri checkpoint 已验收 | 是（候选继续路径） |
| SC-AU02-D1 | 本地 LM Studio 产生质量可用中文探索 | Tauri + real LMStudio 已验收 | 是 |
| SC-AU02-D2 | 前后端候选契约一致 | 已测试 | 是（schema/codegen/类型/测试回归） |

**覆盖结论：12 个用户场景；11/12 已有真实 Tauri 前后端验收，其中 A1/A2 由 `au02-natural-exploration-no-slot-form` 补齐，D1 由同一 driver 的 `--real-lmstudio` provider 变体补齐，B2 的未采纳阅读/事实反证由 `au02-unadopted-candidate-no-reading-fact` 补齐，B3 的坏候选 fallback UI 反证由 `au02-candidate-fallback-ui` 补齐，C1 的多轮候选上下文由 `au02-candidate-multiturn-context` 补齐；D2 是 schema/codegen/类型契约回归，已测试。`tasks/slices/AU02-file-level-closure.md` 已补文件级对账和收口记录。AU-02 当前无 P0/P1 剩余缺口，可进入 AU-03。**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| AU02-GAP-01 — 候选卡缺点选继续探索 | 已闭环：真实工作台可点击“继续聊这个方向”，发送 `candidate_selection` 且不采纳 | 证据：`artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` |
| AU02-GAP-02 — 候选采纳入口未接 adoption boundary | 已闭环：真实工作台点击“采用这个方向”后发送授权 `choose_candidate` action 并进入 `AdoptionBoundary` | 证据：`artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json`；后续转 AU05 safety/freshness |
| AU02-GAP-03 — 真实入口默认 `generate_micro_plan: true` | 已修正：普通探索默认 no-MicroPlan，候选继续路径也不请求 MicroPlan | 证据：`socket.test.ts`、`artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` |
| AU02-GAP-04 — 缺真实 UI walkthrough | 已闭环：真实工作台可见自然探索回复和候选卡、无机械表单、可点击继续讨论、可直接手输自由追问、可点击明确采纳 | 证据：`au02-natural-exploration-no-slot-form`、`au02-candidate-continuation`、`au02-freeform-followup-after-candidate`、`au02-candidate-adoption-bridge` |
| AU02-GAP-05 — 多轮追问缺验收 | 已闭环：真实工作台从候选 source turn 点击继续讨论，再发送普通后续追问，context 仍带 session conversation，assistant reply 反映 prior candidate context，且无 action/adoption/write | 证据：`artifacts/slice-verify/au02-candidate-multiturn-context-tauri/summary.json`；真实 LMStudio 中文质量仍归 D1 |
| AU02-GAP-06 — 候选状态契约测试样例偏差 | 已修正：前端候选契约样例为 `not_adopted`，继续/采纳按钮语义分离 | 证据：`turn_result_candidates.test.ts`、`WorkspaceChat.availableActions.test.tsx` |
| AU02-GAP-07 — 未采纳候选不进入阅读/事实缺反证 | 已闭环：真实工作台生成候选后不点击候选动作，打开阅读模式读取空 TOC，候选标题/简介不可见，且无 action/adoption/projection/write | 证据：`artifacts/slice-verify/au02-unadopted-candidate-no-reading-fact-tauri/summary.json`；AU-05/AU-08 后续继续覆盖已采纳投影和高风险/stale/conflict/cross-work |
| AU02-GAP-08 — candidate fallback UI 反证 | 已闭环：真实工作台触发 malformed provider candidate payload 后，Planner fallback 候选以候选卡渲染，字段非空、`not_adopted`、无 action/adoption/write | 证据：`artifacts/slice-verify/au02-candidate-fallback-ui-tauri/summary.json` |
| AU02-GAP-09 — 真实 LM Studio 中文质量复验 | 已闭环：同一真实工作台自然探索 driver 在 `--real-lmstudio` provider 模式下验证中文自然回复、无 JSON/代码块形态、候选语义相关，且不触发执行/采纳/写入 | 证据：`artifacts/slice-verify/au02-natural-exploration-no-slot-form-tauri-lmstudio/summary.json` |
| AU02-GAP-10 — D2 schema/codegen 统一回归 | 已闭环：候选方向独立 schema/codegen，前端类型和测试消费 generated schema，旧 `"candidate"` fixture 被 typecheck 阻断并修正 | 证据：`docs/design/schemas/foundation/candidate_direction.json`、`frontend/src/generated/foundation/candidate_direction.ts`、`schemas.test.ts`、`turn_result_candidates.test.ts`、`WorkspaceChat.availableActions.test.tsx` |

---

## 7. 已有证据与限制

| 证据 | 证明了什么 | 不能证明什么 |
|---|---|---|
| `dialogue_gateway_test.exs` | exploration、candidate fallback、not_adopted、无表单 | 真实工作台是否可见/可点/可继续 |
| `au02-candidate-fallback-ui` | 真实工作台遇到坏候选 payload 时渲染 Planner fallback 候选卡，字段非空、`not_adopted`、无 action/adoption/write | 真实 LLM 中文体验 |
| `creative_exploration_loop_test.exs` | partner-like exploration、available_actions 空 | 前端输入框和候选卡交互 |
| `planner_real_llm_test.exs` | LM Studio 下可解析 exploration | 真实页面 UI 渲染和作者可见质量 |
| `WorkspaceChat.tsx` | 候选卡渲染、继续讨论、授权采纳入口存在 | 多轮质量和异常恢复 |
| `turn_result_candidates.test.ts` | TS 字段形状、`not_adopted` 状态与渲染门禁 | 真实工作台用户操作 |
| `AdoptionBoundaryTest` | 候选采纳规则 | AU-02 候选卡是否能进入采纳边界 |
| `au02-candidate-continuation` | 真实工作台候选继续讨论不进入采纳边界 | 多轮质量 |
| `au02-candidate-multiturn-context` | 真实工作台候选继续讨论后的普通后续追问会消费 prior candidate context，且不进入 action/adoption/write | 真实 LLM 中文体验 |
| `au02-freeform-followup-after-candidate` | 真实工作台候选卡后自由手输追问不携带 `candidate_selection`，不进入采纳边界 | 真实 LLM 中文体验 |
| `au02-natural-exploration-no-slot-form --real-lmstudio` | 真实 LM Studio provider 请求成功，用户可见回复为中文自然语言，候选方向无 JSON/代码块形态且语义贴合输入，仍无 slot form / MicroPlan / action / adoption / write | D2 schema/codegen 统一回归 |
| `AU02-candidate-schema-codegen` | CandidateDirection schema/codegen、前端类型消费和契约测试闭环，防止候选方向状态混用 artifact adoption enum | 真实页面交互；由 AU-02 Tauri drivers 覆盖 |
| `au02-unadopted-candidate-no-reading-fact` | 真实工作台生成候选后不点击候选动作，阅读模式保持空 TOC，候选标题/简介不进入阅读内容，且无 action/adoption/projection/write | 真实 LLM 中文体验、AU-05/AU-08 已采纳投影完整矩阵 |
| `au02-candidate-adoption-bridge` | 真实工作台明确采纳进入授权 action / adoption boundary | 高风险、stale、conflict、cross-work 完整矩阵 |

---

## 8. 验收命令

```bash
# 后端探索与候选证据
mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs
mix test apps/novel_application/test/novel_application/creative_exploration_loop_test.exs

# 前端候选字段契约
cd frontend && pnpm test -- turn_result_candidates.test.ts
cd frontend && pnpm test -- socket WorkspaceChat.availableActions native-tauri-verifier

# 真实 Tauri 外部验收
bash scripts/tauri_slice_verify.sh au02-natural-exploration-no-slot-form
bash scripts/tauri_slice_verify.sh au02-candidate-fallback-ui
bash scripts/tauri_slice_verify.sh au02-candidate-continuation
bash scripts/tauri_slice_verify.sh au02-candidate-multiturn-context
bash scripts/tauri_slice_verify.sh au02-freeform-followup-after-candidate
bash scripts/tauri_slice_verify.sh au02-unadopted-candidate-no-reading-fact
bash scripts/tauri_slice_verify.sh au02-candidate-adoption-bridge
bash scripts/tauri_slice_verify.sh --real-lmstudio au02-natural-exploration-no-slot-form

# 质量入口（沙箱外或 CI 中执行；本地受 Mix.PubSub 权限影响时以 tauri_slice_verify 证据为准）
bash scripts/quality_accept.sh au02-natural-exploration-no-slot-form --surface tauri
bash scripts/quality_accept.sh au02-candidate-fallback-ui --surface tauri
bash scripts/quality_accept.sh au02-candidate-continuation --surface tauri
bash scripts/quality_accept.sh au02-candidate-multiturn-context --surface tauri
bash scripts/quality_accept.sh au02-freeform-followup-after-candidate --surface tauri
bash scripts/quality_accept.sh au02-unadopted-candidate-no-reading-fact --surface tauri
bash scripts/quality_accept.sh au02-candidate-adoption-bridge --surface tauri
bash scripts/quality_accept.sh au02-natural-exploration-no-slot-form --surface tauri --provider lmstudio

# 真实 LM Studio 局部证据
mix test --include real_llm apps/novel_application/test/novel_application/planner_real_llm_test.exs

# schema/codegen 契约回归
pnpm --dir frontend codegen:schemas
pnpm --dir frontend typecheck
pnpm --dir frontend exec vitest run src/lib/__tests__/schemas.test.ts src/lib/__tests__/turn_result_candidates.test.ts
pnpm --dir frontend exec vitest run src/components/WorkspaceChat.availableActions.test.tsx src/lib/__tests__/schemas.test.ts src/lib/__tests__/turn_result_candidates.test.ts
mix codegen.enums --check
```

> 注意：AU-02 的完整验收不能停在“后端产生 candidate_directions”。必须证明作者在真实工作台能看到候选、操作候选，并且 selection / adoption 边界清楚。
