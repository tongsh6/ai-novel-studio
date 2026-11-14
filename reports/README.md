# reports/ — 长期处置台账

> 跨次运行的长期台账（与单次证据 `artifacts/` 区分：artifacts 是一次性运行产物且 gitignore；reports 是需长期保留、跨运行累积的处置记录）。被静态扫描闭环引用（见 `../AGENTS.md` 静态扫描节）。

## 审查记录

以下报告保存固定时间点的审查发现、证据摘要与复验要求，作为长期处置依据；执行状态与整改 checkpoint 仍只维护在链接的原任务。

| 文件 | 内容与承接 |
|---|---|
| [2026-11-14-b84-implementation-review.md](2026-11-14-b84-implementation-review.md) | B84 实现独立审查及历次整改复核；最新[§15 REV-01 复核缺口整改](2026-11-14-b84-implementation-review.md#15-rev-01-复核缺口整改结果2026-11-14)记录 PGID 回退、外部借用 attach/release、onSpawn 早期收尾与 scope 74/74（待独立复核）；[§14 REV-05/04 整改](2026-11-14-b84-implementation-review.md#14-rev-05-与-rev-04-整改结果2026-11-14)、[§13 REV-01 独立复核](2026-11-14-b84-implementation-review.md#13-rev-01-第二轮整改独立复核)及 §9–12 保留历史审查/整改记录；执行状态见 [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md) |

## 子目录

| 目录 | 内容 |
|---|---|
| `static-scan/` | 静态扫描基线与处置台账（`baseline.json` / `dispositions.json`，详见 `static-scan/README.md`） |
| `gap-ledger/` | 差距回收快照；输入、计数口径及局限见 `gap-ledger/README.md`。 |
