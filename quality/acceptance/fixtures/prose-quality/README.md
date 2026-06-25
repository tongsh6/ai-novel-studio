# prose-quality fixtures（VS-00E 质量基线）

VS-00E CP0 建立的**确定性质量基线**：固定的「坏正文」样本 + 每个样本预期触发的 validator / gate / severity。
目的是让 VS-00E 的质量评估对照**固定输入**衡量，而不是用模糊的「文笔更好」做验收。

- 样本必须可稳定复现，**不依赖真实云端模型**（确定性 validator 直接吃文本；语义 validator 在 CP2 用 stub/fixture 注入预期输出）。
- 这些样本**不是作品事实**，不进入任何作品库；只供质量门 / validator 测试与 acceptance fixture 使用。
- 真实文学质量收益另由 `p1-prose-quality-real-provider-sample` 的人工盲评验证（ADR-0020 I10），fixture 不得冒充真实质量证明。

## 文件

| 文件 | 角色 |
|---|---|
| `baseline-bad-samples.yml` | 10 个坏样本 + 预期 finding（violation / target_validator / quality_gate / expected_severity / scene_mode / stage / prose） |

## 消费方（CP1–CP3 实现时）

- CP2 确定性 validator 单元测试：直接断言坏样本命中对应 `target_validator`。
- CP2 `p1-prose-quality-finding-roundtrip` acceptance：用坏样本驱动产生结构化 `QualityFinding`。
- CP2 `p1-prose-quality-evaluator-degrade`：注入 evaluator 失败，断言不伪造 passed。

> 上游契约：`docs/design/contracts/VS-00E-prose-execution-quality-contract-pack.md`、`docs/design/quality/31-novel-quality-gates.md`、ADR-0020。
