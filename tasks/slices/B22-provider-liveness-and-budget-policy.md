# B22-provider-liveness-and-budget-policy：Provider 存活时限与预算策略（三层时钟 + 诊断 + 作者可见长等待）

**状态**：**done（2026-10-23，CP1–CP4 全落）**。作者拍板原则：**只要模型还在稳定出字就不杀**；总挂钟不是默认控制，liveness（有没有 wire data）+ token 预算承担。CP4 真实 Tauri `agent-provider-slow-stream-liveness` PASS（真实 LM Studio adapter + 本地慢流替身：700ms/块持续 ~7s、legacy timeout=3s 仅作 wire 静默窗口，不再总杀；作者可见「已运行」5.2s 出现）。诚实边界：`(provider, model, thinking)` 自适应校准**明确保留 bootstrap 并登记为 C 轨观察项**（不冒充已校准）；run 级预算 / checkpoint 另立后续切面（见 §2c）。
**来源**：B22 作者 2026-10-22 方向修正（第一版「三层硬超时」规格被作者否决，写死挂钟数字作废，不得再冻结）；设计真源 `docs/design/foundation/08-provider-abstraction.md` §25；相关既有 slice：`tasks/slices/UA01-dynamic-agent-run-budget.md`（run 级预算，registered）、`tasks/slices/D4-planner-transient-retry.md`（既有计划起草单次重试）、`tasks/slices/DS03-awaiting-author-runtime-validity-and-recovery-surface.md`（writer timeout 恢复出口）；作者可见标识纪律 `docs/design/ui/46-state-and-feedback.md` §9.5 第 4 条。
**前置**：`UA01-provider-execution-stream-unification`（ProviderRun / ProviderEvent / ProviderOutput 与 `Provider.Execution` 依赖收敛——B22 的 ctx 注入与诊断挂在同一执行流上，不新增并行分支）；`D4`（既有 planner 单次瞬态重试，B22 不改变）。

## 0. 现状核查（2026-10-22 只读侦察，证据抽样）

| 环节 | B22 前 | B22 后（当前 working tree） |
|---|---|---|
| 时限口径 | 单个 `state.timeout` 同时当 Req `receive_timeout` 与流式挂钟总时长（`OpenAICompatibleStream` / `AnthropicStream` 的 `deadline_ms = state.timeout`），300s 必杀 | connect / response wire 静默 / non_stream 三层时钟；总时长兜底 `deadline` 默认 `nil`（`Provider.TimeoutPolicy`） |
| 配置 | LM Studio / Strata 的 config 写 `timeout: 300000`；hosted 亦写 `timeout` | 本地 provider 删除 `timeout`；hosted 保留 legacy `timeout`，只作静默 / 非流式窗口，不再总杀 |
| 解析入口 | 各 adapter 自行用 `state.timeout` | `Gateway.execute/4` 单点 `resolve_timeout_policy/2` → `ctx.timeout_policy`；adapter 经 `AdapterExecution` helper 消费 |
| 超时诊断 | 只有 `:timeout` + 通用文案，不区分「从未出字」与「出字后中断」 | `timeout_kind` = `:connection_stall` / `:stream_interrupted` / `:deadline` + `details`（`response_timeout_ms` / `deadline_ms` / `duration_ms` / `ttft_ms` / `output_chars` / `output_chunks` / `wire_chunks`） |
| 作者失败语义 | `Planner` 只有 `:provider_timeout` 通用文案；`run_failed` 只有 `provider_error` | `Planner.provider_failure_fallback_message/1` 三类结构文案；`AgentRunServer` 原因码 `provider_timeout_<kind>` + 结构摘要（含字数） |
| 作者等待可见性 | 非终态只有脉冲 / 活动行；慢模型看起来像卡死 | 「已运行 N 分 M 秒」真实墙钟（`run_started` 锚点、5s 门槛、仅非终态） |
| 探活 | health / models 沿用 provider 长 timeout | `TimeoutPolicy.probe_timeout/1` 上限 15s（legacy 更短时尊重 legacy） |
| 自动重试 | provider retryable hint + D4 计划起草单次重试 | 不新增自动重试；既有例外保持（§25.6） |
| 验证 | 无 B22 测试 | `timeout_policy_test`、`lm_studio_test` B22 cases、`upstream_error_test`、`planner_provider_failure_message_test`、`agent_run_runtime_test` 新 case、前端 elapsed test |

