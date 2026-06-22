# E2E01 File-Level Closure

- 状态：file-level deliverable / second-round reviewed / P0-P1 closed, P2 Channel security regression registered
- 类型：Acceptance Slice
- 启动日期：2026-06-21

## 1. 用户 / 系统目标

按 `docs/design/acceptance/e2e/E2E-01-full-chain.md` 重算端到端全链路验收的真实完成度，区分真实 Tauri / real LM Studio 证据、application/channel 局部测试和仍未闭环的 E9 文件级缺口。目标不是把 stub integration 包装成完整 E2E，而是让 13 条路径都有可信状态、owner 和恢复命令。

## 2. 开工检查

- Contract: `DecisionTrace` / `TraceRepository` 持久化字段；E2E-01 E1-E13 验收场景；`quality/acceptance/scenarios.yml` 的 `e2e_aggregate` runner；`quality/acceptance/scenarios/e2e-01-full-chain.yml`。
- Invariant: 已实现场景必须能追溯到真实 provider、真实 SQLite、真实 Channel/UI 或明确的局部测试；没有外部真实页面证据不能标“已验收”；trace 必须能按 `turn_id` 回查。
- Boundary: 本 checkpoint 只改 application integration test、外部质量脚本与验收/任务台账；不改 `frontend/src`、`novel_web` production、`novel_agent` runtime 或 provider 注册；不新增 product acceptance hook。
- Consumer: E2E-01 文件级验收报告；`quality_accept.sh e2e-01-full-chain --provider lmstudio`；后续 AU-07 / E2E replay 聚合；trace query / why / replay 调用方。
- Proof: `mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs`；E2E 相关局部测试；现有 Tauri summary artifacts；`bash scripts/quality_accept.sh e2e-01-full-chain --provider lmstudio`；`task_done` 与 static scan。
- Acceptance Driver: 本 checkpoint 新增外部聚合 runner `scripts/e2e_01_full_chain_check.sh`；它不驱动产品内验收逻辑，只复跑/复核已有真实 Tauri artifacts 和局部测试，并输出 `artifacts/slice-verify/e2e-01-full-chain/summary.json`。产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改 |
| novel_domain | no | 不改 |
| novel_agent | yes | 仅改 test/support deterministic provider，production provider/runtime 不改 |
| novel_application | yes | 补 `dialogue_gateway_real_loop_test.exs` 的 trace persister integration proof；调整 Planner prompt 以允许用户明确多动作请求暴露 `action_scope` gate |
| novel_persistence | no | 只消费现有 `WorkspaceContext.trace_persister/0` 与 `TraceRepository.list_by_turn/1` |
| novel_web | no | 不改 Channel runtime |
| frontend | yes | `StructurePanel` 现有可见入口 copy、frame badge downgrade 显示、外部 Tauri driver/verifier |
| docs/design | yes | 更新 E2E-01 文件级矩阵 |
| quality | yes | 新增 `e2e_aggregate` runner、`e2e-01-full-chain` manifest 与可复跑聚合 summary；收紧 `task_done_check.mjs --latest-ui-summary` 只选择 Tauri surface summary |

## 4. 场景状态矩阵

| 场景 | 状态 | 当前证据 | 剩余缺口 |
|---|---|---|---|
| E1 基础对话 | 已验收 | `au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio` + `planner_real_llm_test.exs` | 无 |
| E2 探索方向 | 已验收 | `au02-natural-exploration-no-slot-form-tauri-lmstudio` + real LLM planner tests | 无 |
| E3 上下文感知 | 已验收 | `au03-current-work-context-ssot-tauri-lmstudio` + SQLite context tests | 无 |
| E4 执行降级 | 已验收 | `e2e-01-downgrade-real-page-tauri-lmstudio` + `v3_full_chain_test.exs` stub downgrade | 无 |
| E5 高风险确认 | 已验收 | `au04-confirm-before-execute-tauri-lmstudio` | 无 |
| E6 工具调度 | 已验收 | `e2e-01-readonly-tool-trace-tauri-lmstudio`：真实聊天输入“查看当前角色列表”→ `allow_tool` → `character_roster` success → no-write truthfulness → `TraceRepository.list_by_turn` 回查结构化 tool trace refs | 无 |
| E7 创作产出 | 已验收 | `p1-chapter-draft-generation-tauri` / `p1-chapter-adoption-reading-tauri-lmstudio` | 无 |
| E8 Action 校验 | 部分实现 | stale/disabled/old action Tauri evidence + invented Channel tests | P2：恶意 payload 外部 fuzz harness 可选 |
| E9 回放审计 | 已验收 | `e2e-01-replay-report-tauri-lmstudio`：真实只读工具链生成持久 trace，外部查询 ReplayReport，六问完整且 no-provider | 无 |
| E10 持久化闭环 | 已测试 | 本 checkpoint 新增 DialogueGateway trace persister → SQLite → `list_by_turn` integration test | P1：外部 trace query UI owner AU-07 |
| E11 错误恢复 | 已验收 | `au01-garbage-json-recovery-tauri` + `au10-workbench-recovery-provider-timeout-tauri` | 无 |
| E12 真实两轮回路 | 已验收 | `au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio` + `au03-current-work-context-ssot-tauri-lmstudio` + SQLite real-loop tests | 无 |
| E13 Action 来源校验 | 已测试 | `workspace_channel_v3_test.exs` exact forged `source_turn_result` rejection | P2：保持 Channel security regression |

