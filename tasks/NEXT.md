# NEXT

> 只维护排期；状态与决策以原任务为准，规则见 [tasks/README](README.md)。换队首先运行 `node scripts/next_task_check.mjs --open`；本次排期理由与未列候选的承接见 [全量对账 §8](2026-10-27-design-to-execution-reconciliation.md#8-2026-10-28-排期与决策材料复核)。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|

> 本轮队列已清空（2026-10-29）：B42 §12、B44、B40 §10.2、B47 CP0–CP3 均达各自 CP 标准；收口复核、未选入 backlog 与残余见 [全量对账 §9](2026-10-27-design-to-execution-reconciliation.md#9-2026-10-29-队列收口复核lead)。当前无 AI 可推进项（作者裁决/授权或新任务排期触发下一轮）。

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|

> 本轮无近期候选：未选入 backlog（B45/B46/B51/B57/B58 等）与条件候选（B39/B43）的承接入口见 [全量对账 §8.1/§9](2026-10-27-design-to-execution-reconciliation.md#81-排期理由与承接)；下一轮由作者排期或触发条件启动，不在此累积镜像。

## 阻塞

- **作者裁决｜求证式创作**：ADR-0030/VS-00K/AU-15 仍 Proposed；B39 实施与 B42 CP4 待裁决，D1–D7 推荐已校准。见 [B39 §9.7](slices/B39-evidence-seeking-authoring.md#97-开放决策清单给作者每项选项-推荐-影响)、[B42 CP4](slices/B42-model-behavior-evidence-tier.md#10-cp4blocked-登记不执行不代签)。
- **作者裁决｜主链语义**：B49 R1–R7 / ADR-0031 与 ADR-0022 状态，约束 B01/B43/B45；建议不是已接受决定。见 [B49 §7](slices/B49-core-semantics-and-adr-review.md#7-交付物五作者裁决包一页式)。
- **作者裁决｜质量物料引用**：不回退 turn_id 的推荐保留；缺引用的 unavailable 事实与观测选项已澄清。见 [B63 R2](slices/B63-known-gaps-remediation.md#62-r2-质量物料引用裁决)。
- **作者裁决｜角色无变化与同名歧义**：B29 T2 统一由 B48 承接，不重复登记、不冒充通过。见 [B48](slices/B48-character-revision-noop-and-ambiguity.md)。
- **作者裁决｜技术方向**：Multi-Agent day-1 约束见 [B50](slices/B50-multi-agent-current-boundary.md)；PaperTrail 须先只读取证再裁决，见 [B51](slices/B51-tech-stack-current-rebase.md)。
- **产品裁决｜候选 fallback**：当前无可达生产者，待协议/产品裁决或真实复现，见 [B40 §10.1](slices/B40-judgment-era-acceptance-reanchor.md#101-逐场景结论表current-head-真跑复核)。
- **作者安排／数据授权**：I10 盲评及其他外部条件见 [既有对账 §7](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；stage 存量修复须单独授权，见 [B28](slices/B28-whole-chapter-revision.md)。
- **条件触发**：世界规则保存问题仅真实产品链复现/作者请求后启动，见 [B38](slices/B38-world-rule-save-intent.md)；B27 语义 known-gap 沿原裁决在后续产品周期回归，见 [B27](slices/B27-systematic-prompt-and-intent-integration.md)。
