# AU-07 系统透明度与决策溯源

> 作者视角：我想知道 AI 为什么这样回复、为什么没有执行、为什么要求确认、参考了哪些作品上下文，以及几天后回看时还能不能解释当时发生了什么。解释必须是作者能理解的安全摘要，而不是 raw prompt、debug dump 或英文错误码。

> 2026-06-21 对账结论：`au07-trace-why-entry` 已重新挂回 `scripts/tauri_slice_verify.sh --list` 与 quality manifest，并通过 `bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri` 复跑。作者可从真实工作台消息流打开 author-safe “为什么？”解释，且不展示 raw prompt/provider/debug/trace id/context id。`au07-state-trace-adoption-replay` 已证明真实工作台“保存为章节正文”后的 action turn、采纳 resolved entry 与 reading projection 共用可回放 `state_trace_ref`。`au07-behavior-trace-terminal-replay` 已证明真实工作台高风险 confirmation 被作者拒绝/取消后，cancelled action turn 记录 terminal `behavior_trace_refs` close event、`event_turn_ref` 与 `behavior_resolution` ref，并可由 `ReplayService` 离线解释，不调用 provider、不调工具、不写作品事实。`ReplayService.build_report/1` 已补 Tool / Behavior / State replay refs 的完整性检查：有 refs 时进入 replay chain，关键 refs 缺失时 `missing_trace_refs` 非空且 `result_status=partial`，不会伪造完整 replay。AU-07 文件级 P0 已关闭，当前可进入 AU-08；剩余 P1 为旧 turn trace 查询 API/UI、developer 双视图权限、完整 ToolTrace registry snapshot、ReplayReport 六问真实入口和 work/session trace 查询隔离。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 点开某轮消息的“为什么？” | 看到作者可读的解释摘要：为什么回复、为什么不执行、为什么要求确认 |
| 查看 AI 参考了哪些内容 | 看到作品背景、当前会话、记忆、已确认设定等来源摘要 |
| 查看为什么被拒绝或降级 | 看到被哪个 gate 拦截，以及中文解释 |
| 查看工具调用过程 | 看到工具名、版本、状态、结果摘要和是否待采纳 |
| 查看采纳/确认/取消原因 | 看到行为状态和作品事实为什么改变或没改变 |
| 离线回看旧会话 | 基于保存的 trace/replay，不重新调用 LLM |
| 切换开发者视图 | 看到更详细的结构化报告，但仍不暴露不应展示的敏感内容 |

明确不能做的：

- 作者可见区不能展示 raw prompt、hidden policy、provider 原始日志、未脱敏工具输入输出。
- Replay 不能默认重新调用 LLM 或用当前上下文替代历史快照。
- `trace_summary` 不能补写 trace 中不存在的解释。
- developer report 不能作为普通作者 UI 主数据源。
- 缺失 trace 时不能谎称解释完整。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU07-I1 | 每个可解释 turn 必须有 DecisionTrace 或明确缺失原因 | SC-AU07-A1/C2 |
| AU07-I2 | ToolRequest / ToolResult 必须可追溯 | SC-AU07-A3/D1 |
| AU07-I3 | Behavior open/close 必须可追溯 | SC-AU07-D2 |
| AU07-I4 | State/adoption/projection 变化必须可追溯 | SC-AU07-D3 |
| AU07-I5 | author-safe summary 必须脱敏 | SC-AU07-B1 |
| AU07-I6 | author-safe 和 developer summary 必须隔离 | SC-AU07-B2 |
| AU07-I7 | replay 默认不调用 provider | SC-AU07-C1 |
| AU07-I8 | replay 必须诚实标注 partial / invalid_trace | SC-AU07-C2 |
| AU07-I9 | 前端只能消费 redacted summary，不直接展示 raw trace | SC-AU07-E1 |

---

## 3. 契约引用

