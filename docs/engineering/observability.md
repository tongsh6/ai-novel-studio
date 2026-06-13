# v3 可观测性手册

> 状态：已落地（2026-05-12 / VS-10 Observability Spine）
>
> 角色：面向开发者与走查者的操作手册，覆盖 v3 业务日志的启用方式、回溯流程和常见诊断模式。本文基于 ADR-0018，不冻结 schema（schema 见 ADR-0018）。

---

## 1. 三源总览

v3 的可观测性由三个独立来源组成，三者用 `turn_id` 交叉引用：

| 来源 | 位置 | 格式 | 内容 | 启用方式 |
|------|------|------|------|----------|
| **业务日志** | `log/app/dev/YYYY-MM-DD.jsonl` (dev) 或 `log/app/stage/YYYY-MM-DD.jsonl` (prod) + console | JSONL | 每个业务步骤的 start/done/error、耗时、关联键 | `dev.exs` / `prod.exs` 设置 `log_jsonl_enabled: true`，目录通过 `APP_LOG_DIR` 环境变量覆盖 |
| **LLM 调用日志** | `log/llm-calls/dev/YYYY-MM-DD.jsonl` (dev) 或 `log/llm-calls/stage/YYYY-MM-DD.jsonl` (prod) | JSONL | LLM HTTP 请求/响应完整体、token 用量 | 已有（VS-018），`dev.exs` 设置 `llm_log_dir` |
| **决策 trace** | SQLite `decision_traces` 表 | SQL | 每 turn 的决策事实链（gate order、reason、replay policy） | 已有（VS-06），persistence 层默认写入 |

**测试环境**：业务日志 JSONL 自动关闭 (`log_jsonl_enabled: false`)，LLMLog 不写测试态，决策 trace 由 Sandbox 回滚。

---

## 2. 启用与配置

### 本地开发

`config/dev.exs` 中，业务日志 JSONL 已默认开启：

```elixir
config :novel_common,
  log_jsonl_enabled: true,
  log_jsonl_dir: System.get_env("APP_LOG_DIR", Path.expand("../log/app", __DIR__) |> Path.absname())
```

启动后，每次 `Logger.info(map)` 调用（需包含 `event` 键）自动追加到 `log/app/YYYY-MM-DD.jsonl`。文件按天滚动，不存在时自动创建。

console 端同时打印所有 `Logger.info` 输出（包括带 `event` 的业务日志和不带 `event` 的普通日志），格式由 Phoenix 默认 formatter 控制。

### 禁用 JSONL（如果不需要）

- 注释掉 `config/dev.exs` 中的 `log_jsonl_enabled: true` 行
- 或设置环境变量 `APP_LOG_DIR=""` 后手动删除 backend

### 日志级别

- dev: 默认 `:debug`（所有 `Logger.info` 输出）
- prod: 默认 `:info`（`config :logger, level: :info`）

---

## 3. 回溯工具

### 3.1 按 turn 回溯（最常用）

```bash
bash scripts/grep_turn.sh <turn_id>
```

从 console 里找 `turn_id`：在 Phoenix 输出中搜索 `"event":"dialogue_gateway.handle_input.done"`，它的 `turn_id` 字段就是。

输出分三部分：
1. **业务日志** — 按时间序列展示该 turn 的完整步骤链（planner.form_frame.done → orchestrator.decide.done → toolbox.execute.done → dialogue_gateway.handle_input.done）
2. **LLM 调用日志** — 该 turn 的所有 HTTP 请求/响应
3. **决策 trace** — 从 SQLite `decision_traces` 拉取的决策事实

### 3.2 按 workspace 回溯

```bash
bash scripts/grep_workspace.sh <workspace_id> --tail 50
```

列出该 workspace 最近 50 条业务日志事件，按时间倒序。

### 3.3 高级筛选（手动 jq）

```bash
# 只看 planner 的 error 事件
jq 'select(.event | test("planner.*error"))' log/app/2026-05-12.jsonl

# 看某个 turn 的完整步骤链（按时间排序）
jq -c 'select(.turn_id == "turn_123")' log/app/*.jsonl | sort

# 统计今天各模块的 error 计数
jq -r 'select(.outcome == "error") | .event' log/app/2026-05-12.jsonl | sort | uniq -c | sort -rn
```

---

## 4. 诊断常见模式

### 4.1 LLM 超时

**症状**：用户看到"模型响应较慢"或超时错误
**日志信号**：
```
event: planner.form_frame.error, reason_code: :timeout
event: dialogue_gateway.handle_input.done, duration_ms: 35000
```
**LLMLog 侧**：该 turn 的 LLM 调用记录会有 `"status": 0, "duration_ms": 30000+`，`resp_body: "timeout"`
**建议**：检查 LM Studio 是否过载；考虑换更快模型；或启用 ADR 中的框架超时降级

### 4.2 Frame 验证失败

**症状**：消息发送失败 "frame validation failed"
**日志信号**：
```
event: dialogue_gateway.handle_input.error, reason_code: :frame_validation_failed
```
**说明**：Planner 返回了 JSON 但 `DialogueFrame.validate/1` 拒绝。通常 LLM 输出格式畸变。
**建议**：在 LLMLog 中看该 turn 的 LLM 原始输出 raw content

### 4.3 工具未找到

**症状**：Toolbox 拒绝执行某个工具
**日志信号**：
```
event: toolbox.execute.error, reason_code: "unknown_tool", tool_name: "xxx"
```
**建议**：确认 CapabilityRegistry 已注册该 tool；检查 orchestrator decision 的 target_ref 是否用了能力列表外的名字

### 4.4 持久化静默失败

**症状**：发送成功但消息/对话历史丢失
**日志信号**：
```
event: dialogue_gateway.*.done   ← 显示 turn 正常完成
```
但 SQLite `interactions` 表中无对应记录。此时 trace persistence 可能已在后台静默失败（当前 Logger.warning，本 VS-10 后改为正式 `persistence.trace.error`）

### 4.5 跨 turn 上下文丢失

**症状**：多轮对话 AI 不记得前文
**日志信号**：
```
planner.form_frame.done context_used: false   ← 同 workspace 的前一轮已在 DB 中
context.assemble.done context_refs: 0          ← ContextAssembler 没从 DB 拉到上下文
```
**建议**：检查 persistence 是否在测试模式（Sandbox 回滚）或 DB 路径不对

---

## 5. 日志体积与清理

- 单 turn：约 8-15 行业务日志 + 0-2 行 LLMLog + 1 行 decision trace
- 桌面日量（100 turns）：~1500 行业务日志 ≈ 500KB JSONL
- LLMLog：~200KB/day（含请求体）
- **建议**：每月清理 `log/app/` 和 `log/llm-calls/`，或写入 CI artifact 后清空（桌面应用场景清理不重要）

---

## 6. 相关文档

- `docs/design/adr/ADR-0018-business-log-schema-v3.md` — 日志 schema 规范（事件命名空间、三必填、关联键）
- `apps/novel_common/lib/novel_common/log_context.ex` — metadata 注入协议
- `apps/novel_common/lib/novel_common/log_emit.ex` — emit 宏（编译期 phase 校验）
- `apps/novel_common/lib/novel_common/log_file_backend.ex` — JSONL 文件 backend
- `apps/novel_common/lib/novel_common/llm_log.ex` — LLM HTTP 日志（已有 VS-018）
- `tasks/slices/v3/VS-10-observability-spine.md` — slice 实施计划
