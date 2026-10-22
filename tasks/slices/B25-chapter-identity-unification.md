# B25-chapter-identity-unification：章节身份统一（写入/采纳/阅读/探索链一律 `chapter_ref = chapter:<chapters.id>`）

**状态**：**doing（2026-10-23；CP0 契约+审计、CP1 仓储层 ref 化、CP2a+CP2b 应用链 ref 贯通、CP3 seq 唯一索引迁移+显式修复脚本 已落并过全量测试；CP4 真实页面 待做）**。
**来源**：`tasks/slices/B24-exploration-chapter-full-read.md` §6 / §7（B24 只统一了**读取/探索面**的唯一寻址；写入/采纳链仍把 `(work_id, title)` 当章节身份）；`docs/project-ledger.md` B24 收口记录；`tasks/NEXT.md` B25 行。
**关联**：B24（读取面已用 ref）、B21（首次 append 场名占位）、B11A（卷/章结构）、Q1c（已采纳内容修订）、AU-05（采纳边界）。

## 0. 问题（只读核查，2026-10-23）

`chapters.id` 是 DB 唯一 UUID 主键；`chapters.seq` 只是代码意图 work 内唯一（migration 只有
`(volume_id, seq)` 普通索引，**无唯一约束**）；`chapters.title` 无唯一约束。当前仍按 title 当
章节身份的生产路径（B24 侦察清单）：

| 位置 | 现状 | 重复标题后果 |
|---|---|---|
| `NovelPersistence.AdoptionRepository.find_or_create_chapter` / `ensure_planned_chapter` | 按 `(work_id, title)` 跨卷匹配/创建 | 同名两章被合并成一行 / 正文写错章 |
| `AdoptionRepository.has_accepted_chapter?/2` | 按 title | 覆盖确认误判 |
| `ReadingProjectionRepo.accepted_chapter_prose/2` | 按 title 读前文 | 续写读错章正文 |
| `TurnExecutionService.resolve_target_chapter` | 按 title 解析目标章 | 续写/重写落错章 |
| `ChapterMissionRepo` | seq / id 混用 | 使命绑定到错误章 |
| `AdoptionRepository.next_chapter_seq` | `max(seq)+1`（无唯一约束，并发/删行可撞号） | 章号冲突 |

B24 已把**读取/探索面**统一为 `chapter_ref = "chapter:<chapters.id>"`（模型可见索引暴露 ref、
chapter_read 按 ref 分页、歧义列候选）；本 slice 把**写入/采纳/阅读/使命链**统一到同一身份。

## 1. 七问

1. **Contract**：冻结「章节身份 = `chapter_ref = "chapter:<chapters.id>"`」为唯一寻址；`seq` 是
   work 内展示序号（可冲突检测、不承担身份）；`title` 是非唯一展示文本（可重复，永不作为身份键）。
   B24 §1.1 契约扩展覆盖写入/采纳链；`VS-00J` 卷/章身份口径同步（卷身份 `(work_id,seq)` 不变）。
   **不新增 ADR**（B24 已冻结读取面；本 slice 是同一决策的写入面补齐）。
2. **Invariant**：
   - I-CH-1：任何按章节定位的读写都不得用 title 做唯一键；title 命中多于一个时必须歧义失败/列候选，禁止 first-match。
   - I-CH-2：采纳物化的 chapter 行由 ref 或机械新建（新 ref），同名章不得静默合并/覆盖。
   - I-CH-3：`chapters.seq` 在 work 内唯一（代码 + DB 唯一索引双保险；历史数据先审计再补约束）。
   - I-CH-4：作者可见面仍只用 `第 N 章「title」`，不出现 uuid/ref；内部 payload/trace 可带 ref。
3. **Boundary**：改 `novel_persistence`（AdoptionRepository / ReadingProjectionRepo / ChapterMissionRepo /
   migration 唯一索引）、`novel_application`（TurnExecutionService 目标章解析、AdoptionWorkflow 参数、
   ProseRevision/续写读前文、仓库端口签名）、`novel_domain`（章节身份值对象/纯函数，若需要）；
   **明确不改**：探索/判断面的 ref 合同（B24 已落）、采纳七态、TurnResult 形状、UI 文案结构、
   provider/prompt 资产。
4. **Consumer**：采纳 accept/edit_then_accept 的 chapter 物化；续写/重写目标章解析与前文读取；
   ChapterMission 读写；阅读投影 TOC/正文读取；档案大纲章列表（展示 seq+title，身份走 ref）。
