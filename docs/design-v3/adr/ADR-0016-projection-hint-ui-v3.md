# ADR-0016：Projection Hint UI v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §5, §6, §7, §8, §9, §11
  - `../07-workbench-ui-contract.md` §8, §12
  - `../contracts/VS-04-adoption-boundary-contract-pack.md`
- 影响范围：UI / Projection / Execution / Trace / Slice
- 相关不变量：`00c` §7 #9、#11、#15
- 首个证明 slice：VS-04 Candidate selection 与 adoption 边界
- 取代：无
- 取代者：无

---

## 背景

采纳状态后，UI 需要知道哪些 read model 或视图应刷新。但刷新提示不能被误解为写入授权，也不能让 Reading View 反向触发 production write。

## 决策范围

本 ADR 冻结 VS-04 所需的最小 `ProjectionHint` contract 和 UI 边界。

## 非目标

- 不冻结最终 projection read model。
- 不定义前端缓存策略。
- 不定义数据库 projection 表。
- 不冻结完整 TurnResultViewModel。

## 考虑过的方案

### 方案 A：UI 自行猜测刷新范围

- 优点：后端更少字段。
- 缺点：UI 会根据局部状态发明业务事实，容易漏刷新或误刷新。

### 方案 B：ProjectionHint 也可触发写入

- 优点：交互链路短。
- 缺点：刷新层和写入层混淆，违反 truth boundary。

### 方案 C：ProjectionHint 只表达刷新提示

- 优点：读模型刷新和 production write 清晰分离。
- 缺点：需要追踪 source state trace。

## 最终决策

采用方案 C。ProjectionHint 只来自已采纳状态变化，并且只允许 UI 刷新 read model。

核心规则：

1. ProjectionHint 必须引用 StateTrace。
2. ProjectionHint 不能来自单纯 candidate selection。
3. UI 根据 hint 刷新失败时，不能回滚或改写 production state。
4. Reading View 不能通过 hint 发起写入 capability。

## 决策理由

ProjectionHint 是跨后端采纳和 UI 投影之间的轻量桥梁。它让 UI 能及时刷新，又不把投影层变成事实来源。

## Contract 影响

- 新增 VS-04 最小 `ProjectionHint`。
- `TurnResult.projection_hints` 只能表达刷新。
- AdoptionDecision 采纳成功后可携带 projection hints。

## Umbrella 边界影响

- `novel_application` 生成 projection hints。
- `novel_web` / frontend 消费 hints 并刷新读视图。
- `novel_persistence` 可保存或提供 read model，但不由 UI hint 决定写入。
- `novel_agent` 不生成 projection hints 作为写入事实。

## UI / Trace / Replay 影响

UI 展示 projection notice 或刷新相关视图。Trace 记录 hint 来源。Replay 能解释某个刷新提示来自哪个 adopted state。

## 垂直切面证明

VS-04 必须证明 projection hint not write、hint requires state trace、refresh failure 不改变 production state。

## 迁移与兼容

v2 中前端依据接口返回局部字段自行刷新或写状态的逻辑，需要迁移为消费 TurnResult projection hints。

## 后续工作

- VS-05 冻结 TurnResultViewModel 的 projection hint 显示。
- VS-06 冻结 projection hint trace summary。

---
