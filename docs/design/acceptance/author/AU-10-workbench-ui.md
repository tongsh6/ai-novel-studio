# AU-10 工作台实时交互

> 作者视角：工作台是我和 AI 协作的主界面。我需要实时知道系统状态、AI 在做什么、现在等我做什么、哪些按钮可以点。界面上的卡片、候选、action、任务状态、trace 和投影状态必须来自真实主链，不能由前端猜测或用 mock 冒充。
>
> 2026-06-21 文件级收口结论：AU-10 当前按 17 个场景重算为 **14/17 已验收、1/17 已测试、2/17 部分实现**。当前 6 个可复跑 Tauri 入口已挂入 quality acceptance：`au10-workbench-matrix-layout`、`au10-workbench-recovery-taskstate`、`au10-workbench-recovery-disconnect-timeout`、`au10-workbench-recovery-provider-timeout`、`au10-workbench-recovery-reconnect`、`au10-workbench-recovery-cancel-waiting`。P0 缺口已关闭；完整异步 LongRunner、FAILED task_state 真实页面、全 card/action 深矩阵、projection/trace 深链路和文案/hidden metadata hygiene 登记为 P1/P2。当前文件满足进入 AU-11 的文件级退出标准。
>
> 2026-06-22 二轮缺口收敛结论：不回退 2026-06-21 文件级可交付判断。6 个当前 AU-10 quality/Tauri 入口已串行复跑通过；未发现需要在 AU-10 本轮先改生产代码才能继续 AU-11 的新增 P0/P1。剩余 P1 仍是完整异步 LongRunner / FAILED task_state 真实页面、全 card/action 深矩阵、projection refresh 和 trace/replay 深链路、UI copy / hidden metadata hygiene；其中 LongRunner 仍等待真实批量生成/推演生产消费者，projection 与 trace 深链路分别归 AU-08 / AU-07 cross-owner。

---

## 1. 文件级证据边界

当前 AU-10 的真实验收主证据以 `bash scripts/tauri_slice_verify.sh --list` 中存在的 Tauri slice 为准：

| Slice | 证明范围 | Artifact |
|---|---|---|
| `au10-workbench-matrix-layout` | 1280x800 真实工作台首屏/layout、普通聊天 no-MicroPlan、why、候选授权 action、adoption、reading projection、task status 基线 | `artifacts/slice-verify/au10-workbench-matrix-layout-tauri/summary.json` |
| `au10-workbench-recovery-taskstate` | 真实“导出全书”动作的 RUNNING / CHECKPOINT / COMPLETED task_state UI 可见性 | `artifacts/slice-verify/au10-workbench-recovery-taskstate-tauri/summary.json` |
| `au10-workbench-recovery-disconnect-timeout` | 不可达 provider 后 no-write fallback、loading 清除、恢复 provider 后继续下一轮 | `artifacts/slice-verify/au10-workbench-recovery-disconnect-timeout-tauri/summary.json` |
| `au10-workbench-recovery-provider-timeout` | hanging OpenAI-compatible endpoint 触发真实 provider timeout、no-write fallback、loading 清除、恢复后继续下一轮 | `artifacts/slice-verify/au10-workbench-recovery-provider-timeout-tauri/summary.json` |
| `au10-workbench-recovery-reconnect` | 外部停止/重启 Phoenix 服务，真实工作台离线禁用输入、自动 rejoin、下一轮继续 | `artifacts/slice-verify/au10-workbench-recovery-reconnect-tauri/summary.json` |
| `au10-workbench-recovery-cancel-waiting` | 高风险 confirmation 等待态可见，点击拒绝/取消后 cancelled TurnResult、no-write、active behavior 关闭、下一轮继续 | `artifacts/slice-verify/au10-workbench-recovery-cancel-waiting-tauri/summary.json` |

历史 `au10-micro-plan-entry` / `au10-ordinary-chat-no-micro-plan` artifact 只作为背景证据：native verifier 仍支持这些行为，但它们不在当前 `tauri_slice_verify.sh --list` 的 AU-10 主入口中，不能替代本文件的当前 runnable evidence。browser `au10-micro-plan-entry` 仍保留为 pr-smoke legacy quality 场景。

---

## 2. 不变量与契约

