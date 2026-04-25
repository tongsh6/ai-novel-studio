# UI Overview v2

> 状态：草案
>
> 角色：UI 阶段的共同原则文档。后续 `41`-`47` 与 `novel-studio-v2.pen` 必须引用本文，不得反向发明 Foundation / Domain 语义。
>
> 上游计划：`../39-ui-design-implementation-plan.md`

---

## 1. 文档定位

本文回答 9 个问题：

1. v2 UI 的核心心智模型是什么
2. 主工作台默认长什么样
3. 为什么对话是主入口，但卡片和结构仍是一等能力
4. 结构面板为什么默认隐藏
5. 阅读模式与创作模式如何分离
6. UI 可以决定什么，不能决定什么
7. 后续 `41`-`47` 应如何继承本文原则
8. Pencil 原型应如何体现这些原则
9. UI 面向的语言与作者群体是什么

本文不负责：

- 具体页面栅格尺寸
- 组件视觉样式全集
- 动画、字体、颜色最终方案
- 新增 intent / status / card type / action type / object schema
- 替代 ADR、Foundation 或 Domain contract

---

## 2. 语义来源

本文只投影以下已存在 contract：

| 来源 | 本文消费的语义 |
| --- | --- |
| `../00-overview.md` §1 / §2.2 / §2.3 / §2.5 | 核心定位、对话优先、结构兜底、结构面板默认隐藏、长跑透明 |
| `../README.md` §5 | UI 阶段目标、UI 文档和 Pencil 原型交付要求 |
| `../39-ui-design-implementation-plan.md` §2 / §3 / §4 / §6 | UI 阶段执行顺序、不得反向驱动边界、冻结输入包、40 验收标准 |
| `../11-ux-contract.md` §2 / §4 / §5 | UI 只能投影运行语义、assistant message 与 ui_cards、render mode |
| `../00b-end-to-end-flow.md` §2-§5 | 用户输入到 adoption / projection 的主链路 |
| `../00e-architecture.md` §2A / §2B | Workbench / Reading View / Structure Panel 的运行时位置 |
| ADR-0001 | TurnResult v2 顶层读取路径 |
| ADR-0002 | turn / task / artifact phase、status、next_action |
| ADR-0006 | canonical card / action schema |
| ADR-0007 | maintenance artifact 与 adoption card payload |
| ADR-0011 | reading projection refresh 四态 |
| ADR-0012 | quality finding UI 投影 |
| ADR-0013 | approval policy / record UI 投影 |
| ADR-0014 | experience objects UI 边界 |
| ADR-0015 | structure panel 字段优先级与渐进披露 |

---

## 3. UI 核心定位

v2 UI 服务的核心产品定义是：

> 一个以对话为主入口、以结构化状态为隐性内核、支持长篇连载创作全生命周期的小说创作 Agent 工作台。

因此 UI 不是：

- 简单聊天窗口
- 后台管理系统
- 大纲表格编辑器
- Prompt 面板
- 调试 trace 浏览器

UI 是：

```text
作者创作驾驶舱
  = 对话主入口
  + Agent 运行状态
  + 结构化结果卡片
  + 可折叠作品结构
  + 阅读成品面
```

这意味着默认体验要轻，但系统能力不能轻。作者应该像和可靠编辑助手对话一样推进创作；当需要确认、采纳、处理风险、恢复长跑或检查结构时，UI 必须把结构化能力显式露出来。

### 3.1 语言与作者约束

v2 UI 面向 **中文作者**，核心场景是 **中国网文 / 长篇连载创作**。

因此：

1. UI 主语言必须是中文。
2. 默认术语、按钮、卡片标题、风险提示、引导文案必须以中文作者能自然理解的表达为准。
3. 文案语气应像可靠的中文网文编辑 / 创作搭档，不像客服机器人、后台系统或英文产品直译。
4. 示例内容、流程命名和结构对象展示应优先贴合中国网文语境，例如立项、题材、卖点、爽点、伏笔、卷纲、章节、上架节点、长跑更新、读者留存等。
5. 可以在 contract、字段名、ADR 引用中保留英文 canonical 名称，但用户可见 UI 不应直接暴露英文内部枚举，除非它是开发 / debug 专用视图。

该约束适用于 `41`-`47`、`novel-studio-v2.pen` 以及所有导出图。

---

## 4. 设计方向

### 4.1 产品气质

建议采用 **editorial cockpit（编辑驾驶舱）** 方向：

- 编辑台：以创作文本和对话判断为中心
- 驾驶舱：持续暴露长跑、预算、风险、checkpoint 等运行状态
- 档案柜：结构对象存在，但默认收纳在侧边，不压迫主创作流
- 阅读室：accepted 内容进入干净阅读模式，和创作态分离

