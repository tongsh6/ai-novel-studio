# v2 → v3 设计吸取整合

> 启动：2026-06-14。范围引用：`docs/design/README.md`「整合原则：以 v3 为主体，吸取 v2」节。
>
> 目标：以 v3 为指导和原则，对原 v2 领域层文档（`docs/design/domain/`、`docs/design/foundation/`）逐篇做吸取判定与改造，使 `docs/design/` 成为由 v3 组织的单一体系，"v2" 作为来源概念消解。
>
> 不是 slice（无产品代码）；是设计文档实质整合的执行台账。

## 1. v3 原则尺（判定 v2 内容用）

见 `docs/design/README.md`「v3 指导原则」11 条（来源 `00`§2/§5/§10、`01`§3）。核心：Dialogue-first/Agent-native、会话结构为内核、AI 引导三层契约、Contract-first 意图用 AI 非关键字、Planner 无执行权、Workbench 即工具箱、写入默认 tentative、可审计可回放、上下文最小可解释、要素×层级×三态、承重垂直切面。

## 2. 吸取判定四类（见 README）

A. v3 已表述 → v2 对应内容标 superseded 指向 v3。
B. v3 未表述、符合 v3、有价值 → 上提进主链/contract。
C. v3 未表述、纯领域知识 → 保留，重新定位为"v3 体系领域层"，服从 v3 原则。
D. 与 v3 冲突 → 淘汰/废弃。

## 3. 逐篇吸取判定表

| 文档 | 主判定 | 依据 / 动作 | status |
|---|---|---|---|
| `domain/20-novel-domain-overview` | C | 领域总览；已重新定位为 v3 领域层入口 | **done** |
| `domain/21-novel-object-model` | C | 纯对象模型，`08` 已引用为上游；已重新定位 | **done** |
| `domain/22-continuity-model` | C | 纯连续性模型；`VS-00C` 已吸取（chapter_summary 等）；已重新定位 | **done** |
| `domain/23-style-and-author-intent` | C | 纯风格模型；`VS-00C`§9 列为后续 contract 依据；已重新定位 | **done** |
| `domain/24-novel-intent-catalog` | **C**（证据纠正） | grep 无 Router/关键字/分类信号；本质是创作动作族词汇表，非 Router 分类表。已重新定位 + 加 v3 适配说明（意图用 AI 非关键字） | **done** |
| `domain/25-maintenance-hooks` | C + 审 B | 维护提炼=`08` 三态实现态来源；可上提"对账机制"概念入 `08`/后续 contract | done(A) / B 待 |
| `domain/26-context-assembly-policy` | C（已部分吸取） | `06`+`VS-00C` 已吸取为"v3 信封+v2 内容策略"；已重新定位+标注被消费 | **done** |
| `domain/27-reading-projection` | C | 阅读投影；AU-08 已实现；已重新定位 | **done** |
| `domain/28-authoring-lifecycle` | **C**（证据纠正） | grep 无冲突信号；纯创作生命周期领域知识。已重新定位 | **done** |
| `domain/33-experience-engine` | C | 经验引擎；`26`§5.9 引用；已重新定位 | **done** |
| `domain/34-novel-element-field-priority` | **C + 审 B**（证据纠正） | grep 无冲突信号；与 `08` 重叠是"上游-细节层"非冲突。已重新定位 + 标注上提候选 | done(A) / B 待 |
| `foundation/00e-architecture` | **A（真冲突）** | grep 命中 7 处 Router-first（turn 站做 intent+slot 抽取）→ v3 §5.2 废弃。已加 part-superseded 状态头指向 00d/04/01；逐条 superseded 标注待 Step B | done(头) / B 待 |
| `foundation/08-provider-abstraction` | C | provider 抽象，SU-01/gateway 在用；已重新定位 | **done** |
| `foundation/09-observability-and-audit` | C | 可观测/审计，ADR-0018+trace 对齐；已重新定位 | **done** |
| `foundation/10-security-and-budget` | C | 安全/预算横切契约，仍有效；已重新定位 | **done** |
| `foundation/30-contract-glossary` | C + 审 B | 术语表；已重新定位 + 标注补 v3 术语待办 | done(A) / B 待 |

## 4. 执行步骤

1. **Step A — 重新定位头部（C 类，机械、低风险）**：每篇 C 类文档头部状态从"草案"改为"v3 体系领域层 · 当前权威（领域细节）"，标题去误导性"v2 时代"暗示，声明"被主链 X 消费 / 服从 v3 原则"，链上 README 整合原则。
2. **Step B — supersession 审计（A 类，需细读，逐篇说明依据）**：24 / 28 / 00e / 34，找出与 v3 冲突或被 v3 覆盖的具体章节，就地标 superseded 指向 v3，保留纯领域部分。
3. **Step C — 上提（B 类）**：25 对账机制、34 要素优先级、30 术语 → 评估上提进 `08`/contract/glossary。

## 5. 决策日志

- 2026-06-14：确立"以 v3 吸取 v2"整合原则（README）；改正此前"spine+substrate 并立永久权威"的误框架（用户定调：单向吸取，v2 概念消解）。完成 README 基石 + 本台账逐篇判定表。
- 2026-06-14：**Step A 完成**——15 篇按 C 类重新定位头部（去标题 v2、状态改"v3 体系领域层·当前权威"、声明归 v3 治理）。证据纠正：24/28/34 经 grep 无 Router/关键字/分类信号，从"审 A"降为 C（纯领域知识）。**唯一真冲突是 `foundation/00e-architecture`**（7 处 Router-first），已加 part-superseded 状态头指向 00d/04/01/00§5.2。
- 2026-06-14：**Step B 完成**——`00e-architecture` 深度审计：发现不止 7 处 Router，其整个运行时架构角色与 v3 `00d-runtime-architecture` 重叠，且"与已有图分工"引用了 v3 不存在的旧文档名（00a-system-landscape/00b-end-to-end-flow/00d-state-machine-atlas）。处置：① 更正死引用并声明从属于 `00d`；② 新增「§0 v3 对照与 supersession」表，逐项标 Router 概念**死**（turn 站/intent+slot 抽取→Dialogue Planner+DialogueFrame/MicroPlan+AI 意图）/**活**（产候选不执行、Orchestrator 唯一编排、门禁横切）。未改写 mermaid 图（00d 为权威图，按对照表换算）。

## 6. 卡点 / 下次恢复

- **Step A + Step B 已完成。** 实质整合核心（v3 主导权威模型 + 16 篇重新定位 + 唯一冲突 00e supersession）已闭环。
- **Step C 待办（增强，非阻塞）**：`25` 对账机制 ↔ `08`§5 三态对账交叉链接；`34` 字段优先级评估上提/合并入 `08`；`30` glossary 补 v3 术语（DialogueFrame/MicroPlan/ContextPacket/AIMessageEnvelope）。这些是内容增强，需逐项确认范围。
- 恢复指引：先读 `docs/design/README.md` 整合原则 → 本表 status 列 → Step C 逐项。
