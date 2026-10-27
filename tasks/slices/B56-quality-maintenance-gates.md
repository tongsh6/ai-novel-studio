# B56：建立/规划/维护期质量门与读模型

- 状态：**deferred（按阶段真实消费者拆 slice，不并入 B39 CP1）**。
- 登记日期：2026-10-27；来源：`worldrule_conflict`、`timeline_and_state`、`foreshadowing`、`serialization_retention` 在质量门实现对照中仍为仅设计/无运行钩子。
- 上游：`docs/design/quality/31-novel-quality-gates.md` §6.1/6.3/6.4/6.10/6.12、[B54](B54-continuity-time-and-state.md)、[B39](B39-evidence-seeking-authoring.md)、I10。

## 1. 范围与拆分原则

四个质量门不能靠一个“质量门大全”任务假装闭环，应按阶段和读模型拆开：

| 质量门 | 前置读模型与消费者 | 启动边界 |
|---|---|---|
| `worldrule_conflict` | 已确认 worldrule、候选与冲突证据 | 建立期设定/规则维护；高置信硬冲突可 BLOCK，低置信 WARN，大影响 CONFIRM |
| `foreshadowing` | 伏笔生命周期、预期与正文证据 | 规划期伏笔维护；不拿关键词当埋设/回收判定，语义判断与作者裁决分开 |
| `timeline_and_state` | 故事时间、时点状态与版本 | 维护期；依赖 B54 的读模型裁决，不先建 timeline schema |
| `serialization_retention` | 章节群结构、读者承诺与题材契约 | 建立/规划期；需要真实留存参照，不用形式指标冒充网文留存 |

各门可先冻结独立读模型，再实现运行钩子。模型可以查证和提出冲突，系统提供确定性边界与证据，作者处理语义裁决。

## 2. 开工七问

1. **Contract**：31 的各门 action、ADOPTION_REVIEW/CONFIRM/BLOCK/WARN、真实作品事实与 VS-00E finding/adoption。各门先明确输入和阶段，不统一塞入 prose 产出期评估。
2. **Invariant**：事实有来源与版本；缺失不伪造；高置信硬冲突才阻断；语义冲突进入审阅/作者裁决；不静默改写 canon 或正文；文学收益由 I10 独立评估。
3. **Boundary**：按门复用 application 读模型/maintenance/quality、domain 纯规则、persistence 当前事实、web/frontend 现有审阅/裁决；不以新增表为默认，不新建统一 evaluator。
4. **Consumer**：建立/规划/维护期作者与编辑、规划/修订/审读工作流和 why。
5. **Proof**：每门都有真实输入、运行钩子、可解释 finding/action 和作者处置；负例冲突与缺失可区分；真实页面验收和必要实模语义复核。
6. **Acceptance Driver**：外部驱动真实工作台产生相应事实冲突，审阅并处置；产品验收感知逻辑 **no**。
7. **Exploration**：规则/伏笔/时间/留存事实均可从通用探索读取并引用，不把四门的读模型只塞固定 packet。

## 3. 预计 Checkpoint（按门分别立项）

| CP | 范围 | 状态 |
|---|---|---|
| CP0 | 每门冻结读模型、触发阶段、冲突类型与 action；先证明真实消费者，不默认四表 | deferred |
| CP1 | `worldrule_conflict` 建立期最小闭环：已确认规则→候选→冲突检测→作者处置 | deferred |
| CP2 | `foreshadowing` 规划期最小闭环：生命周期/预期→正文证据→语义复核与作者裁决 | deferred |
| CP3 | `timeline_and_state` 维护期闭环：依赖 B54 的时间/状态读模型→冲突与依据→审阅，不先建 schema | deferred |
| CP4 | `serialization_retention` 建立/规划期闭环：章节群结构/题材承诺→可解释风险→作者处置；不以形式指标冒充留存 | deferred |

每个 CP 只有在对应真实消费者与读模型成立时才启动，不能为了凑四个 CP 改任务名。

## 4. 非目标

- 不把四门塞进 B39 CP1 或 prose 产出期 evaluator，不新建统一“质量门平台”。
- 不用关键词、句长/对白数等形式代理替代世界规则、伏笔、时间或留存语义。
- 不以脚本 finding 或 stub 通过代替真实模型语义判断与 I10 人工盲评。
- 不把 finding 直接写成自动修改正文/设定，作者主权不变。
- 不提前实现 timeline_event/state_snapshot；B54 先决定读模型。

## 5. 验证与恢复

- 每门都有真实运行钩子和作者可见证据，不是只在目录里存在。
- 冲突与缺失/不确定分别呈现；可重放来源、版本与处置，replay 不调 provider。
- 恢复时先读 31、B54、VS-00E 和 I10；若某门仍无真实消费者，保持 deferred，不为完成率提前实现。
