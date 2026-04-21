# Patch 06: HTTP API 两阶段协议与兼容壳

## 目标

在不破坏现有前端的前提下，为服务端补齐显式 `route` / `execute` 两阶段接口。

当前接口仍以 `/chat` 为主，且默认直接执行，见 [http_api.py](/Users/loong/workspace/novel/ai-novel-studio/novel_workbench/http_api.py:52)。

## 建议修改文件

- `novel_workbench/http_api.py`
- `novel_workbench/services/workbench.py`

## 建议新增接口

- `POST /api/works/{id}/route`
- `POST /api/works/{id}/execute`
- `POST /api/works/{id}/interactions`

## 兼容策略

- 保留 `/api/chat`
- 保留 `/api/works/{id}/chat`
- 旧 `/chat` 内部改成：
  - `route`
  - validate
  - auto-fill / clarification
  - execute if ready

## 实施步骤

1. 为 Router 结果定义统一响应包装：
   - `status`
   - `routeResult`
   - `validationResult`
2. 为 Executor 结果定义统一响应包装：
   - `status`
   - `executionResult`
   - `persistenceResult`
3. 旧 `/chat` 变成兼容壳，而不是主协议入口。
4. 明确以下状态值：
   - `ROUTED`
   - `NEEDS_CLARIFICATION`
   - `READY_FOR_EXECUTION`
   - `EXECUTING`
   - `COMPLETED`
   - `FAILED`

## 验收标准

- 可以显式只做 route，不直接执行。
- 旧前端继续能跑。
- 兼容接口内部不再直接绑定旧 intent 集。
- HTTP 层返回结构能区分“理解请求失败”和“执行失败”。

## 风险

- 前端如果强依赖旧 `reply + actionResult` 结构，会需要补适配。
- 如果状态定义不稳定，前后端会反复返工。

## 依赖

- 依赖 `patch-01` 到 `patch-05`