| 契约 / 代码 | 用途 |
|---|---|
| `docs/design/contracts/VS-06-replay-surface-contract-pack.md` | TraceSummaryView、ReplayCase、ReplayReport、6 个必答问题 |
| `docs/design/adr/ADR-0014-trace-redaction-v3.md` | author-safe TraceSummaryView redaction 决策 |
| `docs/design/adr/ADR-0017-replay-report-v3.md` | ReplayReport 和 no-provider replay 决策 |
| `docs/design/06-memory-context-and-trace.md` | ContextTrace / DecisionTrace / ToolTrace / BehaviorTrace / StateTrace 完整设计 |
| `apps/novel_application/lib/novel_application/trace_writer.ex` | 当前 trace summary 和 DecisionTrace 生成 |
| `apps/novel_application/lib/novel_application/replay_service.ex` | 当前结构化 ReplayReport 生成 |
| `apps/novel_persistence/lib/novel_persistence/trace_repository.ex` | DecisionTrace 持久化、按 workspace/turn 查询 |
| `apps/novel_application/test/novel_application/replay_service_test.exs` | Replay no-provider、partial trace 局部测试 |
| `apps/novel_persistence/test/novel_persistence/trace_repository_test.exs` | trace 持久化局部测试 |
| `frontend/src/components/WorkspaceChat.tsx` | 当前真实工作台，已渲染最小 trace summary / why 入口 |
| `frontend/src/lib/traceSummaryView.ts` | 将 trace_summary allowlist 字段映射成 author-safe 中文解释 |
| `artifacts/slice-verify/au07-trace-why-entry-tauri/summary.json` | 真实 Tauri 工作台点击“为什么”入口的最小闭环证据 |
| `artifacts/slice-verify/au07-state-trace-adoption-replay-tauri/summary.json` | 真实 Tauri 工作台保存正文后 action/projection 共用 StateTrace 的闭环证据 |
| `artifacts/slice-verify/au07-behavior-trace-terminal-replay-tauri/summary.json` | 真实 Tauri 工作台拒绝/取消 confirmation 后记录 terminal BehaviorTrace close/resolution refs 的闭环证据 |

---

## 4. 验收场景

### 场景组 A：作者能理解本轮为什么这样做

#### SC-AU07-A1 — 纯聊天能解释为什么不调工具

**用户视角**：作者问一个创作讨论问题，AI 只是自然回复。作者点“为什么？”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 显示“本轮只需要自然语言回应，不需要工具/写入/等待作者”的中文解释 |
| 当前证据 | `dialogue_gateway_test.exs` 覆盖 DecisionTrace no-tool/no-behavior/no-write；`TraceWriter.record/3` 生成 `trace_summary`；`WorkspaceChat` 消费 `trace_summary`，通过 `traceSummaryView` 映射为中文 author-safe 摘要；`bash scripts/tauri_slice_verify.sh au07-trace-why-entry` 从真实 Tauri 工作台输入普通对话并点击“为什么”入口 |
| 当前状态 | 最小真实前端闭环已补 |
| 当前缺口 | 仍缺旧会话 trace 查询入口和完整 ReplayReport 六问 |
| 优先级 | P1 |

#### SC-AU07-A2 — 被拒绝/降级时能解释 gate

**用户视角**：作者要求“把整本书重写完”，系统降级或拒绝。作者点“为什么？”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 解释 first blocking gate、原因、系统建议的下一步 |
| 当前证据 | `TraceWriter.record_with_decision/5` 写入 `first_blocking_gate`、`reason_codes`、`plan_actions` |
| 当前状态 | 后端局部实现 |
| 当前缺口 | gate/reason 仍是英文 atom/string；无 author-safe 文案表和 UI 展示 |
| 优先级 | P1 |

#### SC-AU07-A3 — 工具调用过程可查

**用户视角**：AI 生成角色草稿后，作者想知道它调用了什么工具。

