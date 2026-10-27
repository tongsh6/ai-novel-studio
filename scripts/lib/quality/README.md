# scripts/lib/quality/

质量证据地基（B41）的共享 helper。**禁止**在此重新实现 YAML 解析；YAML 语法一律交给 `yaml_bridge.py` 的标准解析器。

| 文件 | 角色 |
|---|---|
| `yaml_bridge.py` | 标准 YAML 解析桥：stdin 收 `{root, paths}`，用 PyYAML SafeLoader + 重复键检测解析，输出 JSON `{path, ok, data, error, line}`。唯一 YAML 语法入口。 |
| `manifest.mjs` | manifest 语义校验与查询的唯一实现（规则见 `tasks/slices/B41-quality-evidence-foundation.md` §6）；被 `quality_manifest_check.sh`、`quality_accept.sh`、e2e 聚合器消费。 |
| `manifest_cli.mjs` | `validate` / `list` / `ids-by-tier` / `field` / `registry-status` CLI；执行入口与聚合器通过它读 registry。 |
| `manifest.test.mjs` | 负例矩阵测试：非法 YAML、重复键、词表漂移、未注册/ draft、blocked/anti_hooks/重复 id 等；运行 `node --test scripts/lib/quality/manifest.test.mjs`。 |
| `verdict.mjs` | B41 CP4：evidence verdict v2 生成/读取/校验（由 CP4 负责）。 |
| `verdict_cli.mjs` | B41 CP4：verdict 读写 CLI（供 runner/聚合器调用）。 |
| `verdict.test.mjs` | B41 CP4：verdict 构造/读取/迁移负例测试。 |
| `accept_verdict.mjs` | B41 CP4 真实消费者：`quality_accept.sh` 每次 run 后生成/写入 verdict（确定性 provider pass；真实 provider pass 留 B42；证据缺失降级 evidence_missing；旧 PASS 先归档）。 |
| `quality_accept_batch.test.mjs` | B41 CP2：批次状态分层/退出码 fixture 集成测试（pass/fail/skipped/evidence_missing/not_run）。 |
| `e2e_status.mjs` | B41 CP3：E2E 聚合器状态/来源/freshness 纯函数。 |
| `e2e_status.test.mjs` | B41 CP3：blocked/stale/evidence_missing/provider mismatch 等 fixture 测试。 |
| `evidence_chain.mjs` | B42 CP2：`quality-evidence-chain/v1` 求证证据链（Base refs / observations / observation→provider call 顺序 / used-unbound-unknown / preparation/stale/replay）归一化、集合校验与历史 artifact 只读读取；被 `release_layer.mjs`、`native_run_manifest.mjs`、`release_layer_cli.mjs` 与测试消费，无独立 CLI。 |
| `evidence_chain.test.mjs` | B42 CP2：集合关系正反例、顺序违规、supplied≠used、历史 ws frames / p1 原生实模 artifact 只读验证；`node --test scripts/lib/quality/evidence_chain.test.mjs`。 |
| `native_run_manifest.mjs` | B42 CP3：`quality-native-run/v1` 原生 artifact 目录统一 run manifest（run/final/failure/scoped/checks/termination/native-transport/AX/DB snapshot/生产指纹/identity），final+failure 并存不得只看 final；被 `release_layer_cli.mjs` 消费。 |
| `native_run_manifest.test.mjs` | B42 CP3：合成 fixture 判定语义 + 真实历史原生目录（p1/b28/b29，缺失跳过）只读验证。 |
| `release_layer.mjs` | B42 CP1：`quality-release-layer/v1` release/release-real-llm 分层结果层（机制/模型行为分离、真实 provider PASS 反假绿、重复/保留措辞/失败分母、空 tier 已知事实、blocked 不得 PASS）。 |
| `release_layer_cli.mjs` | B42 CP1：读 registry + B41 batch + verdict + CP2 证据链 + CP3 原生 run，输出分层结果；空 tier exit 65、跨 tier 合并 exit 66。 |
| `release_layer.test.mjs` | B42 CP1：分层/反假绿/空 tier/CLI 真实历史证据只读测试（31 条）。 |
| `quality_accept_shell_safety.test.mjs` | K4 静态回归（Lead 批准）：扫描 `scripts/quality_accept.sh` 双引号内 `$var` 紧跟非 ASCII 的写法（`set -u` 下会 unbound/退出码异常），要求 `${var}`；含扫描器自检与 4 处已修复写法防回退。 |
| `release_layer_accept.test.mjs` | B42 CP1 接线（含 K5 真实 provider passthrough → evidence_missing）：`scripts/quality_accept.sh --tier release\|release-real-llm` 批次后写 batch 目录内 release-layer.json 的 fixture 集成测试；既有退出码/既有 tier 行为不变（6 条）。 |
