# B11D-QUALITY-FIELD-GRANULARITY：质量场粒度 / 多场正文

- 状态：**done（2026-10-24；CP0 裁决 + CP1 实现 + CP2 真实 Tauri 扩展 PASS；多场正文/场级替换按 CP0 默认裁决 Deferred → B28）**
- 来源：`tasks/slices/B11C-scene-craft-completion.md` §5「质量场粒度（B11D 候选）」「多场正文归 B11D/后续」；`docs/design/08-novel-element-model.md:192`
- 设计真源：`docs/design/contracts/VS-00E-prose-execution-quality-contract-pack.md` §7/§8；`docs/design/adr/ADR-0020`；`docs/design/ui/46-state-and-feedback.md` §9.8；NEM04 场次计划存储位
- 类型：承重竖切面（质量 finding 的场级归因 + 场级修订作用域）

---

## 1. 开工七问

1. **Contract**：VS-00E §7.3 `QualityFinding` 作者可见字段（含 `brief_field_refs`，示例即 `scene_1.emotion_transition`）；VS-00E §8 `revise_from_findings` 的 scope 约束只到 local/paragraph/chapter；NEM04 场次计划 = `chapters.plan_direction["scene_plans"]`（设计态），brief `scene_units.unit_id = scene_N`；TurnResult `quality_review.findings` 线格式。
2. **Invariant**：质量 finding 的**场归属只能来自真实策划场清单**（服务端按 brief `scene_N` 白名单推导，evaluator 自报场字段一律不采信、自造场 id 不归因）；场级信息只约束修订 prompt 改写范围，**候选仍是整章草稿、采纳仍整章**（不谎称只替换单场）；场字段缺失/旧调用时 wire 语义不变。
3. **Boundary**：`novel_domain`（`QualityFinding` additive `scene_index/scene_title`）；`novel_common`（`QualityEvaluationRequest` additive `scene_units`）；`novel_agent`（evaluator prompt 场清单 + 禁止发明场 id；认证/校验规则不放松 scope 枚举）；`novel_application`（`TurnExecutionService` 从 brief 取场清单并传给质量评估；`ProseQualityService` 白名单归因 + 清洗自报场字段；`ProseRevisionService` 修订 prompt 场作用域 + 原草稿按全部 items 拼接不静默丢场）；`frontend`（质量卡展示场标签/关联设计字段/诚实边界说明）；`docs/design/schemas/foundation/turn_result_v3.json` additive 字段 + codegen。**不改**采纳边界/多场正文/`scenes` 表/slice_verify 的 prose items 行为。
4. **Consumer**：真实 Tauri 工作台质量卡（`UICards.QualityReviewCard`）；`revise_from_findings` 修订 run；验收 driver/verifier。
5. **Proof**：`QualityFindingTest`（scene 字段归一/序列化）、`ProseQualityServiceTest`（brief 白名单归因/自报场字段不采信/未知场不伪造）、`ProseQualityEvaluatorTest`（prompt 含合法场清单）、`VS00ECP3ProseRevisionTest`（修订 prompt 场作用域 + 候选仍整章）、`UICards.qualityReview.test.tsx`（场标签/关联字段/边界文案）；真实 Tauri 扩展；I1/I2/I3 回归。
6. **Acceptance Driver**：外部 Playwright 驱动真实 Tauri 工作台：既有 `p1-prose-quality-finding-roundtrip`（动作章）扩展——真实生成正文 → 质量卡显示服务端归因「场 · 撤退（第 2 场）」+ 关联设计字段「第 2 场 · 情绪迁移」+ 诚实边界文案 → 勾选 finding 点「局部修订所选问题」→ 真实修订 run 产出 tentative 整章候选，修订 prompt（llm-calls 外部证据）携带「场级作用域：第 2 场（撤退）」与「其他场的正文必须逐字节保留」；零采纳事件。产品零验收感知逻辑。
7. **Exploration**：不适用（质量消费面，非要素物化）。

## 2. CP0 裁决（作者授权按审计建议默认拍板）

开工侦察（只读，2026-10-24）结论：现状质量评估章级一次、只评第一条 item；`QualityFinding` 无场身份；evaluator prompt 看得到多场 brief 但输出不落场；修订候选整章；**当前不存在一次产出多场正文路径**（真实 provider prompt 明写 items 恰好一条）；「按计划场只替换该场」缺少正文场边界数据，且与已登记 B28（整章修订/多片段覆盖/采纳身份）重叠。按「遇作者裁决点按审计建议默认拍板并登记」：

