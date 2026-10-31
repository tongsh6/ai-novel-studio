# NEXT

> 本轮仅整理文档与排期；状态与决策以原任务为准，规则见 [tasks/README](README.md)。每次完成或受阻后运行 `node scripts/next_task_check.mjs --open` 复核并补位；本轮扩展依据见 [全量对账 §17](2026-10-27-design-to-execution-reconciliation.md#17-2026-10-30-元原则整改任务与排期梳理)。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|


## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|

## 阻塞

- **AU12-WRITEBACK 页面收口**：工具/协议/候选/采纳/概览/API/新会话消费 PASS；`task_done` 要求 `surface: tauri`，现外部 driver 只能 `surface: browser`（真实 Tauri 窗口已启动但非 webview 驱动），原生 webview/CUA driver 未就绪；见 [AU12](slices/AU12-correction-intent-roundtrip.md#p2-立项修订的采纳落位与同源消费)。
- **B27**：CP0–CP3 done；CP4 measured FAIL/known-gap 与第二方复核待作者裁决/实模窗口，见 [B27](slices/B27-systematic-prompt-and-intent-integration.md)。
- **B48**：依赖 B43 裁决同源，四场景验收待 B43 门序裁决后启动，见 [B48](slices/B48-character-revision-noop-and-ambiguity.md)。
- **B72 CP1**：缺离线生成器实现与真实模型窗口；见 [B72](slices/B72-author-behavior-offline-corpus-expansion.md#阻塞记录2026-10-31-cp1)。
- **VS00F-TRACE CP1**：A（推荐持久 StateTrace，需 schema 授权）/B（明确 no-trace 边界）/C（延期）；见 [VS00F](slices/VS-00F-five-ledgers-three-state.md#cp0-盘点2026-10-31)。
- **B57 CP1 B/C/D**：需 B39/UA01 受控观察/外部资料 fixture；A/E/F 已 PASS；见 [B57](slices/B57-sec-injection-boundary.md#阻塞记录2026-10-31)。
- **AU08-REFRESH CP1**：需 channel 级 get_toc/get_chapter_content 故障注入代理；见 [AU08](slices/AU08-file-level-closure.md#cp1-阻塞记录2026-10-31)。
- **AU10-FAILED CP1**：缺真实页面确定性失败触发（不增验收开关）；见 [AU10](slices/AU10-workbench-recovery-taskstate.md#failed-cp0-盘点2026-10-31)。
- **UA01-PROMPT-T3T5**：T4 局部完成；T5 需 schema/迁移 A/B/C；D2 driver 超时；见 [UA01](slices/UA01-agentic-loop-prompt-hardening.md#阻塞记录2026-10-31)。
- **B71 CP1**：需修订/supersede ADR-0030/0031；A（推荐）/B additive/C 延期；见 [B71](slices/B71-provider-message-fidelity.md#cp1-阻塞记录2026-10-31)。
- **Q1C-NATIVE**：Q1c 无 Tauri 原生 driver 入口，不能以 browser summary 代签；见 [Q1C](slices/Q1C-adopted-content-revision.md#原生补验-cp0阻塞记录2026-10-31)。
- **P1-AUDIT-BC 页面**：两次 stale projection banner 断言失败，属 AU08 缺口；见 [P1](slices/P1-word-count-audit.md#checkpoint-b-c未做slice-内后续非范围外)。
- **UA01-LOG-B13**：无外部最终 run_failed 触发；AU04 失败场景自身漂移；见 [UA01](slices/UA01-provider-execution-stream-unification.md#b13-cp0-只读核对2026-10-31)。
- **SU04-LIFECYCLE**：实现完成；release 打包外部故障 harness 缺失；见 [SU04](slices/SU04-desktop-sidecar-packaging.md#现役故障与生命周期契约核对)。
- **B01 后续**：需 A（推荐 nullable origin_turn_ref）/B/C 与 migration 授权；见 [B01](2026-10-27-design-to-execution-reconciliation.md#b01-入口来源与语义边界)。
- **B43 后续**：MissingPolicy 门序需 A（推荐）/B/C/D 裁决；见 [B43](slices/B43-gate-order-residual.md)。
- **B67 后续**：维护 StateTrace 依赖 VS00F-TRACE 先冻结；见 [B67](slices/B67-revision-aware-ledger-maintenance.md)。
- **B65 后续**：release 打包 Origin 采集环境缺失；见 [B65](slices/B65-local-http-websocket-origin-boundary.md)。
- **B64 实模**：一次 judgment_protocol_violation 失败待裁决；见 [B64](slices/B64-coordinate-aware-memory-consumption.md)。
- **B39 实模**：setup 第02章候选区 AX 同因失败停止；见 [B39](slices/B39-evidence-seeking-authoring.md)。
- **B51 材料**：PaperTrail 存量/消费者只读核对后再裁决；见 [B51](slices/B51-tech-stack-current-rebase.md)。
- **延期/条件**：多 Agent/24x7 [B50](slices/B50-multi-agent-current-boundary.md#61-延期实施与重新开放)；AU-15 [B42](slices/B42-model-behavior-evidence-tier.md#10-cp4blocked-登记不执行不代签)；I10 盲评 [安排](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排)；stage 修复需授权 [B28](slices/B28-whole-chapter-revision.md)；B38/Experience [B38](slices/B38-world-rule-save-intent.md)/[B68](slices/B68-experience-rule-governance.md)。
