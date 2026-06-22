# 场景化验收蓝图 / Scenario Acceptance Blueprint

> 最后更新：2026-06-22
>
> 目的：把验收从“已有实现对应测试”升级为“完整功能蓝图对应场景”。本文不证明系统已经完成，而是用完整场景地图发现当前系统中不完整、覆盖不足或状态误判的实现。

---

## 1. 验收原则

场景化验收不是测试清单的搬运。每个场景必须从作者或系统用户的真实工作流出发，再映射到设计契约、实现证据和缺口。

| 原则 | 要求 |
|---|---|
| 先蓝图，后实现 | 先列完整用户能力闭环，再标注哪些已经实现、哪些只是局部实现 |
| 先主流程，后边缘 | 优先发现阻塞端到端闭环的缺口，再补异常和边界 |
| 真实消费者 | 每个验收场景必须说明第一个真实消费者：Channel、Frontend、Application、Persistence、Replay 或人工走查 |
| 前端可发起 | 每个 slice 完成时必须能从真实前端入口发起验证；后端/Channel/API/helper/组件测试只能算局部证据 |
| 主链穿透 | 前端发起验证必须覆盖 Frontend 用户操作 → socket/API → web/channel/controller → application → domain/agent/persistence → TurnResult/task_state/projection/trace → 前端反馈 |
| 证据分级 | 已实现不等于已验证；有单测不等于有人机可用；有 stub 不等于真实 LLM / SQLite / UI 走通过 |
| 不把缺口包装成需求扩张 | 验收缺口应说明是“补测试、补集成、补主流程、补 UX、补文档”还是“新增能力” |

状态枚举统一使用：

| 状态 | 含义 |
|---|---|
| 已验收 | 有真实主流程或自动化验收证明 |
| 已测试 | 有自动化测试，但可能只覆盖局部层 |
| 已实现未验收 | 代码存在，但缺真实场景证明 |
| 部分实现 | 只覆盖链路中的若干段 |
| 未实现 | 设计存在，代码/入口缺失 |
| 不确定 | 当前证据不足，需要补查 |

---

## 2. 完整功能蓝图

当前 v3 产品蓝图可分成 10 条能力链。验收文档应覆盖这些链，而不是只覆盖模块文件。

