# AU02 File-Level Closure

- 状态：file-level deliverable / keep regression
- 类型：Author Acceptance File Closure
- 验收文件：`docs/design/acceptance/author/AU-02-explore.md`
- 当前结论：12 个场景中 11 个已有真实页面外部自动化证据，D2 为 schema/codegen 契约回归已测试；P0/P1 已关闭，当前可进入 AU-03。
- 最近复核：2026-06-21

## 1. 文件级目标

AU-02 验收作者从模糊创意进入自然探索：AI 应给出自然语言讨论和候选方向，作者可以继续聊某个候选、直接自由追问，或明确采纳候选进入 adoption boundary。候选方向只是灵感入口，不得自动写入作品事实、阅读模式或生产投影。

本文件是 AU-02 的文件级收口记录，补齐从验收文档、schema、实现入口、quality manifest 到当前 runnable evidence 的对账链路。本轮只新增文件级记录和索引，不修改 production runtime。

## 2. 开工检查

- Contract：`docs/design/acceptance/author/AU-02-explore.md`；`docs/design/schemas/foundation/candidate_direction.json`；`docs/design/schemas/foundation/turn_result_v2.json`；`quality/acceptance/scenarios/au02-*.yml`；`available_actions` / `author_action.choose_candidate` contract。
- Invariant：exploration turn 有 primary DialogueFrame；缺 slot 不自动表单化；TurnResult 是候选卡 canonical 输出；selection 不等于 adoption；候选采纳必须经服务端授权 action 与 `AdoptionBoundary`；探索阶段默认 no-MicroPlan/no-tool/no-write。
- Boundary：切穿真实 Tauri UI、Phoenix Channel、`DialogueGateway`、Planner、`TurnResultBuilder`、`AvailableActionBuilder`、`AdoptionBoundary` 和前端 generated schema；不修改 production provider/runtime、persistence schema、产品验收 hook 或 fixture 注册边界。
- Consumer：`WorkspaceChat` 当前候选面板、`socket.sendMessage` 的 `candidate_selection`、`sendAuthorAction` 的授权 `choose_candidate`、AU-02 quality acceptance runner。
- Proof：后端探索/adoption 局部测试、前端 schema/candidate/socket/action tests、native verifier、7 个 AU-02 Tauri driver、natural exploration real LM Studio 变体、8 个 quality acceptance 入口。
- Acceptance Driver：`scripts/tauri_slice_verify.sh au02-*` 从产品外部驱动真实 Tauri 页面。产品代码没有读取 slice id、没有隐藏 DOM hook、没有验收专用 env/query/localStorage、没有自动输入/点击/上报验收状态。

## 3. 场景对账矩阵

