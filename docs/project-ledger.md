# Project Ledger / 项目事实台账

> 最后更新：2026-05-15（Milestone: AU-03C 作品内会话恢复闭环，自动回到上次 active session）
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

### 当前重点推进事项（2026-05-15）

当前主线从 AU-05 采纳链路前移到 **AU-03C 作品内会话模型与恢复**，原因是 AU-05 的 pending adoption 不能依赖 Tauri/Channel 内存；作者关闭应用再打开时，必须自动回到同一作品的上次 active session，并恢复完整 transcript 与右侧待处理事项。

本轮已完成 AU-03C 的 active-session 恢复闭环：
- 新增 `WorkSession` / `WorkSessionService` / `/api/works/:work_id/sessions/resume`。
- `interactions` 和 `decision_traces` 增加 `session_id`，assistant interaction 持久化 `turn_result`，用于恢复 pending adoption。
- `WorkspaceChat` 启动时加载 resume snapshot，渲染完整 transcript、会话列表/搜索，并在 join 后保存真实 work/session id。
- Tauri 验证新增 `au03c-work-session-resume`：生成 pending artifact → 重启 Tauri → 同一 active session 恢复 transcript 与 pending adoption。

证据：`bash scripts/tauri_slice_verify.sh au03c-work-session-resume`，产物 `artifacts/slice-verify/au03c-work-session-resume-tauri/summary.json`。

Stage 手动走查补充（2026-05-15）：用户通过 `./stage.sh start` 看到历史对话确实被恢复，但 UI 仍有初始化体验缺陷：
- 已恢复 transcript 前面错误插入欢迎语，说明 `WorkspaceChat` 的 welcome 判定与 resume state 存在竞态或状态覆盖。
- 顶部作品上下文仍显示 `未连接`，说明 `resume snapshot / join response` 没有可靠覆盖 `context.workTitle`。
- 顶部 `未定卷` 不是连接异常，而是卷/结构数据未接入真实来源；当前不应与 LLM/服务状态混淆。
- 点击 macOS 左上角关闭按钮时，当前已做补丁式缓解：Tauri `CloseRequested` 中显式 `app_handle().exit(0)`，`/api/system/shutdown` controller 改为先返回 `Plug.Conn` 再异步停机，避免 `expected action/2 to return a Plug.Conn` 报错。**但这不是桌面生命周期根治**：Tauri 仍通过端口/lsof/HTTP shutdown 间接清理 Phoenix，`stage.sh` 的进程所有权、trap/cleanup、dev/stage/prod 关闭语义和自动化验收尚未闭环。
- Stage Startup Context Contract 根因修正已开始（2026-05-15）：`stage.sh` 不再让 `frontend/.env` 覆盖 stage 端口，显式导出 `VITE_API_ENDPOINT=http://127.0.0.1:${PHOENIX_PORT}` / `VITE_WS_ENDPOINT=ws://127.0.0.1:${PHOENIX_PORT}/socket`，避免 `localhost` IPv6/IPv4 解析差异；`before-tauri-dev.sh` 保留调用方传入的 Vite/API/WS env；`WorkspaceChat` 不再在 work/session 启动失败时静默 join `lobby`，Channel join 后校验返回的 work/session 必须匹配启动上下文。自动化补证（2026-05-15 12:37）：新增 `stage-startup-context-contract` 原生 Tauri 验证，先种好带 transcript/pending adoption 的 active session，再从真实工作台首屏恢复并上报 UI probe，证明“顶部不为未连接、恢复 transcript 不插欢迎语、work/session 一致”；证据 `artifacts/slice-verify/stage-startup-context-contract-tauri/summary.json`。
- Stage 复验补充（2026-05-15 03:11）：Stage Startup Context Contract 的主要问题已解决：Tauri 能通过 Vite proxy 加载真实 work/session，Channel join 参数包含真实 `work_id=cc13925d-930f-48b8-96a1-738b0689b502` 和 `session_id=eac5f2ee-84f8-440a-bf04-3bb6fc95ddf3`，不再出现“服务已连接但作品未连接”的伪成功状态。新暴露问题转入 AU-05/AU-10：恢复出的 pending artifact 可以出现在 UI，但点击采纳时 `channel.adopt` 返回 `pending artifact not found`；随后点击放弃会发送 `discard` 事件，而 `WorkspaceChannel.handle_in/3` 没有对应 clause，导致 Channel GenServer 以 `FunctionClauseError` 崩溃并重连。说明 pending adoption 的恢复来源、当前 turn/current_turn_id、AdoptionWorkflow 查找范围、前端 artifact_type/source_turn_ref 以及 discard/modify backend handler 尚未形成闭环。

