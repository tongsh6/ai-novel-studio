# D1 角色真空收口：真空守则、叙事元词捕网与伴生角色 seed 接线

- 状态：doing（CP1）
- 类型：M5 狗粮产品债 D1+D2 收口（`docs/design/notes/2026-08-25-m5-dogfood-observations.md` §3）
- 启动日期：2026-08-25
- 拍板（2026-08-25 用户「全走」）：①守则真空分支 + ③B9 词表扩叙事层元词（=D2）+ ⑤狗粮 seed 具名化并为 CP1；②伴生角色 seed 接线立为 CP2（页面级验收归此）；④立项引导暂缓等 CP2 数据。

## 1. 开工检查（七问）

- **Contract**：VS-00G §2.2 缺席守则增真空变体（`protagonist_missing_vacuum`，系统口径文案层）+ MBC 判例注记；B9 pattern 集扩叙事层元词（生成期 validator 与导出门单一规则源不变）；CP2 消费 R2 伴生契约（`character_seed` 已在白名单，零契约新增）。
- **Invariant**：I-G4 缺席不虚构（真空守则只含行为约束）；B9 单一 pattern 源；采纳边界确认流（叙事元词命中→require_confirmation 走既有 S3）；I1/I2/I3。
- **Boundary**：CP1=`novel_domain`（manifest 真空分支+守则文案）、`novel_application`（validators 词表）、`scripts`（seed 具名化）；CP2=`novel_agent`（prose 伴生指导 roster 空分支，prompt 评审）+ 前端伴生采纳动线；不动 persistence/web 结构。
- **Consumer**：writer prompt（守则段）；采纳边界（B9 确认卡）；CP2=伴生候选卡→角色档案→roster carry 五调用点。
- **Proof**：CP1=manifest 真空分支单测（roster [] → vacuum key；有角色无标记 → 原 key）+ validators 主角命中单测 + seed 具名化后全量回归 + I1/I2/I3；**CP1 属局部证据**。CP2=真实 Tauri 新场景（空档案写首章→伴生角色 seed 出现→采纳建档→次章正文使用该名+真空守则消失），页面级闭环归 CP2。
- **Acceptance Driver**：CP2 场景 `d1-character-vacuum-to-named-roster`（暂名）；产品代码零验收感知。
- **Exploration**：角色 seed 采纳后经档案/`archive_read` characters facet 既有可达；守则/词表非要素物化——不适用。

## 2. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| CP1-T1 | manifest 真空分支 + `protagonist_missing_vacuum` 文案 + MBC 判例注记 | done | `vacuum_variant/2`（仅显式 roster:[] 判真空）；TES 层 reader 缺席且无激活假定时快照不带 roster 键（无法确认≠确认为空）；absence 注入测试 10 例含真空/无源/降级三分支 |
| CP1-T2 | B9 词表扩「主角/反派/配角」+ finding 文案 + 测试 | done | 单一 pattern 源（生成期+导出门+采纳门同扩）；validators 测试含命中/干净负例 |
| CP1-T3 | 狗粮 seed 具名化（陆沉舟）+ 受影响断言校准 | done | 30 处替换；driver 只耦合章标题未受影响；adoption_workflow prose 夹具改干净正文 |
| CP1-T4 | VS-00G §2.2 契约更新 + 局部门禁 | done | 契约增真空变体与 MBC 判例；真退出码门禁链全绿（顺带首抓 CA04 G3 遗留断言败例——world_building 阵容放行后 roster 测试旧 refute 未同步、曾被旧管道链吞掉，本批一并校准） |
| CP2-T1 | prose 伴生指导 roster 空分支（动作指令评审）+ 前端伴生采纳动线强化 | todo | |
| CP2-T2 | 真实 Tauri 全环场景 + verifier + 登记 | todo | |
| CP2-T3 | 全量门禁 + task_done + 收口 | todo | |

## 3. 决策日志

- 2026-08-25 — 真空判定放 `CapabilityFactManifest.evaluate_presence`（domain 纯函数）：仅当快照显式 `roster: []` 才换真空文案；快照缺 roster 数据源维持原守则（无法确认≠确认为空，不冒进指令模型取名）。
- 2026-08-25 — MBC 判例随契约落：为旧模型失败模式（gpt-oss 凭空造角）建的防线（「不得另立新主角」），把守指令的 qwen3.8 逼进镜像失败模式（写「主角」）——换模型族后防线须复验（M3 标本 166 章 0 处「主角」 vs M5 41 处为证）。

## 4. 试行反馈

待 CP2 页面级证据后补。
