# NEXT

> 本轮仅整理文档与排期；状态与决策以原任务为准，规则见 [tasks/README](README.md)。每次完成或受阻后运行 `node scripts/next_task_check.mjs --open` 复核并补位；本轮扩展依据见 [全量对账 §17](2026-10-27-design-to-execution-reconciliation.md#17-2026-10-30-元原则整改任务与排期梳理)。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B70 | CP0 已完成（五类格式冻结 + validator/CLI/正反例 + 复用映射 + 首批 F1/F2/F3×S1/S2/S3 9 cases 与负例）；下一步 CP1：最少 3 目标族数据驱动闭环（多表达/多状态/歧义负例）+ 共享外部 UI driver + 自动硬断言/oracle 变异证明 + verdict/覆盖报告 | [原任务](slices/B70-author-behavior-corpus-and-state-exploration.md) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B27 | §9 CP0 已完成；下一步 CP1：由同一渲染事实派生 supplied/available-not-supplied，接 reply_record/trace，并补红测；现有工作区修改保持不动 | [原任务](slices/B27-systematic-prompt-and-intent-integration.md) |
| B39 | CP1 正文求证与逐次模型输入证据；后续准备/恢复/迁移仍按完整 slice 验收 | [原任务](slices/B39-evidence-seeking-authoring.md) |
| B64 | CP0 核对旧章/新章记忆有效窗；真实目标贯穿 recall、writer/evaluator，保留历史查询语义 | [原任务](slices/B64-coordinate-aware-memory-consumption.md) |
| B47-C07 | 角色持久层整对象指纹、原子性与真实重复请求幂等；其它残余仍留原任务 | [原任务小节](slices/B47-canon-freshness-and-conflict-detection.md#101-角色持久层过期策略裁决材料) |
| B65 | CP0 核对 dev/stage/release 的 HTTP/WS 来源矩阵；修正伪本机前缀风险，鉴权范围另冻结 | [原任务](slices/B65-local-http-websocket-origin-boundary.md) |
| B67 | CP0 复核旧章修订/移除贡献的账面反例；冻结重算、来源版本和作者裁决保护 | [原任务](slices/B67-revision-aware-ledger-maintenance.md) |
| B43 | CP0 与 B45 对齐统一裁决的生产、转换、校验、返回/trace/回放映射；B01 提供真实来源，保留幂等与阻断完整范围 | [原任务](slices/B43-gate-order-residual.md) |
| B45 | CP0 交付38份 schema 的字段/状态→生产→转换→校验→消费/历史映射；逐项处置13个部分承接项，与 B43 协同 | [原任务](slices/B45-schema-legacy-governance.md) |
| B01 | 真实入口来源贯穿生成、存储、trace/回放；保留原 judgment/frame/plan 语义边界范围 | [原任务小节](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界) |
| DS01-RUN-STATE | 首批运行状态链：核对现役 wire 与恢复权限，补 schema/codegen/safeParse 和 live/dead/unknown 正反例 | [原任务小节](slices/DS01-decision-surface-schema-gate.md#9-ds03-agent_run_state-schema-承接) |
| VS00F-B06 | 首批五账链：明确领域信封到面板 DTO 的字段投影、分账状态/载荷、运行时校验与历史读取 | [原任务小节](slices/VS-00F-five-ledgers-three-state.md#b06-分账契约与真实消费-checkpoint) |
| B42-PREP | 准备 AU-15 setup/测量分账、预注册与 driver/verifier；真实运行仍待 B39 接线和资源窗口 | [原任务小节](slices/B42-model-behavior-evidence-tier.md#101-au-15-预注册与-driver-准备) |
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

- **待材料｜PaperTrail 去留**：先完成版本存量与真实消费者的只读核对，再提交去留裁决，见 [B51](slices/B51-tech-stack-current-rebase.md)。
- **条件触发｜独立多 Agent / 24x7**：当前延期，重新开放条件见 [B50 §6.1](slices/B50-multi-agent-current-boundary.md#61-延期实施与重新开放)。
- **验收前置｜AU-15 真实运行**：待 B39 产品/driver 接线、预注册及模型窗口；设计接受前置已解除，见 [B42 CP4](slices/B42-model-behavior-evidence-tier.md#10-cp4blocked-登记不执行不代签)。
- **延期触发｜I10 盲评**：B39 第一批真实样本后再核可比性并安排人工评审，见 [I10 安排](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排)；AI 不代签文学质量。
- **数据授权／外部条件**：stage 存量修复须单独授权，见 [B28](slices/B28-whole-chapter-revision.md)；其余条件见 [既有对账 §7](slices/VS00D-G-GAP-RECONCILIATION.md#7-条件项与未关闭后果)。
- **条件触发**：世界规则保存问题仅真实产品链复现/作者请求后启动，见 [B38](slices/B38-world-rule-save-intent.md)。
- **实模／人工条件**：[B27](slices/B27-systematic-prompt-and-intent-integration.md) 的定向实模与第二方复核、[叙述体裁走查](slices/UA01-codex-style-narrative-alignment.md)、[Provider vendor live](slices/UA01-provider-execution-stream-unification.md) 各按资源/评审安排，历史凭据缺失须重新核实；不阻塞各自可独立准备的步骤。
- **契约准备后裁决**：[创作方向持久化](slices/AU09-work-direction-memory-recall.md) 的类型/多方向生命周期、[立项修订落位](slices/AU12-correction-intent-roundtrip.md#p2-立项修订的采纳落位与同源消费)、[本地备份恢复](slices/B66-local-workspace-backup-restore.md#cp1-之后的实施与验收) 的具体方案须先可审阅再接受；各自准备步骤已入候选。
- **条件触发｜Experience Engine**：经验来源、审阅、规则生命周期与后续消费统一归 [B68](slices/B68-experience-rule-governance.md)；真实复用需求与具体契约明确后再开放，当前保持延期。
