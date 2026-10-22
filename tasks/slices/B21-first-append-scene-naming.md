# B21 多场计划首次 append 场名误标：整章正文不得挂到计划第 1 场名下

- 状态：**done（2026-10-22，CP1–CP4 全落，真实 Tauri `p1-chapter-adoption-reading` PASS）**
- 类型：B 轨用户可见错误修复（B11C CP3 登记转正；作者 2026-10-22 拍板「基线清账 + B21 先做」）
- 来源：`tasks/slices/B11C-scene-craft-completion.md` §4b/§5 CP3、`tasks/NEXT.md` B21 行
- 根因落点：`apps/novel_persistence/lib/novel_persistence/adoption_repository.ex` 的
  `resolve_scene(:append)` / `planned_scene_title/2`

## 1. 开工检查（七问）

- **Contract**：采纳阅读投影的「章/场身份」契约——章含多场景（`docs/design/08-novel-element-model.md`
  v2 §6.6 / ADR-0004）、`plan_direction.scene_plans` 是**设计态**场次切分（NEM04 §3.1：设计态不进
  production `scenes` 行），`scenes` 行是正文采纳物化出的生产投影。首次 append 落的是**整章正文**，
  其场身份=章，不回填设计态第 1 场名；不新增 schema/字段/枚举。
- **Invariant**：整章正文不得被命名为计划第 1 场（作者可见错误：阅读模式把整章挂到假的「第 1 场」）；
  第二次 append 的 NEM04 场名语义不回归（seq=2 仍吃 `scene_plans[1].title`）；overwrite 语义不变
  （同章同 title 覆盖 + supersede）；占位「场景 N」继续由阅读端隐藏。
- **Boundary**：`novel_persistence`（单函数分流 + 单测）；`frontend`（readingProjection 单测锁定
  占位隐藏；产品代码不改）；验收 harness（`scripts/seed_p1_*.exs`、`scripts/tauri_slice_verify.sh`、
  `frontend/slice-verify/{external-ui-driver,native-tauri-verifier}.mjs`、quality scenario）。
  明确不碰：其它 app 的 lib、`scripts/lint_enum_literals.exs`、`docs/design/adr/`、`tasks/NEXT.md`、
  `docs/project-ledger.md`。
- **Consumer**：真实 Tauri 工作台「打开档案 → 生成正文草稿 → 保存为章节正文 → 阅读模式」的作者可见
  阅读投影（`ReadingMode` 渲染）；Channel `get_toc` / `get_chapter_content` 回帧。
- **Proof**：persistence 单测（多场/单场/无计划首次 append 均占位；第二次 append NEM04；overwrite
  既有测试）；`readingProjection` 前端单测；真实 Tauri `p1-chapter-adoption-reading` 由外部
  Playwright driver 断言 + `native-tauri-verifier` 强校验。
- **Acceptance Driver**：`PHOENIX_PORT=4656 VITE_DEV_PORT=5770 bash scripts/tauri_slice_verify.sh
  p1-chapter-adoption-reading`（默认 4657/5769 被用户 stage 占用，禁止 kill 用户进程）。产品代码
  新增验收感知逻辑 **no**（`quality/acceptance/scenarios/p1-chapter-adoption-reading.yml`
  `anti_hooks.product_acceptance_logic_added: false`）。
- **Exploration**：不新增要素物化，无探索面新增（不适用；`scenes` 行仍是既有探索/阅读消费面）。

## 2. 根因（B11C CP3 登记的既有缺陷，本次实锤）

D7（2026-08-26，`apps/novel_application/lib/novel_application/adoption_workflow.ex`
`adoption_mode/1`）把「只有显式 rewrite 才覆盖」作为安全默认：`authoring_intent` 缺省/nil 与
新章首次写入都走 `:append`。而 `AdoptionRepository.persist_reading_projection/3` 的
`:append` 分支：

