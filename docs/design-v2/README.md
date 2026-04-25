# design-v2 文档路线图

> 状态：草案
>
> 目的：把 v2 的全部设计工作组织成一套明确的交付顺序。原则是先完成 Agent 与小说领域设计，再进入 UI 设计；UI 设计必须同时产出文档和 `pencil` 原型文件。
>
> 当前共识补充：v2 的代码实现不以“兼容现有项目代码结构”为前提，可以从头开始重做；现有仓库代码与文档最多作为参考资料，而不是迁移约束。

---

## 1. 总目标

v2 的总体目标分两段完成：

### 第一段：完成系统设计

先把以下内容全部设计清楚并文档化：

- Agent Foundation Layer
- Novel Domain Layer
- 演化治理
- 迁移策略
- 运行时、副作用、一致性、记忆缩减

这一步的完成标准不是“有一个总纲”，而是：

- 关键硬骨都有独立 contract
- 各模块之间依赖方向清楚
- 状态机、对象、intent、hook、budget、observability 都有明确边界
- 从 v1 到 v2 的迁移路径可说明
 
补充说明：

- 当前阶段的“设计完成”不以现有代码迁移方案为完成条件。
- 现有代码层可以整体重做。
- 旧代码的价值主要在于帮助识别已验证过的交互、协议和边界，不构成 v2 的实现包袱。

### 第二段：完成 UI 设计

在系统设计冻结到足够稳定后，再做 UI 设计。

UI 设计的产物必须同时包含：

- UI 设计文档
- `pencil` 原型文件

UI 不提前拍脑袋决定交互结构，而是严格映射前一阶段已经冻结的：

- canonical result
- card protocol
- confirmation / clarification / checkpoint / adoption 语义
- long-run task 状态
- 结构面板对象视图
- 阅读模式投影规则

---

## 2. 文档分区

v2 文档按三层组织：

```text
docs/design-v2/
  A. Foundation：通用 Agent 基础层
  B. Domain：小说业务层
  C. UI：界面层与交互层
```

顺序固定：

```text
Foundation -> Domain -> UI
```

禁止反向驱动：

- 不允许因为某个 UI 想法去改写 Foundation 硬骨。
- 不允许在 Domain contract 未定时先画完成态 UI。
- UI 可以提出约束反馈，但只能作为新 ADR 输入，不能直接越过 contract。

---

## 3. 第一阶段：Foundation 设计清单

这一阶段回答“一个完整的 Agent 到底要有哪些硬骨”。

### F-00 已完成

- `00-overview.md`

### F-01 到 F-12 计划文档

1. `01-agent-foundation-contract.md`
   - Foundation 总边界
   - 子系统依赖关系
   - Layer 1 对 Layer 2 的开放接口

2. `02-turn-and-task-state-machines.md`
   - turn / clarification / confirmation / long-run / tentative 的状态机
   - phase 与 status 映射
   - 终态、恢复、中断

3. `03-conversation-behaviors.md`
   - clarification / confirmation / rejection / cancellation / correction
   - 用户可见语义
   - API 与日志语义

4. `04-capability-and-intent-registry.md`
   - capability registry
   - intent registry
   - router / executor / validator 边界

5. `05-memory-retention-and-retrieval.md`
   - 记忆分层
   - 冷热数据分离
   - summary / retrieval / replay contract
   - interaction log 归档规则

6. `06-planning-and-long-run.md`
   - long-run task
   - checkpoint
   - retry / cancel / resume / branch
   - tentative artifact 生命周期

7. `07-consistency-and-concurrency.md`
   - revision / version stamp
   - optimistic lock 或 lease
   - rebase / invalidation / conflict policy

8. `08-provider-abstraction.md`
   - provider 接口
   - usage 计量
   - provider error 标准化

9. `09-observability-and-audit.md`
   - trace
   - metrics
   - structured logs
   - replay
   - audit

10. `10-security-and-budget.md`
    - prompt injection 边界
    - 权限与确认
    - token / 时长 / 成本 / 写入规模预算

