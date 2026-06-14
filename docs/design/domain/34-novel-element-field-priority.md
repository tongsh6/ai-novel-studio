# Novel Element Field Priority

> 状态：v3 体系领域层 · 当前权威（领域细节）。归 v3 治理、服从 v3 原则（见 `docs/design/README.md`「整合原则：以 v3 为主体，吸取 v2」）；标题/历史中的 v2 仅为来源标记。
>
> 与 `08-novel-element-model.md` 关系：`08`（主链小说要素模型）是上游；本文的字段优先级/对象落位是其领域细节层，后续可考虑上提合并入 `08`（见整合台账 Step C）。
>
> 角色：把“小说要素全集”转译为 v2 Domain 的结构化优先级、对象落位和字段治理规则。
>
> 目标：定义哪些小说要素必须结构化管理，哪些适合半结构化，哪些应暂留文档层；同时明确这些要素应落到 `work / asset / continuity / style / artifact / document memory` 中的哪一层，避免把全部清单一次性塞进 schema。

---

## 1. 文档定位

本文回答 8 个问题：

1. 小说要素清单如何进入 v2，而不是变成超大表单
2. 哪些字段必须结构化，哪些只需要半结构化
3. 哪些内容应该保留为文档层或自由笔记
4. 要素应映射到哪些 Domain object
5. 字段是否进入 authoritative state 由什么决定
6. 要素如何影响 context assembly、quality gate、approval 和 experience
7. UI 后续应该如何呈现这些要素，而不是强迫用户一次性填写
8. 哪些字段暂时不冻结最终 schema

本文不负责：

- 每个对象的最终数据库表结构
- 字段类型全集
- UI 表单布局
- 自动抽取算法

本文只冻结字段优先级和落位原则。

---

## 2. 设计原则

### 2.1 清单不是表单

小说要素清单是建模视野，不是用户必须一次性填写的表单。

系统应允许：

- 对话中逐步补全
- 从正文和纲要中抽取候选
- 由 maintenance hook 草拟
- 由 adoption 进入权威层
- 暂时留在文档或笔记中

### 2.2 先分层，再定字段

任何要素进入 schema 前，先判断它属于：

- 主结构对象
- 资产对象
- 连续性对象
- 风格 / 作者意志对象
- 质量 / 运营策略
- 经验规则
- 文档层材料

### 2.3 必须结构化不等于必须人工填写

“必须结构化”表示系统长期运行需要稳定对象，不表示用户必须先填完。

例如：

- 角色可以从创作中逐步建立
- 伏笔可以由 hook 扫描后进入 pending adoption
- 事件可以从章节维护中提炼

### 2.4 字段可增长，但语义不能混

v2 采用 additive-first。

可以新增字段，但不能把不同语义混在一个字段里：

- 人物长期设定不等于当前状态
- 章节摘要不等于章节正文
- 作者偏好不等于某次 brief
- 爽点模板不等于具体章节爽点

---

## 3. 三层优先级

### 3.1 第一优先级：必须结构化

必须结构化的要素满足至少一个条件：

- 后续生成必须稳定引用
- 会参与一致性检查
- 会进入 authority / adoption / revision
- 会被 long-run resume 依赖
- 会影响阅读投影或维护 hook

默认包括：

- 书籍基础信息
- 角色实体
- 地点实体
- 势力 / 组织实体
- 卷实体
- 章节实体
- 伏笔实体
- 事件实体
- 状态实体
- 连续性规则

### 3.2 第二优先级：建议半结构化

半结构化要素满足：

- 需要被检索和复用
- 需要影响 prompt / validator / quality gate
- 但不适合立即拆成强 schema

默认包括：

- 主题表达
- 卖点设计
- 爽点模板
- 节奏模板
- 情感推进模板
- 决策日志
- 网文运营策略
- 章节功能说明

### 3.3 第三优先级：暂留文档层

文档层要素满足：

- 自由度高
- 变化频繁
- 主要供作者思考
- 不宜直接进入 authoritative state

默认包括：

- 风格偏好长文说明
- 灵感碎片
- 竞品笔记
- 作者自由思考
- 大段世界观散文
- 未整理脑洞

---

## 4. 要素到对象的总映射

### 4.1 work

承载作品根信息。

适合结构化：

- 书名
- 副标题
- 一句话卖点
- 核心标签
- 题材大类
- 子题材
- 目标平台
- 目标读者
- 目标字数
- 预计卷数
- 更新频率
- 商业定位
- 核心差异点

不建议直接塞入 work：

- 所有竞品笔记
- 所有主题长文
- 所有人物完整档案
- 所有章节设计

这些应通过 refs 或文档层连接。

### 4.2 writing_preferences / style objects

承载“怎么写”。

适合结构化或半结构化：

