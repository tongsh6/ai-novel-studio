# UI MVP 规格

## 目标

验证 `AI 小说项目管理台` 的最小产品形态是否成立。

本次验证口径不是“能不能自动写整本书”，而是：

`用户能否通过页面完成一部小说的前 3 章推进闭环`

## MVP 范围

### 必须覆盖

- 多小说项目列表
- 新建小说项目
- 单小说独立工作台
- 设定管理
- 大纲管理
- 第 1-3 章目录与状态管理
- 前 3 章细纲生成
- 前 3 章草稿生成
- 基础章节检查
- 章节批准与项目状态推进

### 暂不覆盖

- 多模型路由与高级 Prompt 管理
- 向量检索
- 高级连续性检查
- 多人协作
- 经验积累引擎
- 复杂工作流编排

## 用户主流程

1. 创建一本小说项目
2. 填写基础信息
3. 补最小设定
4. 生成前三章细纲
5. 逐章生成草稿
6. 查看并检查章节
7. 批准前三章
8. 项目状态更新为“前三章已完成”

## 页面结构

### 1. 小说列表区

- 展示所有小说项目
- 展示每本书的状态、更新时间、下一步动作
- 支持新建项目

### 2. 小说工作台

- `总览`
- `设定`
- `大纲`
- `章节`
- `记录`

### 3. 章节工作区

- 左侧展示第 1-3 章目录
- 中间展示章节 outline 和正文
- 右侧展示状态、涉及角色、检查结果与操作按钮

## 核心对象

### `NovelProject`

- `id`
- `title`
- `genre`
- `hook`
- `platform`
- `audience`
- `status`
- `nextAction`
- `updatedAt`

### `NovelSetting`

- `theme`
- `world`
- `powerSystem`
- `factions`

### `Character`

- `name`
- `role`
- `goal`

### `StoryOutline`

- `premise`
- `volumeGoal`
- `chapterPlans`

### `Chapter`

- `number`
- `title`
- `outline`
- `content`
- `status`
- `characters`
- `foreshadow`
- `checkResult`
- `updatedAt`

### `GenerationRecord`

- `type`
- `chapterNumber`
- `summary`
- `createdAt`

## 最小状态机

### 章节状态

- `not_started`
- `outlined`
- `drafted`
- `approved`

### 项目状态

- `设定中`
- `大纲中`
- `章节推进中`
- `前三章已完成`

## 生成策略

当前版本采用双层策略：

- 优先使用真实 LLM 生成细纲和草稿
- 若模型未配置或调用失败，则自动回退到规则模板
- 章节检查仍以本地规则校验为主

## 验收标准

- 用户能在页面中管理至少 2 本小说项目
- 不同小说项目的数据互相独立
- 用户能编辑设定和大纲
- 页面能展示第 1-3 章目录
- 用户能逐章生成并查看前 3 章内容
- 章节状态能正确从 `not_started` 推进到 `approved`
- 第 1-3 章都批准后，项目状态更新为“前三章已完成”

## 下一步演进

- 将状态与内容落到 SQLite / 后端服务
- 引入更细粒度质量门禁
- 引入人工审核记录与版本管理
