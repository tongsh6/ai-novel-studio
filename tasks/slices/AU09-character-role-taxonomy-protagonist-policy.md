# AU09 Character Role Taxonomy / 角色类型与主角语义规范

- 状态：CP1 闭环（结构化 narrative_role + 主角感知诚实问答 + 真实页面验收）
- 类型：Domain Contract Slice + Dialogue Slice + UI Contract Slice
- 启动日期：2026-06-23
- 来源反馈：用户问题 9、12、13
- 所属验收：`docs/design/acceptance/author/AU-09-story-memory.md`；关联 `AU-11` 引导策略和 E2E 只读 `character_roster` 工具。

## 1. 用户 / 系统目标

作者能清楚地区分“角色是什么类型”，尤其是“主角”是否已经被作品事实确认。输入“主角设定”“主角是谁，叫啥”这类请求时，系统不能只机械返回“当前作品已有 1 个已确认角色”，而应基于当前作品背景、设定和已确认角色，说明谁是主角、是否缺主角标记、是否需要继续设计或采纳新的主角设定。

本 slice 不把普通角色列表读取伪装成主角识别能力；目标是把角色类型、主角语义、读写边界和用户问法统一到可验证的产品行为。

## 2. 开工检查

- **Contract**：`docs/design/domain/21-novel-object-model.md` §7.2 character；`docs/design/domain/34-novel-element-field-priority.md` 中主角要素；`docs/design/domain/24-novel-intent-catalog.md` 角色创建/查询意图；`AU09-character-dossier-roundtrip` 的 Character 主档案单一源。
- **Invariant**：
  - `character_seed` 采纳后的 Character 主档案仍是角色主体单一源；角色演化记忆不能替代主档案。
  - “主角”必须是角色类型或叙事功能上的显式/可解释事实；没有确证时必须诚实说明，而不是把第一个角色默认当主角。
  - 只读问题不能写入作品事实；创建/修订主角设定必须产出 pending artifact 并走采纳边界。
  - 回答“主角是谁”时不得编造姓名、类型或已确认状态；必须区分 accepted / tentative / missing。
- **Boundary**：
  - `novel_domain` / `novel_persistence`：核对 Character 当前字段是否足以表达 role_type / narrative_role / protagonist 标记；若不足，先形成最小 contract，再实现迁移。
  - `novel_application`：角色查询、ContextAssembler、`character_roster` 只读工具和角色设计 prompt 需要消费同一角色类型语义。
  - `novel_agent`：角色设计/查询的 provider prompt 需要明确“主角设定”是查询、澄清还是创建候选，不靠关键词硬分支。
  - `frontend`：作品档案角色 tab 和消息可见文本需要展示角色类型或“未标注主角”的诚实状态；文案集中在 `copy.ts`。
  - **不改**：不把角色 memory 当主角事实源；不在生产 UI 加验收 hook。
- **Consumer**：作者自然对话、作品档案角色 tab、`character_roster` 只读工具、ContextAssembler / why 面板。
- **Proof**：
  - 后端测试覆盖 accepted protagonist、accepted non-protagonist、无 protagonist、tentative protagonist 四类查询。
  - 真实 Tauri 验收：已有角色但无主角标记时，输入“主角是谁，叫啥”返回诚实缺口和可继续设计入口，且 no-write；已有主角时返回主角姓名/类型/来源。
  - 真实 Tauri 验收：输入“主角设定”在缺主角时进入角色设计或澄清链路，不再只返回普通角色列表。
- **Acceptance Driver**：新增 `au09-character-role-taxonomy-protagonist-policy` 外部 Tauri driver；产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不需要基础工具变更 |
| novel_domain | maybe | 如需新增角色类型枚举或纯函数校验 |
| novel_agent | yes | 角色查询/设计 prompt 与主角缺失策略 |
| novel_application | yes | ContextAssembler、角色查询/只读工具、TurnResult 语义 |
| novel_persistence | maybe | Character 字段或 read model 可能需要扩展 |
| novel_web | maybe | Channel/DTO 暴露角色类型 |
| frontend | yes | 角色 tab 展示、消息文案、可能的缺口提示 |
| docs/design | yes | 若字段或语义冻结，先同步角色 contract |
| quality | yes | 新增场景化验收 manifest |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计当前 Character 字段、角色 prompt、`character_roster` 和“主角”问法路径 | done | 现状已查清：`role` 自由文本无结构化主角；`character_roster` narrate 机械列名单；planner/“主角是谁”被吞 |
| T2 | 定义 role type / protagonist 语义与缺失处理规则 | done | `NarrativeRole` 枚举（PROTAGONIST/ANTAGONIST/SUPPORTING/MINOR/ENSEMBLE_POV），codegen 自 `docs/design/schemas/foundation/enums/narrative_role.json`，依据 34 §5 落 character；支持多主角/群像 |
| T3 | 修复“主角设定”“主角是谁，叫啥”的意图与 no-write 响应 | done | `CharacterRosterNarration` 主角感知（accepted/无标记诚实/不默认第一个），planner 与 provider 区分查询 vs 设计；只读 no-write |
| T4 | 让作品档案、只读工具、上下文组装消费同一角色类型语义 | done | `WorkArchiveRepo.characters` + roster adapter + 前端角色 tab/detail/copy 单一 narrative_role 源 |
| T5 | 补真实 Tauri driver、局部测试、quality manifest | done | `au09-character-role-taxonomy-protagonist-policy` Tauri driver 通过；后端四类覆盖；quality manifest 挂入 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收（`artifacts/slice-verify/au09-character-role-taxonomy-protagonist-policy-tauri/summary.json`，`scripts/quality_accept.sh ... --surface tauri` 通过）
- [x] 后端 / Channel / application 局部验证（domain/contract/persistence/application/agent provider 四类 + 路由测试全绿）
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs`
- [x] `bash scripts/quality_manifest_check.sh`
- [ ] `bash scripts/task_done.sh --slice au09-character-role-taxonomy-protagonist-policy --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 2 FAIL：gitleaks ProjectGod 历史 = 既有 accepted_risk；task-done-manifest = 待本 slice 生成）

## 6. 决策日志

- 2026-06-23 — 登记用户反馈 9/12/13。现有角色主档案 CP1 已打通，但“角色类型 / 主角”仍缺统一语义；自然问法被只读角色列表回答吞掉，需作为 AU-09 后续队首处理。
- 2026-06-23 — 契约门定案（§7）：主角 = Character 的结构化**叙事角色**分类（叙事功能层），不是作品立项字段，也不只是关系。用户确认在 Character 上新增 `narrative_role` 枚举，支持多主角（群像），按 narrative_role 聚合回答。
- 2026-06-23 — CP1 闭环：`NarrativeRole` 枚举 + Character domain/schema/migration + item→artifact→adoption→Character→roster 全链路 + 主角感知 narration（`CharacterRosterNarration`）+ planner/provider 区分查询 vs 设计 + 前端角色类型展示。真实 Tauri driver `au09-character-role-taxonomy-protagonist-policy` 通过：无主角→诚实缺口 no-write；设计主角→结构化 PROTAGONIST 采纳；档案显示“主角”标签；再问主角→可校验回答 no-write。

## 7. 试行反馈

- 契约门已回答：主角是 Character 的叙事角色（narrative_role），结构化在 character 对象上。自由文本 `role` 保留为身份描述补充，narrative_role 是可校验的叙事功能事实。
- CP2 后续（未在本 CP）：字段级结构化角色档案（动机/弧光等）、关系对象、角色演化记忆、把某个**已有角色**指定/改判为主角的修订入口（当前仅设计期写入 narrative_role）。
