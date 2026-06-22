# AU07 File-Level Closure

- 状态：file-level deliverable（P0 replay producers closed；P1 follow-up registered）
- 类型：Acceptance / Trace Replay / Tauri Slice
- 启动日期：2026-06-21
- 来源：`docs/design/acceptance/author/AU-07-trace-and-replay.md`、`docs/design/acceptance/SCENARIO-BLUEPRINT.md`、`tasks/slices/AU07-trace-replay-integrity.md`、`tasks/slices/AU07-state-trace-adoption-replay.md`、`tasks/slices/AU07-behavior-trace-terminal-replay.md`

## 1. 开工检查

- Contract: VS-06 ReplayReport、VS-03 Behavior lifecycle、ADR-0014 trace redaction、ADR-0017 no-provider replay、`DecisionTrace.tool_trace_refs/behavior_trace_refs/state_trace_refs`、TurnResult `trace_summary`。
- Invariant: author-safe why 不泄露 raw prompt/provider/debug；replay 默认不调用 provider；缺关键 refs 必须 partial；tool/behavior/state replay refs 必须可追溯；cancel waiting 不调用工具、不写 production state、不采纳 artifact。
- Boundary: 文件级收口跨 `novel_application` ReplayService / DialogueGateway、`novel_web` Channel action trace persistence、`novel_persistence` DecisionTrace 持久化、外部 Tauri harness 与 quality manifest；不修改 provider runtime，不新增生产验收感知逻辑。
- Consumer: `WorkspaceChat` why 入口、`TraceRepository`、`ReplayService.build_report/1`、后续旧 turn trace 查询 API/UI。
- Proof: `bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri`、`bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`、`bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri`、targeted backend/channel/replay tests、verifier tests、quality/task_done/static scan。
- Acceptance Driver: `scripts/tauri_slice_verify.sh` 的三个 AU-07 场景均由外部 Playwright/Tauri driver 从真实工作台输入、点击、打开 why 或采纳/取消动作，并读取 websocket/log/summary 证据。产品代码未新增验收感知逻辑。

## 2. 文件级对账结论

| 项目 | 结论 |
|---|---|
| 场景总数 | 16 |
| 已验收 | 9 |
| 已测试 | 1 |
| 部分实现 | 6 |
| P0 | 已关闭 |
| P1 | 旧 turn trace 查询 API/UI、developer 双视图权限、完整 ToolTrace registry snapshot / redacted I/O、work/session trace 查询隔离、reason catalog 深化 |
| 是否可进入下一文件 | 是，可进入 AU-08 |

## 3. 二轮剩余缺口矩阵（2026-06-22）

本轮复跑 AU-07 本体 3 个真实 Tauri / quality 入口，并补核 E2E cross evidence。全部通过：

