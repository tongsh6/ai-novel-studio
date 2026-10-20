# NEXT / 当前推进队列

> 最后更新：2026-10-18
>
> 角色：本文件是 AI 和人类维护者选择下一项工作的唯一入口。台账记录事实，acceptance 记录验收口径，用户旅行图记录连续体验；本文件把它们压缩成当前可执行队列。
>
> **仪式（硬约束）**：每个工作周期开工先读本文件队首；收尾必须更新本文件。跑偏的根因就是这条仪式中断（2026-07-19 统筹复盘）。

---

## 1. Current Focus

> 当前态校准：2026-10-18；历史进度以提交、slice 任务清单和验收证据交叉核对。

**当前态**：P1 长篇主链已按登记豁免关闭，主线仍是 D8 暴露的真实作者可用性。
Q0、Q1a、Q2、Q3a–Q3d、DS02 和 Q4 轻量机制已落地；Q3d 的 BIZ-01–05 已收口。
2026-10-18 BIZ-05 修复仅记录约束、创作方向用途与动作授权，历史内容保留但不恢复用途不明的旧方向权限。
真实页面专项与四项兼容回归通过；Flash Next Q2 四回合九次 HTTP 200，原文、来源、采纳前后事实及刷新回答一致。
确定性页面故障矩阵和实模分别留证，不混用；本轮未复验 DeepSeek。

**BIZ-06 已闭环**：对话可直接修订/放弃已有候选；新稿待作者采纳，原稿保留；版本来源去重、重新登记、编辑状态与过期编辑保护均有真实页面证据。
Flash Next Q2 十轮 / 25 次调用证明数据与动作；最终四轮 / 9 次调用补证上下文指代及真实完成回执。两批版本边界与失败样本分别留证。

**Q1c / Journey D5 已采纳内容修订已收口（2026-10-21）**：正式 `q1c-adopted-content-revision`
browser 场景 PASS，覆盖来源采纳 → 修订候选命中 accepted 目标 → 覆盖确认 → 旧版
`SUPERSEDED` / 新版 `CONFIRMED` → 追问读新值；四条拒绝矩阵由确定性测试覆盖。
当前队列待三组工作分别提交后，唯一队首转为 T6-AB。诚实边界：Q1c-specific 证据是
browser surface，原生 Tauri Q1c 场景未跑；AU-05/AU-09 Tauri 回归漂移另行维护。

**本轮验证**：后端 1,545 项、前端 483 项、证据验证器 216 项；三个页面专项及两项兼容回归通过。
I1/I2/I3/N-NARR、编译、架构、桌面构建通过；完整扫描 17 PASS / 2 既有 FAIL、三项已处置、0 blocking。
详见 `tasks/slices/Q1B-live-archive-recheck.md`、审计 notes §11 和 `docs/project-ledger.md`。

**队列总览**：§4 当前队列表是唯一状态源；不再复制第二张易漂移的状态表。
Q0→Q1→Q2→Q3→Q4 是历史组织顺序，当前队首由唯一 `next` 行标识。

**观察项（非队列）**：文学质感盲评（M6 书 vs M10c 书，内容侧）；D6 路由表填写（作者
运行时自选，机制就绪零表）；下次狗粮观察=D6 UI 全链、B9 确认路径、Q4 重复段。

**排序论证**：止血先于哲学——真实作者在用、Q1 成本小时级、且 Q1a 同时治 M10c 盲写
续写的连贯性缺陷；哲学先于机制刀——P/R 的判据源自 B 类补写，跳过它就会重演「补丁
追缺陷」（Selection Rule 7 反补丁自检的本轮行使）；回收机制殿后但必做——A 类病根
不是缺文档而是登记后无人收账，不建回收则 Q2/Q3 的新登记同样会烂掉。


---

## 2. Why This Focus

**北极星**：P1 = 作者在真实工作台用真实模型走"设定 → 章节规划 → 逐章产出 → 采纳 → 阅读 → 导出"写出 10 万字可读长篇（`docs/product/novel-output-milestones.md`）。

