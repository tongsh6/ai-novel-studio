# AU07 File-Level Closure

- 状态：file-level deliverable（P0 replay producers closed；old-turn scoped query / partial replay UI / scope negative matrix closed；`au07-gate-reason-why` 退役；**2026-10-28 B61 关闭**：`au07-tooltrace-registry-redacted-io`、`e2e-01-readonly-tool-trace`、`e2e-01-replay-report` 经 B59（step trace 持久化）+ B61（native AX/CGEvent driver）取得原生 PASS 并改 active；P1 follow-up registered）
- 类型：Acceptance / Trace Replay / Tauri Slice
- 启动日期：2026-06-21
- 来源：`docs/design/acceptance/author/AU-07-trace-and-replay.md`、`docs/design/acceptance/SCENARIO-BLUEPRINT.md`、`tasks/slices/AU07-trace-replay-integrity.md`、`tasks/slices/AU07-state-trace-adoption-replay.md`、`tasks/slices/AU07-behavior-trace-terminal-replay.md`

## 1. 开工检查

- Contract: VS-06 ReplayReport、VS-03 Behavior lifecycle、ADR-0014 trace redaction、ADR-0017 no-provider replay、`DecisionTrace.tool_trace_refs/behavior_trace_refs/state_trace_refs`、TurnResult `trace_summary`、`decision_traces.workspace_id/session_id/turn_id` scoped query。
- Invariant: author-safe why 不泄露 raw prompt/provider/debug；replay 默认不调用 provider；旧 turn 查询必须按 work/session/turn scope；缺关键 refs 必须 partial；tool/behavior/state replay refs 必须可追溯；cancel waiting 不调用工具、不写 production state、不采纳 artifact。
- Boundary: 文件级收口跨 `novel_application` ReplayService / TraceReplayService / DialogueGateway、`novel_web` Channel action trace persistence / TraceReplayController、`novel_persistence` DecisionTrace 持久化和 scoped query、frontend why 入口、外部 Tauri harness 与 quality manifest；不修改 provider runtime，不新增生产验收感知逻辑。
- Consumer: `WorkspaceChat` 当前和历史消息 why 入口、`TraceRepository`、`TraceReplayService.show/3`、`ReplayService.build_report/1`、AU-01/AU-03/E2E cross-reference。
- Proof: `bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri`、`bash scripts/quality_accept.sh au07-persisted-trace-query --surface tauri`、`bash scripts/quality_accept.sh au07-partial-replay-ui --surface tauri`、`bash scripts/quality_accept.sh au07-gate-reason-why --surface tauri --provider lmstudio`、`bash scripts/quality_accept.sh au07-trace-query-scope-negative-matrix --surface tauri`、`bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`、`bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri`、targeted backend/controller/replay tests、frontend typecheck、verifier tests、quality/task_done/static scan。
- Acceptance Driver: `scripts/tauri_slice_verify.sh` 的 AU-07 场景均由外部 Playwright/Tauri driver 从真实工作台输入、reload、点击 why 或采纳/取消动作，并读取 websocket/log/API response/summary 证据。产品代码未新增验收感知逻辑。

## 2. 文件级对账结论

| 项目 | 结论 |
|---|---|
| 场景总数 | 16 |
| 已验收 | 13 |
| 已测试 | 0 |
| 部分实现 | 3 |
| P0 | 已关闭 |
| P1 | developer 双视图权限、完整 ToolTrace registry snapshot / redacted I/O、多类型 replay UI 矩阵、reason catalog 深化 |
| 是否可进入下一文件 | 是，可进入 AU-08 |

## 3. 二轮剩余缺口矩阵（2026-06-22）

本轮复跑 AU-07 本体 3 个真实 Tauri / quality 入口，并补核 E2E cross evidence。全部通过：

