# Patch 07: 交互日志与新增对象持久化

## 目标

在现有 SQLite 骨架上增加回放和分析所需的最小存储对象，优先补 `interaction_logs`，随后视需要补 `relations` 和 `settings`。

当前已有：

- `decision_logs`
- `continuity_states`
- `works / characters / outlines / volumes / chapters / drafts`

见 [schema.sql](/Users/loong/workspace/novel/ai-novel-studio/novel_workbench/storage/schema.sql:181)。

## 建议修改文件

- `novel_workbench/storage/schema.sql`
- `novel_workbench/storage/repositories.py`
- `novel_workbench/services/workbench.py`

## 第一优先级

### `interaction_logs`

字段建议：

- `id`
- `work_id`
- `user_input`
- `router_result_json`
- `router_validation_json`
- `executor_result_json`
- `executor_validation_json`
- `status`
- `created_at`
- `updated_at`

## 第二优先级

### `relations`

用于后续关系类 intent。

### `settings`

用于后续世界设定扩写类 intent。

## 实施步骤

1. 在 schema 中新增 `interaction_logs` 表和索引。
2. 在 repository bundle 中补对应 repository。
3. 在 route / execute 编排链中落交互日志。
4. 明确哪些字段存原始 JSON，哪些字段存摘要字段。
5. 再评估是否补 `relations / settings`。

## 验收标准

- 每次 route / execute 都可回放。
- 能按作品查看最近交互历史。
- bad case 可以定位到原始用户输入和对应 Router 输出。
- 不需要先引入更重的数据库。

## 风险

- 如果 JSON 字段无限膨胀，SQLite 查询体验会变差。
- 如果 interaction log 和 decision log 语义不区分，后续会混乱。

## 依赖

- 最好在 `patch-06-http-api-compat.md` 之后进行
