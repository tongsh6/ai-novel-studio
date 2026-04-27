# 软件工程最佳实践约束分析报告

**分析日期**: 2026-04-28
**分析范围**: Elixir 后端 (6 umbrella apps) + TypeScript 前端 (React + Tauri) + CI/CD + 工具链
**项目阶段**: Phase 0 Week 2（早期骨架阶段，~900 行业务代码）

---

## 1. 当前项目架构判断

### 1.1 架构风格

**Elixir 后端**: Umbrella Monolith（6 个 app + 1 个 spike）

```
apps/
├── novel_foundation/       Layer 0: Shared Kernel
├── novel_agent/            Layer 1: Agent Runtime
├── novel_domain/           Layer 2a: Novel Domain Models
├── novel_application/      Layer 2b: Application Services
├── novel_persistence/      Database Layer
└── novel_web/              Phoenix HTTP/WebSocket Gateway
```

架构风格判断：**分层架构（Layered Architecture） + 六边形架构的思想**
- 内层不依赖外层（foundation 无任何依赖）
- 领域层不依赖基础设施（domain 不依赖 Ecto/Phoenix/GenServer）
- Web 层是薄网关（只做 HTTP/WS 适配）
- 通过 umbrella app 依赖声明在编译期强制执行分层

**TypeScript 前端**: 独立 SPA（React 19 + Vite 8 + Tauri 2 桌面壳）

```
frontend/src/
├── App.tsx                  # 根组件
├── components/
│   └── ChannelDemo.tsx      # WebSocket 验证组件
├── lib/
│   ├── socket.ts            # Phoenix Socket 封装
│   ├── schemas.ts           # 从 JSON Schema codegen 的 Zod schema 桶
│   └── __tests__/           # 单元测试（socket + schemas）
├── generated/               # `pnpm codegen:schemas` 生成（不手编）
│   └── foundation/
│       ├── turn_result_v2.ts
│       └── artifact_adoption_entry.ts
└── assets/                  # 静态资源
```

前后端关系：**完全解耦**。前端通过 Phoenix Channel (WebSocket) 通信，不共享代码。唯一的一致性保证是 JSON Schema (docs/design-v2/schemas/) 同时 codegen 出 Ecto schema 和 Zod schema。

### 1.2 依赖关系（实际从 mix.exs 提取）

```
novel_web ──────────────→ novel_application ──→ novel_agent ──→ novel_foundation
    │                            │                    │
    │                            ├──→ novel_domain ───┤
    │                            │                    │
    └──→ novel_foundation ───────┴────────────────────┘
                                     novel_persistence ──→ novel_domain
                                                       └─→ novel_foundation
```

**判断：依赖方向干净、单向、无循环。这是当前项目最大的架构优势。**

### 1.3 分层职责判断

| App | 当前实际职责 | 职责是否清晰 |
|-----|-------------|------------|
| novel_foundation | 空壳（Shared Kernel 占位） | ✅ 定义清楚，等待填充 |
| novel_agent | OTP 监督树（workspace/author/agent 三层启停 + Registry + Dummy GenServer） | ✅ 作为 Agent Runtime 入口，职责单一 |
| novel_domain | 空壳（Application 骨架） | ⚠️ 完全空白，没有领域模型 |
| novel_application | 空壳（Application 骨架） | ⚠️ 完全空白，没有用例 |
| novel_persistence | Ecto Repo + DB Schema + 嵌入式 Schema (JSON mirror) + Schema drift 检查 | ✅ 职责清晰，边界合理 |
| novel_web | Phoenix Endpoint + Router + HealthController + WorkspaceChannel (ping/pong) | ✅ 严格薄网关，无业务逻辑 |

### 1.4 前端分层判断