- `bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri`
- `bash scripts/quality_accept.sh au07-persisted-trace-query --surface tauri`
- `bash scripts/quality_accept.sh au07-partial-replay-ui --surface tauri`
- `bash scripts/quality_accept.sh au07-gate-reason-why --surface tauri --provider lmstudio`
- `bash scripts/quality_accept.sh au07-trace-query-scope-negative-matrix --surface tauri`
- `bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`
- `bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri`
- `bash scripts/tauri_slice_verify.sh e2e-01-readonly-tool-trace`
- `bash scripts/quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio`
- `bash scripts/tauri_slice_verify.sh e2e-01-replay-report`
- `bash scripts/quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio`

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 AU-07 内关闭 | 建议 checkpoint / slice | 是否满足继续到 AU-08 的二轮退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU07-A1 纯聊天 why 解释 no-tool/no-write | 已验收 | 当前 turn、普通旧 turn why 入口和 partial 作者提示已闭合；developer/multi-type UI 未接 | closed / P1 follow-up | closed/P1 | `au07-trace-why-entry`；`au07-persisted-trace-query`：author-safe dialog/no raw/no provider/no write；`au07-partial-replay-ui`：partial no-provider/no-write | 补 developer view 和多类型 replay matrix | 否，当前应关项已闭合 | `AU07-developer-view-boundary` / `AU07-multi-type-replay-matrix` | 是 |
| SC-AU07-A2 被拒/降级时解释 gate | 部分实现 | 已关闭：真实页面 `action_scope` downgrade 后 why 面板展示 author-safe gate/reason 解释；完整 reason catalog 和 developer code 双视图仍为后续 | closed / P1 follow-up | closed/P1 | `au07-gate-reason-why` real LM Studio：真实档案入口触发多步 MicroPlan，Orchestrator 在 `action_scope` 降级，why 面板显示中文 gate/reason、no-provider replay、no-write、无 raw/internal code 泄漏 | 无当前应补；后续补完整 reason catalog 和 developer 双视图 | 已关闭 | `AU07-gate-reason-why` | 是 |
| SC-AU07-A3 工具调用过程可查 | 部分实现 | E2E 已证明 summary-level 持久 tool refs 可查；产品 UI 尚未显示工具过程摘要，独立 ToolTrace registry snapshot / redacted I/O 未闭合 | 补集成 | P1 | `e2e-01-readonly-tool-trace` real LM Studio：`character_roster` success、`TraceRepository.list_by_turn` 返回 `tool_trace_refs` | 补产品内 tool trace/replay UI 与独立 ToolTrace registry snapshot | 否 | `AU07-tool-trace-replay` | 是 |
| SC-AU07-A4 上下文引用来源可见 | 已验收 | 普通旧 turn scoped query 已接产品入口；显式 archived/source detail、developer view 和多类型 replay UI 未接 | cross-reference | P1 | `au03-context-source-ui`；`au07-persisted-trace-query` | 补 archived/source detail、developer view 和多类型 replay UI | 否 | `AU07-old-turn-context-source-detail` | 是 |
| SC-AU07-B1 作者视图不泄露 raw/internal | 已验收 | developer 双视图权限未实现 | 补集成 | P1 | `au07-trace-why-entry`、`au03-context-source-ui`、`au11-quality-diagnosis-message-envelope` | 补 developer view 权限和字段差异 | 否 | `AU07-developer-view-boundary` | 是 |
| SC-AU07-B2 author/developer 双视图隔离 | 部分实现 | `ReplayService` 仍以 author-safe 为主，未定义 developer path / 权限 | 补实现/补集成 | P1 | `ReplayReport.redaction_profile` 字段存在 | 先冻结权限/字段 contract，再补 UI/API | 否 | `AU07-developer-view-boundary` | 是 |
| SC-AU07-B3 中文业务解释 | 部分实现 | 常见摘要和 `action_scope` gate why 已中文化；完整 reason catalog 和 developer code 双视图仍缺 | 文案同步/补验收 | P1 | `au07-trace-why-entry` 无 audit-style 标签；`au07-gate-reason-why` 证明 action_scope gate 文案；`traceSummaryView.test.ts` | 补完整 reason catalog coverage 和 developer code 双视图 | 否 | `AU07-reason-catalog` | 是 |
| SC-AU07-C1 离线 replay 不调 LLM | 已验收 | 普通旧 turn 产品 UI/API 与 partial 作者提示均已闭合 no-provider；developer/multi-type UI 仍缺 | closed / P1 follow-up | closed/P1 | `au07-persisted-trace-query`：scoped persisted replay `provider_called=false`；`au07-partial-replay-ui`：partial replay `provider_called=false`；`e2e-01-replay-report` real LM Studio：ReplayReport `provider_called=false` | 补 developer/multi-type replay UI | 否，当前应关项已闭合 | `AU07-developer-view-boundary` / `AU07-multi-type-replay-matrix` | 是 |
| SC-AU07-C2 不完整 trace 诚实 partial | 已验收 | partial 作者提示已闭合；corrupt / invalid_trace 负向 UI 可作为 P2 后续反证 | closed / P2 follow-up | closed/P2 | `replay_service_test.exs` missing refs -> partial；`trace_replay_service_test.exs` / controller tests 覆盖 persisted partial；`au07-partial-replay-ui` 真实旧 turn why 入口显示 partial warning、missing refs、no-provider/no-write/no raw leak | 无当前应补；后续可补 invalid_trace negative UI | 已关闭 | `AU07-partial-replay-ui` | 是 |
| SC-AU07-C3 ReplayReport 六问 | 已验收 | 只读 tool turn 已由 E2E real LM Studio 六问关闭，普通旧 turn UI/API 已由 `au07-persisted-trace-query` 补最小 no-provider replay，partial 已由 `au07-partial-replay-ui` 关闭；developer view 和多类型组合矩阵仍缺 | 补集成/补验收 | P1 | `e2e-01-replay-report`：chain 含 frame/plan/decision/tool_trace/turn_result，六问 answered/not_applicable；`au07-persisted-trace-query`：旧 turn UI/API no-provider replay；`au07-partial-replay-ui`：missing refs partial UI | 补 developer view 和多类型 replay matrix | 否 | `AU07-developer-view-boundary` / `AU07-multi-type-replay-matrix` | 是 |
| SC-AU07-D1 ToolTrace 进入 replay | 已测试 | summary-level tool refs 已闭；独立 ToolTrace 表、registry snapshot、redacted I/O 未闭 | 补集成 | P1 | `e2e-01-readonly-tool-trace` + `e2e-01-replay-report` real LM Studio | 补完整 ToolTrace registry snapshot / redacted I/O | 否 | `AU07-tool-trace-replay` | 是 |
| SC-AU07-D2 BehaviorTrace 进入 replay | 已验收 | 旧 turn UI/API 与完整独立 BehaviorTrace 表仍为后续 | cross-reference | closed/P1 follow-up | `au07-behavior-trace-terminal-replay` | 后续随旧 turn replay UI/API 深化 | 否 | `AU07-behavior-trace-terminal-replay` | 是 |
| SC-AU07-D3 StateTrace / adoption / projection 进入 replay | 已验收 | 旧 turn UI/API 仍为后续 | cross-reference | closed/P1 follow-up | `au07-state-trace-adoption-replay` | 后续随旧 turn replay UI/API 深化 | 否 | `AU07-state-trace-adoption-replay` | 是 |
| SC-AU07-E1 工作台 why 入口 | 已验收 | 当前消息、普通旧 turn why 入口和 partial 作者提示均已闭合；深层 replay 视图仍为后续 | closed / P1 follow-up | closed/P1 | `au07-trace-why-entry`；`au07-persisted-trace-query`；`au07-partial-replay-ui` | 保持回归；后续补 developer/多类型视图 | 否，当前应关项已闭合 | 保持 current runnable | 是 |
| SC-AU07-E2 持久 trace 查询旧 turn | 部分实现 | 已关闭：产品 Web API/UI 按 work/session/turn 查询持久 trace，并从 reload 后旧 turn why 入口渲染 author-safe no-provider replay | closed | closed | `TraceRepository.list_by_scope/3` tests；`TraceReplayService` / controller tests；`artifacts/slice-verify/au07-persisted-trace-query-tauri/summary.json` | 无当前应补；后续只补 partial/developer/multi-type | 已关闭 | `AU07-persisted-trace-query` | 是 |
| SC-AU07-E3 跨作品/历史会话 trace 隔离 | 部分实现 | scoped query boundary 与跨 work/session/turn 负向矩阵已闭合；developer 权限模型、旧 workspace_id 迁移和会话级完整 replay 未闭合 | closed / P1-P2 follow-up | closed/P1-P2 | `trace_replay_service_test.exs` cross-work session guard、same-turn different-session guard；`au07-persisted-trace-query` UI/API scope match；`au07-trace-query-scope-negative-matrix` 真实 Tauri：valid replay 200，foreign work/source session、source work/foreign session、same-work other session/source turn、missing turn 均 404 且不泄露 trace；`su02-artifact-projection-trace-isolation` 间接证据 | 无当前应补；后续补 developer 权限模型和旧 workspace_id 迁移设计 | 已关闭 | `AU07-trace-query-scope-negative-matrix` | 是 |