## 1. 开工检查（七问）

1. **Contract**：`08-provider-abstraction.md` §25（B22 冻结，替代「单一 `timeout` = 单次调用总挂钟」旧口径）；消费既有 §10 ProviderError（`error_class = TIMEOUT`）、§11 Retryability（provider 只给 hint）语义；`NovelFoundation.UpstreamError.details` 透传契约；AgentRun 失败终局安全兜底 TurnResult 契约；`46-state-and-feedback.md` §9.5 第 4 条作者可见标识连续性。**无新 ADR**：策略由 08 §25 冻结；若未来引入 run 级预算 / 自动重试，需另立契约与 slice。
2. **Invariant**：① 仍在稳定出字的健康长调用不得被总挂钟误杀（出字即续命）；② `response` 窗口只按 wire 静默判挂死，不是业务时限；③ 总时长兜底默认关闭、仅显式配置启用；④ 超时诊断只用结构事实（kind + 数字），作者可见文本零 provider 原始 message（N-NARR / `docs/design/ui/47-ui-copy-guidelines.md` 红线）；⑤ 超时失败终局总有安全兜底 TurnResult、本轮零写入；⑥ legacy 配置兼容（hosted `timeout` 退化为静默 / 非流式窗口，不再总杀）；⑦ B22 不新增自动重试。
3. **Boundary**：涉及 `novel_agent`（`TimeoutPolicy` / `AdapterExecution` / `Gateway` / 两个 stream / 四个 adapter / `InferenceParams` 注释）、`novel_application`（`Planner` / `AgentRunServer`）、`novel_foundation`（`UpstreamError`）、`config`（config / dev / prod）、`frontend`（`WorkspaceChat.tsx` / `copy.ts`）。**明确不改**：AgentPlan / 编排协议、token 预算语义、ProviderRun / ProviderEvent / ProviderOutput 契约字段、持久化 schema、prompt 资产、46 / 47 设计文档正文（只引用）、`tasks/NEXT.md` 与 `docs/project-ledger.md`（Lead 集成批）。
4. **Consumer**：`Gateway.execute/4` 的所有 provider 调用；流式 adapter（`OpenAICompatibleStream` / `AnthropicStream`）；`Planner.provider_failure_fallback_message/1`；`AgentRunServer.failure_family_reason_codes/1` 与 `failure_author_summary/1`；前端 `AgentRunDialogueFlow` 的作者等待指示器；llm-calls JSONL / provider_gateway 业务日志的超时诊断。
5. **Proof**：CP1–CP3 目标测试本地实跑（见 §3）；全量后端 / 前端 / 架构 / I1/I2/I3/N-NARR 以 Lead 集成批报告为准；CP4 外部自动化真实页面 PASS（未做，不冒充）。
6. **Acceptance Driver**：计划由外部 Tauri / Playwright driver 驱动真实工作台——慢而持续出字的流不误杀且作者可见真实等待；静默流以结构失败文案收束、无写入。慢流由 test/support 或外部 harness 注入的 provider 替身产生（不进生产 runtime）；断言只用页面可见语义（elapsed 文案、失败文案、无 `data-testid` / 验收专用开关）。场景 id 与 harness 入口在 CP4 拍板时登记进 `quality/acceptance/scenarios/`（沿用 `au10-workbench-recovery-provider-timeout` / `b17-writer-timeout-steer` 同类真实页面驱动纪律）。**产品代码新增验收感知逻辑：no**。场景已登记：`agent-provider-slow-stream-liveness`（CP4 done，见 §2d）。
7. **Exploration**：不适用——本 slice 不物化 novel element 要素（无新实体 / 槽位 / 探索面对象），只改 provider 存活时限判定、超时诊断与作者等待可见性；探索面同步律无新增可达对象。

