# NEXT / 当前推进队列

> 最后更新：2026-08-25
>
> 角色：本文件是 AI 和人类维护者选择下一项工作的唯一入口。台账记录事实，acceptance 记录验收口径，用户旅行图记录连续体验；本文件把它们压缩成当前可执行队列。
>
> **仪式（硬约束）**：每个工作周期开工先读本文件队首；收尾必须更新本文件。跑偏的根因就是这条仪式中断（2026-07-19 统筹复盘）。

---

## 1. Current Focus

> 2026-07-28 用户插单：`DS03-awaiting-author-runtime-validity-and-recovery-surface`
> （B14 P0 幽灵任务）已完成收口。resume/steer 改同步 call 门禁（仅 paused 可
> resume；awaiting_author 裸 resume 结构化拒绝，恢复入口只有非空补充）；
> `runtime_live` 成为命令权限唯一真源——join 时对 dead bounded run 广播失效快照，
> 历史 TurnResult 不再授予控制权；控制坞按 live/dead/unknown 状态矩阵切换（dead=
> 「原任务已失效」+重新发起，不发 agent_command）；steer 作者输入持久化为带
> `agent_run_id` 的 user interaction 并刷新恢复（顺带修掉二次 settle 重复写 user
> entry 的病灶，judgment/prose 两条 flow）；命令失败收束为控制坞内单一去重
> system status，「操作失败」假 AI 气泡移除。契约冻结 46 §9.7.1 + ADR-0024 S7
> 修订节；三场景真实 Tauri 全 PASS（awaiting 输入必填 / 刷新 live 恢复 / 重启后
> 失效明示）。S7 available_actions 载体与 agent_run_state codegen 仍归 ADR-0024
> CP3 / DS01，B14 销账。队列回到下方 VS-00G 队首。
>
> 2026-07-24 用户截图插单：`UA01-natural-language-steering` 的
> `awaiting_author` regression checkpoint 已完成。原登记只覆盖 S7 上位缺口和
> running steer，未覆盖“作者补充后 run 不恢复、旧确认提示重复”的具体故障；
> 现 `agent-awaiting-author-steer-resume` 真实 Tauri 已证明同 run 恢复并完成、
> goal version=2、零第二 user turn/run、旧提示仅一次。队列回到下方 P1 正文质量
> 插单；ADR-0024 S7 CP3 仍不据此标 done。
>
> 2026-07-24 用户定向插单：`P1-prose-quality-evidence-and-scoped-revision` 已完成。
> 已落地“局部形式异常召回 → 机械重复/刻意修辞语义判定 → 章节级叙事节奏独立评审”；
> 质量卡强制原句、位置、判断理由、影响范围和置信度，修订默认只改命中句段，仅在 finding
> 明确覆盖段落/整章时扩大范围。Pencil `AH4WW/EYiyl/hRFxB`、代码、schema 和三章真实
> Tauri 语义边界均已对齐；局部修订 sibling 与同 run 控制坞复验通过。fixture 不冒充真实
> 模型文学收益，I10 仍由真实样本人工盲评。本插单已收口，队列回到 VS-00G。
>
> 2026-07-24 用户定向插单：`UA01-quality-revision-action-run-anchoring` 已完成。
> 质量卡修订现具备持久动作回执、source-bound AgentRun、单一 assistant 工作回合、
> 同 run 控制坞与刷新重连；真实 Tauri 暂停→刷新→继续通过。队列已回到下方
> VS-00G 当前队首。
>
> 2026-07-24 同会话 UI 收口：`assistant_message.text` 与 AgentRun
> `author_narrative` 改为完整段落精确去重，普通对话不再重复展示同一模型原文；
> 用户/AI 双向阅读宽度、128px 作品档案 rail、输入栏/档案 rail 无装饰分隔线已同步
> 代码、UI 文档与 Pencil。`au01-ordinary-chat-two-turn-roundtrip` 和
> `quality-revision-action-run-anchoring` 真实 Tauri 复验通过。随后继续移除普通
> `casual_reply` 的“AI 回应”重复 badge，以及无叙事/计划/产物/动作价值的 completed
> AgentRun 摘要；执行中瞬时反馈和承重运行状态仍保留，两条 Tauri 场景再次通过。
> 随后完成任务状态/操作层级收口：顶栏聚合真实 AgentRun，暂停/终态不再显示运行中
> 文案或动效，空发送禁用且“继续”按输入状态切换主次；质量卡提交后折叠，原稿/修订稿
> 使用同构候选操作组并对放弃二次确认；会话移到顶栏，档案 rail 只保留档案与 badge，
> 健康状态降为中性。`quality-revision-action-run-anchoring` 在 1280×800 真实 Tauri
> 再次通过，summary 已纳入无横向溢出、静态暂停、终态无 running copy 和零误提交断言。
> 随后将 assistant 正文、AgentRun 过程叙事与探索方向统一到同一阅读列宽；Pencil
> `41§3-main-workbench` 已补探索方向示例，`au02-candidate-continuation` 在真实
> 1280×800 Tauri 中实测正文与候选面板均为 `686.39px` 且左右边缘一致。
> 复核既有 Pencil 与实现后，先纠正候选面板中 3 个未定义 CSS 变量，并按原型恢复
> 浅灰承载面、白色候选卡边界与等权描边动作。随后用户明确新增候选讨论收束：
> Pencil 已增加 `41§3.1-candidate-discussion-collapsed`；“继续讨论”获服务端接受后，
> 来源候选组自动折叠，刷新后从 session transcript 的 `candidate_selection` 恢复，
> 且仍可手动展开。`au02-candidate-continuation` 真实 Tauri 已证明点击折叠、刷新恢复、
> 可重新展开，并继续满足无 adoption / production write。
> 同日补齐 GAP-WT-04 非探索样例：真实验收发现 ADR-0025 判断链虽然前端已支持
> `question_answer` / `meta_discussion`，但 call2 未携带 frame 语义，所有非候选回复
> 都被机械降级为 `casual_reply`。现已按 UA01 冻结设计补回 `frame_type` /
> `dialogue_goal` 判断字段，并由 1280×800 Tauri 双回合证明“回答问题/创作讨论”
> badge 可达、色调不同且无 action/adoption/write。GAP-WT-04 机器闭环已补齐，
> 只剩真人 walkthrough 观感确认。
> 本 UI 收口不改变当前队首。

**M3 节拍狗粮已完成并审计（2026-07-22）：100 章 / 140k 词达成 / 全书导出 ✓——队首 = 状态函数刀 slice 设计**

一日两跑（21 分钟参数误跑：扩章仅由 --target-words 驱动；主跑 ~5.9h `--resume
--chapters 88 --target-words 140000`，跨进程续跑实证）。审计与 A/B 证据：
`artifacts/novel-output/p1-100k-dogfood/m3-audit-2026-07-22.txt`、
`artifacts/model-contracts/lmstudio/call2-registry-replay-ab-2026-07-22.json`。

**六清算靶判定**：
- resume ✓（12 章 17.6k 字带回续跑）；B8 预检 ✓（32768 放行语义生效）；
- clip_echo ✓：wrong_route 97→20（-79%）；残余 19 例="登记"混淆（模型判 execute 却填
  reply）——**已修复并重放完胜 0/19→19/19 首调命中**（9b8e35e5，百章重负载 context，
  工具 `scripts/replay_call2_wrong_route.exs`；探针三形态 call2_first_try=1.0）；
- CP4a 拦截**部分达成**：R3 题材承诺第 60 章开火（critical，距漂移爆发 31-40 章约压线）
  +R4 前指泄露 ×2（61→68/64→71）+报告链 10 份 SUPERSEDE 正常+面板待处置真实点亮；
  **弧光线结构性失明**（characters=0→无记账主体）；
- CA01 **在场但无效**：判断 call1 全程带 premise/main_goal 仍三次收官+漂成太空歌剧
  （一行锚敌不过十几章漂移摘要）；
- CA02 **结构性空转**：181 条记忆全 DRAFT_CONTEXT，设定/伏笔型零条（事实链建好、上游无事实）；
- B9 **不足**：已采纳正文仍 25 处元泄漏（advisory warn 拦不住 runner 自动采纳，修向=
  meta_leak 升采纳级）。Q1 型短章 8→1（大幅改善）。

**三跑中病灶（机器证据坐实）**：①收官循环（收官味标题 7 个：12/16/18/20/31/42/100）
②"登记"误判（已收口）③**地基事实真空**（characters=0/arc=0/设定记忆=0——五脉仅三条
在工作；太空歌剧吸引子=规模棘轮+语料先验+摘要窗低通+收官点火）。五场讨论合流定型
`docs/design/notes/2026-07-22-prompt-as-function-of-state.md`（prompt 即状态函数三维度；
两拍板已裁决：工作假定层全要素开放[三防护+假定注册表+一致性硬性]、盘点触发 A+B+C 全落）。

**队首：VS-00G CP0→CP1 开工**——承重事实完备性与补全回路 contract pack 已
**Frozen**（docs/design/contracts/VS-00G-*.md；三路全树先例排查+8 项裁决：假定放行
分级/盘点三类全产/AU-13 扩+AU-14 新立/假定用户可见名「暂定设定」，其余取建议默认）。
**CP0 done（2026-07-23）**：契约冻结重构（工作假定=既有对象 tentative 态+标注，
零新实体，用户"慎重新增实体"第四纪律）+同批修订六处（08 NEM-GAP-08/VS-00C
design_missing 档/VS-00F I-L1 修订+负债规则续编/06 absent 守则化+切分）+AU-14
立档+AU-13 D 系。**CP1 done（2026-07-23）**：CapabilityFactManifest（domain 纯函数，主角 E07
required，prose/plot_outline 登记）+MissingPolicyResult design_missing 档+
AbsenceDirective 缺席守则+机械准备注入（turn_execution_service，context.
fact_completeness.done 留痕）；单测 8+6，全门绿，**百章标本重放 PASS**（真实
读端口 characters=0→主角缺席守则注入，M3 地基真空产品级下药）。**CP2 R5 done（2026-07-23）**：主角未物化负债规则（design_debt ledger，
阈值 10 策略化，缺位查询 source_refs，revise_design 引导处置）接入真实对账
扫描；domain 单测 5，全门绿，**百章标本重放 PASS**（characters=0→R5 与
R3/R4 同产 4 偏离，M3 弧光线失明检测层修复）。R2 登记（需人物栏结构化提取）、
R6/R7 随 CP3。**CP3 done（2026-07-23，R7 除外）**：works 增全书骨架三字段（target_length/
planned_volumes/serial_form，CA01 加字段链路全复制零新表）+WorkSkeleton domain
（骨架段+收官守则：距目标禁终局/接近可收束）+plot_outline 规划注入（决策点邻近，
治收官循环）+探索面 profile 三行+R6 骨架缺位负债规则；全门绿，**百章标本重放
PASS**（R5+R6 同产，M3 无主角无骨架双负债被揪出）。R7 提前收官登记（需章功能
定位密度判定接章计划 reader）。**CP4a done（2026-07-23）**：逐项采纳白名单从 character_seed 扩到全 seed 家族
（world_rule/foreshadowing/style_rule/constraint，收编 user-journeys H13），
盘点提案逐项采纳的前提件；domain 单测 4，全门绿。**CP4b 提炼可行性 live PASS（2026-07-23）**：真实 LM Studio 从百章标本正文
提炼出主角林浩(PROTAGONIST)+4 配角+6 世界规则+5 伏笔全带依据章（便宜验证
阶梯 live 单点，非狗粮；证据 artifacts/vs00g-replay/cp4b-inventory-live-probe）；
盘点能力核心不确定性消除。**CP4b-1 done（2026-07-23）**：FactInventoryService 提炼引擎（材料装配→
提炼 prompt→provider→结构化提案+坏 JSON 重试，provider 可注入确定性可测，
单测 6，全门绿）。**CP4b-2 done（2026-07-24，主动触发 B 核心链）**：
`fact_inventory_v1` run flow+已采纳材料读端口+三类既有 seed 提案映射+
Channel `start_fact_inventory`+作品档案入口+逐项采纳已接通；真实 Tauri
`au14-fact-inventory-roundtrip` PASS（4 pending，选择性采纳后档案角色/规则/伏笔=1/1/0，
未采纳角色与伏笔仍 pending，提案阶段零 production write）。**CP4c done（2026-07-24，
finding 触发 A）**：`protagonist_undermaterialized` 的「发起盘点」绑定活跃报告条目并复用
同一盘点 run；真实 Tauri `au14-finding-inventory-arc-loop` PASS（空档案 10 章→唯一 finding
→采纳主角沈砚→再采纳第 11 章正文→弧光账首次出现沈砚，不倒灌历史），SC-AU14-A1 完整闭环，
AU-14 当前 1/4。**CP4d done（2026-07-28）**：全书规划字段建议（OQ4 三类之二）——盘点对
缺位规划字段产 `work_skeleton_suggestion`（结构化槽位循 narrative_role 先例，只建议
缺位字段），逐项采纳=works 立项字段回写（mutation 留痕+revision 递增，不写记忆/档案
对象），档案概览新增全书规划三行；SC-AU14-B1 扩展+A1 复验真实 Tauri PASS。至此 CP3
收官守则对存量无骨架书有了补全入口（R6 正向链路）。**CP5a-e done（2026-07-28）**：
工作假定字段位+生命周期策略（零新实体）/盘点主角暂定候选自动激活+采纳同名收束/
【暂定】注入通道（标本重放双靶 PASS）/「暂定设定」区一键确认否决/SC-AU14-A2/A3
真实 Tauri PASS。**用户拍板批（2026-07-29 已全落）**：①B1 暂定候选断言并入→
**AU-14 4/4 全闭环**；②R7 提前收官+R8 假定超龄催办（标本重放四靶 PASS：真实
「终局」标题在假想骨架下触发 R7）；③B9 元泄漏升采纳级（正文命中→S3 确认流）。
**M4 节拍狗粮已跑完并审计（2026-07-29）**：**105 章 / 147,244 字 / 全章达标 / 导出 ✓**
（超 M3 的 100 章/140k；审计见 `artifacts/novel-output/m4-dogfood/m4-audit-2026-07-29.md`）。
**修复验证**：①T4 残余（judgment capability 未列 required）修复后 `run_failed` 全程 0
（修复前 15 分钟 12 次），178 次落地仅 1 次误路由；②CP5b 暂定主角在真实长跑物化生效
（characters 从 M3 的 0 变为「林浩/TENTATIVE/AI_ASSUMPTION/active/PROTAGONIST」）；
③B9 元泄漏拦截真实开火 **15 次**（每次经作者显式确认才入库=拦截+主权语义）。
**正文质量四维全面改善**：Q1 空短章 8→**0**；Q2 产品状态词入正文 有→**0**；
Q3 章号自指 25→20（且全部经确认非静默）；Q4 重复段 0.24%→**0.05%**。
**未闭环（诚实登记）**：盘点节拍 7 次全败于 harness 采纳点击（三次归因：文案漂移→
候选组结构→disabled 按钮，均已修），**works 全书规划字段仍空 → R7 提前收官未上线**，
收官味标题 3 个（12/25/75）未经规则检验；**题材漂移未拦住**（第 25 章起「星际」，
末章「星核祭坛」，M3 Q5 病灶原样存活，拦它的正是未上线的骨架/收官守则链）。
**短跑补证 done（2026-07-29，库 `tmp/dogfood-db-m4b`）**：VS-00G **治漂移全链在真实
模型下走通**——盘点产 13 条提案 → 主角沈洛就地转正 ACCEPTED → **全书规划三字段回写**
（300000/2/连载）→ **R7 提前收官对第 12 章「第一卷终局」开火**（进度 7%，处置
revise_design）；R5/R6 因缺口补上而正确消失。短跑 12 章/18k 字全达标、重试全零。
**短跑顺带抓出并修掉两个产品缺陷**：①候选组采纳文案无视 artifact 类型（规划建议误
显示「保存到作品档案」）；②同名角色重复采纳堆重复档案行（分两层修：盘点 prompt 带
已在档名单 + 采纳端同名升 require_confirmation 交作者裁决，**不按 name 静默 upsert**）。
另加「大纲与结构」全书规划进度摘要行（口径与收官守则注入同源，43 §5.0.0 冻结）。
**三件后续已全部收口（2026-07-29）**：①**R7 真实页面验收 done**——SC-AU13-D2 verified，
并进既有 `au13-review-adjudication-roundtrip`（种子立 6 万字目标、只写第 1 章=进度 1%，
但第 4 章计划已是「第一卷终局」；真实 Tauri 一轮通过，5 findings，driver 按可见文本
parse 进度与章号、校 `chapter_plan:4` 证据、断言 correction intent 回对话流；顺带补了
该场景一直缺的 manifest yml）。②**同名裁决/候选组文案并入 au14 场景 done**——不预置同名
ACCEPTED 角色（会走 `:skipped_canon_present` 掐断暂定设定链），改为场景内自然产生：
沈砚采纳后二次盘点，stub 照抄 M4 真实模型行为重提已在档角色；真实 Tauri PASS，
accept_label=「采纳方案 A 为全书规划」、rows 1→2。③**Order 8 排查 done**（见上表 Order 8 行）。
**顺带修一个新缺口**：确认卡说不清「为什么要我确认」——`decision_message` 改为按
`reason_codes` 分派（同名点名档案里已有的是谁、元泄漏摆出命中原文），拦住了还得给
作者裁决材料；该文案已由 au14 场景取得真实页面证据。

