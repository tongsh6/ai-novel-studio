# 06-sqlite-implementation-notes

## 目的

本文件记录 V1 SQLite 最小实现的实际落地边界，避免 schema 草案和代码骨架再次漂移。

---

## 当前已落地内容

代码文件：

- `novel_workbench/storage/schema.sql`
- `novel_workbench/storage/sqlite.py`
- `novel_workbench/storage/repositories.py`

当前实现只覆盖 `03-sqlite-minimal-schema.md` 中定义的最小八张表：

- `works`
- `characters`
- `outlines`
- `volumes`
- `chapters`
- `drafts`
- `decision_logs`
- `continuity_states`

---

## 文件边界

### `schema.sql`

负责：

- 建表
- 基础索引
- 外键约束

不负责：

- 业务默认值推导
- 对象级状态流转
- 上下文组装
- 派生分析

### `sqlite.py`

负责：

- 建立 SQLite 连接
- 打开 `foreign_keys`
- 设置 `WAL`
- 设置 `NORMAL` synchronous
- 执行 schema 初始化

### `repositories.py`

负责：

- 最小持久化接口
- 单表 `save/get/delete`
- 按 `work_id` 查询
- 章节草稿按 `chapter_id` 查询
- 连续性状态按 `scope` 查询

不负责：

- 跨表事务编排
- 对话动作解释
- 对象合法性校验
- 决策自动生成
- 连续性冲突分析

---

## 字段策略

### Core

高频稳定字段落显式列。

### Extensions

统一走 `extensions_json`。

### Notes

统一走 `notes_json`。

### Derived

不写回源表。

---

## 当前刻意不做

- `relationships`
- `world_rules`
- `plotlines`
- `events`
- `foreshadows`
- `factions`
- `locations`
- `doc_assets`
- `prompt_assets`
- 分析投影表
- 阅读投影缓存表

这些对象和投影在领域模型中保留，但不进入当前最小 SQLite 实现。

---

## 代码层约束

- 仓储层只做薄封装，不在这里偷塞业务规则。
- 所有 ID 仍由应用层生成，不依赖 SQLite 自增主键。
- JSON 先按字符串存储，后续再按阶段迁移到更强类型。
- 后续若新增表或核心字段，必须先回看 `02-v1-scope.md` 与 `05-decisions.md`。
