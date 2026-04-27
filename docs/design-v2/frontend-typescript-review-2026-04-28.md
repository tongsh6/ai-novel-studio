# 前端 TypeScript 分析报告

**分析日期**: 2026-04-28
**项目阶段**: Phase 0 Week 2
**文件统计**: 6 个源 .ts 文件, 3 个 .tsx 文件, 2 个生成 .ts, 2 个 JS 配置文件, 0 个 .vue 文件, 0 个源 .js 文件

---

## 1. TypeScript 配置现状

### 当前 tsconfig.app.json（ts 源码编译）

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["ES2023", "DOM"],
    "module": "esnext",
    "types": ["vite/client"],
    "strict": true,           // ✅
    "skipLibCheck": true,     // ✅

    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    // 以下已开
    "noUnusedLocals": true,           // ✅
    "noUnusedParameters": true,        // ✅
    "erasableSyntaxOnly": true,        // ✅
    "noFallthroughCasesInSwitch": true // ✅
  }
}
```

### 状态判断

| 选项 | 状态 | 说明 |
|------|------|------|
| `strict` | ✅ 已开 | 包含 noImplicitAny, strictNullChecks, strictFunctionTypes, strictBindCallApply, strictPropertyInitialization, noImplicitThis, alwaysStrict |
| `noUnusedLocals` | ✅ 已开 | TS 6+ 新选项 |
| `noUnusedParameters` | ✅ 已开 | TS 6+ 新选项 |
| `noFallthroughCasesInSwitch` | ✅ 已开 | |
| `isolatedModules` | ⚠️ 由 `verbatimModuleSyntax` 隐式包含 | `verbatimModuleSyntax` 强制每个文件是独立模块 |
| `noUncheckedIndexedAccess` | ❌ 未开 | 数组/对象索引不检查 undefined |
| `exactOptionalPropertyTypes` | ❌ 未开 | `prop?: T` 可赋 `undefined` |
| `noImplicitOverride` | ❌ 未开 | 类方法 override 不强加 `override` 关键字 |
| `forceConsistentCasingInFileNames` | ❌ 未开 | 文件名大小写不强制 |

### 建议分阶段开启

**第一阶段：立即开启**（零风险，当前代码全部通过）

```json
{
  "forceConsistentCasingInFileNames": true,
  "isolatedModules": true
}
```

`forceConsistentCasingInFileNames` 纯粹是防御性的——macOS 文件系统不区分大小写，但 CI (Linux) 会区分。`isolatedModules` 已被 `verbatimModuleSyntax` 覆盖，显式声明更清晰。

**第二阶段：Phase 1 开启**（当前代码没有类继承和复杂可选属性，不会破坏现有代码）

```json
{
  "noImplicitOverride": true,
  "exactOptionalPropertyTypes": true
}
```

**第三阶段：Phase 2+ 开启**（需要审计现有索引访问模式）

```json
{
  "noUncheckedIndexedAccess": true
}
```

---

## 2. JS 文件排查

### 文件清单

| 文件 | 类型 | 是否应迁移 |
|------|------|-----------|
| `eslint.config.js` | 配置文件 | ❌ 不需要。ESLint flat config 原生支持 `.js`，且 `parserOptions.projectService: true` 已让 ESLint 用 tsconfig 检查 |
| `scripts/codegen-schemas.mjs` | 构建脚本 | ❌ 不需要。Node.js 执行，与前端 bundle 无关。加 `// @ts-check` 注释可提供部分类型检查，但不强制 |

### 结论

**前端已 100% TypeScript 化**。所有源文件都是 `.ts` / `.tsx`。两个 `.js`/`.mjs` 文件是纯配置文件/构建脚本，不属于应用源码，不需要迁移。

---

## 3. any / unknown 使用情况

### 逐文件扫描