| 目录 | 职责 | 是否清晰 |
|------|------|---------|
| `lib/socket.ts` | Phoenix Socket/Channel 封装 | ✅ 职责单一 |
| `lib/schemas.ts` | Zod schema 导出桶 | ✅ 纯类型/校验 |
| `components/ChannelDemo.tsx` | WebSocket 连通性验证 UI | ✅ 单一演示用途 |
| `generated/` | Codegen 产物 | ✅ 明确标记不手编 |

**判断：前端当前规模极小（3 个源模块 + 3 个测试），结构清晰，没有过度抽象。**

---

## 2. 当前主要问题

按严重程度排序：

### 高优先级（应尽快处理）

| # | 问题 | 说明 |
|---|------|------|
| H1 | **novel_domain 和 novel_application 完全空白** | 6 个 app 中有 2 个是纯骨架。没有领域模型、没有业务规则、没有用例。这使分层架构目前形同虚设——没有代码需要被"分层约束"。Phase 1 开始填代码时分层才真正受考验 |
| H2 | **novel_agent/runtime/ 命名未与设计文档对齐** | 设计文档 `08-multi-agent.md` 定义了 `Agent.Writer / Reviewer / Planner` 等，但代码中是 `AgentProcess`。Phase 1 实现真 Agent 时会出现不一致 |
| H3 | **WebSocket 连接地址硬编码** | `frontend/src/lib/socket.ts:3` 中 `ws://localhost:4000/socket` 硬编码。没有环境变量或配置注入 |
| H4 | **ChannelDemo 组件内联样式** | `ChannelDemo.tsx` 使用 `style={{...}}` 内联对象，未使用 CSS Modules / Tailwind / styled-components |

### 中优先级

| # | 问题 | 说明 |
|---|------|------|
| M1 | **CI 未运行 Dialyzer** | `mix.exs` 根 deps 中有 `:dialyxir`，但 CI 未执行 `mix dialyzer`。类型检查缺失 |
| M2 | **CI 未运行 arch_check** | `scripts/arch_check.exs` 已创建，但 CI workflow 未调用。架构门禁在本地有效但 CI 不执行 |
| M3 | **Schema drift 检查分离散** | 后端 `mix codegen.schemas` 和前端 `pnpm codegen:schemas` 各自独立检查，但没有统一的门禁入口 |
| M4 | **novel_foundation 的 @moduledoc 列出了未来计划但未落地** | 文档说应该有 Result/Error/ID/Clock 等，但目前一个都没有。要么删掉计划描述，要么落地至少一个 |
| M5 | **前端缺少 integration test** | `socket.test.ts` 只测纯逻辑（socket 对象构造），没有 mock WebSocket 的集成测试 |
| M6 | **Elixir 测试缺乏 `async: true`** | `novel_agent/test/novel_agent_test.exs` 设置 `async: false`，但测试之间没有共享状态冲突。可以改成 `async: true` |

### 低优先级

| # | 问题 | 说明 |
|---|------|------|
| L1 | **spikes/ 目录有残留验证代码** | `spikes/v2_verification/` 是 Phase 0 早期的 spike，现在已被正式代码替代，可以归档或删除 |
| L2 | **前端 smoke.test.ts 是无意义测试** | `expect(1+1).toBe(2)` 是 vitest 模板残留，没有实际价值 |
| L3 | **实验目录未明确隔离** | `experiments/` 是 Python 实验目录，但 `.gitignore` 没有明确排除，可能意外提交 |
| L4 | **tasks/ 目录与设计文档的分工不明确** | `tasks/` 中有 Week 1/Week 2 任务计划，但设计文档 `docs/design-v2/` 中也有阶段规划。容易产生"哪个是权威"的疑问 |
| L5 | **未使用 Elixir 1.19 的 set-theoretic types** | 设计文档 `03-backend.md` §2.1 提到 1.19 的类型系统增强，但代码中没有使用 `@type` 做合约约束（除了 basic `@spec`） |

---

## 3. 设计原则适配分析

### 3.1 已体现较好的原则

