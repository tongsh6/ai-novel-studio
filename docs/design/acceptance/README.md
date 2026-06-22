# v3 验收场景全景

> 最后更新：2026-06-22
>
> 本目录包含 AI Novel Studio v3 的验收场景文档。按两种用户视角组织：**系统用户**（自然人，配置和运行软件）和**作者用户**（核心用户，用 AI 写小说）。
>
> 重要：本目录的早期 AU/SU 覆盖率是“文档内场景覆盖率”，不等同于完整产品验收。后续完善以 [场景化验收蓝图](SCENARIO-BLUEPRINT.md) 为总入口，先按完整功能蓝图列场景，再用代码、测试、走查和报告对账。

---

## 用户模型

```
自然人（系统用户）                    作者（核心用户）
─────────────────                    ─────────────────
配置模型供应商                        与 AI 聊创作
切换作品项目                          探索创作方向
给 AI 起名字                          AI 基于作品上下文给建议
                                     审核 AI 执行计划并确认
                                     采纳 AI 生成的候选内容
                                     处理系统的追问和确认
                                     理解 AI 的决策过程
```

---

## 文档索引

### 场景化验收总入口

| 文档 | 作用 | 当前状态 |
|------|------|----------|
| [SCENARIO-BLUEPRINT](SCENARIO-BLUEPRINT.md) | 从完整功能蓝图出发，识别跨 AU/SU 的主流程场景和缺口 | 新增，作为后续重算覆盖率和补 case 的入口 |
| [E2E-01](e2e/E2E-01-full-chain.md) | 用真实 LLM / SQLite / Channel 证明主链端到端路径 | 文件级可交付 / 二轮已复核：10/13 已验收；2/13 已测试；1/13 部分实现；P0/P1 已关闭，2026-06-22 已复跑 E2E 聚合 runner、E4 downgrade、E6 read-only tool trace 与 E9 ReplayReport 六问真实页面 checkpoint；剩余 P2 为 E8/E13 Channel security regression |

### 系统用户验收（3 文档）

| 文档 | 能力 | 场景 | 覆盖率 | 状态 |
|------|------|------|--------|------|
| [SU-01](system/SU-01-model-provider.md) | 切换模型供应商 | 10 | 9/10 已验收；1/10 部分实现（B3）；当前可进入 SU-02 | DeepSeek、运行时切换 API、供应商实时模型列表、工作台模型设置 UI、Tauri 偏好、本地 `provider-secrets.json`、provider/model 审计日志已实现；`su01-model-provider-switching` 已验收 Stub 切换主路径，`su01-lmstudio-disconnected-health` 已验收 LM Studio 未启动断开态，`su01-provider-endpoint-validation` 已验收非法 endpoint 阻断，`su01-provider-model-list-success` 已验收 DeepSeek/Anthropic/LM Studio 模型列表成功管线，`su01-provider-test-failure-ui` 已验收测试连接失败反馈与恢复，`su01-api-key-secret-redaction` 已验收 API Key 配置流脱敏边界；`su01-local-secret-file-roundtrip` 已验收真实 Tauri WebView 保存本地 secret 文件、重启读回与脱敏边界；当前无 SU-01 内必须关闭的 external blocker，P1 仍缺 live vendor/云端供应商真实失败矩阵 |
| [SU-02](system/SU-02-work-switching.md) | 作品空间管理 | 13 | 13/13 已验收；当前可进入 SU-03 | 运行时作品菜单、空库自动未命名作品、快速未命名创建、命名新增、改名、安全移出、leave/join、消息流隔离、慢回复迟到归属、reload 恢复和 artifact/projection/trace 隔离已有真实 Tauri 证据；恢复/归档管理、后端不可用 UX、大列表和异常矩阵为 P2 后续 |
| [SU-03](system/SU-03-model-nickname.md) | 给模型起名 | 6 | 6/6 真实 Tauri 验收；SC-SU03-C2 有 LM Studio payload 证据；当前可进入 AU-01 | work-scoped UI 显示名已补；真实消息、TurnResult、websocket payload 和 LM Studio request body 均证明显示名只影响 UI；后续只需随工作台重构做回归 |

### 作者用户验收（12 文档）

