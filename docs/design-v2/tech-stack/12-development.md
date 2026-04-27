# 开发工作流

> 状态：草案
>
> 目的：定义仓库结构、本地开发 setup、构建/测试/release 流程、CI/CD 思路。本文档在 Phase 0 第 1 周就要可用。

---

## 1. 仓库结构

```
ai-novel-studio/
├── docs/                                # 设计文档
│   └── design-v2/                       # v2 设计
│       ├── (00-34 Agent Runtime/Domain 文档)
│       ├── adr/                         # ADR
│       ├── schemas/                     # JSON Schema SSOT
│       ├── ui-design/                   # UI 设计 + pencil 原型
│       └── tech-stack/                  # 本目录
│
├── apps/                                # Mix umbrella
│   ├── novel_foundation/                # Layer 0: Shared Kernel（基础工具库）
│   │   ├── lib/novel_foundation/
│   │   │   ├── novel_foundation.ex
│   │   │   ├── result.ex                # Result/Error 类型与组合子
│   │   │   ├── error.ex                 # 统一 Error struct
│   │   │   ├── id.ex                    # ID 生成（UUID v7, prefix 规则）
│   │   │   ├── clock.ex                 # 可注入时间源
│   │   │   ├── pagination.ex            # 分页参数与游标
│   │   │   ├── validation.ex            # 通用校验 helper
│   │   │   └── telemetry.ex             # Telemetry 事件定义
│   │   ├── test/
│   │   ├── mix.exs
│   │   └── README.md
│   │
│   ├── novel_agent/                     # Layer 1: Agent Runtime（原 "Foundation"）
│   │   ├── lib/novel_agent/
│   │   │   ├── novel_agent.ex           # 公开 API
│   │   │   ├── application.ex           # OTP Application 入口
│   │   │   ├── turn/                    # Turn 管理
│   │   │   │   ├── orchestrator.ex      # Turn 唯一编排入口
│   │   │   │   ├── turn.ex              # Turn struct
│   │   │   │   └── phase.ex             # Turn phase 状态机
│   │   │   ├── router/                  # 路由
│   │   │   │   ├── router.ex            # Intent 识别 + Slot 抽取
│   │   │   │   └── behaviour.ex
│   │   │   ├── executor/                # 执行
│   │   │   │   ├── executor.ex          # Capability 执行器
│   │   │   │   ├── validator.ex         # 输出校验器
│   │   │   │   └── behaviour.ex
│   │   │   ├── long_runner/             # 长跑任务
│   │   │   │   ├── long_runner.ex
│   │   │   │   └── checkpoint.ex
│   │   │   ├── registry/                # 注册中心（机制）
│   │   │   │   ├── capability_registry.ex
│   │   │   │   ├── intent_registry.ex
│   │   │   │   ├── hook_registry.ex
│   │   │   │   └── registry.ex          # 通用 Registry behaviour
│   │   │   ├── memory/                  # 记忆服务
│   │   │   │   ├── memory_service.ex
│   │   │   │   ├── retrieval.ex
│   │   │   │   └── tier.ex
│   │   │   ├── provider/                # Provider Gateway（§08）
│   │   │   │   ├── gateway.ex           # 统一 LLM 调用入口
│   │   │   │   ├── behaviour.ex         # Provider behaviour
│   │   │   │   ├── openai.ex
│   │   │   │   ├── anthropic.ex
│   │   │   │   ├── stub.ex
│   │   │   │   ├── usage.ex
│   │   │   │   └── error.ex
│   │   │   ├── runtime/                 # 运行时进程管理（监督树）
│   │   │   │   ├── registries.ex        # Registry 声明
│   │   │   │   ├── workspace_session.ex
│   │   │   │   ├── workspace_session/
│   │   │   │   │   ├── dynamic_supervisor.ex
│   │   │   │   │   └── supervisor.ex
│   │   │   │   ├── author_session.ex
│   │   │   │   ├── author_session/
│   │   │   │   │   ├── dynamic_supervisor.ex
│   │   │   │   │   └── supervisor.ex
│   │   │   │   ├── agent_process.ex
│   │   │   │   └── agent_process/
│   │   │   │       ├── children/
│   │   │   │       │   └── dynamic_supervisor.ex
│   │   │   │       └── dummy.ex
│   │   │   ├── authority/               # 权限门禁（§10）
│   │   │   │   └── gate.ex
│   │   │   ├── budget/                  # 预算计量（§10）
│   │   │   │   └── meter.ex
│   │   │   ├── observability/           # 观测性（§09）
│   │   │   │   ├── trace.ex
│   │   │   │   └── metrics.ex
│   │   │   └── multi_agent/             # 多 Agent 组合（§12）
│   │   │       ├── envelope.ex
│   │   │       └── delegation.ex
│   │   ├── test/
│   │   ├── mix.exs
│   │   └── README.md
│   │
│   ├── novel_domain/                    # Layer 2a: Novel Domain Models
│   │   ├── lib/novel_domain/
│   │   │   ├── novel_domain.ex
│   │   │   ├── works/                   # 主结构对象（§21）
│   │   │   │   ├── work.ex
│   │   │   │   ├── volume.ex
│   │   │   │   ├── chapter.ex
│   │   │   │   ├── scene.ex
│   │   │   │   └── draft.ex
│   │   │   ├── characters/              # 资产对象（§21）
│   │   │   │   ├── character.ex
│   │   │   │   ├── faction.ex
│   │   │   │   └── location.ex
│   │   │   ├── continuity/              # 连续性对象（§22）
│   │   │   │   ├── state_snapshot.ex
│   │   │   │   ├── timeline_event.ex
│   │   │   │   └── foreshadowing.ex
│   │   │   ├── style/                   # 风格对象（§23）
│   │   │   │   ├── style_sample.ex
│   │   │   │   ├── writing_preferences.ex
│   │   │   │   └── brief.ex
│   │   │   ├── policies/                # 领域规则（纯函数）
│   │   │   │   ├── continuity_policy.ex
│   │   │   │   ├── quality_gates.ex
│   │   │   │   └── approval_policy.ex
│   │   │   └── events/                  # 领域事件（纯 struct）
│   │   │       └── events.ex
│   │   ├── test/
│   │   └── mix.exs
│   │
│   ├── novel_application/               # Layer 2b: Application Services
│   │   ├── lib/novel_application/
│   │   │   ├── novel_application.ex     # 公开 API
│   │   │   ├── works/                   # 作品管理用例
│   │   │   │   ├── create_work.ex
│   │   │   │   └── manage_structure.ex
│   │   │   ├── chapters/                # 章节创作用例
│   │   │   │   ├── continue_chapter.ex
│   │   │   │   └── revise_chapter.ex
│   │   │   ├── conversations/           # 对话处理用例
│   │   │   │   ├── handle_message.ex
│   │   │   │   └── assemble_turn.ex
│   │   │   ├── context/                 # 上下文组装（执行）
│   │   │   │   ├── context_builder.ex
│   │   │   │   ├── context_selector.ex
│   │   │   │   └── context_budget.ex
│   │   │   ├── prompts/                 # Prompt 构建（小说特化）
│   │   │   │   ├── prompt_builder.ex
│   │   │   │   ├── system_prompts.ex
│   │   │   │   └── task_prompts.ex
│   │   │   ├── registration/            # 领域注册
│   │   │   │   ├── intent_registration.ex
│   │   │   │   ├── capability_registration.ex
│   │   │   │   └── hook_registration.ex
│   │   │   ├── projection/              # 阅读投影协调
│   │   │   │   ├── refresher.ex
│   │   │   │   └── subscriber.ex
│   │   │   └── runtime/                 # 小说创作运行时
│   │   │       └── generation_session.ex
│   │   ├── test/
│   │   └── mix.exs
│   │
│   ├── novel_persistence/               # Database Layer
│   │   ├── lib/novel_persistence/
│   │   │   ├── novel_persistence.ex
│   │   │   ├── application.ex
│   │   │   ├── repo.ex
│   │   │   ├── schemas/                 # DB 表 Ecto Schema
│   │   │   │   └── workspace.ex
│   │   │   ├── embedded/                # 嵌入式 Schema（JSON mirror）
│   │   │   │   ├── artifact_adoption_entry.ex
│   │   │   │   └── turn_result.ex
│   │   │   ├── multi/                   # Ecto.Multi 函数集（adoption boundary）
│   │   │   ├── mappers/                 # DB Schema ↔ Domain Model 映射
│   │   │   └── schema_drift.ex          # Schema drift 检查
│   │   ├── priv/repo/migrations/
│   │   ├── test/
│   │   └── mix.exs
│   │
│   └── novel_web/                       # Phoenix API + Channels
│       ├── lib/novel_web/
│       │   ├── novel_web.ex
│       │   ├── application.ex
│       │   ├── endpoint.ex
│       │   ├── router.ex
│       │   ├── controllers/
│       │   │   ├── health_controller.ex
│       │   │   └── error_json.ex
│       │   ├── channels/
│       │   │   ├── user_socket.ex
│       │   │   └── workspace_channel.ex
│       │   ├── plugs/                   # 未来：auth, workspace_scope
│       │   └── serializers/             # JSON 序列化
│       ├── test/
│       └── mix.exs│
├── frontend/                            # 独立 React/TS SPA + Tauri shell
│   ├── src/
│   │   ├── api/
│   │   ├── generated/                   # codegen 自 docs/design-v2/schemas/
│   │   ├── components/
│   │   ├── stores/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── routes/
│   ├── src-tauri/                       # Tauri 2 shell（Rust glue），布局由 ADR-0016 锁定
│   │   ├── src/
│   │   ├── icons/
│   │   ├── capabilities/
│   │   ├── tauri.conf.json
│   │   ├── Cargo.toml
│   │   └── build.rs
│   ├── public/
│   ├── tests/
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── experiments/                         # Python prompt 实验（隔离, 不进 production）
│   ├── pyproject.toml
│   ├── notebooks/
│   ├── prompts/                         # YAML/JSON prompt 模板
│   └── README.md
│
├── tools/                               # 跨语言工具
│   ├── schema_codegen/                  # Elixir + JS codegen scripts
│   ├── migrate_sqlite_to_pg.exs
│   └── seed_demo_workspace.exs
│
├── data/                                # 已存在 SQLite（v1 历史 + 测试）
│
├── config/                              # Mix 配置
│   ├── config.exs
│   ├── dev.exs
│   ├── test.exs
│   ├── prod.exs
│   └── runtime.exs                      # 阶段 1 / 阶段 2 切换
│
├── .github/workflows/                   # CI
├── mix.exs                              # umbrella root
├── pnpm-workspace.yaml                  # pnpm workspace
├── package.json                         # root npm scripts
├── .tool-versions                       # （可选；本机统一走 Homebrew + nvm，不强制 asdf）
├── .gitignore
└── README.md
```

