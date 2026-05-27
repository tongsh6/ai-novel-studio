# Quality Operating System

本目录是 AI Novel Studio 的质量体系总入口，用来把设计、架构、运行时不变量、场景化验收和证据归档串成一条可审计链路。

## 目录关系

- `docs/engineering/` 保存工程原则、红线和解释性规范。
- `tasks/slices/` 保存承重 slice 的任务执行记录和完成状态。
- `scripts/` 保存可执行验证脚本。
- `quality/acceptance/` 保存场景化验收 manifest、分层和证据契约。
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
| L1 Spec / Design | 明确 slice 消费的设计、ADR、schema、状态字段 | `docs/design-v2/`, `docs/engineering/`, `tasks/slices/` |
| L2 Architecture Guard | 保证 umbrella 依赖方向、frontend 技术栈和设计追溯不漂移 | `mix check`, `scripts/arch_check.exs`, `scripts/frontend_audit.sh`, `scripts/check_design_trace.sh` |
| L3 Runtime Invariant | 证明运行时 user-facing 创作内容来源真实 | `scripts/scenario_invariants/run_i*.exs` |
| L4 Scenario Acceptance | 由外部自动化驱动真实 browser/Tauri 页面完成用户场景 | `scripts/quality_accept.sh`, `scripts/slice_verify.sh`, `scripts/tauri_slice_verify.sh` |
| L5 Evidence / Report | 归档截图、WebSocket 帧、JSONL、summary 和长期处置记录 | `artifacts/`, `quality/reports/`, `reports/static-scan/dispositions.json` |

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