## 4.1 二轮剩余缺口矩阵（2026-06-22）

二轮复核重新跑了当前 E2E-01 quality 入口：`e2e-01-downgrade-real-page --surface tauri --provider lmstudio`、`e2e-01-readonly-tool-trace --surface tauri --provider lmstudio`、`e2e-01-replay-report --surface tauri --provider lmstudio`、`e2e-01-full-chain --provider lmstudio`。本轮只发现并关闭聚合 artifact 的 cross-reference 漂移：E12/E13 名称已对齐 E2E-01 正文，`remaining_gaps` 已拆分 E8/E13。未发现 E2E-01 内应继续关闭的 P1/P0。

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 E2E-01 内关闭 | 建议 checkpoint / slice | 是否满足本轮二轮退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| E1 基础对话 | 已验收 | 无 | closed | closed | `au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio`；`e2e-01-full-chain` 聚合矩阵 | 无 | no | 保持 AU-01 / E2E 聚合回归 | 是 |
| E2 探索方向 | 已验收 | 无 | closed | closed | `au02-natural-exploration-no-slot-form-tauri-lmstudio`；`e2e-01-full-chain` 聚合矩阵 | 无 | no | 保持 AU-02 / E2E 聚合回归 | 是 |
| E3 上下文感知 | 已验收 | 无 | closed | closed | `au03-current-work-context-ssot-tauri-lmstudio`；`mix-application-real-loop` | 无 | no | 保持 AU-03 / E2E 聚合回归 | 是 |
| E4 执行降级 | 已验收 | 无；本轮真实 Tauri + LM Studio 复跑通过 | current evidence refreshed | closed | `e2e-01-downgrade-real-page-tauri-lmstudio/summary.json`：`downgrade_to_dialogue`、`first_blocking_gate=action_scope`、LM Studio request_count=2 | 无 | no | 保持 `e2e-01-downgrade-real-page` | 是 |
| E5 高风险确认 | 已验收 | 无 | closed | closed | `au04-confirm-before-execute-tauri-lmstudio`；`mix-e2e-integration` | 无 | no | 保持 AU-04 / E2E 聚合回归 | 是 |
| E6 工具调度 | 已验收 | 无；本轮真实 Tauri + LM Studio 复跑通过 | current evidence refreshed | closed | `e2e-01-readonly-tool-trace-tauri-lmstudio/summary.json`：`allow_tool`、`character_roster`、tool_status succeeded、`TraceRepository.list_by_turn` 返回 tool trace ref | 无 | no | 保持 `e2e-01-readonly-tool-trace` | 是 |
| E7 创作产出 | 已验收 | 无 | closed | closed | `p1-chapter-draft-generation-tauri`；`p1-chapter-adoption-reading-tauri-lmstudio` | 无 | no | 保持 AU-05/AU-08 cross evidence | 是 |
| E8 Action 校验 | 部分实现 | invented action exact negative 仍是恶意 Channel payload；正常真实 UI 不应提供构造入口 | security regression / non-user UI path | P2 | stale/disabled/old action 有 Tauri 证据；invented negative 有 `workspace_channel_v3_test.exs` 和 `mix-channel-replay-trace` | 若后续需要外部协议 fuzz harness，可新增 Channel-level external fuzz driver；不应在产品 UI 加构造入口 | no | 后续 Channel security regression / protocol fuzz | 是 |
| E9 回放审计 | 已验收 | 无；本轮真实 Tauri + LM Studio 复跑通过 | current evidence refreshed | closed | `e2e-01-replay-report-tauri-lmstudio/summary.json`：no-provider ReplayReport、chain steps frame/plan/decision/tool_trace/turn_result、VS-06 六问 answered/not_applicable | 无 | no | 保持 `e2e-01-replay-report` | 是 |
| E10 持久化闭环 | 已测试 | 无真实页面 trace query UI；application/persistence proof 已闭合，页面查询入口继续归 AU-07 | cross-reference | P1 owner: AU-07 | `dialogue_gateway_real_loop_test.exs`；`trace_repository_test.exs`；`e2e-01-readonly-tool-trace` / `e2e-01-replay-report` 间接证明外部查询可用 | AU-07 若做旧 turn trace query API/UI，再补真实页面 driver | no | AU-07 old-turn trace query / developer replay | 是 |
| E11 错误恢复 | 已验收 | 无 | closed | closed | `au01-garbage-json-recovery-tauri`；`au10-workbench-recovery-provider-timeout-tauri` | 无 | no | 保持 AU-01/AU-10 recovery 回归 | 是 |
| E12 真实两轮回路 | 已验收 | 聚合 summary 名称曾漂移为旧标签；本轮已修正并复跑聚合 runner | cross-reference closed | closed | `e2e-01-full-chain/summary.json` 当前输出 `E12 真实两轮回路`；`au01-ordinary-chat-two-turn-roundtrip-tauri-lmstudio`；`au03-current-work-context-ssot-tauri-lmstudio` | 无 | 已关闭 | `e2e-01-full-chain` 聚合 artifact hygiene | 是 |
| E13 Action 来源校验 | 已测试 | forged `source_turn_result` exact negative 是恶意 Channel payload；正常 UI 不应提供构造入口；聚合 summary 名称与 remaining gaps 曾漂移，本轮已修正 | security regression / cross-reference closed | P2 | `workspace_channel_v3_test.exs`；`mix-e2e-integration`；`mix-real-lmstudio`；`e2e-01-full-chain/summary.json` 当前输出 `E13 Action 来源校验` 并列 remaining gap | 若后续需要外部协议 fuzz harness，可新增 Channel-level external fuzz driver；不应在产品 UI 加构造入口 | no | 后续 Channel security regression / protocol fuzz | 是 |