---

## 2. 工具链

目标版本：

```
elixir 1.19.x
erlang 28.x
nodejs  20.x（与本机已安装的更高版本兼容；不强制降级，详见 §2.0）
rust    1.83.0
```

### 2.0 安装路径（按本机环境策略适配）

本仓库不假设统一用 asdf / mise。本机统一策略要求：

- **系统级 CLI 只允许 Homebrew**（`elixir`、`erlang`、`rust` / `rustup`、`pnpm`、`overmind` 走 brew）
- **Node 运行时只允许 nvm**（已存在的 nvm 管理 Node 版本，避免与 Homebrew node 冲突）
- 不允许 `cargo install` / `npm -g` / `curl | sh` 安装工具链

推荐前置安装步骤（**先检查再安装，已存在的版本不重复装**）：

```bash
# 1. Erlang + Elixir（Homebrew）
brew install erlang elixir

# 2. Rust（Homebrew，后续 Tauri build 用）
brew install rustup-init && rustup-init -y

# 3. Node 20.x（nvm；如本机已是 20.x 兼容版本可跳过）
nvm install 20 && nvm use 20

# 4. pnpm（Homebrew）
brew install pnpm
```

> **关于 Node 版本**：本机当前 Node 24.14.1 与文档目标 20.x 不一致。Phase 0 第 1 周必须验证 Vite 6+ / `phoenix` npm client / Tauri CLI 在 Node 24 下是否兼容；若兼容，本节升级目标到 24；若不兼容，团队成员通过 `nvm install 20 && nvm use 20` 切换。**禁止用 Homebrew 装 node 覆盖 nvm**。

