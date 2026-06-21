# E2E-01 端到端全链路验收

> 验证目标：用真实 LLM（LM Studio）+ 真实 SQLite3 persistence 跑通 v3 主链的 13 条关键路径，证明系统在所有核心场景下可端到端运行。

---

## 1. 什么是端到端验收

与 AU 文档的区别：

| | AU 验收场景 | E2E 验收 |
|---|---|---|
| Provider | stub（固定 JSON） | 真实 LM Studio HTTP 调用 |
| Persistence | 无（内存 trace） | 真实 SQLite3 读写 |
| 验证范围 | 单个能力维度 | 跨 5 个 umbrella app 全链路 |
| 运行频率 | 每次 `mix test` | CI 独立 job / 手动触发 |
| Tag | — | `@moduletag :integration` |

---

## 2. 全链路路径

```text
novel_web (Phoenix.ChannelTest)
  → novel_application (DialogueGateway + real LMStudio complete_fn)
    → novel_agent (LMStudio HTTP POST → parse JSON response)
    → novel_domain (DialogueFrame.validate, MicroPlan.check_forbidden, etc.)
    → novel_persistence (SQLite3 Sandbox: trace write + context read)
  → Channel broadcast → assert on turn_result payload
```

切穿全部 5 个 umbrella app。

---

## 3. 验收场景

### E1 — 基础对话（reply-only）

**场景**：作者发送普通聊天消息，系统通过真实 LLM 生成自然语言回应。

```
输入: "你好，聊聊创作"
经过: AuthorInput → DialogueContext(empty) → Planner(LLM) → DialogueFrame → TurnResult → Channel broadcast
```

**验证点**：
- [ ] `frame.frame_type != nil`
- [ ] `trace.decision_type == :reply_only`
- [ ] `turn_result.truthfulness.tool_called == false`
- [ ] `turn_result.assistant_message.text` 是自然中文，不是 JSON 或错误堆栈

---

### E2 — 探索方向（exploration）

**场景**：作者输入模糊创意，真实 LLM 给出自然探索回应和候选方向。

```
输入: "赛博修仙怎么切入？"
经过: AuthorInput → Planner(LLM) → exploration frame → CandidateDirectionSet → TurnResult
```

**验证点**：
- [ ] `frame.frame_type` 可能为 exploration（由真实 LLM 判定）
- [ ] `turn_result.assistant_message.text` 不含"请补充以下信息"等表格式语言
- [ ] 若产生候选方向，`candidate_directions` 非空且 adoption_status 均为 not_adopted

---

### E3 — 上下文感知（context grounding）

**场景**：在 SQLite3 中预先写入 workspace 和 interaction 数据，发送消息后验证 AI 使用了上下文。

```
准备: workspace + current_work_snapshot + interaction 写入 SQLite3
输入: "帮我把主角动机改得更狠一点。"
经过: ContextAssembler (real fetcher → SQLite3) → Planner(LLM) → grounded response
```

**验证点**：
- [ ] 有 context 时 `context.context_refs != []`
- [ ] 无 context 时 `context_refs == []`
- [ ] AI 回应引用了真实上下文中的信息（如主角名）

---

### E4 — 执行降级（downgrade）

**场景**：作者提出超大范围请求，真实 LLM 生成多步 MicroPlan，Orchestrator 降级。

```
输入: "重写第一章+更新角色+整理伏笔"
参数: generate_micro_plan: true
经过: Planner(LLM) → MicroPlan → Orchestrator → downgrade_to_dialogue
```

**验证点**：
- [x] `decision.decision_type == :downgrade_to_dialogue`
- [x] `OrchestratorDecision.blocks_execution?(decision) == true`
- [x] AI 回应解释了为什么不能一次性完成

---

### E5 — 高风险确认（confirmation）

**场景**：作者要求直接替换正文（高风险操作），系统要求确认。

```
输入: "直接替换正文为悬疑风格"
参数: generate_micro_plan: true
经过: Planner(LLM) → MicroPlan (risk=high) → Orchestrator → require_confirmation
```

