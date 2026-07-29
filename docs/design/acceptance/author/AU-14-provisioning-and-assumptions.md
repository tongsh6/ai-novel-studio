# AU-14 补全我这本书的缺口（设定盘点与暂定设定）

> 作者视角：我可能不是那种一开始就把角色、世界规则、卷纲都整理好的人——我经常是先写着，
> 设定在脑子里、在正文里，但没登记进档案。写到几十章，系统其实比我更清楚"这本书事实上有谁、
> 有什么规则"。我需要它**替我把这些从正文里捞出来**，整理成一份我一眼能看、逐条能采纳的清单；
> 在我还没来得及采纳之前，它对"主角是谁"的合理猜测也别憋着——**标着"暂定"先按这个写**，
> 我随时能一键坐实或否掉。系统只提议、只暂用，**从不替我把猜的东西变成既定事实**。
>
> 立档依据：2026-07-22 M3 节拍狗粮审计实证地基事实真空（characters=0/弧光账无主体/设定记忆=0，
> 百章书审计），`contracts/VS-00G` 冻结承重事实完备性与补全回路。本 AU 是其验收家族；四方边界：
> 与 AU-09（记忆事实）、AU-12（立项档案视图）、AU-13（进度账面与对账）互斥——**本 AU = 补全提案
> 与暂定设定**（把缺的建起来），AU-13 是账面（把跑偏的报出来）。

---

## 1. 我能做什么

- 让系统盘点：AI 读全书正文/摘要，反向提炼出"事实上的设定"（主角团、世界规则、伏笔、风格），
  给我一份 tentative 提案清单，我逐项采纳/编辑后采纳/丢弃。
- 三条触发路径：审读发现"主角没登记"时在处置按钮里点"发起盘点"（A）；档案面板底部"发起设定
  盘点"主动发起（B）；写满 N 章仍无角色档案时系统在对话里主动提议（C，同一缺失只提一次、可关闭）。
- 一次盘点同时产三类：档案提案（角色/规则/伏笔）+全书规划字段建议（目标体量/连载形态）+暂定设定候选。
- 在我采纳前，系统对必需事实（如主角）的合理猜测会以【暂定】标注进入写作——我在「暂定设定」区
  一眼能看见，一键确认（坐实为正式档案）或否决（作废，不再自动重提）。

## 2. 不变量

| # | 不变量 | 上游 |
|---|---|---|
| AU14-I1 | 盘点提案只用既有 artifact 家族与既有采纳边界；零新写入通道 | VS-00G I-G5 / 06 §4.5 |
| AU14-I2 | 暂定设定（tentative + provisional_active）任何状态都不算 canon；档案权威区/记忆召回/写作事实层只认 accepted | VS-00G I-G2 / ADR-0019 INV-2 |
| AU14-I3 | 暂定设定注入必带【暂定】标注与依据；无标注注入=违约（prompt 采样可验） | VS-00G I-G3 |
| AU14-I4 | 暂定转正唯一路径=作者确认→status=accepted（就地，ADR-0019 INV-1）；系统永不静默转正 | VS-00G I-G2 / ADR-0010 |
| AU14-I5 | 记忆类暂定不写 memory_items（走注入期临时文本），确认时才落 memory | VS-00G §2.3 / AU-09 红线 |
| AU14-I6 | 本回路零新增存储实体（暂定=既有对象 tentative 态+标注字段） | VS-00G I-G7 |

## 3. 契约引用

`contracts/VS-00G-fact-completeness-and-provisioning-contract-pack.md`（§2.3 暂用态/§3.3 盘点/
§3.4 生命周期/§5 不变量）、`06` §4.5（seed 采纳映射）、`VS-04`/`ADR-0010`/`ADR-0019`（采纳边界）、
`08` §4（要素模型）、`45` §2/§4.3（引导流与读文本→提取范式）。

## 4. 验收场景（随 CP 立档，编号预留）

| 场景 | 内容 | CP |
|---|---|---|
| SC-AU14-A1 | 空档案写至 N 章 → 负债 finding（主角未物化）→ 处置"发起盘点" → 提案集含主角团 → 逐项采纳 → 弧光账开始记账（地基真空病例的产品级修复回路全链） | VS-00G CP4 |
| SC-AU14-A2 | 盘点提案未采纳期间 → 主角暂定 provisional_active → 写作 prompt 带【暂定】→ 作者否决 → 注入消失、写作回缺席守则 | VS-00G CP5 |
| SC-AU14-A3 | 面板「暂定设定」区显示暂用态角色 → 一键确认 → 就地 tentative→accepted → 进正式角色档案、暂定标注消失 | VS-00G CP5 |
| SC-AU14-B1 | 面板"发起设定盘点"主动发起 → 三类提案（档案+规划字段+暂定候选）→ 逐项处置 | VS-00G CP4 |

## 5. 覆盖状态

**4/4 完整闭环**（2026-07-28）。SC-AU14-A2 与 SC-AU14-A3 于 2026-07-28
通过真实 Tauri 页面验收（VS-00G CP5e）：

- **A3**（`au14-assumption-confirm-roundtrip`）：空角色档案发起盘点 → 主角自动物化为
  【暂定】设定并在完成消息中通知 → 档案概览「暂定设定」区可见（badge/主角行/确认/
  否决）→ 一键确认 → 同一行就地转正 accepted 进正式角色档案（恰一行，无重复），
  暂定区消失。
