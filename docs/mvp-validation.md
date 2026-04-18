# MVP 验证说明

## 目标

本次 MVP 不追求完整的小说生产系统，而是验证最小闭环是否可以在当前仓库中落地：

`状态读取 -> 上下文汇总 -> 仓库校验 -> 状态回写`

## 验证范围

本次只做一个零依赖 CLI：

- `status`
- `check`
- `chapter-context`
- `chapter-check`
- `sync-state`

脚本位置：

- `scripts/novel_mvp.py`

## 为什么这个范围足够作为第一轮验证

当前仓库最大的问题不是“没有更多设定”，而是“资料还没有被系统接起来”。  
第一轮 MVP 只需要回答一个问题：

`当前小说资料能不能被程序稳定读取、发现问题、拼装上下文、回写状态`

如果这个问题能被证明成立，后续再往上加：

- 细纲生成
- 正文生成
- 连续性更细粒度检查
- 主编排 Agent

## CLI 命令

### 1. 查看当前状态

```bash
python3 scripts/novel_mvp.py status
```

输出内容包括：

- 当前项目状态
- 当前角色状态摘要
- 草稿和 metadata 数量
- 重复章节 metadata 检测结果

### 2. 检查当前仓库问题

```bash
python3 scripts/novel_mvp.py check
```

当前会检测：

- 重复章节 metadata
- 当前章节状态是否仍停留在 0
- 活跃角色、活跃伏笔、情绪基调是否为空
- 角色状态与当前章节是否一致

### 3. 生成章节上下文包

```bash
python3 scripts/novel_mvp.py chapter-context --chapter 1
```

输出内容包括：

- 请求章节号
- 当前项目状态
- 该章节选中的 metadata
- 该章节草稿路径
- 当前已跟踪角色

### 4. 回写最小状态

```bash
python3 scripts/novel_mvp.py sync-state \
  --chapter 1 \
  --state drafting \
  --unit 第一卷-单元1 \
  --characters 杨无尘,云山望岳 \
  --plot-hooks 4417号实验体,敖荒种子 \
  --tone 宁静中带离别感
```

会更新：

- `novel_writing_system/大纲管理/临时规划/.current_state.json`
- `novel_writing_system/大纲管理/临时规划/.character_states.json`

### 5. 检查单章资产与状态

```bash
python3 scripts/novel_mvp.py chapter-check --chapter 1
```

这个命令会检查：

- 该章节是否存在 metadata
- 该章节是否存在草稿
- metadata 标题是否为空
- metadata 前情摘要是否为空
- 当前状态是否明显落后于目标章节
- 活跃角色是否已经进入角色状态文件

## 当前 MVP 能验证什么

### 已验证的能力

- 可以稳定读取仓库中的状态文件
- 可以扫描章节 metadata 与草稿
- 可以程序化发现当前数据层问题
- 可以为特定章节生成最小上下文包
- 可以对单章做最小资产与状态检查
- 可以把章节推进状态写回现有状态文件

## 本次实际验证结果

### 验证前

执行：

```bash
python3 scripts/novel_mvp.py check
```

发现 5 个问题：

1. 第 1 章存在重复 metadata
2. `current_state.current_chapter` 仍为 0
3. `active_characters` 为空
4. `active_plot_hooks` 为空
5. `emotional_tone` 为空

### 状态回写

执行：

```bash
python3 scripts/novel_mvp.py sync-state \
  --chapter 1 \
  --state drafting \
  --unit 第一卷-单元1 \
  --characters 杨无尘,云山望岳,云河 \
  --plot-hooks 4417号实验体,敖荒种子,离开寂静山门 \
  --tone 宁静中带离别感
```

结果：

- 当前章节被推进到第 1 章
- 当前状态从 `构思` 更新为 `drafting`
- 活跃角色、伏笔和情绪基调被写回
- 角色状态文件开始具备实际内容

### 验证后

再次执行：

```bash
python3 scripts/novel_mvp.py check
```

在执行一次 metadata 清理后，问题清零：

```json
{
  "issues": [],
  "issue_count": 0
}
```

说明当前最小验证链已经跑通。

这说明最小闭环已经成立：

`读取 -> 发现问题 -> 回写状态 -> 清理结构问题 -> 再次校验`

### 单章校验结果

执行：

```bash
python3 scripts/novel_mvp.py chapter-check --chapter 1
```

结果：

- 第 1 章 `ok = true`
- metadata、草稿、当前状态三者一致

执行：

```bash
python3 scripts/novel_mvp.py chapter-check --chapter 2
```

结果：

- 能正确识别第 2 章已有草稿但没有 metadata
- 能正确提示当前状态仍落后于第 2 章

这证明 CLI 已经能做最小粒度的章节级校验，而不是只做全仓库扫描。

### 还没有覆盖的能力

- 自动生成细纲
- 自动生成正文
- 更细粒度的连续性检查
- 节奏、爽点、信息揭示等专门状态模型
- 人工干预与经验积累模块

## 结论

这版 MVP 不是产品完成版，而是第一轮“系统层存在性验证”。  
它证明了当前仓库已经可以从纯文档库，开始过渡到“可执行工作流”的状态。