| 文件 | 位置 | 模式 | 分类 |
|------|------|------|------|
| `src/lib/socket.ts:9` | `params?: Record<string, unknown>` | Phoenix Socket 连接参数 | 🟢 合理 unknown — Phoenix 外部库的 params 类型就是 `Record<string, unknown>` |
| `src/lib/socket.ts:26` | `echo: Record<string, unknown>` | PingResult 接口 | 🟡 可改进 — ping 返回的 echo 应该是已知结构 |
| `src/lib/socket.ts:29` | `payload: Record<string, unknown>` | ping 函数参数 | 🟡 可改进 — Phase 1 接入真实协议时应收窄 |
| `generated/foundation/turn_result_v2.ts` | 15 处 `z.any()` | codegen 生成的 schema | 🟡 设计意图 — 等待 ADR-0002 等冻结子 schema |
| `generated/foundation/artifact_adoption_entry.ts` | 1 处 `z.any()` (`.catchall`) | codegen 生成的 schema | 🟡 设计意图 |

### 分类统计

| 分类 | 数量 | 处理建议 |
|------|------|---------|
| 必须立即修复的 `any` | **0** | 无 |
| 可以保留但需要 TODO 的 `any` | **16** (全在 generated/) | `generated/` 文件由 `pnpm codegen:schemas` 重写，手编无效。等 ADR 冻结子 schema 后自动解决 |
| 合理使用 `unknown` 的位置 | **3** (socket.ts Phoenix 边界) | 保持。Phoenix params/socket payload 本质上是动态的 |
| 应改为明确类型的位置 | **0** | 无 |

### 关键判断

**当前前端没有任何需要立即修复的 `any` 滥用**。原因很简单：项目还在 Phase 0，业务代码量几乎为零。

`Record<string, unknown>` 在 Phoenix Socket 边界是**正确的类型**——Channel params、push payload、receive response 确实是运行时决定的。Phase 1 接入真实协议时，应该在封装层收窄（例如定义 `PingPayload` 类型）。

`generated/` 中的 `z.any()` **不能手修**——它们是 `json-schema-to-zod` 从设计文档 JSON Schema 派生出来的。JSON Schema 中标记为"由后续 ADR 冻结"的字段会被生成为 `z.any()`。要消除这些，唯一途径是推进 ADR 冻结子 schema，然后重新运行 `pnpm codegen:schemas`。

---

## 4. 类型分层现状与建议

### 当前结构

```
frontend/src/
├── App.tsx                    # 根组件
├── main.tsx                   # 入口
├── index.css                  # 全局样式
├── App.css                    # 根组件样式（空）
├── components/
│   └── ChannelDemo.tsx        # WebSocket 演示组件
├── lib/
│   ├── socket.ts              # Phoenix Socket 封装
│   ├── schemas.ts             # Zod schema 导出桶
│   └── __tests__/
│       ├── socket.test.ts
│       └── schemas.test.ts
└── generated/                 # codegen 产物（不手编）
    └── foundation/
        ├── turn_result_v2.ts
        └── artifact_adoption_entry.ts
```

### 当前状态：没有类型分层，也不需要

项目代码量极少，强制分层是过度设计。当前类型的实际分布：

- **边界类型**：`lib/socket.ts` 中的 `ConnectOptions`, `PingResult` —— 定义在模块内部，紧邻使用方
- **Schema 类型**：`generated/` + `lib/schemas.ts` —— 从 JSON Schema SSOT 派生
- **组件 Props 类型**：`ChannelDemo.tsx` 中无显式 Props 类型（无 props）

### Phase 1 按需引入的结构

当业务代码开始增长时，建议按以下顺序逐步引入类型目录：

```text
# Phase 1 初期 — 只需这个
src/
└── types/
    └── common.ts              # ID, ApiResult<T>, ApiError, Page<T>

# Phase 1 中期 — 当有 3+ 个 feature 时
src/
├── types/
│   ├── common.ts
│   └── domain.ts             # WorkStatus, ChapterStatus 等共享枚举
└── features/
    ├── work/
    │   ├── WorkPanel.tsx
    │   └── types.ts          # WorkDTO, CreateWorkInput
    └── chapter/
        ├── ChapterEditor.tsx
        └── types.ts          # ChapterDTO, ChapterEditorState
```

**原则**：类型跟着功能走。一个 feature 目录内如果类型超过 5 个，再考虑抽 `types.ts`。在此之前，类型可以定义在组件文件内。

