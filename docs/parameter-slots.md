# Parameter Slots 参数槽位定义

> 本文档定义每个 intent 对应的参数槽位结构。
> 
> 参数槽位的目标不是“把一切都结构化”，而是：
> - 为执行器提供稳定输入
> - 为缺失字段判断提供依据
> - 为默认值填充提供边界
> - 为后续状态存储提供统一结构

---

# 1. 设计原则

参数槽位设计必须遵循以下原则：

1. **为执行服务**：槽位必须真的能帮助执行器工作
2. **避免伪结构化**：不要为了整齐而造没用字段
3. **可缺失**：允许部分字段暂时未知
4. **可默认填充**：能合理默认的字段应支持默认
5. **可扩展**：后续加字段不应破坏旧协议

---

# 2. 总体约定

所有 Router 输出的 `parameters` 都应满足：

- 字段名固定
- 字段语义清晰
- 字段值尽量原子化
- 缺失值可为 `null`、空字符串、空数组，但不能整块空对象

---

# 3. Intent 对应槽位

## 3.1 CREATE_CHARACTER_CANDIDATES

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

### 字段解释

#### work_name
- 含义：作品名
- 示例：`天龙`
- 是否必需：建议必需

#### plot_scope
- 含义：本次生成依据的剧情范围
- 示例：
  - `current_plot`
  - `chapter_1`
  - `arc_2`
- 默认值建议：`current_plot`

#### generation_target
- 含义：生成目标
- 固定值：`new_character_candidates`

#### candidate_count
- 含义：需要几个候选
- 示例：`3`
- 默认值建议：`3`

#### role_type
- 含义：角色类型
- 示例：
  - `supporting_role`
  - `antagonist`
  - `guide_role`
  - `faction_member`
  - `functional_role`

#### selection_flow
- 含义：作者如何使用这些候选
- 示例：`author_confirms_after_candidates`

#### constraints
- 含义：附加约束
- 示例：
  - `prefer_existing_canon_factions`
  - `no_new_sect_creation`
  - `martial_logic_first`

---

## 3.2 REFINE_EXISTING_CHARACTER

````json
{
  "work_name": "",
  "character_name": "",
  "refine_dimensions": [],
  "current_basis": "",
  "constraints": []
}
````

### 字段解释

#### character_name
- 含义：要细化的角色名
- 示例：`主角`

#### refine_dimensions
- 含义：具体细化维度
- 常见值：
  - `motivation`
  - `weakness`
  - `backstory`
  - `growth_arc`
  - `role_function`
  - `emotional_hook`
  - `voice_style`

#### current_basis
- 含义：当前已有设定基础
- 示例：
  - `existing_main_character`
  - `draft_character_card`
  - `chapter_defined_character`

#### constraints
- 含义：角色细化时的边界约束

---

## 3.3 DEFINE_CHARACTER_RELATION

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

### 字段解释

#### character_a / character_b
- 含义：关系设计涉及的角色双方

#### relation_goal
- 含义：关系设计目标
- 示例：
  - `increase_tension`
  - `build_dependency`
  - `create_hidden_link`
  - `add_conflict_source`

#### desired_tension
- 含义：希望形成的张力类型
- 示例：
  - `emotional_push_pull`
  - `power_imbalance`
  - `trust_vs_suspicion`
  - `shared_secret`

#### constraints
- 含义：关系设计边界

---

## 3.4 ADVANCE_PLOT

````json
{
  "work_name": "",
  "current_plot_scope": "",
  "advance_goal": "",
  "target_position": "",
  "constraints": []
}
````

### 字段解释

#### current_plot_scope
- 含义：本次推进所依据的剧情范围
- 默认值建议：`current_plot`

#### advance_goal
- 含义：推进目标
- 常见值：
  - `move_to_next_conflict`
  - `reveal_secret`
  - `increase_tension`
  - `prepare_character_entry`
  - `transition_to_new_arc`
  - `reasonable_next_progression`

#### target_position
- 含义：希望推进到的剧情位置
- 示例：
  - `character_entry_completed`
  - `first_conflict_triggered`
  - `chapter_end_hook_ready`

#### constraints
- 含义：剧情推进边界
- 示例：
  - `follow_current_plot_rhythm`
  - `avoid_large_scale_setting_jump`
  - `maintain_character_motivation_consistency`

---

## 3.5 GENERATE_SCENE_OPTIONS

````json
{
  "work_name": "",
  "scene_goal": "",
  "based_on_plot_scope": "",
  "option_count": null,
  "constraints": []
}
````

### 字段解释

