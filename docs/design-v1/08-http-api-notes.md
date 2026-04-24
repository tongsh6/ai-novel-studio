# 08-http-api-notes

## 目的

本文件记录当前最薄 HTTP 传输层的边界，避免后续在接口层过早做成重后端。

---

## 当前已暴露路由

### 查询

- `GET /api/health`
- `GET /api/works`
- `GET /api/works/{workId}`
- `GET /api/works/{workId}/workbench`
- `GET /api/works/{workId}/reading`
- `GET /api/works/{workId}/chapters/{chapterId}`

### 动作

- `POST /api/works`
- `POST /api/works/{workId}/chapters/{chapterId}/generate-outline`
- `POST /api/works/{workId}/chapters/{chapterId}/generate-draft`
- `POST /api/works/{workId}/chapters/{chapterId}/revise-draft`

---

## 设计边界

### 这层负责什么

- 把应用服务暴露为本地 HTTP API
- 解析 JSON 请求
- 返回 JSON 响应
- 提供最小健康检查

### 这层不负责什么

- 登录鉴权
- 多人协作
- 队列任务
- 流式生成
- SSE / WebSocket
- 前端页面渲染

---

## 当前实现约束

- 零依赖，仅使用 Python 标准库 HTTP 服务
- 每个请求独立打开 SQLite 连接
- 路由只服务 V1 主链路，不提前扩展
- 阅读模式仍然是运行时投影，不落缓存表

---

## 运行方式

```bash
python3 server.py
```

可选环境变量：

- `HOST`
- `PORT`
- `NOVEL_WORKBENCH_DB`
