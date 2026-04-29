# 记忆系统 v2 项目适配分析报告

- 日期：2026-04-29
- 依据：用户提供的《小说工作台记忆系统终版设计 v1.0》+ 当前项目实际代码
- 目的：先分析，后确认，再实现

---

## 1. 当前项目结构观察

### 1.1 Umbrella 分层（编译期强制依赖方向）

```
novel_web → novel_application → {novel_agent, novel_domain}
novel_agent → novel_foundation
novel_domain → novel_foundation
```

### 1.2 现有记忆系统 vs 新设计对照

| 维度 | 当前（interactions 表） | 新设计（memory_item 表） |
|------|------------------------|--------------------------|
| 定位 | episodic memory log | 创作事实治理系统 |
| 粒度 | 每条 turn 消息一条记录 | 每条可治理的创作事实一条记录 |
| 分类 | MemoryClass（episodic/semantic/procedural/meta） | MemoryType（WORLD_RULE/CHARACTER_PROFILE/...12 种） |
| 作用范围 | scope_ref（自由字符串） | MemoryScope（GLOBAL/WORK/VOLUME/ARC/CHAPTER/SESSION） |
| 生命周期 | retention_tier（hot/warm/cold） | MemoryStatus（DRAFT→CONFIRMED→STABILIZED/DEPRECATED/ARCHIVED） |
| 治理字段 | freshness_score / importance_score | weight / confidence / source_confidence / locked / recallable / version |
| 有效期 | 无 | NarrativePosition validFrom/validUntil + expireCondition |
| 召回 | 无（手动 recent/by_turn） | Hard Filter + Candidate Search + Rerank + Diversity + Token Budget Pack |
| 引用追踪 | 无 | memory_reference_log（异步） |
| 冲突检测 | 无 | 预留 memory_atom + memory_conflict（P4+） |

**结论：两套系统服务不同目的，不能简单替换。interactions 表保留用于 episodic memory log（回放/审计），memory_item 表是新增的创作事实治理层。**

### 1.3 现有领域模型

| 模型 | 是否存在 | 位置 | 备注 |
|------|---------|------|------|
| Work | ✅ | novel_domain + novel_persistence | works 表，8 字段 |
| Workspace | ✅ | novel_persistence | workspaces 表（最小字段） |
| Volume | ❌ | — | 仅在 Domain.Types 中有 status type |
| Arc | ❌ | — | 不存在 |
| Chapter | ❌ | — | 不存在 |
| Turn | 隐式 | — | turn_id 字符串，无独立表 |
| Task | 部分 | novel_persistence | long_run_tasks 表 |

### 1.4 现有通信方式

- 无 REST API（除 `/health`）
- 全部通过 Phoenix Channel（`workspace:<id>`）通信
- `user_message` 和 `adopt` 两个核心事件

### 1.5 现有异步机制

- Phoenix PubSub 内置于 supervision tree
- 无领域事件总线
- 无异步任务队列

### 1.6 现有 AI 调用链路

- Router → TurnService → AdoptionBoundary
- Provider.Stub（无真实 LLM 调用）
- 无上下文组装逻辑（Memory 仅记录不回召）

---

## 2. 推荐落点

### 2.1 各层职责分配

```
novel_foundation/
  enums/
    memory_type.ex        ← 新增：12 个 MemoryType 值
    memory_scope.ex       ← 新增：6 个 MemoryScope 值
    memory_status.ex      ← 新增：6 个 MemoryStatus 值（不含 LOCKED）
    memory_source_type.ex ← 替换现有的 source_type.ex：6 个新值
    conflict_level.ex     ← 预留（P4+）

novel_domain/
  memory_item.ex          ← 新增：MemoryItem struct + 纯函数
  narrative_position.ex   ← 新增：NarrativePosition struct
  memory_policy.ex        ← 新增：MemoryPolicy behaviour（召回策略接口）

novel_persistence/
  schemas/
    memory_item.ex        ← 新增：Ecto schema
  memory_reference_log.ex ← 新增：引用日志持久化
  migrations/
    00009_create_memory_items.exs

novel_application/
  memory_service.ex       ← 新增：MemoryApplicationService（CRUD 编排）
  memory_recall_service.ex ← 新增：MemoryRecallService（召回编排）
  memory_policy/
    hard_filter.ex        ← 新增：铁律过滤
    candidate_search.ex   ← 新增：候选搜索（MVP：关键词+类型+scope）
    reranker.ex           ← 新增：重排序
    diversity_filter.ex   ← 新增：去重降噪
    token_packer.ex       ← 新增：Token Budget Pack

novel_agent/
  （无改动，现有 Memory.Store 保留不变）

novel_web/
  controllers/
    memory_controller.ex  ← 新增：REST API
  router.ex               ← 修改：加 /api/works/:work_id/memories 路由
```

