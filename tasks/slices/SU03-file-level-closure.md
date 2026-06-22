# SU03 File-Level Closure

- 状态：file-level deliverable / keep regression
- 类型：System Acceptance File Closure
- 验收文件：`docs/design/acceptance/system/SU-03-model-nickname.md`
- 当前结论：6/6 已验收；无 P0/P1 未闭环缺口；当前可进入 AU-01。
- 最近复核：2026-06-22

## 1. 文件级目标

SU-03 验收的是“给 AI 助手起显示名”的系统用户旅程。显示名必须是按作品隔离的 UI preference，只改变工作台 label；不得改变 LLM provider、prompt、canonical role、Channel payload、TurnResult 契约或 trace/replay 识别方式。

本文件是 SU-03 的文件级收口记录，补齐从验收文档到当前 runnable evidence 的对账链路。产品实现已存在，本次不需要修改 production 代码。

2026-06-22 二轮复核：不推翻第一轮 file-level deliverable 结论；本轮只复核已登记剩余 P1/P2、external blocker 和 cross-reference。默认 Tauri quality 入口与真实 LM Studio provider 入口均已复跑通过，未发现本文件内应关闭的 P0/P1。当前剩余仍仅为 P2 回归项：工作台未来新增 assistant 展示面必须继续消费 `assistantRoleLabel`，以及未来若后端 Work profile 接管 UI preference 需另立 ADR/contract。

## 2. 开工检查

- Contract：`docs/design/acceptance/system/SU-03-model-nickname.md`；`quality/acceptance/scenarios/su03-assistant-display-name.yml`；`frontend/src/lib/assistantDisplayName.ts`；Tauri `get_assistant_display_name` / `set_assistant_display_name` command。
- Invariant：`assistantDisplayName` 是 work-scoped UI preference；canonical role 保持 `assistant`；TurnResult 继续使用 `assistant_message`；provider request body 不携带 UI 显示名。
- Boundary：切穿真实 Tauri UI、frontend helper、Tauri preferences、Phoenix Channel message flow 和 provider request log；不修改 `novel_agent`、`novel_application`、`novel_persistence`、`novel_web` contract。
- Consumer：第一个真实消费者是 `WorkspaceChat` 的消息 label、thinking label 和 AI 显示名 Dialog；验收消费者是 `scripts/tauri_slice_verify.sh su03-assistant-display-name`。
- Proof：前端 helper/native verifier 单测；默认 Tauri driver；real LM Studio driver；quality acceptance manifest。
- Acceptance Driver：`frontend/slice-verify/external-ui-driver.mjs` 从产品外部驱动真实 Tauri 工作台。产品代码没有读取 slice id、没有隐藏 DOM hook、没有验收专用 env/query/localStorage、没有自动输入/点击/上报验收状态。

## 3. 场景对账矩阵

| 场景 | 设计期望 | Contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-SU03-A1 默认显示名 | 未设置时欢迎消息、普通 AI 消息和 thinking 都显示默认 `AI` | SU03-I4 | `assistantDisplayName.ts`；`WorkspaceChat.tsx` | `assistantDisplayName.test.ts` | `artifacts/slice-verify/su03-assistant-display-name-tauri/summary.json` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-SU03-A2 所有 AI 展示面统一 | 主工作台、历史 transcript、thinking 使用同一显示名；user label 不受影响 | SU03-I2 | `assistantRoleLabel`；`WorkspaceChat` message/thinking render | `assistantDisplayName.test.ts`；`native-tauri-verifier.test.mjs` | `su03-assistant-display-name` summary | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-SU03-B1 设置显示名并即时生效 | 从真实入口保存“创作助手”后当前工作台即时更新，切换/重启后按作品恢复 | SU03-I3/I4 | `WorkspaceChat` Radix Dialog；Tauri preferences command | `assistantDisplayName.test.ts` | `su03-assistant-display-name` summary | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-SU03-B2 校验、空白回退、重置默认 | trim、空白回默认、20 字符上限、reset 删除当前作品自定义值 | SU03-I4 | `normalizeAssistantDisplayName`；`set/resetAssistantDisplayName`；Tauri/browser preference | `assistantDisplayName.test.ts` | `su03-assistant-display-name` 覆盖真实设置、创建新作品默认值和切回恢复 | 已验收 | 无 | 无 | P1 | 保持回归 |
| SC-SU03-C1 按作品隔离 | 作品 A 的显示名不污染作品 B；切换后随 work_id 恢复 | SU03-I3 | `assistant_display_names` work_id map；`get/setAssistantDisplayName`；`openWork` | `assistantDisplayName.test.ts` | `su03-assistant-display-name` summary | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-SU03-C2 只影响 UI | UI label 可变，但 websocket payload、canonical role、TurnResult、LM Studio request body 不带显示名 | SU03-I1/I2 | UI preference/helper；未改 provider/gateway/planner/TurnResult schema | `native-tauri-verifier.test.mjs` | `su03-assistant-display-name` 与 `--real-lmstudio` summary；`lmstudio-log.json` | 已验收 | 无 | 无 | P0 | `SU03-assistant-display-name-boundary.md` |

