# Design Integrity Review v2

> 状态：草案
>
> 角色：Foundation + Domain 主干阶段性总审查文档。
>
> 目标：在进入 UI 设计前，集中检查 Foundation 与 Domain 之间是否仍有接口漏项，Domain 内部对象 / intent / lifecycle / reading projection 是否存在矛盾或未闭环点，并明确哪些内容必须先冻结。

---

## 1. 文档定位

本文不是新增一层设计，而是对当前 `design-v2` 主线做一次完整性审查。

本文重点回答 3 个问题：

1. Foundation 和 Domain 之间是否还有未闭合接口
2. Domain 内部对象、intent、lifecycle、reading projection 是否已经自洽
3. 哪些点可以留到后续细化，哪些点必须在 UI 设计前先冻结

本文不负责：

- 重写既有 contract
- 直接定义最终 JSON schema
- 替代后续 ADR

本文只给出审查结论、风险分级和冻结建议。

### 1.1 contract 收口更新

本轮已新增 `30-contract-glossary.md`，并回写 Foundation / Domain 中最容易导致实现分叉的漂移项：

- revision / adoption 字段名
- long-run budget 字段名
- task / artifact 状态机漂移
- authority enum 风格
- durable / instant behavior 分类
- intent / hook / capability namespace
- `feedback_patch`、`organization`、reading projection object family
- reading projection 的多源 revision refs

因此，本文后续提到的 UI 前冻结清单仍有效，但字段命名与对象全集应以 `30-contract-glossary.md` 为准。

---

## 2. 审查范围

本次审查覆盖以下主文档：

- Foundation：`00-overview.md`、`01-agent-foundation-contract.md`、`02-turn-and-task-state-machines.md`、`03-conversation-behaviors.md`、`06-planning-and-long-run.md`、`07-consistency-and-concurrency.md`、`10-security-and-budget.md`、`11-ux-contract.md`、`12-multi-agent-composition.md`、`30-contract-glossary.md`
- Domain：`20-novel-domain-overview.md`、`21-novel-object-model.md`、`22-continuity-model.md`、`23-style-and-author-intent.md`、`24-novel-intent-catalog.md`、`25-maintenance-hooks.md`、`26-context-assembly-policy.md`、`27-reading-projection.md`、`28-authoring-lifecycle.md`、`31-novel-quality-gates.md`、`32-human-approval-policy.md`、`33-experience-engine.md`、`34-novel-element-field-priority.md`

审查方式：

- 先看各文档已冻结硬骨
- 再看各文档“暂不冻结”项
- 最后检查跨文档依赖是否已经闭环

---

## 3. 总体结论

### 3.1 结论概述

当前 Foundation + Domain 主干**已经形成可继续推进的主闭环**，没有发现明显的原则级自相矛盾。

已基本成立的主链是：

```text
用户请求
  -> Foundation 行为 / 状态 / 编排
  -> Domain intent / object / maintenance
  -> adoption
  -> accepted source
  -> reading projection
  -> UI 投影
```

### 3.2 当前真正的问题类型

当前缺口主要不是“方向打架”，而是以下四类：

1. **接口实例层还没完全钉死**
   - Foundation 已冻结边界，但若干可被 Domain/UI 直接消费的 schema 仍未定最终形状。
2. **Domain 的若干骨架已定，但局部对象关系和字段精度还没收口**
   - 不至于推翻主线，但会直接影响结构面板、adoption review、reading mode。
3. **UI 前置冻结清单还没有被单独抽出**
   - 各文档分别写了“暂不冻结”，但还缺一份“哪些必须先冻结，哪些可以带着进入 UI” 的统一判断。
4. **新增 Domain 主干已成型，但还没并入本审查的阻塞判断**
   - quality gate、human approval、experience engine、字段优先级会影响 adoption、checkpoint、context assembly 与 UI card，需要纳入 UI 前冻结包。

### 3.3 风险判断

- **低风险**：原则级分层、accepted/tentative 边界、maintenance 主链、生命周期主链
- **中风险**：对象精度、intent slot、projection 刷新策略、feedback_patch 归并、quality finding / approval / experience 的对象形状
- **高风险**：Foundation 顶层 result / card / behavior hint / phase-status 等直接映射 UI 的 contract 未闭合