**历史结构性倒挂（2026-07-19 统筹复盘，非当前实现盘点）**：08 要素模型 37 项要素中真正物化的约 10 项，五本账（E33-E37，设计文档自认的护城河）、章级设计四件套、卷级蓝图、场级 craft 全部未建（NEM-GAP-01~07）。而近两周工时全部在机制层（判断循环/退役/探针）——机制层工作自我繁殖、永远有"正当的下一件事"；领域层不叫喊、缺了不红灯，只会让第 30 章开始漂移，而我们还没写到第 30 章。**底盘已跑到货物前面**：机制层今后只在被领域要素拉动时才动。

## 3. Active Journey

连续体验真源：`docs/product/user-journeys.md`（本节为当前活跃旅程的压缩视图）。

```text
作者在真实工作台提出创作或存档诉求
→ 判断与实际能力对账（Q3a 已实现）
→ 能力不足时诚实说明并给出最近路径（Q3b 已有确定性 Tauri 证据）
→ 作者原文可成为待采纳候选，作者采纳后入档（Q3c 已有确定性 Tauri 证据）
→ 输入留存、来源、采纳及候选动作语义（Q3d / Journey C9：BIZ-01–05 已闭环）
→ 采纳状态统一为 canonical 枚举，历史消息恢复同口径（DS02 / Journey F9，已闭环）
→ 已有候选的修订、放弃、重新登记与事实回复（Q1b / Journey C10：BIZ-06 已闭环）
→ 已采纳内容的修订与后续创作上下文（Q1c / Journey D5：next，先核查真实后果）
→ 场景业务正确性收口后，再评估性能（UA01-CALL2 / Journey C11，观察项）
→ 更长期的跨任务目标与语义履约判定仍需独立契约
```

## 4. Queue

三轨预算：**A 主线 ≥60% / B 债务 ≤25% / C 平台验证 ≤15%**。除非阻塞级 P0 bug，功能推进从队首开始。

### 当前队列（2026-10-08 校准；唯一 next 为当前队首）