| 场景 | 设计期望 | Contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU02-A1 模糊想法得到自然探索回应 | 自然创作讨论、`creative_exploration`、不出现执行/确认/工具卡 | AU02-I1 | `Planner.form_frame`、`DialogueGateway.handle_input`、`WorkspaceChat` | `dialogue_gateway_test.exs`、`creative_exploration_loop_test.exs` | `au02-natural-exploration-no-slot-form`、`--real-lmstudio` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU02-A2 不弹机械表单 | 无 required/missing/slot form，输入框可用 | AU02-I2 | Planner normalization、Channel TurnResult、`WorkspaceChat` | gateway / channel no-slot-form 测试 | `au02-natural-exploration-no-slot-form` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU02-B1 看到候选方向卡片 | 候选 title/pitch/tone_tags 可见，非正式设定 | AU02-I3 / CandidateDirection | `TurnResultBuilder.format_candidates/1`、`WorkspaceCandidatePanel` | `turn_result_candidates.test.ts`、`WorkspaceChat.availableActions.test.tsx` | `au02-natural-exploration-no-slot-form`、`au02-candidate-continuation` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU02-B2 候选方向只是灵感，不自动采纳 | `not_adopted`、no adoption/no write，阅读模式看不到未采纳候选 | AU02-I4 | Candidate schema、truthfulness、ReadingMode read model | `dialogue_gateway_test.exs`、schema tests | `au02-unadopted-candidate-no-reading-fact` | 已验收 | 已采纳投影归 AU-05/AU-08 | cross-reference | P1 | AU-05/AU-08 owner |
| SC-AU02-B3 候选缺失或格式坏时 fallback | fallback candidates 字段非空、`not_adopted`、可渲染 | AU02-I3 | Planner fallback、TurnResultBuilder、CandidatePanel | `dialogue_gateway_test.exs` | `au02-candidate-fallback-ui` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU02-B4 点选候选方向继续探索 | 发送 `user_message.candidate_selection`，不提交 adoption | AU02-I4 | `handleCandidateContinue`、`socket.sendMessage`、Channel user_message | `socket.test.ts`、candidate selection tests | `au02-candidate-continuation` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU02-B5 明确采纳候选方向 | 服务端 action 校验后进入 `AdoptionBoundary` | AU02-I5 | `AvailableActionBuilder.candidate_actions/2`、`ActionValidator`、`DialogueGateway.handle_action`、`AdoptionBoundary` | `adoption_boundary_test.exs`、action tests | `au02-candidate-adoption-bridge` | 已验收 | 高风险/stale/conflict/cross-work 归 AU-05 | cross-reference | P1 | AU-05 owner |
| SC-AU02-C1 追问一个方向后继续自然展开 | 后续普通追问消费 prior candidate context | AU02-I1/I4 | Context assembly、session transcript、Planner | `dialogue_gateway_test.exs` | `au02-candidate-multiturn-context` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU02-C2 探索阶段始终可自由输入 | 候选卡不强制选择，输入框可继续普通消息 | AU02-I4/I6 | `WorkspaceChat.handleSend`、CandidatePanel、socket | `WorkspaceChat.availableActions.test.tsx` | `au02-freeform-followup-after-candidate` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU02-C3 探索阶段不误触发执行计划 | `generate_micro_plan=false`、无 MicroPlan/tool/action/write | AU02-I6 | `socket.sendMessage`、Planner micro-plan boundary | `socket.test.ts` | `au02-natural-exploration-no-slot-form`、`au02-candidate-continuation`、`au02-freeform-followup-after-candidate` | 已验收 | 无 | 无 | P0 | 保持回归 |
| SC-AU02-D1 本地 LM Studio 产生质量可用中文探索 | 中文自然语言、无 JSON/代码块、候选语义相关 | real provider quality | Planner real LLM path、LM Studio request log | `planner_real_llm_test.exs` 既有 real_llm 证据 | `au02-natural-exploration-no-slot-form --real-lmstudio`、`quality_accept --provider lmstudio` | 已验收 | 无 | 无 | P1 | 保持回归 |
| SC-AU02-D2 前后端候选契约一致 | schema/type/backend/frontend 字段一致，状态只允许 `not_adopted` | CandidateDirection schema/codegen | `candidate_direction.json`、generated TS、`WorkspaceChat` 类型消费 | `schemas.test.ts`、`turn_result_candidates.test.ts`、`mix codegen.enums --check` | 无；契约型回归不需要页面验收 | 已测试 | 无 | 无 | P1 | 保持 schema/codegen 回归 |

## 4. 偏差 review

- 候选 continuation：`WorkspaceChat.handleCandidateContinue` 发送普通 `user_message`，只额外携带 `candidate_selection`，并显式 `generate_micro_plan=false`；这符合“继续探索不是采纳”的设计。
- 候选 adoption：`WorkspaceCandidatePanel` 只有在 `turnResult.available_actions` 中存在 server-provided `choose_candidate` action 时才显示采纳按钮；`findCandidateAvailableAction` 找不到匹配 action 时返回 `null`，不会本地发明授权动作。
- 后端 authority：`AvailableActionBuilder.candidate_actions/2` 生成 `choose_candidate` action；`DialogueGateway.handle_action/3` 先经 `ActionValidator` 校验，再从 source TurnResult 重建 candidate set 并调用 `AdoptionBoundary`。
- schema 边界：`candidate_direction.json` 固定 `adoption_status` 只能是 `not_adopted`；前端 generated schema 和测试阻断把 artifact adoption 7 态混入候选方向。
- 验收红线：driver 通过真实输入框、按钮、websocket frame、业务 JSONL、阅读模式 UI、LM Studio log 和 summary artifact 取证；production code 没有验收专用 DOM hook、env/query/localStorage 或 fixture provider 注册。

本轮未发现 AU-02 production 行为偏离设计；无需修改 runtime。需要保留的边界是：高风险/stale/conflict/cross-work 候选采纳完整安全矩阵继续归 AU-05，已采纳后阅读投影完整矩阵继续归 AU-08。

## 5. 缺口分级

