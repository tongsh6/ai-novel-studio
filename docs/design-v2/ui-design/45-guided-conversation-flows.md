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

### 3.1 必填 slot 不是作者表单

ADR-0010 的 `required_to_execute` 表示系统执行前必须获得稳定参数，不表示作者必须一开始就知道答案，更不表示 UI 应把流程设计成表单填写。

Guided Flow 的默认原则是：

1. 先让作者用自然语言表达模糊意图。
2. 系统根据上下文给出候选方向、选择题、对比方案或编辑建议。
3. 作者可以选择、排除、补充偏好，或要求系统“换一组”。
4. 系统把这些选择整理为 draft slot / current parameters。
5. 在执行前用 Confirmation Card 汇总为作者能理解的创作语言。

因此，Clarification Card 不应默认表现为空白输入框集合；它可以是：

- 候选方向卡
- 多方案对比卡
- “我先帮你拟 3 个方向”的建议卡
- 带有“更像 A / B / C”“都不对，换一组”“我补充偏好”的选择卡

只有当作者已经明确知道答案时，UI 才应允许直接填入或口述 slot 值。

---

## 4. 首批核心流程定义

### 4.1 立项引导 (Work Seed Flow)
- **触发意图**：项目初始化/创建新书。
- **必要槽位**：题材 / 类型、核心卖点、目标读者。
- **UI 表现**：
  - 若作者只说“开本新书”，系统需以编辑口吻进入共同定位，而不是直接要求作者填写表单。
  - 如果作者无法明确说出类型、核心卖点或目标读者，系统应提供可选择的方向、追问创作偏好，并把作者的模糊回答整理成候选 slot 值。
  - 完成后，生成项目确认卡（Confirmation），列出系统整理出的立项参数并要求确认。

#### 4.1.1 作者不清楚定位时的探索路径

ADR-0010 要求 `genre`、`core_selling_point`、`target_reader` 在执行前必须具备，但这不意味着 UI 必须把它们做成生硬表单。

对于新作者或尚未形成清晰定位的作者，立项引导必须支持“探索式补槽”：

```text
作者：我想开本新书，但还没想好具体方向。

系统：没问题，我们先不用急着定死。你可以先告诉我更接近哪一种感觉：
  A. 升级变强，主角一路破局
  B. 悬疑解谜，靠线索推进
  C. 群像经营，重关系和势力变化
  D. 情绪爽点优先，先抓读者期待

系统根据回答生成候选：
  genre = 科幻悬疑 / 赛博朋克
  core_selling_point = 底层黑客破解城市级阴谋
  target_reader = 喜欢快节奏、强悬念和升级爽点的男频读者

系统：这是我先帮你归纳的立项方向，你可以直接确认，也可以让我换一组。
```

设计要求：

1. Clarification Card 可以展示“候选方向”而不是空白字段。
2. `genre` 可以由作者选择、口述或由系统根据偏好归纳为 `enum_or_text`。
3. `core_selling_point` 可以先由系统生成候选文案，再由作者确认或修改。
4. `target_reader` 不应要求作者理解平台运营术语；系统可以用“读者期待 / 爽点偏好 / 阅读口味”来反推。
5. 在用户确认前，这些候选值只能作为 `current_parameters` / draft slot，不得直接执行创建。
6. 如果作者明确表示“你帮我定”，系统可以给出 2-3 个方案供选择；选择后仍需 Confirmation Card 收束。

| 中文呈现 | ADR-0010 slot | requiredness | 缺失时 |
| --- | --- | --- | --- |
| 题材 / 类型 | `genre` | required_to_execute | clarification；可通过候选方向辅助选择 |
| 核心卖点 | `core_selling_point` | required_to_execute | clarification；可由系统先生成候选卖点 |
| 目标读者 | `target_reader` | required_to_execute | clarification；可由读者期待 / 爽点偏好反推 |
| 语气偏好 | `tone_preference` | optional_preference | 不单独追问 |
| 参考作品 | `reference_works` | optional_preference | 不单独追问 |

#### 4.1.2 立项确认卡要求

当探索式补槽完成后，Confirmation Card 不应只显示 slot 字段名，而应以作者能理解的创作语言展示：

