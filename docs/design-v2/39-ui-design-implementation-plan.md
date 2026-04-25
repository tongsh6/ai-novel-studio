# UI Design Implementation Plan v2

> 状态：计划草案
>
> 角色：进入 UI 设计阶段前的执行计划与验收入口。
>
> 目标：把 `docs/design-v2/README.md` 中的 UI 设计清单转化为可执行顺序，确保 UI 文档与 `pencil` 原型严格投影 Foundation / Domain 已冻结 contract，不反向发明运行语义。

---

## 1. 计划定位

本文不是新增 UI contract，也不是替代 `40-ui-overview.md` 到 `47-ui-copy-guidelines.md`。

本文只回答 8 个问题：

1. UI 设计阶段从哪里开始
2. 进入 UI 前必须确认哪些输入
3. UI 文档按什么顺序写
4. `pencil` 原型按什么顺序做
5. 每个阶段消费哪些 Foundation / Domain / ADR 语义
6. 哪些内容 UI 不允许自行决定
7. 每个交付物的最低验收标准是什么
8. 如何判断 UI 设计没有偏离 v2 原始愿景

本文不负责：

- 页面最终视觉稿
- 组件最终样式
- 前端代码实现
- 运行时代码架构
- 新增 intent / status / card type / object schema

---

## 2. UI 阶段目标复述

v2 UI 的目标不是做一个后台管理界面，也不是做一个简单聊天窗口。

它要服务 `00-overview.md` §1 的核心定位：

> 一个以对话为主入口、以结构化状态为隐性内核、支持长篇连载创作全生命周期的小说创作 Agent 工作台。

因此 UI 必须同时满足三类要求：

1. **对话优先**：作者默认通过自然语言推动创作，不被表单压垮。
2. **结构兜底**：对象、状态、伏笔、时间线、adoption、projection 等结构能力必须可见、可解释、可校正。
3. **长篇可控**：长跑、预算、checkpoint、质量门、人工确认、阅读投影必须有稳定界面投影。

建议的设计心智模型是：

```text
作者创作驾驶舱
  = 对话主入口
  + Agent 运行状态
  + 结构化结果卡片
  + 可折叠作品结构
  + 阅读成品面
```

---

## 3. UI 不得反向驱动的硬约束

UI 阶段必须遵守以下边界：

1. UI 不得新增 intent namespace。
2. UI 不得新增 turn / task / artifact / adoption / projection 状态。
3. UI 不得新增 card type 或 action type。
4. UI 不得绕过 Agent intent / capability / adoption 直接写 authoritative state。
5. UI 不得把 tentative artifact 默认混入 reading projection。
6. UI 不得把 debug trace / provider raw output 作为主消息来源。
7. UI 如果需要新语义，必须先回到 ADR 或冻结包，而不是直接写进 UI 文档或原型；涉及硬骨变更时遵守 `README.md` §6「ADR 与决策纪律」。

同一语义只能有一个权威来源。UI 文档只能引用这些来源，不能复制后改写。

---

## 4. UI 设计前输入冻结包

### 4.1 已冻结输入

以下输入已经具备 UI 消费基础：

| 输入 | 权威来源 |
| --- | --- |
| TurnResult v2 顶层读取路径 | `adr/0001-turn-result-v2-schema.md` |
| turn / task / artifact 状态枚举 | `adr/0002-state-enums.md` |
| authority / budget / escalation 最小枚举 | `adr/0003-authority-budget-escalation.md` |
| volume / arc 关系 | `adr/0004-volume-arc-relation.md` |
| behavior-specific UI hint | `adr/0005-behavior-ui-hint.md` |
| card / action 最小 schema | `adr/0006-card-action-schema.md` |
| maintenance artifact / adoption card payload | `adr/0007-maintenance-artifact-schema.md` |
| 首批 UI intent 集合 | `adr/0008-first-batch-intents.md` |
| reading projection 对象最小字段 | `adr/0009-projection-object-schema.md` |
| 首批 UI intent slot schema | `adr/0010-first-batch-intent-slot-schema.md` |
| reading projection refresh 状态与触发 | `adr/0011-projection-refresh-state-triggers.md` |
| quality finding 最小 schema 与 UI 投影 | `adr/0012-quality-finding-ui-projection.md` |
| approval policy / record 最小 schema 与 UI 投影 | `adr/0013-approval-policy-record-ui-projection.md` |
| experience objects UI 投影与上下文边界 | `adr/0014-experience-ui-context-boundary.md` |
| 结构面板字段优先级与渐进披露 | `adr/0015-structure-panel-field-priority.md` |
| 统一命名与 namespace | `30-contract-glossary.md` |