| 原则 | 体现位置 | 评价 |
|------|---------|------|
| **依赖倒置** | mix.exs 跨 app 依赖声明 | ✅ 编译期强制执行，内层不依赖外层 |
| **单一职责** | 每个 app 的职责在 `@moduledoc` 中明确声明 | ✅ 文档层面已有边界 |
| **KISS** | 当前代码结构简单直接，无过度抽象 | ✅ Phase 0 只做了必要的监督树验证 |
| **高内聚** | 监督树相关的全部代码（3 层 Supervisor + Registry + Dummy）集中在 `novel_agent/runtime/` | ✅ 高度内聚 |
| **测试保护** | Backend 26 个测试 + Frontend 3 个测试全部通过 | ✅ 基本覆盖 |

### 3.2 当前缺失的原则

| 原则 | 问题 | 严重度 |
|------|------|--------|
| **YAGNI** | `novel_foundation` 的 @moduledoc 列了 7 个未来模块，但没有一个被实际需要。这是"提前设计文档"而非"提前写代码"，边界模糊 | 低 |
| **DRY** | 目前代码量极少，尚无明显重复。但 JSON Schema → Ecto + JSON Schema → Zod 的双路 codegen 未来可能产生重复 | 待观察 |
| **开闭原则** | `AgentProcess.Dummy` 设计为 Phase 1 直接替换，但替换方式是删除 dummy.ex 写新文件还是新增 behaviour 实现？目前没留扩展点 | 低（Phase 1 再设计） |
| **面向接口** | Elixir 端没有定义 behaviour（如 Agent behaviour、Provider behaviour），目前只有具体实现 | 低（量太小，还不需要） |

### 3.3 如果强行引入会导致过度设计的原则

- **面向接口（behaviour）**：当前只有 1 个 Dummy GenServer，定义 behaviour 属于过早抽象
- **Repository 模式**：novel_persistence 目前只有 1 张业务表，不需要引入 repository 抽象
- **CQRS / Event Sourcing**：设计文档中有 Event Bus 的规划（ADR-0011），但 Phase 0 不需要
- **DTO / View Model 分离**：novel_web 只有一个 `/health` 端点，返回 `%{status: "ok"}`，不需要 DTO 层

### 3.4 当前阶段最应优先加强的 3 条原则

1. **YAGNI**：不要因为设计文档写了 12 个子系统就提前创建模块骨架。按 Phase 节奏，需要什么加什么
2. **KISS**：保持当前简单直接的代码风格。不要为了"架构完整性"添加过度分层
3. **测试优先保护核心**：Phase 1 开始写业务逻辑时，先写测试再写实现

---

## 4. 代码组织问题排查

### 无高优先级结构问题

当前代码量极少（~900 行业务代码），没有"上帝类"、没有"万能 Utils"、没有"循环依赖"、没有"Controller 里写 SQL"等问题。这得益于项目还处于极早期。

### 需要关注的点

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 1 | `novel_agent/runtime/agent_process/dummy.ex` | `dummy.ex` 是一个占位模块，Phase 1 要删掉。如果 Phase 1 不删，它就成为死代码 | Phase 1 实现真 Agent 时同步删除 |
| 2 | `novel_web/channels/workspace_channel.ex` | `join/3` 不做任何鉴权，所有 topic 全部放行 | Phase 1 加入 Authority Gate 前加 `# TODO` |
| 3 | `novel_persistence/schemas/workspace.ex` | 这是"数据库模型"但名字像"领域模型"。它应该在 `schemas/` 目录下，目前位置正确 | 保持 |
| 4 | `frontend/src/lib/schemas.ts` | 做了 re-export + alias，但注释说"去掉版本后缀"。如果 JSON Schema 版本号变了，这个 alias 要做相应调整 | 保持，但应记录在 codegen 文档中 |

---

## 5. 软件工程约束适配建议

### 5.1 推荐写入 AGENTS.md / CLAUDE.md 的全局规则

以下规则适合作为项目级 AI 编码行为约束，写入项目根 `AGENTS.md`（或 `.claude/CLAUDE.md`）：

