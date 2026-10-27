# B50：Multi-Agent 当前边界裁决（保留、延期或 Supersede）

- 状态：**blocked（待作者裁决；不新建 runtime）**。
- 登记日期：2026-10-27；来源：tech-stack 将 process-isolated Multi-Agent/24x7 Reviewer/Maintainer 当 day-1 绝对约束并标“全部通过”，当前承重为统一 AgentRun，B39 又禁止第二求证 runtime。
- 上游：`docs/design/tech-stack/08-multi-agent.md`、`docs/design/00d-runtime-architecture.md`、`docs/design/04a-planning-and-long-run.md`、[B39](B39-evidence-seeking-authoring.md)。

## 1. 冲突不能由审计擅自裁决

旧技术决策把进程隔离 Multi-Agent、Reviewer/Maintainer 和 24x7 当明确约束；当前实现却以统一 AgentRun 为承重，LongRunner 批量生产也没有真实消费入口。简单地以“没有 Delegation/Handoff/GenStage 模块”宣布旧决策失效，或为了兑现旧文档新建多进程，都是越权。

本任务只回答：

1. 旧“day-1 必须”的用户决策仍保留、延期还是 supersede？
2. 若保留，真实独立子 Agent 的消费者是什么，如何与统一 AgentRun 的父子委派、预算、crash、handoff 和作者主权共存？
3. 若延期/退役，如何修改 tech-stack 的“全部通过”和依赖关系，避免把设计映射当验收事实？

## 2. 待评方案

- **保留**：必须给出真实消费者、父子运行时边界、预算与故障恢复，不以模块名凑实现。
- **延期**：保留未来委派可能，但明确当前不承诺 24x7/独立进程，并把触发条件写清。
- **Supersede**：以统一 AgentRun 为当前权威，记录旧决策替代关系，不重写历史或删除证据。

## 3. 开工七问

1. **Contract**：tech08 原决策、UA-01 统一 AgentRun、B39 禁第二 runtime、04a 的 LongRunner 现状、ADR 新设/替代规则。
2. **Invariant**：不由模块名缺席判退役，不为兑现旧文档新建进程；真实消费者先于 runtime；24x7 和 crash/budget/handoff 不得虚报。
3. **Boundary**：评审文档、ADR、tech-stack 与任务；不修改 runtime、provider、数据库或 UI。
4. **Consumer**：后续 Reviewer/Maintainer、B39、LongRun 规划和技术决策者。
5. **Proof**：作者明确选择并记录理由；每一保留项有消费者和验收，延期/退役项有触发与替代证据；tech08 不再以“全部通过”冒充验收。
6. **Acceptance Driver**：评审阶段以代码/任务证据和作者决策记录为主；若保留，后续才设计真实父子和故障场景，产品验收感知逻辑 **no**。
7. **Exploration**：委派、handoff、预算和恢复若能成立必须可查；否则只保留统一 AgentRun 的观测，不造第二套遥测。

## 4. 非目标

- 不由本任务实现 Multi-Agent、24x7、Reviewer/Maintainer 或第二个求证 loop。
- 不以“当前没有模块”作为唯一退役理由，也不以旧“全部通过”作为仍需实现的理由。
- 不重复 UA01，不把 B39 当引入第二 runtime 的许可。
- 不把 LongRunner 批量初稿当作 Multi-Agent 已存在的证明；它另由 B52 触发评估。

## 5. 验证与恢复

- 裁决后明确：保留/延期/supersede、当前真实边界、触发条件、承接任务和禁止行为。
- tech08 与依赖表只记录设计映射或实际证据，不再以全勾表示验收。
- 若保留，另立有真实消费者的父子委派与故障恢复 slice；若延期/退役，B39/统一 AgentRun 不被旧约束反向阻断。
- 恢复时先读作者最新裁决，不从本文件的选项直接选实现。