| 能力链 | 用户目标 | 现有文档 | 当前判断 | 主要缺口 |
|---|---|---|---|---|
| 系统启动与模型配置 | 本地启动后知道 AI 是否可用，可配置/测试供应商 | SU-01 | 9/10 已验收；1/10 部分实现（B3）；当前可进入 SU-02 | DeepSeek、运行时切换 API、供应商实时模型列表、工作台模型设置 UI、Tauri 偏好、本地 `provider-secrets.json`、provider/model 审计日志已实现；`su01-model-provider-switching` 已验收 Stub 切换主路径，`su01-lmstudio-disconnected-health` 已验收 LM Studio 未启动断开态，`su01-provider-endpoint-validation` 已验收非法 endpoint 阻断，`su01-provider-model-list-success` 已验收 DeepSeek/Anthropic/LM Studio 模型列表成功管线，`su01-provider-test-failure-ui` 已验收测试连接失败反馈与恢复，`su01-api-key-secret-redaction` 已验收 API Key 配置流脱敏边界；`su01-local-secret-file-roundtrip` 已验收真实 Tauri WebView 保存本地 secret 文件、重启读回与脱敏边界；当前无 SU-01 内必须关闭的 external blocker，P1 仍缺 live vendor/云端供应商真实失败矩阵 |
| 作品空间管理 | 命名新增、切换、重命名、删除或移出作品，保证上下文隔离和恢复策略正确 | SU-02 | 13/13 已验收；当前可进入 SU-03 | 运行时作品菜单、空库自动未命名作品、快速未命名创建、命名新增、改名、安全废弃/移出、leave/join、消息流隔离、慢回复迟到归属、reload 恢复和 artifact/projection/trace 隔离均已有真实 Tauri 证据；后端不可用 UX、恢复/归档管理入口、大列表和异常矩阵为 P2 后续 |
| AI 身份与显示 | 给 AI 起名，且按作品隔离 | SU-03 | 6/6 真实 Tauri 验收；SC-SU03-C2 有 LM Studio payload 证据；当前可进入 AU-01 | 已补 work-scoped UI 显示名、设置/重置、按作品隔离和 provider/prompt/TurnResult 边界；后续只需随工作台重构做回归 |
| 自然创作对话 | 作者能持续自然讨论，不被表单化打断 | AU-01/AU-02 | AU-01: 11/13 有真实页面外部自动化证据，文件级可进入 AU-02；AU-02: 11/12 真实 Tauri checkpoint + D2 schema/codegen 已测试，当前可进入 AU-03 | 普通聊天两轮、空消息 guard、乱码 JSON 友好降级、frame validation 友好错误、TurnResult/recorder/UI 同源对账、provider recovery、模糊创意自然探索且 no-slot-form、真实 LMStudio 中文探索质量、坏候选 fallback UI、候选继续探索、继续讨论后的多轮上下文、候选卡后自由追问、候选 no-MicroPlan、候选采纳桥接、未采纳候选不进阅读/事实和候选 schema/codegen 已有证据；AU-01 剩余 P1 为 trace/replay UI cross-reference，P2 为 no-slot-form UI 反证；AU-02 当前无 P0/P1 剩余 |
| AI 引导式创作会话结构 | AI 每轮基于小说层、当前作品层、本轮引导层组织 message，并结构化判断探索/结构/执行/质量/澄清/确认 | AU-11/VS-00D | AU-11: 文件级可交付，2/4 已验收、2/4 部分实现，P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-12 | 质量诊断三层 envelope 与缺上下文不编造已有真实 Tauri / quality acceptance，二轮 2 个入口均复跑通过；剩余 P1 为 `guidance_mode` schema 冻结、clarify/confirm 引导 proof、prose_writing envelope 投影 |
| 上下文、记忆与作品档案核对 | AI 使用最新作品背景、当前会话、历史会话、记忆、行为上下文，不编造；作者能核对 AI 正在消费的 works 立项事实 | AU-03/AU-09/AU-12 | AU-03: 文件级可交付，12/20 已验收、2/20 已测试、3/20 部分实现、1/20 已实现未验收、1/20 未实现、1/20 不确定，当前可进入 AU-04；AU-09: 文件级可交付，10/14 已验收、1/14 已测试、3/14 部分实现，P0 已关闭，当前可进入 AU-10；AU-12: 文件级可交付，8/11 已验收、1/11 已测试、1/11 部分实现、1/11 未实现，P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 E2E-01 | AU-03 已有新建空白会话、历史会话只读回看、从历史继续创建新 active branch、归档过滤、最新 Work 背景 SSOT、active transcript 分层、上下文来源 UI、长会话压缩和跨作品/记忆分层当前可复跑入口；`AU03-file-level-closure.md` 已补文件级收口记录；`au03-current-work-context-ssot --real-lmstudio` 证明最新 Work 与 active session transcript 进入真实 provider prompt，历史只读 transcript 不替代当前事实；`au03-archive-session-filter` 证明真实工作台归档、默认隐藏 archived、显式搜索回看和普通 context 过滤；剩余 AU-03 P1/P2 为 behavior summary、empty/work-only/failure UI、显式 archived source、AU-07 replay/trace、搜索命中定位和压缩策略细化。AU-09 已把当前 8 个可复跑 Tauri 入口挂入 quality acceptance：`au09-memory-create-recall`、`au09-memory-management-entry`、`au09-memory-trace-roundtrip`、`au09-adopt-setting-recall`、`au09-character-dossier-roundtrip`、`au09-validity-window-recall`、`au09-cross-work-memory-isolation`、`au09-au03-session-memory-layering`；核心 recall、lifecycle、trace、validity、cross-work、session/memory layering 和角色主档案已验收，完整 archive stats、pending inbox、筛选分页矩阵、developer replay、历史旧 turn 查询和独立 MemoryTrace/StateTrace 登记为 P1/P2；AU-12 二轮已复跑 `au12-work-profile-overview` 与 `au12-work-profile-status-isolation`，works 立项概览显示侧、accepted/tentative 状态、空字段、tab 导航、跨作品概览/角色/伏笔/规则隔离、只读 no-write 与 UUID 脱敏均有当前证据；A2 同轮 provider prompt proof 为 P2 加强项，读取失败降级和 correction 修订入口登记为 P1，accepted-artifact / 立项要素深扩展登记为 P2 |
| 执行与确认 | AI 可提计划，系统负责门禁、确认和重审 | AU-04/AU-06 | AU-04: 文件级可交付，10/18 场景有真实 Tauri 验收，5/18 有局部测试，3/18 部分实现，P0 已关闭，2026-06-22 二轮已关闭确认后工具 trace 重复持久化回归，当前可进入 AU-05；AU-06: 文件级可交付，13/17 已验收，4/17 部分实现，P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-07 | `au04-confirm-before-execute` 已证明高风险执行先确认、确认卡说明确认对象/确认前 no-tool/no-write/确认后 re-gate、真实 `author_action`、重新 gate 和 pending artifact；二轮复跑发现并修复 Channel 对已由 application 持久化的 `tool_dispatched` trace 二次落库问题，修复后该入口恢复通过；`au04-confirm-idempotency-ui` 已证明重复确认不重复执行；`au04-stale-confirmation-ui` 已证明当前 turn 推进后旧确认被 stale 拒绝且 no-tool/no-draft；`au04-confirmation-ttl-ui` 已证明 expired confirmation 被拒绝且 no-tool/no-draft；`au04-disabled-confirmation-action-ui` 已证明 disabled confirm 可见但不可提交且 no-author-action/no-tool/no-draft；`au04-history-confirmation-readonly` 已证明历史只读 confirmation 不可执行且 no-action/no-tool/no-draft；`au04-cross-work-confirmation-guard` 已证明跨作品切换后源 confirmation 在目标作品不可见不可执行且 no-action/no-tool/no-draft；`au04-latest-context-rebase-confirmation` 已证明确认前真实改名后 binding/trace 消费最新 Work revision/title；`au04-confirmation-tool-failure-recovery` 已证明确认后工具失败显示失败且无 pending draft / production write；`au10-workbench-recovery-cancel-waiting` 已证明取消等待关闭 active behavior 且可继续下一轮；`au06-single-active-confirmation` 已证明同一 workstream 旧 confirmation 不可执行、最新 confirmation 可执行一次；`au07-behavior-trace-terminal-replay` 已证明取消等待后的 cancelled action turn 记录 terminal BehaviorTrace close/resolution refs。剩余 P1 为 blocking clarification、confirm terminal history/replay、持久 BehaviorBinding ledger、LLM timeout/retry action 和 LongRunner 全矩阵 |
| 创作产物与采纳 | 产出默认草稿，采纳后才进入作品事实 | AU-05 | AU-05: 文件级可交付，15/18 已验收、3/18 部分实现；P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-06 | 候选 adoption boundary、高风险 confirmation、stale rejection、cross-work/canon recovery、artifact accept/discard/edit_then_accept、未采纳/已放弃不进阅读、采纳后 reading projection、StateTrace adoption replay 和设定 recall 均有当前真实 Tauri / quality acceptance 证据；11 个 AU-05 主证据与 cross evidence 已串行复跑通过。剩余 P1/P2 是持久 adoption inbox、ProjectionHint refresh 状态机、完整 replay/旧 turn 查询、canon/revision store 自动计算和人工合并 UX |
| 阅读作品与投影 | 作者能像读一本书一样查看已采纳章节，并知道投影是否过期 | AU-08 | AU-08: 文件级可交付，11/16 已验收、3/16 已实现未验收、2/16 部分实现；P0 已关闭，2026-06-22 二轮已关闭 cross-reference driver 漂移，当前可进入 AU-09 | 采纳正文、编辑后采纳、未采纳不入阅读、跨作品隔离、多章导航、空章诚实显示、短章 audit、导出和 STALE banner 均有当前真实 Tauri / quality acceptance 入口；二轮复跑 5 个 AU-08 本体入口和 3 个 cross evidence 全部通过，并修复 `p1-chapter-draft-generation` 旧文案等待；剩余 projection refresh 专用 action/no-write driver、REBUILDING/FAILED 状态来源、返回工作台上下文、只读 no-write 专项和离线降级登记为 P1 后续 |
| 工作台 UI 与实时反馈 | 看到状态、卡片、候选、action、任务进度 | AU-10 | AU-10: 文件级可交付，14/17 已验收、1/17 已测试、2/17 部分实现；P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-11 | 6 个当前可复跑 AU-10 Tauri 入口已挂入 quality acceptance 并在二轮串行复跑通过，覆盖 1280x800 工作台基线、普通聊天 no-MicroPlan、why、候选授权 action、adoption、reading projection、task_state RUNNING/CHECKPOINT/COMPLETED、不可达 provider、真实 provider timeout、WebSocket service reconnect、取消等待和恢复后继续。剩余完整异步 LongRunner、FAILED task_state 真实页面、全 card/action 深矩阵、projection/trace 深链路和文案/hidden metadata hygiene 登记为 P1/P2 |
| 溯源、回放与运营诊断 | 能解释每轮为什么这样做，断网也能回放 | AU-07/E2E/VS-10 | AU-07: 文件级可交付，9/16 已验收、1/16 已测试、6/16 部分实现；P0 已关闭，2026-06-22 二轮复跑未发现本文件内应关闭的新 P1/P0，当前可进入 AU-08。E2E-01: 文件级可交付 / 二轮已复核，10/13 已验收、2/13 已测试、1/13 部分实现；P0/P1 已关闭，聚合 runner、E4 真实页面 downgrade checkpoint、E6 只读 tool trace checkpoint 与 E9 ReplayReport 六问 checkpoint 已于 2026-06-22 复跑通过；剩余为 E8/E13 P2 Channel security regression | `au07-trace-why-entry` 已恢复为当前可复跑 Tauri / quality 入口；作者 why dialog author-safe、不重调模型、不写生产状态。`au07-state-trace-adoption-replay` 已证明真实工作台保存正文后的 action turn、采纳 resolved entry 与 reading projection 共用可回放 StateTrace refs。`au07-behavior-trace-terminal-replay` 已证明真实工作台 cancel waiting 后的 cancelled action turn 记录 terminal BehaviorTrace close/resolution refs，且 no-provider/no-tool/no-write。`ReplayService` 已支持 Tool/Behavior/State refs 与 missing refs partial，`decision_traces` 已持久化 replay refs；E2E-01 已补 DialogueGateway trace persister → SQLite → `TraceRepository.list_by_turn` integration proof、`e2e-01-full-chain` 聚合 runner、`e2e-01-downgrade-real-page` 真实 Tauri + LM Studio 多步 MicroPlan 降级证据、`e2e-01-readonly-tool-trace` 真实 Tauri + LM Studio 只读角色列表 tool dispatch 与 trace query 证据、`e2e-01-replay-report` 真实 Tauri + LM Studio ReplayReport 六问结构化回放，并在二轮关闭聚合 artifact 的 E12/E13 名称与 E8/E13 remaining gaps 漂移；AU-07 剩余 P1 为旧 turn trace 查询 API/UI、developer 双视图、完整 ToolTrace registry snapshot / redacted I/O、work/session 查询隔离和 reason catalog 深化 |

