# tasks/slices/

承重竖切面执行目录。

长期规则见 `docs/engineering/vertical-slice.md`。当前队列入口见 `tasks/NEXT.md`；本目录只保留仍服务当前推进的 P1 / AU / SU / SI slice 文件。

## 文件类型

| 前缀 | 用途 |
|---|---|
| `P1-*.md` | P1 小说主链与质量 checkpoint |
| `AU*.md` | 作者旅程验收缺口或恢复 slice |
| `SU*.md` | 系统用户旅程验收缺口或恢复 slice |
| `SI-*.md` | 场景化验收不变量与 CI 强制项 |
| `v3/` | 历史命名的当前承重切面工作区；后续有改动时应逐步迁出或重命名，不再新建版本化目录 |

## 当前 Slice 文件

| 文件 | 角色 |
|---|---|
| `SU01-file-level-closure.md` | **file-level deliverable / external platform blocker registered**：SU-01 已按文件级闭环口径重算为 8/10 已验收、1/10 已实现未验收（C3，外部平台 blocker）、1/10 部分实现（B3）。`su01-keychain-webview-roundtrip` 已通过外部 macOS CGEvent/Accessibility driver 从真实 Tauri WebView 完成 Keychain 保存、Tauri 重启读回和脱敏边界；`su01-provider-test-failure-ui` 已证明测试连接失败反馈、草稿保留、无 turn/runtime 副作用和恢复成功；非 macOS secret 产品口径已实现为 unsupported capability + UI 禁止输入/清除 Key，Windows/Linux 真实页面 / 平台矩阵登记为外部平台 blocker；live vendor / 云端供应商真实失败矩阵为 P1 后续；当前可进入 SU-02。 |
| `SU01-lmstudio-disconnected-health.md` | **checkpoint closed**：`SC-SU01-A3` LM Studio 未启动/不可达时的真实工作台断开态已由 `su01-lmstudio-disconnected-health` 证明。SU-01 全量仍缺 API Key/endpoint/云端 provider 和跨平台 secret 异常矩阵。 |
| `SU01-provider-endpoint-validation.md` | **checkpoint closed**：`SC-SU01-B3` endpoint URL 校验 checkpoint。非法 endpoint 在真实模型设置 Dialog 中可见报错，刷新模型、测试连接、保存切换被阻断，且不触发 provider models 请求；B3 实时模型列表成功矩阵仍未闭环。 |
| `SU01-provider-model-list-success.md` | **checkpoint closed**：`SC-SU01-B3` 供应商实时模型列表成功矩阵最小闭环。真实工作台模型设置 Dialog 可分别从 DeepSeek、Anthropic、LM Studio provider models boundary 加载并选择模型；live vendor 账号和非 macOS 真实页面 / 平台矩阵仍未闭环。 |
| `SU01-api-key-secret-redaction.md` | **checkpoint closed**：`SC-SU01-B2/C3` API Key 配置流脱敏 checkpoint。真实工作台输入 fake Key 后，provider options、browser fallback settings、可见 UI、业务 JSONL 和 backend log 均不泄漏 secret；后续 `su01-keychain-webview-roundtrip` 已补真实 macOS Tauri WebView Keychain 写读，非 macOS secret 产品口径已补，平台真实验收仍未闭环。 |
| `SU03-assistant-display-name-boundary.md` | **checkpoint closed**：补 SU-03 `SC-SU03-C2` 行为边界证据。真实工作台改名后发送普通消息，默认 Tauri 验证 wire/TurnResult 契约，`--real-lmstudio` 验证 provider request body 不含 UI 显示名。 |
| `SU02-work-lifecycle-management.md` | **checkpoint closed**：`SC-SU02-B3/B4/B5` 作品级命名新增、修改作品名、安全删除或移出已由 `su02-work-lifecycle-management` 真实 Tauri 验收证明。SU-02 后续缺口已收敛为 P2 管理/异常矩阵。 |
| `SU02-work-restart-recovery.md` | **checkpoint closed**：`SC-SU02-D1/D2` 作品重启恢复与 stale lastOpened 降级已由 `su02-work-restart-recovery` 真实 Tauri 验收证明；reload 后恢复真实 lastOpened，已移出作品不会作为当前 work 恢复。 |
| `SU02-empty-start-unnamed-work.md` | **checkpoint closed**：`SC-SU02-B2` 空工作区自动启动未命名作品已由 `su02-empty-start-unnamed-work` 真实 Tauri 验收证明。空库启动通过幂等 ensure initial 创建单个真实“未命名作品”，普通消息和重命名保持同一 Work，多个未命名作品在作品菜单里可见区分。 |
| `SU02-artifact-projection-trace-isolation.md` | **checkpoint closed**：`SC-SU02-C3` 剩余 artifact / projection / trace 隔离矩阵已由 `su02-artifact-projection-trace-isolation` 真实 Tauri 验收证明。源作品 pending prose artifact 不泄漏到目标作品，源作品采纳后 reading projection 只在源作品有内容，目标 why/trace 不带源作品 artifact/chapter 上下文；SU-02 当前 13/13 已验收，可进入 SU-03。 |
| `SU02-pending-result-work-isolation.md` | **checkpoint closed**：`SC-SU02-C4` 慢回复迟到归属已由 `su02-pending-result-work-isolation` 真实 Tauri 验收证明。作品 A 慢回复完成在原 `work_id`，作品 B 不显示 A 文本且不残留 loading，切回 A 可恢复完成 turn。 |
| `AU01-ordinary-chat-two-turn-roundtrip.md` | **checkpoint closed**：AU-01 普通聊天两轮真实工作台闭环。外部 Tauri driver 从真实输入框发送两轮自然创作聊天，证明 user/assistant 可见顺序、thinking 清退、`generate_micro_plan=false`、无 MicroPlan、无 action/candidate/adoption UI；`--real-lmstudio` 证明真实 provider 两轮 form_frame 请求。AU-01 全量仍缺 trace/replay UI 和 C3 no-slot-form UI 反证。 |
| `AU01-empty-message-guard.md` | **checkpoint closed**：SC-AU01-B3 空消息不会创建聊天 turn。外部 Tauri driver 从真实输入框发送空白内容，证明无 `user_message` frame、DOM 消息数不变、thinking 不出现且输入仍可用；随后有效普通聊天完成，说明恢复路径未断。AU-01 全量仍缺 trace/replay UI 和 C3 no-slot-form UI 反证。 |
| `AU01-garbage-json-recovery.md` | **checkpoint closed**：SC-AU01-E2 LLM 乱码 JSON 友好降级。外部 Tauri driver 从真实输入框触发 test/support provider 返回 malformed frame JSON，验证页面显示友好 fallback、raw payload 不可见、输入/Channel 可恢复，并继续完成一轮普通聊天。AU-01 全量仍缺 trace/replay UI 和 C3 no-slot-form UI 反证。 |
| `AU01-frame-validation-friendly-error.md` | **checkpoint closed**：SC-AU01-E3 frame 校验失败作者友好提示。真实工作台触发 test/support provider 返回带禁止执行语义的 frame，验证 Channel fallback 不把内部 validation reason 放进 UI 或 turn_result，并能继续普通聊天。AU-01 全量仍缺 trace/replay UI 和 C3 no-slot-form UI 反证。 |
| `AU01-turnresult-recorder-ui-consistency.md` | **checkpoint closed**：SC-AU01-B4 TurnResult、interaction recorder 和恢复 UI 同源对账。真实工作台发送普通聊天后，按同一 `turn_id` 证明 websocket `turn_result.assistant_message.text`、transcript assistant row、transcript 内嵌 turn_result 和 reload 后 UI 文本一致；AU-01 剩余 P1 为 AU-07 owner 的 trace/replay UI cross-reference，P2 为 C3 no-slot-form UI 反证。 |
| `AU02-candidate-adoption-bridge.md` | **checkpoint closed**：候选方向 continuation/adoption 边界已拆成两条真实 Tauri 证据。`au02-candidate-continuation` 证明“继续讨论”发送 `user_message.candidate_selection` 且不进入 adoption；`au02-candidate-adoption-bridge` 证明“设为后续方向”提交服务端授权 `author_action.choose_candidate` 并进入 `AdoptionBoundary`。AU-02 之后已由 `AU02-candidate-fallback-ui.md` 关闭 fallback UI 反证，由 `AU02-candidate-multiturn-context.md` 关闭多轮上下文质量反证，由 `AU02-natural-exploration-no-slot-form.md` 的 real LMStudio provider 变体关闭中文探索质量反证，并由 `AU02-candidate-schema-codegen.md` 关闭 D2 schema/codegen 回归。 |
| `AU02-natural-exploration-no-slot-form.md` | **checkpoint closed**：补 AU-02 模糊创意自然探索与 no-slot-form 真实 Tauri 证据。真实工作台发送模糊创意，验证 creative_exploration frame、自然回复、候选卡、无 slot form / MicroPlan / execution / adoption / write；`--real-lmstudio` 变体验证中文自然回复、无 JSON/代码块形态和候选语义相关。 |
| `AU02-candidate-fallback-ui.md` | **checkpoint closed**：补 AU-02 `SC-AU02-B3` 候选缺失/坏格式 fallback 的真实 Tauri UI 反证。test/support provider 返回坏候选 payload，真实工作台渲染 Planner fallback 候选卡，字段非空、`not_adopted`、无 action/adoption/write。 |
| `AU02-candidate-multiturn-context.md` | **checkpoint closed**：补 AU-02 `SC-AU02-C1` 候选继续讨论后的多轮上下文保持。真实 Tauri / quality acceptance 已证明点击“继续讨论”后，后续普通追问能通过会话上下文沿着已选候选方向继续，且无 action/adoption/write。 |
| `AU02-candidate-schema-codegen.md` | **checkpoint closed**：补 AU-02 `SC-AU02-D2` 候选方向 schema/codegen 统一回归。`candidate_direction.json` 固化 `direction_id/title/pitch/tone_tags/adoption_status=not_adopted`，前端 generated schema/type 被 `WorkspaceChat` 与契约测试消费，旧 fixture `"candidate"` 已修为 canonical `not_adopted`。 |
| `AU02-freeform-followup-after-candidate.md` | **checkpoint closed**：补 AU-02 候选卡出现后作者直接手输自由追问的反证。真实 Tauri 证明不点击候选按钮时，下一轮是无 `candidate_selection` 的普通 `user_message`，不提交 `author_action`、不进入 adoption boundary、不写作品事实。 |
| `AU02-unadopted-candidate-no-reading-fact.md` | **checkpoint closed**：补 AU-02 未采纳候选不进入阅读模式 / 作品事实的真实 Tauri 反证。生成候选卡后不点击候选动作，打开阅读模式，验证空 TOC、候选标题/简介不可见、无 action/adoption/projection/write。 |
| `AU03-session-history-readonly.md` | **checkpoint closed**：SC-AU03-C4 历史会话只读回看已由 `au03-session-history-readonly` 真实 Tauri 验收证明。真实工作台搜索历史会话、打开 exited transcript、确认旧 pending adoption 不恢复、输入/发送禁用，并可返回当前 active session；后续 `AU03-current-work-archive-evidence-entry.md` 已补归档过滤和最新 Work 背景 SSOT。 |
| `AU03-session-new-active.md` | **checkpoint closed**：SC-AU03-C2 新建作品内会话入口已由 `au03-session-new-active` 真实 Tauri 验收证明。真实工作台点击“新建会话”后创建新 active session、旧 active 变 `EXITED` 且可只读打开、新 active 以空 transcript rejoin，下一轮消息绑定新 session 且不带旧 transcript；后续 `AU03-current-work-archive-evidence-entry.md` 已补归档过滤和最新 Work 背景 SSOT。 |
| `AU03-branch-from-history.md` | **checkpoint closed**：SC-AU03-C6 从历史会话继续创建新 active session 已由 `au03-branch-from-history` 真实 Tauri 验收证明。产品入口记录 `source_session_ref` / `source_turn_ref`，旧历史保持只读，新分支 session 为空 transcript 且不复制旧历史内容。 |
| `AU03-current-work-archive-evidence-entry.md` | **checkpoint closed**：AU-03 文件级证据入口修复已闭环。`au03-current-work-context-ssot` 与 `au03-archive-session-filter` 已重新挂回 `tauri_slice_verify.sh`、外部 UI driver 和 quality manifest；真实 Tauri/quality acceptance 证明最新 Work 背景 SSOT、active transcript 分层、历史 transcript 不污染当前 prompt、归档默认隐藏且可显式搜索回看。`task_done` 已生成 manifest；静态扫描 0 touched-file finding，唯一 Top 10 为既有 gitleaks accepted_risk。 |
| `AU04-AU06-author-action-binding.md` | **doing / AU-04 high-risk + idempotency checkpoint closed**：`au04-confirm-before-execute` 已证明真实工作台高风险重写先 `needs_confirmation`，点击“确认执行”走服务端 `author_action`，确认前无工具/无写入，确认后重新 gate 并只产出待采纳草稿；`au04-confirm-idempotency-ui` 已证明真实快速重复确认只产生 1 次非 duplicate receipt、1 次工具 dispatch 和 1 份 pending artifact。`ActionValidator` 已要求 `behavior_ref` / `target_ref` / `candidate_*` / `idempotency_key` 与服务端 action 精确一致；`ConfirmationBinding` 已强制 `rebased_state_snapshot_ref` / `gate_result_refs` 并在 confirmation ack / reason_codes 留下 proof。TTL、stale/cross-work、持久 state snapshot、replay 和 behavior history 仍未闭环。 |
| `AU10-workbench-recovery-taskstate.md` | AU-10 recovery 已闭环 checkpoint：真实工作台“导出全书”的 task_state 生命周期可见性；下一队首见 `tasks/NEXT.md`。 |
| `AU10-workbench-recovery-disconnect-timeout.md` | **CP1~CP3B checkpoint closed**：provider 不可用、WebSocket service reconnect、取消等待与真实 provider timeout 均已有真实工作台 Tauri 证据；完整异步 LongRunner streaming 和 stale/disabled/idempotency UI 仍待后续。证据见 `tasks/NEXT.md` 和对应 `artifacts/slice-verify/au10-workbench-recovery-*-tauri/summary.json`。 |
| `AU12-work-profile-overview.md` | **AU-12 首个切面（checkpoint closed）**：补设计 43 §5① 缺失的「作品档案立项概览」只读视图。用户 2026-06-17 调整队列先做 AU12，CP1 已由 `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json` 证明真实工作台可核对 works 立项字段且不泄漏内部 Work UUID；下一队首见 `tasks/NEXT.md`。验收锚点 `docs/design/acceptance/author/AU-12-work-profile.md`。 |
| `AU09-character-dossier-roundtrip.md` | **CP1 done**：作品档案各 tab「数据展示+操作」端到端可用的第一个样板。已打通角色主档案断链——`character_seed` 采纳回写 `Character` 表（设计 21 §7.2 主档案层，**不写记忆**）+ AI 引导的上下文感知 schema 化角色设计（专用 capability 非独立 Agent）+ 角色 tab 展示 + 上下文读取。证据：`artifacts/slice-verify/au09-character-dossier-roundtrip-tauri/summary.json`；CP2 待做字段级结构化、关系对象和角色演化 memory。 |
| `AU10-action-idempotency-stale-disabled.md` | **CP1 部分闭环**：AU10-GAP-03(P0)。后端 stale/invented/disabled + idempotency 去重早已实现且 channel/单测覆盖；本 slice 补前端 duplicate 可见反馈（commit `2724653`）。双击/旧按钮 stale 的外部真实页面验收因 UI 竞态 + 内部状态依赖判定为非确定性，按 Option A 不纳入 harness（slice §7 已落账）。 |
| `AU09-archive-memory-roundtrip.md` | **CP2 checkpoint closed**：作品档案伏笔/规则入口已能通过 `world_building -> foreshadowing_seed / *_rule_seed -> adoption` 写入 governed memory，并按语义进入伏笔/规则 tab 的 read model；`au09-adopt-setting-recall` 已证明真实页面 adoption、伏笔/规则 tab 重开可见、recall/why。不能标完整 AU09 done，因 replay 和完整 trace 仍待补。 |
| `AU09-memory-management-workbench-entry.md` | **checkpoint closed**：正式工作台记忆管理入口、创建、确认、锁定、废弃、归档与 recall/why 基础生命周期已由 `au09-memory-management-entry` 真实 Tauri 验收证明。 |
| `AU09-memory-trace-roundtrip.md` | **checkpoint closed**：记忆 lifecycle/reference 追溯已由 `au09-memory-trace-roundtrip` 证明；locked terminal 后端阻止和 blocked trace 有局部测试，真实页面可见“引用与治理追溯”。 |
| `AU09-validity-window-recall.md` | **checkpoint closed**：章节级 `valid_from` / `valid_until` 已参与普通召回，`au09-validity-window-recall` 证明窗口外记忆不进入 context/why。 |
| `AU09-cross-work-memory-isolation.md` | **checkpoint closed**：跨作品记忆隔离已由 `au09-cross-work-memory-isolation` 证明。真实工作台从作品 A 切到作品 B 后，记忆管理页、作品档案伏笔/规则、ordinary recall 和 why 只消费当前 Work 的 memory。 |
| `AU09-AU03-session-memory-layering.md` | **checkpoint closed**：同一作品内 active session、historical session、current work memory 在 context/why 中分层且不互相伪装，已由 `au09-au03-session-memory-layering` 真实 Tauri 证据证明。 |
| `AU11-quality-diagnosis-message-envelope.md` | **checkpoint closed**：SC-AU11-01 质量诊断引导已把 VS-00D 三层 message / AIMessageEnvelope 从 docs-ready 推进到真实工作台 trace proof；AU11 整体仍有缺上下文真实验收、clarify/confirm guidance_mode、prose_writing envelope 投影缺口。 |
| `AU11-missing-workstate-policy.md` | **next**：SC-AU11-02 缺当前作品上下文不编造。证明 WorkState missing policy 在真实工作台 trace/why 中可见，assistant 不编造已读章节事实且 no write。 |

