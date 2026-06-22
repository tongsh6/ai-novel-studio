# AU-05 采纳创作产物

> 作者视角：AI 生成的角色设定、剧情方向、大纲、章节片段默认都是草稿或候选，不能自动成为作品事实。只有我明确采纳，并且系统通过 adoption boundary 后，它们才进入作品档案、阅读投影或后续上下文。

> 2026-06-21 文件级审计结论：AU-05 当前按 18 个场景重算为 15 个已验收、3 个部分实现。真实工作台已经通过 `author_action` 主链覆盖候选 adoption boundary、高风险确认、stale 拒绝、cross-work/canon conflict recovery，以及 artifact `accept` / `discard` / `edit_then_accept` 到阅读投影的链路。旧文档里“WorkspaceChannel 缺 adopt/discard/modify_draft handler”的判断已经过期；当前有效入口是服务端下发 `available_actions` 后由前端提交 `author_action`，再经 `ActionValidator -> DialogueGateway/AdoptionWorkflow -> AdoptionBoundary` 裁决。剩余未闭环项集中在持久化待处理箱、完整 ProjectionHint stale/refresh 状态机和 developer replay/StateTrace 聚合，均登记为 P1/P2 跨文件后续，不阻止进入 AU-06。
>
> 2026-06-22 二轮缺口收敛更新：本轮不推翻 2026-06-21 文件级可交付结论；已串行复跑 `au05-adoption-safety-freshness`、`au05-stale-conflict-cross-work-freshness`、`au05-conflict-cross-work-recovery`、`au05-canon-conflict-recovery`、`au05-discard-author-action`、`au02-candidate-adoption-bridge`、`au02-unadopted-candidate-no-reading-fact`、`p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`au07-state-trace-adoption-replay` 和 `au09-adopt-setting-recall`，均通过真实 Tauri / quality acceptance。当前无 AU-05 内必须继续关闭的 P1；持久 adoption inbox、ProjectionHint refresh 状态机、完整 replay/旧 turn 查询、canon/revision store 自动计算和人工合并 UX 继续登记到 AU-06/AU-07/AU-08/AU-09/AU-10 后续，不标为已验收。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 让 AI 生成角色、组织、剧情方向、大纲或正文片段 | 以待采纳草稿或候选卡展示，不自动写入作品事实 |
| 浏览多个草稿 | 能看标题、摘要、内容、来源和适用范围 |
| 点选候选继续讨论 | 只表示 selection，不等于 adoption |
| 明确采纳候选方向 | 提交服务端授权 `author_action.choose_candidate`，由 adoption boundary 裁决 |
| 明确保存正文草稿 | 提交服务端授权 `author_action.accept`，写入 accepted draft / reading projection |
| 修改后保存正文 | 提交服务端授权 `author_action.edit_then_accept`，保存作者修改后的版本 |
| 放弃草稿 | 草稿进入 discarded/resolved，不影响作品事实 |
| 切到阅读模式 | 只能看到已采纳正文；未采纳或已放弃草稿不进入目录或正文 |
| 采纳高风险、过期、跨作品或 canon 冲突内容 | 系统返回确认、拒绝或恢复失败，不静默写入 production state |

明确不能做：

- 工具执行成功不等于采纳成功。
- 候选卡被点选或继续讨论不等于作品设定已更新。
- `adoption_state.pending` 里的内容不能出现在阅读模式正文或作品 canon。
- 前端不能通过旁路事件直接写作品事实，必须走后端授权 action 和 adoption boundary。
- 过期、跨作品、冲突或高风险草稿不能静默采纳。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU05-I1 | AI 产物默认 tentative，不是 production fact | SC-AU05-A1/A2/D3 |
| AU05-I2 | ToolResult 不等于 adopted state | SC-AU05-A2/E2 |
| AU05-I3 | candidate selection 不等于 adoption | SC-AU05-B1 |
| AU05-I4 | adoption 只能由系统边界裁决 | SC-AU05-B2/C1 |
| AU05-I5 | 高风险/覆盖/production adoption 必须确认或恢复 | SC-AU05-C2/C4 |
| AU05-I6 | production write 只能由 accepted decision 触发 | SC-AU05-B2/B3/D1 |
| AU05-I7 | Projection/read model 只能消费 accepted source | SC-AU05-D2/D3 |
| AU05-I8 | stale / conflict / cross-work adoption 不得写入 | SC-AU05-C3/C4/C5 |
| AU05-I9 | TurnResult 文案和 truthfulness 不得把 pending 说成 adopted | SC-AU05-E2 |

---

## 3. 契约引用

| 契约 / 代码 | 用途 |
|---|---|
| `docs/design/contracts/VS-04-adoption-boundary-contract-pack.md` | `CandidateSet`、`AuthorActionInput`、`AdoptionDecision`、`ProjectionHint` 规则 |
| `docs/design/adr/ADR-0010-state-adoption-boundary-v3.md` | selection / ToolResult / adopted state 分层决策 |
| `docs/design/adr/ADR-0016-projection-hint-v3.md` | ProjectionHint 与阅读投影刷新边界 |
| `apps/novel_application/lib/novel_application/adoption_boundary.ex` | 候选采纳安全裁决 |
| `apps/novel_application/lib/novel_application/adoption_workflow.ex` | artifact accept / discard / edit_then_accept 持久化与广播 |
| `apps/novel_application/lib/novel_application/dialogue_gateway.ex` | `choose_candidate` author_action 进入 adoption boundary |
| `apps/novel_application/lib/novel_application/action_validator.ex` | 服务端授权 action 精确校验 |
| `apps/novel_application/lib/novel_application/artifact_assembler.ex` / `turn_result_builder.ex` | creative ToolResult -> tentative artifact -> `adoption_state.pending` |
| `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | 当前 Channel 的 `author_action` 入口、action_result / turn_result 广播 |
| `frontend/src/lib/workbenchActions.ts` | 前端把服务端 `available_actions` 转成 `author_action` payload |
| `frontend/src/components/WorkspaceChat.tsx` | 真实工作台候选、草稿、保存/放弃/修改后保存动作 |
| `frontend/src/components/StructurePanel.tsx` | 作品档案里待处理 / 已确认内容入口 |
| `frontend/src/components/ReadingMode.tsx` | 阅读模式只读取 accepted reading projection |

