# B23-awaiting-author-reason-and-exit-surface：停等作者时「为什么停、怎么继续」必须可见

**状态**：**done（2026-10-23 凌晨收口；CP1–CP5 全落，新真实 Tauri 场景 + 五回归 PASS）**。
**来源**：2026-10-22 作者在 stage 观察到「交互总是停下，页面显示『任务正在等待你的确认。』，却没有任何可确认的动作」；本文件 §0 为只读侦察结论。
**关联既有 slice**：`DS03-awaiting-author-runtime-validity-and-recovery-surface.md`（awaiting_author 命令权限矩阵、writer timeout 恢复出口——B23 在其之上补「理由不丢 + 非写作停等出口」，不改其 live/dead/unknown 矩阵）；`B22-provider-liveness-and-budget-policy.md`（作者可见等待连续性，46 §9.5 第 4 条）；`UA01-agentic-loop-prompt-hardening.md`（判断循环 prompt 资产，B23 不改 prompt）。
**设计真源**：`docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md`（AgentRun 状态机 / awaiting_author 语义）、`docs/design/adr/ADR-0024-decision-surface-registry-v3.md`（S7「run 停了必须有下文」）、`docs/design/adr/ADR-0025-*`（判断循环 plan ≠ execute）、`docs/design/ui/46-state-and-feedback.md` §9、`docs/design/ui/47-ui-copy-guidelines.md`。

## 0. 现状核查（2026-10-22 只读侦察，stage 库 `priv/ai_novel_studio_stage.db` + `log/app/stage/2026-10-22.jsonl`）

### 0.1 现象的真实构成（不是一个 bug，是四个叠加）

| # | 环节 | 事实 | 代码锚点 |
|---|---|---|---|
| F1 | 兜底文案 | 「任务正在等待你的确认。」是 `agentRunAwaitingActivity` 兜底：run 状态为 `awaiting_author` 但事件里找不到作者可见、summary 非空的 `awaiting_author` 事件时才显示 | `frontend/src/lib/copy.ts:398`；`WorkspaceChat.tsx:645-671` |
| F2 | 理由在补水链路丢失 | judgment_plan / judgment_loop 的持久化 TurnResult `turn_id` 是子 turn（`message_xxx:agent:6`），前端 `hydrateAgentRunActivityForTurn` 用它调 activity 接口；后端 `ProviderActivityService.fetch_turn_activity` 用 `AgentRunLog.list_by_parent_turn(parent_turn_ref == turn_id)` 查，而 run 的 `parent_turn_ref` 是不带后缀的父消息 id → 0 run / 0 事件 → 回落 F1。stage 库实证：`run_mvieg940_70k.parent_turn_ref = message_a20dca24-…`，TurnResult `turn_id = message_a20dca24-…:agent:6` | `WorkspaceChat.tsx:1437-1477`；`provider_activity_service.ex:19`；`agent_run_log.ex:113` |
| F3 | transcript 回灌剥事件 | 刷新/重进时 `strip_agent_run_activity` 删掉 `agent_run.events`，只能靠 F2 的补水；F2 失败即无理由 | `work_session_service.ex:376-397` |
| F4 | 停等本身无可点出口 | 进入 `awaiting_author` 的路径里，只有预算缺口 `settle_budget_shortfall` 带 `available_actions`；模型 `await_author`（`judgment_await_author`）、计划耗尽 `plan_exhausted_without_completion`、`no_progress` 三条都是纯事件，前端只渲染一句提示 + 主输入框切 steer。文案却叫「等待你确认」/「1 个任务等待确认」，语义是「确认」，实际是「打字补充」 | `agent_run_server.ex:755-765, 947-959, 1841-1856`；`judgment_plan.ex:250`；`WorkspaceChat.tsx:1060-1067`；`copy.ts:381, 507-516` |
| F5 | 死 run 反复广播 | stage 重启后 3 个非终态 bounded run（含一个 10-20 的 `run_mvh3o46a_4xa`）仍留 `awaiting_author`/`running`，每次 join 被 `list_dead_bounded` 以 `runtime_live:false` 广播；今日日志 `channel.agent_run_expired.done` 259 次。`run_mvieqwza_az`、`run_mvig2u6o_3bm` 卡 `running`（进程随重启消失，持久层未收口） | `agent_run_service.ex:199-225`；`workspace_channel.ex:846-880` |