---

## 5. API Contract / DTO 类型

### 当前状态：无 API 层

项目目前不通过 HTTP API 通信——只有 WebSocket（Phoenix Channel）。没有 REST endpoint、没有 `fetch`/`axios` 调用、没有 API DTO。

### 什么时候需要 DTO

当以下任一情况发生时：

1. 后端新增了 HTTP endpoint（如 `POST /api/chapters`）
2. 前端需要从 WebSocket message 中解析结构化数据
3. 前后端数据字段名不一致（如后端 snake_case、前端 camelCase）

当前的 `lib/socket.ts` 只是一个传输层封装，不涉及业务数据。

### 推荐 Phase 1 引入的基础类型

```ts
// src/types/common.ts（Phase 1 第一天就需要）

/** 全局唯一 ID（UUID v7 string） */
export type ID = string;

/** 统一 API 错误 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** 统一 API 成功响应包装 */
export interface ApiResult<T> {
  data: T;
}

/** 分页 */
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
```

**不要提前创建**：WorkDTO, VolumeDTO, ChapterDTO 等业务 DTO——等 Phase 1 真正实现对应功能时，按后端实际返回字段创建。避免"我觉得应该会有这些字段"。

---

## 6. AI 生成链路 / 编辑器状态类型

### 当前状态：不存在

项目还没有生成功能、没有编辑器、没有 store。只有 WebSocket ping/pong。

### 什么时候需要

当以下 Phase 1 任务启动时按需定义：

- `GenerationState`：实现"发送消息 → AI 流式生成"功能时
- `ChapterEditorState`：实现章节编辑器时
- `ConversationState`：实现多轮对话时

**关键原则**（提前声明，避免 Phase 1 犯错）：

```text
GenerationState ≠ ChapterEditorState ≠ ConversationState

GenerationState 负责：流式文本、生成状态、错误
ChapterEditorState 负责：草稿文本、已保存文本、脏标记、光标位置
ConversationState 负责：消息列表、输入框状态、发送状态

三者可以在一个页面同时存在，但必须用独立的 state 管理。
禁止 merge 成一个大 store。
```

---

## 7. Store 类型约束

### 当前状态：无 store

项目没有使用任何状态管理库。`ChannelDemo.tsx` 使用 React `useState`（组件局部状态），这是正确的——组件级状态不需要全局 store。

### 什么时候需要 store

- 多个独立组件需要共享同一份状态（如：对话面板 + 结构面板都需要知道当前 workId）
- 状态需要在组件卸载后保留（如：用户切换页面后回来，对话历史还在）

### 推荐方案

Phase 1 优先用 React Context + useReducer（不引入第三方库）。当 Context 数量超过 3 个或出现性能问题时，再评估 Zustand。

```ts
// 示例：Phase 1 可能的 WorkContext
interface WorkContextState {
  currentWorkId: ID | null;
  works: WorkSummary[];
  loading: boolean;
  error: ApiError | null;
}

type WorkContextAction =
  | { type: "SET_CURRENT"; workId: ID }
  | { type: "LOAD_WORKS"; works: WorkSummary[] }
  | { type: "SET_ERROR"; error: ApiError };
```

---

## 8. 前端门禁完整性

### 当前 package.json scripts

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",    // ✅ 类型检查 + 构建
  "lint": "eslint .",                  // ✅ ESLint (含 recommendedTypeChecked)
  "preview": "vite preview",
  "test": "vitest run",                // ✅
  "codegen:schemas": "node scripts/codegen-schemas.mjs"
}
```

### 已存在

| 门禁 | 命令 | 状态 |
|------|------|------|
| 类型检查 | `tsc -b`（在 build 中） | ✅ |
| ESLint | `pnpm lint` | ✅ |
| 测试 | `pnpm test` | ✅ |
| 构建验证 | `pnpm build` | ✅ |
| Schema drift | `pnpm codegen:schemas` + `git diff` | ✅ CI |

### 缺失

| 门禁 | 建议命令 | 说明 |
|------|---------|------|
| 独立 typecheck | `tsc --noEmit` | `build` 中包含 tsc，但独立 typecheck 可以更快（跳过 vite build）。建议加 `"typecheck": "tsc --noEmit"` |
| check 一键 | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | CI 已经拆开跑，本地开发者需要一个简写 |

### 建议修改 `package.json`

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint .",
    "format:check": "prettier --check .",    // Phase 2 引入 prettier 后
    "preview": "vite preview",
    "test": "vitest run",
    "codegen:schemas": "node scripts/codegen-schemas.mjs",
    "check": "pnpm typecheck && pnpm lint && pnpm test"
  }
}
```

