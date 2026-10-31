# B48：角色修订 no-op 与同名歧义边界

- 状态：**doing（2026-10-30 作者已确认 C04=A；2026-10-31 CP0 契约与四场景冻结完成，CP1 实施待做）**。
- 登记日期：2026-10-27；来源：B29 主业务已完成，但实模 T2 出现 old==new no-op 候选，且“跨轮已经唯一消歧”与“同名必须澄清”相冲突。
- 上游：[B29](B29-existing-character-role-revision.md)、[B27](B27-systematic-prompt-and-intent-integration.md)、[B31](B31-author-reply-run-binding.md)。

## 1. 为什么必须先裁决

当前有两个独立问题不能混为一谈：

1. **no-op 候选**：old==new 的“角色身份修订”没有实际变化，不应成为作者需要处理的无意义候选，但是否应表现为明确幂等结果也需要定义。
2. **同名歧义**：机械地“同名必问”会误伤跨轮已经唯一解析的正确使用；完全不问又可能在真正歧义时改错角色。

B29 主业务 done 不能重开，T2 也不能记 PASS。任何硬化都不能把 no-op 当正常修订，也不能把所有同名都一律追问。

## 2. 待作者选择的契约方向

### 方案 A：普通无变化说明，保留上下文感知歧义（推荐）

- old==new 不产生 candidate/revision，不写 canon；用现有普通回复与 trace 明确说明“当前已是该状态，无需修改”，不新增结构化 no-change 回执语义。
- 同名但未唯一消歧必须询问且零写入；已经唯一消歧可继续。

### 方案 B：显式无变化业务回执

- old==new 返回可在现有 receipt/why/replay 查询的结构化无变化业务结果，不生成新 revision/candidate，不写 canon；先论证现有回执能否承载，不默认新建卡型或表。
- 只在真正歧义时询问；回执必须区分“实际修改”和“无变化”。

### 方案 C：仅收紧同名判断，暂不处理 no-op

- 先解决真实歧义误判，no-op 暂作为非阻断提示留档。
- 风险是仍可能给作者无意义候选，需要额外说明为何接受。

上述选项保留为评审材料；作者已选择 A 及普通无变化说明方向，见 §6。CP0 按该语义对齐既有文案与输出契约，不把未选的结构化业务回执带入实现。

**2026-10-28 补充（尚待裁决）**：推荐 A 的最小产品效果；B 的额外价值是可查询的结构化“无变化”业务记录，只有真实消费者需要时采用。状态已经满足的 no-op 与重复提交同一请求的幂等是两个问题；两方案都必须保留原请求幂等保护。同名是否已消歧必须有本轮/有效跨轮身份依据，不能用 no-op 守卫替代身份解析。B29 T2 的新硬化只在本任务承接，NEXT 不再重复写“是否登记 slice”。

### 2026-10-30 裁决前边界校准

- 先确定角色身份，再判断是否无变化。名字相同不必然需要追问；只有有效的本轮/跨轮证据足以唯一定位时才继续，真实歧义必须询问且零写入，不能随便挑一个同名角色后宣布“已经是主角”。
- A/B 都须遵守已接受 ADR-0031 的统一裁决与真实 trace；A 不新增的是“无变化业务回执”，不等于没有系统留痕。若前面确实执行了读取/检查，必须保留真实发生的事实，不能把“没改作品”误写成“完全没执行”。
- B 的额外范围是可查询的业务无变化结果，先核既有 receipt/Why 能否承载，不默认新卡型或表；它与系统裁决对象、同一请求的幂等重放分别定义。
- 实现须接入现有角色修订意图、身份读取与结果路径：确认 old==new 后的合法无变化出口不能被误判为错误路由而反复纠错；目标缺失/有歧义时也不能提前返回无变化。既有持久层 duplicate 防重复写不等于已经解决无意义候选体验。
- 此处保留裁决前核对；当前选择见 §6。B29 的历史 T2 结论不因设计接受变成 PASS。

## 3. 开工七问（裁决后补齐实现细节）

