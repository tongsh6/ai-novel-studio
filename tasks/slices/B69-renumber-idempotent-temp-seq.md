# B69：章节重编号 from==to 项残留临时 seq（B33 CP3 真实模型原生发现）

- 状态：**done（2026-10-30 CP0–CP3：确定性复现→持久层修复→B30 真实页面回归→B33 CP3 真实模型 S5 回归）。**
- 类型：产品数据完整性缺陷（persistence 采纳事务），不是文档/机制缺口。
- 来源：B33 §元原则整改 CP3 真实模型原生批次 `artifacts/slice-verify/b33-authoring-intent-judgment-reliability-tauri-strata-native-b33cp3full1/`。S5「把全书章节编号理顺，只改列表编号，内容不要动」：judgment `execute maintain_chapter_structure` → 候选 `chapter_structure_change_plan`（4 章）→ 作者采纳 → action_result `accepted`，`committed_mapping = [{第01章,1→1},{第03章,3→2},{第05章,5→3},{第07章,7→4}]`；但只读 DB 快照显示 `chapters.seq = [2,3,4,1000001]`：第01章（from==to）残留临时 seq，`1000001`，C 断言 `S5.chapters_seq_dense` 失败。批次其余 73/74 检查通过。

## 1. CP0：复现与根因（2026-10-30）

- 代码位置：`apps/novel_persistence/lib/novel_persistence/adoption_repository.ex` `execute_renumber/2`（两阶段事务）。
- 根因：第一阶段对每个目标章写入临时 seq `1_000_000 + index`；第二阶段对**phase1 之前加载的同一 struct** 调用 `Ecto.Changeset.change(target.chapter, %{seq: target.new_seq})`。当 `from_seq == to_seq`（如第01章 1→1）时 changeset 为空（struct 里 seq 仍是原值），`Repo.update!` 不产生 UPDATE，数据库保留临时 seq。所有发生位移的章都正常写回，因此只在「dense 重编号且首章无需移动」等场景暴露。
- 必现条件：mapping 中至少一项 `from_seq == to_seq` 且存在其它位移项；无需模型随机性，纯 persistence。
- 复现证据：B33 CP3 批次 `b33-S5.json`（chapters seq 2/3/4/1000001）与 `native-transport.jsonl` 的 accepted receipt（committed_mapping 1→1）。
- 影响：作品章节序号出现 `1000001`，TOC/阅读/后续重编号/写作坐标读到错误 seq；receipt 却报告 accepted + object_count 4（静默数据损坏）。

## 2. 冻结契约与不变量

1. `renumber_chapters` 采纳事务完成后，每个目标章持久 `seq` 必须等于 `committed_mapping` 的 `to_seq`（**包括 from==to 项**）；任何 `1_000_000` 级临时 seq 不得留在持久事实中。
2. 事务失败必须整体回滚，返回 `partial_failure`/`duplicate_seq` 等可解释错误，零残留；不得先提交部分结果。
3. chapter_id 集合/章数/归卷/title 文本/正文 hash/摘要引用不变；receipt 的 committed_mapping 与 DB 事实一致。
4. 修复不得放宽唯一性/越界/跨作品/蓝图类型校验；不新增接口或 schema。

## 3. 开工七问

1. **Contract**：B30 §5 章节重编号契约、ADR-0019 采纳状态、ADR-0028 卷结构；`renumber_receipt/3` 与 `committed_mapping` 语义。
2. **Invariant**：见 §2（seq=to_seq、零临时 seq、事务原子、其它事实不变、receipt 与事实一致）。
3. **Boundary**：仅 `AdoptionRepository.execute_renumber/2` 及其回归测试；不改 UI/判断/编排/域规则，不改 B30/VS-00J 契约。
4. **Consumer**：采纳 action_result/receipt、档案 TOC、阅读投影、写作坐标、后续 renumber/探索。
5. **Proof**：确定性 regression（from==to 项不得残留临时 seq；事务后 seq 全等于 to_seq；位移/交换/重复采纳幂等测试保持）；真实页面 scoped 复验（B30 原生/浏览器场景）+ B33 CP3 S5 scoped 真实模型复验。
6. **Acceptance Driver**：`scripts/tauri_slice_verify.sh b30-chapter-renumber-roundtrip`（既有外部驱动，确定性 provider）验证真实工作台采纳/刷新/消费者；B33 CP3 批次 scoped replay（同 6 场景真实模型）验证修复后 S5 通过；产品验收感知 no。
7. **Exploration**：不涉及模型作品知识获取，不适用。

## 4. CP 计划