因此 AU-03C 当前只能标为“恢复主链有自动化证据，Stage 启动上下文主问题已手动复验通过”，不能标为“pending adoption 可操作闭环完成”。当前重点推进内容切到 **Pending Adoption Resume Action Loop**：从恢复出的 pending artifact 出发，打通采纳/放弃/修改动作，保证前端 action、Channel handler、AdoptionWorkflow 查找范围、source_turn/current_turn 和持久化恢复视图一致。下一步优先修 AU-05/AU-10 的采纳/放弃闭环，而不是继续扩展会话 UI。

Pending Adoption Resume Action Loop checkpoint（2026-05-15 04:37）：已补齐采纳/放弃/修改后采纳三条真实 Tauri 前端动作闭环，并修复 Tauri 验证脚本的 dev 代理路径。`AdoptionWorkflow` 现在可读取恢复自 JSON 的 string-key `turn_result`，避免恢复后采纳误报 `pending artifact not found`；新增 `discard` workflow 和 `WorkspaceChannel.handle_in("discard", ...)`，放弃 pending artifact 会广播 resolved `turn_result` 而不再让 Channel 崩溃；新增 `modify_draft` workflow 和 Channel handler，修改后采纳会产生 `EDITED_ACCEPTED` resolved `turn_result`；修复 `WorkspaceChat` 修改弹窗提交时捕获旧 `modifyInstruction` 的问题；`adopt/discard/modify_draft` action turn_result 会写回会话 transcript，使后续 resume 能看到 resolved adoption；前端 adoption card 的 discard/modify_draft 会带 `source_turn_ref`。真实 Tauri 复验：`bash scripts/tauri_slice_verify.sh au05-adoption-boundary`、`bash scripts/tauri_slice_verify.sh au05-discard-boundary`、`bash scripts/tauri_slice_verify.sh au05-modify-draft-boundary` 均通过，证明真实工作台入口能从“打开档案 → 新动作 → pending artifact”分别触发采纳、放弃、修改后采纳并穿过 Channel/Application/AdoptionWorkflow；证据分别在 `artifacts/slice-verify/au05-adoption-boundary-tauri/summary.json`、`artifacts/slice-verify/au05-discard-boundary-tauri/summary.json`、`artifacts/slice-verify/au05-modify-draft-boundary-tauri/summary.json`。其他验证：`mix test apps/novel_application/test/novel_application/adoption_workflow_test.exs apps/novel_web/test/novel_web/channels/workspace_channel_v3_test.exs`、`pnpm --dir frontend test -- slice-verify/native-tauri-verifier.test.mjs src/lib/__tests__/socket.test.ts`、完整 `mix test`、前端 typecheck/lint/test、AI 静态扫描均通过。后续 AU-08 阅读投影闭环见下一条 checkpoint。