二轮退出判断：AU-07 本轮按依赖关系提前关闭旧 turn persisted trace query P1、partial replay UI P1、`action_scope` gate reason why P1 和 scoped negative matrix P1。ReplayReport 六问和只读 ToolTrace 已由 E2E real LM Studio cross evidence 接住；普通旧 turn author-safe API/UI 已由 `au07-persisted-trace-query` 真实 Tauri 证据闭合；缺 refs 的 persisted partial replay 已由 `au07-partial-replay-ui` 真实 Tauri 证据闭合；降级 gate 的作者安全解释已由 `au07-gate-reason-why` 真实 Tauri + real LM Studio 证据闭合；跨 work、跨 session、same-work other session 和 missing turn 负向 replay 查询已由 `au07-trace-query-scope-negative-matrix` 真实 Tauri 证据闭合。剩余 P1 均需要 developer 权限 contract、多类型 UI 矩阵或更深 trace registry 设计，不应在本轮伪装完成。满足恢复蓝图顺序并进入 AU-08 的二轮退出标准。

## 4. 文件级 checkpoint

| Checkpoint | 结果 | 证据 |
|---|---|---|
| `au07-trace-why-entry` | closed | `artifacts/slice-verify/au07-trace-why-entry-tauri/summary.json` |
| `au07-persisted-trace-query` | closed | `artifacts/slice-verify/au07-persisted-trace-query-tauri/summary.json` |
| `au07-partial-replay-ui` | closed | `artifacts/slice-verify/au07-partial-replay-ui-tauri/summary.json` |
| `au07-gate-reason-why` | closed | `artifacts/slice-verify/au07-gate-reason-why-tauri-lmstudio/summary.json` |
| `au07-trace-query-scope-negative-matrix` | closed | `artifacts/slice-verify/au07-trace-query-scope-negative-matrix-tauri/summary.json` |
| `au07-state-trace-adoption-replay` | closed | `artifacts/slice-verify/au07-state-trace-adoption-replay-tauri/summary.json` |
| `au07-behavior-trace-terminal-replay` | closed | `artifacts/slice-verify/au07-behavior-trace-terminal-replay-tauri/summary.json` |

