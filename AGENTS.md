# AI 编码行为约束

本项目是 Elixir/Phoenix Umbrella + TypeScript/React 前端项目。以下规则适用于所有在此项目中工作的 AI 编码助手。

---

## git
### commit message 规范
使用中文 message，使用以下格式：
<type>: <subject>
- feat: 新增功能
- fix: 修复 bug
- docs: 仅文档变更
- style: 代码格式（不影响功能，例如空格、分号等）
- refactor: 代码重构（既不是新增功能，也不是修复 bug）
- perf: 性能优化
- test: 添加或修改测试
- chore: 其他修改（构建过程或辅助工具的变动）

## 场景化验收红线

承重 slice 的验收标准是：**由外部自动化驱动真实页面的场景化验收**。外部自动化可以使用 Playwright/Tauri/系统 UI 驱动，但必须站在产品之外，像用户一样操作当前真实入口。

产品代码不得为了验收而感知、识别或配合验收场景：

- 禁止在 `frontend/src`、`apps/*/lib` 等生产路径中读取验收专用 env、slice id、URL query、localStorage 或其它开关来改变产品行为。
- 禁止在生产 UI 中内置自动输入、自动点击、自动切换、自动采纳、自动上报 UI 状态等验收逻辑。
- 禁止为了验收添加产品不可见的 DOM hook、隐藏 metadata、`data-testid`、slice 专用 `data-*`、验收专用 Channel/API 事件。
- 禁止把验收 provider、fake provider、script provider 注册进生产 app/runtime。验收替身只能位于 test/support、脚本或外部 harness，并通过测试/脚本环境显式注入。
- 外部自动化应优先使用用户可见语义：role、label、placeholder、按钮文案、页面可见文本，以及网络帧、日志、截图、持久化结果等外部证据。

这不是字符串黑名单。真实产品语义可以出现 `verify`、`data-*`、状态字段或测试相关词，但必须能说明它服务真实用户、真实产品状态或可访问性/样式/组件语义，而不是服务验收脚本。判断标准是行为边界和意图，不是简单命名。

详细规则和模板见 [docs/engineering/scenario-acceptance.md](docs/engineering/scenario-acceptance.md)。

---

## 架构约束

### Umbrella 依赖方向（编译期强制，违反即编译失败）

```
novel_web → novel_application → {novel_agent, novel_domain}
novel_agent → novel_foundation
novel_domain → novel_foundation
```

- novel_foundation 不能依赖任何其他 umbrella app
- novel_domain 不能依赖 novel_agent / novel_persistence / novel_web
- novel_agent 不能依赖 novel_domain / novel_application
- novel_web 不能依赖 novel_persistence / novel_agent

### 各 app 职责边界

| App | 允许 | 禁止 |
|-----|------|------|
| novel_foundation | 纯函数工具、Result/Error 类型、ID 生成 | GenServer、Supervisor、Registry、Ecto、业务概念 |
| novel_domain | 纯 struct + 纯函数、领域规则、领域事件 | GenServer、Repo、Ecto、Phoenix、任何 I/O |
| novel_agent | Agent 运行时、Provider Gateway、监督树、Registry | 引用 NovelDomain / NovelApplication |
| novel_application | 用例编排、上下文组装、Prompt 构建、领域注册 | 引用 NovelWeb |
| novel_persistence | Ecto Repo、DB Schema、Migration、Repository | 引用 NovelWeb / NovelApplication / NovelAgent |
| novel_web | HTTP Router、Controller、Channel、JSON 序列化 | 直接调用 Repo、直接写 Ecto.Query、直接引用 novel_persistence |
| novel_common | 纯函数通用工具，不持有业务状态 | 引用 novel_foundation 以外的模块 |
| novel_test | 跨 app 测试共享 helper | 生产代码依赖它 |
| novel_e2e | 端到端集成测试，只依赖 novel_web | 直接引用 NovelPersistence / NovelAgent / NovelApplication 内部模块 |

### E2E 边界规则（novel_e2e）

novel_e2e 只依赖 novel_web（顶层入口）。测试从 Channel 或 DialogueGateway 入口进入，不直接引用 downstream app 的内部模块。

- **允许**：`NovelApplication.DialogueGateway`、`NovelApplication.ReplayService`（公开入口）
- **禁止**：`NovelPersistence.*`、`NovelAgent.*`、`NovelApplication.Planner/ExecutionOrchestrator/ContextAssembler/...`（内部模块）

