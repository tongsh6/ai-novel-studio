# B54：故事时间与时点状态读模型（B39 后评估）

- 状态：**deferred（B39 CP4 评估后决定建立、映射或退役；不先建 schema）**。
- 登记日期：2026-10-27；来源：连续性设计包含 `timeline_event/state_snapshot`，生产尚无同名对象，MemoryItem/Ledger 可能承接部分语义但没有 Accepted 映射。
- 上游：`docs/design/domain/22-continuity-model.md`、`docs/design/notes/2026-10-26-story-timeline-management.md`、[B39](B39-evidence-seeking-authoring.md)、[B56](B56-quality-maintenance-gates.md)。

## 1. 为什么不直接建表

“没有同名模块”不等于语义完全缺席：

- `CURRENT_STATE` 记忆、LedgerEntry、ChapterSummary 与章节有效窗已承接部分当前状态和章节进度；
- `NarrativePosition.timeline_node_id` 只有留位，没有生产消费者；
- `timeline_and_state` 质量门仍仅设计，不能反推必须先建 timeline_event/state_snapshot。

在 B39 的通用求证链未证明前，直接建表只会得到另一个 APP 无法可靠消费的容器。必须先回答：现有对象能否通过状态/字段/新读取通道表达需求，缺的是事实本体、时间关系计算、来源版本还是实际消费者。

## 2. 启动条件与开工七问

### 启动条件

- B39 CP4 已有真实通用探索与证据回流；
- 先用现有 chapter_read/prose_search 证明“3 天＋2 星期＝17 天”的信息可被模型按需取得；
- 再对照 MemoryItem/Ledger 的实际读取，明确无法表达的最小缺口与真实消费者，才决定建立、映射或退役。

### 七问

1. **Contract**：22 的事件/快照边界、08 三态、AU09 有效期与 B39 证据契约。先复用既有实体状态/字段/新读取通道，确有必要才论证新对象。
2. **Invariant**：故事时间与叙述顺序分开；来源版本可追溯；模糊时间不硬补精确值；Observation 不自动成为 canon；新对象若产生必须同批可被模型探索。
3. **Boundary**：优先 application 读模型与既有 persistence；domain 纯时间关系计算；web/frontend 复用探索/档案；不以新增表为默认，不提前建第二事实源。
4. **Consumer**：后续规划/正文/修订模型，随后是作者查询与质量门。
5. **Proof**：先证明通用读取与观察回流，再证明结构化时间关系确有必要；精确累计、模糊保留、来源版本、恢复与真实页面；无真实消费者不建对象。
6. **Acceptance Driver**：真实 Tauri 自然创作与查询，核对模型请求、观察、输出与来源；产品验收感知逻辑 **no**。
7. **Exploration**：若物化时间事件/快照，必须同批进入探索目录与引用链；不能只入固定携带或只做面板。

## 3. 预计 Checkpoint（启动后细化）

| CP | 范围 | 状态 |
|---|---|---|
| CP0 | 现有实体四步阶梯复核：CURRENT_STATE/Ledger/ChapterSummary/NarrativePosition 能否表达需求；明确最小缺口、消费者和退役候选 | deferred（B39 CP4 后） |
| CP1 | 若确有必要，冻结最小时间关系/时点状态契约与来源版本，再实现首个读模型；模糊保留、相对参照与累计可重算 | deferred |
| CP2 | 规划/正文/修订真实消费、探索与恢复；倒叙/多线只在后续明确范围，不强行首期全覆盖 | deferred |
| CP3 | 与 B56 的质量门对接：时间/状态冲突有依据、作者裁决，不静默改写正文；若决定替代/退役则同步旧设计 | deferred |

## 4. 非目标

- 不先建 timeline_event/state_snapshot 表，不把 08“已覆盖”当实现，不把 run snapshot 当故事快照。
- 不重复 B39/VS-00K 的通用求证架构，不以时间线专用 packet 代替探索。
- 不把 CURRENT_STATE 或 LedgerEntry 的章节进度当故事内日期/时长。
- 不在首期强求全历法、全倒叙、多线并行或“提前三天影响分析”。
- 不把质量门 I10 与对象建设混为一谈。

## 5. 验证与恢复

- 决策前必须有 B39 的真实证据：模型能找到并消费时间表达，而不是 APP 预装答案。
- 若新建对象，须证明既有实体无法承担不变量，并同批实现生产写入、读取、探索、来源与真实消费者。
- 若既有对象足够，更新 22 的映射而非强建表；若退役，明确由谁承接时间/状态语义。
- 恢复时先读 B39 CP4、22、AU09 有效期与 B56，不能从对象名直接开始建表。
