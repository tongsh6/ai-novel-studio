# B85 模型上下文窗口用户设置（UI 入口）

**状态**：**候选（未启动，2026-11-11 作者要求先登记任务）**。
**来源**：作者反馈「模型上下文窗口不应该是代码写死的，要开放给用户做系统配置」；2026-11-11 初始能力已落（`preferences.json` 的 `context_windows` + Tauri 注入 sidecar env，提交 `044092df`），但**没有用户可见的设置入口**（应用当前无系统设置菜单/设置页；唯一设置类入口是顶栏模型供应商弹窗）。
**设计真源**：`docs/design/tech-stack/05-desktop.md` §6（用户数据/偏好与 `context_windows` 字段）、`docs/design/ui/46-state-and-feedback.md`（设置/状态面）、`docs/design/ui/47-ui-copy-guidelines.md`。

## 1. 目标

让作者（用户）能在应用内配置**模型上下文窗口**（按 provider，必要时按 model），而不是只能手工编辑 `preferences.json` 或由开发者改代码/环境变量；配置经产品路径生效（Tauri → sidecar → `ContextPressure` 压力阈值），并能在设置界面看到当前生效值与来源。

## 2. 范围（建议）

- **设置入口**：新增系统设置入口（顶栏齿轮/菜单 → 设置对话框）；复用现有 Radix Dialog 与 UI 契约，不新建平行设置体系。
- **配置项**：按 provider 的上下文窗口（token 数）；可显示默认表值（保守窗口）与用户覆盖值；留空 = 使用默认。
- **存储**：复用 `preferences.json` 的 `context_windows`（既有字段，`044092df` 已实现注入）；Tauri command 读写复用 `read_preferences`/`write_preferences`。
- **生效方式**：保存后提示「重启应用生效」（sidecar env 在启动时注入）；或后续支持热更新（需评估）。
- **不做**：不改压缩阈值（0.70/0.90）与 `keep_recent_items=4` 的产品语义；不向作者暴露「压缩/压力」内部概念细节（设置项文案只写「模型上下文窗口」）。

## 3. 验收

- 设置页可配置 provider 窗口并持久化到 `preferences.json`（按 profile 隔离）；
- 重启后 sidecar 收到 `NOVEL_CONTEXT_WINDOW_OVERRIDES`（可在 sidecar 日志/`Application.get_env(:novel_application, :context_window_overrides)` 核验）；
- 外部自动化（Tauri 驱动）可像用户一样操作设置项；不新增验收专用 hook；
- 前端 `pnpm typecheck/lint/test` + 真实页面批次证据 + 作者可见文案走 `copy.ts`。

## 4. 依赖与边界

- 依赖：`044092df`（配置载体与注入能力）；无其他任务阻塞。
- 边界：本任务只做「用户可配置窗口」UI；压缩触发时机（CP7 会话级）与窗口策略默认值（保守 32k vs 512k）另待作者裁决，不在本任务内改。