| 字段 | 内容 |
|---|---|
| 期望结果 | 显示工具名、版本、状态、结果摘要、产物仍待采纳 |
| 当前证据 | `TraceWriter.record_with_tool/7` 写 tool_name/version/status/request/result id；`replay_service_test.exs` 覆盖 tool_dispatched trace |
| 当前状态 | 局部实现 |
| 当前缺口 | 只有 DecisionTrace 摘要；未持久化完整 ToolTrace / registry snapshot / redacted tool I/O |
| 优先级 | P1 |

#### SC-AU07-A4 — 上下文引用来源可见

**用户视角**：AI 提到“林烬的亲情线”，作者想知道依据来自哪里。

| 字段 | 内容 |
|---|---|
| 期望结果 | author-safe 显示当前作品、会话、记忆、确认设定等来源摘要；无上下文时诚实标注 |
| 当前证据 | `TraceWriter.record/3` 支持 `context_refs` 和 `has_context`；`context_grounding_test.exs` 有 context refs 局部测试 |
| 当前状态 | 局部实现 |
| 当前缺口 | AU-03 已记录 context refs summary 仍占位；缺真实 UI 来源列表 |
| 优先级 | P1 |

### 场景组 B：脱敏与双视图

#### SC-AU07-B1 — 作者视图不暴露内部秘密

**用户视角**：作者打开解释面板。

| 字段 | 内容 |
|---|---|
| 期望结果 | 不展示 raw prompt、hidden policy、provider raw logs、敏感 memory、未脱敏 tool I/O |
| 当前证据 | `DecisionTrace.redaction_level` 字段、ADR-0014 redaction 决策；`NovelApplication.TraceRedactor` 已接入 `TraceWriter` / `ReplayService` author-safe 输出，并有 application 测试覆盖敏感 key、raw prompt/provider/tool/sensitive memory marker 与普通中文摘要保留 |
| 当前状态 | 局部实现 |
| 当前缺口 | 仍缺真实工作台旧 trace 查询、developer 双视图权限和完整 UI 验收；当前 redaction engine 是最小 author-safe 输出层，不等于完整审计脱敏体系 |
| 优先级 | P1 |

#### SC-AU07-B2 — author-safe 与 developer summary 隔离

**用户视角**：普通作者看简洁解释；开发者/审计视图可看结构化细节。

| 字段 | 内容 |
|---|---|
| 期望结果 | 两种视图有明确权限和字段差异；developer report 不进入普通 UI |
| 当前证据 | VS-06 区分 `author_safe` / `developer_summary`；`ReplayReport.redaction_profile` 有枚举 |
| 当前状态 | 结构字段存在 |
| 当前缺口 | `ReplayService.build_report/1` 固定 `redaction_profile: :author_safe`，没有双视图生成/权限边界 |
| 优先级 | P1 |

#### SC-AU07-B3 — 解释使用中文业务语言

**用户视角**：作者不应看到 `action_scope`、`tool_result_not_adoption` 这种内部码作为主要解释。

| 字段 | 内容 |
|---|---|
| 期望结果 | reason_code 有中文业务文案，同时可保留开发者 code |
| 当前证据 | `frontend/src/lib/traceSummaryView.ts` 对 `no_tool_reason`、gate 和常见 reason_codes 做中文 author-safe 映射；文案集中在 `frontend/src/lib/copy.ts` 的 `TRACE` 命名空间；未知机器码不会直接进入作者视图 |
| 当前状态 | 部分实现 / 最小真实前端闭环已补 |
| 当前缺口 | 映射覆盖仍是常见摘要子集；developer code 双视图和权限边界未实现 |
| 优先级 | P1 |

### 场景组 C：离线回放与完整性

#### SC-AU07-C1 — 离线回放不调 LLM

**用户视角**：作者或开发者离线查看旧 turn 的解释。

