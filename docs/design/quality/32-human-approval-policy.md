# Human Approval Policy v2

> 状态：草案（B58 CP1 已冻结最小 additive 契约：复用 author_action_receipts/decision_traces，不建 approval_record 表；死亡/结局/高潮/预算专用 policy 仍 deferred）
>
> 角色：`docs/design/05-turn-behavior-and-state-model.md`、`docs/design/07-workbench-ui-contract.md` 与小说 Domain 文档之间的人工确认策略层。
>
> 目标：定义小说创作中哪些节点必须保留作者主导权，哪些结果可以自动继续，哪些必须进入 confirmation / adoption / checkpoint，从而避免系统自信偏航或把临时结论错误升级为 canon。

---

## 1. 文档定位

本文回答 8 个问题：

1. 人工审批在 v2 中是不是补丁
2. approval、confirmation、adoption、correction 的边界是什么
3. 哪些小说节点默认需要人工确认
4. 如何把确认策略挂到 intent、capability、quality gate 和 long-run
5. 什么情况下允许自动继续
6. 什么情况下必须阻断到用户决策
7. UI 应如何呈现审批动作
8. 审批记录如何进入 audit、memory 和后续经验提炼

本文不负责：

- UI 具体布局
- 按钮文案
- 每个平台商业策略
- 所有 intent 的最终 slot schema

本文只冻结 Human Approval Policy 的 Domain contract。

---

## 2. 定义

`approval_policy` 是小说 Domain 层对 Foundation 行为机制的业务配置。

本文讨论的是 human-facing approval policy；对象名仍统一使用 `approval_policy`。

它决定某个创作动作、artifact 或 mutation proposal 是否需要作者明确处理后才能继续。

它的核心是：

```text
domain action / artifact / risk
  -> approval policy
  -> auto proceed / confirmation / adoption / checkpoint / block
```

---

## 3. 与 Foundation 行为的关系

Foundation 已定义：

- clarification：信息不足，需要追问
- confirmation：信息足够，但高风险或高成本，需要确认
- correction：用户修正已发生识别、产物或写入
- cancellation：用户中止任务
- adoption：tentative artifact 进入 authoritative state 的边界

Human Approval Policy 只回答小说层问题：

- 哪些小说动作高风险
- 哪些 canon 变化必须人工确认
- 哪些产物必须采纳后才进入权威层
- 哪些长跑 checkpoint 必须等待作者

Domain 不得改写 Foundation 行为语义，只能注册策略。

---

## 4. Approval 与 Adoption 的区别

approval 关注“是否允许继续这个动作或方向”。

常见形式：

- 启动高预算 long-run 前确认
- 修改主线方向前确认
- 让角色死亡前确认
- 回收核心伏笔前确认

adoption 关注“是否把这个产物写入 authoritative state”。

常见形式：

- 接受卷纲
- 接受章节正文
- 接受 maintenance 产物
- 接受风格偏好更新

二者可能同时出现：

```text
生成结局方向
  -> confirmation：是否允许生成多个大结局候选
  -> artifact：生成候选
  -> adoption：作者采纳其中一个作为结局方向
```

---

## 5. Approval Policy 最小模型

> 当前冻结：本节最小字段、`risk_class`、`default_behavior` 映射与 bypass 边界由本文、`../07-workbench-ui-contract.md` 与 `../contracts/VS-03-behavior-lifecycle-contract-pack.md` 共同约束。

每条 approval policy 至少包括：

- `approval_policy_id`
- `policy_name`
- `policy_version`
- `applies_to_intent_families`
- `applies_to_artifact_types`
- `applies_to_object_types`
- `risk_class`
- `default_behavior`
- `required_user_action`
- `bypass_policy`
- `audit_level`
- `status`

`risk_class` 建议最小分类：

- `LOW`
- `MEDIUM`
- `HIGH`
- `CRITICAL`

`default_behavior` 至少支持：

- `AUTO_PROCEED`
- `CONFIRM_BEFORE_EXECUTE`
- `CHECKPOINT_BEFORE_CONTINUE`
- `ADOPTION_REQUIRED`
- `BLOCK_UNTIL_USER_DECISION`

### 5.1 最小 policy catalog（B58 CP1 冻结）

当前只注册已有真实消费者的 policy；没有 consumer 的高风险节点保持 deferred，不造假 gate。

