# AU-09 管理故事设定

> 作者视角：我的小说有大量设定——角色关系、伏笔线索、世界观规则。我需要一个"故事圣经"来管理这些内容，确保故事世界前后一致。最重要的是，这些设定应该在我和 AI 对话时被自动引用。

---

## 1. 我能做什么

| 我能做什么 | 系统怎么回应 |
|-----------|------------|
| 打开作品档案面板 | 看到作品总览（卷数、草稿数、角色数、设定数） |
| 按标签页浏览 | 在大纲/角色/伏笔/规则四个标签间切换 |
| 查看记忆管理页面 | 看到完整表格（类型/范围/状态/权重/锁定） |
| 多维度筛选记忆 | 按类型、范围、状态、关键词过滤 |
| 新建记忆 | 填写内容、类型、范围、来源后保存 |
| 管理记忆生命周期 | 确认、锁定、弃用、归档 |
| **和 AI 对话时 AI 自动引用记忆** | ContextAssembler 召回相关记忆放入 prompt |

明确不能做的：
- 记忆管理页面目前是 Phase 0 快速验证产物，最终 UI 待设计规范

---

## 2. 不变量

| 编号 | 不变量 (`00c` §7) | 本验收如何验证 |
|------|-------------------|---------------|
| #5 | 工具调用有 trace | S8 — 记忆生命周期操作有对应状态变更记录 |
| #11 | candidate selection ≠ adoption | S3 — 待采纳内容独立展示在伏笔标签中 |

---

## 3. 契约引用

| 契约 | 用途 |
|------|------|
| `05-memory-retention-and-retrieval.md §4` | MemoryType 枚举体系（11 种类型） |
| `05-memory-retention-and-retrieval.md §5` | MemoryScope 枚举（6 级范围） |
| `05-memory-retention-and-retrieval.md §6` | MemoryStatus 状态机（6 种状态） |
| `05-memory-retention-and-retrieval.md §7` | MemorySourceType（6 种来源） |
| `05-memory-retention-and-retrieval.md §8.1` | MemoryItem 核心字段 |
| `NovelFoundation.Enums.*` | 编译期冻结的枚举常量 |
| `MemoryItem` Ecto Schema | 23 字段的数据模型 + changeset 校验 |
| `memoryApi.ts` | 14 个前端 API 端点 |
| `WorkspaceContext.context_fetcher/0` | 上下文组装时的记忆召回 |

---

## 4. 验收场景

### 场景组 A：数据模型完整性

#### A1 — MemoryItem 字段级校验

**作为作者**，我不知道的是，每条记忆背后有 23 个字段在保证它的治理能力。这些字段必须全部正确存储和校验。

**必填字段**（`changeset` 中 `validate_required`）：
| 字段 | 类型 | 含义 | 默认值 |
|------|------|------|--------|
| `id` | UUID | 主键，不自增 | — |
| `work_id` | UUID | 所属作品 | — |
| `content` | string | 记忆正文 | — |
| `type` | MemoryType | 11 种类型之一 | `"WORLD_RULE"` |
| `scope` | MemoryScope | 6 级范围之一 | `"WORK"` |
| `source_type` | MemorySourceType | 6 种来源之一 | — |

**治理字段**：
| 字段 | 类型 | 含义 | 校验约束 |
|------|------|------|---------|
| `status` | MemoryStatus | 6 种状态之一 | 默认 `"DRAFT"` |
| `weight` | decimal | 召回权重 | `[0.0, 1.0]`，默认 0.5 |
| `confidence` | decimal | 记忆可信度 | `[0.0, 1.0]`，默认 0.5 |
| `source_confidence` | decimal | 来源可信度 | `[0.0, 1.0]`，默认 0.5 |
| `locked` | boolean | 是否锁定 | 默认 false |
| `recallable` | boolean | 是否可被召回 | 默认 true |
| `common_sense` | boolean | 是否为常识 | 默认 false |

**范围字段**：
| 字段 | 含义 |
|------|------|
| `volume_id` | 所属卷（可选） |
| `arc_id` | 所属弧线（可选） |
| `chapter_id` | 所属章节（可选） |

