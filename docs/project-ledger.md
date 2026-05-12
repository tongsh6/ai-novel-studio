# Project Ledger / 项目事实台账

> 最后更新：2026-05-13（Milestone: 场景化验收对账 SU-01~03 + AU-01~08）
>
> 角色：新会话 AI 或新贡献者在 10 分钟内恢复项目状态基线。本文是权威事实来源，设计文档和代码可能滞后于本文，但本文不应滞后于设计和代码。
>
> **重要原则**：「主链已实现」≠「产品已可用」。本台账既追踪契约/代码状态，也追踪 walkthrough 与 acceptance 缺口，避免新会话 AI 把"全 done"误读为"全可用"。

---

## 1. 当前阶段目标

**Stage 5（Real Integration）— v3 主链真实集成与特性扩展**

v3 设计体系已闭环，目前处于特性增强期：
- **QP-01 到 QP-03：已交付（日志/模型配置/UI 走查/跨轮记忆）**
- **VS-00 到 VS-06：已交付（10 个核心切面，涵盖前后端端到端）**
- **VS-07（Intent Expansion）：已交付（完成 CapabilityRegistry 创意类意图扩展）**
- **VS-00A Deepening（Exploration Loop）：已交付（实现从自然对话到工具调用建议的闭环，已通过 9 轮 Review 加固）**
- **VS-06 后续（Task Lifecycle）：已交付（重建 TaskRunner，支持 SQLite 持久化，已通过 3 轮 Review 加固）**
- **QP-Workbench（UI Enhancement）：已交付（实现 Frame Insight 认知洞察可视化，已完成 UI 组件解耦与类型加固）**
- **VS-10（Observability Spine）：已交付（ADR-0018 业务日志 schema + LogContext/LogEmit + 三源回溯工具 + 操作手册）**

### 1.1 Stage 5 真实进度（基于 acceptance 与 walkthrough 对账）

| 维度 | 实测覆盖率 / 状态 | 证据 |
|------|---|---|
| 后端主链单元 + 集成测试 | `mix test`：412 tests / 0 failures；`mix test --include integration`：422 tests / 0 failures（含 novel_e2e 10 条）| 2026-05-12 本地复核；`:real_llm` 默认排除 |
| AI 静态扫描 | 13 PASS / 0 finding / 0 pending disposition | `artifacts/static-scan/top10.md`（2026-05-12）|
| SU-01..SU-03 系统验收 | 已按完整用户场景重算：SU-01 `0/10` 已验收、SU-02 `0/10` 完整端到端验收、SU-03 `0/6` 已验收；均有局部基础设施但未闭环 | `docs/design-v3/acceptance/README.md`；`docs/design-v3/acceptance/system/` |
| AU-01..AU-08 作者验收 | 已按完整前后端用户场景重算：均为 `0/N` 完整真实前后端验收；局部证据不能再等同“已验收” | `docs/design-v3/acceptance/README.md`；`docs/design-v3/acceptance/author/AU-01-chat.md`..`AU-08-reading-mode.md` |
| AU-09..AU-10 作者验收 | **待重算**；仍保留旧“部分实现 / 已实现”口径，不能作为真实验收结论 | `docs/design-v3/acceptance/README.md` |
| 真人走查（最近一次 2026-05-09）| 3 轮对话走通；5 个观感问题（P1×2 / P2×3）| `walkthroughs/2026-05-09/REPORT.md` |
| 业务日志体系 | **新落地（VS-10）**：LogContext/LogEmit + 11 模块结构化日志 + 自然语言 msg（atom→中文） + Console 精简 / JSONL 完整双通道 + 环境目录分离 + 三源回溯工具 + 操作手册 | ADR-0018；`apps/novel_common/lib/novel_common/log_{context,emit}.ex`；`scripts/grep_turn.sh` |
| 真实 LLM 自动测试 | 本地 LM Studio 手动 `--include real_llm`：13 tests / 0 failures；仍默认排除且无定期 CI 跑 | `apps/novel_application/test/.../planner_real_llm_test.exs` |

---

## 2. 已完成事项

### 2.1 v2 实现（Phase 1-3，全部 done）

（...保持不变...）

### 2.2 v3 设计与实现（Stage 0-4，全部完成）

（...保持不变...）

### 2.3 v3 实现 Slice（全部 10 个 + QP 扩展，全部 done）