| approval_policy_id | 适用 | risk_class | default_behavior | required_user_action | bypass_policy | audit_level | status |
|---|---|---|---|---|---|---|---|
| `approval_policy.high_risk_canon_change` | tentative artifact 采纳、覆盖/重大 canon 变更 | `HIGH` | `ADOPTION_REQUIRED` | accept / discard / edit_then_accept | `none`（HIGH/CRITICAL 不允许自动 bypass；仅作者动作或已注册 policy 例外） | `author_safe` | active（consumer=adoption/author_action receipt） |
| `approval_policy.long_run_budget_gate` | 高预算/长跑启动前确认 | `HIGH` | `CONFIRM_BEFORE_EXECUTE` | confirm / cancel | `none` | `author_safe` | active（consumer=confirmation behavior） |

以下节点当前没有可注册的真实 policy consumer，保持 deferred；**不得用文案/按钮存在冒充已实现**：

- 人物死亡/黑化/背叛/核心能力觉醒（§6.6）：需要状态变更 consumer 与 branch 语义。
- 结局方向（§6.8）：需要结局规划/高优先级 planning source consumer。
- 大高潮方向（§6.7）：需要卷级规划 consumer 与 downstream invalidation。
- 高预算具体阈值：当前只有通用 confirmation，阈值/预算单位未冻结。

`default_behavior` 是 Domain policy decision enum，不等同于 runtime `NextAction`，但必须可映射：

| default_behavior | 常见 runtime `NextAction` |
|---|---|
| `AUTO_PROCEED` | `SHOW_RESULT` or `NO_FURTHER_ACTION` |
| `CONFIRM_BEFORE_EXECUTE` | `CONFIRM_BEFORE_EXECUTE` |
| `CHECKPOINT_BEFORE_CONTINUE` | `RESUME_TASK` |
| `ADOPTION_REQUIRED` | `ADOPT_ARTIFACTS` |
| `BLOCK_UNTIL_USER_DECISION` | `ASK_USER` |

---

## 6. 默认必须人工确认的节点

### 6.1 作品定位

包括：

- 书名
- 题材
- 读者定位
- 商业定位
- 平台方向
- 更新目标

默认策略：

- 生成候选可自动
- 写入 work authoritative positioning 需 adoption
- 重大修改需 confirmation

### 6.2 主角与反派重大设定

包括：

- 主角核心欲望
- 主角金手指或核心能力
- 反派定位
- 关键关系
- 重大身份秘密

默认策略：

- 初始候选可 tentative
- canonical 设定需 adoption
- 已有大量下游内容后修改需 confirmation

### 6.3 主线与核心冲突

包括：

- 主线目标
- 核心冲突
- 结局方向
- 故事发动机

默认策略：

- 创建需 adoption
- 大修需 confirmation
- 影响已有 volume / chapter 时进入 checkpoint

### 6.4 卷纲定稿

包括：

- 卷目标
- 阶段高潮
- 关键转折
- 卷尾 hook

默认策略：

- 候选卷纲 tentative
- 定稿需 adoption
- long-run 按卷纲批量写作前需 confirmation

### 6.5 关键章节细纲

包括：

- 开篇三章
- 上架 / 付费节点
- 大高潮章节
- 角色命运转折章
- 伏笔回收章

默认策略：

- 普通章细纲可低风险 adoption
- 关键章细纲需 adoption
- 与主线强相关时需 confirmation

### 6.6 重大人物命运

包括：

- 死亡
- 黑化
- 背叛
- 情感关系定局
- 核心能力失去或觉醒

默认策略：

- 执行前 confirmation
- 结果进入 timeline / state_snapshot 前 adoption
- 若影响长期主线，建议 branch 选项

### 6.7 大高潮方向

包括：

- 卷级高潮
- 大战解决方式
- 主角突破方式
- 反派阶段结局

默认策略：

- 方向确认后再生成正文
- 生成候选可多分支
- 采纳后触发 downstream invalidation 检查

### 6.8 结局方向

包括：

- 开放式或闭合式
- 主角最终状态
- 主题落点
- 世界状态
- 主要关系结算

默认策略：

- 永远需要 human approval
- 任何自动写入都只能是 tentative
- 采纳后成为高优先级 authoritative planning source