| 编号 | 不变量 | 契约 / 真源 | 当前验证 |
|---|---|---|---|
| AU10-I1 | TurnResult 是 UI canonical 输出 | `docs/design/07-workbench-ui-contract.md` §2-§4；VS-05 UI roundtrip | 普通消息、candidate、adoption、why、projection 均从真实 Channel/TurnResult 消费 |
| AU10-I2 | UI 只能提交服务器授权 action | `available_actions` contract；`author_action` Channel 路由 | AU-02/AU-04/AU-05/AU-10 Tauri 证据覆盖 candidate/adoption/confirmation/cancel |
| AU10-I3 | candidate selection 不等于 adoption | AU-02/AU-05/AU-10 | `au02-candidate-continuation`、`au02-candidate-adoption-bridge`、`au10-workbench-matrix-layout` |
| AU10-I4 | task_state 必须来自真实 Channel，而不是 UI 自造状态 | Workbench UI contract；`workspace_channel_task_state_test.exs` | `au10-workbench-recovery-taskstate` 覆盖 RUNNING/CHECKPOINT/COMPLETED；FAILED 仍是局部测试 |
| AU10-I5 | trace summary author-safe，不泄漏 raw prompt | AU-07；VS-05 trace redaction | `au10-workbench-matrix-layout` 与 `au07-trace-why-entry` |
| AU10-I6 | projection hint 只刷新/提示，不授权 UI 写入 | AU-08；Workbench UI contract §12 | AU-08 adoption-reading / export / stale banner 证据；深状态矩阵归 AU-08 P1 |
| AU10-I7 | provider failure/timeout/cancel/reconnect 不写 production content | scenario acceptance 红线；provider/runtime 边界 | AU-10 recovery 四条 Tauri 证据 |

---

## 3. 场景对账矩阵

状态只使用：已验收、已测试、已实现未验收、部分实现、未实现、不确定。

