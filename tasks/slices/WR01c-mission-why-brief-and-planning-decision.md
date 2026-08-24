# WR01c 写前推理层三期：why 面板完整使命 + 规划使命作者裁决

- 状态：done（2026-08-24）
- 类型：Reasoning Slice（写前推理层第四刀；WR01 §16.7 遗留「面板展示 ref 与简报」+ WR02 §16.9 遗留「规划使命落位再议」的收口）
- 启动日期：2026-08-24
- 前置：WR01（使命推导）/ WR01b（章使命裁决模板）/ WR02（规划使命推导）全 done。

## 1. 用户拍板（2026-08-24）

| 问题 | 裁决 |
|---|---|
| why 面板简报深度 | **使命完整结构**：trace_summary 增结构化使命 payload（statement+逐条+依据标签），why 弹窗新增「本章使命/本轮规划使命」区块；replay 侧同步补齐（顺手修 replay 加载成功后覆盖丢使命行的既有缺口）；场级简报不进（brief 未持久，另一刀） |
| 规划使命裁决 | **照抄 WR01b 模板**：works 加 `planning_direction` map 字段（零新表，字段阶梯）持久规划使命；档案「大纲与结构」顶部工作级块确认/改写/作废；作者版下轮规划 0 调用直取 |

## 2. 开工检查（七问）

- **Contract**：VS-00E 新增 §16.10（三期：使命可见性 + 规划使命裁决）；ADR-0024 注册表增 S9
  （规划使命裁决面）；43 §5.0.4（工作级规划使命块）；`ChapterMissionStatus` 枚举复用零新增；
  `works.planning_direction["planning_mission"]` 持久位（与 chapters.plan_direction 同构）。
- **Invariant**：I-M6 作者版不被暂定覆盖（work 级同款）；I-M1/I-M3/I-M4 沿用；trace 使命
  payload 必须 author-safe（TraceRedactor 全量过）；replay 重建的使命字段与广播一致（同源
  state_trace_refs）；未拍板路径（prose/plot prompt 本身）逐字节不变——本刀只动可见性与裁决，
  不动 prompt。
- **Boundary**：`novel_application`（TES/TraceWriter/TraceReplayService/plot flow/DPS/
  DecisionService/探索 profile facet）、`novel_persistence`（migration + Work schema +
  PlanningMissionRepo + TOC 投影顶层）、`novel_web`（channel author_action 三分支）、
  `frontend`（traceSummaryView/why 弹窗区块/StructurePanel 工作级块/copy）；不动 novel_agent/
  novel_domain 值对象（ChapterMission 复用）。
- **Consumer**：① why 弹窗（结构化使命区块，广播与 replay 双路径）；② 档案「大纲与结构」
  工作级裁决块；③ plot flow（作者版 0 调用直取）；④ archive_read profile facet（探索可达）。