**时效字段**：
| 字段 | 含义 |
|------|------|
| `valid_from` | 生效叙事位置（`NarrativePosition` map） |
| `valid_until` | 失效叙事位置 |
| `expire_condition` | 自然语言过期条件 |

**验证点**：
- [ ] 必填字段缺失时 `changeset` 返回 error
- [ ] `type` 值不在 11 种枚举中 → `validate_inclusion` 失败
- [ ] `scope` 值不在 6 种枚举中 → `validate_inclusion` 失败
- [ ] `status` 值不在 6 种状态中 → `validate_inclusion` 失败
- [ ] `weight` / `confidence` 超出 `[0.0, 1.0]` → `validate_number` 失败
- [ ] `version` < 1 → `validate_number` 失败

**代码**：`memory_item.ex:68-110`（`changeset/2`）✅

---

### 场景组 B：状态机

#### B1 — 记忆状态流转定义

**作为作者**，一条记忆经历从草稿到确认到稳定/废弃的完整生命周期。系统必须保证只有合法的状态流转。

**状态枚举**（`MemoryStatus`）：
```
DRAFT → CONFIRMED → STABILIZED
                 → DEPRECATED → ARCHIVED
                 → CONFLICTED
```

| 状态 | 含义 | AI 召回行为 |
|------|------|-----------|
| `DRAFT` | AI 生成的初始记忆，待确认 | 可召回但权重降低 |
| `CONFIRMED` | 作者已确认 | 正常召回 |
| `STABILIZED` | 长期有效的核心设定 | 正常召回，锁定不受自动修改 |
| `CONFLICTED` | 与其他记忆冲突 | 召回时标注冲突 |
| `DEPRECATED` | 已废弃但保留记录 | 不召回 |
| `ARCHIVED` | 归档 | 不召回 |

**注意**：`locked` 不是状态而是独立字段——任意状态的记忆都可以被锁定（`locked = true`），锁定后 AI 不能自动修改。

**验证点**：
- [ ] `DRAFT → CONFIRMED`：`confirmMemory` API 触发
- [ ] `CONFIRMED → DEPRECATED`：`deprecateMemory` API 触发
- [ ] `DEPRECATED → ARCHIVED`：`archiveMemory` API 触发
- [ ] 锁定/解锁独立于状态：DRAFT/CONFIRMED/STABILIZED 都可被锁
- [ ] `recallable = false` 的记忆不被召回，无论状态
- [ ] 状态值不在枚举中 → changeset 拒绝

**代码**：`MemoryDetailDrawer.tsx`（UI 操作按钮）、`memoryApi.ts`（API 端点）✅
**缺口**：没有显式的状态机校验层（如禁止 `ARCHIVED → DRAFT` 回退）。当前依赖前端按钮的显示/隐藏逻辑，后端 API 未拒绝非法流转。❌

---

#### B2 — 锁定的行为语义

**作为作者**，我锁定了一条核心设定（如"灵气被垄断为能源"）。AI 在回复中可以引用它，但不能自动修改它的内容或状态。

**锁定 ≠ 不可召回**：锁定只阻止修改，不阻止引用。

**验证点**：
- [ ] `locked = true` → `update_changeset` 允许修改 `weight` 和 `last_referenced_at`，不允许修改 `content` 或 `status`
- [ ] `locked = true` → UI 中内容字段禁用编辑，但权重和参考时间可更新
- [ ] 锁定记忆在召回时正常参与排序（不受惩罚）

**当前实现**：`update_changeset` 允许修改 `content` 即使是 locked 状态。未做锁定保护。❌

---

### 场景组 C：召回与上下文集成

#### C1 — 记忆召回集成到 ContextAssembler

**作为作者**，我创建了一条伏笔"林烬的妹妹林瑶失踪"，确认后它进入了记忆库。下一轮对话中我问"林烬为什么要冒险"，AI 应该在回答中引用这条伏笔。