| 字段 | 内容 |
|---|---|
| 期望结果 | ReplayReport 基于保存 trace 生成，`provider_called=false` |
| 当前证据 | `ReplayService.build_report/1` 固定 provider_called false；`replay_service_test.exs` 覆盖 does not call provider |
| 当前状态 | 局部已测试 |
| 当前缺口 | 缺从持久化 trace 查询到 replay report 的 API/UI 闭环 |
| 优先级 | P1 |

#### SC-AU07-C2 — 不完整 trace 诚实标注 partial

**用户视角**：旧对话 trace 缺失时，系统明确告诉作者解释不完整。

| 字段 | 内容 |
|---|---|
| 期望结果 | `missing_trace_refs` 非空，`result_status=partial/invalid_trace`，UI 不显示“完整解释” |
| 当前证据 | `replay_service_test.exs` 覆盖 missing turn_result/tool/behavior/state refs -> partial |
| 当前状态 | 后端局部已测试 |
| 当前缺口 | 已检查 `turn_result_ref`、Tool/Behavior/State replay refs 的缺失；仍缺持久旧 turn API/UI 把 partial 状态呈现给作者 |
| 优先级 | P1 |

#### SC-AU07-C3 — ReplayReport 回答 VS-06 六个问题

**用户视角**：开发者用 replay 解释“为什么这样做/没做、工具、采纳、行为、UI 卡片”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 至少回答 VS-06 §5 的 6 个问题 |
| 当前证据 | VS-06 contract 已冻结要求；`ReplayService` 有 chain/decision/state 三类字段 |
| 当前状态 | 部分实现 |
| 当前缺口 | `build_state_explanations/1` 硬编码；缺 plan vs decision、ToolTrace、BehaviorTrace、StateTrace、TurnResultViewModel 解释 |
| 优先级 | P1 |

### 场景组 D：跨 trace 类型的完整链路

#### SC-AU07-D1 — ToolTrace 进入 replay

**用户视角**：回看工具调用时能知道工具版本和结果。

| 字段 | 内容 |
|---|---|
| 期望结果 | Replay chain 包含 ToolRequest / ToolResult / registry snapshot |
| 当前证据 | `TraceWriter.record_with_tool/7` 把工具信息放进 summary |
| 当前状态 | 摘要级局部实现 |
| 当前缺口 | 没有独立 ToolTrace 持久化和 ReplayService 聚合 |
| 优先级 | P1 |

#### SC-AU07-D2 — BehaviorTrace 进入 replay

**用户视角**：回看一次确认/取消时，能看到行为如何打开和关闭。

| 字段 | 内容 |
|---|---|
| 期望结果 | Replay chain 包含 behavior open/resolving/closed/resolution |
| 当前证据 | `DialogueGateway` cancel waiting action turn 写入 terminal `trace_summary.behavior_trace_refs`；generic `WorkspaceChannel` author_action 持久化 `DecisionTrace.behavior_trace_refs`；`ReplayService` 输出 close/resolution refs；`dialogue_gateway_test.exs`、`workspace_channel_action_idempotency_test.exs`、`replay_service_test.exs` 覆盖局部链路；`bash scripts/tauri_slice_verify.sh au07-behavior-trace-terminal-replay` 从真实工作台点击可见拒绝/取消并生成当前证据 |
| 当前状态 | 已验收 |
| 当前缺口 | 旧 turn trace 查询 API/UI 与完整独立 BehaviorTrace 表仍归 C3/E2 P1 后续，不阻塞本文件 P0 |
| 优先级 | closed |

#### SC-AU07-D3 — StateTrace / adoption / projection 进入 replay

**用户视角**：回看某个设定为什么进入作品、阅读投影为什么过期。

| 字段 | 内容 |
|---|---|
| 期望结果 | Replay chain 解释 adoption decision、state trace、projection hint |
| 当前证据 | AU-05 已确认 AdoptionBoundary 纯规则和 projection hint 局部存在 |
| 当前状态 | 未闭环 |
| 当前缺口 | StateTrace 未真实写入；ReplayService `state_explanations` 硬编码 |
| 优先级 | P0 |

