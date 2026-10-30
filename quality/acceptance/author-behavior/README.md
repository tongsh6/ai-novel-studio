# Author Behavior Corpus & State Exploration（B70）

本目录是 B70 的冻结验证资产：**少量人工作者目标模板 + 离线冻结语料 + 状态矩阵 + oracle + provenance/split + 覆盖报告格式**。它只服务产品外验证 harness，不注册产品 runtime，不改变生产 contract。

## 格式与文件

| 文件 | schema | 作用 |
|---|---|---|
| `target-templates.yml` | `author-behavior-targets/v1` | 人工维护的作者目标族：语义目标、允许动作/效果、禁止行为、状态维度、负例陷阱；不含逐条 UI 剧本。 |
| `states.yml` | `author-behavior-states/v1` | 合成作品状态夹具/矩阵：seed 构造、状态维度、全局不变量；默认只用合成样书。 |
| `cases.yml` | `author-behavior-cases/v1` | 冻结语料：目标族 × 状态 × 自然表达；含来源、split、允许结果、禁止行为、oracle 引用。 |
| `oracles.yml` | `author-behavior-oracles/v1` | 机器可判的硬不变量 + 目标族允许结果集合 + 负例陷阱预期；供外部 harness 自动判卷。 |
| `schemas/*.json` | — | 五类格式的 JSON Schema（目标/状态/案例/oracle/覆盖报告）；schema 版本一旦冻结，改版须新版本槽位，不得原地漂移。 |
| `coverage-report.example.json` | `author-behavior-coverage-report/v1` | 覆盖报告格式示例；真实报告由 CP1 生成到 `artifacts/author-behavior/`，不提交。 |

机器校验：`node scripts/author_behavior_check.mjs`（PyYAML 经既有 `scripts/lib/quality/yaml_bridge.py` 解析，单一 YAML 解析源）；CLI 退出码 0 通过 / 66 格式或引用错误。

## 事实分工（消费 B27 §9 / B34 / B42，不另造）

- `retrieved` ≠ `supplied` ≠ 模型自报 `used` ≠ `semantic_correct`。语料只冻结输入/状态/允许结果；supplied/used/语义证据按 B27 §9 与 B42 evidence chain 记录。
- 硬事实（canon 写入、对象身份、重复副作用、虚假完成）由 oracle 自动判定；语义“是否合理”按目标族允许结果集合判定；文学质量仍归真实模型/人工评价（I10），不由本体系代签。
- 真实模型与确定性替身分开汇总；stub 不代签真实模型行为，真实模型不给机制 evidence 加分。
- 旧记录缺请求/供给证据时按 unknown，不回填。

## Provenance 与 Split

- `provenance.kind`：`human_template`（人工写定、可含同义改写入模板）、`derived_frozen`（从既有历史/夹具派生，必须给 `source_refs`）、`generated_frozen`（离线生成后人工冻结，必须给生成器版本、生成时间、源模板引用与 `expression_frozen: true`）。
- `split`：`dev`（开发调词）、`regression`（失败转回归/固定不得调词）、`holdout`（未参与调词，保留集）、`explore`（状态探索随机池，不参与固定回放判分）。
- 同一 `holdout` 表达不得以相同 normalized text 出现在 `dev`/`regression`；失败转回归必须新登记 case id 并保留原失败 case，不得原地改 split 洗白。

## 执行分层（复用 quality/acceptance/tiers.md）

| 层 | 内容 | 触发 |
|---|---|---|
| PR 子集 | `pr-smoke` 目标族代表 case（少量）+ 格式校验 | PR/改动影响面 |
| nightly | 冻结语料回放 + 硬 oracle + 允许结果集合 | nightly/发布前 |
| explore | 状态驱动随机探索（种子可复现、失败缩化） | 后台/夜间；不阻塞 PR |
| real-llm 语义子集 | 未参与调词的 holdout 表达，单槽、有预算；结果入 B42 release-real-llm 流程 | 独立预注册/资源窗口 |

## 当前状态

- CP0（2026-10-30 done）：格式、首批代表目标族/状态/负例与复用边界已冻结。
- CP1（进行中）：确定性 oracle 评估器与 CLI `--evaluate`/覆盖报告已实现并有正反例测试（17/17 node:test），但尚无数据驱动浏览器 run/场景 PASS；不得以 oracle 单测代替页面闭环。
- 语料为合成样书，不含作者真实作品数据；生成模型默认不读取真实材料。
