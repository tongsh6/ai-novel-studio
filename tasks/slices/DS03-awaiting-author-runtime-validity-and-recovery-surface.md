# DS03 Awaiting Author Runtime Validity and Recovery Surface

- 状态：todo / P0 用户可见阻断
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
| T1 | 冻结 S7 recovery surface schema 与状态矩阵 | todo | 明确 paused / awaiting / dead bounded / durable |
| T2 | 收紧 AgentRun resume 状态门禁 | todo | resume 仅允许 paused；awaiting 必须 steer/action |
| T3 | 建立 join 后 runtime liveness 真源 | todo | 历史 TurnResult 不再单独授予控制权 |
| T4 | 持久化 steer 作者输入与来源引用 | todo | refresh/replay 可恢复 |
| T5 | 控制坞按状态切换动作与文案 | todo | awaiting 输入必填；dead bounded 提供重新发起 |
| T6 | 系统错误内联、去重和 pending 防连击 | todo | 不新增 AI 气泡 |
| T7 | 局部测试与 contract/schema 回归 | todo | application/web/frontend/persistence |
| T8 | 真实 Tauri 三场景验收 | todo | live awaiting、refresh-live、refresh-dead |

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

- [ ] 状态矩阵 contract/schema 已冻结并 codegen
- [ ] application / web / persistence / frontend 局部测试通过
- [ ] 三个外部 Tauri 场景全部通过
- [ ] steer Interaction 刷新恢复证据可查
- [ ] `bash scripts/quality_manifest_check.sh`
- [ ] `bash scripts/check_design_trace.sh`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

## 9. 决策日志

- 2026-07-25 — 根据真实用户截图和 Stage DB/AgentEvent 对账登记为独立 P0 slice。
  不回退 `UA01-natural-language-steering` 已完成的 live steer checkpoint；本 slice 专门关闭
  runtime validity、S7 recovery surface、steer persistence 与错误展示边界。
- 2026-07-25 — 本轮只登记，不修改生产代码，不改变 `tasks/NEXT.md` 当前唯一队首。
