# 41 Workbench Layout

> 状态：草案
>
> 角色：定义当前 UI 主工作台（Workbench）的整体布局与区域职责。

---

## 1. 语义来源

本文布局原则及投影对象追溯至：

- `../07-workbench-ui-contract.md`：UI 只能投影 TurnResultViewModel、`ui_cards` 和 `available_actions`。
- `../domain/28-authoring-lifecycle.md`：创作生命周期的阶段感知。
- `../adr/ADR-0015-turn-result-view-model-v3.md`：顶层数据读取路径。
- `40-ui-overview.md`：对话优先、结构兜底、长跑透明、结构面板默认隐藏。

---

## 2. 不负责范围

- 本文不定义具体组件的具体像素或栅格（由 Pencil 原型负责）。
- 不定义卡片内部结构（见 `42-card-system.md`）。
- 不新增任何 Turn/Task/Artifact 状态。

---

## 3. 全局布局架构

主工作台呈现为一个“编辑驾驶舱 (Editorial Cockpit)”，顶层分为三个主要视觉与功能区域：

```text
+-----------------------------------------------------------+
| [顶部上下文栏] Work / Volume / Chapter | Mode | Risk / Budget |
+-----------------------------------------------------------+
|                                  |                        |
| [主对话流区域]                   | [作品档案/结构面板]    |
|                                  | (默认折叠)             |
|  - Assistant Message             |                        |
|  - 卡片流 (Clarification等)      |  - Structure Panel     |
|  - AgentRun 工作态 turn          |  - Work Archive        |
|                                  |                        |
|                                  |                        |
|                                  |                        |
| [输入区]                         |                        |
| (支持自然语言、意图指令)         |                        |
+-----------------------------------------------------------+
```

---

## 4. 区域职责说明

### 4.1 顶部上下文栏 (Top Context Bar)

目标：时刻告知作者当前的创作焦点及 Agent 运行的宏观状态。
数据来源：当前活跃的 `work` / `volume` / `chapter` 对象；全局 `budget` 摘要；全局最高 `severity` 的警告数量。

必须包含：
- **当前上下文位置**：当前作品名、卷名、章节名（若未定则显式标为“未定”）。
- **当前模式**：表明处于 Workbench 创作态（与 Reading Mode 区分，可作为切至阅读态的入口）。
- **系统/长跑摘要**：全局 Budget 消耗进度缩略图、重大风险（Risk / Quality Finding）的全局计数，或当前是否处于长跑被中断（Checkpoint）的状态。

### 4.2 主对话流区域 (Main Conversation Area)

目标：作者日常交互和推进创作的主舞台。这是核心工作区，必须占据最大面积且视觉最突出。
数据来源：`TurnResult` / `ui_cards` / `task refs` / `adoption state`。

必须遵守：
- **对话流为主**：用户输入和 `assistant_message` 按照时间线从上至下排列。
- **卡片即内容**：涉及需要确认（Confirmation）、澄清（Clarification）、采纳（Adoption）的状态，必须以卡片形式嵌入对话流中展示，而不是隐藏在纯文本或侧边栏里。
- **干扰屏蔽**：Debug trace、Provider raw output、系统低级别日志**绝对禁止**作为主消息流的内容出现。

### 4.3 作品档案与结构面板 (Archive & Structure Panel)

目标：作为“档案柜”，按需提供作品结构、角色、设定、伏笔、规则和阅读投影等对象视图，而不压迫主创作用户体验。
数据来源：Accepted / Authoritative objects, pending artifacts, quality/approval refs。

必须遵守：
- **默认折叠/隐藏**：在普通对话和创作流中，该面板不应抢占主对话区域。仅提供轻量的入口提示（如小红点、数量 badge 提示有待采纳产物或风险）。
- **按需展开**：当作者需要查看世界观、角色设定、伏笔、规则或阅读投影时，可以展开面板。
- **渐进披露**：遵循 `43-structure-panel.md` §4 原则，展开后也不应直接铺满所有字段。
- **不承载 AgentRun 主反馈**：AgentRun 运行中状态、provider execution stream、pause / steer / cancel 和工作轨迹必须留在主对话流对应的 assistant 工作态 turn 内；右侧面板不得变成 Agent 控制台，也不得替代作品档案区域。

---

## 5. 验收标准约束

1. 必须明确主入口是对话流。
2. 结构面板不得默认压过对话。
3. AgentRun、long-run、checkpoint、budget 必须有明确且稳定的位置：当前 turn 的工作态、顶部上下文栏和对应卡片；不得默认占用作品档案面板。
4. debug / trace 绝不进入主消息。

---

## 6. 原型布局要求

### 6.1 桌面默认布局

`41§3-main-workbench` screen 必须采用三段式：

```text
顶部上下文栏：work / volume / chapter / mode + budget / risk / checkpoint 摘要
主区域左侧：对话流 + 卡片流 + 输入区
右侧收纳：作品档案 / 结构入口，默认折叠，不显示 AgentRun 控制台
```

顶部上下文栏字段优先级：

1. 当前作品 / 卷 / 章。
2. 当前模式：创作态 / 阅读态入口。
3. 长跑状态：无任务 / 运行中 / checkpoint / failed；只做宏观摘要，详情回到主对话 turn。
4. budget 摘要：预计 / 已消耗 / 风险阈值。
5. risk 摘要：最高 severity 与待处理数量。

### 6.2 主对话流与卡片混排

主区域按时间线展示：

```text
用户输入
assistant_message
ui_cards[]（按 TurnResult 顺序嵌入）
assistant 工作态 turn（active AgentRun，含折叠工作详情）
下一轮输入区
```

规则：

1. `assistant_message` 不得替代需要操作的 card。
2. `adoption_card`、`confirmation_card`、`checkpoint_card` 必须占据可见宽度，不藏到右侧面板。
3. 多张 card 同轮出现时，按 decision urgency 排序：checkpoint / confirmation / adoption / warning / result / progress。
4. AgentRun 内部状态绑定到同一个 assistant 工作态 turn：运行中显示短状态动词和可展开详情，完成后原地更新为最终回复或结果卡，不追加多条 assistant 消息。

### 6.3 输入区状态

| 输入区状态 | UI 行为 | 来源 |
| --- | --- | --- |
| 普通输入 | 允许自然语言输入 | 无 active blocking behavior |
| 等待补充 | 输入区提示“补充缺失信息” | `behavior_state.active.type=clarification` |
| 等待确认 | 输入区弱化，主操作在 confirmation card | `next_action=CONFIRM_BEFORE_EXECUTE` |
| AgentRun 运行中 | 输入仍可用，提示“调整当前请求”并提交 steering 到当前 `run_id` | `agent_run_state.status=running` |
| 长跑运行中 | 输入仍可用，但提示“新输入可能影响续跑” | task `RUNNING` |
| checkpoint | 输入区提示先处理 checkpoint | task `CHECKPOINT` |

### 6.4 窄屏 / 低宽度布局

当宽度不足以显示右侧收纳面板时：

1. 结构面板改为底部抽屉或全屏覆盖层。
2. 顶部上下文栏保留当前 work / chapter / risk 三项，其他进入“运行详情”。
3. 对话流仍是默认首屏，不被结构面板覆盖。

### 6.5 对应原型 screen

| Screen frame | 必须体现 |
| --- | --- |
| `41§3-main-workbench` | 桌面默认三段式布局、对话主入口、右侧收纳默认折叠 |
| `41§6-narrow-workbench` | 窄屏时结构面板转底部 / 全屏覆盖，主对话仍优先 |