| Slice | 名称 | 提交 | 核心验证 |
|-------|------|------|----------|
| VS-00 ~ VS-06 | 10 个承重竖切面 | `f7ba5c2` | 前后端主链闭环 |
| VS-00A | Deep Creative Exploration | `316b018` | 模糊输入→自然探索；用户决策→MicroPlan 触发 Capability 建议；trace 标记为 exploration |
| VS-07 | Intent Registry Expansion | `0ef9058`（Toolbox dispatcher 收尾）| 扩展世界观/人物/大纲/正文 4 类核心创作意图。**注**：dispatcher 当前返回 demo 占位文案，未真实接 LLM 生产 |
| VS-06+ | v3 TaskRunner Rebuild | `cbe2f82` / `6be395b` | 支持 SQLite 状态同步与 RESUMING 恢复流。**注**：前端已订阅 task_state；2026-05-12 已补齐同步 Toolbox 创作工具的 task_state RUNNING/COMPLETED 广播（GAP-WT-03 最小闭环）。完整异步 TaskRunner 接入仍是后续增强 |
| QP-01 ~ QP-03 | 基础设施与启动脚本 | `c1aa8d5` 及更早 | Stage 环境与跨轮记忆闭环 |
| QP-UI | Workbench V3 认知洞察可视化 | `53e2233` / `b6a69aa` | 支持 Frame Insight 切换与全量 v3 UI Card 渲染。**注**：candidate_directions 前端渲染契约已加测试；2026-05-12 已补齐 Planner 对模糊创作输入的 creative_exploration 归一化与候选 fallback（GAP-WT-01 后端闭环）|
| VS-10 | Observability Spine | `HEAD` | ADR-0018 schema 冻结 + LogContext/LogEmit + 结构化日志（11 模块）+ 自然语言 msg（atom→中文映射 + 值翻译）+ Console 精简输出 + 环境目录分离（dev/stage）+ 三源回溯工具 + 操作手册 + Logger metadata 配置闭环。`bash scripts/ai_static_scan.sh --top 10`：13 PASS / 0 finding|

**汇总**：基础设施 + 核心创作能力 + 观测性看板全部 done，**412 default tests + 10 e2e integration tests，0 failures**（2026-05-12 复核）。

---

## 8. 开放问题（已收敛或仍有证据缺口）

| 问题 | 归属 | 状态 | 证据 / 残留 |
|------|------|------|-------------|
| v2→v3 代码迁移策略（旁路 vs 重构） | 已解决 | **彻底重构完成（v3 分支）** | `docs/engineering/v3-migration-strategy.md` |
| JSON Schema / 代码级 contract 如何生成 | 待定 | contract packs 手工维护中 | `docs/design-v3/contracts/` 10 个 pack |
| trace store / replay report 是否持久化 | 已解决 | SQLite3 decision_traces 表 + TraceRepository | `apps/novel_persistence/lib/novel_persistence/trace_repository.ex` |
| 集成测试脚本质量 | 已修复 | `capturing_complete_fn` 校验 Prompt 内容 | `apps/novel_application/test/.../planner_*` |
| 测试覆盖率基线 | 已达标 | 核心域 Domain 81.0% / Persistence 76.7% > 60% | 历史覆盖率报告（请执行 `bash scripts/check_coverage.sh` 复核）|
| 长跑任务状态一致性（后端）| 已验证（后端）| TaskRunner + LongRunTaskLog 通过单测 | `apps/novel_application/test/.../task_runner_test.exs` |
| 长跑任务状态指示（前后端集成）| **最小闭环已补齐** | 同步 Toolbox 创作工具已通过 turn_result 携带 `task_state_events`，WorkspaceChannel 独立广播 `task_state` RUNNING/COMPLETED；完整异步 TaskRunner / LongRunTaskLog 订阅仍待后续 | `apps/novel_application/test/.../creative_artifact_test.exs`；`apps/novel_web/test/.../workspace_channel_v3_test.exs` |
| 创作认知透明度 | 已提升 | 支持"查看认知"+ Orchestrator 决策含风险摘要 | `WorkbenchV3.tsx` Frame Insight 面板 |
| 真实 LLM 测试在 CI 中跑 | **未解决** | `:real_llm` 默认排除，无定期跑 + 无报告留痕 | `apps/novel_application/test/.../planner_real_llm_test.exs` |
| 前端桌面持久化 API 合规 | **未解决（非本次引入）** | `frontend_audit` 持续 warning：`frontend/src/lib/works.ts` 直接使用 `window.localStorage` 保存 last-opened work；当前不阻塞 CI，但与 Desktop-First 约束存在张力。需决定迁移到 Tauri storage / 后端用户偏好 / env 抽象后再改 | `frontend/src/lib/works.ts`；`scripts/frontend_audit.sh` |
| 本地 Tauri DMG 打包 | **需核查（非本次引入）** | `frontend_audit` 中 Vite/Rust release app 构建成功，但 macOS DMG bundle 脚本在本机返回 warning；脚本标注 CI 必需、dev 可选。当前无法确认是本机签名/打包环境问题还是发布链路缺口 | `bash scripts/frontend_audit.sh`；`frontend/src-tauri/target/release/bundle/dmg/bundle_dmg.sh` |

