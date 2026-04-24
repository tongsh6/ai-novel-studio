# docs 文档索引

当前 `docs/` 目录已经按版本与职责分区，当前主线为 **design-v2**，**design-v1** 作为旧设计归档与参考基线保留。

```text
docs/
  AGENTS.md
  README.md
  design-v1/
  design-v2/
  ui-design/
  validator-rules.md
```

## 当前总目标

当前总目标不是继续扩写 v1，而是：

1. 先完成 **v2 系统设计**
2. 再完成 **v2 UI 设计**
3. 为后续 **从头实现或重构实现** 提供清晰、可执行、可验证的 contract

推进顺序固定为：

```text
Foundation -> Domain -> UI
```

这意味着：

- 先完成 Agent Foundation Layer 的关键硬骨设计
- 再完成 Novel Domain Layer 的对象、连续性、intent、hook、上下文组装设计
- 在 contract 足够稳定后，再进入 UI 文档与 `pencil` 原型设计
- 现有代码与旧文档只作为参考资料，不构成 v2 的实现约束

## 目录说明

### `design-v2/`

当前主设计区，按 **Foundation -> Domain -> UI** 的顺序推进。

主要用途：

- 定义 v2 的核心 contract
- 冻结状态机、对象、intent、hook、budget、observability 等边界
- 为后续实现提供清晰落点

建议优先阅读：

1. `design-v2/README.md`
2. `design-v2/00-overview.md`
3. `design-v2/01-agent-foundation-contract.md`
4. `design-v2/05-memory-retention-and-retrieval.md`
5. `design-v2/06-planning-and-long-run.md`
6. `design-v2/07-consistency-and-concurrency.md`
7. `design-v2/12-multi-agent-composition.md`

### `design-v1/`

v1 与旧设计沉淀，保留已验证过的交互、协议、边界与历史方案。

主要用途：

- 回看已验证过的交互与协议
- 提取可继承的边界
- 对比哪些旧实现不应继续继承

建议在需要旧方案参考时阅读：

1. `design-v1/00-vision.md`
2. `design-v1/01-domain-model-full.md`
3. `design-v1/02-v1-scope.md`
4. `design-v1/05-decisions.md`
5. `design-v1/10-agent-orchestration-upgrade.md`
6. `design-v1/11-agent-turn-result-schema.md`
7. `design-v1/13-orchestrator-runtime-spec.md`

### `ui-design/`

独立 UI 设计文档与 `pencil` 原型资料区。

注意：

- UI 设计不能反向驱动 Foundation 硬骨
- 没有冻结语义定义的 UI，只能算草图，不能算完成态设计
- UI 文档与 `pencil` 原型应同步推进

### `AGENTS.md`

给协作代理的工作约束、目录职责、当前总目标与阅读顺序说明。

### `validator-rules.md`

校验规则补充资料。

## 当前工作原则

### 1. v2 是主线，v1 是参考

新设计、新约束、新 contract 优先落在 `design-v2/`。

### 2. 设计先于实现

当前阶段先补清 contract，再谈代码落点。

### 3. UI 不反向驱动基础层

UI 应严格映射已经冻结的语义，例如：

- canonical result
- card protocol
- clarification / confirmation / checkpoint / adoption
- long-run task 状态
- 结构面板对象视图
- 阅读模式投影规则

### 4. 可以从头实现

v2 的后续实现不以兼容现有代码结构为前提。

### 5. 关键裁剪与新增必须落文档

优先同步到对应的 `design-v2/` 文档；如需单独沉淀 ADR，可补建并使用 `design-v2/adr/`。
