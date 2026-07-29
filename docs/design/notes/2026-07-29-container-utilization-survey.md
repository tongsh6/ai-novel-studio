# 结构化容器空转全表排查（Order 8，2026-07-29）

> **性质**：排查备忘，**不授权实现**。产出是"哪些容器在空转/退化 + 根因分几组"，
> 具体要不要修、按什么顺序修，须另行拍板并落 slice。

范围：`tmp/dogfood-db`（100 章，07-22）、`tmp/dogfood-db-m4`（105 章，07-28）、
`tmp/dogfood-db-m4b`（12 章，07-29，最新 VS-00G 重放）三库交叉 + `apps/*/lib`
写入/消费路径。全程只读（SELECT / .tables / .schema / grep）。

## 0. 独立抽验（本文数字可信度）

排查由子代理执行，落盘前对以下论断做了独立复核，**全部吻合**：

| 论断 | 复核命令 | 结果 |
|---|---|---|
| paper_trail 生产零引用 | `grep -rn "PaperTrail" apps/*/lib \| wc -l` | 0 |
| Workspace 生产零写入 | `grep -rln "%Workspace{}\|Workspace.changeset" apps/*/lib \| wc -l` | 0 |
| MutationLog 生产零调用 | `grep -rn "MutationLog\." apps/*/lib \| wc -l` | 0 |
| memory_items.type 单值 | m4 `group by type` | `DRAFT_CONTEXT\|195` |
| plan_direction 全填 | m4 `count(*), sum(plan_direction is not null)` | `105\|105`，键集变体数 = 1 |
| arc/information 子账为 0 | m4 `group by ledger` | 只有 conflict 1 / emotion_curve 105 / promise 1 |
| workspaces/versions 空表 | m4 两表 count | `0\|0` |
| characters role/aliases 全空 | m4/m4b | `1行/0/0`、`4行/0/0` |
| mutations 维度坍缩 | m4 | `195 行 / type 1 / status 1 / actor 1` |

一处修正：scenes title 实际分布为 `场景 1`×89 / `场景 2`×73 / `场景 3`×1 / 章标题×16
（原报告写作 162 + 17，量级结论不变）。

## 1. 结论先行

25 张业务表中，**2 张全库零行空转**（`workspaces`、`versions`）、**8 张退化**
（`volumes`、`characters`、`scenes`、`mutations`、`interactions`、`memory_items`、
`long_run_tasks`、`work_sessions`），另有 `ledger_entries` 的 `information` 子账
三库近乎零行、`arc` 子账在 m4 为 0。

**根因不统一，是三把不同的刀**——这是本次排查最重要的结论，它推翻了 NEXT 里
"根假设：规划层不产结构化事实"的一刀切预期：

1. **「规划层不产结构化事实」只解释 3 处**：`volumes`、`scenes`、`ledger_entries.arc`。
2. **更大的一块是「自由创作只产两种 artifact」**——百章库 `memory_items.tags` 只有
   `outline_draft` 和 `prose_fragment` 两个值，连带 `mutations.mutation_type` 恒为
   `adopt_artifact`、`memory_items.type` 11 个枚举只用 1 个、`scope` 只用 `WORK`。
   这是**产出品类单一**，跟规划层结构化与否无关。
3. **剩下的是「设计留位、消费面/生命周期从未接线」**：`interactions` 记忆分层、
   `mutations` 6 阶段状态机、`long_run_tasks` 18 个字段、`workspaces`/`versions` 整表。

**重要证伪**：初步嫌疑名单里的 `chapters.plan_direction` **完全健康**——m4 库 105/105
章九字段全填、键集零变体。NEM-GAP-03 的关闭是真的，不必再查。

## 2. 表 × 使用深度矩阵

语义字段 = 非 id / 非外键 / 非时间戳。丰富度以 m4（105 章）为准。

