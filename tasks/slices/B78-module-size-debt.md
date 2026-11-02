# B78：模块规模债务治理与存量拆分

- 状态：**todo（2026-11-03 立项；治理机制已落地，存量拆分未开始）**
- 来源：作者 2026-11-03 指出「一个代码文件三千多行是不是太多了」，并要求优化编码规范；同时强调模型规模治理必须遵循「先追源头，再决定校验」原则（[04-error-handling](../coding-standards/04-error-handling.md)）。
- 机制真源：[03 — 模块边界 §3.2](../coding-standards/03-module-boundaries.md)（源头判据 + ratchet 门禁 + 例外）；运行基线 `quality/module-size-baseline.json`；门禁脚本 `scripts/check_module_size.mjs`。
- 本任务只承接**存量拆分**。机制与门禁已由同批交付落地，不在本任务内重复。

## 1. 问题与判断

- 项目规范曾写「单模块 300 行」，但从未机器强制：实测 371 个 `apps/*/lib` 文件中，9 个 >2000 行、17 个 >1000 行、55 个 >500 行；最大 `frontend/src/components/WorkspaceChat.tsx` 5760 行。
- 近 30 天增长：`agent_run_server.ex` +1453、`WorkspaceChat.tsx` +1002、`workspace_channel.ex` +855——不是「一次写大」，而是**每个任务都往既有大文件里加**。
- 判断：本质问题是**职责边界**（模块混合 actor 状态机 / 用例编排 / 持久化 / 渲染），行数只是信号。因此门禁不做美学判定，只保证趋势不恶化；存量拆分按「变更频率 × 规模」排期。

## 2. 已落地治理机制（同批交付，勿在本任务重复实现）

| 层 | 内容 |
|---|---|
| 规范 | `docs/coding-standards/03-module-boundaries.md` §3.2：源头判据、ratchet 规则、例外机制、拆分模式库 |
| 门禁 | `scripts/check_module_size.mjs`：R1 已登记文件只减不增；R2 新增超关注门槛文件必须拆分或登记豁免。`outlier_floor`（生产 500 / 测试 800）只是观察入口，不是行数红线 |
| 基线 | `quality/module-size-baseline.json`：83 个观察文件登记上限 + 2 个聚合型豁免 |
| 接入 | `scripts/ai_static_scan.sh` 的 `module-size` check；CI `static-scan` job 显式 step；[CI gates](../quality/gates/ci.md) |

## 3. 存量债务清单（按 规模 × 90 天 churn 排序）

生产观察文件 Top 14（`score = lines × (churn + 1)`，2026-11-03 采样）：

| 优先级 | 文件 | 行数 | 90 天改动 | 拆分方向（草案） |
|---|---|---:|---:|---|
| P1 | `frontend/src/components/WorkspaceChat.tsx` | 5760 | 31 | 容器 / hooks（socket、run 投影、候选动作）/ 消息与卡片渲染子组件 |
| P1 | `apps/novel_application/lib/novel_application/dialogue_planning_service.ex` | 3195 | 43 | 判断输入组装、上下文裁剪、prompt 诊断、动作分流分模块 |
| P1 | `apps/novel_application/lib/novel_application/agent_run_server.ex` | 3471 | 32 | 状态机 / 命令处理 / 结果提交 / 恢复 / 预算分模块 |
| P1 | `apps/novel_application/lib/novel_application/turn_execution_service.ex` | 3059 | 34 | 用例编排（step 排序/预算/错误传播）与领域组装分离 |
| P1 | `apps/novel_persistence/lib/novel_persistence/adoption_repository.ex` | 2950 | 31 | 按聚合根/查询域拆；事务边界留唯一入口 |
| P2 | `apps/novel_web/lib/novel_web/channels/workspace_channel.ex` | 3469 | 23 | 按动作域拆 handler（确认/修订/采纳/预算/使命/角色合并） |
| P2 | `apps/novel_application/lib/novel_application/adoption_workflow.ex` | 2707 | 25 | 采纳裁决 / 写库 / 回执投影分模块 |
| P2 | `apps/novel_application/lib/novel_application/pending_artifact_workflow.ex` | 2277 | 27 | 候选生命周期 / 修订范围 / 结果闭合分模块 |
| P2 | `apps/novel_application/lib/novel_application/agent_run_flows/prose_drafting_with_quality.ex` | 2190 | 24 | 按阶段拆 step 模块，共享 AuthoringSession |
| P3 | `apps/novel_application/lib/novel_application/judgment_protocol.ex` | 1450 | 33 | Base/scope/工具契约/诊断分模块（注意 IR 边界） |
| P3 | `apps/novel_application/lib/novel_application/agentic_plan_draft_planner.ex` | 1304 | 22 | draft/revise/校验分模块 |
| P3 | `frontend/src/components/StructurePanel.tsx` | 2001 | 9 | 树渲染 / 操作 / 选择状态拆分 |
| P3 | `apps/novel_application/lib/novel_application/exploration_service.ex` | 1245 | 13 | 探索面 / 预算 / 观察归一拆分 |
| P4 | `frontend/src/lib/socket.ts` | 968 | 16 | 连接/重连、事件编解码、回执关联拆分 |