**验证点**：
- [ ] `decision.decision_type == :require_confirmation`
- [ ] `behavior != nil`
- [ ] `behavior.behavior_type == :confirmation`
- [ ] `available_actions` 包含 `confirm_before_execute`

---

### E6 — 工具调度（tool dispatch）

**场景**：单步低风险 capability invocation，系统通过真实 LLM 调用工具。

```
输入: "查看当前角色列表"（低风险只读操作）
经过: Planner(LLM) → MicroPlan → Orchestrator → allow_tool → Toolbox.execute → ToolResult
```

**验证点**：
- [ ] `decision.decision_type == :allow_tool`
- [ ] `result.status == :succeeded`
- [ ] trace 可被 `TraceRepository.list_by_turn` 查询

---

### E7 — 创作产出（creative artifact）

**场景**：AI 生成角色设定或章节片段，产出默认 tentative。

```
输入: "帮我创建三个反派角色"
经过: Planner(LLM) → concrete creative capability → ToolResult → TentativeArtifactSet
```

**验证点**：
- [ ] `TentativeArtifactSet` 非空
- [ ] `artifact_set.adoption_status == :tentative`
- [ ] 数据库作品正式设定表中未写入

---

### E8 — Action 校验（action validation）

**场景**：对 `ActionValidator` 传入 stale / invented / disabled action。

**验证点**：
- [ ] stale → `{:error, "stale..."}`
- [ ] invented → `{:error, "invented..."}`
- [ ] disabled → `{:error, "disabled..."}`

---

### E9 — 回放审计（replay）

**场景**：从真实 trace 构建 ReplayReport。

```
准备: 任意已完成的 turn 的 DecisionTrace
经过: ReplayService.build_report(trace)
```

**验证点**：
- [ ] `report.provider_called == false`
- [ ] `report.result_status in [:complete, :partial]`
- [ ] `report.chain_summary` 包含 frame → plan → decision → turn_result

---

### E10 — 持久化闭环（persistence）

**场景**：turn 完成后查询 SQLite3，验证 trace 已写入。

```
经过: handle_input → TraceWriter → SQLite3 INSERT
验证: TraceRepository.list_by_turn(turn_id)
```

**验证点**：
- [ ] `TraceRepository.list_by_turn(turn_id) != []`
- [ ] trace 字段完整（turn_id, frame_ref, decision_type, event_order）

---

### E11 — 错误恢复（error recovery）

**场景**：传入会返回垃圾数据的 provider function，验证系统不崩溃。

```
准备: broken_fn = fn _prompt -> {:ok, %{content: "not valid json}}}}"}} end
经过: handle_input(input, nil, broken_fn, nil)
```

**验证点**：
- [ ] `fallback_frame.author_visible_draft.message != ""`
- [ ] `trace.decision_type` 为 `:fail_with_recovery` 或 `:reply_only`

---

### E12 — 真实两轮回路（real loop）

**场景**：同一 workspace 连续两轮，第一轮写入 interaction → 第二轮从 persistence 读取。

```
第1轮: "我叫林烬，是一个剑修。" → interaction_recorder 写入 SQLite3
第2轮: "还记得我叫什么吗？"      → context_fetcher 从 SQLite3 读取
```

**验证点**：
- [ ] 第1轮的 user + assistant interaction 被写入 SQLite3
- [ ] 第2轮的 `DialogueContext.conversation_summary` 包含第1轮内容
- [ ] 第2轮 Planner prompt 包含第1轮 user/assistant 交互
- [ ] 第2轮 AI 回应引用了第1轮的信息（如"林烬"）

---

### E13 — Action 来源校验（action source）

**场景**：验证服务端 source_turn_result 机制——客户端不能伪造授权。

```
准备: 正常产生一个包含 confirm_before_execute action 的 turn_result
第1步: 客户端只提交 source_turn_ref + action_id → action 通过 ✅
第2步: 客户端在 source_turn_result 中伪造一个不存在的 action → action 被拒绝 ❌
```