---

## 4. Foundation -> Domain 接口完整性审查

### 4.1 已闭合的接口骨架

以下接口级边界已经基本成立：

1. Foundation 只提供通用运行语义，不感知小说术语
2. Domain 通过 `registry / policy / hook` 等扩展点挂接到 Foundation
3. UI 只能消费 contract，不能自造运行语义
4. 对象写入默认必须经过 intent / capability / adoption，不允许 UI 直接改生产态
5. 行为、checkpoint、adoption、reading projection 都已具备可投影语义

对应依据：

- `01-agent-foundation-contract.md:1080-1093`
- `11-ux-contract.md:825-833`
- `00-overview.md:556-579`

### 4.2 仍存在的接口漏项

#### 4.2.1 TurnResult / 顶层结果 contract 仍未闭合

Foundation 明确冻结了 canonical result 的唯一性，但 `TurnResult v2` 完整 JSON schema 仍未冻结。

依据：

- `01-agent-foundation-contract.md:1085-1093`
- `01-agent-foundation-contract.md:1099-1107`

影响：

- Domain 很难明确自己应把哪些结果挂到哪一层
- UI 无法稳定定义主消息、cards、behavior、adoption、projection 的顶层读取路径

结论：**这是 UI 前必须冻结项。**

#### 4.2.2 phase / status / next_action 的完整枚举仍未闭合

Foundation 已有状态机原则，行为文档也定义了行为对 turn/task 的影响，但完整枚举表仍未冻结。

依据：

- `01-agent-foundation-contract.md:1101-1103`
- `03-conversation-behaviors.md:823-844`

影响：

- Domain 生命周期和 UI 状态映射可能出现“有语义但没枚举”的灰区
- checkpoint / confirmation_required / waiting_user / adoption_pending 等状态无法形成统一渲染分支

结论：**这是 UI 前必须冻结项。**

#### 4.2.3 behavior-specific UI hint 已闭合

行为 contract 已冻结；behavior-specific UI hint 的最小 schema 已由 ADR-0005 冻结（`adr/0005-behavior-ui-hint.md`，Accepted 2026-04-24）。

依据：

- `03-conversation-behaviors.md:823-844`

影响：

- clarification / confirmation / correction 的 UI 细节只能靠前端猜
- 与 `11-ux-contract.md` 的“UI 不应自己猜”原则存在接口缺口

结论：**这是 Foundation 与 UX 之间的直接漏项，必须在 UI 文档前冻结。**

#### 4.2.4 card schema / action schema 细节仍未闭合

UX taxonomy 已冻结，但 card 最终 JSON schema、domain 扩展方式仍未定。

依据：

- `11-ux-contract.md:825-833`
- `11-ux-contract.md:839-844`

影响：

- Domain 的 adoption / checkpoint / replay / projection card 难以统一落位
- UI 组件无法稳定按 contract 建模

结论：**这是 UI 前必须冻结项。**

#### 4.2.5 authority / budget 仍只冻结边界，未冻结最终枚举

Foundation 已明确 authority / budget 的基础地位，但 scope / class / 默认计算规则未冻结。

依据：

- `01-agent-foundation-contract.md:1088-1091`
- `01-agent-foundation-contract.md:1103-1105`

影响：

- Domain 很难稳定定义哪些 intent 默认需 confirmation / escalation
- UI 无法稳定展示高风险门、预算门、升级门

结论：**至少需要冻结最小可用枚举与门槛分类后再做完整 UI。**

---

## 5. Domain 内部一致性审查

## 5.1 已经自洽的主链

以下 Domain 主链已经基本自洽：

1. 对象分四组：主结构 / 资产 / 连续性 / 风格
2. 连续性对象通过 maintenance -> tentative -> adoption -> authoritative 进入系统
3. 风格层通过 `style_sample / writing_preferences / brief / feedback_patch` 分层
4. Reader 默认只消费 accepted / authoritative 源
5. 生命周期主链是 `产出 -> 维护 -> adoption -> reading projection refresh`

对应依据：

