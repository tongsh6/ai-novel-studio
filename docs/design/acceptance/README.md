# v3 验收场景全景

> 最后更新：2026-06-18
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
| [E2E-01](e2e/E2E-01-full-chain.md) | 用真实 LLM / SQLite / Channel 证明主链端到端路径 | 11/13 完整 + 2/13 部分 |

### 系统用户验收（3 文档）

| 文档 | 能力 | 场景 | 覆盖率 | 状态 |
|------|------|------|--------|------|
| [SU-01](system/SU-01-model-provider.md) | 切换模型供应商 | 10 | 6/10 最小真实 Tauri 证据；3/10 已实现但缺真实桌面矩阵 | DeepSeek、运行时切换 API、供应商实时模型列表、工作台模型设置 UI、Tauri 偏好/Keychain、provider/model 审计日志已实现；`su01-model-provider-switching` 已验收 Stub 切换主路径，仍缺 API Key/endpoint/DeepSeek/LM Studio 异常矩阵 |
| [SU-02](system/SU-02-work-switching.md) | 切换作品 | 10 | 0/10 完整端到端验收；5/10 部分/基础设施 | VS-09 CRUD/启动接入已推进，切换闭环未验收 |
| [SU-03](system/SU-03-model-nickname.md) | 给模型起名 | 6 | 5/6 最小真实前端验收；1/6 部分 | work-scoped UI 显示名已补，真实 LLM payload 不变缺独立日志证据 |

### 作者用户验收（12 文档）

| 文档 | 能力 | 场景 | 覆盖率 | 状态 |
|------|------|------|--------|------|
| [AU-01](author/AU-01-chat.md) | 与 AI 聊创作 | 13 | 0/13 完整前后端验收；9/13 有局部证据 | 后端/Channel 主链较强，真实工作台验收不足 |
| [AU-02](author/AU-02-explore.md) | 探索创作方向 | 12 | 4/12 已有真实 Tauri 前后端验收；6/12 有局部证据 | 候选生成、继续探索、明确采纳桥接已补；多轮追问、异常恢复、真实 LLM 质量和未采纳反证仍缺 |
| [AU-03](author/AU-03-context.md) | AI 了解我的作品 | 20 | 0/20 完整前后端验收；5/20 有局部证据 | 缺作品内会话模型与最新作品背景闭环 |
| [AU-04](author/AU-04-execute-and-confirm.md) | 执行任务与确认 | 18 | 0/18 完整真实前后端验收；11/18 有局部证据 | 后端门禁较强，真实确认卡/author_action/幂等闭环不足 |
| [AU-05](author/AU-05-artifact-adoption.md) | 采纳创作产物 | 18 | 0/18 完整真实前后端验收；采纳/放弃/修改后采用与采纳后阅读投影已有最小真实 Tauri 闭环 | 真实采纳入口已接主链；StateTrace、revision/workbox、完整 freshness/conflict 矩阵仍缺 |
| [AU-06](author/AU-06-behavior-lifecycle.md) | 行为生命周期 | 17 | 0/17 完整真实前后端验收；6/17 有局部证据 | 打开行为已部分实现，resolution/history/TTL/replay 未闭环 |
| [AU-07](author/AU-07-trace-and-replay.md) | 决策溯源透明度 | 16 | 0/16 完整真实前后端验收；why 入口已有最小真实 Tauri 闭环 | 作者 why dialog 已能从真实工作台打开；redaction、developer view、多 trace replay 和持久化查询仍缺 |
| [AU-08](author/AU-08-reading-mode.md) | 阅读我的作品 | 16 | 0/16 完整真实前后端验收；采纳到阅读投影已有最小真实 Tauri 闭环 | ReadingMode 已能显示已采纳 artifact；projection job、stale/rebuild、跨作品隔离和 no-write refresh 仍缺 |
| [AU-09](author/AU-09-story-memory.md) | 管理故事设定 | 14 | 0/14 完整真实前后端验收；13/14 有最小真实前端闭环；14/14 有局部证据 | 作品档案固定 mock 已移除并接真实 archive 读模型；角色主档案 CP1、伏笔/规则 adoption roundtrip CP2、正式记忆管理入口、基础生命周期治理、lifecycle/reference author-safe 追溯、有效期窗口召回、跨作品记忆隔离与 AU-03 会话/记忆分层均有真实 Tauri 证据。`world_building` 仍是工具能力名，但伏笔/规则使用 `foreshadowing_seed` / `*_rule_seed` 显式 artifact type，采纳后按 `FORESHADOWING` / `WORLD_RULE` 等治理类型归类；`world_setting` 只保留普通世界观设定和历史兼容。剩余完整独立 MemoryTrace/StateTrace 表、developer replay、Channel 管理入口和历史旧 turn 查询未闭环。 |
| [AU-10](author/AU-10-workbench-ui.md) | 工作台实时交互 | 17 | 完整 AU-10 工作台矩阵未闭环；baseline matrix、task_state checkpoint 与 provider failure recovery CP1 已有真实 Tauri 证据 | provider health、普通聊天、候选、action、adoption、trace/why、reading projection、MicroPlan/no-MicroPlan 已有分散证据；WebSocket 断线、真实 timeout、取消等待、完整异步 LongRunner、全 action/card 和验收卫生未闭环 |
| [AU-11](author/AU-11-ai-guided-authoring.md) | AI 引导式创作会话结构 | 4 | SC-AU11-01 checkpoint closed；0/4 完整验收 | VS-00D 三层 message 已进入 Planner 质量诊断 trace proof；仍需缺上下文真实验收、guidance_mode schema 冻结、clarify/confirm 和 prose_writing envelope proof |
| [AU-12](author/AU-12-work-profile.md) | 查看与核对作品档案 | 11 | 5/11 最小真实 Tauri checkpoint；3/11 部分 | 首个切面 `AU12-work-profile-overview` 已闭环：真实工作台作品档案「概览」可显示 works 立项字段，DTO/UI/业务日志不泄漏内部 Work UUID；accepted 状态、缺字段/失败、跨作品矩阵、no-write 计数和 correction 修订入口仍待后续 |

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