**AU08 卷结构 slice done（Order 8 刀序①，2026-07-29 收口）**——
`tasks/slices/AU08-volume-structured-planning.md`。**CP1 done（2026-07-29，拆雷）**：
`chapter.seq` 此前按 `volume_id` 取 max，**只因恰好只有一卷才没出事**（m4 实测 105 章 /
105 distinct seq / 1 卷）；一旦建第二卷，卷二首章 seq=1 与卷一首章撞号，而账本
`accepted_summaries_by_seq/1`、阅读章列表、正文检索三处都跨全书按 `c.seq` 排序 →
**静默乱序**（账本错位、R7 末 N 章窗取错）。已收为 work 级全局（书里章号本就是
「第12章」而非「卷二第2章」），三条不变量测试反向验证确实会红（实测 `[1,1,1]`、
`[1,1,7]`）。**CP2 done**：`WorkSkeleton.volume_directive/1`（planned_volumes>1 才发指令式分卷要求，
CA01「字段在场≠守则生效」第二次重演）+ ChapterPlanParser 识别逐章 `所属卷：xxx` 标注 +
`find_or_create_volume/3` 按 (work_id,title) 幂等建卷，无标注退化单卷。坑：标注若写成
ASCII 冒号加空格会命中 `chapter_start_line?` 劈出假章，已加负例钉住。
**CP3 done**：StructurePanel 大纲 tab 多卷分组（单卷保持扁平）+ 探索面卷分布 +
**真实 Tauri PASS**（`volume_headers=["第一卷·觉醒 · 5章","第二卷·裂变 · 7章"]`，
故意 5/7 不等分防「按章数均分」猜中，driver 要求页面分组逐条等于模型输出的 `所属卷` 标注）。
更正：ReadingMode 目录本就按卷渲染，先前说它扔掉分组是看漏。**AU08 slice done**。

**AU08 顺带查出的两件已裁决并收口（2026-08-10）**：
1. **`p1-chapter-plan-minimum` 红门转绿**。裁决：plot_outline 走 bounded AgentRun 认可为
   当前产品形态（ADR-0023 计划驱动 + 规划两段式演进的自然结果，2026-06-29「仅 character
   复合起 run」已被后续演进取代），产品不改；driver/verifier 验收语义照 AU08 同构迁移
   （`judgment.decided.done` 键事件、父/子 turn 分层、`decision_id` 绑定工具执行、
   `run_mode=bounded` 断言），真实 Tauri PASS（turn_id=turn_msn4geze_3:agent:4，
   子 turn 形状即证）。
2. **验收 harness .mjs 已纳入 ESLint 正确性检查**（`frontend/eslint.config.js` 对
   `slice-verify/**/*.mjs` 加独立块：仅 recommended 正确性规则 + no-unused-vars，
   globals=node+browser 双执行环境，不做风格检查）。首跑 21 错全清零：**又抓出一个同类
   必崩门**——`driveUa01AgentInterruptCommand` 里 `steerFrameStart` 误植（DS03 b06f0015
   起 `agent-interrupt-safe-point` / `agent-cancel-target-binding` 两门必 ReferenceError），
   修复后 agent-interrupt-safe-point 真实 Tauri PASS；顺带清掉从未注册的死 driver
   `driveUa01AgentBoundedRosterToCharacterDesignSeeded`（269 行）与散落死变量/丢 cause 的
   rethrow。**小缺口登记**：`driveAgenticLoopProseDeviationReplan` 的 `config.reasonNeedle`
   四处传入从未消费，疑似丢失的 replan 理由断言；未自行补强（会单方面收紧既有门），留拍板。

**队首 = 拍板：D7 续写意图破坏性默认修复**（P1 产品缺陷，2026-08-26 作者质疑
「qwen3.8 能到 Opus 4.6 水平不可能判不了续写」后挖出真根因，
`docs/design/notes/2026-08-26-m6-gptoss-contrast.md` §4d/§4e）——**归因推翻**：
qwen 推理全对（原始 prompt/返回逐条为证），只是**省略可选字段 `authoring_intent`**
（gpt-oss 14 次全填 vs qwen 全程 1 次）；产品 `adoption_mode/1` 把缺失落
`_ -> :overwrite`（覆盖作者已采纳正文），planner 白名单 `@writing_intent_values`
又把 nil 视为合法放行——「填错」堵住了、「不填」没堵。M0（2026-07-19）踩过孪生坑
（748→432 字数倒退）只补了半边。**MBC 判例再现**：为一个模型族建的默认把另一族逼进
破坏性路径。四方案见 §4e，推荐 ①默认改安全侧（nil→append）+③字段升必填。
**模型定版拍板顺延到 D7 修复后重评**（原建议全局直切 gpt-oss 的速度/稳定性依据仍在，
但「qwen 判断力不行」的指控已撤销）。

**M8/M9 变量穷举 done（2026-08-26）**：M8=Q8+medium（思考 2475 字符实证）、
M9=BF16 满精度 54.74GB+none——两跑第 1 章续写均 **3/3 误判**（M7-none 同款），
各自达 skip 阈后终止并如实登记部分数据。BF16 工程账：~9.9 tok/s（Q8 的 1/2.3）、
`--estimate-only` 50.98 GiB；投机解码两模式均不可用（`-mtp` 无内建头 /
`-simple`+外部 MTP SIGSEGV）；下载 ggml-org 单文件 53.8GB@19MB/s 约 50 分钟。
其余候选：D1④ 立项引导（暂缓等 CP2 数据）；③channel 串行在 B12。

**M7 公平对照狗粮 done（2026-08-26）**：qwen3.8-27B **Q8_0**（量化对齐）+
`reasoning_effort=none`（运行形态对齐，347 调用全程实证在请求体）——12 章 16807 字
（10 达标 2 skip）4h02m 收官；writer 中位 78.6s 零撞阀（速度问题解决）但**续写坐标
判定系统性退化**：15 次「续写→覆盖确认」误判 + 3 次 skip（M6 全程 2 次），管线效率
优势全数吐回；盘点节拍未触发（skip 章存在，数据缺口如实记）；元词 0（D1 修复跨模型
站住）。结论=qwen 两形态均不胜任本产品 agentic 主链，gpt-oss 三维全胜且无项目偏袒
（§3b 审计）。执行途中沉淀：GGUF variant 寻址判例/reasoning_effort 档位随模板变
（low 在 GGUF 无效、none 通用）/env 求值谜团→runner 显式 config API 桥路
（dogfood_run.sh+dogfood-runner.mjs）；B8 拒跑分支 unbound 修复。

**M6 对照狗粮 done（2026-08-26，队首④取数动作）**：gpt-oss-120b 同刻度对照跑一次
收官——12 章 18181 字 30 分 13 秒、201 调用全 200、provider_runs 全 purpose 全
completed（writer 26/planner 76/evaluator 25/author_reasoning 51，purpose 同源修复后
首跑归因可信）、writer 单调用中位 24.2s max 33.9s（qwen 中位 532s 撞阀 24% 的 1/22、
零撞阀）、盘点节拍 1/1 成功 16 提案 6 角色主角陆沉舟建档骨架 3 字段回写（qwen 3/3
败）、planner 零 retry（qwen 坏草稿 1/4）、「主角」元词泄漏 0（M5 41 处，D1 修复+盘点
建档双因子）、chapter_mission 25 次零失败；runner 侧 2 次坐标回退+1 次 B9 拦截均显式
处理非产品失败。M5 立项的 D4/D5 韧性层在 M6 下零触发=静默保险。证据
`artifacts/novel-output/m6-gptoss-contrast/`，报告落 notes。

**D6 按用途分模型路由 done（2026-08-25，
`tasks/slices/D6-purpose-model-routing.md`，拍板=①+③、默认态仍全局单模型）**：
Gateway 唯一模型决定点挂 purpose→model 表（provider config `purpose_models`，键白名单
writer/planner/evaluator/fact_inventory，未知键忽略、表空零行为变化、显式 model 仍最高
优先）+ `route_hint` 细化通道（盘点 purpose=:tool 共键，`Execution.with_route_hint`
单独寻址，ProviderRun 冻结枚举零改动）；设置对话框「按用途指定模型」select 区（吃供应
商模型列表+「跟随全局」默认，延续模型名不手输立场）；Tauri 偏好/启动重放/浏览器兜底
全链带表。**顺带修既有真缺陷**：注入依赖 purpose 裸穿 Gateway（只有 fallback 构造带
purpose，writer/evaluator 在 Gateway 层一直落默认 :conversation，M5 体温计 writer 归因
实为投影器旁路）——flow funnel 统一 with_purpose 后归因与路由同源；gateway 入口日志补
purpose/route_hint。真实 Tauri `d6-purpose-model-routing` PASS：writer 调用恰 1 次记录
覆盖模型、planner×3/evaluator×1/author_reasoning×2 保持全局；设置区真实可见默认跟随
全局。诚实边界：UI select→保存→路由全链需真实 LM Studio 双模型（狗粮/走查观察项）。

**D5 盘点思考型适配 done（2026-08-25，
`tasks/slices/D5-inventory-thinking-model-adaptation.md`）**：材料逐章混合（四栏摘要
seq 对位优先、缺失章回退正文截断——考据反转：拍板「摘要优先」落地为逐章混合而非整书
all-or-nothing，一章缺摘要不拖全书降级）+ 退化自动降批（减半至最小批 3、提案 item_id
合并去重、`fact_inventory.batch_fallback.start` 留痕）+ 瞬态族单次重试
（retryable:false 直退）；au14 真实 Tauri 回归 PASS + 门禁全绿。判例：全局 log_jsonl
env 文件断言在全量套件被并发测试翻动＝flaky，事件留痕断言改确定性 provider 调用计数。
退化→降批页面级自愈只能真实模型观察，记入下次狗粮观察项。

**D4 计划起草瞬态重试 done（2026-08-25）**：provider 瞬态族（含超时，拍板 a）单次重试
——叙事段独立额度、结构段与 M0 纠正重试共享单额度（两族互斥防重试链）；
`plan_draft.retry.start`（stage/family）双族留痕供狗粮体温计归因；替身 D4PLANFAIL
一次性注入（D3 瞬态判例复用）。真实 Tauri PASS + 门禁全绿。考据修正：D4 登记时的
~1/4 坏草稿率实为三族，其二已由 M0 骨架与 0a78e895 覆盖，本刀补 provider 直抛最后
一族（ADR-0023 CP0 重试半边实装，观察保真仍留 CP0）。

**D3 摘要维护可靠性 done（2026-08-25）**：狗粮吃生产异步语义（env 覆盖链）+ 后台任务
可观测（start/run error 留痕；顺手修 maintenance degrade 谎报分类——谎报族第三例）+
读取侧惰性补做（仅异步模式、previous 单触发点、cap 2）；真实 Tauri
`d3-summary-lazy-repair` PASS（断供→补做→摘要回流 prompt 全链 llm-calls 外证）+
p1 采纳回归 PASS（CP1 组合遗漏「替身正文主角句」急救验证）。判例：瞬态故障注入必须
一次性；触发点挂恰一次读。

**D1 角色真空收口 done（2026-08-25，D2 并入）**：CP1=守则真空分支（取名指令替死锁令，
仅显式 roster:[] 判真空、缺数据源维持原守则）+ B9 词表扩主角/反派/配角 + seed 具名化
（附 CA04 G3 遗留断言校准——旧管道门禁链吞败判例实证）；CP2=伴生角色 seed 条件指导
（模型可读条件零契约新增）+ 真实 Tauri 全环 PASS（真空守则→伴生卡采纳建档→次轮阵容
进 prompt→守则双向切换→伴生零凑数；llm-calls prompt 级外证=替身落盘针）。
MBC 判例落 VS-00G §2.2。（清单见
`docs/design/notes/2026-08-25-m5-dogfood-observations.md` §3）——D1 角色真空→「主角」
泄漏结构解 / D2 B9 词表扩叙事层元词 / D3 accept 同步摘要维护阻塞 channel（异步化）/
D4 planner 重试（ADR-0023 CP0 实装，坏草稿率 ~1/4 章次实据）/ D5 盘点回路思考型适配 /
D6 按 purpose 分模型（新刀）。G4/G5 携带缺口继续留登记表（CA03 §3.1）。

**M5 节拍狗粮 done（2026-08-25）**：qwen3.8-27b 首跑收官——16 章 19339 有效字 14 章达标
导出 ✓（8 次启动含 3 次标定失败；14/15 章思考重尾按设计跳过；扩章 +4 章模型自定规模）。
观察清单全销账：chapter_mission 20/20 全成功全 model、planning_mission 3+1 降级、判断
探索翼实测开火、carry 三分四大 empty 照妖 seed 真空（prior_summaries 仅首章 empty=真实
主链摘要维护健康）、五账运转（情绪 6 DEVIATED/信息 14 REVEALED/审读 1 份）、盘点 3/3 败
（思考型弱点）、writer 中位 532s 重尾撞阀率 24%。当夜修产品缺陷 3（Gateway 谎报模型名 /
plan 值二次编码解套 / 超时未随模型复核）+ runner 九针（39496e28/0252536a/0a78e895/
52b37c3e）；「主角」元词泄漏因果链作者现场抓到（→D1/D2）。报告与判例见 notes（d63ec9df）。
未推送提交积压 16 个，推送等用户指令。

**WR01c 写前推理层三期——slice done（2026-08-24，
`tasks/slices/WR01c-mission-why-brief-and-planning-decision.md`）。**
WR01c 收口一页话：两拍板（why 面板使命完整结构 / 规划使命照抄 WR01b 模板）→
A 半：trace_summary 结构化使命 payload（statement+逐条+依据标签，author-safe）经既有
`state_trace_refs` 持久，why 弹窗独立区块，replay 同源重建（**修掉 replay 加载成功后
覆盖丢使命行的既有缺口**）；B 半：`works.planning_direction["planning_mission"]`
（migration 字段阶梯）+ `PlanningMissionRepo` 四动作（I-M6 同款）+ channel
`*_planning_mission` 三分支（ADR-0024 S9）+ plot flow 作者版 0 调用直取/暂定落库 +
`get_toc` 顶层投影 + archive_read profile「当前规划使命」行（探索面同步律）+
档案大纲 tab 顶部工作级裁决块。真实 Tauri `wr01c-planning-mission-decision`
（模型暂定→档案改写→0 调用直取→why 区块可见→零写入）PASS + `wr01` 复跑 PASS；
契约 VS-00E §16.10 / 43 §5.0.4 / 46 §9.2。



**CA04 携带缺口收口——slice done（2026-08-24，`tasks/slices/CA04-carry-gap-closure.md`，
VS-00C §3.5 I12「改门=改行为」流程首用）。**
CA04 收口一页话：拍板 G1/G2/G3 修、G4/G5 缓 → G1=`WorkSkeleton.render_for_prose/2`
（骨架事实+收官守则，**无分卷守则**——分卷是规划指令写章是噪声）+TES 按调用点分流；
G2=既有 `creative_memory_sections` 原样开门给 plot（同段同源），plot flow+DPS 补
`memory_reader` 透传；G3=登记表 character_roster 行加 world_building（读端口本就在，
纯登记行）。真实 Tauri：新场景 `ca04-carry-gap-closure`（骨架 140000 字/2 卷+确认伏笔/
风格记忆+主角 seed，三次真实调用各证新携带 carried——prose 带 work_skeleton、plot 带
creative_facts/style_guide、world_building 带 character_roster——未拍板门原样+三产物
tentative 零写入）PASS + `ca03` 按新门更新预期复跑 PASS。全量后端 0 failures + 前端 443 +
I1/I2/I3 + xref/arch/credo 全绿。

**CA03 携带层统一——slice done（2026-08-24，`tasks/slices/CA03-carry-selection-registry.md`）。**候选（不代拍板）：① M5 节拍狗粮（观察清单已累齐：别称
sighting / 场级指导 / 伴生产物不凑数 / 两类使命 tool-call 稳定性与牵引 / 作者改写率 /
carry 日志的 empty 告警面——狗粮须用户批准，模型 `qwen/qwen3.8-27b`，B8 预检）；
② **携带缺口 G1-G5 逐条拍板**（CA03 §3.1：正文无骨架/规划无作品事实/world_building 无阵容/
设计无进度态/manifest 只登记两能力——每补一处=改一条路径 prompt，独立小刀）；③ WR01 三期
（why 面板完整简报、规划使命裁决——等 M5 观察）。
CA03 收口一页话：用户拍板「先统一不改行为」→ `CarryRegistry` 14 行登记表（门唯一声明处，
absence=manifest 门、dialogue_context=:all）→ TES 5 个纯开关门切登记表、target_structure/
dialogue_context 上提装配层（bytes 不变）→ `context.carry.done` 三分日志（carried/gated/empty，
gated 不冒充 empty）→ VS-00C §3.5 冻结（I10 单一门面 / I11 登记纪律 / I12 快照即行为）。
真实 Tauri：新场景 PASS + wr01/wr02 复跑 PASS（行为回归干净）；1452 后端 + 442 前端 +
I1/I2/I3 绿。首跑抓到 driver 预期错顺带发现观察面价值：seed 直插采纳层致 prior_summaries
诚实 empty——carry 日志首次让摘要断链这类问题可被机器看见（M5 观察项 +1）。

**WR02 规划前推理「本轮规划使命」——slice done（2026-08-24，
`tasks/slices/WR02-planning-mission-pre-outline-reasoning.md`）。**
WR02 收口一页话：沿用 WR01 三拍板先例 → `ChapterMissionService kind: :planning`（工具名
`planning_mission`/锚点「规划前推理器」，值对象与 I-M1/I-M3/I-M4 复用）→ `ChapterMissionInputs`
`mode: :planning`（新增「已规划待写的章」材料组）→ plot flow CP2b 机械步序第三步（无
N-PLAN/D1）→ 使命段经 `CreativeRequest.planning_mission` 进规划 prompt 账面摘要段后（缺席
逐字节不变）→ `planning_mission.derived.*` 日志 + `mission_derived` 事件 +
`trace_summary.planning_mission_ref/statement`（why 面板「本轮规划使命：…」）。真实 Tauri
PASS；1450 后端 + 441 前端 + I1/I2/I3 绿。
**登记缺口**：规划使命不持久化、无作者裁决入口（等 M5 观察改写/否定率再定形态）。