> **不推荐 asdf / mise**：与本机 Homebrew + nvm 双轨制冲突，会引入第三套版本管理。如果团队有跨机器统一需求，单独立 ADR 讨论。

### 2.1 Elixir 端

| 工具 | 用途 |
|---|---|
| `mix` | 项目管理（build / test / release） |
| `iex -S mix` | REPL（开发体验关键） |
| `mix format` | 代码格式化 |
| `mix credo` | 静态分析（lint） |
| `mix dialyzer` | 类型检查 |
| `mix test` | 测试 |
| `mix release` | 单二进制构建 |

### 2.2 前端

| 工具 | 用途 |
|---|---|
| `pnpm` | 包管理 + workspace |
| `vite` | dev server + build |
| `tsc --noEmit` | 类型检查 |
| `eslint` | lint |
| `prettier` | 格式化 |
| `vitest` | 单测 |
| `playwright` | E2E |

### 2.3 Tauri

| 工具 | 用途 |
|---|---|
| `pnpm tauri dev` | 本地开发（HMR + sidecar） |
| `pnpm tauri build` | 构建安装包 |
| `cargo` | Rust 端 |

---

## 3. 本地开发 setup

### 3.1 第一次

```bash
git clone <repo>
cd ai-novel-studio

# 工具链按 §2.0 路径预先安装：
#   - Homebrew 装 erlang / elixir / rustup / pnpm
#   - nvm 切到 Node 20.x（或团队验证后的 24.x）
# 不再使用 asdf install。

# Elixir 依赖
mix deps.get
mix deps.compile

# 前端依赖
pnpm install

# 数据库 setup（SQLite 自动创建）
mix ecto.create
mix ecto.migrate

# Schema codegen
mix codegen.schemas
pnpm --filter frontend codegen:schemas
```

