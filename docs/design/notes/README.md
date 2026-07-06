# Notes

> 状态：讨论备忘录目录。当前设计体系唯一的 notes 落点。

本目录存放设计过程中的对照分析、讨论沉淀和后续 ADR 输入材料。

这些文档不是 ADR，不冻结 schema，也不直接授权实现。若某个结论需要进入代码或承重垂直切面，必须先升级到对应 contract、ADR 或 slice 设计。

## 文档

- `2026-07-05-agentic-verification-system.md` — Agentic 模式测试验证体系调研与演进方案：现状五层模型盘点 + 八缺口实证（stub/真实模型行为鸿沟、口径脆弱、live 空置、纵向缺档、语料缺失等）→ 金字塔扩展设计（MBC 模型行为契约探针 / 语料回放回归 / 断言三分级 / 故障矩阵 / mini-dogfood 入 release-real-llm 层 / I10 制度化），CP0-CP4 分期。作为 quality 体系扩展与 docs/engineering 规范输入。
- `2026-07-04-agentic-loop-plan-driven-execution.md` — Agentic loop 计划驱动执行设计（探索）：计划由模型起草并作为活文档修订、观察后先确定性核对、命中偏离信号（D1-D7）才做 evaluate+replan 合并调用；调用经济学目标（conversation 7→≈3 / prose 6→4）、协议鲁棒性两级方案、与 ADR-0021/0022 关系及 CP 切分。作为 ADR-0023 输入。
- `2026-07-01-agentic-loop-reasoning-stream-ui.md` — 「彻底 agentic loop」推理流 UI 交互设计（UI 先行探索）：叙事措辞归模型、结构骨架归 app；对应将建原型 `46§9-agentic-loop-reasoning-flow`，并作为 loop 语义 ADR 输入。
- `2026-05-02-claude-code-runtime-lessons.md` — Claude Code 与 runtime、扩展性、权限、agent package、replay 的对照讨论。
- `2026-05-01-llm-call-logging-design.md` — LLM HTTP 调用日志设计（原 `docs/superpowers/specs/`，2026-06-14 迁入；对应实现 slice `tasks/slices/VS-018-llm-call-logging.md`）。

