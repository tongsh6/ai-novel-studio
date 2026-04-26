# ADR-0016：Tauri 工程目录约定从 `tauri/` 改为 `frontend/src-tauri/`

- 状态：Accepted（2026-04-27）
- 涉及范围：tech-stack（仓库布局）
- 相关文档：
  - `../tech-stack/12-development.md` §1（仓库结构总图）
  - `../tech-stack/04-frontend.md` §1（前端栈基线）
  - `../tech-stack/05-desktop.md`（桌面外壳）
  - `../tech-stack/14-roadmap.md` §2.1（Phase 0 第 1 周 T6）
- 取代：无
- 取代者：无

---

## 背景

`12-development.md §1` 在写仓库结构总图时把 Tauri 工程定在仓库根的顶层 `tauri/` 目录，与 `frontend/` 平级。当时只是按"按职责分目录"的直觉拍的，没经过实测。

Phase 0 第 1 周 T6 启动时发现：

- Tauri 2 默认布局是 `frontend/src-tauri/`（与前端 SPA 同根，作为子目录）。
- `pnpm tauri init` / `pnpm tauri dev` / `pnpm tauri build` 全部基于这个默认布局；CLI 在 `frontend/` 下运行时自动定位 `src-tauri/`。
- 社区文档、Tauri Action（CI）、官方 example、各种第三方教程几乎都假设这个布局。
- 跨目录版（顶层 `tauri/`）也支持，但需要在 `tauri.conf.json` 中手工维护 `frontendDist` / `devUrl` / `beforeDevCommand` / `beforeBuildCommand` 四处相对路径，且每次 Tauri 升级时要复核社区模板的差异。

T6 实测前提下，此 ADR 把目录约定从 `tauri/`（spec）改为 `frontend/src-tauri/`（实测）。

---

## 考虑过的方案

### 方案 A：守 spec（保留顶层 `tauri/`）

把 Rust glue 放在仓库根 `tauri/`，与 `frontend/` 平级。`tauri.conf.json` 配 `frontendDist: "../frontend/dist"`、`beforeDevCommand: "pnpm --dir ../frontend dev"` 等相对路径。

- 优点：仓库一级目录按"职责"清晰分割（前端 / Rust glue / Elixir umbrella / 文档）；没有"前端目录里塞 Rust 工程"的混搭感。
- 缺点：每次 Tauri 升级要核对社区模板与本仓库 monorepo 配置的差异；CI 用 Tauri Action 时需要定制路径；新人按官方 quick-start 跑命令时会卡住。

### 方案 B：守 Tauri 默认（`frontend/src-tauri/`）

把 Rust glue 作为 frontend 项目的子目录，按 Tauri 2 默认布局。

- 优点：CLI 命令零配置；社区文档可直接套用；CI 用官方 Tauri Action 模板即可；Tauri 升级时跟随社区路径不漂移。
- 缺点：违反原 spec；前端 vs Rust 在同一根下，目录耦合度比 A 高。

---

## 最终决策

采用 **方案 B**：Tauri 工程位于 `frontend/src-tauri/`，仓库根不再保留顶层 `tauri/` 目录。

---

## 决策原因