| # | 轨 | 任务 | 状态 | 完成判据 |
|---|---|---|---|---|
| Q0 | B | B15 提交收口：TurnBinding 单点（9 flow frame 构造点）+ 防回归守卫测试已绿、`p1-chapter-expansion` 复活 PASS、门禁绿 | **done（2026-08-30）** | ✓ commit 落盘；B15 销账 |
| Q1a | A | D7-overwrite 不变量修复（三刀实落，B 按钮显式 rewrite 未采——场景语义改为作者显式消息更合 D7 契约）：①喂前文改产品事实判别（目标章有已采纳正文即喂，治 M10c 盲写）②**判断②续行合成步继承计划步写作坐标**（真根因：rewrite 意图在偏离处理后蒸发→append 绕过覆盖确认；D8 病理 run 内实例，详 D7 slice 档 §4 追记）③驱动 cycle2 改作者显式「推翻重写」消息 | **done（2026-08-31）** | ✓ 全三条：overwrite-confirm PASS + expansion 不回归 + prior_prose_chars 缺 intent 仍出现（app-log 151 chars + flow 单测） |
| Q1b | A | BIZ-06：已有候选的对话修订/放弃、重新登记与编辑状态 | **done（2026-10-18）** | 三项页面专项、十轮实模数据链及最终四轮上下文/回执实模通过；Journey C10 |
| Q1c | A | 已采纳内容的修订、保留/替代与后续上下文核查（`tasks/slices/Q1C-adopted-content-revision.md`，CP1–CP4/CP5 done） | **done（2026-10-21）** | 正式 browser 场景 PASS + 四条拒绝矩阵 + follow-up 新值；详见 slice §4B |
| T6-AB | A | UA01 T6 CP-AB：prompt 前缀稳定性观测 + 首个实证（`contracts/VS-00I` §9：离线前缀共享度量、全厂商 TTFT、矩阵待核实回填、调用对工具恒定、续行 call1/call2 重排；顺带收口 VS-00H P1 activity 投影 `system_identity_ref`） | **next（2026-10-21；A1/A2/B3/B1/B2 完成；MBC stub 1.0、LM Studio TTFT 1365ms；au02 + gate deviation PASS，budget deviation 仍有既有 drift；继续厂商凭据与 CP-AB 收口）** | 度量对续行调用对给出"改前≈L0 / 改后 call2≈call1 全长"；I-CACHE-2 绿；MBC 不退化且 call1 无工具调用倾向；各可达厂商 `cached_tokens` / TTFT 基线落 `artifacts/`；activity API 可见 `system_identity_ref` |
| T7 | A | 系统身份消息层（`docs/design/contracts/VS-00H-system-identity-message-contract-pack.md`；`tasks/slices/UA01-agentic-loop-prompt-hardening.md` T7） | **done（CP1–CP3 实现完成；live vendor cache / developer UI 后置）** | CP1 身份模块 + Gateway 唯一注入 + ProviderRun `system_identity_ref`；CP2 去 18 处产品自称 + I-SYS-2 守卫；CP3 `cached_tokens` 可见。Proof：gateway focused tests + 全量 `mix test` + 一条既有 slice_verify 场景 + I1/I2/I3 |
| Q2 | A | 哲学补写（B 类盲区四条，一次文档刀）：00§2 作者供给权 / 会话内核跨 turn 义务 / README 原则补语义对账+缺口诚实律（含 D7 fail-safe 判据）/ VS-00D 分权诗第五行（结果对账） | **done（2026-08-30）** | 提交 `8b03a9db`；00 §2.1、README 原则 12/13、VS-00D 结果对账已入档 |
| Q3a | A | P1 语义对账最小版：judgment 的 reason×capability 矛盾拦截（execute∧只读集∧写词，规则级对账兜底非主判；矛盾带说明重试一次，仍矛盾走 judgment_semantic_conflict 诚实失败+S7 作者文案；只读集由 dispatch 表编译期推导 SSOT） | **done（2026-08-31）** | ✓ 基线（notes §8：164/5/0 误报）+ 拦截器单测 11/11（含 D8 stage 原话回放）+ LogEmit 可观测 |
| Q3b | A | R2 能力缺口出口：frame_type 子型 capability_gap（reply 结构化子型，零新字段——缺口事实=frame_type、路径=candidate_directions；探索强转让位判例见 slice 档）；VS-00 两枚举表修订 + domain/协议/前端/替身全链 | **done（2026-08-31）** | ✓ `q3b-capability-gap-honest-reply` 真实 Tauri PASS（存档意图→诚实承认+路径候选+零写入）+ au02 回归 + 全门禁；slice 档 tasks/slices/Q3B-capability-gap-exit.md |
| Q3c | A | R1 作者内容物化：候选第二合法来源——作者消息字节机械物化为待采纳 world_setting 候选（不经模型重写；杂质由 edit-then-accept 主权修剪）；judgment 契约 author_content_registration 信号；**I1 不变量正式升级**（Provider ∨ 作者字节，规则+driver+case 同批登记非绕过） | **done（2026-08-31）** | ✓ `q3c-author-content-materialization` 真实 Tauri PASS（字节断言+物化事件+作者采纳全链）+ q3b/au02 兼容 + I1 4/4；slice 档 tasks/slices/Q3C-author-content-materialization.md |
| Q3d | A | 消息与业务输出对齐：BIZ-01–05 | **done（2026-10-18）** | 消息身份/来源/完整待办与仅记录/候选用途闭环；真实页面正反例及 Flash Next Q2 实模通过；Journey C9 |
| DS02 | A | 采纳状态 canonical 化，撤销前端临时 string 放宽；见 `tasks/slices/DS02-adoption-status-canonicalization.md` | **done（2026-10-05）** | 领域/线格式/历史 transcript 统一大写七态；严格 schema 校验与告警恢复；q3d 历史状态真实页面和 roster 回归 PASS，1510 后端/461 前端测试；对应 Journey F9 |
| UA01-CALL2 | A | 当前模型结构化判断性能观察；既有 UA01 可靠性专项 | **停止参数对照，转业务审计** | 用户明确以使用场景和 App/业务正确性为主线；未完成样本不作参数裁决，537 秒记录仅作旁证；对应 Journey C11 |
| Q4 | B | 差距回收机制（轻量版）：`scripts/gap_ledger.sh` 扫描三处差距表→开放清单+新增/关闭/复核（连续 3+ 快照仍开放，不等同于无进展）；快照台账 reports/gap-ledger/；开工仪式第 6 条接入。首扫=26 项开放（G 7/NEM 7/B 轨 12）。ADR enforced_by 精确超期归后续增强 | **done 轻量版与状态校准（2026-10-05）；B16 已解除新增扫描阻断** | 轻量机制提交 `d37409b4`；本 checkpoint 修复当前队首/旅程检查并校准差距描述，验证见 §6；不代表所有差距已销账 |
| 主线复位 | A | Q1-Q4 后回存量，按真实作者可用性重排：DS02 / UA01 流式卡片简化 / DS01 / 判断纪元 CP1 / Order 7 上下文刀 / AU09 召回 | 顺序**待拍板** | — |

