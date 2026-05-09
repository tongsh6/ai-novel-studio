# Workbench Smoke Test

日期：2026-05-09
模式：`bash scripts/dev.sh --web`

## 环境

| 组件 | 状态 |
|------|------|
| Phoenix (port 4657) | ✅ |
| Vite (port 5768) | ✅ |
| WebSocket (ws://localhost:4657/socket) | ✅ |
| LLM Health Check | ✅ `provider/health` 200 |
| LM Studio | ✅ qwen/qwen3.5-122b-a10b |

## 验证流程

1. **user_message roundtrip** ✅
   - 输入："你好"
   - 输出："你好！很高兴见到你，有什么关于小说创作的想法或需求可以和我聊聊吗？"
   - 截图：`workbench-smoke-test.png`

## 发现并修复的问题

1. Vite proxy `/socket` target 包含路径后缀，导致请求变成 `/socket/socket/websocket` (404)
   - 修复：target 改用 `VITE_API_ENDPOINT`（仅 host）
2. 浏览器模式 `wsBaseUrl` 使用 relative path 导致 Phoenix.Socket 构造 URL 不正确
   - 修复：浏览器模式也使用 `DEFAULT_WS_HOST`（直连 Phoenix）
