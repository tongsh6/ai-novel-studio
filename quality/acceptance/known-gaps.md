# Known Acceptance Gaps

本文件登记已经进入 manifest、但当前不能作为质量 gate 执行的场景。Known gap 不是通过状态，也不能进入 `pr-smoke`。

## 当前 blocked 场景（2026-10-27 B40 复核后）

> 本表只列 registry 中 `status: blocked` 且仍需 gate 的场景；已正式退役对象见下方 `retired` 表，不在此重复。B40 目标场景的逐份结论见 [B40](../../tasks/slices/B40-judgment-era-acceptance-reanchor.md) §7–§10。

| 场景 | 类型 | blocked 原因 | 触发 re-anchor |
|---|---|---|---|
| `au11-quality-diagnosis-message-envelope` | `reanchor_pending`（native driver 缺失） | 旧 envelope 生产链已退役；已按判断纪元普通回复来源/覆盖重锚并通过 browser-surface 机制预验，但 native 系统级驱动（AX/CGEvent）未实现、allowlist 不含本场景，native PASS 未闭环——不得用 browser 证据改 active。 | 实现 native AU11 driver + evidence checker + allowlist 注册后原生复跑（B40 §8.4） |
| `au11-missing-workstate-policy` | `reanchor_pending`（native driver 缺失） | 同上；覆盖如实（空 context_refs）、判断 prompt 0 章事实不编造、要求补材料的断言已重锚可复用。 | 同上 |
| `au07-tooltrace-registry-redacted-io` | `implementation_missing`（B59）+ `reanchor_pending` | 判断纪元 AgentRun 内部只读步 DecisionTrace 未持久化（`do_execute_tool_step` 丢弃 trace；真实 run 按 step turn_id 查 TraceRepository=0 条），ToolTrace registry/redacted IO 无当前持久回查路径；native driver 亦未实现。ToolTrace 实现仍在。 | [B59](../../tasks/slices/B59-agent-run-step-trace-persistence.md) 持久化接线 + native driver；不得用历史 lmstudio summary 代签 |
| `e2e-01-readonly-tool-trace` / `e2e-01-replay-report` | `implementation_missing`（B59）+ `reanchor_pending` | 同上（纯只读 turn + 持久 ToolTrace 回查无当前生产者）；native driver 未实现。 | B59 + native driver |
| `au02-candidate-fallback-ui` | `implementation_missing` / 契约演进 | 判断纪元候选帧只能由 `propose_creative_directions` 产生；坏/空候选在协议校验层安全失败或落 `casual_reply`（候选丢弃），到不了应用 `Planner.fallback_candidates`（无当前可达生产者）。 | 协议/产品裁决允许空候选进入应用兜底，或真实模型产出该路径；不得用旧帧纪元证据代签 |
| `judgment-explore-internal` | `evidence_missing` | 最近真实页面记录（2026-07-20）只有失败截图、无 `summary.json`。 | judgment explore driver 迁移后 current-HEAD 复跑 PASS 改 active |
| `e2e-01-full-chain` E10 持久化闭环 | `evidence_missing` | 无独立真实页面 artifact，只有局部 mix 证据；聚合器按 evidence_missing 处理。 | AU-07 cross-reference 补真实页面证据；补前 aggregate 不 PASS |

登记批次：`tasks/slices/VS00D-G-GAP-RECONCILIATION.md`（2026-10-24）、B27 CP3c/CP3d-B 退役批次（2026-10-24）与 B40 复核批次（2026-10-27）；下一批开工前重扫差距台账时复核本表。

## Gap 类型词表（B41 CP5）

`known-gaps` 与失败证据必须能区分根因类型，不能一律写 blocked：

| 类型 | 含义 | 处置方向 |
|---|---|---|
| `implementation_missing` | 目标能力尚未实现或已被架构演进取代 | 由承接 slice 实现，或正式退役 |
| `driver_stale` | 生产链已演进，验收 driver/manifest 仍等待旧事件/旧 profile | 重锚到当前生产链或退役（B40） |
| `evidence_missing` | 实现存在但缺独立真实页面/真实模型证据 | 补证据（B42/B40），不得用局部测试代替 |
| `retired` | 对象/链路已正式退役 | 从 manifest/registry 移除，不恢复旧对象 |
| `reanchor_pending` | 判断纪元/契约已变，等待重锚 | B40 统一重锚 |
| `credential_blocked` | 缺外部凭据/平台 | 只能 blocked，不能 PASS |

