# Router Test Cases

> 本文档定义 Router 的测试样例，用于：
> - 回归测试
> - bad case 收集
> - few-shot 调整验证
> - intent / parameter / reply 稳定性评估

---

# 1. 测试目标

Router 测试不关心文风，重点只看三件事：

1. `intent` 是否正确
2. `parameters` 是否合理完整
3. `reply` 是否合规不越权

额外关注：

- `missing_fields` 是否准确
- `confidence` 是否基本合理
- JSON 是否可解析

---

# 2. 判定标准

## 2.1 正确
- intent 正确
- 参数提取合理
- 缺失字段判断合理
- reply 为状态确认型

## 2.2 部分正确
- intent 正确，但参数不全
- 或 intent 正确，但 reply 越权
- 或 missing_fields 不准

## 2.3 错误
- intent 错误
- parameters 几乎全空
- reply 明显越权
- 输出不是合法 JSON

---

# 3. 测试用例

## Case 01：新增角色候选

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：current_plot
- 当前约束：尽量使用原著已有势力；不自创门派；武侠逻辑优先

## 用户请求
你根据现在的剧情进行角色创建，我根据你提供的候选，进行确认

请识别意图并输出 JSON。
````

### 期望

#### intent
`CREATE_CHARACTER_CANDIDATES`

#### 核心参数
````json
{
  "work_name": "天龙",
  "plot_scope": "current_plot",
  "generation_target": "new_character_candidates",
  "selection_flow": "author_confirms_after_candidates"
}
````

#### missing_fields
- `candidate_count`
- `role_type`

---

## Case 02：细化已有角色

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：current_plot
- 当前约束：保持武侠逻辑

## 用户请求
把主角的核心欲望、长期执念和情感软肋补完整一点

请识别意图并输出 JSON。
````

### 期望

#### intent
`REFINE_EXISTING_CHARACTER`

#### 核心参数
````json
{
  "work_name": "天龙",
  "character_name": "主角",
  "refine_dimensions": [
    "motivation",
    "growth_arc",
    "weakness"
  ]
}
````

#### missing_fields
空数组

---

## Case 03：推进剧情

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：current_plot
- 当前约束：贴合当前节奏

## 用户请求
接下来这段剧情怎么推进比较合理

请识别意图并输出 JSON。
````

### 期望

#### intent
`ADVANCE_PLOT`

#### 核心参数
````json
{
  "work_name": "天龙",
  "current_plot_scope": "current_plot",
  "advance_goal": "reasonable_next_progression"
}
````

#### missing_fields
- `target_position`

---

## Case 04：角色关系设计

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：current_plot
- 当前约束：关系必须服务主线

## 用户请求
帮我设计主角和这个新人物之间更有张力的关系

请识别意图并输出 JSON。
````

### 期望

#### intent
`DEFINE_CHARACTER_RELATION`

#### 核心参数
````json
{
  "work_name": "天龙",
  "character_a": "主角",
  "character_b": "新人物",
  "relation_goal": "increase_tension"
}
````

---

## Case 05：总结当前状态

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：current_plot
- 当前约束：无

## 用户请求
先把目前这部小说的设定、角色和剧情进度总结一下

请识别意图并输出 JSON。
````

### 期望

#### intent
`SUMMARIZE_CURRENT_STATE`

#### 核心参数
````json
{
  "work_name": "天龙",
  "summary_scope": "current_novel_state",
  "summary_focus": [
    "setting",
    "characters",
    "plot_progress"
  ]
}
````

---

## Case 06：扩写世界设定

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：current_plot
- 当前约束：尽量贴近原著武侠气质

## 用户请求
补一下这条线背后的江湖势力结构，不然现在有点薄

请识别意图并输出 JSON。
````

### 期望

#### intent
`EXPAND_WORLD_SETTING`

#### 核心参数
````json
{
  "work_name": "天龙",
  "setting_domain": "jianghu_network",
  "expansion_goal": "strengthen_world_consistency"
}
````

