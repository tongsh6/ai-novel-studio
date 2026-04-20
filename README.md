# AI Novel Studio

一个面向多小说项目管理的 AI 小说工作台原型。

当前分支的目标不是沉淀 `temp` 上的内容资产，而是验证一个最小产品形态是否成立：

`用户通过页面管理多本小说，并完成其中一本小说的前三章推进`

## 本次 MVP 验证范围

这版原型聚焦 4 个能力：

- 同时管理多本小说项目
- 每本小说维护独立的设定、大纲、章节和生成记录
- 通过页面生成并查看前 3 章的细纲与草稿
- 用基础状态流转验证“前三章已完成”的项目闭环

本次不覆盖：

- 真实 LLM 接入
- 复杂质量门禁
- 多人协作与权限
- 经验学习引擎
- 全书级编排

## 目录

```text
ai-novel-studio/
├── README.md
├── docs/
│   └── ui-mvp-spec.md
├── server.py
└── web/
    ├── index.html
    ├── styles.css
    └── app.js
```

## 运行方式

当前版本已经包含一个零依赖本地后端，用于保存项目数据并提供 API。

例如：

```bash
cd /Users/loong/workspace/novel/ai-novel-studio
python3 server.py
```

然后访问：

`http://127.0.0.1:8000`

如果 `8000` 端口被占用，可以直接换端口启动：

```bash
PORT=8010 python3 server.py
```

## 真实模型接入

当前版本支持接入任意 `OpenAI-compatible` Chat Completions 接口，默认示例是 DeepSeek，也支持本地的 LM Studio。

可配置环境变量：

- `AI_NOVEL_LLM_MODE`
  - `auto`：有 `API_KEY + MODEL` 就走真实模型，否则回退 stub
  - `stub`：强制只用规则模板
- `DEEPSEEK_API_KEY`
- `LMSTUDIO_API_KEY`
  - 可选。LM Studio 本地接口通常不需要。
- `AI_NOVEL_API_KEY`
- `AI_NOVEL_BASE_URL`
  - 默认 `https://api.deepseek.com`
  - LM Studio 常用值：`http://127.0.0.1:1234/v1`
- `AI_NOVEL_MODEL`
  - 默认 `deepseek-chat`
  - LM Studio 常用值：你在本地加载后的模型 ID
- `LMSTUDIO_BASE_URL`
  - 可选。设置后会优先按 LM Studio 处理。
- `LMSTUDIO_MODEL`
  - 可选。设置后会优先按 LM Studio 处理。
- `AI_NOVEL_PROVIDER`
  - 可选。例如 `lm-studio`
- `AI_NOVEL_TIMEOUT`

示例：

```bash
export AI_NOVEL_LLM_MODE=auto
export DEEPSEEK_API_KEY=your_key
export AI_NOVEL_BASE_URL=https://api.deepseek.com
export AI_NOVEL_MODEL=deepseek-chat

python3 server.py
```

LM Studio 示例：

```bash
export AI_NOVEL_LLM_MODE=auto
export LMSTUDIO_BASE_URL=http://127.0.0.1:1234/v1
export LMSTUDIO_MODEL=qwen2.5-14b-instruct

python3 server.py
```

如果模型调用失败，系统会自动回退到规则模板，并在生成记录里写入回退原因摘要。

## Prompt 配置

“生成大纲 / 生成草稿”的提示词已从业务代码中抽离，默认配置文件在：

- `prompts/default_prompts.json`

当前支持的 prompt 项：

- `full_outline`
- `chapter_outline`
- `chapter_draft`

每项都支持：

- `system`
- `user`
- `temperature`

如果你要替换为自己的提示词文件，可以通过环境变量覆盖：

```bash
export AI_NOVEL_PROMPTS_PATH=/absolute/path/to/your_prompts.json
python3 server.py
```

模板变量会由后端自动注入，当前可用字段包括：

- `project_title`
- `project_genre`
- `project_hook`
- `settings_theme`
- `settings_world`
- `settings_power_system`
- `settings_factions`
- `outline_premise`
- `outline_volume_goal`
- `characters_json`
- `chapter_number`
- `chapter_title`
- `chapter_outline`
- `chapter_foreshadow_json`
- `chapter_plan_json`

## 交互说明

页面包含：

- 小说列表
- 小说工作台
- 设定管理
- 大纲管理
- 章节工作区
- 生成记录

在章节工作区中，可以对第 1-3 章执行：

- 生成细纲
- 生成草稿
- 章节检查
- 批准章节

当第 1-3 章都被批准后，项目状态会自动推进为“前三章已完成”。

当前数据存储位置：

- `data/projects.json`

前端通过这些接口与后端交互：

- `GET /api/projects`
- `GET /api/health`
- `GET /api/prompts`
- `POST /api/projects`
- `DELETE /api/projects/:id`
- `PUT /api/prompts`
- `PUT /api/projects/:id`
- `POST /api/projects/:id/generate-full-outline`
- `POST /api/projects/:id/chapters/:number/generate-outline`
- `POST /api/projects/:id/chapters/:number/generate-draft`
- `POST /api/projects/:id/chapters/:number/check`
- `POST /api/projects/:id/chapters/:number/approve`

## 文档

- [UI MVP 规格](./docs/ui-mvp-spec.md)

DeepSeek 官方文档：

- https://api-docs.deepseek.com/
