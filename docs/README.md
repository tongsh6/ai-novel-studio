# Codex 交接包

这是一套把当前 ChatGPT 会话沉淀为 Codex 可读项目上下文的 Markdown 文件。

## 建议使用方式

1. 把本目录放到项目仓库根目录，或放到 `docs/` 目录。
2. 把 `AGENTS.md` 放到仓库根目录。
3. 让 Codex 先阅读以下文件，再开始实现：
   - `00-vision.md`
   - `01-domain-model-full.md`
   - `02-v1-scope.md`
   - `03-sqlite-minimal-schema.md`
   - `05-decisions.md`

## 文件说明

- `00-vision.md`：产品定位与长期蓝图
- `01-domain-model-full.md`：完整对象模型
- `02-v1-scope.md`：V1 范围与非目标
- `03-sqlite-minimal-schema.md`：SQLite 最小可运行 schema 草案
- `04-future-backlog.md`：未来阶段待启用设计
- `05-decisions.md`：关键裁剪与架构决策
- `06-sqlite-implementation-notes.md`：当前 SQLite 最小实现边界
- `07-application-service-notes.md`：当前应用服务动作边界
- `08-http-api-notes.md`：当前最薄 HTTP 接口边界
- `09-frontend-shell-notes.md`：当前单工作台前端壳边界
- `AGENTS.md`：给 Codex 的项目协作说明

## 当前目标

先做一个**对话优先、结构化内核支撑、可切阅读模式**的小说创作工作台原型。

## 当前阶段建议

先实现最小可运行链路：

灵感输入 -> 作品立项 -> 章节细纲 -> 正文草稿 -> 阅读模式
