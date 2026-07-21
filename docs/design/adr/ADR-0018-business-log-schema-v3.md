# ADR-0018：业务日志 Schema v3

- 状态：Accepted
- 日期：2026-05-11
- 来源文档：
  - `../06-memory-context-and-trace.md`（trace 与 audit 分层）
  - `../00d-runtime-architecture.md`（运行时控制面 / 横切层）
  - `../../engineering/quality-gates.md`（工程门禁层）
  - 已有实现：`apps/novel_common/lib/novel_common/llm_log.ex`、`apps/novel_persistence/lib/novel_persistence/trace_repository.ex`
- 影响范围：Logger / Observability / Audit / Slice
- 相关不变量：`00c` §7 #1、#5、#9、#13（不变量本身不依赖日志，但日志是它们出问题时的回溯通道）
- 首个证明 slice：VS-10 Observability Spine
- 取代：无
- 取代者：无

---

## 背景

v3 已有两条结构化事实链：
- `NovelCommon.LLMLog` — Provider HTTP 调用 JSONL（VS-018 引入），按天滚动到 `log/llm-calls/YYYY-MM-DD.jsonl`。
- `DecisionTrace` + `TraceRepository` — 业务决策事实链，写入 SQLite3 `decision_traces` 表，可被 `ReplayService` 重建为 `ReplayReport`。

但 **业务步骤层**（Planner.form_frame、ContextAssembler、Orchestrator、Toolbox.execute、AdoptionBoundary、BehaviorState、ReplayService 自身、TaskRunner、Channel handler）当前只有 ~20 处零散 `Logger.warning`，无结构化字段、无关联键、无统一命名空间。

出现问题时回溯需要跨 Phoenix 控制台日志 + `log/llm-calls/*.jsonl` + SQLite `decision_traces` 三源 grep，没有共同的 `turn_id / workspace_id` 关联键。

LLMLog 与 DecisionTrace 不能替代业务日志：
- LLMLog 只覆盖 HTTP 层，看不到"为什么没有调 LLM"。
- DecisionTrace 是审计事实链，命中失败、HTTP 重试、persistence 写失败等"过程信号"不在其语义里。

## 决策范围

本 ADR 冻结业务日志的最小 schema、命名规则、输出后端，使三源（业务日志 / LLM 日志 / 决策 trace）能基于共同的 `turn_id` 串成完整回溯。

### 1. 关联键协议

每条业务日志**必须**包含的关联键（缺失即视为 schema 违规）：

| 键 | 来源 | 用途 |
|---|---|---|
| `event` | 模块定义 | 点状命名（见 §3）|
| `outcome` | 模块定义 | `ok` \| `error` \| `skipped` \| `degraded` |
| `duration_ms` | 模块测量 | 步骤耗时（无意义时填 `0`）|
| `timestamp` | Logger 自动 | ISO-8601 UTC |

**应当**包含的关联键（取决于上下文，缺失允许）：

| 键 | 来源 |
|---|---|
| `workspace_id` | Logger.metadata（入口写入）|
| `work_id` | Logger.metadata |
| `turn_id` | Logger.metadata |
| `frame_id` | Logger.metadata（form_frame 之后）|
| `behavior_id` | Logger.metadata（behavior 打开后）|
| `decision_id` | Logger.metadata（orchestrator decision 之后）|
| `tool_request_id` | Logger.metadata（dispatch 之后）|

**可选**字段：`reason_code`、`outcome_detail`、`subject_ref`、`count`、自定义业务字段。

### 2. metadata 透传协议

- `NovelCommon.LogContext.put_turn(workspace_id, work_id, turn_id)` 在 `DialogueGateway.handle_input` 入口调用；
- 后续每个模块进入前自然继承父进程 metadata；
- 跨 `Task.async_nolink` / `Task.async` 边界时 **必须显式** 把 metadata 透传到子进程（`NovelCommon.LogContext.snapshot/0` + `LogContext.restore/1`）。

进程崩溃时 metadata 自动丢失，无需手动清理。

### 3. 事件命名空间

形式：`<module>.<step>.<phase>`

- `<module>`：`planner` / `context` / `orchestrator` / `toolbox` / `adoption` / `behavior` / `replay` / `task_runner` / `channel` / `provider` / `ledger`（ADR-0026 扩员：`ledger.update.*` / `ledger.reconcile.*`，携带 turn_id/work_id）
- `<step>`：模块内步骤的小写下划线名（如 `form_frame`、`evaluate`、`execute`）
- `<phase>`：`start` / `done` / `error`（仅这三个，不发明新词）

