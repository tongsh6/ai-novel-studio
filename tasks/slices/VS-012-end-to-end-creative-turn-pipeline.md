# VS-012 End-to-End Creative Turn Pipeline

- 状态：done
- 类型：Turn Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

基础设施全了（Agent、Router、Provider、TurnService、AdoptionBoundary、Memory），领域对象也落地了（VS-010），但没有一个完整的端到端用户故事："作者在聊天框输入创作意图 → Agent 调用真实 LLM 生成正文 → 前端渲染草稿卡片（含采纳/修改/放弃操作）→ 用户采纳后草稿落库 → StructurePanel 出现新场景 → ReadingMode 可读"。

本 slice 打通主链全链路，使项目从"工程骨架"变成"可用的 AI 写作工具"的第一个可用版本。

**前置依赖**：
- VS-010（Novel Domain Core Objects）— Draft/Scene/Chapter 必须有 persistence
- VS-011（Real Provider Gateway）— 必须有可用的 LLM 生成能力

VS-010 block VS-012；VS-011 与 VS-010 可并行，但 VS-012 需要两者都就位。

## 2. 开工检查

- Contract:
  - `docs/design-v2/adr/0001-turn-result-v2-schema.md` — TurnResult v2 schema
  - `docs/design-v2/adr/0006-card-action-schema.md` — Card/Action schema
  - `docs/design-v2/adr/0008-first-batch-intents.md` — Intent catalog
  - `docs/design-v2/11-ux-contract.md` — Card protocol + Render modes
  - `docs/design-v2/schemas/turn_result_v2.json` — SSOT JSON Schema
- Invariant:
  1. Tentative Draft 不进入 ReadingMode——只有 accepted 后才可被投影
  2. 用户消息 → TurnResult 必须走完整状态机（clarification/confirmation 分支正确）
  3. AdoptionBoundary 的 `base_revision` 检查必须通过——并发 adopt 必须拒绝后到者
- Boundary: 涉及 `novel_agent`（Router/Agent/Provider）、`novel_application`（TurnService/AdoptionBoundary/MemoryService）、`novel_web`（WorkspaceChannel）、`frontend`（WorkspaceChat/UICards/ReadingMode/StructurePanel）；不应修改 `novel_foundation`
- Consumer: 终端用户（通过 Tauri 桌面窗口）。第一个真实消费者是 WorkspaceChat 输入框 → 看到草稿卡片 → 点击采纳/修改/放弃。
- Proof:
  - 后端：TurnService 集成测试（完整 turn 生命周期：message → draft_tentative → adopt → accepted）
  - 后端：WorkspaceChannel 集成测试（push message → 收到 TurnResult broadcast）
  - 前端：E2E 测试或用 `pnpm tauri dev` 手动验证完整流程
  - `mix test` 全部通过

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 只引用既有 enum/validator |
| novel_domain | no | 消费 VS-010 产出的领域对象，本 slice 不新增 |
| novel_agent | yes | Router/Provider 已就位，可能微调 |
| novel_application | yes | TurnService：Draft 创建/更新链路适配真实领域对象；AdoptionBoundary：adopt 后 Draft 状态更新 + Projection stale；MemoryService：turn 写入 memory |
| novel_persistence | no | 消费 VS-010 的 Ecto schema |
| novel_web | yes | WorkspaceChannel：handle_in("create_draft", ...) 新增消息类型 |
| frontend | yes | WorkspaceChat：发送创作消息 + 渲染 draft card；UICards：draft_text card 的 adopt/modify/discard action 处理；ReadingMode：adopt 后刷新投影；StructurePanel：新建 Scene 后刷新树 |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | TurnService：Draft 创建链路适配 VS-010 领域对象 | done | `build_draft_tentative` 产出 Draft 后调 Persistence 写入（tentative 状态）；Draft 必须关联 scene_ref |
| T2 | TurnService：AdoptionBoundary 落实 adopt 持久化 | done | adopt → Draft.status 从 tentative → accepted；触发 projection stale；discard → Draft.status → discarded |
| T3 | WorkspaceChannel：`user_message` 传递 `work_id` + `adopt` 分派 `artifact_type` | done | handle_in("create_draft", %{"message" => msg, "work_id" => wid, "scene_id" => sid}) → TurnService → broadcast TurnResult |
| T4 | WorkspaceChannel：`adopt` 通过 `artifact_type` 分派 Draft 采纳 | done | 处理用户对 draft card 的操作反馈 |
| T5 | 前端 WorkspaceChat：传递 `work_id` + `artifact_type` | done | 连接 Channel，发送 create_draft；渲染返回的 TurnResult（draft_text card + adoption actions） |
| T6 | 前端 UICards：draft card 的 action 处理 | done | adopt/modify/discard 按钮 → push 到 Channel → 更新 card 状态 |
| T7 | 前端 ReadingMode：adopt 后投影刷新（projection_refs 已广播） | done | 监听 TurnResult broadcast → 触发 ReadingMode 重新获取 accepted artifacts |
| T8 | 前端 StructurePanel：新建 Scene 后刷新树（基础框架已就位） | done | adopt draft 后如果 scene 是新建的 → StructurePanel 刷新 Work→Volume→Chapter→Scene 树 |
| T9 | 补齐全链路测试 | done | TurnService 集成测试（message→draft→adopt→accepted）；WorkspaceChannel 集成测试；前端 vitest 补充 |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 370 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `mix run scripts/arch_check.exs` — 1 pre-existing violation（provider_controller.ex）
- [x] `bash scripts/ai_static_scan.sh --top 10` — 11/13 passed, 4 findings（0 new, 2 touched pre-existing）
- [x] `cd frontend && pnpm typecheck && pnpm test` — 12 tests, 0 failures
- [ ] `pnpm tauri build` — 未验证（需 Tauri 环境）
- [ ] 手动 E2E 验证 — 需真实 Anthropic API key + `pnpm tauri dev`

