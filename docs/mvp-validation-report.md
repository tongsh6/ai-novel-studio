# MVP 验证报告

## 分支

- `feat/mvp-validation`

## 验证目标

验证当前仓库是否已经具备最小“可执行工作流”能力，而不是停留在纯文档层。

本次验证的闭环范围：

`状态读取 -> 仓库校验 -> 章节上下文装配 -> 状态回写 -> 再次校验`

## 新增内容

- `scripts/novel_mvp.py`
- `docs/mvp-validation.md`
- `.gitignore`

## 执行的命令

### 1. 状态概览

```bash
python3 scripts/novel_mvp.py status
```

核心结论：

- 仓库已有 2 份章节草稿
- 仓库初始存在 2 份章节 metadata
- 实际 canonical metadata 只有 1 份
- 第 1 章初始存在重复 metadata
- 当前状态文件仍停留在“构思 + 第 0 章”

### 2. 基线检查

```bash
python3 scripts/novel_mvp.py check
```

基线问题数：`5`

### 3. 章节上下文装配

```bash
python3 scripts/novel_mvp.py chapter-context --chapter 1
```

验证结果：

- 能正确挑选第 1 章 canonical metadata
- 能正确找到第 1 章草稿
- 能输出当前项目状态包

### 4. 章节级校验

```bash
python3 scripts/novel_mvp.py chapter-check --chapter 1
python3 scripts/novel_mvp.py chapter-check --chapter 2
```

验证结果：

- 第 1 章校验通过
- 第 2 章被正确识别为“已有草稿但没有 metadata”
- 当前状态落后于第 2 章这一问题也被正确提示

### 5. 状态回写

```bash
python3 scripts/novel_mvp.py sync-state \
  --chapter 1 \
  --state drafting \
  --unit 第一卷-单元1 \
  --characters 杨无尘,云山望岳,云河 \
  --plot-hooks 4417号实验体,敖荒种子,离开寂静山门 \
  --tone 宁静中带离别感
```

验证结果：

- `.current_state.json` 被成功写回
- `.character_states.json` 被成功写回
- 历史状态记录开始生成

### 6. 回写后再次检查

```bash
python3 scripts/novel_mvp.py check
```

中间结果：

- 剩余问题数：`1`
- 唯一问题：第 1 章 metadata 重复

### 7. 清理结构性问题后再次检查

执行清理重复 metadata 后再次执行：

```bash
python3 scripts/novel_mvp.py check
```

最终问题数：`0`

最终结果：

```json
{
  "issues": [],
  "issue_count": 0
}
```

## 结果判断

本次 MVP 验证通过。

理由：

1. 仓库已具备最小可执行入口
2. 当前资料可以被程序稳定读取
3. 当前状态可以被程序更新
4. 校验结果会随回写而变化
5. 当前仓库已经从“纯知识库”进入“可执行工作流雏形”
6. 当前 MVP 校验可以跑到 0 问题
7. CLI 已经具备最小章节级检查能力

## 当前仍未覆盖的能力缺口

- 没有细纲自动生成
- 没有正文自动生成
- 没有更细粒度的连续性检查
- 没有人机协同节点
- 没有经验积累模块

## 下一步建议

优先解决顺序建议如下：

1. 统一章节 metadata 结构
2. 为角色、章节、伏笔、事件定义 schema
3. 增加 `chapter outline` 与更细粒度的章节状态回写能力
4. 在此基础上接入主编排 Agent