### 场景组 E：真实入口和持久化访问

#### SC-AU07-E1 — 工作台有“为什么？”入口

**用户视角**：作者在消息旁边点击解释入口。

| 字段 | 内容 |
|---|---|
| 期望结果 | 前端展示 author-safe trace summary 或解释面板 |
| 当前证据 | `TurnResult` 有 `trace_summary` 字段；`WorkspaceChat` 对带 trace 的 assistant 消息渲染“为什么”按钮并打开 Radix Dialog；`au07-trace-why-entry` 原生 Tauri 验证已证明真实工作台入口可用 |
| 当前状态 | 最小真实前端闭环已补 |
| 当前缺口 | 历史会话恢复后的旧 turn 查询仍依赖 transcript 内嵌 `turn_result`，没有 Web API / Channel 查询持久化 trace |
| 优先级 | P1 |

#### SC-AU07-E2 — 可从持久化 trace 查询旧 turn

**用户视角**：几天后回看旧会话仍能解释。

| 字段 | 内容 |
|---|---|
| 期望结果 | trace 按 work/session/turn 持久化，可查询并生成 replay report |
| 当前证据 | `TraceRepository` 支持 insert/list_by_workspace/list_by_turn/get_by_trace_id；`DialogueGateway` 会调用 trace persister |
| 当前状态 | persistence 局部实现 |
| 当前缺口 | 缺 Web API / Channel 事件 / UI 入口把历史 trace 转成作者可见解释 |
| 优先级 | P1 |

#### SC-AU07-E3 — 跨作品和历史会话 trace 隔离

**用户视角**：作者切换作品或打开历史会话，只能看到该作品/会话的解释。

| 字段 | 内容 |
|---|---|
| 期望结果 | trace 查询按 work_id / session_id / turn_id 隔离 |
| 当前证据 | TraceRepository 以 workspace_id 索引；SU-02/AU-03 已记录 work/session 语义仍在迁移 |
| 当前状态 | 部分实现/存在语义风险 |
| 当前缺口 | trace schema 用 workspace_id；当前作品 work_id、旧 workspace_id、未来 session_id 关系未统一 |
| 优先级 | P1 |

---

## 5. 文件级对账矩阵（2026-06-21）

