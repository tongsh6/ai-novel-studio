# Agentic Loop 推理流 UI 交互设计（探索）

> 状态：UI 先行探索 / ADR 输入材料。**不冻结 schema，不授权实现。**
>
> 角色：定义「彻底 agentic loop」的信息流交互骨架，作为 `docs/design/ui/` 新 frame `46§9-agentic-loop-reasoning-flow` 与后续 loop 语义 ADR 的共同依据。
>
> 来源：2026-07-01 与作者连续对话收敛的根本决定——**叙事措辞归模型，结构骨架归 app**。

---

## 1. 背景与根因

原 `46§8-agent-run-dialogue-flow-v4`（已于 2026-07-01 删除，由本设计的 `46§9` 替代）的信息流被作者判为「机械 / 假」。根因不是布局，而是**过程叙事的作者权在 app 手里**：

- `provider_activity_projector.ex` 每一句 summary（「步骤规划已开始调用创作模型」）、`copy.ts` 全部 label、`agent_observation_assembler.ex` 的「已生成 N 个待采纳草稿」——**全是模板**，按 event_type + purpose 拼接，模型零参与。
- 模型真正贡献的只有：最终 artifact 正文，以及 planner JSON 里**一句** `summary`（又短又泛，还被每轮循环复读）。

结论：可见「信息流」95% 是程序替模型说话。任何「重排布局 / 加计划面板 / 换更好看的文案」都治标不治本——只要句子还是 app 写的，就仍然是假的。

这与项目自身最硬的红线同源：I1 因果绑定 / I3 种子贯通 / 场景不变量，本质都是「内容必须模型产出，禁止 app 捏造或模板补齐」，只是过去只覆盖 artifact 正文，**过程叙事一直是模板豁免区**。本设计把该原则从「正文」延伸到「推理流」。

---

## 2. 核心不变量：骨架归 app，措辞归模型

这是本设计的唯一根决定，其余全部由它推导：

| 维度 | 归属 | 说明 |
| --- | --- | --- |
| 叙事措辞（计划步骤描述、探索发现、评估结论、重规划原因、状态解释句） | **模型** | 逐字来自模型流式输出，UI 原样渲染，app 不得改写、补齐、拼接、模板化 |
| 结构骨架（有哪些槽位、第几步、步骤状态 chip、进度条、态与态之间的转移、控件） | **app** | 这是 app 的设计面，与本 spec 定义的一致；不含任何叙述句 |
| 遥测（prun/pcall/片段序号/token/phase 枚举） | app（仅开发者视图） | 默认不可见，折叠在最内层，是唯一允许出现机器 ref 的地方 |

判定标准：**任何一句「读起来像在描述模型正在想什么/做什么/发现了什么」的中文，都必须是模型输出的槽位，不能是 app 常量。** 若某处 app 常量读起来像叙事，即违反本设计。

---

## 3. 结构骨架（固定槽位 + owner）

工作态 turn 内四层，沿用 `46-state-and-feedback.md` §3.1.1 的分层，但中间两层重定义。方框内容用槽位记号，`{模型流:...}` = 模型逐字输出，`[app:...]` = app 骨架。

```
[app: 状态点]  {模型流: 一句话，此刻在做什么/想什么}          ← Status line（模型措辞）

─[app: 计划标签 + 版本号]───────────────────────
  [app: 状态chip]  {模型流: 这一步的描述}                     ← 计划面板：chip 归 app，描述归模型
  [app: 状态chip]  {模型流: 这一步的描述}
  ...
  [app: 若重规划出现的调整分隔线]  {模型流: 为什么调整}        ← 重规划原因归模型

─[app: 推理流标签]──────────────────────────────
  {模型流: 探索后自述发现了什么}                              ← 推理条目全部模型措辞
  {模型流: 评估：这步是否推进/计划是否仍成立}
  {模型流: 决定下一步做什么、为什么}
  [app: ⌄ 模型执行细节（开发者）]                            ← 遥测折叠入口

─[app: 结果槽]─────────────────────────────────
  [app: tentative/candidate 卡片外壳]  {模型: artifact 正文}   ← 走既有 adoption 出口
```

owner 边界要点：
- Status line 的动词与目标句 = 模型输出（不是 app 的「正在读取角色档案」常量）。
- 计划步骤的**描述文字** = 模型；步骤的 **status chip（pending/active/done/skipped）** = app 根据结构尾巴渲染。
- 重规划分隔线是 app 画的，但**「为什么改」这句话是模型的**。
- 推理流每一条都是模型措辞；app 只决定顺序（按事件真实到达序）和是否折叠。

