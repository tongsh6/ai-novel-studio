# 对话式小说工作台 V1 对象模型定义文档

## 1. 文档目标

本文档定义「对话式小说工作台 V1」的对象模型边界，用于统一以下事项：

- 产品对象抽象
- 数据建模边界
- 前后端对象协议
- 上下文组装输入
- 后续表结构与接口设计基础

本文档**不是数据库 DDL**，也**不是 UI 原型稿**。  
它是介于产品设计与工程落地之间的领域模型定义稿。

---

## 2. 建模原则

### 2.1 对话优先，结构兜底

用户前台以自然语言驱动创作。  
系统后台必须把关键创作事实沉淀为结构化对象。

### 2.2 核心字段少而稳

核心字段只保留高频参与以下能力的内容：

- 创作主链路
- 上下文组装
- 一致性校验
- 状态流转
- 对象检索与定位

### 2.3 扩展字段动态承接

作品特有、题材特有、尚未证明通用性的属性，先进入扩展层，不直接污染核心模型。

### 2.4 文档资产不强行字段化

灵感碎片、竞品笔记、长文风格说明、自由思考等，保留在文档层，不强制结构化。

### 2.5 派生分析不是源数据

可读性、节奏分、崩盘风险、商业潜力等，属于分析投影，不属于对象源字段。

### 2.6 连续性状态单独建层

人物知道什么、伤势如何、装备持有、身份是否公开、地点是否变更等，不能全靠人脑记忆，必须有独立的连续性状态层。

---

## 3. 模型分层

### 3.1 核心对象层

- Work
- Character
- Relationship
- Faction
- Location
- WorldRule
- Outline
- Plotline
- Volume
- Chapter
- Event
- Foreshadow
- Draft
- DecisionLog
- ContinuityState

### 3.2 文档资产层

- DocAsset
- PromptAsset

### 3.3 派生投影层

- AnalysisProjection
- ReadingProjection
- IndexProjection

---

## 4. 字段分层约定

每个对象统一分为四层：

### 4.1 `core`

必须稳定结构化、且应优先进入正式 schema 的字段。

### 4.2 `extension`

先放扩展层的字段，适合：

- 题材特化
- 作品特化
- 高频但尚未证明全局通用
- 暂时不值得进入核心 schema

### 4.3 `note`

不做强结构化，保留为备注、文档、说明文本。

### 4.4 `derived`

派生分析结果、评估指标、视图信息，不作为源字段存储核心事实。

---

## 5. 对象定义

---

## 5.1 Work

作品根对象，负责承载整本书的顶层上下文。

### 5.1.1 职责

- 定义作品基础定位
- 维护全局创作阶段
- 维护全局约束与方向
- 作为所有下级对象的归属根

### 5.1.2 Work.core

- `id`
- `title`
- `subtitle`
- `oneLinePitch`
- `genre`
- `subgenres`
- `tags`
- `targetPlatform`
- `targetAudience`
- `targetWordCount`
- `plannedVolumeCount`
- `updateFrequency`
- `commercialPositioning`
- `coreDifferentiators`
- `boundaries`
- `coreTheme`
- `subThemes`
- `emotionalBaseTone`
- `desiredEndingEmotion`
- `startState`
- `endState`
- `incitingIncident`
- `midpointShift`
- `finalConvergence`
- `summary`
- `stage`
- `activeVolumeId`
- `activeChapterId`
- `createdAt`
- `updatedAt`

### 5.1.3 Work.extension

- `competitorRefs`
- `motif`
- `philosophyQuestion`
- `authorWantsToSay`
- `authorDoesNotWantToSay`
- `valuePosition`
- `serializationStrategy`
- `platformSpecificNotes`
- `commercialHookStyle`

### 5.1.4 Work.note

- 长文风格说明
- 竞品长文笔记
- 情绪板文字说明
- 作者自由思考

### 5.1.5 Work.derived

- `commercialPotentialScore`
- `fatigueRisk`
- `collapseRisk`
- `longTermExpectationScore`

---

## 5.2 Character

角色对象，适用于主角、配角、反派、导师等。

### 5.2.1 职责

- 承载角色内外在结构
- 承载角色驱动力与弧线
- 作为关系、事件、章节推进的重要参与方

### 5.2.2 Character.core

- `id`
- `workId`
- `name`
- `gender`
- `age`
- `identity`
- `roleType`
- `appearance`
- `publicPersona`
- `innerCore`
- `coreDesire`
- `coreFear`
- `surfaceGoal`
- `deepGoal`
- `initialFlaw`
- `obsession`
- `values`
- `actionStyle`
- `decisionStyle`
- `emotionTriggers`
- `bottomLine`
- `taboos`
- `growthArc`
- `powerGrowthPath`
- `identitySecrets`
- `breakdownPoints`
- `fateQuestion`
- `firstAppearanceChapterId`
- `currentState`
- `status`
- `updatedAt`

