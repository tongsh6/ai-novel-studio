# 项目运行上下文：画像接入与验收

**状态**：doing（画像接入与合并已完成，进入真实研发试用；模型决策效果与整仓 CI 对账仍未闭环）。

## 1. 授权、基线与边界

维护者已授权 AIEF 通用机制先行，再应用到小说项目；2026-11-13 明确当前生命周期为“研发中”，并要求继续下一阶段。本任务只承接项目画像与工程协作上下文，不授权 B87 的生产实现、数据库修改或模型调用资源。

- 小说项目 PR：[#5](https://github.com/tongsh6/ai-novel-studio/pull/5)，已按维护者本轮授权合入 `develop/dialogue-based-novel-workbench`，合并提交 `7f62c49ef5b54d73bc846daa8ed627914f0e3828`；决策和验收边界见 §7.3。
- 本轮起点：小说项目 `537a651367705b29752cfca6f996c502a664dfdb`；目标分支基线 `89b44a95e22f0c4902c5dfff5002838b3097b12d`。
- AIEF 通用研发阶段：[PR #40](https://github.com/tongsh6/ai-engineering-framework/pull/40)，已合并 `b002f72baa476dd16e7f52b387fee06c68abfeef`。
- 手动接入专项检查：[AIEF PR #41](https://github.com/tongsh6/ai-engineering-framework/pull/41)，已合并 `abbb196a27752cceb21c22a93da080b9dd632e71`。代码评审未报告问题；其首次 CI 仅运行原有测试，新增专项回归的真实执行见 §7.2，不借用旧绿色结果。
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
| CP1 | done：真实画像的 Schema/来源检查、唯一入口及无写入校验 | §7.1；Project Operating Context run `43405425724` 通过，已读取原始 artifact；合并前 HEAD 复验见 §7.3 |
| CP2 | doing：整仓 CI 基线和新增差异分别对账 | §6 已核对作业/步骤；逐问题根因与承接尚未完成，不将同名失败直接当根因相同 |
| CP3 | todo：真实 Agent 决策效果验收 | 下一步随已授权真实研发任务观察；记录实际运行配置、输入、输出、规则来源、判定与证据；静态推演不能代替 |
| CP4 | done：按维护者明确授权合入活跃研发分支试用 | PR #5 已合并为 `7f62c49ef5b54d73bc846daa8ed627914f0e3828`，见 §7.3；不代表整仓 CI 或发布验收通过 |

CP1 通过仅针对 §7.1、§7.3 的精确提交和资产。后续改动须由对应 HEAD 的工作流重新验证，不把旧结果当作未来提交的成功证明。CP4 的合并不自动关闭 CP2、CP3。

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

下一步首先在活跃分支的正常、已授权研发任务中试用：AI 读取 AGENTS、画像、NEXT 和原任务，说明与本任务相关的取舍，执行后记录是否发生无依据兼容、重复实体、欠设计或数据保护缺失。该上下文首先约束开发本项目的 AI，不是小说应用内的创作 Agent 功能；无需仅为画像验证改动产品运行时。

后续优先验证 AIEF 既有 D02（一般研发子场景）、D03、D05、D14、D16。需要进一步隔离画像影响时，可在实验上下文对同一真实任务提供研发/未发布与正式发布/有契约的反事实画像；不得改写项目事实。其余场景沿 AIEF 既有 16 场景验收基线，不新建第二份规则集或评测平台，不把系统性行为评测完成作为本次合入研发分支的前提。

## 6. CI 边界与剩余工作

本轮开始时，PR HEAD `537a651` 的整仓 [CI run 43401436744](https://github.com/tongsh6/ai-novel-studio/actions/runs/43401436744) 为 failure。历史基础提交的 [run 43294123379](https://github.com/tongsh6/ai-novel-studio/actions/runs/43294123379) 也有失败。相同作业名称不足以证明全部问题相同，必须分层报告；本任务不修改旧门禁、阈值或失败样本来获取绿色结果。

本轮 HEAD `d5bf0c52425362896654ffbc13cd4aeb6a47e6c8` 的整仓 [run 43405425854](https://github.com/tongsh6/ai-novel-studio/actions/runs/43405425854) 已结束：

| 作业/步骤 | 实际结果 | 边界 |
|---|---|---|
| Frontend lint/test/build | success | 不能代替全部后端/桌面验收 |
| Tauri macOS、Ubuntu | success | Rust 合同测试，不是原生页面验收 |
| Elixir — Dialyzer | failure | 后续 Test (PR fast set) 被跳过，不能称 mix test 全通过 |
| Windows Tauri — Rust contract tests | failure | 未在本任务修复 |
| AI static scan — Run AI static scan | failure | 未降低阈值或豁免 |
| Quality manifest — parser tests | failure | 后续 manifest check 被跳过 |

四类失败与本轮开始时的 `537a651` 作业/步骤集合一致；这只是步骤级对账，尚未证明每条日志根因相同或无任何新问题。当时因此暂缓 CP4；随后维护者明确要求合入活跃分支试用，实际处置见 §7.3，CP2 仍开放。

剩余范围：完成 CP2 的逐问题对账及承接；随正常研发执行 CP3 的真实决策观察。CP4 合并已完成，不将其重新设为其他事项的阻塞。部署、恢复和数据库迁移等未确认字段不被生命周期答复一并确认。AIEF 尚未发布 npm 新版，持续校验使用工作流固定源码。

## 7. 已执行验证记录

### 7.1 小说项目真实画像与入口

- HEAD：`d5bf0c52425362896654ffbc13cd4aeb6a47e6c8`。
- 专项 [run 43405425724](https://github.com/tongsh6/ai-novel-studio/actions/runs/43405425724) / job `131818486924`：success；入口、真实 Profile、只读检查、证据上传各步骤均 success。
- 已下载并读取 artifact `project-operating-context`，ID `14026862856`；不是只看绿色图标。
- 实际 checkout（PR merge ref）：`5081c2ab8b56c6df1c8622372d4c2aeb59624795`。
- AIEF 固定检查器：`abbb196a27752cceb21c22a93da080b9dd632e71`。
- 画像 SHA-256：`9ffa1f7471383724b2665141ff3468d84398569731712b666b416953c2f242ff`。
- Doctor：`scope=profile`，pass=2、warn=1、fail=0、blockingFail=0。唯一警告是仍有 unknown；没有新增事实确认或改写画像。
- 已记录实际依赖：Ajv `8.20.0`、yaml `2.9.1`；不是宣称所有未来安装会得到相同依赖。
- `human_confirmation_authenticity=not_independently_verified`、`model_behavior=not_run`、`product_acceptance=not_run`。上述边界写在原始 metadata，不因人工阅读而升级。
- 对该 HEAD 的 Codex Review 已完成，未报告问题；不替代测试证据。

### 7.2 上游回归覆盖遗漏与修正

检查 AIEF [run 43404502897](https://github.com/tongsh6/ai-engineering-framework/actions/runs/43404502897) 逐项日志后发现 npm test 当时只列 smoke/lifecycle 文件，新增 12 项专项回归未运行。原日志实际是 canonical 27/27、alias 23/23，不能作为新增回归通过证据。

已用 [AIEF PR #42](https://github.com/tongsh6/ai-engineering-framework/pull/42) 修复测试发现，并让 validate/migrate 负例使用真实子命令。该 PR 未改变生产校验逻辑，已合并 `d0e0fb50c3e490c209225a4cc55d445ccebb1986`。

[run 43405855493](https://github.com/tongsh6/ai-engineering-framework/actions/runs/43405855493) / job `131819901358` 逐项日志确认：canonical **39/39**（含新增 12 项）、alias **23/23**；0 fail、0 skipped。代码评审未报告问题。小说工作流仍固定到已验证的检查器实现 `abbb196`；#42 仅改测试入口/负例，不自动追随 main。

### 7.3 维护者授权合入研发分支（2026-11-13）

维护者询问并要求将 PR 合入活跃分支，随后在小说项目中试用。执行前已说明专项检查通过、整仓 CI 仍失败，合并不是全部验收完成；[合并决策记录](https://github.com/tongsh6/ai-novel-studio/pull/5#issuecomment-6849998546) 保留该范围。

- 合并前精确 HEAD：`eaca2473f38f818ac509b0f8de375d3eef193fbd`。
- 同一 HEAD 的专项 [run 43406293644](https://github.com/tongsh6/ai-novel-studio/actions/runs/43406293644)：completed / success；整仓 [run 43406293569](https://github.com/tongsh6/ai-novel-studio/actions/runs/43406293569)：completed / failure。
- PR #5 通过正常 merge API、精确 expected head 校验后 squash 合入 `develop/dialogue-based-novel-workbench`，合并提交 `7f62c49ef5b54d73bc846daa8ed627914f0e3828`。GitHub 已回读确认 merged=true。
- 未修改分支保护、未强推、未关闭失败检查；整仓 CI 失败保留，未声明全部失败与本次无关。未新增产品实现、数据库操作或 B87 完成声明。
- CP4 仅指本次接入合并完成；CP2/CP3 继续开放，合并后提交的检查以对应运行结果为准，不沿用旧 HEAD 的绿色结果。

## 8. 恢复指引

从活跃分支 `develop/dialogue-based-novel-workbench` 最新 HEAD、本文和专项工作流 artifact 恢复；PR #5 保留接入历史与合并依据。若期间 AIEF 或小说主线变更，重新记录 SHA 与影响面后复验。不要重建画像、不要运行 Retrofit、不要把 B87 排期或执行状态改为本任务的进度。