| 表 | 语义字段 | 生产写入路径 | 标本实测 | 消费侧 | 判定 | GAP |
|---|---|---|---|---|---|---|
| `works` | 13 | `adoption_repository.ex:150-176` + WorkService | 10/13 填；骨架三字段 m4 全 NULL、m4b 才首次有值；`status` 恒 TENTATIVE | 全字段读 | 退化 | GAP-01/08 |
| `volumes` | 3 | 唯一 `adoption_repository.ex:695` | **三库均 1 行，title 恒「第一卷」** | TOC/计数 | **退化** | **GAP-07** |
| `chapters` | 5 | `:701` + `:528` | 105/105 有 summary 与 plan_direction，九字段全非空 | 富读 5 处 | **健康** | GAP-03 已关闭 |
| `scenes` | 3 | `:707`，title 只有章标题或 `场景 N` | 179 行；162 个叫「场景 N」；**schema 零 craft 字段** | 只读 id/title/seq | **退化** | **GAP-04** |
| `drafts` | 3 | `:713` | 179 行全 ACCEPTED，`revision` distinct=1 | 阅读/导出 | 健康（revision 退化） | — |
| `characters` | 8 | `:229` + `assumption_repo.ex:45` | dogfood=0 行 / m4=1 / m4b=4（全同名）；**role、aliases 三库 100% NULL** | 弧光维护读 aliases（值恒空） | **退化** | GAP-08 / AU12 |
| `chapter_summaries` | 4 | ChapterSummaryRepo | 179 行，refs 全非空 | 五本账/上下文 | 健康 | — |
| `memory_items` | 23 | `:283` | **type 11 枚举只用 1 个**；三个归属列全 NULL；权重/时效族全默认 | 只读 content/type/status | **退化** | 未登记 |
| `mutations` | 11 | 唯一 `:54`+`:268`，三字段硬编码 | **type/status/actor 各 distinct=1** | **生产零消费** | **退化（严重）** | 未登记 |
| `interactions` | 11 | `memory_log.ex:16` | **6 个语义字段冻结在默认值** | 只按 session+时间读 | **退化** | 未登记 |
| `ledger_entries` | 11 | 五本账全有写路径 | 见 §3.9；**design_ref 三库 100% NULL** | 三处全读 | **退化 + 子账空转** | GAP-05 |
| `reconciliation_reports` | 4 | ReconciliationReportRepo | 15 行，findings 富 | 裁决面 | 健康 | GAP-06 |
| `decision_traces` | 15 | `trace_writer.ex` | 397 行，绝大多数列富；`context_refs` 100% NULL | 重放/审读 | 健康（单点空转） | — |
| `agent_runs` | 18 | `agent_run_service.ex` | 225 行；`long_run_task_ref`/`failure_ref`/`trigger` 全 NULL | 面板 | 退化（轻） | 未登记 |
| `long_run_tasks` | 26 | `task_runner.ex` | 2 行；**26 字段写 8 个** | 恢复路径 | **退化（严重）** | 未登记 |
| `work_sessions` | 6 | WorkSessionRepo | **三库均 1 行，title 恒「默认会话」** | 会话面板 | 退化 | 未登记 |
| `author_action_receipts` | 5 | Repo | 209 行全填 | 幂等 | 健康 | — |
| `workspaces` | 2 | **生产零写入点** | **三库 0 行** | 查询恒 miss | **空转** | 未登记 |
| `versions` | 5 | **零写入点**（paper_trail 装了没挂 Repo） | **三库 0 行** | 无 | **空转** | 未登记 |
| `agent_events` 等 5 张流水 | — | AgentRunLog/ProviderRunLog | 行数正常 | 重放取证 | 不适用 | — |
| `prose_search_index*` | — | ProseSearchRepo | **0 行**（索引从未建过） | 检索 | 不适用但**未启用** | — |

## 3. 详述（择要）

### 3.1 `workspaces` — 整表空转（缺写入）

`%Workspace{}` / `Workspace.changeset` 在 `apps` 下 9 处命中**全部在测试目录**。
生产链路里 `workspace_id` 直接被赋成 `work_id`（m4 实测 `interactions.workspace_id`
= `works.id`）。**这个命名已经在全树造成语义混淆**，是排查负担而非能力。

### 3.2 `versions` — 依赖装了没接线

`apps/novel_persistence/mix.exs:48` 有 `{:paper_trail, "~> 1.1"}`，但 `apps/*/lib`
里 `PaperTrail` 零命中——Repo 未挂，`Repo.insert` 走原生路径。审计/版本回溯能力
名存实亡。

### 3.3 `volumes` — 单一占位（代码注释自陈根因）

`find_or_create_volume/2` 只按 `work_id` 取 seq 最小的卷，取不到就建默认卷；
两个调用点都只传 `work_id`，**没有任何调用方能指定卷**。注释自陈：「计划是扁平章
列表，无卷分组…故用单一默认卷承载」。

### 3.4 `scenes` — 双缺（NEM-GAP-04 坐实）

schema 字段全集 = `work_id/chapter_id/title/seq/status`，**E23-E30 的场级 craft
字段在 schema 层根本不存在**，无迁移曾添加。且场景是正文采纳的**副产物**——
`materialize_chapter_structure` 只建卷和章，从不建场景。既没有字段可写，也没有
规划路径去写。

### 3.5 `characters` — 只填 4/8 字段 + 同名重复堆积

