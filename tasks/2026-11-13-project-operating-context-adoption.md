# 项目运行上下文：画像接入与验收

**状态**：doing（机械接入验收；尚未宣告模型行为验证或全仓完成）。

## 1. 授权、基线与边界

维护者已授权 AIEF 通用机制先行，再应用到小说项目；2026-11-13 明确当前生命周期为“研发中”，并要求继续下一阶段。本任务只承接项目画像与工程协作上下文，不授权 B87 的生产实现、数据库修改或模型调用资源。

- 小说项目 PR：[#5](https://github.com/tongsh6/ai-novel-studio/pull/5)，目标 `develop/dialogue-based-novel-workbench`。
- 本轮起点：小说项目 `537a651367705b29752cfca6f996c502a664dfdb`；目标分支基线 `89b44a95e22f0c4902c5dfff5002838b3097b12d`。
- AIEF 通用研发阶段：[PR #40](https://github.com/tongsh6/ai-engineering-framework/pull/40)，已合并 `b002f72baa476dd16e7f52b387fee06c68abfeef`。
- 手动接入专项检查：[AIEF PR #41](https://github.com/tongsh6/ai-engineering-framework/pull/41)，已合并 `abbb196a27752cceb21c22a93da080b9dd632e71`。canonical/alias 测试由 [run 43404502897](https://github.com/tongsh6/ai-engineering-framework/actions/runs/43404502897) 验证；代码评审未报告问题。
- 画像唯一真源：[project-operating-profile.yaml](../docs/engineering/project-operating-profile.yaml)。本任务不复制项目字段或重新确认尚未知的责任。

## 2. 存在性审查与复用裁决

| 需要 | 已有资产 | 裁决 |
|---|---|---|
| 画像结构和来源检查 | AIEF canonical CLI 的 `runDoctor`、Schema、`inspectProjectProfileSemantics` | 复用；在 AIEF 增加 `--profile-only`，不在小说项目重写一套检查器 |
| 文档导航与事实归属 | AGENTS.md、docs/engineering/README.md、tasks/README.md | 扩展已有索引，不新建 context 知识树 |
| 持续校验真实画像 | 既有 CI 不包含 Project Profile 检查，产品 Schema/codegen 不承担工程画像职责 | 新增一个有明确消费者的专项工作流，直接使用固定 AIEF commit；不修改产品 codegen 或旧 CI 判定 |
| 任务状态与证据 | tasks/ 规则、PR 检查与 Actions artifact | 本文件记录任务状态；证据保留在 Actions artifact。NEXT 与 B87 不复制本任务状态、不重排产品主线 |

## 3. Checkpoint 与完成条件

| Checkpoint | 范围与当前状态 | 完成证据 |
|---|---|---|
| CP0 | done：画像、AGENTS 入口、索引和人工生命周期确认已进入 PR | PR #5 的既有提交，尤其 `537a651` |
| CP1 | doing：真实画像的 Schema/来源检查、唯一入口及无写入校验 | 本 PR 新增的 Project Operating Context 工作流实际结果；不得用 AIEF 单测代替 |
| CP2 | doing：整仓 CI 基线和新增差异分别对账 | 对照基线与本 PR 的作业、失败步骤及日志；不把同名失败直接当根因相同 |
| CP3 | todo：真实 Agent 决策效果验收 | 实际运行配置、输入、输出、规则来源、人工判定与证据；静态推演不能代替 |
| CP4 | todo：满足仓库合并条件并合入活跃分支 | 审查、CI 与明确的遗留处置；不得绕过门禁或把部分通过写成全仓通过 |

本次提交时 CP1 的新工作流结果尚未取得。结果应在本文件后续验证记录中更新，不提前签署 PASS。

## 4. 确定性验收契约

入口：[.github/workflows/project-operating-context.yml](../.github/workflows/project-operating-context.yml)。

- 使用项目真实 checkout 的画像；检查 AGENTS 中恰有一个标准 Profile 声明，工程索引能够到达画像，根目录没有平行 context 树。
- AIEF 在 sibling checkout 中运行。仅在该 checkout 安装检查器依赖，不引入产品运行时依赖。
- `doctor --profile-only` 复用上游结构与治理检查；非法画像/人工字段非法来源仍失败；unknown 保留警告。
- 校验后项目 `git status --porcelain` 必须为空，禁止检查器写入项目事实。
- Actions artifact `project-operating-context` 保存 `doctor.json`、`metadata.json`、`dependencies.json`；包含实际 checkout SHA、AIEF SHA、画像 SHA-256、依赖版本和验证范围。
- 专项工作流成功不是完整 Doctor 成功，不是仓库 CI 成功，更不是 B87 或文学质量验收成功。

## 5. 真实任务的静态对账（非模型实验）

对照 [B87](slices/B87-model-interaction-request-projection.md) §2/§5，采用画像后正确的工程取舍仍应为：复用现役实体、迁移当前消费者并清理无依据旧兼容路径、保护作者内容和质量证据、保留既有契约/不变量与真实页面验收要求。

这是规范与真实任务的一致性检查，不是一次独立 Agent 运行；不记录“模型已按画像执行”或 D01–D16 全通过。

后续优先验证 AIEF 既有 D02（一般研发子场景）、D03、D05、D14、D16：使用同一真实任务分别给出研发/未发布与正式发布/有契约的画像，比较是否作出有依据的取舍。反事实画像只放实验上下文，不能改写项目事实。其余场景沿 AIEF 既有 16 场景验收基线，不新建第二份规则集。

## 6. CI 边界与剩余工作

本轮开始时，PR HEAD `537a651` 的整仓 [CI run 43401436744](https://github.com/tongsh6/ai-novel-studio/actions/runs/43401436744) 为 failure。历史基础提交的 [run 43294123379](https://github.com/tongsh6/ai-novel-studio/actions/runs/43294123379) 也有失败。相同作业名称不足以证明全部问题相同，必须分层报告；本任务不修改旧门禁、阈值或失败样本来获取绿色结果。

剩余范围：完成 CP1 实际运行取证；核对 CP2；执行 CP3 的真实决策场景；满足 CP4。部署、恢复和数据库迁移等未确认字段不被生命周期答复一并确认。AIEF 尚未发布 npm 新版，持续校验使用工作流固定源码。

## 7. 恢复指引

从 PR #5 的最新 HEAD、本文和专项工作流 artifact 恢复。若期间 AIEF 或小说主线变更，重新记录 SHA 与影响面后复验。不要重建画像、不要运行 Retrofit、不要把 B87 排期或执行状态改为本任务的进度。
