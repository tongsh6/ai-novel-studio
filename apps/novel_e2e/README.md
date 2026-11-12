# novel_e2e

端到端集成测试 app。通过顶层入口（Channel / DialogueGateway）验证真实主链，
不直接引用 downstream app 的内部模块。

## 边界（AGENTS.md「E2E 边界规则」）

- **只依赖 `novel_web`**（+ `novel_test`，仅 `:test`）。
- **允许**：`NovelApplication.DialogueGateway`、`NovelApplication.ReplayService`（公开入口）。
- **禁止**：`NovelPersistence.*`、`NovelAgent.*`、`NovelApplication.Planner/
  ExecutionOrchestrator/ContextAssembler/...`（内部模块）。
- 检查机制：`mix run scripts/arch_check.exs` 自动扫描本 app 的 `lib/` 与 `test/`。

## 文件

- [lib/novel_e2e.ex](lib/novel_e2e.ex)：app 入口占位与定位说明（E2E 用例放 `test/`）。
- [test/novel_e2e_app_smoke_test.exs](test/novel_e2e_app_smoke_test.exs)：端到端冒烟用例（从 `novel_web` 顶层入口进入）。
- [test/test_helper.exs](test/test_helper.exs)：ExUnit 启动与测试环境前置。

## 相关入口

- 工程规则：`docs/engineering/vertical-slice.md`、`docs/engineering/scenario-acceptance.md`
- 场景化验收：`quality/acceptance/`、`scripts/tauri_slice_verify.sh`
- 架构约束：`AGENTS.md` §架构约束
