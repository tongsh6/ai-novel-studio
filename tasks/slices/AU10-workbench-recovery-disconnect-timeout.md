# AU10 Workbench Recovery Disconnect / Timeout / 工作台恢复态断线超时

- 状态：checkpoint closed（CP1 provider failure recovery；CP2 WebSocket reconnect recovery）
- 类型：UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-17
- 来源：`tasks/NEXT.md` Order 27；`docs/design/acceptance/author/AU-10-workbench-ui.md` SC-AU10-A3 / SC-AU10-B1 / AU10-GAP-10 / AU10-GAP-11。

## 1. 用户 / 系统目标

作者在真实工作台遇到 LLM provider 不可用、超时、断线或取消等待时，界面不能无限 loading，不能暗中写入作品事实，且必须能在恢复后继续下一轮对话。

本 slice 当前已闭环两个 checkpoint：CP1 覆盖 provider 不可用时的可恢复失败说明，明确本轮没有待采纳内容或作品事实写入；loading 清除、输入仍可用；恢复 provider 后下一轮不用刷新即可成功。CP2 覆盖真实 WebSocket 断线/重连：外部 driver 停止并重启本次 slice 的 Phoenix 服务，真实工作台进入同步离线、禁用输入、清除 loading，服务恢复后自动 rejoin，并能继续下一轮。取消等待、真实 timeout、完整异步 LongRunner streaming、stale/disabled/idempotency UI 仍是后续 checkpoint。

## 2. 开工检查