### 0.2 为什么「总是停下」（stage 实例）

- `run_mviedcoi_5ta`（judgment_loop）：模型选 `await_author`，在回复正文里问作者两个问题（第04章以哪版为准、第01/05章大纲可否重排）后停等。summary 仅「等待作者说明后继续。」
- `run_mvieg940_70k`（judgment_plan）：模型起 14 步**全只读**计划（上下文 / 角色 / 逐章读 / 伏笔 / 记忆），replan 一次后再次耗尽、无产出步，机械判定 `plan_exhausted_without_completion`，summary 为机械句「计划步骤已走完，但目标产出尚未完成，等待作者确认下一步。」——作者看不到「已核清什么 / 建议下一步」。
- 作品本身有多处悬而未决的分歧（第04章双版本正文、已采纳大纲），判断 prompt 倾向「先问再做」，两者叠加几乎每轮触发。

### 0.3 本 slice 不处理、另立或已有归属

- 判断循环 prompt 「先问再做」倾向的调参 → `UA01-agentic-loop-prompt-hardening` / 狗粮观察，不在 B23。
- 全只读计划的规划层约束（起草时要求至少一个产出步或显式「只读轮」收束）→ 候选后续 slice（见 §6 决策日志待拍板项 ①）。
- run 级预算 / checkpoint → `UA01-dynamic-agent-run-budget`。

## 1. 开工检查（七问）

1. **Contract**：消费 UA-01 contract pack 的 AgentRun 状态机（`awaiting_author` = 需作者输入才能继续，非终态）与 ADR-0024 S7「对话流中不允许存在『run 停了但没有下文』的终局」；消费 46 §9（运行组三层 UI、状态行只渲染模型原话或结构骨架词）与 47 文案三层（展示文案改动不触碰动作指令）。**不新增 ADR、不改 schema**：activity 查询键、`agent_run` 摘要字段均为既有线格式；dead run 收口复用既有 `status/phase/failure_ref` 列。若 CP3 需要在停等事件 payload 携带结构化「下一步建议」载体，须回到 ADR-0024 S7 `available_actions` 既有通道，不发明新字段。
2. **Invariant**：
   ① **理由不丢**：任何 `awaiting_author` run，刷新 / 重进 / 换会话回来后，作者能看到停下的真实理由（事件 summary），兜底文案只在后端确实没给 summary 时出现。
   ② **出口与文案一致**：停等态的标签 / 提示 / 徽标描述的动作必须等于页面上真实可做的动作（打字补充 → 说「回复/补充」；有 `available_actions` → 说「选择」）。
   ③ **S7 不退化**：计划耗尽 / no_progress 停等时，作者可见文本必须含结构事实（已完成哪些步、缺什么），不得只有机械句；文本仍只用骨架词或模型原话，零 provider 原始 payload（N-NARR）。
   ④ **死 run 一次性收口**：runtime 已死的非终态 bounded run 不得在每次 join 时重复广播为「等待中」；收口后持久层状态与 UI 一致，且历史记录可查。
   ⑤ DS03 命令权限矩阵（live/dead/unknown）与「awaiting 必须非空补充」门禁零改动。