### 4.2 视觉关键词

后续视觉原型应围绕以下关键词展开：

- 克制、专注、长时间可用
- 文学编辑感，而不是 SaaS 后台感
- 卡片有明确层级，但不喧宾夺主
- 状态明确可解释，不只靠颜色
- 结构面板像“可展开的作品档案”，不是“必填表单”

### 4.3 可记忆点

v2 UI 最应该被记住的是：

> 作者一直在对话中创作，但随时能看见 Agent 正在维护的作品结构、风险与长跑状态。

---

## 5. 总体信息架构

UI 顶层分为三种模式：

| 模式 | 目标 | 默认入口 | 数据边界 |
| --- | --- | --- | --- |
| Workbench | 创作、规划、确认、采纳、长跑控制 | 对话流 | 消费 TurnResult / ui_cards / task refs / adoption state |
| Structure Panel | 查看、解释、跳转、发起 correction / adoption | 默认隐藏，可展开 | 消费 accepted / authoritative 对象、pending artifacts、quality / approval / experience refs |
| Reading Mode | 阅读 accepted projection | 从 Workbench 或目录进入 | 只消费 reading projection；默认不混入 tentative |

三者关系：

```text
Workbench（默认）
  -> 展开 Structure Panel（查看结构 / 风险 / 经验）
  -> 进入 Reading Mode（消费 accepted projection）
  -> 回到 Workbench（继续创作 / 修订）
```

UI 不应把三者做成互相竞争的主入口。默认主入口始终是 Workbench 的对话流。

---

## 6. 主工作台原则

### 6.1 对话优先

主工作台默认呈现：

1. 当前上下文：work / volume / chapter / mode
2. 对话流：作者输入与 assistant message
3. 结果卡片流：clarification / confirmation / warning / progress / adoption / checkpoint 等结构化卡片
4. 长跑摘要：预算、风险、checkpoint、pending artifacts
5. 可折叠结构入口：作品结构、维护结果、经验规则

对话优先不等于纯文本聊天。任何需要用户决策、采纳、恢复、重试或确认的状态，都必须用 card / panel 明确呈现。

### 6.2 卡片是一等对象

`assistant_message` 承载自然语言叙述；`ui_cards[]` 承载结构化操作和状态。

UI 不得把以下状态只藏在 assistant message 中：

- clarification
- confirmation
- checkpoint
- pending adoption
- failure / retry
- escalation required
- quality warning
- projection stale / failed

卡片系统的完整规范在 `42-card-system.md` 中定义；本文只规定其地位。

### 6.3 引导不是表单

当系统缺少执行所需 slot 时，UI 必须显式进入 clarification，但 clarification 不等于把 required slot 逐项做成输入框。

尤其在立项、新卷、新章等创作决策场景中，作者经常只有模糊意图，尚未想清楚类型、卖点、读者、卷目标或章节冲突。此时 UI 应让 Agent 先提供候选方向、对比方案和编辑建议，再把作者的选择整理为 draft slot / current parameters，最后通过 Confirmation Card 收束。

原则：

1. required slot 是执行前必须稳定的参数，不是作者必须一开始知道的答案。
2. Clarification Card 可以是候选方向卡、多方案对比卡或共同定位卡。
3. UI 不得绕过 slot schema 执行，也不得把探索阶段的候选值直接写入 authoritative state。
4. 作者明确知道答案时，可以直接口述或填写；作者不知道时，应由系统辅助归纳。

### 6.4 长跑透明

长跑任务必须在主工作台中有稳定位置，至少显示：

- estimated / consumed budget
- 当前 phase / status
- checkpoint reason
- pending artifact refs
- warnings / quality findings
- resume / cancel / branch 的可用性

长跑不能表现为“后台正在做一些事”。作者必须知道系统为什么暂停、继续会影响什么、当前有哪些待采纳产物。

---

## 7. 结构面板原则

### 7.1 默认隐藏

结构面板是能力，不是负担。默认工作台不显示大型结构表单。

默认只露出轻量入口，例如：

- 当前章节结构摘要
- pending adoption 数量
- 当前风险 / continuity warning 数量
- “打开作品结构”入口

### 7.2 渐进披露

结构面板遵守 ADR-0015 的 L1-L4 渐进披露：

| 层级 | UI 意义 |
| --- | --- |
| L1 概览 | 当前 work / volume / chapter / long-run / risk 摘要 |
| L2 列表 | volumes、chapters、characters、foreshadowings、worldrules、quality findings |
| L3 详情 | 单对象字段、source refs、revision、adoption status、related findings |
| L4 审计 / 来源 | source_revision_refs、approval records、experience evidence、trace refs |