### 8.1 已落地但未闭环的真实缺口（来自 walkthrough 与 acceptance）

> 来源：`walkthroughs/2026-05-09/REPORT.md` 与 `docs/design-v3/acceptance/README.md` §缺口总览。
> 任何"主链已 done"的判断必须先与本表对账。

#### Walkthrough 跟踪（2026-05-09 走查 5 项）

| ID | 问题 | 优先级 | 证据 / 当前状态 | 责任切片 |
|----|------|--------|-----------------|----------|
| GAP-WT-01 | Candidate cards 不渲染：AI 回复"提供几个创作方向"但 UI 无候选卡片 | P1 | **已补齐后端最小闭环**：前端 `WorkbenchV3.tsx:371-395` 已有渲染逻辑，后端 `Planner` 对模糊创作输入归一化为 `creative_exploration`，当真实 LLM 缺失 `candidate_directions` 时生成 3 个 not_adopted fallback 候选；已加 DialogueGateway 单测与 LM Studio real_llm 复核（13 tests / 0 failures）。剩余：真人走查复验 UI 观感 | 体验加固（后端） |
| GAP-WT-02 | 作品档案右侧"打开档案/查看详情"无内容 | P2 | VS-09 已落地后端 CRUD + 前端 list/create + Channel work_id 透传；档案 UI 详情面板仍未接入 | 体验加固（次轮） |
| GAP-WT-03 | 长跑状态指示全程显示"待机"不变 | P1 | **同步创作工具最小闭环已补齐**：前端已订阅 task_state；`DialogueGateway` 对 creative Toolbox 调用附加 RUNNING/COMPLETED `task_state_events`，`WorkspaceChannel` 广播独立 `task_state` 事件。剩余：真正长耗时工具仍未接 TaskRunner / LongRunTaskLog 实时订阅 | 后端集成（TaskRunner ↔ Toolbox，后续增强）|
| GAP-WT-04 | 纯文本回复，frame_type/exploration/candidate 在 UI 上无视觉区分 | P2 | UICards 类别集合已就位，但 DialogueFrame.frame_type 未驱动样式 | 体验加固（次轮）|
| GAP-WT-05 | 多轮回复彼此独立，上下文感缺失 | P2 | DialogueContext 已产，前端不展示前文引用 | 体验加固（次轮）|

#### 场景化验收对账（2026-05-13）

> 本轮目标不是实现代码，而是把验收 case 从“API/组件存在”改为“真实作者使用场景”。结论：SU-01~03、AU-01~08 已重算；AU-09~10 待下一会话继续逐个过。

| 范围 | 当前状态 | 主要缺口 | 证据 |
|----|----|----|----|
| 场景化验收总入口 | 已新增 | 仍需把 AU-09/AU-10 纳入重算，并在后续实现前按蓝图选承重 slice | `docs/design-v3/acceptance/SCENARIO-BLUEPRINT.md` |
| SU-01 模型供应商 | `0/10` 已验收；`2/10` 有基础设施 | provider health 基础具备；缺 model 列表、运行时切换、Key/endpoint 配置、测试连接 UI 和错误恢复 | `docs/design-v3/acceptance/system/SU-01-model-provider.md` |
| SU-02 作品切换 | `0/10` 完整端到端验收；`5/10` 部分/基础设施 | 后端 Work CRUD、Channel work_id 透传、启动去 mock 已推进；缺运行时切换 UI、rejoin、pending 隔离、跨作品隔离验收 | `docs/design-v3/acceptance/system/SU-02-work-switching.md` |
| SU-03 AI 显示名 | `0/6` 已验收；`1/6` 仅硬编码默认值 | 缺设置入口、持久化、按作品隔离、仅 UI 展示边界 | `docs/design-v3/acceptance/system/SU-03-model-nickname.md` |
| AU-01/AU-02 自然对话与探索 | AU-01 `0/13`；AU-02 `0/12` 完整前后端验收 | 真实工作台 walkthrough 不足；普通聊天/探索默认 MicroPlan 风险；候选操作和采纳桥接未闭环 | `docs/design-v3/acceptance/author/AU-01-chat.md`；`AU-02-explore.md` |
| AU-03 上下文与会话 | `0/20` 完整前后端验收；`5/20` 有局部证据 | 缺作品内 N 次会话、会话列表/搜索/归档/只读重入；最新作品背景未作为 context SSOT | `docs/design-v3/acceptance/author/AU-03-context.md` |
| AU-04/AU-06 执行确认与行为生命周期 | AU-04 `0/18`；AU-06 `0/17` 完整真实前后端验收 | 后端门禁较强；真实入口仍有 confirm/reject vs `author_action` 偏差；behavior_state 消费、resolution/history、幂等、TTL、ConfirmationBinding 未闭环 | `docs/design-v3/acceptance/author/AU-04-execute-and-confirm.md`；`AU-06-behavior-lifecycle.md` |
| AU-05/AU-08 采纳到阅读投影 | AU-05 `0/18`；AU-08 `0/16` 完整真实前后端验收 | 前端 adopt/discard/modify helper 与 Channel handler 不匹配；AdoptionBoundary 未接主流程；TOC 仍 mock，章节读取缺 handler，ProjectionHint 未转 `projection_refs` | `docs/design-v3/acceptance/author/AU-05-artifact-adoption.md`；`AU-08-reading-mode.md` |
| AU-07 溯源回放 | `0/16` 完整真实前后端验收；`8/16` 有局部证据 | Replay no-provider 已测；缺 why UI、redaction、author/developer 双视图、Tool/Behavior/StateTrace 聚合 | `docs/design-v3/acceptance/author/AU-07-trace-and-replay.md` |
| AU-09/AU-10 | 待重算 | 旧文档仍可能把“已有实现/组件”误写成“已验收” | `docs/design-v3/acceptance/README.md` |

