# B87 · 单次 AI 编码会话执行约束（R00–R08、R17–R19 共享）

> 本文件仅包含执行协议，**没有任务执行状态**；唯一状态源是 [B87 总计划](../B87-model-interaction-request-projection.md)，唯一设计增量契约是 [VS-00M](../../../docs/design/contracts/VS-00M-model-interaction-request-response-contract-pack.md)。任务卡 `Rxx.md` 是本次会话的目标/边界清单，不另建状态账本。作者 2026-11-24 将原 R09–R16 转交 [B89](../B89-author-controlled-execution.md) 的 A01–A08；B87 保留 R00–R08、R17–R19，编号不压缩，B89 的实现和验收不作为 B87 完成前置。

## 1. 会话启动协议

**判断顺序**（作者 2026-11-13 纠正）：愿景 → 元原则 → 设计 → 任务规划 → 实现，测试验证目标。先明确作者效果/不变量与独立验收依据，再核对当前代码；不能因为现役模块、Frozen 文档或测试存在就认定其设计正确。存在性查重与目标一致性审查是两件事，均不可省略。

每批启动全新 Codex / Claude Code / OpenCode 会话，交给模型**本 README + 当前 Rxx.md**；模型自行从仓库读取原任务、真实代码与冻结契约。不得一次输入全部保留任务卡，或在完成一批后直接滚动进入下一批；不在 B87 会话继续执行已转交 B89 的批次。

执行前必须：
1. `git status --short`、`git rev-parse HEAD`、`git branch --show-current`，确认活跃分支最新 HEAD、无他人未提交改动；发现并行 WIP，保护原文件并说明冲突，禁止强推。
2. 读取 `AGENTS.md`、`tasks/README.md`、`tasks/NEXT.md`、B87 总计划、当前任务卡及依赖任务。不可从历史日志直接假定 B71/B81 现状。
3. **针对本批明确回答七问**：Contract、Invariant、Boundary、Consumer、Proof、Acceptance Driver、Exploration（不涉及作品事实的必须写明不适用原因）。
4. **存在性审计红线**：每个可能新建的类/模块/表/列/Schema/Tool/API/事件/配置，查实仓库中现存等价实体和真实调用者，给出 `reuse / refactor-and-retire / truly-new / reject`，并写出“现存不能胜任”的证据。无新对象也要写 `none`。
5. 记录可触及文件/禁止触及文件、原始失败基线、成功与否判据和恢复点；跨 Frozen 契约冲突时**先修订/裁决设计，不能先写代码再补批准**。
6. 实施前通过 `bash scripts/task_done.sh --begin artifacts/slice-verify/<本批唯一目录>/scope.json --task tasks/slices/B87-model-interaction-request-projection/Rxx.md` 机器封存开始范围；实际替换本批目录与任务卡。该记录不授权、不验收，只固定任务增量与既有 WIP。历史任务缺记录不得事后追造，按 quality-gates §2.3.1 保留缺证与版本核账。

## 2. 实施原则

**彻底重构，但不做无谓重造**：允许重写错误责任位置、替换旧字段、删除不再消费的代码与测试、直接更新当前数据库 Schema/迁移（项目未发布，**无需兼容旧产品 API/数据协议**）；**必须同批迁所有现役消费者并删旧入口**，绝不双写、dual parse、legacy fallback 或“以后移除”。不可因此默认销毁用户已创作作品和历史可审计证据。

严格应用 SRP/OCP/LSP/ISP/DIP/LoD/CRP、DRY/KISS/YAGNI/SoC 和适度工程：
- 新抽象要有真实消费者，领域与 Provider/数据库保持单向依赖；Elixir 用纯函数、模块组合与 behaviour 而非虚构继承体系；
- 工具 effect、授权状态、版本和作者可见来源各有唯一真源；任何风险/安全规则只有一次权威派生；
- 最小供给、模型按需求证、真实观察闭环；不要补固定材料包诱导 Router-first；不能因 Token 成本删必要正文；
- 作品隔离/权限/版本先于风险/同意，模型建议不得替代执行和采纳；
- 现有作者授权、确认与采纳仍需对象绑定、版本检查、预算、事务原子及审计，不能以确认放行越权；新增模式、长期委托与 `full` 自动采纳由 B89 承担，其转出不解除本批既有执行和采纳边界。

