# Router 设计说明

> 用于“对话式小说工作台”的意图识别与参数提取层。
> 
> 本文档只定义 Router 的职责、协议、意图体系、参数槽位、校验原则。
> 不负责创作执行。

---

# 1. 目标

Router 的目标只有一个：

> 把用户的自然语言创作请求，稳定转换成系统可消费的结构化 JSON。

它解决的不是“写得好不好”，而是：

- 用户这轮到底想干什么
- 这个请求应该进入哪个执行器
- 执行需要哪些参数
- 缺了哪些关键字段
- 是否需要补问或默认填充

---

# 2. 职责边界

## 2.1 Router 负责

1. 识别唯一主意图
2. 提取结构化参数
3. 标记缺失字段
4. 输出严格 JSON

## 2.2 Router 不负责

1. 不直接开始创作
2. 不生成角色正文
3. 不生成剧情正文
4. 不做寒暄
5. 不承诺“我来帮你写”
6. 不输出 JSON 之外的自由文本

---

# 3. 为什么必须单独拆出 Router

如果不拆 Router，直接让“创作助理”同时做：

- 理解请求
- 分类意图
- 提取参数
- 继续创作
- 维持聊天人格

那么模型大概率会优先做“自然顺承回复”，而不是“系统协议输出”。

常见表现：

- intent 看似对，实际上太粗
- parameters 经常空
- reply 抢执行器的活
- 一旦上下文复杂，就开始随意发挥

所以必须分层：

- Router：识别与提取
- Executor：创作与生成

---

# 4. 输入与输出

## 4.1 Router 输入

Router 输入应控制在“最小必要上下文”范围内：

- 当前作品名
- 当前剧情范围
- 当前约束
- 用户原始请求

不应把大段世界观、全文角色卡、全部历史聊天一股脑塞给 Router。

---

## 4.2 Router 输出协议

固定输出 JSON：

````json
{
  "intent": "",
  "parameters": {},
  "missing_fields": [],
  "confidence": 0.0,
  "reply": ""
}
````

字段说明：

### intent
- 必填
- 只能从预定义枚举中选择
- 只能有一个主 intent

### parameters
- 必填
- 尽可能提取完整
- 不能因为部分缺失就直接空对象

### missing_fields
- 必填
- 缺什么写什么
- 如果没有缺失则为空数组

### confidence
- 必填
- 取值范围 `0.0 ~ 1.0`

### reply
- 必填
- 只能是“状态确认型”
- 不能是“执行承诺型”

---

# 5. Reply 约束

## 5.1 合法 reply

- 已识别为基于当前剧情生成角色候选的请求。
- 已识别为推进当前剧情的请求。
- 已识别为对现有角色进行细化的请求。

## 5.2 非法 reply

- 好的，我来给你写 3 个角色。
- 我现在开始推进下一章剧情。
- 我会根据你的设定进行创作。

Router 的 reply 只能说明“系统识别结果”，不能抢执行器的工作。

---

# 6. Intent 枚举

建议第一版定义以下 intent：

## 6.1 CREATE_CHARACTER_CANDIDATES
基于当前剧情或当前需求，生成新的角色候选供作者确认。

适用例子：

- 根据现在剧情补几个角色
- 给我几个候选人物
- 这里需要一个新角色，你先给几个版本

---

## 6.2 REFINE_EXISTING_CHARACTER
对已有角色进行细化与完善。

适用例子：

- 把这个角色写细一点
- 补充他的动机和弱点
- 完善这个人的成长线

---

## 6.3 DEFINE_CHARACTER_RELATION
设计角色之间的关系钩子、冲突、羁绊、依附、误会等。

适用例子：

- 这两个人怎么更有张力
- 设计主角和她的关系
- 给他们加一条暗线联系

---

## 6.4 ADVANCE_PLOT
推进当前剧情。

适用例子：

- 下一章怎么推进
- 这段后面怎么接
- 接下来发生什么比较合理

---

## 6.5 GENERATE_SCENE_OPTIONS
围绕一个目标，生成多个具体场景方案。

适用例子：

- 给我几个桥段方案
- 这一幕可以怎么写
- 这里怎么落成具体场景

---

## 6.6 EXPAND_WORLD_SETTING
扩写世界观、势力结构、规则系统、江湖关系等。

