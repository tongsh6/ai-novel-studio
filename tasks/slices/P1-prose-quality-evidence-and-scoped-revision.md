# P1 正文质量证据化判定与分级修订

- 状态：done
- 类型：Turn Slice / Artifact Slice / UI Contract Slice / Acceptance Slice
- 启动日期：2026-07-24
- 完整闭环：VS-00E `QualityFinding → TurnResult.quality_review → revise_from_findings`

## 1. 用户 / 系统目标

把“句式雷同 = 节奏有问题”的单层启发式改成可解释的三段质量链：

1. 局部形式分析器只召回句首、标点骨架、长度等形式异常候选，不直接下文学结论；
2. 独立语义 evaluator 判断候选是机械重复还是刻意修辞，只有确认的问题进入
   `QualityFinding`；
3. 章节叙事节奏独立对照章功能、情节推进、情绪目标、信息释放与实际正文，不再用句长、
   句数或对白数量代理。

质量卡必须展示原句、位置、判断理由、影响范围和置信度。修订动作按 finding 的
`revision_scope` 执行：默认只改命中句段，只有问题覆盖段落或整章时才允许扩大改写范围。

## 2. 开工检查

- **Contract**：扩展现有 `NovelDomain.QualityFinding`、`QualityEvaluationRequest`、
  `TurnResultV3.quality_review.findings` 与 `revise_from_findings`；不新建平行质量对象或动作。
- **Invariant**：形式命中只产生候选；刻意修辞不得仅因句式重复被判错；章节节奏必须有
  章功能参照；finding 不改作品事实；修订稿仍是独立 tentative sibling。
- **Boundary**：`novel_domain` 承载 finding；`novel_application` 做形式召回、质量编排和
  分级修订；`novel_agent` 做修辞判定与章节节奏语义评审；`frontend` 只消费作者安全字段。
  不修改 adoption 七态与 persistence 事实语义。
- **Consumer**：真实工作台正文草稿下的 `QualityReviewCard`，以及作者点击
  `revise_from_findings` 后的修订 AgentRun。
- **Proof**：形式分析纯函数测试、evaluator prompt/JSON 契约测试、service false-positive
  边界测试、修订 scope 测试、TurnResult schema/codegen、前端组件测试。
- **Acceptance Driver**：扩展 `p1-prose-quality-finding-roundtrip` 的外部 Tauri driver，
  从真实正文生成入口验证证据化质量卡、机械重复确认、刻意修辞不误报、章节节奏 finding
  与局部修订动作。产品代码不新增任何验收感知逻辑。
- **Exploration**：不适用。本 slice 不物化新小说要素；章节计划和 reader effect 仅作为
  质量 evaluator 的只读参照。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增基础设施 |
| novel_domain | yes | 扩展 `QualityFinding` 作者安全字段 |
| novel_agent | yes | 修辞判定与章节节奏 evaluator prompt / 输出 |
| novel_application | yes | 形式候选分析、质量编排、分级修订 |
| novel_persistence | no | 不新增表、不改事实写入 |
| novel_web | possible | 仅当 TurnResult/action 序列化测试需要 |
| frontend | yes | 证据化质量卡与动态修订动作 |
| docs/design | yes | VS-00E、质量门、UI 文档、schema、Pencil |
| quality | yes | 真实页面 acceptance 场景与 manifest |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 冻结三段判定、字段与 scope 契约 | done | 用户拍板：方案二 + 三 + 四 |
| T2 | 更新 Pencil 质量卡与运行/暂停态 | done | `AH4WW` / `EYiyl` / `hRFxB` |
| T3 | 实现局部形式异常候选分析器 | done | 候选不直接进入 QualityFinding |
| T4 | 实现机械重复/刻意修辞语义判定 | done | 不完整 finding 重试后诚实降级 |
| T5 | 实现章节级叙事节奏独立评审 | done | 对照章功能与目标，不依赖形式候选 |
| T6 | 扩展 QualityFinding / schema / UI | done | 原句、位置、理由、范围、置信度 |
| T7 | 修订动作按 local/paragraph/chapter 分级 | done | 默认 local；UI 动作文案随 scope 变化 |
| T8 | 局部、契约、真实 Tauri 与静态扫描闭环 | done | fixture 只证明链路，不冒充文学收益 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收
- [x] 后端 / Channel / 组件局部验证
- [x] `pnpm codegen:schemas`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh`
- [x] 三条 scenario invariant driver
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-07-24 — 形式统计只负责召回，不能把“同句首/同标点骨架”直接等价为节奏问题。
- 2026-07-24 — 刻意排比、回环、咒语式重复等必须经过语义判定；若存在强度、意义、视角
  或情绪递进，不作为机械重复 finding。
- 2026-07-24 — `quality_gate.pacing` 只判断章节实际叙事密度是否匹配结构定位；句长、
  句数、对白数量属于形式层，不作为节奏门代理。
- 2026-07-24 — `quality_finding_id` 是动作选择和 provenance 的稳定标识；validator ref
  只表示规则类型，不能再代替 finding id。
- 2026-07-24 — 修订服务始终返回完整候选正文，但 local scope 要求命中范围外文本尽量
  字节保持；paragraph/chapter 只有在 finding 明确扩大影响范围时启用。

## 7. 试行反馈

- `p1-prose-quality-finding-roundtrip` 在真实 1280×800 Tauri 工作台依次生成三章：
  机械动作段产生 1 个形式候选并确认 1 个 local finding（confidence 0.88）；刻意排比产生
  1 个形式候选但 0 finding；章节推进失配在 0 个形式候选下独立产出 1 个 chapter pacing
  finding。质量卡完整展示原句、句子位置、判断理由、影响范围和置信度。
- `p1-prose-revision-candidate` 证明 local finding 发起同一主链的
  `revise_from_findings`，修订稿以原稿为 `revision_base` 的 tentative sibling；点击后
  质量卡折叠为“修订任务已提交”，原稿保留且无自动采纳。
- `quality-revision-action-run-anchoring` 证明动作回执、单一 assistant 工作回合、固定控制坞、
  暂停、刷新重连和继续仍绑定同一 run。
- 真实页面 fixture 只证明判定职责、证据契约和范围路由成立。真实模型对刻意修辞与章节节奏
  的文学判断准确度仍属于 ADR-0020 I10，需要真实样本与人工盲评，不能由本 slice 自动宣称。
