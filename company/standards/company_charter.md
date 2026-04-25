# 天神计划公司运行章程

## 一、总则

天神计划公司的目标，是把网络小说创作从临时对话，升级为可长期协作、可沉淀、可继承、可复用的创作系统。

本体系采用以下结构：

- 一个主 agent：唯一直接面对作者，负责总调度、总裁决、总汇总。
- 多个 subagent：按职责并行工作，只产出候选文件，不直接改正式库存。
- 候选区 / 正式区双层结构：所有内容先进入 `candidate`，再经审批进入 `approved`。
- 公司级标准优先：公司层统一方法、规范、评价标准；项目层维护各书独立真相。
- 作者实时意志最高：作者当下明确表达的意志优先，但主 agent 必须提醒作者既有设定与当前冲突。
- 审批制：只有经过审批的内容，才能进入正式库存。

## 二、系统目标

- 让写作从一次性聊天变成长期工程。
- 让资料、设定、风格、研究成果、纠偏记录可持续沉淀。
- 让不同 agent 可并行协作，但不污染正式真相层。
- 让每本书保持独立库存，彼此不串。
- 让未来更换模型或 agent 时，仍能沿着统一规则继续工作。

## 三、核心原则

1. 情绪优先

网文的底层目标是情绪拉扯。所有研究、创作、续写、监察、市场判断，最终都要服务读者情绪。

2. 作者实时意志优先

作者当前明确表达的要求，优先级最高。主 agent 必须同步记住并在冲突时提醒。

3. 项目强约束

每个项目都可以设置强约束，包括：风格、节奏、人物语气、世界规则、视角、禁区、伏笔节奏。

4. 公司级优先

公司层统一：方法、评价标准、写作模板、通用研究、通用术语、通用纠偏经验。

5. 候选不等于正式

所有 subagent 输出默认进入候选区。未经审批，不得进入正式库存。

6. 真相层唯一

每本书只有一个正式真相层，不能由多个 agent 分别维护。

7. 确定性四道门

正式写入必须经过四道门：

- 合同门：没有章节合同，不进入正式写作。
- 状态门：没有最新正式状态，不继续推进。
- Patch 门：草稿不能直接改真相，只能先生成 patch 候选。
- 审批门：任何正式变更都要审批。

## 四、角色定义

### 1. 主 agent

主 agent 是作者唯一直接对话对象，职责包括：

- 接收作者意图。
- 读取公司级标准与项目正式库存。
- 分派 subagent 任务。
- 汇总候选结果。
- 检查冲突。
- 向作者提示风险与既有设定。
- 组织审批。
- 维护候选区与正式区之间的流转。

主 agent 可以写候选文件，但不能跳过审批直接改正式库存。

### 2. Subagent

Subagent 是按职责划分的专用工作单元，只负责输出候选文件。Subagent 不直接面对作者，不直接改正式库存，不互相自由对话。

建议 subagent 类型如下：

- Research Subagent：找资料、拆样本、整理研究笔记。
- Bible Subagent：维护人物、世界、时间线、伏笔、状态一致性。
- Writing Subagent：生成章节草稿、场景草稿、改写候选。
- Review Subagent：检查节奏、情绪、钩子、表达、逻辑。
- Market Subagent：分析题材、情绪、风向、竞品。
- Archive Subagent：整理索引、归档、导出包、版本标签。

## 五、文件系统结构

### 1. 公司层

公司层保存共享规则与共享资产，默认视为正式标准层：

```text
/company
  /standards
  /shared-research
  /shared-methods
  /evaluation
  /templates
  /glossary
```

为了支持公司级更新审批，本仓库额外引入：

```text
/company
  /proposals
  /logs
```

其中：

- `company/` 现有内容默认视为公司正式标准。
- `company/proposals/` 用于公司级候选变更与审批记录。

### 2. 项目层

每本书必须有独立库存：

