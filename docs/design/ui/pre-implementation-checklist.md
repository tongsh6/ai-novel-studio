# UI 实现前自查清单

> 目的：确保每个 UI 组件在编码前经过设计审查，避免实现偏离设计。
>
> 规则来源：AGENTS.md § UI 设计驱动（Design-Driven）
>
> 使用方式：写任何 UI 组件前，按顺序勾完本清单。

---

## 事前检查（Pre-Implementation）

### 1. 设计文档确认

- [ ] 已阅读对应的 UI 设计文档章节（`40`-`47`）
  - 设计文档目录：`docs/design/ui/`
- [ ] 已确认本组件的语义边界（不发明新 card_type / intent / state）
- [ ] 已确认不负责范围（设计文档中的"不负责范围"节）

### 2. Pencil 原型确认

- [ ] 已查看对应的 Pencil 原型 screen frame
  - 原型文件：`docs/design/ui/novel-studio.pen`
  - 导出预览：`docs/design/ui/exports/png/`
- [ ] 已确认交互状态变化（hover / active / disabled / loading / error / empty）
- [ ] 已确认颜色/间距/字体与设计 token 一致（`40-ui-overview.md`）

### 3. 技术栈确认

- [ ] 样式方案：Tailwind CSS 4（优先）或 CSS Modules
- [ ] UI 原语：涉及 Dialog/Dropdown/Tabs/Tooltip 时使用 Radix UI 包装
- [ ] Server state：使用 TanStack Query（不在 React state 持有 server 数据）
- [ ] UI state：使用 Zustand（drawer 开关、focused card 等）
- [ ] 图标：来自 Lucide
- [ ] 表单：React Hook Form + Zod resolver

### 4. 追溯准备

- [ ] 已准备好组件头部的设计追溯注释：
  ```
  // Design: docs/design/ui/<文档>.md §<章节>
  // Prototype: novel-studio.pen → <screen-frame-name> (<NODE_ID>)
  ```

### 5. 文案准备

- [ ] 所有用户可见文本已加入 `frontend/src/lib/copy.ts`
- [ ] 文案风格与 `47-ui-copy-guidelines.md` 一致
- [ ] 无硬编码英文术语（canonical 名称不出现在 UI 中）
- [ ] 无内联文案（禁止在 JSX 中直接写中文字符串）

---

## 事后验证（Post-Implementation）

- [ ] `cd frontend && pnpm typecheck && pnpm lint && pnpm test` — 全部通过
- [ ] `bash scripts/frontend_audit.sh` — 依赖与技术栈合规
- [ ] `bash scripts/check_design_trace.sh` — 追溯注释完整
- [ ] 与 Pencil 原型导出图做视觉对照
- [ ] 在 Tauri 窗口（`pnpm tauri dev`）中验证，非浏览器