## 2. CP 路线

| CP | 内容 | 证明 | 状态 |
|---|---|---|---|
| **CP1** | 策略 SSOT + adapter 接线：`Provider.TimeoutPolicy.resolve/2`（connect / response / non_stream / 可选 deadline、local = `:lmstudio` + `:strata`、env 优先级、`0`/`off`/`disabled` 关闭、probe cap）+ `AdapterExecution` helpers + `Gateway` 单点 `resolve_timeout_policy/2` 注入 ctx + `OpenAICompatibleStream` / `AnthropicStream` 改用响应窗口 + 四个 adapter 的流式 / 探活 / 工具调用接线（四个 adapter 的 tool-call 均接 `non_stream_timeout`；Anthropic 经 `do_complete/4` 注入）+ `config/*.exs` 本地 provider 去 `timeout` | `mix test .../timeout_policy_test.exs` 16/0；`lm_studio_test.exs` / `anthropic_test.exs` B22 cases（慢流不杀 / 静默分类 / deadline opt-in / 非流式窗口）；compile | **done（2026-10-22）** |
| **CP2** | 超时诊断 + 作者失败语义：流式 `timeout_kind` + `diagnostics`（ttft / output / wire chunks）+ `UpstreamError.details` 透传 + `Planner` 三类作者安全文案 + `AgentRunServer` 原因码 / 摘要 + 应用层新测试 | `upstream_error_test.exs` 16/0；`planner_provider_failure_message_test.exs` 4/0；`agent_run_runtime_test.exs` 新 case（结构 reason code + 摘要不含 raw payload） | **done（2026-10-22）** |
| **CP3** | 前端真实等待：`WorkspaceChat.tsx` `useAgentRunElapsedSeconds` / `agentRunElapsedAnchorMs`（`run_started` emitted_at 锚点、5s 门槛、仅非终态、1s tick、无合成进度）+ `copy.ts` `WORKBENCH.agentRunElapsedLabel` + 组件测试 | `WorkspaceChat.agentRunElapsed.test.tsx`（前端套件与 design trace 以集成报告为准） | **done（2026-10-22）** |
| **CP4** | 真实页面慢流验收 + 自适应校准：外部自动化驱动真实工作台（慢而持续出字 → 不误杀、elapsed 可见；静默 → 结构失败文案、无写入、输入可恢复）；按 `(provider, model, thinking)` 实测 TTFT p99 校准 response 窗口（或明确保留 bootstrap 并登记）；run 级预算 / checkpoint 另立后续切面 | 外部自动化真实页面 PASS + `artifacts/slice-verify/...` + I1/I2/I3/N-NARR | **done（2026-10-23）**：新真实 Tauri `agent-provider-slow-stream-liveness` PASS（LM Studio adapter + 本地慢流替身；`streamed_ms=7000`、`elapsed_visible_at_ms=5228`、`provider_timeout_count=0`、turn status conversational；证据 `artifacts/slice-verify/agent-provider-slow-stream-liveness-tauri/summary.json`）；自适应校准明确保留 bootstrap 并登记 C 轨观察（不冒充） |

**依赖**：CP1 + CP2 同批（诊断依赖策略）→ CP3；CP4 独立于 CP1–CP3，但必须真实页面闭环后才可写 done。

## 2b. 交付结果（2026-10-22 CP1–CP3）