- 情绪底色
- 叙述距离
- 爽文 / 剧情文倾向
- 热血 / 压抑倾向
- 群像 / 主角独秀倾向
- 章节尾 hook 偏好
- 对话与描写比例偏好
- 禁区与边界
- 作者不想表达的问题

注意：

- 风格偏好长文说明可保留在 document memory
- 被多次验证的偏好可由 Experience Engine 提议转成 `writing_preferences`

### 4.3 main_outline

承载整书级主线骨架。

适合结构化：

- 主线目标
- 主线敌人
- 主线悬念
- 主线任务链
- 主线推进节点
- 主线转折节点
- 主线高潮节点
- 主线回收节点
- 主线真相揭示顺序
- 终局收束点

适合半结构化：

- 主线误导信息
- 大悬念设计说明
- 主题与结局情绪的连接说明

### 4.4 volume / arc

> ADR-0004 已冻结 `volume -> arc`：volume 是 canonical middle-structure parent，arc 是 volume-local story-planning unit。

承载中观结构。

适合结构化：

- 每卷主题
- 每卷主任务
- 每卷主敌人
- 每卷地图
- 每卷核心冲突
- 每卷高潮
- 每卷收束方式
- 每卷钩子
- 单元划分
- 单元目标
- 单元节奏
- 单元爽点
- 单元压迫点
- 单元转折点

这些字段通常是 long-run 的计划来源，需支持 revision 和 approval。

### 4.5 chapter / scene

承载章级和场景级任务。

适合结构化：

- 章节编号
- 章节标题
- 本章功能
- 本章核心事件
- 本章冲突
- 本章爽点
- 本章信息点
- 本章伏笔
- 本章人物推进
- 本章情感推进
- 本章世界观推进
- 本章节奏等级
- 本章结尾钩子
- 本章字数目标
- 本章是否付费点
- 本章是否爆点章

注意：

- 章级设计是计划对象，不等于正文 draft
- 写后事实应通过 maintenance 进入 `chapter_summary / timeline_event / state_snapshot`

### 4.6 character

承载人物长期设定。

适合结构化：

- 姓名
- 性别
- 年龄
- 身份
- 外貌特征
- 性格标签
- 核心欲望
- 核心恐惧
- 明面目标
- 深层目标
- 初始缺陷
- 核心执念
- 价值观
- 行动方式
- 决策风格
- 情绪触发点
- 底线
- 禁忌
- 口头禅或表达习惯
- 成长弧线
- 能力成长路径
- 身份秘密

不应放入 character 的内容：

- 当前所在地点
- 当前伤势
- 当前知道什么
- 当前持有什么装备

这些属于 `state_snapshot`。

### 4.7 relationship

承载人物或势力之间的关系。

适合结构化：

- 亲缘关系
- 师徒关系
- 朋友关系
- 同伴关系
- 对手关系
- 仇敌关系
- 爱情关系
- 暧昧关系
- 利益联盟
- 上下级关系
- 阵营关系
- 隐藏关系

关系变化节点不应只改 relationship 静态字段。

应通过：

```text
timeline_event
  -> state_snapshot
  -> relationship current state
```

### 4.8 faction / organization / location

承载势力、组织和地点资产。

适合结构化：

- 势力格局
- 阶级结构
- 社会制度
- 经济结构
- 文化风俗
- 宗教信仰
- 地理格局
- 地点索引
- 地理移动时间
- 势力状态

注意：

- 长期设定属于 asset
- 当前占领、毁灭、封锁、迁移等属于 `state_snapshot / timeline_event`

### 4.9 ability / item / system asset

承载力量、装备、金手指和系统类资产。

适合结构化：

- 境界划分
- 升级条件
- 升级代价
- 力量来源
- 力量上限
- 力量限制
- 力量克制关系
- 稀有资源
- 技能分类
- 装备体系
- 血脉体系
- 天赋体系
- 系统任务机制
- 成就机制
- 掉落机制
- 召唤机制
- 阵法机制
- 法术机制
- 神器机制
- 异能机制
- 身份权限机制
- 死亡机制
- 复活机制
- 时间机制
- 因果机制
- 金手指名称
- 金手指来源
- 金手指形态
- 金手指触发条件
- 金手指代价
- 金手指限制
- 金手指成长路线
- 金手指终极形态

这些字段通常直接参与：

- worldrule
- power_scaling quality gate
- knowledge boundary
- state_snapshot

### 4.10 worldbuilding / worldrule

worldbuilding 承载世界观总览。

worldrule 承载不能违背的硬规则。

适合结构化：

- 时间背景
- 空间背景
- 历史大事件
- 科技水平
- 修炼体系
- 战斗规则
- 资源体系
- 禁忌规则
- 世界真相
- 世界灾难
- 世界边界
- 世界漏洞
- 世界异常
- 世界运行逻辑

