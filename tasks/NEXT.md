# NEXT

> 本轮仅整理文档与排期；状态与决策以原任务为准，规则见 [tasks/README](README.md)。每次完成或受阻后运行 `node scripts/next_task_check.mjs --open` 复核并补位；本轮扩展依据见 [全量对账 §17](2026-10-27-design-to-execution-reconciliation.md#17-2026-10-30-元原则整改任务与排期梳理)。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B42-PREP | 准备 AU-15 setup/测量分账、预注册与 driver/verifier；真实运行仍待 B39 接线和资源窗口 | [原任务小节](slices/B42-model-behavior-evidence-tier.md#101-au-15-预注册与-driver-准备) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B72 | 作者选择先做 P2：CP0 离线 LLM 语料扩增设计已冻结；下一步 CP1 生成 manifest/candidate 与原始批次，未调用模型；P0/P1 缺口不由本任务销账 | [原任务](slices/B72-author-behavior-offline-corpus-expansion.md) |
| B27 | §9 CP0–CP3 done（同源供给声明、构造器矩阵、外部原生 Tauri+真实模型 M1/M2 cp3c PASS）；原 CP4 measured FAIL/known-gap 与第二方复核仍按作者裁决保留，不重启全量 retest | [原任务](slices/B27-systematic-prompt-and-intent-integration.md) |
| B48 | 无变化普通说明、真正歧义才追问；依赖 B43 裁决同源，完成四场景验收 | [原任务](slices/B48-character-revision-noop-and-ambiguity.md) |
| B40-C06 | CP0 核定旧 fallback 退役及现有纠错/最终失败的替代覆盖；随后同步 registry 并验页面，不只删除旧场景 | [原任务小节](slices/B40-judgment-era-acceptance-reanchor.md#13-候选失败策略裁决材料) |
| B46 | CP0 核对 pending 事实源、版本和恢复；沿原 slice 完成持久待处理入口及跨会话采纳 | [原任务](slices/B46-persistent-adoption-inbox.md) |
| AU09-EVOLUTION | 采纳角色演化后新会话请求/Why 的真实召回与终态过滤；复用 B64 坐标规则 | [原任务小节](slices/AU09-memory-taxonomy-write-policy.md#cp2-角色演化记忆的真实召回) |
| B58 | CP0 对账现有 receipt/trace 与批准语义；缺口成立后才冻结最小契约，不先建新实体 | [原任务](slices/B58-human-approval-policy-unification.md) |
| VS00F-TRACE | 核对章摘要/账面维护的真实变更与 StateTrace；闭合自动/作者变更、幂等、回滚及持久回放 | [原任务小节](slices/VS-00F-five-ledgers-three-state.md#维护-statetrace-后续-checkpoint) |
| B57 | CP0 准备现有作者输入/作品观察对抗矩阵；求证与外部资料部分等对应入口，实模另按资源安排 | [原任务](slices/B57-sec-injection-boundary.md) |
| AU04-AU06 | 核对 T16 的现役确认生产者、终态历史、持久绑定及恢复范围；与 B43/B58 去重后补页面矩阵 | [原任务](slices/AU04-AU06-author-action-binding.md) |
| AU08-REFRESH | 核对现役四态与失败/重试/旧内容口径，补真实页面恢复和零权威写入矩阵 | [原任务小节](slices/AU08-file-level-closure.md#阅读投影状态与失败恢复补验) |
| AU10-FAILED | 核对真实导出失败生产者，补 FAILED 首屏、恢复/新请求及输出完整性证据 | [原任务小节](slices/AU10-workbench-recovery-taskstate.md#failed-任务状态真实页面补验) |
| AU10-MATRIX | 核对当前卡片/动作结果、未知/失效/跨作品与视口矩阵，按 owner 去重后补消费证据 | [原任务小节](slices/AU10-file-level-closure.md#现役动作与卡片矩阵核对) |
| AU07-P1 | 核对 developer 权限、多类型 replay、原因目录与 registry snapshot 的真实消费者；与 B43/VS-00F/B39 去重 | [原任务小节](slices/AU07-trace-replay-integrity.md#p1-消费者与余项核对) |
| UA01-PROMPT-T3T5 | 按当前单调用及 ADR-0031 核对修订尾部、finding 保真与计划面板 N-NARR；按现役消费者接续 | [原任务小节](slices/UA01-agentic-loop-prompt-hardening.md#t3-t5-当前语义审计与承接) |
| B71 | CP1 冻结 AgentRun 原生多轮 Request IR、工具/观察/候选与 provider 投影；先处理目标设计与现役 ADR 差异，不以现状降低目标 | [原任务](slices/B71-provider-message-fidelity.md) |
| VS-00G | 核对 CP5e A2/A3 历史证据与当前版本，明确 scoped 补验；触发 C/记忆富化与 B39 协同 | [原任务](slices/VS-00G-fact-inventory-run.md) |
| CA04-B15 | 核对卷蓝图增量后的三条 carry 行为、诚实缺席与未开放门；沿既有页面驱动补验 | [原任务小节](slices/CA04-carry-gap-closure.md#7-b15-卷蓝图增量回归) |
| Q1C-NATIVE | 核对原生 driver，补设定修订→覆盖→刷新→追问链；保留 browser 历史，不重复实现修订 | [原任务小节](slices/Q1C-adopted-content-revision.md#q1c-原生页面补验) |
| P1-AUDIT-BC | 核对重复段/章、计划与采纳来源和 ReadingMode；冻结缺章率口径，闭合展示与报告一致性 | [原任务小节](slices/P1-word-count-audit.md#checkpoint-b-c未做slice-内后续非范围外) |
| AU03-SEARCH | 核对历史搜索命中 turn 身份、分页定位与高亮；保持历史只读和作品隔离 | [原任务小节](slices/AU03-file-level-closure.md#历史搜索命中定位与只读回看) |
| UA01-LOG-B13 | 只读核对 run_failed 与三源日志的关联键及失败链，依实际缺口补验；vendor live 单独核凭据/资源 | [原任务小节](slices/UA01-provider-execution-stream-unification.md#10-b13-运行失败日志关联) |
| SU04-LIFECYCLE | 核对 sidecar 启动/迁移失败、就绪与退出状态，冻结故障恢复/无孤儿矩阵 | [原任务小节](slices/SU04-desktop-sidecar-packaging.md#现役故障与生命周期契约核对) |
| AU12-WRITEBACK | CP0 准备立项字段/显式提案/版本与采纳落位契约；后续档案和模型消费同源 | [原任务小节](slices/AU12-correction-intent-roundtrip.md#p2-立项修订的采纳落位与同源消费) |
| AU09-DIRECTION | 准备长期方向的类型、并存/替换、有效范围与废弃方案，具体接受前不写记忆 | [原任务小节](slices/AU09-work-direction-memory-recall.md#6-当前契约与裁决材料准备) |
| B66-PREP | CP0 准备本地快照/恢复范围、一致性、敏感文件和覆盖/回滚选项；不操作作者数据 | [原任务小节](slices/B66-local-workspace-backup-restore.md#cp0-最小本地快照恢复契约准备) |
| B51 | CP0/CP1 核对依赖、引用及 PaperTrail 存量/消费者；形成去留材料，后续规范修订不倒装依赖 | [原任务](slices/B51-tech-stack-current-rebase.md) |

## 阻塞

- **B01 后续**：CP0 done；origin_frame_ref 为合成串，CP1 需 A（新增 nullable origin_turn_ref + origin_frame_ref 可空，推荐）/B（origin_ref_kind + turn:<id>）/C（保持 known-gap）之一；涉及 SQLite 表重建/历史兼容，待作者授权 migration，未改 schema/DB。见 [B01 小节](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)。
- **B43 后续**：CP0/CP1 done；CP2 Form R 出口/Replay 同源已落地；**MissingPolicy 在 Gate 之后才评估**，统一门序涉及 ADR-0005 gate 集合与验收判据，需作者/ADR owner 在 A（新增 missing_policy gate，推荐）/B（decide 前 preflight）/C（仅标注）/D（只覆盖 prose flow）间裁决；CP3/CP4 未开工，见 [B43](slices/B43-gate-order-residual.md)。
- **B67 后续**：CP0/CP1 done；CP2 revision CAS/重编号/旧任务晚到已落地，但维护 StateTrace 依赖 [VS00F-TRACE](slices/VS-00F-five-ledgers-three-state.md#维护-statetrace-后续-checkpoint) owner 先冻结生产/存储/回放契约；CP3 页面矩阵未开工，见 [B67](slices/B67-revision-aware-ledger-maintenance.md)。
- **B65 后续**：CP0–CP2 done；真实 Tauri 正常链/恢复重连/隔离 HTTP+WS probe PASS；release 打包自定义协议 Origin 缺采集环境（packaged Tauri + 外部代理），CP3 未关闭，见 [B65](slices/B65-local-http-websocket-origin-boundary.md)。
- **B64 实模后续**：CP0–CP2 done，CP3 确定性真实 Tauri 矩阵 PASS；真实模型一次 `judgment_protocol_violation` 失败（只读、未重试），待判断协议处理/作者裁决后再预注册复验，见 [B64](slices/B64-coordinate-aware-memory-consumption.md)。
- **B39 实模后续**：CP1 机制/模型与 B74–B76 UI 已收口；D6-A setup 第01章成立、第02章候选区 AX 定位同因失败停止；正式 AU-15 待 setup 稳定性修复 + 作者/指定评审，见 [B39](slices/B39-evidence-seeking-authoring.md)。
- **待材料｜PaperTrail 去留**：先完成版本存量与真实消费者的只读核对，再提交去留裁决，见 [B51](slices/B51-tech-stack-current-rebase.md)。
- **条件触发｜独立多 Agent / 24x7**：当前延期，重新开放条件见 [B50 §6.1](slices/B50-multi-agent-current-boundary.md#61-延期实施与重新开放)。
- **验收前置｜AU-15 真实运行**：待 B39 产品/driver 接线、预注册及模型窗口；设计接受前置已解除，见 [B42 CP4](slices/B42-model-behavior-evidence-tier.md#10-cp4blocked-登记不执行不代签)。
- **延期触发｜I10 盲评**：B39 第一批真实样本后再核可比性并安排人工评审，见 [I10 安排](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排)；AI 不代签文学质量。
- **数据授权／外部条件**：stage 存量修复须单独授权，见 [B28](slices/B28-whole-chapter-revision.md)；其余条件见 [既有对账 §7](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)。
- **条件触发**：世界规则保存问题仅真实产品链复现/作者请求后启动，见 [B38](slices/B38-world-rule-save-intent.md)。
- **实模／人工条件**：[B27](slices/B27-systematic-prompt-and-intent-integration.md) 的定向实模与第二方复核、[叙述体裁走查](slices/UA01-codex-style-narrative-alignment.md)、[Provider vendor live](slices/UA01-provider-execution-stream-unification.md) 各按资源/评审安排，历史凭据缺失须重新核实；不阻塞各自可独立准备的步骤。
- **契约准备后裁决**：[创作方向持久化](slices/AU09-work-direction-memory-recall.md) 的类型/多方向生命周期、[立项修订落位](slices/AU12-correction-intent-roundtrip.md#p2-立项修订的采纳落位与同源消费)、[本地备份恢复](slices/B66-local-workspace-backup-restore.md#cp1-之后的实施与验收) 的具体方案须先可审阅再接受；各自准备步骤已入候选。
- **条件触发｜Experience Engine**：经验来源、审阅、规则生命周期与后续消费统一归 [B68](slices/B68-experience-rule-governance.md)；真实复用需求与具体契约明确后再开放，当前保持延期。