例：
- `planner.form_frame.start`
- `planner.form_frame.done`（带 `frame_id` / `frame_type`）
- `planner.form_frame.error`（带 `reason_code`）
- `toolbox.execute.done`（带 `tool_request_id` / `tool_name` / `tool_outcome`）
- `adoption.evaluate.skipped`（带 `reason_code`）

**禁止**：自由文案字符串拼接（`"[Planner] something happened"` 这种）。

### 4. 输出后端

- **console**（默认）：开发态 + 测试态可读，包含 metadata 但不强制 JSON。
- **JSONL 文件 backend**：生产 / 桌面运行态启用，按天滚动到 `log/app/YYYY-MM-DD.jsonl`，与 `log/llm-calls/` 并列。每行格式：
  ```json
  {"timestamp":"2026-05-11T15:30:00.123Z","level":"info","event":"planner.form_frame.done","workspace_id":"ws-1","turn_id":"turn_1","frame_id":"frame_1","duration_ms":482,"outcome":"ok"}
  ```
- 文件 backend 由 `runtime.exs` 控制，测试态关闭以保持快速。

### 5. 与 LLMLog / DecisionTrace 的关系

| 层 | 写谁 | 包含什么 | 不包含什么 |
|---|---|---|---|
| 业务日志（本 ADR）| `log/app/*.jsonl` + console | 业务步骤的 start/done/error、过程信号、耗时 | LLM 完整请求体 / 持久化决策事实 |
| LLMLog（VS-018）| `log/llm-calls/*.jsonl` | LLM HTTP 请求/响应完整体、token 用量 | 业务步骤 |
| DecisionTrace（VS-06）| SQLite `decision_traces` | 决策事实链（gate order、reason、reasons_passed_through、refs）| 过程信号、retry 中间态 |

**关联键**：三源都使用 `turn_id` 作主关联键；`workspace_id` 作次关联键。LLMLog 当前用 `Process.get(:current_step)` 填 `step`，本 ADR 起改为读 `Logger.metadata[:turn_id]`。

### 6. 性能与噪声约束

- INFO 日志的写入开销在桌面单机场景可忽略。
- 单 turn 业务日志不超过 30 行（约 8 个步骤 × 平均 3-4 phase）。
- 失败路径允许 `error` 级；常规路径不允许 `warning`（warning 留给真正需要关注的异常）。

## 非目标

- 不冻结日志远程聚合方案（ELK / Loki / OpenTelemetry）。
- 不冻结 PII 脱敏（v3 桌面单机用户即作者本人，敏感数据语义不存在；上云时再单独 ADR）。
- 不冻结日志查询 UI；命令行 `jq` + shell 工具即可。
- 不替代 LLMLog 或 DecisionTrace；三者并列。
- 不冻结指标 / metrics（Logger 不解决统计聚合）。
- 不强制采样 / 限流；桌面单机 QPS 极低。

## 考虑过的方案

### A. 只增强 LLMLog，不另做业务日志

驳回：LLMLog 语义是 HTTP 层事实，把 Planner / Orchestrator 步骤塞进去会破坏 LLMLog 的现有用途（"我想看那次 LLM 实际请求体"）。

### B. 把业务过程信号写进 DecisionTrace

驳回：DecisionTrace 是 ADR-0013 冻结的审计事实链，加 retry 中间态、persistence 失败等会污染语义，且会让 ReplayReport 变形。

### C. 直接上 OpenTelemetry

驳回：v3 桌面单机，引入 collector / exporter / 后端是过度建设。本 ADR §4 文件 JSONL 已经够用，将来切云端时升级到 OTLP 是增量动作，本 ADR 不阻塞那个未来。

### D. 不冻结 schema，让各模块自由 `Logger.info`

驳回：原状态。问题是命名混乱（`[Planner]` / `[DialogueGateway]` 风格各异）+ 字段不齐 + 缺关联键，回溯成本不可接受。

## 决策结果

采纳上述协议，由 VS-10 Observability Spine 作为首个证明 slice 落地：

1. `NovelCommon.LogContext`：入口 metadata 注入 + 跨进程 snapshot/restore。
2. 每个业务模块按 §3 命名加 start/done/error。
3. JSONL 文件 backend 按 §4 启用，与 LLMLog 并列。
4. LLMLog 改为读 `Logger.metadata[:turn_id]`，保持向后兼容。
5. `scripts/grep_turn.sh` 跨三源拉同一 turn 的所有事件。

## 后续工作

- VS-10 落地后回写本 ADR 的"首个证明 slice"为 done。
- 远程聚合 / 采样 / PII 上云时另发 ADR。
- 指标聚合（如 P95 latency）若需要，另发 ADR-0019 metrics。