| 确认项 | 来源 slot | 推荐展示 |
| --- | --- | --- |
| 作品方向 | `genre` | “赛博朋克 + 悬疑升级” |
| 核心钩子 | `core_selling_point` | “底层黑客发现城市记忆被财阀篡改” |
| 目标读者 | `target_reader` | “喜欢快节奏破局、强悬念和升级爽点的男频读者” |
| 可选语气 | `tone_preference` | “冷峻、压迫感强，但节奏要快” |

确认卡动作建议：

- `confirm`：确认这个方向
- `revise`：换一组方向
- `answer`：补充更多偏好
- `dismiss`：暂不立项

### 4.2 新卷 / 新章规划 (Volume/Chapter Planning Flow)
- **触发意图**：新增卷/章。
- **必要槽位**：目标作品 / 卷 / 章引用；如果进入场景级规划，还需要场景边界。
- **UI 表现**：
  - 如果作者只说“开第二卷”或“下一章继续”，系统应先读取当前作品状态，给出 2-3 个可推进方向，而不是要求作者填写“核心目标”。
  - 作者可以选择一个方向、混合多个方向、排除某个方向，或要求系统换一组。
  - 系统把选择结果整理为卷 / 章规划候选，再通过 Confirmation Card 收束。
  - 可能涉及预读取之前章节的伏笔或状态作为上下文提示（在提示词或上下文中，不在必填表单里）。

#### 4.2.1 作者没想好新卷目标时的探索路径

新卷 / 新章规划常见情况是：作者知道“要继续写”，但并不知道下一卷核心目标、冲突或节奏应该是什么。此时 UI 应支持“续作方向探索”：

```text
作者：第一卷结束了，开第二卷吧。

系统：可以。基于第一卷结尾，目前有三种自然推进方向：
  A. 追查导师怀表：延续悬疑线，主角主动进入更大的遗迹网络
  B. 财阀反扑：把外部压力推高，让主角被迫暴露能力
  C. 新城市篇：换地图，扩大世界观，同时埋下导师真正身份

系统：你更想让第二卷承担哪种作用？也可以说“更爽一点”“更悬疑一点”或“换一组”。
```

设计要求：

1. `work_ref`、`volume_ref`、`chapter_ref` 能从当前上下文高置信推断时，不应打断作者询问。
2. 新卷 / 新章的“核心目标”不应作为作者必须手填的字段；它应由系统结合当前结构、伏笔、未解决冲突生成候选。
3. 候选方向必须说明它会推进什么：主线、人物、世界观、爽点、伏笔回收或商业节奏。
4. 如果作者只提供情绪偏好，如“更燃一点”“别太压抑”“节奏快点”，系统应转译为规划候选，而不是追问专业术语。
5. 最终执行前，Confirmation Card 应展示系统整理出的卷 / 章目标、影响范围和下一步输出。

| 中文呈现 | ADR-0010 slot | requiredness | 缺失时 |
| --- | --- | --- | --- |
| 作品引用 | `work_ref` | required_to_execute | 可从当前 work 高置信推断；冲突时 clarification |
| 目标卷 | `volume_ref` | required_to_execute | clarification 或从当前卷推断 |
| 目标章节 | `chapter_ref` | required_to_execute | clarification 或从当前章节推断 |
| arc 分组 | `arc_ref` / `arc_refs` | optional_preference | 不单独追问 |
| 大纲深度 | `outline_depth` | optional_preference | 使用默认策略 |
| 场景边界 | `scene_boundary` | required_to_execute（场景流程） | clarification |

#### 4.2.2 新卷 / 新章确认卡要求

Confirmation Card 应以创作决策语言收束，而不是只列 slot：

| 确认项 | 来源 | 推荐展示 |
| --- | --- | --- |
| 推进方向 | 系统候选 + 作者选择 | “第二卷主打财阀反扑，外部压力升级” |
| 主线作用 | 当前结构 / 伏笔 / 作者偏好 | “把导师怀表线索从个人谜团扩大到城市级阴谋” |
| 章节或卷范围 | `volume_ref` / `chapter_ref` | “第二卷草纲，先生成 8-10 章规划” |
| 风险提醒 | quality / continuity context | “需要避免过早揭示导师身份，否则第一卷悬念回收会变弱” |

确认卡动作建议：

- `confirm`：按这个方向生成
- `revise`：换一组方向
- `answer`：补充偏好
- `dismiss`：暂不规划

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