| 场景 ID / 名称 | 设计期望 | contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint / slice |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU10-A1 真实工作台首屏 | 打开 Tauri 后进入真实 `WorkspaceChat`，首屏状态、输入、结构栏可用 | AU10-I1/I7；desktop-first | `frontend/src/App.tsx`、`WorkspaceChat.tsx` | native verifier matrix assertions | `au10-workbench-matrix-layout` | 已验收 | 无当前 P0；更多 viewport 是扩展矩阵 | 补验收 | P2 | viewport/右侧栏扩展回归 |
| SC-AU10-A2 LLM health/model 真实显示 | health/model/error 走 endpoint 抽象，Tauri 不假设浏览器路径 | SU-01；desktop endpoint abstraction | `providerHealth.ts`、`env.ts`、provider config API | provider health 单测/集成 | `su01-provider-health-model`、`au10-workbench-matrix-layout` | 已验收 | live vendor 失败矩阵属 SU-01 P1 | cross-reference | P2 | SU-01 live provider matrix |
| SC-AU10-A3 WebSocket 离线禁用输入 | socket 离线时显示离线、禁用输入，恢复后无需刷新 | AU10-I7 | `WorkspaceChat` socket state、Phoenix Channel join | socket helper / runtime state tests | `au10-workbench-recovery-reconnect` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU10-B1 发送消息 loading 生命周期 | 用户消息可见、loading 绑定请求、失败可恢复 | AU10-I1/I7 | `WorkspaceChat.handleSend`、`sendMessage` | AU-01 recorder/UI consistency tests | `au01-ordinary-chat-two-turn-roundtrip`、`au10-workbench-matrix-layout`、AU-10 provider failure/timeout/cancel evidence | 已验收 | LongRunner 独立恢复态未覆盖 | 补验收 | P1 | LongRunner recovery after real consumer |
| SC-AU10-B2 普通聊天不误触发执行态 | 默认 `generate_micro_plan=false`；无服务器要求时不出现执行卡 | AU10-I1 | `socket.ts`、`WorkspaceChat.handleSend` | native verifier no-MicroPlan behavior | `au10-workbench-matrix-layout`；历史 `au10-ordinary-chat-no-micro-plan` 背景 | 已验收 | legacy no-MicroPlan slice 不在当前 Tauri list | 文档同步 | P2 | 需要时重新登记专用 current Tauri entry |
| SC-AU10-C1 候选方向卡片来自 TurnResult | 候选卡展示 title/pitch/tone tags，不空造面板 | AU10-I1/I3 | `WorkspaceChat` candidate render、TurnResult candidates | candidate schema/codegen tests | `au02-candidate-continuation`、`au02-candidate-adoption-bridge`、`au10-workbench-matrix-layout` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU10-C2 点击候选继续探索 | “继续讨论”围绕候选探索但不自动采纳 | AU10-I3 | candidate selection user_message | AU-02 candidate tests | `au02-candidate-continuation` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU10-C3 ActionPanel 只显示授权 action | 只提交 `available_actions`；disabled/stale/invented 不能执行 | AU10-I2 | `workbenchActions.ts`、`sendAuthorAction`、`ActionValidator` | action idempotency/stale/disabled Channel tests | `au02-candidate-adoption-bridge`、`au04-disabled-confirmation-action-ui`、`au04-stale-confirmation-ui`、`au04-confirm-idempotency-ui`、`au10-workbench-matrix-layout` | 已验收 | 双击/旧按钮 stale UI harness 非确定性，不强塞当前 driver | 补验收 | P1 | `AU10-action-idempotency-stale-disabled.md` follow-up |
| SC-AU10-C4 确认/拒绝走真实 `author_action` | confirm/reject/cancel 都携带服务器 action id，通过 Channel 校验 | AU10-I2/I7 | WorkspaceChannel `author_action`、Behavior lifecycle | `workspace_channel_v3_test.exs`、AU-04 tests | `au04-confirm-before-execute`、`au10-workbench-recovery-cancel-waiting` | 已验收 | action_result 全状态 UI 仍未系统化 | 补验收 | P1 | action_result deep matrix |
| SC-AU10-C5 10 种 UI card 渲染正确 | 10 类 card/未知类型都可降级，业务动作不从 card 自造 | AU10-I1/I2 | `UICards.tsx`、card contract | card type/component tests 不完整 | 分散 Tauri 证据覆盖候选、确认、adoption、trace、projection，但无全 card visual matrix | 部分实现 | 全 card 视觉与 unknown fallback 证据不足 | 补测试 / 补验收 | P1 | AU10 card visual matrix |
| SC-AU10-D1 采纳/修改/放弃主流程 | accept/discard/edit_then_accept 走 adoption boundary，采纳后才进作品事实 | AU10-I2/I6 | WorkspaceChannel adoption route、AdoptionWorkflow、ReadingProjection | AU-05/AU-08 tests | `au05-discard-author-action`、`p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`au10-workbench-matrix-layout` | 已验收 | 持久 adoption inbox / deep StateTrace 属 AU-05/AU-07 P1 | cross-reference | P1 | AU-05/AU-07 follow-up |
| SC-AU10-D2 真实首屏消费 task_state | RUNNING/CHECKPOINT/COMPLETED/FAILED 更新真实 UI | AU10-I4 | WorkspaceChannel task_state、`longRun` store | `workspace_channel_task_state_test.exs` 覆盖 FAILED；frontend task_state tests | `au10-workbench-recovery-taskstate` 覆盖 RUNNING/CHECKPOINT/COMPLETED | 已测试 | FAILED 缺真实页面外部自动化证据；异步 LongRunner 缺真实消费者 | 补验收 | P1 | FAILED UI / LongRunner after real consumer |
| SC-AU10-D3 超时/取消等待 | provider timeout、service loss、waiting cancel 后 loading 清除且可继续 | AU10-I7 | ProviderGateway timeout、socket status、Behavior cancel | provider/runtime tests、behavior lifecycle tests | `au10-workbench-recovery-disconnect-timeout`、`au10-workbench-recovery-provider-timeout`、`au10-workbench-recovery-reconnect`、`au10-workbench-recovery-cancel-waiting` | 已验收 | 完整异步 LongRunner 仍缺 | 补验收 | P1 | LongRunner recovery after real consumer |
| SC-AU10-E1 projection hint / 阅读模式 | projection hint 只提示刷新，ReadingMode 读取真实投影 | AU10-I6 | `handleTurnResult` projection refs、ReadingMode APIs | AU-08 projection/export tests | `p1-chapter-adoption-reading`、`p1-export-minimum`、`su02-artifact-projection-trace-isolation`、`au10-workbench-matrix-layout` | 已验收 | refresh/rebuild/failed/no-write 专项归 AU-08 P1 | cross-reference | P1 | AU-08 projection refresh matrix |
| SC-AU10-E2 trace / why 入口 | 作者可见 why，author-safe，能定位本轮解释 | AU10-I5 | `TraceSummaryView`、why dialog、ReplayService | AU-07 replay/trace tests | `au07-trace-why-entry`、`au09-memory-create-recall`、`au10-workbench-matrix-layout` | 已验收 | 历史 turn 查询 / developer view /完整 replay 归 AU-07 P1 | cross-reference | P1 | AU-07 deep replay |
| SC-AU10-F1 Tauri UI 自动化验收 | 有外部 Tauri driver 覆盖启动、发送、loading、candidate、action、task_state、错误恢复 | scenario acceptance | `scripts/tauri_slice_verify.sh`、native verifier | native verifier tests | 6 个 AU-10 当前 Tauri driver + 跨 AU current drivers | 已验收 | 当前 quality 之前未挂 6 个 AU-10 manifest，本轮已补 | 文档同步 / 补验收 | P0 | `AU10-file-level-closure.md` |
| SC-AU10-F2 Tauri / Design-Driven 约束 | endpoint 抽象、copy 集中、设计追溯、无验收专用 hook、无内联样式 | desktop-first；UI design trace；scenario acceptance | `WorkspaceChat`、`copy.ts`、design trace comments | `frontend_audit.sh`、`check_design_trace.sh` | `au10-workbench-matrix-layout` 覆盖 1280x800 layout；质量门禁覆盖静态边界 | 部分实现 | 文案集中、hidden `data-*` 真实产品用途复核、更多状态 viewport 仍需治理 | 修设计偏差 / 验收卫生 | P1 | UI hygiene checkpoint |

---

## 4. 偏差 review

当前没有需要立刻修代码的 P0 设计偏差。已验收场景的主要偏差处理如下：

| 偏差 | 判定 | 处理 |
|---|---|---|
| 旧文档仍把 baseline/task_state/provider failure 写成“完整 AU-10 未闭环”但未给文件级状态 | 文档同步 | 本文件改为 17 场景矩阵，并把当前可复跑 Tauri evidence 挂入 quality |
| `au10-micro-plan-entry` / `au10-ordinary-chat-no-micro-plan` 历史 artifact 容易被误当当前 Tauri list 主证据 | 文档同步 | 明确它们是背景或 legacy browser entry；当前主证据以 6 个 Tauri entries 为准 |
| 完整 LongRunner streaming 缺真实生产消费者 | 不修设计偏差，登记 cross-reference | 不强造验收专用产品逻辑；等批量生成/推演真实消费者出现后关闭 |
| disabled/stale/idempotency 外部 UI 双击 harness 不稳定 | 不强塞实现 | 沿用 `AU10-action-idempotency-stale-disabled.md` Option A：后端/Channel 确定性证据 + 可见 duplicate feedback，UI 竞态不作为当前文件 P0 |
| 全 card 视觉、unknown fallback、copy/hidden metadata hygiene 未形成矩阵 | 修设计偏差 / 补验收 | 登记为 P1，不阻塞当前文件进入 AU-11 |

---

## 5. 缺口分级

### 必须关闭的 P0

当前无开放 P0。F1 的 quality manifest 缺口已通过本轮 `AU10-file-level-closure` 关闭。

### 应关闭的 P1

| 缺口 | Owner 文件 | 当前恢复路径 |
|---|---|---|
| 完整异步 LongRunner streaming、恢复后继续操作 | AU-10 / 未来 LongRunner slice | 等真实批量生成/推演生产消费者出现后补，不使用验收专用 product hook |
| task_state FAILED 真实页面可见性 | AU-10 | 现有 Channel 测试覆盖 FAILED；后续补真实失败任务 UI driver |
| 全 card visual matrix 和 unknown fallback | AU-10 | 建立 `UICards` 视觉/行为矩阵，保持业务动作仍只来自 `available_actions` |
| action_result 全状态 UI、disabled/stale/idempotency 深矩阵 | AU-10 / AU-04 / AU-06 | 保持已有 AU-04/AU-06/Tauri 证据；只做确定性 driver |
| projection refresh/rebuild/failed/no-write 专项 | AU-08 | 已在 AU-08 文件级收口登记 |
| 深 trace/replay、developer view、旧 turn 查询 | AU-07 | 已在 AU-07 文件级收口登记 |
| copy 集中、hidden metadata hygiene、更多 viewport | AU-10 | 单独 UI hygiene checkpoint |

2026-06-22 二轮判断：以上 P1 均不是本轮进入 AU-11 前必须关闭项。当前应保持真实入口与外部 driver 边界，不为了 LongRunner 或 card visual matrix 强加验收专用 product hook；FAILED task_state、card/action、UI hygiene 可作为 AU-10 后续 checkpoint 单独关闭。

### 可登记为后续的 P2

| 缺口 | 说明 |
|---|---|
| legacy browser `au10-micro-plan-entry` 现代化 | 仍可保留 pr-smoke，但不作为当前 AU-10 文件级主证据 |
| 更多右侧栏/窄窗口状态截图 | 当前 1280x800 baseline 已验收；更广 viewport 为回归扩展 |
| 真人走查观感 | 可放入 walkthrough，不替代 Tauri driver |

---

## 6. 文件级完成计划与本轮 checkpoint

本文件当前只需要一个收口 checkpoint：

| Checkpoint | 范围 | 状态 |
|---|---|---|
| AU10-file-level-closure | 审计 17 场景；将 6 个 AU-10 当前 Tauri driver 接入 quality manifest；同步 AU-10 文档、blueprint、README、ledger、tasks/NEXT；复跑 quality acceptance、task_done、static scan | doing |

本 checkpoint 不改生产代码，不涉及 I1/I2/I3 scenario invariants。若后续触碰 TurnResult/tool/artifact/adoption/主链，再按项目规则补跑 I1/I2/I3。

---

## 7. 验收命令

```bash
bash scripts/tauri_slice_verify.sh --list