### 历史 Order 表（M0-M3 期，保留供追溯；不参与当前队首选择，未闭环后果仍由原 slice 负责）

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
| 6 | M3 | A | **五本账优先**（M2 暴露短板已裁决定序：Q5 要角/题材漂移=五本账 E33-E37 缺位直接实证）→ 三态对账（GAP-05/06）→ 卷级蓝图/CP6 外部翼 | **历史队首（已移交当前队列）**；五账与作者裁决入口已落地，长尾以 VS-00F/VS-00G 任务清单为准 | 漂移类缺陷已有账可查、可拦截；当前按 Current Focus 继续补全回路 |

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
| B12 | **AU10 工作台渲染稳定性与局部刷新隔离（2026-07-24 用户反馈）**：当前无整页 reload 证据；视觉“整体闪烁”初判为 `WorkspaceChat` 多状态联动 render、可变 key/条件渲染 remount、异步元素/输入区/档案几何变化与自动滚动叠加。四方案已登记：A 最小防闪烁、B 组件/状态边界、C TanStack Query server-state 收敛、D 显式工作台状态机。 | 详见 `AU10-workbench-render-stability.md`；先 CP0 外部测量，再默认 A→B，C/D 仅证据触发；P1 B 轨；当前队首以本文件 §4 当前队列为准 |
| B13 | **ADR 实施/闭环与 traceability 债**：2026-07-25 的 26 份 ADR / 8 项未闭环是历史审计口径，不能直接作为当前完成率。2026-10-05 检查为 初检 27 份 ADR 均缺 `enforced_by`；Q3d 本次已补 ADR-0027，其余 26 份仍缺，脚本仍只告警并 exit 0；ADR-0027 已按用户确认修订 Accepted。实现与验收状态须逐项对照 owner 与证据，不能以 Accepted 或脚本成功代替。 | 当前队首以 §4 为准；DS02、S4/S7、外部搜索翼、Projection、Replay、I10 的完整状态仍回原 owner。后续补 `enforced_by` 并收紧门禁前，先逐项核验 ADR→slice→代码→真实页面证据；本次仅校准状态，未完成追溯修复 |
| B14 | ~~P0 awaiting_author 幽灵任务与失败气泡~~ **已销账（2026-07-28）**：DS03 全链收口——resume 门禁/liveness 真源/控制坞状态矩阵/steer 持久化/错误内联，三场景真实 Tauri PASS。残余（不阻塞）：S7 available_actions 载体归 ADR-0024 CP3；agent_run_state codegen 归 DS01；Pencil dock dead/awaiting 变体 frame 待补；非 judgment/prose flow 的 steer transcript 顺序对齐待其引入 steer 语义时做（细节见 slice 决策日志）。 | `DS03-awaiting-author-runtime-validity-and-recovery-surface.md` done / verified |

| B15 | **bounded run 下 `toolbox.execute.*` 丢 turn_id**（2026-08-26 D7 排查挖出）：LogEmit 从 Logger metadata 取 turn_id，主链迁 bounded run 后工具执行进程无该键→两个 P1 场景 behavior 门长期哑火。修复=TurnBinding 单点（构造+绑定合一，9 flow frame 构造点全接）+ 防回归守卫测试；`p1-chapter-expansion` 复活 PASS、门禁绿 | **已销账（2026-08-30，Q0）** |

