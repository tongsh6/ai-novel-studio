# Router-Executor 重构任务清单

本目录将 [docs/00-full-design-solution-v1.0.md](/Users/loong/workspace/novel/ai-novel-studio/docs/00-full-design-solution-v1.0.md:1) 的迁移方案拆成一组可独立提交的 patch。

拆分原则：

- 每个 patch 只解决一层结构问题，避免混改。
- 优先保护当前可用链路：立项、角色、章节细纲、正文草稿、阅读模式。
- 先补协议层和边界，再扩执行器和存储。
- 新接口先增量引入，旧接口保留兼容壳。

当前状态：

- [x] `patch-01-router-protocol.md`
- [x] `patch-02-router-validation.md`
- [x] `patch-03-context-manager.md`
- [x] `patch-04-executor-contract.md`
- [x] `patch-05-minimal-intent-executors.md`
- [x] `patch-06-http-api-compat.md`
- [x] `patch-07-storage-and-logs.md`
- [x] `patch-08-tests-and-regression.md`

执行顺序：

1. [patch-01-router-protocol.md](./patch-01-router-protocol.md)
2. [patch-02-router-validation.md](./patch-02-router-validation.md)
3. [patch-03-context-manager.md](./patch-03-context-manager.md)
4. [patch-04-executor-contract.md](./patch-04-executor-contract.md)
5. [patch-05-minimal-intent-executors.md](./patch-05-minimal-intent-executors.md)
6. [patch-06-http-api-compat.md](./patch-06-http-api-compat.md)
7. [patch-07-storage-and-logs.md](./patch-07-storage-and-logs.md)
8. [patch-08-tests-and-regression.md](./patch-08-tests-and-regression.md)

目标落地结果：

- `chat_intent()` 不再直接扮演“路由+执行+兜底回复”三合一入口。
- Router 输出统一为 `intent / parameters / missing_fields / confidence / reply`。
- Validator 能拦截非法 JSON、非法 intent、空参数假成功、reply 越权。
- Context Manager 负责为 Router 和 Executor 分层组装上下文。
- Executor 通过统一接口按 intent 执行。
- HTTP API 支持显式 `route` / `execute` 两阶段，同时兼容旧 `/chat`。
- SQLite 增补交互日志等新对象，支撑回放与 bad case 分析。

非目标：

- 本轮不重写前端。
- 本轮不一次性落地全部 9 个 intent。
- 本轮不推翻现有章节细纲 / 草稿 / 修订链路。
