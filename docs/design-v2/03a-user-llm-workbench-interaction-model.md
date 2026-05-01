# 用户—LLM—工作台 交互模型分析

> 状态：草案（2026-05-02）
>
> 角色：对当前 turn 链路中用户、LLM、工作台三者交互顺序的结构性分析，识别当前架构中导致"表单填写体验"的根因，提出替代方案。
>
> 关联文档：
> - `03-conversation-behaviors.md` — 对话行为（clarification / confirmation / rejection / cancellation / correction）
> - `04-capability-and-intent-registry.md` — intent + slot schema registry
> - `45-guided-conversation-flows.md` — 引导对话流设计（§3.1 探索式补槽原则）
> - `adr/0008-first-batch-intents.md` — 首批 UI intent 集合
> - `adr/0010-first-batch-intent-slot-schema.md` — intent slot schema

---

## 1. 问题定义

当前工作台的对话体验是"表单填写式"的——用户说话后，系统追问缺失的 slot 参数，凑齐后才交付 LLM 执行。这与 `45-guided-conversation-flows.md` §3.1 定义的"探索式对话引导"存在结构性偏差。

本文诊断：**这是设计问题，而非实现问题**。根因在于 `Router` + `TurnService` 在交互链路上的位置错误。

---

## 2. 当前交互模型

```
用户 ──说话──→ Router（classify_intent + extract_slots）
                 │
                 ├── slot 不齐 → TurnService 直接追问用户（"目标读者群体是？"）
                 │                ↑ LLM 在此步骤没有参与对话
                 │
                 └── slot 凑齐 → assemble prompt → LLM.complete() → TurnResult
```

### 2.1 问题分析

工作台充当了**用户和 LLM 之间的中间人/表单验证器**——先拦截用户输入，提取结构化参数，验完整了才放行给 LLM。

| 问题 | 根因 |
|------|------|
| 用户面对的是 slot 追问而非 AI 对话 | Router 在 LLM 之前拦截，缺什么就问什么 |
| LLM 不参与对话引导 | LLM 只在最后一步被调用做内容生成 |
| "下一步"等流程推进语无法识别 | Router 只能做 intent 分类，不理解流程上下文 |
| 无法实现 §45.3.1 的"候选方向探索" | 探索式对话需要 LLM 参与，Router 做不到 |

### 2.2 关键认知

ADR-0010 的 slot schema **本身不是问题**——定义执行前需要什么参数是正确的。问题是 **slot 校验的位置**：它应该是后台约束，不应该成为用户可见的交互模型。

`45-guided-conversation-flows.md` §3.1 明确要求：

> 1. 先让作者用自然语言表达模糊意图
> 2. 系统根据上下文给出候选方向、选择题、对比方案或编辑建议
> 3. 作者可以选择、排除、补充偏好，或要求系统"换一组"
> 4. 系统把这些选择整理为 draft slot / current parameters
> 5. 在执行前用 Confirmation Card 汇总

这里的"系统"应该是 **LLM**，不是工作台。只有 LLM 能做"编辑口吻的共同定位"、能理解"更燃一点"、能生成候选卖点。

---

## 3. 目标交互模型

```
用户 ──说话──→ LLM（理解意图 + 展开对话 + 探索方向 + 生成候选）
                 │
                 └── 需要持久化/执行时 ←→ 工作台（管理状态、卡片、adoption、写库）

工作台的角色：为 LLM 对话提供工具的管家
工作台不应该是：拦截用户请求的柜员
```

### 3.1 角色重新定义

| 角色 | 当前职责 | 目标职责 |
|------|---------|---------|
| LLM | 仅内容生成（最后一步） | 对话引导 + 意图理解 + 参数探索 + 内容生成 |
| 工作台 | 拦截 + 校验 + 追问 + 编排 | 状态管理 + slot 后台校验 + 数据持久化 + 高风险门禁 |
| 用户 | 回答 slot 问题 | 自然对话，被引导着把想法说清楚 |

---

## 4. 候选方案

### 4.1 方案 A：LLM 自主推理

```
用户 → LLM（system prompt 含完整 slot schema + 当前 slot 状态）
         │
         ├── LLM 判断缺参数 → 自然追问
         └── LLM 判断参数全 → 输出 [SLOTS_READY] → 工作台校验 → 执行
```