| B16 | **Phoenix 安全补丁与前端依赖恢复**（2026-10-05）：后端 Phoenix 1.8.7 → 1.8.9，其他 Hex 锁项不变；以已安装 pnpm 10.33.0 执行 frozen-lockfile 恢复前端，package.json/前端锁文件未变；用户已明确授权。 | **已销账（2026-10-05）**：Hex 审计无漏洞；后端 1,492 / 前端 450 测试通过，四项不变量、架构、前端检查及工作台采纳场景通过；完整扫描 17 PASS / 2 既有 FAIL，3 项旧 finding 均有既有处置、0 blocking。桌面构建记录见 §6；ADR-0027 仍 Proposed，不因本次依赖授权变更状态。 |

| B17 | **awaiting_author writer timeout 出口**（DS03 post-closure，2026-10-21 用户定向插单）：prose writer 连续 timeout 后，assistant 活动行显示真实失败原因，控制坞提供「先写第一场（500 字）」scoped steer；不新增裸 continue、不改 AgentRun 主架构。 | **局部测试绿（2026-10-21）**：后端 1,572 / 前端 487；`compile --warnings-as-errors`、xref、arch_check 通过；真实页面/真实模型短验收待跑（不复用旧长跑）。 |
| B18 | **D4 high-risk prose gate 失效**（CP-AB 复跑实锤，2026-10-21）：`mechanical_prose_retry_step` 未继承原 prose 步 `risk_hint`，第一次 gate 拦截后 retry 合成步以默认 low 绕过确认。 | **已修（2026-10-21）**：续行合成步继承 `risk_hint`；`slice_verify` 对 Orchestrator gate/tool failure 优先判 await；`agentic-loop-gate-deviation-replan` 真实 Tauri 复跑 PASS（awaiting_author + D4 + writer 未派发）。 |
| B19 | **D5 budget deviation scenario drift**（2026-10-21）：`agentic-loop-budget-deviation-replan` 未产预期 provider-sourced `plan_revised`；根因升级为 B20（预算写死）。 | **并入 B20**；CP-AB 不以此场景为通过证据。 |
| B20 | **动态 AgentRun 预算**（`tasks/slices/UA01-dynamic-agent-run-budget.md`）：计划派生执行预算 + 规划/执行分账 + 作者“最多一步”约束 + 绝对硬上限；不改 prompt/provider，不简单调大常量。 | **CP0/CP1/CP2 done；CP4 design done（2026-10-21，待实现）**：纯策略 9/9；运行时按计划扩容、作者 cap、预算缺口诚实停等（`plan_budget_shortfall`）；CP3 作者可见扩大预算、CP4 driver/verifier 重做待办；优先于 CP-AB 收口。 |

**C 轨（被 A 轨拉动才做）**：explore 方向质量 live MBC 探针；记忆类面场景级验收；harness/探针体系自发扩建一律禁止。

## 5. Selection Rule

1. **领域拉动判据（第一裁决）**：机制层工作必须回答"被哪个领域要素（E01-E37/五本账/三态）或 M0 缺陷拉动"；答不上 → C 轨排队，不开工。
2. **无队列挂靠的工作不开工**；临时发现先登记（B 轨或 slice 文档余项），不顺手挖。
3. **止损律**（2026-07-18 用户拍板）：语义重定义值得做；纯计数钉快钉；环境毛刺登记复验不深挖。
4. **狗粮节拍**：M0 之后每 3-5 个周期强制一次 10 章级狗粮——产品级测量常态化，防"场景绿=进展"错觉。
5. **周期收尾更新本文件**（Current Focus 一段话 + 队列状态位），历史叙事写 slice 文档不写这里。
6. **差距回收仪式（2026-08-30，Q4/D8 A 类病根）**：开工先跑 `bash scripts/gap_ledger.sh`
   ——扫描 VS-00D G 表 / NEM-GAP 表 / B 轨台账，输出开放差距与滞留红名单（连续 3+ 次
   快照仍开放，非无进展判定）。滞留项必须裁决：推进 / 降级并登记理由 / 显式弃置——登记不是安慰，
   挂账必须收账（VS-00F 伏笔账哲学自反射到工程）。快照台账 `reports/gap-ledger/`。
7. **反补丁自检（2026-07-20 用户提醒固化）**：同类症状出现第二次即触发归并审视——问"这些是几个缺陷还是一个病的几种症状"；症状钉可以先打（防线），但病灶必须立独立收口项且**测量先于设计**；harness 重试把问题变"能跑"不等于病愈，重试率必须进体温计。

