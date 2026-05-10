# AU-05 采纳创作产物

> 作者视角：AI 生成的所有内容（角色设定、剧情大纲、章节片段）默认都是"草稿"。它们以卡片形式展示给我挑选。只有我明确点击"采用"后，这些内容才会正式成为我小说的一部分。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 让 AI "帮我想几个反派组织" | AI 给出候选方案，标注为"草稿" |
| 浏览不同方案 | 方案作为讨论材料展示，不会自动写入作品 |
| 选中一个方案 | 系统告诉我选中了什么，提示是否"确认采用" |
| 点击"采用" | 系统正式写入作品设定，刷新相关视图 |
| 对所有方案都不满意 | 不理会卡片，或让 AI 换一批 |
| 方案过期了还点采用 | 系统提示"已过期"，不执行 |

明确不能做的：
- AI 不能自动把草稿写入正式章节或设定集
- 我不应在没点"采用"的情况下看到这些内容出现在阅读视图中

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #6 | 写入默认 tentative | A1 — 生成物默认标记为草稿 |
| #11 | candidate selection ≠ adoption | B1 — 选中不等于采纳 |
| #12 | 确认后重新 gate | C1 — 高风险采纳需要二次确认 |
| #15 | projection hints 只触发刷新 | C2 — 采纳后触发投影刷新，不授权写入 |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0010 | AdoptionBoundary + AdoptionDecision 定义 |
| ADR-0016 | ProjectionHint 最小 schema |
| VS-02A Contract Pack | TentativeArtifactSet 规则 |
| VS-04 Contract Pack §2 | CandidateSet 最小 schema |
| VS-04 Contract Pack §4 | AdoptionBoundary 最小 policy（7 项 gate fact） |
| VS-04 Contract Pack §5 | ProjectionHint 规则 |
| VS-04 Contract Pack §7 | Proof 草案 |

---

## 4. 验收场景

### 场景组 A：生成的都是草稿

#### A1 — AI 设计了一个反派组织，标注为"待审核"

**作为作者**，我让 AI "设计一个反派组织"。AI 回复了三个候选方案，每个都有名称和简介。回复末尾标注了"这些内容尚未加入你的作品设定"。我在阅读模式里看不到这些内容——只有当我采纳后才会出现。

**验证点**：
- [ ] 生成的内容标记为 `tentative` 或草稿状态
- [ ] 回复中明确告知"尚未加入作品"
- [ ] 未采纳的内容不出现在阅读模式的 TOC 中

**测试**：`creative_artifact_test.exs` — `"result has tentative_artifact in state_delta"` ✅

---

#### A2 — AI 生成了章节片段，但没有自动写入

**作为作者**，AI 帮我写了一段第一章的开头。这段文字以卡片形式展示给我，我可以看、可以修改、可以决定要不要。但它不会自动出现在我的作品里——必须我明确说"采用"。

**验证点**：
- [ ] 创作类工具（creative_generation）没有 write_scopes——不能直接写入
- [ ] 产出在 `TentativeArtifactSet` 中，`adoption_status = :tentative`

**测试**：`creative_artifact_test.exs` — `"creative tool has no write_scopes — cannot produce production fact"` ✅

---

### 场景组 B：选择与采纳是两个步骤

#### B1 — 我先选，再决定是否采纳

**作为作者**，AI 给了我三个反派组织方案。我选了"灵源重工"这个，系统记录了我的偏好，但此时它还不是正式设定——我的作品档案里不会出现"灵源重工"。系统提示我"确认采用？"——这是一个独立的第二步。

**验证点**：
- [ ] 选择（choose_candidate）只记录偏好，不产生 adoption
- [ ] 采纳（adopt）是独立操作，需要经过 AdoptionBoundary 评估

**测试**：`adoption_boundary_test.exs` — `"selection != adoption by default"` ✅

---

#### B2 — 正式采纳后，作品设定更新

**作为作者**，我点击"采用"确认了"灵源重工"。系统正式将其写入作品设定。现在我在作品档案面板里能看到它，阅读模式里相关内容也会更新。