**CP1 策略 + 接线（done）**：`apps/novel_agent/lib/novel_agent/provider/timeout_policy.ex`（`resolve/2` 纯解析：profile、三层默认值、env / config 优先级、`deadline` 仅显式启用、probe 15s 上限）；`adapter_execution.ex`（`timeout_policy/1`、`response_timeout/2`、`non_stream_timeout/2`、`deadline_timeout/1`、`connect_timeout/2`、`probe_timeout/1`）；`gateway.ex`（`resolve_timeout_policy/2` 单点解析并注入 `ctx.timeout_policy`）；`openai_compatible_stream.ex` / `anthropic_stream.ex`（流式只设 wire 静默窗口，`deadline` 默认关闭、仅显式开启时在应用层判定）；`openai_compatible.ex` / `lm_studio.ex` / `deep_seek.ex` / `anthropic.ex`（流式 `response_timeout`、探活 `probe_timeout`、`connect_timeout`；四个 adapter 的 tool-call 均接 `non_stream_timeout`，Anthropic 经 `do_complete/4` 注入）；`inference_params.ex`（max_tokens 定位注释修正）；`config/config.exs` / `config/dev.exs` / `config/prod.exs`（本地 provider 不再配置总时长 `timeout`，hosted legacy `timeout` 仅作窗口兜底）。

**CP2 诊断 + 作者失败语义（done）**：两个 stream 的 `timeout_kind` 分类（`ttft_ms == nil && output == 0` → `:connection_stall`，否则 `:stream_interrupted`；`deadline` 分支 → `:deadline`）与 `diagnostics`；`UpstreamError.to_error_tuple/1` 原样透传 `details`；`Planner.provider_failure_fallback_message/1` 三类结构性作者文案（无 details 的旧错误保留通用超时文案）；`AgentRunServer.failure_family_reason_codes/1` 产出 `provider_error` + `provider_timeout_<kind>`，`failure_author_summary/1` 只用结构类别与字数；超时仍走安全兜底 TurnResult、本轮零写入。

**CP3 前端真实等待（done）**：`frontend/src/components/WorkspaceChat.tsx`（`agentRunElapsedAnchorMs`：最新作者可见 `run_started` 的 `emitted_at`，回退最早事件；`useAgentRunElapsedSeconds`：5s 门槛、1s tick、仅 `created / running / pausing / cancelling`）；`frontend/src/lib/copy.ts`（`WORKBENCH.agentRunElapsedLabel`，输出「已运行 N 分 M 秒 / N 小时 M 分」）；`frontend/src/components/WorkspaceChat.agentRunElapsed.test.tsx`。

**验证（2026-10-22 本地实跑）**：`timeout_policy_test.exs` + `upstream_error_test.exs` → 24 tests / 0 failures；`lm_studio_test.exs` + `planner_provider_failure_message_test.exs` → 30 tests / 0 failures。

**Lead 集成批验证（2026-10-22）**：后端全量 **1,745 tests / 0 failures**；compile `--warnings-as-errors`、format、xref cycles、arch check 全绿；I1/I2/I3 三个场景不变量全绿；前端 `pnpm typecheck` / `pnpm lint` / `pnpm test -- --run` **524 tests / 0 failures**、design trace **16/0/0**；真实 Tauri 回归 `PHOENIX_PORT=4661 VITE_DEV_PORT=5771 bash scripts/tauri_slice_verify.sh p1-prose-execution-brief` **PASS**（真实工作台 ArchiveOutline → 生成正文 draft 链，证据 `artifacts/slice-verify/p1-prose-execution-brief-tauri/summary.json`；该场景 stub provider 秒回，只证明 UI 改动未破坏真实 AgentRun 链路，**不**断言慢流 elapsed 可见）；`bash scripts/task_done.sh --skip-static-scan` manifest ok（UI evidence 指向上述 summary）。静态扫描结果见集成报告；慢流场景仍未登记。

## 2d. CP4 真实页面慢流验收（done，2026-10-23）

**场景**：`agent-provider-slow-stream-liveness`（manifest `quality/acceptance/scenarios/agent-provider-slow-stream-liveness.yml`）。
外部 Playwright driver 驱动真实 Tauri 工作台：