**WR01b 写前推理层二期——slice done（2026-08-24，
`tasks/slices/WR01b-chapter-mission-author-decision.md`）。**
候选（不代拍板）：① M5 节拍狗粮（刀①-④ + AU12 + NEM04 + R2 + WR01/WR01b 的长跑验证：
别称 sighting、场级指导实效、伴生产物「不凑数」、本章使命在 qwen3.8-27b 下的 tool-call
稳定性与对正文的实际牵引、**模型暂定使命被作者改写的频率**——狗粮须用户批准；默认模型名
已对齐 `qwen/qwen3.8-27b`，跑前按 B8 预检）；② 规划（plot_outline）前推理；③ 携带层五通道
统一选取策略（VS-00C AssemblyPolicy 语义扩展）。
WR01b 收口一页话：三拍板（档案大纲 tab 逐章裁决 / 作者版直接用不再推 / 推理完成即存暂定）→
`chapter_mission_status` 枚举 SSOT（TENTATIVE/CONFIRMED/AUTHOR_EDITED，作废=删键）→
`ChapterPlanDirection.chapter_mission` 透传（重物化只补缺失方向并带回使命）→ `ChapterMissionRepo`
零 migration → flow 作者版优先 0 调用、否则推导即落暂定（`persisted` 留痕）→ channel 三动作
（ADR-0024 S8）→ 大纲 tab 使命块（徽标/三动作/就地编辑）→ `chapter_read` 可读 → why 面板一句
使命。真实 Tauri PASS（暂定落库→作者改写→二次写作 0 调用直取作者版→零写入）；1450 后端 +
440 前端 + I1/I2/I3 绿。
**登记缺口**：①作者版在场时对话区无使命段（无模型原话，N-NARR）——若要提示应走状态行
app copy；②确认/作废后面板靠重读 TOC 刷新，未做乐观更新。

**WR01 写前推理层「本章使命」——slice done（2026-08-21，
`tasks/slices/WR01-chapter-mission-pre-writing-reasoning.md`）。**
WR01 收口一页话：三拍板（正文 run 新增模型步 / 本期不存不预确认 / 失败降级继续写）→
`ChapterMissionInputs` 按坐标选十组材料逐条 `[ref]` 列名（不设阈值）→ `ChapterMissionService`
一次 `chapter_mission` tool-call（坏结构重试 1，依据越界机械丢弃 I-M1，叙事 N-NARR 绑定）→
flow 内模型步由模型排入计划、`prose_writing` 声明 D1 前置（一步预算除外）、预算 +1 步 +1 调用
→ 使命进 `ProseExecutionBrief.chapter_context["mission"]` 渲染在章行后（`brief_source`
`chapter_mission|chapter_mission_degraded`）→ `mission_derived` 事件进推理区 → trace/日志留痕。
VS-00E §16 冻结；真实 Tauri PASS（计划顺序 / 依据 ⊆ 材料且越界丢弃 / 叙事可见 / 简报来源 /
零写入）；1442 后端 + 439 前端 + I1/I2/I3 绿。
**登记缺口**：①使命不持久化、作者无改写入口（第二期）；②推理区不显示事件标签（46 §9.5
文档流化后仅段落），「本章使命」标签文案已备在 copy.ts 未露出；③`must_avoid` 只有在后续章
计划带信息释放时才有材料（seed 场景为 0，符合不凑数）。

**R2「自由创作只产两种 artifact」独立刀——slice done（2026-08-21，
`tasks/slices/P1-prose-companion-artifacts.md`）。**
R2 收口一页话：VS-02A §3.2 冻结「同一次 `prose_writing` 调用返回正文 + 0..N 个
既有 seed（character/foreshadowing/world_rule/constraint）」→ contract 校验
（仅四类/主伴 item_id 唯一/非 prose 工具带伴生即拒）→ adapter 分组 + assembler
`assemble_all`（伴生组不继承章归属 provenance）→ TurnResult 多组 candidate_set
零前端改动 → 逐项采纳沿既有落位。真实 Tauri `p1-prose-companion-artifacts` PASS
（五组同轮 / 15 动作 / 采纳前零写入 / 选择性采纳余 3 组 pending）；I1 driver 扩到
解析顶层 `items ++ companion_artifacts`。1429 后端+438 前端+I1/I2/I3 绿。
**同日顺带**：`req` 0.5.17 两条安全公告（GHSA-655f-mp8p-96gv high /
GHSA-px9f-whj3-246m moderate）→ `mix deps.update req` 升 0.7.3（传递带升 finch
0.23 / plug 1.20.3 / plug_crypto / decimal，全套测试兜底，live streaming 路径未
重验）；pnpm 在 nvm node 24.19.0 下按 24.14.1 同款 `corepack enable` 恢复。
**登记缺口**：`constraint_seed` 候选卡头沿用「规则草稿」文案（`copy.ts` 已有
`constraintTitle` 未分派，改动连带既有 driver 断言，等拉动）。

**刀序④ information 账+design_ref——slice done（2026-08-11，
`tasks/slices/VS00F-information-ledger.md`）。Order 8 四把刀全部落地。**
刀④收口一页话：信息账正账双源建账（伏笔带 planned_reveal 预期归己/章计划信息，
design_ref 全账首个真实写入）→ R9 仅超期开火+收官清单（无全局阈值）→
prose/planning 注入（未回收伏笔+禁提前揭示，R4 事前预防）→ 回收=盘点模型提议+
作者采纳收账（机械匹配与纯人工双否决后的定型）。真实 Tauri 全环
`au14-foreshadow-resolution-roundtrip` PASS；payload 细则/状态枚举冻结进
schemas（五本账首份）；1422 后端+437 前端+I1/I2/I3 绿。

**遗留拍板项（不阻塞）**：reasonNeedle 疑丢断言；同名确认卡内嵌「并入既有行」；
mix format 51 个历史漂移文件是否全量格式化（PR 时 CI 会红）；M5 狗粮观察项
（别称 sighting 真实页面级/场级指导实效）。

**刀序③场级 craft——slice done（2026-08-11，`tasks/slices/NEM04-scene-craft-planning.md`）**。
刀③收口一页话：章计划逐场标注（`场次：名｜目标｜议程｜情绪`，AU08 所属卷同款先例）
→ `plan_direction.scene_plans`（存储位按第四纪律阶梯改判：既有 map 字段承载零新列，
设计态不进 production 行；scenes 表「场景 N」由续写按计划场次命名治理，存量不回填）
→ `ProseExecutionBrief` 多场展开闭环（VS-00E「多场展开属后续」销账，
`brief_source=chapter_plan_scene_plans` 留痕）→ 探索面 chapter_read 场次可读。
真实 Tauri：简报场景 `scene_unit_count==2`+source 门 PASS，au08/p1 规划两门零回归；
1408 后端+437 前端+I1/I2/I3 全绿。NEM-GAP-04 部分关闭（E25-E30 等拉动）。

**刀序②角色主体+AU12 归并——slice done（CP1/CP2 2026-08-10，CP3 2026-08-11）**。
`tasks/slices/AU12-character-identity-merge.md` 全档：**CP1 归并主链**（domain 纯
计算+单 Multi+channel `merge_characters`+档案合并弹窗 43 §5.0.2；真实 Tauri PASS，
m4b 同名标本 3→2→1 行、arc 归一、零 adoption 写入）；**CP2 输入面+别名后门**
（盘点/character_design 两链贯通 role/aliases；known_characters 名单含别名+checker
返回规范行，别名命中卡点名「『X』是『Y』的已登记别名」；au14 扩断言 PASS+两
assumption 场景无回归）；**CP3 消费面**（别称 sighting 单测自 CP2 起成真链路证据、
阵容注入行升级为「名（身份，别名：…）：摘要」、**别名拦截卡真实页面闭环**：au12
场景扩尾段——盘点重提归并产生的别名→卡点名归属→拒绝→档案不变，一轮 PASS）。
**登记缺口**：①别称 sighting 真实页面级=M5 狗粮观察项（fixture 不自发用别称，
扭曲 fixture 违背狗粮纪律；长跑后查 arc 账 source_refs 是否含别称章）；②同名
确认卡内嵌「并入既有行」选项（拍板遗留的后续 CP，等拉动）。
刀序余项（等拉动）：③场级 craft ④information 账+design_ref。
R2「自由创作只产两种 artifact」是另一把刀，不与本刀合并。
CP5 剩余余项（等拉动）：触发 C、works 级假定、记忆类注入富化；CP2 R2；
**新登记**：`tasks/slices/AU12-character-identity-merge.md`（同名/别名角色身份归并；
本次只落拦截三层，已有重复行的合并/别名/真重名消歧未做）。
百章书标本保留 `tmp/dogfood-db` 供重放开发。唯余小件：定期化 LongRunTask（A20 随需求）。

两日完成索引（细节全在各 slice/notes，此处不复述）：VS-00F CP0→CP4c 全收口（AU-13 5/5，
脉络/审读命名+面板+审读 run+三场景）｜CA01/CA02 CP1｜七问升格｜文案三层术语｜对话列宽
修复｜狗粮前小修批（B8/B9/rail）｜call2 修复+重放取证。

---

**M3 开工（2026-07-21）：VS-00F 五本账+三态对账 CP0——契约 Proposed rev2 待用户冻结**

P1 已关闭（用户裁决），队首切 M3。CP0 首稿后按用户要求做了**全树先例排查**
（三并行代理扫 142 份设计文档 + 本体抽查），rev2 重写契约：投影认领 VS-00C
§3.0 `progress_state_packet` 既有槽（06 §5.0 continuity ledgers 投影行同义）、
两 artifact 归 25 §8.1 维护家族并与 continuity_warning 切分、自动通过=系统
发起 TENTATIVE→ACCEPTED（ADR-0019 INV-1）首次契约化 25 §9.3、revise_prose
复用 VS-00E §8、dismiss 接 Experience Engine（33）、裁决面认领 ADR-0024
入册、status 枚举 UPPER_SNAKE、质量门 vs 账本分工表首画（31 §6 五处重叠）、
验收开 AU-13 家族；契约 §9 附"复用 vs 新造"先例映射总表。**开放问题 5 项
待拍板**（契约 §8：信封 vs 分表 / CP1 选弧光 / 停滞阈值 / 裁决 UI 载体 /
配套 ADR 切分），冻结前不编码。

---

**M2 达标跑完成（2026-07-21）：101,421 字 / 75 章 / 5.28h / 导出 ✓，P1 字数目标首次在判断纪元达成；质量核对与残留收口待做**

全新起跑（原断点库随机器重启被 macOS 清 TMPDIR 蒸发，已修：狗粮库迁
`tmp/dogfood-db/`）。跑中即修两件：①模型重载上下文回落 8192 致 prose 截断
（`lms load --context-length 32768` 恢复，B8 已登记预检钉）；②**新病灶
clip_echo 头部截断**——扩章批章节摘要变长后 call1 叙事超 240 字符，头部截断
剪掉尾部"单动作执行"结论，call2 只见意图复述回落到"登记"元指令误判 reply。
体温计实锤：**112 次重试中 wrong_route_reply 占 97**，随章数递增（前 17 章
0 次，18 章起几乎章章中招），8 章反复失败被跳过（低于 1000 字）。修复已
实现（`clip_echo` 改头 120+尾 120 双端保留，未提交、未 live 验证——本跑用
启动时旧构建）。**T4（capability 失明）全程零复发**（97 次全是 action 层
reply 误判，无一 capability 错值）。

**收口进展（2026-07-21 后半场）**：②clip_echo 已闭环便宜梯队（单测 8/8 +
live 长摘要单场景 8/8 首调 execute+prose_writing，其中 3 次走截断路径全中；
狗粮级指标按攒批清算搭下次节拍跑）；④四个语义提交已落盘（b6d01c56/
f9e839ca/4034caf3/a011dde0），工作树干净；③郑果条目销（新库无此数据）。

**①质量标准 4.3 审计结果（2026-07-21，机器全量扫+抽样，待用户裁决 P1 关闭）**：
- 达标面：67/75 章过 4.3 六条（字数/场景/推进抽样正常）；"系统提示"13 处
  均为剧情内世界观元素非泄漏；4.5 链路全程真实入口 ✓。
- **Q1** 8 章空/短（跳章残留，均为 wrong_route_reply 反复失败章）。
- **Q2** 产品状态词泄漏 ×2："待采纳草稿"织进正文（1 处带【待采纳草稿】
  结构标签+"此段为…需后续审校"元评论）——4.3 硬违规。
- **Q3** 正文章号自指 ×13（"第51章中恢复的…""那是第60章将要出现的…前兆"
  ——含前指未来章）：writer 的章节坐标/计划上下文被模型当剧情事实写入。
- **Q4** 精确重复段 ×3（3/1258=0.24%，轻微）。
- **Q5**（4.4 维度）要角随扩章批漂移：凌渊 ch23 后消失、凌云 ch24-45 昙花、
  沈逸 ch61+ 接管主线；题材尺度漂移（都市赛博修仙→星际歌剧）——**五本账
  缺位的预言实证（07-19 复盘"第 30 章开始漂移"），M3 领域拉动证据**。
- 修向登记（不顺手做）：Q2/Q3=writer prompt 加"不得引用章号/产品状态词"
  约束 + 导出泄漏 machine check 进质量门；Q1=补写或接受由用户定；Q5=M3
  五本账主任务。
- **P1 关闭建议**：可关闭并把 Q1-Q5 带账进 M3（P1 目的=证明产品链路能产出
  10 万字长篇，已证明；质量精修正是 M3 领域层任务）；或先做一轮"补章+泄漏
  清理"再关。裁决权在用户。

---

**T4 已收口（2026-07-21）：call2 目录失明根因修复 + 干净实例 A/B 实证，M2 解除阻塞可重启**

T4 裁决（细节见 `tasks/slices/UA01-judgment-structured-call-reliability.md`
"T4 收口"节）：两个候选假说双双出局——call2 prompt 全天恒定 ~800 token
（"长上下文"不成立）；干净实例重放旧 prompt 误路由 0/10 命中完全复现
（"服务端状态损坏"不成立）。真根因是 **T2b 极小化把目录撤出 call2 prompt**：
enum 包在 anyOf 内层对模型不可见（对照：直挂 enum 的 action 全天合法），
M2 全天 15 次首调 0 命中——前半天"正常"全靠带目录的重试网救回（8/9），
21:46 JIT 换新实例后约束执行恢复，自造名被静默顶替成合法值绕过重试网。
修复=目录六名+探索工具四名注入 call2 prompt（retry hint 实证措辞）+ 探针
call2 首调体温计（`call2_first_try_rate`，堵 T1/T2c "重试遮首调"假绿）。
A/B：判 execute 时 capability 命中 0/7 → **4/4**，推理链自造名 7/10 → **0/10**。
残余登记：plan 判界方差在 runner 长复合措辞下的占比（观察项）、探针 call1
目录陈旧、会话摘要同质重复注水（B 轨）；郑果孤立草稿 M2 重启前人工废弃。

**M2 重启前置已满足**：live 探针三形态复跑通过（call2_first_try=1.0/
retries=0，protocol=1.0，judgment 0.905/0.952/1.0 全过 0.85 阈值）。重启仍用
`--resume`（上下文长度已排除嫌疑）；runner 章节请求措辞收短留 B7（可选）。
狗粮长跑启动按重型验证门惯例仍需用户拍板。

---

**T2 结构性收口完成（三形态 protocol=1.0/blocked=0）+ 缺陷九/十收口 + M2 重启（2026-07-20）**

T2c 干净基线：修正挂钟阀门误用测试环境短超时后，bare/in_run/long_run 三形态
protocol=1.0、form=1.0、blocked=0/21 完全一致——call2 结构化可靠性在长上下文
下不再退化，T3 阈值门禁双形态达标，本 slice 结构性收口完成。

途中发现并系统性收口的独立缺陷（非本次要修的目标，但同一批现场实测拉出）：
**缺陷九**（无界生成）真根因是全仓仅 3 处的默认参数 funnel（`Gateway.execute/4`
等）用裸 struct 绕过止血阀，非最初以为的 `InferenceParams.new/1`；落地三道
防线——provider 级 max_tokens 配置化、模型无关的挂钟时长止血阀、内容退化检测
（`degenerate_content?/1`）。**缺陷十**（"@"退化刷屏）首版误判为 gpt-oss-120b/
LM Studio 结构性缺陷，用户当场指出两点反证后用 `lms unload/load` 重载模型
验证为本 session 高强度压测造成的会话状态损坏，非结构性问题（教训见
`tasks/slices/UA01-judgment-structured-call-reliability.md`）。场景验收复验
顺带挖出 `explore_request.tool` 自造工具名（与 capability 同款病灶），已用
enum+校验重试同款收口。质量门 `pacing` 确定性兜底指标（句数+零对白）选错代理
信号已登记（`docs/design/quality/31-novel-quality-gates.md` §6.12 债务项 5），
未实现。

