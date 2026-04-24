# 协作模式视觉风格指南 (Expert Mode Style Guide)

## 1. 配色方案 (Color Palette)
协作模式强调长时间工作的眼部舒适度与逻辑清晰度。

| 元素 | 颜色 (Hex) | 用途 |
| :--- | :--- | :--- |
| **背景 (Primary BG)** | `#1E1E1E` | 整体深色背景 |
| **面板背景 (Panel BG)** | `#252526` | 导航栏与控制台背景 |
| **正文文字 (Body Text)** | `#CCCCCC` | 主阅读区域 |
| **强调色 (Accent)** | `#007ACC` | 选中状态、执行按钮 |
| **冲突色 (Conflict)** | `#F44336` | 逻辑冲突波浪线、警告图标 |
| **决策溯源 (Decision)** | `#4CAF50` | 已固化决策的标记 |
| **连续性状态 (Continuity)** | `#FFEB3B` | 状态变更提示 |

## 2. 字体规范 (Typography)
- **正文区**：`Inter`, `-apple-system`, `sans-serif`。字号 `16px`，行高 `1.6`，段间距 `1.2em`。
- **指令区**：`JetBrains Mono` 或 `SF Mono`。字号 `13px`。

## 3. 面板与阴影 (Panels & Shadows)
- **边框**：`1px solid #333333`。不使用大面积阴影，仅在悬浮卡片上使用 `0 4px 12px rgba(0,0,0,0.5)`。
- **圆角**：容器 `4px`，卡片 `8px`。

## 4. 状态预警视觉 (State Alerts)
- **逻辑冲突**：文字下方 1px 红色点状波浪线。
- **状态变更**：侧边栏图标产生 0.5s 的渐变呼吸光效。