## 4. 偏差 review

- UI contract：文案集中在 `frontend/src/lib/copy.ts`；`WorkspaceChat.tsx` 文件头已有设计 trace；入口使用 Radix Dialog 与 Lucide `Bot` / `RotateCcw` 图标。
- Tauri desktop-first：桌面环境经 Tauri command 写 `preferences.json`；浏览器 localStorage 只作为测试/预览 fallback，且不影响 Tauri 主入口。
- Provider/runtime 边界：显示名实现没有注册 provider、没有改 prompt、没有改 `NovelAgent` / `DialogueGateway` / TurnResult schema；`--real-lmstudio` 证明 request body 不包含“创作助手”。
- Work 隔离：Tauri preferences 用 `assistant_display_names` 按 `work_id` 存储；driver 覆盖 A 保存、B 默认、切回 A 恢复。
- 验收红线：driver 通过真实按钮、输入框、websocket frame、TurnResult 和 LM Studio log 取证；生产代码没有验收感知逻辑。

未发现需要“修设计偏差”或“文档同步”的 P0/P1 问题。

## 5. 缺口分级

| 优先级 | 缺口 | 处置 |
|---|---|---|
| P0 | 无 | 当前文件 P0 已关闭。 |
| P1 | 无 | 当前文件 P1 已关闭。 |
| P2 | 工作台未来重构可能新增 assistant 展示面 | 随 AU-10 / 工作台重构保留回归：新增展示面必须继续消费 `assistantRoleLabel`。 |
| P2 | 未来若后端 Work profile 持久化接管偏好 | 需要新 ADR/contract；当前不提前迁移，避免把 UI-only preference 混入业务 schema。 |

## 6. 验证记录

已复跑：

```bash
bash scripts/tauri_slice_verify.sh --list
pnpm --dir frontend exec vitest run src/lib/__tests__/assistantDisplayName.test.ts slice-verify/native-tauri-verifier.test.mjs
bash scripts/quality_manifest_check.sh
bash scripts/tauri_slice_verify.sh su03-assistant-display-name
bash scripts/tauri_slice_verify.sh --real-lmstudio su03-assistant-display-name
bash scripts/quality_accept.sh su03-assistant-display-name --surface tauri
```

2026-06-22 二轮复跑：

```bash
bash scripts/quality_accept.sh su03-assistant-display-name --surface tauri
bash scripts/tauri_slice_verify.sh --real-lmstudio su03-assistant-display-name
```

结果：

- `assistantDisplayName.test.ts` + `native-tauri-verifier.test.mjs`：2 files / 133 tests passed。
- `quality_manifest_check.sh`：passed；warning 均为其它 slice 缺 manifest，SU-03 manifest 已存在。
- 默认 Tauri driver：passed，`provider=slice_verify`，`turn_id=turn_3`。
- real LM Studio driver：passed，`provider=lmstudio`，`request_count=1`，HTTP 200，request body 不包含“创作助手”。
- quality acceptance：passed。
- 2026-06-22 当前 artifact：`artifacts/slice-verify/su03-assistant-display-name-tauri/summary.json` 证明 `sent_payload_includes_display_name=false`、`turn_result_contract_has_assistant_message=true`、`turn_result_has_display_name_key=false`；`artifacts/slice-verify/su03-assistant-display-name-tauri-lmstudio/summary.json` 证明 `provider=lmstudio`、`request_count=1`、HTTP 200，并包含 `lmstudio_request_did_not_include_ui_display_name` 断言。

## 7. 退出结论

SU-03 满足文件级退出标准：

1. 6 个场景均有对账矩阵。
2. 所有 P0/P1 缺口已关闭。
3. 已实现场景均有局部测试证据；承重 UI 主链有外部 Tauri 真实页面证据。
4. `SC-SU03-C2` 有真实 LM Studio request body 反证。
5. 验收文档、蓝图、README、project ledger、quality manifest 已与当前闭环口径一致。
6. 本文件补齐 tasks/slices 文件级收口入口。

当前可进入下一个验收文件：`docs/design/acceptance/author/AU-01-chat.md`。