**M2 重启后暂停（Order 5，2026-07-20）**：`--chapters 0 --target-words 100000
--resume` 重启后遭遇 **T4 新病灶**（call2 的 `capability` 字段与同一次调用
`reason` 自然语言矛盾，疑似强制工具调用语法约束解码阶段静默顶替模型自造的
目录外能力名，非目录/结构校验能拦住）——同一长会话连续 4 次执行类判断 0
命中 `prose_writing`，M2 重启后 51 分钟字数零增长。用户已决定停止 M2、登记
病灶、切换新会话处理，**不要盲目重启 M2**，先读 `tasks/slices/
UA01-judgment-structured-call-reliability.md` T4 节"接手摘要"。当前进度
定格：16,816/100,000 字，12 章 DRAFTING + 5 章 PLANNED（13-17 待写）；工作区
留有一张孤立"郑果"角色设定待采纳草稿（误路由产物），未清理。

M2 首两跑实锤 call2 病灶随上下文长度递减（17 章形态下 capability=null 高频，
缺陷八）——T2 触发条件（连续两跑异常）命中，按数据启动结构性收口：T2a 判断
上下文预算化（章节段有界投影，P2-P4 本来必需）+ T2b call2 极小化 + T2c 长上下文
探针变体测量。当前三跑带 null 重试钉继续当体温计。

M0 五跑一日收口（2026-07-19/20）：判断纪元产品级长跑从"两章即崩"打到 **12 章
17,319 字、11/12 章达标、导出零泄漏、resume 断点续跑实证**（仅第11章 918 字差 82）。
狗粮揪出并即修即钉 **7 个场景桩体系无法暴露的缺陷**：①capability 自造名（enum 硬
约束，live 21/21）②续写坐标自由文本→覆盖倒退（枚举语义+校验重试+runner 守卫，
live 3/3）③采纳后僵尸候选（作者采纳即收束信号，T5 判断纪元形态闭环）④call2 协议
指令误读判 reply（锚定+秒级快速失败）⑤共享 _build 撞车致 run 无声蒸发（狗粮独立
build+库双隔离）⑥run 失败终局 runner 盲等（失败帧秒级化+加权跳章）⑦工具参数套娃
信封致空计划（确定性解套，判断/起草双防护）。**残余登记**：runner 盲等帧层归因
（取证已埋待复现）、误路由/坐标摆动残余率（快速失败已把代价压到秒级，根治探针化
归 C 轨）、run 崩溃缺 terminate 兜底持久化（B 轨）。

**M1 方向感首跑（六跑，2026-07-20）**：结构化种子后 10/10 章全达标（14,062 字、
22 分钟、零跳章零 600s 空等）——M0 原始判据首次完整达成；全程 20 次写作简报
**degraded=false 全绿**（章计划九字段进 writer，判断纪元首次方向在场写作）；
体温计首份数据：retries 3（误路由 1 / run 失败 1 / 坐标摆动 1，全部秒级恢复）。

历史推进记录不再堆在本节：CP 级记录见 `tasks/slices/UA01-judgment-driven-loop.md` §2a-2n，已闭环 slice 证据见各 `*-file-level-closure.md` 与 `artifacts/slice-verify/*/summary.json`。

## 2. Why This Focus

**北极星**：P1 = 作者在真实工作台用真实模型走"设定 → 章节规划 → 逐章产出 → 采纳 → 阅读 → 导出"写出 10 万字可读长篇（`docs/product/novel-output-milestones.md`）。

**结构性倒挂（2026-07-19 统筹复盘，CP5 梳理触发）**：08 要素模型 37 项要素中真正物化的约 10 项，五本账（E33-E37，设计文档自认的护城河）、章级设计四件套、卷级蓝图、场级 craft 全部未建（NEM-GAP-01~07）。而近两周工时全部在机制层（判断循环/退役/探针）——机制层工作自我繁殖、永远有"正当的下一件事"；领域层不叫喊、缺了不红灯，只会让第 30 章开始漂移，而我们还没写到第 30 章。**底盘已跑到货物前面**：机制层今后只在被领域要素拉动时才动。

## 3. Active Journey

连续体验真源：`docs/product/user-journeys.md`（本节为当前活跃旅程的压缩视图）。

```text
作者在真实 Tauri 工作台创作长篇
→ 立作品设定与分卷/章节计划（设计态：E18-E22 结构化——M1）
→ 逐章产出：判断循环按需探索作品事实（CP5 已闭环）→ 朝章计划方向写 → 采纳
→ 摘要/账本随采纳更新（压缩层已建，四栏分维度——M1）
→ 阅读投影、字数审计、导出
→ 10 万字 P1 验收跑（M2）
```

## 4. Queue

三轨预算：**A 主线 ≥60% / B 债务 ≤25% / C 平台验证 ≤15%**。除非阻塞级 P0 bug，功能推进从队首开始。

| Order | 阶段 | 轨 | 任务 | 状态 | 完成判据 |
|---:|---|---|---|---|---|
| 1 | M0 | A | 判断纪元首次狗粮（五跑一日：12 章 17,319 字、11/12 达标、导出+resume 实证；7 缺陷即修即钉） | **done**（2026-07-20） | 判据大体达成（缺章率 0、字数单调、导出 ✓；第11章 918 差 82 属残余摆动） |
| 2 | M0 | A | 狗粮暴露缺陷即修即复跑 | **done**（随 1 消化，commits b1745ee0/e262cbe6/…） | 五跑+resume 全链绿 |
| 2.5 | M0 复盘 | A | call2 病灶收口：T1 基线落档（症状 0/42 复发、judgment bare 0.952/in_run 0.905、残余=plan 判界方差）；T2 按数据降级为观察项（体温计连续异常再启动）；T3 阈值门禁生效 | **done**（2026-07-20，T2 转观察） | ✓ 数据裁决完成 |
| 3 | M1 | A | 章级设计结构化：盘点证明产链早已闭环（writer 文法/解析/简报投影全在），唯一缺口=种子未结构化致狗粮全程 degraded 写作——12 章种子 E18-E22 化，四场景 verified（brief degraded=false / 设计态引用 / 同种子双回归） | **done**（2026-07-20） | NEM-GAP-03 关闭（08 §6.2 注记）；下次狗粮即"按计划方向写"实证 |
| 4 | M1 | A | 章摘要四栏：盘点证明生成/渲染/校验/存储全在（VS-00C CP2 遗产）且 live 实证在产（六跑 10 条 ACCEPTED 全四栏）；本件补唯一缺口=域层公共逆变换 parse_sections（五本账按维度消费入口，generator 真源统一）+ live 样本回归钉。第七问：chapter_read 已吐四栏文本 ✓ | **done**（2026-07-20） | 往返稳定/缺栏诚实/live 样本 4 测；五本账（M3）结构化消费入口就位 |
| 5 | M2 | A | P1 百章验收跑 + 质量标准 4.3 核对 + 导出 | **done**（2026-07-21 P1 关闭，用户裁决：101,421 字/75 章/导出 ✓，Q1-Q5 带账 M3，豁免注记见里程碑文档 P1 Done 节） | ✓ |
| 8 | M3 | A | **结构化容器空转全表排查（2026-07-23 用户拍板，B11/地基真空泛化）**。根假设：规划层/维护层只产扁平结果、不产结构化事实 → 多个既有存储容器被空转/退化使用。已实证两例：**characters 空转**（角色只活正文，自由创作从不写档案→弧光账无主体）、**volumes 退化**（单一默认卷占位，planner 只产扁平章列表→章全挂'第一卷'，B11）。排查维度（像上下文组装全景矩阵）：每张业务表 ×（schema 字段丰富度 / 生产写入路径是否存在且写全字段 / 百章标本实测数据丰富度 / 消费侧是否读全）。候选嫌疑（初步待证）：scene（E23-E30 场级 craft 字段位 NEM-GAP-04）、chapter（plan_direction 九字段是否写全）、mutation/interaction 等。产出：表×使用深度矩阵 + 每个空转/退化归类到 NEM-GAP + 根因是否统一为'规划层不产结构化事实'。方法：schema+生产写入路径+标本实测三对照，只读不改。 | **排查 done（2026-07-29）**：`docs/design/notes/2026-07-29-container-utilization-survey.md`。25 表四维矩阵：2 张全库零行空转（workspaces/versions）、8 张退化（volumes/characters/scenes/mutations/interactions/memory_items/long_run_tasks/work_sessions）、ledger_entries 的 information 子账三库近零 + arc 在 m4 为 0。**根假设被推翻——根因不统一，是四把刀**：R1 规划层不产结构化事实（只解释 volumes/scenes/arc）、**R2 自由创作只产两种 artifact**（更大一块，memory_items.tags 只有 outline_draft/prose_fragment → mutations 类型恒一、memory type 11 枚举用 1 个；类型分派表本来是全的，10 个分支等不到输入）、R3 设计留位消费面未接线、R4 整表未接线。**证伪**：chapters.plan_direction 完全健康（105/105 九字段全填、键集零变体），GAP-03 关闭属实。**刀候选待拍板**：①卷结构（承重最高，解锁 TOC 分层+volume_id 归属+GAP-07）②角色主体（**必须连 AU12 归并一起做**——m4b 已证只补 roster 不做归并会把空转变噪声，4 条同名 arc 重复行）③场级 craft（GAP-04，数据已在提示词里只差落库）④information 账+design_ref。关键数字已独立抽验 | 空转/退化表全部揭露且归因 ✓；进"规划层结构化生产"刀的候选与顺序**待用户拍板** |
| 7 | M3 | A | **上下文组装补全**（2026-07-21 两轮评估+全景矩阵，用户确认登记）。**刀一·写作/评估的事实链**：①L3b 确认记忆进写作（世界规则/伏笔/角色状态，VS-00C §3.1 设计留位未实现——防设定漂移与伏笔失忆最大单项）+ ⓑ风格/作者偏好进创作调用（23 设计断裂：STYLE_RULE/AUTHOR_PREFERENCE 仅探索可查，writer 事前无风格锚、style_fit 只能事后拦）+ ⓓ质量评估器事实输入（knowledge_boundary/timeline 门 🔴 的根因=evaluator 只有正文+brief 无事实）——同一注入基建。**刀二·规划的世界感**：②规划带最近章摘要窗 + ⓐ规划带角色阵容（AgenticPlanDraftPlanner 仅 chapter_titles，**M2 扩章批凭空发明凌云/沈墨/沈逸接管主角团的机制原因**）+ ⓒ卷结构投影（volumes 表零消费，NEM-GAP-07 消费面侧影）+ ③NEM-GAP-01 立项创作字段（premise/theme/main_goal 进常驻上下文，08 §8 序位4 处方；承诺账 design_ref 有真锚）——规划上下文一次补齐。**小件搭车**：④判断章节列表带 DRAFTING/PLANNED 状态（M2 实锤 17/12）+ ⓔ判断 call1 一行"对账报告待裁决"（裁决流程自然发生的前提）。设计裁决依据：06 §5.0 投影表早已定义完整投影集，实现只接了结构链（章/摘要/正文），事实链（记忆/风格/卷/报告）几乎全断——M2 病谱完全对应 | 待定序（建议刀一/刀二各一 slice，排 CP4b/c 前后） | 写作带事实与风格、规划带世界感、立项有命题、判断输入诚实 |
| 6 | M3 | A | **五本账优先**（M2 暴露短板已裁决定序：Q5 要角/题材漂移=五本账 E33-E37 缺位直接实证）→ 三态对账（GAP-05/06）→ 卷级蓝图/CP6 外部翼 | **next**（五本账已 done；VS-00G CP4c finding 触发 A done，当前推进 CP4 全书规划字段建议） | 漂移类缺陷已有账可查、可拦截；当前按 Current Focus 继续补全回路 |

**B 轨债务台账（成批处理，单项超半天登记折返）**：

| 级 | 项 | 处置 |
|---|---|---|
| B1 | 僵尸 run T5 复验、durable 环境竞态复验 | 搭车 M0 狗粮 |
| B2 | D5 预算偏离场景迁移、p1-chapter-adoption-reading/au07 姊妹场景判断纪元重验、no-progress 语义重设计 | 攒批一次做，上限一天 |
| B3 | work_direction 召回（AU09，探索翼=新消费者）、superseded 卡 UI 置灰、toolbox 遥测 run/turn 绑定 | 挂到拉动它的 A 轨项下 |
| B4 | SU01 live vendor 矩阵、DeepSeek live 探针 | 等用户给凭据（用户门控） |
| B5 | 47 文案指南机械步注记 | 顺手带走 |
| B7 | T4 残余三小件：探针 call1 目录陈旧（capability_catalog_section 5 项旧目录 vs 生产 6+4）、会话摘要同质 assistant 消息无去重（"已通过采纳边界"×10 注水）、runner 章节请求四子句长措辞助推 plan 判界方差 | 攒批一次做；详见可靠性 slice "T4 收口"残余登记 |
| B9 | ~~M2 质量缺陷修向~~ **升采纳级已落（2026-07-29）**：正文候选命中元泄漏（章号自指/产品状态词/结构标签，与生成期 validator/导出门同一 pattern 源）→ 采纳升 require_confirmation 走既有 S3 确认流，作者确认后仍可采纳；干净正文不受影响。全回归+真实 Tauri 正文采纳冒烟 PASS。**注记**：下次狗粮 runner 需处理确认路径（泄漏正文不再静默采纳，runner 遇 needs_confirmation 应显式确认或跳过并计数——这正是 forcing function 本意）。余：Q1 空章狗粮清算时补写；Q4 重复段观察 | done（c46dc30b）；runner 确认路径挂狗粮启动批 |
| B11 | **volumes 表退化使用（NEM-GAP-07 领域拉动，2026-07-23 核查实证）**：volumes 表只被退化为单一默认卷占位（`AdoptionRepository.insert_volume` 恒造"第一卷"，planner 只产扁平章列表无卷结构→章全挂默认卷；百章标本 volumes=1/100 章全挂其下）；与地基事实真空同源（规划层不产结构化卷/角色）。活化=改造规划层让 planner 产多卷结构+volumes 表增卷目标/编织/节奏字段（E14-E17）。VS-00G 明确不做（骨架只做 works 意图层）；将来活化后收官守则可升级为卷级收束（每卷可小收束、全书不收官），比现全书级守则更精确 | 卷级蓝图独立刀，待"开新卷"创作动作提出时冻结契约（08 §8 序位 6） |
| B10 | 上下文组装小件（2026-07-21 评估余项）：OmissionNote 覆盖不全（仅 prior_prose 裁剪留痕，摘要窗/roster/账面 cap 的取舍无省略记录）；判断 call1 加账面一行摘要（待议，call2 病灶史提醒判断 prompt 加东西须谨慎）；摘要质量门（四栏齐全有校验、内容质量无——摘要是账本/摘要窗/规划共同上游）；why-panel 上下文可解释面板（VS-00C CP2 延后件，随 CP4c 前端批） | 攒批或挂对应 A 轨项 |
| B8 | LM Studio 上下文配置属重启易失运维状态（2026-07-21 实锤：机器重启后 JIT 默认 8192，17 章形态 prose prompt+输出撑爆窗口 `truncated=1` → provider_response_invalid 无限重试；旧 M2 第13章三次"JSON 解析失败"极可能同病）。已手工 `lms load --context-length 32768` 恢复；候选钉：狗粮预检校验在载模型 context 阈值 + `finish_reason=length` 时报"上下文不足"而非可重试 invalid | 候选钉挂 M2 完跑复盘一并定 |
| B6 | `frontend/slice-verify/dogfood-runner.mjs` 判定架构债——文件里散落一堆各自手写的帧判定函数（事件名/字段字面量），契约理解不唯一、易与真实契约（`frontend/src/lib/socket.ts` 等）漂移（2026-07-20 `awaitingAuthor` 判错字段路径实锤）；已把 `adoptPendingDraft` 一处重构成"分类一次+穷尽分支"（`classifyChapterAttemptFrame`），其余判定点（`readToc`、settle/overwrite 确认等）仍是老写法，未同步重构 | 攒批一次做，理想情况下接入真实契约定义而非本文件自证 |
| B12 | **AU10 工作台渲染稳定性与局部刷新隔离（2026-07-24 用户反馈）**：当前无整页 reload 证据；视觉“整体闪烁”初判为 `WorkspaceChat` 多状态联动 render、可变 key/条件渲染 remount、异步元素/输入区/档案几何变化与自动滚动叠加。四方案已登记：A 最小防闪烁、B 组件/状态边界、C TanStack Query server-state 收敛、D 显式工作台状态机。 | 详见 `AU10-workbench-render-stability.md`；先 CP0 外部测量，再默认 A→B，C/D 仅证据触发；P1 B 轨，不改变 VS-00G 唯一队首 |
| B13 | **ADR 实施/闭环与 traceability 债（2026-07-25 审计）**：当前 26 个 ADR 中可明确判定 8 个未完全闭环——产品/契约缺口 `ADR-0008/0016/0017/0019/0024/0025`，仍为 Proposed 的 `ADR-0022`，以及只剩真实样本人工盲评 I10 的 `ADR-0020`。本次“第一章字数太少了→已经确认了”Stage 现场不是 Provider 超时：两次判断调用均成功；run `run_mrz30t37_4lt` 收到 goal v2 后连续三次 `run_resumed → awaiting_author`，最终 `status=awaiting_author/phase=stopped` 且无 `active_behavior_ref`，归属 `ADR-0008` blocking clarification 与 `ADR-0024` S7 CP3。治理侧 `mix run scripts/adr_trace.exs` 当前报告 26/26 ADR 缺 `enforced_by`，且仍 exit 0，故“其余 18 个无明确核心阻塞”尚非机器认证结论。 | 不改变 VS-00G 唯一队首；S4/S7 与 blocking clarification 由 ADR-0024/UA-06 owner 收口，DS02/外部搜索翼/Projection/Replay/I10 各回原 owner；另行补 `enforced_by` 与把 `adr_trace` 从 soft warn 升为可阻断门禁，实施前先按 ADR→slice→代码→真实页面证据逐项定 owner |
| B14 | ~~P0 awaiting_author 幽灵任务与失败气泡~~ **已销账（2026-07-28）**：DS03 全链收口——resume 门禁/liveness 真源/控制坞状态矩阵/steer 持久化/错误内联，三场景真实 Tauri PASS。残余（不阻塞）：S7 available_actions 载体归 ADR-0024 CP3；agent_run_state codegen 归 DS01；Pencil dock dead/awaiting 变体 frame 待补；非 judgment/prose flow 的 steer transcript 顺序对齐待其引入 steer 语义时做（细节见 slice 决策日志）。 | `DS03-awaiting-author-runtime-validity-and-recovery-surface.md` done / verified |

