# AI 编码行为约束

本项目是 Elixir/Phoenix Umbrella + TypeScript/React 前端项目。以下规则适用于所有在此项目中工作的 AI 编码助手。

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
| novel_web | HTTP Router、Controller、Channel、JSON 序列化 | 直接调用 Repo、直接写 Ecto.Query |

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

---

## 前端约束

### 桌面优先（Desktop-First）

本项目是 **Tauri 2 桌面应用**，不是浏览器 Web 应用。阶段 2 才会切到 B/S。

- **开发命令**：使用 `pnpm tauri dev` 启动，不是 `pnpm dev`。Tauri dev 会启动 Vite + 原生窗口。
- **环境检测**：所有涉及 URL/端点的代码必须通过 `frontend/src/lib/env.ts` 的 `isTauri` 判断，不允许假设运行在浏览器。
- **Tauri API 必须使用**：文件系统访问、系统通知、窗口管理必须使用 `@tauri-apps/api`，不允许使用浏览器 API 替代。
- **禁止浏览器专用 API**：不允许直接使用 `window.location.*`、`document.title`、`navigator.*`（除非通过 `env.ts` 的平台抽象层）。
- **Tauri 配置必须与 spec 一致**：`tauri.conf.json` 的窗口大小（1280×800）、identifier（`com.ai-novel-studio.app`）、CSP、sidecar 配置必须与 `docs/design-v2/tech-stack/05-desktop.md` 一致。
- **CI 必须验证 Tauri 构建**：`pnpm tauri build` 必须成功。

参考：`docs/design-v2/tech-stack/05-desktop.md`（Tauri 2 + Mix Release sidecar 完整方案）

### UI 设计驱动（Design-Driven）

UI 实现必须严格遵循 `docs/design-v2/ui-design/` 中的设计文档和 Pencil 原型。

- **写 UI 代码前**：必须先查看对应的 Pencil 原型 screen frame（`docs/design-v2/ui-design/novel-studio-v2.pen`）和设计文档章节。
- **组件必须可追溯**：每个组件文件头部必须有注释，标注对应的设计文档章节和原型 screen frame ID。格式：
  ```
  // Design: docs/design-v2/ui-design/42-card-system.md §3
  // Prototype: novel-studio-v2.pen → 42§4-adoption-card-states (PZAVY)
  ```
- **卡片类型必须来自 ADR**：`card_type` 必须使用 ADR-0006 已冻结集合，不允许前端自行发明新卡片类型。
- **文案必须集中管理**：所有用户可见文案必须放在 `frontend/src/lib/copy.ts`，不允许在组件中硬编码。参考 `docs/design-v2/ui-design/47-ui-copy-guidelines.md`。
- **禁止内联样式**：不允许 `style={{...}}`，使用 Tailwind CSS 4 或 CSS Modules（优先 Tailwind）。
- **设计 token 必须对齐**：颜色、间距、字体必须与 `docs/design-v2/ui-design/40-ui-overview.md` 中的设计 token 一致。

### 前端技术栈（强制）

以下技术栈由 `docs/design-v2/tech-stack/04-frontend.md` 锁定，不允许自行替换：

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

如果这 5 项答不上来，先补 slice 设计，不要编码。

### 本项目默认承重主链

```text
Turn 输入
→ intent / policy / capability 判定
→ turn phase/status 状态推进
→ application 编排
→ agent / domain / persistence 边界调用
→ TurnResult v2 输出
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

## 项目文档

- 设计文档：`docs/design-v2/`（权威，代码必须遵循）
- ADR：`docs/design-v2/adr/`（已冻结的决策）
- JSON Schema SSOT：`docs/design-v2/schemas/`
- 技术栈：`docs/design-v2/tech-stack/`
- 工程实践：`docs/engineering/`