```elixir
defp resolve_scene(repo, work_id, chapter, _chapter_title, :append) do
  seq = next_scene_seq(repo, chapter.id)             # 首次 append → 1
  title = planned_scene_title(chapter, seq) || "场景 #{seq}"
  insert_scene(repo, %{..., title: title, seq: seq})
end
```

`planned_scene_title(chapter, 1)` = `scene_plans[0].title`，于是**多场计划下首次 append 的整章
正文被命名为该章计划第 1 场名**（真实 m5 数据：3/3/4/4 场计划只落 1/0/0/1 个 scene 行）。
前端 `readingProjection.readableSceneTitle/3` 只隐藏「生成占位标题」（`场景 N` / `第 N 场` /
纯数字）、内部 id、等于章名的场名；计划场名是正常文本 → 阅读模式渲染 `<h3>` 假「第 1 场」标题，
整章正文挂在它下面。NEM04 刀③的命名测试只覆盖「overwrite 首段 + 第二次 append」，未覆盖
「首次 append 就是整章正文」这一组合（D7 后该组合成为最常见的真实路径）。

## 3. CP 计划与完成状态

| # | Checkpoint | Status | 备注 |
|---|---|---|---|
| CP1 | 后端根因修复 + 单测（多场/单场/无计划首次 append；第二次 append NEM04；overwrite 不回归） | done | `resolve_scene(:append)` 拆 `append_scene_title/2`；adoption_repository_test 46/0（本组跑法见 §5） |
| CP2 | 前端占位标题隐藏锁定（readingProjection 单测） | done | 产品代码未改（`isGeneratedScenePlaceholder/1` 已隐藏「场景 1」）；补 4 条单测 |
| CP3 | 验收面：seed 开关、driver 三路真实证据断言、verifier 门、scenario yml | done | 见 §4；默认 seed 字节不变（开关只对本场景打开） |
| CP4 | 真实 Tauri 页面验收 + 门禁 | done | `p1-chapter-adoption-reading` exit 0 / passed；证据见 §6，门禁见 §7 |

## 4. 修复方案（最小方案，不引入 artifact 场作用域）

1. **后端**（`adoption_repository.ex`）：`:append` 的场景命名改为
   `append_scene_title(chapter, seq)`——
   - `seq == 1`（= 该章尚无任何 scene 行，首次 append）：**固定占位「场景 1」**，不回填
     `scene_plans[0].title`；
   - `seq >= 2`：保持 NEM04 刀③语义 `planned_scene_title(chapter, seq) || "场景 #{seq}"`
     （计划没排到这一场仍是占位；存量占位行不回填拍板不变）。
   `next_scene_seq = max(seq)+1`，因此「seq==1」精确等价于「该章首次 append」，不需要额外状态。
2. **前端**：不改产品代码。`normalizeChapterContentTitle` → `readableSceneTitle` 已把
   「场景 1」判为生成占位并置空，`ReadingMode` 因 `scene.title &&` 不渲染 `<h3>`。补单测锁定
   「占位隐藏、正文保留、真实计划场名（第二次 append 的「夜巡」）继续可见」。