#### scene_goal
- 含义：该场景要完成什么
- 示例：
  - `introduce_new_character`
  - `create_first_conflict`
  - `build_romantic_tension`
  - `deliver_secret_information`

#### based_on_plot_scope
- 含义：场景依附于哪个剧情范围

#### option_count
- 含义：要几个场景候选
- 默认值建议：`3`

#### constraints
- 含义：场景生成边界

---

## 3.6 EXPAND_WORLD_SETTING

````json
{
  "work_name": "",
  "setting_domain": "",
  "expansion_goal": "",
  "constraints": []
}
````

### 字段解释

#### setting_domain
- 含义：扩写哪个设定领域
- 示例：
  - `faction`
  - `martial_rules`
  - `geography`
  - `court_power`
  - `jianghu_network`
  - `sect_order`

#### expansion_goal
- 含义：为什么要扩写
- 示例：
  - `support_plot_progression`
  - `strengthen_world_consistency`
  - `prepare_future_conflict`
  - `bind_character_origin`

#### constraints
- 含义：设定扩写边界

---

## 3.7 REVIEW_EXISTING_OUTLINE

````json
{
  "work_name": "",
  "review_target": "",
  "review_focus": [],
  "constraints": []
}
````

### 字段解释

#### review_target
- 含义：审查对象
- 示例：
  - `current_outline`
  - `chapter_3_outline`
  - `arc_1_structure`

#### review_focus
- 含义：重点审查维度
- 常见值：
  - `pacing`
  - `logic`
  - `motivation`
  - `conflict`
  - `consistency`
  - `genre_fit`

#### constraints
- 含义：审查边界与标准

---

## 3.8 SUMMARIZE_CURRENT_STATE

````json
{
  "work_name": "",
  "summary_scope": "",
  "summary_focus": []
}
````

### 字段解释

#### summary_scope
- 含义：总结范围
- 示例：
  - `current_novel_state`
  - `current_arc_state`
  - `chapter_progress_state`

#### summary_focus
- 含义：总结重点
- 常见值：
  - `setting`
  - `characters`
  - `plot_progress`
  - `open_questions`
  - `next_steps`

---

# 4. 缺失值表达约定

建议使用以下表达方式：

- 数值缺失：`null`
- 字符串缺失：`""`
- 列表缺失：`[]`

原因：

- 便于程序识别
- 便于校验器处理
- 不容易和“字段不存在”混淆

---

# 5. 默认值策略

## 5.1 建议支持默认值的字段

### CREATE_CHARACTER_CANDIDATES
- `plot_scope` -> `current_plot`
- `candidate_count` -> `3`

### ADVANCE_PLOT
- `current_plot_scope` -> `current_plot`

### GENERATE_SCENE_OPTIONS
- `option_count` -> `3`

### SUMMARIZE_CURRENT_STATE
- `summary_scope` -> `current_novel_state`

---

## 5.2 不建议乱默认的字段

以下字段建议缺失时进入 `missing_fields`：

- `character_name`
- `character_a`
- `character_b`
- `review_target`
- `setting_domain`

因为这些字段一旦瞎猜，后续执行器会直接走偏。

---

# 6. 参数抽取示例

## 示例 1：新增角色候选

用户请求：

> 你根据现在的剧情进行角色创建，我根据你提供的候选，进行确认

合理参数：

````json
{
  "work_name": "天龙",
  "plot_scope": "current_plot",
  "generation_target": "new_character_candidates",
  "candidate_count": null,
  "role_type": "",
  "selection_flow": "author_confirms_after_candidates",
  "constraints": []
}
````

---

## 示例 2：细化角色

用户请求：

> 把主角的核心欲望和情感软肋补完整一点

合理参数：

````json
{
  "work_name": "天龙",
  "character_name": "主角",
  "refine_dimensions": [
    "motivation",
    "weakness"
  ],
  "current_basis": "existing_main_character",
  "constraints": []
}
````

---

## 示例 3：推进剧情

用户请求：

> 接下来这段剧情怎么推进比较合理

合理参数：

````json
{
  "work_name": "天龙",
  "current_plot_scope": "current_plot",
  "advance_goal": "reasonable_next_progression",
  "target_position": "",
  "constraints": []
}
````

---

# 7. 状态存储建议

后续持久化时，建议把参数对象原样存入：

- interaction log
- execution record
- test case record
- state transition log

这样可以做：

- 回放
- diff
- bad case 分析
- prompt 调整前后对比

---

# 8. 一句结论

参数槽位不是装饰品。

只要槽位设计得太虚、太宽、太没执行意义，Router 就会越来越像“会说 JSON 的聊天机器人”。