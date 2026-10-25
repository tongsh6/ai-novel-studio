# B38 世界规则保存意图的判断/协议（deferred 候选）

- 状态：pending / deferred（trigger：真实产品链复现或作者真实请求；当前不排期）
- 来源：B34 CP3 模型级 replay（`artifacts/model-contracts/b34-cp3/`，2026-10-25）
- 关联：B33 动作意图有界纠错、B27 判断协议、B34 验证体系、D15

## 1. 观察（未确认产品缺口）

- 模型级 replay（完整 canonical-3e judgment prompt，含 `## 当前可用操作` 与 world_building；仅替换作者输入）：
  - 「把『情绪是真实可见的物质』这个设定保存为世界规则」→ 模型无结构化 tool_calls，content 为畸形 `<tool_call><function=memory_recall>…` 文本；未 execute world_building、未写库（1 次调用，未跑产品纠错 loop）。
  - 其余 5 类意图 5 PASS；discussion 原 explore FAIL 在完整目录下修正为 PASS。
- 因此不能据此断定产品缺口：单次模型输出协议异常 + 未经过 B33 有界纠错/产品判断链；需要真实产品链复现（含判断校验/纠错/候选），或作者真实请求触发。

## 2. 触发与计划（deferred）

- 触发：作者真实请求「保存为世界规则/新增伏笔」遇到错误路由/无候选；或下一轮真实创作复验再次出现。
- CP0（触发后）：真实 Tauri 输入「保存X为世界规则」→ 判断/纠错/候选/采纳全景；确认是 (a) 模型协议输出异常（product 纠错可恢复）还是 (b) 动作意图映射/能力目录/纠错覆盖缺口；冻结契约后最小修复 + 确定性/实模 scoped 验证。
- 不提前改产品；不因单次模型级异常扩能力/改 schema。

## 3. 边界

- 只登记候选，不排期；不覆盖 P1/B34 证据；I10 盲评无关。