- **A2**（`au14-assumption-provisional-injection`）：假定激活期生成正文 → 机械准备
  `assumption_active>=1` 且主角不再计缺席（design_missing 无 protagonist）→ 概览
  「否决」→ 再生成一章 → `assumption_active==0` 且主角缺席守则回归。

SC-AU14-A1 已于 2026-07-24 通过真实 Tauri 页面验收：
空角色档案已有 10 章正文 → 作品档案「审读」发起全书审读 →
唯一 `protagonist_undermaterialized` finding 点「发起盘点」→ 服务端反查并绑定
`report_id + finding_index + finding_rule` → `fact_inventory_v1` 提案包含主角沈砚 →
逐项采纳沈砚后角色档案出现正式主角 → 再生成并采纳包含沈砚的第 11 章正文 →
脉络账首次出现「沈砚 / 延续中」。采纳主角不倒灌前 10 章历史账面。

SC-AU14-B1 **完成**（2026-07-28，OQ4 三类同产在单一场景内全部断言）：
真实 Tauri 作品档案入口 → `fact_inventory_v1` → 角色/规则/伏笔既有 seed 提案 +
`work_skeleton_suggestion` 规划建议（target_length 缺位）+ 暂定候选（完成消息明示
「已把盘点出的主角列为【暂定】设定」、概览暂定设定区可见、`get_assumptions`
count>=1）→ 5 个独立 pending/15 个逐项动作 → 采纳角色 1+规则 1+规划建议 1 →
档案投影 1/1/0、概览「目标体量」显示回写值 300000（采纳前为空），另一个角色和
伏笔仍 pending；同名采纳把暂定行就地转正（采纳后 `get_assumptions` count=0，
零重复行）。

**B1 再扩展（2026-07-29，M4b 短跑抓出的两个行为补真实页面验收）**：

- **候选组采纳文案按 artifact 类型分派**：盘点同批产 2 条 `work_skeleton_suggestion`
  时渲染为候选单选组，采纳按钮可见名必须是「采纳方案 A 为**全书规划**」——它写的是
  works 立项字段，不是档案对象。负例翻回通用的「保存方案 A 到作品档案」时 evidence
  必须为 null。此前漏掉是因为规划建议只有单条，走的是非候选组路径。
- **同名角色升作者裁决**：**不预置同名 ACCEPTED 角色**（那会让
  `materialize_character` 走 `:skipped_canon_present`，掐断本场景与 A3 都在断言的
  暂定设定链），改为场景内自然产生——沈砚被采纳后再次发起盘点，stub 照抄 M4 实锤的
  真实模型行为把已在档角色当新发现重提。断言链：确认卡文案含角色名与「别名/改名」
  → 确认前档案仍只有 1 行 → 作者确认后出现第 2 行（真重名是合法创作情形）。
  负例覆盖"未拦住"与"文案没说清理由"两种退化。

页面实证：`skeleton_candidate_accept_label` = 「采纳方案 A 为全书规划」；
`duplicate_confirm_message` = 「作品档案里已经有名为「沈砚」的已确认角色。同名可能是
同一个人、别名或改名，也可能确实是两个同名角色——这需要你判断。确认后会新增一条
角色档案；当前未写入作品事实。」；rows 1→2。

## 6. 落地路线

见 `contracts/VS-00G` §7 CP 表（CP4 盘点、CP5 暂定设定）与 `tasks/slices/`（VS-00G 实施 slice）。

## 7. 已知限制

- 负债 finding 触发 A 与其后的主角采纳/弧光起账链已落地；弧光账按后续正文采纳起账，
  不对采纳前历史正文补记。
- 主动触发 B 的角色/规则/伏笔核心链与全书规划字段建议已落地（后者只建议缺位字段，
  采纳=立项字段回写）；暂定候选的盘点同批物化已落地（CP5b，required 主角自动激活）。
- CP5 暂定设定注入与确认/否决生命周期已落地（A2/A3）；触发 C（对话流自动提议）、works 级假定、记忆类假定注入富化仍未落地。假定寿命催办（R8）规则已实现，其真实页面可见性随 R7 一并并入 AU-13 审读场景。
- **同名角色不做静默归并**（2026-07-29 M4b 实锤后拍板）：`name` 不是身份主键，同名可能是
  真重名/别名/改名三种创作情形。采纳端遇同名已采纳角色一律升 `require_confirmation`
  交作者裁决；别名归并与已有重复档案行合并是档案侧能力，另行登记，不在本 AU。
- 盘点材料已带**已在档角色名单**（消除"模型每次把已在档角色当新发现重提"这一重复源），
  但盘点仍可能提出同名新角色（作者可能确实要写第二个同名者）——两层是拦截而非去重。
- 存量书稿导入（粘贴旧稿→建档）不在本 AU（VS-00G OQ8 独立 slice）。

## 8. 验收命令

```bash
bash scripts/tauri_slice_verify.sh au14-finding-inventory-arc-loop
bash scripts/tauri_slice_verify.sh au14-fact-inventory-roundtrip
bash scripts/tauri_slice_verify.sh au14-assumption-confirm-roundtrip
bash scripts/tauri_slice_verify.sh au14-assumption-provisional-injection
```

证据：

- `artifacts/slice-verify/au14-finding-inventory-arc-loop-tauri/summary.json`
- `artifacts/slice-verify/au14-fact-inventory-roundtrip-tauri/summary.json`
- `artifacts/slice-verify/au14-assumption-confirm-roundtrip-tauri/summary.json`
- `artifacts/slice-verify/au14-assumption-provisional-injection-tauri/summary.json`
