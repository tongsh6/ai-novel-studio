# 前端规范

TypeScript 6 + React 19 + Vite 8 项目的前端编码规范。

## 7.1 组件结构

```
frontend/src/
├── components/        # UI 组件
│   ├── common/        # 通用组件
│   └── features/      # 业务组件
├── lib/               # Phoenix Channel/Socket 封装
├── generated/         # JSON Schema → Zod（不手编）
├── hooks/             # 自定义 Hook
└── styles/            # CSS Modules
```

## 7.2 禁止内联样式

```tsx
// BAD
<div style={{ marginLeft: 8, color: 'blue' }}>Text</div>

// GOOD
import styles from './MyComponent.module.css';
<div className={styles.container}>Text</div>
```

## 7.3 禁止硬编码

```tsx
// BAD
const API_URL = "https://api.example.com/v1";

// GOOD
const API_URL = import.meta.env.VITE_API_BASE_URL;
```

## 7.4 组件职责

| 组件类型 | 职责 | 禁止 |
|----------|------|------|
| 展示组件 | 纯渲染、接收 props | 直接发 API 请求 |
| 容器组件 | 数据获取、状态管理 | 直接操作 DOM |
| 页面组件 | 路由级别的组装 | 过多业务逻辑 |

## 7.5 Hook 规范

- 自定义 Hook 以 `use` 开头
- 一个 Hook 只做一件事
- Hook 内部不直接修改 DOM
- 副作用使用 `useEffect` 明确声明依赖

## 7.6 类型安全

- 禁止 `any` 类型
- API 返回类型从 Zod schema codegen（`generated/`）
- Props 类型优先用 `interface`，联合类型用 `type`