旧 `VS-001..018` 与旧 `DAG.md` 已删除；它们引用的 phase roadmap、旧 ADR 和 Router-first 语义不再作为有效执行事实。

## 最小结构

每个 slice 文件至少包含：

```md
# <Slice Name>

- 状态：todo / doing / done / blocked / deferred
- 类型：Turn Slice / Behavior Slice / Artifact Slice / Projection Slice / Memory Slice / UI Contract Slice / Acceptance Slice
- 启动日期：YYYY-MM-DD

## 1. 用户 / 系统目标

本 slice 要打实什么长期承重能力。

## 2. 开工检查

- Contract:
- Invariant:
- Boundary:
- Consumer:
- Proof:
- Acceptance Driver:

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | |
| novel_agent | no | |
| novel_application | no | |
| novel_persistence | no | |
| novel_web | no | |
| frontend | no | |
| docs/design | no | |
| quality | no | |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | | todo | |

## 5. 验证

- [ ] 外部自动化驱动真实页面的场景化验收
- [ ] 后端 / Channel / 组件局部验证
- [ ] `bash scripts/quality_manifest_check.sh`
- [ ] `bash scripts/check_design_trace.sh`（如果涉及 frontend）

## 6. 决策日志

- YYYY-MM-DD — ...

## 7. 试行反馈

记录本 slice 暴露出的规则缺口、过重流程或需要脚本化的检查。
```

## 试行原则

- slice 文件不是表格填空；它必须帮助接手者理解链路。
- 如果 Contract / Invariant / Boundary / Consumer / Proof / Acceptance Driver 写不出来，优先缩小或重切 slice。
- 不为了满足结构而制造未来抽象。
- 试行期允许更新本 README 和 `docs/engineering/vertical-slice.md`，但要在 slice 决策日志里说明原因。