## 6. Decision Log

- 2026-10-21 — **Q1c 收口**。正式 `q1c-adopted-content-revision` browser 场景
  （slice_verify）PASS，三轮回合约 4.3s；旧版 `SUPERSEDED` / 新版 `CONFIRMED` / 单一
  current fact / follow-up 新值均成立。新增歧义、stale、跨作品拒绝测试与 discard
  矩阵；persistence 层增加 revision target 的 stale/cross-work 事务 guard。诚实边界：
  Q1c-specific 证据为 browser surface；AU-05/AU-09 Tauri 回归场景漂移未计入通过证据。
  队列在 Q1c/VS-00H/DS03 分别提交后转 T6-AB。

- 2026-10-21 — **DS03 post-closure：writer timeout 出口**（用户定向插单）。stage 实跑
  证明 `prose_writing` timeout×2 后通用 awaiting 文案隐藏真实原因，且 replan 的“分段”
  没有落到执行器。最小修复：保留 provider error `type`、prose flow 输出 timeout-
  specific summary/reason codes、assistant 活动行显示最近 awaiting 事件 summary、
  控制坞提供「先写第一场（500 字）」非空 steer。没有新增裸 continue/命令/状态；
  真实页面短验收留待下一次，不以局部测试冒充闭环。队首仍为 Q1c。

- 2026-10-21 — **T6 前缀稳定性三项拍板 + 排期**（用户确认建议）：L4 置尾为硬规则；调用对工具恒定
  默认开启、数据只决定按 adapter 回退；CP-A/B 合并为 CP-AB（度量须有"改后"样本），顺序
  AB → D → C（MBC A/B 硬门禁，失败登记例外）→ E。VS-00H 评审 P1 并入 CP-AB；I-CACHE-1
  CP-C 后升 CI 阻断；VS-00I 实证后再 Frozen；身份 v1 不捆绑。**排期：不插队，CP-AB 排 Q1c
  收口后首位、任何再碰 prompt 的工作之前。** 详见 UA01 slice 决策记录。

- 2026-10-21 — **登记 T6 前缀稳定性契约 `VS-00I`（设计先行，不开工）**：T7 身份层落地后实测，
  171 字符身份之后请求立即分叉（跨调用点于角色句、跨轮于首个动态字段、调用对于工具集差异），
  可复用前缀≈0。契约定五层稳定度 L0–L4（厂商无关）、与六段骨架的映射（⑤⑥置尾不动，判例优先于
  缓存）、调用对工具恒定、逐调用点映射、十厂商适配矩阵（待核实项不写成已知）、离线前缀共享度量
  为主 proof。用户明确目标不只 LM Studio。顺序 CP-A 观测 → B → D → C（MBC A/B 硬门禁）→ E。
  本次只落文档与可达链（contracts README / VS-00H §7 / notes 07-22 / UA01 T6），不改代码；
  队首不变，Q1c 仍为唯一 next。

- 2026-10-21 — **登记系统身份消息层（设计先行，不开工）**：用户指出 app 与 LLM 交互缺统一产品身份前提。
  代码核查：零 `role: "system"`、18 处调用点三种产品自称、VS-00D §4.4 SYSTEM 块从未落地、
  `Usage` 无缓存命中字段。契约落 `docs/design/contracts/VS-00H-system-identity-message-contract-pack.md`
  （Proposed），承重入口 `UA01-agentic-loop-prompt-hardening` T7（CP1 Gateway 注入 → CP2 调用点
  去自称 → CP3 `cached_tokens` 可测）。本次只落文档与可达链（contracts README / VS-00D / 08 /
  notes 07-22 指针），不改代码；队首不变，Q1c 仍为唯一 next，T7 待主线复位时定序。

