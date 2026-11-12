# NEXT

> 本轮仅整理文档与排期；状态与决策以原任务为准，规则见 [tasks/README](README.md)。每次完成或受阻后运行 `node scripts/next_task_check.mjs --open` 复核并补位；本轮扩展依据见 [全量对账 §17](2026-10-27-design-to-execution-reconciliation.md#17-2026-10-30-元原则整改任务与排期梳理)。

## 当前任务

| 任务 | 说明 | 状态来源 |
|---|---|---|
| B71-CP4b | 承接 B82 的 G3/G5 补证与 Responses/Anthropic 实模证据（[B82](slices/B82-b71-golden-slice-evidence.md)）；B81 CP5 的 G6 证据已于 2026-11-11 复核（[B81 §12](slices/B81-session-canonical-authoring-history.md#12-2026-11-11-完成度复核)）；**实模窗口已由 Splash 解除（2026-11-13 全局授权，预注册 `scenario-preregistration-splash-20261113.json` 已冻结）**；B71 的 CP5 最终收口含契约/索引/台账回写。 | [B71](slices/B71-provider-message-fidelity.md) |

当前任务的双向沟通整改见 [原优化计划](slices/bidirectional-gaps-optimization.md)；批次 A–E 的执行状态与证据只在原计划维护，NEXT 不另建状态节。

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B78 | 存量大模块拆分（P1：WorkspaceChat / dialogue_planning_service / agent_run_server / turn_execution_service / adoption_repository）；治理机制与 ratchet 门禁已落地，本任务只做结构化拆分，须在 B71 收口后按「一次一个文件、独立 refactor commit」排期 | [B78](slices/B78-module-size-debt.md) |
| B79 | 存量书稿导入 + 导入后分析建档；**待作者确认启动**后按 [B79](slices/B79-work-import-and-analysis.md) CP0 契约冻结 → CP1 确定性导入链推进；B80 前置梳理已完成（2026-11-08）。 | [B79](slices/B79-work-import-and-analysis.md) |
| B82 | B71 G2/G3/G5 黄金切片证据补证 + Responses/Anthropic 实模（G6 移交 B81 CP5，不在本任务）；G2 done；**2026-11-13 作者选 A：Splash 补 G3/G5 Chat wire**；Responses/Anthropic 待官方凭证；每个切片独立冻结预注册、独立批次、如实登记。 | [B82](slices/B82-b71-golden-slice-evidence.md) |
| B84 | `novel_web` 慢测试收敛（193 tests/532s）+ 00f P2-E 剩余架构/测试债务；不缩小测试覆盖；与 B81 并行（测试前置层）。 | [B84](slices/B84-web-slow-tests-and-arch-debt.md) |
| B85 | 模型上下文窗口用户设置（UI 入口）：作者反馈「窗口不应写死、要开放给用户配置」；初始能力已落（`preferences.json` 的 `context_windows` + Tauri 启动注入 sidecar env，`044092df`），**设置页 UI 未做**（当前应用无系统设置菜单，唯一设置入口是模型供应商弹窗）。 | [B85](slices/B85-model-context-window-settings.md) |
| B87 | Issue #4 模型交互请求/响应投影治理：**仅登记计划，未开始实施**；R00 基线/边界核对可作为候选，R01 需原始请求证据；R02/R03 先核 B81 CP5/G6 与冻结契约，不重做 B71/B81 已实现内容。R10 为授权体系（风险等级/授权模式/critical/full 自动采纳），以 [VS-00M](../docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md) §3.4/§3.6 为设计输入。不得抢占 B81 当前队首。 | [B87](slices/B87-model-interaction-request-projection.md) |
| B86 | 模型材料与返回结构化（内部标识隔离）：作者指出根因「发给模型的数据没结构化、返回也不够结构化」——章节编号/名称/内容与内部 `chapter:<uuid>` 混在自然语言材料里，模型复述到作者可见正文（`cp5-real-05` 实模证据）。方案：材料结构化（ref 只进专用字段）+ tool schema 约束作者可见字段禁内部标识 + 作者可见出口统一 `AuthorVisible.Text` 投影；独立预注册验收。 | [B86](slices/B86-structured-model-materials-internal-ref-isolation.md) |

依赖排序（2026-11-13 更新）。B79 CP0/CP1 等待作者确认启动。B78 按原任务的 B71 依赖排期，B84 和 B71 后续候选的预注册准备可并行。B82 的独立批次条件见原任务，B83 阻塞于凭证。B81 已于 2026-11-11 复核 done（CP1–CP6，G6 证据见 [B81 §12](slices/B81-session-canonical-authoring-history.md#12-2026-11-11-完成度复核)）；B71 实模窗口已由 Splash 解除（2026-11-13 全局授权），收口仍依赖 B82 的 G3/G5 与 Responses/Anthropic 实模（后者仍需官方凭证），G2 与剩余 G 切片证据见 B71 与 B82 原任务。

## 阻塞

- **B83 vendor `stream_options.include_usage` 矩阵（2026-11-13 作者选 A）**：Splash 作为本地 vendor 补测 include_usage；OpenAI/Anthropic 官方凭证仍缺，未测项登记为未验证；矩阵结论不得用于伪造能力声明。见 [B83](slices/B83-vendor-stream-options-matrix.md)。
- **B72 作者行为语料扩增（2026-11-13 作者选 D）**：放弃离线规则扩增（mutation known-gap 只读保留，不再阻塞），转真实 LLM 语料扩增；Splash 全局授权用于 CP1 ≤60 校准，待冻结预注册后执行；生成≠冻结≠PASS。见 [B72](slices/B72-author-behavior-offline-corpus-expansion.md)。
- **UA01 B13 完整失败矩阵**：独立 run_failed 触发与三源 join 已原生 8/8 done；独立 DecisionTrace、真实供应商、取消/恢复/跨作品及 AU04 漂移仍未闭环；见 [UA01](slices/UA01-provider-execution-stream-unification.md#可独立推进-受控最终-run_failed-触发2026-10-31)。
- **AU08 原生故障恢复（2026-11-13 作者选 A）**：新 scoped 预注册只重放 parent_ref 修复后的单链（1 批/0 重试），预注册 `artifacts/model-contracts/au08-channel-fault/preregistration-scoped-single-chain-20261113.json` 已冻结，待真实 Tauri 页面执行；不整批刷分。见 [AU08](slices/AU08-file-level-closure.md)。
- **Q1C 原生补验（2026-11-13 作者选 A）**：新诊断预注册已冻结（1 诊断批 + 1 scoped replay，0 重试），先查 owned_native_window_process_exited 根因，再只重放失败类型单链；不整批刷分。见 [Q1C](slices/Q1C-adopted-content-revision.md)。
- **SU04 外部后续**：CP1 与真实 release app 四场景已 done；签名/公证（需 Apple 证书）、Intel/Windows/Linux CI 真实跑通、失败分类外部 AX 渠道改进为条件后续；见 [SU04](slices/SU04-desktop-sidecar-packaging.md#cp1-缺陷修复与四场景复验2026-10-31收口)。
- **UA01 T3′（2026-11-13 作者选 A）**：维持完整计划契约；把 slice_verify 修订 fixture 修正为「已完成前缀 + 尾部」后接入 `validate_completed_prefix/2`；不改 schema、不恢复 revised_tail。见 [UA01](slices/UA01-agentic-loop-prompt-hardening.md)。
- **B27 CP4 语义（2026-11-13 作者选 A）**：用 Splash 定向重跑 5 个 known-gap（M01r2/M02/M08r2/M16r1/M18r1）+ 第二方复核；不全量 retest、不改阈值/分母。预注册 `artifacts/model-contracts/b27-cp4-hardening/preregistration-splash-20261113.json` 已冻结。见 [B27](slices/B27-systematic-prompt-and-intent-integration.md)。
- **B72 CP1 模型窗口**：离线生成器已入候选，真实模型资源窗口与生成预算未授权；见 [B72](slices/B72-author-behavior-offline-corpus-expansion.md#阻塞记录2026-10-31-cp1)。
- **VS00F-TRACE CP1（2026-11-13 作者选 A）**：新增最小持久 StateTrace 实体；先冻结 schema/迁移设计并获授权，再实施；字段含 before/after、source refs、mutation receipt、idempotency key。见 [VS00F](slices/VS-00F-five-ledgers-three-state.md)。
- ~~B71 原生批次复验~~ **已于 2026-11-07 关闭**：`b71-first-consumer` 在 A1 收口后经 SliceVerify canonical IR 观察识别修复（`26824567`）取得 clean HEAD 真实页面 **19/19**（`artifacts/slice-verify/b71-first-consumer-tauri-native-b71-a1-03/`）；根因是 test-support 旧文本识别与 R1 canonical IR 不同步，产品当时进入 `no_progress_stopped` 的行为正确。实模/CP4b-2/CP5 仍不代签；证据与失败批次见 [B71](slices/B71-provider-message-fidelity.md) 原生批次验收状态小节。
- **B57 CP1 B/C/D（2026-11-13 作者选 A）**：授权受控 fixture/seed（隔离 DB），补内容夹带/观察夹带/伪完成三场景；A/E/F 已 PASS。见 [B57](slices/B57-sec-injection-boundary.md)。
- **P1-AUDIT-BC 页面**：两次 stale projection banner 断言失败，依赖 AU08 投影新鲜度缺口或断言重锚；见 [P1](slices/P1-word-count-audit.md#checkpoint-b-c未做slice-内后续非范围外)。
- **B01 后续（2026-11-13 作者选 A）**：新增 nullable `origin_turn_ref`、`origin_frame_ref` 改 nullable；SQLite 表重建 migration，旧合成值按 legacy 读取、不回填；待实施。见 [B01](2026-10-27-design-to-execution-reconciliation.md)。
- **B43 后续（2026-11-13 作者选 A）**：GateOrder 新增显式 `missing_policy` gate（ADR-0005 12→13 门）；六个 flow 与 TurnExecutionService 统一进门；待实施。见 [B43](slices/B43-gate-order-residual.md)。
- **B67 后续**：维护 StateTrace 依赖 VS00F-TRACE 先冻结；见 [B67](slices/B67-revision-aware-ledger-maintenance.md)。
- **B65 后续（2026-11-13 检查）**：release app 可冷启动（端口 4658 listen），但无 sudo 无法 tcpdump、sidecar 端口硬编码无法代理拦截；release Origin 外部采集仍缺手段，CP3 保持 blocked。见 [B65](slices/B65-local-http-websocket-origin-boundary.md)。
- **B64 实模（2026-11-13 作者选 B）**：用 Splash 按新预注册重跑一次 B64 CP3 真实模型消费；失败只读保留，仍失败则转 B39/B27 判断协议处理。见 [B64](slices/B64-coordinate-aware-memory-consumption.md)。
- **B39 重锚**：目标实现由 B71 CP3/CP4 承接；原 setup 第02章候选区 AX 同因失败记录只读保留，不再单独驱动实现；见 [B39](slices/B39-evidence-seeking-authoring.md)。
- **AU10-FAILED**：缺真实页面确定性失败触发（产品外 fixture/原生目录替身可先构造，真实页面证据仍需窗口）；见 [AU10](slices/AU10-workbench-recovery-taskstate.md#failed-cp0-盘点2026-10-31)。
- **B71 实模（2026-11-13 作者选 A）**：Splash 全局授权，预注册 `artifacts/model-contracts/b71-cp1/scenario-preregistration-splash-20261113.json` 已冻结；下一步跑 CP4b-2/G6。R2 预览确定性证据、Responses/Anthropic 凭证边界与 I10 不代签见 [B71](slices/B71-provider-message-fidelity.md)。
- **B48 CP3（2026-11-13 作者选 A）**：先实现 native_b48_drive/evidence 并注册 allowlist，再用 Splash 按新预注册跑四场景；预注册 `artifacts/b48-cp3/preregistration-splash-20261113.json` 已冻结。见 [B48](slices/B48-character-revision-noop-and-ambiguity.md)。
- **B28 stage 重复章根因（2026-11-13）**：stage work 在仓库 `data/*.sqlite3` 未检出（可能已删除），数据修复关闭；作者要求“为什么写了重复的章”在请求体重构（B87/VS-00M/B86）之后调查。见 [B28](slices/B28-whole-chapter-revision.md)。
- **B42 AU-15（2026-11-13 作者选 A）**：用 Splash 补 AU-15 预注册/driver，先跑 A0/A1/A2（每场景至少 2 次独立重复）；预注册 `artifacts/model-contracts/b42-au15/preregistration-splash-20261113.json` 已冻结。见 [B42](slices/B42-model-behavior-evidence-tier.md)。
- **B38 世界规则保存意图（2026-11-13）**：允许用 Splash/真实页面主动复现一次；缺陷观察放到请求体重构后，不据此关闭；保持 deferred。见 [B38](slices/B38-world-rule-save-intent.md)。
- **延期/条件**：多 Agent/24x7 [B50](slices/B50-multi-agent-current-boundary.md#61-延期实施与重新开放)；I10 盲评 [安排](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排)；B68 Experience [B68](slices/B68-experience-rule-governance.md)（2026-11-13 确认保持 deferred）。

