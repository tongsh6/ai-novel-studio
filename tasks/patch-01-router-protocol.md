# Patch 01: Router 协议层落地

## 目标

把现有混合式意图识别从 [novel_workbench/services/prompts.py](/Users/loong/workspace/novel/ai-novel-studio/novel_workbench/services/prompts.py:9) 中抽离出来，形成一个纯协议型 Router 层。

本 patch 完成后：

- Router 只负责识别意图和提取参数。
- Router 不直接写库，不直接触发创作。
- 先只启用 4 个最小 intent。

## 建议新增文件

- `novel_workbench/router/__init__.py`
- `novel_workbench/router/intents.py`
- `novel_workbench/router/schemas.py`
- `novel_workbench/router/prompts.py`
- `novel_workbench/router/service.py`

## 建议修改文件

- `novel_workbench/services/workbench.py`
- `novel_workbench/services/prompts.py`

## 设计约束

- 最小 intent 集：
  - `CREATE_CHARACTER_CANDIDATES`
  - `REFINE_EXISTING_CHARACTER`
  - `ADVANCE_PLOT`
  - `SUMMARIZE_CURRENT_STATE`
  - 降级值：`OTHER`
- Router 输出结构固定为：

```json
{
  "intent": "",
  "parameters": {},
  "missing_fields": [],
  "confidence": 0.0,
  "reply": ""
}
```

## 实施步骤

1. 在 `router/intents.py` 中定义最小 intent 枚举和合法值集合。
2. 在 `router/schemas.py` 中定义 Router 输出对象的归一化函数。
3. 在 `router/prompts.py` 中迁移 Router system prompt 和最小上下文模板。
4. 在 `router/service.py` 中实现 `route(text, context) -> RouterResult`。
5. 从旧 `services/prompts.py` 中移除或弱化 `_INTENT_SYSTEM` 的混合职责。
6. 在 `WorkbenchService` 中引入 Router 服务，但先不触发执行。

## 验收标准

- 存在可单独调用的 Router 服务。
- Router 调用结果包含 `missing_fields` 和 `confidence`。
- Router 输出不再使用 `CREATE_WORK / GENERATE_OUTLINE / GENERATE_DRAFT / UNKNOWN` 这套旧 intent。
- 代码层面能明确区分“路由结果”和“执行结果”。

## 风险

- 旧前端仍依赖 `/chat` 立即得到执行结果。
- 旧 prompt 语义和新 Router intent 之间会有一段兼容期。

## 依赖

- 无。该 patch 是后续所有 patch 的基础。
