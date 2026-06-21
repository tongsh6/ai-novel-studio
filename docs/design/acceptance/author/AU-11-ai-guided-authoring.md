# AU-11 AI 引导式创作会话结构

> 作者视角：我不是在向一个通用聊天模型提问，而是在和一个能理解小说创作原则、当前作品状态和本轮写作问题的 AI 创作伙伴协作。AI 应该能判断本轮是探索、结构化、执行、质量诊断、澄清还是确认，并把判断依据留在 trace 中。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|---|---|
| 用模糊表达描述创作问题 | AI 先判断本轮引导模式，而不是机械要求补字段 |
| 指出“这一章不够爽 / 不成立 / 不知道怎么写” | AI 基于小说层原则和当前作品状态做质量或结构诊断 |
| 在当前作品上下文不足时请求帮助 | AI 明确说明缺哪些作品状态，并给出最小澄清问题 |
| 请求继续写、重写或修订 | AI 可以提出执行建议，但写入、确认、采纳仍经过 Orchestrator 和作者动作 |
| 查看为什么 AI 这样引导 | trace 能重建 NovelLayer / WorkState / TurnGuidance 三层 message 来源与缺失处理 |

---

## 2. 不变量

| 不变量 | 来源 | 验收含义 |
|---|---|---|
| AU11-I1 | `VS-00D` | 创作相关 AI 调用必须能重建 `AIMessageEnvelope` |
| AU11-I2 | `VS-00D` / `08` | 小说层只提供判断框架，不能替代当前作品事实 |
| AU11-I3 | `VS-00D` / `06` | 当前作品层必须 evidence-bound，缺失、过期、省略和冲突必须显式暴露 |
| AU11-I4 | `VS-00D` / `02` | 本轮引导判断必须结构化进入 `DialogueFrame` / trace，不能只存在于 assistant 文案 |
| AU11-I5 | `ADR-0003` / `04` | AI 可以建议执行、澄清或确认，但不能批准执行、写入或采纳 |
| AU11-I6 | `07` / `AU-07` | 作者可见解释只能展示安全摘要，不能泄露 provider raw prompt 或敏感 trace |

---

## 3. 契约引用

| 契约 | 作用 |
|---|---|
| `contracts/VS-00D-ai-guided-authoring-contract-pack.md` | 三层 contract 与 AI message layer 总入口 |
| `08-novel-element-model.md` | 小说层：要素 × 层级 × 三态、质量判断框架 |
| `06-memory-context-and-trace.md` | 当前作品层：DialogueContext / WorkStateMessage / omission / trace |
| `02-dialogue-frame-and-micro-plan.md` | 本轮引导层：DialogueFrame / guidance_mode / MicroPlan 边界 |
| `contracts/VS-00C-creative-context-assembly-contract-pack.md` | prose_writing 调用点的 CreativeDecisionPacket |
| `04-execution-orchestrator.md` | 执行、确认、降级、拒绝的系统裁决边界 |
| `07-workbench-ui-contract.md` | 前端只消费 TurnResult / trace summary，不直接读取内部 frame 或 prompt |

---

## 4. 验收场景

### SC-AU11-01：质量诊断引导

**Given** 当前作品有目标章节、章摘要或前文 excerpt。  
**When** 作者输入：

```text
这一章感觉不够爽，主角赢得太轻了。
```

**Then**

- Planner message 包含 NovelLayer 中与冲突、代价、读者回报、主角能动性相关的原则。
- WorkStateMessage 引用当前章摘要、前文 excerpt 或明确说明缺失。
- TurnGuidanceMessage 要求 AI 判断本轮应质量诊断、结构化修订还是澄清。
- `DialogueFrame` / trace 记录本轮 `guidance_mode=quality` 或等价过渡语义。
- TurnResult 给作者具体创作取舍，而不是泛泛“加强冲突”。
- 若进入重写，MicroPlan 只是建议，Orchestrator 仍决定确认、降级或允许工具调用。

### SC-AU11-02：缺当前作品上下文时不编造

**Given** 当前 work 没有目标章正文、章摘要或可引用人物状态。  
**When** 作者输入：

```text
帮我看看这一章哪里不成立。
```

**Then**

- WorkStateMessage 明确标记当前章材料 `absent` 或 `omitted`。
- AI 不声称已经读过该章。
- `DialogueFrame` / trace 记录缺失问题。
- TurnResult 给作者最小澄清问题或建议先粘贴/选择目标章。

### SC-AU11-03：澄清与确认是引导模式，不是执行授权

**Given** 作者请求重写已采纳章节，但目标章、风险或写入范围不清楚。  
**When** Planner 判断需要继续推进。  
**Then**

- `guidance_mode` 可以是 `clarify` 或 `confirm`。
- 该判断不等于打开 durable behavior；是否打开 clarification / confirmation 由 MicroPlan 和 Orchestrator 决定。
- 高风险写入必须产生 confirmation 或降级，不允许 Planner 直接执行。

