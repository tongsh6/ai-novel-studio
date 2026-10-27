# B60：后端 Dialyzer 基线清零（门禁债）

- 状态：**todo（2026-10-27 收口复跑发现，未开工；等作者排期/CI 要求）**。
- 登记日期：2026-10-27；发现来源：B41–B49 收口全门禁复跑 `mix dialyzer`（HEAD `dc6cda1e`）失败：`done (warnings were emitted)`，**Total errors: 39, Skipped: 0**。
- 归因：本会话未修改任何 `apps/*/lib` 生产代码（仅 `apps/novel_agent/test/support/provider/slice_verify.ex` 验收替身），warning 文件均非本会话改动；按代码来源归因为 **B28/B36 等前序批次**（如 `adoption_repository.ex` 的 `replacement_pieces/2` guard 告警由 B36 CP2 `be189f0c` 引入区段）在 OTP 28/Elixir 1.19 下未复跑 dialyzer 的既有门禁债。**不是 B40/B42/B41 引入**。
- 上游：`.github/workflows/ci.yml` backend job `Dialyzer` step；AGENTS 完成后门禁；[B41](B41-quality-evidence-foundation.md) 的证据地基。

## 1. 问题

CI backend job 含 `mix dialyzer`，项目无 `ignore_warnings` 配置；当前 HEAD 运行 exit 2（39 warnings），即 CI 该 step 会红，但其余 AGENTS 必需后端门禁（compile -Werror / format / test / credo / xref / arch）均为绿。若不清理，后续「全门禁绿」声明无法包含 dialyzer。

## 2.0 同批发现并已修复：umbrella 根 `mix test` 空测试面（2026-10-27）

- 现象：umbrella 根 `mix test` 以 exit 2 结束（各 app 自身 0 failures），根因是 `apps/novel_test` 与 `apps/novel_e2e` 没有任何 `.exs` 测试文件；Elixir 1.19 下空测试面使该 app 的 test task 非 0，进而拖红根任务。`novel_e2e` 旧 e2e 测试文件已在 `2c3c3b5a`（2026-07-19 帧纪元退役）移除。
- 修复（本轮，最小测试面）：新增 `apps/novel_test/test/novel_test_app_smoke_test.exs` 与 `apps/novel_e2e/test/novel_e2e_app_smoke_test.exs`，只断言对应 app 可编译加载，不引入行为断言/旁路验收；根 `mix test` 恢复 exit 0（7 个 app 全绿 + 2 个 smoke）。
- 与 dialyzer 债务独立：本项已关闭，不属 B60 剩余范围。

## 2. CP0 证据

- 命令：`mix dialyzer`（HEAD `dc6cda1e`，本地 Elixir 1.19.5 / OTP 28）；输出 `Total errors: 39, Skipped: 0, Unnecessary Skips: 0`。
- 重点告警族（需要逐条判断「真实缺陷 / 类型标注过窄 / 死分支」）：
  - `adoption_repository.ex`：`when _ :: binary() === nil` 恒假 guard（849、2441 等）；`pattern_match_cov` 不可达 clause（1274 等）。
  - `pending_artifact_workflow.ex`：`no_return`（288、420）。
  - `novel_application.ex`：`no_return`（385）。
- 取证：本轮门禁日志（本地 `/tmp/final-backend-gates.log`，不入 git）；重跑命令与输出可复现。

## 3. Checkpoint 草案

| CP | 范围与完成标准 |
|---|---|
| CP0 | 已完成（上节）；逐条把 39 warning 分类：真实缺陷 / 类型过窄（typespec/guard 修正）/ 需要显式 ignore + 理由（只能是证明不可达或第三方行为），形成清单 |
| CP1 | 按分类修复：优先真实缺陷与死分支；typespec/guard 修正保持行为不变；每类附最小测试或复跑证据；禁止用全局 ignore_warnings 掩盖 |
| CP2 | `mix dialyzer` 0 warnings；`mix test` / credo / format 全绿；CI backend job 复跑（本地模拟命令即可） |
| CP3 | 收口记录：warning 基线清零证据、任何保留 ignore 的逐条理由、与 B28/B36 任务文档的交叉引用 |

## 4. 非目标

- 不借此改动产品行为/协议；不批量加 `@dialyzer {:nowarn_function, ...}` 掩盖可修问题；不改 provider/持久化语义。
- 不重跑 B27 语义矩阵或真实模型批次（与本门禁债无关）。

## 5. 验证与恢复

- 复跑：`mix dialyzer`（期望 `done (passed successfully)` 或 0 warnings）。
- 回归：`mix compile --warnings-as-errors`、`mix test`、`mix credo --strict`、`mix format --check-formatted`。
- 恢复：先读本节 CP0 告警族清单与 B28/B36 相关 commit（`be189f0c`、`028b6231` 等），逐条分类后再改代码；不确定是否真实缺陷时保留并在 CI 记录。