- 2026-10-21 — **Q1c 收口（用户指令“先停止跑，收口当前成果”）**：A1 已落
  `SUPERSEDED` + 双向 revision link，`revise_adopted_content`/覆盖确认/旧版退场/记忆 UI
  已实现；后端 1555、前端 484、架构/前端审计/设计追溯全绿。真实页面结构链路通过 2 次，
  但最后一次 follow-up 轮被中断，最终 summary 未落盘，正式场景与四条拒绝矩阵未注册，
  故 CP4/CP5 只标部分闭环，不写 done。教训：结构验收不得用真实模型反复跑全链；下一
  步先优化 harness（确定性 provider + seed + `reasoning_effort=none` + 单轮 180s 上限），
  再补一次短的真实模型语义验收。

- 2026-10-21 — **用户插单 T7 系统身份消息层**：VS-00H 已完成 CP0 文档（Proposed），
  用户明确“做这个”。队列切为 T7 `next`、Q1c `paused`（Q1c 代码/门禁已收口，CP4/CP5
  部分闭环保留）。CP1 边界只改 `novel_agent`（身份模块、Gateway 注入、ProviderRun ref），
  不改调用点文本；CP2/CP3 随后。真实模型不作为结构验收门禁。

- 2026-10-21 — **T7 实现收口**：CP1 身份模块 + Gateway 注入 + ProviderRun ref；CP2
  18 处调用点去产品自称 + I-SYS-2 守卫；CP3 `cached_tokens` + Anthropic `cache_control`
  + 连续调用共享前缀。后端全量 1570/0、I1/I2/I3 绿、MBC stub 1.0、`slice_verify
  au02-candidate-continuation` PASS 且测试库 ProviderRun metadata 实测 identity ref。
  诚实边界：真实 vendor cache hit、live MBC、`system_identity_ref` 开发者 UI 展示未做，
  登记在 VS-00H §11.1。Q1c 恢复为唯一 next。

- 2026-10-08 — **按用户要求转向业务正确性**：停止参数/耗时对照，撤出未采用探针代码并保留证据。
  两条真实页面负例分别复现缺失来源保存指令、持续对话后待采纳恢复丢失；局部反例证实
  登记原文/创作执行互斥缺口，实际 UI 帧证实未传稳定消息标识。当前仅审计，生产未修复。
  Q3d / Journey C9 重开为唯一 next；此前 Q1b、DS02、短会话 q3d 的通过保留各自范围，
  不外推为所有业务场景已闭环。详见 2026-10-08 场景审计报告。


- 2026-10-08 — **Q1b 实模闭环**：本机 Qwen 四轮八次 HTTP 200，采纳前后叙事与
  实际零/一条 CONFIRMED 事实一致；新发现并修复未登记分支的来源字段误拦截。
  合盖/温控休眠的失败运行单独保留，稳定开盖后原断言通过。详见 Q1B slice。
  用户“已开盖且散热恢复，继续实模复验”授权后完成；下一断点转 UA01-CALL2 / C11，
  实测结构判定 537 秒，需要先测量，不能把状态正确等同于响应体验已达标。


- 2026-10-05 — **DS02 状态口径闭环**：领域初态、TurnResult、前端采用 canonical 七态；
  历史小写只在 MemoryLog 读取边界归一，旧记录和正文不改写，未知状态继续告警。
  q3d 真实页面含旧 tentative/accepted 夹具恢复与作者采纳，roster 回归通过；1510 后端、
  461 前端测试，四项不变量、架构、桌面构建通过。扫描首轮新增 AliasUsage 已修，
  复扫 17 PASS / 2 既有 FAIL、0 blocking；2026-10-08 核对并提交收尾，见 DS02 slice。唯一 next 设为 Q1b / Journey C10：补真实模型 D8 存档证据，
  不把确定性 provider 的通过等同于真实模型稳定性。


- 2026-10-05 — **Q3d 消息闭环**：用户核查根因后确认消息处理与诉求状态分层，授权
  先接通现有 Interaction/AgentRun/采纳事实。ADR-0027 因此修订 Accepted，原第六账
  提案未采纳。统一接收与结果记录、身份去重、失败/取消留痕、历史原文引用、采纳状态
  追问与刷新恢复已实现；外部 q3d/q3c 场景 PASS。后端 1506/0、前端 450/0、四项
  不变量通过，扫描 17 PASS / 2 既有 FAIL、3 旧处置、0 新增阻断。详情及完整验证见
  Q3D slice。按既有主线复位候选，DS02 设为唯一 next / Journey F9；本次不实施 DS02。

