# 场景化验收蓝图 / Scenario Acceptance Blueprint

> 最后更新：2026-05-13
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
| 系统启动与模型配置 | 本地启动后知道 AI 是否可用，可配置/测试供应商 | SU-01 | 0/10 已验收；2/10 有基础设施 | health 基础具备但不返回 model；无供应商切换、Key/endpoint 管理、测试连接 UI |
| 作品空间管理 | 创建、切换、恢复作品，保证上下文隔离 | SU-02 | 0/10 完整验收；5/10 部分/基础设施 | 后端 CRUD、启动去 mock、Channel work_id 透传已推进；运行时切换 UI、rejoin、pending 隔离、跨作品隔离验收不足 |
| AI 身份与显示 | 给 AI 起名，且按作品隔离 | SU-03 | 0/6 已验收；1/6 仅硬编码默认值 | 组件硬编码 “AI”；无设置入口、持久化、按作品隔离和“仅 UI 展示”验收 |
| 自然创作对话 | 作者能持续自然讨论，不被表单化打断 | AU-01/AU-02 | AU-01: 0/13；AU-02: 4/12 已有真实 Tauri 前后端验收 | 普通聊天、候选继续探索和候选采纳桥接已有 Tauri 证据；仍缺完整 AU-01/AU-02 覆盖重算、异常恢复、多轮追问和真实 LLM 质量复验 |
| 上下文与记忆 | AI 使用最新作品背景、当前会话、历史会话、记忆、行为上下文，不编造 | AU-03/AU-09 | AU-03: 0/20 完整前后端验收；5/20 有局部证据；AU-09: 0/14 完整前后端验收；9/14 有局部证据 | 缺作品内会话模型、会话列表/搜索/归档、历史会话只读态；memory_summary/behavior_summary 未接入；记忆管理 API、召回、溯源未闭环 |
| 执行与确认 | AI 可提计划，系统负责门禁、确认和重审 | AU-04/AU-06 | AU-04: 0/18；AU-06: 0/17 完整真实前后端验收 | 后端门禁和 BehaviorState 打开较强；真实入口确认卡/author_action、behavior_state 消费、resolution/history、幂等、TTL、ConfirmationBinding、完整 re-gate lifecycle 不足 |
| 创作产物与采纳 | 产出默认草稿，采纳后才进入作品事实 | AU-05 | AU-05: 0/18 完整真实前后端验收；10/18 有局部证据 | tentative artifact 已测；真实采纳入口、AdoptionBoundary 主流程、StateTrace、持久化待处理箱、采纳到阅读投影链路不足 |
| 阅读作品与投影 | 作者能像读一本书一样查看已采纳章节，并知道投影是否过期 | AU-08 | AU-08: 0/16 完整真实前后端验收；7/16 有局部证据 | ReadingMode 壳、mode、banner 已有；TOC 仍 mock，章节读取缺 Channel handler，采纳到阅读投影和 no-write refresh 未闭环 |
| 工作台 UI 与实时反馈 | 看到状态、卡片、候选、action、任务进度 | AU-10 | AU-10: 0/17 完整真实前后端验收；9/17 有局部证据 | 真实入口 `WorkspaceChat` 与 `WorkbenchV3` v3 消费者分裂；action/task_state/adoption/trace/Playwright/Tauri 合规未闭环 |
| 溯源、回放与运营诊断 | 能解释每轮为什么这样做，断网也能回放 | AU-07/E2E/VS-10 | AU-07: 0/16 完整真实前后端验收；8/16 有局部证据 | Replay no-provider 和 DecisionTrace 持久化已有局部证据；真实 why UI、redaction、author/developer 双视图、ToolTrace/BehaviorTrace/StateTrace replay、完整 6 问题回答不足 |

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
| P0 | 普通聊天真实工作台闭环 | 打开工作台、输入创作聊天、收到自然回复、不出现执行卡、可继续下一轮 | AU-01/E2E | 补验收/修正 | 后端 reply-only 已有证据，但真实入口 `WorkspaceChat` 默认 `generate_micro_plan: true`，可能偏离普通聊天目标 |
| P1 | LLM 异常降级 UI 闭环 | LM Studio 不可用、返回乱码、超时、恢复后下一轮可继续 | AU-01/E2E | 补验收 | 后端 broken provider / garbage JSON 已测，仍缺真实工作台 UI 恢复验收 |
| P0 | 确认幂等与重审闭环 | 高风险计划 → 确认 → 重新 gate → 工具执行；重复点击不重复执行 | AU-04/AU-06 | 补集成/补实现 | 执行权是 v3 核心安全边界 |
| P0 | 候选方向操作闭环 | 模糊输入 → 候选方向 → 点选某方向继续探索 → 明确采纳时进入 adoption boundary | AU-02/AU-05/AU-10 | 已闭环 | `au02-candidate-continuation` 与 `au02-candidate-adoption-bridge` 已提供真实 Tauri 证据；高风险候选 confirmation checkpoint 见 `au05-adoption-safety-freshness`，stale restored candidate rejection checkpoint 见 `au05-stale-conflict-cross-work-freshness`，cross-work recovery checkpoint 见 `au05-conflict-cross-work-recovery`，canon conflict recovery checkpoint 见 `au05-canon-conflict-recovery` |
| P1 | 记忆召回端到端 | 新建/确认记忆 → 对话引用 → trace 显示引用来源 → 无上下文不编造 | AU-03/AU-09/AU-07 | 补集成 | 记忆是小说长期创作的关键差异点 |
| P0 | 作品内会话管理闭环 | 一个作品下 N 个会话；列表/搜索/归档；历史会话只读；最新作品背景仍生效 | AU-03/SU-02/AU-07 | 新增/补集成 | 作品长期创作不能只有一条无限聊天流；会话和作品背景分层是上下文正确性的基础 |
| P1 | 采纳到阅读投影 | 生成草稿 → 采纳 → projection hint → 阅读模式 TOC/正文刷新 | AU-05/AU-08 | 补集成 | 连接“生成内容”与“作品可读”，验证作品产物流 |
| P1 | TaskRunner 长任务实时反馈 | 长耗时任务 RUNNING/CHECKPOINT/COMPLETED/FAILED 真实 streaming 到 UI | AU-10/VS-06+ | 补集成 | 当前只有同步工具最小 task_state，不能代表完整长任务 |
| P2 | Trace author-safe / developer 双视图 | 作者看中文解释，开发者看完整 trace，敏感字段隔离 | AU-07/VS-10 | 修设计偏差 | 透明度能力已部分实现，但视图边界不清 |
| P2 | AI 显示名按作品隔离 | 设置 AI 名称、切换作品、默认值、对 LLM 请求无影响 | SU-03 | 补实现/补验收 | 体验增强，不阻塞主链；需避免把显示名混入 provider/model/prompt 语义 |

