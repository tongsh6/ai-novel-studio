# NEM04-scene-craft-planning：场级 craft 规划落库与简报多场展开（Order 8 刀序③）

**状态**：**done（CP1/CP2 2026-08-11）**；四拍板+存储位改判均已用户批准（§7）。

**CP1 done**：parser 场次行抽取（`场次/场景` label、｜子槽、ASCII 冒号防雷钉负例）+
`ChapterPlanDirection.scene_plans` 结构化键（title 必填、子槽缺省容忍、无标注键不存在）+
builder 逐场展开（`planned_scene`、场缺情绪回退章级、议程自由文本原样进 prompt、
`scene_title` 可选键进 brief 渲染）+ 续写场景按计划场次名（存量不回填）；
单测五组，全量 1408 后端零回归（旧格式退化不变由全部既有 fixture 证明）。
**CP2 done**：real.ex 章计划 prompt 逐场指令（保 stub 锚点）+ 替身两场产出（复刻
真实行为，不认 slice id）+ 简报留痕补 `brief_source`（走规划场次路径的机器证据）+
探索面 `chapter_read` 场次计划渲染（单测断言）；**真实 Tauri 三场景 PASS**：
`p1-prose-execution-brief`（简报按种子两条场次标注展开 `scene_unit_count==2` +
`brief_source=chapter_plan_scene_plans` 门）、`au08-volume-structured-planning` 与
`p1-chapter-plan-minimum`（替身章计划带场次行零回归）；I1/I2/I3 PASS。
**来源**：Order 8 排查 §3.4/§5.3（NEM-GAP-04：scene 是空结构节点，零 craft 字段；
「结构化数据其实已经在提示词里,只差落库」）；设计留位 08 §落地建议第 3 条
（场级 craft 最小槽：场景目标/出场人物议程/情绪，循目标字数槽先例）。

## 1. 问题（两处退化互为因果）

1. **规划侧**：章计划九字段里的「字数与场次」每章都在产场级规划
   （「约1200字，两场（对账/夜巡）」），但它是一行自由文本，写完即扔——
   模型已经在做场级规划，产品把它当废纸。
2. **执行侧**：`ProseExecutionBrief`（VS-00E）本就是场级执行简述并已注入
   writer prompt，但 builder 注释自陈「**CP1 单场；多场展开属后续**」——
   整章被投影成一个 `scene_1` 单元，场怎么切、每场改变什么全靠模型现场即兴。
   M3/M4 的水场/平铺病灶的结构入口。
3. **副产物侧**：`scenes` 表行是正文采纳时的占位副产物，179 行里 162 行叫
   「场景 N」（Order 8 实测）。

**刀③ = 把规划侧的场级数据接住（落库）→ 喂给执行侧（简报多场展开）→
顺带治好副产物命名。它就是 VS-00E 留的「多场展开」checkpoint,数据来源换成
规划落库而非 LLM 二次展开。**

## 2. 机器事实（2026-08-11 探索）

- `ChapterPlanParser`：章计划唯一解析口径；`所属卷` 逐章标注先例
  （label 抽取先于方向解析、自描述不依赖行序、无标注退化）可直接复制到逐场标注。
- `ChapterPlanDirection`：九个字符串字段的 domain struct，`chapters.plan_direction`
  是 **`:map` 列**——加结构化键零 migration。
- `ProseExecutionBriefBuilder.build/1`：`ChapterPlanDirection` → 单场投影
  （scene_mode `chapter_projection`）或降级（`degraded_from_plan`）；
  scene_unit 键族 `target_change/character_agendas/emotion_transition/...` 与
  最小三槽一一对应；`turn_execution_service` 已留痕 `scene_unit_count`。
- `AdoptionRepository.resolve_scene`：append 模式 `insert_scene(title: "场景 #{seq}")`
  ——「场景 N」的唯一产地。
- `prose_execution_brief` 已有真实 Tauri 场景（`p1-prose-execution-brief`）可扩展。

## 3. 设计

### 3.1 存储位：`plan_direction.scene_plans`（第四纪律阶梯改判，零新列）

原方案「scenes 表加三列」被阶梯第一步否决——理由三条：

1. **既有字段可承载**：`chapters.plan_direction` 是 map 列，场级计划就是章计划的
   组成部分，与九字段同居一处、同读同写（慎重新增实体第一步命中即停）。
2. **设计态/作品事实边界**（ADR-0020/VS-00E）：craft 槽是**写前设计态**；
   `scenes` 行是 production 结构节点（阅读链 drafts 的容器）。把设计态塞进
   production 行会模糊 VS-00E 划清的边界。
3. **避免双种群结构雷**：若 outline 采纳建「计划场景行」而正文采纳继续建
   「副产物场景行」，一张表两种语义行——AU08 CP1 撞号雷的同款形状。

`scenes` 表的用户可见退化（「场景 N」）由 **§3.4 副产物命名修复**解决，零新列。

### 3.2 规划标注格式（拍板②：文本逐场标注，AU08 先例）

