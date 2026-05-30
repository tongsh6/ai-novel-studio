# ProjectGod 写作工作台

这是面向网络小说生产的公司级前端工作台，替代旧的静态只读资料展示器。

## 边界

- 不提供搜索中心、搜索输入框、搜索结果页或 anysearch 入口。
- 所有按钮使用固定 Context Profile 读取明确资料。
- 默认只写候选区，不直接写入库内正式内容。
- 不设计归档部门、归档按钮或归档文件夹。

## 启动

```bash
rtk run "cd tools/ControlCenter && npm install"
rtk run "cd tools/ControlCenter && npm run build"
rtk run "cd tools/ControlCenter && npm run preview"
```

打开：

```text
http://127.0.0.1:4173
```

开发模式需要同时启动 API 与 Vite：

```bash
rtk run "cd tools/ControlCenter && npm run api"
rtk run "cd tools/ControlCenter && npm run dev"
```