### 2.2 关键决策

**A. interactions 表保留不动。** 现有 Memory.Store + MemoryLog 继续服务 episodic memory（回放/审计/turn 历史），新的 memory_item 表独立存在。

**B. 新枚举替换旧枚举。** `MemorySourceType`（新 6 值：AUTHOR_CONFIRMED/AUTHOR_CREATED/AI_EXTRACTED/CHAPTER_EXTRACTED/WORK_SETTING_IMPORTED/SESSION_CONTEXT）替换现有 `SourceType`（旧 8 值），或作为独立枚举并行存在。

**C. Volume/Arc/Chapter 外键使用可空 UUID。** 当前这些领域对象尚未建模，外键先设可空，不阻塞 Memory 落地。

**D. 先走 REST API，不加 Channel event。** MVP 阶段记忆管理是独立页面操作，不需要实时广播。

---

## 3. 数据库改动清单

### 3.1 新增表：memory_items

```elixir
# Migration 00009
create table(:memory_items, primary_key: false) do
  add :id, :binary_id, primary_key: true
  add :work_id, :binary_id, null: false

  # 可选外键（volume/arc/chapter 尚未建模）
  add :volume_id, :binary_id, null: true
  add :arc_id, :binary_id, null: true
  add :chapter_id, :binary_id, null: true

  add :content, :text, null: false
  add :summary, :text, null: true

  # 枚举字段（string 存储，Foundation.Enums 校验）
  add :type, :string, null: false
  add :scope, :string, null: false
  add :status, :string, null: false, default: "DRAFT"
  add :source_type, :string, null: false

  add :reference_count, :integer, null: false, default: 0

  # DECIMAL(5,4) → Elixir :decimal
  add :weight, :decimal, precision: 5, scale: 4, null: false, default: 0.5000
  add :confidence, :decimal, precision: 5, scale: 4, null: false, default: 0.5000
  add :source_confidence, :decimal, precision: 5, scale: 4, null: false, default: 0.5000

  add :locked, :boolean, null: false, default: false
  add :recallable, :boolean, null: false, default: true
  add :common_sense, :boolean, null: false, default: false

  # NarrativePosition — 嵌入 JSONB
  add :valid_from, :map, null: true
  add :valid_until, :map, null: true
  add :expire_condition, :text, null: true

  add :version, :integer, null: false, default: 1

  add :tags, {:array, :string}, null: true

  add :source_id, :binary_id, null: true
  add :last_referenced_at, :utc_datetime_usec, null: true

  timestamps(type: :utc_datetime_usec)
end

# 索引
create index(:memory_items, [:work_id, :status, :type, :scope, :locked, :recallable])
create index(:memory_items, [:work_id, :weight])
create index(:memory_items, [:work_id, :source_type, :source_id])
```

### 3.2 新增表：memory_reference_logs

```elixir
create table(:memory_reference_logs, primary_key: false) do
  add :id, :binary_id, primary_key: true
  add :memory_id, :binary_id, null: false
  add :work_id, :binary_id, null: false
  add :task_id, :binary_id, null: true
  add :conversation_id, :binary_id, null: true
  add :reference_scene, :string, null: false
  add :reference_reason, :text, null: true

  timestamps(type: :utc_datetime_usec, updated_at: false)
end

create index(:memory_reference_logs, [:memory_id])
create index(:memory_reference_logs, [:work_id, :reference_scene])
```

### 3.3 改动总结

- **新增 2 张表**：memory_items（~25 字段）、memory_reference_logs（7 字段）
- **新增 5 个索引**
- **不动现有表**：interactions / works / workspaces 保持不变

---

## 4. 后端类与接口清单

### 4.1 novel_foundation — 枚举（3 新增 + 1 替换）

