# Phase 0 路线图

> 状态：草案
>
> 目的：把"技术栈选型已锁定"这个状态推进到"可以开始写代码"。本文档定义 Phase 0 的具体工作分解：从立项到第一个 end-to-end smoke test，再到 capability 完整跑通。

---

## 1. Phase 0 目标

**Phase 0 不是 alpha**。它是把架构脚手架 + 工程纪律立起来的阶段，预期 **3-4 周** 完成。

完成标准：

- 仓库结构完整，团队成员可以本地一键启动
- OTP supervision tree 顶层骨架立起来
- ADR-0001 / ADR-0002 schema 落地为 Ecto + Zod codegen
- 第一个真实 capability 跑通：`intent.CREATE_WORK_SEED`
- Authority Gate / Budget Meter / Observability 横切层接入
- CI 跑通（schema 一致性检查 + 测试）

**Phase 0 之后的"Phase 1"才是真正的产品功能开发**，按 v2 README §7 顺序写各 Foundation/Domain 子系统。

---

## 2. 第 1 周：脚手架 + 第一份 Schema

### 2.1 工作项

| 任务 | 交付物 |
|---|---|
| 仓库结构初始化 | Mix umbrella + 4 个 apps + frontend + tauri 目录都建立 |
| 工具链 setup | Homebrew + nvm 路径校验 + 团队 onboarding 文档 |
| Mix umbrella + 依赖 | `mix.exs` + 4 个 apps 的 `mix.exs` + `mix deps.get` 通过 |
| Phoenix endpoint 骨架 | `mix phx.server` 能启动，访问 `/health` 返回 200 |
| Frontend 骨架 | `pnpm dev` 能启动 Vite，访问 `localhost:5173` 显示 hello world |
| Tauri 骨架 | `pnpm tauri dev` 能启动 Tauri，加载 frontend |
| 第一份 JSON Schema | `docs/design-v2/schemas/turn_result.json` 按 ADR-0001 §3 写完 |
| Schema codegen 工具 | `mix codegen.schemas` + `pnpm codegen:schemas` 能跑通 |
| Git + CI | GitHub Actions 跑 `mix test` + `pnpm test` |

### 2.2 完成标准

- [ ] 团队任意成员按 [`12-development.md`](./12-development.md) §2.0 完成工具链校验后，`git clone + mix deps.get + pnpm install` 能跑起来
- [ ] `mix phx.server` + `pnpm dev` + `pnpm tauri dev` 三个终端都能启动
- [ ] CI 跑通，`mix test` 至少有一个 dummy test 通过
- [ ] `docs/design-v2/schemas/turn_result.json` reviewed 并 commit

### 2.3 OTP 培训（并行）

- 团队成员（特别是非 Elixir 背景）开始 "Designing Elixir Systems with OTP" 阅读
- 每周 1-2 次内部 office hour 答疑
- 重点章节：OTP behaviours、supervision tree、GenServer

---

## 3. 第 2 周：Supervision tree 骨架 + Persistence 层

### 3.1 工作项

| 任务 | 交付物 |
|---|---|
| OTP application 骨架 | `AINovelStudio.Application` 启动顶层 supervisor，包含 Repo / PubSub / Telemetry |
| Workspace.DynamicSupervisor | 顶层多作者根支持动态启停 workspace |
| Author.DynamicSupervisor | 单 workspace 下支持动态启停 author session |
| Agent.Children.DynamicSupervisor | 单 author 下能动态 spawn 子 Agent（暂用 dummy GenServer 占位）|
| Ecto Repo + 第一张表 | `mix ecto.create + mix ecto.migrate` 跑通；建一张 `workspaces` 表 |
| Ecto schemas codegen 完整 | `turn_result.json` → `Persistence.Schemas.TurnResult` |
| paper_trail 接入 | 第一张表 + revision audit 跑通；完成 [`verification/paper-trail-ecto-compatibility.md`](./verification/paper-trail-ecto-compatibility.md) |
| Phoenix Channels 雏形 | 一个 `WorkspaceChannel`，能 join + 收消息 |
| Frontend Channel 客户端 | `phoenix` npm client 能连上 channel + send 消息 |
| Frontend Zod schema 接入 | `TurnResultSchema.parse` 在前端能跑通 |