**验证点**：
- [ ] 合法 action（服务端有对应 available_action）通过
- [ ] 伪造的 `source_turn_result` 不能授权 invented action
- [ ] 错误原因包含 "invented" 或相关提示

---

## 4. 文件级对账状态

> 2026-06-21 复核口径：当前 E2E-01 不再沿用旧的“11/13 完整 + 2/13 部分”文案。按场景化验收红线重算后为 **10/13 已验收、2/13 已测试、1/13 部分实现**。没有外部自动化驱动真实 Tauri 页面证据的场景不标“已验收”。同日已补 `e2e-01-full-chain` 外部聚合 runner；E4 真实页面多步 MicroPlan 降级已由 `e2e-01-downgrade-real-page-tauri-lmstudio` 关闭；E6 只读工具调度与 trace 回查已由 `e2e-01-readonly-tool-trace-tauri-lmstudio` 关闭；E9 完整 ReplayReport 六问已由 `e2e-01-replay-report-tauri-lmstudio` 关闭。

| 场景 | 状态 | 真实页面外部自动化验收证据 | 局部测试证据 | 偏差 / 缺口 | 优先级 / owner |
|------|------|-----------------------------|--------------|-------------|----------------|
| E1 基础对话 | 已验收 | `artifacts/slice-verify/au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio/summary.json`：真实 Tauri 两轮聊天 + LM Studio `form_frame` 两次 2xx | `v3_full_chain_test.exs` reply-only；`planner_real_llm_test.exs` real LLM reply | 无阻塞 | closed |
| E2 探索方向 | 已验收 | `artifacts/slice-verify/au02-natural-exploration-no-slot-form-tauri-lmstudio/summary.json`：自然探索、候选卡、无机械 slot form | `planner_real_llm_test.exs` exploration real LLM；candidate schema/codegen tests | 无阻塞 | closed |
| E3 上下文感知 | 已验收 | `artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json`：最新 Work + active transcript 分层进入真实 provider prompt | `dialogue_gateway_real_loop_test.exs` SQLite conversation/memory prompt loop | 无阻塞 | closed |
| E4 执行降级 | 已验收 | `artifacts/slice-verify/e2e-01-downgrade-real-page-tauri-lmstudio/summary.json`：真实 Tauri 档案面板点击“发起新操作”→ LM Studio 生成 3 action MicroPlan → Orchestrator 在 `action_scope` 降级；无 `toolbox.execute`、无 `author_action`、无执行控件、无 production write；UI badge 显示“降级为对话” | `v3_full_chain_test.exs` multi-step plan → `downgrade_to_dialogue`；`framePresentation.test.ts` 覆盖 downgrade badge | 无阻塞 | closed |
| E5 高风险确认 | 已验收 | `artifacts/slice-verify/au04-confirm-before-execute-tauri-lmstudio/summary.json`：真实 Tauri + LM Studio 高风险确认、re-gate、tentative output | `v3_full_chain_test.exs` confirmation branch；AU04 channel/action tests | 无阻塞 | closed |
| E6 工具调度 | 已验收 | `artifacts/slice-verify/e2e-01-readonly-tool-trace-tauri-lmstudio/summary.json`：真实 Tauri 聊天输入“查看当前角色列表”→ LM Studio frame + MicroPlan → Orchestrator `allow_tool` → `character_roster` 成功；页面显示已确认角色并声明没有写入作品事实；外部查询 `TraceRepository.list_by_turn` 返回结构化 `tool_trace_refs` | `tool_provenance_test.exs` registry/grants/adapter；`dialogue_gateway_real_loop_test.exs` read-only tool trace 持久化回查；`TraceRepository` tests | 无阻塞 | closed |
| E7 创作产出 | 已验收 | `artifacts/slice-verify/p1-chapter-draft-generation-tauri/summary.json` 与 `p1-chapter-adoption-reading-tauri-lmstudio/summary.json`：章节片段生成后默认 pending/tentative，采纳前不进入阅读投影 | `v3_full_chain_test.exs` creative artifact chain；AU05 adoption boundary tests | 无阻塞 | closed |
| E8 Action 校验 | 部分实现 | `au04-stale-confirmation-ui`、`au04-disabled-confirmation-action-ui`、`au06-single-active-confirmation` 证明 stale/disabled/old action 在真实页面不可执行或被拒绝 | `workspace_channel_v3_test.exs` invented/stale/source validation | invented action 是恶意客户端输入，真实用户页面无法自然构造；当前 exact negative 仍在 Channel 层 | P2：Channel security regression 保持 |
| E9 回放审计 | 已验收 | `artifacts/slice-verify/e2e-01-replay-report-tauri-lmstudio/summary.json`：真实 Tauri 聊天输入触发 `character_roster` 只读工具链，外部查询持久 DecisionTrace 并由 `ReplayService.build_report/1` 生成 ReplayReport；summary 证明 `provider_called=false`、`result_status=complete`、缺失引用为空、包含 frame / plan / decision / tool_trace / turn_result，且 VS-06 六问均为 `answered` 或 `not_applicable` | `replay_service_test.exs`；`trace_repository_test.exs`；`dialogue_gateway_real_loop_test.exs` 验证 `plan_ref`、tool trace refs 与 replay 缺失检测 | 无阻塞 | closed |
| E10 持久化闭环 | 已测试 | 无真实页面 trace query UI；why/trace UI 证据归 AU-07 | `dialogue_gateway_real_loop_test.exs` 2026-06-21 新增 `handle_input` + `WorkspaceContext.trace_persister` + `TraceRepository.list_by_turn` 回查；`trace_repository_test.exs` | application/persistence 链路已闭合；外部页面按 turn 查询 trace 仍归 AU-07/E2E replay | P1：外部 trace query UI owner AU-07 |
| E11 错误恢复 | 已验收 | `au01-garbage-json-recovery-tauri`、`au10-workbench-recovery-provider-timeout-tauri`：真实工作台友好降级、loading 清退、可继续输入 | `v3_full_chain_test.exs` broken provider / garbage JSON；`planner_real_llm_test.exs` provider recovery | 无阻塞 | closed |
| E12 真实两轮回路 | 已验收 | `au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio` 证明真实两轮可见；`au03-current-work-context-ssot-tauri-lmstudio` 证明 active transcript 进入真实 provider prompt | `dialogue_gateway_real_loop_test.exs` SQLite 写入第一轮 interaction，第二轮 prompt/summary 读取 | 无阻塞 | closed |
| E13 Action 来源校验 | 已测试 | AU04/AU05/AU06 真实页面证明合法 action 走服务端授权；无真实页面伪造 `source_turn_result` 场景 | `workspace_channel_v3_test.exs` exact：客户端伪造 `source_turn_result` 不能授权 invented action | 伪造来源属于恶意 Channel payload，不是正常 UI 操作；保留为 Channel security regression | P2：Channel security regression 保持 |

