# ADR-0000：历史决策索引

- 状态：Accepted（作为索引）
- 日期：2026-04-23
- 涉及范围：Foundation + Domain 全局
- 相关文档：`../00-overview.md` §7

---

## 1. 本文定位

v2 设计过程中已经形成共识的若干关键决策目前以精简条目形式集中记录在 `00-overview.md` §7「关键设计决策索引」。

本文是一个跳板：

- 列出这批决策的编号与主题
- 说明它们当前的权威存放位置
- 指明何时应把某一条从 `00-overview.md` §7 搬到独立 ADR 文件

拆分原则：

- 当某条决策被重新质疑、扩展、或产生 breaking change 时，必须拆为独立 ADR。
- 当某条决策需要详细写明「考虑过的方案 + 原因 + 迁移策略」时，也必须拆为独立 ADR。
- 仅作为共识快照、暂无变动压力的条目，可继续留在 `00-overview.md` §7。

---

## 2. 历史决策清单（D2-001 ~ D2-017）

所有条目当前的权威原文在 `../00-overview.md` §7。

| 编号 | 主题 | 当前位置 | 独立 ADR |
| --- | --- | --- | --- |
| D2-001 | 目标用户是网文长篇连载作者 | `../00-overview.md` §7 | 未拆分 |
| D2-002 | 人机分工采用 Co-author + Ghost writer 混合 | `../00-overview.md` §7 | 未拆分 |
| D2-003 | 体量目标是长期连载 | `../00-overview.md` §7 | 未拆分 |
| D2-004 | 记忆内核采用结构化对象库 + 片段检索混合 | `../00-overview.md` §7 | 未拆分 |
| D2-005 | 创作粒度采用全生命周期设计，默认场景级可控生成 | `../00-overview.md` §7 | 未拆分 |
| D2-006 | 风格注入采用设定文档 + 样本 + brief，在线反馈作为补充 | `../00-overview.md` §7 | 未拆分 |
| D2-007 | 长期连续性系统性建模 | `../00-overview.md` §7 | 未拆分 |
| D2-008 | 维护 intent 采用混合提议 | `../00-overview.md` §7 | 未拆分 |
| D2-009 | 长跑支持中途编辑与自动吸收 | `../00-overview.md` §7 | 未拆分 |
| D2-010 | 长跑资源消耗启动前预估且过程中实时展示 | `../00-overview.md` §7 | 未拆分 |
| D2-011 | V1 单作品单 long-run task，最终形态可多任务但默认关闭并发 | `../00-overview.md` §7 | 未拆分 |
| D2-012 | 章以上层级采用引导式对话 + 隐藏结构面板 | `../00-overview.md` §7 | 未拆分 |
| D2-013 | 第一优先级是 Agent 基础完整形态 | `../00-overview.md` §7 | 未拆分 |
| D2-014 | 小说质量门禁必须领域化 | `../00-overview.md` §7 | 未拆分 |
| D2-015 | 高风险 canon 变化必须保留作者确认 | `../00-overview.md` §7 | 未拆分 |
| D2-016 | 经验沉淀不能直接污染长期偏好 | `../00-overview.md` §7 | 未拆分 |
| D2-017 | 小说要素清单不是一次性表单 | `../00-overview.md` §7 | 未拆分 |

---

## 2.1 已落盘独立 ADR

| 编号 | 主题 | 状态 | 文件 |
| --- | --- | --- | --- |
| ADR-0001 | TurnResult v2 顶层 schema | Accepted (2026-04-24) | `0001-turn-result-v2-schema.md` |
| ADR-0002 | Turn / Task / Artifact 状态枚举 | Accepted (2026-04-24) | `0002-state-enums.md` |
| ADR-0003 | Authority / Budget / Escalation 最小枚举 | Accepted (2026-04-24) | `0003-authority-budget-escalation.md` |

---

## 3. 结构性修正记录

除 D2-001~D2-017 外，本轮设计完整性审查中还做出以下结构性修正，未来若被质疑应升格为独立 ADR：

1. **一致性与并发升为独立子系统**：原 §4 未给 `07-consistency-and-concurrency.md` 安排子系统编号。本轮将其插入为 Layer 1 子系统 7，使子系统 1-12 与文件 01-12 严格对齐。
2. **演化治理降级为过程纪律**：原 §4.10 演化治理作为独立子系统与文件层不匹配（文件 10 为 security-and-budget）。本轮将其下沉为 §8.4 治理纪律，承接 additive-first / schema version / ADR / contract tests / compatibility window 全部硬骨条目。
3. **Intent Registry 归属收口**：原 §4.3 同时声明 Intent Registry 与 Slot Policy 为硬骨，但 Intent Registry 与 Capability Registry 共存于文件 04。本轮将 Intent Registry 移到 §4.4（能力与 Executor 层），使注册中心在一处集中管理。
4. **Layer 2 模块对齐**：原 §5.6 长跑创作 / §5.8 结构面板在 Domain 文件层无独立文档。本轮替换为 §5.6 上下文组装策略（对应文件 26）与 §5.8 创作生命周期（对应文件 28），结构面板作为 UI 层关注点下沉到 Layer 3。
5. **文档组织清单实事求是**：原 §8.3 文档组织建议包含若干与实际 `docs/design-v2/` 不一致的文件名。本轮改为以当前目录实际内容为准的清单。

---

## 4. 升格为独立 ADR 的触发条件

出现以下情况时应把对应条目拆出为 `NNNN-<slug>.md`：

- 需要详细论证「考虑过的方案 + 拒绝原因」
- 决策内容产生破坏性变更（breaking change）
- 决策内容被废弃或被另一条决策替代
- 决策内容需要配合明确的迁移策略

未达到这些触发条件时，条目继续留在本索引与 `00-overview.md` §7。
