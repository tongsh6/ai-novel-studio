# Static Scan Reporting

静态扫描闭环记录两个维度：

1. `artifacts/static-scan/top10.md`：本次扫描出的 Top N 问题快照。
2. `artifacts/static-scan/disposition.md`：Top N 问题的处置视图，合并本目录的长期处置台账。

## Directory Layout

```text
artifacts/static-scan/
  report.json        # 机器可读完整扫描结果，临时产物，不提交
  top10.md           # 本次 Top N 问题快照，临时产物，不提交
  disposition.md     # 本次 Top N 处置视图，临时产物，不提交
  raw/               # 各工具原始输出，临时产物，不提交

reports/static-scan/
  README.md          # 本约定，提交
  baseline.json      # 当前允许的 finding fingerprint 基线，提交
  dispositions.json  # 长期处置台账，按 finding fingerprint 记录，提交
```

## Disposition DB

`dispositions.json` 以 finding fingerprint 为 key：

```json
{
  "tool|check|file|line|title": {
    "status": "fixed",
    "handling": "改为 wss 测试 endpoint，避免 insecure websocket 误报。",
    "recommendation": "生产环境继续通过 env.ts 统一生成 endpoint。",
    "owner": "ai",
    "updated_at": "2026-04-30"
  }
}
```

## Baseline

当扫描结果已收敛到可接受状态时，生成或更新 baseline：

```bash
bash scripts/ai_static_scan.sh --top 10 --write-baseline
```

baseline 只记录 finding fingerprint，用于后续区分新增问题和既有问题。若当前为零 finding，`fingerprints` 应为空数组。

## CI Blocking Rule

CI 不只看工具命令退出码。只要 `report.json` 中存在未处置 finding，`scripts/ai_static_scan_report.mjs` 就会返回非零。

允许通过的处置必须满足：

| Status | Required fields |
|---|---|
| `false_positive` | `handling` |
| `accepted_risk` | `handling`, `recommendation` |
| `deferred` | `handling`, `recommendation` |

`pending` 和仍被扫描命中的 `fixed` 都会阻塞 CI。`fixed` 只应用于历史处置说明；如果同一 fingerprint 仍然出现，说明尚未真正修复。

允许的 `status`：

| Status | Meaning |
|---|---|
| `pending` | 新发现或尚未判断 |
| `fixed` | 已在当前改动中修复 |
| `accepted_risk` | 确认存在但当前接受风险 |
| `false_positive` | 工具误报，附原因 |
| `deferred` | 暂缓处理，附后续建议 |

## AI Closure Rule

每次功能实现后运行：

```bash
bash scripts/ai_static_scan.sh --top 10
```

最终汇报必须同时说明：

- Top N 扫描结果：新增 / 触及文件 / 严重度 / 工具来源
- 处置结果：已修复、接受风险、误报或暂缓，以及处理方案和建议