二轮退出判断：满足。E2E-01 当前仍为 10/13 已验收、2/13 已测试、1/13 部分实现；P0/P1 维持关闭，E8/E13 均明确登记为 P2 Channel security regression，E10 的页面 trace query 为 AU-07 cross-reference owner，不阻塞 E2E-01 本轮退出。

## 5. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 重算 E2E-01 13 场景状态矩阵 | done | 10/13 已验收、2/13 已测试、1/13 部分实现 |
| T2 | 补 E10 trace persister → SQLite → `list_by_turn` proof | done | `dialogue_gateway_real_loop_test.exs` 新增 integration case |
| T3 | 更新 E2E-01 验收文件 | done | 旧覆盖表已替换为当前证据矩阵 |
| T4 | 同步 README / ledger / task_done / static scan | done | `task_done` manifest 通过；static scan 仅剩既有 gitleaks accepted_risk，0 touched-file finding |
| T5 | 设计 E2E 聚合 runner | done | 采用外部 `e2e_aggregate` runner，不改产品 runtime |
| T6 | 实现并运行 E2E 聚合 runner | done | `bash scripts/quality_accept.sh e2e-01-full-chain --provider lmstudio` 通过；summary 写入 `artifacts/slice-verify/e2e-01-full-chain/summary.json` |
| T7 | 修正 task_done 自动 UI evidence 选择 | done | 聚合 summary 不再被当作 Tauri UI evidence；`node scripts/task_done_check.mjs --latest-ui-summary` 返回最新 Tauri summary |
| T8 | E4 真实页面多步 MicroPlan 降级 checkpoint | done | `quality_accept.sh e2e-01-downgrade-real-page --surface tauri --provider lmstudio` 通过；summary 写入 `artifacts/slice-verify/e2e-01-downgrade-real-page-tauri-lmstudio/summary.json` |
| T9 | E6 指定低风险只读 tool dispatch + trace query checkpoint | done | 从真实工作台“查看当前角色列表”触发 `character_roster`，证明 `allow_tool`、Toolbox success、no-write truthfulness 与 `TraceRepository.list_by_turn` 回查 |
| T10 | E9 完整 ReplayReport 六问 checkpoint | done | `quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio` 通过；E2E 聚合 runner 已消费该 summary 并将 E9 升级为已验收 |
| T11 | 二轮复跑 E2E-01 当前 quality 入口 | done | 三个真实 Tauri + LM Studio checkpoint 和 `e2e-01-full-chain` 聚合 runner 均于 2026-06-22 复跑通过 |
| T12 | 修正聚合 artifact cross-reference 漂移 | done | `scripts/e2e_01_full_chain_check.sh` 的 E12/E13 名称与 E8/E13 remaining gaps 已对齐 E2E-01 正文；聚合 summary 已重新生成 |

