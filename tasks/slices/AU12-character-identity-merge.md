# AU12-character-identity-merge：同名/别名角色的身份归并

**状态**：registered（未开工）
**来源**：2026-07-29 M4b 短跑实锤——档案里出现 4 行同名「沈洛」。
拦截侧已修（见下"已落地的前置"），**归并侧尚无能力**。

## 1. 问题

`name` 不是身份主键。同名有三种创作情形，机器无法自行判定：

| 情形 | 作者意图 | 期望后果 |
|---|---|---|
| 真重名 | 书里确实有两个「沈洛」 | 两行并存，需可区分（消歧标注） |
| 别名/化名 | 「沈洛」与「洛公子」是同一人 | 一个身份，多个称呼 |
| 改名 | 前 20 章叫「沈洛」，之后改叫「沈砚」 | 同一身份换主名，历史称呼保留 |

因此**禁止按 name 静默 upsert / 自动合并**——那会把作者的三种意图压成一种。

## 2. 已落地的前置（2026-07-29，VS-00G CP6 顺带）

- **源头减重复**：盘点 prompt 带已在档角色名单，明示"不要再作为新角色提案"
  （`FactInventoryService.inventory_prompt/4` 的 `known_characters` 段）。
- **采纳端拦截**：`character_seed` 采纳遇同名已采纳角色 → `require_confirmation`
  （`AdoptionBoundary.duplicate_character_decision`，reason_codes
  `["duplicate_character_name", "confirmation_required"]`）。
- **暂定行就地转正**：同名 tentative AI 假定行被采纳时就地转正，不插新行（CP5b）。

这三层只解决"不再新增重复行"，**不解决"已经有的重复行怎么办"**。

## 3. 本 slice 范围（待设计）

1. **消歧标注**：真重名情形下两行如何在档案/召回/写作注入里可区分（现有 `name`
   之外是否需要 disambiguator，还是靠既有 `summary`/`role` 字段——按"慎重新增实体"
   四步阶梯先查既有字段）。
2. **别名**：一个角色多个称呼。同样先查既有实体——记忆类 `CHARACTER_PROFILE` 条目
   能否承载，还是必须落 characters 字段。
3. **合并动作**：档案侧作者动作，把 B 行并入 A 行，历史引用（弧光账 last_seen、
   记忆 subject、章摘要人物栏）如何跟随，不能产生悬空引用。

## 4. 七问（开工前必须补全）

现只能答其中三项，**其余答不上来即说明还没到开工时机**：

- **Contract**：合并动作的处置枚举与既有 adoption/archive 动作族的关系（待定）
- **Invariant**：合并后不得产生悬空引用；canon 只从 tentative 入的 INV-1 不受影响
- **Boundary**：novel_domain（身份规则）+ novel_persistence（合并事务）+
  novel_web/frontend（档案侧动作）；不动盘点与采纳链（已修）
- **Consumer**：作品档案角色区（待定具体入口）
- **Proof**：待定
- **Acceptance Driver**：并入 AU-12 档案场景族（不新起近重复场景）
- **Exploration**：合并后探索面读到的应是合并后的单一身份（待验）

## 5. 决策日志

- 2026-07-29 — 用户就"如何处理同名角色"提问后拍板：不按 name 静默 upsert，
  同名一律交作者裁决；归并能力单独成 slice，本批只做拦截。