---

## 5. 场景覆盖对账发现

本轮只基于现有文档与项目台账对账，尚未逐行核对所有实现。

| 发现 | 影响 | 建议 |
|---|---|---|
| SU-01 原标 22%，场景化对账后应改为 0/10 已验收 | “能看 health”容易被误判为“可切换供应商” | 先补 health model/error 测试，再设计运行时 provider config |
| `acceptance/README.md` 的覆盖率和测试计数已滞后 | 新会话会误判完成度 | 下一步先更新 README 总览，改为引用台账和本蓝图 |
| SU-02 已按 VS-09 证据重算为 10 个场景、0/10 完整端到端验收 | 已推进的 CRUD/启动接入不会再被误判为未开始，但切换闭环风险仍突出 | 下一步按 SU02-GAP-01~04 补运行时切换和隔离验收 |
| AU-10 已按真实工作台 UI 链路重算 | `WorkspaceChat` 是真实入口；普通聊天、候选继续探索、候选授权采纳已有真实 Tauri 证据；确认 lifecycle、projection refresh、错误恢复仍未综合闭环 | AU-10 后续应与 AU-04/AU-05/AU-08 合并成“真实工作台主入口统一 v3 action/task_state/adoption/projection”承重 slice |
| AU-02 候选方向状态已重算 | backend fallback/real_llm 证据已进入验收文档；候选卡点选、采纳桥接、高风险候选 confirmation checkpoint、stale restored candidate rejection checkpoint、cross-work recovery checkpoint 和 canon conflict recovery checkpoint 已闭环 | 下一步转向 P1 长篇产出主链：章节计划最小闭环 |
| AU-06 与 AU-04 都指向确认 lifecycle 缺口 | 重复但合理，说明它是跨文档主风险 | 建议合并为一个 P0 场景族追踪 |
| AU-04 已按真实工作台入口重算 | `WorkspaceChat` 调旧 confirm/reject 事件，后端实现 `author_action`，说明“后端测试通过”不能等同“作者可确认执行” | 优先把 AU-04/AU-06 合并为真实确认闭环 slice |
| AU-05 已按真实采纳入口重算 | 前端会 push `adopt` / `discard` / `modify_draft`，但当前 Channel 无对应 handler；`AdoptionBoundary` 仍是纯规则，未接作品事实和阅读投影 | 优先把“生成草稿 -> 采纳 -> 作品档案/阅读投影”作为跨 AU-05/AU-08 的 P0/P1 验收链路 |
| AU-06 已按真实 lifecycle 重算 | `BehaviorState` 可打开，但真实入口 `WorkspaceChat` 期望 `behavior_state.active`，后端 v3 输出扁平结构；resolution/history/TTL/replay 未闭环 | AU-04/AU-06 应合并为一个 confirmation/behavior lifecycle 承重 slice |
| AU-07 已按真实解释入口重算 | ReplayService no-provider 已测，TraceRepository 可存 DecisionTrace；但前端无 why 入口，redaction engine、双视图、Tool/Behavior/StateTrace 聚合缺失 | trace/replay 应服务作者解释和开发者诊断两个视图，不能只停留在结构测试 |
| AU-08 已按真实阅读链路重算 | `ReadingMode` 前端壳存在，但 `get_toc` 是固定 mock，`get_chapter_content` 无 Channel handler，ProjectionHint 未转 `projection_refs` | AU-05/AU-08 应合并验证“生成草稿 -> 采纳 -> 阅读投影 -> 只读刷新” |
| AU-09 已按真实故事设定/记忆链路重算 | `MemoryItem` schema、Phase 0 管理组件、reference log helper、`memory_summary` 字段存在；但 Router 无 memory API，档案 Channel handler 返回 mock，真实 fetcher 返回 memory nil | AU-09 应与 AU-03/AU-07 合并验证“新建/确认记忆 -> 召回进 context/prompt -> trace 显示引用来源 -> 历史会话不覆盖最新 Work 背景” |
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
| SC-SU02-01 | 双作品上下文隔离 | 创建 A/B；A 中写角色名；切 B 后问“主角是谁”不得引用 A |
| SC-AU01-01 | 普通聊天真实工作台闭环 | 打开工作台；发送普通创作聊天；收到自然回复；不出现执行/采纳卡；可继续下一轮 |
| SC-AU04-01 | 确认幂等 | 同一 `idempotency_key` 重复确认只执行一次 |
| SC-AU02-01 | 候选方向操作闭环 | 输入模糊创意得到候选；点选候选继续探索；明确采纳时进入 adoption boundary |
| SC-AU05-01 | 采纳到阅读投影 | 采纳章节片段后，阅读模式可看到该章节或明确显示 projection 待刷新 |

这些 case 的作用不是证明系统已经可用，而是刻意把当前实现压到完整用户闭环上，暴露不完整处。
