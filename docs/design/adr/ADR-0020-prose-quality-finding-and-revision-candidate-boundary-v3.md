# ADR-0020：Prose Quality Finding 与 Revision Candidate 边界 v3

- 状态：Accepted
- 日期：2026-06-25
- 来源文档：
  - `../contracts/VS-00E-prose-execution-quality-contract-pack.md`（本 ADR 授权的 contract pack）
  - `../quality/31-novel-quality-gates.md`（Quality Gate / QualityFinding 设计、§6 gate 目录）
  - `ADR-0010-state-adoption-boundary-v3.md`（采纳边界：selection ≠ adoption）
  - `ADR-0017-replay-report-v3.md`（replay 不重新调用模型）
  - `ADR-0012-tool-request-result-v3.md`（ToolRequest/Result 边界）
- 影响范围：Domain / Application / Agent / Quality / Trace / Frontend
- 相关不变量：VS-00E §12（I1–I10）
- 首个证明 slice：CP1 `p1-prose-execution-brief` → CP2 `p1-prose-quality-finding-roundtrip` / `p1-prose-quality-evaluator-degrade` → CP3 `p1-prose-revision-candidate` / `p1-prose-quality-adoption-boundary`
- 取代：无
- 取代者：无

---

## 背景

章级目标（`ChapterPlanDirection` → `ReaderEffectBrief`）已存在，但未展开为可执行的场级因果/情绪结构，且正文生成后没有独立验证正文是否实现这些目标。当前由同一模型既写正文又自评（`CreativeOutputSelfReport`），质量信号不可靠；作者只能改/弃正文，不能基于结构化问题生成独立修订候选。

VS-00E 引入：场级执行简述 `ProseExecutionBriefV1`、独立质量服务 `ProseQualityService` 产出 `QualityFinding`、基于 finding 的 sibling 修订候选。本 ADR 冻结其中**不可让步的边界**，防止后续实现把质量评估变成静默改稿或把失败当通过。

## 决策范围

冻结 evaluator / 原稿 / 修订候选 / finding / replay / 降级 的边界不变量，并要求各层 enforce。取值与 gate 目录仍属 `../quality/31-novel-quality-gates.md`；执行简述结构属 VS-00E pack。

## 冻结的不变量

```text
I1  原始正文永不被静默覆盖：evaluator 与修订流程都不得 in-place 改写已生成的原稿 artifact。
I2  QualityFinding 不是作品事实，不直接修改 artifact 内容、作品事实库或采纳状态。
I3  Evaluator 失败 ≠ 质量通过：失败必须标记 quality_review_unavailable，禁止生成空 finding 冒充 passed。
I4  修订稿始终是新的 tentative artifact，拥有与原稿不同的 artifact id（sibling）。
I5  Writer 与 Evaluator 是独立调用、独立 prompt、独立 provider call ref 与 trace ref。
I6  Replay 默认不重新调用 Writer 或 Evaluator，只从持久化 ref 重建解释。
I7  文学类 finding 默认不硬阻断作者采纳；仅高置信事实冲突/认知越界允许 BLOCK/CONFIRM。
I8  一次作者 revision action 最多生成一个修订候选；evaluator 不得自动递归触发下一次修订。
I9  前端不得自行提升 finding 的严重级别或代替作者决定 artifact 可否采纳。
I10 真实质量收益必须经人工盲评验证；fixture / 自动化不得声称「文学质量已提升」。
```

## 非目标

- 不冻结具体 validator 算法细节（属 CP2 实现 + VS-00E §11）。
- 不引入固定数字张力曲线、情绪曲线 DB 表、SubtextMap 聚合（VS-00E 非目标）。
- 不定义自动多轮润色 / 自动采纳 / 自动永久 experience rule（明确禁止）。
- 不改 adoption 七态取值与转换矩阵（属 ADR-0019）。

## 考虑过的方案

### 方案 A（采纳）：evaluator 只读 + finding 非事实 + 修订为 sibling
质量评估是只读旁路，产出结构化 finding 供作者审阅；修订永远是新 tentative artifact，作者保留原稿与最终决定权。审计与作者控制最强，符合 selection ≠ adoption 与 replay 不变量。代价：每次正文多一次 evaluator 调用（成本/延迟，见风险）。

### 方案 B（否决）：writer 自评后按阈值自动改写
同模型自评不可靠（信号偏置），自动改写会静默覆盖原稿、绕过作者采纳，违反 I1/I2/I9，且 replay 不可解释。

### 方案 C（否决）：finding 直接写入作品事实作为「质量标签」
使 finding 成为事实污染连续性与 trace；违反 I2。

## 后果

- 必须新增独立质量请求/结果 contract（不复用 `CreativeOutputSelfReport`）。
- writer 与 evaluator 各占一次 provider 调用：成本与延迟翻倍（风险，CP2 评估）。
- 小模型 evaluator 存在误报；故文学类默认 WARN/ADOPTION_REVIEW，不硬阻断。
- replay 需持久化 brief/finding/call refs 才能重建。
