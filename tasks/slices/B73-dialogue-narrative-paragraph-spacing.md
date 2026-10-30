# B73：对话叙事段落双倍空行修复（作者反馈换行过大）

- 状态：**doing（2026-10-31 CP0 复现与根因完成；CP1 CSS 修复已落地；页面 scoped 复验待做）**。
- 来源：作者在 B39 AU-15 原生实模批次运行中直接反馈“换行有问题”，附真实 Tauri 窗口截图（AI 回应叙事行之间空行过大）。
- 类型：UI 呈现缺陷（非产品数据/模型语义）；不新增验收感知逻辑。

## 1. 复现与证据（CP0，2026-10-31）

- 截图：作者提供 B39 AU-15 原生 Tauri 窗口截图——AI 叙事段“已阅读章节正文…/已核查章节…/I'll draft…/已检索正文…”之间出现约单行高度的空白。
- AX 文本证据：`artifacts/slice-verify/b39-au15-au15cp1a-native/a1-run1-after.text.txt` 显示这些行本身是**独立 narrative 事件**，每行只含单个换行；文本内部没有 `\n\n`。
- 代码根因（frontend/src/components/WorkspaceChat.tsx + `.module.css`）：
  1. `AgentRunDialogueFlow` 将 `visibleNarrativeEvents` 各渲染为 `<p className={agenticLoopNarrativeParagraph}>`；
  2. 父容器 `.agenticLoopReasoning` 已有 `display:flex; flex-direction:column; gap:12px`；
  3. 段落自身同时声明 `margin: 0 0 12px`（last-child 去 margin）；
  4. flex gap 与 margin 叠加 → 段落间实际 24px，形成作者看到的“双倍空行/换行过大”。
- 影响范围：仅 AgentRun 对话叙事段落间距；不涉及正文、卡片、消息内容或数据。
- 不涉及：模型输出换行字节（不修改 provider/artifact）、不修改 Markdown/白名单。

## 2. CP1 修复（2026-10-31）

- `frontend/src/components/WorkspaceChat.module.css`：`.agenticLoopNarrativeParagraph` 改为 `margin: 0`，段落间距唯一来源为父容器 flex `gap: 12px`；移除冗余 last-child margin 规则。
- 回归守卫：`scripts/lib/quality/narrative_spacing.test.mjs` 静态断言父容器 gap=12px、段落在主题规则中无 margin/margin-bottom（防止再次叠加；放在 node 侧避免 node 类型污染前端 typed lint）。
- 门禁（本轮）：`pnpm typecheck`、`pnpm lint`、`pnpm test -- --run WorkspaceChat.narrativeSpacing.test.ts` 通过；全量前端测试随后跑。

## 3. 页面 scoped 复验（进行中：AU15 uib74 批次）

- 需在真实 Tauri 工作台用外部 driver 重新生成同一叙事流（AU15 A1 或 AU10 渲染场景），测量相邻 narrative 段落 computed margin/gap，断言间距为 12px（不是 24px），并截图对照。
- 复验前不得标记 B73 done；类型/视觉最终判断仍由作者确认。

## 4. 残余

- 由于修复只在 CSS/组件展示层，历史会话内容不受影响；需在修复后的构建中重新打开旧会话确认无回归。
- 若作者期望活动行更紧凑（非 12px 段落间距）或只有探索活动行使用更小间距，属于新的 UI 设计取舍，应在此 slice 单独裁决，不在本次顺手改。
