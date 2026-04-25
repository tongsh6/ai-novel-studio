# 45 Guided Conversation Flows

> 状态：草案
>
> 角色：定义基于 Intent 系统的引导式对话流程。

---

## 1. 语义来源

本文提及的引导流和槽位约束来源于：

- `../24-novel-intent-catalog.md`：小说领域的意图目录。
- `../28-authoring-lifecycle.md`：创作周期的阶段划分。
- `../adr/0008-first-batch-intents.md`：首批批准的 UI Intent 集合。
- `../adr/0010-first-batch-intent-slot-schema.md`：意图必需的槽位定义。
- `../adr/0013-approval-policy-record-ui-projection.md`：审批策略要求。

---

## 2. 不负责范围

- 不自造新意图，所有流程必须从 ADR-0008 中寻找对应。
- 不自造意图所需的信息字段，必须依赖 ADR-0010 提供的 Slots。

---

## 3. 引导流程设计心智

引导流（Guided Flows）是指当作者触发某个关键意图（如“我想开本新书”）时，UI 配合底层的槽位校验逻辑，以多轮对话和卡片的形式，自然地引导作者补齐必填信息，确认风险，然后开始执行。

**核心机制：**
- 匹配 Intent (ADR-0008) -> 检查必备 Slots (ADR-0010) -> 如果缺失，返回 Clarification Card 索要信息 -> 信息齐全，评估风险 -> 高风险出 Confirmation Card / Checkpoint -> 执行。

---

## 4. 首批核心流程定义

### 4.1 立项引导 (Work Seed Flow)
- **触发意图**：项目初始化/创建新书。
- **必要槽位**：书名、核心卖点、目标受众、基础世界观方向。
- **UI 表现**：
  - 若作者只说“开本新书”，系统需以编辑口吻抛出 Clarification Card，分步询问核心卖点等。
  - 完成后，生成项目确认卡（Confirmation），列出立项参数并要求确认。

| 中文呈现 | ADR-0010 slot | requiredness | 缺失时 |
| --- | --- | --- | --- |
| 题材 / 类型 | `genre` | required_to_execute | clarification |
| 核心卖点 | `core_selling_point` | required_to_execute | clarification |
| 目标读者 | `target_reader` | required_to_execute | clarification |
| 语气偏好 | `tone_preference` | optional_preference | 不单独追问 |
| 参考作品 | `reference_works` | optional_preference | 不单独追问 |

### 4.2 新卷 / 新章规划 (Volume/Chapter Planning Flow)
- **触发意图**：新增卷/章。
- **必要槽位**：对应上一级的关联、本卷/章核心冲突或目标、预计字数/节奏。
- **UI 表现**：
  - 根据 ADR-0010，若缺失核心冲突，系统追问。
  - 可能涉及预读取之前章节的伏笔或状态作为上下文提示（在提示词或上下文中，不在必填表单里）。

| 中文呈现 | ADR-0010 slot | requiredness | 缺失时 |
| --- | --- | --- | --- |
| 作品引用 | `work_ref` | required_to_execute | 可从当前 work 高置信推断；冲突时 clarification |
| 目标卷 | `volume_ref` | required_to_execute | clarification 或从当前卷推断 |
| 目标章节 | `chapter_ref` | required_to_execute | clarification 或从当前章节推断 |
| arc 分组 | `arc_ref` / `arc_refs` | optional_preference | 不单独追问 |
| 大纲深度 | `outline_depth` | optional_preference | 使用默认策略 |
| 场景边界 | `scene_boundary` | required_to_execute（场景流程） | clarification |

### 4.3 风格样本导入 (Style Sample Injection Flow)
- **触发意图**：提供文风参考。
- **必要槽位**：文本样本、作者希望提取的风格特征（选填或系统推断）。
- **UI 表现**：
  - 接收大量文本后，系统进入提取分析态，返回含有提取出的风格标签卡片，请求作者确认（Confirmation）。

| 中文呈现 | ADR-0010 slot | requiredness | 缺失时 |
| --- | --- | --- | --- |
| 风格样本来源 | `style_sample_source` | required_to_execute | clarification |
| 偏好范围 | `preference_range` | required_to_execute | clarification |
| 风格适用范围 | `style_scope` | optional_preference | 可后续补充 |

### 4.4 长跑启动前确认 (Long-run Pre-flight Confirmation)
- **触发意图**：启动批量生成、推演等高预算操作。
- **UI 表现**：
  - 此路径属于高风险/高预算路径。
  - **必须**在执行前抛出包含预算预估、目标范围、预期输出的 Confirmation Card。
  - 只有明确点击确认，才能放行进入长跑。

| 中文呈现 | ADR-0010 slot | requiredness | 缺失时 |
| --- | --- | --- | --- |
| 续写 / 推演范围 | `continuation_range` | required_to_execute | clarification |
| checkpoint 条件 | `checkpoint_condition` | required_to_execute（RUN_UNTIL_CHECKPOINT） | clarification |
| checkpoint 间隔 | `checkpoint_interval` | optional_preference | 使用默认策略 |
| 目标字数 | `target_word_count` | optional_preference | 不单独追问 |
| 最大预算提示 | `max_budget_hint` | optional_preference | 无则系统估算后 confirmation |

---

## 5. 验收标准约束

1. 每条梳理的引导流必须绑定到 ADR-0008 明确定义的 intent。
2. 流程中的必填信息收集必须严格对应 ADR-0010 的 slot schema。
3. 槽位缺失时必须通过 Clarification 卡片或对话流索要，决不允许 UI 直接生成默认假数据执行。
4. 明确高风险或高预算的路径必须挂载 Confirmation 或 Checkpoint 阻断。