3. **Boundary**：
   - 改：`novel_application`（`ProviderActivityService` 查询键；`AgentRunServer` / `JudgmentPlan` 的计划耗尽 summary 组装；`AgentRunService` 启动期死 run 收口）、`novel_persistence`（仅在需要新增查询函数时，`AgentRunLog` 加按 run_id / 子 turn 的查询；**零 migration**）、`novel_web`（如 activity 路由需接受 run_id 参数）、`frontend`（`copy.ts` 停等文案族、`WorkspaceChat.tsx` 补水键与停等提示分支）。
   - **明确不改**：判断循环 prompt 资产、`AgentNextStepDecision` 契约、DS03 命令门禁与 `runtime_live` 真源、`available_actions` 载体形状、transcript 回灌的事件剥离策略（保持惰性补水，只修补水命中）。
4. **Consumer**：真实工作台 `WorkspaceChat`（停等活动行、控制坞提示、「N 个任务等待…」徽标、主输入 placeholder）；`external-ui-driver.mjs` 既有场景（`agent-awaiting-author-*`、`agent-dead-bounded-run-expiry`、`b17-writer-timeout-steer`）作为回归消费者。
5. **Proof**：见 §5。CP 级单测 + 既有 Tauri 场景回归 + 新增 1 条真实页面场景（judgment_plan 计划耗尽停等 → 理由可见 → 刷新后仍可见 → 打字补充恢复同一 run）。
6. **Acceptance Driver**：外部 Playwright/Tauri driver 驱动真实工作台；停等由 test/support 的 slice_verify provider 替身用既有 `awaiting_marker` 机制触发（不进生产 runtime）；断言只用页面可见文本 / 网络帧 / app JSONL。**产品代码新增验收感知逻辑：no**。
7. **Exploration**：不适用——不物化 novel element 要素，只改停等态的理由可见性、文案语义、活动查询键与死 run 收口。

## 2. CP 路线（最小实现步只是 checkpoint，不缩小 §1 范围）