### 5.2.3 Character.extension

- `speechHabit`
- `speechTaboo`
- `behaviorHabit`
- `pressureResponse`
- `intimacyStyle`
- `trustThreshold`
- `jealousyTrigger`
- `publicMaskStrength`
- `symbolicItem`
- `reputation`
- `highlightSceneRefs`
- `coolPointMechanism`
- `sacrificePotential`
- `growthPotential`

### 5.2.4 Character.note

- 角色自由备注
- 替代设定方案
- 气质描述文本

### 5.2.5 Character.derived

- `dimensionalityScore`
- `consistencyRisk`
- `popularityPotential`

---

## 5.3 Relationship

人物关系对象，用于表达角色之间的显性与隐性关系。

### 5.3.1 职责

- 表达关系类型
- 表达关系阶段变化
- 表达关系线的动态趋势

### 5.3.2 Relationship.core

- `id`
- `workId`
- `fromCharacterId`
- `toCharacterId`
- `relationType`
- `publicState`
- `hiddenState`
- `currentStage`
- `dynamic`
- `alignment`
- `targetArc`
- `updatedAt`

### 5.3.3 Relationship.extension

- `trustLevel`
- `intimacyLevel`
- `powerBalance`
- `asymmetryNotes`
- `changeEventRefs`
- `ruptureEventRefs`
- `repairEventRefs`
- `emotionalFunction`
- `conflictFunction`
- `infoFunction`

### 5.3.4 Relationship.note

- 化学反应备注
- 关系转向备选方案

### 5.3.5 Relationship.derived

- `tensionScore`
- `progressionHealth`

---

## 5.4 Faction

势力对象，用于门派、组织、国家、公司、军团等。

### 5.4.1 职责

- 表达阵营结构
- 表达组织资源与目标
- 参与剧情与世界层冲突

### 5.4.2 Faction.core

- `id`
- `workId`
- `name`
- `type`
- `publicImage`
- `trueNature`
- `ideology`
- `goal`
- `leaderCharacterIds`
- `allyFactionIds`
- `enemyFactionIds`
- `coreResources`
- `tabooRules`
- `firstAppearanceChapterId`
- `currentState`
- `status`

### 5.4.3 Faction.extension

- `classPosition`
- `internalStructure`
- `publicSupportLevel`
- `collapseRisk`
- `signatureStyle`

### 5.4.4 Faction.note

- 长文 lore
- 边支故事说明

### 5.4.5 Faction.derived

- `influenceScore`
- `threatScore`

---

## 5.5 Location

地点对象，用于城市、区域、门派、秘境、街区、学院等。

### 5.5.1 职责

- 表达空间叙事单位
- 承载地理与氛围信息
- 支撑事件、移动、章节场景

### 5.5.2 Location.core

- `id`
- `workId`
- `name`
- `type`
- `summary`
- `atmosphere`
- `geographicRole`
- `relatedFactionIds`
- `connectedLocationIds`
- `firstAppearanceChapterId`
- `currentState`
- `status`

### 5.5.3 Location.extension

- `hazards`
- `secrets`
- `cultureMarkers`
- `economicMarkers`
- `symbolicMeaning`

### 5.5.4 Location.note

- 景观长文描述
- 灵感来源说明

### 5.5.5 Location.derived

- `plotImportanceScore`

---

## 5.6 WorldRule

世界规则对象，统一承载世界规则、力量规则、金手指规则。

### 5.6.1 职责

- 表达世界底层逻辑
- 表达力量体系与限制
- 参与一致性校验与上下文组装

### 5.6.2 WorldRule.core

- `id`
- `workId`
- `domain`
- `name`
- `summary`
- `statement`
- `implications`
- `limitations`
- `costs`
- `exceptions`
- `status`
- `priority`

### 5.6.3 WorldRule.extension

- `timeBackground`
- `socialSystem`
- `classStructure`
- `economicStructure`
- `religionBelief`
- `languageSystem`
- `technologyLevel`
- `cultivationSystem`
- `battleRules`
- `resourceSystem`
- `worldTruth`
- `worldDisaster`
- `worldBoundary`
- `worldAnomaly`
- `metaphor`
- `realmLevels`
- `upgradeConditions`
- `upgradeCosts`
- `powerSource`
- `powerCap`
- `counterRelations`
- `deathMechanism`
- `resurrectionMechanism`
- `timeMechanism`
- `causalityMechanism`
- `cheatName`
- `cheatOrigin`
- `cheatForm`
- `cheatTrigger`
- `cheatGrowthRoute`
- `cheatFinalForm`