### 3.2 日常开发

3 个终端：

```bash
# Terminal 1: Phoenix backend (with iex REPL)
iex -S mix phx.server

# Terminal 2: Vite dev server
pnpm --filter frontend dev

# Terminal 3 (optional): Tauri dev (整合 webview + sidecar)
pnpm tauri dev
```

或者一键启动：

```bash
# Procfile.dev
backend: iex -S mix phx.server
frontend: pnpm --filter frontend dev

# 用 overmind 或 foreman
overmind start -f Procfile.dev
```

### 3.3 环境变量（dev）

```bash
# .env.dev
AI_NOVEL_LLM_MODE=lm_studio
AI_NOVEL_BASE_URL=http://localhost:1234/v1
AI_NOVEL_API_KEY=lm-studio
AI_NOVEL_MODEL=qwen3.5-122b-a10b
AI_NOVEL_TIMEOUT=300

DB_TYPE=sqlite
DB_PATH=./dev.sqlite3
```

---

## 4. 构建与 Release

### 4.1 Mix Release

```bash
MIX_ENV=prod mix release sidecar
# 产出: _build/prod/rel/sidecar/bin/sidecar
```

`mix.exs`:

```elixir
def project do
  [
    apps_path: "apps",
    version: "0.1.0",
    elixir: "~> 1.17",
    deps: deps(),
    releases: [
      sidecar: [
        applications: [
          novel_foundation: :permanent,
          novel_domain: :permanent,
          novel_persistence: :permanent,
          novel_web: :permanent
        ],
        steps: [:assemble, :tar],
        include_erts: true,
        include_executables_for: [:unix, :windows]
      ]
    ]
  ]
end
```

### 4.2 Tauri 安装包

```bash
# 1. 构建前端
pnpm --filter frontend build

# 2. 构建 sidecar
MIX_ENV=prod mix release sidecar --overwrite
mkdir -p tauri/binaries
cp _build/prod/rel/sidecar/bin/sidecar tauri/binaries/novel-studio-sidecar-$(uname -s)-$(uname -m)

# 3. 构建 Tauri
pnpm tauri build
# 产出: tauri/target/release/bundle/{dmg,msi,deb,appimage}/
```

### 4.3 阶段 2 server build

```bash
MIX_ENV=prod mix release server
# 产出: _build/prod/rel/server/bin/server
# 部署到 K8s / Fly.io / 自建机器
```

---

## 5. 测试

### 5.1 测试金字塔

```
        E2E (Playwright)
       /                \
    集成测试 (mix test)
   /                       \
单元测试       Contract 测试
(ExUnit/Vitest) (JSON Schema validate)
```

### 5.2 测试命令

```bash
# Elixir 单测 + 集成
mix test
mix test --only contract       # 仅 contract test
mix test --only integration    # 仅集成测试
mix test --only property       # property-based test

# Dialyzer + Credo
mix dialyzer
mix credo --strict

# 前端单测
pnpm --filter frontend test
pnpm --filter frontend test:contract

# E2E
pnpm --filter e2e test
```

