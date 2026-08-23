# WR01b 写前推理层第二期：本章使命落章计划 + 作者裁决 + 探索可达

- 状态：done（2026-08-24）
- 类型：Reasoning Slice（WR01 续篇；暂定机制从角色泛化到章）
- 启动日期：2026-08-22
- 前置：`WR01-chapter-mission-pre-writing-reasoning.md`（done，使命随 run 消失）

## 1. 用户 / 系统目标

第一期的使命只活在一次 run 里。第二期让它**落在章计划上**：作者能在作品档案里看到每章的
使命（暂定 / 已确认 / 作者改写），一键确认、就地改写、或作废；作者定过的使命下次写这章时
**直接用、不再让模型推**；AI 探索工具 `chapter_read` 能读到它；「为什么」面板显示这一章
是按什么使命写的。

完整闭环：

```text
正文 run 推理步 → 使命存 chapters.plan_direction["chapter_mission"]（status=TENTATIVE，零新表零新列）
→ 档案「大纲与结构」逐章显示使命与状态 → 作者 确认 / 改写 / 作废（author_action，S8 决策面）
→ 下次写这章：作者版在场 → 推理步 0 调用直取作者版进简报；否则照一期推导并覆盖旧暂定
→ chapter_read 探索渲染「本章使命（状态）」 → 为什么面板「本章使命：…」
```

## 2. 开工检查（七问）

- **Contract**：VS-00E §16.8（二期：持久位、状态机、作者版优先、裁决动作）；ADR-0024 决策面
  注册表增 **S8 本章使命裁决**（`confirm_chapter_mission` / `rewrite_chapter_mission` /
  `discard_chapter_mission`，渲染责任=档案大纲 tab）；43 §5.0.3；枚举 SSOT
  `docs/design/schemas/foundation/enums/chapter_mission_status.json`
  （TENTATIVE / CONFIRMED / AUTHOR_EDITED，作废=删键）。
- **Invariant**：
  - I-M6 作者版不被覆盖：status ∈ {CONFIRMED, AUTHOR_EDITED} 时推理步不写、不改、不再调模型；
    只有作废后才重新推导。
  - I-M7 使命仍是设计态：只进 `plan_direction`，不进 memory / ledger / 正文；
    `production_write_performed=false`；暂定写入与 AU-14 暂定设定同款（系统可写暂定、
    转正只经作者动作）。
  - I-M2/I-M3/I-M4 沿用一期（依据绑定、叙事只来自模型、降级不拦稿）。
  - 探索面同步律：使命落库同批 `chapter_read` 可读。
- **Boundary**：`novel_foundation`（codegen 枚举）、`novel_domain`（`ChapterPlanDirection.chapter_mission`
  透传、`ChapterMission` 状态/来源）、`novel_persistence`（`ChapterMissionRepo` 读写 plan_direction
  键，零 migration）、`novel_application`（flow 作者版优先 + 暂定写入端口、裁决用例、`chapter_read`、
  trace 语句）、`novel_web`（三个 author_action 分支）、`frontend`（大纲 tab 使命块 + 编辑态、
  why 面板一行、TOC 类型）。
- **Consumer**：① 档案大纲 tab（作者）；② 推理步（作者版优先）；③ `chapter_read`（AI 探索）；
  ④ why 面板。
