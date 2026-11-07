# 00f · 实现态能力图谱（System Capability Atlas）

> 状态：**living 文档**（2026-11-08 首版，基于当前 HEAD 只读盘点）
>
> 定位：本文是**实现态**能力图谱——从真实入口反查「功能域 → 后端实现 → 前端消费 → 验证证据 → 缺口」。
> 它**不是**设计真源（设计态见 `00`–`08` 与 `00c` 契约图谱），也**不是**验收缺口台账
> （见 [`quality/acceptance/known-gaps.md`](../../quality/acceptance/known-gaps.md)）或任务状态
> （见 [`tasks/NEXT.md`](../../tasks/NEXT.md) 与 `tasks/slices/`）。
>
> 使用规则：
> 1. 任何「完善/新增功能」开工前，先在本文找到所属功能域与真实入口，确认缺口状态；
> 2. 状态词表只使用 §2 的定义，**没有页面/实模证据的能力不得标「已取证」**；
> 3. 每次交付改变功能域状态时同步更新本表与 §5 缺口清单（同 commit）；
> 4. 本文不替代 `00c` 的 contract 索引；状态对象/契约名以 `00c` 为准。

---

## 1. 真实入口总览（2026-11-08 盘点）

### 1.1 前端视图（`frontend/src/App.tsx`）

| 视图 | 入口 | 说明 |
|---|---|---|
| 工作台 | `WorkspaceChat`（workbench mode） | 唯一主工作区：对话流、任务控制坞、时间线、候选/质量卡、结构面板、压缩记录、回答卡、Why 回放等 |
| 阅读模式 | `ReadingMode`（reading mode） | 作品阅读投影（TOC/章节正文） |
| 记忆页 | `MemoryListPage`（memory mode） | 记忆列表/详情/创建（`MemoryDetailDrawer`/`MemoryCreateDialog`） |

React Query 负责服务端状态；Zustand 管 UI state；Socket 单 Channel（`frontend/src/lib/socket.ts`）。

### 1.2 WorkspaceChannel 真实消息（`apps/novel_web/lib/novel_web/channels/workspace_channel.ex`）

- **前端 → 后端**（frontend push）：`user_message`、`author_action`、`agent_command`、`agent_events_since`、`plan_next_volume`、`export_work`、`get_toc`、`get_work_profile`、`get_chapter_content`、`get_characters`、`get_assumptions`、`get_foreshadowing`、`get_rules`、`get_ledger_threads`、`get_review_report`、`get_writing_coordinate`、`get_work_stats`、`ping`。
- **后端 → 前端**（broadcast/push）：`agent_event`、`agent_run_state`、`turn_result`、`action_result`、`task_state`。
- **无前端消费者的旧 handler**（待退役评估，见 §5 P1-C）：`adopt`、`discard`、`modify_draft`。

### 1.3 HTTP API（`apps/novel_web/lib/novel_web/router.ex`）

| 域 | 入口 |
|---|---|
| 健康 | `GET /health` |
| Provider | `GET /api/provider/health`、`/options`；`POST /models`、`/test`；`PUT /config` |
| 作品 | `GET/POST /api/works`、`POST /api/works/ensure-initial`、`PATCH/DISCARD /api/works/:id`、`GET /api/works/:id` |
| 记忆 | `/api/works/:work_id/memories`（列表/创建/recall/show/confirm/lock/unlock/deprecate/archive/weight/validity/references） |
| 会话 | `/api/works/:work_id/sessions`（resume/list/search_hits/create/archive/transcript/show） |
| 回放/活动 | `/turns/:turn_id/replay`、`/provider-runs`、`/agent-run-activity` |
| 系统 | `POST /api/system/shutdown` |

### 1.4 桌面与验收入口

- Tauri 2 外壳 + Mix Release sidecar（`docs/design/tech-stack/05-desktop.md`）；隔离 `tauri-home`、原生窗口、进程所有权由 `scripts/lib/native_*` 管理。
- 验收入口：`scripts/quality_accept.sh <scenario> --surface tauri|browser`、`scripts/tauri_slice_verify.sh <slice>`、`scripts/native_b71_batch.sh <tag>`、`scripts/scenario_invariants/run_*.exs`、`bash scripts/ai_static_scan.sh --top 10`。

---

## 2. 状态词表（判定标准）

| 状态 | 含义（必须满足） |
|---|---|
| **M3 已取证（页面/实模）** | 机制测试通过 **且** 有外部自动化驱动真实页面（必要时真实模型）的当前源码证据 |
| **M2 已实现（机制层）** | 生产代码存在、单测/集成/Channel 测试覆盖；无当前源码的独立页面/实模证据 |
| **M1 部分实现** | 主链可用但存在明确子缺口（未接线/未覆盖/未取证子项） |
| **M0 未实现** | 设计/任务已登记，但生产代码不存在 |
| **D 文档不一致** | 文档描述与实现不一致（待修或已修登记） |