检查机制：`mix run scripts/arch_check.exs` 自动扫描 novel_e2e 源码。

---

## 编码规范

维度化编码规范见 [docs/coding-standards/index.md](docs/coding-standards/index.md)。新增或调整规范维度只需修改该目录下的文件，无需修改本文件。|

### 开始前必须做

1. 阅读目标 app 的 `mix.exs` 了解依赖关系
2. 阅读同目录已有模块，了解现有代码风格
3. 运行 `mix compile` 确认当前状态可编译

### 完成后必须做

**后端**：
1. `mix compile --warnings-as-errors` — 零警告
2. `mix test` — 全部通过
3. `mix xref graph --format cycles --label compile-connected --fail-above 0` — 无循环
4. `mix run scripts/arch_check.exs` — 架构边界正常
5. 为新模块写测试

**前端**：
6. `cd frontend && pnpm typecheck && pnpm lint && pnpm test` — 零错误
7. `bash scripts/frontend_audit.sh` — 依赖与技术栈合规
8. `bash scripts/check_design_trace.sh` — 组件可追溯到设计文档

**提交说明**：
9. 说明：修改了什么、为什么这样改、影响范围、验证方式

### AI 静态扫描闭环

每次 AI 完成功能实现后，必须执行统一扫描入口：

```bash
bash scripts/ai_static_scan.sh --top 10
```

AI 必须基于 `artifacts/static-scan/top10.md` 和 `artifacts/static-scan/report.json` 完成闭环：

1. 优先修复 P0/P1 问题，以及本次改动文件中的 P2 问题
2. 无法安全修复的问题必须说明原因、影响范围和后续处理建议
3. 修复后必须复跑 `bash scripts/ai_static_scan.sh --top 10`
4. 最终汇报必须包含：执行命令、已修复问题、剩余 Top 10、处置状态、验证结果

扫描报告分两个维度维护：

- `artifacts/static-scan/top10.md`：本次扫描出的 Top N 问题
- `artifacts/static-scan/disposition.md`：Top N 的处置视图，合并 `reports/static-scan/dispositions.json` 中的长期处置台账

快速本地验证可使用：

```bash
bash scripts/ai_static_scan.sh --top 10 --quick
```

### 场景化验收不变量（机器强制）