#### 下一会话交接（从这里继续）

1. 先读取 `docs/project-ledger.md`、`docs/design-v3/acceptance/SCENARIO-BLUEPRINT.md`、`docs/design-v3/acceptance/README.md`。
2. 从 `docs/design-v3/acceptance/author/AU-09-story-memory.md` 开始逐个过场景，不要跳到实现。
3. 继续沿用本轮口径：完整前后端用户场景优先；代码/组件/API 存在只能算局部证据；mock、helper 测试、文档描述不能算已验收。
4. AU-09 重点核查故事设定/记忆是否真实进入主链 context、可管理、可召回、可溯源，并与 AU-03 的“作品内会话 + 最新作品背景”对齐。
5. AU-10 重点核查真实工作台 UI：卡片、候选、action、task_state、trace、projection、错误态、Tauri 桌面约束和 Playwright/真人走查。

#### 进行中的承重切片（修正前 §1 的"全 done"假象）

| Slice | 状态 | 真实缺口 |
|-------|------|----------|
| VS-10 Observability Spine | **已落地并验证闭环（2026-05-12）** | Logger metadata key 已纳入配置；`mix credo suggest --strict --format json` 0 issues；AI 静态扫描 13 PASS / 0 finding。novel_agent provider 层自由文案 Logger 属 LLMLog 范围，非本 slice 引入 |
| VS-09 Work Management | **核心已落地（2026-05-11）**，剩余高级场景待续 | 切换 UI / cross-work e2e / pending 隔离 / 不可用降级 |
| 体验加固 P1 修复 | **GAP-WT-01 后端闭环 + GAP-WT-03 同步工具最小闭环已落地（2026-05-12）** | 已完成 3 轮复审：契约/架构、测试语义、文档/质量体系。复审中补齐畸形候选 fallback、真实 not_adopted 测试、creative_generation 类型推断、过期注释清理；非本次引入的 localStorage / DMG warning 已登记。剩余为真人走查复验、完整异步 TaskRunner/LongRunTaskLog 接入、真实长任务进度细分 |
| Toolbox 创作 dispatcher 真实 LLM 接入 | 待规划 | VS-07 收尾后续，4 个 dispatcher 仍返回 demo items |

---

## 9. 维护规则

1. 每次 slice 完成或阶段推进后更新本文 §2-§4。
2. 新增废弃事项时更新 §5。
3. 优先级变化时更新 §6。
4. 新增关键证据时更新 §7。
5. 开放问题收束或新增时更新 §8；遗留缺口必须放入 §8.1，不得在 §8 写"已解决"了事。
6. 每次产品体验走查（`walkthroughs/<date>/REPORT.md`）必须在 24h 内把发现的问题登记进 §8.1，标注优先级、证据路径、责任切片。
7. 「主链已实现」≠「产品已可用」。在标 done 之前必须确认：a) 真人走查已通；b) 对应 acceptance 文档场景覆盖率 ≥ 目标线；c) 没有阻塞 P0 GAP。否则只能写"已实现，未闭环"。
8. 更新日期写入文件头。
