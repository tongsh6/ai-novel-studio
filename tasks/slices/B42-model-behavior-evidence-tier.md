# B42：真实模型行为与求证证据分层

- 状态：**todo（依赖 B41 的 verdict 地基，未开工）**。
- 登记日期：2026-10-27；来源：`release` / `release-real-llm` 均为 0 注册场景，实模与 deterministic 结果混在 nightly，AU-15 还缺 Base→Observation→used refs 的证据字段。
- 上游：[B41](B41-quality-evidence-foundation.md)、[AU-15](../../docs/design/acceptance/author/AU-15-evidence-seeking-authoring.md)、[B39](B39-evidence-seeking-authoring.md)、[tiers](../../quality/acceptance/tiers.md)。

## 1. 目标

建立两类不可互相代签的证据：

1. **机制证据**：计划、工具、观察、状态、持久化、恢复、页面操作和 adoption 是否按契约执行。
2. **模型行为证据**：真实模型在自然输入下是否自行选择求证、使用观察、承认未知或仍忽略证据。

同时让原生系统驱动、浏览器驱动、不同 provider/model、尝试次数、失败分母和保留措辞可机读，避免 HTTP 200 或 stub PASS 被写成模型语义 PASS。

## 2. 开工七问

1. **Contract**：B41 verdict、VS-00K/AU-15 的 Base/Observation/used refs、B27 实模双臂与保留集、原生/浏览器 driver 证据格式。新字段必须 additive 并有版本。
2. **Invariant**：实模与 stub 分 verdict；`supplied≠used`；未自报告=unknown；观察必须进入后续真实请求；输入/参数/重复数/禁答集/失败分母先冻结；缺凭据只能 blocked，不能 PASS。
3. **Boundary**：quality schema/runner/report、外部 verifier、原生证据索引、AU-15/B27 fixtures。生产 `apps/` 不改，不新增模型分支或专用 packet。
4. **Consumer**：B39/AU-15 实模求证、B27 语义评审、release 审核者与后续原生场景。
5. **Proof**：模型行为场景至少独立 2 次且全过才可选为通过，timeout/格式失败入分母；保留未调词措辞；browser/native、driver/provider/model、actual_model 可回放；观察 refs 与后续 provider call 顺序可判。
6. **Acceptance Driver**：真实 Tauri 原生系统 UI + 真实 provider，外部保存请求/响应、观察、页面和 DB 快照；产品验收感知逻辑 **no**。
7. **Exploration**：真实观察及 refs 必须来自作品读取，非硬编码；能沿 observation→provider_call→used refs 回查，不把工具日志当模型已读。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 冻结模型行为/机制两类结果、输入参数、重复与保留措辞、凭据 blocked 和分母语义 | 未开工 |
| CP1 | `release-real-llm` tier/结果层落地；与 deterministic nightly 分开汇总；模型/参数/actual_model/驱动可回放 | 未开工 |
| CP2 | 求证证据字段：`base_refs`、请求观察、`observation_refs/outcome/source_revision/coverage`、`observation_to_provider_call`、`used_context_refs/unbound_refs/unknown/preparation_outcome/stale_on_restore/replay_provider_called` | 未开工 |
| CP3 | 原生证据发现：run/final/failure/scoped checks/termination/native-transport/AX/DB snapshot 统一 run manifest，含生产指纹与 scoped 范围 | 未开工 |
| CP4 | AU-15 A0/A1/A2 预注册与真实运行；B27 语义 fixture 另按原 rubric，不与求证共享通过线；报告分机制/模型行为/文学评价。涉及 AU-15 的真实创作求证执行必须先经 ADR-0030 Accepted，证据基建不代替该决策 | 未开工 |

## 4. 非目标

- 不用真实 HTTP 200 代替模型自主求证或文学判断。
- 不把 stub 排好的探索步骤写成模型选择。
- 不要求所有场景都跑实模；凭据/平台缺失必须 blocked。
- 不把 scoped 原生结果外推为全矩阵、全供应商或文学收益。
- 不把 I10 人工盲评合并进自动模型行为 verdict。

## 5. 验证与恢复

- `release`/`release-real-llm` 不再为空且有明确归属；实模结果不与 deterministic 聚合为单一 PASS。
- A0 Base 足够可不探索；A1 人物承诺、A2 时间关系使用同一产品链，无领域专用分支。
- 关键缺事实场景独立≥2次全过，保留至少一种未调词措辞，失败入分母。
- 每个观察可追到 source/work/authority/version/coverage 与后续真实 provider 请求；未读取 ref 不得成为 used evidence。
- 恢复时先读 B41 verdict 和 B39 预注册，缺字段只能标 evidence_missing，不能补写 PASS。
