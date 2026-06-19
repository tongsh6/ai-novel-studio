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
| `SU01-lmstudio-disconnected-health.md` | **checkpoint closed**：`SC-SU01-A3` LM Studio 未启动/不可达时的真实工作台断开态已由 `su01-lmstudio-disconnected-health` 证明。SU-01 全量仍缺 API Key/endpoint/云端 provider 和跨平台 secret 异常矩阵。 |
| `SU01-provider-endpoint-validation.md` | **checkpoint closed**：`SC-SU01-B3` endpoint URL 校验 checkpoint。非法 endpoint 在真实模型设置 Dialog 中可见报错，刷新模型、测试连接、保存切换被阻断，且不触发 provider models 请求；B3 实时模型列表成功矩阵仍未闭环。 |
| `SU01-api-key-secret-redaction.md` | **checkpoint closed**：`SC-SU01-B2/C3` API Key 配置流脱敏 checkpoint。真实工作台输入 fake Key 后，provider options、browser fallback settings、可见 UI、业务 JSONL 和 backend log 均不泄漏 secret；Keychain WebView 写读和跨平台 secret 策略仍未闭环。 |
| `SU03-assistant-display-name-boundary.md` | **checkpoint closed**：补 SU-03 `SC-SU03-C2` 行为边界证据。真实工作台改名后发送普通消息，默认 Tauri 验证 wire/TurnResult 契约，`--real-lmstudio` 验证 provider request body 不含 UI 显示名。 |
| `SU02-work-lifecycle-management.md` | **checkpoint closed**：`SC-SU02-B3/B4/B5` 作品级命名新增、修改作品名、安全删除或移出已由 `su02-work-lifecycle-management` 真实 Tauri 验收证明。SU-02 全量仍缺 pending 迟到结果、重启恢复和完整隔离矩阵。 |
| `AU01-ordinary-chat-two-turn-roundtrip.md` | **checkpoint closed**：AU-01 普通聊天两轮真实工作台闭环。外部 Tauri driver 从真实输入框发送两轮自然创作聊天，证明 user/assistant 可见顺序、thinking 清退、`generate_micro_plan=false`、无 MicroPlan、无 action/candidate/adoption UI；`--real-lmstudio` 证明真实 provider 两轮 form_frame 请求。AU-01 全量仍缺空消息/乱码/frame 校验友好提示和完整异常矩阵。 |
| `AU02-candidate-adoption-bridge.md` | **checkpoint closed**：候选方向 continuation/adoption 边界已拆成两条真实 Tauri 证据。`au02-candidate-continuation` 证明“继续讨论”发送 `user_message.candidate_selection` 且不进入 adoption；`au02-candidate-adoption-bridge` 证明“设为后续方向”提交服务端授权 `author_action.choose_candidate` 并进入 `AdoptionBoundary`。AU-02 全量仍缺直接手输追问反证、多轮上下文质量、真实 LMStudio 质量和未采纳候选不进入阅读/事实反证。 |
| `AU03-session-history-readonly.md` | **checkpoint closed**：SC-AU03-C4 历史会话只读回看已由 `au03-session-history-readonly` 真实 Tauri 验收证明。真实工作台搜索历史会话、打开 exited transcript、确认旧 pending adoption 不恢复、输入/发送禁用，并可返回当前 active session；AU-03 全量仍缺搜索命中定位、从历史继续分支、归档过滤当前入口复跑、最新作品背景 SSOT 和完整 replay 页面。 |
| `AU03-session-new-active.md` | **checkpoint closed**：SC-AU03-C2 新建作品内会话入口已由 `au03-session-new-active` 真实 Tauri 验收证明。真实工作台点击“新建会话”后创建新 active session、旧 active 变 `EXITED` 且可只读打开、新 active 以空 transcript rejoin，下一轮消息绑定新 session 且不带旧 transcript；AU-03 全量仍缺从历史分支继续、搜索命中定位、归档过滤当前入口复跑、最新作品背景 SSOT 和完整 replay 页面。 |
| `AU04-AU06-author-action-binding.md` | **doing / backend-channel checkpoint**：补 AU-04/AU-06 author_action 绑定边界。`ActionValidator` 已要求 `behavior_ref` / `target_ref` / `candidate_*` / `idempotency_key` 与服务端 available action 精确一致，Channel 已覆盖漏传/错配拒绝；完整真实 UI 重复点击、TTL、ConfirmationBinding state snapshot 和 behavior history 仍未闭环。 |
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