| 优先级 | 缺口 | 处置 |
|---|---|---|
| P0 | 无 | AU-02 自然探索、候选 fallback、continuation、freeform follow-up、no-MicroPlan、未采纳不入阅读/事实和采纳桥接均有当前真实页面证据。 |
| P1 | SC-AU02-D2 无真实页面证据 | D2 是 schema/codegen 契约回归，不是用户页面场景；已用 generated schema/type、前端契约测试和 enum codegen check 关闭。 |
| P1 | 高风险/stale/conflict/cross-work 候选采纳安全矩阵 | 登记为 AU-05 owner；AU-02 只负责“明确采纳入口到 adoption boundary”的文件级主链。 |
| P1 | 已采纳候选进入作品事实/阅读投影的完整矩阵 | 登记为 AU-05/AU-08 owner；AU-02 已证明未采纳候选不进入阅读/事实。 |
| P2 | 真人观感复验、更多非 exploration frame 样例 | 后续体验矩阵；不阻塞 AU-02 文件级退出。 |

## 6. 验证记录

已复跑：

```bash
bash scripts/tauri_slice_verify.sh --list
mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs apps/novel_application/test/novel_application/creative_exploration_loop_test.exs apps/novel_application/test/novel_application/adoption_boundary_test.exs
pnpm --dir frontend exec vitest run src/lib/__tests__/schemas.test.ts src/lib/__tests__/turn_result_candidates.test.ts src/lib/__tests__/candidateSelection.test.ts src/components/WorkspaceChat.availableActions.test.tsx src/lib/__tests__/socket.test.ts slice-verify/native-tauri-verifier.test.mjs
bash scripts/quality_manifest_check.sh
mix codegen.enums --check
bash scripts/tauri_slice_verify.sh au02-natural-exploration-no-slot-form
bash scripts/tauri_slice_verify.sh au02-candidate-fallback-ui
bash scripts/tauri_slice_verify.sh au02-candidate-continuation
bash scripts/tauri_slice_verify.sh au02-candidate-multiturn-context
bash scripts/tauri_slice_verify.sh au02-freeform-followup-after-candidate
bash scripts/tauri_slice_verify.sh au02-unadopted-candidate-no-reading-fact
bash scripts/tauri_slice_verify.sh au02-candidate-adoption-bridge
bash scripts/tauri_slice_verify.sh --real-lmstudio au02-natural-exploration-no-slot-form
bash scripts/quality_accept.sh au02-natural-exploration-no-slot-form --surface tauri
bash scripts/quality_accept.sh au02-candidate-fallback-ui --surface tauri
bash scripts/quality_accept.sh au02-candidate-continuation --surface tauri
bash scripts/quality_accept.sh au02-candidate-multiturn-context --surface tauri
bash scripts/quality_accept.sh au02-freeform-followup-after-candidate --surface tauri
bash scripts/quality_accept.sh au02-unadopted-candidate-no-reading-fact --surface tauri
bash scripts/quality_accept.sh au02-candidate-adoption-bridge --surface tauri
bash scripts/quality_accept.sh au02-natural-exploration-no-slot-form --surface tauri --provider lmstudio
git diff --check
bash scripts/task_done.sh --skip-static-scan
bash scripts/ai_static_scan.sh --top 10
node scripts/task_done_check.mjs
```

结果：

- 后端 AU-02 相关测试：38 tests / 0 failures。
- 前端 AU-02 相关测试：166 tests / 0 failures。
- `quality_manifest_check.sh`：passed；warning 均为其它 slice 缺 manifest，AU-02 manifest 已存在。
- `mix codegen.enums --check`：in sync。
- 7 个 AU-02 默认 Tauri driver 均 passed。
- natural exploration real LM Studio 变体 passed，summary 记录 `provider=lmstudio`、`request_count=1`、HTTP 200、中文自然回复、无 JSON/代码块、候选语义相关。
- 8 个 AU-02 quality acceptance 入口均 passed。
- `git diff --check`：passed。
- `task_done.sh --skip-static-scan`：manifest ok，UI evidence not required。
- `task_done_check.mjs`：manifest ok。
- `ai_static_scan.sh --top 10`：17 passed / 1 failed；唯一 Top 10 是既有 gitleaks `generic-api-key` accepted_risk，`blocking=0`、`touched=0`，不命中本轮文件。

## 7. 退出结论

AU-02 满足文件级退出标准：

1. 12 个场景均有可信对账矩阵。
2. P0 已关闭。
3. P1 已尽量关闭；剩余高风险/stale/conflict/cross-work 采纳安全矩阵明确登记为 AU-05 owner，已采纳阅读投影完整矩阵明确登记为 AU-08 owner。
4. 已实现场景均有局部测试证据；承重探索主链有外部 Tauri 真实页面证据。
5. AU-02 quality manifest、slice driver、summary artifact、验收 README、SCENARIO-BLUEPRINT 和项目台账口径一致。
6. 本文件补齐 tasks/slices 文件级收口入口。

当前可进入下一个验收文件：`docs/design/acceptance/author/AU-03-context.md`。