**完整数据流**：
```
Turn N: 作者创建并确认记忆 → MemoryItem(status=CONFIRMED, type=FORESHADOWING)
Turn N+1: 作者发消息 → ContextAssembler.assemble(ws_id, fetcher)
  → fetcher 内部调用 recallMemories(ws_id, query: 本轮消息, ...)
  → 返回匹配的记忆列表（如"林烬的妹妹林瑶失踪"）
  → 填充 memory_summary 字段
  → to_prompt_text 生成 "## 相关记忆\n- 伏笔: 林烬的妹妹林瑶失踪\n- 设定: ..."
  → Planner 将记忆段放入 LLM prompt
  → AI 回应引用林瑶失踪的信息
```

**验证点**：
- [ ] `context_fetcher` 内部调用 `recallMemories`（或在 fetcher 外部单独召回后合并）
- [ ] 召回的 `memory_summary` 是非空文本（当有匹配记忆时）
- [ ] AI 回应中能看到召回的记忆内容
- [ ] `context_refs` 中包含 `source_type = :memory` 的 ref

**当前实现**：`workspace_context.ex:27` — `memory_summary` 写死为 `nil`。记忆召回未接入 ContextAssembler。❌

---

#### C2 — 召回排序与过滤

**作为作者**，我有 50 条记忆，AI 只需要最相关的几条。召回根据以下因素排序：

**召回排序因子**：
| 因子 | 字段 | 影响方向 |
|------|------|---------|
| 内容匹配度 | 语义搜索 vs query | 高匹配优先 |
| 权重 | `weight` | 高权重优先 |
| 可靠度 | `confidence` × `source_confidence` | 高可靠优先 |
| 新鲜度 | `last_referenced_at` | 最近引用过加分 |
| 类型偏好 | `prefer_types` 参数 | 匹配类型加分 |
| 范围匹配 | `scope` vs 当前上下文 | 精准匹配优先 |

**排除规则**：
- `recallable = false` → 不召回
- `status = DEPRECATED / ARCHIVED` → 不召回
- `valid_until` 已过期 → 不召回

**验证点**：
- [ ] `recallable = false` 的记忆被排除
- [ ] `DEPRECATED / ARCHIVED` 状态的记忆被排除
- [ ] 过期记忆（`valid_until`）被排除
- [ ] 召回结果按权重降序排列
- [ ] `prefer_types` 参数对结果有影响（指定类型的记忆排更前）
- [ ] 召回结果有数量/ token 上限

---

#### C3 — 召回 token 预算控制

**作为作者**，一次性召回 100 条记忆会把 prompt 撑爆。系统必须有 token 预算控制。

**验证点**：
- [ ] `recallMemories` 接受 `token_budget` 参数
- [ ] 返回结果 `estimated_tokens <= token_budget`
- [ ] 当候选记忆超预算时，按相关性截断
- [ ] 截断不影响 `iron_law` 类记忆（高权重 + CONFIRMED + STABILIZED）的包含

---

### 场景组 D：档案面板与表格

#### D1 — 四标签切换 + 统计数据

**作为作者**，打开作品档案面板看到统计数据，在大纲/角色/伏笔/规则四个标签间切换。

已验证场景（保持不变）：S1-S3 → 见上一版 AU-09 §4 场景组 A

---

#### D2 — 记忆列表筛选精度

**作为作者**，我筛选"已确认的伏笔"时，列表必须只显示同时满足 `type = FORESHADOWING AND status = CONFIRMED` 的记录。

**多条件筛选逻辑**（AND 关系）：
| 筛选器 | UI 控件 | 字段映射 |
|--------|---------|---------|
| 关键词 | text input | `content ILIKE %keyword%` |
| 类型 | select | `type = ?` |
| 范围 | select | `scope = ?` |
| 状态 | select | `status = ?` |
| 锁定 | select | `locked = ?` |

**验证点**：
- [ ] 所有激活的筛选条件以 AND 组合
- [ ] 清空筛选条件 → 恢复全部记忆列表
- [ ] 筛选后 count 更新
- [ ] 无匹配结果时显示"暂无记忆"空态

