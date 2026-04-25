# 天神计划 / Project God

这个仓库把 Codex 变成一个可长期协作、可沉淀、可审批、可继承的网文创作公司操作系统。

## 仓库结构

- `AGENTS.md`: 主 agent 的项目级规则。
- `.codex/agents/*.toml`: 项目级 subagent 定义。
- `.agents/skills/company-manager/`: 主流程 skill。
- `company/`: 公司级正式标准、方法、模板与术语。
- `books/`: 每本书独立库存。
- `scripts/new_book.sh`: 从模板新建书库。

## Codex 中的落地方式

- 你在 Codex 里打开这个仓库后，顶层线程就是主 agent 入口。
- 需要并行时，明确要求 Codex 使用 subagents；官方文档说明 Codex 只会在你明确要求时生成 subagent。
- `candidate/` 是协作工作区，`approved/current/` 是唯一正式真相层。

## 快速开始

1. 在 Codex app / CLI 里把这个仓库作为项目打开。
2. 新建一本书：

   ```bash
   ./scripts/new_book.sh BookSlug "书名"
   ```

3. 在顶层线程说明当前书名、章节号和任务类型。
4. 审批通过前，只允许把成果落到 `candidate/`。
5. 你明确说出 `approved`、`rejected` 或 `partial` 后，再推进正式入库。

## 官方参考

- [AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [Skills](https://developers.openai.com/codex/skills)
- [Subagents](https://developers.openai.com/codex/subagents)