- `21-novel-object-model.md:848-857`
- `22-continuity-model.md:768-777`
- `23-style-and-author-intent.md:586-594`
- `27-reading-projection.md:604-612`
- `28-authoring-lifecycle.md:702-709`

这说明 Domain 的主闭环方向没有问题。

### 5.2 当前未发现的严重矛盾

本轮没有发现以下类型的硬冲突：

- object model 说 tentative 可直接入阅读，而 projection 说不行
- lifecycle 说 maintenance 是附属，而 hooks/projection 说它是主链
- style 层说 feedback_patch 直接覆盖长期偏好，而 author-intent 文档说不能

相反，这些主语义在文档间是一致的。

### 5.3 当前存在的中风险未决项

#### 5.3.1 `volume` 与 `arc` 的最终关系未收口

对象模型只冻结了“二者都要留位置”，但未冻结最终实现关系。

依据：

- `21-novel-object-model.md:852`
- `21-novel-object-model.md:865-867`

影响：

- 结构面板层次
- 目录导航
- planning / lifecycle 中的中观结构默认单元
- reading TOC 是否以 volume、arc、或二者并存组织

结论：**这是 UI 前建议冻结项。**

#### 5.3.2 `relationship / item / ability` 精度仍未收口

对象模型承认这些资产对象的最终精度尚未定。

依据：

- `21-novel-object-model.md:867`

影响：

- 结构面板细粒度编辑能力
- context assembly 的引用密度
- maintenance / snapshot 的 scope 设计

结论：**不是 UI 首批阻塞项，但在做结构面板详细设计前应补清。**

#### 5.3.3 summary 机制存在统一化未决

对象模型仍未定 `summary` 是单独表还是统一 summary 机制。

依据：

- `21-novel-object-model.md:868`

影响：

- `chapter_summary`、interaction summary、checkpoint summary、reader_recap 的归类方式
- UI / 调试面 / replay 面的数据来源一致性

结论：**这是 Domain 内部语义整洁度问题，建议在实现前收口，但不一定阻塞第一版 UI 草图。**

#### 5.3.4 continuity 子类型枚举仍未收口

连续性模型未冻结 timeline 时间字段、foreshadowing type、snapshot scope 子类型、worldrule 分类。

依据：

- `22-continuity-model.md:783-789`

影响：

- maintenance validator 细则
- warning/adoption review 的差异化表达
- 结构面板筛选与阅读 recap 生成策略

结论：**不是主链冲突，但会影响 UI 的对象视图粒度。**

#### 5.3.5 `feedback_patch` 归并算法与 brief 作用域仍未收口

风格模型已冻结优先级，但 `feedback_patch` 最终归并算法和 brief 作用域枚举仍未定。

依据：

- `23-style-and-author-intent.md:592-605`

影响：

- “临时反馈何时升格为长期偏好” 的系统行为
- scene / chapter / volume / work 级 brief 的 UI 附着点

结论：**会影响风格面板和修订流，建议在 UI 详细设计前冻结。**

#### 5.3.6 intent family 已成型，但 intent 实例层未收口

intent catalog 只冻结了 family 边界，未冻结具体 intent 全集、slot schema、capability mapping、budget profile。

依据：

- `24-novel-intent-catalog.md:852-870`

影响：

- guided conversation flows
- action surfaces
- clarification slot 展示
- long-run 启动确认信息

结论：**这是 UI 前必须至少补最小可用集的项。**

#### 5.3.7 maintenance artifact schema 与 auto-adoption policy 未收口

maintenance 主链是清楚的，但 artifact schema、聚合算法、低风险自动 adoption 策略仍未定。

依据：

- `25-maintenance-hooks.md:676-695`

影响：

- adoption review 的卡片结构
- 维护结果的批量处理界面
- scene provisional -> chapter authoritative 的合并 UI

结论：**这是 UI 前必须冻结的 adoption 相关项。**

#### 5.3.8 context assembly summary schema 未收口

上下文策略已经清楚，但 assembly summary 的最终 schema、token 配额、切片参数仍未定。

依据：

- `26-context-assembly-policy.md:860-879`

影响：

