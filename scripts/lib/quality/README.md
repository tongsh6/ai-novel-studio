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
