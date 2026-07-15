# 对话流诊断与决策面收口梳理（探索）

> 状态：讨论备忘（不冻结 schema、不授权实现）。结论需升级为 contract 修订（`07-workbench-ui-contract.md` §4 / `VS-05` §4）+ ADR 后方可实现。
>
> 来源：2026-07-15 对话流体验诊断（作者主诉「对话流不流畅」）；对契约文档、后端产出、前端消费的全链路代码走读。
>
> 上游/关联：ADR-0022（Proposed）、`notes/2026-07-04-agentic-loop-plan-driven-execution.md`（调用经济学，ADR-0023 输入）、`notes/2026-07-01-agentic-loop-reasoning-stream-ui.md`（推理流 UI）、`docs/design/07-workbench-ui-contract.md` §4、`docs/design/contracts/VS-05-ui-roundtrip-contract-pack.md` §4。

---

## 1. 诊断结论

对话流「不丝滑」是四类问题叠加，不是单一 bug：

| # | 问题类别 | 一句话 |
|---|---|---|
| 1 | 卡片契约三方失联 | 契约 10 种 card_type、后端产出 3 种、前端消费 9 种，真正贯通的只有 `candidate_set` |
| 2 | 延迟结构 | 一轮对话串行多次模型调用（实测 conversation=7 次/轮、40-65 秒，见 2026-07-04 note），最终内容不流式 |
| 3 | 前端渲染粒度 | 8 字符/事件的推理 delta 驱动 3800 行无 memo 单体组件全量重渲染 |
| 4 | 状态死角 | awaiting_author 无 TurnResult 落地；clarification 无显式决策面；运行组完成瞬间锚定跳变 |

## 2. 卡片契约三方失联：事实清单

后端 card_type 产出点全集（仅 3 处）：

- `candidate_set` — `apps/novel_application/lib/novel_application/turn_result_builder.ex:188`（契约内 ✅）
- `confirmation_card` — `turn_result_builder.ex:397`（契约名为 `confirmation_request` ❌）
- `result_card` — `apps/novel_application/lib/novel_application/dialogue_gateway.ex:932`（契约中不存在 ❌）

前端分发 switch（`frontend/src/components/WorkspaceChat.tsx:3406-3427`）认 9 种：`clarification_card` / `confirmation_card` / `warning_card` / `candidate_set` / `progress_card` / `checkpoint_card` / `result_card` / `failure_card` / `escalation_card`，其中 6 种后端从不产出（死代码），未知类型静默降级为 `DefaultCard`（title/body 灰卡）。

契约（07 §4 十种 / VS-05 §4 七种最小集）中的 `clarification_prompt`、`recovery_prompt`、`trace_summary`、`projection_notice`、`capability_notice`、`selection_prompt`、`revision_target_prompt`、`cancellation_summary` 后端从未产出。

schema 治理缺口：

- 后端发 `schema_version: "3.0-draft"`，codegen SSOT 仍是 v2（semver 正则连 "3.0-draft" 都不接受）。
- SSOT schema 中 `ui_cards` 是 `z.array(z.any())`，卡片形状不受任何机器闸门保护。
- 前端手写 `TurnResult` interface（`WorkspaceChat.tsx:149`），`lib/schemas.ts` 的 codegen schema 无运行时消费者，channel payload 无 `safeParse`。违反 tech-stack 强制表「Zod 4 + codegen，禁止手写 type」。2026-05-09 走查「candidate cards 不渲染」P1 的结构性根因即此——当时修实例，未修机制。

## 3. 关键洞察：决策面已经迁出 ui_cards

契约（07 §4）设想一切经 ui_cards 呈现；但 UA-01 CP5 之后的真实产品里，assistant 回合解剖为 8 层，作者决策面实际由**四条并行通道**驱动：