| 场景 | 设计期望 | Contract / invariant | 实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint / slice |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU07-A1 | 纯聊天 why 解释 no-tool/no-write | AU07-I1/I7/I9；VS-06；ADR-0014 | `WorkspaceChat`；`traceSummaryView.ts`；`TraceWriter.record/3` | `traceSummaryView.test.ts`；`replay_service_test.exs` | `artifacts/slice-verify/au07-trace-why-entry-tauri/summary.json` | 已验收 | 旧 turn 查询未接入 | 补集成 | P1 | `AU07-persisted-trace-query` |
| SC-AU07-A2 | 被拒/降级时解释 first gate 和下一步 | AU07-I1；VS-01 | `TraceWriter.record_with_decision/5`；`traceSummaryView.ts` gate 文案 | `traceSummaryView.test.ts` | 无独立真实 gate why driver | 部分实现 | gate/reason 文案 catalog 仍是子集 | 补验收/文案同步 | P1 | `AU07-gate-reason-why` |
| SC-AU07-A3 | 工具调用过程可查 | AU07-I2；VS-02；VS-06 | `TraceWriter.record_with_tool/7`；`ReplayService.build_report/1` | `replay_service_test.exs` 覆盖 tool refs chain 与 missing partial | 无真实 tool replay UI | 已测试 | summary-level refs，不是独立 ToolTrace 表 | 补集成 | P1 | `AU07-tool-trace-replay` |
| SC-AU07-A4 | 上下文来源可见 | AU07-I1/I5；VS-00B | `trace_summary.context_refs`；`traceSummaryView.ts` | `context_grounding_test.exs`；`traceSummaryView.test.ts` | `artifacts/slice-verify/au03-context-source-ui-tauri/summary.json` | 已验收 | 复用 AU-03 driver，旧 turn 查询未接 | cross-reference | P1 | `AU07-old-turn-context-trace-query` |
| SC-AU07-B1 | 作者视图不泄露 raw/internal 信息 | AU07-I5/I9；ADR-0014 | `TraceRedactor`；`traceSummaryView.ts`；`WorkspaceChat` | `trace_redactor_test.exs`；`traceSummaryView.test.ts` | `au07-trace-why-entry`、`au03-context-source-ui`、`au11-quality-diagnosis-message-envelope` | 已验收 | developer 视图权限未实现 | 补集成 | P1 | `AU07-developer-view-boundary` |
| SC-AU07-B2 | author/developer 双视图隔离 | AU07-I6；ADR-0017 | `ReplayReport.redaction_profile` | 无完整双视图测试 | 无 | 部分实现 | `ReplayService` 仍固定 author_safe | 补实现 | P1 | `AU07-developer-view-boundary` |
| SC-AU07-B3 | 中文业务解释，不把机器码给作者 | AU07-I5/I9 | `frontend/src/lib/copy.ts` TRACE；`traceSummaryView.ts` | `traceSummaryView.test.ts` | `au07-trace-why-entry` | 部分实现 | reason catalog 仍是常见子集 | 文案同步/补验收 | P1 | `AU07-reason-catalog` |
| SC-AU07-C1 | 离线 replay 不调 LLM | AU07-I7；ADR-0017 | `ReplayService.build_report/1` | `replay_service_test.exs` | why dialog 文案证明打开解释不重调模型；无旧 turn API/UI | 已测试 | 缺持久 trace 查询到 replay report 的 UI/API | 补集成 | P1 | `AU07-persisted-trace-query` |
| SC-AU07-C2 | 不完整 trace 诚实标 partial | AU07-I8；VS-06 | `ReplayService.find_missing_refs/1` | `replay_service_test.exs` 覆盖 turn_result/tool/behavior/state missing refs | 无真实 partial replay UI | 已测试 | partial 尚未进入作者旧 turn UI | 补验收 | P1 | `AU07-partial-replay-ui` |
| SC-AU07-C3 | ReplayReport 回答 VS-06 六问 | VS-06 §5 | `ReplayService.build_report/1` | `replay_service_test.exs` 覆盖 tool/behavior/state refs 与缺失 | 无真实完整 replay driver | 部分实现 | plan-vs-decision、TurnResultViewModel 解释仍不足 | 补实现 | P1 | `AU07-six-question-report` |
| SC-AU07-D1 | ToolTrace 进入 replay | AU07-I2；VS-02 | `DecisionTrace.tool_trace_refs`；`TraceWriter.record_with_tool/7`；`decision_traces.tool_trace_refs` | `replay_service_test.exs`；`trace_repository_test.exs` | 无真实 tool replay UI | 已测试 | summary-level refs，缺独立 ToolTrace / registry snapshot | 补集成 | P1 | `AU07-tool-trace-replay` |
| SC-AU07-D2 | BehaviorTrace 进入 replay | AU07-I3；VS-03 | `DialogueGateway` cancel waiting terminal refs；`WorkspaceChannel` generic action trace persistence；`DecisionTrace.behavior_trace_refs`；`ReplayService` behavior chain/state explanation | `dialogue_gateway_test.exs`；`workspace_channel_action_idempotency_test.exs`；`replay_service_test.exs`；`trace_repository_test.exs` | `artifacts/slice-verify/au07-behavior-trace-terminal-replay-tauri/summary.json` | 已验收 | 完整旧 turn replay UI/API 归 C3/E2 继续补 | cross-reference | closed | `AU07-behavior-trace-terminal-replay` |
| SC-AU07-D3 | StateTrace/adoption/projection 进入 replay | AU07-I4；VS-04；ADR-0016 | `AdoptionWorkflow`；`WorkspaceChannel` action trace persistence；`DecisionTrace.state_trace_refs`；`ReplayService` state chain | `adoption_workflow_test.exs`；`workspace_channel_action_idempotency_test.exs`；`replay_service_test.exs`；`trace_repository_test.exs` | `artifacts/slice-verify/au07-state-trace-adoption-replay-tauri/summary.json` | 已验收 | 完整旧 turn replay UI 归 C3/E2 继续补 | cross-reference | closed | `AU07-state-trace-adoption-replay` |
| SC-AU07-E1 | 工作台有“为什么？”入口 | AU07-I9；ADR-0014 | `WorkspaceChat`；`traceSummaryView.ts` | `native-tauri-verifier.test.mjs` | `au07-trace-why-entry` | 已验收 | 无 | 无 | closed | 保持 current runnable |
| SC-AU07-E2 | 可从持久化 trace 查询旧 turn | AU07-I1/I7/I8；ADR-0018 | `TraceRepository`；`decision_traces` | `trace_repository_test.exs` 覆盖 DecisionTrace 与 replay refs 持久化 | 无 API/UI | 部分实现 | 缺 Web API / Channel / UI 入口 | 补集成 | P1 | `AU07-persisted-trace-query` |
| SC-AU07-E3 | 跨作品和历史会话 trace 隔离 | AU07-I1；SU-02/AU-03 cross | `TraceRepository.workspace_id/session_id`；SU-02/AU-03 evidence | `trace_repository_test.exs` 基础查询 | `su02-artifact-projection-trace-isolation` 间接证明 trace 隔离 | 部分实现 | workspace_id/work_id/session_id 语义仍需统一 API 验收 | 修设计偏差/补验收 | P1 | `AU07-trace-query-scope` |

