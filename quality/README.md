# Quality Operating System

## 模型交互设计候选验证入口

[场景验收目录](acceptance/README.md) → [固定输入索引](acceptance/fixtures/README.md) → [VS-00M 合成样例](acceptance/fixtures/model-interaction/README.md)，由 [离线脚本](../scripts/model_contracts/model_interaction/README.md) 消费。其结果是设计样例自洽性，不是产品验收；报告只进 `artifacts/`。

本目录是 AI Novel Studio 的质量体系总入口，用来把设计、架构、运行时不变量、场景化验收和证据归档串成一条可审计链路。

## 目录关系

- `docs/engineering/` 保存工程原则、红线和解释性规范。
- `tasks/slices/` 保存承重 slice 的任务执行记录和完成状态。
- `scripts/` 保存可执行验证脚本。
- `quality/acceptance/` 保存场景化验收 manifest、分层和证据契约。
- `quality/module-size-baseline.json` 是模块规模治理的 ratchet 基线（观察文件登记上限 + 聚合型文件豁免），由 `scripts/check_module_size.mjs` 读写，规则见 `docs/coding-standards/03-module-boundaries.md` §3.2。
- `artifacts/` 保存本地或 CI 运行产物，不应作为源码提交。
- `reports/` 保存少量长期处置台账，例如 static scan disposition。

## 五层质量模型

```text
L1 Spec / Design
L2 Architecture Guard
L3 Runtime Invariant
L4 Scenario Acceptance
L5 Evidence / Report
```

| Layer | 目的 | 主要入口 |
|---|---|---|
| L1 Spec / Design | 明确 slice 消费的设计、ADR、schema、状态字段 | `docs/design/`, `docs/engineering/`, `tasks/slices/` |
| L2 Architecture Guard | 保证 umbrella 依赖方向、frontend 技术栈、设计追溯与模块规模不漂移 | `mix check`, `scripts/arch_check.exs`, `scripts/frontend_audit.sh`, `scripts/check_design_trace.sh`, `scripts/check_module_size.mjs` |
| L3 Runtime Invariant | 证明运行时 user-facing 创作内容来源真实 | `scripts/scenario_invariants/run_i*.exs` |
| L4 Scenario Acceptance | 由外部自动化驱动真实 browser/Tauri 页面完成用户场景 | `scripts/quality_accept.sh`, `scripts/slice_verify.sh`, `scripts/tauri_slice_verify.sh` |
| L5 Evidence / Report | 归档截图、WebSocket 帧、JSONL、summary 和长期处置记录 | `artifacts/`, `quality/reports/`, `reports/static-scan/dispositions.json` |

## 模块规模治理（L2 ratchet）

行数是代理指标，本质判据是职责数/变更理由（见 `docs/coding-standards/03-module-boundaries.md` §3.2）。机器门禁只做两件事：

```bash
node --test scripts/check_module_size.test.mjs && node scripts/check_module_size.mjs --check
```

- **R1 ratchet**：`quality/module-size-baseline.json` 中已登记的观察文件，任何改动不得让行数超过 `max_lines`（只减不增）。
- **R2 新观察登记**：超过关注门槛（生产 500 行 / 测试 800 行）但未登记也未豁免的文件必须拆分，或在 baseline `exemptions` 登记理由与复核日期。
- `outlier_floor` 只是「进入观察名单」的入口，不是行数红线；门禁不判定「文件够不够优雅」。
- 存量拆分按「变更频率 × 规模」排序，登记为独立架构债务任务（`tasks/slices/B78-module-size-debt.md`），不与功能 slice 混做。

## 本机 Manifest 门禁环境

本机 `/opt/homebrew/bin/python3` 已提供 PyYAML 6.0.3；`/usr/bin/python3` 未提供该模块，不代表本机缺少依赖，也不需要安装。`scripts/quality_manifest_check.sh` 会优先使用 PATH 中的 `python3`，并在必要时复用上述 Homebrew 解释器。本机直接运行：

```bash
bash scripts/quality_manifest_check.sh
```

门禁必须由标准 YAML 解析器完成，不得因解释器选择问题改用正则解析。

## 承重 Slice 追踪字段

每个承重 slice 应能追踪：

- 消费的设计、ADR、schema、状态字段。
- 保护的系统不变量。
- 穿过的真实 app 边界。
- 第一个真实消费者。
- 局部测试和运行时不变量。
- 外部自动化驱动真实页面的场景化验收。
- 验收证据路径。
- PR / nightly / release 质量门禁层级。