- Debug / replay / explainability surfaces
- “系统为什么用了这些上下文”的可解释性展示

结论：**不阻塞主工作台首屏，但会阻塞解释性与调试性 UI。**

#### 5.3.9 projection object schema 与刷新策略未收口

reading projection 的原则已定，但 projection object 字段、recap 生成策略、stale 自动/手动刷新、预览模式交互仍未定。

依据：

- `27-reading-projection.md:604-623`

影响：

- 阅读模式数据结构
- stale 提示与 refresh CTA
- preview path 与默认阅读 path 的分离方式

结论：**这是阅读模式 UI 前必须冻结项。**

#### 5.3.10 lifecycle 的 UI 显示细节仍未收口

生命周期主链已经成立，但阶段提示文案、阶段展示形式、done 阈值、混合阶段显示仍未定。

依据：

- `28-authoring-lifecycle.md:702-720`

影响：

- 阶段导航和推荐提示
- 主工作台默认焦点提示

结论：**不阻塞 UI 主结构，但会影响阶段导航细节。**

---

## 6. 三类重点问题清单

### 6.1 Foundation 和 Domain 之间的接口漏项

必须显式补齐的接口漏项包括：

1. TurnResult 顶层 schema
2. phase / status / next_action 最小可用枚举
3. behavior-specific UI hint schema ✅ 已由 ADR-0005 冻结
4. card / action 最终 JSON schema 最小版
5. authority / budget 最小可用枚举
6. Domain intent family 到 registry / capability / hook 的最小映射面
7. quality gate / approval policy / experience rule 到 Foundation validator / policy / card / context 的最小映射面

### 6.2 Domain 内部的高关注未决项

最值得优先收口的 Domain 内部未决项包括：

1. `volume` vs `arc`
2. intent 最小实例集与 slot schema
3. maintenance artifact schema
4. `feedback_patch` 归并策略
5. projection object schema 与 refresh policy
6. quality finding 最小 schema 与 gate-to-action 映射
7. approval policy / approval record 最小 schema 与风险矩阵
8. experience evidence / artifact / rule 最小 schema 与进入上下文的控制规则
9. 必须结构化字段的最小对象落位表

### 6.3 UI 前必须先冻结的内容

如果这些不冻结，UI 只能靠猜：

1. TurnResult 顶层结构
2. behavior / task / adoption / projection 相关状态枚举
3. clarification / confirmation / checkpoint / adoption card schema
4. Domain 最小 intent + slot 形状
5. 阅读投影对象结构与刷新语义
6. `volume / arc` 的中观结构关系
7. maintenance artifact + adoption card payload 的对象形状
8. quality finding / approval / experience 相关卡片扩展字段
9. 结构面板首批对象字段优先级与渐进披露边界

---

## 7. UI 设计前冻结清单

## 7.1 必须先冻结（Blocking）

### Foundation

1. `TurnResult v2` 最小完整 schema ✅ 已由 ADR-0001 冻结（`adr/0001-turn-result-v2-schema.md`，Accepted 2026-04-24）
2. turn / task / artifact / adoption 相关最小状态枚举 ✅ turn / task / artifact 状态枚举已由 ADR-0002 冻结（`adr/0002-state-enums.md`，Accepted 2026-04-24）；adoption 7 态由 ADR-0001 + 30 §3.2 唯一权威
3. behavior-specific UI hint 最小 schema ✅ 已由 ADR-0005 冻结（`adr/0005-behavior-ui-hint.md`，Accepted 2026-04-24）
4. card / action 最小 schema ✅ 已由 ADR-0006 冻结（`adr/0006-card-action-schema.md`，Accepted 2026-04-25）
5. authority / budget / escalation 最小枚举 ✅ 已由 ADR-0003 冻结（`adr/0003-authority-budget-escalation.md`，Accepted 2026-04-24）

### Domain