---

## 7. 可自动继续的低风险动作

默认可以自动继续：

- 纯总结当前状态
- 低风险措辞润色
- 不改变事实的格式化
- 生成多个候选但不写 production
- 读取 accepted 内容进入阅读投影
- 低风险 maintenance 草拟

但自动继续仍需满足：

- 不直接写 production
- 不越过 authority scope
- 不消耗超预算
- 不创建高风险 canon 变化

---

## 8. 与 Intent Family 的关系

高 approval 敏感族：

- 世界观族
- 主线族
- 分卷族
- 人物族
- 风格族
- 维护族

中 approval 敏感族：

- 章节族
- 场景族
- 改稿族
- 长跑族

低 approval 敏感族：

- 阅读族
- 总结类 intent
- 解释类 intent

是否需要确认最终取决于 anchor、规模、预算、风险和当前 authoritative state。

---

## 9. 与 Long-Run 的关系

long-run 至少在以下节点检查 approval policy：

1. task 创建后、执行前
2. 预算估计完成后
3. 每个 checkpoint
4. 高风险 unit 前
5. adoption 批量处理前
6. resume 前发现 authoritative state 变化时

典型规则：

```text
long-run plan
  -> estimate
  -> approval policy
  -> confirmation if required
  -> run units
  -> checkpoint
  -> adoption review
```

不能因为任务已经开始，就绕过后续高风险确认。

---

## 10. 与 Quality Gate 的关系

quality gate 可以触发 approval。

示例：

- `knowledge_boundary` 高风险命中 -> confirmation
- `power_scaling` 硬规则冲突 -> block
- `web_hook_strength` 关键章过弱 -> adoption review
- `foreshadowing` 核心伏笔回收 -> confirmation

Human Approval Policy 决定：

- 质量问题是否必须给用户看
- 用户是否可以覆盖风险继续
- 是否必须 branch
- 是否阻断 adoption

---

## 11. 审批记录

> 当前冻结：本节 `approval_record` 最小字段与 `decision` 枚举由本文和当前 approval / behavior contract 共同约束。

每次人工审批都应形成 record。

最小字段：

- `approval_record_id`
- `approval_policy_ref`
- `source_turn_ref`
- `source_task_ref`
- `target_ref`
- `target_type`
- `risk_class`
- `decision`
- `decision_note`
- `decided_by`
- `decided_at`
- `base_revision`

`decision` 至少支持：

- `CONFIRMED`
- `REJECTED`
- `EDITED_CONFIRMED`
- `ACCEPTED`
- `EDITED_ACCEPTED`
- `DISCARDED`
- `BRANCHED`
- `CANCELLED`

### 11.1 additive 实现映射（B58 CP1 冻结）

**不新增 `approval_record` 表或第二套批准状态机。** 每次作者批准复用一条 `author_action_receipts` 记录；`approval_record` 是权威事实的投影，不是新实体。

| approval_record 字段 | 现有来源/映射 | 状态 |
|---|---|---|
| `approval_record_id` | `author_action_receipts.id`（UUID） | 已有 |
| `approval_policy_ref` | receipt.result 新增键；由 action/target/policy catalog 机械解析 | additive |
| `source_turn_ref` | receipt.source_turn_ref | 已有 |
| `source_task_ref` | receipt.result 新增键（如 long_run task ref/run_id） | additive |
| `target_ref` | receipt.result.target_artifact_ref 或 action target_ref | 已有 |
| `target_type` | receipt.result 新增键（artifact_type/object_type） | additive |
| `risk_class` | receipt.result 新增键；来自 policy catalog，不由模型自报 | additive |
| `decision` | receipt.status/result 与 adoption_status 映射：ACCEPTED/EDITED_ACCEPTED/CONFIRMED/EDITED_CONFIRMED/REJECTED/DISCARDED/CANCELLED/BRANCHED | 映射 |
| `decision_note` | receipt.result 新增键（仅作者明确输入时；无则不编造） | additive |
| `decided_by` | 固定 `author`（当前唯一批准主体） | 常量 |
| `decided_at` | receipt.inserted_at | 已有 |
| `base_revision` | receipt.result.revision_base（adoption 已有）或新增键 | additive/已有 |

**Decision 映射约束**