**C 轨（被 A 轨拉动才做）**：explore 方向质量 live MBC 探针；记忆类面场景级验收；harness/探针体系自发扩建一律禁止。

## 5. Selection Rule

1. **领域拉动判据（第一裁决）**：机制层工作必须回答"被哪个领域要素（E01-E37/五本账/三态）或 M0 缺陷拉动"；答不上 → C 轨排队，不开工。
2. **无队列挂靠的工作不开工**；临时发现先登记（B 轨或 slice 文档余项），不顺手挖。
3. **止损律**（2026-07-18 用户拍板）：语义重定义值得做；纯计数钉快钉；环境毛刺登记复验不深挖。
4. **狗粮节拍**：M0 之后每 3-5 个周期强制一次 10 章级狗粮——产品级测量常态化，防"场景绿=进展"错觉。
5. **周期收尾更新本文件**（Current Focus 一段话 + 队列状态位），历史叙事写 slice 文档不写这里。
6. **反补丁自检（2026-07-20 用户提醒固化）**：同类症状出现第二次即触发归并审视——问"这些是几个缺陷还是一个病的几种症状"；症状钉可以先打（防线），但病灶必须立独立收口项且**测量先于设计**；harness 重试把问题变"能跑"不等于病愈，重试率必须进体温计。

## 6. Decision Log