| 文件 | 说明 |
|------|------|
| `enums/memory_type.ex` | 12 值：WORLD_RULE ~ DRAFT_CONTEXT |
| `enums/memory_scope.ex` | 6 值：GLOBAL / WORK / VOLUME / ARC / CHAPTER / SESSION |
| `enums/memory_status.ex` | 6 值：DRAFT / CONFIRMED / STABILIZED / CONFLICTED / DEPRECATED / ARCHIVED |
| `enums/memory_source_type.ex` | **替换**现有 `source_type.ex`：AUTHOR_CONFIRMED / AUTHOR_CREATED / AI_EXTRACTED / CHAPTER_EXTRACTED / WORK_SETTING_IMPORTED / SESSION_CONTEXT |

对应 JSON SSOT 文件：`docs/design-v2/schemas/foundation/enums/memory_type.json` 等 4 个。

### 4.2 novel_domain — 领域对象（2 新增）

| 文件 | 说明 |
|------|------|
| `memory_item.ex` | MemoryItem struct + new/confirm/lock/deprecate/archive/update_weight/update_validity 纯函数 |
| `narrative_position.ex` | NarrativePosition struct（work_id/volume_id/arc_id/chapter_id/scene_index/narrative_layer） |

### 4.3 novel_persistence — 持久化（2 新增 + 1 migration）

| 文件 | 说明 |
|------|------|
| `schemas/memory_item.ex` | Ecto schema + changeset |
| `memory_reference_log.ex` | 引用日志持久化模块（write/batch_write/by_memory） |

### 4.4 novel_application — 用例编排（2 新增 + 5 策略模块）

| 文件 | 说明 |
|------|------|
| `memory_service.ex` | MemoryApplicationService：create/confirm/lock/unlock/deprecate/archive/update_weight/update_validity/update_recallable/search |
| `memory_recall_service.ex` | MemoryRecallService：recall/1（六阶段流程编排） |
| `memory_policy/hard_filter.ex` | Hard Filter：铁律级直接注入 |
| `memory_policy/candidate_search.ex` | Candidate Search：关键词+类型+scope 匹配 |
| `memory_policy/reranker.ex` | Rerank：Score = Relevance*0.6 + Weight*0.3 + Recency*0.1 + usageBoost |
| `memory_policy/diversity_filter.ex` | Diversity Check：去重降噪 |
| `memory_policy/token_packer.ex` | Token Budget Pack：按区块组织输出 |

### 4.5 novel_web — 接口层（1 新增 + 1 修改）

| 文件 | 说明 |
|------|------|
| `controllers/memory_controller.ex` | REST API 10 个端点 |
| `router.ex` | 加 `/api/works/:work_id/memories` scope |

### 4.6 API 端点清单

```
POST   /api/works/:work_id/memories                  # 创建记忆
GET    /api/works/:work_id/memories                  # 搜索记忆（query params 筛选）
GET    /api/works/:work_id/memories/:memory_id        # 获取记忆详情
POST   /api/works/:work_id/memories/:memory_id/confirm   # 确认记忆
POST   /api/works/:work_id/memories/:memory_id/lock      # 锁定记忆
POST   /api/works/:work_id/memories/:memory_id/unlock    # 解锁记忆
POST   /api/works/:work_id/memories/:memory_id/deprecate # 废弃记忆
POST   /api/works/:work_id/memories/:memory_id/archive   # 归档记忆
PATCH  /api/works/:work_id/memories/:memory_id/weight    # 修改权重
PATCH  /api/works/:work_id/memories/:memory_id/validity  # 修改有效期
POST   /api/works/:work_id/memories/recall               # 召回记忆
GET    /api/works/:work_id/memories/:memory_id/references # 查看引用记录
```

---

## 5. 前端页面与组件清单

### 5.1 MVP（P0）页面

| 页面 | 路由 | 组件 |
|------|------|------|
| 记忆管理页 | `/works/:workId/memories` | MemoryListPage |
| 记忆详情页 | `/works/:workId/memories/:memoryId` | MemoryDetailPage |
| 记忆创建 | 管理页内 dialog | MemoryCreateDialog |

### 5.2 P0 组件树