两条写入路径的字段白名单都很窄，`role` 与 `aliases` 无任何生产写入点。这直接
打断消费侧：`ledger_maintenance.ex:132` 的 `names = [name | aliases]` 别名匹配
永远退化成单名匹配。m4b 4 行角色全叫「沈洛」，弧光账因此得到 4 条**同一人的
重复 arc 条目**——AU12 身份归并未做的直接后果。

**这条最值得注意**：它说明**只补 roster 不做归并，会把空转换成噪声**。

### 3.6 `mutations` — 11 字段 6 阶段退化为 1 类型 1 状态

`mutation_type`/`authority_scope`/`requires_adoption` 全是硬编码字面量，写完立刻
置 APPLIED，五个中间状态标本零出现。`MutationLog` 五个函数生产零调用。
07-consistency §7.1/§7.2 的 mutation 对象 + 6 阶段机制，产品里只落成了「采纳流水」。

### 3.9 `ledger_entries` — 五本账只跑起三本，且 98% 是情绪曲线

| 库 | arc | conflict | information | emotion_curve | promise |
|---|---|---|---|---|---|
| dogfood-db (100ch) | 0 | 1 | 2 | 100 | 1 |
| m4 (105ch) | **0** | 1 | **0** | 105 | 1 |
| m4b (12ch) | 4（同一人重复） | 1 | **0** | 12 | 1 |

`arc` 为 0 的机制：arc 条目的 `subject_ref = character[:id]`，roster 空则一条不产
——这正是 VS-00G「弧光账无主体」的机制级实证。`conflict`/`promise` 恒 1 条，
是全书级单条，不随章增长。`design_ref` 三库 100% NULL（账本与设计态从不挂钩，
三态对账缺半条腿）。

## 4. 根因分组（四组，各自一把刀）

| 组 | 命中 | 要修的话是一把什么刀 |
|---|---|---|
| **R1 规划层不产结构化事实** | `volumes`、`scenes`、`ledger_entries.arc` | 让 planner/维护层产出卷分组、场级切分、角色主体，并给物化函数开接收参数的口子 |
| **R2 自由创作只产两种 artifact** | `mutations`、`memory_items.type/scope/tags`、`characters` 字段窄 | 创作产物品类扩面：主循环常态产出 foreshadowing/world_rule/character/constraint seed。**类型分派表本来就是全的，10 个分支等不到输入** |
| **R3 设计留位、消费面从未接线** | `interactions` 分层、`mutations` 状态机、`long_run_tasks` 18 字段、`agent_runs.trigger`、`decision_traces.context_refs`、`ledger_entries.design_ref` | **先砍后补**：逐字段裁决「接线 or 删列」，别让 schema 继续假装有能力 |
| **R4 整表从未接线** | `workspaces`、`versions`、`prose_search_index` | 死表清算：要么接上，要么下迁移删掉 |

R1 与 R2 **不能合并成一把刀**——前者是"规划产出的形状"，后者是"创作产出的品类"，
改动面和消费者都不同。

## 5. 「规划层结构化生产」刀的候选（按承重排序，待拍板）

1. **卷结构（`volumes`）** — 承重最高。唯一一个"一改就同时解锁 TOC 分层、
   `memory_items.volume_id` 归属、卷级蓝图（GAP-07）"的点，且 B11「章全挂第一卷」
   已是用户可见缺陷。
2. **角色主体（`characters`）** — 次高，**但必须连 AU12 身份归并一起做**。
   m4b 已证明「有 roster 就有 arc 条目」，但同名重复会让 arc 账立刻变成 4 条重复行。
   补 `role`/`aliases` 写入是必要子项（别名匹配在等它）。
3. **场级 craft（`scenes`，GAP-04）** — 第三。需先加 schema 字段。承重低于前两者，
   但**结构化数据其实已经在提示词里**（`plan_direction.word_count_and_scenes` 已写
   「两场（对账/夜巡）」），只差落库，实施成本可能低于直觉。
4. **`information` 账 + `ledger_entries.design_ref`** — 第四。五本账里唯一常态零行
   的一本；design_ref 全 NULL 意味着三态对账缺半条腿。
5. **（不建议进这把刀）`memory_items` 类型维度** — 属于 R2，靠扩 artifact 品类解决，
   塞进来会稀释焦点。

## 6. 未证实事项（诚实登记）

- `works.status` 三库恒 TENTATIVE、`adopted_at` 恒 NULL；`Work.adopt_changeset/1`
  存在但未追查生产调用点——不排除「作品采纳」在狗粮流程里本就不该发生。
- `drafts.revision` distinct=1 是否为设计意图（append 模式每次新建场景，版本链天然
  不累积），未与契约核对。
- `chapters.status` 恒 DRAFTING（COMPLETED 从未到达）的写入路径未逐条排查。