---

## 4. 状态集与转移

态由 loop 的真实推理阶段驱动，**不是固定模板顺序**；顺序涌现。app 负责识别当前处于哪个态并渲染对应骨架，态内的叙述句仍全部来自模型。

| 态 | app 骨架表现 | 模型槽位 |
| --- | --- | --- |
| planning | 计划面板出现，步骤 chip 多为 pending | 计划各步描述、status line |
| exploring | 某 explore 步 active，推理流追加条目 | 探索意图 + 探索发现 |
| executing | 某 act 步 active，显示进度条/字数 | 当前动作说明 |
| evaluating | 推理流追加评估条目 | 「这步是否推进 / 计划是否仍成立」的判断 |
| **replanning** | 计划面板出现调整分隔线，旧步降权/新步插入，版本号 +1 | **重规划原因**（核心差异态：现有 loop 完全没有此态） |
| done | 计划回顾（vN、重规划次数），结果槽填充 | 完成语 + artifact |
| blocked / await author | 某步标 ⏸ 受阻，浮出作者可选控件 | 受阻原因 + 可选方向的说明 |

关键转移 **replanning**：`executing/exploring → evaluate 判定计划前提不成立 → replanning（版本 +1，模型给原因）→ 回到 exploring/executing`。这条回路让作者看到「模型改主意了，因为它自己说的这个原因」，是「彻底 agentic」与「机械直线」的分水岭。

---

## 5. 流式协议要点（喂给实现/ADR）

要让措辞真来自模型，loop 的「思考」必须从**非流式 JSON**升级为**流式**，每个循环产出两段：

1. **reasoning 流（作者安全、流式）**：模型逐字吐出的自然语言推理——即 §3 所有 `{模型流:...}` 槽位的来源。UI 逐字渲染。
2. **结构尾巴（小 JSON，机器用）**：本轮选哪个工具 / 计划步骤及其 status / 是否 `replanned` / 是否 `goal_satisfied|await_author`。**只驱动 app 的 chip 与态，绝不作为叙述来源。**

app 从这两段里**只取结构**去画骨架，叙述一律引用①的原文。provider 的 prun/pcall/chunk/token 事件继续存在，但只进开发者视图，不再拼成作者可见句子。

---

## 6. 渲染不变量（机器可检查方向）

1. 作者可见的每一句叙述，其字节来源必须可追溯到某次模型输出；app 侧不得存在「读起来像叙事」的常量字符串。
2. 遥测（provider run/call ref、片段序号、token、phase 枚举）默认不可见，仅开发者视图；作者视图不出现机器 ref。
3. 不得暴露 raw prompt、chain-of-thought 私有段、API key、provider 私有 payload、完整 ToolRequest（延续 §3.1 第 9 条）。
4. 中间 reasoning/chunk 不得静默覆盖或直接采纳 artifact；产物仍走 tentative/candidate 出口。

---

## 7. 本设计引入的未冻结语义 → ADR 待办

以下是 UI 先行暴露、**尚未冻结**、必须走 ADR/contract 才能实现的语义（对齐 `ui/README.md` §3「未冻结语义先暂停画面走 ADR」）：

- `AgentPlan`：多步、可版本化、可就地修订的计划对象（现仅有单步 `AgentNextStepDecision` + 单动作 `MicroPlan`）。
- 步骤 `kind: :explore | :act` 区分；步骤 `status` 状态机。
- `plan_revised` 事件 + 重规划原因字段。
- reasoning 作为**流式一等输出**的 provider 协议（现 reasoning 仅在 planner JSON `summary` 单句里）。
- evaluate 环节：独立调用 vs 折进 planner 同调用（待定，见下）。

未决分叉（进 ADR 时定）：evaluate 是否独立模型调用；计划结构化到什么粒度；地板模型下 reasoning 质量的兜底策略（对齐地板档 forcing function 立场）。

---

## 8. 追溯与后续

- 对应将建的原型：`docs/design/ui/novel-studio.pen` → `46§9-agentic-loop-reasoning-flow`（A–E 状态面板），建立后登记进 `traceability/screen-to-doc-map.md`。
- 建 frame 前提：Pencil MCP 需连通（`.pen` 加密，只能经 Pencil 工具读写）。
- 升级路径：本 notes → loop 语义 ADR + plan/reasoning contract（`docs/design/contracts/`）→ `46-state-and-feedback.md` §9 正式 UI 文档 → 承重竖切面实现。