Pending Adoption Resume Action Loop hardening（2026-05-15 13:16）：用户 Stage 日志再次捕获 `channel.adopt` 失败：`turn_id=turn_adopt_21`、原因 `adoption_rejected`、详情 `"pending artifact not found"`。根因不是 JSON string-key，而是恢复态/动作态中 socket `current_turn_id` 可能已经推进到 action turn；当前端 payload 没带或丢失 `source_turn_ref` 时，Channel 会把 action turn 当 source turn 传给 `AdoptionWorkflow`，导致 pending artifact 查找落空。修复：`WorkspaceChannel` 的 `adopt` / `discard` / `modify_draft` 统一通过 `artifact_id` 在 socket 已恢复的 `turn_results_by_id` 中反查包含该 pending artifact 的真实 source turn；只有 artifact 已 resolved 或完全找不到 pending source 时才 fallback 到请求 source/current turn。前端 `WorkspaceChat` 对话流 adoption card 的 accept 也补传消息 `turn_id`，与 discard/modify 行为对齐。新增回归测试覆盖“当前 turn 是 `turn_adopt_21` action turn，但无 `source_turn_ref` 的 adopt 仍回溯到 `turn-adopt-source` 并成功”。验证：相关 adoption/channel/session 测试、完整 `mix test`、`mix compile --warnings-as-errors`、xref cycle check、arch check、前端 typecheck/lint/test、`pnpm tauri build`、`bash scripts/frontend_audit.sh`、`bash scripts/check_design_trace.sh`、`bash scripts/ai_static_scan.sh --top 10` 均通过。Tauri 原生复验 `bash scripts/tauri_slice_verify.sh au05-adoption-boundary` 本轮 180 秒超时，后端仅见 `/api/provider/health`，未产出 app JSONL，不能作为 AU-05 真实前端复验证据；为避免后续误判，`scripts/tauri_slice_verify.sh` 超时分支已新增 app JSONL 诊断，能区分“缺 app JSONL 文件”“有日志但关键事件不足”“LLM 证据缺失”。13:49 复验日志显示 source-turn 回溯已生效：`channel.adopt` / `adoption.evaluate` / `channel.adopt.done` 均在 `turn_6` 完成；同时暴露旧卡片可对已 resolved artifact 继续触发 discard/modify。已补二次动作保护：只要 socket 已知 `adoption_state.resolved` 中存在该 `artifact_id`，后续 `adopt` / `discard` / `modify_draft` 返回 `artifact already resolved`，不再进入 `AdoptionWorkflow`；Channel 回归测试覆盖 adopt 后再 discard/modify 被拒绝。前端交互也同步加固：`WorkspaceChat` 会根据 transcript 中的 `adoption_state.resolved` 禁用旧 adoption card 上的 accept/discard/edit_then_accept 按钮，并在 click handler 中 no-op，避免作者从旧卡片继续发起重复动作；右侧档案 pending 列表原本已按 resolved artifact 过滤。

Product Review note（2026-05-15 14:05）：上述前端禁用旧 adoption action 只能算防误触止血，不应视为 AU-05/AU-10 的产品化交互完成。正确体验应把 pending adoption card 在 resolved 后转换为明确的“决策记录/已处理卡”：显示 `已采纳` / `已放弃` / `已修改后采纳` 状态，移除待处理动作，替换为符合状态的后续动作（例如查看已采纳内容、打开阅读模式、继续扩写、查看原草稿或重新生成）。对话流旧卡片、右侧档案 pending count、阅读投影提示必须一致更新。下一步应实现状态化 `AdoptionCard` / `AdoptionDecisionCard`，而不是继续依赖 disabled button 表达业务状态。

Reading Mode Projection checkpoint（2026-05-15 12:18）：AU-08 采纳到阅读投影已形成原生 Tauri 前端发起闭环。新增 `NovelPersistence.ReadingProjectionRepo` 与 `NovelApplication.ReadingProjectionService`，`WorkspaceChannel.get_toc` 不再返回固定 `mock_work / 第一卷：起源`，而是读取当前 `work_id` 下有 `ACCEPTED` draft 的卷章；空作品或无效 work 返回空 TOC；新增 `get_chapter_content` handler，按当前 work 隔离读取章节下已采纳 draft 正文，跨作品/缺失章节返回错误。`AdoptionRepository.persist/1` 现在在同一事务内写 `Mutation`、confirmed memory，并 materialize `Volume/Chapter/Scene/Draft(ACCEPTED)`，使采纳后的内容可被 ReadingMode 读取。前端修复 `App.tsx`，切到 ReadingMode 时保持 `WorkspaceChat` 挂载，避免卸载时断开 Channel；`tauri.conf.json` / Vite dev host 与 `scripts/tauri_slice_verify.sh` 对齐到 `127.0.0.1:5769`，避免原生窗口加载不到 Vite。真实验证：`bash scripts/tauri_slice_verify.sh au08-adoption-reading-projection` 通过，证据 `artifacts/slice-verify/au08-adoption-reading-projection-tauri/summary.json`，关键事件覆盖 `channel.user_message.start → toolbox.execute.done → channel.adopt.done → channel.get_toc.done → channel.get_chapter_content.done`，`chapter_count=1`、`content_chars=80`。剩余：当前 materialization 是最小 accepted content read model，尚未按真实卷章规划/章节归属智能合并，也未实现 projection refresh job 的 FRESH/REBUILDING/FAILED 状态机。