**结论：16 个场景；6/16 已验收，4/16 已测试，6/16 部分实现。`au07-trace-why-entry`、`au07-state-trace-adoption-replay`、`au07-behavior-trace-terminal-replay` 已分别关闭当前消息 why 入口、StateTrace/adoption/projection replay producer、Behavior terminal close/resolution replay producer 三个文件级 P0 证据缺口。AU-07 当前满足文件级退出标准，可进入 AU-08；剩余 P1/P2 已登记为后续 checkpoint。**

---

## 6. 缺口

| 缺口 | 具体表现 | 类型 | 优先级 |
|---|---|---|---|
| AU07-GAP-01 — 真实工作台“为什么？”入口不完整 | `au07-trace-why-entry` 已重新接入当前 `tauri_slice_verify` / quality manifest 并通过复跑；历史旧 turn 查询和完整 UI 验收未覆盖 | 补实现/补验收 | P1 |
| AU07-GAP-02 — reason/gate 作者友好中文映射仍是子集 | 常见 `no_tool_reason` / gate / reason_codes 已映射；完整 reason catalog 和 developer code 双视图未实现 | 补实现/文案同步 | P1 |
| AU07-GAP-03 — redaction engine 未形成完整闭环 | 已有 `TraceRedactor` application 输出层和测试；仍缺旧 trace 查询、developer 双视图权限、完整 UI/持久化验收 | 补集成/补验收 | P1 |
| AU07-GAP-04 — author-safe / developer summary 未隔离 | `ReplayService` 固定 author_safe，无 developer path 和权限边界 | 补实现/补集成 | P1 |
| AU07-GAP-05 — ReplayReport 不能回答 VS-06 六问 | 已补 tool/behavior/state refs chain 与 missing refs partial；plan-vs-decision、TurnResultViewModel、真实旧 turn UI/API 聚合仍不足 | 补实现/补测试 | P1 |
| AU07-GAP-06 — ToolTrace 未独立持久化/聚合 | `DecisionTrace.tool_trace_refs` 与 `decision_traces.tool_trace_refs` 已能保存 request/result/version summary；仍缺独立 ToolTrace 表和 registry snapshot | 补集成 | P1 |
| AU07-GAP-07 — BehaviorTrace terminal replay | 已关闭：`au07-behavior-trace-terminal-replay` 证明真实工作台 cancel waiting 后的 cancelled action turn 记录 terminal close event、event turn 与 `behavior_resolution` ref，`ReplayService` 可离线解释；完整独立 BehaviorTrace 表和旧 turn UI/API 归后续 P1 | 保持回归 | closed |
| AU07-GAP-08 — StateTrace/adoption/projection replay 缺失 | 已关闭：`au07-state-trace-adoption-replay` 证明真实采纳正文 action turn、采纳 resolved entry 与 reading projection 共用 `state_trace_ref`，`ReplayService` 已支持 state refs 和缺失 partial | 保持回归 | closed |
| AU07-GAP-09 — trace 查询 API/UI 缺失 | TraceRepository 存在，但没有作者查看旧 turn 解释的入口 | 补集成/补验收 | P1 |
| AU07-GAP-10 — work/session trace 隔离语义不清 | trace 使用 workspace_id，当前产品正在迁移 work/session 模型 | 修设计偏差/补验收 | P1 |

