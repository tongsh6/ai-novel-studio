# 场景化验收蓝图 / Scenario Acceptance Blueprint

> 最后更新：2026-06-18
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
| 系统启动与模型配置 | 本地启动后知道 AI 是否可用，可配置/测试供应商 | SU-01 | 6/10 最小真实 Tauri 证据；3/10 已实现但缺真实桌面矩阵 | DeepSeek、运行时切换 API、供应商实时模型列表、工作台模型设置 UI、Tauri 偏好/Keychain、provider/model 审计日志已实现；`su01-model-provider-switching` 已验收 Stub 切换主路径，仍缺 API Key/endpoint/DeepSeek/LM Studio 异常矩阵和跨平台 secret 策略 |
| 作品空间管理 | 创建、切换、恢复作品，保证上下文隔离 | SU-02 | 0/10 完整验收；5/10 部分/基础设施 | 后端 CRUD、启动去 mock、Channel work_id 透传已推进；运行时切换 UI、rejoin、pending 隔离、跨作品隔离验收不足 |
| AI 身份与显示 | 给 AI 起名，且按作品隔离 | SU-03 | 0/6 已验收；1/6 仅硬编码默认值 | 组件硬编码 “AI”；无设置入口、持久化、按作品隔离和“仅 UI 展示”验收 |
| 自然创作对话 | 作者能持续自然讨论，不被表单化打断 | AU-01/AU-02 | AU-01: 0/13；AU-02: 4/12 已有真实 Tauri 前后端验收 | 普通聊天、候选继续探索和候选采纳桥接已有 Tauri 证据；仍缺完整 AU-01/AU-02 覆盖重算、异常恢复、多轮追问和真实 LLM 质量复验 |
| AI 引导式创作会话结构 | AI 每轮基于小说层、当前作品层、本轮引导层组织 message，并结构化判断探索/结构/执行/质量/澄清/确认 | AU-11/VS-00D | AU-11: SC-AU11-01 checkpoint closed；0/4 完整验收 | 质量诊断最小 trace proof 已补；仍缺缺上下文真实验收、guidance_mode schema 冻结、clarify/confirm 和 prose_writing envelope proof |
| 上下文、记忆与作品档案核对 | AI 使用最新作品背景、当前会话、历史会话、记忆、行为上下文，不编造；作者能核对 AI 正在消费的 works 立项事实 | AU-03/AU-09/AU-12 | AU-03: 0/20 完整前后端验收；5/20 有局部证据；AU-09: 0/14 完整前后端验收；13/14 最小真实前端闭环，14/14 有局部证据；AU-12: 5/11 最小真实 Tauri checkpoint | 缺作品内会话完整管理矩阵；AU09 archive memory roundtrip CP2 已证明 `foreshadowing_seed` / `*_rule_seed` artifact 采纳后按语义进入伏笔/规则 governed memory、tab 可见并可召回；`au09-memory-management-entry` 已证明正式记忆管理入口和基础生命周期治理；`au09-memory-trace-roundtrip` 已证明 lifecycle/reference author-safe 追溯、locked guard 和 terminal 排除解释；`au09-validity-window-recall` 已证明有效期窗口参与普通 recall；`au09-cross-work-memory-isolation` 已证明真实工作台跨作品切换后档案、记忆页、recall 和 why 不串作品；`au09-au03-session-memory-layering` 已证明同一作品内 active/historical session 与 governed memory 在 context/why 中分层且不互相伪装；AU-12 已补 works 立项概览 CP1，但 accepted-artifact 类立项要素、缺字段/失败、跨作品矩阵和 correction 修订入口仍缺 |
| 执行与确认 | AI 可提计划，系统负责门禁、确认和重审 | AU-04/AU-06 | AU-04: 0/18；AU-06: 0/17 完整真实前后端验收 | 后端门禁和 BehaviorState 打开较强；真实入口确认卡/author_action、behavior_state 消费、resolution/history、幂等、TTL、ConfirmationBinding、完整 re-gate lifecycle 不足 |
| 创作产物与采纳 | 产出默认草稿，采纳后才进入作品事实 | AU-05 | AU-05: 0/18 完整真实前后端验收；采纳/放弃/修改后采用已有最小真实 Tauri 闭环 | 真实采纳入口已接 AdoptionWorkflow；StateTrace、revision/workbox、freshness/conflict 完整矩阵仍不足 |
| 阅读作品与投影 | 作者能像读一本书一样查看已采纳章节，并知道投影是否过期 | AU-08 | AU-08: 0/16 完整真实前后端验收；采纳到阅读投影已有最小真实 Tauri 闭环 | ReadingMode 可显示已采纳 artifact；projection job、stale/rebuild、跨作品隔离和 no-write refresh 未闭环 |
| 工作台 UI 与实时反馈 | 看到状态、卡片、候选、action、任务进度 | AU-10 | AU-10: 完整工作台矩阵未闭环；baseline matrix、task_state checkpoint 与 provider failure recovery CP1 已有真实 Tauri 证据 | `WorkspaceChat` 是唯一生产工作台入口并已接 action/adoption/trace/projection 分散证据；缺 WebSocket 断线、真实 timeout、取消等待、完整异步 LongRunner、全 action/card 和验收卫生 |
| 溯源、回放与运营诊断 | 能解释每轮为什么这样做，断网也能回放 | AU-07/E2E/VS-10 | AU-07: 0/16 完整真实前后端验收；why 入口已有最小真实 Tauri 闭环 | 作者 why dialog 已接真实入口；redaction、developer view、Tool/Behavior/StateTrace replay、完整 6 问题回答不足 |

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
| P0 | 作品切换隔离闭环 | 创建两个作品、切换、发送消息、pending 返回不串作品、重启恢复 | SU-02/AU-03 | 补集成 | 作品是小说工作台的基本边界；串作品会污染上下文和产物 |
| P0 | 普通聊天真实工作台闭环 | 打开工作台、输入创作聊天、收到自然回复、不出现执行卡、可继续下一轮 | AU-01/E2E | 已有最小闭环/继续补矩阵 | `generate_micro_plan=false` 默认和两轮普通聊天已有 deterministic + LMStudio Tauri 证据；剩余是异常恢复、DOM 反馈细节和 AU-10 matrix 归并 |
| P1 | LLM 异常降级 UI 闭环 | LM Studio 不可用、返回乱码、超时、恢复后下一轮可继续 | AU-01/E2E | checkpoint closed / 继续补矩阵 | `au10-workbench-recovery-disconnect-timeout` CP1 已证明不可达 provider 后 no-write fallback、loading 清除、恢复 provider 后继续下一轮；返回乱码、真实 timeout 和更多 UI 矩阵仍缺 |
| P0 | 确认幂等与重审闭环 | 高风险计划 → 确认 → 重新 gate → 工具执行；重复点击不重复执行 | AU-04/AU-06 | 补集成/补实现 | 执行权是 v3 核心安全边界 |
| P0 | 候选方向操作闭环 | 模糊输入 → 候选方向 → 点选某方向继续探索 → 明确采纳时进入 adoption boundary | AU-02/AU-05/AU-10 | 已闭环 | `au02-candidate-continuation` 与 `au02-candidate-adoption-bridge` 已提供真实 Tauri 证据；高风险候选 confirmation checkpoint 见 `au05-adoption-safety-freshness`，stale restored candidate rejection checkpoint 见 `au05-stale-conflict-cross-work-freshness`，cross-work recovery checkpoint 见 `au05-conflict-cross-work-recovery`，canon conflict recovery checkpoint 见 `au05-canon-conflict-recovery` |
| P1 | 记忆召回端到端 | 新建/确认记忆 → 对话引用 → trace 显示引用来源 → 无上下文不编造 | AU-03/AU-09/AU-07 | 补集成 | 记忆是小说长期创作的关键差异点 |
| P0 | AI 引导式创作 message 闭环 | 作者说“这一章不够爽”时，Planner/Provider 调用能重建 NovelLayer / WorkState / TurnGuidance 三层 message，缺上下文不编造，进入重写仍需 Orchestrator | AU-11/VS-00D/AU-07 | checkpoint closed / 继续补矩阵 | SC-AU11-01 已证明质量诊断三层 envelope 进入真实工作台 trace/why 且 no-write；下一步补缺上下文真实验收、schema 冻结和 prose_writing 投影 |
| P0 | 作品内会话管理闭环 | 一个作品下 N 个会话；列表/搜索/归档；历史会话只读；最新作品背景仍生效 | AU-03/SU-02/AU-07 | 新增/补集成 | 作品长期创作不能只有一条无限聊天流；会话和作品背景分层是上下文正确性的基础 |
| P1 | 采纳到阅读投影 | 生成草稿 → 采纳 → projection hint → 阅读模式 TOC/正文刷新 | AU-05/AU-08 | 已有最小闭环/继续补完整投影 | `au08-adoption-reading-projection` 已证明采纳后正文可读；剩余 projection job/stale/rebuild/cross-work/no-write |
| P1 | TaskRunner 长任务实时反馈 | 长耗时任务 RUNNING/CHECKPOINT/COMPLETED/FAILED 真实 streaming 到 UI | AU-10/VS-06+ | checkpoint closed / 异步 LongRunner 延后 | 真实“导出全书”动作已证明同步任务 task_state UI；`04a-planning-and-long-run.md` 已确认异步 LongRunner 缺真实生产消费者，待批量生成/推演成为真实 slice 后再补 |
| P2 | Trace author-safe / developer 双视图 | 作者看中文解释，开发者看完整 trace，敏感字段隔离 | AU-07/VS-10 | 修设计偏差/补深链路 | why 入口已有真实 Tauri 证据；author/developer 边界、redaction 和 replay 聚合仍不完整 |
| P2 | AI 显示名按作品隔离 | 设置 AI 名称、切换作品、默认值、对 LLM 请求无影响 | SU-03 | 补实现/补验收 | 体验增强，不阻塞主链；需避免把显示名混入 provider/model/prompt 语义 |