1. **Contract**：B29 的 chapter/character ref、base fingerprint、修订候选与回执、B27 操作语义、B31 来源绑定与 ADR-0031 统一裁决；按 C04=A 明确无变化说明，使用真实系统事实来源，不新增无变化业务回执。
2. **Invariant**：old==new 不产生伪修订/新 canon；真正歧义零写入并询问；已唯一消歧不被机械打断；其他角色和正文不变。
3. **Boundary**：application 判断/候选/采纳与上下文消歧，persistence 仅现成角色读取，web/frontend 现有候选与回执，不新增卡型。
4. **Consumer**：已有角色修订候选/采纳卡及作者裁决体验。
5. **Proof**：old==new 以普通无变化说明处理且不产生 candidate/revision；同名未消歧必须询问且零写入，已唯一消歧可继续；不误改其他角色。
6. **Acceptance Driver**：真实 Tauri + 真实模型，覆盖同名未消歧、跨轮唯一消歧、old==new、真实修订四类；产品验收感知逻辑 **no**。
7. **Exploration**：角色 refs、消歧依据、old/new 与回执可从候选/why/replay 查询，不把跨轮来源当隐式默认身份。

## 4. 非目标

- 不重开 B29 主业务，不把 T2 写成通过。
- 不一律同名追问，也不接受无意义候选为正常功能。
- 不新建平行角色身份体系或新卡型。
- 不用 no-op 守卫代替真实模型歧义判断，也不让模型跨轮来源直接覆盖作者明确指定。

## 5. 验证与恢复

- C04=A 已确认；B29 原证据保持历史，实施与新证据按本任务 CP 推进。
- 按 A 形成无变化结果、统一裁决/trace 与四场景真实模型证据；失败不产生错误写入，已有证据保留。
- 恢复时先读 B29 T2、B27 语义和 B31 来源绑定；若选择新回执，必须同时更新前端展示和 replay，不能只改后端。

## 6. C04 裁决记录

- 日期：2026-10-30；来源：本聊天展示 A 普通无变化说明、B 结构化无变化业务回执、C 只处理歧义的选项，推荐 A 后，作者回复原文 **“同意推荐，C04 选 A，继续下一项裁决。”**。
- 已生效选择：**C04=A**。先确认正确角色身份；已是目标状态时直接说明本次无需修改，不生成待采纳候选、新 revision 或 canon 变更，不新增无变化业务回执。
- 身份边界：同名但已由有效本轮/跨轮证据唯一定位时继续；真正有歧义先询问，不随意选同名对象后宣称无需修改。目标缺失/未知不得当成 no-op。
- 审计边界：保留已接受 ADR-0031 要求的统一裁决与真实 trace；实际执行过读取/检查就如实记录，不将无作品变更等同无执行。普通说明采用真实事实与合法来源，不冒充模型过程叙事。
- 本次只关闭作者取舍阻塞；B48 产品实现与验收未完成，B29 T2 仍保留原 known-gap，存量数据不处理。C05–C08 未由本项代选。

## 7. 实施 checkpoint

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 对齐 B29 修订路由、持久角色身份/当前值、合法无变化出口及既有 copy/结果契约；冻结四场景与边界反例；核对 B43 统一裁决依赖 | **done（2026-10-31，见 §8）** |
| CP1 | 先唯一解析身份，再根据真实当前值判 no-op；无变化普通说明、无候选/新修订；真实歧义询问，已消歧不重复问，正常修订保持候选采纳链 | todo |
| CP2 | 接通统一裁决/trace/来源与 Why，回归缺目标、跨作品、错误身份、跨轮证据失效、重复请求和真实修改；不把合法 no-op 当错误路由反复纠错 | todo |
| CP3 | 外部驱动真实 Tauri + 真实模型覆盖 no-op、真实修订、同名未消歧、跨轮已消歧；证明正确对象、无多余候选/写入、其它角色/正文不变，回归 B29/B31 | todo |

本表只细化既有完整范围。若统一裁决 producer 尚未就绪，联动 B43 复用同一能力，不在 B48 复制一份；可独立推进 CP0，不把工程依赖误写为作者仍未裁决。固定文案遵守 copy 约束，真实模型与原生运行按具体预注册/资源安排执行；局部机制通过不代签 CP3 或 B29 T2。

## 8. CP0 契约冻结记录（2026-10-31）

**链路与现有契约（当前 HEAD 证据）**