| 问题 | 默认裁决 |
|---|---|
| 「场」语义 | 采用 **规划场次（`scene_plans[i]` / brief `scene_N`）** 作为 finding 归属语义；不把 item/draft 段当规划场。 |
| 本 slice 范围 | **方案 A**：场级 finding 可定位 + 质量卡场级可见 + 场级修订指令 + 合法场白名单校验；**候选仍整章、采纳仍章级**。 |
| 「只替换该场」/多场正文 | **Deferred → B28**（已登记整章修订/多片段覆盖 slice）；B11D 不实现场级采纳事务/多 item 正文。 |
| 字段方案 | 新增 additive `scene_index`/`scene_title`（schema additive + codegen），来源由服务端从 brief `scene_N` 白名单推导；`brief_field_refs` 按真实 brief 场清单校验归因。 |
| 共享文件 | 本 slice 只改 `slice_verify.ex` 质量 findings 区段（不碰 B26 计划改的 prose items/计划区段）；driver/verifier 为既有场景扩写；若并行会话后续改同文件由对方 rebase。 |

**诚实边界（必须保持）**：质量卡明示「场级信息只约束修订范围；修订候选仍是整章草稿，采纳仍按整章生效（只替换单场归后续章修订能力）」。

## 3. CP1 实现（本 slice 主体）

**Domain / Contract**
- `NovelDomain.QualityFinding`：additive `scene_index`（pos int|nil）/`scene_title`（string|nil）；`new/1` 归一（int/数字串）、`to_map/1` 输出。
- `NovelCommon.Contracts.QualityEvaluationRequest`：additive `scene_units: [%{unit_id, scene_title}]`（默认 []，旧调用兼容）。
- `docs/design/schemas/foundation/turn_result_v3.json`：`quality_review.findings[]` additive 可选 `scene_index`/`scene_title` + `pnpm codegen:schemas` 再生成。

**Application**
- `TurnExecutionService`：从 `ProseExecutionBrief.scene_units` 提取 `%{"unit_id","scene_title"}` 清单传入质量评估 ctx 与 evaluator request；质量正文评估从「只取第一条 item」改为**全部 items 正文按 `\n\n` 拼接**（单 item 逐字节不变；顺带消除多 item 时其余场不参与评估的缺口）。
- `ProseQualityService`：质量 finding 先**清空 evaluator 自报场字段**（不采信），再按（a）多 item 场边界偏移（未来兼容）与（b）brief `scene_N` 白名单归因；自造/未知场 id 不产归因。
- `ProseAgent.ProseQualityEvaluator`：prompt 增加「本章计划场次（合法 unit_id 清单）」段，要求 finding 指向具体场时在 `brief_field_refs` 用合法 `scene_N` 前缀、禁止发明场 id；不放松 finding 校验（scope 枚举不变）。
- `ProseRevisionService`：所选 finding 的场归属进入修订指令（`场：第 N 场（title）`）与修订范围（`场级作用域：…；其他场正文必须逐字节保留`）；原草稿按全部 items 拼接（不再静默丢场）；修订 provenance 补 `target_chapter_ref`（B25 漏点顺带修复，不扩范围）。
- 候选仍是 sibling tentative 整章草稿；scope 枚举与采纳边界不变。

**Frontend**
- `UICards.QualityReviewCard`：finding 元数据行显示「场 · 撤退（第 2 场）」；`brief_field_refs` 显示为「关联设计字段 · 第 2 场 · 情绪迁移」（场/字段中文映射集中在 `copy.ts`）；卡片在存在场归因时显示诚实边界文案。
- 类型经 schema codegen 透传（Zod 不再剥离场字段）。

**测试**
- 新增/扩展：`quality_finding_test`（3）、`prose_quality_service_test`（3：合法归因/自报不采信/未知场不伪造）、`prose_quality_evaluator_test`（prompt 场清单）、`vs00e_cp3_prose_revision_test`（修订 prompt 场作用域 + 候选整章）、`UICards.qualityReview.test.tsx`（场标签/关联字段/边界文案）。
- 既有全量后端测试 + 前端测试绿。

## 4. CP2 真实 Tauri 验收