Stage Startup Context Contract automation checkpoint（2026-05-15 12:38）：新增 `scripts/seed_stage_startup_context.exs` 和 `bash scripts/tauri_slice_verify.sh stage-startup-context-contract`。验证流程先在测试 DB 中创建真实 Work/active session/transcript/pending adoption，再启动原生 Tauri 工作台，由 `WorkspaceChat` 在恢复首屏通过 Channel 上报 `slice_verify.ui_state.done`。verifier 要求 `work_session.resume.done → channel.join.done → slice_verify.ui_state.done`，并断言同一 `work_id/session_id`、`transcript_count=2`、`pending_adoption_count=1`、服务状态已连接、作品标题可见且不是未连接/失败态、恢复 transcript 后没有欢迎语注入。证据：`artifacts/slice-verify/stage-startup-context-contract-tauri/summary.json`。

### 1.1 Stage 5 真实进度（基于 acceptance 与 walkthrough 对账）

| 维度 | 实测覆盖率 / 状态 | 证据 |
|------|---|---|
| 后端主链单元 + 集成测试 | `mix test`：412 tests / 0 failures；`mix test --include integration`：422 tests / 0 failures（含 novel_e2e 10 条）| 默认测试 2026-05-13 本地复核；integration 仍沿用 2026-05-12 复核；`:real_llm` 默认排除 |
| AI 静态扫描 | 13 PASS / 0 finding / 0 pending disposition | `artifacts/static-scan/top10.md`（2026-05-15）|
| SU-01..SU-03 系统验收 | 已按完整用户场景重算：SU-01 `0/10` 已验收、SU-02 `0/10` 完整端到端验收、SU-03 `0/6` 已验收；均有局部基础设施但未闭环 | `docs/design-v3/acceptance/README.md`；`docs/design-v3/acceptance/system/` |
| AU-01..AU-10 作者验收 | 已按完整前后端用户场景重算：均为 `0/N` 完整真实前后端验收；局部证据不能再等同“已验收”。AU-09 为 `0/14` 完整验收、`9/14` 局部证据；AU-10 为 `0/17` 完整验收、`13/17` 局部证据（action/task_state 最小切片已推进） | `docs/design-v3/acceptance/README.md`；`docs/design-v3/acceptance/author/AU-01-chat.md`..`AU-10-workbench-ui.md` |
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
| 桌面生命周期 / Stage 进程所有权 | **未解决（当前仅补丁缓解）** | 点击窗口关闭已补 `CloseRequested -> app exit` 和 shutdown controller 返回值错误；Stage Startup Context Contract 已开始收敛：stage 端口/env 不再被 `.env` 覆盖，API/WS 改用 `127.0.0.1`，前端禁止静默降级到 `lobby`。但真实所有权仍混乱：Tauri 侧按端口清 Phoenix，`stage.sh` 使用 `exec pnpm tauri dev` 后 cleanup/trap 语义弱，缺“点 X 后 Tauri/Vite/Phoenix 全部退出、端口释放、下次可干净启动”的自动化验收。后续应建 Desktop App Lifecycle / Stage Process Ownership 小 slice，明确进程 owner 和关闭契约 | `frontend/src-tauri/src/lib.rs`；`apps/novel_web/lib/novel_web/controllers/system_controller.ex`；`scripts/stage.sh`；`scripts/before-tauri-dev.sh`；`frontend/src/components/WorkspaceChat.tsx` |
| Pending adoption 恢复后的采纳/放弃/修改闭环 | **三条真实 Tauri 前端动作闭环已通过；source-turn 漂移已加固（2026-05-15）** | 已修复恢复自 JSON 的 string-key `turn_result` 查找，采纳不再因 key 形态误报 `pending artifact not found`；已补 `discard` workflow 与 Channel handler，放弃会返回 `DISCARDED` resolved `turn_result` 而不是 Channel 崩溃；已补 `modify_draft` workflow 与 Channel handler，修改后采纳会返回 `EDITED_ACCEPTED` resolved `turn_result`；已修 `WorkspaceChat` 修改弹窗旧 state 捕获问题；adopt/discard/modify_draft action turn_result 会写回 transcript 供 resume 去重。04:37 的 `au05-adoption-boundary`、`au05-discard-boundary`、`au05-modify-draft-boundary` 原生 Tauri 自动化均通过真实工作台入口。13:16 针对用户 Stage 日志中 `current_turn_id=turn_adopt_21` 导致 adopt 查不到 pending artifact 的复现风险，`WorkspaceChannel` 已改为按 `artifact_id` 从已恢复 `turn_results_by_id` 反查 pending source turn，前端 accept 也补传消息 `turn_id`；Channel 回归测试已覆盖。13:16 的 `au05-adoption-boundary` 原生 Tauri 复验未产出 app JSONL 而超时，不能作为新前端闭环证据；验证脚本已补超时诊断。后续 AU-08 已补采纳到阅读投影最小闭环，见 `au08-adoption-reading-projection` | `frontend/src/components/WorkspaceChat.tsx`；`apps/novel_web/lib/novel_web/channels/workspace_channel.ex`；`NovelApplication.AdoptionWorkflow`；`scripts/tauri_slice_verify.sh`；`artifacts/slice-verify/au05-adoption-boundary-tauri/summary.json`；`artifacts/slice-verify/au05-discard-boundary-tauri/summary.json`；`artifacts/slice-verify/au05-modify-draft-boundary-tauri/summary.json`；`artifacts/slice-verify/au08-adoption-reading-projection-tauri/summary.json` |

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