### 7.3 不做巨型表单

结构面板不得把小说要素全集变成一次性填写表单。

允许：

- 查看 accepted / authoritative object
- 跳转到相关章节 / 场景 / 卡片
- 发起 correction / adoption / regeneration intent
- 显示 pending maintenance artifacts

不允许：

- 绕过 Agent 直接写 authoritative state
- 自造 object type 或字段语义
- 把 tentative artifact 默认显示为 canon
- 把 document memory 当作 authoritative constraint

完整结构面板规范在 `43-structure-panel.md` 中定义。

---

## 8. 阅读模式原则

### 8.1 阅读模式独立于创作态

Reading Mode 是 accepted projection 的消费面，不是另一个编辑器。

默认消费：

- `reading_projection_root`
- `reading_projection_toc`
- `reading_projection_chapter`
- `reader_recap`

默认不消费：

- tentative artifact
- debug trace
- provider raw output
- 未采纳 maintenance artifact
- 未采纳 experience artifact

### 8.2 Projection status 必须显式

Reading Mode 必须呈现 ADR-0011 的四态：

- `FRESH`
- `STALE`
- `REBUILDING`
- `FAILED`

`STALE` 不等于不可读；它表示当前阅读投影可读但不是最新 accepted source。UI 必须能解释“你正在读旧投影，系统建议刷新”。

### 8.3 Tentative preview 必须显式

如果后续需要预览未采纳版本，必须是显式 preview path，不能混入默认 Reading Mode。

完整阅读模式规范在 `44-reading-mode.md` 中定义。

---

## 9. UI 不得反向驱动的边界

UI 阶段必须遵守：

1. 不得新增 intent namespace。
2. 不得新增 turn / task / artifact / adoption / projection 状态。
3. 不得新增 card type 或 action type。
4. 不得绕过 Agent intent / capability / adoption 直接写 authoritative state。
5. 不得把 tentative artifact 默认混入 reading projection。
6. 不得把 debug trace / provider raw output 作为主消息来源。
7. 不得把 `quality_finding.action`、`approval_policy.default_behavior` 等 Domain decision enum 当作 runtime `NextAction`。
8. 不得把 UI 文案或按钮名写成新的 contract。
9. 如果需要新语义，必须先回到 ADR 或冻结包。

---

## 10. 后续 UI 文档继承规则

| 文档 | 必须继承本文哪些原则 |
| --- | --- |
| `41-workbench-layout.md` | 对话优先、卡片一等对象、长跑透明、结构默认隐藏 |
| `42-card-system.md` | 卡片只投影 ADR-0006 canonical card type，不新增基础语义 |
| `43-structure-panel.md` | ADR-0015 渐进披露、不做巨型表单、不直写 authoritative state |
| `44-reading-mode.md` | accepted projection only、projection 四态、tentative preview 显式化 |
| `45-guided-conversation-flows.md` | intent / slot 来自 ADR-0008 / ADR-0010，缺 slot 走 clarification；required slot 不等于作者表单 |
| `46-state-and-feedback.md` | 状态必须来源于 TurnResult / task / artifact / adoption / projection，不只靠颜色表达 |
| `47-ui-copy-guidelines.md` | 文案区分 confirmation 与 adoption、风险提示必须说明影响范围和可选动作 |

`47-ui-copy-guidelines.md` 还必须继承本文 §3.1：UI 主语言为中文，文案面向中国网文作者，不做英文产品直译。

---

## 11. 对应原型画面

本文对应 `novel-studio-v2.pen` 中的整体设计方向，不单独要求一个独立 screen。

但以下 screen 必须体现本文原则：

| Screen frame | 必须体现 |
| --- | --- |
| `41§3-main-workbench` | 对话主入口、结果卡片流、长跑摘要、结构入口默认收起 |
| `43§5-structure-panel-expanded` | 渐进披露，不是巨型表单 |
| `44§3-reading-mode-stale` | Reading Mode 与 Workbench 分离，STALE 可读但需提示 |
| `46§6-checkpoint-feedback` | checkpoint 原因、预算、pending artifact、可选动作明确 |

---

## 12. 最低验收

本文完成后，后续 UI 阶段必须满足：

1. `41`-`47` 都引用本文作为 UI 总原则来源。
2. 默认主入口是 Workbench 对话流。
3. Structure Panel 默认隐藏，仅按需展开。
4. Reading Mode 只消费 accepted projection，tentative preview 显式分离。
5. 所有状态、卡片、动作都有 Foundation / Domain / ADR 来源。
6. UI 不新增运行语义；新增语义必须回 ADR。
7. 所有用户可见 UI 文案以中文实现，并贴合中国网文创作语境。
