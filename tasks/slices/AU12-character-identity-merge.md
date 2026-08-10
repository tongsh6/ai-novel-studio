# AU12-character-identity-merge：角色主体 + 同名/别名身份归并（Order 8 刀序②）

**状态**：in_progress（**CP1/CP2 done 2026-08-10**，CP3 待做；三拍板项已裁决，见 §8）
**来源**：2026-07-29 M4b 短跑实锤——档案里出现 4 行同名「沈洛」；Order 8 排查
（`docs/design/notes/2026-07-29-container-utilization-survey.md` §3.5/§5.2）拍板
本刀范围 = **角色主体（role/aliases 生产写入）必须连身份归并一起做**：
m4b 已证明「有 roster 就有 arc 条目」，但同名重复让弧光账立刻变成 4 条重复行——
只补 roster 不做归并会把空转换成噪声。

## 1. 问题

`name` 不是身份主键。同名有三种创作情形，机器无法自行判定：

| 情形 | 作者意图 | 期望后果 |
|---|---|---|
| 真重名 | 书里确实有两个「沈洛」 | 两行并存，需可区分（消歧标注） |
| 别名/化名 | 「沈洛」与「洛公子」是同一人 | 一个身份，多个称呼 |
| 改名 | 前 20 章叫「沈洛」，之后改叫「沈砚」 | 同一身份换主名，历史称呼保留 |

因此**禁止按 name 静默 upsert / 自动合并**——那会把作者的三种意图压成一种。

另一半问题：`characters.role` 与 `aliases` schema/changeset/消费面全部就位，但
**生产写入路径零喂值**（三库 100% NULL），弧光别名匹配永远退化成单名匹配。

## 2. 已落地的前置（2026-07-29，VS-00G CP6 顺带）

- **源头减重复**：盘点 prompt 带已在档角色名单（`FactInventoryService.known_characters_section/1`）。
- **采纳端拦截**：同名已采纳角色 → `require_confirmation`
  （`AdoptionBoundary.duplicate_character_decision`，reason_codes
  `["duplicate_character_name", "confirmation_required"]`）。
- **暂定行就地转正**：同名 tentative AI 假定行被采纳时就地转正，不插新行（CP5b）。

这三层只解决"不再新增重复行"，不解决"已经有的重复行怎么办"，也没堵住
**别名后门**（见 §4.3）。

## 3. 机器事实（2026-08-10 全链探索，已抽验）

- **schema 就位**：`character.ex` 有 `aliases {:array,:string}` / `role` /
  `narrative_role`，changeset 全 cast；无唯一索引（`(work_id,name)` 索引非 unique）。
- **写入路径共 3 处，全不喂 role/aliases**：
  `adoption_repository.ex` `character_attrs/1`（白名单只有 work_id/name/summary/
  narrative_role/status，注释自陈「aliases 等留 CP2」）；`assumption_repo.ex`
  `materialize_character/1` 同窄；confirm/discard 只改状态。
- **提案白名单是闸门**：`tool_output_contract.ex` `normalize_item/1` 重建式白名单,
  模型输出的 `aliases`/`role` 键会被**静默丢弃**——加字段必须显式 opt-in
  （narrative_role/memory_subtype/skeleton_field 三个先例同构）。
- **消费面全部已接线，只等输入**（R2 同款结构）：
  - 弧光别名匹配：`ledger_maintenance.ex` `subject_in_text?/2`
    `names = [name | aliases || []]`；
  - CA01 阵容注入：`turn_execution_service.ex` `character_roster_line/1`
    渲染 `- name（role）：summary`；
  - 探索面：`exploration_service.ex` `render_characters/1` 用 `narrative_role || role`；
  - `character_roster` 工具输出 aliases（`character_roster_adapter.ex`）；
  - 前端角色行已渲染 role 标签 + `别名：` 行（`StructurePanel.tsx` + `archiveDetail.ts`）。
- **外部引用全图**（合并需跟随的只有一处）：
  - `ledger_entries.subject_ref` = character.id 字符串，幂等键
    `(work_id, ledger, subject_ref)` **唯一索引**——合并时 arc 条目不能改
    subject_ref 了事，必须吸收合一；
  - 章摘要人物栏 / 正文 / prose_execution_brief 的 character_ref 全是**人名文本**，
    合并零动作（别名匹配接住历史称呼）；
  - `memory_items` **没有任何 character 引用字段**（归属仅 work/volume/arc/chapter），
    合并零动作。
- **动作族形态**：档案侧动作走 channel 层短路（`workspace_channel.ex`
  `confirm_assumption`/`discard_assumption` 先例：payload 带 `character_ref`，
  回 `{received, action_status: "applied", ...}`，幂等靠 author_action receipt）。