### 2026-10-27 B41 发现登记（不改 registry 状态，交接 B40/B42）

| 对象 | 类型 | 证据/原因 | 接手 |
|---|---|---|---|
| `vs10-observability-spine`（pr-smoke，active） | ~~`driver_stale` + `reanchor_pending`~~ → **B40 CP3 已重锚 PASS（browser-surface）** | key events 迁 judgment 链 + 父子 turn 关联修复；`artifacts/slice-verify/vs10-observability-spine/`（verdict pass，git_head d6bc69a4，summary surface=browser/driver=headless-chromium，非原生 PASS）。 | 已关闭（native 覆盖仍属汇总 gap） |
| `e2e-01-full-chain` E4 `e2e-01-downgrade-real-page` | ~~`implementation_missing` + `reanchor_pending`~~ → **B40 CP3 已 retired** | 判断纪元后无 multi-step MicroPlan 生产者，action_scope 阈值静态不可达（B13B D7）；B40 正式退役并重指 E4 替代证据 `agent-step-regate`。 | 已关闭（替代证据 = `agent-step-regate` 当前 PASS + `gate_order_closure_test` 单测） |
| E10 持久化闭环（e2e-01-full-chain 内） | `evidence_missing` | 无独立真实页面 artifact，只有局部 mix 证据；B41 CP3 按 evidence_missing 处理。 | AU-07 cross-reference 补真实页面证据；补前 aggregate 不 PASS |
| `b27-natural-author-intent` / `b34-author-intent-corpus-fixtures` | draft（非执行） | driver 未实现/无外部 driver；B41 CP1 登记为 drafts，永不执行、不计 PASS。 | B27/B34 后续按需注册 |
| 真实模型 pass verdict（所有 provider≠slice_verify） | `evidence_missing` | B41 CP4：真实 provider 的 pass 需 B42 模型行为证据；B41 不写 PASS verdict（读方 evidence_missing）。 | B42 CP1/CP2 |

### 2026-10-27 B40 CP1 重锚结果（AU11）

| 场景 | 结果 | 证据 | 备注 |
|---|---|---|---|
| `au11-quality-diagnosis-message-envelope` | **blocked（B40 CP1 重锚完成，native PASS 未闭环）** | `artifacts/slice-verify/au11-quality-diagnosis-message-envelope-tauri/summary.json`（**browser-surface 机制预验**：surface=browser/driver=headless-chromium；verdict 已改写 status=skipped，reason=native_system_driver_missing，旧 pass 归档 `verdict-history/`） | native 系统级驱动未实现（TAURI_NATIVE_SYSTEM_DRIVER allowlist 不含）；不得用 browser 证据改 active。触发=实现 native AU11 driver + evidence checker + allowlist 注册后原生复跑 |
| `au11-missing-workstate-policy` | **blocked（B40 CP1 重锚完成，native PASS 未闭环）** | `artifacts/slice-verify/au11-missing-workstate-policy-tauri/summary.json`（browser-surface 机制预验；verdict status=skipped，reason=native_system_driver_missing） | 同左；覆盖如实（空 context_refs）+ 判断 prompt 0 章事实不编造 + 要求补材料的断言已重锚可复用 |


### 2026-10-27 B40 CP2 / native surface 结论（blocked 与 retired）

