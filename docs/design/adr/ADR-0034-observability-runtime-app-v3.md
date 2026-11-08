# ADR-0034：可观测性运行时独立 app（novel_telemetry）——common 回归纯契约层

- 状态：Accepted（2026-11-08，作者选择方案 C：新增独立 runtime app 承载日志 I/O）
- 日期：2026-11-08
- 来源：B71 2026-11-08 审核轮架构审计（`artifacts/b71-audit-20261108/arch-report.md` P2-10）；作者 2026-11-08 裁决「2 C」
- 影响范围：umbrella 新增 `novel_telemetry` app、依赖方向、release 配置、日志配置键、`arch_check` 门禁、AGENTS 架构表
- 相关不变量：作者可见面/证据链字节与路径不变；`novel_common` 纯契约（无 I/O/运行时状态）
- 首个证明 slice：B71（2026-11-08 审核轮）
- 取代：无
- 取代者：无

## 背景

`AGENTS.md` 规定 `novel_common` 是「跨 app 纯契约/纯规则/纯函数」层，禁止「文件 I/O、运行状态」。
但 2026-11-08 审计确认 `NovelCommon.LogEmit`（JSONL 业务日志、`File.write!`、`Task.start` 异步写出）
与 `NovelCommon.LLMLog`（LLM 调用 JSONL：`File.mkdir_p!`/`File.write`）长期位于 common，且被
novel_agent / novel_application / novel_persistence / novel_web 共 41 个生产文件消费；
`arch_check` 的 `@common_forbidden` 只检查跨 app 引用，不覆盖 I/O 禁止项，因此门禁无法发现该越界。

可选方案：A（在 AGENTS 显式登记例外）、B（common 定义 sink behaviour，各 app 注入）、C（新增独立 runtime app）。
作者 2026-11-08 选择 **C**：把可观测性运行时整体迁出纯契约层。

## 决策

1. 新增 umbrella app **`novel_telemetry`**，承载日志运行时副作用：`NovelTelemetry.LogEmit`（结构化业务日志
   JSONL 写出与脱敏/编码）、`NovelTelemetry.LLMLog`（LLM HTTP 调用 JSONL）、`NovelTelemetry.LogContext`
   （Logger metadata 关联协议）、`NovelTelemetry.LogFileDate`（本地日滚动文件名）。
2. 依赖方向：`novel_telemetry → novel_foundation`；产品 app（agent/application/persistence/web）
   `→ novel_telemetry`。`novel_common` 不再包含任何日志 I/O，回归纯契约。
3. 配置键从 `:novel_common` 迁到 `:novel_telemetry`（`llm_log_dir` / `log_jsonl_enabled` / `log_jsonl_dir`），
   dev/prod/runtime 同步；日志文件路径、行格式（`[ts] {...}`）、脱敏规则、按本地日滚动语义保持不变，
   既有验收证据读取路径不受影响。
4. `arch_check` 增加 `novel_telemetry` 边界规则（不得引用业务 app / Ecto/Repo/Phoenix/GenServer 等），
   并给 `novel_common` 增加运行时 I/O 禁止模式（构建期 `lib/mix/tasks/` 生成器白名单例外）；
   默认项目根解析改为「含 mix.exs + apps/ 的 umbrella 根」，避免默认日志目录落到子 app。
5. `novel_telemetry` 不承载任何业务概念、不依赖业务 app；未来若需要另一个副作用族（如指标导出），
   在本 app 内扩展或另立 runtime app，不得回迁 common。

## 验证

- 旧模块全仓 0 引用（`NovelCommon.LogEmit/LLMLog/LogContext/LogFileDate`）；
- `mix compile --force --warnings-as-errors`（dev/test）EXIT 0；
- `novel_telemetry` 迁移测试（log_emit/llm_log/log_context）与全量 `mix test` 0 failures；
- `mix run scripts/arch_check.exs` 通过（新增规则无存量误报）；
- 日志输出路径/格式不变：dev/prod/runtime 显式目录配置不变，`log/app/<env>/YYYY-MM-DD.jsonl` 与
  `log/llm-calls/YYYY-MM-DD.jsonl` 仍按本地日生成；
- 静态扫描与不变量 driver（含 LLMLog/LogContext 消费方）通过。

## enforced_by

- `apps/novel_telemetry/mix.exs`
- `apps/novel_telemetry/lib/novel_telemetry/log_emit.ex`
- `apps/novel_telemetry/lib/novel_telemetry/llm_log.ex`
- `apps/novel_telemetry/lib/novel_telemetry/log_context.ex`
- `apps/novel_telemetry/lib/novel_telemetry/log_file_date.ex`
- `apps/novel_telemetry/test/novel_telemetry/log_emit_test.exs`
- `apps/novel_agent/mix.exs`
- `apps/novel_application/mix.exs`
- `apps/novel_persistence/mix.exs`
- `apps/novel_web/mix.exs`
- `config/dev.exs`
- `config/runtime.exs`
- `scripts/arch_check.exs`
- `./AGENTS.md`

## enforcement_gaps

- 日志写入仍是调用进程内 `Task.start` fire-and-forget（与原实现一致）；未改为 OTP 监督的 sink 进程——刻意保持字节/时序等价，如需更强可观测性可靠性另行立项。
- `novel_telemetry` 未新增独立启动监督树；app 目前只提供纯函数/宏 + 文件写出，不引入 GenServer。