```markdown
# AI Novel Studio — AI 编码行为约束

## 架构约束（违反会导致编译失败）

1. **Umbrella 依赖方向不可逆**
   - novel_web → novel_application → {novel_agent, novel_domain}
   - novel_agent → novel_foundation
   - novel_domain → novel_foundation
   - 禁止 novel_foundation 依赖任何 umbrella app
   - 禁止 novel_domain 依赖 novel_agent / novel_persistence / novel_web
   - 禁止 novel_web 依赖 novel_persistence

2. **模块边界规则**
   - novel_foundation: 只能有纯函数工具，禁止 GenServer/Supervisor/Registry/Ecto
   - novel_domain: 只能有纯 struct + 纯函数，禁止 GenServer/Repo/Phoenix/Ecto
   - novel_agent: 业务无关的 Agent 运行时，禁止引用 NovelDomain / NovelApplication
   - novel_web: 薄网关，禁止直接调用 Repo / Ecto.Query / NovelAgent 内部模块

## 编码约束

3. **修改前必须先读**
   - 修改任何 app 前，先读该 app 的 mix.exs（了解依赖）
   - 修改前先读 apps/ 下的同名模块，确认不会重复

4. **不允许的操作**
   - 不允许创建名为 Common / Utils / Helpers 的万能模块
   - 不允许在 controller / channel 里写业务逻辑
   - 不允许绕过 mix.exs 的 in_umbrella 依赖声明直接跨 app 引用
   - 不允许为了通过编译删除已有校验
   - 不允许在 novel_foundation 中添加任何业务概念

5. **测试要求**
   - 新增模块必须至少有一个测试
   - 修改核心逻辑必须更新测试
   - 运行 `MIX_ENV=test mix check` 通过后方可声称完成

6. **命名规则**
   - 模块名必须表达业务含义（不用 Manager / Handler / Processor 等模糊词）
   - 文件名必须与主模块名一致
   - 测试文件必须以 _test.exs 结尾，放在对应 test/ 目录下
```

### 5.2 推荐写入项目开发规范的规则

以下规则适合写入 `docs/design-v2/tech-stack/` 或独立的开发规范文档：

```markdown
# 开发规范

## 代码组织

1. **新增模块的判断标准**
   - 如果一个模块只被一个调用方使用，放在调用方同目录
   - 如果一个模块被多个 app 使用，考虑它属于哪个 app 的职责边界
   - 如果不知道该放哪，先在 PR 中讨论，不要直接创建

2. **配置管理**
   - 环境相关配置放 config/（如 DB 连接、端口）
   - 业务常量放在对应 app 的模块中（如 `NovelAgent.Router.Behaviour.default_timeout()`）
   - 禁止在代码中硬编码环境特定值（如 URL、端口）

3. **错误处理**
   - 业务错误：`{:error, reason}` tuple
   - 意外错误：let it crash（让 supervisor 重启）
   - 禁止混用 raise 与 error tuple
   - 每个 error reason 必须是 struct 或有文档说明的 atom

4. **日志规范**
   - Logger.info 用于关键生命周期事件（如 Application started）
   - Logger.error 由 supervisor/GenServer 自动记录 crash
   - 禁止在循环中使用 Logger（性能问题）

5. **模块文档**
   - 每个公开模块必须有 @moduledoc
   - 每个公开函数必须有 @doc 和 @spec
   - @moduledoc 必须说明"这个模块解决什么问题"而非"这个模块做了什么"

## 测试规范

6. **测试放置**
   - 单元测试放在对应 app 的 test/ 下，目录结构与 lib/ 一致
   - 集成测试放在 test/integration/ 下
   - 不要创建 test/support/ 下的万能 helper

7. **测试风格**
   - 使用 `describe` 描述被测模块/函数
   - 使用 `test` 描述预期行为
   - 优先使用 `async: true`（除非测试之间有共享状态）
```