适合半结构化：

- 世界观核心隐喻
- 文化氛围长文
- 设定反差说明

### 4.11 foreshadowing

承载伏笔生命周期。

适合结构化：

- 伏笔编号
- 埋设章节
- 回收章节
- 回收方式
- 延迟回收策略
- 误导线索
- 红鲱鱼
- 伏笔状态
- 关联主线 / 支线
- 关联角色 / 物品 / 世界规则

伏笔对象默认 adoption 敏感。

### 4.12 timeline_event

承载事件索引与因果链。

适合结构化：

- 故事开始点
- 引爆点
- 中段变轨点
- 终局收束点
- 主线推进节点
- 主线转折节点
- 主线高潮节点
- 主线回收节点
- 支线开始点
- 支线结束点
- 支线与主线连接点
- 关系变化节点
- 关系破裂节点
- 关系修复节点

timeline_event 是“发生了什么”，不是整章摘要。

### 4.13 state_snapshot

承载某个锚点的当前有效状态。

适合结构化：

- 人物能力一致
- 人物认知边界
- 人物关系当前态
- 地理移动时间
- 装备持有情况
- 势力状态
- 境界成长
- 伤势恢复
- 伏笔状态
- 死亡与存活状态
- 已公开信息
- 未公开信息
- 仅作者知道的信息
- 仅读者知道的信息
- 仅角色知道的信息
- 禁止提前泄露的信息
- 需要逐步揭示的信息

这些字段是 continuity guard 和 context assembly 的关键输入。

### 4.14 chapter_summary

承载章级高密度摘要。

适合结构化或半结构化：

- 本章核心事件
- 本章冲突
- 本章信息点
- 本章人物推进
- 本章情感推进
- 本章世界观推进
- 本章伏笔变化
- 本章结尾状态

chapter_summary 不应直接内嵌在 chapter 中，而是独立连续性 / memory 对象。

### 4.15 document memory

承载高自由度材料。

适合保留：

- 参考竞品
- 灵感碎片
- 作者自由思考
- 风格偏好长文说明
- 竞品笔记
- 主题散文
- 未定稿脑洞

这些可以被检索，但默认不进入 authoritative context。

---

## 5. 要素类别到落位矩阵

| 要素类别 | 推荐落位 | 优先级 | 备注 |
|---|---|---|---|
| 项目基础信息 | `work` | 必须结构化 | 作品根 scope |
| 题材与定位 | `work` / `writing_preferences` | 必须结构化或半结构化 | 定位变更通常需 approval |
| 主题与表达 | `writing_preferences` / document memory | 半结构化 | 主题结论可进结局规划 |
| 核心卖点 | `work` / semi-structured artifact | 半结构化 | 可影响 quality gate |
| 故事基本盘 | `main_outline` | 必须结构化 | 主线级 adoption 敏感 |
| 主角要素 | `character` / `state_snapshot` | 必须结构化 | 长期设定与当前状态分离 |
| 配角与反派 | `character` / `relationship` | 必须结构化 | 可牺牲性等需 approval policy |
| 人物关系 | `relationship` / `timeline_event` | 必须结构化 | 变化用事件表达 |
| 世界观要素 | `worldbuilding` / `worldrule` | 必须结构化或半结构化 | 硬规则必须结构化 |
| 力量与金手指 | `ability` / `item` / `worldrule` | 必须结构化 | 参与战力和规则检查 |
| 剧情结构 | `main_outline` / `arc` | 必须结构化 | 支线可作为 arc 或 outline branch |
| 卷、单元、章节 | `volume` / `arc` / `chapter` / `scene` | 必须结构化 | long-run 计划来源 |
| 冲突 / 伏笔 / 爽点 / 情感 / 节奏 | mixed | 必须结构化或半结构化 | 伏笔必须结构化，爽点模板半结构化 |
| 网文特有要素 | strategy artifact / quality gate | 半结构化 | 关键节点可落 chapter 字段 |
| 一致性与信息管理 | `state_snapshot` / `worldrule` | 必须结构化 | continuity guard 输入 |
| 执行与质量评估 | registry / quality finding / audit | 半结构化 | 不直接进入故事对象 |
| 结局层 | `main_outline` / ending artifact | 必须结构化或半结构化 | 高 approval 敏感 |

---

## 6. 结构化判定规则

某个字段是否必须结构化，按以下规则判断。

### 6.1 需要一致性检查

凡是会被检查“前后是否矛盾”的字段，倾向结构化。

例如：

- 人物能力
- 装备持有
- 存活状态
- 伏笔状态
- 角色认知边界

### 6.2 会影响后续生成

凡是后续 executor 必须稳定读取的字段，倾向结构化。

例如：