### 5.3 Test database

阶段 1 dev 用 SQLite，但 test 也跑 PG 兼容性测试：

```elixir
# config/test.exs
config :novel_persistence, AINovelStudio.Repo,
  adapter: Ecto.Adapters.SQLite3,
  database: ":memory:",
  pool: Ecto.Adapters.SQL.Sandbox
```

```elixir
# config/test_postgres.exs
# 单独 env 跑 PG 兼容性
config :novel_persistence, AINovelStudio.Repo,
  adapter: Ecto.Adapters.Postgres,
  database: "ainovel_test",
  pool: Ecto.Adapters.SQL.Sandbox
```

CI 同时跑两个：

```bash
mix test                            # SQLite
MIX_ENV=test_postgres mix test     # PostgreSQL
```

---

## 6. CI/CD

### 6.1 GitHub Actions workflow

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  elixir:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        db: [sqlite, postgres]
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        ports: [5432:5432]
    steps:
      - uses: actions/checkout@v4
      - uses: erlef/setup-beam@v1
        with:
          elixir-version: "1.19.x"
          otp-version: "28.x"
      - run: mix deps.get
      - run: mix compile --warnings-as-errors
      - run: mix format --check-formatted
      - run: mix credo --strict
      - run: mix dialyzer
      - run: mix test
        env:
          DB_TYPE: ${{ matrix.db }}
  
  schema-consistency:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: erlef/setup-beam@v1
      - uses: actions/setup-node@v4
      - run: mix codegen.schemas
      - run: pnpm --filter frontend codegen:schemas
      - run: |
          git diff --exit-code apps/novel_persistence/lib/persistence/schemas/
          git diff --exit-code frontend/src/generated/schemas/
  
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - run: pnpm --filter frontend tsc --noEmit
      - run: pnpm --filter frontend lint
      - run: pnpm --filter frontend test
      - run: pnpm --filter frontend build
  
  tauri-build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      # build sidecar + frontend + tauri
      # 产出 release artifact
      # （只在 release tag 时跑完整 build）
```

### 6.2 Release pipeline

- Tag `v0.1.0` → 自动构建多平台 Tauri 包 → 上传到 GitHub Releases
- 阶段 2 server release：自动 build Docker image → push 到 registry → K8s rolling update

---

## 7. 代码风格

### 7.1 Elixir

- 用 `mix format` 自动格式化
- 模块名 `AINovelStudio.Foundation.Provider.Gateway`
- 函数 `snake_case`
- Pattern match > 多 `if`
- 函数文档 `@moduledoc` + `@doc` 必写
- `@spec` 类型注解必写（公开 API）

### 7.2 TypeScript

- Strict mode 必开
- 用 `prettier` + `eslint`
- Component `PascalCase.tsx`
- Hook `useXxx.ts`
- 没有 `any`，没有 `// @ts-ignore`
- `interface` 用于公共 contract，`type` 用于内部

### 7.3 Commit

- Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `test:`）
- PR 必须有描述 + 关联 issue
- Squash merge 默认

---

## 8. Python `experiments/` 隔离

```
experiments/
├── pyproject.toml
├── README.md                            # 边界说明
├── notebooks/
│   ├── 01_prompt_design_writer.ipynb
│   ├── 02_review_eval.ipynb
│   └── ...
├── prompts/                             # 输出物
│   ├── writer_prompt_v3.yaml
│   ├── reviewer_prompt_v2.yaml
│   └── ...
└── eval/
    └── (评测脚本 + 报告)
```

**规则**：

- `experiments/` 是独立 Python 项目（`uv` / `poetry`）
- **产品代码不依赖 Python 文件**
- 输出物只能是 `.yaml` / `.json` / `.md`，由产品代码读取
- 不在 production CI 中跑

---

## 9. 当前 TBD

- 具体 monorepo 工具（Mix umbrella + pnpm workspace 已选 vs Nx 等）
- 跨平台 sidecar build 自动化（GitHub Actions matrix）
- Hot reload 在生产 release 中的开关
- 多版本 Elixir / Erlang 兼容性测试
- 团队代码审查工具（GitHub PR vs Gerrit）
- 是否引入 Type 系统辅助工具（如 Gradient）

以上 TBD 在 Phase 0 中期处理。