| 文档 | 能力 | 场景 | 覆盖率 | 状态 |
|------|------|------|--------|------|
| [AU-01](author/AU-01-chat.md) | 与 AI 聊创作 | 13 | 11/13 有真实页面外部自动化证据；2/13 已测试；文件级可进入 AU-02 | 普通聊天两轮真实工作台闭环已补，含可见 user/assistant 顺序、thinking 清退、`generate_micro_plan=false`、无 MicroPlan、无 action/candidate/adoption UI；`--real-lmstudio` 证明真实 provider 两轮 form_frame 请求。空消息 guard、provider recovery、乱码 JSON 友好降级、frame validation 友好错误和 TurnResult/recorder/UI 同源对账已补真实页面验收；剩余 P1 为 trace/replay UI cross-reference（owner：AU-07），P2 为 no-slot-form UI 反证 |
| [AU-02](author/AU-02-explore.md) | 探索创作方向 | 12 | 文件级可交付：11/12 已有真实 Tauri 前后端 checkpoint；1/12 schema/codegen 契约已测试；当前可进入 AU-03 | 模糊创意自然探索/no-slot-form、真实 LMStudio 中文探索质量、坏候选 fallback UI、候选生成、继续探索、继续讨论后的多轮上下文、候选卡后自由追问、未采纳候选不进阅读/事实、明确采纳桥接、候选 no-MicroPlan 已补；D2 候选方向 schema/codegen 回归已闭环；`AU02-file-level-closure.md` 已补文件级收口记录 |
| [AU-03](author/AU-03-context.md) | AI 了解我的作品 | 20 | 文件级可交付：12/20 已验收；2/20 已测试；3/20 部分实现；1/20 已实现未验收；1/20 未实现；1/20 不确定；当前可进入 AU-04 | 新建会话、历史会话只读回看、从历史继续创建新分支会话、归档过滤、最新 Work 背景 SSOT、active transcript 分层、上下文来源 UI、长会话压缩和跨作品/记忆分层已有当前可复跑真实 Tauri 证据；`au03-current-work-context-ssot --real-lmstudio` 证明最新 Work 与 active transcript 进入真实 provider prompt；`AU03-file-level-closure.md` 已补文件级收口记录；剩余 P1/P2 为 behavior summary、empty/work-only/failure UI、显式 archived source、AU-07 replay/trace、搜索命中定位和压缩策略细化 |
| [AU-04](author/AU-04-execute-and-confirm.md) | 执行任务与确认 | 18 | 文件级可交付：10/18 场景有真实 Tauri 验收；5/18 有局部测试；3/18 部分实现；P0 已关闭，2026-06-22 二轮已关闭确认后工具 trace 重复持久化回归，当前可进入 AU-05 | `au04-confirm-before-execute` 已证明真实高风险确认主链：needs_confirmation、确认卡说明确认对象/确认前 no-tool/no-write/确认后 re-gate、点击“确认执行”走 `author_action`、重新 gate 后只产出待采纳草稿；二轮复跑发现并修复 Channel 对 `tool_dispatched` trace 的重复落库，修复后该入口无 `channel.persist_trace` 失败且恢复通过；`au04-confirm-idempotency-ui` 已证明真实快速重复确认只产生 1 次非 duplicate receipt、1 次工具 dispatch 和 1 份 pending artifact；`au04-stale-confirmation-ui` 已证明 follow-up 推进当前 turn 后旧确认被 stale 拒绝，且 no-tool/no-draft；`au04-confirmation-ttl-ui` 已证明 expired confirmation 被拒绝，且 no-tool/no-draft；`au04-disabled-confirmation-action-ui` 已证明 disabled confirm 可见但不可提交，且 no-author-action/no-tool/no-draft；`au04-history-confirmation-readonly` 已证明历史只读 confirmation 不可执行且 no-action/no-tool/no-draft；`au04-cross-work-confirmation-guard` 已证明跨作品切换后源 confirmation 在目标作品不可见不可执行且 no-action/no-tool/no-draft；`au04-latest-context-rebase-confirmation` 已证明确认前真实改名后 binding/trace 消费最新 Work revision/title；`au04-confirmation-tool-failure-recovery` 已证明确认后工具失败可见、无 pending draft、无 production write；普通聊天不误触发确认和取消等待也有真实证据。剩余 P1/P2 是持久 ConfirmationBinding snapshot、trace/replay、LLM timeout/retry action、assistant_message truthfulness 和 LongRunner 全矩阵 |
| [AU-05](author/AU-05-artifact-adoption.md) | 采纳创作产物 | 18 | 文件级可交付：15/18 已验收；3/18 部分实现；P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-06 | 候选 adoption boundary、高风险 confirmation、stale rejection、cross-work/canon recovery、artifact accept/discard/edit_then_accept、未采纳/已放弃不进阅读、采纳后 reading projection、StateTrace adoption replay 和设定 recall 均有当前真实 Tauri / quality acceptance 证据；11 个 AU-05 主证据与 cross evidence 已串行复跑通过；剩余 P1/P2 是持久 adoption inbox、ProjectionHint refresh 状态机、完整 replay/旧 turn 查询、canon/revision store 自动计算和人工合并 UX；`AU05-file-level-closure.md` 已补二轮缺口矩阵 |
| [AU-06](author/AU-06-behavior-lifecycle.md) | 行为生命周期 | 17 | 文件级可交付：13/17 已验收；4/17 部分实现；P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-07 | 高风险 confirmation、普通聊天 no-waiting、active behavior UI、confirm binding/re-gate、cancel/reject、等待期间继续聊天 stale guard、旧/过期/禁用/历史/跨作品 action、TTL、幂等、single-active runtime safety、cancel terminal BehaviorTrace 和前端只提交服务端 action 均有当前真实 Tauri / quality acceptance 证据；12 个 AU-06 关联入口已串行复跑通过；剩余 P1 是 blocking clarification、confirm terminal history/replay 与持久 BehaviorBinding ledger；`AU06-file-level-closure.md` 已补二轮缺口矩阵 |
| [AU-07](author/AU-07-trace-and-replay.md) | 决策溯源透明度 | 16 | 文件级可交付：9/16 已验收；1/16 已测试；6/16 部分实现；P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-08 | `au07-trace-why-entry`、`au07-state-trace-adoption-replay`、`au07-behavior-trace-terminal-replay` 三个 AU-07 本体入口已串行复跑通过；作者 why dialog author-safe、不重调模型、不写生产状态，StateTrace/adoption/projection replay producer 与 Behavior terminal replay producer 均有当前真实 Tauri 证据。`e2e-01-readonly-tool-trace` 与 `e2e-01-replay-report` 的默认 Tauri 和 real LM Studio quality 入口也已复跑通过，补上 summary-level ToolTrace refs 持久回查和 ReplayReport 六问 cross evidence；剩余 P1 是旧 turn trace 查询 API/UI、developer 双视图、完整 ToolTrace registry snapshot / redacted I/O、work/session 查询隔离和 reason catalog 深化 |
| [AU-08](author/AU-08-reading-mode.md) | 阅读我的作品 | 16 | 文件级可交付：11/16 已验收；3/16 已实现未验收；2/16 部分实现；P0 已关闭，2026-06-22 二轮已关闭 cross-reference driver 漂移，当前可进入 AU-09 | 采纳正文、编辑后采纳、未采纳不入阅读、跨作品隔离、多章导航、空章诚实显示、短章 audit、导出和 STALE banner 均有当前真实 Tauri / quality acceptance 入口；二轮复跑 5 个 AU-08 本体入口和 3 个 cross evidence 全部通过，并修复 `p1-chapter-draft-generation` 旧文案等待；剩余 P1 是 projection refresh 专用 action/no-write driver、REBUILDING/FAILED 状态来源、返回工作台上下文、只读 no-write 专项和离线降级 |
| [AU-09](author/AU-09-story-memory.md) | 管理故事设定 | 14 | 文件级可交付：10/14 已验收；1/14 已测试；3/14 部分实现；P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-10 | 8 个当前可复跑 AU-09 Tauri 入口已挂入 quality acceptance 并在二轮串行复跑通过：记忆创建确认召回、管理入口与生命周期终态排除、lifecycle/reference author-safe 追溯、伏笔/规则 adoption、角色主档案、有效期窗口、跨作品隔离、AU-03 会话/记忆分层。历史 `au09-archive-real-data` / `au09-memory-recall-context` 仅作背景；剩余 P1/P2 是完整 archive stats、pending inbox、筛选分页真实页面矩阵、developer replay、历史旧 turn 查询、Channel 管理入口和完整独立 MemoryTrace/StateTrace 表。 |
| [AU-10](author/AU-10-workbench-ui.md) | 工作台实时交互 | 17 | 文件级可交付：14/17 已验收；1/17 已测试；2/17 部分实现；P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-11 | 6 个当前可复跑 AU-10 Tauri 入口已挂入 quality acceptance 并在二轮串行复跑通过，覆盖 1280x800 工作台基线、普通聊天 no-MicroPlan、why、候选授权 action、adoption、reading projection、task_state RUNNING/CHECKPOINT/COMPLETED、不可达 provider、真实 provider timeout、WebSocket reconnect、取消等待和恢复后继续；剩余 P1/P2 是完整异步 LongRunner、FAILED task_state 真实页面、全 card/action 深矩阵、projection/trace 深链路和文案/hidden metadata hygiene |
| [AU-11](author/AU-11-ai-guided-authoring.md) | AI 引导式创作会话结构 | 4 | 文件级可交付：2/4 已验收；2/4 部分实现；P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-12 | `au11-quality-diagnosis-message-envelope` 与 `au11-missing-workstate-policy` 已挂入真实 Tauri / quality acceptance 并在二轮串行复跑通过，覆盖 VS-00D 质量诊断三层 envelope、缺上下文 WorkState missing、why 可见、不编造和 no tool/adoption/write；剩余 P1 是 `guidance_mode` schema 冻结、clarify/confirm 引导 proof、prose_writing envelope 投影 |
| [AU-12](author/AU-12-work-profile.md) | 查看与核对作品档案 | 11 | 文件级可交付：8/11 已验收；1/11 已测试；1/11 部分实现；1/11 未实现；P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 E2E-01 | `au12-work-profile-overview` 与 `au12-work-profile-status-isolation` 已挂入真实 Tauri / quality acceptance 并在二轮串行复跑通过，覆盖 works 立项概览、accepted/tentative 状态、空字段、概览/大纲/角色/伏笔/规则导航、跨作品隔离、no-write 和 UUID 脱敏；A2 prompt 同源为实现/测试约束，缺同轮 provider prompt 外部证据；剩余 P1 是读取失败诚实降级和 correction 修订意图 |

