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

- 2026-06-14：**Step C 完成**——`30` glossary 新增「§0 v3 主链核心术语」（DialogueFrame/MicroPlan/OrchestratorDecision/ContextPacket/DialogueContext/AIMessageEnvelope/TurnResult/DecisionTrace/ConfirmationBinding/AvailableAction/BehaviorState/phase-status，一句话+权威源，防漂移）；`25` 加向上链（其 hook 链路=`08`§5 实现态提炼机制）；`08`§6 加向下链到领域细节层（34/25），双向可达。决策：`34` **不物理合并入 08**（避免 08 臃肿/丢细节），保留为 08 领域细节层 + 双向链接。

## 5b. Review 发现与修复（2026-06-14）

整合后做核验式 review，发现并修复：

| # | 问题 | 性质 | 处置 |
|---|---|---|---|
| R1 | `00e` §0 表与状态头引用的行号（88/152/281…）因插入内容上移而全失效 | 自引入 | 改为稳定节锚点（§2A/§3/§4/§6/§10/ROUTER 节），删全部行号 |
| R2 | `00e` 状态头用简称「整合原则」，与其余 15 篇全称不一致 | 自引入 | 补全为「整合原则：以 v3 为主体，吸取 v2」 |
| R3 | `22 §13.5` 引用 `02 §523-533`「已固化合法转换」、`06 §11.3` 均失效（02 该区间现为 Trace、06§11 为 Replay） | **预存在 v2 漂移** | 改指可验证 canonical（30 §3.2 + ADR-0001）；删失效行号 |

**遗留 GAP（R3 暴露）**：adoption 7 态的"合法转换"表在 v3 无统一 canonical 落点（glossary §3.2 仅列取值集合、无转换；无 ADR 含转换表）。建议后续由 ADR-0010（state-adoption-boundary）或 glossary 收口。非本次整合阻塞。

校验通过项：README 无残留旧框架词；glossary §0 引用的 02/04/05/06/VS-00D/ADR 全部存在；15 篇头部节名一致；00e 节锚点 5 个齐全。

## 6. 卡点 / 下次恢复

- **Step A + B + C 全部完成。实质整合闭环。Review 已过（R1/R2/R3 已修，遗留 1 个 7 态转换表 canonical gap）。**
- 终态：`docs/design/` 为 v3 主导的单一体系——主链 spine（00-08）权威、16 篇领域层归 v3 治理且去版本化、唯一架构冲突 00e 已 supersession 对照、glossary 覆盖 v3+v2 术语、要素模型与领域细节层双向可达。
- 无遗留阻塞。后续若 v3 再推翻某领域结论，按本台账「四类吸取判定」就地标 superseded 即可。
- 恢复指引：先读 `docs/design/README.md` 整合原则 → 本表（全 done）。