### 4.1 本轮复核命令

```bash
bash scripts/tauri_slice_verify.sh --list
mix test --include integration apps/novel_e2e/test/novel_e2e/v3_full_chain_test.exs
mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs apps/novel_application/test/novel_application/replay_service_test.exs apps/novel_persistence/test/novel_persistence/trace_repository_test.exs
mix test --include real_llm apps/novel_application/test/novel_application/planner_real_llm_test.exs
bash scripts/quality_accept.sh e2e-01-full-chain --provider lmstudio
bash scripts/quality_accept.sh e2e-01-downgrade-real-page --surface tauri --provider lmstudio
bash scripts/quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio
bash scripts/quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio
```

2026-06-21 结果：`v3_full_chain_test.exs` 10 tests / 0 failures；`dialogue_gateway_real_loop_test.exs` 8 tests / 0 failures；Channel + ReplayService + TraceRepository 合计 60 tests / 0 failures；`planner_real_llm_test.exs` 13 tests / 0 failures；`quality_accept e2e-01-downgrade-real-page --surface tauri --provider lmstudio` 通过并写入 `artifacts/slice-verify/e2e-01-downgrade-real-page-tauri-lmstudio/summary.json`；`quality_accept e2e-01-readonly-tool-trace --surface tauri --provider lmstudio` 通过并写入 `artifacts/slice-verify/e2e-01-readonly-tool-trace-tauri-lmstudio/summary.json`；`quality_accept e2e-01-replay-report --surface tauri --provider lmstudio` 通过并写入 `artifacts/slice-verify/e2e-01-replay-report-tauri-lmstudio/summary.json`；`quality_accept e2e-01-full-chain --provider lmstudio` 通过并写入 `artifacts/slice-verify/e2e-01-full-chain/summary.json`，其中聚合矩阵为 10/13 已验收、2/13 已测试、1/13 部分实现。