证据层级与项目一致：形态层（页面）> 机制层（测试）> 模型行为层（实模另证）；**不通过机制层代签模型行为或文学质量（I10）**。

---

## 3. 功能域矩阵（2026-11-08）

> 「证据」列只写已核实来源：测试域（`mix test` 各 app）、验收场景族（`quality/acceptance/scenarios.yml`，233 项）、页面批次
> （`artifacts/slice-verify/`，历史批次 ≠ 当前源码 PASS；最近确认 PASS 见 `docs/project-ledger.md`/B71）。

| # | 功能域 | 真实入口 | 后端实现（摘要） | 前端消费（摘要） | 证据 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 对话主链与轮次 | Channel `user_message`/`turn_result` | `agent_run_service`、`agent_run_server`、`agent_run_flows/*`、`turn_result` 组装 | `WorkspaceChat`、`UICards`、`framePresentation` | web channel tests、au01/agent-* 场景、历史页面批次 | M2 |
| 2 | AgentRun 执行循环与控制 | Channel `agent_command`/`agent_run_state`/`agent_event` | `agent_run_server`、`agent_run_budget`、`agent_run_startup`、`agentic_next_step_planner` | `agentRunTimeline`/`agentRunAnchoring`/`agentRunInputRouting`/控制坞 | agent 506 tests、b31/b71 批次（19/19 等） | M2（部分页面 M3） |
| 3 | 判断与计划 | 对话输入 | `judgment_protocol`、`agentic_plan_draft_planner`、`planner` | 时间线/计划卡 | judgment-* 场景族、单测 | M2 |
| 4 | 创作与质量 | 作者写作请求 | `prose_drafting_with_quality` 等 flows、`quality_*`、`authoring_operation` | `UICards`（候选/质量卡）、`reviewFindingActions` | p1-* 场景族（17）、agent-prose-* | M2（实模未证） |
| 5 | 采纳与确认边界 | Channel `author_action`（accept/discard/edit_then_accept/confirm/reject） | `author_action_*`、`adoption_workflow`、`author_action_admission`、确认交接 | `authorActionSubmission`/`candidateActionGroups`/`adoptionDecision`（死模块见 §5） | au04/au05 场景族、confirmation 批次 | M2（部分页面 M3） |
| 6 | 档案、结构与阅读 | Channel `get_toc`/`get_chapter_content`、阅读模式 | `reading_projection*`、works/chapter 服务 | `ReadingMode`、`StructurePanel`、`readingProjection*` | p1/b28/b30/au08 场景、阅读批次 | M2 |
| 7 | 小说要素 | Channel `get_characters`/`get_assumptions`/`get_foreshadowing`/`get_rules`/`get_ledger_threads`/`get_work_profile` | 领域服务 + `world_*`/`character_*`/`ledger_threads` | 工作台侧栏/档案面板、`ledgerThreadsWire` | au09/au13/au14 场景族 | M2 |
| 8 | 记忆体系 | HTTP memories + 记忆页 | `memories_controller`、memory 服务、分层召回 | `MemoryListPage`/`MemoryDetailDrawer`/`MemoryCreateDialog` | au09（15 场景）+ web controller tests | M2（面板泄漏修复已有页面 PASS 记录） |
| 9 | 上下文与压缩 | 安全点自动维护、压缩记录 | `transcript_compaction`、`auto_maintenance_*`、checkpoint | `TranscriptCompactionNotice` | au03/au11 场景、T1–T12 单测、不变量 | M1（G6 实模未闭环） |
| 10 | 会话管理 | HTTP sessions + 前端 | `work_sessions_controller`、service | `sessions.ts`、工作台会话列 | au03 场景族 | M2 |
| 11 | Provider 与设置 | HTTP provider + 设置界面 | `Provider.Gateway`、adapter 族、registry、runtime config、secret 安全 | Provider 设置（WorkspaceChat 设置弹层）、`providerHealth` | su01（10 场景）+ agent 传输测试 | M2（实模/官方凭证未证） |
| 12 | 可观测性与回放 | HTTP replay/activity、Channel 事件/Why | `trace_replay_controller`、`provider_activity_controller`、`authoring_replay`、`agent_run_event_query` | `agentRunTimeline`、Why 回放 | au07/e2e-01 场景、N-NARR 不变量 | M2 |
| 13 | 作品导出 | Channel `export_work`、`task_state` | 导出任务（channel 内流程 + 服务） | `export.ts` | e2e/p1-export 场景 | M2 |
| 14 | 桌面外壳与打包 | Tauri 窗口/菜单/sidecar | `desktopSidecar.ts` + Rust shell | 原生入口 | SU 场景族、原生页面批次 | M2（release 签名/多平台外部阻塞） |
| 15 | 恢复与鲁棒性 | 断线/重启/超时/取消 | durable checkpoint、resume、startup 恢复、取消 token | 控制坞/恢复 UI | au08/au10/b71 恢复场景、b71-a1-03 | M2（部分实模未证） |
| 16 | 质量与验收体系（工程） | 脚本/CI | quality/acceptance、scenario_invariants、static scan、arch/xref/module-size | 无（工程侧） | 233 场景 registry、五类不变量、CI | M3（工程层） |