---

## 不变量覆盖矩阵

v3 系统 15 个不变量（来自 `00c` §7）与验收文档的映射：

| 不变量 | AU-01 | AU-02 | AU-03 | AU-04 | AU-05 | AU-06 | AU-07 | AU-08 | AU-09 | AU-10 | AU-11 |
|--------|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|:-----:|
| #1 每 turn 必有 frame | ● | ● | ● | | | | | | | | ● |
| #2 MicroPlan 只是建议 | | | | ● | | | | | | | |
| #3 Orchestrator 唯一门禁 | | | | ● | | | | | | | ● |
| #4 默认只允许下一步 | | | | ● | | | | | | | |
| #5 工具调用有 trace | | | | | | | ● | | ● | | |
| #6 写入默认 tentative | | | | ● | ● | | | ● | | | |
| #7 behavior 有生命周期 | | | | | | ● | | | | | |
| #8 缺 slot 不自动表单 | | ● | ● | | | ● | | | | | ● |
| #9 TurnResult canonical | ● | ● | | | | | ● | | | ● | ● |
| #10 UI 只能提交 action | | | | | | ● | | | | ● | |
| #11 selection ≠ adoption | | | | | ● | | | | ● | | |
| #12 确认后重新 gate | | | | ● | ● | ● | | | | | ● |
| #13 trace summary 脱敏 | | | ● | | | | ● | | | | ● |
| #14 replay 不调 LLM | ● | | | | | ● | ● | | | | ● |
| #15 projection 只刷新 | | | | | ● | | | ● | | | |

**不变量覆盖率：15/15（100%）**

> AU-12（作品档案）已有文件级真实 Tauri 证据：AU12-I1 的 works/profile 单一事实源显示侧、AU12-I2 只读 no-write、AU12-I3 不泄漏内部 id、AU12-I4 当前作品隔离、AU12-I5 状态可辨、AU12-I6 空字段诚实显示均已在作品档案查看链路验证；AU12-I1 的同轮 provider prompt proof、AU12-I6 的读取失败降级矩阵和 AU12-I7 correction intent 仍为 P1/P2。系统 15 不变量矩阵暂不扩列，等 AU12 correction/编辑链路补齐后再整体重算。

---

## 测试总览

```bash
# 全部验收关联测试 — 一键运行
mix test apps/novel_application/test/novel_application/
mix test apps/novel_web/test/novel_web/channels/
```

| 测试文件 | 关联文档 | 测试数 |
|---------|---------|--------|
| `dialogue_gateway_test.exs` | AU-01, AU-02 | 13 |
| `context_grounding_test.exs` | AU-03 | 12 |
| `execution_authority_test.exs` | AU-04 | 18 |
| `adoption_boundary_test.exs` | AU-05 | 9 |
| `creative_artifact_test.exs` | AU-04, AU-05, AU-10 | 12 |
| `behavior_lifecycle_test.exs` | AU-06 | 8 |
| `action_roundtrip_test.exs` | AU-04, AU-06, AU-07 | 8 |
| `replay_service_test.exs` | AU-07 | 6 |
| `trace_repository_test.exs` | AU-07 | 6 |
| `workspace_channel_v3_test.exs` | AU-01, AU-04, SU-02 | 12 |

**总计：98 个测试，0 个失败，13 个被排除（需 real LLM / integration）**

---

## 缺口总览

