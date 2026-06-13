# P1 Word Count Audit / 10 万字最小长篇正文有效字数审计

- 状态：checkpoint A 已闭环（2026-05-31，确定性 Tauri 通过）；B/C 未做
- 类型：Product Slice / Novel Output Milestone P1
- 来源：`docs/product/novel-output-milestones.md` §2 统计口径、§3 阶段目标、§4.1 数量标准、§5 P1 Done、§7 #4、§8 验收产物；`docs/product/user-journeys.md` Journey D7 / G / J；`tasks/slices/P1-chapter-adoption-reading.md`「后续 checkpoint（未做）」。
- 当前目标：在已采纳正文进入阅读投影并显示有效字数之后，补齐**确定性审计层**——把"哪些章是空章 / 短章 / 达标"和"是否达到 P1 门槛（单章≥1000、总≥100,000）"算出来，并让真实工作台的阅读消费者（ReadingMode）看得到，不达标的章节有明确标记。

---

## 1. 产品目标

P1 已经能：生成章节计划 → 生成正文草稿 → 采纳进入作品事实 → ReadingMode 阅读 → 显示有效字数（`ProseWordCount` + reading projection）。

但「显示字数」不等于「能验收质量」。`docs/product/novel-output-milestones.md` §4.1 要求：总字数达标、单章达标、缺章率 0、空章/重复章 0。本 slice 把这些标准从"验收文档里的口径"变成"产品里可见的审计结果"：

- 每章被判定为 空章 / 短章 / 达标。
- 作品被判定为是否达到 P1 门槛。
- 阅读消费者对短章/空章给出可见标记，而不是只显示一个字数数字让作者自己心算。

口径冻结于 milestones §2/§3，统计必须确定性，禁止 LLM 自报（沿用 `ProseWordCount` 已有约束）。

---

## 2. 开工检查（承重 slice 6 项）

- **Contract**：消费 milestones §3 阈值（P1：单章≥1,000、总≥100,000）冻结为 `NovelDomain.NovelMilestone`；新增 `NovelDomain.ProseAudit` 章节/作品审计结果结构；reading projection toc 的 `volumes[].chapters[]` 新增 `audit_status`，toc 顶层新增 `audit` 汇总；前端 `TocData` 对应扩展。沿用 `ProseWordCount.count/1` 口径不变。
- **Invariant**：审计只针对**已采纳正文有效字数**（与现有 `word_count` 同源，每场景取最新版本、tentative/章节计划/摘要不计入）；判定确定性、可复算、禁 LLM 自报；新增字段只增不破坏现有 toc 形状（向后兼容）。
- **Boundary**：切过 `novel_domain`（纯函数判定）→ `novel_persistence`（reading projection 聚合附审计）→ `novel_application`（DTO）→ `novel_web`（Channel `get_toc` payload）→ frontend（ReadingMode 标记/达标进度）。**不修改** `novel_agent`；不让前端自行计算字数或门槛（判定 SSOT 在后端 domain）。
- **Consumer**：第一真实消费者 = **ReadingMode**（真实产品入口 `App.tsx → ReadingMode`）：目录章节项对空章/短章显示标记；顶栏显示 P1 达标进度。`WorkArchive` 统计区同口径为后续 checkpoint，不在本次。
- **Proof**：domain 单测（章节状态 + 作品汇总 + 边界）、persistence toc 审计回归、channel `get_toc` payload 回归、前端 `readingProjection`/`ReadingMode` 组件测试；外部 Tauri 自动化驱动真实页面。
- **Acceptance Driver**：`bash scripts/tauri_slice_verify.sh p1-word-count-audit`，外部 Playwright 操作真实工作台：生成一段 <1000 字的正文草稿 → 采纳 → 打开 ReadingMode → 断言目录该章显示「短章」标记、顶栏显示 P1 未达标进度。产品代码**不新增任何验收感知逻辑**（标记由真实 `audit_status` 驱动，是真实产品能力）。验收产物 `artifacts/novel-output/p1-word-count-audit/word-count.json` 由外部 verifier 输出，不进生产路径。

---

## 3. 完整范围与 checkpoint 划分

本 slice 的**完整验收范围**（milestones §4.1 / §5 / §8）：

1. 空章（有效字数 = 0）检测
2. 短章（有效字数 < 阶段下限）检测
3. 单章门槛 + 总字数门槛判定（P1：≥1,000 / ≥100,000）
4. 重复段落 / 重复章检测
5. 缺章率检测
6. `artifacts/novel-output/<milestone-id>/word-count.json` 验收产物

**checkpoint A（本次）**：覆盖 1 / 2 / 3，并由 ReadingMode 真实消费 + Tauri 场景化验收；word-count.json 产物由 verifier 先产出基础版（总字数、各章字数与状态、是否达标）。

**checkpoint B（slice 内下一步，非范围外）**：4 重复段落/重复章检测（确定性段落比对）。

**checkpoint C（slice 内下一步，非范围外）**：5 缺章率（依赖章节计划 seq 与已采纳章节比对）+ word-count.json 补全缺章/重复维度。

> 说明：4/5/6 是本 slice 计划内后果，未在 checkpoint A 覆盖只表示"下一 checkpoint"，不是"范围外"。导出（P1-export-minimum）与 10 万字狗粮（P1-100k-dogfood-run）是 milestones §7 的**独立后续 slice**，不属本 slice。

---

## 4. 最小闭环（checkpoint A）

