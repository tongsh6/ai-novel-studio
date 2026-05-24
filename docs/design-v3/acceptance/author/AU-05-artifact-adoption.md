# AU-05 采纳创作产物

> 作者视角：AI 生成的角色设定、剧情方向、大纲、章节片段默认都是草稿或候选，不能自动成为作品事实。只有我明确采纳，并且系统通过 adoption boundary 后，它们才进入作品档案、阅读投影或后续上下文。

> 2026-05-13 场景化对账结论：创作产物默认 tentative、AdoptionBoundary 纯规则、前端待采纳展示都有局部证据；但真实工作台采纳入口未接入当前后端 Channel，`AdoptionBoundary.evaluate/3` 未接到 `author_action` / `adopt` 主流程，StateTrace / production write / projection refresh 仍未闭环。因此 AU-05 不能再按“100% 已实现”判断。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 让 AI 生成角色、组织、剧情方向、大纲或正文片段 | 以待采纳草稿或候选卡展示，不自动写入作品事实 |
| 浏览多个草稿 | 能看标题、摘要、内容、来源和适用范围 |
| 点选某个候选继续讨论 | 只表示 selection，不等于 adoption |
| 明确采纳某个草稿 | 系统评估 freshness、目标、冲突、权限、确认策略和 trace readiness |
| 修改后再采纳 | 系统保留原草稿来源，写入修改后的 accepted 版本 |
| 放弃草稿 | 草稿进入 discarded/resolved，不影响作品事实 |
| 切到阅读模式 | 只能看到已采纳内容；未采纳草稿不进入目录或正文 |
| 采纳后阅读投影过期 | 系统提示投影 stale / refresh，而不是让 UI 自己写状态 |

明确不能做的：

- 工具执行成功不等于采纳成功。
- 候选卡被点选不等于作品设定已更新。
- `adoption_state.pending` 里的内容不能出现在阅读模式正文或作品 canon。
- 前端不能通过 `adopt` 事件直接写作品事实，必须走后端 adoption boundary。
- 过期、跨作品、冲突或高风险草稿不能静默采纳。

---

## 2. 不变量

| 编号 | 不变量 | 本验收如何验证 |
|---|---|---|
| AU05-I1 | AI 产物默认 tentative，不是 production fact | SC-AU05-A1/A2 |
| AU05-I2 | ToolResult 不等于 adopted state | SC-AU05-A2/D3 |
| AU05-I3 | candidate selection 不等于 adoption | SC-AU05-B1 |
| AU05-I4 | adoption 只能由系统边界裁决 | SC-AU05-C1/C2/C3 |
| AU05-I5 | 高风险/覆盖/production adoption 必须确认并重新 gate | SC-AU05-C4 |
| AU05-I6 | production write 必须有 StateTrace / DecisionTrace | SC-AU05-D1/E1 |
| AU05-I7 | ProjectionHint 只触发刷新，不授权 UI 写入 | SC-AU05-D2 |
| AU05-I8 | stale / conflict / cross-work adoption 不得写入 | SC-AU05-C3/C4/C5 |
| AU05-I9 | TurnResult 文案不得把 pending 说成 adopted | SC-AU05-E2 |

---

## 3. 契约引用