---

## 5. 场景覆盖对账发现

本轮只基于现有文档与项目台账对账，尚未逐行核对所有实现。

| 发现 | 影响 | 建议 |
|---|---|---|
| SU-01 原标 22%，场景化对账后应改为 0/10 已验收 | “能看 health”容易被误判为“可切换供应商” | 先补 health model/error 测试，再设计运行时 provider config |
| `acceptance/README.md` 的覆盖率和测试计数已滞后 | 新会话会误判完成度 | 下一步先更新 README 总览，改为引用台账和本蓝图 |
| SU-02 已按 VS-09 证据重算为 10 个场景、0/10 完整端到端验收 | 已推进的 CRUD/启动接入不会再被误判为未开始，但切换闭环风险仍突出 | 下一步按 SU02-GAP-01~04 补运行时切换和隔离验收 |
| AU-10 已按真实工作台 UI 链路重算 | `WorkspaceChat` 是唯一生产工作台入口；`历史旁路工作台` / `历史旁路 socket helper` 旁路已退役删除；provider health、普通聊天、候选、授权 action、adoption、trace/why、reading projection、MicroPlan/no-MicroPlan 已有分散真实 Tauri 证据；baseline matrix、真实导出 task_state checkpoint、provider failure recovery、WebSocket 断线、真实 timeout、取消等待均有 checkpoint；完整异步 LongRunner 和全 action/card 仍未综合闭环 | LongRunner 待真实批量生成/推演消费者出现后再做；短期继续铺有真实入口的 AU-09/AU-12 等产品功能广度 |
| AU-02 候选方向状态已重算 | backend fallback/real_llm 证据已进入验收文档；候选卡点选、采纳桥接、高风险候选 confirmation checkpoint、stale restored candidate rejection checkpoint、cross-work recovery checkpoint 和 canon conflict recovery checkpoint 已闭环 | 下一步转向 P1 长篇产出主链：章节计划最小闭环 |
| AU-06 与 AU-04 都指向确认 lifecycle 缺口 | 重复但合理，说明它是跨文档主风险 | 建议合并为一个 P0 场景族追踪 |
| AU-04 已按真实工作台入口重算 | `WorkspaceChat` 当前通过服务器 `available_actions` 提交 `author_action`；确认、候选和采纳相关动作已有多条真实 Tauri checkpoint | 优先补 action_result 全状态、stale/idempotency/disabled UI 和 AU-10 恢复态，而不是重复接旧 helper |
| AU-05 已按真实采纳入口重算 | 前端 accept/discard/edit_then_accept 已通过 `author_action` 接 AdoptionWorkflow，并有真实 Tauri 证据；旧 direct helper/handler 属兼容债务 | 后续补 StateTrace/revision/workbox、freshness/conflict 和完整 projection 矩阵 |
| AU-06 已按真实 lifecycle 重算 | `BehaviorState` 可打开，但真实入口 `WorkspaceChat` 期望 `behavior_state.active`，后端 v3 输出扁平结构；resolution/history/TTL/replay 未闭环 | AU-04/AU-06 应合并为一个 confirmation/behavior lifecycle 承重 slice |
| AU-07 已按真实解释入口重算 | ReplayService no-provider 已测，TraceRepository 可存 DecisionTrace；真实工作台 why 入口已有 `au07-trace-why-entry` 证据；redaction engine、双视图、Tool/Behavior/StateTrace 聚合仍缺 | trace/replay 应服务作者解释和开发者诊断两个视图，不能只停留在结构测试 |
| AU-08 已按真实阅读链路重算 | ReadingMode 已能显示采纳后的真实 artifact；完整 TOC/章节矩阵、projection job/stale/rebuild、跨作品隔离和 no-write refresh 仍缺 | AU-05/AU-08 后续验证应从最小 adoption-reading 升级为完整投影状态机 |
| AU-09 已按真实故事设定/记忆链路重算 | `MemoryItem` schema、REST 管理入口、Phase 0 管理组件、reference log helper、`memory_summary` 字段、真实档案 Channel read model、记忆召回、why 来源、`foreshadowing_seed / *_rule_seed artifact -> governed memory -> 伏笔/规则 tab -> recall`、正式工作台记忆管理入口、基础生命周期治理、lifecycle/reference author-safe 追溯、有效期窗口 recall、跨作品记忆隔离和 AU-03 会话/记忆分层均已有 checkpoint；Channel 管理入口、developer replay、历史旧 turn 查询和完整独立 trace 表仍未完整闭环 | 下一步按 `tasks/NEXT.md` 转向 AU11 / VS-00D，补 AI 引导式创作三层 message 的真实工作台 trace proof |
| 缺少“人工 walkthrough case”标准格式 | 真人走查发现问题难以反哺验收文档 | 增加 walkthrough case 模板，输出场景 ID 和失败证据 |

