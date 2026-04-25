# 系统检查报告 2026-04-24 v1

- 状态：candidate/index
- 书名：放逐边地开拓录

## 检查结论

- 正式区 `approved/current/` 已有正式总纲、世界规则、人物、时间线、伏笔、第一卷合同和研究方法。
- 书内审批卡均已脱离 `decision: null` 状态。
- `approval_foundation_pack_v1.json` 已标记为 `partial` 并被 v2 替代。
- `approval_patch_ch00_v1.json` 已标记为 `rejected`，避免空模板误入库。
- 正式合同的依赖文件路径已从“待基础设定包审批后补正式路径”改为正式状态文件路径。
- 公司级开篇方法和领主种田流竞品经验已分别进入 `company/shared-methods/` 与 `company/shared-research/`。

## 当前正常残留

- `approved/archive/2026-04-24_initial_template_snapshot/` 中保留的“待补”来自初始模板快照，属于归档留痕，不视为当前正式缺口。

## 下一步

- ch01-ch03 v3 重写稿继续写入 `candidate/drafts/`。
- v3 草稿完成后，只能作为候选稿；若作者满意，再生成正式正文 patch 与 approval。