| CP | 工作 | 状态 |
|---|---|---|
| CP0 | 复现（红测）+ 根因/契约冻结 + 影响登记 | doing（本节完成） |
| CP1 | 修复 `execute_renumber/2`（phase2 以 DB 当前事实写入，事务内校验后提交）+ regression test；保持幂等/交换/负例测试 | **done（2026-10-30）**：phase1/phase2 均按 `chapter.id` 直接 `update_all` 写 DB 当前事实，事务内逐章复核 `seq == new_seq` 否则整体回滚；新增红→绿回归测试 |
| CP2 | scoped 复验：B30 外部驱动真实页面重编号闭环 + B33 CP3 S5（及必要整批回归）真实模型；失败只读保留 | **done（2026-10-30）**：B30 真实页面场景 PASS；B33 CP3 修复后批次 S5 检查通过（seq=[1,2,3,4]） |
| CP3 | 门禁/台账/B30/B33 文档同步与残余登记 | **done（2026-10-30）**：本文 + B30/B33 交叉引用 + ledger；全门禁见 §6 |

## 5. 验证与恢复

- 确定性：`mix test apps/novel_persistence/test/novel_persistence/b30_renumber_test.exs apps/novel_application/test/novel_application/b30_renumber_adoption_test.exs`。
- 真实页面：`bash scripts/tauri_slice_verify.sh b30-chapter-renumber-roundtrip`（确定性 provider，原生/浏览器驱动按脚本默认）。
- 真实模型回归：B33 CP3 `b33-authoring-intent-judgment-reliability` 批次（strata/iq3_s 单槽，结束后 unload 核验）。
- 失败批次只读保留，不覆盖；重跑使用新 artifact tag。

## 6. CP1–CP3 记录与证据（2026-10-30）

### 6.1 CP1 修复

- 代码：`AdoptionRepository.execute_renumber/2` 两阶段均在事务内以 `chapter.id` 直接写数据库当前事实（`update_all`），不再对 phase1 之前的 struct 做空 changeset 更新；phase2 后事务内逐章复核 `Repo.get!(Chapter, id).seq == target.new_seq`，任一不符 raise 使事务整体回滚并返回 `partial_failure`，杜绝望报 accepted 而残留临时 seq。
- 红→绿：新增 `apps/novel_persistence/test/novel_persistence/b30_renumber_test.exs`「B69：from==to 的章不得残留临时 seq」——修复前实测 `1000001`，修复后 `[11,12,13]` 且无 `>=1_000_000` 残留；原有交换/幂等/负例测试全部保持绿色。
- 边界：只改持久层重编号执行；未改 UI/判断/编排/契约/schema。

### 6.2 CP2 scoped 复验

- **真实页面（确定性 provider）**：`bash scripts/tauri_slice_verify.sh b30-chapter-renumber-roundtrip` 通过（exit 0，浏览器驱动批次 `artifacts/slice-verify/b30-chapter-renumber-roundtrip-tauri/`）。
- **原生页面（修复+credo 重构后最新代码，确定性 provider）**：`TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_NATIVE_TRANSPORT_PROXY=1 TAURI_NATIVE_ARTIFACT_TAG=b30fixnative bash scripts/tauri_slice_verify.sh b30-chapter-renumber-roundtrip` + 外部 `scripts/native_b30_drive.mjs`：**30/30 + T8 6/6 通过，runner exit 0**（`artifacts/slice-verify/b30-chapter-renumber-roundtrip-tauri-native-b30fixnative/`）；覆盖 dense/交换/幂等/刷新/消费者/负例/卷蓝图既有 T1–T6。
- **真实模型回归（strata/iq3_s 单槽）**：B33 CP3 修复后批次 `artifacts/slice-verify/b33-authoring-intent-judgment-reliability-tauri-strata-native-b33cp3full2/`。S5「把全书章节编号理顺，只改列表编号，内容不要动」：judgment execute maintain_chapter_structure → 候选采纳（receipt accepted, committed_mapping 1→1/3→2/5→3/7→4）→ 只读 DB `chapters.seq=[1,2,3,4]`，`S5.chapters_seq_dense` 通过；title/正文 hash/角色不变检查通过；运行结束 strata `loaded=null`。
- 修复前批次 `b33cp3full1`（失败只读保留）证明该缺陷真实可复现；修复后同场景通过，属“产品缺陷修复后的 scoped 回归”，不是重跑换分。

### 6.3 残余

- B33 CP3 第二次整批中 S3/S4 出现新的真实模型行为失败（S3 讨论却 execute 生成角色候选；S4 writer/候选未产出而 capability_gap 收束），与本缺陷无关，已登记在 B33 CP3 记录与 known-gap，不因 B69 关闭而销账。
- 临时 seq 偏移常量仍为 `1_000_000`（事务内私有实现），不暴露接口；若未来并发/软删除参与 seq 计算需另立 slice 复核，不在本修复放宽任何守卫。