### 5.6.4 WorldRule.note

- 长文设定 lore
- 未启用机制
- 备选世界机制

### 5.6.5 WorldRule.derived

- `freshnessScore`
- `complexityRisk`
- `contradictionRisk`

---

## 5.7 Outline

总纲对象，用于表达全书级叙事骨架。

### 5.7.1 职责

- 定义核心冲突与总目标
- 定义故事发动机
- 定义中段变轨与终局走向

### 5.7.2 Outline.core

- `id`
- `workId`
- `oneSentencePremise`
- `protagonistNeed`
- `whyImpossible`
- `costToPay`
- `mainOpponent`
- `coreConflict`
- `mainGoal`
- `stageGoals`
- `finalGoal`
- `storyStartPoint`
- `incitingIncident`
- `midpointShift`
- `finalConvergence`
- `endingDirection`
- `mainSuspense`
- `truthRevealOrder`
- `storyEngine`
- `escalationPattern`
- `status`

### 5.7.3 Outline.extension

- `misdirectionInfo`
- `recallNodes`
- `philosophicalQuestion`
- `audienceExpectationDesign`

### 5.7.4 Outline.note

- 替代总纲方案
- 已废弃方向说明

### 5.7.5 Outline.derived

- `structuralCompletenessScore`
- `middleCollapseRisk`

---

## 5.8 Plotline

剧情线对象，用于主线、支线、情感线、悬疑线、政治线等。

### 5.8.1 职责

- 承载线级目标与功能
- 连接主线与支线
- 支撑卷章级推进分析

### 5.8.2 Plotline.core

- `id`
- `workId`
- `name`
- `type`
- `objective`
- `mainEnemyOrResistance`
- `startPoint`
- `endPoint`
- `connectToMainlinePoint`
- `involvedCharacterIds`
- `function`
- `status`

### 5.8.3 Plotline.extension

- `reward`
- `suspenseRole`
- `foreshadowRole`
- `emotionalRole`
- `worldbuildingRole`

### 5.8.4 Plotline.note

- 可选转向方案

### 5.8.5 Plotline.derived

- `relevanceScore`
- `dragRisk`

---

## 5.9 Volume

卷对象，用于中观叙事单元。

### 5.9.1 职责

- 承载卷目标与卷冲突
- 连接总纲与章节
- 承载卷高潮与卷收束方式

### 5.9.2 Volume.core

- `id`
- `workId`
- `orderNo`
- `title`
- `theme`
- `mainTask`
- `mainEnemy`
- `coreConflict`
- `objective`
- `entryState`
- `exitState`
- `climax`
- `resolutionStyle`
- `hook`
- `relatedLocationIds`
- `relatedPlotlineIds`
- `involvedCharacterIds`
- `status`

### 5.9.3 Volume.extension

- `unitDivision`
- `unitGoals`
- `unitTempo`
- `suspenseDensity`
- `emotionalPeakDistribution`
- `pressurePoints`
- `turningPoints`
- `atmosphereProfile`
- `subplotWeight`

### 5.9.4 Volume.note

- 卷级长文说明

### 5.9.5 Volume.derived

- `pacingScore`
- `diffusionRisk`
- `payoffStrength`

---

## 5.10 Chapter

章节对象，用于最直接的创作落点。

### 5.10.1 职责

- 承载章节规划
- 连接正文版本
- 支撑本章级上下文组装

### 5.10.2 Chapter.core

- `id`
- `workId`
- `volumeId`
- `orderNo`
- `title`
- `povCharacterId`
- `function`
- `coreEvent`
- `conflict`
- `infoPoints`
- `foreshadowRefs`
- `characterProgress`
- `emotionalProgress`
- `worldbuildingProgress`
- `endingHook`
- `targetWordCount`
- `isExplosiveChapter`
- `summary`
- `status`
- `updatedAt`

### 5.10.3 Chapter.extension

- `coolPoints`
- `paymentPoint`
- `tempoLevel`
- `emotionTemperature`
- `suspenseLevel`
- `dialogueRatio`
- `descriptionRatio`
- `dailyLifeVsBattleRatio`
- `buildUpLength`
- `hookStrength`
- `revealRhythm`

### 5.10.4 Chapter.note

- 章节自由备注
- 可选场景想法

### 5.10.5 Chapter.derived

- `readabilityScore`
- `pacingScore`
- `emotionalIntensity`
- `coolnessScore`
- `clarityScore`

---