| CP | 内容 | 属于哪个闭环 / 距闭环还缺 | 证明 | 状态 |
|---|---|---|---|---|
| **CP1 理由不丢** | activity 补水按 run 命中：前端补水键用 `agent_run.parent_turn_ref ?? turn_id`（线格式已有该字段，`WorkspaceChat.tsx:1492` 已有同样回退先例）；后端 `fetch_turn_activity` 兼容子 turn（按 `parent_turn_ref` 命中不到时回退按 `run_id` 或剥 `:agent:N` 后缀）；决定二者取其一并写入决策日志 | 闭环 ①；CP1 后刷新可见理由，但文案语义（②）与机械句（③）仍在 | `provider_activity_service` 单测（子 turn 命中）、前端补水单测、stage 库样本手工重放 | **done**：前端 `agentRunActivityQueryTurn`（`agentRunAnchoring.ts`）+ 后端 `fetch_turn_activity` 子 turn 兜底；`provider_activity_service_test` 5/5；standalone run 刷新补水（仅只读计划停等不产 TurnResult）另由 CP1 补口覆盖，新场景刷新后理由可见 |
| **CP2 出口与文案一致** | `copy.ts`：`agentRunStatusLabels.awaiting_author`、`taskAgentRunAwaitingLabel`、`agentRunAwaitingActivity`、`agentRunAwaitingInputHint/Placeholder` 改为「等待你的回复/补充」族并明确「在下方输入框回答后发送」；控制坞 awaiting 分支按是否有 `available_actions` 分派提示（有→「请选择」，无→「请回复」）；同步修 driver 中 7 处对「等待你确认」的文本断言与 `agent-dead-bounded-run-expiry.yml` 断言文本 | 闭环 ②；按 47 §2.3 属展示文案层，不触碰 `*.prompt` 动作指令 | 前端组件测试更新；三条既有 awaiting / dead-run Tauri 场景回归 PASS | **done**：`copy.ts` 6 条 + `awaiting_author_requires_input` 改「回复/补充」；控制坞「预算→请选择 / writer timeout→专门 hint / 其余→回复」；driver/verifier/yml 断言同步；真实 Tauri `agent-awaiting-author-input-required`、`agent-awaiting-author-steer-resume`、`b17-writer-timeout-steer` 回归 PASS |
| **CP3 计划耗尽不只给机械句** | `JudgmentPlan.mechanical_await_author_decision`（及 `prose_drafting_with_quality` 同名函数的非 writer-timeout 分支）summary 组装进结构事实：已完成步数 / 步描述摘要、未达成的完成条件、建议下一步（骨架词），零 provider 原文；是否同时附 S7 `available_actions`（如「按已核清结果出方案」）在决策日志拍板后决定，默认不加 | 闭环 ③；与 CP1 合起来才让作者看到「核清了什么」 | `agent_run_judgment_plan_flow_test` 新 case（耗尽 summary 含步数与缺口词、不含 raw payload）；N-NARR 守卫 | **done**：judgment_plan / prose 非 writer_timeout summary = 「计划共 N 步，已完成 M 步；目标产出尚未完成（…）；已核对：模型 plan description 原话（≤3 条）；下一步：骨架建议」，五骨架词字面出现、零 provider raw payload；flow 测试覆盖 |
| **CP4 死 run 一次性收口** | 后端启动（Application / AgentRunService 初始化）扫描非终态 bounded run 且 Registry 无进程者，一次性置 `failed`（`failure_ref = runtime_lost_on_restart`）或等价终态并记 developer 事件；`list_dead_bounded` 保留作同会话兜底但不再每 join 重复命中 | 闭环 ④；需确认 durable run 的 checkpoint 恢复路径不被误伤（只碰 `run_mode == bounded`） | `agent_run_service` 单测（重启模拟）；stage 日志 `agent_run_expired.done` 每 run 至多 1 次；`agent-dead-bounded-run-expiry` 场景语义调整（dead run 改为终态可查而非每次降级广播）并 PASS | **done（实现方案调整为首次 join 惰性收口，见 §6）**：`AgentRunLog.mark_runtime_lost/2` 条件 UPDATE + developer 双通道留痕；第一 join 广播/日志各 1 次、第二 join 零重复、durable 零触碰；真实 Tauri `agent-dead-bounded-run-expiry` PASS（`dead_state_status=failed`、broadcast=1、expired_log=1、`second_join_no_repeat=true`、`failure_ref=runtime_lost_on_restart`） |
| **CP5 真实页面闭环** | 新场景 `agent-plan-exhausted-awaiting-reason`：真实 Tauri 工作台 → 替身诱导 judgment_plan 只读计划耗尽 → 页面可见结构理由（非兜底句）→ 刷新后仍可见 → 主输入提示为「回复/补充」→ 打字补充恢复同一 run_id | 全部 ①–④ 的外部自动化证明 | `scripts/slice_verify.sh agent-plan-exhausted-awaiting-reason` PASS + `artifacts/slice-verify/<id>/`（截图 / ws 帧 / app jsonl）+ I1/I2/I3 | **done**：真实 Tauri `agent-plan-exhausted-awaiting-reason` PASS；summary 含 `awaiting_summary_text` 五骨架词、`after_reload_reason_visible=true`、`final_status=completed`、同一 `run_id` 恢复；证据 `artifacts/slice-verify/agent-plan-exhausted-awaiting-reason-tauri/summary.json` |

**依赖**：CP1 → CP3（理由先能到前端，再丰富理由）；CP2 独立；CP4 独立；CP5 依赖 CP1–CP4。CP4 可因风险单独后置，但后置时本 slice 不得标 done，只能标「④ 未闭环」。

## 3. 涉及范围