> AU-12（作品档案）已有 CP1 真实 Tauri 证据：AU12-I1 单一事实源、AU12-I3 不泄漏内部 id 在 works 立项字段只读查看链路上已验证；AU12-I2 只读 no-write 目前只到 UI/路径层部分证据，AU12-I7 correction intent 尚未实现。系统 15 不变量矩阵暂不扩列，等 AU12 后续 CP2/CP3 补齐后再整体重算。

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
| 普通聊天真实工作台验收 | AU-01 AU01-GAP-01 | 补验收 | P0 |
| 普通聊天误触发 MicroPlan 风险 | AU-01 AU01-GAP-02 | 修正/补验收 | P0 |
| 聊天异常与降级 UI 体验 | AU-01 AU01-GAP-03~05 | 补集成/补验收 | P1 |
| 候选卡点选继续探索 | AU-02 AU02-GAP-01 | 已闭环：`au02-candidate-continuation` | closed |
| 候选采纳桥接 adoption boundary | AU-02 AU02-GAP-02 | 已闭环：`au02-candidate-adoption-bridge` | closed |
| 探索阶段真实入口与多轮体验 | AU-02 AU02-GAP-03~07 | 修正/补验收 | P0/P1 |
| 作品内会话模型与管理 | AU-03 AU03-GAP-01~03 | 新增/补集成 | P0 |
| 最新作品背景接入 context | AU-03 AU03-GAP-04 | 修正/补集成 | P0 |
| 记忆/行为/来源摘要上下文 | AU-03 AU03-GAP-05~10 | 补集成/补验收 | P1/P2 |
| 真实入口确认动作接入 `author_action` | AU-04 AU04-GAP-01~02 | 修设计偏差/补集成 | P0 |
| 确认幂等、Binding、取消 lifecycle | AU-04 AU04-GAP-03~06 | 补实现/补测试/补验收 | P0 |
| 确认后任务反馈、真值文案、失败恢复 | AU-04 AU04-GAP-07~09 | 补集成/补测试/补验收 | P1 |
| 真实采纳入口与 AdoptionBoundary 主流程 | AU-05 AU05-GAP-01~02 | accept/discard/edit_then_accept 最小闭环已补；完整语义矩阵待补 | P0 |
| StateTrace、持久化待处理箱、selection/adoption 桥接 | AU-05 AU05-GAP-03~05 | selection/adoption 桥接已有 checkpoint；StateTrace/revision/workbox 待补 | P0 |
| freshness/conflict/cross-work 与高风险确认 | AU-05 AU05-GAP-06~07 | 高风险 confirmation、stale restored candidate rejection、cross-work recovery 与 canon conflict recovery checkpoint 已闭环；完整 context version/revision freshness、覆盖确认和 StateTrace 仍待补齐 | P0 |
| ProjectionHint、修改/放弃、truthfulness、真实档案/阅读 | AU-05 AU05-GAP-08~11 | 修改/放弃与采纳后阅读最小闭环已补；truthfulness/完整投影状态待补 | P1 |
| 真实入口 behavior_state / available_actions 消费 | AU-06 AU06-GAP-01~02 | 修正/补集成/补验收 | P0 |
| behavior resolution/history 与 ConfirmationBinding | AU-06 AU06-GAP-03~05 | 补实现/补集成/补测试 | P0 |
| 单活跃、幂等、跨作品/会话隔离 | AU-06 AU06-GAP-06/AU06-GAP-08~09 | 补实现/补测试/补验收 | P0 |
| TTL、BehaviorTrace/replay、clarification 主链 | AU-06 AU06-GAP-07/AU06-GAP-10~11 | 补实现/状态核查/补验收 | P1 |
| 工作台 why 入口与中文解释 | AU-07 AU07-GAP-01~02 | 最小真实 Tauri 闭环已补；文案/深度 trace 待补 | P1 |
| trace redaction 与 author/developer 双视图 | AU-07 AU07-GAP-03~04 | 补实现/补测试/补集成 | P0/P1 |
| Replay 六问与 Tool/Behavior/StateTrace 聚合 | AU-07 AU07-GAP-05~08 | 补实现/补集成/补测试 | P0/P1 |
| trace 查询 API/UI 与 work/session 隔离 | AU-07 AU07-GAP-09~10 | 补集成/修设计偏差/补验收 | P1 |
| 阅读模式真实 TOC/章节读取 | AU-08 AU08-GAP-01~02 | 采纳后正文可读最小闭环已补；完整 TOC/章节矩阵待补 | P0 |
| 采纳到阅读投影与 ProjectionHint adapter | AU-08 AU08-GAP-03~04 | 最小真实 Tauri 闭环已补；projection job/stale/rebuild 待补 | P0 |
| projection refresh no-write 与跨作品隔离 | AU-08 AU08-GAP-05~06 | 补实现/补测试/补验收 | P0 |
| 阅读模式错误态与 UI 自动化 | AU-08 AU08-GAP-07~09 | 补实现/补验收/文案同步 | P1/P2 |
| 记忆管理 REST/Channel 入口与作品档案真实数据 | AU-09 AU09-GAP-01~03 | 档案真实数据最小闭环已补；`AU09-archive-memory-roundtrip` CP2 已补显式伏笔/规则 artifact 采纳后的语义归类、伏笔/规则 tab 重开可见和 `au09-adopt-setting-recall` 真实 Tauri adoption/recall/why；`AU09-memory-management-workbench-entry` 已补正式管理入口和基础状态治理；继续补 Channel 管理入口、trace/replay 与设计追溯 | P0/P1 |
| 记忆召回到 context/prompt 与 recall ranking | AU-09 AU09-GAP-04~05 | 补实现/补集成 | P0 |
| 记忆状态机、locked 保护、有效期窗口 | AU-09 AU09-GAP-06~08 | 基础状态机、locked UI/recall、lifecycle blocked trace 和章节有效期窗口 checkpoint 已补；继续补完整 StateTrace/MemoryTrace 表、scene-level 窗口和降权策略 | P0/P1 |
| 记忆引用日志、作者溯源、AU-03 会话分层 | AU-09 AU09-GAP-09~12 | recall/lifecycle reference log、作者可见追溯与 AU-03 会话/记忆分层已补；继续补 developer replay、历史旧 turn 查询和完整独立 trace 表 | P0/P1 |
| 角色主档案 roundtrip（创建→采纳→Character 主档案→展示→上下文） | AU-09 AU09-GAP-13 | CP1 已闭环：`character_seed` 采纳写 Character 主档案且不写 memory，角色 tab 可见并进入后续上下文；CP2 字段级结构化/关系/演化待补 | P0 |
| 真实工作台入口与 v3 action/task_state 消费者分裂 | AU-10 AU10-GAP-01/AU10-GAP-03/AU10-GAP-07 | `WorkspaceChat` 已是唯一生产工作台入口；`历史旁路工作台` / `历史旁路 socket helper` 旁路已退役删除；真实导出 task_state、provider failure CP1、WebSocket reconnect CP2、cancel waiting CP3A 与 provider timeout CP3B checkpoint 已闭环，继续补完整异步 LongRunner UI | P0 |
| 普通聊天默认 MicroPlan、card action 绕过授权、候选操作 | AU-10 AU10-GAP-02/AU10-GAP-04~05 | 默认 MicroPlan、card action 授权、候选继续探索均已有 Tauri 证据；剩余为完整矩阵归并 | P1 |
| adoption UI、trace/why、projection、错误恢复 | AU-10 AU10-GAP-06/AU10-GAP-08~10 | adoption/why/projection 最小闭环已有；provider failure、WebSocket reconnect、cancel waiting 与 provider timeout 均已有 Tauri checkpoint；完整 LongRunner 和深度状态待补 | P0/P1 |
| 工作台 UI 自动化与 Tauri/Design 约束 | AU-10 AU10-GAP-11~12 | AU-10 baseline matrix、真实导出 task_state、provider failure、WebSocket reconnect、cancel waiting 与 provider timeout checkpoint 已补；完整 LongRunner、全 action/card、文案/hidden metadata 卫生待复核 | P0 |
| AI 引导式创作三层 message 闭环 | AU-11 AU11-GAP-01~05 | SC-AU11-01 已有真实 Tauri checkpoint；继续补缺上下文真实验收、guidance_mode schema 冻结、clarify/confirm 和 prose_writing envelope proof | P0 |
| 作品档案立项概览后续矩阵与修订入口 | AU-12 SC-AU12-A4/B1~C2 | works 立项字段只读概览 CP1 已闭环；accepted 状态、缺字段/失败、跨作品切换、no-write 计数、accepted-artifact 类立项要素和 correction 修订入口待补 | P1 |
| 供应商 health/model/error 补齐 | SU-01 SU01-GAP-01~03 | 补实现/补测试 | P0/P1 |
| 供应商运行时切换与安全配置 | SU-01 SU01-GAP-04~07 | 补设计/补实现/补集成 | P0 |
| 作品切换主闭环与隔离 | SU-02 SU02-GAP-01~04 | 补集成/补验收 | P0 |
| 作品管理 UI 与恢复策略 | SU-02 SU02-GAP-05~09 | 补实现/修设计偏差 | P1/P2 |
| AI 显示名设置与隔离 | SU-03 SU03-GAP-01~05 | 最小真实前端闭环已补；剩余真实 LLM payload 不变证据 | P2 |

**总缺口：持续重算中。当前 SU-01~03、AU-01~12 已按场景化口径重算或新立；AU-12 work profile overview CP1 已闭环但整体未完成。AU-10 baseline/task_state/provider failure/reconnect/cancel/timeout 已有 checkpoint；完整异步 LongRunner 因缺真实生产消费者按 `docs/design/04a-planning-and-long-run.md` 延后。当前继续铺产品功能广度，`AU09-archive-memory-roundtrip` CP2 已由 `au09-adopt-setting-recall` 证明真实页面伏笔/规则生成、adoption、tab 重开可见、recall/why；`AU09-memory-management-workbench-entry` 已由 `au09-memory-management-entry` 证明正式入口与基础生命周期治理；`AU09-memory-trace-roundtrip` 已补 lifecycle/reference author-safe 追溯；`AU09-validity-window-recall` 已补章节有效期窗口；`AU09-cross-work-memory-isolation` 已补跨作品隔离；`AU09-AU03-session-memory-layering` 已补同一作品内 active/historical session 与 governed memory 分层；`AU11-quality-diagnosis-message-envelope` 已补 SC-AU11-01 最小真实工作台 trace proof。**

---

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