| 缺口 | 关联文档 | 类型 | 优先级 |
|------|---------|------|--------|
| 普通聊天真实工作台验收 | AU-01 AU01-GAP-01 | 已补普通聊天两轮 checkpoint，后续补异常矩阵 | P1 |
| 普通聊天误触发 MicroPlan 风险 | AU-01 AU01-GAP-02 | 已补两轮 no-MicroPlan + no action/candidate/adoption UI checkpoint | P1 |
| 聊天异常与降级 UI 体验 | AU-01 AU01-GAP-06 | 空消息 guard、乱码 JSON recovery、frame validation friendly error 与 TurnResult/recorder/UI 同源对账已补真实页面验收；继续补 replay/trace UI | P1 |
| 候选卡点选继续探索 | AU-02 AU02-GAP-01 | 已闭环：`au02-candidate-continuation` | closed |
| 候选采纳桥接 adoption boundary | AU-02 AU02-GAP-02 | 已闭环：`au02-candidate-adoption-bridge` | closed |
| 探索阶段真实入口与多轮体验 | AU-02 AU02-GAP-03~10 | 模糊创意自然探索/no-slot-form、真实 LMStudio 中文质量、坏候选 fallback UI、no-MicroPlan 入口偏差、候选 continuation/multiturn context/freeform follow-up/adoption walkthrough、未采纳候选阅读/事实反证和候选 schema/codegen 均已闭环 | done |
| 作品内会话模型与管理 | AU-03 AU03-GAP-01~03 | 新建会话、历史只读回看、从历史继续分支和归档过滤当前入口均已补真实 Tauri 证据；继续补搜索命中定位/高亮和完整 replay | closed/P2 |
| 最新作品背景接入 context | AU-03 AU03-GAP-04 | 已闭环：`au03-current-work-context-ssot` 与 `--real-lmstudio` 证明最新 Work snapshot 和 active session transcript 进入真实 provider prompt | closed |
| 记忆/行为/来源摘要上下文 | AU-03 AU03-GAP-05~10 | memory recall、author-safe 来源摘要、归档过滤和长会话 checkpoint 已补；behavior summary、显式 archived source、真实故障 UI 和 AU-07 replay/trace 继续补 | P1/P2 |
| 真实入口确认动作接入 `author_action` | AU-04 AU04-GAP-01~02 | 主路径已补：`au04-confirm-before-execute`；disabled 子矩阵已补：`au04-disabled-confirmation-action-ui`；完整 card/action replay matrix 继续补 | P0 |
| 确认幂等、Binding、取消 lifecycle | AU-04 AU04-GAP-03~06 | 取消等待主路径已补；重复确认 UI 幂等已补；当前-turn stale 确认拒绝已补；expired confirmation 拒绝已补；历史只读 confirmation 不可执行已补；cross-work confirmation 隔离已补；latest-context rebase 已补真实页面验收；ConfirmationBinding re-gate refs 已有强契约；持久 snapshot 和 replay 仍需补实现/补验收 | P0/P1 |
| 确认后任务反馈、真值文案、失败恢复 | AU-04 AU04-GAP-07~09 | 工具失败主路径已由 `au04-confirmation-tool-failure-recovery` 补真实 Tauri 验收；RUNNING/COMPLETED/LongRunner、LLM timeout、retry action、真值文案和 replay 仍待补 | P1 |
| 真实采纳入口与 AdoptionBoundary 主流程 | AU-05 AU05-GAP-01~02 | 已闭环：候选走 `author_action.choose_candidate -> DialogueGateway -> AdoptionBoundary`，artifact 走 `author_action.accept/discard/edit_then_accept -> AdoptionWorkflow`；当前质量入口可复跑 | closed |
| StateTrace、持久化待处理箱、selection/adoption 桥接 | AU-05 AU05-GAP-03~05 | selection/adoption 桥接已闭环；持久 adoption inbox 与完整 StateTrace/replay 仍待补 | P1 |
| freshness/conflict/cross-work 与高风险确认 | AU-05 AU05-GAP-06~07 | 高风险 confirmation、stale restored candidate rejection、cross-work recovery 与 canon conflict recovery 均已由真实 Tauri 质量验收闭环；完整 context version/revision freshness、覆盖确认和 canon store 自动计算仍待补 | P1 |
| ProjectionHint、修改/放弃、truthfulness、真实档案/阅读 | AU-05 AU05-GAP-08~11 | 修改/放弃、采纳后阅读、未采纳/已放弃不进阅读、设定 recall 和 truthfulness no-write 已闭环；完整 ProjectionHint stale/refresh 状态机仍待 AU-08 | P1/P2 |
| blocking clarification 主链 | AU-06 AU06-GAP-03/AU06-GAP-11 | 补实现/补集成/补验收 | P1 |
| confirm terminal history、BehaviorTrace/replay | AU-06 AU06-GAP-04/AU06-GAP-10 | 补集成/补验收 | P1 |
| 持久 BehaviorBinding ledger / replay 解释 | AU-06 AU06-GAP-05/AU06-GAP-06/AU06-GAP-09 | 补集成/补验收 | P1 |
| 工作台 why 入口与中文解释 | AU-07 AU07-GAP-01~02 | 当前 Tauri/quality 入口已恢复并复跑；reason catalog/旧 turn 查询待补 | P1 |
| trace redaction 与 author/developer 双视图 | AU-07 AU07-GAP-03~04 | author-safe why/redaction 最小链路已补；developer 双视图权限和旧 trace 查询仍待补 | P1 |
| Replay 六问与 Tool/Behavior/StateTrace 聚合 | AU-07 AU07-GAP-05~08 | ReplayService refs/partial 已补；StateTrace adoption/projection producer 与 Behavior terminal close/resolution producer 均已有真实 Tauri 证据；旧 turn replay UI/API、完整 ToolTrace registry snapshot 和六问聚合继续作为 P1 补齐 | P1 |
| trace 查询 API/UI 与 work/session 隔离 | AU-07 AU07-GAP-09~10 | 补集成/修设计偏差/补验收 | P1 |
| 阅读模式真实 TOC/章节读取 | AU-08 AU08-GAP-01~02 | 当前 Reading Projection 读链已接 `get_toc` / `get_chapter_content`；采纳、编辑后采纳、多章导航和空章诚实显示均有真实 Tauri / quality 入口；2026-06-22 二轮修复并复跑 `p1-chapter-draft-generation`，证明未采纳正文草稿仍不进 Reading Projection | done |
| 采纳到阅读投影与 ProjectionHint adapter | AU-08 AU08-GAP-03~04 | 采纳后 `projection_refs.refresh_status=STALE` 已进入 WorkspaceChat/ReadingMode 并有 stale banner 真实 Tauri 断言；完整 refresh job/status machine 仍为 P1 | done/P1 |
| projection refresh no-write 与跨作品隔离 | AU-08 AU08-GAP-05~06 | 跨作品隔离已由 SU-02 证明；专用 refresh action/no-write driver 待补 | P1 |
| 阅读模式错误态与 UI 自动化 | AU-08 AU08-GAP-07~09 | 核心阅读质量入口已补；离线/失败态、返回上下文和只读 no-write 专项待补 | P1/P2 |
| 记忆管理 REST/Channel 入口与作品档案真实数据 | AU-09 AU09-GAP-01~03 | 文件级 P0 已关闭：管理入口、伏笔/规则 adoption、角色主档案、跨作品档案/记忆隔离均有当前 Tauri / quality 证据；完整 archive stats current driver、pending inbox、Channel 管理入口和正式设计追溯登记为 P1/P2 | done/P1/P2 |
| 记忆召回到 context/prompt 与 recall ranking | AU-09 AU09-GAP-04~05 | 文件级 P0 已关闭：`au09-memory-create-recall`、`au09-adopt-setting-recall`、`au09-validity-window-recall`、`au09-cross-work-memory-isolation` 均证明 confirmed/current/in-window memory 进入 context/why；更细 ranking 属后续深化 | done/P2 |
| 记忆状态机、locked 保护、有效期窗口 | AU-09 AU09-GAP-06~08 | 文件级 P0 已关闭：基础状态机、locked UI/recall、terminal 排除、lifecycle blocked trace 和章节有效期窗口均有当前 Tauri / quality 入口；scene-level 窗口、降权策略和未来自动改写反证为 P2 | done/P2 |
| 记忆引用日志、作者溯源、AU-03 会话分层 | AU-09 AU09-GAP-09~12 | author-safe recall/lifecycle reference log、why 来源、记忆详情追溯和 AU-03 会话/记忆分层已闭环；developer replay、历史旧 turn 查询和完整独立 trace 表登记为 P1 | done/P1 |
| 角色主档案 roundtrip（创建→采纳→Character 主档案→展示→上下文） | AU-09 AU09-GAP-13 | 文件级 P0 已关闭：`character_seed` 采纳写 Character 主档案且不写 memory，角色 tab 可见并进入后续上下文；CP2 字段级结构化/关系/演化待补 | done/P1 |
| 真实工作台入口与 v3 action/task_state 消费者分裂 | AU-10 AU10-GAP-01/AU10-GAP-03/AU10-GAP-07 | `WorkspaceChat` 已是唯一生产工作台入口；6 个当前 AU-10 Tauri driver 已挂入 quality acceptance；真实导出 task_state、provider failure、WebSocket reconnect、cancel waiting 与 provider timeout 已验收；FAILED task_state 真实页面和完整异步 LongRunner 仍为 P1 | done/P1 |
| 普通聊天默认 MicroPlan、card action 绕过授权、候选操作 | AU-10 AU10-GAP-02/AU10-GAP-04~05 | 默认 MicroPlan、card action 授权、候选继续探索均已有 Tauri 证据；剩余为完整矩阵归并 | P1 |
| adoption UI、trace/why、projection、错误恢复 | AU-10 AU10-GAP-06/AU10-GAP-08~10 | adoption/why/projection 最小闭环已有；provider failure、WebSocket reconnect、cancel waiting 与 provider timeout 均已有 Tauri/quality entry；完整 LongRunner 和深度 projection/trace 状态待补 | done/P1 |
| 工作台 UI 自动化与 Tauri/Design 约束 | AU-10 AU10-GAP-11~12 | AU-10 baseline matrix、真实导出 task_state、provider failure、WebSocket reconnect、cancel waiting 与 provider timeout 已挂入 quality acceptance；全 card/action、文案/hidden metadata 卫生和更多 viewport 状态待复核 | done/P1 |
| AI 引导式创作三层 message 闭环 | AU-11 AU11-GAP-01~05 | SC-AU11-01/02 已有真实 Tauri / quality acceptance：质量诊断三层 envelope、缺上下文 WorkState missing、why 可见、不编造、no tool/adoption/write；`guidance_mode` schema 冻结、clarify/confirm 和 prose_writing envelope proof 登记为 P1 | done/P1 |
| 作品档案读取失败与修订入口 | AU-12 SC-AU12-B3/C2 | works 立项概览、accepted/tentative 状态、空字段、跨作品隔离、tab 导航和 no-write 已闭环；读取失败诚实降级和 correction 修订意图待补，accepted-artifact / 立项要素深扩展登记为 P2 | P1 |
| 供应商 health/model/error 补齐 | SU-01 SU01-GAP-01~03 | 已补 health connected/disconnected、LM Studio 未启动、测试连接失败和 AU-01 乱码 JSON recovery 真实 Tauri 证据；继续补启动关闭/云端失败矩阵 | P0/P1 |
| 供应商运行时切换与安全配置 | SU-01 SU01-GAP-04~07 | 已补 Stub 切换主路径、endpoint URL 校验、模型列表成功矩阵、测试连接失败反馈与恢复、API Key redaction checkpoint、profile-scoped Tauri 偏好与本地 `provider-secrets.json`；`su01-local-secret-file-roundtrip` 已补真实 Tauri WebView local-file 写读、0600 权限和重启读回；继续补 live vendor/失败矩阵，Windows/Linux local-file 页面矩阵降为 P2 平台回归 | P1/P2 |
| 作品切换主闭环与隔离 | SU-02 SU02-GAP-01~04 | 运行时切换、空库启动、慢回复迟到归属和 artifact/projection/trace 隔离真实 Tauri 闭环已补；角色/统计扩展矩阵后续 | done/P2 |
| 作品生命周期命名新增、改名、删除或移出 | SU-02 SU02-GAP-06~08 | 最小真实 Tauri 闭环已补；stale/discarded lastOpened reload 降级已补；异常矩阵待补 | done/P2 |
| 作品管理 UI 与恢复策略 | SU-02 SU02-GAP-09~11 | Tauri preference / browser fallback 口径已纠偏并有 reload checkpoint；恢复/归档管理入口、后端不可用 UX 待补 | P1/P2 |
| AI 显示名设置与隔离 | SU-03 SU03-GAP-01~05 | 已闭环：默认名、设置/重置、按作品隔离、websocket/TurnResult/LM Studio payload 边界均有真实 Tauri 证据 | done |

