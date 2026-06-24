# AU09 Memory List UX Redesign / 记忆列表视觉与交互重构

- 状态：闭环（全局浅色 token + 语义状态/类型/召回 + 真实页面截图验收）
- 类型：UI Contract Slice + Memory Governance Slice
- 启动日期：2026-06-23
- 来源反馈：用户问题 14
- 所属验收：`docs/design/acceptance/author/AU-09-story-memory.md`

## 1. 用户 / 系统目标

记忆页面的列表字体颜色、行颜色、状态呈现和整体扫描体验需要从 UX 角度重构，符合全局工作台调性。它应帮助作者快速判断记忆类型、状态、召回价值、来源与是否过时，而不是用杂乱颜色制造噪声。

## 2. 开工检查

- **Contract**：`docs/design/ui/40-ui-overview.md` token；`docs/design/ui/43-structure-panel.md` 档案/记忆心智；`docs/design/ui/47-ui-copy-guidelines.md`；AU-09 memory status/type。
- **Invariant**：
  - UI 颜色和行状态必须服务真实记忆状态，不用装饰色替代语义。
  - deprecated / archived / locked / recallable 等状态要可扫读、可访问、可解释。
  - 文案集中在 `copy.ts`；组件有设计追溯；不使用内联 style。
  - 视觉重构不改变 memory recall 或 lifecycle 语义。
- **Boundary**：
  - `frontend`：MemoryListPage、状态 badge、筛选控件、行详情、空/错误/loading 态。
  - `docs/design/ui`：若当前设计不足，先补最小设计说明和追溯。
  - **不改**：不新增后端状态语义；不改 memory 写入策略，除非依赖 `AU09-memory-taxonomy-write-policy` 已冻结。
- **Consumer**：作者在工作台记忆入口查看、筛选、治理当前作品记忆。
- **Proof**：前端测试 + 真实 Tauri 截图/summary，证明多类型、多状态、多行列表在 1280x800 下可读、无重叠、颜色符合 token、筛选和状态解释可用。
- **Acceptance Driver**：新增或扩展 `au09-memory-management-filter-matrix` / `au09-memory-list-ux-redesign` 外部 Tauri driver；产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | |
| novel_agent | no | |
| novel_application | no | |
| novel_persistence | no | |
| novel_web | maybe | 仅当现有 DTO 缺展示必要字段 |
| frontend | yes | 列表、状态、筛选、响应式布局 |
| docs/design | yes | UI 追溯与必要设计说明 |
| quality | yes | 真实页面 UX 验收 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 截取并审计当前记忆页面列表 UX | done | 现状：CSS 硬编码深色 hex（off-theme，全局是浅色 token），返回按钮浅主题贴深色页；状态/范围渲染原始枚举无标签无语义色；类型 badge 单色；硬编码中文未进 copy.ts；无 recallable 指示 |
| T2 | 对齐全局 token 和状态语义映射 | done | `MemoryListPage.module.css` 全部改用 `var(--surface/foreground/accent/border/rounded/sans)`；`memoryListView.ts` 纯函数定状态 tone（confirmed/stabilized/draft/conflicted/terminal） |
| T3 | 重构列表、筛选、状态和空/错/loading 态 | done | 状态/范围/类型用中文标签；状态语义徽标+点；新增「召回」列（可召回/不召回，终态强制不召回与 §4.5 一致）；终态行降权；筛选/空/loading 文案进 `copy.ts`；1280x800 可读无重叠 |
| T4 | 补设计追溯、前端测试和 Tauri 截图验收 | done | header 引用 `40-ui-overview`；`memoryListView` 前端单测；`au09-memory-list-ux-redesign` Tauri driver + 截图通过；修既有 `au09-memory-management-filter-matrix` driver 的 placeholder/loading 断言（复跑通过） |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收（`artifacts/slice-verify/au09-memory-list-ux-redesign-tauri/summary.json` + 截图；`scripts/quality_accept.sh au09-memory-list-ux-redesign --surface tauri` 通过；`container_bg=rgb(252,250,247)` 即全局浅色 token）
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`
- [x] `bash scripts/frontend_audit.sh`
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 gitleaks ProjectGod 既有 accepted_risk）

## 6. 决策日志

- 2026-06-23 — 登记用户反馈 14。当前问题不是单个颜色 bug，而是 memory list 的信息架构和视觉语义需要按全局 UI 调性重构；应在 memory taxonomy 明确后推进。
- 2026-06-24 — 闭环：根因是记忆页整页用硬编码深色 hex（与全局浅色 workbench 调性冲突），状态/范围/类型显示原始枚举。改：CSS 全量改用全局 token；`memoryListView.ts` 把状态映射成语义 tone（颜色服务真实状态非装饰）；列表用中文标签 + 状态徽标 + 召回列 + 终态行降权；文案集中 `copy.ts`；设计追溯 header 指向 `40-ui-overview`。真实 Tauri 截图证明：浅色调（bg=rgb(252,250,247)）、状态显示「已确认/已弃用」非枚举、类型/范围标签、逐行召回值、终态行弱化、无重叠。坑：copy 改 placeholder/loading 文案破坏既有 filter-matrix driver 的 `getByPlaceholder("搜索关键词…")`/`加载中...` 断言，已同步修正并复跑通过（详情抽屉仍显示原始 status，trace/entry driver 不受影响）。

## 7. 试行反馈

- 颜色服务真实状态语义而非装饰：confirmed/stabilized=实、draft=弱、conflicted=警示色、terminal=弱化+不召回。详情抽屉（`MemoryDetailDrawer`）仍是独立的旧深色样式与原始 status 展示，本 slice 未纳入（聚焦列表）；CP2 可把抽屉与创建对话框一并对齐全局 token，并统一「不召回/不可召回」措辞。