| 对象 | 类型 | 原因 | 触发/替代 |
|---|---|---|---|
| `au07-tooltrace-registry-redacted-io` | blocked（`native_driver_missing` + `step_trace_not_persisted`） | ① native 系统级驱动未实现；② 判断纪元 AgentRun 内部只读步 DecisionTrace 未持久化（`do_execute_tool_step` 丢弃 trace；真实 run 按 step turn_id 查询 TraceRepository=0 条），ToolTrace registry/redacted I/O 无当前持久回查路径。ToolTrace 实现仍在。 | 实现 AgentRun step trace persistence + native driver 后重锚复跑；不得用历史 lmstudio summary / browser 机制预验代签。失败证据只读保留：`artifacts/slice-verify/au07-tooltrace-registry-redacted-io-tauri/`（`trace-query.json` count=0） |
| `e2e-01-readonly-tool-trace` / `e2e-01-replay-report` | blocked（同上） | 同一 step trace 持久化缺口 + native driver 未实现；原「纯只读 turn + 持久 ToolTrace 回查」无当前生产者 | 同上 |
| `e2e-01-downgrade-real-page` | **retired** | 判断纪元无 multi-step `%MicroPlan{}` 生产者，`action_scope` 降级静态不可达 | `agent-step-regate`（当前 12 门 allow 路径真实页面 + author-safe why）+ `gate_order_closure_test`（blocked 路径单测） |
| `au07-gate-reason-why` | **retired** | 同上；持久 replay summary 无 gate-blocking why 文本来源 | 同上 |
| `gap-wt04-non-exploration-frame-badges` | **retired** | B26（`5ce6261d`）起 `JudgmentProtocol.frame_type/1` 只产 `creative_exploration/capability_gap/casual_reply`，`question_answer/meta_discussion` 无生产者（前端 badge 文案残留但无消费者）。历史 07-24 证据早于该收窄，不能作为当前证据。 | `au01-ordinary-chat-two-turn-roundtrip`、`au01-turnresult-recorder-ui-consistency`（frame 展示一致性）current-HEAD browser-surface 复跑；B26 决策为语义收窄真源 |
| `agent-provider-streaming-progress` | **retired** | `provider_progress_v1` profile/计划目录/预算已退役（B27 CP3c/F10） | `agent-provider-execution-stream-unified`、`agent-provider-execution-error-author-safe` |
| `au10-micro-plan-entry` | **retired** | F14 legacy MicroPlan 入口语义已退役 | `pr-smoke-core-reply`（新增当前可执行 pr-smoke 场景，判断纪元普通回复链）+ `p1-chapter-plan-minimum`/`judgment-plan-multi-step` 规划链证据 |

| `au02-candidate-fallback-ui` | blocked（`implementation_missing`/契约演进） | 判断纪元候选帧只能由 `propose_creative_directions` 工具产生；坏/空候选 payload 在协议校验层安全失败或落为 `casual_reply`（候选被丢弃），到不了应用 `Planner.fallback_candidates`；应用兜底代码仍在但无当前可达生产者 | 触发=协议/产品裁决允许 creative_exploration 空候选进入应用兜底，或真实模型产出该路径；不得用旧帧纪元证据代签 |
| `au01-garbage-json-recovery` | **retired** | 判断纪元 provider 契约=自然语言 content+可选原生工具调用，不再要求可解析 JSON 结构；旧「乱码 JSON 降级」无当前生产者 | `au01-frame-validation-friendly-error`（协议损坏安全终局）+ `agent-provider-execution-error-author-safe` |

## 2026-10-27 B40 CP3 当前 PASS（browser-surface，如实标注）

> 下面场景为 current-HEAD 真跑 PASS（`tauri_slice_verify` 默认 Playwright→Vite，summary `surface=browser/driver=headless-chromium`，**不是原生系统级 PASS**）；真实模型语义归 B42。

| 场景 | verdict | git_head | 备注 |
|---|---|---|---|
| `au01-empty-message-guard` | pass | d6bc69a4 | driver 按当前产品「空输入禁用发送」重锚 |
| `au01-ordinary-chat-two-turn-roundtrip` | pass | d6bc69a4 | 判断纪元两轮 reply 链 |
| `au01-frame-validation-friendly-error` | pass | d6bc69a4 | S7 友好终局（不锁文案版本） |
| `au02-natural-exploration-no-slot-form` | pass | d6bc69a4 | judgment creative_exploration + 无工具/采纳卡 |
| `agent-step-regate` | pass | d6bc69a4 | E4 替代证据；12 门 allow lineage + author-safe why/gate 断言 |
| `pr-smoke-core-reply` | pass | d6bc69a4（F14 新增） | pr-smoke 当前可执行最小真实路径 |