| 维度 | 评价 |
|------|------|
| 对话自然度 | ★★★★★ |
| 可靠性 | ★★ — LLM 可能"忘记"追问、幻觉认为 slot 已齐 |
| 工程复杂度 | ★★ |
| LLM 成本 | 高（每轮带完整 schema + 历史） |
| 与现有基础设施兼容 | 低（Router 废弃，slot 校验完全依赖 LLM） |
| 可测试性 | 差 — "为什么不执行？"无法确定根因 |

### 4.2 方案 B：LLM + 工作台双通道协作

```
用户 → LLM（system prompt 含 schema）
         │
         └── 每轮后 ← 工作台静默校验 slot
               ├── 缺 slot → 注入 hint 到 LLM 上下文
               └── 全齐 → 执行
```

| 维度 | 评价 |
|------|------|
| 对话自然度 | ★★★★ |
| 可靠性 | ★★★ |
| 工程复杂度 | ★★★★★ — 双通道通信协议脆弱，时序问题难以处理 |
| LLM 成本 | 高 |
| 与现有基础设施兼容 | 中 |
| 可测试性 | 差 — LLM 与工作台之间的隐式通信难以验证 |

### 4.3 方案 C：LLM 无 schema 感知 + 工作台被动提取

```
用户 → LLM（纯自然对话，无 schema）
         │
         └── 对话历史 → 工作台 NER/提取器 → slot 补全 → 执行
```

| 维度 | 评价 |
|------|------|
| 对话自然度 | ★★★★ |
| 可靠性 | ★★ — 语义映射不可靠（"主角前期很弱慢慢变强" → core_selling_point 无法用 NER 提取） |
| 工程复杂度 | ★★★★ — 两套独立逻辑（对话 + 提取），维护成本高 |
| LLM 成本 | 低 |
| 与现有基础设施兼容 | 中 |
| 可测试性 | 差 — 对话与提取的耦合无法端到端验证 |

### 4.4 方案 D：结构化对话输出（推荐）

```
用户 → LLM（system prompt 含 schema + 当前 slot 状态 + 对话历史）
         │
         └── LLM 每轮输出结构化响应：
               {
                 "message": "自然语言回复...",
                 "slot_updates": {"genre": "都市", "core_selling_point": "商战复仇"},
                 "slot_status": "NEEDS_MORE" | "READY_TO_EXECUTE"
               }
               │
               └── 工作台收到
                     ├── 校验 slot_updates → 合并到 accumulated_slots
                     ├── slot_status=NEEDS_MORE → 注入新状态到下一轮 LLM
                     └── slot_status=READY ∧ 校验通过 → 执行
```

| 维度 | 评价 |
|------|------|
| 对话自然度 | ★★★★ |
| 可靠性 | ★★★★ — LLM 输出可校验，工作台保留最终话语权 |
| 工程复杂度 | ★★★ — 结构化输出的解析和校验 |
| LLM 成本 | 中 — 合并当前 3 次调用为 1 次，且结构化输出模型支持好 |
| 与现有基础设施兼容 | ★★★★★ — 复用 SlotSchema / accumulated_slots / blocking_slots |
| 可测试性 | ★★★★ — 每轮结构化输出可追溯、可审计 |

**推荐理由：**

1. **与现有基础设施高度兼容**。`SlotSchema`、`accumulated_slots`、`blocking_slots`（VS-017）都可以直接复用
2. **单一真相来源**。LLM 输出的结构化部分是工作台可直接校验的，不依赖隐式推断
3. **渐进可实现**。先让 LLM 同时做对话 + slot 提取（替代当前 Router 的两次 LLM 调用），后续再让 LLM 自主判断 slot_status
4. **可审计可测试**。每轮对话 LLM 对 slot 的判断被写入 JSONL 日志，出问题可追溯到具体轮次
5. **节约 LLM 调用**。当前每轮最多 3 次 LLM 调用（classify + extract + execute），方案 D 减少到 1 次

---

## 5. 方案 D 详细设计

### 5.1 一轮对话的数据流

```
1. 用户说话
2. 工作台组装上下文：
   - 对话历史
   - 当前 accumulated_slots
   - schema（blocking_slots + optional slots）
   - 工作上下文（work_ref、当前阶段等）
3. 工作台发送给 LLM（单次调用）
4. LLM 返回 {message, slot_updates, slot_status}
5. 工作台校验 slot_updates
6. 工作台更新 accumulated_slots
7. 工作台返回 message 给前端
8. 如果 slot_status=READY_TO_EXECUTE：
   a. 工作台做最终 blocking_slots 校验（硬门禁）
   b. 校验通过 → 执行 intent → 生成 TurnResult
   c. 高风险操作 → 插入 Confirmation Card
```

### 5.2 关键约束