### 4.2 当前缺口分级

- P0：已关闭。旧覆盖表把 stub integration 写成“完整 E2E”的偏差已更正；E10 的 trace persister → SQLite → `TraceRepository.list_by_turn/1` 断点已补 integration proof。
- P1：已关闭。E9 完整 ReplayReport 六问已有独立真实 Tauri / real LM Studio evidence，并被 E2E 聚合 runner 消费。
- P2：E8/E13 的 invented / forged source negative 是恶意客户端 payload，正常真实 UI 不应提供构造入口；继续由 Channel security regression 覆盖，除非后续新增专门的外部协议 fuzz harness。

### 4.3 质量入口状态

当前 `quality_accept.sh` 已支持 `e2e_aggregate` runner，`quality/acceptance/scenarios/e2e-01-full-chain.yml` 已登记为 `nightly` / `browser` / `default_provider: lmstudio`。该 runner 通过 `scripts/e2e_01_full_chain_check.sh --provider lmstudio` 从外部复跑 E2E integration、DialogueGateway real-loop、Channel/Replay/Trace tests、real LM Studio planner tests，并校验现有真实 Tauri summary；输出 `artifacts/slice-verify/e2e-01-full-chain/summary.json`。

注意：该 runner 是文件级证据聚合器，不是产品页面内逻辑，也不为产品新增验收感知 env/query/localStorage、DOM hook 或自动采纳行为。E4、E6 与 E9 已由独立真实 Tauri checkpoint 升级为“已验收”；E8/E13 forged source negative 继续作为 P2 Channel security regression。

---

## 5. 测试配置

```
LM Studio: localhost:1234, 模型 openai/gpt-oss-120b
数据库: SQLite3（Sandbox pool, WAL mode）
Persistence 注入:
  fetcher = NovelPersistence.WorkspaceContext.context_fetcher()
  persister = NovelPersistence.WorkspaceContext.trace_persister()
  recorder = NovelPersistence.WorkspaceContext.interaction_recorder()
  handle_input(input, fetcher, real_complete_fn, persister, recorder)
Tag: @moduletag :integration
排除: ExUnit.start(exclude: [:integration, :real_llm])
```

## 6. 验收命令

```bash
# E2E 集成测试（stub LLM + SQLite3 sandbox）
mix test --include integration apps/novel_e2e/test/novel_e2e/v3_full_chain_test.exs

# 仅 real loop 测试
mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs

# 真实 LLM Planner / Gateway 解析测试（需 LM Studio）
mix test --include real_llm apps/novel_application/test/novel_application/planner_real_llm_test.exs

# Action 来源校验（不依赖 LM Studio）
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
```

## 7. CI 回退策略

CI 中 LM Studio 可能不可用（需 GPU）。回退方案：
- 使用 stub provider 验证 persistence 集成（标注 `provider_called: false`）
- 即使使用 stub，仍保留 real-loop proof：至少一条测试穿过真实 SQLite3 persistence 回调
- stub 只能替代 LLM 内容生成，不能替代 persistence 闭环