5. **Proof**：单测矩阵（同名两章不合并、按 ref 精确写/读、title 歧义诚实失败、seq 冲突拒绝、
   历史数据审计）；**真实 Tauri 场景**（见 6）PASS；I1/I2/I3/N-NARR 不变；xref/arch/adr_trace 绿。
6. **Acceptance Driver**：外部 Tauri/Playwright driver 从真实工作台驱动——seed 两章同名标题 +
   不同正文，作者采纳/续写指定章（通过模型可见 ref 或唯一 seq），断言正文写入正确 chapter 行、
   另一同名章不变、阅读区按 ref 显示对应正文、档案大纲两行同名共存。慢改/写链证据入
   `artifacts/slice-verify/b25-chapter-identity-unification-tauri/`。**产品代码新增验收感知逻辑：no。**
7. **Exploration**：不新增要素；但「章节身份」是探索面可达对象（B24 已暴露 ref），本 slice 保证
   写入后探索面仍按同一 ref 可达（同批回归 `judgment-explore-chapter-plan` / `judgment-explore-chapter-full-read`）。

## 2. CP 路线

| CP | 内容 | 证明 | 状态 |
|---|---|---|---|
| **CP0 契约冻结** | 章节身份/`seq`/`title` 三层语义；仓库端口签名改为 `chapter_ref`（或 `ChapterIdentity` 值对象）；ADR/契约注记（B24 §1.1 扩展、VS-00J 注记）；**历史数据审计口径**（重复 title/seq 清单） | 契约文档 + `adr_trace` + 只读审计报告 | **done（2026-10-23，见 §2.1）** |
| **CP1 仓储层 ref 化** | AdoptionRepository（find_or_create/ensure_planned/has_accepted/next_seq 并发安全）、ReadingProjectionRepo（accepted_chapter_prose by ref）、ChapterMissionRepo（id 为主）单点收口；title 只做「唯一命中兼容」并返回歧义错误 | 仓储层单测矩阵（同名不合并/歧义拒绝/按 ref 写读/seq 冲突） | **done（2026-10-23，13 例：adoption_repository 7 + reading_projection 1 + domain/assembler/adoption_flow 5）** |
| **CP2 应用链 ref 化** | TurnExecutionService.resolve_target_chapter / AdoptionWorkflow / 续写前文 / 修订目标 / ChapterMission 全部走 ref；judgment/plan 上下文提供 ref（B24 已给）；执行参数不信任 title | 应用层集成测试 + flow 回归 | **doing（CP2a done：采纳 attrs ref 透传 + 覆盖判断用 ref + 前文按 ref 读；CP2b 计划 step ref 贯通待做）** |
| **CP3 数据与约束** | migration：`chapters` 唯一索引（先审计重复再上线）；重复标题/seq 历史数据修复脚本（只报告 + 显式修复，不静默合并）；回滚路径 | 迁移测试 + 审计报告（真实库/测试库） | **done（2026-10-23：唯一索引迁移 + rollback 实测 + repair 脚本双模；重复 seq DB 修复演练 90 章无损）** |
| **CP4 真实页面闭包** | 新场景 `b25-chapter-identity-unification`（同名两章 seed + 采纳/续写/阅读/大纲断言）；B24 两场景回归；真实 Tauri PASS + artifacts | `quality_accept.sh b25-chapter-identity-unification --surface tauri` PASS | registered |
| **CP5 收口** | NEXT/journeys/ledger、B24 §6 follow-up 销账、ADR 注记；门禁全绿 | 全门禁 + task_done manifest | registered |

**依赖**：CP0 → CP1 → CP2 → CP3 → CP4 → CP5。CP1/CP2 可同批；CP3 必须在 CP4 前（唯一索引）但历史数据修复可与 CP4 并行。

## 2.1 CP0 契约冻结（2026-10-23）

**章节身份三层语义（冻结）**：

| 层 | 角色 | 唯一性 | 使用边界 |
|---|---|---|---|
| `chapter_ref = "chapter:<chapters.id>"` | **唯一身份/寻址键** | DB 唯一（id 主键，work scope 校验） | 读写/采纳/续写/探索一律优先；跨改名稳定 |
| `seq` | work 内展示序号 | 代码意图 + CP3 DB 唯一索引 | 目录排序、作者可见「第 N 章」；可作 ref 的唯一命中别名，不承担全局身份 |
| `title` | 作者可见展示文本 | **不唯一**（同名是创作事实） | 只用于展示与旧 artifact 兼容；不得单独作为唯一键 |

**解析规则（冻结，禁止 first-match）**：

1. 有 `target_chapter_ref` → 按 id + work scope 精确命中；不存在/跨作品 → `{:error, {:target_chapter_not_found, ref}}`，
   **不回退 title**（回退会静默写错章）。
