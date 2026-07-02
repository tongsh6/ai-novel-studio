# Notes

> 状态：讨论备忘录目录。当前设计体系唯一的 notes 落点。

本目录存放设计过程中的对照分析、讨论沉淀和后续 ADR 输入材料。

这些文档不是 ADR，不冻结 schema，也不直接授权实现。若某个结论需要进入代码或承重垂直切面，必须先升级到对应 contract、ADR 或 slice 设计。

## 文档

- `2026-07-01-agentic-loop-reasoning-stream-ui.md` — 「彻底 agentic loop」推理流 UI 交互设计（UI 先行探索）：叙事措辞归模型、结构骨架归 app；对应将建原型 `46§9-agentic-loop-reasoning-flow`，并作为 loop 语义 ADR 输入。
- `2026-05-02-claude-code-runtime-lessons.md` — Claude Code 与 runtime、扩展性、权限、agent package、replay 的对照讨论。
- `2026-05-01-llm-call-logging-design.md` — LLM HTTP 调用日志设计（原 `docs/superpowers/specs/`，2026-06-14 迁入；对应实现 slice `tasks/slices/VS-018-llm-call-logging.md`）。