11. `11-ux-contract.md`
    - canonical cards
    - render modes
    - streaming / interruption events
    - UI 层消费 contract

12. `12-multi-agent-composition.md`
    - agent identity
    - message envelope
    - parent-child budget / authority
    - artifact handoff

### Foundation 阶段完成标准

必须同时满足：

1. 所有 Layer 1 子系统都有独立文档。
2. 所有高风险未决问题都有 ADR 或明确 deferred 说明。
3. `00-overview.md` 中的 Layer 1 条目都已有落点。
4. 能画出一个不带小说术语的通用 Agent 运行图。

---

## 4. 第二阶段：Domain 设计清单

这一阶段回答“小说这个领域如何使用 Agent 基础能力”。

### D-01 到 D-14 计划文档

1. `20-novel-domain-overview.md`
   - 小说领域整体边界
   - 生命周期、时序、风格三大维度

2. `21-novel-object-model.md`
   - work / volume / chapter / scene / draft / character 等对象
   - id、关系、锚点、生命周期

3. `22-continuity-model.md`
   - state_snapshot
   - timeline_event
   - foreshadowing
   - worldrule
   - chapter_summary

4. `23-style-and-author-intent.md`
   - style_sample
   - writing_preferences
   - brief
   - 在线反馈补丁机制

5. `24-novel-intent-catalog.md`
   - 立项族
   - 世界观族
   - 主线族
   - 分卷族
   - 章节族
   - 场景族
   - 正文族
   - 改稿族
   - 人物族
   - 风格族
   - 长跑族
   - 阅读族
   - 维护族

6. `25-maintenance-hooks.md`
   - 默认 post-hook
   - adoption contract
   - maintenance validator

7. `26-context-assembly-policy.md`
   - Router / Executor / LongRunner / Reader 各自的上下文组装
   - RAG 与结构化对象的组合顺序

8. `27-reading-projection.md`
   - 阅读模式投影
   - accepted / tentative 边界
   - 目录与正文投影规则

9. `28-authoring-lifecycle.md`
   - 从立项到阅读的全生命周期流程
   - 建立期、推进期、连载期、修订期

10. `30-contract-glossary.md`
    - Foundation / Domain 共享字段名
    - revision / adoption / authority / namespace 规则
    - 跨文档漂移收口

11. `31-novel-quality-gates.md`
    - 小说领域质量门禁目录
    - 连续性、人物、节奏、爽点、hook、战力、留存等 gate
    - gate 与 validator / adoption / long-run 的关系

12. `32-human-approval-policy.md`
    - 作者确认策略
    - 高风险 canon 变更与人工审批节点
    - confirmation / adoption / checkpoint 的领域映射

13. `33-experience-engine.md`
    - 作者修改、采纳、否决、质量结果的经验沉淀
    - experience evidence / artifact / rule
    - 经验如何反哺上下文、风格与策略

14. `34-novel-element-field-priority.md`
    - 小说要素清单的结构化优先级
    - 必须结构化 / 半结构化 / 文档层的落位规则
    - 要素到 Domain object、quality gate、experience 的映射

### Domain 阶段完成标准

必须同时满足：

1. 小说对象、intent、hook、上下文组装已成体系。
2. 长连载连续性有明确 contract，不依赖 prompt 自觉。
3. 可画出“用户一句话 -> Agent -> 对象更新 -> 阅读投影”的全链路。
4. UI 团队不需要再猜“这个卡片到底在表达什么状态”。

---

## 5. 第三阶段：UI 设计清单

这一阶段回答“用户怎么用这个系统，而且用起来不重”。

前提：

- Foundation 与 Domain 的硬骨已经足够稳定。
- canonical result、card protocol、state machine、long-run 行为已经冻结到可以投影为界面。

### UI 执行入口

进入具体 UI 文档前，先阅读并执行：