（当前没有 prettier，不建议立即引入。Phase 1 中期再评估。）

---

## 9. 依赖边界检查

### 当前状态

6 个源文件，import 关系简单且合理：

```
main.tsx → App.tsx → ChannelDemo.tsx → socket.ts
                                      → schemas.ts → generated/**
```

没有跨层违规——因为根本没有"层"。当前规模不需要 `eslint-plugin-boundaries`。

### Phase 1 推荐规则

当目录结构增长后，在 AGENTS.md 中声明以下规则（不用工具强制执行，人工 review）：

```text
src/types/          — 不允许 import src/features/
src/features/*/     — 不允许 import src/features/other-feature/
src/components/     — 通用组件允许被任何 feature import
src/lib/            — 工具模块允许被任何地方 import
src/generated/      — 不允许被手动 import（通过 lib/schemas.ts 桶统一导出）
```

---

## 10. 立即可以做的事（最小整改）

### 1. 添加 `vite-env.d.ts`

当前缺少 `ImportMetaEnv` 的类型增强。`socket.ts` 中的 `import.meta.env.VITE_WS_ENDPOINT` 需要 `as string` 断言。

```ts
// src/vite-env.d.ts（新建）
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

加了之后可以移除 `socket.ts` 中的 `as string | undefined` 断言。

### 2. 开启 `forceConsistentCasingInFileNames`

修改 `tsconfig.app.json`：

```json
"forceConsistentCasingInFileNames": true
```

### 3. 加 `typecheck` script

修改 `package.json`：

```json
"typecheck": "tsc -b --noEmit",
```

### 4. 代码中使用 `Record<string, unknown>` 加 TODO 注释

`socket.ts` 中的 `Record<string, unknown>` 在 Phase 1 接入真实协议后应收窄为具体类型。当前加注释标记即可。

```ts
// TODO(Phase 1): 收窄为具体业务 payload 类型
export function ping(channel: Channel, payload: Record<string, unknown>): Promise<PingResult> {
```

---

## 11. 整改优先级总结

| 优先级 | 操作 | 预计时间 | 破坏性 |
|--------|------|---------|--------|
| P0 | 创建 `vite-env.d.ts` | 2 分钟 | 无 |
| P0 | 开启 `forceConsistentCasingInFileNames` | 1 分钟 | 无（当前全通过） |
| P0 | 添加 `typecheck` script | 1 分钟 | 无 |
| P1 | `socket.ts` 加 TODO 注释 | 2 分钟 | 无 |
| P2 | 创建 `src/types/common.ts`（ID, ApiResult, ApiError） | Phase 1 第一天 | 无 |
| P2 | 开启 `noImplicitOverride`, `exactOptionalPropertyTypes` | Phase 1 | 可能需小修 |
| P3 | 开启 `noUncheckedIndexedAccess` | Phase 2+ | 可能需要较多修改 |
| P3 | 业务 DTO（WorkDTO 等） | 按需，等后端有对应 endpoint | 无 |
| P3 | Store / EditorState / GenerationState 类型 | 等对应功能实现时 | 无 |

---

*本报告基于 2026-04-28 代码状态。项目处于 Phase 0 极早期，前端几乎没有任何业务代码。TypeScript 化的基础已经很扎实（strict: true + ESLint recommendedTypeChecked + 零 any 滥用）。真正需要关注的类型安全问题会在 Phase 1 开始填充业务代码时出现——只要 AGENTS.md 中的约束被执行，就不会有大的技术债务累积。*
