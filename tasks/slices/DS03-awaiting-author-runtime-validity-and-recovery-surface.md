# DS03 Awaiting Author Runtime Validity and Recovery Surface

- 状态：done / verified（2026-07-28，三场景真实 Tauri 全 PASS）
- 类型：Decision Surface Slice / AgentRun Runtime Slice / UI Contract Slice / Acceptance Slice
- 登记日期：2026-07-25
- 父决策：ADR-0024 S7 CP3、ADR-0008 blocking clarification
- 相关已完成 checkpoint：`UA01-natural-language-steering`

## 1. 用户 / 系统目标

作者看到“任务正在等待你的确认”时，产品必须明确区分：

1. `paused`：运行实例仍然有效，作者可以直接继续。
2. `awaiting_author`：系统缺少作者输入，必须提交具体补充，不能用裸 `resume` 重放旧判断。
3. bounded runtime 已失活：历史记录仍可阅读，但旧任务不可继续；必须诚实显示失效并提供重新发起路径。

系统错误不得伪装成新的 AI 对话，作者通过当前任务输入的 steer 也必须进入持久会话记录。

## 2. 现场证据与问题边界

2026-07-25 用户截图显示：

- AI 已明确询问作者选择“扩充现有正文 / 重写本章 / 新增情节段落”，页面同时显示
  “任务正在等待你的确认”。
- 固定控制坞仍提供强主操作“继续”，输入占位文案也暗示可以“直接继续任务”。
- 连续点击后页面追加多条标记为 AI 的“操作失败，请重试”，但任务仍保持
  `awaiting_author`。
- 作者输入“继续”后没有形成可恢复的会话闭环。

Stage SQLite 与事件记录对账：

- work：`7d9b0edf-b9ed-4edd-bc57-851454942ecd`
- session：`76561332-a3c5-4cdc-a49f-6e3db8fb2f48`
- run：`run_mrz30t37_4lt`
- 持久状态：`run_mode=bounded`、`status=awaiting_author`、`phase=stopped`、
  `long_run_task_ref=nil`
- goal 已更新到 version 2，文本为“已经确认了”，但该 steer 作者输入没有写入
  `interactions`
- 事件 167–175 在约两秒内出现三组
  `run_resumed → evaluation_made → awaiting_author`，证明裸 `resume` 只重放旧的 settled
  判断，没有消费新的 blocking 信息
- 2026-07-24 16:10:28 重新 join 后没有
  `channel.agent_run_reconnect.done`；bounded runtime 已不在 Registry，但历史 TurnResult
  仍使前端显示可继续
- 后续 `agent_command resume` 经 `AgentRunService.lookup/1` 返回 `not_found`；前端 catch
  每次追加一条本地 assistant failure。失败行不在 `interactions`，刷新会消失

这不是 Provider 超时或模型连续失败，而是“历史状态、实时运行时、作者决策面”三者没有
形成单一状态契约。

## 3. 与既有 checkpoint 的关系

`UA01-natural-language-steering` 已证明：当 live AgentRun 进入 `awaiting_author` 且作者
提交具体 steer 时，可以在同一 `run_id` 清理旧 judgment/progress 并恢复执行。

本 slice 不重复该 checkpoint，而是关闭它未覆盖的四个边界：

1. `awaiting_author` 裸 `resume` 不得继续。
2. 刷新/重启后的 dead bounded run 不得恢复成可操作任务。
3. steer 作者输入必须持久化并在刷新后恢复。
4. 命令失败不得追加为 AI 消息，也不得无限重复。

## 4. 开工检查

- **Contract**：ADR-0024 S7 的 awaiting_author TurnResult + recovery surface；
  ADR-0008 / VS-03 的 author-blocking behavior；UA-01 的 AgentRun command/state contract。
- **Invariant**：
  - `paused` 与 `awaiting_author` 的恢复动作语义不可混用。
  - 历史 TurnResult 只能恢复可读叙事，不能授予实时命令权限。
  - dead bounded run 不得静默复活或继续旧 snapshot。
  - 作者 steer 不得只存在于 React state / AgentRun goal。
  - 系统/传输错误不得伪装成 AI 生成内容。
- **Boundary**：
  - `novel_application`：AgentRun command 状态门禁、awaiting_author 恢复前置条件。
  - `novel_web`：command error code、steer interaction persistence、join runtime truth。
  - `novel_persistence`：复用现有 Interaction / AgentRunLog，不新增平行记录体系。
  - `frontend`：历史/实时 run 合并、控制坞动作、错误展示与输入持久回执。
  - `novel_agent`、正文质量 evaluator、作品事实写入链明确不应修改。