- **状态弹药**：`AdoptionStatus` 已有 `SUPERSEDED`（读端口只认
  ACCEPTED/EDITED_ACCEPTED，被并入行自动从 roster/注入/探索消失且保审计痕）；
  `ArcLedgerStatus.RETIRED` 存在但**零消费方过滤**——arc 源条目留 RETIRED 行会成
  对账噪声，故吸收后删行更干净。
- **标本**：`tmp/dogfood-db-m4b` 4 行同名沈洛（全 ACCEPTED+PROTAGONIST，
  role/aliases 全空，1 行带 provisional_source）+ 各挂 1 条 arc 账,同 subject_label。

## 4. 设计

### 4.1 合并动作 `merge_characters`（归并半边的核心）

- **载体**：author_action，channel 层短路（循 confirm_assumption 形态）。
  payload：`{source_ref, target_ref, keep_name}`（keep_name ∈ {"target","source"}，
  改名情形选 source = 换主名）。
- **事务**（novel_persistence 单 Multi）：
  1. target.aliases := uniq(target.aliases ++ [source.name | source.aliases]) -- [主名]；
     keep_name=source 时 target.name := source.name，旧主名入 aliases；
  2. source 行 status → `SUPERSEDED`（保痕，读端口天然隐藏；summary 不并——
     target 是作者选择保留的档案行）；
  3. arc 账吸收：target 的 arc 条目 source_refs 并集 + last_seen 取两者较新
     （走既有 upsert）；source 的 arc 条目**删除**（数据已吸收，留行必成对账噪声；
     target 无 arc 条目而 source 有时，等价于改挂 target）；
  4. 幂等：author_action receipt（重复提交返回既有回执）。
- **消歧（真重名）**：不合并即消歧——两行并存靠既有 `role`/`summary` 区分，
  合并选择 UI 必须展示两行的 summary 首行供作者辨认。零新字段。
- **UI 入口**：档案角色区。选中一行 → 详情面板「并入其他角色…」→ Radix Dialog
  列出同作品其余角色（同名行置顶）→ 选目标 + 主名单选 → 确认（展示后果：
  哪行保留、别名如何变化）。文案全进 copy.ts。

### 4.2 角色主体输入面（role/aliases 生产写入）

盘点提炼与 character_design 两条链同构补槽（narrative_role 加字段先例全复制）：

1. 盘点 prompt（`inventory_prompt/4`）character_seed 增：`"aliases"`（正文中
   出现过的别称数组，没有则省略）、`"role"`（一句话身份描述）；
2. `normalize_item/1` opt-in 白名单增 `aliases`（校验字符串数组、trim、去空）与
   `role`；
3. `adoption_workflow.ex` attrs 增 `aliases`/`role` 槽；
4. `character_attrs/1` 与 `materialize_character/1` 增两键；
5. `real.ex` character_design prompt 同构增两字段（保留 stub 正则锚点！）。

### 4.3 别名后门（输入面开闸后必须同批堵）

aliases 一旦有值，「洛公子」的新提案不会被同名拦截拦住（checker 精确匹配 name）：

1. `known_characters/2` 注入名单改为 name+aliases 全集（prompt 的"不要重复提案"
   覆盖别称）；
2. `accepted_character_named?/2` 改为命中 name **或 aliases 包含**（同名确认卡
   文案已按 reason_codes 分派，别名命中时点名"是谁的别名"）。

### 4.4 明确不做（YAGNI，等拉动）

- 单行改名动作（无第二行时的纯改名）——本刀只做"两行归一"；
- 已 SUPERSEDED 行的反悔/拆分；
- 同名确认卡内嵌"直接并入既有行"选项（动作族扩面，若拍板要做则为后续 CP）；
- memory_items 角色主体字段（无引用字段是现状，不新增实体）。

## 5. CP 拆分

- **CP1 归并主链 done（2026-08-10）**：`NovelDomain.CharacterIdentity`（merge_plan/
  absorb_arc_plan 纯计算，单测 9）→ `NovelPersistence.CharacterMergeRepo`（单 Multi：
  别名并集/主名切换/source→SUPERSEDED/arc 吸收-改挂-改标签，单测 6）→
  `CharacterIdentityService` → channel `merge_characters` 短路子句（channel 测试 1，
  含重复提交诚实拒绝）→ 档案角色详情「并入其他角色…」+ Radix Dialog（目标同名置顶/
  主名单选/后果预览，43 §5.0.2）→ **真实 Tauri PASS**：`au12-character-identity-merge`
  场景（seed 复刻 m4b 同名双行+双 arc 形状，两次归并 3→2→1 行、别名可见、
  `get_ledger_threads` entry_count 2→1、零 adoption/记忆写入；证据
  `artifacts/slice-verify/au12-character-identity-merge-tauri/`）。
  坑：脉络数据在面板打开时批量拉取，归并后须关开档案一次才有新读端口留痕。