---

## 3. 场景设计模板

每个新验收 case 必须用同一个结构，避免变成含糊描述。

```text
ID:
名称:
用户视角:
前置条件:
触发:
期望结果:
不变量:
契约:
涉及边界:
真实消费者:
验证方式:
当前证据:
当前状态:
缺口类型:
优先级:
```

`验证方式` 必须优先写真实前端发起路径：作者从哪个界面进入、输入或点击什么、应该看到什么状态变化，以及验证脚本输出到哪个 artifact 目录。若当前只能通过后端/Channel/helper/组件测试验证，`当前状态` 只能写“已测试”“部分实现”或“已实现未验收”，不能写“已验收”。

不算前端发起验证：直接调用后端模块、直接 push Channel payload、只测 socket helper、只测组件 render、只用 mock 文档描述。自动化验证推荐沉淀为 `scripts/slice_verify.sh <slice-id>`，输出截图、日志、网络帧到 `artifacts/slice-verify/<slice-id>/`；接手者可先运行 `bash scripts/slice_verify.sh --list` 查看当前已有场景。

缺口类型只能选：

| 类型 | 含义 |
|---|---|
| 补测试 | 实现大概率存在，但缺自动化证明 |
| 补集成 | 各段存在，但主流程没打通 |
| 补验收 | 自动化有覆盖，但缺真实 UI/LLM/SQLite 走查 |
| 补实现 | 主流程缺关键代码 |
| 修设计偏差 | 实现与 v3 契约/愿景不一致 |
| 文档同步 | 文档覆盖率、状态、路径滞后 |
| 状态核查 | 证据冲突或不足，先核查再下结论 |