3. **验收面（外部 harness，产品零感知）**：
   - `scripts/seed_p1_chapter_draft_generation.exs`：新增 `P1_SCENE_PLAN_SEED=1` 开关，仅当开关
     打开时在第 01 章「字数与场次」行后追加两条 B11C 单行场次计划
     （`场次：对账｜目标：…`、`场次：夜巡｜目标：…`）。该 seed 被多个场景共用，默认开关关闭时
     **计划字节不变**，不影响既有断言口径。
   - `scripts/tauri_slice_verify.sh`：seed 执行时只对 `p1-chapter-adoption-reading` 置
     `P1_SCENE_PLAN_SEED=1`。
   - `frontend/slice-verify/external-ui-driver.mjs`：`driveP1ChapterAdoptionReading` 采集三路
     真实外部证据——(a) `get_toc` 回帧里第 01 章 `plan_direction.scene_plans`（证明种子多场计划
     进了真实 Channel→DB 投影）；(b) `get_chapter_content` 回帧里 `scenes[].title`（真实 DB 场景
     行）；(c) 阅读区章级容器真实渲染的 `<h3>` 场标题（用户可见）。断言：2 场计划、首行场景标题
     = 「场景 1」占位、计划场名未成为场景行标题、计划场名/占位未渲染成阅读区假标题。断言以
     `sliceId === "p1-chapter-adoption-reading"` 门控（复用该函数的 word-count-audit/expansion/
     au07 场景保持既有口径）。
   - `frontend/slice-verify/native-tauri-verifier.mjs`：`findP1ChapterAdoptionReadingEvidence`
     对本场景额外要求上述字段且拒绝假标题；`p1ChapterAdoptionReadingBehavior` 增加三条
     assertion（占位保留 / 计划场名未进 scene 行标题 / 未渲染假标题）。仅本场景强制。
   - `frontend/slice-verify/native-tauri-verifier.test.mjs`：新增 B21 合成反例自测（假场景行
     标题 / 假计划标题 / 假占位标题 / 缺计划场次 四种伪造均拒绝）。
   - `quality/acceptance/scenarios/p1-chapter-adoption-reading.yml`：登记
     `first-append-whole-chapter-scene-title-is-placeholder` 不变量与对应 ui/network/data 断言。
4. **dialyzer 顺带修**：`adoption_repository.ex:54` `call_without_opaque` 是 Ecto.Multi.new/0
   返回 `%Ecto.Multi{}` 内 `MapSet.internal/0` 为 opaque、同函数立刻交给 `Multi.insert/4` 的
   已知误报；在 `persist/1` 上加带中文注释的 `@dialyzer {:no_opaque, [persist: 1]}`（本轮唯一
   豁免，未放宽全局）。

## 5. 单测清单（CP1/CP2）

后端 `apps/novel_persistence/test/novel_persistence/adoption_repository_test.exs`
「续写累积多场景 (append)」describe 新增 4 条 + 既有 3 条不回归：

| 测试 | 断言 |
|---|---|
| 首次 append（多场计划）不回填计划场名 | scene 行标题 `["场景 1"]`；`chapter_content` 首场标题=「场景 1」且正文原样 |
| 首次 append（单场计划）同样不回填计划场名 | scene 行标题 `["场景 1"]`（不是唯一计划场名） |
| 首次 append（无场次计划）保持「场景 1」占位 | 存量占位行为不变 |
| 首次 append 不回填 + 第二次 append 仍用计划第 2 场名（NEM04 不回归） | 标题 `["场景 1", "夜巡"]`，两段正文都在 |
| 既有：续写同章累积字数不 supersede | 不变（overwrite 首段 + append） |
| 既有：overwrite 后 append 用计划场次名 | 不变（`["第01章：黑市对账夜", "夜巡"]`） |
| 既有：默认 overwrite 仍 supersede | 不变 |

前端 `frontend/src/lib/__tests__/readingProjection.test.ts` 新增 4 条：

- 「场景 1 / 第 1 场 / 场景一 / 1」全部隐藏为 `""` 且正文不丢（B21 占位）；
- 真实计划场名「夜巡」继续可见（NEM04 不回归）；
- 场名=章名时映射为选中章标题（阅读区不重复渲染假标题）；
- 内部投影 id `as_42` 与空标题隐藏。

## 6. 真实页面验收（CP4，外部自动化驱动真实页面）

命令：`PHOENIX_PORT=4656 VITE_DEV_PORT=5770 bash scripts/tauri_slice_verify.sh
p1-chapter-adoption-reading`（默认端口被用户 stage 占用，未杀用户进程）。

流程（真实 Tauri 工作台 + 外部 Playwright driver，产品零验收感知）：打开档案 → 大纲与结构
（种子第 01 章含 2 场计划）→ 生成正文草稿 → 作者点击保存为章节正文（D7 后走 `:append` 首次
append）→ 阅读模式。

