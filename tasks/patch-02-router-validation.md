# Patch 02: Router Validator 与缺失字段策略

## 目标

为 Router 增加显式校验与缺失字段处理，避免当前“LLM 给出看似能用的 JSON，但实际上不可执行”的情况。

## 建议新增文件

- `novel_workbench/validators/__init__.py`
- `novel_workbench/validators/router_validator.py`
- `novel_workbench/router/defaults.py`

## 建议修改文件

- `novel_workbench/router/service.py`
- `novel_workbench/services/workbench.py`

## 核心能力

- JSON 结构校验
- intent 合法性校验
- 参数槽位与 intent 一致性校验
- `missing_fields` 一致性校验
- `reply` 越权校验
- 默认值补全与 clarification 分流

## 实施步骤

1. 在 `router_validator.py` 中实现 `validate_router_result(result)`。
2. 先覆盖以下规则：
   - 必须包含 `intent / parameters / missing_fields / confidence / reply`
   - `intent` 必须在最小枚举中
   - `confidence` 必须在 `0.0 ~ 1.0`
   - `reply` 不能包含执行承诺语义
3. 在 `defaults.py` 中实现最小默认补全规则：
   - `candidate_count` 默认 `3`
   - `plot_scope` 默认 `current_plot`
   - `summary_scope` 默认 `current_work`
4. 在 `WorkbenchService` 中加入 clarification 状态分流：
   - 有默认值可补则补
   - 否则返回 `NEEDS_CLARIFICATION`

## 验收标准

- 非法 Router 输出不会直接进入执行阶段。
- 空参数假成功会被识别出来。
- 缺失字段会被显式返回，而不是静默吞掉。
- `/chat` 或后续 `/route` 能返回结构化状态，而不是单纯一段回复文本。

## 风险

- 严格校验会使旧模型 prompt 的失败率短期上升。
- clarification 策略如果定义不清，会导致流程卡住。

## 依赖

- 依赖 `patch-01-router-protocol.md`