- **Consumer**：真实 `WorkspaceChat` 当前任务控制坞与主输入框。
- **Proof**：状态机/Channel/Interaction/组件回归 + 外部 Tauri 三场景矩阵。
- **Acceptance Driver**：
  外部自动化从真实工作台触发 awaiting_author、刷新和后端 runtime 失活，再使用作者可见
  按钮/输入框完成验证；产品代码不新增 slice/env/query/localStorage/data-* 验收感知逻辑。
- **Exploration**：不适用。本 slice 不物化小说要素，只修复作者决策面和运行时有效性。

## 5. 推荐落地契约

### 5.1 状态与主操作

| 状态 | 作者语义 | 主操作 |
|---|---|---|
| `paused` + runtime live | 作者主动暂停，可原地恢复 | `继续` |
| `awaiting_author` + runtime live | 缺少作者决策/补充 | 输入必填后 `提交补充` |
| bounded runtime dead | 历史任务已失效 | `重新发起任务`，不得发送 resume |
| durable checkpoint recoverable | 有持久检查点 | 使用 durable recovery contract，不复用 bounded resume 假象 |

`awaiting_author` 的 bare `resume` 必须在后端被拒绝；只有非空 steer 或绑定
`answer_clarification` action 才能重新进入判断。

### 5.2 历史状态与实时状态

- `TurnResult.agent_run` 是历史展示事实，不是 runtime liveness authority。
- 当前任务控制权必须来自 server 发出的 live/recovered `agent_run_state`。
- join 完成后未重连到 live bounded runtime 时，前端必须把历史非终态降为
  `unavailable/expired`，不能继续保留 active controls。

### 5.3 作者输入与错误

- steer 输入写入当前 session Interaction，并携带稳定 `run_id` / source turn ref；
  refresh 后必须恢复在对话中的原位置。
- command pending 期间禁用重复提交。
- `not_found`、scope mismatch、timeout 等错误在控制坞内显示单一 system status；
  不追加 assistant bubble，不使用笼统“操作失败”覆盖可恢复方向。
- 同一 run / command / reason 的错误必须去重。

## 6. 任务清单

| # | 任务 | Status | 说明 |
|---|---|---|---|
| T1 | 冻结 S7 recovery surface schema 与状态矩阵 | done | 状态矩阵冻结在 `docs/design/ui/46-state-and-feedback.md` §9.7.1 + ADR-0024「S7 运行时有效性」修订节；`agent_run_state` schema codegen 显式归 DS01，不据此关闭 S7 |
| T2 | 收紧 AgentRun resume 状态门禁 | done | resume/steer 改同步 call：resume 仅 paused（awaiting 回 `awaiting_author_requires_input`，非 resumable 回 `not_resumable`）；steer 空白文本回 `steer_requires_text`、终态回 `not_steerable`；channel error reason 结构化透传 |
| T3 | 建立 join 后 runtime liveness 真源 | done | 稳态快照/重连恒带 `runtime_live: true`；join 时 `AgentRunService.list_dead_bounded/2`（复用闲置 `AgentRunLog.list_active_bounded/2`）对 dead bounded 广播 `runtime_live: false` 只读快照 + `channel.agent_run_expired.done` 留痕；前端 `agentRunRuntimeAuthority`（live/dead/unknown）成为命令权限唯一判据，历史 TurnResult 快照不再授权 |
| T4 | 持久化 steer 作者输入与来源引用 | done | steer 接受后 `DialogueGateway.persist_author_steer/5` 落 user interaction（content 携带 `agent_run_id`，turn_id=`{parent_turn_ref}:steer:{goal_version}` 幂等）；goal.version>1 的再次 settle 只补 assistant entry 防重复；transcript DTO/controller/前端 `agentRunId` 全链透传 |
| T5 | 控制坞按状态切换动作与文案 | done | awaiting=补充提示+终止（无裸「继续」，占位语拆分）；dead bounded=「原任务已失效」+「重新发起任务」（预填 goal、走新 user_message）；dead durable=检查点口径无实时控制；unknown=「正在确认任务状态…」全禁用；dead run 不计顶栏聚合、主输入回普通语义 |
| T6 | 系统错误内联、去重和 pending 防连击 | done | `AgentCommandError` 保留结构化 reason；失败=控制坞单一内联 status（run/command/reason 去重、成功清除），不追加 assistant 气泡；steer 失败撤回乐观消息并还原输入；`not_found` 即时本地降级 dead；command in-flight 全按钮防连击 |
| T7 | 局部测试与 contract/schema 回归 | done | 后端 496+120 全绿（新增：paused 恢复、awaiting 拒裸 resume/空 steer、dead bounded join 广播+not_found、steer 持久化 entry、transcript agent_run_id）；前端 typecheck/lint/428 组件测试全绿（dock 状态矩阵 5 新例）；verifier 单测通过 |
| T8 | 真实 Tauri 三场景验收 | done | 三场景全 PASS（2026-07-28）：`agent-awaiting-author-input-required`（无裸继续/空输入禁发/同 run 恢复/刷新后补充恰一次——首跑抓出 prose flow 完成时二次写 user entry 的重复病灶并修复）；`agent-bounded-refresh-live-resume`（暂停→刷新→reconnect `recovered+runtime_live`→继续→完成，无第二 run/无重启）；`agent-dead-bounded-run-expiry`（Phoenix 外部重启→`runtime_live:false`→失效文案+唯一重新发起→预填 goal→新 run_id，零 agent_command 打向死 run）。证据 `artifacts/slice-verify/agent-*-tauri/` |

