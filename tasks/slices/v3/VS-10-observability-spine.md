# VS-10 Observability Spine

> 状态：docs-ready（2026-05-11）
>
> 角色：建立 v3 业务日志体系最小骨架。让任何一次 turn 在出现问题（崩溃 / 性能异常 / 行为异常 / 持久化失败 / 上下文缺失）时都能基于共同的 `turn_id` 串成完整回溯链，覆盖业务步骤层（Planner / ContextAssembler / Orchestrator / Toolbox / AdoptionBoundary / BehaviorState / ReplayService / TaskRunner / Channel），与既有 `LLMLog`（HTTP 层）和 `DecisionTrace`（决策事实链）三源并列。

---

## 1. Contract

| Contract | 用途 |
|---|---|
| `docs/design-v3/adr/ADR-0018-business-log-schema-v3.md` | 冻结事件命名空间、关联键、JSONL 输出格式、与 LLMLog/DecisionTrace 的边界 |
| `apps/novel_common/lib/novel_common/log_context.ex`（新增）| Logger.metadata 注入与跨进程 snapshot/restore 协议 |
| `apps/novel_common/lib/novel_common/llm_log.ex` | LLMLog 改为读 `Logger.metadata[:turn_id]`，保持向后兼容 |
| `log/app/YYYY-MM-DD.jsonl` | 业务日志文件后端（生产 / 桌面运行启用，测试态关闭）|
| `scripts/grep_turn.sh` / `scripts/grep_workspace.sh` | 跨三源（app / llm / decision_traces）的关联回溯工具 |

> **冻结点**：本 slice 不重新发明事件名 / 字段；所有命名严格遵循 ADR-0018 §3。

## 2. Invariant

1. **关联键完整性**：经过 `DialogueGateway.handle_input` 的所有日志必含 `workspace_id` + `turn_id`；下游模块加自己的局部键（`frame_id` / `behavior_id` / `decision_id` / `tool_request_id`）。
2. **三必填**：每条业务日志必含 `event` / `outcome` / `duration_ms`（duration 无意义时填 `0`），缺一即视为 schema 违规。
3. **命名空间纪律**：事件名遵循 `<module>.<step>.<phase>`，phase 只能是 `start` / `done` / `error`；不允许自由文案 `Logger.info "[Foo] bar"`。
4. **三源解耦**：业务日志不写 LLM 完整请求体（那归 LLMLog），不写决策事实（那归 DecisionTrace）；只写过程信号。
5. **跨进程透传**：`Task.async` / `Task.async_nolink` 子进程必须显式 `LogContext.snapshot/0` + `restore/1`，否则 metadata 丢失。
6. **测试态零文件输出**：`MIX_ENV=test` 时文件 backend 关闭，避免单元测试污染 `log/app/`。

## 3. Boundary

```text
novel_web (Channel handler)
  └ LogContext.put_turn(ws_id, work_id, turn_id) — 入口注入 metadata
    ↓ Logger.metadata 自动继承
novel_application
  ├ DialogueGateway     →  dialogue_gateway.* 事件
  ├ Planner             →  planner.form_frame.* / planner.build_plan.*
  ├ ContextAssembler    →  context.assemble.*
  ├ ExecutionOrchestrator → orchestrator.decide.*
  ├ Toolbox             →  toolbox.execute.*（含 tool_name）
  ├ AdoptionBoundary    →  adoption.evaluate.*
  ├ BehaviorState/Store →  behavior.transition.*
  ├ TaskRunner          →  task_runner.*.*（已有 Logger.info，本 slice 改造为结构化）
  └ ReplayService       →  replay.build_report.*
novel_agent
  └ Provider.{Anthropic,LMStudio,Gateway}
       → 仍走 LLMLog（HTTP 层），但 LLMLog 改读 turn_id 自 metadata
novel_persistence
  └ TraceWriter / MemoryLog / LongRunTaskLog 的失败路径
       → persistence.<table>.error 事件（成功路径不打日志，由 DecisionTrace 留事实）

不修改：novel_foundation / novel_domain（纯函数 + struct，本就不应有 Logger）
```

**Boundary 守住**：novel_common 不引用其他业务 app；LogContext 是纯包装，只依赖 elixir 标准库 Logger。

## 4. Consumer

- **真实消费者**：
  - 开发者在 Phoenix 控制台 / Tauri devtools 看 console（默认 backend）。
  - 出问题时跑 `scripts/grep_turn.sh <turn_id>` 拿三源合并的时间序回溯。
  - 后续 walkthrough 报告里直接附 `log/app/*.jsonl` 节选作为证据。
- **测试消费者**：
  - `novel_common/test/log_context_test.exs` — 入口注入、跨进程 snapshot/restore、生命周期。
  - `novel_application/test/.../dialogue_gateway_logging_test.exs` — 跑一次完整 turn，断言关键事件全到位、关联键全填好。

## 5. Proof