**总缺口：持续重算中。当前 SU-01~03、AU-01~12、E2E-01 已按场景化口径重算或新立；SU-01 B3 模型列表成功矩阵已由 `su01-provider-model-list-success` 补最小真实工作台 checkpoint，B4 测试连接失败反馈与恢复已由 `su01-provider-test-failure-ui` 补真实 Tauri 证据，当前 local-file secret 写读已由 `su01-local-secret-file-roundtrip` 补真实 Tauri 证据；live vendor/失败矩阵仍是 P1，Windows/Linux local-file 页面矩阵降为 P2 平台回归，不再是 SU-01 external blocker。SU-02 空库启动未命名作品、作品生命周期命名新增/改名/安全移出、慢回复迟到归属、重启恢复和 artifact/projection/trace 隔离已有真实 Tauri checkpoint，P0/P1 已闭环，恢复/归档管理、后端不可用 UX、大列表和异常矩阵为 P2 后续；SU-03 work-scoped AI 显示名、默认回退、作品隔离和 UI-only provider 边界已闭环，当前可进入 AU-01。AU-01 普通聊天两轮、空消息 guard、乱码 JSON recovery、frame validation friendly error 和 TurnResult/recorder/UI 同源对账真实工作台 checkpoint 已补，文件级可进入 AU-02；剩余 replay/trace UI 登记为 AU-07 cross-reference，C3 no-slot-form UI 反证为 P2。AU-02 模糊创意自然探索/no-slot-form、真实 LMStudio 中文质量、坏候选 fallback UI、候选 continuation/multiturn context/freeform follow-up/adoption bridge、未采纳阅读/事实反证和 D2 候选 schema/codegen 回归已闭环，文件级可进入 AU-03。AU-03 新建会话、历史只读、从历史继续、归档过滤、最新 Work 背景 SSOT、active transcript 分层、上下文来源、长会话和跨作品/记忆分层已补当前可复跑真实 Tauri 证据，`au03-current-work-context-ssot --real-lmstudio` 已证明真实 provider prompt 分层，P0 已关闭，文件级可进入 AU-04；剩余 behavior summary、显式 archived source、failure UI、AU-07 replay/trace 和搜索/压缩细化登记为 P1/P2。AU-04 高风险确认主链已由 `au04-confirm-before-execute` 登记为质量场景，重复确认不重复执行已由 `au04-confirm-idempotency-ui` 证明，当前-turn 旧确认 stale 拒绝已由 `au04-stale-confirmation-ui` 证明，expired confirmation 拒绝已由 `au04-confirmation-ttl-ui` 证明，disabled confirmation 不可提交已由 `au04-disabled-confirmation-action-ui` 证明，历史只读 confirmation 不可执行已由 `au04-history-confirmation-readonly` 证明，cross-work confirmation 隔离已由 `au04-cross-work-confirmation-guard` 证明，latest-context rebase 已由 `au04-latest-context-rebase-confirmation` 证明，ConfirmationBinding re-gate refs 已有强契约；持久 snapshot 和 replay 仍未闭环。AU-07 已补 why 入口、StateTrace/adoption/projection replay producer、Behavior terminal replay producer、只读工具链 summary-level ToolTrace refs 和 ReplayReport 六问 cross evidence，二轮口径为 9/16 已验收、1/16 已测试、6/16 部分实现，P0 已关闭，文件级可进入 AU-08；剩余 P1 为旧 turn trace 查询 API/UI、developer 双视图、完整 ToolTrace registry snapshot / redacted I/O、work/session 查询隔离和 reason catalog 深化。AU-12 works 立项概览显示侧、accepted/tentative 状态、空字段、tab 导航、跨作品隔离、no-write 与 UUID 脱敏均已有真实 Tauri / quality acceptance，文件级 P0 已关闭；A2 同轮 provider prompt proof 为 P2，加强项，读取失败降级与 correction 修订入口登记为 P1，accepted-artifact/立项要素深扩展为 P2。E2E-01 已按真实证据重算为 10/13 已验收、2/13 已测试、1/13 部分实现；E10 trace persister → SQLite → `TraceRepository.list_by_turn` 已补局部 integration proof，`e2e-01-full-chain` 聚合 runner、`e2e-01-downgrade-real-page`、`e2e-01-readonly-tool-trace` 和 `e2e-01-replay-report` 已挂入 quality acceptance 并通过，P0/P1 已关闭，剩余 P2 为 E8/E13 invented/forged source Channel security regression。AU-10 baseline/task_state/provider failure/reconnect/cancel/timeout 已有 checkpoint；完整异步 LongRunner 因缺真实生产消费者按 `docs/design/04a-planning-and-long-run.md` 延后。当前继续铺产品功能广度，`AU09-archive-memory-roundtrip` CP2 已由 `au09-adopt-setting-recall` 证明真实页面伏笔/规则生成、adoption、tab 重开可见、recall/why；`AU09-memory-management-workbench-entry` 已由 `au09-memory-management-entry` 证明正式入口与基础生命周期治理；`AU09-memory-trace-roundtrip` 已补 lifecycle/reference author-safe 追溯；`AU09-validity-window-recall` 已补章节有效期窗口；`AU09-cross-work-memory-isolation` 已补跨作品隔离；`AU09-AU03-session-memory-layering` 已补同一作品内 active/historical session 与 governed memory 分层；`AU11-quality-diagnosis-message-envelope` 已补 SC-AU11-01 最小真实工作台 trace proof。**

