# NEXT

> 本轮仅整理文档与排期；状态与决策以原任务为准，规则见 [tasks/README](README.md)。每次完成或受阻后运行 `node scripts/next_task_check.mjs --open` 复核并补位；本轮扩展依据见 [全量对账 §17](2026-10-27-design-to-execution-reconciliation.md#17-2026-10-30-元原则整改任务与排期梳理) 与 [2026-10-31 队列审计报告](../../artifacts/queue-audit/2026-10-31-audit.md)。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B71-CP4b | 确定性+原生核心已收口：§16.14 确认/拒绝双路径 clean PASS（01i/02c/01k2/02e2）、pending 08 原生 77/77、CP3b 实模协议层机制 10/10+G1–G5、行为覆盖 pilot（01c2 PASS/#6 真实模型失败）、显示名机制 P0+P1（真实页面全类别扫描零命中）、压缩 A 方案（§18 Accepted、阶段 4/5、自动维护启用）。剩余：A3 压缩自动维护 AX（driver 实现中）、完整 G1–G6/I10 不代签项、Pencil PNG 环境限制、CP5 最终收口 | [B71](slices/B71-provider-message-fidelity.md) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B79 | 存量书稿导入 + 导入后分析建档（导入 txt/md/粘贴→自动切分落库；分析六类直接写档案、批次可撤销；大纲/卷落现有 schema、无卷划分不产卷信息；覆盖=软替换）。可先独立推进 CP0 契约冻结与 CP1 确定性导入链，不依赖 B71 收口；CP3/CP4 分析长跑需真实模型窗口 | [B79](slices/B79-work-import-and-analysis.md) |
| B78 | 存量大模块拆分（P1：WorkspaceChat / dialogue_planning_service / agent_run_server / turn_execution_service / adoption_repository）；治理机制与 ratchet 门禁已落地，本任务只做结构化拆分，须在 B71 收口后按「一次一个文件、独立 refactor commit」排期 | [B78](slices/B78-module-size-debt.md) |

## 阻塞

- **B72 离线生成器质量门**：离线生成器/manifest/persona 已实现且契约测试 12/12，但 mutation 两轮后 51.5%、111 survivors；真实模型校准未授权。待 A（推荐：专门 mutation 测试预算/负责人）/B（保留 known-gap）/C（进一步拆分实现）；见 [B72](slices/B72-author-behavior-offline-corpus-expansion.md#可独立推进-离线生成器契约2026-10-31)。
- **UA01 B13 完整失败矩阵**：独立 run_failed 触发与三源 join 已原生 8/8 done；独立 DecisionTrace、真实供应商、取消/恢复/跨作品及 AU04 漂移仍未闭环；见 [UA01](slices/UA01-provider-execution-stream-unification.md#可独立推进-受控最终-run_failed-触发2026-10-31)。
- **AU08 原生故障恢复**：两批预注册预算耗尽，无原生 summary；parent_ref 关联已修并有单测但未复验。待作者选择 A（推荐：新 scoped 预算只重放单链）/B（暂缓并推进其他候选）；见 [AU08](slices/AU08-file-level-closure.md#原生批次预算耗尽2026-10-31)。
- **Q1C 原生补验**：原生批次已超过预注册上限，停止重试；待作者选择 A（推荐：新启动诊断预注册与 scoped 预算）/B（暂缓，保留 browser 边界）/C（更大 harness 改造授权）；见 [Q1C](slices/Q1C-adopted-content-revision.md#原生补验-s1s4-预算耗尽与暂停2026-10-31)。
- **SU04 外部后续**：CP1 与真实 release app 四场景已 done；签名/公证（需 Apple 证书）、Intel/Windows/Linux CI 真实跑通、失败分类外部 AX 渠道改进为条件后续；见 [SU04](slices/SU04-desktop-sidecar-packaging.md#cp1-缺陷修复与四场景复验2026-10-31收口)。
- **UA01 T3′**：校验模式接入尝试回退；待作者选择 A（推荐：维持完整计划契约，适配 fixture 后接入）/B（支持只产尾部，需 cursor 协同）/C（known-gap）；见 [UA01](slices/UA01-agentic-loop-prompt-hardening.md#t3-第二次尝试校验模式与暂停2026-10-31)。
- **B27 CP4 语义**：确定性负例矩阵已冻结（`artifacts/model-contracts/b27-cp4-hardening/negative-matrix.json`，确定性侧无机械可修缺口）；模型语义 known-gap 关闭需实模预注册窗口 + 第二方复核；见 [B27](slices/B27-systematic-prompt-and-intent-integration.md)。
- **B72 CP1 模型窗口**：离线生成器已入候选，真实模型资源窗口与生成预算未授权；见 [B72](slices/B72-author-behavior-offline-corpus-expansion.md#阻塞记录2026-10-31-cp1)。
- **VS00F-TRACE CP1**：A（推荐持久 StateTrace，需 schema 授权）/B（明确 no-trace 边界）/C（延期）；见 [VS00F](slices/VS-00F-five-ledgers-three-state.md#cp0-盘点2026-10-31)。
- **B57 CP1 B/C/D**：需 B39/UA01 受控观察/外部资料 fixture 与数据授权；A/E/F 已 PASS；见 [B57](slices/B57-sec-injection-boundary.md#阻塞记录2026-10-31)。
- **UA01-PROMPT-T5**：T5 需 schema/迁移 A/B/C 裁决；D2 driver 超时；T3 已入候选；见 [UA01](slices/UA01-agentic-loop-prompt-hardening.md#阻塞记录2026-10-31)。
- **P1-AUDIT-BC 页面**：两次 stale projection banner 断言失败，依赖 AU08 投影新鲜度缺口或断言重锚；见 [P1](slices/P1-word-count-audit.md#checkpoint-b-c未做slice-内后续非范围外)。
- **B01 后续**：需 A（推荐 nullable origin_turn_ref）/B/C 与 migration 授权；见 [B01](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)。
- **B43 后续**：MissingPolicy 门序需 A（推荐）/B/C/D 裁决（工程依赖，不阻塞 B48 CP0）；见 [B43](slices/B43-gate-order-residual.md)。
- **B67 后续**：维护 StateTrace 依赖 VS00F-TRACE 先冻结；见 [B67](slices/B67-revision-aware-ledger-maintenance.md)。
- **B65 后续**：release 打包 Origin 采集环境缺失；见 [B65](slices/B65-local-http-websocket-origin-boundary.md)。
- **B64 实模**：一次 judgment_protocol_violation 失败待裁决；见 [B64](slices/B64-coordinate-aware-memory-consumption.md)。
- **B39 重锚**：目标实现由 B71 CP3/CP4 承接；原 setup 第02章候选区 AX 同因失败记录只读保留，不再单独驱动实现；见 [B39](slices/B39-evidence-seeking-authoring.md)。
- **AU10-FAILED**：缺真实页面确定性失败触发（产品外 fixture/原生目录替身可先构造，真实页面证据仍需窗口）；见 [AU10](slices/AU10-workbench-recovery-taskstate.md#failed-cp0-盘点2026-10-31)。
- **B71 CP3b**：CP3a 确定性接线已入候选（不缩小 CP3 范围）；CP3b 需真实 Tauri 原生窗口 + 实模资源窗口与预算，属资源型等待而非决策阻塞；预注册 `artifacts/model-contracts/b71-cp1/scenario-preregistration.json`；见 [B71](slices/B71-provider-message-fidelity.md#cp3b-实模窗口验收2026-10-31)。
- **B48 CP3**：CP0–CP2 done；CP3 需真实模型/原生 runtime 窗口 + native driver 前置，预注册 `artifacts/b48-cp3/preregistration.json`；见 [B48](slices/B48-character-revision-noop-and-ambiguity.md)。
- **延期/条件**：多 Agent/24x7 [B50](slices/B50-multi-agent-current-boundary.md#61-延期实施与重新开放)；AU-15 [B42](slices/B42-model-behavior-evidence-tier.md#10-cp4blocked-登记不执行不代签)；I10 盲评 [安排](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排)；stage 修复需授权 [B28](slices/B28-whole-chapter-revision.md)；B38/Experience [B38](slices/B38-world-rule-save-intent.md)/[B68](slices/B68-experience-rule-governance.md)。
## 双向沟通过隙优化（2026-11-04 审核后）

- 审核真源：[`artifacts/review-bidirectional/SUMMARY.md`](../artifacts/review-bidirectional/SUMMARY.md)（4 名独立审核员 + Lead 交叉复核；L1–L4a 成立、L4b blocked）。
- 优化计划：[`slices/bidirectional-gaps-optimization.md`](slices/bidirectional-gaps-optimization.md)——批次 A（传输层死协议清理）/ B（compact_transcript 入口）/ C（跨重启 HITL 恢复）/ D（验收基线补门）/ E（P2 健壮性）；每批独立 commit + 全量门禁。
- 边界：L4b 真实模型语义不代签；Phase 0 无鉴权为设计边界；不新增产品面。