- 2026-10-05 — **B16 依赖修复闭环**（用户明确同意安装/升级）：`novel_web` 精确约束
  Phoenix 1.8.9；恢复原传递依赖锁项后 `mix deps.get --check-locked` 通过，最终只变更
  Phoenix 一个 Hex 锁项。前端使用已有 pnpm 10.33.0 按锁恢复 251 个依赖，不升级全局工具。
  验证：`mix compile --warnings-as-errors`、`mix test`（1,492/0）、`mix deps.audit`；
  `pnpm typecheck && pnpm lint && pnpm test`（450/0）、`pnpm build`、架构与前端审计、
  I1/I2/I3/N-NARR 均通过；`bash scripts/ai_static_scan.sh --top 10` 返回 0：
  17 PASS / 2 FAIL、3 findings、0 blocking，余项为历史 gitleaks 误报/已接受风险及
  已暂缓的 ChapterSummary 嵌套问题，不把它们写成修复。
  外部页面回归：`bash scripts/quality_accept.sh q3c-author-content-materialization --surface tauri`
  通过（独立测试库/4857+5869 端口，确定性 provider；启动 Tauri，Playwright 操作同一真实工作台页面，
  不是 native WebView 内部自动化），证明作者字节候选→采纳链路；不代表真实模型或所有 Tauri API 验收。
  桌面构建：sidecar + `pnpm tauri build`；检查发现 overwrite 保留旧 release 目录，
  将旧生成目录保存在 `artifacts/project-analysis/b16-sidecar-before-clean/` 后从干净目录重建，
  sidecar 中仅 `phoenix-1.8.9`。证据：`artifacts/project-analysis/b16-*.log`、
  `artifacts/slice-verify/q3c-author-content-materialization-tauri/summary.json`、
  `artifacts/static-scan/{report.json,top10.md,disposition.md}`。
  保留边界：24 条既有测试告警与一条测试收尾 SQLite owner 退出日志仍在（0 失败）；
  Vite 大块警告仍在；安装包为本机 ad-hoc 签名，未做 Apple 公证。Q3d 继续等待 ADR 决策。

- 2026-10-05 — **Q4 状态校准 checkpoint**（用户指令「开工」）：以既有提交和 slice
  记录核对 Q0/Q1/Q2/Q3/Q4，移除历史队首对当前队列的影响；Q3d 决策评审为唯一 next，
  对应 Journey C9，ADR-0027 保持 Proposed。五本账、三态对账与 message envelope 的
  差距改为已落地部分和剩余范围，保留未闭环项，不凭文档修订销账。补差距目录索引。
  工程验证：`node --test scripts/next_task_check.test.mjs`、`node scripts/next_task_check.mjs`、
  `bash scripts/gap_ledger.sh`。8 项回归通过，旧 HEAD 文档被新检查器正确拒绝。
  `bash scripts/ai_static_scan.sh --top 10` 完整执行：13 PASS / 6 FAIL / 0 SKIP，
  Top N 共 7 项、触及文件 0 项；2 项历史 gitleaks（误报/接受风险）、1 项既有 Credo
  暂缓项保留，Phoenix 漏洞与前端三项工具缺失仍 pending（B16），不改处置状态压绿。
  编译/架构/I1/I2/I3/N-NARR/Sobelow/Semgrep/队列检查通过。扫描入口补本地工具预检，
  缺工具返回失败，阻止当前环境 pnpm 自动补装；测试并入既有扫描入口。
  产品页面验收：本 checkpoint 无生产改动，不新增产品 slice 完成声明。

- 2026-08-30 — **队列整体重构**（用户指令）：Current Focus 编年（约 490 行）按
  NEXT 判例收编归 SSOT；队列重排为 Q0 收尾→Q1 作者止血→Q2 哲学补写→Q3 机制刀
  （P1→R2→R1→P2→P3）→Q4 差距回收→主线复位待拍板。结构性判断：北极星 P1 已达成、
  stage 有真实作者被 D8 拦住，主线从机器长跑转向真实作者可用性；排序论证见 §1。
  D1④ 归并入 Q1b；GAP-06/B13 复位进 Q4；模型定版类议题终态=非决策（产品不绑模型）。

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