### 5.3 推荐每次任务提示中附加的规则

以下是可以直接复制到 AI 编码请求末尾的"任务约束模板"：

```text
## 任务约束

### 范围
- 本次只修改：<列出文件或模块>
- 本次禁止修改：<列出禁止触碰的文件或模块>

### 验收标准
- [ ] `mix compile --warnings-as-errors` 通过
- [ ] `mix test` 全部通过
- [ ] `mix xref graph --format cycles --fail-above 0` 通过
- [ ] `mix run scripts/arch_check.exs` 通过
- [ ] 新增代码有测试覆盖

### 不允许
- 不允许修改 mix.exs 依赖声明（除非本次任务明确要求）
- 不允许修改 config/ 下的配置（除非本次任务明确要求）
- 不允许格式化无关代码
- 不允许引入新的 hex 依赖（除非本次任务明确要求）
- 不允许把业务逻辑写到 novel_web 或 novel_foundation

### 输出要求
- 说明修改了什么、为什么这样改
- 说明影响范围（哪些模块/测试受影响）
- 说明验证方式（运行了什么命令，结果是什么）
```

---

## 6. 推荐落地的架构门禁

```text
门禁名称：          编译门禁
适用程度：          已落地
建议工具：          mix compile --warnings-as-errors
检测内容：          编译错误 + 编译警告
失败条件：          任何编译错误或警告
落地成本：          0（已落地）
优先级：            P0

门禁名称：          测试门禁
适用程度：          已落地
建议工具：          mix test + pnpm test
检测内容：          全部单元测试
失败条件：          任何测试失败
落地成本：          0（已落地）
优先级：            P0

门禁名称：          格式化门禁
适用程度：          已落地
建议工具：          mix format --check-formatted + pnpm lint
检测内容：          Elixir 代码格式化 + TypeScript ESLint
失败条件：          格式不一致或 lint 规则违反
落地成本：          0（已落地）
优先级：            P0

门禁名称：          循环依赖检查
适用程度：          已在 root mix.exs alias 中配置
建议工具：          mix xref graph --format cycles --label compile-connected --fail-above 0
检测内容：          Umbrella app 之间是否有编译期循环依赖
失败条件：          检测到任何循环
落地成本：          0（已落地）
优先级：            P0

门禁名称：          Credo 静态分析
适用程度：          已落地（CI 已配置）
建议工具：          mix credo --strict
检测内容：          代码风格、设计问题、可读性、重构机会、警告
失败条件：          任何检查失败
落地成本：          0（已落地）
优先级：            P0

门禁名称：          Schema drift 检查
适用程度：          已落地（后端 + 前端）
建议工具：          mix codegen.schemas + pnpm codegen:schemas + git diff
检测内容：          JSON Schema (docs/design-v2/schemas/) 与 Ecto schema / Zod schema 是否一致
失败条件：          codegen 后 git diff 非空
落地成本：          0（已落地）
优先级：            P0

门禁名称：          架构边界检查
适用程度：          脚本已创建但 CI 未调用
建议工具：          mix run scripts/arch_check.exs
检测内容：          foundation 不能有 OTP 进程、domain 不能有 Ecto、web 不能有 Repo 等
失败条件：          匹配到任何禁止模式
落地成本：          1 行 CI 配置（在 ci.yml 的 backend job 中添加）
优先级：            P1 — 应该立即加入 CI

门禁名称：          Dialyzer 类型检查
适用程度：          依赖已安装但 CI 未运行
建议工具：          mix dialyzer
检测内容：          类型错误、函数不存在、契约违反
失败条件：          Dialyzer 报告 error
落地成本：          中等（首次运行需要构建 PLT，约 2-3 分钟，之后可缓存）
优先级：            P1 — 建议 Phase 1 加入

门禁名称：          禁止特定依赖方向
适用程度：          已通过 mix.exs 的 in_umbrella 在编译期强制
建议工具：          mix compile（编译即强制）
检测内容：          novel_domain 不能依赖 novel_agent、novel_web 不能依赖 novel_persistence
失败条件：          编译失败
落地成本：          0（已落地）
优先级：            P0（已落地）

门禁名称：          测试覆盖率检查
适用程度：          未落地
建议工具：          mix test --cover + 覆盖率阈值
检测内容：          行覆盖率
失败条件：          低于阈值（建议初始 60%，逐步提升）
落地成本：          低（Elixir 内建支持）
优先级：            P2 — Phase 1 再加入，当前代码量太少，覆盖率无意义

门禁名称：          前端 TypeScript 严格模式
适用程度：          已落地（tsconfig 使用 strict: true）
建议工具：          tsc -b（在 pnpm build 中）
检测内容：          类型错误
失败条件：          任何类型错误
落地成本：          0（已落地）
优先级：            P0

门禁名称：          前端构建检查
适用程度：          未落地在 CI
建议工具：          pnpm build
检测内容：          TypeScript 编译 + Vite 打包是否成功
失败条件：          构建失败
落地成本：          1 行 CI 配置
优先级：            P1 — CI 只跑了 lint + test，没跑 build
```