- `bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri`
- `bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`
- `bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri`
- `bash scripts/tauri_slice_verify.sh e2e-01-readonly-tool-trace`
- `bash scripts/quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio`
- `bash scripts/tauri_slice_verify.sh e2e-01-replay-report`
- `bash scripts/quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio`

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 AU-07 内关闭 | 建议 checkpoint / slice | 是否满足继续到 AU-08 的二轮退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU07-A1 纯聊天 why 解释 no-tool/no-write | 已验收 | 旧 turn 查询未接产品入口 | 补集成 | P1 | `au07-trace-why-entry` quality 通过；author-safe dialog/no raw/no provider replay | 补历史会话/旧 turn trace query API/UI | 否 | `AU07-persisted-trace-query` | 是 |
| SC-AU07-A2 被拒/降级时解释 gate | 部分实现 | 降级 gate 有 E2E evidence，但未从 why 面板展示完整 author-safe gate 文案 | 补验收/文案同步 | P1 | `e2e-01-downgrade-real-page` 证明 `action_scope` downgrade；`traceSummaryView` 常见 gate 文案 | 补 gate why UI driver 或纳入旧 turn replay UI | 否 | `AU07-gate-reason-why` | 是 |
| SC-AU07-A3 工具调用过程可查 | 已测试 | E2E 已证明持久 tool refs 可查；产品 UI 尚未显示工具过程摘要 | 补集成 | P1 | `e2e-01-readonly-tool-trace` real LM Studio：`character_roster` success、`TraceRepository.list_by_turn` 返回 `tool_trace_refs` | 补产品内 tool trace/replay UI | 否 | `AU07-tool-trace-replay` | 是 |
| SC-AU07-A4 上下文引用来源可见 | 已验收 | 旧 turn context trace 查询未接产品入口 | cross-reference | P1 | `au03-context-source-ui` | 补旧 turn context trace 查询 | 否 | `AU07-old-turn-context-trace-query` | 是 |
| SC-AU07-B1 作者视图不泄露 raw/internal | 已验收 | developer 双视图权限未实现 | 补集成 | P1 | `au07-trace-why-entry`、`au03-context-source-ui`、`au11-quality-diagnosis-message-envelope` | 补 developer view 权限和字段差异 | 否 | `AU07-developer-view-boundary` | 是 |
| SC-AU07-B2 author/developer 双视图隔离 | 部分实现 | `ReplayService` 仍以 author-safe 为主，未定义 developer path / 权限 | 补实现/补集成 | P1 | `ReplayReport.redaction_profile` 字段存在 | 先冻结权限/字段 contract，再补 UI/API | 否 | `AU07-developer-view-boundary` | 是 |
| SC-AU07-B3 中文业务解释 | 部分实现 | 常见摘要已中文化，完整 reason catalog 和 developer code 双视图仍缺 | 文案同步/补验收 | P1 | `au07-trace-why-entry` 无 audit-style 标签；`traceSummaryView.test.ts` | 补 reason catalog coverage 和 gate why driver | 否 | `AU07-reason-catalog` | 是 |
| SC-AU07-C1 离线 replay 不调 LLM | 已测试 | no-provider structural replay 已由 E2E cross evidence 关闭；产品旧 turn UI/API 仍缺 | 补集成 | P1 | `e2e-01-replay-report` real LM Studio：ReplayReport `provider_called=false` | 补旧 turn replay 查询 API/UI | 否 | `AU07-persisted-trace-query` | 是 |
| SC-AU07-C2 不完整 trace 诚实 partial | 已测试 | partial 只在 backend test；没有真实 partial UI | 补验收 | P1 | `replay_service_test.exs` missing refs -> partial | 补真实 partial replay UI/driver | 否 | `AU07-partial-replay-ui` | 是 |
| SC-AU07-C3 ReplayReport 六问 | 部分实现 | 只读 tool turn 已由 E2E real LM Studio 六问关闭；多类型组合和产品 UI/API 仍缺 | 补集成/补验收 | P1 | `e2e-01-replay-report`：chain 含 frame/plan/decision/tool_trace/turn_result，六问 answered/not_applicable | 补旧 turn UI/API、developer view、多类型 replay matrix | 否 | `AU07-persisted-trace-query` / `AU07-developer-view-boundary` | 是 |
| SC-AU07-D1 ToolTrace 进入 replay | 已测试 | summary-level tool refs 已闭；独立 ToolTrace 表、registry snapshot、redacted I/O 未闭 | 补集成 | P1 | `e2e-01-readonly-tool-trace` + `e2e-01-replay-report` real LM Studio | 补完整 ToolTrace registry snapshot / redacted I/O | 否 | `AU07-tool-trace-replay` | 是 |
| SC-AU07-D2 BehaviorTrace 进入 replay | 已验收 | 旧 turn UI/API 与完整独立 BehaviorTrace 表仍为后续 | cross-reference | closed/P1 follow-up | `au07-behavior-trace-terminal-replay` | 后续随旧 turn replay UI/API 深化 | 否 | `AU07-behavior-trace-terminal-replay` | 是 |
| SC-AU07-D3 StateTrace / adoption / projection 进入 replay | 已验收 | 旧 turn UI/API 仍为后续 | cross-reference | closed/P1 follow-up | `au07-state-trace-adoption-replay` | 后续随旧 turn replay UI/API 深化 | 否 | `AU07-state-trace-adoption-replay` | 是 |
| SC-AU07-E1 工作台 why 入口 | 已验收 | 无新增缺口 | 已闭环 | closed | `au07-trace-why-entry` | 保持回归 | 否 | 保持 current runnable | 是 |
| SC-AU07-E2 持久 trace 查询旧 turn | 部分实现 | E2E verifier 可外部查询持久 trace；产品 Web API/Channel/UI 入口仍缺 | 补集成/补验收 | P1 | `TraceRepository` tests；`e2e-01-readonly-tool-trace` / `e2e-01-replay-report` 外部查询 | 补产品内旧 turn trace query API/UI | 否 | `AU07-persisted-trace-query` | 是 |
| SC-AU07-E3 跨作品/历史会话 trace 隔离 | 部分实现 | SU-02/03 间接证明隔离；trace query API 的 work/session/turn scope 未冻结 | 修设计偏差/补验收 | P1 | `su02-artifact-projection-trace-isolation` 间接证据；repository 基础查询测试 | 补 work_id/session_id/turn_id 查询边界与 negative driver | 否 | `AU07-trace-query-scope` | 是 |