### 4.2 UI 前 Blocking 项收口状态

`29-design-integrity-review.md` §7.1 曾将以下内容列为 UI 前 Blocking 项。它们不得被降级为普通 deferred 项；当前已通过 ADR-0012 到 ADR-0015 收口为可被 UI 消费的最小 contract。

完整算法、完整数据库字段、UI 文案和视觉细节仍可 deferred；但 UI 文档不得再自行改写这些 ADR 已冻结的字段、枚举和边界。

1. `quality finding` 最小 UI 投影字段、默认 severity / action 与 adoption / checkpoint 映射：已由 ADR-0012 冻结，影响 `42-card-system.md`、`46-state-and-feedback.md`。
2. `approval_policy` / `approval_record` 最小 UI 投影字段、`risk_class` 与 bypass policy 边界：已由 ADR-0013 冻结，影响 `42-card-system.md`、`45-guided-conversation-flows.md`、`46-state-and-feedback.md`。
3. `experience_evidence` / `experience_artifact` / `experience_rule` 的 UI 呈现边界，以及进入 context assembly 的控制规则：已由 ADR-0014 冻结，影响 `43-structure-panel.md`、`46-state-and-feedback.md`。
4. 首批结构面板对象的字段优先级与渐进披露规则：已由 ADR-0015 冻结，影响 `43-structure-panel.md` 与 `pencil` 原型结构面板画面。

这些输入的领域来源分别是：

- `31-novel-quality-gates.md`
- `32-human-approval-policy.md`
- `33-experience-engine.md`
- `34-novel-element-field-priority.md`

最低冻结结果：

| 阻塞输入 | 冻结 ADR | UI 可继续设计的范围 |
| --- | --- | --- |
| quality finding UI 投影 | ADR-0012 | 可设计 quality warning / finding card，但不得新增 `quality_finding.action` 或 runtime `NextAction` |
| approval policy / record UI 投影 | ADR-0013 | 可设计 approval flow，但不得绕过 approval / adoption / authority / revision 边界 |
| experience UI 投影 | ADR-0014 | 可展示 experience 面板和反馈入口，但 evidence/artifact/rule 三类对象必须区分 |
| 结构面板字段优先级 | ADR-0015 | 可设计结构面板和原型，但不得自造对象类型、字段语义或巨型表单 |

---

## 5. 总体执行顺序

UI 设计阶段按以下顺序执行：

```text
39-ui-design-implementation-plan
  -> Pre-freeze: ADR-0012/0013/0014/0015 已完成
  -> 40-ui-overview
  -> 41-workbench-layout
  -> 42-card-system
  -> 43-structure-panel
  -> 44-reading-mode
  -> 45-guided-conversation-flows
  -> 46-state-and-feedback
  -> 47-ui-copy-guidelines
  -> docs/ui-design/novel-studio-v2.pen
```

原则：

1. ADR-0012/0013/0014/0015 已完成 31/32/33/34 的最小 UI 投影冻结，后续 UI 文档必须引用这些 ADR。
2. 先定义 UI 总原则，再定义布局。
3. 先定义卡片系统，再定义具体流程。
4. 先定义结构面板的数据边界，再画结构面板。
5. 先定义阅读投影语义，再画阅读模式。
6. 文档先于 `pencil` 原型。
7. 原型必须能回链到文档章节。

### 5.1 Pre-freeze 完成判据

Pre-freeze 已完成：§4.2 中 4 个阻塞输入已分别升格为 ADR-0012 / ADR-0013 / ADR-0014 / ADR-0015。