**代码**：`MemoryListPage.tsx:95-123`（筛选 UI）、`listMemories` API ✅

---

### 场景组 E：时效与有效期

#### E1 — 有效期窗口

**作为作者**，我设置一条记忆"仅在第一章有效"（`valid_from: {chapter_id: "ch1"}, valid_until: {chapter_id: "ch2"}`）。当故事推进到第二章后，这条记忆不再被召回。

**验证点**：
- [ ] `valid_from` 指定了记忆开始生效的叙事位置
- [ ] `valid_until` 指定了记忆失效的叙事位置
- [ ] 当前叙事位置在 `[valid_from, valid_until)` 之外 → 不召回
- [ ] `expire_condition` 字段存储自然语言条件（如"主角离开矿洞后失效"），供人工判断
- [ ] `valid_from/valid_until` 可以是 `null`（永久有效）

**当前实现**：`valid_from`/`valid_until` 字段已在 schema 中定义，但 UI 未暴露设置入口，召回逻辑未使用。❌

---

## 5. 场景覆盖状态

| 场景 | 做什么 | 验证粒度 | 状态 |
|------|--------|---------|------|
| A1 | MemoryItem 字段级校验 | 字段 × 约束 | ✅ changeset 已定义 |
| B1 | 状态机流转定义 | 状态 × 转换 | ⚠️ 前端按钮控制，后端无校验 |
| B2 | 锁定行为语义 | locked × 字段修改权限 | ❌ update_changeset 未保护 |
| C1 | 记忆召回集成 | fetcher → recall → prompt | ❌ memory_summary 写死 nil |
| C2 | 召回排序与过滤 | 排序因子 × 排除规则 | ⚠️ 有 API 但未端到端验证 |
| C3 | 召回 token 预算 | token_budget 上限 | ⚠️ API 支持但未验证 |
| D1 | 四标签切换 + 统计 | UI 组件级 | ✅ |
| D2 | 筛选精度 | 多条件 AND | ✅ |
| E1 | 有效期窗口 | valid_from/until | ❌ 未接入召回逻辑 |

**通过率：3/9 完整 + 3/9 部分 = 约 50%**

---

## 6. 缺口

| 缺口 | 具体表现 | 影响 | 建议处理 |
|------|---------|------|---------|
| GAP-01 — memory_summary 未接入 ContextAssembler | `workspace_context.ex:27` 返回 nil | AI 对话时无法引用记忆库 | fetcher 内调用 `recallMemories` → 填充 `memory_summary` |
| GAP-02 — 状态机无后端校验 | `confirmMemory` API 未拒绝非法状态转换 | 前端 bug 可导致 `ARCHIVED → DRAFT` 回退 | 后端增加状态机 guard：每次状态变更前校验合法路径 |
| GAP-03 — locked 字段未保护 | `update_changeset` 允许修改 locked 记忆的 content | 锁定是摆设——API 层仍可修改内容 | `update_changeset` 内 or API handler 层校验 `locked=true` → 拒绝 content/status 修改 |
| GAP-04 — 召回端到端未验证 | `recallMemories` 有 API 但无测试 | 不知道召回结果是否正确进入 prompt | VS-08 中增加 real-loop 测试：创建记忆 → 发消息 → 验证 AI 引用记忆 |
| GAP-05 — 有效期窗口未生效 | `valid_from/valid_until` 字段定义了但召回时不用 | 设置了有效期的记忆仍在全书中被引用 | 召回逻辑中增加叙事位置比对 |
| GAP-06 — 无自动化测试 | 记忆 CRUD + 生命周期全靠手动操作 | 重构或回归时无保障 | 新增后端测试：`memory_lifecycle_test.exs` |

---

## 7. 验收命令

```bash
# 当前无自动化测试——记忆管理验收依赖手动操作

# 可执行的验证：
# 1. 编译期枚举校验：mix compile --warnings-as-errors
# 2. Ecto changeset 校验（通过 ExUnit 覆盖 schema 层）
# 3. 记忆召回集成：VS-08 中通过真实 SQLite3 + recallMemories API 验证
```