二轮退出判断：AU-07 当前没有应在本文件内立即实现的新 P1/P0。ReplayReport 六问和只读 ToolTrace 已由 E2E real LM Studio cross evidence 接住；剩余 P1 均需要产品 API/UI、权限 contract 或更深 trace registry 设计，不应在本轮用外部 verifier 结果伪装成作者可见旧 turn UI 已完成。满足进入 AU-08 的二轮退出标准。

## 4. 文件级 checkpoint

| Checkpoint | 结果 | 证据 |
|---|---|---|
| `au07-trace-why-entry` | closed | `artifacts/slice-verify/au07-trace-why-entry-tauri/summary.json` |
| `au07-state-trace-adoption-replay` | closed | `artifacts/slice-verify/au07-state-trace-adoption-replay-tauri/summary.json` |
| `au07-behavior-trace-terminal-replay` | closed | `artifacts/slice-verify/au07-behavior-trace-terminal-replay-tauri/summary.json` |

`au07-behavior-trace-terminal-replay` 证明：真实工作台出现 confirmation waiting 后，作者点击可见拒绝/取消动作，cancelled action turn 记录 terminal BehaviorTrace close event、`event_turn_ref` 与 `behavior_resolution` ref；ReplayService 可离线解释终态；本路径 no-provider、no-tool、no-production-write。

## 5. 文件级验证

- [x] `bash scripts/tauri_slice_verify.sh au07-trace-why-entry`
- [x] `bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh au07-state-trace-adoption-replay`
- [x] `bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh au07-behavior-trace-terminal-replay`
- [x] `bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri`
- [x] `bash scripts/tauri_slice_verify.sh e2e-01-readonly-tool-trace`
- [x] `bash scripts/quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio`
- [x] `bash scripts/tauri_slice_verify.sh e2e-01-replay-report`
- [x] `bash scripts/quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio`
- [x] targeted backend / Channel / replay tests
- [x] verifier 单测：`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 Top 10 为历史 `gitleaks` accepted_risk，touched-file finding 0，blocking 0）

## 6. 后续 owner

| 缺口 | Owner | 恢复路径 |
|---|---|---|
| 旧 turn trace 查询 API/UI | AU-07 / AU-10 后续 | 从 `TraceRepository` 查询到 author-safe replay report，再接历史会话/消息 why 入口 |
| developer 双视图权限 | AU-07 / VS-10 | 明确权限边界、redaction profile 和敏感字段隔离后再做 UI |
| 完整 ToolTrace registry snapshot | AU-07 / tool runtime 后续 | 当前已由 E2E 证明 summary-level refs 可查；后续补 registry version 和 redacted I/O snapshot |
| ReplayReport 六问多类型产品入口 | AU-07 / E2E-01 | 只读 tool turn 六问已闭；后续补 reply-only、confirmation、adoption、behavior、UI action 的产品内查询和 developer view |
| work/session trace 查询隔离 | AU-07 / SU-02 / AU-03 | 将 work_id/session_id/turn_id 查询边界固化到 API/UI 验收 |

## 7. 决策日志

- 2026-06-21 — AU-07 文件级退出标准按“P0 replay producer 闭环 + P1 follow-up 登记”执行；不把旧 turn API/UI、developer 双视图和完整六问 replay 伪装成已完成。
- 2026-06-21 — Behavior terminal replay 选择 cancel waiting 作为真实链路，因为它已有真实 confirmation card、server-authorized action、cancelled TurnResult、后续恢复 turn 和 no-tool/no-write 边界。
- 2026-06-21 — `task_done` 已生成 manifest；`ai_static_scan --top 10` 剩余唯一 Top 10 为历史 `gitleaks` accepted_risk，本文件级收口 touched-file finding 为 0，blocking 为 0。
- 2026-06-22 — 二轮复核串行复跑 AU-07 本体 3 个 quality 入口和 E2E readonly tool trace / replay-report cross evidence；E2E 两项 real LM Studio quality 入口通过。AU-07 计数调整为 9/16 已验收、1/16 已测试、6/16 部分实现；剩余 P1 不在缺产品 API/UI 或权限 contract 前伪装完成。
