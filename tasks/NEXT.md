# NEXT

> 本轮仅整理文档与排期；状态与决策以原任务为准，规则见 [tasks/README](README.md)。每次完成或受阻后运行 `node scripts/next_task_check.mjs --open` 复核并补位；本轮扩展依据见 [全量对账 §17](2026-10-27-design-to-execution-reconciliation.md#17-2026-10-30-元原则整改任务与排期梳理) 与 [2026-10-31 队列审计报告](../../artifacts/queue-audit/2026-10-31-audit.md)。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B71 | CP2 进行中：IR v1 + 三类投影 + G1–G6 + OpenAI 兼容/Anthropic adapter 桥完成（provider 测试全绿）；剩余真实观察/校验回流接 IR 与 I-CACHE 重锚——CP3 首个消费者范围，需真实 Tauri/实模窗口 | [B71](slices/B71-provider-message-fidelity.md) |

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B48 | CP0 已 done（契约与四场景冻结，§8）；下一步 CP1：no-op 普通说明出口 + 待办 workflow 候选拦截 + 纯函数/workflow 测试（不依赖 B43 裁决） | [B48](slices/B48-character-revision-noop-and-ambiguity.md) |
| B46 | 残差矩阵页面驱动：edit_then_accept / 重复提交 / 跨作品 / EXITED 只读；不重开 inbox 主体范围 | [B46](slices/B46-persistent-adoption-inbox.md) |
| B27 | 5 个 CP4 known-gap 的确定性负例/构造器矩阵（实模另需预注册与资源窗口，「第二方复核」原文归本任务定向硬化） | [B27](slices/B27-systematic-prompt-and-intent-integration.md) |
| B73 | CP3 剩余门禁/静态扫描残余判定：把「他人 B30 native 证据过期」「历史 gitleaks」「非本任务 format」与 B73 自身改动分离，只对自身范围收口 | [B73](slices/B73-author-behavior-runtime-and-action-coverage.md) |
| UA01-PROMPT | T3 规划器前缀确定性校验/必要时机械合并（不涉 schema，可独立于 T5 裁决） | [UA01](slices/UA01-agentic-loop-prompt-hardening.md#t3-前缀确定性可独立推进2026-10-31) |
| Q1C | 作者已选 A 补原生 driver；复用 AU12 原生驱动接线，需独立 runtime 预算 | [Q1C](slices/Q1C-adopted-content-revision.md#原生补验-cp0阻塞记录2026-10-31) |
| SU04 | 预注册隔离 release-app 外部 UI 故障驱动（正常冷启动/坏包/端口占用/退出无孤儿） | [SU04](slices/SU04-desktop-sidecar-packaging.md#可独立推进-release-app-预注册2026-10-31) |
| AU08 | 产品外通用按 channel 故障注入代理（get_toc/get_chapter_content），不增验收开关 | [AU08](slices/AU08-file-level-closure.md#可独立推进-channel-故障注入代理2026-10-31) |
| UA01-LOG | 构造受控「最终 run_failed」外部触发 + 同 turn 三源 join 断言 | [UA01](slices/UA01-provider-execution-stream-unification.md#可独立推进-受控最终-run_failed-触发2026-10-31) |
| B72 | 先实现离线生成器/manifest/persona 契约（不调模型），模型窗口后置 | [B72](slices/B72-author-behavior-offline-corpus-expansion.md#可独立推进-离线生成器契约2026-10-31) |

## 阻塞

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
- **延期/条件**：多 Agent/24x7 [B50](slices/B50-multi-agent-current-boundary.md#61-延期实施与重新开放)；AU-15 [B42](slices/B42-model-behavior-evidence-tier.md#10-cp4blocked-登记不执行不代签)；I10 盲评 [安排](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排)；stage 修复需授权 [B28](slices/B28-whole-chapter-revision.md)；B38/Experience [B38](slices/B38-world-rule-save-intent.md)/[B68](slices/B68-experience-rule-governance.md)。
