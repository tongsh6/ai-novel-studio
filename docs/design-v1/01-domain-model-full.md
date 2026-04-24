# 01-domain-model-full

## 分层

### 核心对象层
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

### 文档资产层
- DocAsset
- PromptAsset

### 派生投影层
- AnalysisProjection
- ReadingProjection
- IndexProjection

---

## 1. Work

### 职责
- 作品根对象
- 维护作品定位、主题、全局约束、阶段状态
- 作为所有下级对象归属根

### Core
- id
- title
- subtitle
- oneLinePitch
- genre
- subgenres
- tags
- targetPlatform
- targetAudience
- targetWordCount
- plannedVolumeCount
- updateFrequency
- commercialPositioning
- coreDifferentiators
- boundaries
- coreTheme
- subThemes
- emotionalBaseTone
- desiredEndingEmotion
- startState
- endState
- incitingIncident
- midpointShift
- finalConvergence
- summary
- stage
- activeVolumeId
- activeChapterId

### Extension
- competitorRefs
- motif
- philosophyQuestion
- authorWantsToSay
- authorDoesNotWantToSay
- valuePosition
- serializationStrategy
- platformSpecificNotes
- commercialHookStyle

### Note
- 长文风格说明
- 竞品长文笔记
- 情绪板文字说明
- 作者自由思考

### Derived
- commercialPotentialScore
- fatigueRisk
- collapseRisk
- longTermExpectationScore

---

## 2. Character

### 职责
- 角色内外在结构
- 驱动力与成长弧线
- 参与关系、事件、章节推进

### Core
- id
- workId
- name
- gender
- age
- identity
- roleType
- appearance
- publicPersona
- innerCore
- coreDesire
- coreFear
- surfaceGoal
- deepGoal
- initialFlaw
- obsession
- values
- actionStyle
- decisionStyle
- emotionTriggers
- bottomLine
- taboos
- growthArc
- powerGrowthPath
- identitySecrets
- breakdownPoints
- fateQuestion
- firstAppearanceChapterId
- currentState
- status

### Extension
- speechHabit
- speechTaboo
- behaviorHabit
- pressureResponse
- intimacyStyle
- trustThreshold
- jealousyTrigger
- publicMaskStrength
- symbolicItem
- reputation
- highlightSceneRefs
- coolPointMechanism
- sacrificePotential
- growthPotential

### Note
- 角色自由备注
- 替代设定方案
- 气质描述文本

### Derived
- dimensionalityScore
- consistencyRisk
- popularityPotential

---

## 3. Relationship

### 职责
- 表达角色之间的显性与隐性关系
- 维护关系变化与推进阶段

### Core
- id
- workId
- fromCharacterId
- toCharacterId
- relationType
- publicState
- hiddenState
- currentStage
- dynamic
- alignment
- targetArc

### Extension
- trustLevel
- intimacyLevel
- powerBalance
- asymmetryNotes
- changeEventRefs
- ruptureEventRefs
- repairEventRefs
- emotionalFunction
- conflictFunction
- infoFunction

### Note
- 化学反应备注
- 关系转向备选方案

### Derived
- tensionScore
- progressionHealth

---

## 4. Faction

### Core
- id
- workId
- name
- type
- publicImage
- trueNature
- ideology
- goal
- leaderCharacterIds
- allyFactionIds
- enemyFactionIds
- coreResources
- tabooRules
- firstAppearanceChapterId
- currentState
- status

### Extension
- classPosition
- internalStructure
- publicSupportLevel
- collapseRisk
- signatureStyle

### Note
- lore 长文
- 边支故事说明

### Derived
- influenceScore
- threatScore

---

## 5. Location

### Core
- id
- workId
- name
- type
- summary
- atmosphere
- geographicRole
- relatedFactionIds
- connectedLocationIds
- firstAppearanceChapterId
- currentState
- status

### Extension
- hazards
- secrets
- cultureMarkers
- economicMarkers
- symbolicMeaning

### Note
- 景观长文描述
- 灵感来源说明

### Derived
- plotImportanceScore

---

## 6. WorldRule

### 职责
统一承载世界规则、力量规则、金手指规则。

### Core
- id
- workId
- domain
- name
- summary
- statement
- implications
- limitations
- costs
- exceptions
- status
- priority

### Extension
- timeBackground
- socialSystem
- classStructure
- economicStructure
- religionBelief
- languageSystem
- technologyLevel
- cultivationSystem
- battleRules
- resourceSystem
- worldTruth
- worldDisaster
- worldBoundary
- worldAnomaly
- metaphor
- realmLevels
- upgradeConditions
- upgradeCosts
- powerSource
- powerCap
- counterRelations
- deathMechanism
- resurrectionMechanism
- timeMechanism
- causalityMechanism
- cheatName
- cheatOrigin
- cheatForm
- cheatTrigger
- cheatGrowthRoute
- cheatFinalForm

### Note
- 长文 lore
- 未启用机制
- 备选机制

### Derived
- freshnessScore
- complexityRisk
- contradictionRisk

---

## 7. Outline

### 职责
- 定义全书级叙事骨架
- 钉死故事发动机与核心冲突

### Core
- id
- workId
- oneSentencePremise
- protagonistNeed
- whyImpossible
- costToPay
- mainOpponent
- coreConflict
- mainGoal
- stageGoals
- finalGoal
- storyStartPoint
- incitingIncident
- midpointShift
- finalConvergence
- endingDirection
- mainSuspense
- truthRevealOrder
- storyEngine
- escalationPattern
- status

### Extension
- misdirectionInfo
- recallNodes
- philosophicalQuestion
- audienceExpectationDesign