2. 无 ref（旧 artifact/非模型路径）→ work 内 title 精确匹配：0 行 → 机械新建章（新 ref）；1 行 → 复用；
   **>1 行 → `{:error, {:ambiguous_chapter_title, ids}}`**（诚实失败，不合并、不选第一行）。
3. 覆盖判断（`has_accepted_chapter_identity?`）：ref → 精确章；title 唯一 → 该章；**title 同名多章 → 保守返回 true**
   （视为已有 canon，要求作者确认），绝不静默覆盖。
4. 正文读前文（`accepted_chapter_prose/2`）：ref 精确读；title 唯一 → 读；**title 歧义 → 返回 ""**（不猜；
   调用方应改用 ref——生产链已优先传 resolved ref）。
5. `title` 归一（trim + 空回退「已采纳内容」）保持既有 A4 行为，仅作为 title 兼容路径的匹配口径。

**历史数据审计（CP0 只读）**：新增 [chapter_identity_audit.exs](../../scripts/chapter_identity_audit.exs)，
扫 `chapters` 的重复 `(work_id,title)` / 重复 `(work_id,seq)` / 空 title，输出
`artifacts/chapter-identity/audit.{md,json}`。当前实测：
- `artifacts/novel-output/p1-100k-dogfood/work-snapshot.sqlite3`：90 章 / 1 作品，重复 title 0、重复 seq 0、空 title 0 → **OK**；
- 结论：历史百章样本无身份冲突，可直接进入 CP3 唯一索引（迁移前对其它库仍先跑审计）。

**契约归属**：不新增 ADR（B24 已冻结读取面 ref 契约）；本 slice 的写入面扩展在本文冻结，并需在 CP5 回写
B24 slice §6 follow-up 与 `VS-00J` 卷/章身份注记。

## 2.2 CP1/CP2a 实现记录（2026-10-23）

**CP1 仓储层（`novel_persistence`）**：
- `AdoptionRepository.persist/1` 阅读投影路径新增 `target_chapter_ref` 解析：
  `resolve_chapter/5`（ref 精确 → work scope；无 ref → title 0/1/>1 语义）替代旧 `find_or_create_chapter/4`
  （旧实现按 title `limit(1)`，同名章静默 first-match）。
- 新增 `has_accepted_chapter_identity?/2`（ref 或 title；同名多章保守 true）；
  旧 `has_accepted_chapter?/2` 与 `overwrite_reader/0` 改为 identity 语义（保留签名）。
- `ReadingProjectionRepo.accepted_chapter_prose/2` 接受 `chapter:<uuid>` 或 title：
  ref 精确读、title 唯一命中读、同名歧义返回 ""；设定盘点材料回退改为按 chapter id 精确读。
- 失败语义：歧义/ref 不存在以 `{:error, reason}` 返回 writer → B13b BB-7 的失败 action_result +
  `failed_recoverable` TurnResult 路径（诚实失败、零写入）。

**CP2a 应用链（`novel_application`/`novel_domain`）**：
- `TentativeArtifactSet` 新增 `target_chapter_ref` 字段（additive）；`ArtifactAssembler` 从 provenance
  透传并只接受合法 `chapter:<uuid>`；`TurnResultBuilder.unit_pending_entry/2` 把 ref 写入 pending artifact。
- `AdoptionWorkflow`：覆盖判断用 `adoption_chapter_identity/1`（ref 优先、title 回退）；持久化 attrs
  带 `target_chapter_ref`。
- `TurnExecutionService.execute/1`：目标章解析后经章节索引读端口确定性映射 ref（**唯一命中才成立**，
  同名多章 → nil 不猜）；`provenance/3` 带 ref；读前文优先用 `ref || title`（改名/同名稳定）。

**本批测试**：`adoption_repository_test` 新增 6 例（ref 精确写同名章、无 ref 歧义失败、跨作品 ref 拒绝、
title 唯一兼容、ref 读前文/歧义空、seq max+1 不复用）；`reading_projection_repo_test` 新增 1 例；
`adoption_workflow_test` 新增 1 例（writer attrs ref + 覆盖 identity 用 ref）；`creative_artifact_test`
新增 1 例（assembler 合法/非法 ref）。相关套件：persistence 294/0、application 700/0、web 130/0。