- **Proof**：domain/persistence/application/web 单测；flow 测试「作者版在场 → 0 调用」；
  真实 Tauri `wr01-chapter-mission-author-decision`。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh wr01-chapter-mission-author-decision`：
  seed 同 WR01 → 写第 03 章（推导并存暂定）→ 档案大纲 tab 第 03 章出现【暂定】使命 → 作者
  点「改写使命」就地编辑并保存 → 回执 AUTHOR_EDITED、面板显示【作者改写】→ 再写第 03 章
  → app-log `chapter_mission.derived.done` `source=author provider_call_count=0`、简报
  `brief_source` 含 `chapter_mission` 且 `chapter_mission_ref` = 作者版 id → 正文仍 tentative。
  产品代码零验收感知逻辑。
- **Exploration**：`chapter_read` 新增「本章使命（状态）：一句话；必须推进…；不得…」段，
  单测覆盖。

## 3. 用户拍板（2026-08-22）

| 问题 | 裁决 |
|---|---|
| 作者在哪裁决 | 档案「大纲与结构」逐章（确认 / 改写 / 作废），暂定设定同款 |
| 作者版下次怎么用 | 直接用作者版，不再让模型推（0 调用） |
| 暂定何时存 | 推理完成即存暂定；同章作者版不覆盖；新暂定覆盖旧暂定 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 枚举 SSOT + codegen；`ChapterPlanDirection` 透传 `chapter_mission`；`ChapterMission` 状态/来源 | done | `chapter_mission_status.json` → ex/ts 双端生成；`ChapterPlanDirection.chapter_mission` 往返透传 + `design_empty?/carry_mission`（大纲重物化只补缺失方向并带回使命）；`ChapterMission` `status/source`、`author_version?`、`as_tentative`、`from_author`、`persisted_map`，作者版 prompt 标「作者已定」；domain 单测 3 例 |
| T2 | `ChapterMissionRepo`（put_tentative / confirm / rewrite / discard / get） | done | 零 migration；作者版在场 `put_tentative` 返回 `:author_version_kept`；confirm 只接受暂定；rewrite 换 `cm_author_*` id；discard 删键；persistence 单测 3 例（含重物化带回使命） |
| T3 | flow：作者版优先（0 调用）+ 暂定写入端口；trace 语句；`chapter_read` 渲染 | done | `execute_mission_decision_step` 先查目标章 `plan_direction.chapter_mission`：作者版→`mission_author_success`（0 调用、不发 mission_derived、日志 `source=author`）；否则推导后 `persist_tentative_mission`（`persistence_chapter_mission_writer/0`，日志 `persisted=stored|author_version_kept|skipped|failed:*`）；`trace_summary.chapter_mission_statement`；`chapter_read`「本章使命：…（暂定/作者已确认/作者改写）」；flow 新测 1 + 主测试断落库 + 探索测试扩 |
| T4 | web：三个 author_action + `ChapterMissionDecisionService` | done | `confirm/rewrite/discard_chapter_mission`（payload `chapter_ref`；rewrite 带 statement/must_advance/must_avoid，行列表或多行字符串皆可）；回执 `mission_status` + `mission`；channel 单测 1 例（TOC 带使命→确认→改写→作废→删键） |
| T5 | frontend：大纲 tab 使命块（状态/三动作/就地编辑）+ TOC 类型 + why 面板一行 | done | `StructurePanel` `renderChapterMission`（徽标【暂定】/【已确认】/【作者改写】、条目带依据、确认使命/改写使命/作废使命、就地编辑三 textarea + 保存改写/取消，成功后重读 TOC）；`socket.ts` `TocChapter.plan_direction.chapter_mission`；`copy.ts` `chapterMission` 块 + `TRACE.chapterMission`；`traceSummaryView` 「本章使命：…」；typecheck/lint/440 tests 绿 |
| T6 | 契约/文档：VS-00E §16.8、ADR-0024 S8、43 §5.0.3 | done | 三处已落；`docs/design/schemas/README.md` 登记枚举 |
| T7 | 测试 + 真实 Tauri 场景 | done | manifest `wr01-chapter-mission-author-decision.yml`、driver `driveWr01ChapterMissionAuthorDecision`、verifier 取证/行为 + 单测、`tauri_slice_verify.sh` 登记；真实页面运行结果见 §7 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收（2026-08-24 `tauri_slice_verify.sh wr01-chapter-mission-author-decision` PASS，见 §7）
- [x] 后端 / Agent / Application / Web 局部验证（全量 1450 tests 0 failures）
- [x] I3 / I1 / I2
- [x] `mix compile --warnings-as-errors && mix test`；xref；arch_check
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`（440 tests）
- [x] `bash scripts/quality_manifest_check.sh`；`bash scripts/ai_static_scan.sh --top 10`（经 `task_done.sh --slice` 统一收尾）

## 6. 决策日志

- 2026-08-22 — 作废=删除 `plan_direction["chapter_mission"]` 键而非 DISCARDED 态：作废的语义
  是「让模型下次重推」，留一个 DISCARDED 态只会让推理步多一个分支且档案里多一行噪声。
- 2026-08-22 — 作者版优先时不发 `mission_derived` 叙事事件（没有模型原话可绑，N-NARR 不许
  app 造句）；只发开发者观察 + 业务日志 `source=author`，简报照常带使命并标「作者已定」。
- 2026-08-22 — 裁决动作文案用「确认使命 / 改写使命 / 作废使命」，与暂定设定的「确认 / 否决」
  区分，避免同一面板内两组同名按钮。

## 7. 试行反馈

- 2026-08-24 — 真实 Tauri 首跑 PASS（`artifacts/slice-verify/wr01-chapter-mission-author-decision-tauri/`）：
  第一次写第 03 章 → `chapter_mission.derived.done source=model persisted=stored` → 档案大纲 tab
  第 03 章卡片出现「【暂定】本章使命」+ 两条必须推进（带依据）+ 确认使命/改写使命/作废使命 →
  点改写，三个 textarea 就地编辑，保存 → `rewrite_chapter_mission` 回执 `AUTHOR_EDITED`、面板重读
  TOC 显示「【作者改写】」与作者原话 → 第二次写第 03 章 → `source=author provider_call_count=0`、
  无 `mission_derived` 事件、简报 `brief_source` 含 `chapter_mission` 且 `chapter_mission_ref`=
  作者版 id、trace 带作者原话 → 两次正文均 tentative、零写入。9 条行为断言全中。
- 截图核对：暂定态卡片徽标/条目/三按钮与 43 §5.0.3 一致；改写后徽标切换、作者原话在场。
- 观察：作者版下次写作时推理区没有「本章使命」段落（没有模型原话可绑，N-NARR 不许 app 造句）
  ——作者在档案里刚改过，这是可接受的；若将来要在对话区提示「本章按你定的使命写」，应走
  结构状态行（app copy）而非叙事段。
- 真实模型侧未验（M5 狗粮）：模型在作者版存在时是否仍"想推理"——不存在该路径（0 调用），
  无需观察；要观察的是模型版暂定被作者改写的频率（改写率 = 推理质量的反向指标）。
