# B47：Canon Freshness 与持久冲突发现

- 状态：**todo（先 contract 后实现，未开工）**。
- 登记日期：2026-10-27；来源：当前部分安全检查依赖候选预声明 `canon_conflicts`，不能证明系统会从当前持久事实自动发现冲突或过期。
- 上游：[AU05-canon-conflict-recovery](AU05-canon-conflict-recovery.md)、[AU05-file-level-closure](AU05-file-level-closure.md)、[B28](B28-whole-chapter-revision.md)、[B29](B29-existing-character-role-revision.md)、[B36](B36-localized-revision-algorithm.md)。

## 1. 问题与目标

当前系统能处理“候选自己声明有冲突”的情况，但真正的持久事实安全还需要：

- 候选与当前 canon 的冲突由系统按真实对象和版本发现，而不是靠模型或候选自报；
- base revision/fingerprint 变化后旧候选被识别为 stale，不得继续写入；
- 覆盖时重新 gate，StateTrace/receipt 能解释来源、前后版本与拒绝原因。

不能把本任务做成一个泛化“canon store”空架构。应按真实对象逐个复用 B28/B29/B36 已证明的 base version/fingerprint/stale 保护。

## 2. 开工七问

1. **Contract**：VS-04 adoption、现有 revision_base/base_ref/fingerprint/stale_base_version、B28/B29/B36 对象版本语义与 AU05 freshness/conflict 场景。先冻哪些对象支持自动冲突发现，不泛化到所有作品事实。
2. **Invariant**：冲突依据来自当前持久事实与版本，不从 LLM 文案猜；stale base 零写入；覆盖重新 gate；StateTrace/receipt 可回放前后版本与原因；候选未授权变更不写 canon。
3. **Boundary**：application AdoptionBoundary/Workflow、domain 纯比较、persistence 当前 canon/版本读取、web/frontend 既有确认与回执。不新建泛化存储。
4. **Consumer**：AdoptionWorkflow、作者覆盖确认、StateTrace/replay 和后续 freshness 检查。
5. **Proof**：持久 canon A 与候选 B 冲突时自动识别→fail_with_recovery 或覆盖确认；stale base 零写入；同 key/版本幂等；前后版本可解释。
6. **Acceptance Driver**：外部驱动真实候选与持久基线变化，在真实页面确认/拒绝/重试；产品验收感知逻辑 **no**。
7. **Exploration**：canon 当前版本、候选 base、stale 原因和前后版本可从 why/replay 查询，不新增固定 prompt packet。

## 3. Checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 选择首批真实对象与冲突类型，冻结 base version/fingerprint、自动检测、stale 与重新 gate 语义；确认现有持久源可支持 | 未开工 |
| CP1 | 实现对象级基线比较与自动冲突/stale 检测；不从候选自报推断 | 未开工 |
| CP2 | 采纳事务内重新 gate、失败回滚、StateTrace/receipt 前后版本；确认/拒绝幂等 | 未开工 |
| CP3 | 真实页面冲突、stale、覆盖确认与恢复矩阵；同步 AU05 freshness/conflict 证据，其他对象按真实消费者扩展 | 未开工 |

## 4. 非目标

- 不新建泛化 canon store、版本表或第二套事实源。
- 不让模型判断代替持久版本和对象规则。
- 不把 B28/B29/B36 的对象保护复制成互不一致的全局逻辑。
- 不把所有语义冲突都机械判为同一 action；高风险仍按 adoption/confirmation 边界处理。

## 5. 验证与恢复

- 持久基线改变后旧候选 stale，零写入；当前 canon 与候选冲突时系统自行发现，而非候选预声明。
- 合法覆盖重新 gate 并保留前后版本与来源；失败回滚。
- 恢复时先读 B28/B29/B36 和 AU05 freshness；若某对象没有可靠版本语义，先补该对象的 contract，不强行统一。