---

## Case 07：审查大纲

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：arc_1
- 当前约束：重点看逻辑和节奏

## 用户请求
你帮我看看这版第一卷大纲会不会节奏太平

请识别意图并输出 JSON。
````

### 期望

#### intent
`REVIEW_EXISTING_OUTLINE`

#### 核心参数
````json
{
  "work_name": "天龙",
  "review_target": "arc_1_outline",
  "review_focus": [
    "pacing",
    "logic"
  ]
}
````

---

## Case 08：场景候选

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：chapter_3
- 当前约束：要有一点压迫感

## 用户请求
这一幕主角第一次见到对方，可以给我几个不同的场景走法

请识别意图并输出 JSON。
````

### 期望

#### intent
`GENERATE_SCENE_OPTIONS`

#### 核心参数
````json
{
  "work_name": "天龙",
  "scene_goal": "first_meeting_scene",
  "based_on_plot_scope": "chapter_3"
}
````

---

# 4. 模糊用例

## Case 09：模糊的“这里不太对”

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：current_plot
- 当前约束：无

## 用户请求
这里感觉不太对

请识别意图并输出 JSON。
````

### 期望
- 可以判为 `OTHER`
- 或根据更完整上下文判为 `REVIEW_EXISTING_OUTLINE`
- 关键是不能胡乱输出一堆空参数然后假装懂了

---

## Case 10：模糊的“这个人有点薄”

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：current_plot
- 当前约束：无

## 用户请求
这个人有点薄，补厚一点

请识别意图并输出 JSON。
````

### 期望
- 倾向 `REFINE_EXISTING_CHARACTER`
- 但如果角色名缺失，应进入 `missing_fields: ["character_name"]`

---

# 5. 复合请求用例

## Case 11：先总结再推进

### 输入

````text
## 当前最小上下文
- 当前作品：天龙
- 当前剧情范围：current_plot
- 当前约束：无

## 用户请求
你先帮我总结一下现在的情况，再说接下来怎么推进

请识别意图并输出 JSON。
````

### 期望
这里是一个关键测试点。

#### 方案 A：Router 只识别主意图
- 主意图判为 `SUMMARIZE_CURRENT_STATE`

#### 方案 B：系统支持复合意图
- 当前 v1 不建议
- 当前 v1 应优先识别第一主请求：`SUMMARIZE_CURRENT_STATE`

---

# 6. 错误用例

## Case 12：reply 越权错误

### 错误输出示例

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
  "reply": "好的，我现在为你推进下一章剧情。"
}
````

### 问题
- intent 可能是对的
- parameters 可能也差不多
- 但 `reply` 越权，必须判失败或部分失败

---

## Case 13：parameters 全空错误

### 错误输出示例

````json
{
  "intent": "REFINE_EXISTING_CHARACTER",
  "parameters": {},
  "missing_fields": [],
  "confidence": 0.88,
  "reply": "已识别为角色细化请求。"
}
````

### 问题
- parameters 全空
- missing_fields 也不对
- 这是典型“看起来像成功，实际上不可执行”的假阳性

---

# 7. 测试记录模板

建议每次测试按如下格式记录：

````markdown
## Test Record
- case_id:
- request_summary:
- expected_intent:
- actual_intent:
- expected_parameters:
- actual_parameters:
- expected_missing_fields:
- actual_missing_fields:
- reply_compliance:
- json_valid:
- result: PASS / PARTIAL / FAIL
- notes:
````

---

# 8. 回归测试建议

每次改动以下任何一项，都要跑一轮 Router 回归：

- intent 枚举
- 参数槽位
- Router system prompt
- few-shot 样例
- Validator 规则
- 默认值策略

至少准备：

- 8 条标准样例
- 4 条模糊样例
- 3 条复合样例
- 3 条错误样例

---

# 9. 一句结论

没有测试集的 Router，不是 Router，只是一次性的 prompt 幻觉。
