# AU08 Reading Return Context

- 状态：done
- 类型：Acceptance Driver Slice / UI Context Regression
- 启动日期：2026-06-22
- Primary Acceptance File: `docs/design/acceptance/author/AU-08-reading-mode.md`
- Affected Acceptance Files: `docs/design/acceptance/author/AU-03-context.md`、`docs/design/acceptance/author/AU-10-workbench-ui.md`、`docs/design/acceptance/system/SU-02-work-switching.md`

## 1. 依赖调度说明

| 字段 | 内容 |
|---|---|
| 原 blueprint 位置 | AU-08 阅读我的作品，位于 AU-07 之后、AU-09 之前 |
| 被提前处理的原因 | `SC-AU08-B4` 是已实现未验收的 P1：真实页面能从阅读返回，但第一轮缺“返回后继续输入仍在同一 work/session”的外部 driver |
| 阻塞场景/文件 | AU-08 B4；同时为 AU-03 当前会话上下文、AU-10 工作台返回可输入状态、SU-02 work/session 隔离提供 cross evidence |
| 回填方式 | 回填到 AU-08 B4、AU-08 D4 自动化验收、acceptance README、SCENARIO-BLUEPRINT、project ledger 和 slice 索引 |
| 恢复 blueprint 顺序 | B4 关闭后 AU-08 剩余 P1 仅为 projection refresh/status machine 与失败降级；满足恢复到 AU-09 的二轮退出标准 |

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-08-reading-mode.md` 的 `SC-AU08-B4`；`App.tsx` 模式切换语义；`WorkspaceChat` active work/session；`docs/design/ui/44-reading-mode.md`。
- Invariant: 从 ReadingMode 返回工作台不得创建新 work/session；返回后真实 follow-up 必须沿用返回前的 `work_id` / `session_id`；返回动作本身不得发送 `author_action` 或 `user_message`。
- Boundary: 只改外部 driver、native verifier、quality manifest、docs/tasks/ledger。生产 `frontend/src` 与 umbrella runtime 不改；不新增验收 env/query/localStorage/DOM hook；不把 fixture provider 注册进 production runtime。
- Consumer: 作者在阅读模式点击“返回工作台”后继续输入；quality entrypoint `scripts/quality_accept.sh au08-reading-return-context --surface tauri`。
- Proof: native verifier 单测正负样例；真实 Tauri quality acceptance；`quality_manifest_check.sh`；`task_done` 与 static scan 收口。
- Acceptance Driver: 真实 Tauri 工作台生成并采纳第 01 章正文，进入阅读模式，点击真实“返回工作台”，再输入 follow-up，断言 websocket 与 app log 中 follow-up 仍处于同一 work/session。产品代码新增验收感知逻辑：no。

## 3. 实现与证据

| 项 | 结果 |
|---|---|
| 外部 driver | `frontend/slice-verify/external-ui-driver.mjs` 新增 `au08-reading-return-context`，复用真实生成/采纳/阅读链路后点击“返回工作台”并发送 follow-up |
| native verifier | `frontend/slice-verify/native-tauri-verifier.mjs` 校验返回 no `author_action` / no `user_message`、follow-up start/done 同 work/session、turn_result 到达同 session |
| verifier tests | `frontend/slice-verify/native-tauri-verifier.test.mjs` 增加正例与 session mismatch 负例 |
| quality manifest | `quality/acceptance/scenarios/au08-reading-return-context.yml` 登记 Tauri entrypoint 与 anti-hooks |
| 真实页面证据 | `artifacts/slice-verify/au08-reading-return-context-tauri/summary.json` |

关键 evidence：

- `bash scripts/quality_accept.sh au08-reading-return-context --surface tauri` 已通过。
- `summary.json` 记录 `turn_ids=["turn_3","turn_adopt_18","turn_19"]`、`followup_turn_id=turn_19`。
- `work_id=3b6f31bf-ad3e-4126-98d3-5e5aa9d198f6`、`session_id=c9553054-ce18-472f-9d07-3357d7930a0e` 在返回前后保持一致。
- `ui-state.json` 的 `slice_verify.ui_state.done` 记录 `returned_to_workbench=true`、`chat_input_enabled_after_return=true`、`send_button_enabled_after_return=true`、`no_author_action_sent_on_return=true`、`no_user_message_sent_on_return=true`、`followup_channel_done_same_scope=true`、`work_id_preserved_after_return=true`、`session_id_preserved_after_return=true`。

## 4. 剩余缺口矩阵

| 场景 ID / 名称 | 第一轮状态 | 第二轮状态 | 剩余缺口 | 类型 | 优先级 | 当前证据 | 是否应在 AU-08 内关闭 | 建议 checkpoint | 退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU08-B4 返回工作台不丢上下文 | 已实现未验收 | 已验收 | 无 | 验收缺口已关闭 | - | `au08-reading-return-context-tauri` 真实页面证据 | 已关闭 | 保持 quality regression | 满足 |
| SC-AU08-C2 刷新投影不写入作品事实 | 部分实现 | 部分实现 | refresh/retry 仍不是专用 projection refresh action；缺 no-write driver | P1 / dependency blocker | P1 | ADR-0016/VS-04；暂无真实 refresh driver | 不在本 checkpoint 内关闭 | `au08-projection-refresh-no-write` | 可恢复 blueprint 顺序 |
| SC-AU08-C3/C4 REBUILDING/FAILED 状态 | 已实现未验收 | 已实现未验收 | UI banner 存在，缺真实状态 producer 和 failure/retry driver | P1 / dependency blocker | P1 | runtime 派生测试；无真实 producer | 不在本 checkpoint 内关闭 | Projection job/status machine | 可恢复 blueprint 顺序 |
| SC-AU08-D2 离线/Channel failure 诚实降级 | 部分实现 | 部分实现 | 缺真实断网/Channel failure reading driver | P1 | P1 | runtime state 测试；无真实 failure driver | 后续和 AU-10 recovery 合并 | AU-08 failure follow-up | 可恢复 blueprint 顺序 |

二轮退出判断：`SC-AU08-B4` 已有真实页面 evidence，可回填 AU-08 并恢复到 blueprint 下一文件；Projection refresh/status machine 和失败降级继续登记为 P1 后续，不伪关闭。
