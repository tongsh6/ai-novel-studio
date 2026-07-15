# UA01 判断驱动交互循环（ADR-0025 实施）

- 状态：CP0 done（文档批次 2026-07-15）/ CP1 todo（开工需用户批准 + MBC 探针前置）
- 类型：Agent Runtime Slice / Prompt Protocol Slice
- 父 ADR：`docs/design/adr/ADR-0025-judgment-driven-interactive-loop-v3.md`（Accepted）
- 展开层：`docs/design/notes/2026-07-15-judgment-driven-interactive-loop.md`

## 1. 目标

交互场景从计划驱动迁到判断循环：机械准备 → 判断①（意图+形态，含计划按需）→
探索/执行 → 判断②（观察+续行）→ 收束或停等作者。协议主线方案 B（回复内联）。

## 2. CP 路线（每 CP 开工前补六问）

| CP | 内容 | 状态 |
|---|---|---|
| CP0 | ADR-0025 + ADR-0023 注记 + 00 §2.3 形态章 + 00c/46§9.6/README 联动 | **done**（2026-07-15） |
| CP1 | conversation 迁判断循环（方案 B：判断①两段 + 直接回复内联；路由并入判断①）。**前置**：MBC 探针验证内联协议与"是否开计划"判断质量 | todo |
| CP2 | 单候选创作 profile 迁循环（执行内联自评 + 判断②按需） | todo |
| CP3 | prose/修订迁循环；D 系循环语义回归 | todo |
| CP4 | 计划按需全量（判断①制定计划分支 + UI 真计划恢复显示） | todo |
| CP5 | 探索内部翼（作品事实索引 + 检索工具箱 + 探索预算） | todo（可与 CP2/CP3 并行） |
| CP6 | 探索外部翼（SearchProvider + web_search + 带来源设定候选 + 网络授权边界） | todo（依赖 CP5 框架） |

## 3. 决策日志

- 2026-07-15：CP0 文档批次落地（用户"同意 开始落所有的文档"）。ADR-0025 同日
  Accepted（用户四次方向拍板）；N-PLAN 改写进 00c §7 #17；形态陈述落 00 §2.3。

## 4. 下次会话恢复指引

先读 ADR-0025 与来源 note（§4 协议三方案、§5a 探索两翼、§8 开放问题 1-7），
CP1 开工前先做 MBC 探针（复用 scripts/model_contracts/ 模式）。