- 后端：`apps/novel_application/lib/novel_application/provider_activity_service.ex`、`agent_run_server.ex`、`agent_run_service.ex`、`agent_run_flows/judgment_plan.ex`、`agent_run_flows/prose_drafting_with_quality.ex`；`apps/novel_persistence/lib/novel_persistence/agent_run_log.ex`（查询函数，零 migration）；`apps/novel_web/.../provider_activity_controller.ex`（视 CP1 选项）。
- 前端：`frontend/src/lib/copy.ts`、`frontend/src/components/WorkspaceChat.tsx`、相关 `*.test.tsx`；`frontend/slice-verify/external-ui-driver.mjs`（断言文本与新场景）。
- 质量运行体系：`quality/acceptance/scenarios/agent-plan-exhausted-awaiting-reason.yml`（新）、`agent-dead-bounded-run-expiry.yml`（断言调整）、`quality/acceptance/scenarios/README.md` 登记。

## 4. 任务清单

- [x] CP1 补水命中（前后端二选一拍板后实现）+ 单测：前端 parent_turn_ref 优先 + 后端子 turn 兜底；standalone run 刷新补水补口
- [x] CP2 文案族改写 + 控制坞分派 + driver/yml 断言同步 + 组件测试
- [x] CP3 计划耗尽 summary 结构化 + flow 测试 + N-NARR
- [x] CP4 死 run 收口（首次 join 惰性收口）+ 单测 + 场景语义调整 + 真实 Tauri PASS
- [x] CP5 新场景登记 + driver + 真实 Tauri PASS + artifacts
- [x] 门禁：`mix compile --warnings-as-errors`、`mix test`（1,816/0）、xref 无环、arch_check、前端 typecheck/lint/test（562/0）、frontend_audit 27、check_design_trace 16、`credo --strict` 0、`dialyzer` 0、`ai_static_scan.sh --top 10` 0 blocking、I1/I2/I3/N-NARR/I-CACHE-1
- [x] `tasks/slices/README.md` / `tasks/NEXT.md` 状态回写

## 5. 验证

| 层 | 命令 / 场景 | 证明的不变量 |
|---|---|---|
| 单测 | `mix test apps/novel_application/test/novel_application/provider_activity_service_test.exs`（新/扩）、`agent_run_judgment_plan_flow_test.exs`、`agent_run_service_test.exs` | ①③④ |
| 前端 | `cd frontend && pnpm test -- WorkspaceChat.agentRunControlDock WorkspaceChat.agentRun` | ②、F1 兜底仅在无 summary 时出现 |
| 真实页面回归 | `bash scripts/slice_verify.sh agent-awaiting-author-input-required`、`agent-awaiting-author-steer-resume`、`agent-dead-bounded-run-expiry`、`b17-writer-timeout-steer` | ⑤ 不退化、②④ |
| 真实页面新增 | `bash scripts/slice_verify.sh agent-plan-exhausted-awaiting-reason` | ①②③ 全链 |
| 不变量 | `MIX_ENV=test mix run scripts/scenario_invariants/run_i{3,1,2}_*.exs` | 主链改动必跑 |

## 6. 决策日志

- 2026-10-22 侦察结论：现象是 F1–F5 叠加，不是单点卡片缺失；拆为「理由不丢 / 出口与文案一致 / 耗尽不机械 / 死 run 收口」四个不变量。
- **待拍板 ①**：CP1 修补水命中选前端（用 `parent_turn_ref` 回退，零后端改动）还是后端（activity 接口兼容子 turn / run_id）。倾向前端优先 + 后端兼容兜底，二者都不新增线格式字段。
- **待拍板 ②**：CP3 计划耗尽是否同时附 S7 `available_actions`（例如「按已核清结果先出方案」）。默认只做 summary 结构化，不加动作，避免为 awaiting 路径发明新载体。
- **待拍板 ③**：CP4 死 run 收口的终态取 `failed(runtime_lost_on_restart)` 还是 `cancelled`。倾向 `failed` + `failure_ref`，与 S7 失败终局语义一致。
- **候选后续 slice（不在 B23）**：规划层对「全只读计划」的起草约束（至少一个产出步或显式只读轮收束），根因在 ADR-0025 判断循环，另立。