- 当前卷目标
- 章节功能
- 主角核心欲望
- 世界硬规则
- 金手指限制

### 6.3 会改变 canon

凡是采纳后会成为 canon 的字段，倾向结构化并带 revision。

例如：

- 主线目标
- 反派结局
- 世界真相
- 角色死亡
- 结局方向

### 6.4 只是表达倾向

表达倾向适合半结构化。

例如：

- 偏热血还是偏压抑
- 爽文还是剧情文
- 风格卖点
- 话题性卖点

### 6.5 只是探索材料

探索材料适合 document memory。

例如：

- 竞品分析长文
- 灵感碎片
- 作者自由思考
- 未整理设定脑洞

---

## 7. Adoption 与 Approval

字段落位也决定 adoption / approval 策略。

默认高 approval 敏感：

- 作品定位
- 主角核心设定
- 反派核心设定
- 主线目标
- 卷纲定稿
- 关键章节细纲
- 角色死亡 / 背叛 / 黑化
- 世界硬规则
- 结局方向

默认 adoption 敏感：

- main_outline
- volume / arc plan
- chapter / scene plan
- character canonical profile
- worldrule
- foreshadowing
- state_snapshot
- timeline_event
- chapter_summary

默认低风险：

- 临时 brainstorm
- 多候选卖点
- 章节标题候选
- 不改变事实的润色说明

---

## 8. 与 Context Assembly 的关系

不同层级要素进入上下文的方式不同。

默认优先级：

1. 当前任务 brief
2. 当前 anchor 的结构对象
3. 当前 authoritative continuity
4. 当前 authoritative style / preferences
5. relevant semi-structured strategy
6. summaries
7. 必要原文片段
8. document memory 中的相关材料

禁止默认做法：

- 把整个要素清单塞进 prompt
- 把所有竞品笔记塞进 prompt
- 把未采纳设定当成 canon
- 把灵感碎片默认作为执行约束

---

## 9. 与 Quality Gates 的关系

字段落位决定 quality gate 可检查什么。

示例：

- `worldrule` 支撑设定冲突检查
- `character` + `state_snapshot` 支撑人物逻辑检查
- `foreshadowing` 支撑伏笔检查
- `ability` / `worldrule` 支撑战力膨胀检查
- `chapter` 中的付费点 / 爆点字段支撑网文留存检查
- `state_snapshot` 中的信息边界支撑 knowledge boundary 检查

质量门不能依赖自由文本“自觉记得”。

---

## 10. 与 Experience Engine 的关系

半结构化要素是经验引擎的重要候选来源。

例如：

- 作者反复保留的章节尾 hook 可成为 hook 经验
- 作者反复删除的套路可成为高频错误清单
- 被采纳的爽点结构可成为爽点经验
- 多次成功的节奏配置可成为节奏模板

但经验要进入长期偏好或策略，仍需走 experience artifact -> review / adoption -> experience rule。

---

## 11. UI 呈现原则

> ADR 冻结：首批结构面板对象、字段优先级、L1-L4 渐进披露与 UI 不得自造 schema 的边界已由 `adr/0015-structure-panel-field-priority.md` 冻结。

UI 不应把本文变成一个巨型信息录入页。

推荐呈现：

- 建立期只展示最小 work / positioning / protagonist / main conflict
- 规划期逐步展开 volume / arc / chapter
- 产出期重点展示当前 chapter / scene / brief / continuity warnings
- 维护期展示 pending maintenance artifacts
- 阅读与修订期展示 accepted 内容和可回刷对象

结构面板可以有完整字段，但默认折叠。

---

## 12. 本文冻结的硬骨

> ADR 冻结：本节硬骨中的 UI 前阻塞部分已由 `adr/0015-structure-panel-field-priority.md` 升格冻结。

本文正式冻结以下字段优先级硬骨：

1. 小说要素清单是建模视野，不是一次性填写表单
2. 要素分为必须结构化、建议半结构化、暂留文档层三类
3. 必须结构化的要素默认包括 work、character、location、faction / organization、volume、chapter、foreshadowing、timeline_event、state_snapshot、worldrule
4. 半结构化要素默认包括主题表达、卖点设计、爽点模板、节奏模板、情感推进模板、决策日志、网文运营策略
5. 文档层默认承载风格长文、灵感碎片、竞品笔记和作者自由思考
6. 长期设定、当前状态、章节摘要、正文 draft、经验规则必须分层，不能混写
7. 字段是否进入 authoritative state 必须受 adoption / approval / revision 约束

---

## 13. 下一步

后续应细化：

1. 必须结构化对象的最小字段 schema
2. 半结构化 strategy artifact 的类型集合
3. document memory 的 source metadata 和 retrieval policy
4. UI 结构面板的字段分组与渐进披露规则