---

## 7. AI 编码行为约束（可直接复制到提示词中）

```text
## AI 编码行为约束

### 开始前
- 先阅读 `apps/<target>/mix.exs` 了解依赖关系
- 先阅读同名或同目录的已有模块，了解现有风格
- 先运行 `mix compile` 确认当前状态是可编译的

### 编码中
- 不要新增 hex 依赖，除非本次任务明确要求
- 不要修改 mix.exs 的 deps，除非本次任务明确要求
- 不要把业务逻辑写进 novel_web（Controller/Channel）
- 不要把 Ecto.Query 写进 novel_web
- 不要把 GenServer 写进 novel_foundation 或 novel_domain
- 不要创建 Common/Utils/Helpers 万能模块
- 不要为了"可能有用"而添加函数（YAGNI）
- 不要修改与本任务无关的文件
- 不要大范围格式化（mix format 留到单独的命令）

### 完成后
- 运行 `mix compile --warnings-as-errors` 验证编译
- 运行 `mix test` 验证全部测试通过
- 运行 `mix xref graph --format cycles --fail-above 0` 验证无循环依赖
- 运行 `mix run scripts/arch_check.exs` 验证架构边界
- 为新模块写测试
- 说明修改了什么、为什么、影响范围、验证方式
```

---

## 8. 暂时不建议强制执行的规则

| # | 规则 | 原因 |
|---|------|------|
| 1 | **严格的测试覆盖率阈值** | 当前代码量仅 ~900 行，覆盖率数字无统计学意义。Phase 1 业务代码量上来后再设阈值 |
| 2 | **Behaviour/Interface 强制** | 当前只有 1 个 Dummy GenServer，定义 behaviour 是过度设计。等至少 2 个实现时再引入 |
| 3 | **禁止 TODO/FIXME 注释** | Credo 已启用 `TagTODO` 检查（exit_status: 2），但 Phase 0 应允许 TODO 占位。Phase 1 收紧 |
| 4 | **Git Hook (pre-commit/pre-push)** | 当前用 CI 门禁即可，本地 hook 会降低开发速度 |
| 5 | **严格的模块依赖方向 lint（如 `boundary` 库）** | `scripts/arch_check.exs` + `mix.exs in_umbrella` 已经够用，引入额外工具是过度工程 |
| 6 | **禁止 `mix format` 之外的格式化规则** | Credo 和 ESLint 的规则集已经足够，不需要自定义格式化规则 |
| 7 | **长函数/长文件警告阈值** | 当前所有文件都在 50 行以内，没有需要拆分的长文件 |

---

## 9. 优先级路线图

### 第一阶段：立即加入，不改架构

**预计耗时：30 分钟**