证据：`artifacts/slice-verify/p1-chapter-adoption-reading-tauri/summary.json`（含
`ui-frames.json` / `ui-state.json` / `app-log.json` / 截图）：

**结果：exit 0 / passed（2026-10-22，`provider=slice_verify`，`surface=tauri`）**。首轮
（02:46）失败于 driver 取「最后一个 `get_chapter_content` 回帧」——阅读模式会为目录里每一章
各读一次（12 章），最后一帧是空章 `scenes: []`；改为按目标章标题精确取回帧后第二轮回
`passed`。这条失败也反证断言真的在消费真实回帧而不是自证。

`summary.json` 关键字段（全部来自真实 Tauri 工作台 + 外部 driver/verifier）：

| 字段 | 值 |
|---|---|
| `turn_id / draft_turn_id` | `message_73d460fd-2b53-488f-b815-cce18fca1877:agent:5`（基 turn 为 `message_73d460fd…`） |
| `artifact_type` | `prose_fragment`（`as_mvigrn9d_2f`，作者点击保存为章节正文后 accepted） |
| `planned_scene_titles` | `["对账", "夜巡"]`（`get_toc` 回帧 `plan_direction.scene_plans`，证明种子多场计划进了真实 Channel→DB 投影） |
| `reading_scene_row_titles` | `["场景 1"]`（`get_chapter_content` 回帧，真实 DB 场景行标题=占位，**不是**计划第 1 场名） |
| `reading_scene_headings` | `[]`（阅读区真实渲染 `<h3>` 场标题为空：占位被前端隐藏，无假「第 1 场」） |
| `total_word_count / chapter_word_count / expected_word_count` | `134 / 134 / 134`（单章；显示字数 == 可见正文有效字数） |
| `projection_refresh_status` | `STALE`（既有投影过期提示照旧） |
| `behavior.assertions` | 既有 12 条 + B21 新增 3 条：`first_append_whole_chapter_keeps_generated_scene_placeholder` / `planned_first_scene_title_not_used_as_scene_row_title` / `planned_scene_title_not_rendered_as_fake_reading_heading` |

证据目录 `artifacts/slice-verify/p1-chapter-adoption-reading-tauri/`：
`summary.json`、`ui-state.json`（三路场名证据）、`ui-frames.json`（含 `get_toc` /
`get_chapter_content` 真实回帧）、`app-log.json` + `app-log/*.jsonl`（主链日志、
`channel.get_chapter_content.done scene_count=1 content_chars=151`）、
`p1-chapter-adoption-reading-external-ui.png`（截图：第 01 章正文直接位于章标题下，无假场标题）、
`seed.log`、`tauri.log`。产品代码新增验收感知逻辑 **no**。

## 7. 门禁与验证结果（2026-10-22）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 后端编译 | `mix compile --warnings-as-errors` | 绿（0 warning） |
| 后端格式 | `mix format --check-formatted`（本 slice 改的 3 个 .ex/.exs/.exs 文件） | 绿 |
| 相关后端测试 | `MIX_TEST_PARTITION=b21 MIX_ENV=test mix test`（adoption_repository_test + reading_projection_repo_test + adoption_workflow_test + adoption_boundary_test + reading_projection_service_test） | 108 tests / 0 failures（其中 adoption_repository_test 46/0） |
| 前端 typecheck/lint/test | `pnpm typecheck && pnpm lint && pnpm test` | 绿；543 tests / 0 failures（含 B21 新增 4 条 readingProjection + 2 条 verifier 自测反例）；D18 修复后 544/0（+1 条 agent 纪元拆分用例） |
| dialyzer（本组） | `mix dialyzer 2>&1 | tee /tmp/b21-dialyzer.log` 后 grep `adoption_repository` | `adoption_repository.ex:54 call_without_opaque` 已消失（`@dialyzer {:no_opaque, [persist: 1]}`）；全仓剩余 125 条均为其它 owner 在改的文件，不在本 slice scope |
| 架构边界 | `mix run scripts/arch_check.exs` | 通过 |
| 质量 manifest | `bash scripts/quality_manifest_check.sh` | passed |
| 真实 Tauri | `PHOENIX_PORT=4656 VITE_DEV_PORT=5770 bash scripts/tauri_slice_verify.sh p1-chapter-adoption-reading` | **exit 0 / passed**（见 §6）；结束后脚本自清理、未占端口、未杀用户进程 |