- 2026-10-22 晚间 **开工登记**：作者定向插单「直接开工 B23」，按 VS-00F 先例对三项待拍板默认拍板：
  - **待拍板 ①→ 前端优先 + 后端兼容兜底**：前端补水键优先 `agent_run.parent_turn_ref ?? turn_id`（`WorkspaceChat` 已有同类回退先例）；后端 `ProviderActivityService.fetch_turn_activity` 在 `list_by_parent_turn` 命中 0 时按剥 `:agent:N` 后缀 / run_id 兜底。二者都不新增线格式字段。
  - **待拍板 ②→ 不新增 `available_actions` 载体**：CP3 只做计划耗尽 summary 结构化（已完成步数 / 缺口 / 建议下一步骨架词，零 provider 原文），动作载体留待既有 S7 通道有真实需求时另立。
  - **待拍板 ③→ 终态 `failed(runtime_lost_on_restart)`**：CP4 只碰 `run_mode == bounded`；durable run 的 checkpoint 恢复路径零改动。
- 2026-10-22 晚间 **范围校准**：CP1/CP2/CP3/CP4 可并行实现；CP5 依赖前四项完成。门禁按 §4 清单执行，I1/I2/I3 必跑。
- 2026-10-22 深夜 **CP4 实现方案调整（Lead 拍板）**：不做启动期 boot sweep，改为**首次 join 惰性收口**——`AgentRunService.list_dead_bounded/2` 首次命中「持久层非终态 + Registry 无进程」时，用 `AgentRunLog.mark_runtime_lost/2` 单条条件 UPDATE 收口为 `failed(runtime_lost_on_restart)`，本次 join 返回收口后 failed 快照（channel 广播/日志各一次），第二次 join 不再命中。理由：boot sweep 会在 UI 收到任何信号前把 run 变终态，导致 join 不再广播、而 transcript 仍是 awaiting 的 UI/状态错位；lazy-first-join 保留一次诚实失效信号，同时保证持久层与日志一致、零重复。developer 留痕双通道：AgentEvent(visibility=developer) + LogEmit `agent_run.runtime_lost.done`。
- 2026-10-22 深夜 **CP1 补口（Lead 拍板 A 方案）**：纯只读计划耗尽停等的 judgment_plan run **不产任何 TurnResult**，刷新后 transcript 无同 run 消息可触发 turn_result 补水，join 又只恢复 `agent_run_state`（events 空）→ 理由回落兜底句。修法选前端 standalone run activity 补水（按 `agent_run.parent_turn_ref` 拉 activity，run 级幂等），不新增后端 rejoin 重播 awaiting 事件语义（避免动 ADR-0024 S7 口径）。
- 2026-10-22 深夜 **CP4 前端配套**：收口后首帧 `agent_run_state.status=failed` 属终态，原 `hasActiveAgentRun` 条件会卸载控制坞、丢掉「原任务已失效 + 重新发起任务」。新增 `agentRunDockRenderMode`：dead bounded run 即使终态也渲染过期坞（composer 仍普通发送、不可 steer），prefill 绑定 dead run。
- 2026-10-22 深夜 **验收观察（非产品 bug，driver 口径修正）**：reload/重进时前端 `reconcilePendingMessages` 会重传未确认的原作者消息（同一 `turn_id`，server `received_user_run` 幂等返回同一 run）；这是交付核对重传，不是第二个作者回合。CP5 driver 按 distinct `turn_id` 计数并显式断言「补充文本未以 user_message 发出」。
- 2026-10-23 凌晨 **回归发现既有验收漂移（非 B23 引入，未在 B23 修）**：`agent-no-progress-stop` 真实 Tauri 复跑失败——driver 期望「prose 单步只读计划 → 空转修订 `plan_revised` → 计划耗尽 awaiting_author（steps=4 / provider_calls=6 / replans=1 / tool_calls=0）」，当前产品实际走 `judgment② continuation`（`d9a943e9` CP3a，2026-07-18）判 continue → 机械追加 prose 产出步 → 正常完成。场景期望文本来自 `09c4894f`（2026-07-17）比 CP3a 早一天，属历史场景未随判断②语义迁移的漂移（D20），与 B23 改动无交集（B23 在该路径只改 summary 文案，实际未走到 `mechanical_await_author_decision`）。处置：登记 NEXT B 轨验收债，B23 不冒充修复、不把该场景计入本批 PASS 集。
- 2026-10-23 凌晨 **收口证据**：新场景 + 四回归真实 Tauri 全 PASS（新场景、agent-awaiting-author-input-required、agent-awaiting-author-steer-resume、agent-dead-bounded-run-expiry、b17-writer-timeout-steer）；`agent-no-progress-stop` 因期望停留在 CP3a 前旧口径（D20，见上一条）**未计入 PASS**，已由 B23-FOLLOWUP（2026-10-23）按判断纪元语义重定义并通过真实 Tauri——追记见 §6 末尾。后端 1,816/0、前端 562/0、credo/dialyzer/format/enum/arch/xref/adr_trace/quality_manifest 全绿；I1/I2/I3/N-NARR/I-CACHE-1 全绿；静态扫描 0 blocking（gitleaks 2 条既有 disposition 保留）。