---

## 4. 第一批应补的场景族

这些不是新增功能愿望，而是按完整蓝图回看后，最能发现当前不完整实现的场景族。

| 优先级 | 场景族 | 覆盖目标 | 关联文档 | 缺口类型 | 为什么优先 |
|---:|---|---|---|---|---|
| P0 | 作品生命周期管理闭环 | 命名新增作品、修改作品名、安全删除或移出作品、删除当前作品后切换、lastOpened 不恢复已移出作品 | SU-02 | 已闭环/P2 后续 | `su02-work-lifecycle-management` 已证明真实工作台命名新增、改名、安全移出和 fallback；`su02-work-restart-recovery` 已证明 reload 恢复 existing lastOpened，且 stale/discarded lastOpened 回退到真实 Work；恢复/归档管理入口和异常矩阵降为 P2 |
| P0 | 作品切换隔离闭环 | 创建两个作品、切换、发送消息、pending 返回不串作品、重启恢复、artifact/projection/trace 不串作品 | SU-02/AU-03 | 已闭环/P2 后续 | `su02-work-switching` 已证明真实菜单快速创建/切换、leave/join 和消息流不串；`su02-pending-result-work-isolation` 已证明作品 A 慢回复迟到不污染作品 B 且切回 A 可恢复；`su02-work-restart-recovery` 已证明重启恢复最小闭环；`su02-artifact-projection-trace-isolation` 已证明源作品 pending artifact、采纳后 reading projection、目标 why/trace 均按 `work_id` 隔离；角色/统计扩展矩阵降为 P2 |
| P0 | 普通聊天真实工作台闭环 | 打开工作台、输入创作聊天、收到自然回复、不出现执行卡、可继续下一轮 | AU-01/E2E | 已闭环/继续补异常矩阵 | `au01-ordinary-chat-two-turn-roundtrip` 已证明真实 Tauri 两轮普通聊天：user/assistant 顺序可见、thinking 清退、`generate_micro_plan=false`、无 MicroPlan、无 action/candidate/adoption UI；`--real-lmstudio` 证明真实 provider 两轮 form_frame 请求。`au01-empty-message-guard` 已证明空白输入不创建 turn 且后续聊天可恢复。`au01-turnresult-recorder-ui-consistency` 已证明同一 turn 的 UI 文本、websocket TurnResult、interaction recorder transcript 与 reload 恢复 UI 一致。剩余是 trace/replay 作者 UI 和更完整异常恢复矩阵 |
| P1 | LLM 异常降级 UI 闭环 | LM Studio 不可用、返回乱码、超时、恢复后下一轮可继续 | AU-01/E2E | checkpoint closed / 继续补矩阵 | `au10-workbench-recovery-disconnect-timeout` CP1 已证明不可达 provider 后 no-write fallback、loading 清除、恢复 provider 后继续下一轮；`au10-workbench-recovery-provider-timeout` 已证明真实 timeout recovery；`au01-garbage-json-recovery` 已证明返回乱码时友好 fallback、raw payload 不可见且下一轮可继续；`au01-frame-validation-friendly-error` 已证明 forbidden semantics frame 被拦截、UI/turn_result 不泄漏内部 reason 且下一轮可继续。剩余是 replay/trace UI |
| P0 | 确认幂等与重审闭环 | 高风险计划 → 确认 → 重新 gate → 工具执行；确认卡必须解释确认对象、确认前不执行不写入、确认后重审；重复点击不重复执行；旧确认不能跨当前 turn/作品/历史会话执行；确认前上下文变化必须被重新消费；disabled action 不得被提交；确认后工具失败不得半写入；同一 workstream 旧等待态不能和最新等待态同时可执行 | AU-04/AU-06 | AU-04/AU-06 文件级 P0 已关闭；继续补持久 snapshot / confirm replay / LLM timeout / retry action / blocking clarification / LongRunner 矩阵 | `au04-confirm-before-execute` 已关闭高风险确认主路径和确认卡说明内容；`au04-confirm-idempotency-ui` 已证明同一确认动作快速重复点击只执行一次；`au04-stale-confirmation-ui` 已证明 follow-up 推进当前 turn 后旧确认被 stale 拒绝；`au04-confirmation-ttl-ui` 已证明 expired confirmation 被拒绝；`au04-disabled-confirmation-action-ui` 已证明 disabled confirm 可见但不可提交；`au04-history-confirmation-readonly` 已证明历史只读 confirmation 不可执行；`au04-cross-work-confirmation-guard` 已证明跨作品切换后源 confirmation 不泄漏不执行；`au04-latest-context-rebase-confirmation` 已证明确认前真实改名后 binding/trace 消费最新 Work revision/title；`au04-confirmation-tool-failure-recovery` 已证明确认后工具失败 no-draft/no-write；`au06-single-active-confirmation` 已证明同一 workstream 旧 confirmation 不可执行、最新 confirmation 可执行一次；`au07-behavior-trace-terminal-replay` 已证明取消等待终态有 BehaviorTrace close/resolution refs；执行权仍是 v3 核心安全边界，后续补持久 snapshot、confirm replay、LLM timeout、retry action 和 clarification |
| P0 | 候选方向操作闭环 | 模糊输入 → 候选方向 → 可点选继续探索或直接自由追问 → 明确采纳时进入 adoption boundary | AU-02/AU-05/AU-10 | 已闭环 | `au02-candidate-fallback-ui`、`au02-candidate-continuation`、`au02-freeform-followup-after-candidate`、`au02-unadopted-candidate-no-reading-fact` 与 `au02-candidate-adoption-bridge` 已提供真实 Tauri 证据；高风险候选 confirmation checkpoint 见 `au05-adoption-safety-freshness`，stale restored candidate rejection checkpoint 见 `au05-stale-conflict-cross-work-freshness`，cross-work recovery checkpoint 见 `au05-conflict-cross-work-recovery`，canon conflict recovery checkpoint 见 `au05-canon-conflict-recovery` |
| P1 | 记忆召回端到端 | 新建/确认记忆 → 对话引用 → trace 显示引用来源 → 无上下文不编造 | AU-03/AU-09/AU-07 | 补集成 | 记忆是小说长期创作的关键差异点 |
| P0 | AI 引导式创作 message 闭环 | 作者说“这一章不够爽 / 哪里不成立”时，Planner/Provider 调用能重建 NovelLayer / WorkState / TurnGuidance 三层 message，缺上下文不编造，进入重写仍需 Orchestrator | AU-11/VS-00D/AU-07 | P0 closed / P1 后续 | SC-AU11-01 已证明质量诊断三层 envelope 进入真实工作台 trace/why 且 no-write；SC-AU11-02 已证明缺章节/正文/人物状态时 WorkState missing、why 可见、assistant 要求补材料且 no tool/adoption/write；2026-06-22 二轮复跑 2 个 AU-11 quality/Tauri 入口均通过；schema 冻结、clarify/confirm 和 prose_writing 投影为 P1 |
| P0 | 作品内会话管理闭环 | 一个作品下 N 个会话；列表/搜索/归档；历史会话只读；最新作品背景仍生效 | AU-03/SU-02/AU-07 | 已闭环；P1/P2 后续 | `au03-session-new-active` 已证明真实工作台新建空白 active session、旧 active 退出并只读可回看、下一轮消息绑定新 session 且不带旧 transcript；`au03-session-history-readonly` 已证明 exited 历史会话只读回看和返回 active session；`au03-branch-from-history` 已证明历史会话“从这里继续”创建带 source refs 的新 active branch；`au03-archive-session-filter` 已证明归档默认隐藏、显式搜索回看和 ordinary context filter；`au03-current-work-context-ssot --real-lmstudio` 已证明历史会话回看后下一轮仍使用最新 Work 背景和 active transcript。剩余搜索命中定位/高亮、显式 archived source 与完整 replay 降为 P1/P2 owner 后续 |
| P1 | 采纳到阅读投影 | 生成草稿 → 采纳 → projection hint → 阅读模式 TOC/正文刷新 | AU-05/AU-08 | AU-08 文件级可交付/P1 状态机后续 | `p1-chapter-adoption-reading` 与 `p1-chapter-edit-then-accept` 已证明真实采纳/编辑后采纳进入 Reading Projection；`p1-chapter-draft-generation` 与 `au02-unadopted-candidate-no-reading-fact` 覆盖未采纳不入阅读，其中 `p1-chapter-draft-generation` 二轮已修复文案等待漂移并复跑通过；`su02-artifact-projection-trace-isolation` 覆盖跨作品隔离；`p1-chapter-expansion-multichapter` 覆盖多章导航和空章诚实显示；剩余 projection refresh 专用 action、REBUILDING/FAILED 状态来源和 no-write refresh driver 登记为 AU-08 P1 |
| P1 | TaskRunner 长任务实时反馈 | 长耗时任务 RUNNING/CHECKPOINT/COMPLETED/FAILED 真实 streaming 到 UI | AU-10/VS-06+ | checkpoint closed / 异步 LongRunner 延后 | 真实“导出全书”动作已证明同步任务 task_state UI；`04a-planning-and-long-run.md` 已确认异步 LongRunner 缺真实生产消费者，待批量生成/推演成为真实 slice 后再补 |
| P2 | Trace author-safe / developer 双视图 | 作者看中文解释，开发者看完整 trace，敏感字段隔离 | AU-07/VS-10 | 修设计偏差/补深链路 | why 入口已有真实 Tauri 证据；author/developer 边界、redaction 和 replay 聚合仍不完整 |
| P2 | AI 显示名按作品隔离 | 设置 AI 名称、切换作品、默认值、对 LLM 请求无影响 | SU-03 | 已闭环/保持回归 | `su03-assistant-display-name` 已证明默认/设置/切换，并用 `--real-lmstudio` 证明显示名不进入 provider request body |

