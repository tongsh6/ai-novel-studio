# NEXT

> 只维护排期；执行状态和更新规则见 [tasks/README](README.md)，进度以每行链接的原任务为准。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|

> 当前无 AI 可推进项：B41/B40/B59/B60/B61/B62/B63 已 done；B42 CP0–CP3 done（CP4 待 ADR-0030）、B49 评审材料 done（R1–R7 待作者裁决）、B39 CP0+CP1 只读预研 done（施工待 ADR-0030，D1–D7 待作者）；剩余为作者裁决/授权或新任务排期，见「阻塞」。


## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B38-WORLD-RULE-SAVE-INTENT | deferred 候选；仅在真实产品链复现或作者请求时触发。 | [B38](slices/B38-world-rule-save-intent.md) |

## 阻塞

- **作者裁决｜ADR-0030（B39 CP1+ 与 B42 CP4 的共同前置）**：ADR-0030/VS-00K/AU-15 均 Proposed；Accepted 前 AI 不进入求证式创作产品实现。解锁后 B39 CP1–CP4 与 B42 CP4 才可开工；2026-10-28 B39 CP1 只读预研已给出 D1–D7 开放决策（Base refs 形状、探索预算、准备判断边界、release tier 口径、gate-lineage、A1/A2 seed、观察 ref 进 writer prompt），作者可一并裁决。见 [B39 §9](slices/B39-evidence-seeking-authoring.md)、[B42](slices/B42-model-behavior-evidence-tier.md)。
- **作者裁决｜B49 R1–R7 与 ADR-0031 状态**：主链语义收窄（primary/plan 边界、reply-only 与 OrchestratorDecision、decision_type/status 子集、ADR-0007 动作退役、只读 output 校验分层）与 ADR-0022 处置（推荐 Superseded by ADR-0031）待作者逐项选；未裁决前 B01/B43/B45 不得按提案改 schema/代码。裁决包见 [B49 §7](slices/B49-core-semantics-and-adr-review.md)。
- **作者裁决｜R2 质量评估 material ref 语义（B60/B63）**：`AuthoringTaskBuilder.for_quality_evaluation` 原 `source_ref || turn_id` 兜底永不触发（B60 已删死兜底）；推荐 A 保持现状「不回退」（quality evaluation 物料必须绑定正文 artifact ref，turn_id 回退会让物料来源漂移并违背 I1 因果绑定），备选 B 回退 / C 不回退+显式观测。未确认前 R2 保持 open。见 [B63 §6.2](slices/B63-known-gaps-remediation.md)、[B60 §8.2](slices/B60-backend-dialyzer-baseline.md)。
- **作者裁决｜B48**：B29 no-op / 同名歧义策略（拒绝 no-op、显式幂等回执或仅收紧歧义）；T2 不冒充通过，未裁决前不改代码。见 [B48](slices/B48-character-revision-noop-and-ambiguity.md)。
- **作者安排｜I10 文学盲评**：P1 canonical-3e 与原生 scoped 只提供可盲评样本/工程证据；文学质量收益判定须作者指定负责人、样本与时机，AI 不代签、不以自动化分数替代。
- **作者授权｜历史 stage 数据修复**：stage 存量（ch1/ch17）保持只读清单；任何修复需作者单独授权，先备份/diff/回滚与保留策略。见 [B28](slices/B28-whole-chapter-revision.md)。
- **作者裁决｜B29 T2 known-gap**：「指定沈砚为主角」（两个同名沈砚）时真实模型未走 await_author、产出 old==new no-op 角色修订候选（未采纳、DB 零写入）；确定性 23/23 与 T1 全链 PASS，T2 不冒充通过。是否登记 no-op 拒绝/同名澄清硬化产品 slice 待裁决。
- **验收基建｜native 覆盖现状**：11 个场景已有原生 PASS（B61：AU11×2+AU07×3；B62：au01×3+pr-smoke-core-reply+au02-natural+agent-step-regate）；`vs10` 注册 surface=browser，按设计保留 browser 证据。**其余 nightly 场景（B40 §10.2 list）PASS 仍不得读作原生交互**，按需逐场景用 B61/B62 harness 补齐。
- **产品/契约裁决候选｜`au02-candidate-fallback-ui`**：判断纪元候选帧只能由 `propose_creative_directions` 产生，坏/空候选到不了应用 fallback；应用兜底代码仍在但无当前可达生产者。触发=协议/产品裁决或真实模型产出该路径。
- **下一批验收重锚｜B40 §10.2 同族未复跑**：`p1-chapter-draft-generation`、`p1-prose-execution-brief`、`au01-turnresult-recorder-ui-consistency`、`au02-candidate-*`、`au03-*`、`au05-adoption-safety-freshness`、`au07-trace-why-entry`、`au09-au03-*`、`au12-correction-intent-roundtrip`、`vs00c-*` 的 verifier/manifest 旧事件未全部迁移；历史 PASS 只作历史，nightly 复跑前不得 pass。见 [B40 §10.2](slices/B40-judgment-era-acceptance-reanchor.md)。
- **已知未闭环｜`release` / `release-real-llm` registry 为空**：B42 结果层已落地并接线 `quality_accept.sh`，但不以占位/blocked 假场景充数；首个真实场景 AU-15 归 B42 CP4。见 [B42](slices/B42-model-behavior-evidence-tier.md)。
- **B27 CP4 known-gap（2026-10-25，作者裁决）**：最后一次全量 retest6 integrated 40/40 ok、unavailable 0、ZT 0、uq 0；key_set 仅 M01r2、overall 34/40=0.85 <0.90 → 不标 CP4 done，记录 known-gap（M01r2/M02/M08r2/M16r1/M18r1）并转入 B31；B27 不再全量 retest，后续 B28/产品硬化周期回归。机制与替身结果不代表真实模型闭环。见 [B27](slices/B27-systematic-prompt-and-intent-integration.md)。
- **条件项**：凭据、外部探索、人工盲评、durable、live vendor/OAuth、跨平台签名公证等承接位置见 [既有对账任务](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)；不因未列为候选而消失。