`au07-behavior-trace-terminal-replay` 证明：真实工作台出现 confirmation waiting 后，作者点击可见拒绝/取消动作，cancelled action turn 记录 terminal BehaviorTrace close event、`event_turn_ref` 与 `behavior_resolution` ref；ReplayService 可离线解释终态；本路径 no-provider、no-tool、no-production-write。

`au07-persisted-trace-query` 证明：真实工作台发送普通创作聊天后，assistant turn 持久到 active session transcript；reload 恢复旧 turn 后，作者点击可见“为什么”入口；产品 API 使用 work_id/session_id/turn_id scope 查询持久 trace 并生成 ReplayReport；UI 渲染 author-safe replay 摘要，`provider_called=false`，且无 tool/write/raw prompt/provider/debug/trace id/context id 泄漏。

`au07-partial-replay-ui` 证明：外部 harness 在同一 work/session/turn scope 插入缺 `turn_result_ref` / `tool_trace_refs` 的持久 DecisionTrace；真实 Tauri 工作台 reload 恢复旧 turn 后，作者点击可见“为什么”入口，产品 API 返回 `result_status=partial` 与 `missing_trace_refs`，作者面板显示“这轮 trace 不完整”和“不重新调用模型”；全过程 no-provider、no-tool、no-production-write，且无 raw prompt/provider/debug 泄漏。

