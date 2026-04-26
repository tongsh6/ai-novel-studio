# Frontend 前端栈

> 状态：草案
>
> 目的：定义 React/TS 前端栈、关键组件、与后端 contract 的投影方式。本文档不展开具体 UI 设计（那些在 `../ui-design/` 目录），只回答"前端用什么技术实现"。

---

## 1. 总览

```yaml
language:        TypeScript 5.x
framework:       React 19+
build:           Vite 6+
state_server:    TanStack Query (server state)
state_client:    Zustand (UI state)
schema:          Zod 4 (runtime + compile-time)
ws_client:       phoenix npm package (Phoenix Channels)
ui_primitives:   Radix UI (headless)
styling:         Tailwind CSS 4
icons:           Lucide
forms:           React Hook Form + Zod resolver
testing:         Vitest + React Testing Library + Playwright
package:         pnpm (workspace)
```

---

## 2. 选型理由

### 2.1 React 19+

| 优势 | 备注 |
|---|---|
| 生态厚度 | UI 组件库选择最多，Radix UI / shadcn/ui 等成熟 |
| Suspense / Concurrent | 流式 LLM 输出、streaming card 投影顺手 |
| Server Components（可选） | 阶段 2 web 形态可考虑 Next.js / Remix，但本栈先不绑定 |
| 招人池 | 顶配 |
| Tauri 支持 | Tauri 2 对 React 一等公民 |

为什么不选别的：

- **Vue 3**：生态不如 React，Tauri 模板较少
- **Svelte 5**：runes 表达 state 顺手，但社区 < React
- **SolidJS**：性能优秀但生态小
- **Compose Web**（Kotlin）：alpha，不适合长期形态

### 2.2 TypeScript 5.x

- Strict mode 必开
- `Literal` + `discriminated union` 表达 ADR-0001 14+5 字段足够
- 与 Zod 形成"编译期 + 运行时双重保证"

### 2.3 Vite 6+

| 优势 | 备注 |
|---|---|
| 启动快 | 单机 alpha 期开发体验金牌 |
| HMR 干净 | React Fast Refresh 支持完整 |
| 生态成熟 | 各类插件（Tauri / SVG / WASM）都有 |

### 2.4 TanStack Query（server state）

- 自动 caching + revalidation
- 与 Phoenix Channels 配合做"server push + query invalidation"
- 处理 ADR-0011 reading projection refresh 的 stale 状态自然

### 2.5 Zustand（UI state）

- 用于纯 UI 状态（drawer 打开/关闭、focused card 等）
- 不用 Redux：本项目 server state 主要走 TanStack Query，本地 UI state 用 Redux 太重
- 不用 Jotai/Recoil：Zustand 更直接

### 2.6 Zod 4

- 运行时校验 + TypeScript type 自动推断
- ADR-0001 schema 的前端 SSOT
- React Hook Form 用 `@hookform/resolvers/zod` 直接接入

### 2.7 Radix UI + Tailwind CSS

- Radix 提供 unstyled accessible primitives（Dialog / Dropdown / Tabs / Tooltip 等）
- Tailwind 提供 utility class
- shadcn/ui 是 Radix + Tailwind 的预制组件集合，可作为起步参考

### 2.8 Phoenix JS client（npm package `phoenix`）

Phoenix Channels 官方 JS 客户端，npm 包名是 `phoenix`，提供：

- 自动重连
- Channel 抽象（topic + event + payload）
- Presence 跨用户在线状态（阶段 2 多作者协作有用）

---

## 3. 关键架构纪律

### 3.1 UI 不发明语义

[`../00e-architecture.md`](../00e-architecture.md) §10 反模式 #7：UI 不能发明语义。具体到前端代码：

- 卡片类型必须从 ADR-0006 已冻结集合中选（`clarification_card` / `confirmation_card` / `warning_card` / `checkpoint_card` / `tentative_artifact_card` / `adoption_card` / `long_run_progress_card`）
- `next_action` 必须从 ADR-0002 已冻结集合中选
- `card.status` 等于后端 `card_state.value`
- 不能在前端造新 intent，必须由 Router 决策

### 3.2 schema codegen，不手写

后端 `docs/design-v2/schemas/*.json` 是 SSOT，前端用 codegen 生成 Zod schema + TS type。详见 [`09-schema-codegen.md`](./09-schema-codegen.md)。

```ts
// 不允许手写：
// type TurnResult = { turn_id: string; ... }

// 必须 codegen：
import { TurnResult, TurnResultSchema } from "@/generated/schemas/turn_result";
const turnResult = TurnResultSchema.parse(rawResponse);
```

### 3.3 server state vs UI state 分离

- server state（TurnResult / Cards / Projection）→ TanStack Query
- UI state（drawer / modal / focused card）→ Zustand
- 不在 React state 里持有 server data 拷贝

### 3.4 Reading View 只读 Projection

`../00e-architecture.md` §10 反模式 #2：UI 不能直接读 Domain Stores。  
前端读取 `reading_projection_*` 表（通过 API），**不读** `domain_object` / `continuity_object` / `style_object`。

### 3.5 流式输出

LLM 流式响应通过 Phoenix Channel push 到前端：

```ts
channel.on("turn:streaming", (payload) => {
  const event = StreamingEventSchema.parse(payload);
  // append to streaming buffer
});

channel.on("turn:streaming_done", (payload) => {
  const result = TurnResultSchema.parse(payload);
  // commit to TanStack Query cache
  queryClient.setQueryData(["turn", turnId], result);
});
```

---

## 4. 目录结构

