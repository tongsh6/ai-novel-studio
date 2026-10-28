# Script Helper Index

`scripts/lib/` 放多个启动/验收脚本共享的 helper。这里的脚本不应单独作为用户入口；入口脚本应位于 `scripts/` 顶层或对应场景目录。

| 文件 | 角色 |
|---|---|
| `process_tree.sh` | 进程树终止与清理 helper，被 stage/dev/Tauri 验收脚本复用。 |
| `tauri_dev_config.sh` | 生成 Tauri dev runtime overlay config，避免启动脚本改写 `frontend/src-tauri/tauri.conf.json`。 |
| `b31-question-proof.mjs` | B31 浏览器驱动与原生验证器共用的纯回复证明/预算 helper；不操作页面或产品。测试在 frontend/slice-verify/b31-question-proof.test.mjs。 |
| `b28-chapter-fixture.mjs` | B28 原浏览器与原生验收共用的原始合成正文、旧全文兼容归一及ADR-0029计划/预览字节与实际分段校验；正文仍必须通过真实UI编辑采纳。 |
| `native_ui/` | [外部系统 UI 驱动](native_ui/README.md)：macOS AX/CGEvent 驱动真实 Tauri 窗口（原生验收 harness），含高层工作台动作与等待账；产品不读取。 |
| `quality/` | [B41 质量证据地基](quality/README.md)：标准 YAML 解析桥、manifest 语义校验/查询 CLI、反例测试；被 `scripts/quality_manifest_check.sh`、`scripts/quality_accept.sh`、e2e 聚合器消费。 |

| `native_app_ownership.mjs` | B37原生重开归属清理：精确匹配本批独立可执行路径，清理前复核PID身份，输出退出证据；由Tauri runner调用。 |
| `native_app_ownership.test.mjs` | 重开/同名其他批次/参数伪匹配的归属回归。 |

## quality/（B41 证据基建）

契约文件位于 `quality/acceptance/verdict-schema.json`（quality-verdict/v2）。本目录 verdict 相关文件：

| 文件 | 角色 |
|---|---|
| `quality/verdict.mjs` | verdict v2 唯一生成/读取/校验实现：`buildVerdict`/`writeVerdict`/`readVerdict`/`validateVerdict`。缺 verdict.json、缺 status 或结构无效一律 evidence_missing，绝不默认 PASS；旧 summary.json 只算 artifact（legacy_summary=true）；拒绝用失败 verdict 静默覆盖已有 PASS。无外部依赖。 |
| `quality/verdict_cli.mjs` | verdict v2 的 bash runner CLI：`read <artifact_dir>`（JSON，退出码 0 pass / 1 fail / 65 skipped / 67 evidence_missing / 69 not_run）、`write <artifact_dir> <json>`、`validate <file>`。 |
| `quality/verdict.test.mjs` | verdict 负例矩阵、legacy 读取、PASS 覆盖保护与 schema/实现同源回归；运行 `node --test scripts/lib/quality/verdict.test.mjs`，无前端/npm 依赖。 |
| `quality/e2e_status.mjs` | B41 CP3 E2E 聚合器判定纯函数：场景状态 `pass/fail/blocked/stale/evidence_missing/not_run`、freshness（`git_head`/`current`）、聚合 verdict `quality-aggregate/v1` 与批量退出码；被 `scripts/e2e_01_full_chain_check.sh` 消费。 |
| `quality/e2e_status.test.mjs` | B41 CP3 负例 fixture：E4 blocked、旧 summary 无 git_head→stale、缺失/provider 不匹配、fresh pass 与退出码映射；运行 `node --test scripts/lib/quality/e2e_status.test.mjs`。 |
## quality/（B42 模型行为与求证证据分层，2026-10-27）

| 文件 | 角色 |
|---|---|
| `quality/evidence_chain.mjs` | B42 CP2 + §12：`quality-evidence-chain/v1`——Base refs、observations（outcome/source_revision/coverage）、observation→后续 provider call 顺序、used/unbound/unknown、preparation_outcome/stale_on_restore/replay 三态（`replay_status`）的归一化与集合校验；`quality-evidence-requirements/v1` 必需证据声明的归一化/校验与 `evaluateEvidenceCompleteness`；绑定/完整性判定与 artifact 记录读取；被 `release_layer.mjs`/CLI 消费。 |
| `quality/native_run_manifest.mjs` + `quality/native_run_manifest_cli.mjs` | B42 CP3：`quality-native-run/v1`——原生 artifact 目录统一 run manifest（run/final/failure/scoped/checks/termination/native-transport/AX/DB snapshot/生产指纹）；final+failure 并存必须 fail，scoped 不外推全矩阵；CLI `scan <artifact-dir>`。 |
| `quality/release_layer.mjs` + `quality/release_layer_cli.mjs` | B42 CP1 + §12：`quality-release-layer/v1`——release/release-real-llm 分层结果层（机制/模型行为分离、真实 provider PASS 反假绿、重复/保留措辞/失败分母、空 tier=not_run）；证据链一律重算、必需证据按声明逐维度判定（缺必需→evidence_missing，硬违规→fail）；CLI 读 artifact 记录的 evidence-chain/evidence-requirements 或 `--evidence-requirements`；被 `scripts/quality_accept.sh` 的 release tier 批次消费。 |
| `quality/release_layer_accept.test.mjs` | B42 CP1 接线 + K5（真实 provider passthrough→evidence_missing）fixture 集成测试。 |
| `quality/quality_accept_shell_safety.test.mjs` | K4 静态回归：扫描 `quality_accept.sh` 双引号内 `$var` 紧跟非 ASCII 的写法，避免 `set -u` 下变量名被全角字符吞并。 |