6. `volume / arc` 关系 ✅ 已由 ADR-0004 冻结（`adr/0004-volume-arc-relation.md`，Accepted 2026-04-24）
7. 首批 UI 需要覆盖的具体 intent 最小集合 ✅ 已由 ADR-0008 冻结（`adr/0008-first-batch-intents.md`，Accepted 2026-04-25）；覆盖立项/世界观/主线/章节/场景五阶段、合计 ≤20 个 intent
8. 这些 intent 的最小 slot schema ✅ 已由 ADR-0010 冻结（`adr/0010-first-batch-intent-slot-schema.md`，Accepted 2026-04-25）；覆盖 ADR-0008 首批 20 条 intent 的 required slots / optional preference slots，并沿用 04 §6 slot policy
9. maintenance artifact / adoption card payload 最小 schema ✅ 已由 ADR-0007 冻结（`adr/0007-maintenance-artifact-schema.md`，Accepted 2026-04-25）；canonical `card_type` 为 ADR-0006 已冻结的 `adoption_card`，不引入 `adoption_review` 等别名
10. `reading_projection_root / toc / chapter / reader_recap` 最小字段集 ✅ 已由 ADR-0009 冻结（`adr/0009-projection-object-schema.md`，Accepted 2026-04-25）
11. projection refresh 的最小状态与触发语义 ✅ 已由 ADR-0009 + ADR-0011 共同冻结（`adr/0009-projection-object-schema.md` / `adr/0011-projection-refresh-state-triggers.md`，Accepted 2026-04-25）；ADR-0009 冻结 `status` 字段位置与 `source_revision_refs` 挂载，ADR-0011 冻结 `FRESH` / `STALE` / `REBUILDING` / `FAILED` 四态、最小触发器与 stale 判定
12. quality finding 最小 schema、默认 severity / action 枚举与 adoption / checkpoint 映射 ✅ 已由 ADR-0012 冻结（`adr/0012-quality-finding-ui-projection.md`，Accepted 2026-04-25）
13. approval policy / approval record 最小 schema、risk_class 与 bypass policy 边界 ✅ 已由 ADR-0013 冻结（`adr/0013-approval-policy-record-ui-projection.md`，Accepted 2026-04-25）
14. experience evidence / artifact / rule 最小 schema，以及 experience rule 进入 context assembly 的控制规则 ✅ 已由 ADR-0014 冻结（`adr/0014-experience-ui-context-boundary.md`，Accepted 2026-04-25）
15. 首批结构面板对象的字段优先级与渐进披露规则 ✅ 已由 ADR-0015 冻结（`adr/0015-structure-panel-field-priority.md`，Accepted 2026-04-25）

## 7.2 可以后置冻结（Non-blocking）

1. 资产对象更细粒度字段全集
2. snapshot / worldrule / foreshadowing 子类型最终枚举全集
3. `feedback_patch` 最终归并算法细节
4. aggregate summary 的最终格式
5. lifecycle 文案和视觉阶段命名
6. preview mode 的最终交互细节
7. quality gate 的最终 validator 算法
8. experience rule 的最终提炼算法
9. 半结构化 strategy artifact 的最终类型全集

原则：

- **阻塞项**：不给出就无法稳定映射 UI contract
- **非阻塞项**：不给出仍可先做 UI 主结构，但后续要回补

---

## 8. 建议的收口顺序

为避免 UI 设计阶段再反向驱动 contract，建议按以下顺序收口：

1. Foundation 顶层 result / state / card / behavior hint 最小 schema
2. Domain 最小 intent + slot + capability/hook 映射
3. `volume / arc` 关系与结构面板主层次
4. maintenance artifact / adoption card payload schema
5. quality finding + approval policy + experience rule 的最小 schema 与卡片扩展字段（已由 ADR-0012 / ADR-0013 / ADR-0014 冻结）
6. reading projection object schema + refresh policy
7. 首批结构面板字段优先级与渐进披露规则（已由 ADR-0015 冻结）
8. 再进入 UI 文档与 `pencil` 原型

---

## 9. 本次审查结论

本次审查的最终判断是：

1. **Foundation 与 Domain 的方向没有打架，主链成立。**
2. **当前最大问题不是原则冲突，而是 UI 可消费 contract 仍有若干实例层漏项。**
3. **Domain 内部没有明显逻辑互斥，但若干对象关系、intent 细化、adoption 形状、quality/approval/experience 形状、projection 刷新策略必须先收口。**
4. **UI 前最小冻结清单已由 ADR-0001 到 ADR-0015 收口；后续可以进入 UI 文档，但仍不应让 UI 反向发明 contract。**