| 契约 / 代码 | 用途 |
|---|---|
| `docs/design-v3/contracts/VS-04-adoption-boundary-contract-pack.md` | CandidateSet、AuthorActionInput choose_candidate、AdoptionDecision、ProjectionHint 规则 |
| `docs/design-v3/adr/ADR-0010-state-adoption-boundary-v3.md` | selection / ToolResult / adopted state 分层决策 |
| `docs/design-v3/adr/ADR-0016-projection-hint-v3.md` | ProjectionHint 与阅读投影刷新边界 |
| `apps/novel_application/lib/novel_application/adoption_boundary.ex` | 当前采纳评估纯规则 |
| `apps/novel_application/lib/novel_application/turn_result_builder.ex` | creative ToolResult -> `adoption_state.pending` 与 `adoption_card` |
| `apps/novel_application/test/novel_application/adoption_boundary_test.exs` | 低风险/高风险/未知候选/stability/projection hint 局部测试 |
| `apps/novel_application/test/novel_application/creative_artifact_test.exs` | creative tool、TentativeArtifactSet、task_state 局部测试 |
| `frontend/src/components/WorkspaceChat.tsx` | 当前真实工作台展示 pending adoption 与调用采纳动作 |
| `frontend/src/components/StructurePanel.tsx` | 作品档案面板展示待采纳内容 |
| `frontend/src/components/ReadingMode.tsx` | 阅读模式读取 projection status 并触发刷新请求 |
| `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | 当前 Channel 缺 `adopt` / `discard` / `modify_draft` handler 的关键证据 |

---

## 4. 验收场景

### 场景组 A：AI 产物默认只是草稿

#### SC-AU05-A1 — 生成角色设定后显示为待采纳

**用户视角**：作者说“帮我生成三个主角设定方向”。

| 字段 | 内容 |
|---|---|
| 前置条件 | 已打开某个作品；模型或 stub 可用 |
| 触发 | 输入创作产物请求 |
| 期望结果 | 工作台出现待采纳草稿卡；草稿有标题、正文/摘要、来源；不进入已确认设定 |
| 当前证据 | `creative_artifact_test.exs` 覆盖 `TentativeArtifactSet`、`adoption_status: :tentative`；`TurnResultBuilder.maybe_add_artifacts/2` 生成 `adoption_state.pending` 和 `adoption_card` |
| 当前状态 | 已测试/部分实现 |
| 当前缺口 | 未有真实工作台 walkthrough 证明卡片在 `WorkspaceChat` 中完整可见、可审核 |
| 优先级 | P0 |

#### SC-AU05-A2 — 工具成功不自动写作品事实

**用户视角**：AI 成功生成章节片段，作者还没采纳。

| 字段 | 内容 |
|---|---|
| 期望结果 | `truthfulness.production_write_performed=false`；阅读模式目录/正文不显示该片段 |
| 当前证据 | `creative_generation` capability `write_scopes == []`；`creative_artifact_test.exs` 覆盖 creative tool 无 write scope；E2E 覆盖 pending artifact |
| 当前状态 | 后端局部已测试 |
| 当前缺口 | 阅读模式当前数据来自 `get_toc` / `get_chapter_content` mock handler，未和 adoption state 真实隔离验收 |
| 优先级 | P0 |

#### SC-AU05-A3 — 草稿在作品档案有待处理入口

**用户视角**：作者打开作品档案，能看到所有待采纳草稿。

| 字段 | 内容 |
|---|---|
| 期望结果 | 作品档案显示待采纳数量和待采纳列表；可进入审核动作 |
| 当前证据 | `WorkspaceChat` 汇总 `adoption_state.pending`；`StructurePanel` 展示 `pendingAdoptions` 并显示“采纳设定” |
| 当前状态 | 前端部分实现 |
| 当前缺口 | 缺后端真实采纳 handler 和端到端 UI 验收；当前列表只来自本次前端消息内存，不是持久化待处理箱 |
| 优先级 | P0 |

### 场景组 B：选择、修改、放弃与采纳分开

#### SC-AU05-B1 — 点选候选只是继续探索，不是采纳

**用户视角**：作者在候选方向卡里点了一个方向，想沿着它继续聊。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统记录 selection intent 或继续对话；不产生 adopted state，不刷新阅读投影 |
| 当前证据 | `ADR-0010` 明确 selection != adoption；`adoption_boundary_test.exs` 覆盖高风险 selection 不 adopted；`artifacts/slice-verify/au02-candidate-continuation-tauri/summary.json` 和 `artifacts/slice-verify/au02-candidate-adoption-bridge-tauri/summary.json` 证明真实工作台先继续探索、再明确采纳 |
| 当前状态 | 最小真实前后端闭环已完成 |
| 当前缺口 | 高风险、stale、conflict、cross-work 采纳安全仍待 AU05 safety/freshness 加固 |
| 优先级 | P0 |

#### SC-AU05-B2 — 点击“采纳”必须走后端 adoption boundary

**用户视角**：作者点击某个草稿卡的“采纳”。

| 字段 | 内容 |
|---|---|
| 期望结果 | 前端提交可验证的 author action / adoption action；后端执行 target、source、freshness、conflict、trace gate |
| 当前证据 | `WorkspaceChat.handleAdopt/1` 调用 `socket.adopt`；`socket.test.ts` 只验证会 push `adopt` 事件 |
| 当前状态 | 前端 helper 已有，后端入口未接 |
| 当前缺口 | `WorkspaceChannel` 没有 `handle_in("adopt")`；`AdoptionBoundary.evaluate/3` 没有被 Channel/DialogueGateway 调用 |
| 优先级 | P0 |

#### SC-AU05-B3 — 修改后再采纳

**用户视角**：作者觉得草稿方向对，但要求“把主角性格改得更果断”后再采纳。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统生成 edited draft，保留原草稿来源和 revision_base，再进入 adoption boundary |
| 当前证据 | `WorkspaceChat` 有修改弹窗；`socket.modifyDraft` helper 会 push `modify_draft` |
| 当前状态 | 前端壳存在 |
| 当前缺口 | `WorkspaceChannel` 没有 `handle_in("modify_draft")`；缺 edited adoption 状态和 revision 测试 |
| 优先级 | P1 |

#### SC-AU05-B4 — 放弃草稿

**用户视角**：作者对草稿不满意，点击放弃。

| 字段 | 内容 |
|---|---|
| 期望结果 | 草稿进入 discarded/resolved，不再出现在待采纳列表；不影响作品事实 |
| 当前证据 | `socket.discardArtifact` helper 存在；domain/persistence 层有 draft discard 相关测试 |
| 当前状态 | 局部实现 |
| 当前缺口 | `WorkspaceChannel` 没有 `handle_in("discard")`；`TurnResult.adoption_state.resolved` 没有真实更新链路 |
| 优先级 | P1 |

### 场景组 C：采纳边界安全

#### SC-AU05-C1 — 低风险草稿可采纳，但必须留下 decision

**用户视角**：作者采纳低风险角色设定。

| 字段 | 内容 |
|---|---|
| 期望结果 | 后端返回 `AdoptionDecision.adopt_tentative` 或等价 accepted 结果；包含 reason_codes、decision_trace_ref、state_trace_ref |
| 当前证据 | `adoption_boundary_test.exs` 覆盖 low-risk candidate -> `:adopt_tentative`；`AdoptionBoundary` 构造 `state_trace_ref` 字符串 |
| 当前状态 | 纯规则已测试 |
| 当前缺口 | `state_trace_ref` / `adopted_state_ref` 仍是字符串模式，不是真实 DB/trace 记录 |
| 优先级 | P0 |

#### SC-AU05-C2 — 高风险采纳要求二次确认

**用户视角**：作者采纳一个会大幅改世界观的方案。

| 字段 | 内容 |
|---|---|
| 期望结果 | adoption boundary 返回 `require_confirmation`，并接入 AU-04 确认 lifecycle |
| 当前证据 | `artifacts/slice-verify/au05-adoption-safety-freshness-tauri/summary.json` 证明真实 Tauri 工作台输入高风险候选并点击“采用这个方向”后，服务端授权 `choose_candidate` 进入 `AdoptionBoundary`，返回 `require_confirmation` / `needs_confirmation`，UI 显示“候选方向待确认”，`candidate_adopted=false` 且 `production_write_performed=false`；`action_roundtrip_test.exs` / `workspace_channel_v3_test.exs` 覆盖回归 |
| 当前状态 | 高风险不能静默采纳的 checkpoint 已闭环 |
| 当前缺口 | 完整 AU-04 `ConfirmationBinding` / re-gate 主流程仍未接入；后续需要把 confirmation 后的继续处理做成真实工作台闭环 |
| 优先级 | P0 |

#### SC-AU05-C3 — stale 草稿不能采纳

**用户视角**：作者几天后点了旧草稿采纳，这期间作品背景已经变化。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统识别 stale source/action/state snapshot，要求重新生成或重新确认 |
| 当前证据 | `adoption_boundary_test.exs` 只覆盖 unknown candidate_id -> fail_with_recovery |
| 当前状态 | 局部测试，不是真 freshness |
| 当前缺口 | 未实现 source turn / state snapshot / context version freshness check |
| 优先级 | P0 |

#### SC-AU05-C4 — 冲突采纳进入恢复或修订

**用户视角**：作者采纳的新设定和已有 canon 冲突，例如角色年龄不一致。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统提示冲突，允许修订、覆盖确认或放弃；不能静默覆盖 |
| 当前证据 | VS-04 contract 要求 conflict check |
| 当前状态 | 未实现/未验收 |
| 当前缺口 | `AdoptionBoundary.evaluate/3` 未检查目标当前 canon 或 revision |
| 优先级 | P1 |

#### SC-AU05-C5 — 跨作品草稿不能采纳到当前作品

**用户视角**：作者切换作品后，尝试采纳上一个作品里的草稿。

| 字段 | 内容 |
|---|---|
| 期望结果 | 系统拒绝跨 work adoption；草稿、state trace、projection 都归属原作品 |
| 当前证据 | SU-02/AU-03 已记录 work_id 隔离仍未完整验收 |
| 当前状态 | 未实现/未验收 |
| 当前缺口 | pending adoption 只存在前端消息内存；缺 work-scoped adoption store 和 cross-work 验收 |
| 优先级 | P0 |

### 场景组 D：采纳后的作品事实与阅读投影

#### SC-AU05-D1 — 采纳后作品档案出现已确认设定

**用户视角**：作者采纳角色设定后，打开作品档案能看到该角色/设定从待采纳移到已确认。

| 字段 | 内容 |
|---|---|
| 期望结果 | 已确认设定来自后端持久化事实，不是前端临时文案 |
| 当前证据 | `StructurePanel` 有“已确认设定”区域，但数据来自 `get_foreshadowing` / `get_characters` mock handler |
| 当前状态 | UI 壳存在，真实数据未接 |
| 当前缺口 | 缺 adopted state repository、StateTrace、档案查询闭环 |
| 优先级 | P0 |

#### SC-AU05-D2 — 采纳后阅读投影提示 stale / refresh

**用户视角**：作者采纳章节片段或设定后，切到阅读模式看到投影过期提示，并可刷新。

| 字段 | 内容 |
|---|---|
| 期望结果 | 后端 TurnResult 带 `projection_refs.refresh_status=STALE` 或等价 ProjectionHint；ReadingMode 显示刷新入口 |
| 当前证据 | `ReadingMode` 能展示 `projectionStatus === "STALE"`；`WorkspaceChat` 会读取 `projection_refs` 更新 store；`AdoptionBoundary` 会返回 `projection_hints` |
| 当前状态 | 两端局部存在，未集成 |
| 当前缺口 | `TurnResultBuilder` 未把 adoption projection_hints 转成 `projection_refs`；`AdoptionBoundary` projection_ref 仍硬编码 `"character_list"` |
| 优先级 | P1 |

#### SC-AU05-D3 — 未采纳草稿不进入阅读模式

**用户视角**：作者生成章节片段但不采纳，切到阅读模式。

| 字段 | 内容 |
|---|---|
| 期望结果 | 阅读模式明确显示“暂无已采纳内容”或旧版本，不显示 pending 草稿 |
| 当前证据 | `ReadingMode` 有空态文案；creative tool 无 write scope |
| 当前状态 | 局部实现 |
| 当前缺口 | `get_toc` / `get_chapter_content` 当前是 mock handler，未基于 accepted source revisions 验证 |
| 优先级 | P1 |

### 场景组 E：追溯、真值与恢复

#### SC-AU05-E1 — 采纳可回放

**用户视角**：作者或开发者能回看“这个设定为什么进入作品、来自哪个草稿、谁点了采纳、当时是否有冲突”。

| 字段 | 内容 |
|---|---|
| 期望结果 | DecisionTrace + StateTrace + source refs 可回放 |
| 当前证据 | VS-04 contract 要求 StateTrace / DecisionTrace；`AdoptionBoundary` 生成字符串 ref |
| 当前状态 | 未闭环 |
| 当前缺口 | 缺真实 StateTrace 写入、ReplayService adoption 解释、前端 trace 入口 |
| 优先级 | P1 |

#### SC-AU05-E2 — AI 不谎报采纳状态

**用户视角**：系统说“已采纳”时，这件事必须真的发生；只是 pending 时不能说已写入作品。

| 字段 | 内容 |
|---|---|
| 期望结果 | `truthfulness.artifact_adopted` 和 assistant_message 与真实 adoption decision 一致 |
| 当前证据 | `TurnResultBuilder.build_truthfulness/3` 默认 tool result `artifact_adopted=false`；`tool_provenance_test.exs` 覆盖 ToolResult not adoption |
| 当前状态 | 局部已测试 |
| 当前缺口 | 缺 adoption 成功/失败后的 TurnResult truthfulness 与 LLM 文案测试 |
| 优先级 | P1 |

#### SC-AU05-E3 — 采纳失败有恢复路径

**用户视角**：采纳失败时，作者知道是过期、冲突、权限、目标不清还是系统错误，并知道下一步能做什么。

| 字段 | 内容 |
|---|---|
| 期望结果 | 返回可理解失败原因和 retry / revise / regenerate / cancel 动作 |
| 当前证据 | `AdoptionBoundary` unknown candidate 返回 `fail_with_recovery` reason_codes |
| 当前状态 | 局部规则存在 |
| 当前缺口 | 缺 Channel/TurnResult/UI 恢复卡与真实 walkthrough |
| 优先级 | P1 |

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 当前状态 | 是否闭环 |
|---|---|---|---|
| SC-AU05-A1 | 生成待采纳草稿卡 | 已测试/部分实现 | 否，缺真实工作台验收 |
| SC-AU05-A2 | 工具成功不写作品事实 | 已测试 | 否，缺阅读模式隔离验收 |
| SC-AU05-A3 | 作品档案待采纳入口 | 部分实现 | 否 |
| SC-AU05-B1 | selection 不等于 adoption | 已测试 | 否，UI selection 未实现 |
| SC-AU05-B2 | 点击采纳走后端边界 | 未接入 | 否 |
| SC-AU05-B3 | 修改后再采纳 | 前端壳存在 | 否 |
| SC-AU05-B4 | 放弃草稿 | 局部实现 | 否 |
| SC-AU05-C1 | 低风险采纳有 decision/trace | 已测试 | 否，trace 是字符串 ref |
| SC-AU05-C2 | 高风险采纳要求确认 | checkpoint closed | 是，高风险候选不能静默采纳；完整 AU-04 re-gate lifecycle 仍未闭环 |
| SC-AU05-C3 | stale 草稿拒绝 | 部分测试 | 否 |
| SC-AU05-C4 | 冲突采纳恢复 | 已设计 | 否 |
| SC-AU05-C5 | 跨作品采纳隔离 | 未实现/未验收 | 否 |
| SC-AU05-D1 | 采纳后作品档案更新 | UI 壳存在 | 否 |
| SC-AU05-D2 | 采纳后阅读投影刷新 | 部分实现 | 否 |
| SC-AU05-D3 | 未采纳不进阅读模式 | 局部实现 | 否 |
| SC-AU05-E1 | 采纳可回放 | 已设计/部分 ref | 否 |
| SC-AU05-E2 | AI 不谎报采纳 | 局部已测试 | 否 |
| SC-AU05-E3 | 采纳失败恢复 | 局部规则存在 | 否 |

**结论：18 个场景；已有草稿采纳/放弃/修改、候选继续探索、候选授权采纳和高风险候选 confirmation checkpoint 等真实 Tauri 前后端闭环；关键剩余缺口集中在 StateTrace、持久化作品事实、阅读投影刷新状态机，以及 stale、conflict、cross-work 采纳安全。**

---

## 6. 缺口

| 缺口 | 具体表现 | 类型 | 优先级 |
|---|---|---|---|
| AU05-GAP-01 — 真实采纳入口未接后端 | `WorkspaceChat` push `adopt`，但 `WorkspaceChannel` 无 `handle_in("adopt")` | 补集成/补实现 | P0 |
| AU05-GAP-02 — AdoptionBoundary 未进入主流程 | `AdoptionBoundary.evaluate/3` 只有纯规则测试，未被 Channel/DialogueGateway/author_action 调用 | 补集成 | P0 |
| AU05-GAP-03 — StateTrace / adopted_state_ref 未真实写入 | 当前是字符串 ref，不是持久化 state trace 或作品事实 | 补实现/补验收 | P0 |
| AU05-GAP-04 — pending adoption 不是持久化待处理箱 | `WorkspaceChat` 从消息内存聚合 pending，切作品/重启/历史会话后不可恢复 | 补实现/补集成 | P0 |
| AU05-GAP-05 — selection/action/adoption 桥接缺失 | 已闭环：候选卡展示、选择继续探索、授权 `choose_candidate` 采纳边界有完整 Tauri 证据 | 已完成 | closed |
| AU05-GAP-06 — freshness / conflict / cross-work 检查不足 | stale 测试只是 unknown id；cross-work rejection 已有 application 回归但缺真实 UI 验收；缺 context version、revision、conflict recovery | 补实现/补测试/补验收 | P0 |
| AU05-GAP-07 — 高风险采纳未接 confirmation lifecycle | 高风险 rule 已经通过真实 Tauri 工作台返回 `require_confirmation` / `needs_confirmation` 且不写 production fact；完整 AU-04 re-gate 仍未接 | checkpoint closed / 后续补 confirmation lifecycle | P0 |
| AU05-GAP-08 — ProjectionHint 未接 ReadingMode | `projection_hints` 未转 `projection_refs`，projection_ref 硬编码 | 补集成/修正 | P1 |
| AU05-GAP-09 — 修改/放弃链路缺后端 | `modify_draft` / `discard` 前端 helper 有，Channel handler 缺失 | 补实现 | P1 |
| AU05-GAP-10 — adoption truthfulness 缺成功/失败文案测试 | 只验证 ToolResult not adoption，缺 adopted/rejected 后文案约束 | 补测试 | P1 |
| AU05-GAP-11 — 作品档案/阅读模式仍有 mock handler | `get_toc`、`get_characters` 等返回 mock，不代表采纳后真实作品可见 | 补集成/补验收 | P1 |

---

## 7. 已知基础设施

| 基础设施 | 当前价值 | 不应误判 |
|---|---|---|
| `creative_generation` + `TentativeArtifactSet` | 能证明 AI 产物默认 tentative | 不等于可采纳进作品 |
| `TurnResultBuilder.maybe_add_artifacts/2` | 能输出 `adoption_state.pending` 和 `adoption_card` | 不等于点击采纳会成功 |
| `AdoptionBoundary.evaluate/3` | 能表达低风险采纳、高风险确认、未知候选恢复 | 不等于已写入作品事实 |
| `WorkspaceChat.handleAdopt/1` | 前端有采纳按钮和 helper | 后端没有对应 `adopt` handler |
| `StructurePanel` | 能展示待采纳列表 | 列表来自当前消息内存，不是持久化工作箱 |
| `ReadingMode` projection banner | 能显示 stale/rebuilding/failed 状态 | 缺 adoption -> projection_refs -> banner 的后端链路 |

---

## 8. 验收命令

这些命令只能证明局部规则和产物生成，不能证明 AU-05 完整通过：

```bash
mix test apps/novel_application/test/novel_application/adoption_boundary_test.exs
mix test apps/novel_application/test/novel_application/creative_artifact_test.exs
cd frontend && pnpm test -- src/lib/__tests__/socket.test.ts src/lib/__tests__/schemas.test.ts
```

完整 AU-05 验收还需要补充：

```text
1. 真实工作台：生成草稿 -> 待采纳卡可见 -> 点击采纳 -> 后端 AdoptionBoundary -> action_result/turn_result。
2. 采纳后作品档案：pending 移除，已确认设定/角色/章节出现，且来自持久化事实。
3. 采纳到阅读投影：accepted source 改变 -> projection_refs STALE -> ReadingMode 提示刷新 -> 刷新后可读。
4. stale/conflict/cross-work：旧草稿、冲突草稿、跨作品草稿不能写入当前作品。
5. modify/discard：修改后采纳和放弃都有 resolved adoption state 与 trace。
6. replay/truthfulness：回放能解释来源、作者动作、decision、state trace 和 projection hint。
```