## 7. 试行反馈

- **耗时结构**：CP1/CP2/CP3/CP4 由三条并行 lane（可见性/后端/验收 harness）推进，CP5 端到端验收由 Lead 串行跑；真实 Tauri 首批失败两类——(a) driver 把交付重传当第二个作者回合（口径修正，非产品缺陷），(b) 初版新场景未覆盖「纯只读停等无 TurnResult」的刷新路径（触发 CP1 补口）。
- **被验收抓到的真实缺口（已修）**：judgment_plan 纯只读计划耗尽停等不产 TurnResult → reload 后无消息触发 activity 补水 → 理由回落兜底句；前端 standalone run events 补水后新场景 reload 断言转绿。
- **文案层波及**：CP2 仅展示文案 + 控制坞 hint/placeholder；driver/verifier 断言同步；未触碰 `*.prompt` 动作指令与采纳/覆盖确认语义。`no_progress` 后端 summary 同步改「回复」语义，driver 首子句仍命中。
- **未在 B23（诚实边界）**：判断循环「先问再做」倾向调参、全只读计划的规划层起草约束、run 级预算/checkpoint 仍归 UA01/后续 slice。

- **2026-10-23 B23-FOLLOWUP 追记：`agent-no-progress-stop` 按判断纪元语义重定义（骑 B24 CP2，真实 Tauri PASS）**。旧期望（D20）停在 `09c4894f`（2026-07-17）判断纪元第一版：prose 单步只读计划 → 空转 `plan_revised` → awaiting_author `agent_loop_awaiting_author`（steps=4/provider=6/replans=1/tool=0）；实际自 CP3a（`d9a943e9`）起走 judgment② continuation → completed（B23 回归 artifact 实测 steps=4/provider=8/replans=1/tool=1，无 summary.json）。只读侦察确认旧 roster 重复诱导路径已死、当时无产品 flow 可真正触发 `no_progress`。B24 CP2 的 explore progress signature 去 sequence 提供了真实路径：同 tool+同 query 重复观察 → 第二次 signature 重复 → runtime 既有 `apply_progress_signature` 判停 `no_progress`。实现（产品零改动）：`slice_verify.ex` 诊断标记分支两轮探索 `archive_read`/`profile`；driver/verifier/manifest/scenarios.yml/tauri echo 按判断纪元语义重写（`stop_reason=no_progress`、两次探索同 tool+同 query+观察字节相同、`consumed_steps=3 / provider_calls=4 / tool_calls=0`、无最终 TurnResult/零写入、作者可见「未取得新进展」）。真实 Tauri PASS，证据 `artifacts/slice-verify/agent-no-progress-stop-tauri/summary.json`。台账修正：§6 上条「五回归」改为「四回归 + 本追记」；NEXT B23 行同步。
