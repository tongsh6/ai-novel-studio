# B25-chapter-identity-unification：章节身份统一（写入/采纳/阅读/探索链一律 `chapter_ref = chapter:<chapters.id>`）

**状态**：**registered（2026-10-23，由 B24 收口时作者点名「章节名会重复，不能当身份」转出的 follow-up；本批只定 slice 契约与路线，未编码）**。
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
| **CP0 契约冻结** | 章节身份/`seq`/`title` 三层语义；仓库端口签名改为 `chapter_ref`（或 `ChapterIdentity` 值对象）；ADR/契约注记（B24 §1.1 扩展、VS-00J 注记）；**历史数据审计口径**（重复 title/seq 清单） | 契约文档 + `adr_trace` + 只读审计报告 | registered |
| **CP1 仓储层 ref 化** | AdoptionRepository（find_or_create/ensure_planned/has_accepted/next_seq 并发安全）、ReadingProjectionRepo（accepted_chapter_prose by ref）、ChapterMissionRepo（id 为主）单点收口；title 只做「唯一命中兼容」并返回歧义错误 | 仓储层单测矩阵（同名不合并/歧义拒绝/按 ref 写读/seq 冲突） | registered |
| **CP2 应用链 ref 化** | TurnExecutionService.resolve_target_chapter / AdoptionWorkflow / 续写前文 / 修订目标 / ChapterMission 全部走 ref；judgment/plan 上下文提供 ref（B24 已给）；执行参数不信任 title | 应用层集成测试 + flow 回归 | registered |
| **CP3 数据与约束** | migration：`chapters` 唯一索引（先审计重复再上线）；重复标题/seq 历史数据修复脚本（只报告 + 显式修复，不静默合并）；回滚路径 | 迁移测试 + 审计报告（真实库/测试库） | registered |
| **CP4 真实页面闭包** | 新场景 `b25-chapter-identity-unification`（同名两章 seed + 采纳/续写/阅读/大纲断言）；B24 两场景回归；真实 Tauri PASS + artifacts | `quality_accept.sh b25-chapter-identity-unification --surface tauri` PASS | registered |
| **CP5 收口** | NEXT/journeys/ledger、B24 §6 follow-up 销账、ADR 注记；门禁全绿 | 全门禁 + task_done manifest | registered |

**依赖**：CP0 → CP1 → CP2 → CP3 → CP4 → CP5。CP1/CP2 可同批；CP3 必须在 CP4 前（唯一索引）但历史数据修复可与 CP4 并行。

## 3. 不做 / 诚实边界

- 不做「按 title 自动合并同名章」：同名是创作事实（两章可同名），身份只能靠 id/seq。
- 不做跨作品章节标题统一/规范化（title 保持作者原样）。
- 不改变 B24 读取面的预算/续读/文案合同。
- 历史 `(work_id,title)` 重复数据不静默合并；只出审计清单 + 显式修复动作（作者裁决）。

## 4. 任务清单

- [ ] CP0 契约冻结 + 历史数据审计（重复 title / seq 清单）
- [ ] CP1 仓储层 ref 化 + 单测矩阵
- [ ] CP2 应用链 ref 化 + flow 回归
- [ ] CP3 migration 唯一索引 + 历史修复脚本/回滚
- [ ] CP4 真实 Tauri 新场景 + B24 两场景回归
- [ ] CP5 台账/文档收口 + 全门禁
- [ ] `tasks/slices/README.md` / `tasks/NEXT.md` / `docs/design/adr/README.md`（如 ADR 注记）回写
