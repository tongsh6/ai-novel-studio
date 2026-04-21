# Patch 03: Context Manager 最小分层

## 目标

把当前散落在 prompt builder 内的上下文拼接逻辑抽出来，形成最小可用的 Context Manager。

当前问题见：

- [build_intent_messages()](/Users/loong/workspace/novel/ai-novel-studio/novel_workbench/services/prompts.py:37)
- [build_outline_messages()](/Users/loong/workspace/novel/ai-novel-studio/novel_workbench/services/prompts.py:88)

这些函数直接拼接上下文，导致 Router 和 Executor 的上下文边界混在一起。

## 建议新增文件

- `novel_workbench/context_manager.py`

## 建议修改文件

- `novel_workbench/router/prompts.py`
- `novel_workbench/services/prompts.py`
- `novel_workbench/services/workbench.py`

## 本 patch 范围

先只做两层：

- `L1`: Router 最小上下文
- `L2`: Executor 执行上下文

暂不实现：

- 完整 L3 全局背景层
- 完整 L4 系统约束注册中心

## 实施步骤

1. 定义 `build_router_context(work_id, text)`。
2. 定义 `build_executor_context(work_id, intent, parameters)`。
3. Router 上下文只允许包含：
   - 当前作品
   - 当前剧情范围
   - 当前约束
   - 用户原始请求
4. Executor 上下文按 intent 选择性装配：
   - 作品摘要
   - 当前章节摘要
   - 相关角色
   - 相关设定
   - 最近决策
5. 把 prompt builder 里的业务取数逻辑迁回 `WorkbenchService` 或 `ContextManager`。

## 验收标准

- Router prompt 不再读取与当前任务无关的大块信息。
- Executor prompt 的上下文来源统一，避免每个 prompt builder 各拼一套。
- 代码里不再出现多个 prompt builder 直接从仓储层抓数据的情况。

## 风险

- 上下文裁剪过度会让执行器结果变差。
- 如果相关对象筛选策略过粗，Context Manager 很快又会变成另一个“大杂烩”。

## 依赖

- 依赖 `patch-01-router-protocol.md`
- 最好在 `patch-02-router-validation.md` 之后进行