### 7b. 共用 seed 回归核对（p1-chapter-draft-generation，2026-10-22）

按「共用 seed 改动需核对受影响的既有场景断言口径」要求，端口空闲窗口（借用
`/tmp/ainovel-tauri.lock` 串行锁，结束后释放）复跑了一次
`PHOENIX_PORT=4656 VITE_DEV_PORT=5770 bash scripts/tauri_slice_verify.sh p1-chapter-draft-generation`
（该场景不开 `P1_SCENE_PLAN_SEED`，即种子字节与 B21 前完全一致）：

- **产品行为全绿**（driver 断言通过）：`draft_generated=true`、`draft_pending=true`、
  `draft_card_visible=true`、`reading_plan_visible_before_adoption=true`、
  `unadopted_draft_visible_in_reading=false`、`adopt_event_sent=false`、draft_body_chars=151；
  app JSONL `toolbox.execute.done tool_name=prose_writing tool_outcome=succeeded`、无 error 事件。
- **verifier 报 `timed out waiting for native slice evidence`**：经逐条核对，这是 **HEAD 既有
  的验收 verifier 漂移，与 B21 改动无关**——`findP1ChapterDraftGenerationEvidence` 用
  `uiState.draft_turn_id`（agent 纪元 `turn_X:agent:N`）**精确**过滤记录，要求同一 turn 同时
  出现基 turn 的 `channel.user_message.start`/`context.assemble.done` 与 agent turn 的
  `toolbox.execute.done`；agent 纪元下不可能同时满足（实测 app JSONL：start 在基 turn、
  toolbox 在 `:agent:5`）。同文件里 `p1-chapter-adoption-reading` finder 已在
  c4509c86「验证器与不变量驱动器判断纪元迁移」中做了 base/agent 链拆分，draft-generation
  finder 漏迁 → 该场景在此次复跑前即无法通过（非本 slice 引入；本 slice 只改 seed 开关、
  未走 `:append` 的正文采纳逻辑也无从影响它）。
- **处置（2026-10-22，Lead 授权后闭环，登记 D18）**：Lead 授权顺手修该 HEAD 既有验收
  verifier 漂移，边界限定为 `native-tauri-verifier.mjs` 的 `findP1ChapterDraftGenerationEvidence`
  及其直接辅助断言 + 对应 self-test，不改 driver/产品代码/其它场景 finder。
  - 修法：finder 按基 turn（`turn_X`）+ agent turn（`turn_X:agent:N`）拆因果链——入口
    `channel.user_message.start` / `channel.user_message.done` 在基 turn，context 组装用既有
    `contextAssembleTurnIdForDraftTurn/2` 解析（agent 链落点），`toolbox.execute.done` 在 agent
    turn；behavior 把旧的 `planner.form_frame/form_micro_plan.done` 断言迁到判断纪元
    （`judgment.decided.done`，lmstudio 侧 step 期望 `judgment`），并保留
    micro_plan/no-adoption/pending/toc 语义。
  - self-test：`p1-chapter-draft-generation` 期望形状同步（`turn_ids` 链 + `context_turn_id`）；
    新增 1 条 D18 锁定用例：基 turn/agent turn 拆分形态必须通过，且「去掉基 turn
    judgment」必须拒绝（防止只靠工具执行冒充判断纪元证据）；VS-00C CP3 复用的旧 fixture
    保留 planner 事件，不受影响。
  - **第二次真实 Tauri 复跑 exit 0 / passed**（`PHOENIX_PORT=4656 VITE_DEV_PORT=5770
    bash scripts/tauri_slice_verify.sh p1-chapter-draft-generation`）：
    `summary.json` = `turn_ids [基 turn, :agent:5]`、`draft_turn_id=…:agent:5`、
    `context_turn_id=…:agent:3`、chapter_count/reading_chapter_count=12、draft_body_chars=151、
    behavior 断言 10 条（含 `judgment_decided_before_prose_execution`）。产品代码零改动。
  - 门禁：前端 `pnpm lint && pnpm test` = 544/0（543 + 1 条 D18 用例）；锁/端口/进程已清理，
    default test DB 由脚本 cleanup reset。