## 7. 验收矩阵

### A. live awaiting_author

1. 作者触发需要具体方向的任务。
2. 页面不显示裸“继续”，只显示补充输入。
3. 空输入不可提交。
4. 输入“在现有正文基础上扩充场景和心理描写”。
5. 同一 run 恢复，旧确认提示不重复，作者输入刷新后仍存在。

### B. refresh 后 runtime 仍 live

1. bounded run 进入 paused 或 awaiting_author。
2. 刷新页面，Channel reconnect 到同一 live runtime。
3. 控制坞从真实 `agent_run_state.runtime_live=true` 恢复正确动作。
4. 不创建第二个 run，不重复执行已完成 step。

### C. refresh / backend restart 后 bounded runtime 已失活

1. 持久 transcript 中保留历史 awaiting_author TurnResult。
2. runtime Registry 中不存在该 bounded run。
3. 页面显示“原任务已失效，需要重新发起”，不显示可点击 resume。
4. 点击重新发起走新的作者请求和新 run；不向旧 run 发送 `agent_command`。
5. 页面没有“操作失败，请重试”AI 气泡，旧任务状态不复活。

## 8. 完成标准

- [x] 状态矩阵 contract 已冻结（46 §9.7.1 + ADR-0024 修订节；`agent_run_state` schema codegen 显式归 DS01，见决策日志残余登记）
- [x] application / web / persistence / frontend 局部测试通过（后端 496+120 全绿、前端 typecheck/lint/428 全绿、verifier 184 全绿）
- [x] 三个外部 Tauri 场景全部通过（见 T8）
- [x] steer Interaction 刷新恢复证据可查（场景 A reload 断言 + `agent-awaiting-author-input-required-tauri/ui-state.json`）
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/ai_static_scan.sh --top 10`（本 slice 触碰项全处置：persist_author_steer 圈复杂度已重构；gitleaks 两项为既有 false_positive/accepted_risk 台账）

## 9. 决策日志

- 2026-07-25 — 根据真实用户截图和 Stage DB/AgentEvent 对账登记为独立 P0 slice。
  不回退 `UA01-natural-language-steering` 已完成的 live steer checkpoint；本 slice 专门关闭
  runtime validity、S7 recovery surface、steer persistence 与错误展示边界。
- 2026-07-25 — 本轮只登记，不修改生产代码，不改变 `tasks/NEXT.md` 当前唯一队首。
- 2026-07-28 — 用户拍板插单执行。实现取舍：
  - resume/steer 从 `GenServer.cast` 改同步 call——原 cast 语义下「命令被拒绝」对前端
    表现为成功回执，是幽灵任务的机制根源之一；改 call 后拒绝结构化可见。
  - awaiting_author 的提交路径收束为 composer「发送调整」（空输入禁用）单一入口，
    控制坞不再给任何主按钮——避免「提交补充」与「发送调整」双提交竞争，也保住
    `agent-awaiting-author-steer-resume` 既有场景契约。
  - dead bounded 不改写持久层状态（历史记录保持 awaiting_author 真相），失效只经
    wire（`runtime_live: false`）声明；「重新发起」=预填原 goal 走新 `user_message`。
  - steer 持久化用独立 user interaction + 二次 settle 抑制 user entry，而非依赖
    settle 对重写——后者在 run 死亡/取消时丢失作者输入。
- 2026-07-28 — 残余登记（不阻塞本 slice）：①prose 等非 judgment flow 的 settle 持久化
  不走 `effective_author_text`，其 user/assistant 对在完成时才落库，mid-run steer entry
  的 transcript 顺序会先于原始请求（judgment flow 无此问题）；待这些 flow 引入
  awaiting/steer 语义时一并对齐。②Pencil `46§9.7-agent-run-control-dock`（dxUhh）尚未
  补 dead/awaiting 变体 frame，文字契约已冻结在 46 §9.7.1。③`agent_run_state` schema
  codegen 归 DS01。