---

## 10. 下一步

建议接下来按 `39-ui-design-implementation-plan.md` 进入 UI 阶段：

1. 先写 `ui-design/40-ui-overview.md` 与 `ui-design/41-workbench-layout.md`，确认 UI 只投影 contract。
2. 再写 `ui-design/42-card-system.md`，消费 ADR-0006 / 0007 / 0012 / 0013。
3. 再写 `ui-design/43-structure-panel.md`，消费 ADR-0014 / 0015。
4. 最后推进 `44`-`47` 与 `pencil` 原型。

UI 设计若发现新的运行语义需求，必须回到 ADR，而不是直接写进 UI 文档或原型。

---

## 11. 结构一致性检查维度（2026-04-23 增补）

### 11.1 增补背景

本轮审查原先只覆盖 Foundation ↔ Domain 的接口闭环性和 Domain 内部对象/intent/lifecycle 自洽性，未覆盖一个同样会误导后续工作的维度：
**总览文档（`00-overview.md`）自述的结构与实际文件结构之间的一致性。**

这类问题不是原则冲突，但会让 UI 团队、实现团队、后续 ADR 作者按照错误的编号、错误的文件名、错误的归属去找依据。

### 11.2 应纳入定期检查的维度

1. **子系统编号 ↔ 文件编号对齐**
   - Layer 1 §4 子系统 1-N 必须严格对应文件 `01-*.md` ~ `NN-*.md`，不允许跳号或错位。
   - 若某个文件存在但没有对应子系统条目，或某个子系统条目不对应文件，必须显式说明原因（如文件合并、跨子系统支撑）。

2. **模块编号 ↔ 文件编号对齐**
   - Layer 2 §5 模块 1-N 必须严格对应文件 `21-*.md` ~ `2N-*.md`。
   - `20-novel-domain-overview.md` 作为 Domain 总览独立存在，不计入模块编号。

3. **注册中心归属集中**
   - Intent Registry、Capability Registry、Policy Registry、Hook Registry 等注册中心必须在同一个子系统中声明，不允许分散到多个子系统的硬骨清单中。

4. **治理纪律与子系统的区分**
   - additive-first、schema version、ADR、contract tests、compatibility window 等过程性纪律属于跨切面治理，归 §8 演化策略，不作为独立子系统。
   - 独立子系统必须指向运行时存在的代码边界。

5. **文件清单实事求是**
   - `§8.3 文档组织建议` 必须以 `ls docs/design-v2/` 的实际结果为准，不允许保留历史猜想文件名。
   - 新增或删除文件时必须同步更新 §8.3。

6. **ADR 目录与 §7 决策索引的关系**
   - `§7 关键设计决策索引` 是共识快照。
   - `docs/design-v2/adr/0000-index.md` 是跳板与拆分触发条件说明。
   - 独立 ADR 文件 `NNNN-<slug>.md` 是被重新质疑或变动时的归宿。
   - 三者职责不可互相顶替，但必须互相引用。

### 11.3 本轮已完成的结构性修正

以下修正已在 2026-04-23 一次性完成，详情见 `adr/0000-index.md` §3：

1. 一致性与并发升为 Layer 1 子系统 7（原无归属）。
2. 演化治理降级为 `00-overview.md §8.4` 治理纪律（不再作为独立子系统，不占用 01-12 子系统编号槽位）。
3. Intent Registry 从 §4.3 移至 §4.4，与 Capability Registry 共处。
4. Layer 2 §5.6 替换为上下文组装策略（对应文件 26），§5.8 替换为创作生命周期（对应文件 28）。
5. `§8.3 文档组织建议` 改为以当前目录实际内容为准。
6. 新建 `docs/design-v2/adr/` 目录，包含 `README.md`（模板与治理规则）和 `0000-index.md`（历史决策索引与拆分触发条件）。

这些修正不改变任何 Foundation / Domain 的硬骨语义，仅修复结构漂移，使文档之间互相引用时不再出现"编号与文件不符"的断层。
