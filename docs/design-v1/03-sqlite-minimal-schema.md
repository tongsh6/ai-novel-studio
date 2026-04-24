# 03-sqlite-minimal-schema

## 目标

这是 V1 的 SQLite 最小可运行 schema 方案。  
目标不是完美，而是先把闭环跑通。

## 选型原则

- 单用户
- 本地优先
- 低并发
- 先验证对象模型和对话流转
- 未来可迁 PostgreSQL

## SQLite 设计原则

- 主键统一用 `TEXT`
- JSON 统一先存为 `TEXT`
- 时间统一用 Unix 毫秒 `INTEGER`
- 扩展字段统一走 `extensions_json`
- 备注统一走 `notes_json`
- 不做过度范式化
- 尽量避免 SQLite 方言锁死未来迁移

## 初始化建议

- 开启 `foreign_keys`
- 使用 `WAL`
- 使用 `NORMAL` synchronous

---

## V1 最小八张表

### 1. works
负责作品根对象。

### 2. characters
负责人物核心对象。

### 3. outlines
负责总纲骨架。

### 4. volumes
负责卷级规划。

### 5. chapters
负责章节规划。

### 6. drafts
负责正文版本。

### 7. decision_logs
负责关键决策固化。

### 8. continuity_states
负责动态状态与信息边界。

---

## 为什么是这八张

这是最小闭环的必要骨架：

- `works`：没有作品根对象，所有上下文都会飘
- `characters`：没有人物对象，写作无法稳定
- `outlines`：没有总纲，整体方向会散
- `volumes`：没有卷，中观结构无法诊断
- `chapters`：没有章，正文无落点
- `drafts`：没有正文版本，阅读无法成立
- `decision_logs`：没有决策，系统只会聊天不会维护作品
- `continuity_states`：没有状态层，长篇抗崩能力几乎为零

---

## 第二阶段再补的表

- relationships
- world_rules
- plotlines
- events
- foreshadows
- field_definitions

---

## 第三阶段再补的表

- factions
- locations
- doc_assets
- prompt_assets
- 全文检索虚拟表
- 分析投影缓存表

---

## 表设计策略

### Core Fields
显式列。

### Extensions
统一放 `extensions_json`。

### Notes
统一放 `notes_json`。

### Derived
不直接写回源表，走分析投影层或缓存层。

---

## 迁移 PostgreSQL 的注意点

- 不要把 SQLite 特有语法散落到业务代码里
- 应用层生成 ID
- 统一通过仓储/DAO 层访问数据库
- JSON 字段未来可直接迁到 `JSONB`
- 枚举先用 `TEXT`，未来再收敛为更强类型

---

## 实施建议

先实现八张核心表和最小 CRUD + 查询，不要一口气上全量 schema。  
当前重点不是“把数据库设计得漂亮”，而是让工作台真正开始工作。
