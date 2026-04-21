# Validator Rules 校验规则

> 本文档定义对话式小说工作台中，针对 Router 输出与 Executor 输出的校验规则。
> 
> Validator 的作用不是“吹毛求疵”，而是防止系统把**表面正确、实则不可执行**的结果当成成功。

---

# 1. Validator 的职责

Validator 负责：

1. 校验 Router 输出是否合法
2. 校验 Executor 输出是否符合格式
3. 校验 reply 是否越权
4. 校验参数是否足够支撑执行
5. 在必要时触发重试、回退或修复

Validator 不负责：

- 意图识别
- 创作执行
- 文学质量主观评价
- 长篇解释

---

# 2. 校验对象

当前建议分两类校验：

## 2.1 Router Validator
校验 Router 的 JSON 输出

## 2.2 Executor Validator
校验执行器输出的格式与结构完整性

---

# 3. Router Validator 规则

## 3.1 JSON 合法性校验

### 规则
输出必须是合法 JSON。

### 失败示例
- 有多余文字包在 JSON 外面
- JSON 少逗号、少引号
- 输出是 markdown 包裹的伪 JSON

### 处理
- 判定 `FAIL_JSON_INVALID`
- 触发一次重试

---

## 3.2 顶层字段完整性校验

### 必须字段
- `intent`
- `parameters`
- `missing_fields`
- `confidence`
- `reply`

### 失败示例
缺少任意一个字段。

### 处理
- 判定 `FAIL_REQUIRED_FIELD_MISSING`

---

## 3.3 intent 合法性校验

### 规则
`intent` 必须属于预定义枚举：

- `CREATE_CHARACTER_CANDIDATES`
- `REFINE_EXISTING_CHARACTER`
- `DEFINE_CHARACTER_RELATION`
- `ADVANCE_PLOT`
- `GENERATE_SCENE_OPTIONS`
- `EXPAND_WORLD_SETTING`
- `REVIEW_EXISTING_OUTLINE`
- `SUMMARIZE_CURRENT_STATE`
- `OTHER`

### 失败示例
- `REFINE_CHARACTER`
- `CREATE_ROLE`
- `PLOT_HELP`

### 处理
- 判定 `FAIL_INTENT_OUT_OF_ENUM`
- 可选修复：降级为 `OTHER`
- 同时写入异常日志

---

## 3.4 confidence 取值校验

### 规则
- 必须为数字
- 取值范围必须在 `0.0 ~ 1.0`

### 失败示例
- `"high"`
- `1.2`
- `-0.3`

### 处理
- 判定 `FAIL_CONFIDENCE_INVALID`

---

## 3.5 parameters 基础完整性校验

### 规则
- `parameters` 必须存在
- 必须是对象
- 不能长期出现“全空对象 + 空 missing_fields”的假成功

### 失败示例

````json
{
  "intent": "ADVANCE_PLOT",
  "parameters": {},
  "missing_fields": [],
  "confidence": 0.95,
  "reply": "已识别为推进当前剧情的请求。"
}
````

### 处理
- 判定 `FAIL_PARAMETERS_EMPTY`
- 优先触发重试

---

## 3.6 missing_fields 一致性校验

### 规则
如果参数中明显存在缺失，但 `missing_fields` 为空，应判为不一致。

### 示例
当 `CREATE_CHARACTER_CANDIDATES` 中：
- `candidate_count = null`
- `role_type = ""`

而 `missing_fields = []`

这通常不合理。

### 处理
- 判定 `FAIL_MISSING_FIELDS_INCONSISTENT`

---

## 3.7 reply 合规性校验

### 规则
`reply` 必须是状态确认型，不能是执行承诺型。

### 非法关键词参考
- “好的，我会”
- “我来帮你写”
- “我现在开始”
- “接下来我为你生成”
- “我将为你补全”

### 合法示例
- 已识别为推进当前剧情的请求。
- 已识别为对现有角色进行细化的请求。

### 处理
- 判定 `FAIL_REPLY_OVERREACH`
- 可选修复：自动替换为模板化状态确认文本

---

# 4. Intent 与参数槽位匹配校验

Validator 不只看有没有参数，还要看参数是否和 intent 匹配。

---

## 4.1 CREATE_CHARACTER_CANDIDATES 参数校验

### 至少应包含
- `work_name`
- `plot_scope`
- `generation_target`

### 推荐检查
- `generation_target == "new_character_candidates"`

### 常见失败
- 漏 `plot_scope`
- `generation_target` 填成别的
- `parameters` 里混入不相关角色细化字段

---

## 4.2 REFINE_EXISTING_CHARACTER 参数校验

### 至少应包含
- `work_name`
- `character_name`
- `refine_dimensions`

### 常见失败
- 缺 `character_name`
- `refine_dimensions` 为空且不在 `missing_fields`
- 混入关系字段 `character_b`

---

