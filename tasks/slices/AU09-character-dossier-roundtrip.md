# AU09 Character Dossier Roundtrip / 角色主档案采纳回写（AI 引导角色设计）

- 状态：done（CP1 已闭环；CP2 字段级结构化 + 演化待后续 slice）
- 类型：Artifact Slice + UI Contract Slice（角色主档案领域对象的 创建→采纳→展示→上下文 闭环）
- 启动日期：2026-06-17
- 所属验收：主锚 `docs/design/acceptance/author/AU-09-story-memory.md`（角色作为故事设定核心对象的管理）；显示消费面 = 作品档案「角色」tab（`AU-12-work-profile.md` 的档案视图）
- 所属设计：`docs/design/domain/21-novel-object-model.md` §7.2/§12.5（character 资产层核心对象 / 主档案层）、`docs/design/01-user-llm-workbench-interaction-model.md` §3.2/§3.3/§3.5（AI-guided / agent kernel / toolbox）、`docs/design/domain/24-novel-intent-catalog.md`（CREATE_CHARACTER_CANDIDATES 等）、`docs/design/ui/43-structure-panel.md` §3/§5（只读 + 发起意图）、VS-04 采纳边界、VS-00C 上下文组装

> 本文件是 slice 入口。CP1 已按本文冻结范围交付；CP2/CP3 仍按 §6 拆分另行推进。

---

## 0. 缺陷事实（为什么需要这个 slice）

「作品档案」角色 tab 曾存在**结构性断裂**：

- 角色 tab 读 **`Character` 表**（`get_work` → `WorkArchiveRepo.characters`，status=accepted）。
- 但作者创建角色（对话 → `character_seed` → 采纳）时，`adoption_repository.ex:110` 把它路由成 **MemoryItem(CHARACTER_PROFILE)**，**不写 Character 表**。
- 全仓**生产代码零写入 `Character` 表**（只有测试 `insert_character` 与 migration 在碰）。

结果：真实流程下角色落进 memory，角色 tab 读的主档案层永远空。`Character` 表——设计 21 §7.2 要的角色**主档案层**——成了只有测试在写的死表。同时 `character_seed → memory` 是**层级错位**：把"创建角色主体"降级成"写一条记忆"。

2026-06-17 CP1 已收口该断链：`character_seed` 采纳写 `Character` accepted 主档案、创建不写 memory、角色 tab 可见、下一次角色设计上下文可读到现有 Character。证据：`artifacts/slice-verify/au09-character-dossier-roundtrip-tauri/summary.json`。

并附带：前端「新建角色」`onCreateCharacter` 发的是 `"我想调整或新增伏笔"`（复制粘贴 bug）；创建入口只在角色为空时出现。

---

## 1. 用户 / 系统目标

作者在真实工作台**和 AI 一起设计一个新角色**：AI 理解意图后基于作品背景/世界观/设定/剧情/现有角色与关系，按角色对象模型给出结构化设计建议并引导作者完善；定稿采纳后角色进入 **Character 主档案层**，在作品档案「角色」tab 可见，并被组装进后续创作上下文。

长期承重：打通"角色主档案 创建→采纳→展示→上下文"这条样板链路，作为作品档案各 tab"数据展示 + 操作"端到端可用的第一个样板。

### 1.1 两层模型（用户 2026-06-17 定）

| 层 | 是什么 | 存哪 | 何时写 |
|---|---|---|---|
| **角色主体（主档案层）** | 相对稳定的人物档案：是谁、定位、别名、核心设定 | **`Character` 表（单一源）** | `character_seed` 采纳时 |
| **演化（连续性层，互补不替代）** | 随作品推进的角色变化/状态/关系演化 | MemoryItem(CHARACTER_PROFILE / current_state / relationship) | 后续叙事推进（**本 slice 不写，CP2**） |

二者**都组装进上下文**：主档案（角色是谁）+ 演化记忆（角色现在怎样）。对齐设计 21 §7.2「相对稳定的人物档案 + 时序变化通过连续性对象表达」。

---

## 2. 开工检查（承重六问）