`au07-gate-reason-why` 证明：真实 Tauri 档案入口点击「发起综合修订」，real LM Studio 生成多步 MicroPlan，Orchestrator 在 `action_scope` 降级；作者从降级消息点击可见“为什么”后，产品 replay API 按持久 trace summary 恢复 `first_blocking_gate`，UI 展示“当前请求超出本轮可执行范围”和 MicroPlan 评估说明，且 `provider_called=false`、no-tool、no-production-write、无 raw prompt/provider/debug/internal gate code 泄漏。

`au07-trace-query-scope-negative-matrix` 证明：真实工作台发送普通讨论 turn 并 reload 恢复旧消息后，外部 harness 从产品外部请求 replay API；原 work/session/turn 返回 200 且 `provider_called=false`，foreign work/source session、source work/foreign session、same-work other session/source turn、missing turn 均返回 404；负向响应不包含 `trace_summary` 或 `replay_report`，错误未进入产品 UI，且全过程 no-provider、no-tool、no-production-write。

## 5. 文件级验证

- [x] `bash scripts/tauri_slice_verify.sh au07-trace-why-entry`
- [x] `bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh au07-persisted-trace-query`
- [x] `bash scripts/quality_accept.sh au07-persisted-trace-query --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh au07-partial-replay-ui`
- [x] `bash scripts/quality_accept.sh au07-partial-replay-ui --surface tauri`
- [x] `bash scripts/quality_accept.sh au07-gate-reason-why --surface tauri --provider lmstudio`
- [x] `bash scripts/quality_accept.sh au07-trace-query-scope-negative-matrix --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh au07-state-trace-adoption-replay`
- [x] `bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh au07-behavior-trace-terminal-replay`
- [x] `bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh e2e-01-readonly-tool-trace`
- [x] `bash scripts/quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio`
- [x] `bash scripts/tauri_slice_verify.sh e2e-01-replay-report`
- [x] `bash scripts/quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio`
- [x] targeted backend / controller / replay tests：`mix test apps/novel_persistence/test/novel_persistence/trace_repository_test.exs apps/novel_application/test/novel_application/trace_replay_service_test.exs apps/novel_web/test/novel_web/controllers/trace_replay_controller_test.exs`
- [x] frontend trace view test：`pnpm --dir frontend exec vitest run src/lib/__tests__/traceSummaryView.test.ts`
- [x] `pnpm --dir frontend typecheck`
- [x] verifier 单测：`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 Top 10 为历史 `gitleaks` accepted_risk，touched-file finding 0，blocking 0）

## 6. 后续 owner

| 缺口 | Owner | 恢复路径 |
|---|---|---|
| developer / multi-type 旧 turn replay UI | AU-07 / AU-10 后续 | 在已闭合的 `TraceReplayService` + why 入口上补 developer 权限和多类型 replay 矩阵 |
| developer 双视图权限 | AU-07 / VS-10 | 明确权限边界、redaction profile 和敏感字段隔离后再做 UI |
| 完整 ToolTrace registry snapshot | AU-07 / tool runtime 后续 | 当前代码已写 registry/grant/redacted I/O，`au07-tooltrace-registry-redacted-io` 的 driver/manifest 仍要求退役事件；改为“实现存在、当前证据待重锚”，由 [B40-judgment-era-acceptance-reanchor](B40-judgment-era-acceptance-reanchor.md) 承接；不重建 ToolTrace |
| ReplayReport 六问多类型产品入口 | AU-07 / E2E-01 | 只读 tool turn 六问已闭；后续补 reply-only、confirmation、adoption、behavior、UI action 的产品内查询和 developer view |
| developer 权限模型和旧 workspace_id 迁移细化 | AU-07 / SU-02 / AU-03 | work/session/turn scoped query 与负向矩阵已由 `au07-trace-query-scope-negative-matrix` 固化；后续只补权限 contract、developer view 和旧迁移设计 |

## 7. 决策日志

- 2026-06-21 — AU-07 文件级退出标准按“P0 replay producer 闭环 + P1 follow-up 登记”执行；不把旧 turn API/UI、developer 双视图和完整六问 replay 伪装成已完成。
- 2026-06-21 — Behavior terminal replay 选择 cancel waiting 作为真实链路，因为它已有真实 confirmation card、server-authorized action、cancelled TurnResult、后续恢复 turn 和 no-tool/no-write 边界。
- 2026-06-21 — `task_done` 已生成 manifest；`ai_static_scan --top 10` 剩余唯一 Top 10 为历史 `gitleaks` accepted_risk，本文件级收口 touched-file finding 为 0，blocking 为 0。
- 2026-06-22 — 二轮复核串行复跑 AU-07 本体 3 个 quality 入口和 E2E readonly tool trace / replay-report cross evidence；E2E 两项 real LM Studio quality 入口通过。当时形成历史中间口径：9 项已验收、1 项已测试、6 项部分实现；剩余 P1 不在缺产品 API/UI 或权限 contract 前伪装完成。
- 2026-06-22 — 按依赖关系提前处理 `au07-persisted-trace-query`，关闭 SC-AU07-E2 普通旧 turn 持久 trace scoped query。当前证据来自真实 Tauri reload 后的旧 turn “为什么”入口，API response 与 UI 均按 work/session/turn scope 对账，no-provider/no-write。当时形成历史中间口径：10 项已验收、1 项已测试、5 项部分实现；developer 双视图、多类型 UI 和负向权限矩阵继续登记为 P1 follow-up，partial UI 随后由 `au07-partial-replay-ui` 关闭。
- 2026-06-22 — 继续按依赖关系提前处理 `au07-partial-replay-ui`，关闭 SC-AU07-C2 不完整 trace 诚实 partial 作者提示。外部 harness 只在测试环境写入同 scope 不完整 trace，真实工作台 reload 后从旧 turn “为什么”入口触发产品 API，UI 显示 partial warning、missing refs 和 no-provider 文案，且 no-provider/no-tool/no-write/no raw leak。AU-07 计数调整为 11/16 已验收、0/16 已测试、5/16 部分实现；developer/multi-type、ToolTrace registry、负向权限矩阵和 reason catalog 继续登记为 P1 follow-up。
- 2026-06-22 — 按依赖关系继续处理 `au07-gate-reason-why`，关闭 SC-AU07-A2 `action_scope` 降级为什么解释。首次真实验收暴露 persisted replay summary 丢失 `first_blocking_gate`，已在 `TraceReplayService` 中从白名单 no-write reason 恢复 gate 字段，再由 `traceSummaryView` 映射为作者安全中文。`quality_accept au07-gate-reason-why --surface tauri --provider lmstudio` 通过，AU-07 计数调整为 12/16 已验收、0/16 已测试、4/16 部分实现；完整 reason catalog、developer 双视图、多类型 UI 和 ToolTrace registry 继续登记为 P1 follow-up。
- 2026-06-22 — 继续按依赖关系处理 `au07-trace-query-scope-negative-matrix`，关闭 SC-AU07-E3 scoped negative matrix。真实 Tauri 工作台建立普通 turn 并 reload 恢复旧消息后，外部 harness 验证原 scope replay 200，foreign work/source session、source work/foreign session、same-work other session/source turn、missing turn 均 404，且负向响应不含 `trace_summary` / `replay_report`、错误不进 UI、no-provider/no-tool/no-write。AU-07 计数调整为 13/16 已验收、0/16 已测试、3/16 部分实现；developer 双视图、多类型 UI、ToolTrace registry 和 reason catalog 继续登记为 P1 follow-up，旧 workspace_id 迁移细化登记为 P2。

## 8. B40 CP2 复核记录（2026-10-27）

- **实现存在**：`TraceWriter.record_with_tool/7` 仍写 registry snapshot/contract refs/grant summary/redacted request/result summaries；`ReplayService.build_report/1` 仍 no-provider。
- **证据重锚结论（B59 修复后更新）**：`au07-tooltrace-registry-redacted-io` **仍 blocked（唯一原因=native driver 未实现）**；产品侧 step trace 持久化已由 B59 修复，scoped 复验 `trace-query count=1` 且 ToolTrace/ReplayReport 断言通过（browser-surface）。B40 时的两个原因记录保留如下（历史）：
  1. 判断纪元 AgentRun 内部只读步（如 `character_design_with_context_v1` 的 `character_roster` 步）会广播中间步 `turn_result` 并产生 ToolTrace（`TurnExecutionService.execute`），但 flow 的 `do_execute_tool_step` 丢弃返回的 trace（`character_design_with_context.ex:300-345`），**step DecisionTrace 未持久化到 TraceRepository**；本轮真实 run 按 step turn_id 查询 `TraceRepository.list_by_turn` 返回 0 条。因此「ToolTrace 持久回查 + ReplayReport」无当前可达路径（旧 `au07-tooltrace-*-lmstudio` 证据为帧纪元，不可复用）。
  2. native 系统级驱动未实现（`TAURI_NATIVE_SYSTEM_DRIVER` allowlist 只含 B26/B28/B29/B30/B31/P1），browser-surface 不足以记 active（Lead 2026-10-27 surface 裁决）。
- **已保留的可复用重锚**：driver 已改为「先看角色阵容 → 设计反派」真实请求 + AgentRun 内部只读 `character_roster` 步；manifest/verifier 断言按「只读工具步 + registry/redaction/no-provider/no production write」重写；失败证据只读保留在 `artifacts/slice-verify/au07-tooltrace-registry-redacted-io-tauri/`（`trace-query.json` count=0）。
- **退役**：`au07-gate-reason-why` 正式退役（action_scope 降级在判断纪元无生产者；why 持久 summary 无 gate-blocking 文本来源），替代证据=`agent-step-regate`（12 门 allow lineage + author-safe why/无模型召回，挂在该 driver/verifier 上）+ `gate_order_closure_test`（blocked 路径单测）。
- **不重建 ReplayService / 不恢复旧对象**：本任务未改 ReplayService/ToolTrace 生产代码。
- **B61 native 关闭追记（2026-10-28）**：三场景在真实 Tauri 窗口以 AX/CGEvent 驱动取得原生 PASS（29/29 checks、trace count=1、ReplayReport 六问/no-provider），registry active；证据 `artifacts/slice-verify/{au07-tooltrace-registry-redacted-io,e2e-01-readonly-tool-trace,e2e-01-replay-report}-tauri/summary.json`。
- **B59 修复追记（2026-10-27）**：`StepTracePersistence` 把 5 个 AgentRun flow 的 step DecisionTrace 交给既有 persister；scoped 复验三个场景（au07-tooltrace / e2e-readonly / e2e-replay）均 PASS（browser-surface），`trace-query.json` count=1 且 registry snapshot/合同 refs/grant summary/redacted IO/no-provider ReplayReport 齐备。场景 registry 仍 blocked（native driver 未实现），不得读作原生 PASS。