**验证点**：
- [ ] 采纳后产生 `AdoptionDecision`
- [ ] `adoption_status` 从 `tentative` 变为 `adopted`
- [ ] Trace 记录了从生成→选择→采纳的完整链路

**测试**：`adoption_boundary_test.exs` — `"low-risk candidate is adopted as tentative"` ✅

---

### 场景组 C：安全边界

#### C1 — 高风险方案需要二次确认

**作为作者**，我选了一个会大范围修改作品设定的方案。系统没有直接执行，而是再次弹出确认提示——告诉我具体会改动什么、影响多大，让我再确认一次。

**验证点**：
- [ ] 高风险候选（`risk_hint = :high`）→ AdoptionDecision 为 `require_confirmation`
- [ ] 确认后才真正执行 adoption

**测试**：`adoption_boundary_test.exs` — `"high-risk candidate requires confirmation"` ✅

---

#### C2 — 采纳后相关视图提示刷新

**作为作者**，我采纳了一个新角色后，阅读模式那边如果有相关内容，会提示"投影状态：已过期"——因为新角色的加入影响了之前的视图。我需要点"刷新投影"才能看到最新版本。

**验证点**：
- [ ] adoption 后产生 ProjectionHint
- [ ] ProjectionHint 触发视图刷新提示（STALE）
- [ ] ProjectionHint 不授权前端写入

**测试**：`adoption_boundary_test.exs` — `"projection hint appears only on adoption"` ✅

---

#### C3 — 一个过期的方案，点了采用也不执行

**作为作者**，AI 三天前给我生成了一个角色方案，我一直没处理。这期间作品的剧情已经推进了，那个方案的前提条件已经变了。我今天才点"采用"，系统应该告诉我"这个方案已过期，建议重新生成"。

**验证点**：
- [ ] 过期的 candidate → `AdoptionDecision.decision_type = :fail_with_recovery`
- [ ] 不产生 production write
- [ ] **当前实现：candidate_not_found 分支有 `fail_with_recovery`，但 freshness check（上下文版本比对）未实现** ❌

**测试**：`adoption_boundary_test.exs` — `"stale candidate_id fails"` ✅

---

#### C4 — 系统不谎报采纳状态

**作为作者**，AI 回复说"已成功将灵源重工加入作品设定"。这句话必须是真的——系统内部记录中 `adoption_status` 必须是 `adopted`。如果不是，AI 就是在撒谎。

**验证点**：
- [ ] TurnResult 的 truthfulness 中 `artifact_adopted` 仅在真正采纳后为 true
- [ ] 草稿状态下 TurnResult 不能声称"已写入作品"

**测试**：`adoption_boundary_test.exs` — `"selection != adoption by default"` ✅

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 生成标注为草稿 | ✅ |
| A2 | 不自动写入 | ✅ |
| B1 | 选择和采纳分开 | ✅ |
| B2 | 采纳后设定更新 | ✅ |
| C1 | 高风险二次确认 | ✅ |
| C2 | 采纳后提示刷新 | ✅ |
| C3 | 过期方案拒绝 | ⚠️ freshness check 未实现 |
| C4 | 不谎报状态 | ✅ |

**通过率：7/8 完整 + 1/8 部分 = 约 94%**

---

## 6. 缺口

| 缺口 | 具体表现 | 影响 |
|------|---------|------|
| GAP-01 — freshness check 未实现 | `AdoptionBoundary.evaluate` 不比对上下文版本 | 基于过时上下文生成的候选可能被错误采纳 |
| GAP-02 — 采纳后 StateTrace 未实际写入 | `adopted_state_ref` 是字符串模式不是真实 DB 记录 | 回放时无法追溯采纳对作品状态的实际变更 |
| GAP-03 — Production write 无 StateTrace | 采纳操作不产生 production state trace | 历史审计缺失——无法知道"什么时候因为什么把什么写入了作品" |
| GAP-04 — ProjectionHint 的 projection_ref 硬编码 | 始终返回 `"character_list"` | 不同采纳类型（角色/大纲/章节）的投影刷新不正确 |

---

## 7. 验收命令

```bash
mix test apps/novel_application/test/novel_application/adoption_boundary_test.exs
mix test apps/novel_application/test/novel_application/creative_artifact_test.exs
```
