# 差距回收台账

本目录保存 `scripts/gap_ledger.sh` 生成的跨次快照。任务入口为 `tasks/NEXT.md` §5，设计与剩余范围仍在原文档维护。

## 文件

| 文件 | 角色 |
|---|---|
| `latest.json` | 最近一次扫描日期、开放差距描述和连续出现次数；由脚本生成并提交，不手工改写计数。 |
| `README.md` | 本目录索引、输入来源和快照解释。 |

## 输入与解释

- `docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md` §6：G1–G7。
- `docs/design/08-novel-element-model.md` §6.2：NEM-GAP；明确已关闭的行排除，部分关闭仍挂账。
- `tasks/NEXT.md`：B 轨债务台账；已销账项排除。

运行 `bash scripts/gap_ledger.sh` 会更新快照。`streak` 统计连续扫描仍然开放的次数，**不代表逾期天数，也不证明期间没有实施进展**；达到三次只是需要复核的提示。
差距描述来自文档，过期描述必须先按代码、原 slice 和验收证据校准再扫描。计数下降不是目标，局部实现不能凭文档改写升级为整体关闭。

2026-10-05 已校准五本账、三态对账、全书骨架与 message envelope 的现有能力和剩余缺口；这些部分关闭项继续保留，不将历史证据当作当日重新验收。