### 3.2 完成标准

- [ ] 启动应用后 `Observer` 能看到完整 supervision tree
- [ ] 创建一个 workspace，supervision tree 下出现对应 Workspace.Supervisor + Author.DynamicSupervisor
- [ ] Ecto 写一条 turn_result 数据 + paper_trail 自动写 versions 表
- [ ] `paper_trail` 技术验证结论已记录到 [`verification/paper-trail-ecto-compatibility.md`](./verification/paper-trail-ecto-compatibility.md)
- [ ] 前端能连接 Phoenix Channel + 收到一条服务端 push
- [ ] schema 一致性 CI 通过

---

## 4. 第 3 周：横切层 + Provider Gateway

### 4.1 工作项

| 任务 | 交付物 |
|---|---|
| Authority Gate 骨架 | Plug + GenServer，每次 capability invoke 检查 authority |
| Budget Meter 骨架 | GenServer 计量 + emit telemetry |
| Provider Gateway 骨架 | OpenAI 兼容 provider（连 LM Studio）+ Stub provider |
| Provider Gateway behaviour 定义 | `AINovelStudio.Foundation.Provider` behaviour |
| Structured Output 验证 | ✅ 已完成（2026-04-26 二跑）：四路径全部 normal 20/20，决策 `instructor_lite` 主 + `langchain` 副 + 直连 Req fallback。详见 [`verification/structured-output-library-choice.md`](./verification/structured-output-library-choice.md) §7 |
| 第一个 capability | `cap.simple_complete`：调用 LLM 返回文本，无业务逻辑 |
| Telemetry + OTel 接入 | OpenTelemetry-erlang + Phoenix.Telemetry，能在 stdout 看到 trace |
| Audit log 骨架 | JSONL 写入功能 |
| CI 完善 | 加 contract test + dialyzer + credo |

### 4.2 完成标准

- [ ] 调用 `cap.simple_complete` 返回 LLM 响应
- [ ] structured output 技术验证结论已记录，并同步更新 `03-backend.md` / `07-provider.md` 依赖说明
- [ ] OTel trace 能看到完整 span 链路
- [ ] Authority denied 时 capability 拒绝执行
- [ ] Budget exceed 时触发 escalation（即使只是 log）
- [ ] Audit log 文件有正确条目

---

## 5. 第 4 周：第一个真实 capability + End-to-End smoke

### 5.1 工作项

| 任务 | 交付物 |
|---|---|
| Intent registry 骨架 | `intent.CREATE_WORK_SEED` 注册 |
| Slot Schema 接入 | ADR-0010 slot schema for `CREATE_WORK_SEED` |
| Router 骨架 | 能识别 intent + 抽取 slots + 决定 next_action |
| Executor 骨架 | 能调用 capability 产出 tentative artifact |
| Adoption Boundary 骨架 | `Ecto.Multi` accept tentative → production write |
| Domain `Work` schema | 第一个 Domain Object（小说作品）|
| TurnResult v2 完整产出 | Phoenix Channel push 给前端 |
| Frontend 渲染第一张 card | adoption_card 能显示 + accept/reject 按钮工作 |
| End-to-end smoke test | 用户输入 "建一本玄幻小说" → 触发 CREATE_WORK_SEED → 产生 tentative work → 用户 accept → DB 中有 work 记录 |
| Phase 0 retrospective | 团队回顾 + Phase 1 计划 |

### 5.2 完成标准

- [ ] 端到端用户旅程跑通：输入文本 → 后端处理 → 前端显示卡片 → 用户接受 → 数据持久化
- [ ] 整个链路有完整 OTel trace
- [ ] paper_trail 记录了 revision history
- [ ] Audit log 记录了所有关键事件
- [ ] 前后端 schema 一致（CI 验证）
- [ ] 团队对 OTP / Phoenix / Ecto 基础有信心

---

## 6. Phase 0 完成后的第一步（Phase 1 启动）

按 v2 README §7 推荐顺序：

