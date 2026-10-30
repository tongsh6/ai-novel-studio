# NEXT

> 本轮仅整理文档与排期；状态与决策以原任务为准，规则见 [tasks/README](README.md)。每次完成或受阻后运行 `node scripts/next_task_check.mjs --open` 复核并补位；本轮扩展依据见 [全量对账 §17](2026-10-27-design-to-execution-reconciliation.md#17-2026-10-30-元原则整改任务与排期梳理)。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| SU04-LIFECYCLE | CP0 done：已冻结解包 marker/就绪/迁移/端口/退出孤儿缺口矩阵；CP1 修复与真实打包应用故障复验待做 | [原任务小节](slices/SU04-desktop-sidecar-packaging.md#现役故障与生命周期契约核对) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B27 | §9 CP0–CP3 done（同源供给声明、构造器矩阵、外部原生 Tauri+真实模型 M1/M2 cp3c PASS）；原 CP4 measured FAIL/known-gap 与第二方复核仍按作者裁决保留，不重启全量 retest | [原任务](slices/B27-systematic-prompt-and-intent-integration.md) |
| B48 | 无变化普通说明、真正歧义才追问；依赖 B43 裁决同源，完成四场景验收 | [原任务](slices/B48-character-revision-noop-and-ambiguity.md) |
| VS-00G | 核对 CP5e A2/A3 历史证据与当前版本，明确 scoped 补验；触发 C/记忆富化与 B39 协同 | [原任务](slices/VS-00G-fact-inventory-run.md) |
| AU12-WRITEBACK | CP0 准备立项字段/显式提案/版本与采纳落位契约；后续档案和模型消费同源 | [原任务小节](slices/AU12-correction-intent-roundtrip.md#p2-立项修订的采纳落位与同源消费) |
| AU09-DIRECTION | 准备长期方向的类型、并存/替换、有效范围与废弃方案，具体接受前不写记忆 | [原任务小节](slices/AU09-work-direction-memory-recall.md#6-当前契约与裁决材料准备) |
| B66-PREP | CP0 准备本地快照/恢复范围、一致性、敏感文件和覆盖/回滚选项；不操作作者数据 | [原任务小节](slices/B66-local-workspace-backup-restore.md#cp0-最小本地快照恢复契约准备) |
| B51 | CP0/CP1 核对依赖、引用及 PaperTrail 存量/消费者；形成去留材料，后续规范修订不倒装依赖 | [原任务](slices/B51-tech-stack-current-rebase.md) |

## 阻塞

- **B72 CP1**：CP0 设计 done；CP1 需要离线生成器实现 + 真实模型 ≤60 校准/核心批次，当前无实现与模型资源窗口（未加载模型、未改 corpus），待作者/指定实现者提供生成器与预算后解除，见 [B72](slices/B72-author-behavior-offline-corpus-expansion.md#阻塞记录2026-10-31-cp1)。
- **VS00F-TRACE CP1 裁决**：CP0 已确认 adoption 仅 summary-level `state_trace_refs`、LedgerMaintenance 无 StateTrace。选项：A（推荐）新增最小持久 StateTrace/mutation receipt（work/chapter/turn、before/after digest、source refs、幂等），需 schema/迁移授权；B 明确 maintenance 只承诺业务日志+ledger revision/source_refs，不承诺逐条 trace 并关闭本债；C 延期。未裁决前不建实体、不改验收边界，见 [VS00F-TRACE](slices/VS-00F-five-ledgers-three-state.md#cp0-盘点2026-10-31)。
- **B57 CP1 B/C/D**：A/E/F 真实 Tauri PASS；B 内容夹带/C 观察夹带/D 伪完成需要 B39/UA01 observation/外部资料受控 fixture 入口或作者授权测试数据，当前入口未就绪，未加产品钩子；解除后补全矩阵，见 [B57](slices/B57-sec-injection-boundary.md#阻塞记录2026-10-31)。
- **AU08-REFRESH CP1**：CP0 done；真实页面失败/重试/跨作品矩阵需要按 channel 请求注入 `get_toc`/`get_chapter_content` 失败的通用外部代理，当前 harness 只有消息投递故障代理；未伪造故障、未停后端。解除后补 CP1，见 [AU08](slices/AU08-file-level-closure.md#cp1-阻塞记录2026-10-31)。
- **AU10-FAILED CP1**：CP0 盘点完成；失败 producer/前端错误投影存在，但真实页面无法确定性触发（空作品导出按钮隐藏、原生目录选择不可控、无 export 写失败代理）；不新增验收开关，登记阻塞，见 [AU10](slices/AU10-workbench-recovery-taskstate.md#failed-cp0-盘点2026-10-31)。
- **UA01-PROMPT-T3T5**：T4 finding 结构渲染已完成（局部测试）；D2 页面 driver 超时、T5 provenance 需 schema/迁移 A/B/C 裁决、T3 前缀校验待；未重复盲跑、未改 schema。解除后补页面与 provenance，见 [UA01](slices/UA01-agentic-loop-prompt-hardening.md#阻塞记录2026-10-31)。
- **B71 CP1**：CP0 完成；CP1 目标 Request IR/原生多轮需修订或 supersede ADR-0030/0031 与 UA-01/VS-00I，涉及 ADR 裁决，AI 不自行改协议。选项 A（推荐，正式修订/supersede 目标）/B（现役 additive 实验，不改 ADR）/C（延期）；未裁决前不改代码/契约，见 [B71](slices/B71-provider-message-fidelity.md#cp1-阻塞记录2026-10-31)。
- **Q1C-NATIVE**：Q1c 场景注册为 browser surface，无 Tauri 原生 driver 入口；不能把 browser summary 当原生证据，未伪造/未重写修订链。解除条件=接原生 Q1c 外部 driver 并留当前 HEAD 原生事实，见 [Q1C](slices/Q1C-adopted-content-revision.md#原生补验-cp0阻塞记录2026-10-31)。
- **P1-AUDIT-BC 页面**：CP0/CP1 实现/artifact writer 完成；真实 Tauri 场景两次在同一 stale projection banner 断言失败（服务端 STALE 未被 ReadingMode 消费，属 AU08 已登记缺口），按预算停止；未放宽断言。解除依赖=AU08 投影新鲜度消费修复/口项确认后重锚，见 [P1](slices/P1-word-count-audit.md#checkpoint-b-c未做slice-内后续非范围外)。
- **UA01-LOG-B13**：CP0 只读 done；现无外部场景把 run 驱动到最终 run_failed，AU04 provider 失败场景复跑超时（自身漂移）；需受控失败触发+同 run/turn 三源关联补验，未改代码/日志，见 [UA01](slices/UA01-provider-execution-stream-unification.md#b13-cp0-只读核对2026-10-31)。
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
