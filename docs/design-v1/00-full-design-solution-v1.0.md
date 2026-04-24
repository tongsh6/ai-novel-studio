# 对话式小说工作台：Router / Executor / Context 完整设计方案 v1.0

> 目标：把“小说创作对话”从随意聊天，升级为**可路由、可执行、可扩展、可测试、可沉淀**的系统。
> 
> 本设计解决的核心问题不是“怎么让 AI 会写”，而是“怎么让 AI 在创作场景下稳定按系统意图工作”。

---

# 目录

- [1. 背景与问题定义](#1-背景与问题定义)
- [2. 设计目标](#2-设计目标)
- [3. 非目标](#3-非目标)
- [4. 核心设计原则](#4-核心设计原则)
- [5. 总体架构](#5-总体架构)
- [6. 核心模块设计](#6-核心模块设计)
  - [6.1 Router（意图识别与参数提取器）](#61-router意图识别与参数提取器)
  - [6.2 Executor（创作执行器）](#62-executor创作执行器)
  - [6.3 Context Manager（上下文管理器）](#63-context-manager上下文管理器)
  - [6.4 Memory / State Store（状态与记忆层）](#64-memory--state-store状态与记忆层)
  - [6.5 Validator（输出校验器）](#65-validator输出校验器)
- [7. Router 详细设计](#7-router-详细设计)
  - [7.1 Router 职责边界](#71-router-职责边界)
  - [7.2 Intent 枚举设计](#72-intent-枚举设计)
  - [7.3 参数槽位体系](#73-参数槽位体系)
  - [7.4 Router 输出协议](#74-router-输出协议)
  - [7.5 Router System Prompt](#75-router-system-prompt)
  - [7.6 Router Few-shot 示例](#76-router-few-shot-示例)
- [8. Executor 详细设计](#8-executor-详细设计)
  - [8.1 执行器分层](#81-执行器分层)
  - [8.2 各 Intent 对应执行模板](#82-各-intent-对应执行模板)
- [9. Context 设计](#9-context-设计)
  - [9.1 上下文分层原则](#91-上下文分层原则)
  - [9.2 最小必要上下文模板](#92-最小必要上下文模板)
  - [9.3 创作详细上下文模板](#93-创作详细上下文模板)
- [10. 对话流与状态机](#10-对话流与状态机)
- [11. API / JSON 协议设计](#11-api--json-协议设计)
- [12. 失败处理与回退策略](#12-失败处理与回退策略)
- [13. 测试方案](#13-测试方案)
- [14. 存储设计建议](#14-存储设计建议)
- [15. 演进路线图](#15-演进路线图)
- [16. 最小可落地版本建议](#16-最小可落地版本建议)
- [17. 附录](#17-附录)

---

# 1. 背景与问题定义

当前很多“小说对话系统”有一个常见问题：

1. **把聊天人格和系统路由混在一起**
2. **把创作任务和意图识别任务混在一起**
3. **把结构化协议和自然语言输出混在一起**

结果就是：

- 看起来输出了 JSON，但实际上不可驱动系统
- intent 有了，但粒度太粗
- parameters 经常为空
- 模型总想“顺手开始创作”
- 每次 prompt 一复杂，就变成“礼貌聊天机器人”

这不是模型偶然失常，而是系统设计本身不干净。

---

# 2. 设计目标

本方案的目标是：

## 2.1 让系统具备稳定的“对话解析能力”

用户输入一句自然语言后，系统能稳定识别：

- 这是在要新角色
- 还是在补世界观
- 还是在推进剧情
- 还是在复盘当前状态
- 还是在审查既有大纲

## 2.2 让系统输出可被后续模块消费的结构化结果

不是“长得像 JSON”，而是：

- intent 可枚举
- parameters 有槽位
- 缺失信息可追问
- confidence 可观测
- reply 不越权

## 2.3 让创作层和路由层彻底解耦

Router 只负责识别与提取。  
Executor 只负责创作与生成。

## 2.4 让上下文使用从“堆提示词”进化为“分层供给”

不同模块只拿自己该拿的上下文：

- Router 用最小必要上下文
- Executor 用目标相关上下文
- Summarizer 用全局状态摘要
- Validator 用协议与质量标准

## 2.5 让系统具备后续扩展能力

未来可扩展到：

- 多作品管理
- 多卷/多章节管理
- 世界设定库
- 角色库
- 关系图谱
- 版本比较
- 创作建议回放
- 结构化历史操作记录

---

# 3. 非目标

本方案当前**不追求**以下内容：

## 3.1 不追求“一次性做成全自动写书代理”

现阶段重点是：

- 稳定识别
- 稳定执行
- 稳定回放
- 稳定测试

不是做一个全自动闭眼写 300 万字的幻想系统。

## 3.2 不追求让单个 Prompt 包打一切

不会再搞一个超级 system prompt，既负责人格、又负责分类、又负责创作、又负责解释。

这是错误方向。

## 3.3 不追求一开始就引入复杂智能规划器

先把基本闭环做对：

用户请求 -> Router -> Executor -> Validator -> 存档

再考虑 Planning Agent、Critic Agent、Multi-Agent 协作。

## 3.4 不追求先定义过细的全量文学理论体系

本方案是“工作台设计”，不是“文学批评理论大全”。

---

# 4. 核心设计原则

## 4.1 单一职责原则

每个模块只做一件事：

- Router：识别与提取
- Executor：执行创作
- Validator：校验格式与质量
- Context Manager：供给上下文
- State Store：保存状态与资产

## 4.2 先协议，后能力

先把以下东西定死：

- intent 枚举
- parameters 槽位
- JSON 协议
- 状态流转
- 错误处理

再谈创作质量。

## 4.3 先稳定，后华丽

系统首先要做到：

- 100 次里 95 次不跑偏
- 结构化结果可消费
- 上下游能协作

而不是偶尔写出一段“很惊艳”的文字。

## 4.4 Router 不准越权

Router 不能开始写小说。  
它只能告诉系统：

- 用户想干什么
- 参数是什么
- 缺什么
- 下一步该调哪个执行器

## 4.5 上下文最小化供给

给模型的上下文越多，不代表越好。  
错误做法是“把所有设定都塞进去”。

正确做法是“按任务给最小必要上下文”。

## 4.6 创作执行必须按意图模板化

不同 intent，必须有不同执行模板：

- 新角色候选
- 细化已有角色
- 推进剧情
- 补场景
- 补设定
- 审核大纲

不能混成一个万能创作 prompt。

---

# 5. 总体架构

## 5.1 高层架构图

````text
用户输入
  ↓
Router
  ↓
结构化路由结果（intent + parameters）
  ↓
Context Manager
  ↓
Executor（按 intent 选择）
  ↓
Validator
  ↓
输出给用户 / 写入状态库
````

## 5.2 模块关系图

````text
┌────────────────────┐
│   Conversation UI  │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│       Router       │
│ intent / params    │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│   Context Manager  │
│ context assembly   │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│      Executor      │
│ create / refine    │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│     Validator      │
│ format / quality   │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ State / Asset Store│
└────────────────────┘
````

---

# 6. 核心模块设计

## 6.1 Router（意图识别与参数提取器）

Router 是整个系统的“分诊台”。

职责：

- 识别用户当前请求属于哪个 intent
- 提取该 intent 所需参数
- 标记缺失字段
- 输出严格 JSON

不负责：

- 创作正文
- 人格回复
- 推进剧情
- 生成角色
- 给文学建议

---

## 6.2 Executor（创作执行器）

Executor 是“真正干活的人”。

职责：

- 根据 intent + parameters 执行具体创作任务
- 输出结构化创作结果或面向用户的创作候选

例如：

- 生成角色候选
- 细化既有角色
- 推进下一段剧情
- 生成多个场景方案
- 扩写世界观
- 审查大纲漏洞

---

## 6.3 Context Manager（上下文管理器）

职责：

- 根据当前 intent 选择合适上下文
- 裁剪无关设定
- 汇总最小必要事实
- 组装给 Router / Executor / Validator 的不同上下文包

---

## 6.4 Memory / State Store（状态与记忆层）

职责：

- 保存作品状态
- 保存章节状态
- 保存角色设定
- 保存关系结构
- 保存世界设定
- 保存每一次路由与执行结果
- 为后续回放与测试提供基础

---

## 6.5 Validator（输出校验器）

职责：

- 校验 JSON 是否符合协议
- 校验参数是否齐全
- 校验 reply 是否越权
- 校验执行器输出是否符合格式要求
- 必要时触发回退或重试

---

# 7. Router 详细设计

## 7.1 Router 职责边界

### Router 只做这 4 件事

1. 识别意图  
2. 提取参数  
3. 发现缺失字段  
4. 输出结构化结果  

### Router 绝不做这 6 件事

1. 不生成角色正文  
2. 不推进剧情正文  
3. 不补写对白  
4. 不进行创作性解释  
5. 不寒暄  
6. 不说“好的，我来为你……”  

---

## 7.2 Intent 枚举设计

建议第一版使用以下 intent：

### CREATE_CHARACTER_CANDIDATES

含义：

- 基于当前剧情或当前需求，生成新的角色候选供作者确认

适用请求：

- 给我几个新角色候选
- 根据当前剧情补几个可用人物
- 这里需要一个角色，你先给我几版

---

### REFINE_EXISTING_CHARACTER

含义：

- 对已有角色进行细化与完善

适用请求：

- 把这个角色写细一点
- 补充他的动机和软肋
- 完善人物成长线

---

### DEFINE_CHARACTER_RELATION

含义：

- 设计角色之间的关系结构、钩子、冲突、羁绊、误解、依赖、师承等

适用请求：

- 这两个人之间怎么更有张力
- 设计主角和她的关系线
- 给他们加一层暗线联系

---

### ADVANCE_PLOT

含义：

- 推进当前剧情，设计下一步走向

适用请求：

- 接下来怎么推进
- 下一章怎么写比较合理
- 这段后面怎么接

---

### GENERATE_SCENE_OPTIONS

含义：

- 在给定剧情目标下，生成多个场景落地方案

适用请求：

- 给我几个桥段方案
- 这一幕可以怎么写
- 这个场景怎么落地更好

---

### EXPAND_WORLD_SETTING

含义：

- 补充世界观、势力结构、江湖规则、制度背景、地域环境等

适用请求：

- 这部分设定不够厚
- 补一下门派体系
- 把江湖关系网再搭起来

---

### REVIEW_EXISTING_OUTLINE

含义：

- 对已有大纲进行结构审查、问题识别、逻辑验证

适用请求：

- 看看这版大纲有没有问题
- 节奏会不会塌
- 角色动机成立吗

---

### SUMMARIZE_CURRENT_STATE

含义：

- 总结当前作品状态，包括设定、角色、进度、悬而未决问题

适用请求：

- 先回顾一下当前情况
- 总结目前已确定内容
- 帮我整理现状

---

### OTHER

含义：

- 无法稳定归类
- 或者当前请求跨多个意图但主意图不清晰

---

## 7.3 参数槽位体系

### 7.3.1 CREATE_CHARACTER_CANDIDATES

````json
{
  "work_name": "",
  "plot_scope": "",
  "generation_target": "new_character_candidates",
  "candidate_count": null,
  "role_type": "",
  "selection_flow": "",
  "constraints": []
}
````

字段说明：

- `work_name`：作品名
- `plot_scope`：生成所依据的剧情范围，如 `current_plot` / `chapter_1` / `arc_2`
- `generation_target`：固定值 `new_character_candidates`
- `candidate_count`：候选数量
- `role_type`：角色类型，如配角 / 反派 / 引线人 / 功能角色 / 门派人物
- `selection_flow`：例如 `author_confirms_after_candidates`
- `constraints`：创作限制，如不自创门派、贴合原著势力等

---

### 7.3.2 REFINE_EXISTING_CHARACTER

````json
{
  "work_name": "",
  "character_name": "",
  "refine_dimensions": [],
  "current_basis": "",
  "constraints": []
}
````

`refine_dimensions` 可选值示例：

- motivation
- weakness
- backstory
- growth_arc
- role_function
- emotional_hook
- voice_style

---

### 7.3.3 DEFINE_CHARACTER_RELATION

````json
{
  "work_name": "",
  "character_a": "",
  "character_b": "",
  "relation_goal": "",
  "desired_tension": "",
  "constraints": []
}
````

---

### 7.3.4 ADVANCE_PLOT

````json
{
  "work_name": "",
  "current_plot_scope": "",
  "advance_goal": "",
  "target_position": "",
  "constraints": []
}
````

`advance_goal` 示例：

- move_to_next_conflict
- reveal_secret
- increase_tension
- prepare_character_entry
- transition_to_new_arc

---

### 7.3.5 GENERATE_SCENE_OPTIONS

````json
{
  "work_name": "",
  "scene_goal": "",
  "based_on_plot_scope": "",
  "option_count": null,
  "constraints": []
}
````

---

### 7.3.6 EXPAND_WORLD_SETTING

````json
{
  "work_name": "",
  "setting_domain": "",
  "expansion_goal": "",
  "constraints": []
}
````

`setting_domain` 示例：

- faction
- martial_rules
- geography
- court_power
- jianghu_network
- sect_order

---

### 7.3.7 REVIEW_EXISTING_OUTLINE

````json
{
  "work_name": "",
  "review_target": "",
  "review_focus": [],
  "constraints": []
}
````

`review_focus` 示例：

- pacing
- logic
- motivation
- conflict
- consistency
- genre_fit

---

### 7.3.8 SUMMARIZE_CURRENT_STATE

````json
{
  "work_name": "",
  "summary_scope": "",
  "summary_focus": []
}
````

---

## 7.4 Router 输出协议

统一输出协议如下：

````json
{
  "intent": "",
  "parameters": {},
  "missing_fields": [],
  "confidence": 0.0,
  "reply": ""
}
````

字段规则：

### `intent`

- 必填
- 必须从枚举列表中取值
- 只能有一个

### `parameters`

- 必填
- 尽可能完整
- 不能因为字段不全就直接空对象
- 能提多少提多少

### `missing_fields`

- 必填
- 缺什么写什么
- 如果没有缺失则为空数组

### `confidence`

- 必填
- 范围 `0.0 ~ 1.0`
- 用于观测识别稳定性

### `reply`

- 必填
- 只能是**状态确认型**
- 不能是**执行承诺型**

合法示例：

- 已识别为基于当前剧情生成角色候选的请求。
- 已识别为对现有角色进行细化的请求。

非法示例：

- 好的，我会为你生成几位角色。
- 我现在开始补全下一章剧情。

---

## 7.5 Router System Prompt

以下是推荐的 Router System Prompt：

````text
你不是小说创作助理。
你是“对话式小说工作台”的意图识别与参数提取器（Router）。

你的唯一职责：
1. 识别用户当前请求对应的唯一 intent
2. 从上下文与用户请求中提取 parameters
3. 判断是否存在信息缺失，并写入 missing_fields
4. 输出严格 JSON

你的禁止事项：
- 不得开始创作小说内容
- 不得生成角色设定正文、剧情正文、对白正文
- 不得寒暄
- 不得输出“好的，我会……”之类的执行承诺
- 不得输出 JSON 之外的任何内容

意图识别原则：
- 只选择一个最匹配的 intent
- 若请求是“新增角色候选”，不能误判为“细化已有角色”
- 若请求是“推进剧情”，不能误判为“场景润色”
- 若无法归类，使用 OTHER

输出字段要求：
- intent: 必填，必须从给定 intent 列表中选择
- parameters: 必填，必须尽可能提取完整
- missing_fields: 必填，数组；若无缺失则为空数组
- confidence: 必填，0~1 之间的小数
- reply: 必填，但只能写“状态确认型”文本，不能写“执行承诺型”文本

reply 合法示例：
- "已识别为基于当前剧情生成角色候选的请求。"
- "已识别为对现有角色设定进行细化的请求。"

reply 非法示例：
- "好的，我会为你生成几位候选角色。"
- "我现在开始推进下一章剧情。"

当参数无法完全确定时：
- 能提取的先提取
- 缺失项写入 missing_fields
- 不得因为部分缺失就把 parameters 留空

可选 intent 列表：
- CREATE_CHARACTER_CANDIDATES
- REFINE_EXISTING_CHARACTER
- DEFINE_CHARACTER_RELATION
- ADVANCE_PLOT
- GENERATE_SCENE_OPTIONS
- EXPAND_WORLD_SETTING
- REVIEW_EXISTING_OUTLINE
- SUMMARIZE_CURRENT_STATE
- OTHER

输出 JSON 格式固定如下：
{
  "intent": "",
  "parameters": {},
  "missing_fields": [],
  "confidence": 0.0,
  "reply": ""
}
````

---

## 7.6 Router Few-shot 示例

### 示例 1：新增角色候选

#### 输入

````text
当前上下文：
- 当前作品：《天龙》
- 当前剧情范围：第1章之后
- 约束：尽量使用原著已有势力，不自创门派，武侠逻辑优先

用户请求：
“你根据现在的剧情进行角色创建，我根据你提供的候选，进行确认”

请识别意图并输出 JSON。
````

#### 期望输出

````json
{
  "intent": "CREATE_CHARACTER_CANDIDATES",
  "parameters": {
    "work_name": "天龙",
    "plot_scope": "current_plot",
    "generation_target": "new_character_candidates",
    "candidate_count": null,
    "role_type": "",
    "selection_flow": "author_confirms_after_candidates",
    "constraints": [
      "prefer_existing_canon_factions",
      "no_new_sect_creation",
      "martial_logic_first"
    ]
  },
  "missing_fields": [
    "candidate_count",
    "role_type"
  ],
  "confidence": 0.96,
  "reply": "已识别为基于当前剧情生成角色候选的请求。"
}
````

---

### 示例 2：细化已有角色

#### 输入

````text
当前上下文：
- 当前作品：《天龙》

用户请求：
“把主角的核心欲望、长期执念和情感软肋补完整一点”

请识别意图并输出 JSON。
````

#### 期望输出

````json
{
  "intent": "REFINE_EXISTING_CHARACTER",
  "parameters": {
    "work_name": "天龙",
    "character_name": "主角",
    "refine_dimensions": [
      "motivation",
      "growth_arc",
      "weakness"
    ],
    "current_basis": "existing_main_character",
    "constraints": []
  },
  "missing_fields": [],
  "confidence": 0.95,
  "reply": "已识别为对现有角色设定进行细化的请求。"
}
````

---

### 示例 3：推进剧情

#### 输入

````text
当前上下文：
- 当前作品：《天龙》
- 当前剧情：主角刚接触到关键线索，但冲突还没真正爆发

用户请求：
“接下来这段剧情怎么推进比较合理”

请识别意图并输出 JSON。
````

#### 期望输出

````json
{
  "intent": "ADVANCE_PLOT",
  "parameters": {
    "work_name": "天龙",
    "current_plot_scope": "current_plot",
    "advance_goal": "reasonable_next_progression",
    "target_position": "",
    "constraints": []
  },
  "missing_fields": [
    "target_position"
  ],
  "confidence": 0.94,
  "reply": "已识别为推进当前剧情的请求。"
}
````

---

# 8. Executor 详细设计

## 8.1 执行器分层

建议采用“按 intent 分执行模板”的方式。

### 不推荐方案

- 一个万能创作 prompt，处理所有创作任务

问题：

- 上下文污染严重
- 输出风格与结构不稳定
- 不同任务互相干扰
- 很难做针对性优化

### 推荐方案

每个 intent 对应一个执行模板：

- CREATE_CHARACTER_CANDIDATES_EXECUTOR
- REFINE_EXISTING_CHARACTER_EXECUTOR
- DEFINE_CHARACTER_RELATION_EXECUTOR
- ADVANCE_PLOT_EXECUTOR
- GENERATE_SCENE_OPTIONS_EXECUTOR
- EXPAND_WORLD_SETTING_EXECUTOR
- REVIEW_EXISTING_OUTLINE_EXECUTOR
- SUMMARIZE_CURRENT_STATE_EXECUTOR

---

## 8.2 各 Intent 对应执行模板

---

### 8.2.1 CREATE_CHARACTER_CANDIDATES_EXECUTOR

#### 目标

基于当前剧情与约束，输出一组**可供作者选择**的角色候选。

#### 输出建议格式

````markdown
## 角色候选 1
- 姓名：
- 身份：
- 立场：
- 核心欲望：
- 与当前剧情的连接点：
- 适合承担的功能位：
- 风险点：

## 角色候选 2
...
````

#### 执行 Prompt 模板

````text
你是小说创作执行器，当前任务是：基于已给定剧情与约束，生成新的角色候选。

要求：
1. 输出多个候选角色，而不是只输出一个
2. 每个候选必须服务于当前剧情，而不是脱离剧情乱造
3. 角色要有明确功能位
4. 若作品有原著约束，优先贴合原著世界结构
5. 不要直接替作者定稿，而是给出可选方案

输入参数：
- work_name: {{work_name}}
- plot_scope: {{plot_scope}}
- candidate_count: {{candidate_count}}
- role_type: {{role_type}}
- constraints: {{constraints}}

请按统一格式输出候选角色。
````

---

### 8.2.2 REFINE_EXISTING_CHARACTER_EXECUTOR

#### 目标

对已有角色进行定向补强。

#### 输出建议格式

````markdown
## 角色细化结果
### 基础信息
- 角色名：
- 当前定位：

### 补强维度
#### 1. 核心欲望
#### 2. 软肋与弱点
#### 3. 长期执念
#### 4. 成长弧线
#### 5. 与主线的绑定方式
````

#### 执行 Prompt 模板

````text
你是小说创作执行器，当前任务是：细化已有角色设定。

要求：
1. 只围绕指定角色展开
2. 必须聚焦指定 refine_dimensions
3. 输出要补强角色功能，而不是空泛文学描写
4. 不要脱离当前作品风格与设定

输入参数：
- work_name: {{work_name}}
- character_name: {{character_name}}
- refine_dimensions: {{refine_dimensions}}
- current_basis: {{current_basis}}
- constraints: {{constraints}}

请输出结构化角色细化结果。
````

---

### 8.2.3 DEFINE_CHARACTER_RELATION_EXECUTOR

#### 目标

设计两个角色之间的有效关系钩子。

#### 输出建议格式

````markdown
## 角色关系设计

- 角色 A：
- 角色 B：
- 关系主轴：
- 表层关系：
- 深层钩子：
- 冲突来源：
- 情感张力来源：
- 后续可发展的关系事件：
````

---

### 8.2.4 ADVANCE_PLOT_EXECUTOR

#### 目标

推进剧情，不是散聊，不是写散文。

#### 输出建议格式

````markdown
## 剧情推进方案

### 当前状态判断
### 下一步推进目标
### 推荐推进路径
1.
2.
3.

### 关键冲突点
### 风险点
### 可选转折点
````

#### 执行 Prompt 模板

````text
你是小说创作执行器，当前任务是：推进剧情。

要求：
1. 必须基于当前 plot scope
2. 必须明确“为什么这样推进”
3. 必须避免空泛建议
4. 必须给出推进路径与关键冲突
5. 不要直接写整章正文，除非明确要求

输入参数：
- work_name: {{work_name}}
- current_plot_scope: {{current_plot_scope}}
- advance_goal: {{advance_goal}}
- target_position: {{target_position}}
- constraints: {{constraints}}

请输出结构化剧情推进方案。
````

---

### 8.2.5 GENERATE_SCENE_OPTIONS_EXECUTOR

#### 目标

给定一个目标，输出多个场景方案，而不是单一路径。

#### 输出建议格式

````markdown
## 场景方案 1
- 场景目标：
- 发生地点：
- 出场人物：
- 核心动作：
- 情绪张力：
- 优点：
- 缺点：

## 场景方案 2
...
````

---

### 8.2.6 EXPAND_WORLD_SETTING_EXECUTOR

#### 目标

补设定时必须服务作品，不是做百科条目堆砌。

#### 输出建议格式

````markdown
## 设定扩写结果

### 设定领域
### 当前缺口
### 建议补强内容
### 与剧情的绑定方式
### 与角色的关联点
### 需要避免的设定风险
````

---

### 8.2.7 REVIEW_EXISTING_OUTLINE_EXECUTOR

#### 目标

对大纲进行问题识别，而不是表面夸奖。

#### 输出建议格式

````markdown
## 大纲审查结果

### 总体判断
### 主要问题
1.
2.
3.

### 问题级别
- 高优先级：
- 中优先级：
- 低优先级：

### 修正建议
### 不建议改动的部分
````

---

### 8.2.8 SUMMARIZE_CURRENT_STATE_EXECUTOR

#### 目标

为作者快速恢复状态。

#### 输出建议格式

````markdown
## 当前作品状态总结

### 已确定内容
### 当前剧情进度
### 核心角色现状
### 世界设定现状
### 未解决问题
### 推荐下一步
````

---

# 9. Context 设计

## 9.1 上下文分层原则

不要再把所有信息都塞给所有模块。

建议分 4 层：

### L1：路由层上下文

给 Router 使用，只包含：

- 当前作品名
- 当前剧情范围
- 当前约束
- 用户原始请求

### L2：执行层上下文

给 Executor 使用，包含：

- Router 输出的 intent / parameters
- 当前任务所需剧情摘要
- 相关角色卡
- 相关设定条目
- 当前章节状态

### L3：全局背景层上下文

按需提供：

- 作品总设定
- 卷结构
- 世界规则
- 关系图谱
- 核心主题
- 风格边界

### L4：系统约束层上下文

给所有模块复用：

- 输出格式要求
- 协议约束
- 质量标准
- 禁止项

---

## 9.2 最小必要上下文模板

这个模板给 Router 用：

````text
## 当前最小上下文
- 当前作品：{{work_name}}
- 当前剧情范围：{{plot_scope}}
- 当前约束：{{constraints}}

## 用户请求
{{user_request}}

请识别意图并输出 JSON。
````

---

## 9.3 创作详细上下文模板

这个模板给 Executor 用：

````text
## 当前任务
- intent: {{intent}}
- parameters: {{parameters}}

## 当前作品信息
- 作品名：{{work_name}}
- 核心卖点：{{core_hook}}
- 风格边界：{{style_constraints}}

## 相关剧情摘要
{{plot_summary}}

## 相关角色信息
{{related_characters}}

## 相关世界设定
{{related_settings}}

## 当前任务要求
{{task_requirements}}

请按指定格式完成本次创作任务。
````

---

# 10. 对话流与状态机

## 10.1 基本流程

````text
用户输入
  -> Router 识别
  -> 若参数完整：进入 Executor
  -> 若参数缺失：进入 Clarification / Default Filling
  -> 执行输出
  -> Validator 校验
  -> 返回用户
  -> 写入状态库
````

## 10.2 缺失字段处理

当 `missing_fields` 不为空时，有两种策略：

### 策略 A：系统自动补默认值

适用字段：

- candidate_count 缺失时默认 3
- option_count 缺失时默认 3
- plot_scope 缺失时默认 `current_plot`

### 策略 B：向用户发起补充询问

适用字段：

- character_name
- relation_target
- review_target
- setting_domain

### 建议

能默认补的尽量补。  
不要凡事都反问用户。

---

## 10.3 状态节点建议

可定义以下状态：

- `ROUTED`
- `NEEDS_CLARIFICATION`
- `READY_FOR_EXECUTION`
- `EXECUTING`
- `VALIDATING`
- `COMPLETED`
- `FAILED`

---

# 11. API / JSON 协议设计

## 11.1 Router 请求示例

````json
{
  "model": "router-model",
  "messages": [
    {
      "role": "system",
      "content": "Router System Prompt..."
    },
    {
      "role": "user",
      "content": "## 当前最小上下文 ... "
    }
  ],
  "temperature": 0.1,
  "stream": false
}
````

---

## 11.2 Router 返回示例

````json
{
  "intent": "CREATE_CHARACTER_CANDIDATES",
  "parameters": {
    "work_name": "天龙",
    "plot_scope": "current_plot",
    "generation_target": "new_character_candidates",
    "candidate_count": 3,
    "role_type": "",
    "selection_flow": "author_confirms_after_candidates",
    "constraints": [
      "prefer_existing_canon_factions",
      "no_new_sect_creation",
      "martial_logic_first"
    ]
  },
  "missing_fields": [
    "role_type"
  ],
  "confidence": 0.97,
  "reply": "已识别为基于当前剧情生成角色候选的请求。"
}
````

---

## 11.3 Executor 请求示例

````json
{
  "model": "creator-model",
  "messages": [
    {
      "role": "system",
      "content": "CREATE_CHARACTER_CANDIDATES_EXECUTOR Prompt..."
    },
    {
      "role": "user",
      "content": "## 当前任务 ... "
    }
  ],
  "temperature": 0.7,
  "stream": false
}
````

---

## 11.4 参数建议

### Router 层

````json
{
  "temperature": 0.1,
  "stream": false
}
````

### Executor 层

````json
{
  "temperature": 0.6
}
````

说明：

- Router 要低温、稳定
- Executor 可以适当高温，保留创意空间

---

## 11.5 如支持强格式约束，优先启用

优先级如下：

1. `json_schema`
2. function calling / tool calling
3. grammar / constrained decoding
4. 最后才是纯文本要求“请输出 JSON”

---

# 12. 失败处理与回退策略

## 12.1 Router 输出非法 JSON

处理方式：

1. Validator 检测失败
2. 触发一次重试
3. 重试时追加“仅输出合法 JSON”
4. 若仍失败，进入 fallback parser

---

## 12.2 Intent 不在枚举中

处理方式：

- 视为 Router 失败
- 自动改写为 `OTHER`
- 写入异常日志
- 记录该请求用于后续 prompt 微调

---

## 12.3 Parameters 全空

这是严重错误，通常意味着：

- Router Prompt 失效
- 用户输入过于模糊
- Intent 设计太粗
- 槽位定义不完整

处理方式：

1. 触发重试
2. 若仍全空，转入 `NEEDS_CLARIFICATION`
3. 记录为高优先级 bad case

---

## 12.4 Reply 越权

例如 Router 回复：

- 好的，我来写 3 个角色
- 我接下来给你推进剧情

处理方式：

- Validator 拦截
- 强制改写为状态确认型文本

---

## 12.5 Executor 输出不符合结构

处理方式：

- 追加格式修复 prompt 重试一次
- 仍失败则进入结构化修复器
- 最差返回“半结构化可读结果”，但要标记非标准输出

---

# 13. 测试方案

## 13.1 Router 测试重点

Router 不看文采，只看三件事：

1. intent 对不对  
2. parameters 全不全  
3. reply 有没有越权  

---

## 13.2 测试集分类

建议构建以下 bad case / normal case 测试集：

### A 类：标准清晰请求

- 给我几个角色候选
- 帮我推进下一章
- 补一下这个角色设定

### B 类：模糊请求

- 这里不太对
- 我想让这个人更立体一点
- 后面感觉接不上

### C 类：复合请求

- 先总结一下现状，再帮我想下怎么推进
- 先补设定，再根据设定造一个角色

### D 类：干扰请求

- 你觉得这本书怎么样
- 这个桥段是不是太俗
- 我有点乱，先帮我梳理下

---

## 13.3 测试指标

### Router 指标

- Intent Accuracy
- Parameter Fill Rate
- Missing Field Precision
- Reply Compliance Rate
- JSON Valid Rate

### Executor 指标

- Format Compliance Rate
- Task Completion Quality
- Constraint Adherence
- Reusability
- Edit Distance to User Acceptance

---

## 13.4 回归测试建议

最少准备 20 条历史用户请求，持续回归。

每次修改：

- Router prompt
- intent 体系
- 参数槽位
- few-shot

都要重新跑回归。

---

# 14. 存储设计建议

## 14.1 推荐存储对象

### Work（作品）

- id
- name
- genre
- pitch
- style_constraints
- world_summary

### Chapter / Plot Node（章节 / 剧情节点）

- id
- work_id
- title
- summary
- plot_status
- unresolved_points

### Character（角色）

- id
- work_id
- name
- identity
- motivation
- weakness
- growth_arc
- current_status

### Relation（关系）

- id
- work_id
- character_a
- character_b
- relation_type
- tension_source
- hidden_hook

### Setting（设定）

- id
- work_id
- domain
- content
- related_plot_scope

### Interaction Log（交互日志）

- id
- work_id
- user_input
- routed_intent
- routed_parameters
- executor_output
- validation_result
- created_at

---

## 14.2 是否必须数据库

第一阶段不必须。

### MVP 可行方案

- JSON 文件
- Markdown 文件
- SQLite

### 更推荐

如果你是单机 / 本地工具优先：

- SQLite 非常合适

原因：

1. 足够轻  
2. 方便结构化查询  
3. 不需要额外服务  
4. 易于导出  
5. 适合原型和中小型工作台  

---

# 15. 演进路线图

## Phase 1：Router MVP

完成：

- intent 枚举
- parameters 槽位
- Router prompt
- 20 条测试集
- JSON 协议校验

## Phase 2：Executor 分意图落地

完成：

- 3 个核心执行器
  - CREATE_CHARACTER_CANDIDATES
  - REFINE_EXISTING_CHARACTER
  - ADVANCE_PLOT
- 基本上下文组装
- Validator 校验

## Phase 3：状态持久化

完成：

- SQLite / JSON store
- 角色库
- 设定库
- 剧情节点库
- 操作日志库

## Phase 4：复合任务支持

例如：

- 先总结，再推进
- 先补设定，再造角色
- 先审大纲，再生成修正版

## Phase 5：高级能力

例如：

- 多 agent 协作
- 自评审
- 版本 diff
- 创作轨迹回放
- 角色关系图谱生成
- 章节状态自动摘要

---

# 16. 最小可落地版本建议

如果你现在就要开始做，不要贪。

先做这套：

## 16.1 只支持 4 个 intent

- CREATE_CHARACTER_CANDIDATES
- REFINE_EXISTING_CHARACTER
- ADVANCE_PLOT
- SUMMARIZE_CURRENT_STATE

## 16.2 只做两层 prompt

- Router Prompt
- 4 个执行器 Prompt

## 16.3 只做一个轻存储

- SQLite 或 JSON 文件

## 16.4 只做一个校验器

- JSON 合法性
- intent 合法性
- parameters 非空
- reply 不越权

这已经够你跑出第一版闭环了。

---

# 17. 附录

## 17.1 你原案例的正确 Router 结果

针对用户请求：

> 你根据现在的剧情进行角色创建，我根据你提供的候选，进行确认

更合理的路由结果应为：

````json
{
  "intent": "CREATE_CHARACTER_CANDIDATES",
  "parameters": {
    "work_name": "天龙",
    "plot_scope": "current_plot",
    "generation_target": "new_character_candidates",
    "candidate_count": null,
    "role_type": "",
    "selection_flow": "author_confirms_after_candidates",
    "constraints": []
  },
  "missing_fields": [
    "candidate_count",
    "role_type"
  ],
  "confidence": 0.97,
  "reply": "已识别为基于当前剧情生成角色候选的请求。"
}
````

而不应该是这种结果：

````json
{
  "reply": "好的，我会根据第1章的剧情为您生成几位候选角色设定...",
  "intent": "REFINE_CHARACTER",
  "parameters": {}
}
````

错误原因：

1. intent 太粗且误判  
2. parameters 空了  
3. reply 越权，抢执行器的活  

---

## 17.2 一句最重要的话

这个系统成败的关键，不是“AI 会不会写”，而是：

> **你有没有把“聊天人格”与“系统协议”分层。**

只要这两层继续混着写，后面所有问题都会反复出现。

---