进入 `42-card-system.md`、`43-structure-panel.md`、`45-guided-conversation-flows.md` 或 `46-state-and-feedback.md` 时，必须直接引用对应 ADR；如果 UI 文档或原型需要新增字段、状态、card type、action type 或对象语义，必须先回到 ADR 流程。

---

## 6. UI 文档交付计划

### 6.1 `40-ui-overview.md`

目标：定义 UI 总原则与边界。

必须覆盖：

- 对话优先
- 结构面板默认隐藏
- 工作台不是后台系统
- 阅读模式与创作模式分离
- UI 只投影 contract，不发明运行语义

最低验收：

1. 明确引用 `00-overview.md` 的核心定位。
2. 明确引用 `README.md` §5 的 UI 阶段要求。
3. 明确列出 UI 不得反向驱动的边界。

### 6.2 `41-workbench-layout.md`

目标：定义主工作台布局。

建议主结构：

```text
顶部上下文栏
  - 当前 work / volume / chapter / mode
  - long-run / budget / risk 摘要

主区域
  - 对话流
  - 结果卡片流

右侧或底部可折叠区域
  - 结构面板
  - 长跑任务
  - 维护结果
```

最低验收：

1. 主入口必须是对话流。
2. 结构面板不得默认压过对话。
3. long-run、checkpoint、budget 必须有位置。
4. debug / trace 不进入主消息。

### 6.3 `42-card-system.md`

目标：定义 UI 卡片体系。

必须覆盖：

- clarification card
- confirmation card
- warning card
- checkpoint card
- tentative artifact card
- adoption card
- long-run progress card

以上名称是 UI 场景名称，不是新的 `card_type`。

`42-card-system.md` 必须使用 ADR-0006 §3 的 canonical `card_type`：

| UI 场景 | canonical `card_type` | payload / refs 来源 |
| --- | --- | --- |
| clarification card | `clarification_card` | ADR-0005 behavior hint；`refs.behavior_id` |
| confirmation card | `confirmation_card` | ADR-0005 behavior hint；approval policy 如涉及 Domain 风险 |
| warning card | `warning_card` | validation / quality finding / projection stale / policy warning |
| checkpoint card | `checkpoint_card` | long-run task / checkpoint refs |
| tentative artifact card | `result_card` 或 `adoption_card` | artifact refs；需要决策时用 `adoption_card` |
| adoption card | `adoption_card` | ADR-0007 maintenance/adoption payload；artifact refs |
| long-run progress card | `progress_card` | task refs；budget / progress snapshot |
| quality finding 场景 | `warning_card`、`failure_card`、`checkpoint_card` 或 `adoption_card` | `31` 的 quality finding freeze；不得新增 `quality_finding_card` |
| approval 场景 | `confirmation_card`、`escalation_card`、`adoption_card` 或 `warning_card` | `32` 的 approval freeze；不得新增 `approval_card` |
| projection stale / refresh 场景 | `warning_card`、`progress_card` 或 `failure_card` | ADR-0009 / ADR-0011 projection refs；不得新增 `projection_card` |

最低验收：

1. 每类卡片必须说明对应的 contract 来源。
2. 不得新增 ADR-0006 之外的 card / action 基础语义。
3. 卡片状态必须来自 TurnResult、task state、artifact state、adoption state 或 projection state。
4. 必须特别避免用 UI 自造的 `card.status` 替代 contract 状态。
5. 若某个 UI 场景无法映射到 ADR-0006 canonical `card_type`，必须停止并走 README §6 的 ADR 流程，不能在 UI 文档中临时命名。

### 6.4 `43-structure-panel.md`

目标：定义隐藏结构能力如何逐步显示。

首批结构面板建议包括：

- Work 概览
- Volume / Chapter 树
- Character 简表
- Foreshadowing 列表
- Timeline / State snapshot
- Style / Writing preferences
- Long-run tasks

最低验收：

1. 字段优先级必须引用 `34-novel-element-field-priority.md`。
2. 面板只提供查看、跳转、发起 correction / adoption，不直接绕过 Agent 写 authoritative state。
3. 必须区分 authoritative、accepted、tentative、pending adoption。
4. 不把小说要素清单变成一次性大表单。
5. `foreshadowing`、`timeline_event`、`state_snapshot`、`worldrule` 等子类型未冻结的部分只能作为 placeholder 或自由标签展示，不得由 UI 自造枚举。

