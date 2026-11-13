# B84：`novel_web` 慢测试收敛与剩余架构/测试债务

- 状态：**todo（2026-11-08 立项；00f P2-E 剩余项承接；2026-11-12 增补验收资产/规模治理债务登记，见文末）**
- 来源：
  - [00f 能力图谱 P2-E](../../docs/design/00f-capability-atlas.md)：`novel_web` 193 tests / 532s 慢测试仍待收敛；`novel_common` 日志 I/O 部分已由 ADR-0034（`novel_telemetry`）闭环，本任务只承接 web 慢测试与剩余债务。
  - B71 审核轮架构 P2-10 记录与 2026-11-08 候选。
- 范围：
  1. 诊断 `novel_web` 慢测试根因（真实等待/时序重试/DB 初始化/外部依赖等分类，只读 profiling，先不改测试语义）；
  2. 在**不缩小覆盖**的前提下收敛耗时（如共享测试前置、减少真实等待、泄漏/超时治理；复用既有测试体系与 `scripts/lib/test_env.sh` 统一前置，不手写旁路脚本）；
  3. 剩余架构/测试债务核对（00f P2-E 剩余项逐条处置或登记承接）。
- 非目标：不为提速删断言/跳过测试/放宽验收；不引入新测试框架；不动产品行为。
- 验收：全量 `mix test` 覆盖不降、耗时基线前后对比、稳定性证据；每项债务有处置或明确承接；门禁（compile/credo/format/xref/arch/扫描）保持绿。
- 依赖：无外部窗口；可与 B81 设计/实现期并行，但改动只在测试/前置层，不触碰 B81 写域（若需共享文件须协调）。
- 恢复入口：本任务；证据在 `artifacts/` 与测试报告。

## 验收资产与规模治理债务登记（2026-11-12 复核）

以下债务由 2026-11-12 B71/B81 复核的 clean/架构审计登记，归属本任务（测试/验收资产层，
不改产品行为）。修复前不得把相关断言的"通过"当作有效验收证据。

1. **browser driver 与当前 UI 契约漂移（driver_stale）**：`frontend/slice-verify/external-ui-driver.mjs`
   仍有多处查询 `section[aria-label="推理"]`（约 8 处：`installReasoningStreamObserver` 及
   `driveAgentSessionTranscriptLazyPage` / `driveUa01AgentBoundedRosterToCharacterDesign` /
   `driveAgentConversationTurn` / `driveAgentProviderExecutionActivityRestored` 等），而前端
   `WorkspaceChat.tsx:930` 已移除该重复 landmark（「推理」现为 `agentRunTimeline.ts` 的可见
   label 文本，区域契约是 `aria-label="本轮创作过程"`）。这些场景在 `quality/acceptance/scenarios.yml`
   仍为 active，若在真实窗口运行会出现假阴性/超时。修复方向：改用用户可见语义
   （`[aria-label="本轮创作过程"]` 或时间线可见 label），改后必须重跑对应 Tauri/nightly 批次并
   保存证据；不得用旧 landmark 继续判绿。
2. **规模治理盲区**：`node scripts/check_module_size.mjs` 只扫 `apps/*/lib`、`apps/*/test`、
   `frontend/src`；`frontend/slice-verify/external-ui-driver.mjs`（41,360 行）与
   `native-tauri-verifier.mjs`（27,318 行）、`scripts/lib/native_ui/`（80 个 mjs）不在 ratchet 内，
   也没有 B78 拆分排期。处置建议：先把验收脚本纳入 module-size 观察名单（门槛可高于生产代码，
   如 1500–2000 行）并登记 baseline，再按「一次一个文件、独立 refactor commit」拆分；在此之前
   至少禁止在未登记情况下继续扩大这两个文件。
3. 已在本轮修复、无需跟进：`scripts/lib/native_ui/README.md` 索引补全 10 个漏列 mjs（含 g3）；
   `apps/novel_e2e/README.md` 补齐（目录可达性规则）。

## 2026-11-13 R00 核实的质量测试前置债务（可独立推进）

来源：[B87 R00 基线](B87-model-interaction-request-projection.md#95-验证状态与恢复)，HEAD `89b44a95` 的 [CI run 43294123379](https://github.com/tongsh6/ai-novel-studio/actions/runs/43294123379)。本节只登记测试前置层的具体修复范围；本任务仍未实施，不把代码问题笼统视作环境故障。

- `scripts/lib/quality/au15_preregistration_check.test.mjs` 直接调用真实仓库检查器，并读取 gitignored `artifacts/model-contracts/b39-cp1/au15-preregistration.json`；干净 CI 缺文件即失败。应让现有检查器消费显式输入/输出，测试使用隔离且自足的夹具；保留缺文件、缺前置、冻结状态等失败语义，不提交真实运行产物充当测试依赖。
- `scripts/lib/quality/evidence_chain.test.mjs:411` 在仓库 `tmp/` 未存在时调用 `mkdtempSync`，导致 ENOENT。复用该文件已有 `os.tmpdir()` 模式与测试清理；验证原本的拒绝覆盖/显式覆盖行为，不删断言。
- `scripts/lib/quality/manifest.test.mjs` 两项真实仓库断言硬编码 231/233，与实际 232/234 漂移。应按 registry/扫描来源分别校验集合、草案分离、重复/漏项和路径边界，另用小型固定夹具测精确数量；不能仅把常数加一或删除仓库完整性断言。
- 验收：上述完整质量 parser suite 在无用户 artifacts、无预建 repo/tmp 的干净 checkout 中通过；既有正反例仍有效；入口无模型/产品写入；`quality_manifest` 检查、NEXT/索引及适用 ub-mode 门禁通过。使用现有框架，不另建测试库。

本地 `mix test` 同 HEAD 为 3185 tests/0 failures，其中 web 196 tests/548.1 秒；旧 193/532s 是历史基线。远端 Dialyzer 与 Windows smoke 失败另见 B87 归因，不能由本节测试修复代签生产类型修复或 Windows 实测。

## 变更记录

- 2026-11-08：立项（承接 00f P2-E 剩余 web 慢测试与债务）。
- 2026-11-12：登记验收资产 driver 漂移（aria-label="推理"）与验收脚本规模治理盲区；补 native_ui README 与 novel_e2e README 索引。
- 2026-11-13：B87 R00 核实干净 CI 的质量 parser 前置/集合断言失败，登记可独立执行的测试隔离修复；尚未实施。
