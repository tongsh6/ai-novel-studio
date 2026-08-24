# CA04 携带缺口收口：G1 正文带全书进度 / G2 规划带作品事实与风格 / G3 世界观带阵容

- 状态：done（2026-08-24）
- 类型：Carry Slice（CA03 缺口清单的拍板执行；VS-00C §3.5 I12「改门=改行为」流程首用）
- 启动日期：2026-08-24
- 前置：`CA03-carry-selection-registry.md`（done，登记表与三分日志）；缺口 G1-G5 见其 §3.1。

## 1. 用户拍板（2026-08-24）

| 缺口 | 裁决 |
|---|---|
| G1 正文路径无全书骨架/收官守则 | **修**：写章 prompt 带目标体量+进度+收官守则（骨架未立诚实缺席；分卷守则是规划专用指令，不进正文） |
| G2 规划路径无作品事实/风格段 | **修**：规划 prompt 带已确认事实四组+风格段（规划 flow 补传 memory 读端口） |
| G3 world_building 无阵容 | **修**：登记表 character_roster 行加 world_building（生成端不再盲于现有角色） |
| G4 设计/演化带进度态 | 缓，留登记表（等狗粮观察拉动） |
| G5 缺席守则扩能力 | 缓，留登记表（VS-00G 领域工作，等拉动） |

## 2. 开工检查（七问）

- **Contract**：VS-00C §3.5 登记表三行变更（work_skeleton +prose / creative_facts+style_guide
  +plot / character_roster +world_building），按 I12 走拍板（§1）+ 场景化验收；WorkSkeleton
  增正文向渲染（事实+收官守则，无分卷守则）。
- **Invariant**：I-C2/I-C3 沿用（门只在登记表、三分诚实）；骨架未立/记忆为空时**诚实缺席**
  （empty，不伪造）；未拍板路径 prompt 逐字节不变（G4/G5 门不动）。
- **Boundary**：`novel_domain`（WorkSkeleton 正文向渲染）、`novel_application`（登记表三行、
  work_skeleton_section 按调用点分流、plot flow/DPS 补 memory_reader 透传）、验收 harness；
  不改 persistence/web/frontend 组件。
- **Consumer**：prose writer prompt（进度与收官守则）、plot writer prompt（事实/风格）、
  world_building prompt（阵容）；carry 日志（三行门变更可见）。
- **Proof**：TES 上下文单测（三条路径的 prompt 段在场/缺席）；carry_registry 单测门快照更新；
  全量回归；真实 Tauri `ca04-carry-gap-closure`（骨架+记忆+角色齐备的 seed，三次调用各证
  新携带 carried + 零写入）+ `ca03-carry-registry-observability` 复跑（同步更新其对新门的预期）。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh ca04-carry-gap-closure`；产品代码零验收
  感知逻辑。
- **Exploration**：不适用（携带门变更，非要素物化）。

## 3. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | WorkSkeleton 正文向渲染（无分卷守则）+ TES work_skeleton_section 分流 | done | `WorkSkeleton.render_for_prose/2`（事实+收官守则）；TES 按 `prose_writing_action?` 分流；骨架注入测试改为 5 例（prose 注入含收官守则/refute 分卷守则、未立诚实缺席、character_design 门挡） |
| T2 | 登记表三行变更 + plot flow/DPS 补 memory_reader + carry 单测更新 | done | 三行各带 CA04 注释；plot flow TES call + DPS plot planner spec 补 `memory_reader` 透传；carry 门快照与三分夹具更新；facts 测试拆「plot 注入（G2）」+「character_design 门挡」 |
| T3 | ca03 场景对新门的预期更新 | done | driver/verifier/单测/yml 四处：prose 的 work_skeleton 从 gated 改「不得 gated」（seed 未立骨架→empty）、planning 的 creative_facts 须 carried、style_guide 不得 gated |
| T4 | seed（骨架+确认记忆+角色）+ 新场景 ca04 + verifier | done | `scripts/seed_ca04_carry_gaps.exs`（骨架 140000/2卷+伏笔/风格记忆+主角+两章已写）；三次真实调用（prose/plot/world_building）各证新携带 carried + 未拍板门不变 + 零写入；manifest/driver/verifier/单测/登记四处齐 |
| T5 | VS-00C §3.5 表更新 + 全量门禁 | done | 表三行标 CA04 注记；全量门禁与双场景真实 Tauri 全绿（§4/§6）；credo 圈复杂度顶爆拆 `reader_deps/1` helper |

## 4. 验证

- [x] 外部自动化驱动真实页面的场景化验收（`ca04-carry-gap-closure` PASS + `ca03-carry-registry-observability` 复跑 PASS）
- [x] 后端局部验证（骨架注入 5 例 / 事实注入 10 例 / carry 门快照）；I3 / I1 / I2 PASS
- [x] `mix compile --warnings-as-errors && mix test`（全量 0 failures）；xref 无环；arch_check 通过
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`（443 tests）
- [x] `bash scripts/quality_manifest_check.sh`；`bash scripts/ai_static_scan.sh --top 10`（经 `task_done.sh --slice` 统一收尾）

## 5. 决策日志

- 2026-08-24 — 分卷守则不进正文：它是「规划时逐章标注所属卷」的规划指令，写章时是噪声；
  正文向渲染 = 骨架事实 + 收官守则。
- 2026-08-24 — G2 的落点是既有 creative_memory_sections 原样开门（同段同文案），不为规划
  另造事实段变体——规划与写作对「已确认事实」的口径必须同源。

## 6. 试行反馈

- 2026-08-24 — 真实 Tauri PASS（`artifacts/slice-verify/ca04-carry-gap-closure-tauri/`）：骨架
  （140000 字/2 卷）+ 确认伏笔/风格记忆 + 主角 + 两章已写的 seed 下三次真实调用——
  - prose：carried=[target_structure, character_roster, creative_facts, style_guide,
    **work_skeleton**, progress_state, execution_brief, decision_packet, dialogue_context]（G1 生效）；
  - plot：carried=[character_roster, **creative_facts**, **style_guide**, work_skeleton,
    progress_state, planning_mission, dialogue_context]（G2 生效）；
  - world_building：carried=[**character_roster**, dialogue_context]，其余 12 条全部 gated
    （G3 生效且 G4/G5 未拍板门原样，empty 为空=源都被门挡住前就没到渲染）。
  三产物 tentative 零写入；同批 `ca03-carry-registry-observability` 按新门更新预期后复跑 PASS。
- G2 的页面级效力在单测里先现形：规划 prompt 里完整出现「## 作品事实（作者已确认，写作必须
  保持一致）」四组 + 风格段，与写作侧逐字节同段——同源口径拿到了机器证据。
- credo 抓到 `do_execute_tool_step` 圈复杂度 10（memory_reader 的 `||` 顶爆）→ 拆
  `reader_deps/1` 读端口清单 helper（顺带把 6 个 reader 缺省收拢一处，新 reader 依查点更醒目）。
