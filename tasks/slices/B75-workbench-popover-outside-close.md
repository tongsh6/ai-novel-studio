# B75：工作台弹出层点击外部/Esc 关闭（AU15 驱动发现）

- 状态：**done（2026-10-31；CP0 复现/契约 + CP1 实现 + 真实 Tauri scoped 页面证据 uib74f）**。
- 来源：B39 AU-15 外部原生驱动在新建会话后无法通过“点击外部/Esc”收起会话弹层；核对 `frontend/src/components/WorkspaceChat.tsx:4196` 原生 `<details>` 仅能再点“会话”按钮 toggle。
- 范围：工作台会话/作品菜单等弹出层统一关闭手势（click-outside、Esc、焦点返回触发按钮），保持现有可见语义与键盘可达；不改业务动作/契约。
- 验收：外部真实 Tauri 驱动从用户入口打开弹层后，点击外部/Esc 均可关闭且不触发隐藏动作；键盘焦点返回触发按钮；无验收感知逻辑。
- 备注：源自 AU15 blocked 场景 `known_not_closed`，不阻塞 B39 机制证据，但应在后续 UX 批次收口。

## 实现与证据（2026-10-31）

- 实现：新增 `frontend/src/lib/popoverDismiss.ts` 纯事件装配（click-outside / Esc / 焦点回 summary），`WorkspaceChat.tsx` 会话 `<details>` 接入；不改业务动作。
- 测试：`popoverDismiss.test.ts` 3 条（内部点击不关闭、外部关闭、Esc 关闭+焦点、已关闭不触发）；前端 typecheck/lint/test 635/635。
- 真实页面：AU15 scoped 批次 `uib74f` 驱动的 `verifySessionPopoverDismiss` 在真实 Tauri 窗口完成 click-outside 与 Esc 关闭，`b75-popover-dismiss.json ok=true`；截图 `b75-popover-open.jpg`/`b75-click-outside-closed.jpg`/`b75-escape-closed.jpg`（证据目录 `artifacts/slice-verify/b39-au15-uib74f-native/`）。
- 说明：该批次 driver 后续外部步骤失败（`external_driver_failed`），只读保留；B75 本身两项目标已在失败前完成并留证，不用整批结果粉饰。
