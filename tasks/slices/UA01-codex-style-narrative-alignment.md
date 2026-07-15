# UA01 Codex 式叙事体裁对齐（46§9.4 实施）

- 状态：doing（2026-07-15 用户批准设计稿后开工）
- 类型：Prompt Asset Slice / UI Layout Slice
- 父设计：`docs/design/ui/46-state-and-feedback.md` §9.4（用户 2026-07-15 拍板）
- 父 slice：`UA01-agentic-loop-streaming-reasoning-card-simplification.md`（三层收敛的体裁演进）

## 1. 目标

AI 响应对齐 Codex Desktop 式工作流呈现：意图开场段 → 折叠活动行（仅进行中指示）→
阶段结论段 → 轻量进度行 → 产物卡。叙事措辞归模型（提示词体裁引导），活动行/进度行
为纯结构词归 app copy；§9.1 根原则与 N-NARR 不放宽。

## 2. 开工检查（六问）

- **Contract**: 46§9.4 五要素映射与红线；ADR-0022（叙事作者权）、ADR-0023（计划驱动）不动；`copy.ts` 集中文案约束。
- **Invariant**: N-NARR（叙事字节绑定）；46§9.1 判定标准（叙述句必须来自模型）；用户原则「文案几乎全部归 AI，系统只留结构词」。
- **Boundary**: `novel_application` 提示词资产（计划起草/叙事体裁 context block）、`frontend`（AgentRunDialogueFlow / agentRunTimeline / copy.ts）；`novel_agent` 协议、`novel_domain`、后端事件流不改。
- **Consumer**: WorkspaceChat 真实对话主链的作者。
- **Proof**: 后端 focused prompt 测试 + N-NARR driver；前端 typecheck/lint/vitest；真实 Tauri `agent-conversation-turn`（三层结构断言沿用 section[aria-label] 判定）+ `agent-bounded-roster-to-character-design` 回归；stage 真实模型走查（体裁效果需真模型评估，stub 叙事为固定文本）。
- **Acceptance Driver**: 既有外部 Tauri driver；产品代码不新增验收感知逻辑（no）。

## 3. 范围

必须实现：

1. 提示词体裁约束（§9.4.3）：起草 reasoning 开场段（目标复述+顺序+边界承诺）；
   exploration/evaluation 叙事升格为成段结论（核清事实+判断+影响范围）。
2. AgentRunDialogueFlow：推理区改文档流段落体；结构事件聚合为活动行
   （仅 tool_started 进行中显示，完成即收起）；状态行并入进度行
   （第 n/m 步 · k 份草稿待采纳 · 约 x 字）。
3. copy.ts：活动行进行中模板与进度行单位词（§9.4.4 收紧版）。

非目标：不改事件协议/持久化；不新增叙事来源；不动候选/采纳卡（已完成）。

## 4. 决策日志

- 2026-07-15：slice 创建（用户"好"批准 §9.4 设计稿）。
- 2026-07-15：三部分落地——①提示词体裁（起草=意图开场段三要素、修订=阶段结论段三要素）；
  ②AgentRunDialogueFlow：推理区文档流段落体（去逐条结构标签）、活动行（仅 tool_started
  进行中显示 spinner 文字，tool_completed/终态收起）、进度行并入状态行（第 n/m 步 ·
  k 份草稿待采纳 · 约 x 字，字数从 adoption_state.pending payload 计）；③copy.ts 结构词
  （activityDrafting/Reading/Working + progressStep/Pending/Chars）。死 CSS（旧叙事
  列表/标签块）清除。
- 2026-07-15：**假计数修正**——完成态曾显示「第 0/4 步」：计划面板步骤状态是事件快照，
  完成态落后于真实进度；步数计数改以运行时事实 completed_step_refs 为准（宁缺毋假）。
- 2026-07-15：验证——前端 390/390 + typecheck/lint；后端 1214/0；I1/I2/I3 全绿；
  真实 Tauri agent-conversation-turn 与 agent-bounded-roster-to-character-design 复跑绿
  （截图确认段落体/进度行/计划 checklist 生效）。**体裁真实观感待 stage 真模型走查**
  （stub 叙事为固定文本，意图段/结论段效果需真模型评估）。

## 5. 下次会话恢复指引

先读 46§9.4（含 9.4.4 收紧版），再看本文件范围；提示词资产入口
`apps/novel_application/lib/novel_application/agentic_plan_draft_planner.ex`
与其 context block；前端入口 `frontend/src/components/WorkspaceChat.tsx`
的 AgentRunDialogueFlow。
