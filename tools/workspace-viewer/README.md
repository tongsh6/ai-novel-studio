# ProjectGod 只读资料展示器

这是一个本地静态前端，用来浏览 `company/` 和 `books/` 下的 Markdown / JSON / TOML 文件。

## 设计边界

- 只读展示，不提供修改、审批、删除、保存能力。
- 前端不拆解 Markdown 语义，不把部门、人物、伏笔等内容转成第二套结构化数据。
- 文件内容来自 `tools/workspace-viewer/data/content-manifest.json`。
- 更新展示内容时，重新生成 manifest。

## 生成数据

```bash
rtk run "node tools/workspace-viewer/scripts/build-manifest.mjs"
```

## 本地预览

从仓库根目录启动静态服务：

```bash
rtk run "python3 -m http.server 4173"
```

然后打开：

```text
http://127.0.0.1:4173/tools/workspace-viewer/index.html
```