### Note
- 替代总纲方案
- 废弃方向说明

### Derived
- structuralCompletenessScore
- middleCollapseRisk

---

## 8. Plotline

### Core
- id
- workId
- name
- type
- objective
- mainEnemyOrResistance
- startPoint
- endPoint
- connectToMainlinePoint
- involvedCharacterIds
- function
- status

### Extension
- reward
- suspenseRole
- foreshadowRole
- emotionalRole
- worldbuildingRole

### Note
- 可选转向方案

### Derived
- relevanceScore
- dragRisk

---

## 9. Volume

### Core
- id
- workId
- orderNo
- title
- theme
- mainTask
- mainEnemy
- coreConflict
- objective
- entryState
- exitState
- climax
- resolutionStyle
- hook
- relatedLocationIds
- relatedPlotlineIds
- involvedCharacterIds
- status

### Extension
- unitDivision
- unitGoals
- unitTempo
- suspenseDensity
- emotionalPeakDistribution
- pressurePoints
- turningPoints
- atmosphereProfile
- subplotWeight

### Note
- 卷级长文说明

### Derived
- pacingScore
- diffusionRisk
- payoffStrength

---

## 10. Chapter

### Core
- id
- workId
- volumeId
- orderNo
- title
- povCharacterId
- function
- coreEvent
- conflict
- infoPoints
- foreshadowRefs
- characterProgress
- emotionalProgress
- worldbuildingProgress
- endingHook
- targetWordCount
- isExplosiveChapter
- summary
- status

### Extension
- coolPoints
- paymentPoint
- tempoLevel
- emotionTemperature
- suspenseLevel
- dialogueRatio
- descriptionRatio
- dailyLifeVsBattleRatio
- buildUpLength
- hookStrength
- revealRhythm

### Note
- 章节自由备注
- 可选场景想法

### Derived
- readabilityScore
- pacingScore
- emotionalIntensity
- coolnessScore
- clarityScore

---

## 11. Event

### Core
- id
- workId
- name
- type
- timeAnchor
- locationId
- participantCharacterIds
- participantFactionIds
- prerequisiteEventIds
- summary
- outcome
- consequences
- visibilityScope
- relatedChapterIds
- status

### Extension
- emotionalMeaning
- symbolicMeaning
- reversalPotential
- sacrificePotential
- publicNarrative
- hiddenNarrative

### Note
- 备选事件版本

### Derived
- importanceScore
- continuityRisk

---

## 12. Foreshadow

### Core
- id
- workId
- code
- name
- surfaceForm
- hiddenMeaning
- plantedChapterId
- payoffChapterId
- payoffMethod
- delayedPayoffStrategy
- misleadingClues
- redHerrings
- status
- importance

### Extension
- reinforceChapterIds
- linkedCharacterIds
- linkedPlotlineIds
- emotionalPayoffType
- truthLayer

### Note
- 可选回收方案

### Derived
- exposureRisk
- payoffDelayRisk

---

## 13. Draft

### Core
- id
- workId
- chapterId
- versionNo
- sourceType
- text
- wordCount
- summary
- status
- createdAt
- createdBy

### Extension
- styleProfileSnapshot
- outlineSnapshotRef
- settingSnapshotRef
- reviewNotes
- revisionReason

### Note
- 局部改写想法

### Derived
- prosePressure
- continuityRisk
- styleDeviationRisk

---

## 14. DecisionLog

### Core
- id
- workId
- decisionType
- title
- decision
- rationale
- affectedObjectRefs
- confirmedByUser
- createdAt

### Extension
- alternatives
- rollbackNote
- syncStatus
- riskNotes

### Note
- 讨论摘要

### Derived
- unresolvedDependencyCount

---

## 15. ContinuityState

### 职责
用于承载动态状态与信息边界，避免长篇靠人脑记忆。

### Core
- id
- workId
- scopeType
- scopeId
- stateType
- currentValue
- effectiveFromEventId
- effectiveToEventId
- visibilityScope
- status
- updatedAt

### Extension
- repeatReminderNeeded
- leakForbidden
- gradualRevealPlan
- conflictRuleRefs

### Note
- 状态说明文本

### Derived
- contradictionRisk

---

## 16. DocAsset

### Core
- id
- workId
- type
- title
- content
- tags
- relatedObjectRefs
- createdAt
- updatedAt

---

## 17. PromptAsset

### Core
- id
- workId
- type
- title
- promptTemplate
- variables
- tags

---

## 投影层

### AnalysisProjection
用于承载：
- 可读性
- 节奏流畅度
- 情感强度
- 爽感强度
- 信息清晰度
- 连续性风险
- 崩盘风险
- 商业潜力
- 长线期待感

这些都不是源字段。

### ReadingProjection
把卷章与正文版本投影成纯净阅读视图。

### IndexProjection
用于：
- 事件索引
- 伏笔索引
- 地点索引
- 时间线表
- 术语表
- 群像视图
- 敌我识别视图

这些都是视图，不是源对象。

---

## 对象关系

- Work 1---n Character
- Work 1---n Relationship
- Work 1---n Faction
- Work 1---n Location
- Work 1---n WorldRule
- Work 1---1 Outline
- Work 1---n Plotline
- Work 1---n Volume
- Volume 1---n Chapter
- Chapter 1---n Draft
- Work 1---n Event
- Work 1---n Foreshadow
- Work 1---n DecisionLog
- Work 1---n ContinuityState
- Work 1---n DocAsset
- Work 1---n PromptAsset

---

## 设计收束

领域词典不是 schema。  
真正的建模工作，是把领域词典拆成：

- 对象
- 核心字段
- 扩展字段
- 文档资产
- 连续性状态
- 派生投影
