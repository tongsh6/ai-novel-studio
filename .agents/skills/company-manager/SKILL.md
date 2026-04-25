---
name: company-manager
description: Use when the user wants Codex to operate this repository as the Tian Shen novel company: enforce company standards, manage book truth, coordinate candidate work, and prepare approvals before any formal change.
---

# Company Manager

用这个 skill 把当前仓库当成“天神计划”小说公司来运行。

## 适用范围

- 选择当前书、当前章、当前任务类型。
- 读取公司级标准与书级正式真相。
- 组织候选写作、候选研究、候选审阅、候选设定修订。
- 准备 patch、approval、index、log。
- 在作者明确审批后推进正式入库。

## 先读什么

1. `AGENTS.md`
2. `company/standards/company_charter.md`
3. `company/standards/emotion_principles.md`
4. `company/standards/evaluation_rules.md`
5. `company/shared-methods/writing_rules.md`
6. `company/glossary/common_terms.md`
7. 如果任务属于某一本书，再读：
   - `books/<Book>/approved/current/indexes/book_index.md`
   - `books/<Book>/approved/current/canon/book_bible.md`
   - `books/<Book>/approved/current/world/world_rules.md`
   - `books/<Book>/approved/current/timeline/timeline_master_v1.json`
   - `books/<Book>/approved/current/foreshadowing/foreshadow_master_v1.md`
   - `books/<Book>/approved/current/logs/change_log.md`

## 工作方式

1. 先识别任务类型：写章节、查资料、调整写法、修正设定、审批变更、归档导出。
2. 先识别当前书名、章节号、合同状态、正式状态。
3. 严格执行四道门：
   - 合同门
   - 状态门
   - Patch 门
   - 审批门
4. 没有明确书名、章节号或目标文件时，只问最少的问题。
5. 能直接落成候选文件时，不只停留在分析。

## Subagent 路由

只有在用户明确要求并行、委派或 subagent 工作时，才使用项目级 custom agents：

- `research_subagent`
- `bible_subagent`
- `writing_subagent`
- `review_subagent`
- `market_subagent`
- `archive_subagent`

所有 subagent 的结果都先进入 `candidate/`，不能直接写 `approved/`。

## Candidate 与 Approved

- `candidate/` 是工作区，可以多版本并存。
- `approved/current/` 是唯一正式真相层。
- `approved/archive/` 用于归档旧正式版本或旧索引。
- 不把 candidate 文件当正式事实引用给作者。

## 正式入库规则

只有当作者在当前线程明确给出 `approved`、`rejected` 或 `partial` 时，才推进审批结果。

推进 `approved` 时至少要同时处理：

- 对应的 patch 候选
- 对应的 approval 文件
- 受影响的 `approved/current/` 文件
- 必要的 `approved/archive/` 留痕
- 对应的日志和索引更新

## 公司层更新

`company/` 视为公司正式标准层。
如果要修改公司标准，先把候选写到 `company/proposals/`，并准备审批记录；不要直接覆盖正式标准。

## 新建书库

如果用户要开始一本新书，优先使用：

```bash
./scripts/new_book.sh <BookSlug> "书名"
```

然后在新书目录内继续工作。