### 7c. 真实 provider（本机 Strata App `iq3_s`）验收（2026-10-22 23:35，Lead 执行）

在确定性 PASS 之外，按要求补一次**真实模型**端到端验收（不是替身 provider）：

```
PHOENIX_PORT=4656 VITE_DEV_PORT=5770 \
  bash scripts/tauri_slice_verify.sh --provider strata p1-chapter-adoption-reading
```
→ **exit 0 / passed**（证据 `artifacts/slice-verify/p1-chapter-adoption-reading-tauri-strata/summary.json`）：
- 真实 provider 外证：`strata-log.json` + `llm-calls/2026-10-22.jsonl` 共 **8 次真实请求**，模型 `iq3_s`，输入 18,767 / 输出 5,606 tokens（真实 TTFT/latency）；app JSONL 有 `provider_gateway.complete.done` ×8、`prose_quality.evaluated.done`、`quality_policy.decided.done`。
- 真模型生成正文 ~1,700 有效字；B21 断言全过：`planned_scene_titles=["对账","夜巡"]`、`reading_scene_row_titles=["场景 1"]`、`reading_scene_headings=[]`、`total/chapter/expected_word_count=1700/1700/1700`；阅读页截图 `p1-chapter-adoption-reading-external-ui.png`（正文直接位于章标题下，无假「第 1 场」标题）。
- 真实模型路径暴露并修复了**验收 harness 假设**（产品代码零改动）：① 同轮产出 companion 候选（角色/规则）时，正文不一定是 `pending[0]` → 按 `artifact_type=prose_fragment` 定位；② 质量复核存在时正文采纳按钮是「保存原稿」而非「保存为章节正文」→ 按正文语义按钮优先点击；③ 采纳后只要求正文候选的保存按钮消失（其它 companion 候选允许仍待处理）。
- 回归：同 driver 改动后确定性 `p1-chapter-adoption-reading` 复跑 **PASS**（`artifacts/slice-verify/p1-chapter-adoption-reading-tauri/summary.json`）。
- 诚实边界：真实 provider 验收依赖本机 Strata App 在 47831 运行，属 nightly/live 证据、非 CI 确定性；只证明链路与用户可见行为，不评价文学质量（盲评另列）。

## 8. 决策日志

- 2026-10-22 — **为何用 `seq == 1` 判定首次 append，而不是查「章内是否已有正文」**：
  `next_scene_seq = max(seq)+1`，该章没有任何 `scenes` 行 ⇔ seq=1；用现有机械口径即可，
  不引入新状态、不改 schema。
- 2026-10-22 — **为何选「首次 append 保持占位」而不是引入 artifact 场作用域**：B11C CP3 登记
  的首选最小方案；场作用域/多场正文是 B11D 及后续范围，本 slice 只消除作者可见的假场标题。
  代价：计划的场名与正文投影仍是「章级正文 + 场级设计态」两个面，不强行合并。