```
frontend/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── src/
│   ├── api/
│   │   ├── client.ts                    # phoenix npm client + fetch wrapper
│   │   ├── socket.ts                    # Phoenix Socket
│   │   └── channels/
│   │       ├── workspace.ts
│   │       ├── turn.ts
│   │       └── projection.ts
│   ├── generated/
│   │   ├── schemas/                     # codegen from docs/design-v2/schemas/
│   │   │   ├── turn_result.ts
│   │   │   ├── card.ts
│   │   │   ├── adoption_state.ts
│   │   │   └── ...
│   │   └── types/
│   │       └── api.ts                   # OpenAPI codegen
│   ├── components/
│   │   ├── cards/                       # ADR-0006 card system
│   │   │   ├── ClarificationCard.tsx
│   │   │   ├── ConfirmationCard.tsx
│   │   │   ├── CheckpointCard.tsx
│   │   │   ├── AdoptionCard.tsx
│   │   │   └── LongRunProgressCard.tsx
│   │   ├── workbench/                   # ../ui-design/41
│   │   │   ├── ConversationStream.tsx
│   │   │   ├── CardStream.tsx
│   │   │   └── TopBar.tsx
│   │   ├── reading/                     # ../ui-design/44
│   │   │   ├── ReadingView.tsx
│   │   │   ├── TocNavigation.tsx
│   │   │   └── ChapterContent.tsx
│   │   ├── structure_panel/             # ../ui-design/43
│   │   │   ├── WorkPanel.tsx
│   │   │   ├── VolumeTreePanel.tsx
│   │   │   ├── CharacterPanel.tsx
│   │   │   ├── ForeshadowingPanel.tsx
│   │   │   └── TimelinePanel.tsx
│   │   └── primitives/                  # Radix + Tailwind 包装
│   ├── stores/
│   │   ├── ui.ts                        # Zustand UI state
│   │   ├── workspace.ts                 # Current workspace/work/volume context
│   │   └── settings.ts                  # User preferences (theme, etc.)
│   ├── hooks/
│   │   ├── useTurn.ts                   # TanStack Query
│   │   ├── useProjection.ts
│   │   ├── useChannel.ts                # Phoenix Channel hook
│   │   └── useStreaming.ts
│   ├── lib/
│   │   ├── auth.ts                      # device key (Stage 1) / OAuth (Stage 2)
│   │   ├── env.ts                       # API base URL detection (Tauri vs Web)
│   │   └── format.ts
│   └── routes/                          # TanStack Router or React Router
│       ├── workbench.tsx
│       ├── reading.tsx
│       └── settings.tsx
├── public/
└── tests/
    ├── unit/
    └── e2e/
```

---

## 5. 阶段 1（Tauri）vs 阶段 2（Web）的差异

前端代码 100% 共享，**只换部署形态 + 几个环境变量**：

| 维度 | 阶段 1 (Tauri) | 阶段 2 (Web) |
|---|---|---|
| 入口 | `vite build --base ./` + Tauri 嵌入 | `vite build` + 部署到 CDN |
| API base URL | `http://localhost:4000` (sidecar) | `https://api.example.com` |
| WebSocket URL | `ws://localhost:4000/socket` | `wss://api.example.com/socket` |
| 认证 | Device key（Tauri Secure Storage 取） | OAuth/SSO 或 JWT |
| 文件系统访问 | Tauri `@tauri-apps/api/fs` | 浏览器原生（受限）|
| 通知 | Tauri 系统通知 | Web Notifications API |
| 多窗口 | Tauri WebviewWindow | 浏览器多 tab |

环境检测：

```ts
// src/lib/env.ts
export const isTauri = "__TAURI__" in window;

export const apiBaseUrl = isTauri
  ? "http://localhost:4000"   // Tauri sidecar
  : import.meta.env.VITE_API_BASE_URL;

export const wsBaseUrl = isTauri
  ? "ws://localhost:4000/socket"
  : import.meta.env.VITE_WS_BASE_URL;
```

---

## 6. 与 ui-design/ 文档的关系

`docs/design-v2/ui-design/40-47.md` 是 **UI 语义层**（设计契约）。  
本目录 `04-frontend.md` 是 **UI 实现层**（技术栈）。

| ui-design 文档 | 本前端栈对应组件 |
|---|---|
| `40-ui-overview.md` | `App.tsx`、`routes/` |
| `41-workbench-layout.md` | `components/workbench/` |
| `42-card-system.md` | `components/cards/` |
| `43-structure-panel.md` | `components/structure_panel/` |
| `44-reading-mode.md` | `components/reading/` |
| `45-guided-conversation-flows.md` | 跨多个 components 的引导流 |
| `46-state-and-feedback.md` | `hooks/useStreaming.ts` + 各组件 loading state |
| `47-ui-copy-guidelines.md` | `lib/copy.ts` 文案常量 |

---

## 7. 测试策略

| 层 | 工具 | 范围 |
|---|---|---|
| 单元 | Vitest | utility 函数、纯组件 |
| 组件 | React Testing Library | UI 组件交互、accessibility |
| Schema | Zod parse 测试 | codegen 产出与后端 schema 一致 |
| E2E | Playwright | 关键用户流（建立 work、写章、阅读） |

E2E 测试在两形态下都跑：

- 阶段 1：Tauri build + Playwright Tauri driver
- 阶段 2：常规 web Playwright

---

## 8. 当前 TBD

- 具体路由库选型（TanStack Router vs React Router）
- 主题切换策略（CSS variables vs Tailwind theme switch）
- 国际化（i18next vs Tauri 原生 locale）
- 富文本编辑器选型（小说正文编辑用 Lexical / TipTap / ProseMirror？）
- 设计系统具体落地（shadcn/ui 直接用 vs 自建）

以上 TBD 在 UI 阶段（v2 README §5）正式开始时确定，不阻塞 Phase 0 后端实施。