## 3. 单批次必须形成完整可观察闭环

`PASS` 当且仅当：
- 本批 **唯一目标效果** 在真实消费者可观察，负例/边界/回滚/取消/恢复按本卡全通过；B89 新功能及其专项清理/整体验收由 B89 独立完成，不借本批旧证据签收；
- 新增对象存在性审计表齐全、旧重复入口已删除且无残留消费；
- 代码/测试/文档与实际契约同源，任何预期跨 app/budget/权限性质的改变经合法冻结；
- 对应的单元、集成、三 wire 与**真实 Tauri 页面外部驱动**（若用户行为变化）均有可重放证据；
- 需要真实模型行为判定的批次提供真实 Provider 原生证据；Stub/模拟只能证明机制；
- 当前改动全量适用的强制门禁通过，已知前置 CI 红灯已归因且不能作为本批新回归的理由；最终 R19 必须达到 B87 保留范围的全链 clean；
- 形成一个可回溯提交 SHA，并**只在 B87 总计划**更新本批状态、验证与后继恢复入口。

任一必选缺失为 `FAIL` 或 `BLOCKED`；不允许“有条件完成”“过半完成”，也不能通过改测试/换样本/降低质量/隐式降级骗 PASS。不能满足一个独立会话的闭环时，应在编码前调整任务批次边界，而不是把验收债务甩给下一批。

## 4. 通用验证入口（以当前仓库可执行命令与 AGENTS.md 为准）

```bash
source scripts/lib/test_env.sh
novel_test_db_prepare --quiet
mix compile --warnings-as-errors
mix test
mix check
mix xref graph --format cycles --label compile-connected --fail-above 0
mix run scripts/arch_check.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_n_narr.exs
MIX_ENV=test mix run scripts/scenario_invariants/run_icache_prefix.exs
node scripts/next_task_check.mjs
git diff --check
bash scripts/task_done.sh --scope "$TASK_SCOPE"
```

`test_env` 在未指定 `NOVEL_TEST_DB_DIR` 时创建并迁移一次性测试库，不重置作者数据库；直接裸跑 `mix run` 可能落入缺表的新测试库，R00 已保留该失败反例。`TASK_SCOPE` 必须指向实施前已封存的本批 scope.json。所有本批文档/代码修改完成后运行 `task_done.sh --scope "$TASK_SCOPE"`：它绑定实际执行前后源码与真实检查结果，完整扫描成功后才封存工程结果；有 UI 改动时另传实际 `--slice`，复用已有证据还须提供执行时形成的 `--ui-binding`。不能手造 manifest、以 quick/skip 代替完整检查，或把无 scope 的全树扫描称为任务完成。工程证据身份成立不自动代签本卡场景覆盖或 PASS。工具因沙箱日志路径或网络失败时，保留失败并只纠正运行前置，不安装/升级、不改扫描规则、不把未扫描记为通过。

有前端/UI 改动追加 `cd frontend && pnpm typecheck && pnpm lint && pnpm test` 及适用 Tauri/AX 场景。涉及 Provider/会话/权限/采纳的后端行为变化，必须从真实工作台路径补证明；产品代码不得植入验收专用逻辑。测试失败/外部环境缺失要记录完整命令、退出码与现象，不能不跑却写“通过”。

## 5. 统一交付报告（每个会话只回复这一批的事实）

```text
Batch: Rxx
Base: branch + full SHA; WIP 状态
Outcome: PASS | FAIL | BLOCKED
本批用户可观察效果: 场景与实际证据（不能只有“已实现”）
Existence audit: 每个新/改/退对象 → existing owner → decision → first consumer
Design/Frozen check: 依据、裁决、实际更新文件
Changes: 真正修改/删除的文件及不变量
Negative matrix: 对象/版本/越权/取消/并发/撤销/失败回滚/混淆等真实结果
Acceptance: 外部真实工作台/模型批次、请求引用/原始响应与输出对账
Commands: 所有必需命令、退出码、PASS/FAIL 和证据路径
Clean: 无兼容双轨、无零消费者、无未关闭的新缺陷
Commit: SHA（没有提交不得宣称完成代码批次）
SSOT: B87 对应批次的状态/证据已回填；NEXT 仅调度时更新
Handoff: 下批要读取的最小事实/待裁决项，未闭环后果不得被掩盖
```