### SC-AU11-04：prose_writing 消费同一个 envelope

**Given** Orchestrator 允许进入 prose_writing。  
**When** CreativeProvider 被调用。  
**Then**

- Tool input 来自 `AIMessageEnvelope(call_site=:prose_writing)` 的专项投影。
- `CreativeDecisionPacket` 必须能说明写作坐标、设计态、实现态、进度态、缺失处理和 trace refs。
- provider prompt 不是调用点临时拼接的 `creative_brief + context_text` 黑箱。

---

## 5. 场景覆盖状态

| 场景 | 当前状态 | 当前证据 | 缺口 | 优先级 |
|---|---|---|---|---|
| SC-AU11-01 | 已验收 | `au11-quality-diagnosis-message-envelope` 真实 Tauri / `quality_accept`：质量诊断输入后 trace/why 可重建 NovelLayer / WorkState / TurnGuidance，assistant 给出具体取舍，且 no tool/adoption/write | `guidance_mode` 尚未冻结进 `DialogueFrame` schema，只是过渡 trace/evidence 字段 | P1 |
| SC-AU11-02 | 已验收 | `au11-missing-workstate-policy` 真实 Tauri / `quality_accept`：真实工作台创建无章节/正文/人物状态的 work，输入“帮我看看这一章哪里不成立”，WorkState 显式标记 chapter/prose/character missing，assistant 要求补材料且不声称已读该章，why 显示缺失，no tool/adoption/write | 仍是 Planner 质量诊断调用点的过渡 envelope，未扩展到所有 AI 调用点 | P1 |
| SC-AU11-03 | 部分实现 | ADR-0002/0003/0005/0009、AU-04/AU-06 confirmation/behavior 真实 Tauri 证据已约束执行授权边界 | 需要 clarify/confirm `guidance_mode` 与 behavior/orchestrator 组合 proof，证明“引导模式”不等于 durable behavior 授权 | P1 |
| SC-AU11-04 | 部分实现 | `VS-00C` 已定义 CreativeDecisionPacket，CP0/CP3/CP4/CP5 已有结构化上下文和 prose_writing 前置证据 | `prose_writing` provider prompt 仍未由 `AIMessageEnvelope(call_site=:prose_writing)` 专项投影统一渲染并进入 trace | P1 |

当前结论：AU-11 文件级 P0 已关闭，当前口径为 `2/4` 已验收、`2/4` 部分实现；可进入 AU-12。剩余 P1 为 schema 冻结、clarify/confirm 引导证明、prose_writing envelope 投影。

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| `AIMessageEnvelope` 仍是 application 层过渡 builder，尚未冻结为跨调用点 schema | 只能证明 Planner 质量诊断 checkpoint，不能证明所有 AI 调用都按三层组织 | P1：经 ADR/schema/test 冻结正式字段和投影 |
| `DialogueFrame` 当前代码没有 `guidance_mode` 目标字段 | 本轮引导判断只能落在 evidence / uncertainty / trace | P1：经 ADR/schema/test 冻结字段 |
| clarify / confirm 仍缺独立引导模式 proof | 目前主要由 AU-04/AU-06 证明执行授权边界，还不能证明 `guidance_mode=clarify/confirm` 的组合关系 | P1：补 clarify/confirm driver 与 behavior/orchestrator 对账 |
| CreativeProvider prompt 与 Planner 判断仍可能脱节 | 生成正文时丢失本轮引导判断和要素焦点 | P1：prose_writing 调用消费 CreativeDecisionPacket / AIMessageEnvelope 投影 |
| DialogueContext 当前作品投影仍较薄 | 质量诊断有时只能基于 snapshot 与显式 missing，而不是完整章节/人物态 | P2：与 AU-03 / AU-09 / AU-12 的 WorkState projection 扩展合并推进 |

---

## 7. 已知限制 / 现有基础设施

- 当前文档定义的是目标 contract，不声明当前代码已实现。
- 过渡期允许 `guidance_mode`、`element_focus`、`quality_risks` 先进入 `evidence_summary` / `uncertainty` / FrameTrace。
- 真实验收必须从当前生产工作台入口发起，不能只直接调用 Planner 或 provider。
- provider raw prompt 可以作为开发证据，但不能作为作者可见解释。

---

## 8. 验收命令

设计阶段：

```bash
rg -n "VS-00D|AIMessageEnvelope|NovelLayerMessage|WorkStateMessage|TurnGuidanceMessage|AU-11" docs/design tasks/slices/v3
git diff --check
```

实现阶段：

```bash
bash scripts/quality_accept.sh au11-quality-diagnosis-message-envelope --surface tauri
bash scripts/quality_accept.sh au11-missing-workstate-policy --surface tauri
```

当前文件级收口命令需同时覆盖 SC-AU11-01 和 SC-AU11-02；SC-AU11-03/04 作为 P1 后续登记，不阻塞进入 AU-12。