适用例子：

- 这部分设定太薄
- 补一下门派体系
- 把背景结构再搭起来

---

## 6.7 REVIEW_EXISTING_OUTLINE
对已有大纲做结构审查与问题识别。

适用例子：

- 看看这个大纲有没有问题
- 节奏会不会塌
- 这条线逻辑是否成立

---

## 6.8 SUMMARIZE_CURRENT_STATE
总结当前作品状态。

适用例子：

- 先回顾一下现在的情况
- 帮我总结当前设定和剧情进度
- 整理一下目前已确定内容

---

## 6.9 OTHER
无法稳定归类时使用。

---

# 7. 参数槽位设计

## 7.1 CREATE_CHARACTER_CANDIDATES

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

字段解释：

- `work_name`：作品名
- `plot_scope`：当前剧情范围，如 `current_plot`
- `generation_target`：固定为 `new_character_candidates`
- `candidate_count`：候选数量
- `role_type`：角色类型，如配角 / 引线人 / 反派 / 门派人物
- `selection_flow`：例如 `author_confirms_after_candidates`
- `constraints`：约束条件

---

## 7.2 REFINE_EXISTING_CHARACTER

````json
{
  "work_name": "",
  "character_name": "",
  "refine_dimensions": [],
  "current_basis": "",
  "constraints": []
}
````

`refine_dimensions` 示例：

- motivation
- weakness
- backstory
- growth_arc
- role_function
- emotional_hook
- voice_style

---

## 7.3 DEFINE_CHARACTER_RELATION

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

## 7.4 ADVANCE_PLOT

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

## 7.5 GENERATE_SCENE_OPTIONS

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

## 7.6 EXPAND_WORLD_SETTING

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

## 7.7 REVIEW_EXISTING_OUTLINE

````json
{
  "work_name": "",
  "review_target": "",
  "review_focus": [],
  "constraints": []
}
````

---

## 7.8 SUMMARIZE_CURRENT_STATE

````json
{
  "work_name": "",
  "summary_scope": "",
  "summary_focus": []
}
````

---

# 8. 缺失字段策略

当某些字段无法从当前请求中稳定提取时：

1. 能提多少提多少
2. 缺的写入 `missing_fields`
3. 不得因为部分缺失就让 `parameters` 为空

示例：

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

---

# 9. 默认值策略

不是所有缺失字段都需要追问用户。

建议默认值：

- `plot_scope` 缺失时：默认 `current_plot`
- `candidate_count` 缺失时：默认 3
- `option_count` 缺失时：默认 3

适合追问的字段：

- `character_name`
- `character_b`
- `review_target`
- `setting_domain`

原则：

> 能默认补的不要骚扰用户，不能乱补的再问。

---

# 10. Context 约束

Router 使用的上下文模板建议如下：

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

# 11. 失败判定

以下情况视为 Router 失败：

1. 非法 JSON
2. intent 不在枚举中
3. parameters 全空
4. reply 越权
5. intent 与用户请求明显不匹配

---

# 12. 校验规则

Validator 应至少校验以下内容：

## 12.1 JSON 合法性
是否为合法 JSON

## 12.2 Intent 合法性
是否在预定义枚举内

## 12.3 Parameters 合法性
是否至少提取出可识别字段

## 12.4 Missing Fields 一致性
是否真的把缺失项写了出来

## 12.5 Reply 合规性
是否出现执行承诺语言

---

# 13. 推荐参数

Router 调用建议：

````json
{
  "temperature": 0.1,
  "stream": false
}
````

原因：

- Router 要低温
- Router 要稳定
- Router 不需要创意

---

# 14. MVP 范围建议

第一阶段先只做 4 个 intent：

- CREATE_CHARACTER_CANDIDATES
- REFINE_EXISTING_CHARACTER
- ADVANCE_PLOT
- SUMMARIZE_CURRENT_STATE

理由：

- 足够覆盖高频核心动作
- 降低系统复杂度
- 便于做回归测试
- 能更快验证闭环

---

# 15. 最重要的一句话

Router 的成败关键不是“分类名好不好听”，而是：

> 它能不能长期稳定地产出系统真正可消费的结构化协议。

只要 Router 继续兼任“创作助理”，它就一定会反复失控。