| Date | Decision | Why |
|---|---|---|
| 2026-07-28 | DS03 P0 插单执行并收口（用户指令「先提交这批改动，然后处理 DS03」）：resume/steer cast→同步 call 是本 slice 最重语义改动——cast 语义下「拒绝」对前端即成功，是幽灵任务机制根源；`runtime_live` 从零消费字段升为命令权限唯一真源；dead bounded 不改写持久层状态、失效只经 wire 声明。 | 三场景真实 Tauri PASS + 全门禁绿（后端 616 测试/前端 428+184/不变量 I1I2I3/xref/arch/design-trace/audit）。场景 A 首跑抓出 prose flow 完成时以 goal.text 二次写 user entry 的重复病灶（steer 后即重复作者补充），suppress_user_entry 双 flow 收口——验收红线的价值实证。 |
| 2026-07-25 | 登记 `DS03-awaiting-author-runtime-validity-and-recovery-surface` 为 P0/B14，不改变当前唯一队首。 | 用户截图与 Stage DB/AgentEvent 证明问题不是模型连续失败：同一 bounded run 裸 resume 重放旧 awaiting 判断，runtime 失活后历史 TurnResult 仍授予控制权，`not_found` 被追加为 AI 气泡，steer 作者输入未持久化。该边界不在已完成的 UA01 live-steer checkpoint 内，归属 ADR-0024 S7 CP3。 |
| 2026-07-25 | 登记 ADR 实施/闭环审计：当前可明确判定 8/26 未完全闭环，并把 `adr_trace` 26/26 缺 `enforced_by` 的机器追溯缺口列为 B13；不据 ADR 文件头的 Accepted/Proposed 单字段宣称实现完成。 | Stage 日志与 SQLite 状态已直接证明本次卡住属于 `awaiting_author` 恢复/澄清决策面缺口，而非模型或网络超时；同时 ADR 索引、slice 索引与最新 owner 文件存在状态漂移，必须保留“决策已接受 / 代码已实现 / 真实页面已闭环 / 机器可追溯”四层口径。 |
| 2026-07-24 | 登记 `AU10-workbench-render-stability` 为 P1/B 轨，不改变当前 VS-00G 唯一队首；四方案定序为 CP0 测量 → A 最小防闪烁 → B 组件/状态边界，C Query 化与 D 状态机按证据触发。 | 当前问题属于真实用户可见体验债务，但尚无文档级 reload 或 P0 阻塞证据；先冻结 remount/layout/scroll 的量化基线，可避免直接把症状升级成全量状态架构重写，也能与 UA01 streaming、AU12 last-known snapshot 既有职责保持正交。 |
| 2026-07-21 | **P1 里程碑关闭**（用户裁决）：达标跑 101,421 字/75 章/5.28h/导出 ✓，Q1-Q5 缺陷带账进 M3（豁免注记入里程碑文档）；M3 定序=五本账优先（Q5 漂移直接拉动）。狗粮验证纪律固化"攒批清算"模式（修复只积累+便宜梯队，搭节拍跑一次清算，不为单个修复单独起跑）。 | P1 目的=证明产品链路能产出 10 万字长篇，已由外部自动化驱动真实工作台全程实证；Q2/Q3 修向是 B 轨小件，Q5（要角/题材随扩章批漂移）恰是 M3 五本账主任务，留在 P1 里错位。07-19 复盘"底盘跑到货物前面、第 30 章开始漂移"的预判被本跑数据完整证实——机制层此后由领域要素拉动。 |
| 2026-07-21 | T4 收口：根因改判为 T2b 撤目录致 call2 目录失明（推翻"长上下文"假说，排除"服务端状态损坏"假说）；修复=目录注入 call2 prompt + 探针首调体温计；reason↔capability 一致性校验方向关闭。M2 解除阻塞。 | 三重证据裁决：①M2 全天 call2 prompt 恒定 ~800 token（预算化在工作，上下文没长）；②LM Studio 日志钉住瘟疫起点=21:46 JIT 新实例第一个判断调用（约束执行从"劣化浮出"翻转为"正常顶替"），非上下文增长点；③干净实例逐字节重放：旧 prompt 0/10 命中且顶替现场复现，新 prompt 判 execute 4/4 命中、自造名 0/10。教训：T1/T2c 探针绿是"重试遮首调"假绿——体温计必须测首调，不测协议黑盒的最终值。 |
| 2026-07-20 | T2 结构性收口裁决完成（三形态 protocol=1.0/blocked=0），M2 重启为 Order 5 头队；缺陷九真根因改判为 3 处默认参数 funnel（非 InferenceParams 本身），缺陷十撤销"gpt-oss/LM Studio 结构性缺陷不可修"的结论，改判为本 session 压测造成的会话状态损坏。 | 用户两次指出误判：一次是"换个 AI 这个量级还一致吗"逼出 provider 级配置化+挂钟止血阀的系统性设计；一次是"该项目不是第一次用 gpt-oss、应先查公开信息"直接推翻了"结构性缺陷需升级/换模型"的错误结论——`lms unload/load` 重载模型后同一 prompt 立刻恢复正常，坐实是会话状态问题。教训：怀疑结构性缺陷前先查是否有更简单的状态类解释，复测要跨会话做，同一可能已污染的服务实例里反复测不算独立样本。 |
| 2026-07-20 | M2 暂停，登记 T4 新病灶（call2 capability 与 reason 自相矛盾，疑似强制工具调用语法约束解码阶段静默顶替模型自造的目录外能力名），用户切换新会话处理，不在本会话继续等它自愈。 | 重启后连续 4 次执行类判断 0 命中 prose_writing（每次顶替到不同错误能力），51 分钟字数零增长；用户截图直接抓到隐藏推理链"决定用 creative_writing"但实际输出"character_design"的原始证据。用户判断"继续跑只是在耗时间不会有新进展"，止损优于继续观察同一个已经证实、尚未理解成因的系统性故障。 |
| 2026-07-19 | 项目统筹复盘落地：三轨预算（A≥60/B≤25/C≤15）+ 领域拉动判据 + M0-M3 阶段队列 + NEXT.md 仪式恢复。CP5 全收口（CP5a 判断循环内部翼 + CP5b 补面/计划检索步/设计态场景/探索面同步律，commits dcdc3860/39b31efe）；帧纪元退役两批完成（c4509c86 等，净删约 6,900 行）；I1/I2/I3/N-NARR 驱动器迁判断主链全绿。 | 用户诊断"任务易被小方向带走出不来"，CP5 梳理暴露机制层/领域层倒挂（37 要素仅约 10 项物化、五本账全缺）；判断纪元零狗粮。M0 裁决跑先行，领域层（章级设计/摘要四栏/五本账）成为 A 轨主序。 |
| 2026-07-15 | ADR-0025（判断驱动交互循环 + 计划按需 + 探索两翼）Accepted，CP0 文档批次落地（00 §2.3 形态章 / 00c N-PLAN 改写 / ADR-0023 适用域注记 / 46§9.6 / slice 立项）。 | 用户四次方向拍板（消灭形式主义→真循环→计划按需→探索必须）+ "同意 开始落所有的文档"。CP1（对话循环，方案 B 回复内联）开工前置 MBC 探针；实现排期与 Order 62 长尾收口的先后待用户定。 |
| 2026-07-15 | DS01 CP1 实现落地：schema 闸门（ui_card/turn_result_v3 codegen + barrel 组合收紧）、前端删手写 TurnResult 与 6 个死卡片分支、turnResultWire safeParse（Channel + transcript 同一入口）、后端 result_card 删 actions 字段、契约单测（运行时 3 + 源码扫描 2）、漂移注入测试。全 gate 绿：后端 1214/0、前端 390/0 + typecheck/lint、xref/arch_check、I1 3/3 I2 3/3 I3 3/3、frontend_audit/design_trace、静态扫描 touched=0。**场景化验收未闭环**：`agent-bounded-roster-to-character-design` 在 DS01 改动与干净 baseline（stash 隔离复验）上以同一断言失败（driver 期望 provider_calls=3，Order 62 CP1 两段式规划后口径过时），属 Order 62 CP3 复跑批既有债务，非 DS01 回归。 | 顺带发现并登记：adoption_status 大小写漂移（JSON SSOT 大写 7 态 vs 线上小写，DS01 决策日志）；artifact_adoption_entry.json 扩展 payload/source refs 被 persistence SchemaDriftTest 抓出后同步 Ecto 镜像——JSON↔Ecto、JSON↔前端双向闸门自此对 adoption 条目同时生效。 |
| 2026-07-15 | 用户批准 `DS01-decision-surface-schema-gate` 插队为 next（Order 63）；Order 59 UA01-provider-execution-stream-unification 让位为 queued，DS01 CP1 闭环后恢复。 | 对话流不流畅诊断（notes/2026-07-15）确认卡片契约三方失联且无机器闸门；ADR-0024 已 Accepted（决策面注册表 S1-S7 + N-SURF），CP1 schema 闸门先行可让 CP2/CP3（clarification / awaiting_author 决策面）及后续所有卡片工作在 CI 红灯保护下推进。与 Order 62 运行组卡视觉简化正交。CP0 文档已提交（commit 5390cb17）。 |
| 2026-07-05 | 用户 stage 反馈体验回归插队（Order 62）：规划调用拆两段式恢复真流式（调用 ×2 体验优先）+ 卡片按处置表简化 + 工作详情整体移除。 | ADR-0023 CP4 强制 tool call 使规划期间 content 无字节可流，run 开场长时间零反馈后卡片突然出现，违背「AI 流式输出所思所想」的既定交互要求；卡片推理原文重复 3 次、阶段带/终态区冗余。用户三项拍板记录于 `tasks/slices/UA01-agentic-loop-streaming-reasoning-card-simplification.md`。此拍板同时取代 SI-model-behavior-contracts T4 的分岔 A 为主通道（arguments.author_reasoning 降级为回退）；ADR-0023 调用经济学需登记修订注记。 |
| 2026-07-05 | ADR-0023 CP2 D1-D7 与 CP4 native tool calling 均已闭合，ADR-0023 可升 Accepted。 | D1-D7 与 no-deviation 已有 focused tests、native verifier 与真实 Tauri summary；CP4 已把 AgentPlan draft/revision 迁到 provider-native tool calls，并由 `agent-plan-native-tool-calling-protocol` 证明 `agent_plan_draft` / `agent_plan_revision` count/name telemetry 可见且 arguments 不泄漏。ProviderExecution runtime 统一和 AgentPlan planning protocol 迁移分属不同证据链，但当前二者都已有各自闭环证据。 |
| 2026-06-29 | 切换队首到 `UA01-provider-execution-stream-unification` CP0。 | 用户明确否决“最小 streaming contract”、`supports_streaming=false` 时回到旧 complete 体系，以及统一体系之外的第二套 provider 执行口径；provider streaming 必须按完整 provider execution stream 统一架构推进。CP0 只审计和登记，不写第二套 streaming/fallback 代码。 |
| 2026-06-29 | `UA01-provider-execution-stream-unification` CP1/CP2 落地。 | `novel_common` 新增纯 `ProviderRun` / `ProviderEvent` / `ProviderOutput` contract，`ProviderRun.execution_mode` 只接受 `:event_stream`，author-visible `ProviderEvent` 拒绝 raw prompt / chain-of-thought payload；`Gateway.execute/4` 物化 provider execution facts，`Gateway.complete/3` 改为兼容消费者。下一步仍需迁移 adapter/caller/Channel/UI，不能写成完整 streaming 体感闭环。 |
| 2026-06-29 | `UA01-provider-execution-stream-unification` CP5 UX 方向重定向。 | 用户确认目标对齐 Codex Desktop 的聊天流：一条 assistant 工作态 turn 承载短状态、可展开工作进度、模型执行流和 pause / steer / cancel；active run 输入框提交 steering；最终结果原地收束。用户进一步明确功能目的：让作者理解系统与 AI 如何理解目标、制定计划、修订计划、执行并形成候选的前因后果，而不是显示简单状态卡；随后指出卡片式承载不符合对话流。当前仅保留非卡片式 v4 `46§8-agent-run-dialogue-flow-v4` (kg4wN) 并导出 PNG，旧探索稿已删除，`novel-studio.pen` 已出现 Git diff。 |
| 2026-06-30 | `UA01-provider-execution-stream-unification` CP5 前端工作态回复实现。 | `WorkspaceChat` 把现有 `agent_event` / `agent_run_state` 嵌入同一 assistant 回复的展开式“工作详情”，运行中先显示临时 assistant 工作态回复，final `TurnResult.agent_run` 到达后原地收束；事件分组为目标理解、上下文依据、计划制定、作者调整、执行记录、结果与边界，UI 呈现层把内部 `AgentRun` 文案转为“这次创作请求”。`agent-bounded-roster-to-character-design` 真实 Tauri 已通过。该结论不等于 provider execution stream caller 迁移完成。 |
| 2026-06-30 | ProviderExecution success/error activity 进入普通对话工作轨迹。 | `ProviderActivityProjector` 已把 ProviderRun/Event/Output facts 投影为 developer visibility 的 `provider_progress`；真实 Tauri `agent-provider-execution-stream-unified` 验证 provider_started/provider_final_output，`agent-provider-execution-error-author-safe` 验证 provider_started/provider_error 和安全 fallback TurnResult。错误场景是显式 provider error 验收，native verifier 只对此场景放行 error/fallback，其他场景仍由通用错误保护拦截。 |
| 2026-06-30 | ProviderExecution activity 可从持久 AgentRun events 恢复到对话流。 | `AgentRunLog` 增加 scoped run/event 查询，`WorkSessionService.resume/show` 把 author-safe events 恢复到 `turn_result.agent_run.events`，`WorkspaceChat` 合并 restored/live events 后仍按同一 assistant 工作详情渲染。真实 Tauri `agent-provider-execution-activity-restored` 通过，证明 reload 后 provider activity 可见且不重新调用 provider、不泄漏 raw payload。 |
| 2026-06-30 | ProviderExecution 工作轨迹细节进入同一对话流。 | `frontend/src/lib/agentRunTimeline.ts` 从 author-safe payload 渲染模型事件、用途、provider run/call refs、状态、输出类型、结果长度和用量计数；planning/gate payload 渲染认知帧、候选数、计划/裁决编号；并从 author-safe events 按真实事件语义归纳“本轮路径”和模型调用摘要。新增 `WorkspaceChat.agentRunTimeline.test.tsx` 防 raw prompt / assistant_message 泄漏、保护无 provider event 时不虚构模型调用；Tauri driver/verifier 要求 provider event/ref 详情、普通对话 execution brief、角色设计 execution brief、正文质量 execution brief 均可见。 |
| 2026-07-01 | ProviderExecution public dependency 旧兼容入口收口。 | `Provider.Execution.dependency()` 与 `Execution.complete_fn/1` 不再接受裸一参函数或 keyword opts；DialogueGateway / Planner / TurnExecutionService 公开调用链只传 provider execution dependency。测试和 scenario invariant driver 改为显式 `%Provider.Execution{}` 或 `NovelTest.ProviderHelpers.provider_execution/1` 注入，避免把旧 `complete_fn` 形态保留为第二 provider 入口。 |
| 2026-06-29 | 登记 `AU11-creative-partner-conversational-voice`（Order 60）为 backlog 后续，不抢当前队首。 | 验证路由校准 + 消除「思考中」时观察到：trivial / 模糊输入（如「测试」）的对话回应偏系统诊断腔（「系统运行正常」），与愿景「作者面对可感知的创作伙伴」不符。这是提示词 / persona 层质量问题，与路由、AgentRun 主链、UI 阶段流正交，且受地板档模型限制，单列为后续，不混入当前 slice。 |
| 2026-06-29 | 切换队首到 `UA01-unified-agent-run-mainchain-closure`，并把 `SU01-provider-failure-matrix-live-vendor` 标为 blocked 后续。 | 用户明确要求按新验收口径逐 CP 检查 UA-01 主链；SU01 live vendor 需要真实账号/订阅凭据，本机无法闭环。审计启动时 UA-01 偏差定位为：CP5/CP6 只有文档登记；普通对话/正文主链仍可能是 run 外同步规划或 run 内单 step 包旧主链；前端 ack 后仍可能只显示“思考中...”。 |
| 2026-06-29 | `UA01-unified-agent-run-mainchain-closure` CP2 普通对话纠偏推进。 | `conversation_turn_v1` 已从单 step 黑盒改为 context / frame / strategy / finalize 四阶段 AgentRun flow；`agent-conversation-turn` 真实 Tauri 通过并记录 `steps=4`、`tool_calls=0`、`provider_calls=1`、无 `sync_turn` fallback。当时 CP5/CP6 仍未实现，下一步继续 CP4 正文 profile review 与 CP5/CP6 子 slice。 |
| 2026-06-29 | `UA01-unified-agent-run-mainchain-closure` CP4 修订 profile 纠偏推进。 | `revise_from_findings` 不再走 Channel 同步 `DialogueGateway` 旧主链，已新增 `prose_revision_from_findings_v1` bounded AgentRun：读取/校验修订对象、修订计划与授权、工具执行、最终候选汇总四步可见。局部测试与 driver/verifier 已更新；fresh Tauri summary 复跑被本地残留端口与 sandbox `Mix.PubSub :eperm` 阻断，不能标完整 CP4 done。 |
| 2026-06-29 | CP5/CP6 从 ADR 后续项拆成可执行子 slice 和 blocked quality scenarios。 | 新增 `UA01-CP5-durable-agent-run-resume.md`、`UA01-CP6-stream-cancel-readonly-batch.md`；当时新增 blocked scenarios `agent-durable-resume-long-run-task`、`agent-provider-streaming-progress`、`agent-provider-cancel-honest-boundary`、`agent-readonly-batch-profile`。该记录只代表当时任务设计和验收入口已登记，生产实现与真实 Tauri proof 尚未完成；后续同日 CP5 已由下一条记录闭环。 |
| 2026-06-29 | CP5 durable AgentRun + LongRunTask 已闭环。 | `agent-durable-resume-long-run-task` 从 blocked 转 active/nightly；真实 Tauri 验收证明 durable run 有 `long_run_task_ref`，backend restart 后从 checkpoint 广播 `run_resumed` / `agent_run_state`，stale resume 进入 `awaiting_author` 且不重复执行已完成 step。当时 CP6 streaming/cancel/read-only batch 仍未实现。 |
| 2026-06-29/30 | CP6 provider progress / ProviderExecution cancel / readonly batch 已闭环。 | `agent-provider-streaming-progress`、`agent-provider-cancel-honest-boundary`、`agent-readonly-batch-profile` 从 blocked 转 active/nightly 并通过真实 Tauri。该记录证明 author-safe checkpoint progress、ProviderExecution cancel 状态和 read-only batch；后续 live vendor 真实矩阵与更细前端流式体感继续由 `UA01-provider-execution-stream-unification` 承接。 |
| 2026-06-29 | 自然语言 steering 已闭环。 | `agent-natural-language-steer` 通过真实 Tauri：运行中主输入框 steering 文本发送为同一 active `run_id` 的 `agent_command steer`，广播 `plan_adjusted` 与 goal version 2，且 `no_second_user_message_for_steer=true`，不创建第二个作者 turn 或新 run。 |
| 2026-06-29 | `UA01-unified-agent-run-mainchain-closure` CP4 正文草稿 profile 继续加严。 | `prose_drafting_with_quality_v1` 已从三步加严为四步：正文上下文、策略/授权、正文生成+质量复核、最终汇总。driver/verifier 改为要求 context step、goal_understood、context observation 和 `steps=4`；fresh Tauri summary 已通过。 |
| 2026-06-30 / 2026-07-04 | 章节大纲 Agent Profile 先纯化为 next-step planner loop，后由 ADR-0023 CP3 升级为 plan-driven checkpoint。 | `agent-plot-outline-with-context` 最新真实 Tauri summary 记录 `plot_outline_with_context_v1` 已由 model-drafted AgentPlan + mechanical cursor 推进：计划包含 context 与 `plot_outline` 两步，工具 step 仍重新构造单动作 MicroPlan 并经过 Orchestrator gate，最终生成 tentative `outline_draft`，summary 记录 `steps=2`、`tool_calls=1`、`provider_calls=3`。 |
| 2026-06-30 / 2026-07-04 | 角色演化 Agent Profile 先纯化为 next-step planner loop，后由 ADR-0023 CP3 升级为 plan-driven checkpoint。 | `agent-character-evolution-with-context` 最新真实 Tauri summary 记录 `character_evolution_with_context_v1` 已由 model-drafted AgentPlan + mechanical cursor 推进：计划包含 context 与 `character_evolution` 两步，工具 step 仍重新构造单动作 MicroPlan 并经过 Orchestrator gate，最终生成 tentative `character_evolution_seed`，summary 记录 `memory_subtype=CURRENT_STATE`、`steps=2`、`tool_calls=1`、`provider_calls=3`。 |
| 2026-07-04 | 世界设定 Agent Profile 由 ADR-0023 CP3 升级为 plan-driven checkpoint。 | `agent-world-building-with-context` 与 `agent-world-building-style-rule-with-context` 最新真实 Tauri summary 记录 `world_building_with_context_v1` 已由 model-drafted AgentPlan + mechanical cursor 推进：计划包含 context 与 `world_building` 两步，工具 step 仍重新构造单动作 MicroPlan 并经过 Orchestrator gate；原始作者目标继续驱动 artifact type，最终分别生成 tentative `foreshadowing_seed` / `style_rule_seed`，summary 均记录 `steps=2`、`tool_calls=1`、`provider_calls=3`。 |
| 2026-06-30 | 正文草稿 Agent Profile 已迁到 next-step planner loop，并通过 fresh Tauri。 | `prose_drafting_with_quality_v1` 当时不再保留四步 fixed workflow：context observation → planner decision → 单动作 MicroPlan → Orchestrator gate → `prose_writing` writer/evaluator provider execution → quality/artifact observation → completion decision。Tauri driver/verifier 已加严为要求 provider activity / usage UI 可见；当时 fresh `agent-prose-drafting-with-quality --surface tauri` 已通过，summary 记录 2 steps / 1 tool / 六次 provider call。当前已由 2026-07-04 ADR-0023 CP1 继续迁到 model-drafted AgentPlan + mechanical cursor，最新 routed Tauri 口径为 2 steps / 1 tool / 4 provider calls。 |
| 2026-06-24 | `SU01-provider-vendor-matrix-openai-minimax-zhipu-kimi-gemini` CP1 闭环，**本轮用户反馈产品问题队列（编号 9-17，6 个 slice）全部闭环**，无新队首。 | 用户反馈 15（新增 OpenAI/Minimax/智谱/Kimi/Gemini 供应商矩阵）。审计确认现有 provider 抽象已对 registry 泛化（web/application 的 options/models/config/test 零改动），扩展点是 Gateway 注册 + 前端 ProviderId 联合 + Rust secret 白名单 + config 默认。实现：新增 `NovelAgent.Provider.OpenAICompatible`（`__using__` 宏共享 `complete/health_check/list_models/from_config`，Bearer/`/chat/completions`/`/models`/错误归一）+ 6 个 ~10 行 vendor adapter（不 6× 克隆 DeepSeek）；OpenAI 的 API Key 与订阅以两个独立 vendor id（`openai`/`openai_subscription`）区分（独立 secret/endpoint/label/redaction，契合既有单 secret per provider 基础设施，KISS）；`config.exs` 提供 env 可覆盖默认；`modelProvider.ts` 扩展 ProviderId 联合与归一化，UI 从后端 registry 自动渲染（前端不写死）+ 订阅认证方式 hint；Rust `MODEL_PROVIDER_IDS` 扩展到 10 id，单测锁定两认证方式 secret 隔离。真实 browser-side Playwright driver `su01-provider-vendor-matrix` + 本地 OpenAI 兼容 `/v1/models` fixture（生产 adapter 经可配置 endpoint 发真实 HTTP，无需 fixture 注入 env）证明：6 新供应商来自后端 registry、订阅 hint 可见、test-fail 不切换 runtime/不建 turn、保存后两认证方式独立且 fake key 不进 options/UI/浏览器 settings/业务日志/backend log。后端 `openai_compatible_test`/`gateway_test` 矩阵用例 + agent 93/web 94/Rust 7 全绿 + I1/I2/I3 + arch_check + 前端 320 + audit/design-trace + manifest 全绿。**诚实未闭环**：live vendor 真实云端失败矩阵 + OpenAI 订阅 OAuth 登录传输（需真实账号，登记 SC-SU01-B3 P1 后续，不冒充）。坑：改 endpoint `onChange` 清空模型列表→恢复 endpoint 须重新加载/选模型再保存（否则保存 disabled）；失败 UI 直接展示后端原因（connection refused→「无法连接 OpenAI」）断言不能只匹配「连接不可用」；驱动需在 verifier 注册 evidence + behavior 两个 handler（缺 behavior 则 180s poll 超时）。 |
| 2026-06-24 | `AU09-memory-list-ux-redesign` 闭环，队首推进到 `SU01-provider-vendor-matrix`（用户反馈队列最后一项）。 | 用户反馈 14（记忆页列表字体/行色/扫描体验需按全局调性重构）。根因：`MemoryListPage.module.css` 整页硬编码深色 hex，与全局浅色 workbench（`--bg:#fcfaf7` cream / `--foreground-primary:#000` / `--accent:#ff9800`）冲突，状态/范围显示原始枚举无语义。改：CSS 全量改用全局 token；新增纯函数 `memoryListView.ts` 把状态映射成语义 tone（confirmed/stabilized/draft/conflicted/terminal，颜色服务真实状态非装饰）；列表用中文标签 + 状态徽标 + 新增「召回」列（终态强制不召回，与 §4.5 召回过滤一致）+ 终态行降权；文案集中 `copy.ts`；设计追溯 header 指向 `40-ui-overview`。真实 Tauri 截图证明：浅色调（bg=rgb(252,250,247)）、状态「已确认/已弃用」非枚举、类型/范围标签、逐行召回值、终态弱化、无重叠。同步修复并复跑既有 `au09-memory-management-filter-matrix` driver 的 placeholder/loading 断言（详情抽屉仍显示原始 status，trace/entry driver 不受影响）。前端 typecheck/lint/test（+memoryListView 单测）/audit/design-trace + static-scan 全绿。 |
| 2026-06-24 | `AU09-memory-taxonomy-write-policy` CP1 闭环，队首推进到 `AU09-memory-list-ux-redesign`（解除 Order 56 阻塞）。 | 用户确认范围（冻结契约 + 角色演化记忆写入路径 + Tauri 验收）。`06-memory-context-and-trace.md §4.5` 冻结实现层写入治理：各 artifact→MemoryType 映射、何时写/不写、角色主档案 vs 角色演化记忆边界、更新/supersede/deprecate/archive + 召回过滤。新增 `character_evolution` 能力 + `character_evolution_seed` artifact（`creative_artifact_types`/`CapabilityRegistry`/`ToolAdapterRegistry`/`@creative_tools`），采纳写角色记忆（CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP，按 `memory_subtype` 结构化或内容兜底分类）非 Character 主档案；planner 与 provider 区分“设计角色”vs“更新/演化角色”。真实 Tauri 证明：设计角色→主档案不写记忆、记忆页无角色记忆；更新当前状态→采纳写「当前状态」角色记忆、记忆页按类型展示且保留本轮 nonce（因果绑定）。后端 domain/contract/persistence/agent 测试 + I1/I2/I3 + 全门禁绿。修复 `@creative_tools` 漏注册致工具拿不到 provider 的 `complete_fn_required`。 |
| 2026-06-24 | `AU12-archive-concurrent-model-run-read-snapshot` 闭环，队首推进到 `AU09-memory-taxonomy-write-policy`。 | 用户反馈 11（模型执行期间打开作品档案空白）双重根因：① StructurePanel 被条件渲染（`{!isPanelOpen ? rail : panel}`）→关闭即卸载→重开 state 重置丢快照；② 打开即 `setProfile(null)`、读失败 `setBlank`、无 loading 指示；③ Phoenix channel 串行，`user_message` 同步跑模型 turn 阻塞 archive 读。前端修复=StructurePanel 常驻挂载（关闭自渲染 null，state 跨开/关保留）+ 只在 workId 变才清空 + `archiveLoading`/`archiveError` 诚实状态条 + 读失败保留上次内容（概览仅无快照时降级为读取失败提示，保留 `au12-profile-read-failure-degrade`）。真实 Tauri 证明执行期间打开档案显示「题材/核心卖点」立项快照（非空白）+「正在更新作品档案」诚实指示，开档案不产生 user_message/author_action（只读 no-write），turn 完成后刷新。channel 并发实时刷新（后端异步化）与 AU-10 异步 LongRunner 同属已延后后端项，诚实登记为后续。后端全门禁 + I1/I2/I3 绿。 |
| 2026-06-24 | `AU09-character-candidate-per-item-adoption` 闭环，队首推进到 `AU12-archive-concurrent-model-run-read-snapshot`。 | 用户反馈 10 的根因是采纳授权粒度 bug：`AvailableActionBuilder`/`turn_result_builder` 按 artifact_set 生成单一 accept（target_ref=artifact_set_id），2 候选只有 1 个采纳按钮，采纳时合并成一个 Character。新增纯函数 `TentativeArtifactSet.adoptable_units/1` 把多候选 `character_seed` 分解为逐候选独立采纳单元（artifact_id=`set::item`），builder/available_actions 逐单元生成 pending + accept/discard/edit，前端按钮文案附候选名区分；`AdoptionWorkflow`/`AdoptionRepository` 采纳契约零改动（按 artifact_id 查 pending，条目现含单 item）。`outline_draft` 等多 item 属同一产物保持整体采纳。真实 Tauri 证明一轮 2 候选→2 采纳按钮→采纳第二个只写第二个 Character、第一个保留按钮且未入已确认角色、档案仅 1 个已确认角色。后端逐候选采纳测试 + slice_verify 2 候选测试 + I1/I2/I3 + 全门禁绿。 |
| 2026-06-23 | `AU09-character-role-taxonomy-protagonist-policy` CP1 闭环，队首推进到 `AU09-character-candidate-per-item-adoption`。 | 契约门定案：主角 = Character 的结构化叙事角色（`narrative_role` 枚举，用户确认，支持群像），不是立项字段也不只是关系。落地全链路：`NarrativeRole` codegen 枚举 + Character domain/schema/migration + item→artifact→adoption→Character→roster；`CharacterRosterNarration` 主角感知（无主角诚实报缺口、不把第一个角色默认当主角、群像聚合）；planner 与 slice_verify/stub/real provider 区分“主角是谁”只读查询 vs “设计主角”创建。真实 Tauri driver 证明：无主角→诚实缺口且 no-write；设计主角→结构化 PROTAGONIST 经采纳边界写 Character；档案角色 tab 显示“主角”标签；再问主角→可校验回答且 no-write。后端四类覆盖 + I1/I2/I3 + 全门禁绿。 |
| 2026-06-23 | 登记用户反馈 9-17 为 6 个 slice，并将队首切到 `AU09-character-role-taxonomy-protagonist-policy`。 | 这些反馈跨 AU-09、AU-12、SU-01 和 AU-10，但共同指向当前真实产品体验缺口。角色类型/主角语义影响“主角设定”“主角是谁”两类错误响应，也会影响后续角色候选采纳和角色记忆边界，因此作为第一队首；旧 `E2E01-p1-replay-report` 已由 `E2E01-file-level-closure` 后续记录证明关闭，不再保留 `next`。 |
| 2026-06-21 | `E2E01-p1-replay-report` checkpoint 闭环，本轮 SU-01 → E2E-01 文件级闭环达到当前交付状态。 | E2E-01 当前为 10/13 已验收、2/13 已测试、1/13 部分实现。E9 通过真实 Tauri 工作台发起 `character_roster` 低风险只读 tool，外部查询持久 `DecisionTrace` 并由 `ReplayService.build_report/1` 生成 no-provider ReplayReport；summary 证明 frame/plan/decision/tool_trace/turn_result 链与 VS-06 六问完整。`quality_accept.sh e2e-01-replay-report --surface tauri --provider lmstudio` 与 `quality_accept.sh e2e-01-full-chain --provider lmstudio` 均通过；剩余为 P2 Channel security regression。 |
| 2026-06-21 | `E2E01-p1-readonly-tool-trace` checkpoint 闭环；后续队首曾为 `E2E01-p1-replay-report`。 | E2E-01 当时为 9/13 已验收、2/13 已测试、2/13 部分实现。E6 通过真实 Tauri 工作台发起 `character_roster` 低风险只读 tool，证明 orchestrator allow、toolbox succeeded、UI no-write/no-action、当前作品 accepted character 可见、tentative/foreign character 不泄漏，并经 `TraceRepository.list_by_turn/1` 回查结构化 `tool_trace_refs`。`quality_accept.sh e2e-01-readonly-tool-trace --surface tauri --provider lmstudio` 与 `quality_accept.sh e2e-01-full-chain --provider lmstudio` 均通过；后续 E9 已在同日闭环。 |
| 2026-06-21 | `E2E01-file-level-closure` 完成文件级对账、E10 checkpoint、聚合 runner checkpoint 与 E4 真实页面 downgrade checkpoint；当时后续队首为 `E2E01-p1-readonly-tool-trace`。 | E2E-01 旧“11/13 完整 + 2/13 部分”已更正为当时的 8/13 已验收、2/13 已测试、3/13 部分实现；E10 由 `DialogueGateway.handle_input` 注入真实 `WorkspaceContext.trace_persister/0` 后经 SQLite `TraceRepository.list_by_turn/1` 回查闭环。`e2e_aggregate` 已通过 `quality_accept.sh e2e-01-full-chain --provider lmstudio`，E4 通过 `quality_accept.sh e2e-01-downgrade-real-page --surface tauri --provider lmstudio`；当时剩余 P1 为指定低风险只读 tool dispatch + trace query、完整 ReplayReport 六问，后续 E6/E9 已在同日闭环。 |
| 2026-06-21 | `AU12-file-level-closure` 闭环，当前按用户指定顺序进入 `E2E-01-file-level-audit`。 | `au12-work-profile-overview` 与 `au12-work-profile-status-isolation` 已挂入真实 Tauri / quality acceptance，覆盖 works 立项概览显示侧、accepted/tentative 状态、空字段、tab 导航、跨作品隔离、no-write 和 UUID 脱敏。A2 prompt 同源为实现/测试约束，读取失败降级和 correction 修订意图登记为 P1/P2 后续，不阻塞进入 E2E-01。 |
| 2026-06-21 | `AU09-file-level-closure` 闭环，当前按用户指定顺序进入 `AU10-file-level-audit`。 | 8 个 AU-09 当前 Tauri 场景已挂入 `quality_accept.sh --surface tauri` 并用于文件级矩阵：记忆创建确认召回、管理入口、生命周期终态排除、trace、伏笔/规则 adoption、角色主档案、有效期窗口、跨作品隔离、AU-03 会话/记忆分层。剩余 archive stats、pending inbox、筛选分页、developer replay、历史旧 turn、Channel 管理入口和完整 MemoryTrace/StateTrace 登记为 P1/P2。 |
| 2026-06-21 | `AU08-file-level-closure` 闭环，当前按用户指定顺序进入 `AU09-file-level-audit`。 | 5 个 P1 Reading Projection 场景已挂入 `quality_accept.sh --surface tauri` 并复跑通过；采纳正文、编辑后采纳、未采纳不入阅读、跨作品隔离、多章导航、空章诚实显示、短章 audit、导出和 STALE banner 均有当前真实 Tauri evidence。剩余 projection refresh 专用 action/no-write driver、REBUILDING/FAILED 状态来源、返回工作台上下文、只读 no-write 专项和离线降级登记为 AU-08 P1 后续。 |
| 2026-06-21 | `AU07-behavior-trace-terminal-replay` checkpoint 闭环，AU-07 文件级 P0 关闭，当前按用户指定顺序进入 `AU08-file-level-audit`。 | `au07-trace-why-entry` 已恢复当前 why 入口，`au07-state-trace-adoption-replay` 已证明 StateTrace/adoption/projection replay producer，`au07-behavior-trace-terminal-replay` 已证明 cancel waiting terminal close/resolution refs 可回放；剩余旧 turn trace 查询 API/UI、developer 双视图、ToolTrace registry snapshot、ReplayReport 六问和 work/session 查询隔离登记为 P1 后续。 |
| 2026-06-18 | `AU10-workbench-recovery-longrunner-CP3C` 延后，当前队首切到 `AU09-archive-memory-roundtrip`。 | `docs/design/04a-planning-and-long-run.md` 已确认异步 LongRunner 没有真实生产消费者；用户决策先铺产品功能广度。AU09 伏笔/规则档案链路有真实 StructurePanel 入口、`world_building` artifact contract 和 adoption/memory/read-model 消费者，更符合承重 slice 规则。 |
| 2026-06-18 | `AU09-archive-memory-roundtrip` 先补 CP1，不直接宣称完整 AU09 闭环。 | 当时已补 `world_building` prompt 与 `world_setting` governed memory 分类，并复用/收紧 `au09-adopt-setting-recall` 证明真实页面 adoption/recall/why；采纳后档案 tab 即时刷新矩阵在 CP1 时尚未覆盖。 |
| 2026-06-18 | `AU09-archive-memory-roundtrip` CP2 闭环，队首推进到 `AU09-memory-management-workbench-entry`。 | 当时同一 Tauri driver 已从真实「新增伏笔」「新建规则」入口生成并采纳 `world_setting` artifact，采纳后按语义分类为伏笔/规则 governed memory；重开伏笔/经验规则 tab 均可见，且后续 recall/why 解释引用来源。此 artifact type 口径已在下一条根据用户反馈纠偏；AU09 整体当时仍缺正式记忆管理入口与生命周期状态治理，因此下一步继续同一 journey。 |
| 2026-06-18 | 纠偏 `world_building` 输出类型：伏笔/规则不再默认归到 `world_setting`。 | 用户指出“当前把伏笔归到 world_setting”。现已将 tentative artifact contract 扩展为 `foreshadowing_seed` / `world_rule_seed` / `style_rule_seed` / `constraint_seed`；`world_setting` 只保留普通世界观设定和历史兼容，adoption 直接按显式类型写入 governed memory。 |
| 2026-06-18 | `AU09-memory-management-workbench-entry` checkpoint 闭环，队首推进到 `AU09-memory-trace-roundtrip`。 | `au09-memory-management-entry` 已证明真实工作台头部「记忆」入口、创建 DRAFT、确认 CONFIRMED、锁定后仍可召回且终端动作禁用、解锁后废弃、另建并归档记忆，以及 terminal memory 不再进入后续 context/why 内容。AU09 整体仍缺 MemoryTrace/StateTrace、reference log 聚合、有效期、跨作品隔离和 AU-03 会话分层，因此下一步补 trace/replay 可解释链路。 |
| 2026-06-18 | `AU09-memory-trace-roundtrip` checkpoint 闭环，队首推进到 `AU09-validity-window-recall`。 | 后端已记录 create/confirm/lock/unlock/deprecate/archive lifecycle trace，并拒绝 locked terminal action 且写 blocked trace；记忆详情通过正式 references API 展示“引用与治理追溯”；`au09-memory-trace-roundtrip` 真实 Tauri 证明 locked 记忆仍可召回、terminal 记忆后续不进 context/why。AU09 下一缺口是有效期窗口参与 ordinary recall。 |
| 2026-06-18 | 复核发现 `AU09-validity-window-recall` 代码、测试和 driver 已存在；复跑 checkpoint 闭环，队首推进到 `AU09-cross-work-memory-isolation`。 | `MemoryRecallRepo` 已按当前作品已采纳章节最大 seq 过滤 `valid_from` / `valid_until`，`memory_recall_repo_test` 6 测通过；`au09-validity-window-recall` 真实 Tauri 证明窗口外记忆不进入 context/why。AU09 下一缺口是跨作品记忆隔离，避免另一部作品 memory 污染当前 Work。 |
| 2026-06-18 | `AU09-cross-work-memory-isolation` checkpoint 闭环，队首推进到 `AU09-AU03-session-memory-layering`。 | 外部 Tauri 证据证明真实工作台从作品 A 切到作品 B 后，作品档案伏笔/规则、记忆管理页、ordinary recall 和 why 均只消费 B 的 governed memory；后端 repo/service 测试补 foreign memory id 的 get/update/confirm/references not_found 边界。AU09 下一缺口是与 AU-03 active/historical session 分层对齐。 |
| 2026-06-18 | `AU09-AU03-session-memory-layering` checkpoint 闭环，队首推进到 `AU11-quality-diagnosis-message-envelope`。 | 外部 Tauri 证据证明真实工作台打开历史只读会话后返回 active session，下一轮 `current_work` / `session_transcript` / `memory` 三类 context refs 与 why 分层，历史 transcript 不进入 session 或 memory source。按 `SCENARIO-BLUEPRINT.md` §4 / §7，下一 P0 是 AU11/VS-00D 质量诊断 message envelope，从 docs-ready contract 推进到真实工作台 trace proof。 |
| 2026-06-18 | `AU11-quality-diagnosis-message-envelope` checkpoint 闭环，队首推进到 `AU11-missing-workstate-policy`。 | 新增 application 层 `AIMessageEnvelope` 过渡 builder，Planner prompt、`DialogueFrame.evidence_summary` 与 `trace_summary.ai_message_envelope` 共用同一三层结构；why 面板展示质量诊断、质量门、作品层来源/缺失摘要。真实 Tauri + quality_accept 证明质量诊断输入 no tool/adoption/write。AU11 下一缺口是 SC-AU11-02：缺当前作品上下文时不编造。 |
| 2026-05-21 | 建立 `tasks/NEXT.md` 作为唯一任务入口，当前 focus 锁定 AU-03。 | 解决 AI 每轮从台账随机挑任务的问题，把推进方式从“能闭环就做”改成“沿当前用户旅行图连续推进”。 |
| 2026-05-21 | 对账 `user-journeys.md` 与实际代码后，保持队首为 `AU03-branch-from-history`。 | `WorkSessionService.create/2` 和 `WorkSessionsController.create/2` 已提供 source refs 的 API 局部能力，但 `frontend/src/lib/sessions.ts` / `WorkspaceChat` 没有 create session helper 或“从这里继续”入口，且无 `au03-branch-from-history` Tauri 证据。 |
| 2026-05-21 | `AU03-branch-from-history` 已闭环，队首推进到 `AU03-archive-session-filter`。 | 原生 Tauri 证据证明真实工作台从历史 transcript 点击继续后创建新 active session，并保留旧会话/旧 turn 来源引用，旧 transcript 未复制到新 session。 |
| 2026-05-21 | `AU03-archive-session-filter` 已闭环，队首推进到 `AU03-current-work-context-ssot`。 | 原生 Tauri 证据证明真实工作台可归档历史会话、默认列表隐藏、显式搜索仍可找回并只读打开；persistence/application 测试证明普通 context 默认排除 archived session transcript。 |
| 2026-05-21 | `AU03-current-work-context-ssot` 已闭环，队首推进到 `AU03-long-session-compression`。 | 原生 Tauri + LMStudio 证据证明真实工作台先打开历史只读 transcript、返回 active session 后发送下一轮，Planner prompt 使用最新 Work 背景 + 当前 active session transcript，旧历史 session transcript 未覆盖当前作品事实。 |
| 2026-05-21 | `AU03-long-session-compression` 已闭环，队首推进到 `AU03-context-source-ui`。 | Persistence/Application 测试与原生 Tauri + LMStudio 证据证明超过窗口的旧 turn 进入 session summary，Planner request messages 只保留 early summary + 最新 transcript 窗口，未把旧 turn 原文塞入 prompt。 |
| 2026-05-24 | `AU03-context-source-ui` 已闭环，当前 focus 从 AU-03 转入 AU-02/AU-05 候选采纳桥接。 | 原生 Tauri 外部 UI driver 证明普通回复 why 面板显示 current work / recent dialogue / memory 三类 author-safe 来源摘要，且不暴露 raw prompt；Journey B 当前连续前缀已闭环到 B11，下一最高杠杆断点是 C6/F 的 selection/adoption 边界。 |
| 2026-05-24 | `AU02-candidate-adoption-bridge` 已闭环，队首推进到 `AU05-adoption-safety-freshness`。 | 原生 Tauri 外部 UI driver 证明真实工作台先点击候选继续探索，再点击服务端授权的“采用这个方向”，`author_action.choose_candidate` 进入 `AdoptionBoundary` 并返回 `adopt_tentative`；下一风险是高风险、stale、conflict、cross-work 采纳安全。 |
| 2026-05-24 | `AU05-adoption-safety-freshness` 的高风险 confirmation checkpoint 已闭环，队首推进到 stale / conflict / cross-work freshness。 | 原生 Tauri 外部 UI driver 证明真实工作台输入高风险候选并点击“采用这个方向”后，服务端授权 `choose_candidate` 进入 `AdoptionBoundary`，返回 `require_confirmation` / `needs_confirmation`，UI 显示“候选方向待确认”，`candidate_adopted=false` 且 `production_write_performed=false`。Application 回归已覆盖 cross-work rejection，但真实 UI 场景仍需后续闭环。 |
| 2026-05-24 | `AU05-stale-conflict-cross-work-freshness` 的 stale restored candidate checkpoint 已闭环，队首推进到 conflict / cross-work recovery。 | 原生 Tauri 外部 UI driver 证明真实工作台从持久化 transcript 恢复出 stale candidate 后，作者点击“采用这个方向”，服务端授权 `choose_candidate` 经 `AdoptionBoundary` 返回 `reject`，UI 显示“候选方向未采用”，`candidate_adopted=false` 且 `production_write_performed=false`。剩余 canon conflict 与跨作品旧 action 仍需真实 UI 验收。 |
| 2026-05-24 | `AU05-conflict-cross-work-recovery` 的 cross-work checkpoint 已闭环，队首推进到 canon conflict recovery。 | 原生 Tauri 外部 UI driver 证明真实工作台从当前作品 transcript 恢复出其它作品来源候选后，作者点击“采用这个方向”，服务端授权 `choose_candidate` 经 `AdoptionBoundary` 返回 `fail_with_recovery`，UI 显示“候选方向采用失败”，`candidate_adopted=false` 且 `production_write_performed=false`。剩余 canon/revision conflict 仍需真实 UI 验收。 |
| 2026-05-24 | `AU05-canon-conflict-recovery` 的 canon conflict checkpoint 已闭环，队首推进到 `P1-chapter-plan-minimum`。 | 原生 Tauri 外部 UI driver 证明真实工作台恢复出带结构化 `canon_conflicts` 的“年龄设定覆盖”候选后，作者点击“采用这个方向”，服务端授权 `choose_candidate` 经 `AdoptionBoundary` 返回 `fail_with_recovery`，reason_codes 包含 `canon_conflict_detected` / `conflict_recovery_required`，UI 显示“候选方向采用失败”，`candidate_adopted=false` 且 `production_write_performed=false`。下一步按 `docs/product/novel-output-milestones.md` 转向 P1 长篇产出主链的章节计划最小闭环。 |
| 2026-05-24 | `P1-chapter-plan-minimum` 已闭环，队首推进到 `P1-chapter-draft-generation`。 | 原生 Tauri 外部 UI driver 证明真实工作台从作品档案“大纲与结构”点击“开始规划”，发送带 micro plan 的章节大纲请求，`plot_outline` 生成 12 章 `outline_draft`，作者点击真实“采纳”后经 `AdoptionBoundary` 持久化为作品档案章节计划；`outline_draft` 不 materialize Reading Projection，作品档案 `get_chapter_plans` 可读取并显示首章和终章标题。 |
| 2026-05-24 | `P1-chapter-draft-generation` 已闭环，队首推进到 `P1-chapter-adoption-reading`。 | 原生 Tauri 外部 UI driver 证明真实工作台从已采纳章节计划点击第 1 章“生成正文草稿”，发送带 micro plan 的正文请求，`prose_writing` 生成 `prose_fragment` 待采纳正文草稿；UI 显示“正文草稿待采纳”，未发送 adopt 事件，ReadingMode 在采纳前为空且未泄漏正文草稿。 |
| 2026-05-29 | `P1-chapter-adoption-reading` 闭环，并补齐 `edit_then_accept`、覆盖确认重新 gate（B1/B2）。 | 真实 accept 接通采纳持久化（纠正空兜底高估）；采纳三元组 + 覆盖确认；两 provider Tauri 通过。 |
| 2026-05-30 | AU-09 记忆召回端到端（create / adopt-setting / validity-window）闭环；code-review 回归（behavior_state 形状、章节身份 A2–A6）修复。 | 见 `docs/project-ledger.md` 对应条目。 |
| 2026-05-31 | `P1-word-count-audit` checkpoint A 闭环，队首推进到 checkpoint B/C（重复/缺章）。 | `NovelDomain.ProseAudit` + `NovelMilestone` 审计层；`ReadingProjectionRepo.toc` 附 audit；ReadingMode 标记短章/空章 + P1 达标进度；确定性 Tauri 验收 `short_chapter_marked=true`、`milestone_met=false`（168 字短章）。后端 631 + 全门禁绿。 |
| 2026-05-31 | 质量门禁收敛（word-count B/C）放后，新焦点 `P1-chapter-expansion`：单章续写累积到达标，数据流地基已就位。 | 字数审计暴露"全是短章"，根因是采纳把章/场景塌缩成单场景 + 缺续写产出。续写累积对齐 v2 21 §6.6/ADR-0004；意图识别走 v3 DialogueFrame/Planner（AI 非关键字），意图作为 artifact provenance 顺现有数据流。本轮完成数据流地基（plan→artifact provenance→采纳 append/overwrite），后端 635 绿；未闭环：Planner 真实 LLM 识别 + Tauri（队首仍为本 slice）。 |
| 2026-06-01 | `P1-chapter-expansion` checkpoint 1 闭环。 | Planner 现从自然语言识别续写/重写意图 + 目标章（章节上下文经 6 元组 fetcher 注入 plan prompt，LLM 精确复制已采纳章节标题），续写采纳为同章新场景累积、不 supersede；重写走覆盖确认兜底。确定性 Tauri：初稿 168 → 2 轮续写 → 单章累积 1302、短章翻达标。`--real-lmstudio`（gpt-oss-120b）：初稿 672 → 真实 LLM 两轮均识别 continuation → 单章累积 1509、4×POST 全 200。两证据 `artifacts/slice-verify/p1-chapter-expansion-tauri{,-lmstudio}/summary.json`。 |
| 2026-06-04 | 队列重排：质量护栏（repetition-gaps）从队首后移，**先做主链 checkpoint 2 续写连贯 + checkpoint 3 连续多章**。 | 用户决策 + 设计依据：repetition/短章审计属小说 `quality_gate`→`quality_finding`→policy（v2 31 / v3-quality-gates §4），当前短章审计已是错位的 reading-projection 派生字段（设计债 F1），repetition 若照搬会加深 F1。v3-quality-gates §4.2 明确「完整质量门禁应在主链稳定后才铺开」。且 checkpoint 1 暴露续写易重复/另起（确定性两轮近重复、真实 LLM 也会漂），根因是 prose_writing 不带本章前文——连贯性是 repetition 门会暴露的根因，应先治根（连贯），再立护栏（独立 creative-quality slice）。 |
| 2026-06-04 | `P1-chapter-expansion-continuity`（checkpoint 2）闭环，队首推进到 `P1-chapter-expansion-multichapter`（checkpoint 3）。 | prose_writing 续写/重写时上下文带入目标章已采纳正文（v2 28「基于前文」）：`ReadingProjectionRepo.accepted_chapter_prose/2` 读端口 + `persistence_chapter_prose_reader` 注入 + `TurnExecutionService` 拼前文 section + observability 事件 `turn_execution.continuation_context.done`。**关键健壮性修复**：真实 LLM 能识别 continuation 意图但常漏 `target_chapter`，故目标章改由应用层用 `DialogueContext.current_chapters` 确定性解析（命中用之，否则回退最新章），并把解析结果同时用于读前文与采纳归章，二者一致。确定性 Tauri 累积 1290、`--real-lmstudio`（gpt-oss-120b）491→1637，两者 `prior_prose_context_events=2`、真实 prose_writing 请求含「本章已采纳正文」。后端 216 测试绿 + 9 新测试。 |
| 2026-06-10 | `P1-chapter-expansion-multichapter`（checkpoint 3）闭环，队首推进到 `P1-export-minimum`；质量护栏（19）按「质量放后」延后。 | 新 slice `p1-chapter-expansion-multichapter`：作者对话框逐章自然语言推进第 1/2/3 章首稿，各章正文按 target_chapter（真实 LLM 从列表精确复制）/artifact 标题（确定性）归到各自计划章、不串，阅读目录显示完整 12 章计划且 3 章按 seq 有序有正文。确定性各 ~135 字、`--real-lmstudio`（gpt-oss-120b）各 537/477/571 字，两 provider Tauri 通过。**顺带修既有 P0**：require_confirmation 的 user turn 持久化时 `Interaction.content`（Ecto :map）内嵌 `MicroPlan` struct → `Ecto.ChangeError` 崩 GenServer（此前只有 author_action confirm 被测、user turn 直接 require_confirmation 未覆盖）；`DialogueGateway.jsonable/1` 深度 struct→map 规范化 + 回归单测。后端 223 测试绿 + I3/I1/I2 全过。 |
| 2026-06-10 | 插队工作（不在主队列，借「降 AI 味」提示词 + harness 修复）。 | plan-minimum 复活 + overwrite-confirm 对齐 toc 语义（`53c7d9b`）；prose_writing 写作质量约束 Slice A（`ceefa60`）；目标字数结构化创作槽 Slice B checkpoint 1（`4959943`，新 slice `p1-chapter-word-count-target`）。降 AI 味分析性验收结论见 memory：对白手法显著、反套话黑名单照搬截图未对准本地模型指纹，按「本地模型先聚焦功能」延后。 |
| 2026-06-12 | `P1-100k-dogfood-run`（Order 21）**P1 里程碑达成**：115,274 有效字 / 90 章全 ≥1000 / 审计全 ok / 导出 390KB 完整 90 章目录有序 / 抽查 0 泄漏 0 重复。 | 放大跑暴露并修复两个真实产品缺口：① 真实 LLM 长上下文偶发非法 JSON（字符串内裸换行）→ `CreativeProvider.Real` 增加坏 JSON 纠错重试（与 Planner frame retry 同模式，3 单测）；② **续写前文注入无长度上限** → LM Studio n_ctx=4096 下 ~1000 字章的续写请求 HTTP 400（`n_keep 4264 >= n_ctx 4096`），任何达标章永远无法续写 → `prior_prose_section` 裁剪到末尾 2000 字并标注省略（修复后 21 个滞留章连续零失败补齐）。运维教训：狗粮数据在共用 test DB，`tauri_slice_verify.sh` cleanup 会重置——长跑期间禁跑 slice 验收（基建改进项：狗粮独立 DB）；LM Studio 建议 n_ctx ≥8192；6 小时高负载后模型输出会暂时退化（停跑喘息可恢复）。质量观察（非阻断）：8/90 章标题无「第NN章」编号前缀（目录 seq 仍有序）；连续性/重复段自动检测归 Order 19（deferred）。 |
| 2026-06-12 | P0 插队：`AU10-workbench-matrix-layout` 成为当前 next。 | 用户指出 `WorkspaceChat` / `历史旁路工作台` 的问题并未解决。当前已退役删除 `历史旁路工作台` / `历史旁路 socket helper` 旁路，`WorkspaceChat` 成为唯一生产工作台入口；下一步补 AU-10 专属 matrix/layout Tauri 验收和截图暴露的真实 viewport 问题。 |
| 2026-06-17 | `AU10-workbench-matrix-layout` baseline checkpoint 已闭环，队首推进到 `AU10-workbench-recovery-taskstate`。 | 原生 Tauri 外部 driver 在 1280×800 真实工作台完成普通聊天 no-MicroPlan、why 弹窗、候选授权 action、正文草稿采纳、Reading Projection 与任务状态首屏基线；但仍未覆盖长任务全过程、断线、超时和失败恢复，因此 AU-10 整体不得标 complete。 |
| 2026-06-17 | 修正队首：AU10 recovery 延后，当前回到 VS-00C CP 序列，CP3 已闭环，队首为 CP4。 | 用户明确要求“做完所有 CP，才能转到下一个任务”。CP3 已有真实 Tauri 证据 `vs00c-cp3-structured-context`，证明第 2 章首稿从真实档案入口发起，prose_writing 前拿到目标章计划摘要、seq 和前后章位置；CP4/CP5 仍是首稿高质量方向层所需前置，不能被 AU10 recovery 插队。 |
| 2026-06-17 | `VS-00C-CP4-chapter-plan-structure` 已闭环，队首推进到 CP5 ReaderEffectBrief。 | CP4 已把 outline 规划产物解析并物化为 `chapters.plan_direction`，prose_writing 前的 `context.structure.done` 可证明 `has_plan_direction=true`；下一步补读者效果目标和自报告质量线索。 |
| 2026-06-17 | `VS-00C-CP5-reader-effect-brief` 已闭环，队首回到 `AU10-workbench-recovery-taskstate`。 | CP5 的 Tauri 证据证明 ReaderEffectBrief 在 provider 调用前形成，prose_writing 输出携带非权威 self_report 且不进入作品事实；VS-00C CP0-CP5 序列已完成，按用户要求转回下一个任务 AU10 recovery。 |
| 2026-06-17 | 插队修复续写阅读面泄漏系统场景占位标题，队首仍保持 `AU10-workbench-recovery-taskstate`。 | 用户指出续写章节出现“场景 2 / 场景 3”。根因是续写 append 的内部 scene title `场景 #{seq}` 被 ReadingMode 展示；修复为隐藏系统占位标题、保留有意义场景标题，并收紧 prose_writing prompt 禁止正文元标签。Tauri 复验 `p1-chapter-expansion` 已通过，证据 `artifacts/slice-verify/p1-chapter-expansion-tauri/summary.json` 包含 `scene_placeholder_titles_hidden=true` / `reading_mode_hides_generated_scene_placeholder_titles`，不改变当前功能队列。 |
| 2026-06-17 | `AU10-workbench-recovery-taskstate` checkpoint 已闭环，队首推进到 `AU10-workbench-recovery-disconnect-timeout`。 | 原生 Tauri 外部 driver 通过真实工作台生成并采纳正文、进入阅读模式点击“导出全书”，证明 websocket `task_state` RUNNING / CHECKPOINT / COMPLETED 到达 UI 且返回工作台后“任务完成”可见；Channel 回归覆盖导出失败时 FAILED 广播。该 checkpoint 不覆盖 WebSocket 断线重连、LLM 超时/取消等待或完整异步 LongRunner streaming。 |
| 2026-06-17 | `AU12-work-profile-overview` 当时暂登记为 AU10 recovery 之后的后续项。 | AU-12 设计指出 `works` 立项字段已进入 prompt 但作者无法在作品档案核对；当时用户决策是不插队 AU10 recovery。该决策已被下一行“先完成 AU12”的队列调整覆盖。 |
| 2026-06-17 | 用户调整任务队列，先完成 `AU12-work-profile-overview`；队首随后回到 AU10 recovery。 | 新增 `WorkArchiveService.profile/1` / Channel `get_work_profile` / StructurePanel「概览」tab / 外部 Tauri driver。证据 `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json` 证明真实工作台作品档案可显示 works 立项字段、状态为待确认，且 DTO/UI/业务日志不泄漏内部 Work UUID。当时 AU12 整体仍未完成；现已由 `AU12-file-level-closure` 收口到文件级可交付状态。 |
| 2026-06-17 | 用户调整任务队列，先完成 `AU09-character-dossier-roundtrip` CP1；队首随后回到 AU10 recovery。 | 角色主档案断链已收口：`CreativeProvider.Real` 角色设计专用 prompt；`character_seed` 采纳写 `Character` accepted 且不写 memory；采纳 state ref 指向 `character_id`；作品档案角色 tab 非空仍可创建；下一次角色设计上下文读到 Character 主档案。证据 `artifacts/slice-verify/au09-character-dossier-roundtrip-tauri/summary.json`。CP2 字段级结构化、关系对象和演化 memory 未完成。 |
| 2026-06-17 | `AU10-workbench-recovery-disconnect-timeout` CP1 provider failure recovery 已闭环，当时队首继续同 slice 的 CP2 reconnect。 | 外部 Tauri driver 通过产品 provider config API 切到不可达 LM Studio endpoint，真实工作台发送消息后收到可恢复 fallback TurnResult，UI 显示无法连接且明确没有写入作品事实，loading 清除、输入可用；恢复 `slice_verify` provider 后下一轮完成。证据 `artifacts/slice-verify/au10-workbench-recovery-disconnect-timeout-tauri/summary.json`。本 CP 不覆盖 WebSocket 断线重连、取消等待、完整异步 LongRunner streaming 或 stale/disabled/idempotency UI。 |
| 2026-06-17 | `AU10-workbench-recovery-disconnect-timeout` CP2 WebSocket service reconnect 已闭环，队首当时继续同 slice 的 CP3 cancel / timeout / LongRunner。 | 外部 Tauri driver 停止/重启本次 slice 的 Phoenix 服务，真实工作台在 socket/channel close/error 后显示“同步离线”、禁用输入且清除 loading；服务恢复后自动 rejoin，下一轮消息完成。证据 `artifacts/slice-verify/au10-workbench-recovery-reconnect-tauri/summary.json`。该 CP 当时不覆盖取消等待、真实 timeout、完整异步 LongRunner streaming 或 stale/disabled/idempotency UI；取消等待随后已由 CP3A 闭环。 |
| 2026-06-17 | `AU10-workbench-recovery-disconnect-timeout` CP3A cancel waiting 已闭环，队首继续同 slice 的 CP3B timeout / LongRunner。 | 外部 Tauri driver 触发真实高风险工具 confirmation 后点击可见“拒绝”，Channel 经 `DialogueGateway.handle_action/3` 返回 cancelled action_result 与 no-write TurnResult，关闭 active behavior；UI 显示已取消等待、清除确认按钮、输入可用，并完成后续消息。证据 `artifacts/slice-verify/au10-workbench-recovery-cancel-waiting-tauri/summary.json`。本 CP 不覆盖真实 timeout、完整异步 LongRunner streaming 或 stale/disabled/idempotency UI。 |
| 2026-06-17 | `AU10-workbench-recovery-provider-timeout` CP3B provider timeout 已闭环，队首推进到 CP3C LongRunner streaming。 | 外部 Tauri driver 启动一个不响应的 OpenAI-compatible endpoint，通过产品 provider config API 切到 LM Studio runtime，真实工作台发送消息后 Provider Gateway 记录 `provider_gateway.complete.error reason_code=timeout`；Channel 返回 no-write fallback TurnResult，UI 显示响应超时且明确没有写入作品事实，loading 清除、输入可用；恢复 `slice_verify` 后下一轮完成。证据 `artifacts/slice-verify/au10-workbench-recovery-provider-timeout-tauri/summary.json`。本 CP 不覆盖完整异步 LongRunner streaming 或 stale/disabled/idempotency UI。 |
| 2026-06-11 | dogfood checkpoint 2：12 章全部跑满（16,734 字、12/12 ≥1000、0 失败、末跑 8 分钟）+ 增量规划 slice `p1-plan-incremental` 两 provider 闭环（**零产品代码**——物化层 title 幂等 + seq 续排本就支持追加，真实 gpt-oss-120b 从已有 12 章正确接续生成第13-19章、采纳追加、原章不动）。10 万字放大跑解锁。 | runner 修两个深层 bug：① 长会话**历史帧误匹配**（帧匹配不限起点 → 第08章误进第03章的确认分支）→ waitForFrame 加 fromIndex 限定本轮；② **waitForFunction(fn, arg, options) 参数顺序坑复发**（两参形式 timeout 被当 arg 从未生效、默认 30s）→ runner 全部改三参——该坑在所有 slice driver 的两参调用里潜伏（条件总在 30s 内满足未暴露），后续宜统一清理。狗粮还实证：覆盖确认/确认执行/失败重试-跳过/`--resume` 三次断点续跑全部工作；确定性 provider 的「改写」关键字误判（planner-keyword 债）只影响离线调试不影响真实跑。增量批量由 AI 自定（实测 7 章），验收下限放宽 >= 5。 |
| 2026-06-11 | `P1-100k-dogfood-run`（Order 21）checkpoint 1：狗粮长跑 runner 基建落地并真实试跑通过；放大到 10 万字前发现产品缺口「计划无法增量扩展」。 | 新增 `scripts/dogfood_run.sh` + `frontend/slice-verify/dogfood-runner.mjs`（外部 Playwright 像作者一样逐章推进真实工作台：读阅读投影找未达标章 → 首稿/续写自然语言指令 → 确认创建采纳 → 循环 → 导出全书；支持 `--resume` 断点续跑=「重启后继续生成下一章」真实演练、确认卡处理（消费 AU-04 链）、失败重试-跳过、progress.jsonl + milestones §8 产物）。真实试跑（gpt-oss-120b）：第01章 135→642→1101、第02章 137→804→1600，续写衔接自然（nonce 贯通）、~25s/轮。**缺口**：seed 计划仅一卷 12 章（≈1.8 万字），10 万字需 ~70-100 章；增量规划（「继续规划第二卷」→ outline 采纳追加到既有结构）未验证，疑似采纳物化（固定「第一卷」+ seq 从 1 重算）不支持追加——需先以独立 slice 闭环增量规划，或本轮先跑满 12 章并如实报告缺口。 |
| 2026-06-11 | `P1-export-minimum`（Order 20）闭环，队首推进到 `P1-100k-dogfood-run`。 | 阅读模式新增「导出全书」：channel `export_work` → `ExportService`（复用 `ReadingProjectionService.toc/chapter_content` 单一作品事实源，AU-08 口径——未采纳草稿天然不进导出）→ `NovelDomain.ExportDocument` 纯函数渲染（头部元信息 + 全章按 seq 目录 + 逐卷逐章正文 + 未写章「（本章暂无已采纳正文）」诚实占位）→ 写盘（`:export_dir` config，test=tmp/exports、默认 ~/Documents/AI Novel Studio）→ UI 显示「已导出到 <路径>」。验收 driver 复用采纳-阅读链后点真实导出按钮、从页面路径读真实文件断言 12 章目录有序、已采纳正文在文、占位恰 11；确定性 + `--real-lmstudio` 通过。后端 229+105 测试、I3/I1/I2、前端审计/设计追溯全过。 |
| 2026-06-10 | P0 插队（Selection Rule 2）：code review 发现 user-turn 高风险确认链两层断链，修复并以新 slice `au04-confirm-before-execute` 闭环（AU-04 首个真实页面验收）。 | ① turn_result 经 `Map.put(:plan, raw struct)` 旁挂 MicroPlan（契约外捷径），broadcast（Jason `Protocol.UndefinedError`）/persist 双崩——「作者直接说重写第X章→确认卡」从未在真实 wire 走通；② 确认后 re-gate `GateOrder` 无确认满足输入，高风险 plan 永 `confirmed_but_blocked`——ADR-0009「确认→重新 gate→执行」只实现了一半（ConfirmationBinding domain 壳零消费）。修复：plan 载体 JSON 安全化（`DialogueGateway.jsonable`，Jason 原生可编码标量 struct 保留）+ `MicroPlan.from_map` 反序列化（atom/string key 双形态，未知枚举落最保守）+ `ConfirmationBinding` 接入 `handle_action`→`ExecutionOrchestrator.decide/3`→`GateOrder.evaluate/2`（authority/write_boundary 感知确认，其余 gate 照常，VS-03 §6「确认不等于 gate 一定通过」）。验收：`au04-confirm-before-execute` 确定性 + `--real-lmstudio` 通过（确认卡过真实 wire、确认前 `tool_called=false`/`production_write_performed=false`、确认后同 turn 产 tentative prose）；回归 overwrite-confirm/adoption-reading/multichapter 全过；后端 227+102 测试、I3/I1/I2 全过。 |
