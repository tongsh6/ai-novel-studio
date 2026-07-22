# Notes

> 状态：讨论备忘录目录。当前设计体系唯一的 notes 落点。

本目录存放设计过程中的对照分析、讨论沉淀和后续 ADR 输入材料。

这些文档不是 ADR，不冻结 schema，也不直接授权实现。若某个结论需要进入代码或承重垂直切面，必须先升级到对应 contract、ADR 或 slice 设计。

## 文档

- `2026-07-22-prompt-as-function-of-state.md` — Prompt 即状态函数（用户确认的 AI 指令体系完整完善方向）：三维度=结构体系（目录 SSOT/六段骨架/模型口径库/逐 prompt 探针）+状态感知（强制三件套/缺席行为学/承重事实清单 manifest）+回路闭合（设计负债规则族/设定盘点提案/默认设定三档边界）；M3 跑中实锤为证（收官循环/call2 登记误判/50 章地基事实真空）；两拍板点待定（工作假定层/盘点触发形态）。作为 UA01-agentic-loop-prompt-hardening 架构层与设计负债+盘点 slice 输入。
- `2026-07-15-judgment-driven-interactive-loop.md` — 判断驱动交互循环（用户方向拍板）：对话/交互式创作从"计划驱动"改为"机械准备 + 模型判断① / ② + 用户裁决出口"的真循环，计划驱动收窄为长任务路线图域（N-PLAN 适用域改写）；判断协议三方案对比（推荐 B：判断两段式 + 直接回复内联，简单对话 2 次调用）；与 ADR-0021/0022/0023、S1-S7、D 系、N-NARR 的资产映射与 CP0-CP5 路线；§5a 探索能力域两翼（用户确认必须）：内部检索（工具箱+作品事实索引+预算）与外部网络搜索（带来源设定候选、tentative 采纳门、网络授权边界、SearchProvider 抽象）。作为 ADR-0025 输入。
- `2026-07-15-dialogue-flow-decision-surface-review.md` — 对话流诊断与决策面收口梳理：卡片契约三方失联事实清单（契约 10 / 后端 3 / 前端 9）、决策面已迁出 ui_cards 的七行盘点表 → 方案 C「决策面注册表」契约修订提案（ui_cards 收缩为信息通告 lane、补 clarification/awaiting_author 决策面、schema 治理进闸门），并把丝滑度问题挂接到 ADR-0023 调用经济学与 2026-07-01 推理流 UI。作为 07 §4 / VS-05 §4 修订与后续 ADR 输入。
- `2026-07-05-agentic-verification-system.md` — Agentic 模式测试验证体系调研与演进方案：现状五层模型盘点 + 八缺口实证（stub/真实模型行为鸿沟、口径脆弱、live 空置、纵向缺档、语料缺失等）→ 金字塔扩展设计（MBC 模型行为契约探针 / 语料回放回归 / 断言三分级 / 故障矩阵 / mini-dogfood 入 release-real-llm 层 / I10 制度化），CP0-CP4 分期。作为 quality 体系扩展与 docs/engineering 规范输入。
- `2026-07-04-agentic-loop-plan-driven-execution.md` — Agentic loop 计划驱动执行设计（探索）：计划由模型起草并作为活文档修订、观察后先确定性核对、命中偏离信号（D1-D7）才做 evaluate+replan 合并调用；调用经济学目标（conversation 7→≈3 / prose 6→4）、协议鲁棒性两级方案、与 ADR-0021/0022 关系及 CP 切分。作为 ADR-0023 输入。
- `2026-07-01-agentic-loop-reasoning-stream-ui.md` — 「彻底 agentic loop」推理流 UI 交互设计（UI 先行探索）：叙事措辞归模型、结构骨架归 app；对应将建原型 `46§9-agentic-loop-reasoning-flow`，并作为 loop 语义 ADR 输入。
- `2026-05-02-claude-code-runtime-lessons.md` — Claude Code 与 runtime、扩展性、权限、agent package、replay 的对照讨论。
- `2026-05-01-llm-call-logging-design.md` — LLM HTTP 调用日志设计（原 `docs/superpowers/specs/`，2026-06-14 迁入；对应实现 slice `tasks/slices/VS-018-llm-call-logging.md`）。