- **spec 应跟实测走，不是反过来**。原 spec 在写时没经实测，T6 启动是第一次实测；应当以实测验证过的布局为准，而不是为守原图付出长期相对路径维护代价。
- **新人 onboarding 成本**。社区资料几乎都假设 `frontend/src-tauri/`，新人对照官方教程走时不会被自定义路径绊住。
- **CI 模板可直接套用**。Tauri 官方 [`tauri-action`](https://github.com/tauri-apps/tauri-action) 默认假设 `src-tauri/` 是 frontend 子目录，方案 B 下 T9 CI 在加 Tauri build 时无需路径调整。
- **目录耦合是可接受的**。前端 SPA 与 Tauri Rust glue 本就在同一发布单元（桌面应用 = frontend bundle + Tauri shell），同根反而更准确地反映了单元边界。

---

## 最终决策内容

### 1. 仓库布局调整

```
ai-novel-studio/
├── apps/                                # Mix umbrella
│   └── novel_*/
├── frontend/
│   ├── src/                             # React SPA
│   ├── src-tauri/                       # Tauri 2 shell（Rust glue）
│   │   ├── src/
│   │   ├── icons/
│   │   ├── capabilities/
│   │   ├── tauri.conf.json
│   │   ├── Cargo.toml
│   │   └── build.rs
│   ├── public/
│   └── ...
└── ...                                  # 不再有顶层 tauri/
```

### 2. `frontend/package.json` 增加 tauri scripts

`pnpm tauri init` 会自动注入：

```json
{
  "scripts": {
    "tauri": "tauri"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  },
  "dependencies": {
    "@tauri-apps/api": "^2"
  }
}
```

之后命令统一在 `frontend/` 目录下：`pnpm tauri dev` / `pnpm tauri build` / `pnpm tauri init` 等。

### 3. `tauri.conf.json` 关键字段

按 Tauri 2 默认（无需自定义相对路径）：

- `frontendDist: "../dist"`（frontend 的 vite 构建产物在 `frontend/dist/`）
- `devUrl: "http://localhost:5173"`
- `beforeDevCommand: "pnpm dev"`（在 frontend/ 下相对运行）
- `beforeBuildCommand: "pnpm build"`

---

## 影响

### 对 `12-development.md §1` 的影响

§1 仓库结构总图中的顶层 `tauri/` 块必须移除，并把 `frontend/` 块扩充为含 `src-tauri/` 子目录。

### 对其他 tech-stack 文档的影响

- `04-frontend.md`：无字段级影响，但若提到 Tauri 路径需更新。
- `05-desktop.md`：若有顶层 `tauri/` 路径引用需更新。
- `14-roadmap.md` §2.1 / §2.2：无影响（只描述"Tauri 骨架"，不锚定路径）。

### 对 ADR 体系的影响

本 ADR 是 v2 ADR 体系中第一份**工程层 / 仓库布局**决策。先前 ADR-0001~0015 都是 Foundation / Domain 的 schema/contract 决策。后续若再有此类工程层决策，参照本 ADR 体例（背景—候选—决策—影响—迁移）即可，不必另立 ADR 模板。

### 迁移策略

- 删除仓库根 `tauri/.gitkeep` 与空 `tauri/` 目录。
- T6 实施时直接走 `cd frontend && pnpm tauri init`，让 CLI 在 `frontend/src-tauri/` 生成模板。
- 没有需要从原 `tauri/` 搬运的文件（原目录从未注入实际工程文件，仅 `.gitkeep` 占位）。

---

## 后续工作

### 必须更新的文档

- `tech-stack/12-development.md` §1：移除顶层 `tauri/` 块，frontend 块加 `src-tauri/`。
- `adr/0000-index.md` §2.1：追加 ADR-0016 行；§5 追加触发条件行。

### 不在本 ADR 范围内

- Tauri 应用本身的具体配置（窗口尺寸、bundle 配置、capabilities 集合等）：由 T6 实施 + `05-desktop.md` 后续更新覆盖。
- Tauri sidecar 二进制（Mix Release）的归档位置：原 spec 中的 `tauri/binaries/` 应迁到 `frontend/src-tauri/binaries/` 或独立 `tools/release/`，留待 Phase 1 release 阶段决策。

### 依赖 ADR

无。

---

## 评审与终止条件

- 评审：本 ADR 仅涉及仓库布局，由 Tech Lead 自审 + 实测验证（T6 `pnpm tauri dev` 启动成功）即可 Accept，不需要 Foundation/Domain 评审。
- 终止：T6 实施成功 + `12-development.md §1` 修订 commit + `0000-index.md` 表更新 commit，本 ADR 即闭环。