> 本轮目标不是实现代码，而是把验收 case 从“API/组件存在”改为“真实作者使用场景”。结论：SU-01~03、AU-01~10 已重算；后续进入承重 slice 规划与实现。

| 范围 | 当前状态 | 主要缺口 | 证据 |
|----|----|----|----|
| 场景化验收总入口 | 已新增 | SU-01~03、AU-01~10 均已按真实场景口径重算；后续实现前按蓝图选承重 slice | `docs/design-v3/acceptance/SCENARIO-BLUEPRINT.md` |
| SU-01 模型供应商 | `0/10` 已验收；`2/10` 有基础设施 | provider health 基础具备；缺 model 列表、运行时切换、Key/endpoint 配置、测试连接 UI 和错误恢复 | `docs/design-v3/acceptance/system/SU-01-model-provider.md` |
| SU-02 作品切换 | `0/10` 完整端到端验收；`5/10` 部分/基础设施 | 后端 Work CRUD、Channel work_id 透传、启动去 mock 已推进；缺运行时切换 UI、rejoin、pending 隔离、跨作品隔离验收 | `docs/design-v3/acceptance/system/SU-02-work-switching.md` |
| SU-03 AI 显示名 | `0/6` 已验收；`1/6` 仅硬编码默认值 | 缺设置入口、持久化、按作品隔离、仅 UI 展示边界 | `docs/design-v3/acceptance/system/SU-03-model-nickname.md` |
| AU-01/AU-02 自然对话与探索 | AU-01 `0/13` 完整 DOM 验收；已有 1 条原生 Tauri 两轮普通聊天主链证据；AU-02 `0/12` 完整前后端验收 | 普通聊天默认 MicroPlan 风险已用 `au01-ordinary-chat-two-turn-roundtrip` / `au10-ordinary-chat-no-micro-plan` 压住；仍缺 DOM 级自然回复、loading、无执行卡断言；候选操作和采纳桥接未闭环 | `docs/design-v3/acceptance/author/AU-01-chat.md`；`AU-02-explore.md` |
| AU-03 上下文与会话 | active session 恢复已有 1 条原生 Tauri 闭环证据；整体仍未完成全部 20 场景 | 已补 WorkSession、resume snapshot、完整 transcript 恢复、会话列表/搜索基础、pending adoption 重开恢复；仍缺历史 session 打开/只读、归档、从历史分支继续、最新 Work 背景 context SSOT、归档过滤、长会话压缩 | `docs/design-v3/acceptance/author/AU-03-context.md`；`artifacts/slice-verify/au03c-work-session-resume-tauri/summary.json` |
| AU-04/AU-06 执行确认与行为生命周期 | AU-04 `0/18`；AU-06 `0/17` 完整真实前后端验收 | 后端门禁较强；真实入口确认/拒绝已接 `author_action` 最小闭环；behavior_state 消费、resolution/history、幂等、TTL、ConfirmationBinding 和 UI 验收未闭环 | `docs/design-v3/acceptance/author/AU-04-execute-and-confirm.md`；`AU-06-behavior-lifecycle.md` |
| AU-05/AU-08 采纳到阅读投影 | **最小真实 Tauri 闭环已补（2026-05-15）**；完整 AU 覆盖率仍需重算 | `au08-adoption-reading-projection` 已证明真实工作台生成待采纳内容、点击采纳、后端写 mutation/memory/accepted draft read model、ReadingMode 经 Channel 拉到 TOC 和章节正文。剩余：真实卷章归属/合并、projection refresh job 状态机、完整 AU-05/AU-08 场景覆盖未重算 | `docs/design-v3/acceptance/author/AU-05-artifact-adoption.md`；`AU-08-reading-mode.md`；`artifacts/slice-verify/au08-adoption-reading-projection-tauri/summary.json` |
| AU-07 溯源回放 | `0/16` 完整真实前后端验收；`8/16` 有局部证据 | Replay no-provider 已测；缺 why UI、redaction、author/developer 双视图、Tool/Behavior/StateTrace 聚合 | `docs/design-v3/acceptance/author/AU-07-trace-and-replay.md` |
| AU-09 故事设定/记忆 | `0/14` 完整真实前后端验收；`9/14` 有局部证据 | `MemoryItem` schema、Phase 0 管理组件、reference log helper、`memory_summary` 字段存在；但 memory REST/Channel 管理入口、真实档案数据、recall 到 prompt、引用溯源和 AU-03 会话/最新背景分层均未闭环 | `docs/design-v3/acceptance/author/AU-09-story-memory.md` |
| AU-10 工作台实时交互 | `0/17` 完整真实前后端验收；1 条最小浏览器前端发起验证；4 条原生 Tauri 自动化证据；`13/17` 有局部证据 | 真实入口 `WorkspaceChat` 已接普通聊天默认 false、`available_actions`/`author_action`、`task_state` 最小闭环；`scripts/slice_verify.sh au10-micro-plan-entry` 已能从浏览器前端触发 MicroPlan；`scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` 已能从原生 Tauri 输入框/发送按钮连续完成两轮普通聊天并证明不进入 MicroPlan；`scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan` 已能从原生 Tauri 触发普通消息并断言 `generate_micro_plan=false`；`scripts/tauri_slice_verify.sh au10-micro-plan-entry` 已能从原生 Tauri 触发 MicroPlan 入口并断言 `generate_micro_plan=true`；adoption、候选点选、trace/why、projection、完整 DOM/工作台验收仍未闭环 | `docs/design-v3/acceptance/author/AU-10-workbench-ui.md` |