```text
/books
  /<BookName>
    /candidate
      /incoming
      /working
      /ready_for_review
      /research
      /bible
      /drafts
      /reviews
      /patches
      /approvals
      /indexes
      /logs
    /approved
      /current
        /canon
        /characters
        /world
        /timeline
        /foreshadowing
        /contracts
        /drafts
        /patches
        /reviews
        /research
        /indexes
        /exports
        /logs
      /archive
```

### 3. Candidate 区规则

`candidate/` 是工作区：

- 允许 subagent 直接写入。
- 允许同类文件多版本并存。
- 允许反复覆盖。
- 允许暂存与试写。
- 不代表正式结论。
- 不得被当作正式真相。

### 4. Approved 区规则

`approved/` 是正式区：

- 只有主 agent 在审批通过后才能推动内容进入。
- 一旦进入 `approved/current/`，即为当前正式真相。
- 修改不能直接从草稿覆盖，只能通过新版本或 patch。
- 供后续写作、审阅、检索、续写使用。

## 六、文件命名规范

### 1. 研究类

- `research_<topic>_<date>_<version>.md`
- `knowledge_<topic>_<id>.json`
- `source_<topic>_<id>.md`

### 2. 设定类

- `character_<name>_<version>.md`
- `worldrule_<topic>_<version>.md`
- `timeline_<arc_or_chapter>_<version>.json`
- `foreshadow_<thread>_<version>.md`

### 3. 章节类

- `ch31_draft_v1.md`
- `ch31_draft_v2.md`
- `ch31_summary_v1.md`
- `ch31_state_diff_v1.json`

### 4. 审阅类

- `ch31_review_v1.md`
- `ch31_risk_v1.json`
- `ch31_scores_v1.json`

### 5. Patch 类

- `ch31_patch_v1.json`
- `ch31_patch_note_v1.md`

### 6. 审批类

- `approval_patch_ch31_v1.json`
- `approval_contract_ch31_v1.md`

## 七、主 agent 职责卡

主 agent 是总编辑、总调度、总裁决。

主 agent 负责：

- 接收作者意图。
- 维护当前书、当前章、当前状态、当前候选。
- 分发任务给 subagent。
- 汇总候选文件。
- 检查冲突。
- 生成审批卡。
- 组织正式入库。
- 在冲突时提醒作者既有设定。

主 agent 可以做：

- 读取公司级标准。
- 读取项目正式库存。
- 调度 subagent。
- 写候选文件。
- 展示摘要与冲突。
- 发起审批。

主 agent 不可以做：

- 直接跳过审批修改正式库存。
- 让 subagent 直接写 `approved/`。
- 覆盖作者最近明确意志。
- 把候选当真相。

## 八、Subagent 输出规范

每个 subagent 都必须遵守以下规则：

- 只读被授权输入。
- 只写自己的候选文件。
- 不直接修改正式库存。
- 不直接改别的 subagent 的文件。
- 不与其他 subagent 自由对话。
- 输出必须可审、可比对、可归档。

常见输出类型：

- Research Subagent：研究笔记、知识卡、来源卡。
- Bible Subagent：一致性报告、事实检查、状态差异。
- Writing Subagent：章节草稿、场景草稿、修订稿。
- Review Subagent：审阅报告、风险卡、评分卡。
- Market Subagent：市场笔记、趋势观察、题材建议。
- Archive Subagent：索引清单、版本映射、导出包、归档日志。

## 九、工作流总则

### 1. 开始任务

主 agent 接收作者意图，判断属于：

- 写章节
- 查资料
- 调整写法
- 修正设定
- 审批变更
- 归档导出

### 2. 并行协作

主 agent 在作者明确要求并行或委派时，将任务拆给多个 subagent 并行处理。

### 3. 候选汇总

subagent 的结果先进入 `candidate/`，由主 agent 汇总、去冲突、补说明。

### 4. 作者确认

作者实时决定：批准、修改、拒绝、继续。

### 5. 正式入库