---

## 5. 场景覆盖对账发现

本轮只基于现有文档与项目台账对账，尚未逐行核对所有实现。

| 发现 | 影响 | 建议 |
|---|---|---|
| SU-01 已按文件级二轮口径重算为 10 个场景 | 9/10 已验收，B3 为部分实现；`su01-provider-test-failure-ui` 已证明测试连接失败反馈、草稿保留、无 turn/runtime 副作用和恢复成功；`su01-local-secret-file-roundtrip` 已证明真实 Tauri WebView 写入 `provider-secrets.json`、0600 权限、重启读回和脱敏边界；旧 Keychain / non-macOS unsupported blocker 已被当前 local-file 设计取代 | 当前可进入 SU-02。进入后保留 live vendor/云端供应商真实失败矩阵作为 B3/P1 后续，Windows/Linux local-file 页面矩阵作为 P2 平台回归 |
| `acceptance/README.md` 的覆盖率和测试计数已滞后 | 新会话会误判完成度 | 下一步先更新 README 总览，改为引用台账和本蓝图 |
| SU-02 已按 2026-06-20 checkout 重算为 13 个场景 | 运行时切换、空库启动未命名作品、作品生命周期、慢回复迟到归属、重启恢复和 artifact/projection/trace 隔离闭环已补，不应继续误判为“没有切换 UI”“不能命名/改名/移出作品”“空库启动会停在 lobby/mock”“pending 迟到一定会串作品”“lastOpened 仍只靠 localStorage”或“artifact/projection/trace 全矩阵未验收” | 当前可进入 SU-03；恢复/归档管理入口、后端不可用 UX、大列表和异常矩阵作为 P2 后续 |
| AU-01 普通聊天主路径、空消息 guard、乱码 JSON recovery、frame validation 友好错误与 recorder/UI 同源对账已按当前 checkout 重算 | `au01-ordinary-chat-two-turn-roundtrip` 已从真实 Tauri 工作台证明两轮自然聊天、可见消息顺序、thinking 清退、no-MicroPlan、无 action/candidate/adoption UI，并有 real LMStudio provider 请求证据；`au01-empty-message-guard` 已证明空白输入不会发送 `user_message` 或追加 DOM 消息，且后续普通聊天可恢复；`au01-garbage-json-recovery` 已证明 malformed provider frame JSON 友好降级、raw payload 不可见并可继续聊天；`au01-frame-validation-friendly-error` 已证明 forbidden semantics frame 被拦截且 UI/turn_result 不泄漏内部 reason；`au01-turnresult-recorder-ui-consistency` 已证明同一 `turn_id` 下 UI、websocket TurnResult、interaction recorder transcript 与 reload 恢复 UI 都使用同一 assistant 文本；不应继续误判为“缺真实工作台 walkthrough”“空消息无真实页面证据”“乱码 JSON 无真实页面证据”“frame validation 无友好错误验收”或“B4 只有局部测试” | 后续 AU-01 优先补 replay/trace UI 和 C3 no-slot-form UI 反证，而不是重复补普通聊天/异常降级/recorder 主路径 |
| AU-10 已完成二轮工作台 UI 链路复核 | 文件级可交付结论不回退：14/17 已验收、1/17 已测试、2/17 部分实现，P0 已关闭。`WorkspaceChat` 是唯一生产工作台入口；2026-06-22 已串行复跑 6 个 AU-10 quality/Tauri 入口；baseline、task_state RUNNING/CHECKPOINT/COMPLETED、provider failure、provider timeout、WebSocket reconnect 和 cancel waiting 均有真实页面证据；FAILED task_state 仍是局部测试；全 card/action、projection/trace 深链路、LongRunner 和 UI hygiene 登记为 P1/P2 | 当前可进入 AU-11；本轮未发现 AU-10 内应关闭的新 P1/P0。LongRunner 待真实批量生成/推演消费者出现后再做；不为验收强造 product hook |
| AU-02 候选方向状态已重算 | backend fallback/real_llm 证据已进入验收文档；模糊创意自然探索/no-slot-form、真实 LMStudio 中文探索质量、坏候选 fallback UI、候选卡点选 continuation、继续讨论后的多轮上下文、候选卡后自由手输追问、未采纳候选不进阅读/事实、采纳桥接、高风险候选 confirmation checkpoint、stale restored candidate rejection checkpoint、cross-work recovery checkpoint、canon conflict recovery checkpoint 和 D2 schema/codegen 回归已闭环；continuation 明确是 `user_message.candidate_selection`，自由追问明确是不带 `candidate_selection` 的普通 `user_message`，都不是 `author_action.choose_candidate` | AU-02 当前可进入 AU-03 |
| AU-06 与 AU-04 都指向确认 lifecycle 缺口 | 重复但合理，说明它是跨文档主风险；当前 P0 runtime safety 已合并闭环 | 后续继续合并追踪 replay、clarification、timeout/retry，不重复补确认主链 |
| AU-04 已按真实工作台入口重算 | `WorkspaceChat` 当前通过服务器 `ui_cards` 展示确认卡、通过 `available_actions` 提交 `author_action`；`au04-confirm-before-execute` 已证明高风险确认主链和确认卡说明内容，且 2026-06-22 二轮已修复确认后工具 trace 重复持久化导致的 quality 回归；`au04-confirm-idempotency-ui` 已证明重复确认不重复执行，`au04-stale-confirmation-ui` 已证明当前 turn 推进后旧确认被 stale 拒绝且 no-tool/no-draft，`au04-confirmation-ttl-ui` 已证明 expired confirmation 被拒绝且 no-tool/no-draft，`au04-disabled-confirmation-action-ui` 已证明 disabled confirmation 可见但不可提交且 no-author-action/no-tool/no-draft，`au04-history-confirmation-readonly` 已证明历史只读 confirmation 不可执行且 no-action/no-tool/no-draft，`au04-cross-work-confirmation-guard` 已证明跨作品切换后源 confirmation 在目标作品不可见不可执行且 no-action/no-tool/no-draft，`au04-latest-context-rebase-confirmation` 已证明确认前真实改名后 binding/trace 消费最新 Work revision/title，`au04-confirmation-tool-failure-recovery` 已证明确认后工具失败显示失败且 no-draft/no-write；`ActionValidator` 已补 `behavior_ref` / `target_ref` / `candidate_*` / `idempotency_key` 与服务端 action 的精确绑定和 `expires_at` 校验；`ConfirmationBinding` 已强制 `rebased_state_snapshot_ref` / `gate_result_refs` 并在 confirmation ack / reason_codes 留下 proof；AU-04 文件级 P0 已关闭，当前可进入 AU-05 | 优先补 action_result 全状态、持久 snapshot、replay、LLM timeout/retry action 和 AU-10 恢复态，而不是重复接旧 helper |
| AU-05 已按真实采纳入口重算 | 前端 accept/discard/edit_then_accept 已通过 `author_action` 接 AdoptionWorkflow，并有真实 Tauri 证据；2026-06-22 二轮已复跑 11 个 AU-05 主证据与 cross evidence，未发现本文件内应关闭的新 P1/P0；旧 direct helper/handler 属兼容债务 | 后续补 persistent adoption inbox、ProjectionHint refresh 状态机、完整 replay/旧 turn 查询、canon/revision store 自动计算和人工合并 UX |
| AU-06 已按真实 lifecycle 重算 | 13/17 已验收、4/17 部分实现，P0 已关闭，2026-06-22 二轮 12 个关联 Tauri / quality 入口复跑通过，当前可进入 AU-07。`BehaviorState.snapshot/1` 与 `WorkspaceChat` active behavior 形状已对齐；confirmation open、confirm/re-gate、cancel、stale、expired、disabled、history readonly、cross-work、idempotency、latest-context rebase、tool failure、single-active runtime safety 与 cancel terminal BehaviorTrace 均有真实 Tauri / quality_accept 证据 | 下一步不重复补确认主链，转 AU-07 trace/replay；AU-06 剩余 P1 是 blocking clarification、confirm terminal history/replay 与持久 BehaviorBinding ledger |
| AU-07 已按真实解释入口、StateTrace producer、Behavior terminal replay 与 E2E replay cross evidence 重算 | `au07-trace-why-entry` 已重新挂回当前 `tauri_slice_verify` / quality manifest 并复跑；`au07-state-trace-adoption-replay` 已证明真实采纳正文 action/projection 共用 StateTrace refs；`au07-behavior-trace-terminal-replay` 已证明 cancel waiting action turn 的 terminal close/resolution refs 可持久化并进入 replay；`e2e-01-readonly-tool-trace` 与 `e2e-01-replay-report` 已以真实 Tauri + real LM Studio 证明只读工具链的 summary-level `tool_trace_refs` 持久回查和 ReplayReport 六问；ReplayService 已补 refs/partial，不再硬编码完整解释；TraceRepository 可持久化 replay refs | AU-07 二轮口径为 9/16 已验收、1/16 已测试、6/16 部分实现；P0 已关闭，当前可进入 AU-08。后续优先补旧 turn trace 查询 API/UI、developer 双视图、完整 ToolTrace registry snapshot / redacted I/O、work/session 查询隔离和 reason catalog 深化 |
| AU-08 已按真实阅读链路重算 | ReadingMode 已能显示采纳后的真实 artifact；`get_toc` / `get_chapter_content` 经 Application/Persistence 读取当前作品已采纳事实；采纳、编辑后采纳、未采纳不入阅读、跨作品隔离、多章导航、空章诚实显示、短章 audit、导出和 STALE banner 已有真实 Tauri / quality acceptance 证据；2026-06-22 二轮修复并复跑 `p1-chapter-draft-generation`，确认待保存 prose 草稿卡真实渲染且未采纳正文不进入 Reading Projection | AU-08 文件级 P0 已关闭，唯一应在本轮关闭的 cross-reference driver 漂移已关闭，当前可进入 AU-09；projection refresh 专用 action/no-write driver、REBUILDING/FAILED 状态来源和失败降级仍作为 P1 后续，不回写成完整状态机已闭环 |
| AU-09 已完成二轮故事设定/记忆链路复核 | 文件级可交付结论不回退：10/14 已验收、1/14 已测试、3/14 部分实现，P0 已关闭。2026-06-22 已串行复跑 8 个当前 quality/Tauri 入口，覆盖记忆创建确认召回、管理入口、生命周期终态排除、lifecycle/reference author-safe trace、伏笔/规则 adoption、角色主档案、有效期窗口、跨作品隔离和 AU-03 会话/记忆分层；历史 `au09-archive-real-data` / `au09-memory-recall-context` 仅作背景，不再作为当前 runnable evidence | 当前可进入 AU-10；本轮未发现 AU-09 内应关闭的新 P1/P0。完整 archive stats、pending inbox、筛选分页真实页面矩阵、developer replay、历史旧 turn 查询和完整独立 MemoryTrace/StateTrace 表继续登记为 P1/P2 后续 |
| 缺少“人工 walkthrough case”标准格式 | 真人走查发现问题难以反哺验收文档 | 增加 walkthrough case 模板，输出场景 ID 和失败证据 |