[场景化验收红线](#场景化验收红线)的可机器验证版本见 [docs/engineering/scenario-invariants.md](docs/engineering/scenario-invariants.md)，落地为三条 0/1 不变量，**全部已落地、CI 强制**：

- **I3 种子贯通**：用户输入中的随机标识符必须出现在最终 user-facing artifact 内容字段（抓 hardcoded 创作内容）
- **I1 因果绑定**：artifact item 的 title/body/rationale 必须精确字节相等于 Provider 调用响应中同 item_id 的字段（抓字节修补/补齐/合并）
- **I2 输入差异**：N 个语义独立输入产出的 artifact item_id 集合两两不相交（抓按输入分支预制 hardcoded）

完成涉及主链 / 工具 / TurnResult / artifact 的任何改动后，必须执行：

```bash
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
```

任一 driver 退出码非 0 → 改动不可提交。**禁止使用 `--no-verify`、注释 disable directive、修改不变量规则脚本等方式绕过**。

唯一允许的豁免路径：在 `docs/engineering/scenario-invariants.md` 增加 Exceptions 节明确登记 + PR 审核通过。

违规修复方向由 driver 报告 `artifacts/scenario-invariants/{i1,i2,i3}.md` 给出，AI 必须按其中 "修复方向" 字段处理，不允许自行发明绕路。

CI 在 `.github/workflows/ci.yml` 已加三条 step（I3 / I1 / I2），PR 触发后强制运行。三条形成捕获网：单一伪造手段最多绕过其中一条，要全部绕过的复杂度已等价于实现一个真实 LLM。

---

## 前端约束

### 桌面优先（Desktop-First）

本项目是 **Tauri 2 桌面应用**，不是浏览器 Web 应用。阶段 2 才会切到 B/S。

- **开发命令**：使用 `pnpm tauri dev` 启动，不是 `pnpm dev`。Tauri dev 会启动 Vite + 原生窗口。
- **环境检测**：所有涉及 URL/端点的代码必须通过 `frontend/src/lib/env.ts` 的 `isTauri` 判断，不允许假设运行在浏览器。
- **Tauri API 必须使用**：文件系统访问、系统通知、窗口管理必须使用 `@tauri-apps/api`，不允许使用浏览器 API 替代。
- **禁止浏览器专用 API**：不允许直接使用 `window.location.*`、`document.title`、`navigator.*`（除非通过 `env.ts` 的平台抽象层）。
- **Tauri 配置必须与 spec 一致**：`tauri.conf.json` 的窗口大小（1280×800）、identifier（`com.ai-novel-studio.app`）、CSP、sidecar 配置必须与 `docs/design/tech-stack/05-desktop.md` 一致。
- **CI 必须验证 Tauri 构建**：`pnpm tauri build` 必须成功。

参考：`docs/design/tech-stack/05-desktop.md`（Tauri 2 + Mix Release sidecar 完整方案）

### UI 设计驱动（Design-Driven）

UI 实现必须严格遵循 `docs/design/ui/` 中的设计文档和 Pencil 原型。

- **写 UI 代码前**：必须先查看对应的 Pencil 原型 screen frame（`docs/design/ui/novel-studio.pen`）和设计文档章节。
- **组件必须可追溯**：每个组件文件头部必须有注释，标注对应的设计文档章节和原型 screen frame ID。格式：
  ```
  // Design: docs/design/ui/42-card-system.md §3
  // Prototype: novel-studio.pen → 42§4-adoption-card-states (PZAVY)
  ```
- **卡片类型必须来自当前 UI contract**：`card_type` 必须使用 `docs/design/07-workbench-ui-contract.md` §4 与 `docs/design/contracts/VS-05-ui-roundtrip-contract-pack.md` §4 的当前集合，不允许前端自行发明新卡片类型。
- **文案必须集中管理**：所有用户可见文案必须放在 `frontend/src/lib/copy.ts`，不允许在组件中硬编码。参考 `docs/design/ui/47-ui-copy-guidelines.md`。
- **禁止内联样式**：不允许 `style={{...}}`，使用 Tailwind CSS 4 或 CSS Modules（优先 Tailwind）。
- **设计 token 必须对齐**：颜色、间距、字体必须与 `docs/design/ui/40-ui-overview.md` 中的设计 token 一致。

### 前端技术栈（强制）

以下技术栈由 `docs/design/tech-stack/04-frontend.md` 锁定，不允许自行替换：

| 类别 | 强制使用 | 禁止使用 |
|------|---------|----------|
| 样式 | Tailwind CSS 4 | styled-components, CSS-in-JS |
| UI 原语 | Radix UI (headless) | 裸写 div/button 实现 Dialog/Tabs/Tooltip |
| Server state | TanStack Query | 在 React state 中持有 server 数据拷贝 |
| UI state | Zustand | Redux, Jotai |
| 表单 | React Hook Form + Zod resolver | 裸写 form state |
| 图标 | Lucide | 其他图标库 |
| Schema | Zod 4 + codegen | 手写 TypeScript type |

- **依赖检查**：`scripts/frontend_audit.sh` 会检查 `package.json` 是否包含所有强制依赖，作为 pre-commit hook 和 CI 门禁。
- **禁止引入非 spec 库**：未经 ADR 流程，不允许安装 spec 之外的状态管理/样式/UI 库。

---

## 设计原则

- **YAGNI**：只加当前需要的代码，不提前设计未来可能需要的抽象
- **KISS**：优先简单直接的方案，不引入不必要的间接层
- **测试优先保护核心**：业务规则必须有测试，IO/边界层可适度放宽
- **最小改动**：只改任务要求的范围，不做无关重构

---

## 承重竖切面（试行）

项目初期的目标是建立可持续发展的承重结构。功能开发默认按**承重竖切面**组织，而不是按 DB / API / UI / Agent 等横向层单独交付。

承重竖切面规则见 [docs/engineering/vertical-slice.md](docs/engineering/vertical-slice.md)。执行层任务放在 [tasks/slices/](tasks/slices/)。

### 开始编码前必须回答

任何开发任务开始编码前，AI 必须先说明：

1. **Contract**：本 slice 固化或消费哪个契约、schema、ADR、状态字段？
2. **Invariant**：本 slice 保护哪个系统不变量？
3. **Boundary**：本 slice 切穿哪些真实 app 边界？哪些 app 明确不应修改？
4. **Consumer**：第一个真实消费者是谁？Channel、Frontend、Application test、Projection builder 或其他？
5. **Proof**：用什么测试或命令证明链路和不变量成立？
6. **Acceptance Driver**：由哪个外部自动化脚本驱动真实页面完成场景化验收？产品代码是否新增任何验收感知逻辑（默认必须为 no；若不是 no，必须说明它为何是真实产品能力而非验收钩子）？

如果这 6 项答不上来，先补 slice 设计，不要编码。

### Slice 完成标准：外部自动化驱动真实页面

每完成一个 slice，都必须能由外部自动化驱动真实页面完成场景化验收，这是承重竖切面的核心价值。后端测试、组件测试、API helper 测试只能作为局部证据，不能单独证明 slice 完成。

- 默认页面入口是当前真实产品入口（例如 `App.tsx -> WorkspaceChat` / Tauri 工作台），不是旁路 demo 组件、Storybook、孤立组件或脚本专用页面。
- Proof 必须说明外部脚本如何触发这条链路：点击、输入、切换、确认、采纳或查看状态。
- 场景化验收必须像用户一样操作 UI，并穿过真实主链：Frontend 用户操作 → socket/API 请求 → web/channel/controller → application 编排 → domain/agent/persistence → TurnResult/task_state/projection/trace → 前端可见反馈。
- 不算完成验收：直接调用后端模块、直接 push Channel payload、只测 socket helper、只测组件 render、只用 mock 文档描述、让产品代码内置自动化或上报验收状态。
- 自动化可以使用 Playwright/Tauri 脚本；人工 walkthrough 可以作为临时证据，但长期应沉淀为 `scripts/slice_verify.sh <slice-id>` 这类可重复脚本，并输出截图/日志/网络帧到 `artifacts/slice-verify/<slice-id>/`。接手时先运行 `bash scripts/slice_verify.sh --list` 查看已有 slice 验证。
- 如果当前 slice 因基础设施限制暂时无法由外部自动化驱动真实页面验收，必须标记为“未闭环”，说明缺哪个入口、事件、状态投影或 UI 自动化，而不能写 done。
- 每个 slice 的最终汇报必须区分：外部自动化驱动真实页面的验收、后端/Channel/组件局部验证、尚未闭环的缺口。

### 最小实现步不能缩小 slice 范围

允许把一个承重 slice 拆成多个最小实现步，但最小实现步只能作为执行 checkpoint，不能替代 AU/SU/GAP 文档中的完整验收范围。

- 最小实现步必须引用既有规划、acceptance 文档、GAP 编号或 slice 任务清单，不能由 AI 现场发明范围。
- 必须说明该 checkpoint 属于哪个完整闭环，以及距离完整闭环还缺哪些计划内后果。
- 未覆盖 persistence、trace、projection、UI 验证等规划内后果时，不能写“本次不做/范围外”；只能写“下一 checkpoint”或“未闭环缺口”。
- 只接 handler/helper/service、只跑局部测试、只证明 happy path 的 checkpoint 不能标 slice done。
- 最小实现步的目的只是降低一次改动风险，不是降低验收标准。

### 本项目默认承重主链

```text
Turn 输入
→ intent / policy / capability 判定
→ turn phase/status 状态推进
→ application 编排
→ agent / domain / persistence 边界调用
→ TurnResult / TurnResultViewModel 输出
→ ui_card / action / adoption / projection 消费
→ memory / audit / replay 留痕
```

slice 可以只覆盖其中一段连续链路，但必须形成可执行闭环，并且至少有一个真实消费者。

### 禁止任务形态

- 只建表、schema、migration
- 只写 controller/channel
- 只搭 UI 壳
- 只加 provider/repository/service 抽象
- 只创建未来会用的模块
- 只实现 happy path 但没有状态、契约、不变量测试

每个新增模块、函数、字段、组件都必须能回答：

- 属于哪个 slice？
- 服务哪个 contract？
- 保护哪个 invariant？
- 被哪个 consumer 调用？

---

## 项目知识结构（SSOT）与禁止自建

本项目的文档、任务、证据已有唯一体系。**任何 AI 或外部工具进入本项目，必须把产物落到下表既有位置，禁止自建平行体系。** 这是入场即生效的硬约束，违反即视为引入孤岛。

### 唯一落点表

| 你要落的东西 | 唯一位置 | 入口/规则 |
|---|---|---|
| 设计、运行时、状态、UI 设计 | `docs/design/` | `docs/design/README.md`（当前唯一设计真源，禁止新建版本化目录） |
| ADR（冻结决策） | `docs/design/adr/` | 当前唯一 ADR 目录 |
| Contract pack / spec | `docs/design/contracts/` | 契约冻结前文档 |
| JSON Schema / enum SSOT | `docs/design/schemas/` | codegen 源 |
| 验收设计 | `docs/design/acceptance/` | 场景化验收 |
| 技术栈 | `docs/design/tech-stack/` | — |
| 工程实践规则 | `docs/engineering/` | vertical-slice、scenario-invariants 等 |
| 讨论备忘 / 运行经验（不授权实现） | `docs/design/notes/` | 唯一 notes 落点 |
| 任务、计划、进度、决策日志、恢复指引 | `tasks/` | `tasks/README.md`；开工前必读 `tasks/NEXT.md` |
| 承重竖切面任务 | `tasks/slices/` | slice 开工检查与验证 |
| 质量**运行体系**（gates / invariants / acceptance manifest / scenarios） | `quality/` | `quality/README.md`；被 `scripts/quality_*.sh`、`scenario_invariants` 消费 |
| 长期处置台账（如 static-scan baseline / disposition） | `reports/` | `reports/static-scan/`；被静态扫描闭环引用 |
| 技术选型**可复跑验证代码**（独立 mix spike） | `spikes/` | 被 `docs/design/tech-stack/verification/` 引用；不参与产品 umbrella build |
| 产品体验**人工走查报告**（real LLM + GUI 自动化截图 + 观感） | `walkthroughs/<date>/` | `walkthroughs/README.md`；走查发现须按 `docs/project-ledger.md` §规则登记 |
| 运行/验收/扫描/狗粮**证据产物** | `artifacts/`（已 gitignore） | 只放机器产出的证据，不放设计或任务文档 |
| 作者本人想法 / 手记 | `notes/`（顶层） | 作者私人笔记，非 AI 工作产物，AI 不在此落任何东西 |

> 角色辨析（看名字易混，实为不同层）：`docs/design/quality/` = 质量门禁**设计**；`quality/` = 质量**运行体系**；`artifacts/` = 单次运行**证据**；`reports/` = 跨次**处置台账**。四者不是重复，不要互相合并或复制。

### 禁止事项

- **禁止新建平行的 plans / specs / notes / tasks / docs 目录或工具专属知识树。** 已知反例：`.sisyphus/`、`docs/superpowers/`、顶层 `notes/`、顶层 `quality/`、`artifacts/task-done/` 属历史孤岛，待收编，不得新增同类。
- 带入外部 AI 工具（其自带 plan/spec/memory 约定）时，必须把其产物重定向到上表既有位置，不得让工具在仓库根或 docs 下另起目录。
- 设计引用一律用 `docs/design/...`；不得引用已删除的 `docs/design-v2/` `docs/design-v3/` 旧路径。
- 临时/运行产物（`*.sqlite3`、`/tmp`、`/log`、`/cover`、`/artifacts/**`）已由 `.gitignore` 覆盖，不要提交，也不要在别处复制一份。

新增任何文档前，先在上表找到它该去的唯一位置；找不到对应类别，说明它可能不该存在，先问，不要自创目录。

### 目录可达性规则（防孤岛的机器可检查标准）

孤岛 = **从 `AGENTS.md` 出发、沿引用链 AI 索引不到的文件**。一个文件再有价值，若 AI 进项目后走不到它，就等于不存在，于是 AI 重新造一份——这是"每个 AI 自搞一套"的根因。

强制标准：

1. **每个被承认的目录必须有自己的 `README.md`（或 `index.md`）作为索引节点**，即使父级已提及该目录。无索引节点的目录视为不可达。
2. 索引节点必须**逐个列出本目录的文件/子目录并说明角色**，不能是空壳——要让进入该目录的 AI 知道读什么、主次如何。
3. 可达链：`AGENTS.md` → 上表目录 → 该目录 `README` → README 列出的文件。**任一跳断（目录无 README，或 README 漏列某文件），下游即孤岛。**
4. 新增文件时，必须同步把它登记进所在目录的 `README`；新增目录时，必须同时建该目录的 `README` 并从父级链入。

例外：`*/deps/`、`node_modules/`、构建产物等第三方/生成目录不适用本规则。