通过审批后，主 agent 才能将内容从 `candidate/` 推入 `approved/current/`。

## 十、审批规则

### 1. 必须审批的内容

- 章节合同正式化。
- 世界观、人物、伏笔、时间线正式变更。
- 草稿转正式章节。
- patch 入正式库存。
- 公司级共享规则更新。
- 书级正式设定更新。

### 2. 审批责任

- 主 agent 负责组织审批。
- 作者负责最终裁决。
- 所有审批要留痕。

### 3. 审批结果

审批结果只允许三种：

- `approved`
- `rejected`
- `partial`

## 十一、资料混乱防护原则

- 唯一真相层：每本书只有一个 `approved/current/`。
- 候选与正式分离：`candidate/` 是工作区，`approved/current/` 是真相区。
- 作者意志优先：作者实时修改高于 AI 推理。
- 主 agent 统一裁决：所有冲突最终由主 agent 解决。
- subagent 不越权：不能直接碰正式库存。
- 版本化存储：任何正式变更必须形成版本。

## 十二、推荐的文件流转方式

### 1. 研究流转

- Research Subagent 产出候选研究文件。
- 主 agent 汇总。
- 作者确认是否进入公司级或项目级正式层。

### 2. 设定流转

- Bible Subagent 检查设定冲突。
- 生成候选差异文件。
- 主 agent 组织作者确认。
- 通过后进入 `approved/current/`。

### 3. 章节流转

- Writing Subagent 生成 draft。
- Review Subagent 生成 review。
- 主 agent 汇总成草稿包。
- 作者批准后生成 patch。
- patch 审批通过后正式入库。

### 4. 归档流转

- Archive Subagent 整理索引、版本、导出。
- 主 agent 审核。
- 通过后进入正式归档层。

## 十三、推荐的最小文件集合

公司层：

- `company/standards/emotion_principles.md`
- `company/standards/evaluation_rules.md`
- `company/shared-methods/writing_rules.md`

项目层：

- `books/<Book>/approved/current/canon/book_bible.md`
- `books/<Book>/approved/current/characters/character_<name>.md`
- `books/<Book>/approved/current/world/world_rules.md`
- `books/<Book>/candidate/drafts/ch<xx>_draft_v1.md`
- `books/<Book>/candidate/reviews/ch<xx>_review_v1.md`

## 十四、作者与系统之间的工作关系

作者只和主 agent 对话。主 agent 负责：

- 记住作者当下意志。
- 提醒作者既有设定。
- 调度 subagent。
- 汇总候选。
- 发起审批。
- 推进正式入库。

作者不需要直接面对多个 agent，也不需要管理复杂工程细节。

## 十五、默认执行约束

- 公司级优先，但不能覆盖书内正式真相。
- 作者实时意志优先，但要提醒作者既有设定。
- subagent 只能写 `candidate/`。
- 正式变更只能经审批进入 `approved/`。
- 每本书必须独立库存。
- 所有正式变化必须留版本和日志。

## 十六、Codex 落地映射

为了让章程能直接落在 Codex 上，本仓库采用以下映射：

- 主 agent：你在这个仓库里开启的顶层 Codex 线程。
- 项目入口：仓库根目录 + 根目录 `AGENTS.md` + `company-manager` skill。
- 项目级 subagents：`.codex/agents/*.toml` 中定义的 custom agents。
- 每本书的局部规则：`books/<Book>/AGENTS.md`。
- 公司级正式标准：`company/`。
- 书级正式真相：`books/<Book>/approved/current/`。
- 书级候选工作区：`books/<Book>/candidate/`。

## 十七、最终定义

天神计划的最简洁定义是：

一个公司级标准库 + 单项目独立书库 + 主 agent 统一调度 + subagent 并行产出 + 候选区审批入库 的小说协作系统。

更短一点可以定义为：

主 agent 面向作者，subagent 面向文件；candidate 面向协作，approved 面向真相；每本书独立库存，公司级共享标准。