---

## 6. 建议的整理顺序

不要一次性改完 14 份验收文档。建议按能暴露主流程缺口的顺序推进。

| 顺序 | 工作 | 产物 | 验收方式 |
|---:|---|---|---|
| 1 | 更新 acceptance README 总览 | 覆盖率口径、测试计数、蓝图链接、状态枚举 | 文档 diff 清楚区分“实现/测试/验收” |
| 2 | 重写 SU-02 作品切换验收 | 场景化 case + 当前证据 + P0 缺口 | 已完成首轮对账，后续进入 SU-03 |
| 3 | 更新 AU-02 探索验收 | 候选 fallback、real_llm、候选点选/采纳桥接场景 | 已完成首轮对账，后续进入 AU-03 |
| 4 | 合并 AU-04/AU-06 确认 lifecycle P0 | 一个端到端确认幂等/重审场景族 | 先写验收，再决定实现 slice |
| 5 | 建立 walkthrough case 模板 | 每次真人走查能直接生成 acceptance 缺口 | 新增模板并在台账引用 |

---

## 7. 下一步可直接补的验收 Case

建议优先从以下 5 个 case 开始补文档和测试，因为它们最容易暴露当前实现缺口。

| ID | 名称 | 最小验证 |
|---|---|---|
| SC-AU11-01 | AI 引导质量诊断 | 已补：`au11-quality-diagnosis-message-envelope` 证明输入“这一章不够爽，主角赢得太轻了”后 trace/why 可重建三层 message，assistant 给出具体取舍且 no tool/adoption/write；缺上下文真实工作台验收仍待后续 |
| SC-AU09-D3 | 会话与记忆来源分层 | 已补：`au09-au03-session-memory-layering` 证明同一作品 active/historical session + confirmed memory 分层，下一轮 context/why 区分 current work、session_transcript 与 governed memory |
| SC-AU01-01 | 普通聊天真实工作台闭环 | 打开工作台；发送普通创作聊天；收到自然回复；不出现执行/采纳卡；可继续下一轮 |
| SC-AU04-01 | 确认幂等 | 同一 `idempotency_key` 重复确认只执行一次 |
| SC-AU02-01 | 候选方向操作闭环 | 输入模糊创意得到候选；点选候选继续探索；明确采纳时进入 adoption boundary |
| SC-AU05-01 | 采纳到阅读投影 | 采纳章节片段后，阅读模式可看到该章节或明确显示 projection 待刷新 |

这些 case 的作用不是证明系统已经可用，而是刻意把当前实现压到完整用户闭环上，暴露不完整处。