- **Contract**：
  - 消费 21 §7.2 角色对象模型、24 角色意图、01 §3.2/§3.5、43 §3、VS-04、VS-00C。
  - 固化 `character_seed` 采纳 → 结构化 `Character` 行的回写契约；`Character` 表 = 角色主档案**单一源**；memory(CHARACTER_PROFILE) = 互补演化层（本 slice 不写）。
  - 角色设计 turn 必须收到作品上下文（背景/世界观/设定/剧情/**现有角色及关系**）。
  - **角色 schema = 框架而非封闭字段表**：核心骨架维度（定位/动机/背景/关系/弧光/外貌/语言风格/能力体系绑定…）+ **AI 据作品信息自行推断补充作品专属维度**（修仙→境界·功法；科幻→种族·科技；都市→职业·社会关系…）。产出结构开放可扩展，不是固定必填表单。
- **Invariant**：
  - **I-a 主档案单一源**：`character_seed` 采纳后角色进 `Character`(accepted)，角色 tab 能展示；不再只落 memory。
  - **I-b 创建不写记忆**（用户点1）：`character_seed` 采纳**只写 Character、不写 CHARACTER_PROFILE memory**（层级归位）；memory 留给后续演化。
  - **I-c 双层入上下文**：上下文组装补"读 Character 主档案"这一路——既喂写作连续性，也喂"设计新角色时看得见现有阵容"；保证停掉 memory 误路由后 AI 不丢角色上下文。
  - **I-d AI 引导、基于上下文**（用户点3）：角色设计建议必须基于作品真实状态（有来源），AI **多轮引导完善**，不是按钮→写表、不是一次性表单、不凭空生成；缺上下文要诚实暴露。
  - **I-e 采纳边界 / 只读面板**：创建走 dialogue → tentative `character_seed` → 采纳（VS-04）→ Character；未采纳不进表；面板只读不直写（43 §3、01 §3.2，不做 CRUD 控制台）。
  - **I-f work_id 隔离**；I1/I2/I3 与既有 memory/伏笔/规则/大纲 tab 不受影响；real.ex 三锚点不动。
  - **I-g schema 是开放框架**（用户点）：角色设计建议覆盖核心骨架维度，并据作品信息**推断补充作品专属维度**，不被固定字段表封死；推断维度仍受 I-d 约束（基于作品真实信息，非凭空）。CP1 以 summary 文本承载开放结构；CP2 抽稳定核心入列时**必须保留可扩展部分**，不得强塞固定列。
- **Boundary**：
  - `novel_agent`：`CreativeProvider.Real` 新增**角色设计 prompt 分支**（按 21 §7.2 维度引导结构化建议 + refine 友好 + 上下文 grounding，**保三锚点**）。当前 `character_seed` 落通用 prompt，是"不够引导"的根源。
  - `novel_persistence`：`AdoptionRepository` 的 `character_seed` 分支从"写 CHARACTER_PROFILE memory"改为"写 `Character` 行（accepted，最小映射 name←title / summary←body）"；`WorkArchiveRepo.characters`（读）不动。
  - `novel_application`：上下文组装补读 `Character` 主档案（喂创作 + 喂角色设计 turn）；`adoption_workflow` character_seed 分支对齐（不再触发角色 memory）。
  - `frontend`：修 `onCreateCharacter` 错文案 → 发起"和 AI 设计角色"的正确意图对话；角色 tab **非空也保留**创建入口；采纳后刷新角色列表；文案进 `copy.ts`。
  - **不改**：planner 意图判定机制（意图用 AI 非关键字）、prose_writing 链、其它 artifact 的 memory 写入语义、reading projection 口径。
- **Consumer**：角色 tab（读 Character 展示）+ 上下文组装（读 Character 喂 AI 写作与设计）+ 真实作者（设计→采纳→看到角色）。
- **Proof**：见 §4。
- **Acceptance Driver**：外部 Tauri driver（真实档案 + 设计对话 + 采纳 + 帧/业务日志）；产品代码不读 slice id/env/query/localStorage。角色设计对所有作品一致，是真实产品能力。

---

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | maybe | 若需角色设计的纯校验/归一值对象（最小化，能不加则不加） |
| novel_agent | yes | `CreativeProvider.Real` 角色设计 prompt 分支（schema 维度 + grounding，保锚点） |
| novel_application | yes | 上下文读 Character 主档案；adoption_workflow character_seed 对齐 |
| novel_persistence | yes | `AdoptionRepository` character_seed → 写 `Character`（停 memory）；Character schema 已有 |
| novel_web | no | get_characters / user_message / author_action 采纳均已有 |
| frontend | yes | onCreateCharacter 正确意图 + 非空保留入口 + 采纳后刷新 + copy.ts |
| docs/design | no | 复用 21/01/24/43，不改设计 |
| quality | no | |

---

## 4. Proof

- **agent 单测**：角色设计 prompt 含 schema 维度引导与上下文占位；三锚点（用户创作简述 / 上下文 / 重要 + I3 nonce）保留；坏 JSON 重试不破。
- **persistence 单测**：`character_seed` 采纳 → `Character`(accepted，name/summary 正确、work_id 隔离)；**不产生 CHARACTER_PROFILE memory**；未采纳不写。
- **application 单测**：上下文组装含 Character 主档案（设计 turn 看得见现有角色）；adoption_workflow character_seed 不触发角色 memory。
- **frontend 单测**：onCreateCharacter 发正确角色设计意图（非伏笔）；角色 tab 非空保留创建入口；采纳后刷新；文案取自 copy.ts。
- **不变量**：`MIX_ENV=test mix run scripts/scenario_invariants/run_i{3,1,2}_*.exs` 全过。
- **工程门禁**：compile -Werror、各 app test、arch_check、xref 无环；前端 typecheck/lint/test、frontend_audit、check_design_trace。
- **外部 Tauri 验收**：`bash scripts/tauri_slice_verify.sh au09-character-dossier-roundtrip` —— 真实工作台对话"帮我设计一个角色 X" → AI 带作品上下文给出结构化设计建议（可多轮完善）→ 作者采纳 → **角色 tab 出现该角色** + 业务日志证明 `Character` 回写（且未写角色 memory）。

---

## 5. 架构判断：专用 capability，不是独立 Agent（用户 2026-06-17 同意）

"AI 引导角色设计"在本架构里 = **现有 dialogue-first 对话内核 + 一档专用 capability（prompt + 上下文组装 + schema）**，不是新开一个"角色 Agent"。

- 01 §3.3 会话结构即 agent 内核；§3.2 AI 引导 ≠ 作者指挥离散工具；§3.5 工具箱。独立角色 Agent 会把统一引导内核割成按领域子 agent，违背愿景，也是过度设计（作者在环的引导对话，非自治 agent loop）。
- 现成模式：`prose_writing` / `plot_outline` 各有专用 prompt 分支 + VS-00C 上下文；唯独 `character_seed` 掉进通用 prompt——补齐即照此模式加一档。
- 合力来源：Planner 引导 + context grounding（含现有角色） + 角色设计 prompt（schema 化建议） + 主链多轮 refine + VS-04 采纳。

---

## 6. Checkpoint 拆分（不缩小 slice 范围）

- **CP1（本 slice）— AI 引导的上下文感知角色设计 + 主档案回写打通**：
  发起设计对话 → AI 带作品上下文（含现有角色）按 schema 维度产出角色设计建议 → 多轮完善 → 采纳 → **Character 最小回写**（name + summary 承载结构化档案文本，**不写记忆**）→ 角色 tab 展示 → 上下文读 Character。修 onCreateCharacter 错文案 + 非空保留入口。
- **CP2（后续）— 字段级结构化 + 演化**：character_seed 产出结构化 JSON → Character 的 role/aliases/动机/弧光**列级**落地 + **关系对象建模** + 角色**演化入记忆**（REFINE/ARC/叙事驱动）+ 演化 memory 与主档案在上下文协同。
- **CP3（后续）— 其它 tab 照样板推**：伏笔新增、规则禁用/归档/supersede（43 §5.1）、角色详情 L3/L4（关系/状态/溯源）。

---

## 7. 诚实边界

- CP1 的"schema 化"先落在**设计建议的内容质量 + 文本档案**层面（AI 真按角色模型给建议、能多轮完善），**字段拆列**与**关系对象**是 CP2；但 CP1 体验已是"AI 引导设计"而非按钮。
- CP1 不做角色编辑/删除、不做关系对象、不写演化记忆。
- 不把档案做成 CRUD 控制台（01 §3.2）；操作 = 发起对话意图，写入在主链 + 采纳边界。

---

## 8. 决策日志

- 2026-06-17：与用户对齐完成。①角色采纳写 `Character` 主档案、**不写记忆**；②CP1 最小映射 name/summary，结构化字段 CP2；③角色创建是 **AI 引导的上下文感知 schema 化设计 + 多轮完善**，非按钮写表；④实现 = **专用 capability/prompt 组合**，非独立 Agent（对齐 01 §3.2/§3.3/§3.5）。根因：`Character` 表生产零写入 + `character_seed → memory` 层级错位。
- 2026-06-17：AU 归属——主锚 **AU-09**（用户确认；角色作为故事设定核心对象的管理），显示面消费 AU-12（作品档案角色 tab）。
- 2026-06-17：schema = **开放框架**（I-g）。核心骨架维度（定位/动机/背景/关系/弧光/外貌/语言风格/能力体系绑定）+ AI 据作品信息推断补充作品专属维度（不封闭）；CP1 文本承载、CP2 抽核心入列须保留可扩展部分。

---

## 9. 开放点

- AU 主锚 = **AU-09**（用户 2026-06-17 确认；作品档案角色 tab 作 AU-12 显示消费面）。
- ~~角色设计 prompt 的 schema 维度~~ —— **已定（2026-06-17）**：schema = 开放框架（见 I-g）。核心骨架 = 定位/动机/背景/关系/弧光/外貌/语言风格/能力体系绑定；AI 据作品信息推断补充作品专属维度，受 I-d 上下文约束。

## 10. CP1 交付记录

- 2026-06-17：CP1 已闭环。实现内容：`CreativeProvider.Real` 角色设计专用 prompt、`character_seed` 采纳回写 `Character` 且不写 memory、采纳结果 `adopted_state_ref` 指向 `character_id`、上下文组装读取 Character 主档案、作品档案角色 tab 的创建入口修正与非空保留、外部 Tauri driver `au09-character-dossier-roundtrip`。
- 2026-06-17：验收证据：`bash scripts/tauri_slice_verify.sh au09-character-dossier-roundtrip` 通过；summary 记录 `archive_character_count=1`、`context_character_count=1`、`adopted_state_ref=<character_id>`。
- 后续：CP2 做字段级结构化、关系对象与角色演化 memory；CP3 复用该样板推进其它档案 tab 操作闭环。
