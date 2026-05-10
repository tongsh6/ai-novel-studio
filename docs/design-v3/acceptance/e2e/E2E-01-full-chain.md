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
- [ ] `decision.decision_type == :downgrade_to_dialogue`
- [ ] `OrchestratorDecision.blocks_execution?(decision) == true`
- [ ] AI 回应解释了为什么不能一次性完成

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
经过: Planner(LLM) → creative_generation → ToolResult → TentativeArtifactSet
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

## 4. 覆盖状态

| 场景 | 内容 | 测试文件 | 状态 |
|------|------|---------|------|
| E1 | 基础对话 | `v3_full_chain_test.exs` | ❌ 待建 |
| E2 | 探索方向 | 同上 | ❌ 待建 |
| E3 | 上下文感知 | 同上 | ❌ 待建 |
| E4 | 执行降级 | 同上 | ❌ 待建 |
| E5 | 高风险确认 | 同上 | ❌ 待建 |
| E6 | 工具调度 | 同上 | ❌ 待建 |
| E7 | 创作产出 | 同上 | ❌ 待建 |
| E8 | Action 校验 | 同上 | ❌ 待建 |
| E9 | 回放审计 | 同上 | ❌ 待建 |
| E10 | 持久化闭环 | 同上 | ❌ 待建 |
| E11 | 错误恢复 | 同上 | ❌ 待建 |
| E12 | 真实两轮回路 | `dialogue_gateway_real_loop_test.exs` | ⚠️ 已写，tag 为 :integration |
| E13 | Action 来源校验 | `workspace_channel_v3_test.exs` | ✅ Channel 层已测试 |

**通过率：1/13 完整 + 1/13 部分 = 约 12%**。E2E 集成测试是下一阶段的主要建设工作。

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
# E2E 集成测试（需 LM Studio 运行中 + SQLite3）
mix test --include integration apps/novel_web/test/integration/v3_full_chain_test.exs

# 仅 real loop 测试
mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs

# Action 来源校验（不依赖 LM Studio）
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
```

## 7. CI 回退策略

CI 中 LM Studio 可能不可用（需 GPU）。回退方案：
- 使用 stub provider 验证 persistence 集成（标注 `provider_called: false`）
- 即使使用 stub，仍保留 real-loop proof：至少一条测试穿过真实 SQLite3 persistence 回调
- stub 只能替代 LLM 内容生成，不能替代 persistence 闭环