## 5.11 Event

事件对象，用于历史事件、剧情节点、关系变化、真相揭示等。

### 5.11.1 职责

- 作为时间线锚点
- 作为连续性状态变化锚点
- 支撑剧情推进与回溯

### 5.11.2 Event.core

- `id`
- `workId`
- `name`
- `type`
- `timeAnchor`
- `locationId`
- `participantCharacterIds`
- `participantFactionIds`
- `prerequisiteEventIds`
- `summary`
- `outcome`
- `consequences`
- `visibilityScope`
- `relatedChapterIds`
- `status`

### 5.11.3 Event.extension

- `emotionalMeaning`
- `symbolicMeaning`
- `reversalPotential`
- `sacrificePotential`
- `publicNarrative`
- `hiddenNarrative`

### 5.11.4 Event.note

- 备选事件版本

### 5.11.5 Event.derived

- `importanceScore`
- `continuityRisk`

---

## 5.12 Foreshadow

伏笔对象，用于埋设、误导、延迟回收、回收兑现。

### 5.12.1 职责

- 统一管理伏笔生命周期
- 支撑误导线索与回收检查
- 服务长篇抗崩能力

### 5.12.2 Foreshadow.core

- `id`
- `workId`
- `code`
- `name`
- `surfaceForm`
- `hiddenMeaning`
- `plantedChapterId`
- `payoffChapterId`
- `payoffMethod`
- `delayedPayoffStrategy`
- `misleadingClues`
- `redHerrings`
- `status`
- `importance`

### 5.12.3 Foreshadow.extension

- `reinforceChapterIds`
- `linkedCharacterIds`
- `linkedPlotlineIds`
- `emotionalPayoffType`
- `truthLayer`

### 5.12.4 Foreshadow.note

- 可选回收方案

### 5.12.5 Foreshadow.derived

- `exposureRisk`
- `payoffDelayRisk`

---

## 5.13 Draft

正文版本对象，用于章节正文、改稿、定稿、发布版本。

### 5.13.1 职责

- 承载正文文本
- 承载版本演化
- 作为阅读投影输入

### 5.13.2 Draft.core

- `id`
- `workId`
- `chapterId`
- `versionNo`
- `sourceType`
- `text`
- `wordCount`
- `summary`
- `status`
- `createdAt`
- `createdBy`

### 5.13.3 Draft.extension

- `styleProfileSnapshot`
- `outlineSnapshotRef`
- `settingSnapshotRef`
- `reviewNotes`
- `revisionReason`

### 5.13.4 Draft.note

- 局部改写想法

### 5.13.5 Draft.derived

- `prosePressure`
- `continuityRisk`
- `styleDeviationRisk`

---

## 5.14 DecisionLog

决策日志对象，用于固化关键创作决策。

### 5.14.1 职责

- 记录已确认的创作决定
- 作为后续上下文稳定约束
- 作为回溯与解释依据

### 5.14.2 DecisionLog.core

- `id`
- `workId`
- `decisionType`
- `title`
- `decision`
- `rationale`
- `affectedObjectRefs`
- `confirmedByUser`
- `createdAt`

### 5.14.3 DecisionLog.extension

- `alternatives`
- `rollbackNote`
- `syncStatus`
- `riskNotes`

### 5.14.4 DecisionLog.note

- 讨论摘要

### 5.14.5 DecisionLog.derived

- `unresolvedDependencyCount`

---

## 5.15 ContinuityState

连续性状态对象，用于承载动态状态与信息边界。

### 5.15.1 职责

- 管理状态变化
- 管理知识边界
- 管理持有、暴露、伤势、位置等动态信息

### 5.15.2 ContinuityState.core

- `id`
- `workId`
- `scopeType`
- `scopeId`
- `stateType`
- `currentValue`
- `effectiveFromEventId`
- `effectiveToEventId`
- `visibilityScope`
- `status`
- `updatedAt`

### 5.15.3 ContinuityState.extension

- `repeatReminderNeeded`
- `leakForbidden`
- `gradualRevealPlan`
- `conflictRuleRefs`

### 5.15.4 ContinuityState.note

- 状态说明文本

### 5.15.5 ContinuityState.derived

- `contradictionRisk`

---

## 5.16 DocAsset

文档资产对象，用于承载不宜强结构化的资料与思考。

### 5.16.1 职责

- 存储自由文本资产
- 与对象建立引用关系
- 作为创作辅助资料输入

### 5.16.2 DocAsset.core

- `id`
- `workId`
- `type`
- `title`
- `content`
- `tags`
- `relatedObjectRefs`
- `createdAt`
- `updatedAt`

---