## 5.1 E4 真实页面降级 checkpoint 开工检查

- Contract: E2E-01 E4；`MicroPlan.proposed_actions`；`GateOrder.action_scope`；`OrchestratorDecision.decision_type = downgrade_to_dialogue`；TurnResult truthfulness；`STRUCTURE_PANEL.panelActions.overview.prompt`；`quality/acceptance/scenarios/e2e-01-downgrade-real-page.yml`。
- Invariant: 明确多动作请求必须在 Orchestrator 的 `action_scope` gate 降级为对话；不得触发 `toolbox.execute`、`author_action`、`adoption.evaluate`、确认卡执行或 production write。通过 app log、websocket frame、ui-state summary 与 LM Studio request log 联合验证。
- Boundary: 切穿真实 Tauri 工作台按钮 → Channel `user_message` → application Planner / Orchestrator → TurnResult → 前端可见反馈 → native verifier。可改 application planner prompt、test/support provider、集中 copy、外部 driver/verifier 和 quality manifest；不改 production provider runtime，不新增产品验收 env/query/localStorage/DOM hook。
- Consumer: 第一个真实消费者是作者在档案面板概览中点击“发起综合修订”；质量消费者是 `scripts/quality_accept.sh e2e-01-downgrade-real-page --surface tauri --provider lmstudio`。
- Proof: `mix test --include integration apps/novel_e2e/test/novel_e2e/v3_full_chain_test.exs`；`bash scripts/tauri_slice_verify.sh e2e-01-downgrade-real-page`；`bash scripts/tauri_slice_verify.sh --real-lmstudio e2e-01-downgrade-real-page`；`bash scripts/quality_accept.sh e2e-01-downgrade-real-page --surface tauri --provider lmstudio`；`quality_manifest_check`、`task_done`、`ai_static_scan`。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 中的 `e2e-01-downgrade-real-page` 外部 Tauri driver。产品代码新增验收感知逻辑：no。

### 5.2 E4 checkpoint 结果

- 已关闭偏差：Planner prompt 不再强制所有请求压成单 action；当用户明确要求多个独立操作时，真实 LLM 会输出多项 `proposed_actions`，由 Orchestrator 的 `action_scope` gate 降级，而不是让 UI/验收脚本绕过主链。
- 已关闭 UI 偏差：执行候选被降级时，工作台 badge 改为“降级为对话”，不再误显示“生成草稿”。
- 真实页面证据：`artifacts/slice-verify/e2e-01-downgrade-real-page-tauri-lmstudio/summary.json` 记录 provider=`lmstudio`、2 次 LM Studio 2xx、`decision_type=downgrade_to_dialogue`、`first_blocking_gate=action_scope`、无 `toolbox.execute`、无 `author_action`、无执行/采纳控件、无 production write、降级 badge 可见。
- 确定性回归证据：`artifacts/slice-verify/e2e-01-downgrade-real-page-tauri/summary.json` 使用 test/support provider 证明同一 Tauri driver/verifier 可离线复跑。

## 5.3 E6 指定只读工具 checkpoint 开工检查