---

> 2026-06-21 补充：AU-04 新增确认卡说明内容真实 Tauri / quality acceptance 证据，`au04-confirm-before-execute` 现在必须看到确认对象、确认前 no-tool/no-write 和确认后 re-gate 说明；此前 2026-06-20 `au04-confirmation-tool-failure-recovery` 已证明确认后 `prose_writing` 工具失败会显示失败且无 pending draft / production write。AU-04 当前口径为 10/18 已验收、5/18 已测试、3/18 部分实现，P0 已关闭；剩余为持久 ConfirmationBinding snapshot、replay、LLM timeout/retry action、assistant_message truthfulness 和 LongRunner 全矩阵。
> 2026-06-22 补充：AU-04 二轮复跑发现 `au04-confirm-before-execute` 当前 quality 入口暴露确认后工具 trace 重复持久化问题；已在 Channel action trace 分支中跳过 application 已持久化的 `tool_dispatched` trace，保留 adoption / cancel 等非工具 action trace 路径，并补 Channel regression test。随后 9 个 AU-04 默认 Tauri / quality 入口、`au06-single-active-confirmation` 与 `au10-workbench-recovery-cancel-waiting` 已串行复跑通过；AU-04 当前无本文件内必须继续关闭的 P1，可进入 AU-05。