## 5.17 PromptAsset

Prompt 模板对象，用于沉淀创作模板与分析模板。

### 5.17.1 职责

- 模板复用
- 创作流程标准化
- 后续动作编排的模板支撑

### 5.17.2 PromptAsset.core

- `id`
- `workId`
- `type`
- `title`
- `promptTemplate`
- `variables`
- `tags`

---

## 6. 派生投影定义

---

## 6.1 AnalysisProjection

用于章节、卷、作品、角色等范围的分析结果输出。

### 6.1.1 典型指标

- 可读性
- 节奏流畅度
- 情感强度
- 爽感强度
- 信息清晰度
- 连续性风险
- 崩盘风险
- 商业潜力
- 长线期待感

### 6.1.2 定义

```yaml
AnalysisProjection:
  id:
  workId:
  scopeType:
  scopeId:
  metrics:
  summary:
  generatedAt:
```

---

## 6.2 ReadingProjection

用于把结构化对象和正文版本投影成纯净阅读态。

### 6.2.1 职责

- 目录投影
- 正文投影
- 版本选择
- 阅读视图渲染

---

## 6.3 IndexProjection

用于索引与浏览，不作为源对象存储。

### 6.3.1 典型索引

- 事件索引
- 伏笔索引
- 地点索引
- 时间线表
- 术语表
- 群像视图
- 敌我识别视图

---

## 7. 对象关系

```text
Work 1---n Character
Work 1---n Relationship
Work 1---n Faction
Work 1---n Location
Work 1---n WorldRule
Work 1---1 Outline
Work 1---n Plotline
Work 1---n Volume
Volume 1---n Chapter
Chapter 1---n Draft
Work 1---n Event
Work 1---n Foreshadow
Work 1---n DecisionLog
Work 1---n ContinuityState
Work 1---n DocAsset
Work 1---n PromptAsset

Character n---n Character (via Relationship)
Character n---n Event
Faction n---n Event
Location 1---n Event
Plotline n---n Volume
Plotline n---n Chapter
Foreshadow n---n Chapter
ContinuityState n---1 Event
Draft n---1 Chapter
```

---

## 8. 状态建议

---

## 8.1 Work.stage

- `IDEATION`
- `SETTING`
- `OUTLINING`
- `VOLUME_PLANNING`
- `CHAPTER_PLANNING`
- `DRAFTING`
- `REVISING`
- `READING`
- `FROZEN`

---

## 8.2 Chapter.status

- `BACKLOG`
- `OUTLINED`
- `DRAFTING`
- `DRAFTED`
- `REVIEWING`
- `REVISED`
- `FROZEN`

---

## 8.3 Draft.status

- `DRAFT`
- `REVIEWED`
- `REVISED`
- `APPROVED`
- `PUBLISHED`

---

## 8.4 Foreshadow.status

- `PLANNED`
- `PLANTED`
- `REINFORCED`
- `PAID_OFF`
- `DROPPED`

---

## 8.5 Character.status

- `DRAFT`
- `ACTIVE`
- `LOCKED`
- `DEPRECATED`
- `MERGED`

---

## 9. 哪些内容不应直接建为核心对象

以下内容不应单独建为核心对象：

- 题材与定位
- 核心卖点
- 网文特有要素
- 结局层
- 质量评分项
- 索引视图项
- 图谱视图项

它们应分别落到：

- Work / Work.extension
- DocAsset
- AnalysisProjection
- IndexProjection
- ReadingProjection

---

## 10. V1 最小实现建议

### 10.1 V1 一等核心对象

- Work
- Character
- Relationship
- WorldRule
- Outline
- Plotline
- Volume
- Chapter
- Event
- Foreshadow
- Draft
- DecisionLog
- ContinuityState

### 10.2 V1 辅助对象

- Faction
- Location
- DocAsset
- PromptAsset

### 10.3 V1 派生层

- AnalysisProjection
- ReadingProjection
- IndexProjection

---

## 11. 非目标

V1 不以以下内容为目标：

- 复杂图数据库建模
- 全题材全字段一次性完备
- 复杂多人协作权限
- 自动化全书生成
- 可视化大屏优先
- 过度细颗粒百科化设定管理

---

## 12. 收束结论

本模型的核心判断是：

- 作品要素清单不是 schema
- 作品要素清单是领域词典
- 真正的建模工作是把领域词典拆成：
  - 对象
  - 核心字段
  - 扩展字段
  - 文档资产
  - 连续性状态
  - 派生投影

只有这样，系统才能同时做到：

- 前台对话轻
- 后台结构稳
- 长篇不易崩
- 阅读闭环成立
- 后续 schema 可演化