- `frontend/src/lib/copy.ts`（1432 行、40 次改动）与 `provider/stub.ex`（1429 行）是**显式豁免**的聚合型文件：文案 SSOT 与契约样本被规范要求集中，不参与拆分排序。
- 排序数据可由 `node scripts/check_module_size.mjs --report` + `git log --since=90.days --format=%H -- <file>` 复算。

## 4. 开工七问（首批拆分前必须填写）

1. **Contract**：拆分不改变任何对外契约（HTTP/Channel/wire、Run/TurnResult、持久 schema、IR）；以现有测试作为行为冻结基线。
2. **Invariant**：现有测试全绿（行为不变）+ 拆分后文件行数进入观察门槛以下或显著下降 + 新增模块有唯一职责与 `@moduledoc` + 跨模块调用方向不引入新循环依赖。
3. **Boundary**：只改目标 app 内部结构；不顺手改协议、不迁移无关逻辑、不引入新依赖。
4. **Consumer**：现有生产调用点与测试；不允许为了拆分新增旁路入口或双轨实现。
5. **Proof**：拆分前后目标 app 全量测试、`mix compile --warnings-as-errors`、xref/arch、I1/I2/I3、`scripts/check_module_size.mjs --check`；对高 churn 文件补充「拆分后仍由同一真实入口消费」的集成证据。
6. **Acceptance Driver**：拆分属结构性重构，默认不改变用户可见行为；若涉及页面组件拆分，需用现有原生/浏览器场景证明渲染与交互不回归（不新增验收感知逻辑）。
7. **Exploration**：本任务不物化作品知识，不涉及 Base/观察供给，不新增 packet。

## 5. 拆分方法与验收标准

- 遵循 `docs/coding-standards/03-module-boundaries.md` §3.2.4 模式库；先写「职责清单」再动手（ub-mode：先 Make it Right 的结构，再搬代码）。
- 一次只拆一个文件，串行交付；每拆完一个跑该 app 全量测试并更新 baseline（`--write-baseline` 会自动降低 `max_lines`）。
- 禁止：把代码搬到 `_impl.ex` 继续单文件膨胀、按行数机械切分导致逻辑碎片化、同时改行为与结构。
- 完成定义：债务清单 P1/P2 文件全部降至观察门槛以下或被证明「本质聚合」并登记豁免；门禁长期绿；测试无放宽。

## 6. 排期建议

- 不与功能 slice 混做；每次选一个文件，独立 commit（`refactor:` 前缀）。
- 优先 P1 中「下一个功能任务即将再改」的文件：拆分收益是防止 B71 之后继续往同一文件加。
- 本轮 B71 期间的硬约束：`quality/module-size-baseline.json` 中任何文件不得净增长（由门禁强制）；确需增长时先在 B71 内拆分对冲，或把该文件排进 B78 先行处理。

## 7. 明确不做

- 不对 `copy.ts`/`stub.ex` 等豁免文件做「为了行数」的拆分。
- 不追求覆盖率/变异分数的文件级指标。
- 不为拆分新增生产校验、开关或验收 hook。