```
MemoryListPage
├── MemoryFilterBar          # 类型/scope/status/locked 筛选
├── MemoryTable              # 列表展示
│   └── MemoryRow            # 单行：type badge + content preview + weight + status
├── MemoryCreateDialog       # 创建表单
└── MemoryDetailDrawer       # 详情侧边栏
    ├── MemoryBasicInfo      # content/summary/type/scope/status
    ├── MemoryGovernance     # weight/confidence/locked/recallable
    ├── MemoryValidity       # validFrom/validUntil/expireCondition
    ├── MemoryStats          # referenceCount/lastReferencedAt/sourceType
    └── MemoryActions        # confirm/lock/deprecate/archive 按钮组
```

### 5.3 P2 页面（第二批次）

| 页面 | 路由 | 说明 |
|------|------|------|
| 召回预览 | 续写前展示 | MemoryRecallPreview |

---

## 6. 分阶段任务拆分

### 阶段 1A：枚举 + Domain struct（1-2 小时）

| # | 任务 | 交付物 |
|---|---|---|
| 1A.1 | 4 个枚举 JSON SSOT | memory_type.json / memory_scope.json / memory_status.json / memory_source_type.json |
| 1A.2 | `mix codegen.enums` 生成 4 个模块 | memory_type.ex / memory_scope.ex / memory_status.ex / memory_source_type.ex |
| 1A.3 | NovelDomain.MemoryItem struct | 全字段 struct + new/0 工厂函数 |
| 1A.4 | NovelDomain.NarrativePosition struct | 嵌套 struct |
| 1A.5 | lint 扩展 | 把 4 个新枚举的 canonical values 加入 lint_enum_literals.exs |
| 1A.6 | `mix check` 全绿 | 验证 |

### 阶段 1B：数据库 + Persistence 层（1-2 小时）

| # | 任务 | 交付物 |
|---|---|---|
| 1B.1 | Migration 00009 + 00010 | memory_items + memory_reference_logs 表 |
| 1B.2 | Ecto Schema + changeset | NovelPersistence.Schemas.MemoryItem |
| 1B.3 | MemoryReferenceLog 模块 | write/by_memory 基础 API |
| 1B.4 | 测试 | schema validation + reference log 测试 |

### 阶段 1C：Application 层 — 记忆管理（2-3 小时）

| # | 任务 | 交付物 |
|---|---|---|
| 1C.1 | MemoryService CRUD | create/confirm/lock/unlock/deprecate/archive |
| 1C.2 | MemoryService 查询 | search（多条件筛选+排序）/get |
| 1C.3 | MemoryService 更新 | update_weight/update_validity/update_recallable |
| 1C.4 | locked 冲突拦截 | 修改 locked 记忆时检查权限规则 |
| 1C.5 | 测试 | 全生命周期测试 + locked 规则测试 |

### 阶段 1D：Application 层 — 记忆召回（2-3 小时）

| # | 任务 | 交付物 |
|---|---|---|
| 1D.1 | HardFilter | weight>=0.9 + locked + CONFIRMED/STABILIZED + recallable + scope 匹配 |
| 1D.2 | CandidateSearch | 关键词匹配 + type 匹配 + scope 匹配（MVP 不依赖向量库） |
| 1D.3 | Reranker | Score = Relevance*0.6 + Weight*0.3 + Recency*0.1 + usageBoost |
| 1D.4 | DiversityFilter | 去重 + 高频低权重降噪（referenceCount>50 & weight<0.6） |
| 1D.5 | TokenPacker | 按区块组织：【不可违背规则】【当前状态】【人物关系】... |
| 1D.6 | MemoryRecallService | 六阶段流程 + 返回 MemoryRecallResult |
| 1D.7 | 异步引用日志 | 召回后写 memory_reference_log + 更新 reference_count |
| 1D.8 | 测试 | 各策略模块测试 + 集成测试 |

### 阶段 1E：Web API 层（1-2 小时）

| # | 任务 | 交付物 |
|---|---|---|
| 1E.1 | MemoryController | 12 个端点 |
| 1E.2 | Router 更新 | 加 scope + Phoenix 的 :api pipeline |
| 1E.3 | JSON 序列化 | 自定义 Jason encoder（Decimal → float, struct → map） |
| 1E.4 | 测试 | Controller 测试 |

### 阶段 1F：前端 — 记忆管理页（2-3 小时）