- 2026-10-22 — **为何第二次 append 继续吃计划场名**：NEM04 刀③的意图是「续写新场景优先用
  计划场次名」（治「场景 N」占位）；首次 append 是整章正文，第二次起才对应计划的第 2 场。
  回归测试钉死该边界，不因 B21 修复扩大沉没面。
- 2026-10-22 — **为何 seed 用 env 开关而不是直接给共用 seed 加场次行**：
  `seed_p1_chapter_draft_generation.exs` 被 P1/字数审计/扩写/判断等多场景共用；无条件加场次
  计划会改变这些场景的档案展示、执行简报与第二次 append 场名。开关只对本场景打开，默认
  字节不变，最小 blast radius。
- 2026-10-22 — **为何 driver 的三路断言与 verifier 门都按 sliceId 门控**：
  `driveP1ChapterAdoptionReading` 被 `p1-word-count-audit` / `p1-chapter-expansion` /
  `au07-state-trace-adoption-replay` 复用，且 `findP1ChapterAdoptionReadingEvidence` 也被它们
  复用；不做门控会把 B21 证据要求扩散到无关场景、破坏既有断言口径。
- 2026-10-22 — **为何 scene 行标题证据取 `get_chapter_content` 回帧而非 app JSONL**：
  `channel.get_chapter_content.done` 只记 `scene_count/content_chars`，不含 `scenes[].title`；
  为记录标题改 `novel_web/lib` 属于本任务明确不碰的范围。真实 Channel 回帧就是 DB 读端口的
  wire 证据，外部 driver 落 `ui-state.json`，`tauri_slice_verify.sh` 的 verifier 把
  `ui-state.json` 与 app JSONL 合并消费。此边界已登记，不用产品日志字段换证据。
- 2026-10-22 — **dialyzer 豁免唯一性**：只对 `persist/1` 关 opacity 检查
  （`@dialyzer {:no_opaque, [persist: 1]}` + 中文注释），Ecto.Multi 误报不触发其它函数；未新增
  其它 `@dialyzer` 静默。
- 2026-10-22 — **prettier 误伤回退**：验收 harness 两文件（`external-ui-driver.mjs` /
  `native-tauri-verifier.mjs` 及其 self-test）在 HEAD 非 prettier 全文件风格；本次只格式化自己
  加的行，不做全文件重排，避免 2000+ 行噪声 diff 干扰评审（回退后 diff 仅 +87/+77/+78 行）。

## 9. 诚实边界

- 本 slice **只修「首次 append 的整章正文不被命名成计划第 1 场」**；不实现 artifact 场作用域、
  不做多场正文投影、不改阅读模式场级 UI 结构。计划场次与正文投影的语义分层仍是「设计态 vs
  生产行」（NEM04 §3.1 拍板）。
- 真实 Tauri 验收使用确定性 `slice_verify` provider（CI/nightly 口径）；真实模型是否稳定产出
  `场次：` 行、以及真实模型下「整章正文 + 多场计划」的阅读观感仍归狗粮观察。
- 共用 seed 的其它 ~40 个场景**未逐一复跑 Tauri**：默认开关关闭时 seed 字节不变、
  `resolve_scene(:overwrite)` 未改、首次 append 命名从「计划名（若有）/场景 N」收敛为「场景 1」
  对无场次计划场景逐字节等价。已实际复跑 `p1-chapter-draft-generation` 核对（见 §7b）：driver
  产品断言全绿；其 verifier 超时是 HEAD 既有 agent 纪元 turn 绑定漂移（D18），与本 slice 无关，
  Lead 授权后已在本轮顺手修复并二次真实 Tauri PASS。`p1-chapter-expansion` 第二次 append 会改为
  吃计划第 2 场名「夜巡」——仅当该场景也打开开关时；默认关闭故不受影响。
- `adoption_repository.ex` 的 `@dialyzer {:no_opaque, [persist: 1]}` 是本轮唯一 dialyzer 豁免；
  需 Lead 在最终报告中汇总。
- 本 slice 不 commit（由 Lead 统一提交）。