- **Proof**：TES trace payload 单测 / replay 重建单测 / PlanningMissionRepo 四动作单测 /
  DecisionService 单测 / plot flow 作者版 0 调用测试 / TOC 投影含 planning_direction 测试 /
  channel 三动作测试 / verifier 单测；真实 Tauri 新场景 `wr01c-planning-mission-decision`
  （规划 run 落暂定 → 档案块可见 → 作者改写 → 再规划 log source=author、provider_call_count=0
  → why 弹窗结构化区块可见）；`wr01-chapter-mission-before-prose` 复跑（行为回归）。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh wr01c-planning-mission-decision`；
  产品代码零验收感知逻辑。
- **Exploration**：规划使命经 `get_toc` 投影进档案（工作级块）+ `archive_read` 的 `profile`
  facet 同批补渲染（判断循环内部翼可达，探索面同步律）。

## 3. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | Part A 后端：TES 使命结构化 payload → TraceWriter summary + state_trace_refs 持久 → TraceReplayService 重建（修 replay 丢行）+ 单测 | done | `mission_payload/1`（author-safe，string 键）；TraceWriter `maybe_put_mission_payloads` + `mission_state_refs`；replay `put_mission_summary` 重建三字段；replay 单测新增使命重建例 |
| T2 | Part A 前端：traceSummaryView 结构化使命 + why 弹窗区块 + copy（一句话行升区块） | done | `TraceMissionView`（label/statement/statusLabel/逐条+依据标签，旧 trace 回退一句话）；why 弹窗独立区块；`TRACE.missionSection` 文案；旧一句话行退役（无 driver 断言依赖） |
| T3 | Part B 后端：migration + Work schema + PlanningMissionRepo + DecisionService + 注入函数 + plot flow + DPS + channel + TOC + archive_read + 单测 | done | 迁移 20260824000001；repo 四动作+get_mission（I-M6 同款）；flow `author_planning_mission`（0 调用）+`persist_tentative_planning_mission`（日志 persisted=）；DPS plot spec 补两键；channel `*_planning_mission` 三分支（S9）；`get_toc` 顶层 `planning_direction`；archive_read profile「当前规划使命」行；repo 3 例/channel 1 例/flow 2 例/投影 1 例 |
| T4 | Part B 前端：TocData 类型 + StructurePanel 工作级规划使命块 + copy | done | 大纲 tab 顶部（骨架进度行前）工作级块，徽标/三动作/就地三 textarea，与章使命块同构；`STRUCTURE_PANEL.planningMission` |
| T5 | 契约与设计档：VS-00E §16.10 / ADR-0024 S9 / 43 §5.0.4 / 46 §9.2 注记 | done | 四处全落 |
| T6 | 真实 Tauri：新场景 wr01c + driver/verifier/登记 + wr01 复跑 | done | 全套 harness（driver/verifier 证据+行为/单测/yml/四处登记）；运行结果见 §6 |
| T7 | 全量门禁 + task_done + 收口 | done | 全量后端 0 failures + 前端 444 + I1/I2/I3 + xref/arch/credo；task_done 统一收尾 |

## 4. 验证

- [x] 外部自动化驱动真实页面的场景化验收（`wr01c-planning-mission-decision` PASS + `wr01-chapter-mission-before-prose` 复跑 PASS）
- [x] 后端局部验证（repo/channel/flow/replay/投影全绿）；I3 / I1 / I2 PASS
- [x] `mix compile --warnings-as-errors && mix test`（全量 0 failures）；xref 无环；arch_check 通过
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`（444 tests）
- [x] `bash scripts/quality_manifest_check.sh`；`bash scripts/ai_static_scan.sh --top 10`（经 `task_done.sh --slice` 统一收尾）

## 5. 决策日志

- 2026-08-24 — trace 使命持久位选既有 `state_trace_refs`（{:array,:map} 列，零 migration）：
  广播 summary 与 replay 重建同源一条 state ref，不加表列。
- 2026-08-24 — why 弹窗一句话行升区块后，旧 `TRACE.chapterMission` 行文案随之退役（无既有
  driver 断言该行，无迁移债）。
- 2026-08-24 — 规划使命的裁决动作命名对齐章使命家族：`confirm|rewrite|discard_planning_mission`
  （payload 无 chapter_ref，work 级）。

## 6. 试行反馈

- 2026-08-24 — 真实 Tauri PASS（`artifacts/slice-verify/wr01c-planning-mission-decision-tauri/`）：
  第一次规划 run `planning_mission.derived.done source=model persisted=stored` →
  档案「大纲与结构」顶部【暂定】工作级块（确认/改写/作废三动作在场）→ 就地改写
  `rewrite_planning_mission` 回 AUTHOR_EDITED、面板重读显【作者改写】+作者原话 →
  第二次规划 `source=author provider_call_count=0 persisted=author_version`、零 mission_derived
  事件、prompt 带「本轮规划使命（作者已定）」→ **why 弹窗结构化区块**（标签+状态+一句使命+
  逐条依据）页面可见；两次大纲草稿全程 tentative 零写入。同批 `wr01-chapter-mission-before-prose`
  复跑 PASS（章使命链行为回归干净）。
- why 弹窗首次进入场景化验收（此前 trace 有 ref、UI 零展示）：驱动方式=点真实「为什么」按钮断言
  区块文本，零验收钩子。
- replay 丢使命行的既有缺口顺手修复并有单测钉住（state_trace_refs 同源重建）。
- 坑：作者版 prompt 渲染是「本轮规划使命（作者已定）：…」（后缀挂标签不挂句尾），断言要对齐
  `to_prompt_lines` 真实输出。