1. `01-agent-foundation-contract.md` 主文档落实（如果还没写完）
2. `05-memory-retention-and-retrieval.md` 实施（hot/warm/cold 三层）
3. `06-planning-and-long-run.md` 实施（LongRunner + checkpoint）
4. `07-consistency-and-concurrency.md` 实施（revision + 乐观锁）
5. `12-multi-agent-composition.md` 实施（真实 Multi-Agent，按 [`08-multi-agent.md`](./08-multi-agent.md) 落地）
6. 其余 Foundation 子系统
7. Domain 模块（按 §5）
8. UI 设计 + pencil 原型（按 v2 README §5）

---

## 7. Phase 0 资源估算

### 7.1 团队规模

最小可行团队：

- 1 位 Tech Lead（Elixir 经验或快速学习能力强）
- 1 位 后端工程师（Elixir 或 学习中）
- 1 位 前端工程师（React/TS）
- 1 位 设计师（pencil 原型 + UI 设计，可分阶段加入）

### 7.2 时间

- Phase 0：3-4 周
- 如果团队全部 Elixir 新手：可能需要 5-6 周（含培训）

### 7.3 风险缓冲

参考 [`13-risks.md`](./13-risks.md)：

- R-07 OTP 学习曲线超预期：预留 1 周缓冲
- R-10 codegen 漂移：第 1 周建立纪律，避免后期返工

---

## 8. 关键 Milestones

| Milestone | 目标日期（相对）| 验证 |
|---|---|---|
| M0 | 第 1 天 | 仓库初始化 + 团队 onboarding 完成 |
| M1 | 第 1 周末 | 三栈骨架启动通过 |
| M2 | 第 2 周末 | Supervision tree + Persistence 跑通 |
| M3 | 第 3 周末 | Provider Gateway + 横切层接入 |
| M4 | 第 4 周末 | End-to-end smoke test 通过 |
| M5 (Phase 1 启动) | 第 5 周 | 第一个 Foundation 子系统实施开始 |

---

## 9. 沟通与决策

### 9.1 日常

- 每日 standup：15 分钟，blocker 优先
- 每周 review：1 小时，按 milestone 进度对齐
- 每周 OTP office hour：1 小时，疑难解答

### 9.2 决策

- 技术栈选型已锁定，不重审（除非 [`13-risks.md`](./13-risks.md) 触发回退条件）
- 子系统设计决策：先 ADR draft → review → 立 ADR → 实施
- 紧急工程决策：tech lead 24h 内拍板 + 异步通知

---

## 10. 不在 Phase 0 范围内的事

明确**不做**的事，避免 scope creep：

- ❌ 完整 §12 Multi-Agent 实施（Phase 1 中段）
- ❌ LongRunner 实施（Phase 1 中段）
- ❌ Reading projection 实施（Phase 1 后段）
- ❌ Maintenance hooks 实施（Phase 1 后段）
- ❌ UI 设计文档（v2 阶段 3 才开始）
- ❌ Tauri 安装包构建 + 签名（Phase 1 末期）
- ❌ 阶段 2 PostgreSQL 切换（Phase 2）
- ❌ 多 LLM provider 并行调用（按需启用）
- ❌ Distributed Erlang cluster（Phase 2）

---

## 11. 当前 TBD

- 具体团队成员安排（待团队确认）
- 第一个 capability `CREATE_WORK_SEED` 的具体 prompt 设计（experiments/ 输出）
- LLM provider 选择（LM Studio 本地 / OpenAI 远程，按预算决定）
- [`verification/`](./verification/) 任务完成状态与是否需要 ADR
- pencil 原型何时介入 Phase 0 （UI 卡片设计可能影响 frontend 骨架）

以上 TBD 在 Phase 0 第 1 周的 kick-off 会议上确定。

---

## 12. Phase 0 Kick-off 会议议程

建议第 1 天的 kick-off 会议覆盖：

1. 阅读本目录 `00-overview.md` + `01-decision-rationale.md` (30 min)
2. 团队 Q&A on tech stack (30 min)
3. 工具链 setup demo (15 min)
4. 工作分解与责任 (30 min)
5. 风险登记与缓解措施 review (15 min)
6. milestones 时间线确认 (15 min)
7. 沟通节奏 + 决策机制 (15 min)
8. 行动项 + Phase 0 第一周计划 (15 min)

总时长 ~3 小时（含休息）。