- 判断入口：`apps/novel_application/lib/novel_application/judgment_protocol.ex:649-675`（`validate_character_profile_route/execute`）在 execute 时校验真实目标、唯一 `character_ref` 与作者原话可确定目标叙事角色；**不比较 old/new**。
- 候选构建：`pending_artifact_workflow.ex:377-430`（`revise_character_profile/4`）→ `character_profile.ex:66-95` `resolve_target/3`（身份/同名消歧）→ `character_profile.ex:120-160` `build_candidate/4` → `validate_changes/1` `character_profile.ex:141-175` → `pending_artifact_workflow.ex:403-470` `build_character_profile_candidate/5`。
- 现状缺口：`build_candidate/4` 无条件生成 `changes = [%{field: "narrative_role", old: old, new: desired_role}]`，**没有 old==new 判断**；B29 T2 真实模型因此产生 `PROTAGONIST → PROTAGONIST` no-op 候选（B29:141，`pending=1`、DB 零写入）。
- 采纳侧：`adoption_repository.ex:1684-1706` `apply_character_revision` 已有 duplicate 幂等（已等于 `new_role` 且 fingerprint 匹配 → committed duplicate 回执）；但只发生在作者采纳后，不能阻止无意义候选进入待办。
- 结果契约：候选 → TurnResult `execution_candidate` + pending `character_profile_revision`（artifact_type）；采纳 → receipt（ADR-0019/ADR-0027）；文案由后端 `candidate_title/candidate_body`（`character_profile.ex:146-166`）与前端 `frontend/src/lib/copy.ts:181/187`（`acceptLabel: "保存到作品"`）承载，不新增卡型。
- Trace：DecisionTrace `decision_type: :character_profile_revision`、事件 `character_profile_revision_candidate_built`（`pending_artifact_workflow.ex:463-470`）。

**C04=A 落地语义冻结**

1. `old == new`：不产生 candidate/revision/canon 变更；回合以普通作者可见说明呈现「当前已是该状态，本次无需修改」；**不新增**无变化业务回执（不新表、不新卡型、不新 receipt 语义）。
2. 必须保留真实发生的事实：若本轮真实执行了角色读取/身份核对，trace/事件如实记录；不把「没改作品」写成「完全没执行」。
3. 身份优先：同名但已由有效本轮/跨轮证据唯一定位 → 继续；真正歧义 → 询问且零写入；目标缺失/未知不得当成 no-op。
4. 幂等独立：同一请求重复提交沿用原请求幂等保护；no-op 与幂等是两个问题，不互相替代。

**四场景冻结（CP3 验收输入）**

| 场景 | 输入 | 期望 |
|---|---|---|
| S1 no-op | 对已是 PROTAGONIST 的角色说「指定X为主角」 | 普通说明、无 pending 候选、无 revision/canon 变更、无采纳动作；trace 保留真实检查事实 |
| S2 真实修订 | 配角 → 主角 | pending candidate（old≠new）、作者采纳后同一角色 id 更新、其它角色与正文不变 |
| S3 同名未消歧 | 两个同名角色且无有效消歧依据 | 询问（await_author）、零候选、零写入 |
| S4 跨轮唯一消歧 | 上一轮已唯一指向某角色，本轮继续同名引用 | 继续、不重复询问；按真实 old/new 落到 S2 或 S1 语义 |

**边界反例矩阵**

- 目标缺失（作者没说是谁）→ 询问/诚实失败，不得 no-op。
- 跨作品或错误身份 → 拒绝，不得 no-op。
- 跨轮证据失效（对象删除/改名/角色已变）→ 重新询问。
- 重复请求（同 turn retry）→ 幂等，不重复候选。
- 真实修改 → 候选链保持，不得被 no-op 守卫误伤。

**B43 依赖结论**

- CP1 的 no-op 出口在 application 本地（`CharacterProfile` / 待办 workflow）即可实现，不依赖 B43 `MissingPolicy` 门序；不新增 gate。
- CP2 的统一裁决/trace 复用现有 ADR-0031 真实 trace 与 judgment decision；若 B43 后续修改共享 producer，B48 复用同一能力、不复制一份。
- `B43` 只是工程依赖，不是作者裁决前置；NEXT 不再把 B48 整体写成「待 B43 裁决」。

**CP1 实施约束（下一 checkpoint）**

- 落点：`CharacterProfile.build_candidate/4` 返回 no-change 分支（或 workflow 判断），由 application 生成普通说明 TurnResult；不新增卡型/表。
- 必须保留 frame/trace/事件顺序，`truthfulness.production_write_performed=false`。
- 测试：纯函数 no-op/真实修订矩阵 + workflow 级（候选缺失、普通说明文案）+ 回归 B29 23 项确定性场景。

**CP0 结论**：契约与四场景已冻结；CP0 done。CP1–CP3 按 §7 表推进；CP3 真实模型 + 真实 Tauri 需按预注册与资源窗口执行，未获窗口前不标完成。