#### 下一会话交接（从这里继续）

1. 先读取 `docs/project-ledger.md`、`docs/design-v3/acceptance/SCENARIO-BLUEPRINT.md`、`docs/design-v3/acceptance/README.md`。
2. 继续沿用本轮口径：完整前后端用户场景优先；代码/组件/API 存在只能算局部证据；mock、helper 测试、文档描述不能算已验收。
3. **每个 slice 完成时必须能从真实前端入口发起验证**。这是 slice 的价值所在；若只能用后端/Channel/helper/组件测试证明，则只能标“局部证据”或“未闭环”，不能标 done。最终汇报必须说明作者从哪个前端界面、通过什么操作触发这条链路，并证明它穿过 Frontend → socket/API → web/channel/controller → application → domain/agent/persistence → TurnResult/task_state/projection/trace → 前端反馈。推荐沉淀为 `scripts/slice_verify.sh <slice-id>`，输出到 `artifacts/slice-verify/<slice-id>/`；接手时先运行 `bash scripts/slice_verify.sh --list`。
4. **最小实现步只能是 checkpoint，不能缩小规划范围**。任何“先做最小一步”必须引用既有 AU/SU/GAP 或 slice 任务编号，说明它属于哪个完整闭环、已经覆盖哪些计划内后果、下一 checkpoint 还必须补哪些计划内后果。不能把 persistence、trace、projection、UI 验证等 acceptance 已要求的后果说成“本次不做/范围外”；暂未覆盖时只能标“局部证据”或“未闭环”。规则正文见 `docs/engineering/vertical-slice.md` §1.2。
5. 下一步不再重算 AU/SU 文档，继续承重 slice 实现。优先候选：
   - 真实工作台主入口继续补 adoption/projection/trace/UI 自动化：覆盖 AU-05/AU-07/AU-08/AU-10 的 P0/P1 缺口。
   - 记忆召回端到端：新建/确认记忆 -> 召回进 context/prompt -> trace 显示引用来源 -> 历史会话不覆盖最新 Work 背景，覆盖 AU-03/AU-07/AU-09。
6. 任何实现前仍需回答 Contract / Invariant / Boundary / Consumer / Proof；其中 Proof 必须包含前端发起路径，暂缺则记录未闭环原因。

