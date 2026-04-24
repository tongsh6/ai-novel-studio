# 通用组件与交互规范

## 1. 核心对话框 (Dialogue Panel)
- **输入联动**：支持 `@` 唤起角色列表，`#` 唤起章节列表，`/` 唤起命令列表。
- **状态感知**：对话框边缘颜色代表当前 `status`（如：READY_FOR_EXECUTION 为绿色，FAILED 为红色）。

## 2. 结构化卡片 (Entity Cards)
- **卡片类型**：Character, Plot, Foreshadow, Decision。
- **共有操作**：[查看详情] [加入上下文] [设为当前目标]。

## 3. 决策浮窗 (Decision Tooltip)
- **用途**：显示该情节对应的 `decision_logs` 原始数据。
- **内容**：意图 (Intent) + 理由 (Rationale) + 时间戳。

## 4. 模式切换逻辑
```javascript
function switchMode(newMode) {
  // 1. 保持当前 state.selectedWorkId 不变
  // 2. 重新加载对应模式的 DOM 布局
  // 3. 执行特定模式的渲染函数 (renderBeginner / renderExpert / renderMaster)
}
```

## 5. 前后端协议对接
- **所有 UI 动作必须最终转换为对 `/api/works/{id}/execute` 的调用。**
- **所有展示数据必须来自 `ReadingProjection` 或 `open_workbench` 的返回值。**
