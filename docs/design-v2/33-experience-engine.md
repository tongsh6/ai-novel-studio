# Experience Engine v2

> 状态：草案
>
> 角色：`docs/design-v2/05-memory-retention-and-retrieval.md`、`23-style-and-author-intent.md`、`31-novel-quality-gates.md` 与 `32-human-approval-policy.md` 之后的经验沉淀机制。
>
> 目标：定义 v2 如何把作者修改、采纳、否决、质量门结果、章节复盘和成功/失败模式沉淀为可复用经验，并在不污染 authoritative state 的前提下反哺后续创作。

---

## 1. 文档定位

本文回答 8 个问题：

1. 经验沉淀为什么不能只靠对话历史
2. Experience Engine 与 Memory、writing_preferences、feedback_patch 的关系是什么
3. 哪些运行事件可以成为经验来源
4. 经验如何从原始事件变成可复用规则
5. 经验如何进入后续上下文与执行策略
6. 经验为什么也需要 adoption 或 review
7. 如何避免“错误经验”污染作品
8. 经验结果如何被观测、回放和解释

本文不负责：

- 具体学习算法
- 模型微调
- prompt 模板最终文案
- 自动评判商业成功

本文只冻结 Experience Engine 的 Domain contract。

---

## 2. 为什么需要 Experience Engine

长篇创作中，系统会不断获得比初始设定更有价值的信息：

- 作者接受了哪些版本
- 作者改掉了哪些表达
- 作者反复否决哪些套路
- 哪些章节质量门经常失败
- 哪些 hook 或爽点被反复保留
- 哪些风格补丁在后续被证明有效

如果这些只留在 interaction log 里，后续执行很难稳定利用。

如果直接把这些写进 writing_preferences，又会污染长期偏好。

因此需要一个中间层：

```text
runtime evidence
  -> experience artifact
  -> validation / review
  -> adopted experience rule
  -> retrieval / policy / prompt support
```

---

## 3. 定义

`Experience Engine` 是小说 Domain 层的经验提炼与反哺机制。

它负责把创作过程中的证据转化为可追踪、可审查、可启用、可禁用的经验对象。

它不是自动微调模型，也不是自动覆盖作者偏好。

---

## 4. 与 Memory 的关系

Memory 负责保存、检索、回放、归档。

Experience Engine 负责从 memory 与运行事件中提炼“可复用经验”。

二者关系：

- interaction log 是证据来源
- accepted artifacts 是正样本
- rejected / discarded artifacts 是负样本
- quality findings 是问题样本
- approval records 是作者决策样本
- feedback_patch 是短期修正样本
- adopted experience rules 是语义记忆或元记忆的输入

Experience Engine 依赖 Memory，但不替代 Memory。

---

## 5. 与风格对象的关系

`writing_preferences` 是长期稳定偏好。

`brief` 是局部临时意图。

`feedback_patch` 是在线反馈形成的增量补丁。

`experience_rule` 是从多个证据中提炼出的可复用经验。

经验不应直接写入 writing_preferences。

推荐路径：

```text
feedback_patch / edits / approvals
  -> experience artifact
  -> review
  -> adopted experience rule
  -> optional writing_preferences proposal
```

只有当经验稳定、跨多次创作有效，并且作者采纳后，才应提议并入长期偏好。

---

## 6. 经验来源

Experience Engine 至少支持以下来源。

### 6.1 作者修改记录

包括：

- 对正文的改写
- 对纲要的改写
- 对人物设定的改写
- 对风格表述的改写

重点记录 diff 前后的变化、修改发生在哪个 anchor、修改是否被最终采纳。

### 6.2 被接受版本

accepted artifacts 是正向经验来源。

可提炼：

- 作者喜欢的节奏
- 章节尾 hook 类型
- 对话密度
- 情绪推进方式
- 爽点兑现方式

### 6.3 被否决版本

discarded / rejected artifacts 是负向经验来源。

可提炼：

- 高频雷点
- 不适合本书的套路
- 过度解释
- 人设偏航模式
- 质量门误判或真失败

### 6.4 章节复盘

包括：

- 章节目标是否完成
- hook 是否有效
- 爽点是否成立
- 情绪推进是否达标
- maintenance 是否产生大量修正

### 6.5 高风险错误记录

来源：

- quality gate hard failure
- human approval rejection
- correction
- invalidated artifact
- consistency conflict

这些应进入高优先级经验候选，但不能自动变成永久规则。

### 6.6 有效 prompt / capability 模式

如果某类执行配置反复产出被采纳结果，可形成执行经验。

示例：

- 某类章节适合先生成 scene beats 再写正文
- 某类情感戏需要先列角色潜台词
- 某类爽点需要先建立压抑和反差

---

## 7. 经验对象模型

经验层至少包括三类对象：

1. `experience_evidence`
2. `experience_artifact`
3. `experience_rule`

### 7.1 experience_evidence

表示原始证据引用。

最小字段：

- `evidence_id`
- `evidence_type`
- `source_ref`
- `work_ref`
- `anchor_type`
- `anchor_ref`
- `signal`
- `created_at`

