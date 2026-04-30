# VS-014 ReadingMode Real Content Projection

- 状态：done
- 类型：Projection Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

VS-013 完成了 modify_draft 闭环。用户在对话中可以：创建作品 → 生成草稿 → 采纳/修改/放弃。但采纳后的草稿无处可读——ReadingMode 渲染的全是硬编码占位文本，不是用户实际创作的内容。

本 slice 实现 ReadingMode 的真内容投影：采纳后的 draft 按 Volume → Chapter → Scene 结构渲染为可读正文，TOC 侧边栏显示真实的卷/章树。StructurePanel 大纲 tab 同步接入真实数据。

## 2. 开工检查

- Contract: ADR-0009 (Projection Object Schema), ADR-0011 (Projection Refresh Triggers)
- Invariant:
  1. 只有 accepted 状态的 artifact 进入 ReadingMode
  2. projection_refs stale 时 ReadingMode 显示刷新提示
  3. 不暴露 tentative 内容
- Boundary: 涉及 novel_application (ReadingService)、novel_web (WorkspaceChannel)、frontend (ReadingMode + StructurePanel + store)；不修改 novel_domain、novel_agent、novel_foundation
- Consumer: 用户点击"阅读模式"→ 看到采纳后的作品正文
- Proof: `mix test` 371 tests 全绿，static scan 13/13 PASS

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 只引用既有 enum |
| novel_domain | no | |
| novel_agent | no | |
| novel_application | yes | 新增 ReadingService（build_toc + build_chapter_content） |
| novel_persistence | no | 消费既有 schemas |
| novel_web | yes | WorkspaceChannel: 新增 get_toc + get_chapter_content handler |
| frontend | yes | ReadingMode 全部重写真实渲染；StructurePanel 大纲 tab 接真数据；store 新增 channel；socket.ts 新增 getToc/getChapterContent |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | ReadingService | done | build_toc/1（volumes + chapters 树）+ build_chapter_content/1（scenes + accepted drafts） |
| T2 | Channel handlers + socket.ts | done | get_toc + get_chapter_content，请求-响应式（handle_in → reply） |
| T3 | ReadingMode 真实渲染 | done | 从 store 取 channel → getToc → 渲染 TOC → 点击章节 → getChapterContent → 渲染正文；保留 STALE/REBUILDING/FAILED banner |
| T4 | StructurePanel 大纲 tab | done | panel 打开时 getToc，渲染 volumes/chapters 树替代占位 |
| T5 | ESLint 修复 | done | set-state-in-effect 改为派生状态；useEffect 补 setChannel 依赖 |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 371 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `mix run scripts/arch_check.exs` — ✅ 通过
- [x] `mix credo suggest --strict` — no issues
- [x] `bash scripts/ai_static_scan.sh --top 10` — 13/13 PASS
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test` — 全部通过

## 6. 决策日志

- 2026-04-30 — 数据获取选择 WebSocket Channel 请求-响应模式（handle_in + reply），而非新增 REST 端点。理由：复用现有 WorkspaceChannel，与现有 `adopt`/`modify_draft` 模式一致。后续可加 REST 缓存层。
- 2026-04-30 — Channel 对象存入 Zustand store（`channel: Channel | null`），使非 WorkspaceChat 组件（ReadingMode、StructurePanel）也能发送消息。
- 2026-04-30 — ReadingMode 内容加载使用派生状态（`contentLoading = activeChapterId != null && chapterContent == null`）而非 `setState` in effect，满足 react-hooks/set-state-in-effect 规则。
- 2026-04-30 — 大纲 tab 的 TOC 数据在 panel 打开时自动获取（`useEffect([isOpen, channel, context.workId])`），无需用户手动刷新。
- 2026-04-30 — Characters/Foreshadowing/Rules tabs 保持空状态——需要后续数据填充（角色、伏笔、规则的 accepted 数据）才能呈现真内容。

## 7. 试行反馈

- `Enum.map_join/3` 替代 `Enum.map/2 |> Enum.join/2` 已被 Credo 捕获并修复。
- Channel 存 store 的模式是暂时的——后续应考虑 React Context 或专门的 connection manager 模块。Store 中的 Channel 对象不应被序列化（已经在 Zustand 的 `partialize` 或 `persist` 中排除）。
- 首次加载无内容时 ReadingMode 显示引导文案，体验良好。但需要在 WorkspaceChat 中显式创建作品上下文后才有内容。