- Contract: Provider Gateway error log、Planner fallback TurnResult、`WorkspaceChannel user_message`、Phoenix socket/channel lifecycle、TurnResult `truthfulness.production_write_performed=false`、`WorkspaceChat` loading/input state。
- Invariant: provider 失败不能写 production fact 或产生可采纳 artifact；失败后 UI 不得无限 loading；WebSocket 断开时不能继续发送；重连后作者可继续发送下一轮并穿过真实主链。
- Boundary: 涉及 `novel_application`、`novel_web`、`frontend/src/components/WorkspaceChat.tsx`、`frontend/slice-verify`、`scripts/tauri_slice_verify.sh` 和任务/验收文档；不改 persistence schema、不注册验收 provider 到生产 runtime、不新增产品验收 hook。
- Consumer: 真实 `WorkspaceChat` 输入框、消息流和 provider runtime；外部 Tauri driver 通过真实页面操作。
- Proof: Application/Channel 回归、native verifier 单元测试、`bash scripts/tauri_slice_verify.sh au10-workbench-recovery-disconnect-timeout`、`bash scripts/tauri_slice_verify.sh au10-workbench-recovery-reconnect`。
- Acceptance Driver: CP1 driver 通过产品 provider config API 临时切到不可达 LM Studio endpoint，驱动真实工作台发送消息，验证 failure TurnResult、业务日志、UI loading/input 状态；再恢复 `slice_verify` provider 并发送下一轮。CP2 driver 从产品外部停止/重启本次 Phoenix 服务，验证真实 socket/channel 断线、rejoin 和恢复后下一轮完成。产品代码不读取 slice id/env/query/localStorage。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增基础类型。 |
| novel_domain | no | 不新增领域对象。 |
| novel_agent | no | 复用既有 Provider Gateway 与 runtime config；不新增生产 provider。 |
| novel_application | yes | Planner fallback 文案明确 no artifact / no production write；回归锁 provider unavailable 后可继续。 |
| novel_persistence | no | 不写 schema / migration。 |
| novel_web | yes | Channel 真异常分支补 scoped fallback TurnResult；provider unavailable 主链保持 done + fallback result。 |
| frontend | yes | `WorkspaceChat` 响应真实 socket/channel close/error；Tauri driver/verifier 增加 provider failure 和 service reconnect recovery 验收。 |
| docs/design | yes | 同步 AU-10 acceptance 和 Journey J 状态。 |
| quality | no | 不新增质量运行规则。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | provider unavailable fallback 明确“无待采纳内容 / 无作品事实写入” | done | `Planner.fallback_message/1`。 |
| T2 | Channel 真异常 fallback TurnResult 补 turn/work/session scope 与 truthfulness | done | 覆盖非 provider 主链异常，避免前端收到不可追踪空壳。 |
| T3 | 外部 Tauri driver 通过不可达 provider 验证失败恢复与下一轮继续 | done | 先切 `lmstudio` 到 `127.0.0.1:9`，再恢复 `slice_verify`。 |
| T4 | native verifier 识别 failure turn + recovery turn 证据 | done | failure turn 是 `channel.user_message.done` + provider error，不是 Channel error。 |
| T5 | 文档 / NEXT / ledger 同步 | done | 本 CP 不把 J10 整体标 done。 |
| T6 | WebSocket 断线/重连 UI 验收 | done | 外部 driver 停止/重启本次 Phoenix 服务，验证离线禁用输入、重连后继续下一轮。 |
| T7 | 取消等待和完整异步 LongRunner streaming | todo | 后续 checkpoint。 |
| T8 | stale/disabled/idempotency UI 深矩阵 | todo | 后续 checkpoint。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au10-workbench-recovery-disconnect-timeout`（证据：`artifacts/slice-verify/au10-workbench-recovery-disconnect-timeout-tauri/summary.json`）
- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh au10-workbench-recovery-reconnect`（证据：`artifacts/slice-verify/au10-workbench-recovery-reconnect-tauri/summary.json`）
- [x] 后端 / Channel / 前端局部验证：`mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs`；`pnpm exec vitest run slice-verify/native-tauri-verifier.test.mjs src/lib/__tests__/workspaceRuntimeState.test.ts src/lib/__tests__/socket.test.ts`
- [ ] `bash scripts/quality_manifest_check.sh`
- [ ] `bash scripts/check_design_trace.sh`（本 CP 未改产品组件追溯注释）
- [ ] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-17 — 选择 provider failure recovery 作为 `AU10-workbench-recovery-disconnect-timeout` CP1。它直接覆盖 AU10 SC-AU10-B1 的失败恢复和 SU-01 provider 异常矩阵的一段真实页面链路，风险小于立即模拟 WebSocket 断线。
- 2026-06-17 — 真实产品把 provider unavailable 处理为可恢复 conversational fallback TurnResult，并记录 `provider_gateway.complete.error`；Channel 事件是 `channel.user_message.done`。verifier 按这个合同验收，而不是强行要求 Channel error。
- 2026-06-17 — CP1 closed：外部 Tauri driver 证明不可达 provider 下真实工作台显示“无法连接到创作引擎 / 没有写入作品事实”，loading 清除，输入可继续；恢复 provider 后下一轮完成。WebSocket 断线、取消等待、完整异步 LongRunner streaming 和 stale/disabled/idempotency UI 保持后续缺口。
- 2026-06-17 — CP2 closed：外部 Tauri driver 不再依赖浏览器离线模拟，而是停止/重启本次 slice 的 Phoenix 服务，证明真实工作台在 socket/channel close/error 后显示“同步离线”、禁用输入且不残留 loading；服务恢复后观察到 `channel.join.done` rejoin，并完成下一轮 `channel.user_message.done`。取消等待、真实 timeout、完整异步 LongRunner streaming 和 stale/disabled/idempotency UI 保持后续缺口。

## 7. 试行反馈

- provider failure 与 Channel handler 真异常是两条不同失败路径：前者应返回可恢复 TurnResult，后者仍需要 scoped fallback TurnResult，避免客户端拿不到 turn/work/session 语义。
- 验收脚本应验证业务日志和 UI 状态的因果绑定：provider error 属于失败 turn，provider done 属于恢复 turn，不能只看页面上出现错误文字。
- 浏览器 `context.setOffline(true)` 不一定会及时关闭既有 WebSocket；断线重连验收要从产品外部控制真实后端服务，才能稳定证明真实 socket/channel 生命周期。
