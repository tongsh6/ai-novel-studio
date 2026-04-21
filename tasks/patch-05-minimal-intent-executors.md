# Patch 05: 四个最小 Intent 执行器落地

## 目标

为最小 intent 集实现真正可运行的执行器，同时尽量复用现有能力。

## 建议新增文件

- `novel_workbench/executors/create_character_candidates.py`
- `novel_workbench/executors/refine_existing_character.py`
- `novel_workbench/executors/advance_plot.py`
- `novel_workbench/executors/summarize_current_state.py`
- `novel_workbench/validators/executor_validator.py`

## 建议修改文件

- `novel_workbench/services/prompts.py`
- `novel_workbench/services/workbench.py`

## 执行器分组策略

### 1. 可复用现有逻辑的

- `REFINE_EXISTING_CHARACTER`
  - 优先桥接到现有 `refine_character()`

### 2. 可先用聚合视图完成的

- `SUMMARIZE_CURRENT_STATE`
  - 优先基于 `open_workbench()` 聚合返回做总结

### 3. 需要新 prompt 的

- `CREATE_CHARACTER_CANDIDATES`
- `ADVANCE_PLOT`

## 实施步骤

1. 为 `CREATE_CHARACTER_CANDIDATES` 定义 Markdown 结构输出。
2. 为 `ADVANCE_PLOT` 定义结构化推进方案输出。
3. 为 `REFINE_EXISTING_CHARACTER` 增加“现有角色不存在时”的明确返回语义。
4. 为 `SUMMARIZE_CURRENT_STATE` 提供无模型或轻模型降级方案。
5. 为四类执行器增加基础输出校验：
   - 结构完整
   - 结果与 intent 匹配
   - 不跨任务乱写

## 验收标准

- 四个最小 intent 均可独立执行。
- 输出结果具有稳定结构，而不是随意散文。
- `SUMMARIZE_CURRENT_STATE` 不依赖章节草稿存在也能运行。
- `REFINE_EXISTING_CHARACTER` 不再和旧 `REFINE_CHARACTER` 语义混用。

## 风险

- `ADVANCE_PLOT` 容易和旧章节细纲/正文草稿能力边界冲突。
- `CREATE_CHARACTER_CANDIDATES` 如果缺关系/设定存储支持，短期只能做轻执行。

## 依赖

- 依赖 `patch-04-executor-contract.md`
