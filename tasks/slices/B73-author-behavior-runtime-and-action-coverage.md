# B73：作者行为运行链与动作覆盖补强

- 状态：**in_progress（2026-10-31 开工）**。
- 类型：B70 后续 P0/P1 验证实现；只扩外部真实页面 driver、冻结验证资产、隔离 seed/test-support 与判卷，不重开 B70 基础设施范围。
- 设计真源：[作者行为语料生成与状态探索验证设计](../../docs/design/acceptance/author-behavior-corpus-and-state-exploration.md) §8–§17；上游执行事实：[B70](B70-author-behavior-corpus-and-state-exploration.md) §6.3–§8。
- 开工 HEAD：`338abd216ae6a8d9614995844c7e74fc3a957ab9`。所有新 verdict/覆盖报告必须绑定实际运行 HEAD，不继承旧 PASS。
- 数据与模型边界：只用合成作品和 `ARTIFACT_DIR/database` 隔离 DB；真实作品/stage 数据不改，真实模型未授权、不加载/调用。确定性 provider 只证明机制，不代签模型语义或文学质量。

## 1. 范围与完成标准

### P0：旧语料与运行硬事实闭环

1. 在真实 `WorkspaceChat` 页面跑完旧 17 cases，补齐 C-F1-003、C-F1-G01、C-F3-G01、C-F2-001、C-F2-003、C-F3-002；不得以局部 oracle 测试替代页面证据。
2. F2 正文 execute 与 F3 明确保存 execute 经完整主链生成 TENTATIVE 候选；采纳前权威 canon/原文 hash 不变，候选目标 ref 与真实章/作品绑定。
3. 10 个 negative traps 分别保存“状态实际构造、刺激实际到达、oracle 实际判定”的证据；declared/executed/evaluated 分开。合法路径反误杀与违规检测分别记录，不能复制 trap id 冒充覆盖。
4. HO3 用真实重复动作/重试验证候选、登记、receipt 或 canon 不产生重复副作用。
5. 在当前 HEAD 按影响面复验固定回放与探索场景；失败批次只读保留，不覆盖旧证据、不反复重跑换分。

### P1：会改变正确行为的状态与动作

- 状态：同名章、多候选、stale、跨作品/失效对象、读取失败/unknown、多轮补充/纠正/反悔。每类必须说明改变的是哪条正确行为，并留下真实页面轨迹与外部事实。
- 动作：采纳、拒绝、编辑后采纳、重复确认/取消、断线/重开恢复；纳入 seeded 探索的行动模型、逐步 G1–G6 和覆盖汇总，不只写一次性 helper。
- 完整 native 矩阵、真实模型语义、I10 文学质量不在本任务代签；若未完成必须留在开放缺口。

## 2. 开工七问

1. **Contract**：消费既有 `author-behavior-{targets,states,cases,oracles,fixtures}/v1`、`author-behavior-coverage-report/v1`、TurnResult/adoption receipt 与 B41 `quality-verdict/v2`。只做 additive 观察/覆盖字段；不改变生产决策、卡片或采纳契约。
2. **Invariant**：G1–G6；execute 只产 TENTATIVE，未发生真实 UI 作者动作不得写 canon；目标 ref/原文 hash/作品隔离可核；重复动作幂等；unknown 与证据缺失不 PASS。
3. **Boundary**：只改本任务需要的 `quality/acceptance/author-behavior/**`、场景 manifest、`scripts/**`、外部 `frontend/slice-verify/**`、test-support provider/seed 和本文。生产 `apps/*/lib` 与 `frontend/src` 不改；B72、B39/AU15 在途文件与他人 WIP 不动。
4. **Consumer**：首个消费者是开发者通过 `scripts/quality_accept.sh` 驱动的真实浏览器工作台；后续消费者是 nightly/PR 覆盖审核与失败回归。
5. **Proof**：node/ExUnit 只证明 fixture 和判卷局部逻辑；完成证据必须来自外部 Playwright 的真实发送/点击/编辑/重开，结合 WS、截图、app log、隔离 DB 前后快照和 receipt。trap 检测变异测试与真实页面合法路径分开举证。
6. **Acceptance Driver**：复用 `author-behavior-corpus.mjs` 与 `slice_verify.sh` / `quality_accept.sh`，按 manifest 运行；产品新增验收感知逻辑：**no**，无新增生产 env、slice 识别、DOM hook、自动操作或 provider。
7. **Exploration**：本 slice 不新增作品知识供给或专用 prompt packet。execute/只读查询沿用真实探索与 AgentRun 主链；外部观察只读真实 TurnResult、请求/日志和 DB，不声称实模语义或观察使用已证明。

## 3. Checkpoint

| CP | 范围 | 状态与证据 |
|---|---|---|
| CP0 | 盘点旧报告与产品动作语义；修通标准 PyYAML 环境；建立真实观察/trap 数据形状的失败测试 | **in_progress**：系统 `python3` 缺 PyYAML，使用 `artifacts/b73-tooling/venv` 隔离安装项目指定 6.0.3，不改全局环境；其余待实现。 |
| CP1 | P0：17/17 页面回放、F2/F3 execute、TENTATIVE/canon/hash/ref、10 traps、HO3、当前 HEAD verdict | 未闭环。 |
| CP2 | P1：新增有行为差异的状态与完整作者动作/多轮/恢复，接入 seeded 探索 | 未闭环。 |
| CP3 | 影响面复验、标准门禁、I1/I2/I3、静态扫描闭环与最终边界 | 未闭环。 |

## 4. 执行日志与证据

- 2026-10-31：`git status` 确认 B72/AU15/B70 文档与 native 入口存在他人 WIP；本任务不修改这些文件。
- 2026-10-31：旧扩展报告确认 11/17、10 traps evaluated=0、HO3 未执行；现有 driver 固定写 `author_action=false`、`object_mismatch=false`、`duplicate_side_effect=false`，不足以证明新增动作，需改为外部事实派生。
- 真实页面、局部测试、门禁和未完成项将在对应 CP 完成后追加；本文是本任务唯一执行状态源。