### 7.2 experience_artifact

表示系统从证据中提炼出的经验草稿。

最小字段：

- `artifact_id`
- `artifact_type`
- `source_evidence_refs`
- `work_ref`
- `scope_ref`
- `candidate_rule`
- `confidence`
- `risk`
- `requires_adoption`
- `status`
- `created_at`

### 7.3 experience_rule

表示已采纳、可用于后续创作的经验规则。

最小字段：

- `rule_id`
- `rule_type`
- `work_ref`
- `scope_ref`
- `rule_text`
- `applies_to_intent_families`
- `priority`
- `status`
- `source_artifact_ref`
- `created_at`
- `updated_at`

---

## 8. 经验类型

默认经验类型至少包括：

- 作者偏好画像
- 本书特有写法
- 高频错误清单
- 节奏经验
- 爽点经验
- 情感推进经验
- Prompt / Capability 策略经验

这些类型回答的问题分别是：作者倾向保留什么、本书怎么写更像自己、系统最容易犯什么错、不同章节应如何控制快慢、爽点如何铺垫和兑现、关系与情绪如何推进、任务应如何拆分和执行。

---

## 9. 经验提炼流程

推荐流程：

```text
collect evidence
  -> cluster signals
  -> draft experience artifact
  -> validate source traceability
  -> risk classify
  -> adoption / review
  -> activate experience rule
```

可以由以下事件触发：

- artifact accepted
- artifact rejected
- edit_then_accept
- quality gate failure
- correction completed
- chapter retrospective
- long-run checkpoint
- user explicit request

不建议每次小修改都立即写长期经验。

默认策略：

- 小修改进入 evidence
- 多次同类 evidence 聚合为 artifact
- artifact 经 review 后成为 rule

---

## 10. Adoption 与风险

经验也可能是错的。

因此：

- 单次证据不应自动变成 rule
- 高影响经验必须 adoption
- 低风险经验可以作为 tentative hint
- 经验 rule 必须可禁用、可 supersede、可归档

高风险经验包括：

- 改写长期风格偏好
- 影响多个 intent family
- 改变 quality gate 默认策略
- 改变 high-risk approval policy
- 反向覆盖作者明确设定

---

## 11. 经验进入上下文

experience_rule 可进入 Executor / LongRunner / Validator 上下文，但必须受 Context Assembly Policy 控制。

默认顺序建议：

1. 当前任务 brief
2. authoritative style / continuity
3. relevant experience rules
4. recent feedback patches
5. raw evidence only when needed

不应默认把大量原始修改 diff 塞进 prompt。

---

## 12. 与 Quality Gate 的关系

Experience Engine 可以消费 quality findings。

常见模式：

- 某质量门反复 warning，但作者总是接受，说明 gate 阈值可能过严
- 某质量门反复 warning，作者总是修改，说明应提前注入 executor
- 某类 hard failure 频繁出现，说明需要新的 preflight gate

但经验不能自动改写 quality gate。

必须产生 policy proposal，并经 review / adoption 后生效。

---

## 13. 与 Human Approval 的关系

approval record 是高价值经验来源。

示例：

- 作者拒绝某个主角黑化方向
- 作者采纳某种卷尾高潮结构
- 作者要求结局保持开放
- 作者反复编辑并接受某类文风

这些记录可以形成 experience artifact。

但作者的一次临时选择不一定等于长期偏好。

---

## 14. UI 投影

Experience Engine 通常不应打扰主工作流。

只有在以下情况需要显式 UI：

- 有高置信经验建议采纳
- 某类错误多次复发
- long-run resume 前需要应用新经验
- 用户打开经验面板
- 系统建议把经验并入 writing_preferences

可用 card：

- `result_card`
- `adoption_card`
- `warning_card`
- `replay_card`

---

## 15. 观测与审计

Experience Engine 必须记录：

- evidence collected
- artifact drafted
- artifact accepted / discarded
- rule activated / disabled
- rule used in context assembly
- rule contributed to generation

Explainability 至少能回答：

- 这条经验来自哪里
- 为什么本轮使用了它
- 它是否被作者采纳
- 它影响了哪个 intent 或 capability

---

## 16. 本文冻结的硬骨

本文正式冻结以下经验引擎硬骨：

1. Experience Engine 是小说 Domain 层机制，用于从运行证据提炼可复用经验
2. 经验来源至少包括作者修改、accepted / rejected artifacts、章节复盘、quality findings、approval records 和有效执行模式
3. 经验对象至少分为 evidence、artifact、rule 三层
4. experience artifact 默认不直接污染 writing_preferences 或 policy
5. 高影响 experience rule 必须 adoption / review 后才能生效
6. 经验进入上下文必须受 Context Assembly Policy 控制
7. 经验使用必须可追踪、可解释、可禁用

---

## 17. 下一步

后续应细化：

1. experience evidence / artifact / rule 的最终 schema
2. experience rule 与 writing_preferences proposal 的转换规则
3. quality gate 与 approval record 到 experience artifact 的提炼策略
4. 经验面板和 adoption card 的 UI 投影字段