1. **CI 加入 arch_check 执行**
   ```yaml
   # .github/workflows/ci.yml backend job 添加一行
   - run: mix run scripts/arch_check.exs
   ```

2. **CI 加入前端 build 检查**
   ```yaml
   # frontend job 添加
   - run: pnpm build
   ```

3. **删除前端 smoke.test.ts**
   - 无意义测试，直接删除

4. **novel_web socket URL 改为可配置**
   - 加环境变量 `VITE_WS_ENDPOINT`，默认 `ws://localhost:4000/socket`

5. **novel_foundation.ex 清理 @moduledoc**
   - 删除"未来计划"列表，保持简洁

### 第二阶段：补充门禁，提升约束力

**预计耗时：2-3 小时（Phase 1 启动前）**

6. **Dialyzer 加入 CI**
   ```yaml
   - run: mix dialyzer
   ```
   需要配置 PLT 缓存

7. **novel_domain 创建第一个领域模型**
   - 从设计文档 `21-novel-object-model.md` 中提取 `Work` struct 作为起点
   - 验证"domain 不能依赖 Ecto"的架构门禁是否真的生效

8. **novel_agent 新增 Agent behaviour**
   - 当有 2 个以上 Agent 实现时（Writer + Reviewer），定义 behaviour

9. **启用 Credo 的 ModuleDependencies 检查**
   - 当前在 disabled 列表中，Phase 1 启用后可以检测模块级依赖

### 第三阶段：局部重构，优化边界

**预计耗时：待 Phase 1 中期评估**

10. **统一 Schema drift 检查入口**
    - 创建一个 `mix check.schemas` alias 同时跑后端 + 前端的 schema 检查

11. **novel_persistence 内部分层**
    - 当 schemas 超过 10 个时，区分 `schemas/`（DB 表）和 `embedded/`（JSON mirror）

12. **前端引入 CSS Modules 或 Tailwind**
    - 解决 `ChannelDemo.tsx` 的内联样式问题

### 第四阶段：长期治理

13. **测试覆盖率阈值** — 等业务代码量 > 3000 行后设定
14. **Repository 模式** — 当 Domain Model 和 DB Schema 出现明显分歧时引入
15. **多语言 codegen 统一** — 当 schema 数量 > 20 时考虑统一 codegen pipeline
16. **spikes/ 归档或删除** — Phase 1 结束后评估

---

## 附录：当前工具链全景

| 层级 | 工具 | 状态 | 用途 |
|------|------|------|------|
| Elixir 编译 | mix compile | ✅ CI | 编译检查 |
| Elixir 测试 | mix test (ExUnit) | ✅ CI | 26 个测试 |
| Elixir 格式 | mix format | ✅ CI | 代码格式一致性 |
| Elixir 静态分析 | mix credo --strict | ✅ CI | 代码质量 |
| Elixir 循环依赖 | mix xref graph | ✅ 本地 check alias | 架构 |
| Elixir 架构边界 | mix run scripts/arch_check.exs | ⚠️ 本地有，CI 缺 | 架构 |
| Elixir 类型检查 | mix dialyzer | ❌ 未运行 | 类型安全 |
| Elixir Schema drift | mix codegen.schemas | ✅ CI | 契约一致性 |
| TypeScript 编译 | tsc -b | ✅ pnpm build | 类型检查 |
| TypeScript 测试 | vitest | ✅ CI | 4 个测试 |
| TypeScript 格式 | eslint | ✅ CI | 代码风格 |
| TypeScript Schema | pnpm codegen:schemas | ✅ CI | 契约一致性 |
| 前端构建 | vite build | ⚠️ CI 缺 | 构建验证 |
| Git 规范 | 无 | — | — |
| Commit 规范 | 无 | — | — |

---

*本报告基于 2026-04-28 代码状态。项目处于 Phase 0 Week 2 早期，代码量极少，架构骨架健康。当前最大的工程问题是"过于干净"——大部分 app 还是空的，真正的架构考验在 Phase 1 开始填充代码时到来。*