1. driver 启动本地 OpenAI 兼容慢流替身（仅验收 harness，不进生产 runtime）：每 700ms 一块 SSE 正文、约 7s 持续出字；判断结构调用（tools + forced tool_choice）走非流式立即返回合法 `judgment_decision`。
2. 通过产品 provider runtime API 把 LM Studio 指向该替身（模型 `slow-stream-model`）；后端以 `NOVEL_LMSTUDIO_TIMEOUT_MS=3000` 注入 legacy timeout——B22 后它只作为 **wire 静默窗口**，不再是总挂钟。
3. 作者式普通对话 → 真实 LM Studio adapter / Gateway / TimeoutPolicy / AgentRun 全链；流式期间不因 3s 总挂钟被杀，5s 门槛后作者可见「已运行 N 秒」。
4. 流结束 → 正常 reply TurnResult（非 failed/failed_recoverable/cancelled），输入框恢复；app log 无 `provider_gateway.complete.error` / 无 `timeout` 原因码；log noise 门禁正常路径 9 行 / 0 error。

**证据**：`artifacts/slice-verify/agent-provider-slow-stream-liveness-tauri/summary.json`：
`duration_ms=7498`、`streamed_ms=7000`、`stream_chunk_count=10`、`streaming_request_count=1`、`tool_request_count=1`、`provider_done_count=2`、`provider_timeout_count=0`、`elapsed_visible_at_ms=5228`、turn status `conversational`、`no_production_write=true`、`log_noise.ok=true`。
**证伪能力**：若旧「legacy timeout = 总挂钟」语义复活，该流会在 3s 处被误杀（scenario 断言 elapsed≥4s、duration≥6s、无 timeout）。

**自适应校准决策**：本批**明确保留 bootstrap**（local response 900s / non-stream 1800s / deadline nil），不按 `(provider, model, thinking)` 实测 TTFT p99 收紧——理由：① 校准需要多模型多思考档的系统性采样，属 C 轨平台验证（≤15% 预算）；② 当前 bootstrap 是「异常检测窗口」而非业务时限，误杀方向已被本次真实页面 + 单测证明消除；③ 收紧窗口有误杀真实慢预填的风险，需专门基线数据与作者裁决。**登记为 C 轨观察项**（不冒充已校准），见 §2c。

---

## 2c. 诚实边界（未闭环，不得写 done）

1. ✅ **真实页面慢流验收已闭环（2026-10-23 CP4）**：`agent-provider-slow-stream-liveness` 真实 Tauri PASS（见 §2d）；不再以单测冒充慢流证据。
2. **无自适应校准（明确保留 bootstrap 并登记 C 轨观察）**：local `response_ms = 900_000` 是保守 bootstrap（实测 TTFT 最大 195s；预填充 / 排队可能更长），不是按 `(provider, model, thinking)` p99 测出的值；极慢预填充仍可能误杀，快模型也未被收紧。CP4 决策见 §2d。
3. **只有心跳 / keepalive、没有 token 的流不会被默认杀灭**：`response_ms` 只认 wire data，尚无语义级 stall watchdog。
4. **其他未实现项**（详见 `08` §25.8）：单机并发隐形排队、partial 输出不可挽救（不转 tentative artifact）、无自动重试、数小时链 checkpoint / 后台化 / 通知未实现。
5. **诊断字段尚无真实调用抽样证据**：`timeout_kind` / ttft / chars / chunks 等 details 由单测覆盖，尚未在真实超时事件上抽样核对 llm-calls JSONL；CP4 一并取证。
6. **证据面**：慢流专项证据已入档（`artifacts/slice-verify/agent-provider-slow-stream-liveness-tauri/summary.json`，2026-10-23 CP4）；既有 `p1-prose-execution-brief` 回归 summary 继续作为 UI 回归证据，两者不混用。
7. **文档引用已统一**：前端代码注释统一为「46 §9.5 第 4 条」，不再使用不存在的 `§9.5.4` 小节号。

## 3. 验证命令

