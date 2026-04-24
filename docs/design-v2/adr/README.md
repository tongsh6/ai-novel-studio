# ADR 目录

> 状态：草案
>
> 目的：记录 v2 设计过程中的架构决策（Architecture Decision Record）。

---

## 1. ADR 是什么

ADR 是一个短文档，用来固化一次硬骨决策：

- 它为什么被提出
- 被考虑过的方案
- 最终选择
- 选择的原因
- 不采用其他方案的原因
- 迁移策略（如果涉及破坏性变更）

ADR 是设计过程的长期记忆，用来防止后续回流讨论同一个已经定过的问题。

---

## 2. 何时必须写 ADR

参照 `../README.md` §6：

- Foundation 硬骨（Layer 1 子系统 1-12）改动：**必须 ADR**。
- Domain 核心对象与连续性机制改动：**必须 ADR**。
- UI 仅表现层微调：可不写 ADR。
- UI 若反向要求 contract 变更：**必须先写 ADR，再改 Foundation / Domain 文档**。

新增子系统、新增模块、改动 AgentTurnResult / canonical result 语义、改变 intent/capability 边界、改变 adoption / projection 规则，均属于硬骨范畴。

---

## 3. ADR 文件命名

```text
NNNN-<slug>.md
```

- `NNNN`：四位自增编号，从 `0001` 开始。
- `<slug>`：kebab-case 的简短主题，描述决策核心。

示例：

- `0001-agent-turn-result-v2.md`
- `0002-consistency-subsystem-split.md`

`0000-index.md` 是总索引，记录历史上已经形成共识、但还没有拆到独立 ADR 文件中的决策清单。

---

## 4. ADR 模板

```markdown
# ADR-NNNN：<决策标题>

- 状态：Proposed / Accepted / Deprecated / Superseded by ADR-XXXX
- 日期：YYYY-MM-DD
- 涉及范围：Foundation / Domain / UI 中的具体子系统或模块
- 相关文档：列出引用或受影响的设计文档

## 背景

说明提出这次决策的触发点。

## 考虑过的方案

- 方案 A：描述 + 利弊
- 方案 B：描述 + 利弊
- 方案 C：描述 + 利弊

## 最终决策

选择了哪个方案。

## 决策原因

为什么选它，为什么不选其它。

## 影响

- 对 Foundation 的影响
- 对 Domain 的影响
- 对 UI 的影响
- 迁移策略（如为破坏性变更）

## 后续工作

- 需要更新的文档
- 需要补的契约测试
- 需要追踪的 deprecation 窗口
```

---

## 5. ADR 状态

- **Proposed**：正在评审。
- **Accepted**：已接受，为当前有效决策。
- **Deprecated**：已弃用，但未被替代。
- **Superseded by ADR-XXXX**：已被新的 ADR 替代；新 ADR 必须明确引用被替代的编号。

历史 ADR 永不删除，只能改状态。