| 步骤 | 命令 | 预期 |
|------|------|------|
| 1 | `mix test apps/novel_common/test/novel_common/log_context_test.exs` | metadata 注入 / snapshot / restore 全绿 |
| 2 | `mix test apps/novel_application/test/novel_application/dialogue_gateway_logging_test.exs` | 跑一次 turn → 捕获日志 → 断言 `planner.form_frame.done` / `orchestrator.decide.done` / `dialogue_gateway.handle_input.done` 均含 `turn_id` |
| 3 | `mix test` 全量 | 0 failures，无新 warning |
| 4 | `bash scripts/grep_turn.sh <turn_id>` 跑一次 dev 启动后的真实 turn | 输出包含业务日志 + LLMLog + DecisionTrace 三源，按时间排序 |
| 5 | `bash scripts/ai_static_scan.sh --top 10 --quick` | 0 finding |

## 6. 涉及范围

| App / 文件 | 改动类型 | 说明 |
|---|---|---|
| `apps/novel_common/lib/novel_common/log_context.ex` | 新增 | put_turn / put_frame / put_behavior / snapshot / restore |
| `apps/novel_common/lib/novel_common/log_emit.ex` | 新增（可选小包装）| `emit(:planner, :form_frame, :done, %{...})` 编译期校验 phase 枚举 |
| `apps/novel_application/lib/novel_application/dialogue_gateway.ex` | 修改 | 入口写 metadata；start/done/error 三阶段日志；replace 现有 warning |
| `apps/novel_application/lib/novel_application/planner.ex` | 修改 | form_frame / build_plan 加结构化日志 |
| `apps/novel_application/lib/novel_application/context_assembler.ex` | 修改 | assemble 步骤日志 |
| `apps/novel_application/lib/novel_application/execution_orchestrator.ex` | 修改 | decide 日志 |
| `apps/novel_application/lib/novel_application/toolbox.ex` | 修改 | execute 日志（含 tool_name / tool_outcome / unknown_tool）|
| `apps/novel_application/lib/novel_application/adoption_boundary.ex` | 修改 | evaluate 日志 |
| `apps/novel_application/lib/novel_application/task_runner.ex` | 修改 | 现有 `Logger.info` → 结构化 |
| `apps/novel_application/lib/novel_application/replay_service.ex` | 修改 | build_report 日志 |
| `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | 修改 | join / user_message / author_action 入口写 metadata |
| `apps/novel_common/lib/novel_common/llm_log.ex` | 修改 | turn_id 来源从 `Process.get(:current_step)` 改为 `Logger.metadata[:turn_id]`，并加 step 兼容字段 |
| `config/config.exs` / `config/dev.exs` / `config/runtime.exs` / `config/test.exs` | 修改 | Logger backend 配置（test 关文件输出）|
| `apps/novel_common/lib/novel_common/log_file_backend.ex` | 新增 | 简易 JSONL backend（写 `log/app/YYYY-MM-DD.jsonl`），不引入第三方 |
| `scripts/grep_turn.sh` / `scripts/grep_workspace.sh` | 新增 | 跨三源回溯 |
| `docs/engineering/observability.md` | 新增 | 操作手册（开关方式、回溯流程、常见模式）|

**不动**：`novel_foundation` / `novel_domain` / `novel_persistence/schemas/*` / 既有 `LLMLog` 的 JSONL 输出格式（向后兼容）/ `DecisionTrace` 表结构。

## 7. 已知风险

1. **Logger backend 性能**：自定义 JSONL backend 若同步写文件会拖慢热路径；本 slice 用 GenServer 异步落盘（`handle_cast`），无 backpressure。桌面单机 QPS 极低，可接受。
2. **跨进程透传遗漏**：`Task.async` 调用点遗漏 snapshot/restore 时 metadata 丢失。本 slice 在所有现有 `Task.async` / `Task.start` 调用点同步改造。后续新增异步点时通过 code review + grep `Task\.async` 双重保证。
3. **事件名漂移**：开发者随手新增事件名而不进 ADR-0018 §3 命名空间。本 slice 引入 `LogEmit.emit/4`（编译期校验 phase 枚举为 `:start | :done | :error`），降低漂移。模块名当前不强制校验，靠 review。
4. **关联键噪声**：metadata 在 Logger 输出里默认全打，console 会很长。本 slice 配置 `:default_formatter` 限定字段；jsonl backend 全字段，console 只显示关键 4 字段。
5. **日志体积**：单 turn ≤30 行 × 桌面用户每天 100 turn ≈ 3000 行/天，约 600KB JSONL/天，可接受。

## 8. 验收命令

```bash
# 后端
mix compile --warnings-as-errors
mix test apps/novel_common/test/novel_common/log_context_test.exs
mix test apps/novel_application/test/novel_application/dialogue_gateway_logging_test.exs
mix test  # 全量

mix xref graph --format cycles --label compile-connected --fail-above 0
mix run scripts/arch_check.exs

# 静态扫描
bash scripts/ai_static_scan.sh --top 10 --quick

# 回溯工具自检（需要先跑一次 dev 启动产生真实日志）
bash scripts/dev.sh --web &
# ... 发一条消息，记下 turn_id ...
bash scripts/grep_turn.sh <turn_id>
```

## 9. 与现有 slice 的关系

- **依赖**：ADR-0018（本 slice 启动的硬前置）。
- **不阻塞**：本 slice 不修改任何 v3 contract / 状态机 / UI；可与任何业务 slice 并行。
- **解决**：长期可观测性赤字；为后续走查报告、性能分析、问题回溯提供基础。
- **不解决**：远程聚合 / 指标聚合 / PII 脱敏 / OpenTelemetry 接入（按 ADR-0018 非目标全部留给后续 ADR）。
