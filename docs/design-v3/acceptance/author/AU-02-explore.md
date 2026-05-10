# AU-02 探索创作方向

> 作者视角：我有一个模糊的创作想法但还没想清楚，AI 应该像创作伙伴一样帮我展开思路、给出几个可能的方向，而不是丢给我一张必填表单。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 说"我想写赛博修仙但没想好" | AI 给我几个方向让我选，不替我决定 |
| 和 AI 来回讨论创作可能性 | AI 用创作伙伴的语气帮我理清思路 |
| 看到候选方向 | 方向是灵感参考，不是我必须选的 |
| 不想要了可以不管它 | 候选方向不会自动变成作品设定 |
| 追问其中一个方向 | AI 基于那个方向继续展开 |

明确不能做的：
- AI 不能弹出一张表让我填"作品类型、主角身份、世界观、目标读者"
- 候选方向不能自动写入作品设定

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #1 | 每 turn 必有 frame | A1 — exploration turn 也产生 primary DialogueFrame |
| #8 | 缺 slot 不自动等于表单 | A2 — 不产生 slot form / durable clarification |
| #9 | TurnResult 是 canonical 输出 | B2 — 候选方向不声称已采纳 |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0001 | DialogueFrame 支持 creative_exploration frame_type |
| ADR-0015 | 前台只消费 TurnResult / view model |
| VS-00A Contract Pack §2 | Exploration Turn 最小语义 |
| VS-00A Contract Pack §3 | CandidateDirectionSet 规则 |
| VS-00A Contract Pack §4 | 缺信息不自动表单化 |

---

## 4. 验收场景

### 场景组 A：自然探索对话

#### A1 — 模糊想法得到自然回应

**作为作者**，我说"我想写赛博修仙但没想好方向"。AI 用自然对话回应我——"这个方向可以有几种味道：公司垄断灵气、宗门搬进霓虹都市、修仙者被算法评级。你更想写热血、黑色幽默，还是压抑一点？"

这不是表单，不是在收集信息——这是在和我一起构思。

**验证点**：
- [ ] AI 回应读起来像创作讨论
- [ ] 回应不含"请补充以下信息"、"必填字段"等表格式语言
- [ ] `frame.frame_type` 为 `creative_exploration` 或 `casual_reply`（取决于 LLM 判断）
- [ ] `trace.decision_type` 为 `:exploration` 或 `:reply_only`

**测试**：`dialogue_gateway_test.exs` — `"fuzzy creative idea enters exploration frame"` ✅、`"assistant message is natural exploration not field list"` ✅

---

#### A2 — 不会弹出机械表单

**作为作者**，我还没想好方向。AI 不该丢表单给我。系统内部不能出现 slot 相关字段——那是上一个架构的残留。

**验证点**：
- [ ] TurnResult 不含 `required_slots`、`missing_slots`、`slot_schema`、`slot_form`
- [ ] 不打开 durable clarification
- [ ] `truthfulness.durable_behavior_opened == false`

**测试**：`dialogue_gateway_test.exs` — `"does not open mechanical slot form"` ✅

---

### 场景组 B：候选方向

#### B1 — 看到候选方向卡片

**作为作者**，AI 在探索中给了我几个方向。每个方向有吸引人的标题、一段简介、以及风格标签帮我想象。方向是给我参考的，不是让我填的表单。

**验证点**：
- [ ] `candidate_directions` 包含 title、pitch、tone_tags
- [ ] 候选方向以卡片形式呈现在 TurnResult 中

**已知限制**：stub provider 返回空 candidates，real LLM 才会生成候选方向。stub 路径下 `Enum.all?(candidates, & &1.adoption_status == :not_adopted)` 对空列表 trivially true。完整验证需 real LLM。

---

#### B2 — 候选方向只是灵感，不是正式设定

**作为作者**，AI 给出的候选方向不会自动变成作品设定。我在阅读模式里看不到它们——只有当我明确采纳后才会出现。

**验证点**：
- [ ] 候选方向 `adoption_status` 为 `not_adopted`
- [ ] TurnResult 不能声称"已创建作品"或"已采纳设定"
- [ ] `truthfulness.tool_called == false`、`artifact_adopted == false`

**测试**：`dialogue_gateway_test.exs` — `"candidate directions are marked not_adopted"` ✅

---

### 场景组 C：持续探索不被卡住

#### C1 — 可以基于一个方向继续追问

**作为作者**，AI 给了我 3 个方向。我对第一种比较感兴趣，追问"公司垄断灵气这个方向能再展开一下吗？"AI 基于这个方向继续展开。追问不触发确认弹窗。

**验证点**：
- [ ] 后续消息能引用之前讨论的方向
- [ ] 不会因追问打开 durable behavior
- [ ] 每轮仍是 exploration 或 casual_reply

**缺口**：❌ 无多轮探索对话测试。

---

#### C2 — 聊了 5 轮还是能自由输入

**作为作者**，探索了 5 轮后，我仍然可以自由打字——不会被强制要求从几个 action 按钮里选。

**验证点**：
- [ ] 探索阶段 `available_actions` 为空或仅 `continue_dialogue`
- [ ] 输入框始终可用

**缺口**：❌ 无测试。如果某个路径错误地产生了非空 available_actions，输入框会被禁用。

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 模糊想法自然回应 | ✅ |
| A2 | 不弹表单 | ✅ |
| B1 | 候选方向卡片 | ⚠️ stub 空候选 |
| B2 | 候选不是设定 | ✅ |
| C1 | 追问一个方向 | ❌ 无测试 |
| C2 | 探索后自由输入 | ❌ 无测试 |

**通过率：3/6 完整 + 1/6 部分 = 约 58%**

---

## 6. 缺口

| 缺口 | 具体表现 | 影响 |
|------|---------|------|
| GAP-01 — 多轮探索对话测试 | C1 无测试 | 追问后是否还停留在 exploration 未被验证 |
| GAP-02 — 探索阶段 available_actions 为空 | C2 无测试 | 如果某路径错误产生 action，输入框可能被禁用 |
| GAP-03 — 候选方向仅 real LLM 验证 | stub 路径 candidate_directions 永远为空 | B1 的核心体验（看到候选方向卡片）只能手动验证 |

---

## 7. 已知限制

stub provider 返回固定文本"收到你的消息。"——无法验证"AI 自然展开创作方向"和"候选方向生成"的完整体验。stub 路径只能验证防御性规则（不弹表单、不谎报采纳）。完整场景需 VS-08 端到端集成。

---

## 8. 验收命令

```bash
mix test apps/novel_application/test/novel_application/dialogue_gateway_test.exs
```