---

## 4. 跨域事实（盘点确认）

1. **单一 Channel**：工作台所有实时能力经 `WorkspaceChannel`；前后端消息名已核对一致（含 `broadcast!` 的 `action_result`/`task_state`）。
2. **Provider 契约边界**：canonical Request IR（`novel_common`）+ 三 wire 投影 + 能力事实；执行边界保留路由选择/传输/监督（A1 裁决后）。
3. **流式与预览（R2）**：三 wire SSE 统一生命周期、Responses SSE、工具参数增量→作者正文预览；确定性页面证据 `b71-authoring-transcript-tauri-native-stream-preview-06`（7/7 checks）。
4. **确定性页面证据 ≠ 实模**：`slice_verify`/`streaming_slice_verify` 批次只证接线与不变量；实模与文学质量（I10）另证。
5. **导入/分析（B79）未实现**：独立大功能，未在上一轮范围内启动（作者 2026-11-08 指示先梳理现有功能）。

---

## 5. 缺口清单（首轮盘点，2026-11-08）

| 编号 | 级别 | 缺口 | 证据 | 处置 |
|---|---|---|---|---|
| P1-A | P1 死代码 | `frontend/src/components/ChannelDemo.tsx`(+css) 无任何引用 | 全仓 import/JSX 扫描 0 引用 | **已修（2026-11-08）**：已删除；`check_design_trace.sh`/`frontend_audit.sh` 的 demo 豁免同步移除 |
| P1-B | P1 死代码 | `frontend/src/lib/adoptionDecision.ts` 仅测试引用，生产未使用 | 生产 import 扫描 0；仅 `lib/__tests__/cards.test.ts` | **已修（2026-11-08）**：已删除模块、`CARD.adoptionDecision` 文案段与 2 个死测试；前端 53 files/484 tests 全绿 |
| P1-C | P1 旧协议 | Channel `adopt`/`discard`/`modify_draft` handler 无前端消费者（前端走 `author_action` accept/discard/edit_then_accept） | 前端 push 消息扫描 0；`AU-05` 已确认当前有效入口是 author_action；后端 handler + 13 处 v3 测试仍保留 | **评估完成（2026-11-08），待实施退役**：三个 handler 各 ~50 行、三个 result helper 仅旧 handler 使用；底层 `AdoptionWorkflow.handle_*` 被 `author_action` 与 `pending_artifact_workflow` 复用（不删）；退役时把 v3 测试中 pending 校验/跨 work 拒绝/edit_then_accept 安全断言迁移到 author_action 路径 |
| P2-A | P2 未实现 | 存量书稿导入/分析建档（B79） | 无生产代码；任务文档独立 | 独立大功能，作者指示暂不启动 |
| P2-B | P2 未取证 | G6 压缩后真实请求未闭环 | B71 记录；需同 run 多回合实模窗口 | 等实模窗口 |
| P2-C | P2 未取证 | 真实模型行为/Responses·Anthropic 实模 | q2_0 批次仅机制必选项；官方凭证缺失 | 等窗口/凭证，不代签 |
| P3-A | P3 文档 | `docs/design/README.md` 顶部 2026-11-04 历史状态行仍写「R1 实现位于未提交工作区」 | 与当前已提交实现不符（历史记录可保留） | 补最新状态行说明当前状态，不改写历史 |
| P3-B | P3 文档 | `quality/acceptance/known-gaps.md` 与当前实现/任务状态的一致性未逐条复核 | 233 场景 + 台账 | 下一轮逐条核对 |

---

## 6. 维护规则

- 新增/退役功能：更新 §3 对应行与 §5；页面证据只在 `artifacts/` 留证据目录，不在本文复制数据。
- 状态升级到「M3 已取证」必须引用可复跑入口（quality_accept/tauri_slice_verify/native_b71_batch）与证据目录；
- 实模/文学质量证据单独分层，不得用机制层证据升级。