| # | 任务 | 交付物 |
|---|---|---|
| 1F.1 | MemoryListPage | 筛选栏 + 表格 |
| 1F.2 | MemoryDetailDrawer | 详情 + 操作按钮 |
| 1F.3 | MemoryCreateDialog | 创建表单 |
| 1F.4 | API client 层 | `frontend/src/lib/memoryApi.ts` |
| 1F.5 | 测试 | 组件渲染 + 交互测试 |

### 阶段 1G：集成 + 门禁（1 小时）

| # | 任务 | 交付物 |
|---|---|---|
| 1G.1 | TurnService 集成 memory recall | 续写时调 recall 注入上下文 |
| 1G.2 | mix check 全绿 | 架构/编译/测试/lint/ADR trace |
| 1G.3 | 端到端验证 | 创建→确认→锁定→召回 完整链路 |

---

## 7. 风险点

| 风险 | 级别 | 缓解 |
|------|------|------|
| Volume/Arc/Chapter 未建模，外键可空 | 低 | NarrativePosition 用 map 存 json，外键设 nullable，后续 join 时不报错即可 |
| 现有 SourceType 枚举与 MemorySourceType 冲突 | 中 | 两者语义不同（SourceType=日志来源，MemorySourceType=事实来源），保留两个独立枚举 |
| MemoryClass vs MemoryType 命名混淆 | 低 | 明确：MemoryClass 属于 interactions 表（episodic/semantic），MemoryType 属于 memory_items 表（WORLD_RULE/...） |
| REST API 与现有 Channel-only 架构不一致 | 低 | 记忆管理是 CRUD 操作，天然适合 REST。Channel 保留给实时 turn 通信 |
| 无异步任务队列，引用日志同步写可能阻塞 | 低 | MVP 阶段用 `Task.start/1` fire-and-forget，后续可接 Oban |
| 无真实 LLM Provider | 中 | 召回不依赖 LLM（MVP 用关键词），冲突检测（P4+）需 LLM 时才接入真实 Provider |

---

## 8. 第一批最小可执行任务

按优先级排序：

1. **创建 4 个枚举 JSON SSOT** → `mix codegen.enums` → 验证编译
2. **创建 Migration 00009**（memory_items 表）→ `mix ecto.migrate`
3. **创建 NovelDomain.MemoryItem struct** + NarrativePosition
4. **创建 NovelPersistence.Schemas.MemoryItem**（Ecto schema）
5. **创建 MemoryService**（create/get/search/confirm/lock/deprecate/archive）
6. **创建 MemoryController** + 路由
7. **创建前端 MemoryListPage**（最简可用版本：列表 + 创建 + 操作按钮）
8. **创建 MemoryRecallService** 骨架（先 Hard Filter + TokenPacker，后续再加 Rerank/Diversity）
9. **跑通 `mix check`**

---

## 9. 明确暂不实现

以下来自终版设计文档，明确延后：

| 项目 | 延后至 | 原因 |
|------|--------|------|
| memory_atom 表 + EAV 抽取 | P4（第五阶段） | 复杂度过高，先做治理再结构化 |
| memory_conflict 表 + 冲突检测 | P5（第六阶段） | 依赖 EAV 原子化 |
| LLM 冲突裁决 | P5 | 依赖冲突检测 + 真实 Provider |
| 冲突调解中心（前端） | P5 | 依赖冲突 API |
| 记忆时间线（前端） | P6（第七阶段） | 依赖足够数据积累 |
| Vector Search / embedding | 后续升级 | MVP 关键词匹配足够 |
| 第 2 批 MemoryType 覆盖（全 12 种） | P1 后期 | MVP 先支持 WORLD_RULE/CONSTRAINT/CHARACTER_PROFILE/CURRENT_STATE/PLOT_FACT |
| 召回预览页面 | P2（第三阶段） | 先让召回跑通，再做可视化 |
| memory_embedding 表 | 后续升级 | MVP 不做向量 |

---

## 10. 下次会话恢复指引

1. 阅读本报告 + 终版设计文档 §1-§10
2. 从阶段 1A 开始：先建 4 个枚举 JSON SSOT
3. 每完成一个阶段跑 `mix check` 确保不引入回归
4. 第一批目标：阶段 1A-1E（后端完整链路）+ 阶段 1F 最简前端