---

## 6. 建议的整理顺序

不要一次性改完 14 份验收文档。建议按能暴露主流程缺口的顺序推进。

| 顺序 | 工作 | 产物 | 验收方式 |
|---:|---|---|---|
| 1 | 更新 acceptance README 总览 | 覆盖率口径、测试计数、蓝图链接、状态枚举 | 文档 diff 清楚区分“实现/测试/验收” |
| 2 | 重写 SU-02 作品切换与生命周期验收 | 场景化 case + 当前证据 + P0/P1 关闭状态 | 已完成运行时切换对账；空库启动未命名作品、命名新增、改名、删除或移出作品、慢回复迟到归属、重启恢复和 artifact/projection/trace 隔离已补真实 Tauri checkpoint，当前可进入 SU-03；恢复/归档入口、后端不可用 UX 和异常矩阵为 P2 |
| 3 | 更新 AU-02 探索验收 | 候选 fallback、real_llm、候选点选/freeform follow-up/采纳桥接场景 | 已完成滚动对账；候选 fallback UI、候选继续讨论后的多轮上下文、候选卡后自由追问、未采纳阅读/事实、采纳桥接、真实 LMStudio 中文质量和 D2 schema/codegen checkpoint 已补；AU-02 可进入 AU-03 |
| 4 | 合并 AU-04/AU-06 确认 lifecycle P0 | 一个端到端确认幂等/重审场景族 | 已补真实 Tauri / quality_accept 矩阵；剩余为 replay、clarification、timeout/retry 后续 |
| 5 | 建立 walkthrough case 模板 | 每次真人走查能直接生成 acceptance 缺口 | 新增模板并在台账引用 |

