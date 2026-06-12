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

| 场景 | 当前状态 | 当前证据 | 缺口 |
|---|---|---|---|
| SC-AU11-01 | 未实现 | `VS-00D` 已定义 contract；现有 Planner frame 较粗 | 需要 AIMessageEnvelope、guidance_mode 过渡 trace、质量诊断 proof |
| SC-AU11-02 | 部分实现 | AU-03/VS-00B 已有不编造上下文的设计基础 | 需要 WorkStateMessage missing policy 与真实工作台验收 |
| SC-AU11-03 | 部分实现 | ADR-0002/0003/0005/0009 已约束执行边界 | 需要 clarify/confirm guidance_mode 与 behavior/orchestrator 组合 proof |
| SC-AU11-04 | 未实现 | `VS-00C` 已定义 CreativeDecisionPacket | 需要 prose_writing provider prompt 从 envelope 渲染并进入 trace |

当前结论：AU-11 是 design-ready 验收入口，不代表产品已完成。

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|---|---|---|
| `AIMessageEnvelope` 还未成为代码对象或 trace 可重建对象 | 无法证明每次 AI 调用真的按三层组织 | 先做 VS-00D docs-ready slice，再进入最小 Planner proof |
| `DialogueFrame` 当前代码没有 `guidance_mode` 目标字段 | 本轮引导判断只能落在 evidence / uncertainty / trace | CP1 先过渡，CP2 经 ADR/schema/test 冻结字段 |
| DialogueContext 当前作品投影较薄 | AI 质量诊断容易缺当前章证据 | 与 VS-00C / AU-03 / AU-09 合并推进 WorkState projection |
| CreativeProvider prompt 与 Planner 判断仍可能脱节 | 生成正文时丢失本轮引导判断和要素焦点 | prose_writing 调用必须消费 CreativeDecisionPacket |
| 作者可见 why 还不能解释三层 message | 用户无法判断 AI 为什么这样引导 | AU-07 trace summary 需要新增 author-safe envelope 摘要 |

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
rg -n "VS-00D|AIMessageEnvelope|NovelLayerMessage|WorkStateMessage|TurnGuidanceMessage|AU-11" docs/design-v3 tasks/slices/v3
git diff --check
```

实现阶段入口待 VS-00D slice 冻结后补充；完成前不得把 AU-11 标记为已验收。