---

## 4. 场景对账矩阵

| 场景 | 设计期望 | Contract / invariant | 相关实现入口 | 局部测试证据 | 真实页面外部自动化验收证据 | 当前状态 | 设计偏差 | 缺口类型 | 优先级 | 建议 checkpoint / owner |
|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU05-A1 生成后显示为待采纳 | AI 产物默认以待保存/待采纳卡展示，不进入事实 | AU05-I1 / `TentativeArtifactSet` | `ArtifactAssembler`、`TurnResultBuilder`、`WorkspaceChat` | `creative_artifact_test.exs`、`workspace_channel_v3_test.exs` | `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`au05-discard-author-action` 均先生成 `prose_fragment` pending 卡 | 已验收 | 原文以“角色设定”为例，当前真实证据覆盖正文草稿；角色/设定归 AU-09 交叉证据 | 类型覆盖扩展 | P2 | AU-09 继续扩角色/设定完整矩阵 |
| SC-AU05-A2 工具成功不自动写事实 | 工具成功后 `production_write_performed=false`，未保存不进阅读 | AU05-I1/I2/I7 | `TurnExecutionService`、`AdoptionWorkflow`、`ReadingMode` | `creative_artifact_test.exs`、`tool_provenance_test.exs` | `au05-discard-author-action`：生成后放弃，TOC 总字数 0、章节正文 0；`au02-unadopted-candidate-no-reading-fact`：未采纳候选不进阅读 | 已验收 | 无 | 保持回归 | P2 | 保持 AU-05/AU-08 回归 |
| SC-AU05-A3 草稿在作品档案有待处理入口 | 作品档案能看到待处理数量和待处理列表，可触发审核动作 | AU05-I1/I4 | `WorkspaceChat` runtime adoption state、`StructurePanel` pending actions | `WorkspaceChat.availableActions.test.tsx` | `au05-discard-author-action` 证明待采纳数量、真实按钮和 resolved 后清理；历史 resume 证据证明 pending 可恢复显示 | 部分实现 | 当前待处理箱主要来自 transcript/runtime state，不是独立持久 workbox | 持久化 workbox | P1 | AU-06/AU-10 action matrix；后续 persistent adoption inbox |
| SC-AU05-B1 选择候选只是继续探索 | continuation / selection 不等于 adoption，不写投影 | AU05-I3 | `WorkspaceChat.handleCandidateContinue`、`DialogueGateway.handle_input` | `action_roundtrip_test.exs` | `au02-candidate-continuation`、`au02-freeform-followup-after-candidate`、`au02-unadopted-candidate-no-reading-fact` | 已验收 | 无 | 保持回归 | P2 | AU-02 keep regression |
| SC-AU05-B2 点击保存必须走后端边界 | 前端提交服务端授权 action；后端校验 target/source/freshness/conflict | AU05-I4/I6 | `workbenchActions.toAuthorActionPayload`、`WorkspaceChannel.author_action`、`AdoptionWorkflow.handle_adopt` | `workspace_channel_v3_test.exs`、`action_roundtrip_test.exs`、`adoption_workflow_test.exs` | `p1-chapter-adoption-reading`：点击“保存为章节正文”后 `accept` 经 adoption workflow 写入 reading projection | 已验收 | 旧 `socket.adopt` 旁路口径已过期，当前以 `author_action.accept` 为准 | 文档同步 | closed | `AU05-file-level-closure.md` |
| SC-AU05-B3 修改后再采纳 | 作者编辑后的正文替换原草稿，保留 source 并写入 accepted 版本 | AU05-I4/I6/I9 | `WorkspaceChat` Radix Dialog、`author_action.edit_then_accept`、`AdoptionWorkflow.handle_modify_draft` | `workspace_channel_v3_test.exs`、`native-tauri-verifier.test.mjs` | `p1-chapter-edit-then-accept`：payload 带 `edited_content`，阅读模式显示编辑后正文，字数等于编辑后正文 | 已验收 | 文案已从“修改后采纳”改成“修改后保存正文”，验收 driver 已同步 | 文档/driver 同步 | closed | keep regression |
| SC-AU05-B4 放弃草稿 | 草稿进入 discarded/resolved，不再可提交，不写作品事实 | AU05-I1/I6/I7 | `author_action.discard`、`AdoptionWorkflow.handle_discard` | `workspace_channel_v3_test.exs`、`native-tauri-verifier.test.mjs` | `au05-discard-author-action`：点击“不保存”，resolved=DISCARDED，按钮清理，阅读 projection 为空 | 已验收 | 旧 `discard` Channel event 口径已过期，当前以 `author_action.discard` 为准 | 文档同步 | closed | keep regression |
| SC-AU05-C1 低风险可采纳但必须留下 decision | low-risk candidate 只能经 adoption boundary 返回 decision，不由前端写事实 | AU05-I4/I6 | `DialogueGateway.handle_action`、`AdoptionBoundary.evaluate` | `adoption_boundary_test.exs`、`action_roundtrip_test.exs` | `au02-candidate-adoption-bridge`：点击“设为后续方向”后返回 `adopt_tentative`，`production_write_performed=false` | 已验收 | `state_trace_ref` 仍不是完整持久 StateTrace | Trace 加固 | P1 | AU-07 / StateTrace follow-up |
| SC-AU05-C2 高风险要求确认 | 高风险/覆盖类候选不能静默采纳，必须 confirmation 或 no-write | AU05-I5/I8 | `AdoptionBoundary`、`DialogueGateway`、AU-04 confirmation binding | `adoption_boundary_test.exs`、`workspace_channel_v3_test.exs` | `au05-adoption-safety-freshness`：高风险候选返回 `require_confirmation` / `needs_confirmation`，无 production write | 已验收 | 完整 confirmation 后续 re-gate 由 AU-04/AU-06 owner | Cross-reference | P1 | AU-06 behavior lifecycle |
| SC-AU05-C3 stale 草稿不能采纳 | 恢复出的 stale source/candidate 被拒绝，不写事实 | AU05-I8 | `CandidateSet.stability`、`ActionValidator`、`AdoptionBoundary` | `adoption_boundary_test.exs`、`action_roundtrip_test.exs` | `au05-stale-conflict-cross-work-freshness`：`reject`，reason `source_turn_stale/stale_candidate_set`，无 production write | 已验收 | 完整 context version / state snapshot freshness 尚未持久化 | Freshness 加固 | P1 | State snapshot contract follow-up |
| SC-AU05-C4 canon 冲突进入恢复 | 结构化 canon conflict 不能静默覆盖，进入 recovery/confirmation | AU05-I5/I8 | `candidate.canon_conflicts`、`AdoptionBoundary` | `adoption_boundary_test.exs`、`workspace_channel_v3_test.exs` | `au05-canon-conflict-recovery`：`fail_with_recovery`，reason `canon_conflict_detected/conflict_recovery_required`，无 production write | 已验收 | 当前冲突来自 source candidate 已带结构化依据，尚未自动从 canon store 计算 | Conflict store / merge | P1 | AU-09 / StateTrace / merge follow-up |
| SC-AU05-C5 跨作品草稿不能采纳 | 外部作品来源不能写到当前作品 | AU05-I8 | `DialogueGateway` current/source work scope、`AdoptionBoundary` | `action_roundtrip_test.exs`、`workspace_channel_v3_test.exs` | `au05-conflict-cross-work-recovery`：`fail_with_recovery`，reason `work_id_mismatch/cross_work_adoption_rejected`，无 production write | 已验收 | 完整跨作品 persistent inbox 仍缺 | Workbox / isolation 加固 | P1 | SU-02/AU-06 follow-up |
| SC-AU05-D1 采纳后作品档案出现已确认设定 | 已保存事实来自后端持久化 read model，不是前端临时文案 | AU05-I6 | `AdoptionWorkflow`、archive/memory read model | `adoption_workflow_test.exs`、AU-09 memory tests | `au09-adopt-setting-recall`：伏笔/规则 artifact 采纳后进入 governed memory、档案 tab 可见、后续 recall/why 可见；`p1-chapter-adoption-reading` 证明正文进入 reading read model | 已验收 | 完整角色/组织/关系矩阵归 AU-09 | Cross-reference | P1 | AU-09 story memory |
| SC-AU05-D2 采纳后阅读投影提示 stale / refresh | accepted source 改变后投影状态可刷新，UI 不自行写状态 | AU05-I7 | `ReadingProjectionRepo`、`ReadingMode`、projection refs | `readingProjection.test.ts`、reading repo tests | `p1-chapter-adoption-reading` / `p1-chapter-edit-then-accept` 证明采纳后可读；尚未证明 STALE -> refresh job 状态机 | 部分实现 | 当前真实证据覆盖 materialized read model，不覆盖完整 stale/rebuild/failed 状态机 | Projection state machine | P1 | AU-08 reading mode |
| SC-AU05-D3 未采纳草稿不进入阅读模式 | pending/discarded 内容不进入 TOC/正文 | AU05-I2/I7 | `ReadingProjectionRepo`、`AdoptionWorkflow` | reading repo tests、`native-tauri-verifier.test.mjs` | `au05-discard-author-action`、`au02-unadopted-candidate-no-reading-fact` | 已验收 | 无 | 保持回归 | P2 | AU-08 keep regression |
| SC-AU05-E1 采纳可回放 | 作者/开发者可回看来源、动作、decision、trace | AU05-I6/I9 | `DecisionTrace`、receipt、app JSONL、why/replay | `action_roundtrip_test.exs`、receipt tests | 当前 Tauri summary / ui-frames / app JSONL 可定位 action 和 decision；尚无完整 replay UI 聚合 | 部分实现 | 机器 artifact 可审计，但产品 replay 页面与 StateTrace 聚合未完成 | Replay / StateTrace | P1 | AU-07 trace-and-replay |
| SC-AU05-E2 AI 不谎报采纳状态 | pending/rejected/failed/adopted 的文案和 truthfulness 与裁决一致 | AU05-I9 | `TurnResult.truthfulness`、`assistant_message`、UI card copy | `tool_provenance_test.exs`、`workspace_channel_v3_test.exs` | `au05-adoption-safety-freshness`、`au05-stale-*`、`au05-conflict-*`、`au05-canon-*`、`p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept` 均断言 no-write / adopted / edited accepted 对应关系 | 已验收 | 更细的 LLM timeout/retry truthfulness 归 AU-04/AU-10 | Cross-reference | P2 | keep regression |
| SC-AU05-E3 采纳失败有恢复路径 | 失败原因可见，状态为 reject / fail_with_recovery，不写事实 | AU05-I8/I9 | `AdoptionBoundary`、`WorkspaceChannel.action_result`、result card | `adoption_boundary_test.exs`、`workspace_channel_v3_test.exs` | `au05-stale-conflict-cross-work-freshness`、`au05-conflict-cross-work-recovery`、`au05-canon-conflict-recovery` | 已验收 | 当前恢复卡只给失败/重选路径，未含完整人工合并编辑器 | UX 深化 | P2 | AU-10 / AU-09 follow-up |

---

## 5. 文件级 review

### 5.1 已确认“已验收”的主证据

| 证据 | 证明什么 |
|---|---|
| `artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json` | 明确候选采纳走授权 `author_action.choose_candidate`，进入 adoption boundary，不由前端写事实 |
| `artifacts/slice-verify/au02-unadopted-candidate-no-reading-fact-tauri/summary.json` | 未采纳候选不进入阅读模式或作品事实 |
| `artifacts/slice-verify/au05-adoption-safety-freshness-tauri/summary.json` | 高风险候选返回 confirmation/no-write |
| `artifacts/slice-verify/au05-stale-conflict-cross-work-freshness-tauri/summary.json` | stale restored candidate 返回 reject/no-write |
| `artifacts/slice-verify/au05-conflict-cross-work-recovery-tauri/summary.json` | cross-work candidate 返回 fail_with_recovery/no-write |
| `artifacts/slice-verify/au05-canon-conflict-recovery-tauri/summary.json` | 结构化 canon conflict 返回 fail_with_recovery/no-write |
| `artifacts/slice-verify/au05-discard-author-action-tauri/summary.json` | `discard` 通过真实按钮触发，resolved=DISCARDED，阅读投影为空 |
| `artifacts/slice-verify/p1-chapter-adoption-reading-tauri/summary.json` | `accept` 通过真实按钮触发，正文进入 reading projection，字数与内容一致 |
| `artifacts/slice-verify/p1-chapter-edit-then-accept-tauri/summary.json` | `edit_then_accept` 带作者编辑内容，保存后阅读模式显示编辑后正文 |
| `artifacts/slice-verify/au09-adopt-setting-recall-tauri/summary.json` | 设定类 artifact 采纳后进入作品档案/记忆 read model 并可召回 |

### 5.2 已发现的实现 / 文档偏差

| 偏差 | 判定 | 处置 |
|---|---|---|
| 旧文档认为 `WorkspaceChannel` 缺 `adopt` / `discard` / `modify_draft` handler | 文档过期，不是代码缺口 | 改为当前 `author_action.accept/discard/edit_then_accept` 主链口径 |
| 旧验收 driver 等待旧文案“采用这个方向 / 候选方向采用失败 / 修改后采纳” | 验收 harness 跟产品 copy 漂移 | driver 改为兼容当前 copy：`设为后续方向`、`后续方向设置失败`、`修改后保存正文` |
| 三个 AU-05 seed 缺当前 `AvailableAction.target_ref/source_turn_ref` 字段 | 验收 seed 跟 action contract 漂移 | seed 补齐当前生产 action builder 字段形态；不改生产 runtime |
| `state_trace_ref` / `adopted_state_ref` 不是完整持久 StateTrace | 真实剩余能力缺口 | 登记为 P1 owner：AU-07/StateTrace follow-up |
| 采纳后 ProjectionHint stale/refresh 状态机未完整验收 | 真实剩余能力缺口 | 登记为 P1 owner：AU-08 |

### 5.3 缺口分级

| 缺口 | 当前判断 | 优先级 | Owner / 恢复路径 |
|---|---|---|---|
| AU05-GAP-01 真实采纳入口未接后端 | 已关闭：真实入口为 `author_action.accept/discard/edit_then_accept`，不是旧 direct `adopt` event | closed | keep regression |
| AU05-GAP-02 AdoptionBoundary 未进入主流程 | 已关闭：候选经 `DialogueGateway -> AdoptionBoundary`，artifact 经 `AdoptionWorkflow` | closed | keep regression |
| AU05-GAP-03 StateTrace / adopted_state_ref 未真实写入 | 未完整闭环，但不阻断当前文件进入 AU-06 | P1 | AU-07 / StateTrace 持久化 |
| AU05-GAP-04 pending adoption 持久化待处理箱 | 部分实现：transcript/runtime 可见，独立 workbox 缺 | P1 | AU-06 / AU-10 action matrix |
| AU05-GAP-05 selection/action/adoption 桥接 | 已关闭 | closed | `au02-candidate-adoption-bridge` |
| AU05-GAP-06 freshness / conflict / cross-work | 当前安全矩阵已验收；完整 context version/revision/canon store 自动计算仍缺 | P1 | State snapshot / AU-09 |
| AU05-GAP-07 高风险采纳 confirmation lifecycle | no-write confirmation 已验收；完整 behavior lifecycle 归 AU-06 | P1 | AU-06 |
| AU05-GAP-08 ProjectionHint -> ReadingMode stale/refresh | 采纳后可读已验收；完整 stale/rebuild 状态机未闭环 | P1 | AU-08 |
| AU05-GAP-09 修改/放弃链路 | 已关闭 | closed | `p1-chapter-edit-then-accept`、`au05-discard-author-action` |
| AU05-GAP-10 adoption truthfulness | 主链 truthfulness 已由真实验收覆盖；更细 timeout/retry 归 AU-10 | P2 | AU-10 |
| AU05-GAP-11 作品档案/阅读模式 mock handler | 章节阅读和设定 recall 已接真实 read model；完整 archive 矩阵归 AU-09 | P1 | AU-09 |

**P0 结论**：AU-05 当前文件内没有剩余 P0。剩余 P1 均有明确 owner 和可复跑证据恢复路径。

---

## 6. 验收命令

本轮文件级收口使用的真实页面外部自动化：

```bash
bash scripts/quality_accept.sh au05-adoption-safety-freshness --surface tauri
bash scripts/quality_accept.sh au05-stale-conflict-cross-work-freshness --surface tauri
bash scripts/quality_accept.sh au05-conflict-cross-work-recovery --surface tauri
bash scripts/quality_accept.sh au05-canon-conflict-recovery --surface tauri
bash scripts/quality_accept.sh au02-candidate-adoption-bridge --surface tauri
bash scripts/quality_accept.sh au02-unadopted-candidate-no-reading-fact --surface tauri
bash scripts/quality_accept.sh au05-discard-author-action --surface tauri
bash scripts/tauri_slice_verify.sh p1-chapter-adoption-reading
bash scripts/tauri_slice_verify.sh p1-chapter-edit-then-accept
bash scripts/tauri_slice_verify.sh au09-adopt-setting-recall
```

局部验证与质量入口：

```bash
pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs
bash scripts/quality_manifest_check.sh
bash scripts/ai_static_scan.sh --top 10
```

涉及 TurnResult / artifact / adoption / 主链时，后续若修改 production runtime 仍必须按 `docs/engineering/scenario-invariants.md` 运行 I1/I2/I3。

---

## 7. 文件级退出判断

| 退出项 | 判断 |
|---|---|
| 所有场景有可信对账矩阵 | 满足，见 §4 |
| 所有 P0 缺口关闭或登记 blocker | 满足，当前无剩余 P0 |
| P1 有后续 checkpoint / owner / 恢复路径 | 满足，见 §5.3 |
| 已实现场景有局部测试证据 | 满足，见 §4/§6 |
| 承重主链有外部自动化真实页面证据 | 满足，见 §5.1/§6 |
| 文档、蓝图、README、ledger、tasks/slices、quality manifest 同步 | 本文件收口同步 |
| task_done 与 ai_static_scan | 已运行；`task_done_check` 通过，`task_done.sh` / `ai_static_scan.sh --top 10` 仅因既有 gitleaks accepted_risk 返回非零，0 touched-file finding |

**文件级结论：AU-05 可进入下一个验收文件 AU-06。**