> 2026-06-21 补充：AU-05 已完成文件级收口，当前口径为 15/18 已验收、3/18 部分实现，P0 已关闭，当前可进入 AU-06。新增/刷新证据包括 `au05-discard-author-action`、`p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`au09-adopt-setting-recall`，并复跑 `au05-adoption-safety-freshness`、`au05-stale-conflict-cross-work-freshness`、`au05-conflict-cross-work-recovery`、`au05-canon-conflict-recovery`、`au02-candidate-adoption-bridge`、`au02-unadopted-candidate-no-reading-fact`。旧 direct `adopt` / `discard` / `modify_draft` handler 缺口口径已替换为当前 `author_action` 主链；剩余为持久 adoption inbox、ProjectionHint stale/refresh、完整 StateTrace/replay 和 canon/revision store 自动计算。
> 2026-06-22 补充：AU-05 二轮缺口收敛未发现本文件内应关闭的新 P1/P0；11 个真实 Tauri / quality 入口已串行复跑通过：`au05-adoption-safety-freshness`、`au05-stale-conflict-cross-work-freshness`、`au05-conflict-cross-work-recovery`、`au05-canon-conflict-recovery`、`au05-discard-author-action`、`au02-candidate-adoption-bridge`、`au02-unadopted-candidate-no-reading-fact`、`p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`au07-state-trace-adoption-replay`、`au09-adopt-setting-recall`。AU-05 继续保持 15/18 已验收、3/18 部分实现，P0 已关闭，当前可进入 AU-06；剩余 persistent inbox、refresh 状态机、完整 replay/旧 turn 查询、canon/revision store 自动计算和人工合并 UX 已登记 owner。
>
> 2026-06-21 补充：AU-06 已完成文件级收口，当前口径为 13/17 已验收、4/17 部分实现，P0 已关闭，当前可进入 AU-07。新增 `au06-single-active-confirmation` 真实 Tauri / quality acceptance 证据，证明连续两个高风险 confirmation 下旧 behavior 不可执行、最新 behavior 可执行一次；既有 AU04/AU10 evidence 覆盖 confirmation open、confirm binding/re-gate、cancel、stale、TTL、disabled、history readonly、cross-work、idempotency、latest-context rebase。剩余 P1 交给 blocking clarification、confirm terminal history、BehaviorTrace/replay 和持久 BehaviorBinding ledger。
> 2026-06-22 补充：AU-06 二轮缺口收敛未发现本文件内应关闭的新 P1/P0；12 个真实 Tauri / quality 入口已串行复跑通过：`au04-confirm-before-execute`、`au04-confirmation-tool-failure-recovery`、`au04-confirm-idempotency-ui`、`au04-stale-confirmation-ui`、`au06-single-active-confirmation`、`au04-confirmation-ttl-ui`、`au04-disabled-confirmation-action-ui`、`au04-history-confirmation-readonly`、`au04-cross-work-confirmation-guard`、`au04-latest-context-rebase-confirmation`、`au10-workbench-recovery-cancel-waiting`、`au07-behavior-trace-terminal-replay`。AU-07 cross evidence 已证明 cancel waiting 后的 cancelled action turn 记录 terminal BehaviorTrace close/resolution refs；confirm terminal replay、blocking clarification 和持久 BehaviorBinding ledger 继续登记为 P1 owner，当前可进入 AU-07。
>
> 2026-06-21 补充：AU-07 已完成文件级收口，当前口径为 6/16 已验收、4/16 已测试、6/16 部分实现，P0 已关闭，当前可进入 AU-08。新增 `au07-behavior-trace-terminal-replay` 真实 Tauri / quality acceptance 证据，证明真实工作台 cancel waiting 后的 cancelled action turn 记录 terminal BehaviorTrace close/resolution refs，且 ReplayService 可离线解释 no-provider/no-tool/no-write 的终态；既有 `au07-trace-why-entry` 与 `au07-state-trace-adoption-replay` 分别覆盖 author-safe why 入口和 StateTrace/adoption/projection replay producer。剩余 P1 交给旧 turn trace 查询 API/UI、developer 双视图、完整 ToolTrace registry snapshot、ReplayReport 六问和 work/session 查询隔离。
> 2026-06-22 补充：AU-07 二轮缺口收敛未发现本文件内应关闭的新 P1/P0；3 个 AU-07 本体真实 Tauri / quality 入口已串行复跑通过：`au07-trace-why-entry`、`au07-state-trace-adoption-replay`、`au07-behavior-trace-terminal-replay`。同时 `e2e-01-readonly-tool-trace` 与 `e2e-01-replay-report` 的默认 Tauri 和 real LM Studio quality 入口均通过，证明只读 `character_roster` 工具链的持久 `tool_trace_refs` 可查询，且 ReplayReport 可从持久 trace no-provider 生成完整六问。AU-07 二轮口径调整为 9/16 已验收、1/16 已测试、6/16 部分实现；旧 turn trace 查询 API/UI、developer 双视图、完整 ToolTrace registry snapshot / redacted I/O、work/session 查询隔离和 reason catalog 深化继续登记为 P1 owner，当前可进入 AU-08。
>
> 2026-06-21 补充：AU-08 已完成文件级收口，当前口径为 11/16 已验收、3/16 已实现未验收、2/16 部分实现，P0 已关闭，当前可进入 AU-09。新增/刷新 `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`p1-word-count-audit`、`p1-chapter-expansion-multichapter`、`p1-export-minimum` quality manifest；外部 verifier 补 STALE banner、目录点击第 2/3 章和未写第 4 章空态断言。剩余 P1 为 projection refresh 专用 action/no-write driver、REBUILDING/FAILED 状态来源、返回工作台上下文、只读 no-write 专项和离线降级。
> 2026-06-22 补充：AU-08 二轮缺口收敛发现并关闭 `p1-chapter-draft-generation` cross-reference driver 漂移。旧 driver 等待“待确认的创作材料”文案，当前真实 UI 为“待保存章节草稿/章节正文草稿”；修复只改外部 driver，并在点击真实“阅读”入口后等待新的 `channel.get_toc.done`。随后 `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`p1-word-count-audit`、`p1-chapter-expansion-multichapter`、`p1-export-minimum`、`p1-chapter-draft-generation`、`au02-unadopted-candidate-no-reading-fact`、`su02-artifact-projection-trace-isolation` 均已串行复跑通过。AU-08 当前无本文件内未关闭 P0/P1 blocker，可进入 AU-09；projection refresh/status machine 等仍登记为 P1 后续。
>
> 2026-06-21 补充：AU-09 已完成文件级收口，当前口径为 10/14 已验收、1/14 已测试、3/14 部分实现，P0 已关闭，当前可进入 AU-10。新增 `au09-memory-create-recall`、`au09-memory-management-entry`、`au09-memory-trace-roundtrip`、`au09-adopt-setting-recall`、`au09-character-dossier-roundtrip`、`au09-validity-window-recall`、`au09-cross-work-memory-isolation`、`au09-au03-session-memory-layering` quality manifest，并明确历史 `au09-archive-real-data` / `au09-memory-recall-context` 只作背景证据。剩余 P1/P2 为完整 archive stats、pending inbox、筛选分页真实页面矩阵、developer replay、历史旧 turn 查询、Channel 管理入口和完整独立 MemoryTrace/StateTrace 表。
> 2026-06-22 补充：AU-09 二轮缺口收敛未发现本文件内应关闭的新 P1/P0；8 个真实 Tauri / quality 入口已串行复跑通过：`au09-memory-create-recall`、`au09-memory-management-entry`、`au09-memory-trace-roundtrip`、`au09-adopt-setting-recall`、`au09-character-dossier-roundtrip`、`au09-validity-window-recall`、`au09-cross-work-memory-isolation`、`au09-au03-session-memory-layering`。AU-09 继续保持 14 个场景中 10 个已验收、1 个已测试、3 个部分实现；完整 archive stats、pending inbox、筛选分页真实页面矩阵、developer replay、历史旧 turn 查询和完整独立 MemoryTrace/StateTrace 表继续登记为 P1/P2，当前可进入 AU-10。
>
> 2026-06-21 补充：AU-10 已完成文件级收口，当前口径为 14/17 已验收、1/17 已测试、2/17 部分实现，P0 已关闭，当前可进入 AU-11。新增 `au10-workbench-matrix-layout`、`au10-workbench-recovery-taskstate`、`au10-workbench-recovery-disconnect-timeout`、`au10-workbench-recovery-provider-timeout`、`au10-workbench-recovery-reconnect`、`au10-workbench-recovery-cancel-waiting` quality manifest。剩余 P1/P2 为完整异步 LongRunner、FAILED task_state 真实页面、全 card/action 深矩阵、projection/trace 深链路和文案/hidden metadata hygiene。
> 2026-06-22 补充：AU-10 二轮缺口收敛未发现本文件内应关闭的新 P1/P0；6 个真实 Tauri / quality 入口已串行复跑通过：`au10-workbench-matrix-layout`、`au10-workbench-recovery-taskstate`、`au10-workbench-recovery-disconnect-timeout`、`au10-workbench-recovery-provider-timeout`、`au10-workbench-recovery-reconnect`、`au10-workbench-recovery-cancel-waiting`。AU-10 继续保持 17 个场景中 14 个已验收、1 个已测试、2 个部分实现；完整异步 LongRunner、FAILED task_state 真实页面、全 card/action 深矩阵、projection/trace 深链路和文案/hidden metadata hygiene 继续登记为 P1/P2，当前可进入 AU-11。
>
> 2026-06-21 补充：AU-11 已完成文件级收口，当前口径为 2/4 已验收、2/4 部分实现，P0 已关闭，当前可进入 AU-12。新增 `au11-missing-workstate-policy` 真实 Tauri / quality acceptance，证明真实工作台空白作品下“哪里不成立”会进入 VS-00D WorkState missing，不编造当前章/人物状态，why 显示缺失，且 no tool/adoption/write。剩余 P1 为 `guidance_mode` schema 冻结、clarify/confirm 引导 proof、prose_writing envelope 投影。
> 2026-06-22 补充：AU-11 二轮缺口收敛未发现本文件内应关闭的新 P1/P0；2 个真实 Tauri / quality 入口已串行复跑通过：`au11-quality-diagnosis-message-envelope`、`au11-missing-workstate-policy`。AU-11 继续保持 4 个场景中 2 个已验收、2 个部分实现；`guidance_mode` schema 冻结、clarify/confirm 引导 proof 和 `prose_writing` envelope 投影继续登记为 P1，当前可进入 AU-12。
>
> 2026-06-21 补充：AU-12 已完成文件级收口，当前口径为 8/11 已验收、1/11 已测试、1/11 部分实现、1/11 未实现，P0 已关闭，当前可进入 E2E-01。新增 `au12-work-profile-status-isolation` 真实 Tauri / quality acceptance，证明 accepted/tentative 状态可辨、空字段诚实显示、五个档案 tab 可导航、跨作品概览/角色/伏笔/规则隔离，且档案查看 no user_message / author_action / adoption / tool / write、不泄漏内部 Work UUID。A2 的 prompt 同源为实现/测试约束，缺同轮 provider prompt 外部证据；剩余 P1 为读取失败诚实降级和 correction 修订意图。
> 2026-06-22 补充：AU-12 二轮缺口收敛未发现本文件内应关闭的新 P1/P0；2 个真实 Tauri / quality 入口已串行复跑通过：`au12-work-profile-overview`、`au12-work-profile-status-isolation`。AU-12 继续保持 11 个场景中 8 个已验收、1 个已测试、1 个部分实现、1 个未实现；读取失败诚实降级和 correction 修订意图继续登记为 P1，A2 同轮 provider prompt proof 为 P2 加强项，当前可进入 E2E-01。
>
> 2026-06-21 补充：E2E-01 已完成文件级对账、E10 checkpoint、聚合 runner checkpoint、E4 真实页面 downgrade checkpoint、E6 只读工具 trace checkpoint 与 E9 ReplayReport 六问 checkpoint，当前口径为 10/13 已验收、2/13 已测试、1/13 部分实现，P0/P1 已关闭。旧“11/13 完整 + 2/13 部分”已更正：stub integration 不再被当成完整 E2E。新增 `dialogue_gateway_real_loop_test.exs` trace persistence case，证明 `DialogueGateway.handle_input` 注入真实 `WorkspaceContext.trace_persister/0` 后可经 SQLite 由 `TraceRepository.list_by_turn/1` 回查同 turn trace；新增 `e2e-01-full-chain` 聚合 runner、`e2e-01-downgrade-real-page`、`e2e-01-readonly-tool-trace` 与 `e2e-01-replay-report` Tauri runner，`bash scripts/quality_accept.sh e2e-01-full-chain --provider lmstudio`、`bash scripts/quality_accept.sh e2e-01-downgrade-real-page --surface tauri --provider lmstudio`、`bash scripts/quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio` 与 `bash scripts/quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio` 已通过并写入 summary。剩余 P2 为 E8/E13 invented/forged source negative Channel security regression。
> 2026-06-22 补充：E2E-01 二轮缺口收敛未发现本文件内应关闭的新 P1/P0；`e2e-01-downgrade-real-page --surface tauri --provider lmstudio`、`e2e-01-readonly-tool-trace --surface tauri --provider lmstudio`、`e2e-01-replay-report --surface tauri --provider lmstudio` 和 `e2e-01-full-chain --provider lmstudio` 均已串行复跑通过。二轮仅关闭聚合 artifact cross-reference 漂移：`summary.json` 的 E12/E13 名称已对齐“真实两轮回路 / Action 来源校验”，E8/E13 remaining gaps 已分别登记。当前仍为 10/13 已验收、2/13 已测试、1/13 部分实现；E8/E13 继续作为 P2 Channel security regression，E10 页面 trace query 继续归 AU-07 owner，本轮满足退出标准。

## 文档结构约定

每个验收文档统一使用 8 节结构：

```
# Title
> 视角概述
## 1. 我能做什么          — 用户能力表（我能做什么 | 系统怎么回应）
## 2. 不变量               — 映射到 00c §7（AU）或自定义（SU）
## 3. 契约引用             — ADR / Contract Pack / 代码文件
## 4. 验收场景             — Given/When/Then 格式，按场景组分节
## 5. 场景覆盖状态          — 表格 + 通过率
## 6. 缺口                 — 表格：影响 + 建议处理
## 7. 已知限制 / 现有基础设施 — 可选
## 8. 验收命令              — 可执行的测试命令
```
