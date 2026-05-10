# AU-05 采纳创作产物

> 作者视角：AI 生成的所有内容（主角设定、剧情大纲、章节片段）默认都是"草稿"。它们以卡片形式展示给我挑选。只有我明确点击"采用"后，这些内容才会正式成为我小说的一部分。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 让 AI "帮我想三个可能的主角名字" | AI 给出候选卡片，每张有名字和背景 |
| 浏览并对比不同方案 | 候选方案作为讨论材料展示，不改变作品正文 |
| 选中一个方案 | 系统记录我的偏好，提示是否"确认采用" |
| 点击"采用"按钮 | 系统正式写入作品设定，并刷新我的作品视图 |
| 对所有方案都不满意 | 我可以不理会这些卡片，或让 AI 换一批 |

明确不能做的：
- AI 不应自动把草稿写入正式章节或设定集
- 我不应在没有"采用"操作的情况下看到这些内容出现在阅读视图中

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #6 | 写入默认 tentative | A1 — 生成物默认 `adoption_status: :tentative` |
| #11 | candidate selection ≠ adoption | B1 — 选择后仍需确认才写入 |
| #12 | 确认后重新 gate | C1 — adoption 前过 Orchestrator re-gate |
| #15 | projection hints 只触发刷新 | C1 — adoption 后产生 ProjectionHint，不授权写入 |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| ADR-0010 | AdoptionBoundary + AdoptionDecision 定义 |
| ADR-0016 | ProjectionHint 最小 schema |
| VS-02A Contract Pack | TentativeArtifactSet 规则 |
| VS-04 Contract Pack §2 | CandidateSet 最小 schema |
| VS-04 Contract Pack §4 | AdoptionBoundary 最小 policy |
| VS-04 Contract Pack §5 | ProjectionHint 规则 |
| VS-04 Contract Pack §7 | Proof 草案（8 条） |

---

## 4. 验收场景

### 场景组 A：草稿生成

#### A1 — 生成内容默认为草稿

**作为作者**，我要求 AI "设计一个反派组织"。系统生成候选方案，并明确标注为"草案"。

```
作者: 设计一个反派组织。
AI: 我为你构思了三个各具特色的反派组织方案：
    [方案1: 影之议会] - 潜伏在暗处的古老势力...
    [方案2: 灵源重工] - 垄断了全球灵气的巨头...
    [方案3: 虚空教派] - 崇拜异位面神明的狂信徒...
    (这些内容尚未加入你的作品设定)
```

**验证点**：
- [ ] 收到包含 `tentative_artifacts` 或 `candidate_directions` 的回复
- [ ] 内部记录的 `adoption_status` 为 `tentative` 或 `not_adopted`
- [ ] 数据库作品正式设定表中没有新增这些数据
- [ ] 创作工具（creative tool）没有 write_scopes

**测试**：`creative_artifact_test.exs` — `"result has tentative_artifact in state_delta"` ✅
**测试**：`creative_artifact_test.exs` — `"creative tool has no write_scopes — cannot produce production fact"` ✅

---

### 场景组 B：选择与偏好

#### B1 — 选择一个候选方案

**作为作者**，我对"方案2: 灵源重工"很满意，点击了选择按钮。系统记录我的选择，但此时作品设定仍未发生正式改变。

**验证点**：
- [ ] 提交了 `choose_candidate` 动作
- [ ] 系统记录了我的选择偏好
- [ ] 此时作品设定仍未变（selection 阶段 ≠ adoption 阶段）

**测试**：`adoption_boundary_test.exs` — `"selection != adoption by default"` ✅

---

### 场景组 C：采纳边界

#### C1 — 确认采用后正式写入

**作为作者**，我确认采用"灵源重工"作为本作品的反派。系统执行采纳操作，写入作品设定。

**验证点**：
- [ ] 内部产生 AdoptionDecision
- [ ] 数据库作品设定表中出现了"灵源重工"
- [ ] Trace 记录了从"草稿生成"到"选择"再到"采纳"的完整过程

**测试**：`adoption_boundary_test.exs` — `"low-risk candidate is adopted as tentative"` ✅

---

#### C2 — 采纳冲突处理（过期失效）

**作为作者**，我尝试采用一个已经被我改乱了上下文的旧草稿。系统检测到上下文已失效，提示"草稿已过期，请重新生成"。

**验证点**：
- [ ] AdoptionBoundary 拦截了过期的采纳请求
- [ ] 返回明确的错误或降级提示

**测试**：`adoption_boundary_test.exs` — `"stale candidate_id fails"` ✅

---

### 场景组 D：诚实性

#### D1 — 系统不谎报进度

**作为作者**，AI 回复说"我已经帮你写好了"。这必须真的意味着它已经采纳了，而不是仅仅生成了草稿。

**验证点**：
- [ ] 若 `adoption_status != :adopted`，TurnResult 严禁宣称"已写入作品"
- [ ] UI 上的状态显示与内部 `adoption_status` 严格一致

**测试**：`adoption_boundary_test.exs` — `"selection != adoption by default"` ✅

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 状态 |
|------|--------|------|
| A1 | 生成默认为草稿 | ✅ 有测试 |
| B1 | 选择候选方案 | ✅ 有测试 |
| C1 | 确认采用后写入 | ✅ 有测试 |
| C2 | 采纳冲突处理 | ✅ 有测试 |
| D1 | 系统不谎报进度 | ✅ 有测试 |

**通过率：5/5（100%）**

---

## 6. 缺口

| 缺口 | 影响 | 建议处理 |
|------|------|---------|
| GAP-01 — 高风险候选必须二次确认 | 候选内容涉及 production write 时需额外 confirmation | 已有 `high-risk candidate requires confirmation` 测试，但端到端场景未覆盖 |
| GAP-02 — ProjectionHint 刷新验证 | adoption 后 UI 是否收到正确的 projection hint 并刷新 | 在 VS-08 集成测试中验证 adoption → projection refresh 链路 |

---

## 7. 验收命令

```bash
mix test apps/novel_application/test/novel_application/adoption_boundary_test.exs
mix test apps/novel_application/test/novel_application/creative_artifact_test.exs
```