```text
已采纳若干章正文（含至少一章 <1000 字）
→ ReadingProjectionRepo.toc 计算每章有效字数
→ NovelDomain.ProseAudit 判定每章 empty/short/ok + 作品汇总 + 是否达 P1 门槛
→ DTO / Channel get_toc 透传 audit
→ ReadingMode 目录对短章/空章显示标记，顶栏显示 P1 达标进度
→ 外部 Tauri 驱动真实页面断言标记与进度可见
```

---

## 5. 非目标

- 不做重复段落检测（checkpoint B）。
- 不做缺章率（checkpoint C）。
- 不做全书导出（P1-export-minimum，独立 slice）。
- 不做 10 万字真实产出（P1-100k-dogfood-run，独立 slice）。
- 不让前端计算门槛或字数；判定 SSOT 在 domain。
- 不修改 `ProseWordCount` 的字数口径。

---

## 6. 进度

### checkpoint A — 空章/短章/门槛判定 + ReadingMode 消费（已闭环，2026-05-31，确定性 Tauri 通过）

- **domain**：`NovelDomain.NovelMilestone`（冻结 milestones §3 四阶段阈值，P1=单章≥1000/总≥100000）+ `NovelDomain.ProseAudit`（`chapter_status/2` 判定 empty/short/ok，`summarize/2` 作品汇总 + `meets_threshold`）。13 单测。
- **persistence**：`ReadingProjectionRepo.toc` 复用 `ProseAudit.summarize` 算作品 audit，`annotate_audit_status` 给每章附 `audit_status`；新增字段不破坏现有 toc 形状。3 回归测试。
- **application/channel**：`ReadingProjectionService.toc` DTO 带 audit；`get_toc` payload 透传 + 日志加 audit 摘要；channel 回归断言 lobby audit 透传（stage/min/target/meets_threshold）。
- **frontend**：`socket.ts` 加 `WorkAudit`/`ChapterAuditStatus`；`readingProjection.ts` 归一 audit + 章节 status（旧 payload 缺省安全）；`ReadingMode` 目录短章/空章标记 + 顶栏 P1 达标进度；`copy.ts` 集中文案；4 个 readingProjection 单测。
- **门禁**：后端 631 测试 0 failures、xref 无循环、arch、I1/I2/I3、credo 0 issues；前端 typecheck/lint/test(176)、frontend_audit(exit 0)、design_trace 100%。本次引入的唯一 touched-file finding（credo nesting at reading_projection_repo.ex）已修。
- **外部 Tauri 验收（确定性 provider）通过**：`bash scripts/tauri_slice_verify.sh p1-word-count-audit`。真实工作台生成并采纳一个 168 字（<1000）短章 → ReadingMode 目录标「短章」、顶栏显示「P1 进度 168 / 100,000 字」非「已达 P1 目标」。证据 `artifacts/slice-verify/p1-word-count-audit-tauri/summary.json`（`short_chapter_marked=true`、`milestone_met=false`、11 条 assertions 含 `sub_1000_word_chapter_marked_short_in_toc` / `p1_milestone_progress_visible_not_met`）+ 产物 `artifacts/novel-output/p1-word-count-audit/word-count.json`。

### checkpoint B / C（未做，slice 内后续，非范围外）

- **B**：重复段落 / 重复章检测（确定性段落比对）。
- **C**：缺章率（章节计划 seq 与已采纳章节比对）+ word-count.json 补全缺章/重复维度。
- 独立后续 slice（非本 slice）：P1-export-minimum、P1-100k-dogfood-run。

---

## 7. 已知设计债（review 发现，按"质量放后"暂挂）

依据 v3 复用边界（`engineering/quality-gates.md` §4 + `engineering/architecture-guardrails.md` line 38 显式复用 v2 `31-novel-quality-gates.md` + ADR-0012）做的对齐 review，本 checkpoint 有三处与 v3/v2 设计的偏差，经用户决策「质量放后面」暂挂，不在当前阶段重构：

- **F1（语义归属，中）**：短章/空章/字数门槛在设计上属「小说质量门禁」（v2 31 `serialization_retention`/`pacing` → `quality_finding`，ADR-0012 投影到 `warning_card`）。当前实现为 reading projection 派生字段（`audit`/`audit_status`）+ ReadingMode 内联 badge，违反 `v3-quality-gates` §4.3「质量发现不能直接…刷新阅读投影」的分离原则。后果：`audit_status` 无 severity/action/can_override，进不了 adoption risk、不能 BLOCK/CONFIRM。未来若需"短章提示补写 / 阻断低质量章采纳"，应收敛到 `quality_finding` + policy + `warning_card`，从 reading projection 解耦。**当前合规依据**：`v3-quality-gates` §4.2 明确首批不要求完整运行质量门、line 200「完整质量门禁后续 creative quality slice 逐步进入」，故 P1 展示型审计可接受。
- **F2（阶段硬编码，低）**：`ReadingProjectionRepo` 的 `@audit_stage :p1` 写死。阶段应来自 work 级目标里程碑配置（v2 31 §7 阶段默认门禁 + milestones §3 分阶段阈值）。P2+ work 会用 P1 阈值（1000）错判。当前只有 P1，暂可接受。
- **F3（read model 偏离，低）**：既有 reading projection toc 实现（非本次引入）未遵循 v2 ADR-0009 最小字段集（无 `source_revision_refs`/`projection_status`/`toc_id`）；v3 ADR-0016 又「不冻结最终 projection read model」。故加 audit 字段不违反任何已冻结契约，但若未来对齐 ADR-0009 / 冻结 projection read model，audit 字段应一并纳入设计。