#### 进行中的承重切片（修正前 §1 的"全 done"假象）

| Slice | 状态 | 真实缺口 |
|-------|------|----------|
| VS-10 Observability Spine | **已落地并验证闭环（2026-05-12）** | Logger metadata key 已纳入配置；`mix credo suggest --strict --format json` 0 issues；AI 静态扫描 13 PASS / 0 finding。novel_agent provider 层自由文案 Logger 属 LLMLog 范围，非本 slice 引入 |
| VS-09 Work Management | **核心已落地（2026-05-11）**，剩余高级场景待续 | 切换 UI / cross-work e2e / pending 隔离 / 不可用降级 |
| Workbench action/task_state 最小切片 | **已推进（2026-05-14）** | `WorkspaceChat` 普通消息默认不请求 MicroPlan；真实入口渲染服务器 `available_actions`，提交 `author_action`；订阅 `task_state` 并更新 longRun store；Channel 在 action 后记忆新 turn；`scripts/slice_verify.sh au10-micro-plan-entry` 可从浏览器真实前端入口触发 MicroPlan 并输出 websocket frame / 截图 artifact；`scripts/tauri_slice_verify.sh au01-ordinary-chat-two-turn-roundtrip` 可从原生 Tauri 输入框/发送按钮连续完成两轮普通聊天并输出两个 turn 的 JSONL evidence；`scripts/tauri_slice_verify.sh au10-ordinary-chat-no-micro-plan` 可从原生 Tauri 输入框/发送按钮触发普通消息并输出 `generate_micro_plan=false` JSONL evidence；`scripts/tauri_slice_verify.sh au10-micro-plan-entry` 可从原生 Tauri 触发 MicroPlan 入口并输出 JSONL evidence。剩余：adoption 主流程、候选 selection、trace/why、projection、完整 DOM/Playwright/Tauri 验收 |
| AU-03C Work Session Resume | **主链已落地并通过原生 Tauri 验证（2026-05-15）；Stage 启动上下文主问题已手动复验通过** | 自动化证明 active session / transcript / pending adoption 可从持久化恢复；Stage Startup Context Contract 已修复并由用户复验真实 work/session join。剩余：pending adoption 只能恢复显示，尚不能采纳/放弃；新建会话 UI、历史会话打开/只读、归档、从历史继续创建分支、归档不进默认 context、长会话摘要压缩 |
| Stage Startup Context Contract | **手动 stage 复验通过主问题；原生 Tauri 自动化已补证（2026-05-15）** | 已修 stage/env 端口 SSOT、`localhost`→`127.0.0.1` API/WS、`before-tauri-dev.sh` env 传递、Vite proxy target 与前端 API base 拆分、`WorkspaceChat` 禁止 work/session 失败时静默 join `lobby`，并校验 Channel 返回 work/session 与启动上下文一致。`bash scripts/tauri_slice_verify.sh stage-startup-context-contract` 证明真实工作台首屏从持久化 active session 恢复 transcript/pending adoption 后，UI 上报同一 work/session、服务已连接、作品标题可见、未插入欢迎语。证据：`artifacts/slice-verify/stage-startup-context-contract-tauri/summary.json` |
| Pending Adoption Resume Action Loop | **三条真实 Tauri 前端动作闭环已通过（2026-05-15）** | 后端/Channel checkpoint 已补：string-key 恢复 turn_result 可被 AdoptionWorkflow 读取，`discard` 不再导致 Channel 崩溃，`modify_draft` 返回 `EDITED_ACCEPTED`，adopt/discard/modify_draft action turn_result 写回 transcript 供 resume 去重。真实 Tauri 自动化 `au05-adoption-boundary`、`au05-discard-boundary`、`au05-modify-draft-boundary` 均已通过，证明真实工作台点击可触发三类动作。AU-08 采纳后阅读投影最小闭环已由 `au08-adoption-reading-projection` 补齐；不能把 AU-05/AU-08 整体标 done 的剩余原因变为完整场景覆盖和 projection refresh 状态机 |
| Desktop App Lifecycle / Stage Process Ownership | **未规划；当前仅补丁缓解（2026-05-15）** | 已修点击关闭后的直接报错和 Tauri app 不退出症状，但尚未定义桌面关闭契约、stage 进程所有权、Phoenix/Vite/Tauri 清理顺序和自动化证明。不能把“点 X 可关”误标为桌面生命周期 done |
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
