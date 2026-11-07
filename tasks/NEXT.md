# NEXT

> 本轮仅整理文档与排期；状态与决策以原任务为准，规则见 [tasks/README](README.md)。每次完成或受阻后运行 `node scripts/next_task_check.mjs --open` 复核并补位；本轮扩展依据见 [全量对账 §17](2026-10-27-design-to-execution-reconciliation.md#17-2026-10-30-元原则整改任务与排期梳理)。

## 当前任务

| 任务 | 下一步与用户结果 | 状态来源 |
|---|---|---|
| B71-CP4b | R1 请求边界/原生投影/三消费者迁移与 2026-11-06 作者裁决已实现：A（system 规则/版本，`6dbb9dd4`）、D（finite_mode 持久事实，`b7aecafb`）、Anthropic 相邻 role 合并退役（`19dcfad9`）、B27 冻结器退役（`a8645e85`）；后端全量 3089/0、credo no issues、I1/I2/I3/N-NARR/I-CACHE 通过（提交 b32da8cd/abf4c63b/c652277b/19dcfad9/b7aecafb/e5e1491c/6dbb9dd4/a8645e85/63361db1）。**已完成**：裁决 4 C 依赖图下沉三阶段——首轮 `29464e60`/`e6c97020`/`3e64e3b1`/`8628411d`（含既有严格门禁修复 `b125989c` 与文档 `7af7c904`），2026-11-07 按作者 A1 裁决恢复原计划统一归属 `776e3641`（Projection/三投影/能力事实一并下沉 `novel_common`）。原生批次 A 后复验**已于 2026-11-07 通过**（`b71-a1-03` 19/19，clean HEAD `26824567`；SliceVerify canonical IR 观察识别适配同提交）。**2026-11-07 R2 统一流式生命周期 + Responses SSE 已完成（确定性机制层）**：`SSEStream` 三 wire 共用取消/静默/总时长/终止物化，Chat/Anthropic 迁移为 decoder（行为不变），Responses SSE 新增并翻正 `streaming: true`；工具调用不再隐式非流式；`ResponsesWire` 统一 call_id/raw_arguments 归一；Responses 截断 fail-closed；DeepSeek 私有 reasoning 经 provider_state 回放；I-CACHE 扩展三投影（CI 强制）。验证：agent 498/0、全量 0 failures、credo/format/xref/arch/module-size、I1–I3/N-NARR/I-CACHE 全通过。**下一步（作者 2026-11-07 选择 C→A，均已执行）**：C——CP5 无窗口收口与 R2 流式正文预览机制已补齐（确定性层）；A——q2_0 实模预注册重冻结后 3 批：批次 01 PASS required mechanism 7/7（3 次真实调用、canon 零写、ask_author），但工具调用/G2–G6 未触发；批次 02 FAIL harness 时序竞争（已修）；批次 03 FAIL 真实模型 run failed（usage_collected），不重跑换分。**判定**：q2_0 不能替代完整 CP4b-2/G6 场景结论。下一步需更强模型窗口或 OpenAI/Anthropic 官方凭证（Responses/Anthropic 实模）、G6 auto-maintenance 场景、真实页面流式预览证据；B79 CP0/CP1 与 AU10 产品外 fixture 可并行，B78/B39 待 B71 收口。I10 不代签 | [B71](slices/B71-provider-message-fidelity.md) |

当前任务的双向沟通整改见 [原优化计划](slices/bidirectional-gaps-optimization.md)；批次 A–E 的执行状态与证据只在原计划维护，NEXT 不另建状态节。

## 后续候选

| 任务 | 承接结果 / 依赖 | 状态来源 |
|---|---|---|
| B79 | 存量书稿导入 + 导入后分析建档（导入 txt/md/粘贴→自动切分落库；分析六类直接写档案、批次可撤销；大纲/卷落现有 schema、无卷划分不产卷信息；覆盖=软替换）。可先独立推进 CP0 契约冻结与 CP1 确定性导入链，不依赖 B71 收口；CP3/CP4 分析长跑需真实模型窗口 | [B79](slices/B79-work-import-and-analysis.md) |
| B78 | 存量大模块拆分（P1：WorkspaceChat / dialogue_planning_service / agent_run_server / turn_execution_service / adoption_repository）；治理机制与 ratchet 门禁已落地，本任务只做结构化拆分，须在 B71 收口后按「一次一个文件、独立 refactor commit」排期 | [B78](slices/B78-module-size-debt.md) |

依赖排序（2026-11-07 更新）：R2 已完成（确定性机制层），B79 CP0/CP1 与 AU10 产品外 fixture 部分现在可并行推进；B78/B39/CP5 证据刷新须待 B71 收口；其余候选依赖外部窗口或作者 A/B/C 裁决（见阻塞节）。排期结论不等于授权或完成声明。

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
- ~~B71 原生批次复验~~ **已于 2026-11-07 关闭**：`b71-first-consumer` 在 A1 收口后经 SliceVerify canonical IR 观察识别修复（`26824567`）取得 clean HEAD 真实页面 **19/19**（`artifacts/slice-verify/b71-first-consumer-tauri-native-b71-a1-03/`）；根因是 test-support 旧文本识别与 R1 canonical IR 不同步，产品当时进入 `no_progress_stopped` 的行为正确。实模/CP4b-2/CP5 仍不代签；证据与失败批次见 [B71](slices/B71-provider-message-fidelity.md) 原生批次验收状态小节。
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
- **B71 实模/页面后续窗口（2026-11-07 更新）**：R2 机制层已完成并提交；作者选择 C（B71 收口剩余：实模/G6/CP5），当前只读探测 Strata 在线但可用模型为 `q2_0`（预注册为 `iq3_s`），且无 OpenAI/Anthropic 官方凭证。待作者裁决：A（推荐）以 `q2_0` 重新预注册跑 CP4b-2/G6 + Responses/Anthropic 实模等凭证；B 等 iq3_s 窗口；C 先做 CP5 无窗口收口与 R2 预览 UI 设计。未获批前不启动实模批次。R2 真实流式正文预览 UI 已按作者裁决 B 纳入 R2 后续 checkpoint 并**完成确定性层**：SSEStream 对「工具参数 JSON body」（写作真实形态）产出 author_content_delta、三 wire 测试 8/8、真实 Tauri 页面批次 `b71-authoring-transcript-tauri-native-stream-preview-06` PASS（生成中预览 + 协议字节零泄漏 + 最终 turn_result）；真实模型流式行为与 Responses/Anthropic 实模另证。详见 [B71](slices/B71-provider-message-fidelity.md) 对应小节。
- **B48 CP3**：CP0–CP2 done；CP3 需真实模型/原生 runtime 窗口 + native driver 前置，预注册 `artifacts/b48-cp3/preregistration.json`；见 [B48](slices/B48-character-revision-noop-and-ambiguity.md)。
- **延期/条件**：多 Agent/24x7 [B50](slices/B50-multi-agent-current-boundary.md#61-延期实施与重新开放)；AU-15 [B42](slices/B42-model-behavior-evidence-tier.md#10-cp4blocked-登记不执行不代签)；I10 盲评 [安排](slices/VS00D-G-GAP-RECONCILIATION.md#i10-人工盲评安排)；stage 修复需授权 [B28](slices/B28-whole-chapter-revision.md)；B38/Experience [B38](slices/B38-world-rule-save-intent.md)/[B68](slices/B68-experience-rule-governance.md)。