- `39-ui-design-implementation-plan.md`
  - UI 设计实施顺序
  - UI 前输入冻结包
  - `40`-`47` 文档验收标准
  - `pencil` 原型交付与验证策略

该文档不新增 UI contract，只负责把 Foundation / Domain / ADR 已冻结语义组织成 UI 阶段的执行计划，防止 UI 反向发明 intent、状态、card type 或对象语义。

### UI 文档

建议采用以下编号：

1. `40-ui-overview.md`
   - UI 核心原则
   - 默认主工作台
   - 结构面板默认隐藏
   - 阅读模式定位

2. `41-workbench-layout.md`
   - 主工作台布局
   - 对话流
   - 结果卡片流
   - 顶栏上下文
   - 右侧抽屉 / 底部面板策略

3. `42-card-system.md`
   - clarification card
   - confirmation card
   - warning card
   - checkpoint card
   - tentative artifact card
   - adoption card
   - long-run progress card

4. `43-structure-panel.md`
   - 世界观 / 卷树 / 章节树 / 人物 / 伏笔 / 时间线 / 风格偏好 / 长跑任务
   - 查看与编辑的交互规则

5. `44-reading-mode.md`
   - 阅读模式布局
   - 目录导航
   - 创作态跳转
   - 预览 tentative 的方式

6. `45-guided-conversation-flows.md`
   - 立项引导
   - 新卷引导
   - 风格样本导入
   - 长跑启动前确认

7. `46-state-and-feedback.md`
   - loading / streaming / paused / failed / resumed / completed
   - 错误反馈
   - 解释性反馈

8. `47-ui-copy-guidelines.md`
   - 对话内系统语气
   - 卡片标题与按钮文案
   - 风险提示文案

### UI 原型

必须同步产出 `pencil` 文件，至少包含：

1. 主工作台主视图
2. 长跑启动确认
3. checkpoint 暂停态
4. tentative adoption
5. 结构面板展开态
6. 阅读模式
7. 立项引导流
8. 新卷 / 新章工作流

建议文件：

- `docs/ui-design/novel-studio-v2.pen`

如果拆分多文件，也要保留一个总装配文件。

### UI 阶段完成标准

必须同时满足：

1. 每份 UI 文档都有对应页面或组件原型。
2. 所有关键状态机都有 UI 投影。
3. 不存在“文档里有状态，原型里没体现”的断层。
4. 不存在“原型里有交互，Foundation / Domain 没定义语义”的越界。

---

## 6. ADR 与决策纪律

从现在开始，新增或修改硬骨必须进入 `docs/design-v2/adr/`。

建议规则：

- Foundation 硬骨：必须 ADR
- Domain 核心对象与连续性机制：必须 ADR
- UI 仅表现层微调：可不写 ADR
- UI 若反向要求 contract 变更：必须先写 ADR 再改 Foundation / Domain 文档

---

## 7. 当前执行顺序

从现在开始的实际写作顺序建议如下：

1. `01-agent-foundation-contract.md`
2. `05-memory-retention-and-retrieval.md`
3. `06-planning-and-long-run.md`
4. `07-consistency-and-concurrency.md`
5. `12-multi-agent-composition.md`
6. 其余 Foundation 文档
7. 全部 Domain 文档
8. 全部 UI 文档
9. `pencil` 原型

之所以把 `memory`、`long-run`、`consistency` 提前，是因为这几项决定了系统能不能真的支撑长期连载，而不是只在总纲里成立。

实现前备注或迁移策略不占用 Foundation 子系统编号；若后续需要单独成文，必须同步更新本文档清单与 `00-overview.md` §8.3。

---

## 8. 当前共识

当前已经明确的共识如下：

1. 先做完整设计，再做 UI 设计。
2. UI 设计必须有文档。
3. UI 设计必须有 `pencil` 原型文件。
4. 主工作台以对话为主，结构面板默认隐藏。
5. 小说业务不能反向污染 Agent Foundation。
6. 代码实现可以从头开始，现有仓库仅作为参考，不作为迁移目标。