---

## 7. 已知基础设施

| 基础设施 | 当前价值 | 不应误判 |
|---|---|---|
| `TraceWriter.record*` | 能生成 reply/decision/tool/recovery 的 DecisionTrace 摘要 | 不等于完整 ToolTrace/BehaviorTrace/StateTrace |
| `ReplayService.build_report/1` | 能结构化 replay 且不调 provider；能消费 tool/behavior/state refs；缺关键 refs 时返回 partial | 不等于作者 UI 可见旧 turn replay |
| `TraceRepository` | 能持久化和查询 DecisionTrace record 及 replay refs | 不等于有 trace API / history UI |
| `redaction_level` / `redaction_profile` 字段 | 为双视图留下结构 | 不等于脱敏策略已执行 |
| `trace_summary` 字段 | TurnResult 可携带解释摘要，`WorkspaceChat` 已有最小 why 入口 | 不等于有持久化 trace 查询 API / 旧会话 replay UI |

---

## 8. 验收命令

这些命令只能证明局部 trace/replay 能力，不能证明 AU-07 完整通过：

```bash
mix test apps/novel_application/test/novel_application/replay_service_test.exs
mix test apps/novel_application/test/novel_application/context_grounding_test.exs
mix test apps/novel_persistence/test/novel_persistence/trace_repository_test.exs
pnpm --dir frontend test -- traceSummaryView.test.ts
bash scripts/tauri_slice_verify.sh au07-trace-why-entry
bash scripts/quality_accept.sh au07-trace-why-entry --surface tauri
bash scripts/tauri_slice_verify.sh au07-state-trace-adoption-replay
bash scripts/quality_accept.sh au07-state-trace-adoption-replay --surface tauri
bash scripts/tauri_slice_verify.sh au07-behavior-trace-terminal-replay
bash scripts/quality_accept.sh au07-behavior-trace-terminal-replay --surface tauri
```

AU-07 文件级收口后的 P1/P2 后续还需要补充：

```text
1. 工作台 why walkthrough：每条 assistant 消息可打开 author-safe 解释。
2. Redaction 测试：raw prompt / hidden policy / sensitive memory / raw tool I/O 不进入作者视图。
3. Developer report：同一 trace 可生成 developer summary，且权限隔离。
4. Replay 六问：reply-only、confirmation、tool、adoption、behavior、UI action 都能解释。
5. Trace API/UI：从持久化 trace 查询旧 turn，离线生成 replay，不调 provider。
6. Work/session 隔离：只能查看当前作品/会话授权范围内的 trace。
```