- Contract: E2E-01 E6；`docs/design/03-capability-toolbox-contract.md`；ADR-0011 / ADR-0012；`VS-02-tool-provenance-contract-pack.md`；`CapabilityRegistryEntry` / `ToolRequest` / `ToolResult`；`DecisionTrace.tool_trace_refs`；`TraceRepository.list_by_turn/1`。
- Invariant: Planner 只能建议 `character_roster`，Orchestrator 才能裁决 `allow_tool`；ToolRequest grants 不能超过 registry scope；`character_roster` 是低风险 read-only 工具，不能产生 production write、adoption、author_action 或写入 state_delta；tool trace 必须进入持久化 DecisionTrace 并可按 turn 回查。
- Boundary: 切穿真实 Tauri 工作台可见入口 → Channel `user_message` → Planner / MicroPlan → Orchestrator → `TurnExecutionService` → agent-side Toolbox adapter → TurnResult → TraceWriter → SQLite `TraceRepository.list_by_turn` → native verifier。允许改 `novel_common` registry、`novel_agent` adapter registry/adapter、`novel_application` ToolRequest input/narration/prompt、外部 driver/verifier、quality manifest 和台账；不改 `novel_persistence` schema，不让 `novel_agent` 直接读 Repo，不在 `frontend/src` 增加验收 hook。
- Consumer: 第一个真实消费者是作者在真实工作台查看/询问当前作品角色列表；质量消费者是 `scripts/quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio` 与 E2E-01 聚合 runner。
- Proof: 新增/更新 tool provenance、DialogueGateway real-loop trace persistence、native verifier tests；运行 `bash scripts/tauri_slice_verify.sh e2e-01-readonly-tool-trace`、`bash scripts/tauri_slice_verify.sh --real-lmstudio e2e-01-readonly-tool-trace`、`bash scripts/quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio`、`bash scripts/quality_accept.sh e2e-01-full-chain --provider lmstudio`、`task_done` 与 static scan。
- Acceptance Driver: 外部 Tauri driver `frontend/slice-verify/external-ui-driver.mjs` 中新增 `e2e-01-readonly-tool-trace`；产品代码新增验收感知逻辑：no。driver 只使用可见聊天输入、websocket frame、app log 与持久化 trace 查询证据。

### 5.4 E6 checkpoint 结果

- 已关闭缺口：E6 不再只依赖泛化 creative tool 或 stub `allow_tool`，已有独立真实 Tauri / real LM Studio 场景覆盖指定低风险只读角色列表查询。
- 已补实现：新增 production registry capability `character_roster`、agent-side read-only adapter、application 层角色列表读取注入 ToolRequest、Planner prompt / deterministic provider 识别“查看当前角色列表”、ToolResult narration 显式声明 no-write。
- 真实页面证据：`artifacts/slice-verify/e2e-01-readonly-tool-trace-tauri-lmstudio/summary.json` 记录 provider=`lmstudio`、2 次 LM Studio 2xx、`decision_type=allow_tool`、`tool_name=character_roster`、Toolbox success、accepted character visible、tentative / foreign character absent、无 `author_action` / adoption / execution controls、无 production write，且外部 `TraceRepository.list_by_turn` 返回结构化 `tool_trace_refs`。
- 确定性回归证据：`artifacts/slice-verify/e2e-01-readonly-tool-trace-tauri/summary.json` 使用 test/support provider 证明同一 Tauri driver/verifier 可离线复跑。

## 5.5 E9 完整 ReplayReport 六问 checkpoint 开工检查

- Contract: E2E-01 E9；`docs/design/contracts/VS-06-replay-surface-contract-pack.md` 的 `ReplayReport` / 六问；ADR-0017 structural replay；`DecisionTrace.frame_ref` / `plan_ref` / `tool_trace_refs` / `behavior_trace_refs` / `state_trace_refs`；`TraceRepository.list_by_turn/1`。
- Invariant: ReplayReport 必须只由持久 trace 构建，不调用 provider；planner-mediated turn 必须保留 frame/plan/decision/tool/TurnResult 链；VS-06 六问必须有 answered / not_applicable / missing 的显式状态，缺关键 ref 时 `result_status` 不得冒充 complete。
- Boundary: 切穿真实 Tauri 工作台 → Channel → Planner / MicroPlan → Orchestrator → Tool adapter → TraceWriter → SQLite DecisionTrace → 外部 verifier 查询 `ReplayService.build_report/1`。允许改 domain/application/persistence trace 字段、ReplayService、外部 driver/verifier、quality manifest 和台账；不改 production UI hook，不把 fixture provider 注册进 production runtime。
- Consumer: 第一个真实消费者是 AU-07 / E2E replay surface 的结构化审计报告；质量消费者是 `scripts/quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio` 与 E2E-01 聚合 runner。
- Proof: `mix test apps/novel_application/test/novel_application/replay_service_test.exs apps/novel_persistence/test/novel_persistence/trace_repository_test.exs apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs`；`node --check frontend/slice-verify/external-ui-driver.mjs`；`node --check frontend/slice-verify/native-tauri-verifier.mjs`；`cd frontend && pnpm test -- native-tauri-verifier --runInBand`；`bash scripts/tauri_slice_verify.sh e2e-01-replay-report`；`bash scripts/tauri_slice_verify.sh --real-lmstudio e2e-01-replay-report`；`bash scripts/quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio`；`quality_accept.sh e2e-01-full-chain --provider lmstudio`；`task_done` 与 static scan。
- Acceptance Driver: 外部 Tauri driver `frontend/slice-verify/external-ui-driver.mjs` 中的 `e2e-01-replay-report`。产品代码新增验收感知逻辑：no；driver 只使用可见聊天输入、websocket frame、app log、SQLite trace 查询与 replay report 结构断言。