---

## 7. 下一步可直接补的验收 Case

建议优先从以下 case 开始补文档和测试，因为它们最容易暴露当前实现缺口。

| ID | 名称 | 最小验证 |
|---|---|---|
| SC-SU02-B3 | 命名新增作品 | 已补：从真实工作台打开作品菜单，输入作品名创建新 Work；成功后切到新 `work_id`，列表显示标题 |
| SC-SU02-B4 | 修改作品名 | 已补：在作品菜单触发重命名；经 `WorkService` 更新 title/revision，顶栏和列表同步，channel work_id 不变 |
| SC-SU02-B5 | 删除或移出作品 | 已补：对当前作品执行二次确认后的安全废弃/移出；删除当前作品后切到另一个真实 Work 或新建未命名 Work；reload 恢复不再打开已移出的 Work；恢复/归档入口和异常矩阵仍待补 |
| SC-AU11-01 | AI 引导质量诊断 | 已补：`au11-quality-diagnosis-message-envelope` 证明输入“这一章不够爽，主角赢得太轻了”后 trace/why 可重建三层 message，assistant 给出具体取舍且 no tool/adoption/write |
| SC-AU11-02 | 缺上下文不编造 | 已补：`au11-missing-workstate-policy` 证明真实工作台空白作品下输入“帮我看看这一章哪里不成立”后，WorkState 显式记录 chapter/prose/character missing，assistant 要求补材料且不声称已读该章，why 显示 missing，no tool/adoption/write |
| SC-AU09-D3 | 会话与记忆来源分层 | 已补：`au09-au03-session-memory-layering` 证明同一作品 active/historical session + confirmed memory 分层，下一轮 context/why 区分 current work、session_transcript 与 governed memory |
| SC-AU01-01 | 普通聊天真实工作台闭环 | 已补：真实 Tauri 工作台两轮普通聊天，收到自然回复，thinking 清退，不出现执行/候选/采纳卡；`--real-lmstudio` 证明真实 provider 两轮请求 |
| SC-AU01-B3 | 空消息不会发送 | 已补：真实 Tauri 工作台空白输入点击发送，不产生 websocket `user_message`，不追加可见消息，不进入 thinking；随后有效普通聊天完成 |
| SC-AU04-A1 | 高风险执行先确认 | 已补：`au04-confirm-before-execute` 证明真实工作台高风险重写先确认，确认前无工具/无写入，确认后重新 gate 并产出待采纳草稿 |
| SC-AU04-E2 | 确认后工具失败恢复 | 已补：`au04-confirmation-tool-failure-recovery` 证明真实工作台确认后 `prose_writing` provider failure 显示失败，且不产生 pending draft 或 production write |
| SC-AU04-01 | 确认幂等 | 同一 `idempotency_key` 重复确认只执行一次 |
| SC-AU02-01 | 候选方向操作闭环 | 输入模糊创意得到候选；点选候选继续探索；明确采纳时进入 adoption boundary |
| SC-AU05-01 | 采纳到阅读投影 | 采纳章节片段后，阅读模式可看到该章节或明确显示 projection 待刷新 |

这些 case 的作用不是证明系统已经可用，而是刻意把当前实现压到完整用户闭环上，暴露不完整处。