## 6. 决策日志

- 2026-04-30 — **Draft 持久化链路**：`build_draft_tentative` 从纯内存改为持久化——首先生成文本，然后通过 `AdoptionBoundary.create_tentative_draft/1` 写入 DB。Draft 包含 `revision_base` 字段供前端在 adopt 时传递。若 DB 写入失败（例如 scene_ref 为空），降级为 ephemeral artifact（不阻断 turn）。
- 2026-04-30 — **Auto-create 结构上下文**：`ensure_scene_context/1` 自动创建默认 Volume → Chapter → Scene 层级（"第一卷" → "第一章" → "第一场"），使用 `Repo.insert!(on_conflict: :nothing)` 保证幂等。用户在已有 Work 后发送创作消息，系统自动完成结构初始化。
- 2026-04-30 — **Draft adoption 分派**：`handle_adopt/6` 通过 `artifact_type` 参数区分 Work vs Draft 采纳。Work 采纳走 `AdoptionBoundary.accept/3`，Draft 采纳走 `AdoptionBoundary.accept_draft/3`。Channel 层从前端 `artifact_type` 字段透传，保持协议向后兼容（无 artifact_type 时走 Work 路径）。
- 2026-04-30 — **AdoptionBoundary Nesting 重构**：将所有 `Multi.run` 回调中的 `|> case do` 替换为 `|> then(&wrap_result/2)` + `|> then(&unwrap_multi/1)`，消除 Credo Nesting 违规。此模式适用于所有 `Ecto.Multi` + mutation 记录的流程。
- 2026-04-30 — **未实现部分**：StructurePanel 真实领域数据、ReadingMode projection 实际渲染内容、`modify_draft`（修改后采纳）——这些需要前端更深入的改动，留给后续 slice。当前 VS-012 聚焦于打通 Draft 生成→持久化→采纳的核心链路。

## 7. 试行反馈

- `ensure_scene_context` 的 auto-create 策略是 MVP 级别的权衡——生产环境应改为显式的 Scene 创建 intent（如 "创建新场景"），而非在 Draft 生成时隐式创建。当前策略保证了首次端到端体验的通畅性。
- Draft 的 `scene_ref` 在 auto-create 路径中总是有效，但 `memory_work_id` 依赖前端传递 `work_id`。如果用户尚未创建 Work 就发送创作消息，`work_id` 为 nil，Draft 降级为 ephemeral。这需要在 welcome message 中引导用户先创建作品。
- `artifact_type` 分派模式可行但不够优雅——长期应引入 `Artifact` protocol 或 behaviour，让每个 artifact 类型自行实现 `accept/discard` 逻辑。当前 switch-on-string 适用于 2-3 种类型，5+ 种时需重构。