章块内逐场标注行（label 家族 `场次/场景/场`，先抽取后参与方向解析，
同 `volume_title` 先例；内部子槽用 `｜` 分隔，避开方向解析的 `；` 切分）：

```text
第01章：黑市对账夜: 沈洛潜入黑市追查暗扣。
章功能定位：推进章
…
场次：对账｜目标：核对暗扣并确认被抽走的频段｜议程：沈洛要证据、摊主要脱身｜情绪：压抑
场次：夜巡｜目标：躲过巡检并带走账单残页｜议程：沈洛要撤离、巡检要清场｜情绪：紧绷
字数与场次：约1200字，两场（对账/夜巡）
```

解析产物：`plan_direction.scene_plans = [%{"title","goal","agendas","emotion"}]`
（有序即场次 seq；子槽缺省容忍，title 必填否则整行丢弃；无任何场次行 → 键不存在，
一切现状不变）。`word_count_and_scenes` 原样保留（人读摘要口径不动）。

### 3.3 简报多场展开（拍板④：第一消费者）

`ProseExecutionBriefBuilder`：direction 带 `scene_plans` 时逐场投影
（`unit_id: "scene_N"`、`scene_mode: "planned_scene"`、`target_change` ← goal、
`character_agendas` ← agendas、`emotion_transition.end` ← emotion、
source `["chapter_plan_scene_plans"]`、degraded=false）；无 scene_plans 回退
现状单场投影/降级投影。**VS-00E「多场展开属后续」就此闭环**。

### 3.4 副产物场景行命名修复

`resolve_scene` append 模式：该章 `plan_direction.scene_plans[seq-1].title` 存在
则用计划场次名，缺则维持「场景 N」。存量不回填（拍板③）。

### 3.5 planner 产出指令

real.ex 章计划 prompt 增逐场标注格式指令（保 stub 锚点）；
slice_verify 替身章计划产出带场次行（复刻真实模型行为）。

## 4. 明确不做（YAGNI）

- E25-E30 其余场级要素槽（等拉动）；
- 存量「场景 N」回填；
- 简报 LLM 二次展开（确定性投影即可，数据已在计划里）；
- 阅读模式场级 UI 变化（阅读链不动）。

## 5. CP 拆分

- **CP1 解析+落库+展开**：parser 场次行抽取 + `ChapterPlanDirection.scene_plans`
  结构化键 + builder 多场展开 + 副产物命名修复；单测四组；**百章标本重放**
  （无场次行计划全退化不变）。
- **CP2 产出+验收**：real.ex/替身 prompt 指令 + 真实 Tauri
  （扩 `p1-prose-execution-brief` 或章计划场景族：规划带场次 → 采纳 →
  写正文 → `scene_unit_count == 场次数` + 简报 prompt 段外部证据 +
  正文采纳后场景行用计划名）+ 探索面 `chapter_read` 场次可读。

## 6. 七问

- **Contract**：`plan_direction` 增 `scene_plans` 结构化键（E18-E22 九字段
  契约修订，落 08 NEM-GAP-04 部分关闭 + VS-00C/VS-00E 相应节）；
  逐场标注格式进 ChapterPlanParser 口径注释；brief `scene_mode` 增
  `planned_scene` 值（VS-00E scene_unit 键族不变）。
- **Invariant**：①无场次标注的计划字节级行为不变（百章标本重放证）；
  ②scene_plans 是设计态，不进任何 production 写路径（只被 brief/命名/探索读）；
  ③I1/I2/I3 不受影响（parser 只读采纳后的 artifact content）；
  ④场次 seq=行序，章内稳定。
- **Boundary**：novel_domain（direction/brief 纯函数）、novel_persistence
  （parser+resolve_scene 命名）、novel_application（builder）、novel_agent
  （real.ex prompt）；**不动** channel/web/frontend 生产 UI、阅读链、采纳边界。
- **Consumer**：`ProseExecutionBriefBuilder`（第一，写作指令直达 writer prompt）；
  副产物场景命名（用户可见）；探索面 `chapter_read`。
- **Proof**：parser/direction/builder/命名四组单测；百章标本重放；真实 Tauri
  场景（外部 driver：规划→采纳→生成正文→简报场次证据+场景行名）。
- **Acceptance Driver**：扩既有 p1 简报/章计划场景族，产品零验收感知。
- **Exploration**：`chapter_read` 返回章计划时场次行同批可读（探索面同步律）。

## 7. 拍板记录

- 2026-08-11 — 用户批四项推荐：①最小三槽（场景目标/出场人物议程/情绪定位）
  ②章计划文本逐场标注（AU08 先例）③存量「场景 N」不回填 ④执行简报注入先行。
- 2026-08-11 — **存储位按第四纪律阶梯改判**（AI 提出，待用户确认）：
  原口头方案「scenes 表加三列」→ `plan_direction.scene_plans` 既有 map 字段承载
  （§3.1 三条理由）；scenes 表退化改由副产物命名修复治理，零新列零 migration。