bash scripts/quality_accept.sh au10-workbench-matrix-layout --surface tauri
bash scripts/quality_accept.sh au10-workbench-recovery-taskstate --surface tauri
bash scripts/quality_accept.sh au10-workbench-recovery-disconnect-timeout --surface tauri
bash scripts/quality_accept.sh au10-workbench-recovery-provider-timeout --surface tauri
bash scripts/quality_accept.sh au10-workbench-recovery-reconnect --surface tauri
bash scripts/quality_accept.sh au10-workbench-recovery-cancel-waiting --surface tauri

bash scripts/quality_manifest_check.sh
bash scripts/task_done.sh --skip-static-scan
node scripts/task_done_check.mjs
bash scripts/ai_static_scan.sh --top 10
git diff --check
```

局部证据可按需复跑：

```bash
mix test apps/novel_web/test/novel_web/channels/workspace_channel_task_state_test.exs
mix test apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs
cd frontend && pnpm test
```

---

## 8. 文件级退出判断

| 标准 | 当前判断 |
|---|---|
| 所有场景有可信矩阵 | 满足 |
| P0 关闭或登记为跨文件 blocker | 满足：无开放 P0 |
| P1 尽量关闭并有 owner/恢复路径 | 满足：LongRunner、FAILED task_state、card/action、projection、trace、hygiene 已登记 |
| 已实现场景有局部测试证据；承重主链有外部真实页面证据 | 满足：14 个场景已验收，1 个场景有局部测试，2 个场景部分实现 |
| 验收文档、SCENARIO-BLUEPRINT、acceptance README、project ledger、tasks/slices、quality manifest 同步 | 本 checkpoint 同步 |
| task_done 与 ai_static_scan 完成 | `task_done` / `task_done_check` 已生成并校验 manifest；`ai_static_scan --top 10` 已执行，唯一 Top 10 为历史 gitleaks accepted_risk，0 touched-file finding，blocking=0 |

结论：AU-10 可以进入 AU-11。6 个 AU-10 Tauri quality acceptance 已复跑通过；task_done 与 static scan 在本轮最终质量门禁中收口。
