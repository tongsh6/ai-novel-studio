# AU09 Memory List UX Redesign / 记忆列表视觉与交互重构

- 状态：todo
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
| T1 | 截取并审计当前记忆页面列表 UX | todo | 字体、行色、状态、密度、扫描路径 |
| T2 | 对齐全局 token 和状态语义映射 | todo | 避免一页多套色彩语言 |
| T3 | 重构列表、筛选、状态和空/错/loading 态 | todo | 桌面 1280x800 优先 |
| T4 | 补设计追溯、前端测试和 Tauri 截图验收 | todo | `check_design_trace.sh` 必须通过 |

## 5. 验证

- [ ] 外部自动化驱动真实页面的场景化验收
- [ ] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`
- [ ] `bash scripts/frontend_audit.sh`
- [ ] `bash scripts/check_design_trace.sh`
- [ ] `bash scripts/quality_manifest_check.sh`
- [ ] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-23 — 登记用户反馈 14。当前问题不是单个颜色 bug，而是 memory list 的信息架构和视觉语义需要按全局 UI 调性重构；应在 memory taxonomy 明确后推进。

## 7. 试行反馈

- 实现前若需要查看 `.pen` 原型，必须使用 Pencil MCP，不直接读取 `.pen` 文件。
