# AU11 Missing WorkState Policy / 缺当前作品上下文不编造

- 状态：done
- 类型：AI-Guided Authoring Slice + Trace Contract Slice
- 启动日期：2026-06-21
- 所属验收：`docs/design/acceptance/author/AU-11-ai-guided-authoring.md` SC-AU11-02。
- 所属设计：`docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md`。

## 1. 用户 / 系统目标

作者要求“帮我看看这一章哪里不成立”但当前 work 没有目标章摘要、正文 excerpt 或可引用人物状态时，系统必须把 WorkState 缺失结构化记录到 `AIMessageEnvelope` / trace，并在 TurnResult 中诚实说明缺哪些材料。AI 不得声称已经读过当前章，也不得编造作品事实。

本 checkpoint 只覆盖 SC-AU11-02 的真实工作台 proof；不声明 AU11 完成，不实现 prose_writing envelope 投影。

## 2. 开工检查

- **Contract**：继续消费 `VS-00D` 的 `WorkStateMessage` / `MissingPolicy` / `TraceRequirements`；复用或演进 `NovelApplication.AIMessageEnvelope`。
- **Invariant**：
  - WorkState 缺失必须结构化进入 trace，而不是只写在 assistant 文案里。
  - 缺上下文时不得出现当前作品、当前章、人物状态的编造事实。
  - 无上下文质量诊断仍不得触发 tool/adoption/production write。
  - 产品代码不得新增验收 hook。
- **Boundary**：
  - `novel_application`：Planner / AIMessageEnvelope / TraceWriter。
  - `frontend`：why 面板展示缺失摘要。
  - 不改 persistence schema；不引入生产验收开关。
- **Consumer**：真实工作台普通输入、TurnResult trace summary、why 面板。
- **Proof**：
  - 后端：缺 work snapshot / 缺 chapter summary / 缺 prose excerpt contract 测试。
- 外部 Tauri：创建只有标题、没有章节/正文/人物状态的真实 work；从真实工作台输入“帮我看看这一章哪里不成立”；验证 trace/why 显示 WorkState missing，assistant 要求补充目标章或摘要，no write。
- **Acceptance Driver**：新增真实 Tauri driver；不新增产品验收感知逻辑。

## 3. 当前缺口

- 2026-06-21 已补 `au11-missing-workstate-policy` 真实 Tauri / quality acceptance。
- 真实工作台证据证明：selected real work 有 snapshot 但无章节材料；WorkStateLayer 标记 chapter summary / prose excerpt / character state missing；TurnGuidance 记录缺目标章/正文问题；assistant 要求补材料且不声称已读该章；why 显示 quality mode、missing WorkState 和 missing prose limit；无 tool/adoption/write。
- 实现侧顺带补齐：`AIMessageEnvelope` 识别“哪里不成立”质量诊断原句；缺 `character_state` / `style_intent` 时输出 author-safe missing map；why 面板可同时显示安全来源和缺失提示。

## 4. 验证计划

- [x] 后端 missing WorkState contract 测试
- [x] 前端 why 缺失摘要测试
- [x] `bash scripts/tauri_slice_verify.sh au11-missing-workstate-policy`
- [x] `bash scripts/quality_accept.sh au11-missing-workstate-policy --surface tauri`
- [x] `bash scripts/ai_static_scan.sh --top 10`（经 `task_done` 执行；Top 10 仅历史 `gitleaks` accepted_risk，0 touched files，blocking=0）

## 5. 证据

- `artifacts/slice-verify/au11-missing-workstate-policy-tauri/summary.json`
- `quality/acceptance/scenarios/au11-missing-workstate-policy.yml`
- `bash scripts/quality_accept.sh au11-missing-workstate-policy --surface tauri`

## 6. 决策日志

- 2026-06-21 — SC-AU11-02 真实工作台 proof 闭环。没有向产品代码加入 slice id/env/query/localStorage/DOM hook；新增逻辑均是用户可见的质量诊断语义和 author-safe trace missing 表达。