```bash
# CP1 / CP2 目标测试（2026-10-22 本地实跑，结果见 §2b）
mix test apps/novel_agent/test/novel_agent/provider/timeout_policy_test.exs \
         apps/novel_foundation/test/novel_foundation/upstream_error_test.exs
mix test apps/novel_agent/test/novel_agent/provider/lm_studio_test.exs \
         apps/novel_application/test/novel_application/planner_provider_failure_message_test.exs
mix test apps/novel_application/test/novel_application/agent_run_runtime_test.exs

# CP3 前端（套件与 design trace 以集成报告为准）
cd frontend && pnpm typecheck && pnpm lint && \
  pnpm test -- --run src/components/WorkspaceChat.agentRunElapsed.test.tsx

# AGENTS.md 门禁（Lead 集成批执行）
mix compile --warnings-as-errors
mix format --check-formatted
mix xref graph --format cycles --label compile-connected --fail-above 0
mix run scripts/arch_check.exs
mix test
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_n_narr.exs

# CP4（done）：慢流专项真实 Tauri 场景：
bash scripts/quality_accept.sh agent-provider-slow-stream-liveness --surface tauri

PHOENIX_PORT=4661 VITE_DEV_PORT=5771 bash scripts/tauri_slice_verify.sh p1-prose-execution-brief
bash scripts/task_done.sh --skip-static-scan
# 慢流场景 id 在 CP4 拍板后登记
git diff --check
```

## 4. 明确不做（YAGNI / 登记）

- 不重设 provider `max_tokens`，不引入跨 provider 通用 token 默认值（token 预算归 `InferenceParams` + provider 配置）；
- 不做 run 级动态预算 / 后台化 / 通知（`UA01-dynamic-agent-run-budget.md` owner）；
- 不做有界自动重试（前置是 run 级时间 / 预算与可归因上限，另立切面）；
- 不把 partial content salvage 成 tentative artifact；
- 不动 46 / 47 设计正文与 Pencil 原型；
- 不新增验收专用 hook / `data-testid` / env 开关，不把验收替身注册进生产 runtime；
- 不改 ProviderRun / ProviderEvent / ProviderOutput 契约与持久化 schema。

## 5. 风险与返工点

| 风险 | 处置 |
|---|---|
| local 900s 对极慢预填充仍可能误杀 | CP4 用真实 TTFT p99 校准；`NOVEL_*_RESPONSE_TIMEOUT_MS` / 组 env 可临时放宽 |
| hosted 行为变化：legacy `timeout` 不再总杀，长挂调用可能无限延续 | response 窗口仍挡静默；部署侧需总上界时显式 `NOVEL_*_DEADLINE_TIMEOUT_MS` |
| heartbeat 流绕过 response 窗口 | 登记为未实现语义 stall watchdog；CP4 观察是否需要另立切面 |
| 单机并发排队消耗 response 窗口 | 文档登记；并发 / 队列治理另立 slice |
| 前端 elapsed 起点被重连 / 恢复事件重放拉偏 | 取最新作者可见 `run_started`；回退最早事件；无时间戳不显示 |
| 文档引用简写与文档小节号不一致 | 已消除（前端注释统一为 §9.5 第 4 条） |

## 6. 决策日志

- 2026-10-22 — 作者否决第一版「三层硬超时」规格（写死的总时长数字作废，不得再冻结进设计或 slice）；本文件按修正后方向重写。
- 2026-10-22 — 作者拍板新原则「只要模型还在稳定出字就不杀」：单次调用可合法 10–60 分钟、任务链可数小时；总挂钟不是默认控制，liveness + token 预算承担。设计冻结为 `08` §25。
- 2026-10-22 — CP1–CP3 落实现：`TimeoutPolicy` SSOT + Gateway 单点注入 + adapter 接线 + `timeout_kind` 诊断 + 作者安全失败语义 + 前端真实墙钟等待；目标测试本地 54 tests / 0 failures（§2b）。
- 2026-10-22 — CP4（真实页面慢流验收 + 自适应校准）与 run 级预算后续切面 queued；未写 done。