**未闭环（下一 checkpoint）**：CP2b 计划 step `target_chapter_ref` 贯通（`AgentPlan.PlanStep` /
`AgentNextStepDecision` / `MicroPlan` action / planner schema+prompt / prose flow 继承），使同名章场景
模型也能确定性续写指定章；CP3 唯一索引迁移 + 历史修复脚本；CP4 真实 Tauri 场景（同名两章 seed +
采纳/续写/阅读/大纲断言）+ B24 两场景回归；CP5 收口。

## 2.3 CP2b/CP3 实现记录（2026-10-23）

**CP2b 计划 step ref 贯通**：
- `AgentPlan.PlanStep` / `AgentNextStepDecision` / `MicroPlan` action 新增 `target_chapter_ref`（additive）
  ——domain 层用纯 UUID 形态正则校验（不引入 Ecto），非法/空 → nil。
- `AgenticPlanDraftPlanner`：tool schema 增 `target_chapter_ref`；「计划要求」两段 prompt 明确要求
  prose 步**逐字复制「作品章节」索引里的 `chapter_ref`**（同名章必须靠 ref 区分）；step 归一解析 ref。
- prose flow：`mechanical_execute_decision` / 判断②合成重试步 / `plan_from_decision` 三处把
  `target_chapter_ref` 与 title 坐标同批透传（跨偏离不丢身份）；`AgentRunServer` 计划步骤投影带 ref；
  `PendingArtifactWorkflow` 修订路径从原候选继承 ref。
- `TurnExecutionService`：新增 `@doc false resolve_target_chapter_identity/6`——action ref 优先
  （索引 title 纠正模型复制的旧标题；stale ref 保留给持久层诚实失败，不回退 title 静默写错章），
  无 ref 才按 title 唯一命中映射；读前文用 `ref || title`。

**CP3 seq 唯一约束与历史修复**：
- 迁移 `20261023000001_add_unique_chapter_seq_index`：`unique_index(:chapters, [:work_id, :seq])`
  （Ecto 默认命名，SQLite UNIQUE 错误才能转 changeset error）；`Chapter.changeset` 补
  `unique_constraint(:seq, name: :chapters_work_id_seq_index)`。
- `AdoptionRepository` 新章 seq=max+1，并发唯一冲突重试一次（仍冲突 → `{:error, {:chapter_seq_conflict, title}}`
  诚实失败，不静默换号）。
- 新增 `scripts/chapter_identity_repair.exs`：默认只读报告（重复 title/seq/空 title）；`--fix-dup-seq`
  显式修复——每 work 按 `(seq, inserted_at, id)` 稳定排序重排 1..n（事务内先负号再落位，唯一索引存在时也可执行），
  永不合并/删除/改 title。演练：90 章 dogfood 快照注入重复 seq 后修复 → 90 章无损、0 重复；rollback 实测
  `ecto.rollback` → 索引删除 → `ecto.migrate` → 索引重建。
- 既有验收夹具漂移修正：阅读投影测试链按 work 内 max+1 分配 seq（旧夹具按卷重启 seq，与 I-CH-3 冲突）；
  B24 `chapter_read` 重复 seq 歧义测试改为「CP3 后 DB 拒绝重复 seq + 唯一 seq 可读」（防御性歧义分支保留在服务层）。

**测试**：domain 3 例（PlanStep/Decision/MicroPlan ref 归一）；planner 2 例（schema/prompt + step 解析）；
`chapter_identity_resolution_test` 6 例；prose flow 2 处断言（pending artifact ref / 重试步继承）；
persistence CP3 2 例 + 阅读链夹具修正。全量后端 **1,868/0**（application 708 / persistence 295）。

## 3. 不做 / 诚实边界

- 不做「按 title 自动合并同名章」：同名是创作事实（两章可同名），身份只能靠 id/seq。
- 不做跨作品章节标题统一/规范化（title 保持作者原样）。
- 不改变 B24 读取面的预算/续读/文案合同。
- 历史 `(work_id,title)` 重复数据不静默合并；只出审计清单 + 显式修复动作（作者裁决）。

## 4. 任务清单

- [x] CP0 契约冻结 + 历史数据审计（重复 title / seq 清单）—— 2026-10-23
- [x] CP1 仓储层 ref 化 + 单测矩阵 —— 2026-10-23
- [x] CP2 应用链 ref 化 + flow 回归（CP2a+CP2b done）—— 2026-10-23
- [x] CP3 migration 唯一索引 + 历史修复脚本/回滚 —— 2026-10-23（rollback/修复演练实测）
- [ ] CP4 真实 Tauri 新场景 + B24 两场景回归
- [ ] CP5 台账/文档收口 + 全门禁
- [ ] `tasks/slices/README.md` / `tasks/NEXT.md` / `docs/design/adr/README.md`（如 ADR 注记）回写
