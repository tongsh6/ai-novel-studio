# Patch 04: Executor 统一接口与调度层

## 目标

建立独立的 Executor 合同层，让执行阶段不再散落在 `WorkbenchService` 的条件分支里。

当前耦合点见 [chat_intent()](/Users/loong/workspace/novel/ai-novel-studio/novel_workbench/services/workbench.py:713)。

## 建议新增文件

- `novel_workbench/executors/__init__.py`
- `novel_workbench/executors/base.py`
- `novel_workbench/executors/registry.py`
- `novel_workbench/executors/result_types.py`

## 建议修改文件

- `novel_workbench/services/workbench.py`

## 目标接口

建议定义：

- `ExecutorContext`
- `ExecutorResult`
- `BaseExecutor`
- `ExecutorRegistry`

统一入口建议为：

`execute(intent, parameters, context) -> ExecutorResult`

## 实施步骤

1. 为执行器定义统一的输入输出结构。
2. 引入 executor registry，根据 intent 找到执行器。
3. 把 `WorkbenchService` 中分支式执行逻辑搬到 registry 调度。
4. `WorkbenchService` 只保留编排职责：
   - route
   - validate
   - assemble context
   - dispatch executor
   - persist result

## 验收标准

- `WorkbenchService` 中不再用长 `if/elif` 分派 intent。
- 每个 executor 都通过统一接口暴露能力。
- 后续新增 intent 时不需要继续往 `chat_intent()` 里叠条件。

## 风险

- 过早抽象会把当前小代码库搞复杂。
- 统一接口过宽，会导致 executor 之间仍然很难隔离。

## 依赖

- 依赖 `patch-03-context-manager.md`