1. **工作台保留硬门禁**。LLM 声称 `READY_TO_EXECUTE`，工作台必须再次校验 `blocking_slots` 是否真的全部满足。这是防止 LLM 幻觉的最后一道防线
2. **slot_updates 只增不改**。LLM 可以新增 slot 值，不能删除或覆盖工作台已验证的 slot
3. **slot_status 降级策略**。如果工作台发现 LLM 声称 READY 但实际上缺 slot，工作台可以降级为 `NEEDS_MORE` 并让 LLM 继续追问
4. **Confirmation 仍由工作台触发**。符合 ADR-0008 的 risk_class 和 ADR-0003 的 authority escalation

### 5.3 与当前实现的渐进过渡

**Phase 1**（最小改动）：
- 合并 `classify_intent` + `extract_slots` 为一次 LLM 调用
- LLM 返回结构化 JSON（intent + slots）
- Router 校验结果，缺失 slot 时把信息传回 TurnService
- TurnService 调用 LLM 做自然语言追问（而非用 `slot_label` 硬拼）

**Phase 2**（完整方案 D）：
- LLM 维护完整对话上下文
- LLM 自主判断 slot 状态
- 工作台只做硬门禁 + 高风险门禁

**Phase 3**（探索式引导）：
- 实现 §45.3.1 的候选方向生成
- LLM 主动生成候选、对比方案
- 用户用自然语言选择、排除、换组

### 5.4 风险与缓解

| 风险 | 缓解 |
|------|------|
| LLM 输出的 JSON 格式不稳定 | 使用 JSON mode / structured output；解析失败时降级为纯文本追问 |
| LLM 推理能力不足（本地模型） | 结构化输出对推理要求不高；可以先上 cloud model，后续验证本地模型能力 |
| slot_updates 与事实不符 | 工作台做最终硬校验；写入前必须通过 blocking_slots 检查 |
| LLM cost 增加（单次调用变长） | 当前 3 次调用合并为 1 次，总体 token 消耗反而降低 |

---

## 6. LLM 对话人格定义

LLM 在对话中扮演的角色直接影响用户体验和系统行为。这不是实现细节，而是产品定义。

### 6.1 角色选项

| 角色 | 描述 | 典型话术 | 适用场景 |
|------|------|---------|---------|
| 编辑助手 | 有经验的编辑，引导作者想清楚 | "我们不急着定类型，先聊聊你想写什么感觉的故事？" | 创作引导流程 |
| 执行工具 | 被动响应，用户说什么就做什么 | "我理解你想创建一部都市小说。还需要确认目标读者。" | 效率优先路径 |
| 灵感伙伴 | 主动贡献创意和灵感 | "商战复仇这个方向很有意思！我想到几个开篇场景，要不要听听？" | 卡壳时的脑暴 |

### 6.2 建议：编辑助手（默认） + 灵感伙伴（按需）

- 默认以编辑助手角色进行对话
- 用户说"给点灵感"或对话推进困难时切换到灵感伙伴模式
- 执行明确指令时（如"续写第三章"）减少闲聊，直接执行

---

## 7. 与现有 ADR 的关系

| ADR | 关系 | 说明 |
|-----|------|------|
| ADR-0008 | 消费 | intent 集合不变，LLM 仍然需要映射到已知 intent |
| ADR-0010 | 消费 | slot schema 不变，校验规则不变，只是校验位置从 Router 移到 LLM 输出之后 |
| ADR-0001 | 消费 | TurnResult v2 schema 不变 |
| ADR-0002 | 消费 | state enums 不变 |
| ADR-0003 | 消费 | authority / confirmation 逻辑不变 |
| ADR-0006 | 消费 | card/action schema 不变 |

本提案**不要求修改任何 ADR**。它只改变交互链路上各组件的顺序和职责分配。

---

## 8. 待决策项

1. **选择哪个方案**？（推荐 D）
2. **LLM 角色选择**？（推荐编辑助手 + 灵感伙伴按需）
3. **实施节奏**？（Phase 1 先合并 classify + extract，Phase 2 上完整方案 D）
4. **本地模型是否支持结构化输出**？（需验证 qwen3.6-35b-a3b 的 JSON mode 能力）

---

## 9. 回写清单

- [ ] `00c-reading-map.md`：在工程师路径中补充本文
- [ ] `03-conversation-behaviors.md`：本文作为 §3 交互模型的补充
- [ ] `45-guided-conversation-flows.md`：本文作为 §3.1 的技术实现方案
- [ ] 若方案确定 → 起草 ADR