- `ACCEPTED`/`DISCARDED` 等既有 adoption_status 必须原样保留，不能二次改写。
- `EDITED_CONFIRMED`/`EDITED_ACCEPTED` 只在作者实际编辑后确认时出现；不得因 UI 打开编辑框自动标记。
- 失败/重复/过期动作不得产生新的有效 approval record；幂等重复只返回原 receipt。
- `decided_by=author` 是当前唯一值；harness/模型/自动流程不得写作者批准。
- `approval_policy_ref/risk_class/base_revision` 缺失时不补默认值伪造完整；记录为 missing 并在 why/replay 如实显示。
- 审计读取经 `AuthorActionReceiptRepo` + `DecisionTraceRecord`/ReplayService；不新增查询服务时先复用现有入口。

审批记录进入：

- audit
- interaction memory
- adoption history
- experience engine source
- explainability

---

## 12. UI 投影

approval policy 通常投影为：

- `confirmation_card`
- `adoption_card`
- `checkpoint_card`
- `warning_card`
- `escalation_card`

UI 不应把高风险确认埋进普通 assistant message。

卡片至少应显示：

- 需要确认什么
- 为什么需要确认
- 影响哪些对象
- 不确认会怎样
- 可选动作
- 是否可稍后处理

---

## 13. 旁路与覆盖

系统可以支持用户覆盖部分风险继续，但必须受限。

允许覆盖：

- 中低风险质量 warning
- 风格偏好轻微冲突
- 非关键章节 hook 弱

不建议覆盖：

- revision conflict
- authority conflict
- 结局方向采纳
- 大规模 production write
- 已知硬设定冲突

覆盖判定优先级：

1. authority / revision / security / hard consistency conflict 永远不可被 `can_override` 覆盖。
2. `approval_policy.bypass_policy` 优先于单个 `quality_finding.can_override`。
3. `quality_finding.can_override` 只能表达该 finding 本身是否可被覆盖。
4. 多个 finding 同时存在时，任一 non-overridable finding 都会阻断整体 bypass。
5. 用户覆盖必须产生 approval record / audit record。

覆盖也必须留下 audit record。

### 13.1 与 maintenance auto-adoption 的对接（ADR-0007）

ADR-0007 §2 在 `maintenance_artifact` 上保留了 `auto_adoption_hint` (boolean) 与 `risk_class` (LOW / MEDIUM / HIGH / CRITICAL) 字段，但显式不冻结自动 adoption 决策策略。该策略是 W9 工单与本文档联合冻结的范围：

1. `auto_adoption_hint = true` 仅是产出方建议，不授权系统跳过 adoption boundary。
2. 实际是否触发自动 adoption 由 `approval_policy.default_behavior`（§5）+ `bypass_policy`（§13）+ `risk_class` 三方组合决定。
3. `risk_class = HIGH` / `CRITICAL` 的 maintenance artifact 即便 `auto_adoption_hint = true`，仍走人工 adoption；`risk_class = LOW` 才进入自动 adoption 候选范围。
4. 自动 adoption 完成后 `adoption_status` 仍取 §3.2 7 态之一（`ACCEPTED` 或 `EDITED_ACCEPTED`），不引入 `AUTO_ADOPTED` 等非 canonical 值；audit record 通过 `approval_record.decision` 与 `bypass_policy` 命中标记区分自动 vs 人工路径。

---

## 14. 本文冻结的硬骨

本文正式冻结以下人工审批硬骨：

1. 人工审批是小说 Domain 层核心策略，不是 UI 补丁
2. approval 关注是否允许动作或方向继续，adoption 关注产物是否进入 authoritative state
3. 作品定位、主角/反派重大设定、主线、卷纲、关键章节、重大人物命运、大高潮、结局方向默认需要人工确认或采纳
4. long-run 必须在启动、checkpoint、resume 和高风险 unit 前检查 approval policy
5. quality gate 可以触发 approval，但不能替代用户决策
6. 所有人工审批都必须有可审计 record
7. approval policy decision 必须能映射到 canonical runtime `NextAction`

---

## 15. 下一步

后续应细化：

1. intent family 到 approval policy 的默认映射表
2. confirmation card / adoption card 的 Domain 扩展字段
3. approval record 与 audit / memory 的持久化 schema
4. 与 `31-novel-quality-gates.md` 的风险矩阵合并测试
