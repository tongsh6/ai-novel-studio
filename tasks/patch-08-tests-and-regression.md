# Patch 08: Router/Executor 回归测试与 bad case 基线

## 目标

补齐当前仓库缺失的自动化测试，至少为 Router 协议、Validator 和最小 Executor 建一条可回归的测试基线。

目前仓库没有 `tests/` 目录，也没有自动化 bad case 回归。

## 建议新增文件

- `tests/test_router_service.py`
- `tests/test_router_validator.py`
- `tests/test_context_manager.py`
- `tests/test_executor_registry.py`
- `tests/test_minimal_executors.py`
- `tests/fixtures/router_cases.json`

## 测试分组

### 1. Router 协议测试

- intent 是否命中
- parameters 是否非空
- `missing_fields` 是否合理
- `reply` 是否越权

### 2. Validator 测试

- 非法 JSON
- 非法 intent
- `confidence` 越界
- 参数全空假成功
- `missing_fields` 不一致

### 3. Executor 测试

- `CREATE_CHARACTER_CANDIDATES` 结果结构
- `ADVANCE_PLOT` 结果结构
- `SUMMARIZE_CURRENT_STATE` 降级路径
- `REFINE_EXISTING_CHARACTER` 桥接逻辑

### 4. API 兼容测试

- `/route`
- `/execute`
- 旧 `/chat`

## 实施步骤

1. 建立 `tests/` 目录和最小测试运行方式。
2. 先补纯函数级测试，不急着做集成测试。
3. 为 Router 准备 20 条固定 case。
4. 为历史 bad case 建立回归基线。
5. 在 README 或开发文档中记录测试入口。

## 验收标准

- 新 Router 协议调整后可以快速回归。
- 至少有一组固定 bad case 不会靠人工回忆。
- patch 01 到 patch 07 引入的核心模块都有基础测试覆盖。

## 风险

- 如果测试过度依赖真实 LLM，回归会不稳定。
- 如果不先抽纯函数，测试会被 `WorkbenchService` 大对象拖累。

## 依赖

- 依赖前面所有 patch，至少需要 Router、Validator、Context Manager、Executor 的基础实现。