| 决策时刻 | 驱动字段 | 渲染器 | 动作通道 | 契约地位 |
|---|---|---|---|---|
| 选择候选方向 | `candidate_directions` | WorkspaceCandidatePanel | `choose_candidate` + continue | 字段在 ADR-0018 系，卡片契约未覆盖 |
| 采纳/弃用/改后采纳草稿 | `adoption_state` + `candidate_set` 卡 | CandidateSetCard + 动作按钮 | `accept` / `discard` / `edit_then_accept` | 三方一致（唯一贯通决策面，I1 绑定保护） |
| 确认高风险执行 | `behavior_state` + `confirmation_card` 卡 | ConfirmationCard + 动作按钮 | `confirm_before_execute` / `reject_or_cancel_confirmation` | 卡片名偏离契约 |
| 回答澄清 | `behavior_state`（status=needs_clarification） | **无显式 UI**，隐式「下一条消息即回答」（`WorkspaceChat.tsx:1102`） | `answer_clarification`（后端有、前端不渲染入口） | 契约有 `clarification_prompt`，实现缺位 |
| 质量发现重写 | `quality_review` | QualityReviewCard | `revise_from_findings` | 字段驱动，卡片契约未覆盖（VS-00E 系） |
| 运行中控制 | `agent_run_state` + agent 事件流 | AgentRunDialogueFlow | pause / resume / cancel / steer | ADR-0021/0022 系，卡片契约未覆盖 |
| awaiting_author 恢复 | 仅 agent 事件（`agent_run_server.ex:302,577`） | 运行组芯片变「等待作者」 | **无**（不产出 TurnResult / available_actions） | 契约有 `recovery_prompt`，实现缺位 |

结论：**「改代码对齐 10 卡契约」与「改契约认领 3 卡」都不成立**。前者要求把 4 个已验收、有 I1 绑定和专属 UI 的决策面回填进 ui_cards（大规模重写换取纸面一致）；后者只是承认现状命名，不回答「决策面契约到底是什么」，clarification / recovery 缺口原样保留。

## 4. 收口方向提案（方案 C：决策面注册表）

契约修订不再以「card_type 集合」为中心，改为冻结**决策面注册表**：

1. **每个决策时刻冻结一行契约**：canonical 驱动字段 + 动作通道（available_actions 的 action_type 集）+ 渲染责任。上表即注册表初稿。action_type 层现状基本贯通（`choose_candidate` / `accept` / `discard` / `edit_then_accept` / `confirm_before_execute` / `reject_or_cancel_confirmation` / `revise_from_findings` / `cancel_pending_behavior` / `answer_clarification`），可直接冻结。
2. **ui_cards 收缩定位为信息通告 lane**（不承载决策）：现存 `result_card`、confirmation 的展示部分归入此类；命名在 ADR 中一次性定案（届时统一 `confirmation_card`→契约名或反向，只改 3 个产出点 + 1 个 switch）。07 §4 中从未落地的 7 种卡片显式标注 Deferred 或废弃，前端删除 6 个死分支。
3. **补两个缺失决策面**：
   - clarification 显式化：needs_clarification 时产出结构化澄清 surface（问题文本 + `answer_clarification` 动作绑定），替换「隐式下一条消息」约定。
   - awaiting_author 落 TurnResult：预算耗尽/无进展时产出带恢复动作（steer/resume/cancel 语义）的 TurnResult，消灭对话死角。
4. **schema 治理进闸门**：决策面字段 + ui_cards 形状进 codegen schema；前端删手写 `TurnResult`，channel payload `safeParse`；`schema_version` 收敛。此后契约漂移在 CI 变红，而不是 UI 静默兜底。

CP 切分建议：CP0 契约修订 + ADR（本 note 升级）→ CP1 schema codegen + 前端接入校验（含删死代码）→ CP2 clarification 决策面 → CP3 awaiting_author TurnResult。每个 CP 按承重竖切面六问立项，Proof 含场景化验收。

## 5. 丝滑度问题与既有规划的挂接

| 问题 | 处置 |
|---|---|
| 调用经济学（7 次/轮、40-65 秒） | **已有方案**：`notes/2026-07-04` 计划驱动执行（conversation 7→≈3），走 ADR-0023，不另立 |
| 创作内容不流式（`author_narrative_delta` 仅限 `:author_reasoning`，`adapter_execution.ex:156`；正文等 run 结束一次性落地） | `notes/2026-07-01` 推理流 UI 的自然延伸：prose 等 purpose 的 chunk 经 author-safe 过滤后作为内容 delta 投影进气泡。建议独立 slice，provider 流式基建已就绪 |
| 渲染粒度（`@author_reasoning_delta_chunk_size 8`，`setAgentEvents` 全量重建，消息项无 memo，`agentEvents` 跨 run 只增不减） | 前端性能 slice：delta 时间窗合并（50-100ms）、消息项 memo、事件按 run 分桶 |
| 运行组锚定跳变（运行中挂用户消息下，完成后迁入 assistant 消息 + hydrate 二次重排；两个专项测试文件佐证此处反复修补） | 建议与内容流式 slice 合并设计：运行组自始至终以 assistant 占位消息为宿主，完成后原地收束 |

优先级建议：CP0/CP1（契约+schema 闸门）→ awaiting_author/clarification（CP2/CP3）→ 内容流式 → 渲染粒度/锚定 → 调用经济学（随 ADR-0023 主线）。
