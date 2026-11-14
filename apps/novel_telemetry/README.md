# novel_telemetry

可观测性运行时 app（2026-11-08 作者裁决 C，ADR-0034）。它承载原来位于
`novel_common` 的日志文件 I/O 与运行时关联协议，使 `novel_common` 回归纯契约/纯函数层。

## 模块

| 文件 | 角色 |
|---|---|
| `lib/novel_telemetry/log_emit.ex` | 结构化业务日志（ADR-0018 §3/§4）：编译期 phase 校验的 `emit/4` 宏、事件字段规范化、JSONL 调用者内同步写出（失败经 `Logger` 诊断且不改变业务返回）、脱敏/中文翻译。 |
| `lib/novel_telemetry/llm_log.ex` | LLM HTTP 调用 JSONL：每次 Provider 调用一行 `[ts] {json}`（含 usage/私有引用关联）；编码失败写可编码占位并报错，不静默丢。 |
| `lib/novel_telemetry/log_context.ex` | `Logger.metadata` 关联键注入协议（workspace/work/turn/frame/provider call refs 等），跨进程快照与恢复。 |
| `lib/novel_telemetry/log_file_date.ex` | 按机器本地日滚动日志文件名（时间戳仍 UTC）。 |
| `test/novel_telemetry/` | 上述模块迁移自 `novel_common` 的行为测试（JSONL 形状/配置键/关联键/编码失败占位）。 |

## 依赖与边界

- 依赖：`novel_foundation`（无业务依赖）。
- 被 `novel_agent` / `novel_application` / `novel_persistence` / `novel_web` 依赖。
- 禁止：引用任何业务 app（agent/application/domain/persistence/web）、Ecto/Repo/Phoenix、业务概念。
- 配置键：`:novel_telemetry`（`llm_log_dir` / `log_jsonl_enabled` / `log_jsonl_dir`）；
  未配置时按 umbrella 根 `log/llm-calls`、`log/app/<env>` 输出。
- 日志路径、行格式、脱敏规则保持不变，既有验收证据读取路径不变。JSONL 在调用者
  进程内 append 完成，`emit/__emit__` 统一返回 `:ok`；这是副作用命令回执，不是
  fsync 落盘保证，也不再宣称与旧异步 fire-and-forget 时序等价。
