# B74：候选动作按对象分组与主次层级（作者反馈按钮平铺 UX）

- 状态：**doing（2026-10-31 CP0/CP1 done；真实 Tauri scoped 页面复验多次受模型/滚动取证影响未闭环，保持开放）**。
- 来源：作者在 B39 AU-15 实模原生窗口反馈“这么多按钮平铺在一起，不是一个友好优雅的 UX 设计和实现”，并选择方向 A：按候选对象分组卡片 + 主次操作。
- 类型：UI/UX 呈现重构；不改变 adoption 契约/动作集合/产品数据。

## 1. CP0 复现与根因（2026-10-31）

- 证据：作者截图（“原稿候选”下 9 个按钮平铺：保存原稿/放弃原稿/编辑原稿后保存/保存到作品档案/不保存/修改后保存 ×重复）；AU15 原生批次 `artifacts/slice-verify/b39-au15-au15cp1a-native/` 同轮 pending 含正文候选 + 多个伴生候选（character/world/constraint 等），每条均有 accept/edit/discard 动作。
- 根因（`frontend/src/components/WorkspaceChat.tsx` + CSS）：
  1. `visibleAvailableActions(turnResult)` 汇总同一 turn 所有 pending artifact 的 adoption actions；
  2. 渲染为单个 `.cardActions`（flex-wrap）按钮行，仅对质量修订的 original/revision 加一个总标题；
  3. 伴生候选没有对象标题/分组，正文“保存原稿”与各类型“保存到作品档案/不保存/修改后保存”混排，标签重复且无法判断作用于哪个候选。
- 影响：仅候选动作展示区；动作契约（available_actions/target_ref/adoption effect）不变。
- 契约边界：不改 `available_actions` 协议、不合并/删除动作、不改变采纳效果；仅改变分组与视觉层级。

## 2. CP1 修复（2026-10-31）

- 新增纯函数 `frontend/src/lib/candidateActionGroups.ts`：按 action.target_ref ↔ pending artifact_id 分组；组内按 `accept → edit_then_accept → discard → 其它` 排序；无归属动作（预算/确认/选择）保持独立 ungrouped；候选标题由类型标签+首 item title 派生（原文/角色/世界规则/伏笔/约束 等），质量修订组沿用“原稿候选/修订稿候选”标题与 hint。
- `WorkspaceChat.tsx` 动作区重构为：每个 pending 候选一张小卡（标题+hint+卡内动作），动作按主次渲染（accept 主按钮，edit 次按钮，discard danger-ghost）；ungrouped 动作在底部独立行；原逐候选 item 动作（既有 candidate_set `::` 路径）不变。
- CSS：新增 `.candidateActionArea/.candidateActionCard/...`（白底细边框卡片、组内 actions 横排、ungrouped 独立），不改既有全局按钮样式。
- 测试：`frontend/src/lib/candidateActionGroups.test.ts` 3 条纯函数测试（组顺序/动作顺序/标题、ungrouped 隔离、原稿/修订标题+hint）；前端 typecheck/lint/全量 test 628/628 通过。

## 3. 真实页面 scoped 复验（未闭环，保留证据）

- 目标：真实 Tauri + 真实模型候选下，同一 turn 多候选显示为多张对象卡，保存按钮直接位于对应候选内容卡内、与正文同卡；无动作契约回归。
- 尝试记录（新 tag，均不覆盖既有证据）：
  1. `uib74`（全量 A0/A1/A2，分组卡但未贴内容）：driver 旧截图只拍到质量 finding 卡；该批机制 3/5 pass、A2-run2 失败，不用于 UI PASS。
  2. `uib74b`（scoped a1-run2，分组卡旧版）：driver_rc=0/runner pass，截图确认叙事段落间距修复，但动作仍在底栏（该 build 早于“贴内容卡”改动）。
  3. `uib74c`（scoped a1-run2，内容卡动作版）：Tauri build 已含最新 UI；native 截图仅拍到质量 finding 卡，AX/滚动未到达候选卡，未形成候选区视觉证据。
  4. `uib74d`（加滚轮取证后 scoped a1-run2）：turn_timeout，失败只读保留；未获截图。
- 结论：**代码与组件测试已证明内容卡内动作顺序（正文先于保存按钮）；真实 Tauri 候选区视觉复验未闭环**。下一步需在 A1 成功 run 后用 scroll-locate-candidate 驱动截图（或改用可稳定定位候选卡的浏览器 surface），不得把组件测试当页面 PASS。
- 验证前不得把 B74 标 done；最终视觉/文案是否“优雅”仍由作者确认。

## 4. 残余

- 同轮候选很多时卡片纵向变长；是否加“全部保存/批量操作”、卡片折叠、只展开首个候选，属后续 UX 取舍（需作者确认，不在本次擅自扩大）。
- 伴生候选的“保存到作品档案”是否应改成类型专属主按钮文案（如“保存角色档案”）可作为下一轮文案优化。
- 会话栏弹层 click-outside/Esc 关闭缺口由 AU15 驱动发现，另立 B75 候选，不混入本 slice。