## 4.3 DEFINE_CHARACTER_RELATION 参数校验

### 至少应包含
- `work_name`
- `character_a`
- `character_b`

### 常见失败
- 只给一个角色
- 关系目标完全缺失
- 错判成角色细化

---

## 4.4 ADVANCE_PLOT 参数校验

### 至少应包含
- `work_name`
- `current_plot_scope`
- `advance_goal`

### 常见失败
- 没有推进目标
- 把它误做场景候选
- 把 `current_plot_scope` 留空但未标缺失

---

## 4.5 GENERATE_SCENE_OPTIONS 参数校验

### 至少应包含
- `work_name`
- `scene_goal`
- `based_on_plot_scope`

---

## 4.6 EXPAND_WORLD_SETTING 参数校验

### 至少应包含
- `work_name`
- `setting_domain`
- `expansion_goal`

---

## 4.7 REVIEW_EXISTING_OUTLINE 参数校验

### 至少应包含
- `work_name`
- `review_target`

---

## 4.8 SUMMARIZE_CURRENT_STATE 参数校验

### 至少应包含
- `work_name`
- `summary_scope`

---

# 5. Executor Validator 规则

Executor 不输出 Router JSON，所以它的校验重点不同。

---

## 5.1 输出结构校验

### 规则
执行器输出必须符合对应 intent 的格式模板。

例如 `ADVANCE_PLOT_EXECUTOR` 应至少包含：

- 当前状态判断
- 下一步推进目标
- 推荐推进路径
- 关键冲突点

### 失败示例
只给一段散文，没有结构。

### 处理
- 判定 `FAIL_EXECUTOR_FORMAT_INVALID`
- 触发一次格式修复重试

---

## 5.2 必要小节校验

对于每个执行器，定义必须出现的小节。

### 示例：CREATE_CHARACTER_CANDIDATES_EXECUTOR
必须有：
- 至少两个候选角色
- 每个候选包含功能位
- 有综合建议

### 示例：REVIEW_EXISTING_OUTLINE_EXECUTOR
必须有：
- 总体判断
- 主要问题
- 修正建议

---

## 5.3 约束遵守校验

### 规则
执行器输出不得违反输入 constraints。

### 示例
输入约束：
- 不自创门派
- 尽量使用原著已有势力

执行器却输出：
- 主角加入“玄冥九曜宗”

这就违反约束。

### 处理
- 判定 `FAIL_CONSTRAINT_VIOLATION`

---

## 5.4 目标对齐校验

### 规则
执行器输出必须围绕当前任务目标。

### 失败示例
任务是 `ADVANCE_PLOT`，结果给了角色小传。
任务是 `REFINE_EXISTING_CHARACTER`，结果开始扩世界观。

### 处理
- 判定 `FAIL_TASK_MISALIGNED`

---

# 6. 失败码建议

建议定义统一失败码：

- `FAIL_JSON_INVALID`
- `FAIL_REQUIRED_FIELD_MISSING`
- `FAIL_INTENT_OUT_OF_ENUM`
- `FAIL_CONFIDENCE_INVALID`
- `FAIL_PARAMETERS_EMPTY`
- `FAIL_MISSING_FIELDS_INCONSISTENT`
- `FAIL_REPLY_OVERREACH`
- `FAIL_SLOT_MISMATCH`
- `FAIL_EXECUTOR_FORMAT_INVALID`
- `FAIL_CONSTRAINT_VIOLATION`
- `FAIL_TASK_MISALIGNED`

---

# 7. 校验结果结构建议

建议 Validator 输出如下结构：

````json
{
  "is_valid": false,
  "stage": "router",
  "error_codes": [
    "FAIL_REPLY_OVERREACH",
    "FAIL_MISSING_FIELDS_INCONSISTENT"
  ],
  "warnings": [],
  "suggested_action": "retry_with_stricter_instruction"
}
````

---

# 8. 建议动作策略

## 8.1 retry_with_stricter_instruction
适用：
- JSON 非法
- reply 越权
- 少量字段缺失

## 8.2 auto_repair_reply
适用：
- 只有 reply 越权，其余都对

## 8.3 downgrade_to_other
适用：
- intent 不稳定或不在枚举中

## 8.4 needs_clarification
适用：
- 核心参数缺失，无法默认补

## 8.5 reject_and_log
适用：
- 严重不一致
- 多次重试仍失败

---

# 9. 最低落地规则建议

如果你现在只做 MVP，至少先实现以下 6 条校验：

1. JSON 合法性
2. 顶层字段完整性
3. intent 枚举合法性
4. parameters 不为空对象
5. reply 不越权
6. intent 与参数槽位基本匹配

这 6 条已经能拦下大量假成功结果。

---

# 10. 一句结论

没有 Validator 的系统，会把“会说漂亮话的错误结果”当成成功。

这类系统前期看着顺，后期一定炸。