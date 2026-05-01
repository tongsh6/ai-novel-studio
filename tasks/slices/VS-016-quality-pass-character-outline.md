# VS-016 Quality Pass — Per-Character Adoption + GENERATE_CHAPTER_OUTLINE

- 状态：done
- 类型：Turn Slice + Quality Fix
- 启动日期：2026-05-01
- 完成日期：2026-05-01

## 1. 用户 / 系统目标

两个问题：

1. **角色采纳 UX bug**：`character_adoption_card` 只渲染一个"全部采纳"按钮指向第一个角色，其余角色无法单独操作
2. **缺少大纲生成**：无法在对话中说"生成章节大纲"

本 slice 修复上述问题。

## 2. 开工检查

- Contract: ADR-0006 (Card/Action), ADR-0008 (Intents)
- Invariant: 每个角色独立可采纳/放弃；大纲生成复用 Draft 持久化
- Boundary: novel_agent（IntentRegistry + Router）、novel_application（TurnService）

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_agent | yes | IntentRegistry: GENERATE_CHAPTER_OUTLINE slot schema + meta |
| novel_application | yes | TurnService: character_adoption_cards（逐角色卡片）+ build_generation_prompt（大纲专用 prompt） |

## 4. 任务清单

| # | 任务 | Status |
|---|---|---|
| T1 | character_adoption_card → character_adoption_cards（逐角色 accept/discard 按钮）| done |
| T2 | IntentRegistry 注册 GENERATE_CHAPTER_OUTLINE | done |
| T3 | TurnService: intent_display_name + build_generation_prompt（大纲专用）| done |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 371 tests, 0 failures
- [x] `mix credo suggest --strict` — no issues
- [x] `bash scripts/ai_static_scan.sh --top 10` — 13/13 PASS
- [x] `cd frontend && pnpm typecheck && pnpm lint` — 全部通过

## 6. 决策日志

- 2026-05-01 — GENERATE_CHAPTER_OUTLINE 复用 `build_draft_tentative` 基础设施（ProviderGateway → create_tentative_draft → adoption_card），仅定制 prompt。无需新增 normalize_intent 分支——catch-all `:other` 已路由到 `build_draft_tentative`。
- 2026-05-01 — 大纲 prompt 要求"章节标题、3-5个关键情节点、场景划分建议"，结构比通用草稿更明确。
