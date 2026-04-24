# AGENTS.md

## 角色

你正在协助推进“对话式小说工作台”的文档设计与后续实现准备。  
当前阶段以 **design-v2** 为主，**design-v1** 作为旧设计归档与参考基线存在。

这不是通用聊天应用，也不是创作 ERP。

## 文档目录

当前 `docs/` 目录按版本与职责分区：

```text
docs/
  AGENTS.md
  README.md
  design-v1/
  design-v2/
  ui-design/
  validator-rules.md
```

各目录职责：

- `design-v1/`：v1 与旧设计沉淀，保留已验证过的交互、协议、边界与历史方案
- `design-v2/`：当前主设计区，按 Foundation -> Domain -> UI 的顺序推进
- `ui-design/`：独立 UI 设计文档与 `pencil` 原型资料
- `README.md`：`docs/` 总索引
- `validator-rules.md`：校验规则补充资料

## 产品定位

一个以对话为主入口、以结构化内核为隐性支撑、以阅读模式为结果闭环的小说创作工作台。

## 当前总目标

当前总目标不是继续扩写 v1，而是：

1. 先完成 **v2 系统设计**
2. 再完成 **v2 UI 设计**
3. 为后续 **从头实现或重构实现** 提供清晰、可执行、可验证的 contract

更具体地说：

- 先把 Agent Foundation Layer 设计清楚
- 再把 Novel Domain Layer 设计清楚
- 冻结关键状态机、对象、intent、hook、budget、observability 边界
- 在 contract 稳定后，再进入 UI 文档与 `pencil` 原型设计
- 现有代码与 v1 文档只作为参考资料，不构成 v2 的迁移包袱

## 当前优先级

优先顺序固定：

```text
Foundation -> Domain -> UI
```

当前阶段优先完成：

- Agent 基础层 contract
- 记忆、长跑任务、一致性、编排、多 agent 组合等高风险硬骨
- 小说领域对象、连续性、intent、hook、上下文组装

暂时不要反向推进：

- 不要因为某个 UI 想法改写 Foundation 硬骨
- 不要在 Domain contract 未冻结前先定完成态 UI
- 不要把现有代码结构当成 v2 的实现约束

## 必读文件顺序

如果你在推进当前主线，请优先阅读：

1. `README.md`
2. `design-v2/README.md`
3. `design-v2/00-overview.md`
4. `design-v2/01-agent-foundation-contract.md`
5. `design-v2/05-memory-retention-and-retrieval.md`
6. `design-v2/06-planning-and-long-run.md`
7. `design-v2/07-consistency-and-concurrency.md`
8. `design-v2/12-multi-agent-composition.md`

如果需要参考旧方案，再回看：

1. `design-v1/00-vision.md`
2. `design-v1/01-domain-model-full.md`
3. `design-v1/02-v1-scope.md`
4. `design-v1/05-decisions.md`
5. `design-v1/10-agent-orchestration-upgrade.md`
6. `design-v1/11-agent-turn-result-schema.md`
7. `design-v1/13-orchestrator-runtime-spec.md`

## 当前工作原则

### 1. v2 是主线，v1 是参考

新设计、新约束、新 contract 优先落在 `design-v2/`。  
`design-v1/` 主要用于：

- 回看已验证过的交互与协议
- 提取可继承的边界
- 对比哪些旧实现不应继续继承

### 2. 设计先于实现

在当前阶段：

- 先补清 contract
- 再谈代码落点
- 不要为了显得完整而跳过设计硬骨

### 3. UI 不能反向驱动基础层

UI 只能映射已经冻结的语义，包括：

- canonical result
- card protocol
- clarification / confirmation / checkpoint / adoption
- long-run task 状态
- 结构面板对象视图
- 阅读模式投影规则

### 4. 可以从头实现

v2 的后续代码实现不以“兼容现有项目代码结构”为前提。  
旧代码与旧文档最多作为参考，不作为迁移包袱。

### 5. 高风险硬骨必须显式落文档

尤其是以下主题，不能只靠口头共识：

- 状态机
- 记忆保留与检索
- long-run task 生命周期
- 并发一致性与冲突策略
- 多 agent 组合边界
- 预算、安全、可观测性

## UI 形态约束

优先：

- 单工作台
- 对话流主导
- 结构面板默认隐藏、按需展开
- 正文工作态
- 阅读态

避免：

- 多页面后台
- 大量表单驱动
- 功能菜单堆满
- 在 contract 未冻结前先画复杂大屏

## 工作方式

当你开始处理任务时：

1. 先判断任务属于哪个目录：`design-v1/`、`design-v2/`、`ui-design/` 或索引文档
2. 如果是新设计，默认写入 `design-v2/`
3. 如果是旧资料整理、归档、引用修复，优先落在 `design-v1/` 或 `README.md`
4. 如果是 UI 任务，确保文档与 `pencil` 原型同步推进
5. 如果修改 Foundation 或 Domain 硬骨，先检查是否需要 ADR
6. 如果引用了旧文档，明确它是“参考”还是“现行约束”

## 硬约束

### 1. 不要把 v1 当成 v2 的实现包袱

v1 是参考，不是必须兼容的目标系统。

### 2. 不要跳过 contract 直接做表现层

没有语义定义的 UI 只是草图，不算完成。

### 3. 不要让小说领域反向污染 Agent Foundation

Foundation 先保持通用抽象，再由 Domain 层承接小说业务。

### 4. 不要把分析投影当成源事实

可读性、节奏分、崩盘风险等属于派生分析，不应直接污染核心对象。

### 5. 所有关键裁剪与新增都要落文档

需要同步到对应的 `design-v2/` 文档；如需单独沉淀 ADR，补建并使用 `design-v2/adr/`。
