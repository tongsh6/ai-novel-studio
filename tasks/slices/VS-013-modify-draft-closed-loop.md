# VS-013 Modify Draft Closed Loop

- 状态：done
- 类型：Turn Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

VS-012 打通了"发送消息 → LLM 生成草稿 → 采纳"的最简链路，但写作工具最核心的交互——"修改草稿"——完全不工作。前端"修改后采纳"按钮只是输入框预填占位符，没有后端支持。同时，discard 对 draft_text 静默失败。

本 slice 实现完整的 modify_draft 闭环：
- 用户点击"修改后采纳"→ 输入修改意见 → Agent 调用 LLM 重写草稿 → 返回新 revision 的 adoption_card → 用户可继续修改或采纳
- 修复 discard on draft_text 静默失败 bug

## 2. 开工检查

- Contract: ADR-0001 (TurnResult v2), ADR-0006 (Card/Action), ADR-0008 (Intents)
- Invariant:
  1. 修改只在 tentative draft 上进行
  2. base_revision 检查拒绝并发修改（optimistic_lock）
  3. 修改后 draft 仍为 tentative，需重新采纳
  4. 每次修改生成新 revision
- Boundary: 涉及 novel_application (TurnService + AdoptionBoundary)、novel_web (WorkspaceChannel)、frontend (WorkspaceChat + socket.ts)；不修改 novel_domain、novel_foundation、novel_agent
- Consumer: 终端用户——点击"修改后采纳"→ 输入修改意见 → 获得改写后的草稿
- Proof: `mix test` 371 tests 全绿，static scan 13/13 PASS

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | Draft.update_content/2 已存在，无需修改 |
| novel_agent | no | 复用 ProviderGateway.complete/2 |
| novel_application | yes | AdoptionBoundary: 新增 modify_draft/4 + modify_draft_multi/5；TurnService: 新增 handle_modify_draft/6 + handle_discard_draft/2 |
| novel_persistence | no | Draft.changeset/2 已支持 content 更新 + optimistic_lock |
| novel_web | yes | WorkspaceChannel: 新增 modify_draft handler + 修复 discard handler 路由 draft_text |
| frontend | yes | socket.ts: 新增 modifyDraft + discardArtifact 传 artifact_type；WorkspaceChat: 重写 edit_then_accept handler |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 修复 discard draft_text 静默失败 | done | WorkspaceChannel discard handler 新增 artifact_type 分派；TurnService 新增 handle_discard_draft/2；socket.ts discardArtifact 传 artifact_type |
| T2 | AdoptionBoundary.modify_draft/4 | done | Repo.get + tentative check + Multi pipeline + modify_draft_multi 提取消除 Credo nesting |
| T3 | TurnService.handle_modify_draft/6 | done | 构建修改 prompt → ProviderGateway.complete → AdoptionBoundary.modify_draft → 返回 adoption_card |
| T4 | WorkspaceChannel.modify_draft handler | done | 提取 draft_id/base_revision/content/instruction，调用 TurnService |
| T5 | 前端 modifyDraft + edit_then_accept 重写 | done | socket.ts 新增 modifyDraft；WorkspaceChat 用 window.prompt 获取修改意见 |
| T6 | 补齐/router 测试修复 | done | 恢复 12 个测试 + 数据驱动 refactor + "创作一本" classify 规则 |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 371 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `mix run scripts/arch_check.exs` — ✅ 通过
- [x] `mix credo suggest --strict` — no issues
- [x] `bash scripts/ai_static_scan.sh --top 10` — 13/13 PASS
- [x] `cd frontend && pnpm typecheck && pnpm test` — 12 tests, 0 failures

## 6. 决策日志

- 2026-04-30 — modify_draft 用 window.prompt 收集修改意见（MVP），非最终 UI。后续应换为 modal/inline editor。
- 2026-04-30 — modify_draft 后 draft 保持 tentative 状态，用户需重新采纳。这是有意设计：每次修改都应经过人工审核。
- 2026-04-30 — 修改 prompt 格式：原文 + 修改意见 + "请根据修改意见重写上文。只输出修改后的完整文本"。后续可基于 feedback_patch 概念扩展。
- 2026-04-30 — modify_draft_multi 提取为独立私有函数，消除 Credo nesting 违规。用 guard clause `when draft.status == "TENTATIVE"` 做 status 检查。
- 2026-04-30 — 修复了 router_test.exs 的数据驱动重构（此前转换为 Enum.find_value 时引入了不可编译的匿名函数在 module attribute 中，且丢失了 9 个测试）。

## 7. 试行反馈

- discard on draft_text 静默失败是 VS-012 遗留的 bug——`AdoptionBoundary.discard_draft/2` 已实现但从未被调用。VS 设计时应检查已有基础设施是否已全部接入。
- 前端"edit_then_accept"按钮的 action_type 保持不变（向后兼容），但 handler 从 no-op 改为真实功能。
- Router 的 `classify_intent` 返回 `:unknown` (atom) 和 `"intent.XXX"` (string) 的类型不一致，是已知设计权衡——后续应考虑统一为 tagged tuple。