### 6.5 `44-reading-mode.md`

目标：定义阅读模式。

必须覆盖：

- reading projection root / toc / chapter / recap
- accepted-first 原则
- stale / refresh 状态
- tentative preview 的显式入口
- 从阅读态跳回创作态

最低验收：

1. 默认只消费 accepted / authoritative source。
2. projection status 必须使用 ADR-0011 的 `FRESH` / `STALE` / `REBUILDING` / `FAILED`。
3. stale 不等于不可读，UI 必须能显示旧投影仍可读。
4. tentative preview 不得混入默认阅读模式。
5. tentative preview 的入口必须引用明确 contract 来源；如果没有来源，只能在 `44` 中标为 deferred，不得画成完整交互。

### 6.6 `45-guided-conversation-flows.md`

目标：定义引导式对话流程。

首批流程：

1. 立项引导
2. 新卷 / 新章规划
3. 风格样本导入
4. 长跑启动前确认

最低验收：

1. 每条流程必须绑定 ADR-0008 的 intent。
2. 每条流程的必填信息必须来自 ADR-0010 的 slot schema。
3. 缺必填 slot 时进入 clarification，不允许 UI 自行执行。
4. 高风险或高预算路径必须进入 confirmation / checkpoint。

### 6.7 `46-state-and-feedback.md`

目标：定义状态与反馈。

必须覆盖：

- loading
- streaming
- waiting user
- confirmation required
- adoption pending
- checkpoint
- failed / retry
- resumed
- completed
- budget warning
- quality warning

最低验收：

1. 每个状态都要说明来源字段。
2. 不能只靠颜色表达状态。
3. 长跑任务必须显示进度、预算、风险和 checkpoint 原因。
4. 失败态必须区分 retry、correction、discard、ask user。

### 6.8 `47-ui-copy-guidelines.md`

目标：定义 UI 文案规范。

必须覆盖：

- 对话内系统语气
- 卡片标题
- 按钮文案
- 风险提示文案
- confirmation 与 adoption 的区别
- checkpoint 解释文案

最低验收：

1. 文案要像可靠编辑助手，不像客服机器人。
2. 必须让作者知道当前动作是“确认方向”还是“采纳为权威状态”。
3. 风险提示必须说明影响范围和可选动作。

---

## 7. `pencil` 原型交付计划

### 7.1 原型文件

建议文件：

```text
docs/ui-design/novel-studio-v2.pen
```

如果后续拆分多个 `.pen` 文件，必须保留一个总装配文件作为入口。

### 7.2 最小画面集合

原型至少包含 8 个画面：

1. 主工作台主视图
2. 长跑启动确认
3. checkpoint 暂停态
4. tentative adoption
5. 结构面板展开态
6. 阅读模式
7. 立项引导流
8. 新卷 / 新章工作流

### 7.3 原型制作顺序

```text
组件基线
  -> 主工作台
  -> 卡片状态组
  -> 结构面板
  -> 阅读模式
  -> 引导式流程
  -> 异常 / 失败 / checkpoint 状态
```

### 7.4 文档回链规范

每个顶层 screen frame 必须能回链到对应 UI 文档章节。

建议命名格式：

```text
<doc-id>§<section>-<screen-name>
```

示例：

```text
41§3-main-workbench
42§4-adoption-card-states
43§5-structure-panel-expanded
44§3-reading-mode-stale
45§2-work-seed-guided-flow
46§6-checkpoint-feedback
```

要求：

1. 每个 screen frame 的 `name` 必须包含文档编号与章节号。
2. 如果一个画面覆盖多个文档章节，用 frame 内 note/context 节点记录额外引用。
3. 原型中的交互说明不得只写在视觉旁注里，必须能回链到 `40`-`47` 文档正文。
4. 如果画面使用 blocked placeholder，frame name 中必须包含 `blocked`，并在 note/context 中写明被哪个 §4.2 阻塞输入卡住。

### 7.5 Pencil 验证策略

当前本机 Pencil MCP 已验证可以：