### 5.6 E9 checkpoint 结果

- 已关闭缺口：E9 不再只依赖 AU-07 why/ref producer 与局部 ReplayService test；已有独立真实 Tauri / real LM Studio 场景从持久 `DecisionTrace` 构建完整 `ReplayReport`。
- 已补实现：`DecisionTrace` / `DecisionTraceRecord` 增加 `plan_ref`；`TraceWriter`、Channel action trace 和 DialogueGateway 持久化 `plan_ref`；`ReplayReport` 增加 `required_questions`；`ReplayService` 输出 VS-06 六问状态并将缺失 `plan_ref` 计入 partial。
- 真实页面证据：`artifacts/slice-verify/e2e-01-replay-report-tauri-lmstudio/summary.json` 记录 provider=`lmstudio`、2 次 LM Studio 2xx、`decision_type=allow_tool`、`tool_name=character_roster`、Toolbox success、ReplayReport `provider_called=false`、`result_status=complete`、缺失引用为空、链路包含 frame / plan / decision / tool_trace / turn_result，六问均为 `answered` 或 `not_applicable`。
- 确定性回归证据：`artifacts/slice-verify/e2e-01-replay-report-tauri/summary.json` 使用 test/support provider 证明同一 Tauri driver/verifier 可离线复跑。

## 6. 验证