命令：`PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh p1-prose-quality-finding-roundtrip --surface tauri`

验收语义（外部 Playwright 驱动真实 Tauri）：
- seed：动作章 02 加两条计划场次（交锋/撤退）；真实 provider 替身按真实 prompt 产出正文与质量 finding（finding 的 `brief_field_refs=["scene_2.emotion_transition"]` 是替身对真实契约字段的合法输入）。
- 真实页面：质量卡显示「场 · 撤退（第 2 场）」+「关联设计字段 · 第 2 场 · 情绪迁移」+ 诚实边界文案。
- 勾选该 finding → 真实「局部修订所选问题」→ 真实修订 run：tentative 整章候选 pending；llm-calls 外部证据中修订 prompt 含「场级作用域：第 2 场（撤退）」「其他场的正文必须逐字节保留」；无采纳事件。
- 证据（已收口）：`artifacts/slice-verify/p1-prose-quality-finding-roundtrip-tauri/summary.json`——`finding_scene_index=2`、`finding_scene_title=撤退`、`revision_turn_id=turn_rev_*`、assertions 含 `finding_attributed_to_planned_scene_with_brief_field_refs_visible` 与 `scene_scoped_revision_prompt_keeps_whole_chapter_candidate_boundary`、`log_noise.ok=true`。

## 5. 诚实边界 / Deferred（登记 B28）

1. **多场正文（一次产出多场 items → 多个 scene/draft）Deferred → B28**：真实 provider prompt 目前明确「items 恰好一个连贯正文条目」；B11D 不放开该契约、不做多 item 采纳事务/阅读多场投影改造（阅读链已能渲染多次采纳产生的多 scene，但非同一次生成）。
2. **「只替换该场」Deferred → B28**：缺少正文场边界与场级采纳身份；B11D 的场级修订是**整章候选 + 场级约束**，UI 明示，不谎称只替换单场。
3. **场级 finding 依赖 evaluator 输出 brief_field_refs `scene_N`**：服务端白名单校验；若模型/旧 evaluator 不填场引用，则 finding 无场归因（诚实缺席），UI 不猜。
4. **共同文件协调**：`slice_verify.ex` 仅动质量 findings 区段；`ProseQualityEvaluator`/`ProseRevisionService` 与并行 B27 计划重叠，已按最小 additive 落地，后续 B27 若重构需保留场段语义。
5. **质量评估仍是章级一次调用**：逐场独立评审/多次 evaluator 调用 Deferred（与多场正文一起归 B28）。
6. **`scenes` 表不加 craft 列**、场次计划作者编辑、E28-E30：维持 NEM04/B11C 非目标。

## 6. 验证命令

```bash
mix compile --warnings-as-errors && mix test
mix credo --strict && mix dialyzer && mix format --check-formatted
mix xref graph --format cycles --label compile-connected --fail-above 0
mix run scripts/arch_check.exs && mix run scripts/adr_trace.exs
bash scripts/quality_manifest_check.sh
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
cd frontend && pnpm typecheck && pnpm lint && pnpm test
PHOENIX_PORT=4660 VITE_DEV_PORT=5773 bash scripts/quality_accept.sh p1-prose-quality-finding-roundtrip --surface tauri
bash scripts/ai_static_scan.sh --top 10
```

## 7. 决策日志

- **2026-10-24 — CP0 裁决（审计默认）**：场语义=规划场次；B11D=方案 A（场级 finding 可见+场级修订指令+白名单校验，候选仍整章）；多场正文/场级替换 Deferred→B28；新增 additive `scene_index/scene_title`；`slice_verify.ex` 仅动质量 findings 区段。
- **2026-10-24 — CP1 实现**：QualityFinding 场字段 + 请求场景清单 + evaluator prompt 合法场清单 + 服务端白名单归因/自报清洗 + 修订 prompt 场作用域 + 原草稿全 items + B25 ref 补漏 + 质量卡展示与诚实边界文案 + schema/codegen。
- **2026-10-24 — 测试**：域/应用/agent/前端新增 9 条场景相关测试；全量后端/前端绿。
- **2026-10-24 — CP2 真实 Tauri 扩展验收 PASS**：quality card 显示服务端归因场标签/关联设计字段/诚实边界；勾选 finding → 局部修订 → tentative 整章候选 + 修订 prompt 场作用域；零采纳。