- 打开 `.pen` 文档
- 读取 editor state 与 schema
- 写入节点
- 读取节点结构

但截图渲染链路可能不稳定。因此原型验证采用三层：

1. `snapshot_layout` 检查布局问题。
2. `batch_get` 检查节点层级和文本内容。
3. 必要时在 VS Code / Pencil 侧人工确认画布截图。

如果 Pencil MCP 或截图链路临时不可用，UI 阶段不得因此跳过原型语义验证。最低兜底方式是：

1. 先用 Markdown ASCII layout 和状态表描述画面结构。
2. 保留 `docs/ui-design/novel-studio-v2.pen` 作为最终 source of truth 的目标文件。
3. 在 Pencil 恢复后补齐 `.pen` frame，并按 §7.4 回链到文档章节。
4. 兜底稿不能替代最终 `.pen` 交付，只能作为短期 unblock 产物。

---

## 8. 跨文档追溯矩阵

每份 UI 文档都必须维护自己的“语义来源”小节。最低追溯关系如下：

| UI 交付物 | 必须追溯到 |
| --- | --- |
| `40-ui-overview.md` | `00-overview.md`、`README.md`、`01-agent-foundation-contract.md` |
| `41-workbench-layout.md` | `11-ux-contract.md`、`28-authoring-lifecycle.md`、ADR-0001 |
| `42-card-system.md` | `11-ux-contract.md`、ADR-0001、ADR-0005、ADR-0006、ADR-0007 |
| `43-structure-panel.md` | `21-novel-object-model.md`、`22-continuity-model.md`、`34-novel-element-field-priority.md` |
| `44-reading-mode.md` | `27-reading-projection.md`、ADR-0009、ADR-0011 |
| `45-guided-conversation-flows.md` | `24-novel-intent-catalog.md`、`28-authoring-lifecycle.md`、ADR-0008、ADR-0010 |
| `46-state-and-feedback.md` | `02-turn-and-task-state-machines.md`、`03-conversation-behaviors.md`、ADR-0002、ADR-0003 |
| `47-ui-copy-guidelines.md` | `03-conversation-behaviors.md`、`32-human-approval-policy.md`、`11-ux-contract.md` |
| `novel-studio-v2.pen` | `40`-`47` 全部 UI 文档 |

---

## 9. 完成定义

UI 设计阶段只有同时满足以下条件，才算完成：

0. §4.2 的 4 个阻塞输入已经通过来源文档冻结小节或 ADR 完成收口，并被 `42` / `43` / `45` / `46` 引用；不存在被降级为普通 deferred 的 29 §7.1 Blocking 项。
1. `40`-`47` 全部文档存在。
2. 每份文档都有“语义来源”和“不负责范围”。
3. 每份文档没有新增 Foundation / Domain 未定义的运行语义。
4. 每个关键状态机都有 UI 投影说明。
5. 每类关键卡片都有 contract 来源，且能映射到 ADR-0006 canonical `card_type`。
6. 每个首批引导流程都能映射到 ADR-0008 intent 与 ADR-0010 slot。
7. `docs/ui-design/novel-studio-v2.pen` 覆盖最小 8 个画面。
8. 原型画面能按 §7.4 回链到对应文档章节。
9. 不存在“文档里有状态，原型里没体现”的断层。
10. 不存在“原型里有交互，Foundation / Domain 没定义语义”的越界。

---

## 10. 推荐下一步

下一步先补 §4.2 的 UI 前冻结小节，然后写 `40-ui-overview.md`。

理由：

1. `31` / `32` / `33` / `34` 当前已有 UI 投影描述，但还不足以作为 UI 阶段的冻结输入。
2. 先补冻结小节，`42` / `43` / `45` / `46` 才不会在卡片、审批、经验、结构面板上反向发明语义。
3. 完成冻结后，`40-ui-overview.md` 作为所有 UI 文档的共同原则来源，可以固定“对话优先、结构隐藏、阅读分离、UI 不反向驱动”的边界。

完成 `40-ui-overview.md` 后，再进入 `41-workbench-layout.md` 和 `42-card-system.md`。这两份文档决定主工作台和卡片系统，是后续结构面板、阅读模式和引导流的基础。