- [x] `bash scripts/tauri_slice_verify.sh --list`
- [x] `mix test --include integration apps/novel_e2e/test/novel_e2e/v3_full_chain_test.exs`
- [x] `mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs`
- [x] `mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs apps/novel_application/test/novel_application/replay_service_test.exs apps/novel_persistence/test/novel_persistence/trace_repository_test.exs`
- [x] `mix test --include real_llm apps/novel_application/test/novel_application/planner_real_llm_test.exs`
- [x] `bash scripts/quality_accept.sh e2e-01-full-chain --provider lmstudio`
- [x] `mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs apps/novel_application/test/novel_application/execution_authority_test.exs`
- [x] `cd frontend && pnpm test -- framePresentation`
- [x] `cd frontend && pnpm typecheck`
- [x] `bash scripts/tauri_slice_verify.sh e2e-01-downgrade-real-page`
- [x] `bash scripts/tauri_slice_verify.sh --real-lmstudio e2e-01-downgrade-real-page`
- [x] `bash scripts/quality_accept.sh e2e-01-downgrade-real-page --surface tauri --provider lmstudio`
- [x] `mix test apps/novel_application/test/novel_application/tool_provenance_test.exs apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs`
- [x] `node --check frontend/slice-verify/external-ui-driver.mjs && node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `cd frontend && pnpm test -- native-tauri-verifier --runInBand`
- [x] `bash scripts/tauri_slice_verify.sh e2e-01-readonly-tool-trace`
- [x] `bash scripts/tauri_slice_verify.sh --real-lmstudio e2e-01-readonly-tool-trace`
- [x] `bash scripts/quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio`
- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `cd frontend && pnpm test -- native-tauri-verifier --runInBand`
- [x] `mix test apps/novel_application/test/novel_application/replay_service_test.exs apps/novel_persistence/test/novel_persistence/trace_repository_test.exs apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs`
- [x] `mix test --include integration apps/novel_application/test/novel_application/dialogue_gateway_real_loop_test.exs`
- [x] `bash scripts/tauri_slice_verify.sh e2e-01-replay-report`
- [x] `bash scripts/tauri_slice_verify.sh --real-lmstudio e2e-01-replay-report`
- [x] `bash scripts/quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio`
- [x] `bash scripts/quality_accept.sh e2e-01-full-chain --provider lmstudio`
- [x] `bash scripts/quality_accept.sh e2e-01-downgrade-real-page --surface tauri --provider lmstudio`（2026-06-22 二轮复跑）
- [x] `bash scripts/quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio`（2026-06-22 二轮复跑）
- [x] `bash scripts/quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio`（2026-06-22 二轮复跑）
- [x] `bash scripts/quality_accept.sh e2e-01-full-chain --provider lmstudio`（2026-06-22 二轮复跑；聚合 summary 名称和 remaining gaps 已对齐）
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `node scripts/task_done_check.mjs --latest-ui-summary`
- [x] `bash scripts/task_done.sh --top 10`

## 7. 决策日志

- 2026-06-21 — 旧 E2E-01 覆盖表把 stub integration 写成完整 E2E，不符合场景化验收红线；本轮改为按真实 Tauri / real LM Studio / SQLite / Channel 局部证据分层标注。
- 2026-06-21 — E10 的 `TraceRepository.list_by_turn/1` 断点由 application/persistence integration test 补齐；不把它标“已验收”，因为没有外部真实页面 trace query UI。
- 2026-06-21 — 已补 `e2e_aggregate` runner 和 `quality/acceptance/scenarios/e2e-01-full-chain.yml`，入口为 `scripts/e2e_01_full_chain_check.sh --provider lmstudio`；runner 只聚合既有真实 Tauri artifacts 与局部测试，E4/E6 只有在独立 Tauri summary 存在且断言通过后才升级为已验收，E9 仍需后续完整 ReplayReport 证据。
- 2026-06-21 — 因 E2E 聚合 summary 位于 `artifacts/slice-verify/` 但不是 Tauri surface，`task_done_check.mjs --latest-ui-summary` 已改为只选择 `surface: "tauri"` 的 summary，避免 task_done 自动拿聚合 summary 充当 UI evidence。
- 2026-06-21 — `task_done` 复用当前最新 AU12 UI evidence，因为本 checkpoint 未改 frontend / Tauri driver；静态扫描剩余 Top 10 为历史 gitleaks accepted_risk，不在 touched files。
- 2026-06-21 — E4 真实页面 downgrade 已补独立 Tauri driver / quality manifest。实现同时修正 Planner prompt 的设计偏差（显式多动作请求不能被压成单 action）和 UI badge 偏差（降级 turn 不再显示“生成草稿”）。
- 2026-06-21 — E6 只读工具 dispatch 已补独立 Tauri driver / quality manifest。`character_roster` 是 production registry 中显式低风险 read-only capability，agent adapter 只消费 application 注入的角色列表，不跨边界读 Repo；外部 driver 用 `TraceRepository.list_by_turn` 查询持久 trace，不新增产品验收 hook。
- 2026-06-21 — E9 完整 ReplayReport 六问已补独立 Tauri driver / quality manifest。实现只扩展持久 trace/ref 与 structural replay report，不调用 provider、不写业务状态、不新增产品验收 hook；E2E 聚合矩阵更新为 10/13 已验收、2/13 已测试、1/13 部分实现。
- 2026-06-22 — 二轮复跑 E2E-01 当前四个 quality 入口全部通过；本轮只关闭聚合 artifact cross-reference 漂移：E12/E13 名称对齐验收正文，E8/E13 remaining gaps 分开登记。E8/E13 仍是 P2 Channel security regression，E10 页面 trace query 仍归 AU-07 owner，不阻塞 E2E-01 退出。

## 8. 试行反馈

E2E-01 已具备独立聚合 runner，可作为当前文件级质量入口复跑。E4 真实页面 downgrade、E6 只读 tool trace、E9 完整 ReplayReport 六问 checkpoint 均已关闭；二轮复跑已确认当前证据仍通过，并修正聚合 artifact 的 E12/E13 cross-reference 漂移。文件级 P0/P1 已关闭，E8/E13 invented / forged source negative 继续作为 P2 Channel security regression，当前文件满足本轮二轮退出标准。