- **CP2 输入面 + 后门 done（2026-08-10）**：§4.2 全链贯通（盘点 prompt 增 role/
  aliases 两字段 + `normalize_item` 白名单 opt-in（顺带把可选键链重构成统一归约，
  治 credo 复杂度）+ adoption_workflow attrs 增槽 + `character_attrs` 有值才写
  （nil 不进 changeset，防就地转正清空既有别名）+ `materialize_character`/
  主角假定物化带两键 + real.ex character_design prompt 同构）；§4.3 后门两处
  （known_characters 名单含别名 + checker 升级 `accepted_character_matching/2`
  返回 `%{name: 规范行, alias_hit}`，布尔旧 checker 兼容；**别名命中确认卡点名
  「『X』是已确认角色『Y』的已登记别名」**，opts 经 finalize 穿线到文案）。
  单测：contract role/aliases 收敛 + workflow 别名命中卡文案/attrs 贯通 +
  assumption_repo matching/物化带键，全量 1402 后端 + 437 前端绿，I1/I2/I3 PASS。
  **真实 Tauri**：`au14-fact-inventory-roundtrip` 扩断言 PASS（采纳后档案行可见
  身份「底层灵气缴费者出身的调查者」+「别名：砚哥」，同名重提确认链保持绿）；
  `au14-assumption-confirm-roundtrip`/`au14-assumption-provisional-injection`
  复跑 PASS（假定物化路径带 role/aliases 无回归）。
- **CP3 消费面证明（待做）**：①章摘要用**别称**提及 → 弧光 sighting 记账
  （别名匹配首次真实生效）；②阵容注入行含 role 的注入证据；③**别名命中确认卡的
  真实页面验收**（CP2 只有 workflow 单测证据，尚无外部 driver 走真实页面命中
  别名的场景——诚实缺口，不并入 au14 现场景以免破坏既有断言，需独立扩展）。

顺序：CP1 先行（处理存量噪声，给 CP2 新输入兜底），与 Order 8 警告的因果一致。

## 6. 七问

- **Contract**：`merge_characters` 动作进 07-workbench-ui-contract §4 动作族 +
  channel 事件登记；提案 item 增 `aliases`/`role` 键（normalize_item 白名单即
  契约面，循 narrative_role 先例）；21 §7.2 补一行别名/消歧语义；不新增 schema。
- **Invariant**：①合并事务后 arc 账 subject_ref 全部指向存活（非 SUPERSEDED）
  角色行，`(work_id,ledger,subject_ref)` 唯一性保持；②合并是纯档案操作，零
  正文/记忆/章摘要写入；③幂等（receipt）；④INV-1（canon 只从 tentative 入）
  不受影响；⑤别名只扩召回，不改写任何历史文本。
- **Boundary**：novel_persistence（merge 事务 + 白名单增槽）、novel_application
  （service 编排 + 盘点 prompt + 后门两处）、novel_web（channel 短路动作）、
  novel_agent（real.ex prompt 两字段）、frontend（档案合并入口）。**不动**拦截
  三层既有逻辑（只扩 checker 匹配域）、不动 ledger 对账规则、不动 memory。
- **Consumer**：弧光维护别名匹配（aliases 首个真实消费者）、CA01 阵容注入
  （role）、档案角色区（合并入口 + 归一后单行）、探索面 archive_read characters
  facet、`character_roster` 工具。
- **Proof**：persistence/domain 单测（事务五不变量）；两条真实 Tauri 场景
  （CP1 合并场景 + CP2 au14 扩展）；m4b 形状 seed 复刻；全门 green。
- **Acceptance Driver**：并入 AU-12 档案场景族（外部 driver 操作真实档案 UI：
  点详情 → 并入 → 选目标 → 确认 → 断言档案/网络帧/app log/探索面），产品代码
  零验收感知。
- **Exploration**：合并后 `archive_read` characters facet 返回单一身份含别名；
  `character_roster` 工具输出 aliases（已支持，输入到位即生效）——探索面同批可达。

## 7. 拍板项（已全部裁决，2026-08-10）

1. **被并入行处置**：`SUPERSEDED`（零新状态、保审计、读端口天然隐藏）。
2. **合并入口**：档案侧先行；同名确认卡内嵌"并入既有行"选项列为后续 CP 单独拍板。
3. **CP2 范围**：盘点 + character_design 两条链同批。

## 8. 决策日志

- 2026-07-29 — 用户就"如何处理同名角色"提问后拍板：不按 name 静默 upsert，
  同名一律交作者裁决；归并能力单独成 slice，本批只做拦截。
- 2026-07-29 — Order 8 刀序拍板：刀②=角色主体+AU12 归并同做（§3.5「只补
  roster 不做归并会把空转换成噪声」）。
- 2026-08-10 — 全链探索 + 七问补全（本文档 §3-§6）。
- 2026-08-10 — 用户裁决三拍板项：①被并入行置 SUPERSEDED；②合并入口档案侧
  先行（确认卡内嵌选项另拍）；③CP2 覆盖盘点+character_design 两链。CP1 开工。