**原生系统级未覆盖 known-gap（B40 汇总）**：`tauri_slice_verify` 默认 driver 仍是外部 Playwright→Vite（browser-surface，summary `surface=browser/driver=headless-chromium`），Tauri 窗口仅启动；`TAURI_NATIVE_SYSTEM_DRIVER=1` allowlist 目前只含 B26/B28/B29/B30/B31/P1。B40 的 CP1/CP2 目标场景与 CP3 家族证据均不得读作「原生系统级交互通过」；native 闭环统一由后续「native acceptance driver 覆盖」批次承接（触发：为 AU11/AU07/CP3 家族补 AX/CGEvent driver + native evidence checker + allowlist）。

### 2026-10-27 B42 证据分层发现（known-gap 候选登记）

| 对象 | 类型 | 证据/原因 | 处置/触发 |
|---|---|---|---|
| 历史原生/实模证据缺 B42 CP2 证据字段（`base_refs`、观察 `outcome/source_revision/coverage`、`preparation_outcome/stale_on_restore`） | `evidence_missing` | `artifacts/quality-accept/b42-cp1-cp3/evidence-chain-p1-chapter-draft-generation-native.json`、`evidence-chain-agentic-loop-plan-replan-reasoning.json`：旧 artifact 未记录这些字段，补写=伪造；只能 `binding=unknown/partial`，不得提升为模型行为 PASS | 后续真实模型 run 按 B42 CP2 字段落盘后再评估；旧证据保持只读 |
| 历史原生/实模证据缺 B42 CP1 模型行为判据元数据（`retention_wording{text,ref,tuned:false}`、独立 `attempts.json`、`params/actual_model` 来源） | `evidence_missing` | `artifacts/quality-accept/b42-cp1-cp3/`、p1 native artifact：无法从旧日志反推 | 新预注册批次补齐；在此之前 release-real-llm 只能 evidence_missing(67) |
| `release` / `release-real-llm` registry 为空、gate 未启用 | 有意未闭环 | `quality/acceptance/tiers.md`：不注册占位/blocked 假场景；`release` 首批候选待 B40 重锚 + release gate 启用；`release-real-llm` 首场景=AU-15（B42 CP4，依赖 ADR-0030 Accepted） | 作者接受 ADR-0030 后 CP4 预注册；否则保持空与 not_run |
| 真实 provider PASS 的模型行为判据 | `evidence_missing` | B41 CP4 + B42 CP1/K5：真实 provider runner 成功但缺 `model_behavior` 证据一律 evidence_missing(67)，不得写 PASS | B42 CP2/CP4 + 新预注册批次 |

### 交接说明

- **B40**：`vs10-observability-spine`、E4/au07-gate/B13B D7/D11 等重锚或退役；重锚后由 CP2/CP3 重新运行并在 verdict 写 `git_head` 才可 pass。
- **B42**：真实模型 verdict 的 `model_behavior` 层、`release-real-llm` tier 与 AU-15 见证；在 B42 落地前，真实 provider 运行不得把 HTTP 200/局部证据写成模型语义 PASS。
- B41 不因本表修改任何 active/blocked registry 状态（非目标），类型仅用于报告与后续任务承接。

### 2026-10-27 B40 交接给 Lead/B41 的残留（非 B40 修复范围）

| 残留 | 现象 | 处置建议 |
|---|---|---|
| ~~`accept_verdict.mjs` git_head 短/长 hash 不一致~~ **Lead 已修复（2026-10-27）** | verdict 曾写 `d6bc69a4`（`rev-parse --short`），聚合器用完整 hash 比较 → 新 verdict 判 stale。修复：`accept_verdict.mjs` 与 `quality_accept.sh` 改记录完整 hash；`e2e_status.mjs` 新增 `commitMatches` 兼容既有短哈希（≥7 位前缀，git 缩写语义），并补 `e2e_status.test.mjs` 回归。 | 已关闭；最终提交后在最终 HEAD 复跑聚合器即可让 fresh verdict 正确判 current（见 B40 §12） |
| 同族未复跑场景 | §B40 10.2 清单（p1/au02 余项/au03/au05/au07-trace-why/au09/au12/vs00c） | 下一批 driver/verifier 重锚 + nightly 复跑；历史证据不得代签 |
| E10 持久化闭环 | 无独立真实页面 artifact | AU-07 cross-reference 补证据；补前 aggregate 不会 PASS |
