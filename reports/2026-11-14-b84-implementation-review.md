# B84 实现独立审查报告（2026-11-14）

> 本文件保存本次审查的版本、发现、证据摘要与复验要求，是固定时间点的审查记录。
> B84 的执行状态、整改 checkpoint 与后续签收只维护在[原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)；本报告不建立第二份活动状态台账。
> **最新入口：**请先读 [§16 REV-05 与 REV-04 整改独立复核](#16-rev-05-与-rev-04-整改独立复核)：REV-04 精确回归与旧逻辑对照已独立通过，可关闭；REV-05 正常套件16/16，但首次ready断言前blocker未登记兜底，继续开放。[§15 REV-01 第三轮整改](#15-rev-01-复核缺口整改结果2026-11-14)保留并行实施者的PGID/借用/onSpawn修复与74/74记录，待另行独立复核；[§14](#14-rev-05-与-rev-04-整改结果2026-11-14)和[§13](#13-rev-01-第二轮整改独立复核)保留历史。§1–15 不冒充本轮运行验收。

## 1. 结论与验收边界

**审查建议：修复本报告确认的 1 个 P1、5 个 P2 后，再复核 B84 签收。** 严重级别是本次独立审查的优先级判断，不是测试工具自动生成的等级。

作者在本次会话中明确：“A5 验证过 mac 了，win/Linux 不需要验”。因此本轮以 **macOS** 为验收边界，Windows/Linux 不计入发现、扣分或阻塞。该范围裁决适用于本次 B84 验收，不扩写为整个产品的跨平台承诺变更。

B84 原任务末尾已有 A5 本机验收记录。该记录与本轮新增反例分别保留：已有通过结果证明其覆盖的场景；本轮反例暴露的是尚未覆盖的异常恢复、失败传播、并发时序与页面判据缺口。不能因为顶部旧摘要仍写“A5 未开始”而推断 A5 从未验证，也不能用既有通过数量覆盖新增反例。

本轮仅审查与生成报告，未实施六项代码修复、未新增正式回归用例、未启动真实模型或页面。复现只使用本次拥有的合成目录、文件和进程；审查创建的临时资源已回收，没有执行全局 reap 或清理历史作者资料。

## 2. 审查对象、依据与证据口径

### 2.1 版本基线

| 项目 | 本次观察 |
|---|---|
| 项目 | ai-novel-studio |
| 分支 | `develop/dialogue-based-novel-workbench` |
| 审查 HEAD | `208033fc0175955c7966c1270ddbb78c9da4b4a6` |
| B84 差量参考起点 | `e0976d98218e83a8c1c2a88bdbc58cf0cba28494` |
| 工作区 | 包含审查时既有未提交变更；不能将本报告写成 clean HEAD 验收 |
| 特别归属 | `reapOrphanScopes` 及其新增测试为未提交工作区实现；fixture 发布竞争所在逻辑已提交 |
| 本轮有效套件 | 当前工作区的 scope self-tests，62/62 通过；包含未提交 reap 测试 |
| 日期口径 | 2026-11-14，Asia/Shanghai；不推定未记录的具体执行时刻 |

本报告源码定位使用审查时工作区行号与函数名。源码调整后应以函数/调用链和文末指纹核对，不按旧行号机械修改。尤其 `test_env.mjs` 的 WIP reap 在前部增加了 41 行，后续行号与 HEAD 不同。

### 2.2 判断依据

- [AGENTS.md](../AGENTS.md)：愿景、原则、设计、任务、实现的判断顺序；验收不得缩小覆盖；实体复用和文档 SSOT。
- [项目画像](../docs/engineering/project-operating-profile.yaml)：研发期、保留作者内容、按实际风险匹配工程复杂度。
- [质量门禁 §2.5](../docs/engineering/quality-gates.md)：作用域所有权、一次初始化、退出失败传播、宿主失联恢复及原场景覆盖。
- [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)：A1–A5 范围、已有实施记录和验收。
- [任务状态规则](../tasks/README.md)：执行状态只在原任务维护，索引只导航，历史证据不改写。

### 2.3 证据等级

| 证据 | 可以支持的结论 | 本报告的限制 |
|---|---|---|
| 当前源码与差量 | 定位责任、调用链及条件分支 | 不独自证明自然运行中已发生事故 |
| 真实进程/文件的受控反例 | 指定故障或时序下，真实实现产生了观察结果 | 不外推自然发生频率，不声称损坏过真实作者数据 |
| 提取真实判定函数执行 | 当前验收谓词会接受给定反例 | 不冒充完整浏览器/Tauri 验收 |
| 本轮 self-test 执行 | 所选 62 项在记录环境下通过 | 不代签完整 Mix/Cargo 或六项新反例 |
| 原任务中的全量/页面记录 | 历史批次及其声明的覆盖 | 本轮没有重跑，不计作本轮新增执行 |

受控探针的执行概要、关键输出及可用运行标识如下。原始调用/输出来自本次 WebCodex 审查会话；本次落库保存其摘要，不声称仓库已经有六套正式可复跑探针脚本。后续修复应将对应反例沉淀到既有测试/验收集合。

## 3. 发现总览

| 编号 | 级别 | 范围 | 发现 | 本轮证据 |
|---|---|---|---|---|
| B84-REV-01 | P1 | A5；未提交 reap | 父 owner 失联后，仍归档活跃子进程使用的目录 | 真实 CLI/进程，受控 SIGKILL 与目录年龄 |
| B84-REV-02 | P2 | A4；已提交 driver | 仅凭外层容器存在，误判叙事恢复成功 | 当前真实谓词 + 零叙事合成 document |
| B84-REV-03 | P2 | A4；新增调用方依赖旧 helper | cleanup 失败分支接不到进程回收失败 | 真实 helper/子进程 + 信号失败注入 |
| B84-REV-04 | P2 | A1/A2；已提交 owner | 成功发布与 owner 退出竞争导致假失败 | 真实双进程 + 受控调度 |
| B84-REV-05 | P2 | A3；已提交 helper | 任务枚举越过 deadline 后仍返回成功 | 真实 Task.Supervisor + 受控 shutdown |
| B84-REV-06 | P2 | A3；已提交配置 | 裸 Mix 自有 DB 删除失败静默通过 | 真实配置退出钩子 + 专属目录权限故障 |

这些编号仅用于本次报告和原任务之间引用，不构成新的质量框架或全仓问题注册表。

## 4. 详细发现

### B84-REV-01 — P1：reap 没有先结束失联 owner 的活动子进程

**定位：** [scripts/lib/test_env.mjs](../scripts/lib/test_env.mjs)，207–225 行，`reapOrphanScopes`。

**代码事实：** 检查 marker 中父 owner PID 已不在、目录足够旧后，直接 `renameSync` 整个 scope。真实 `run` 的 payload 可以在 owner 被 SIGKILL 后继续存活；恢复路径没有核实这些活动资源已经结束。

**复现步骤：**

1. 在本次外层 owned run 中创建专属 base，通过真实 CLI 启动内层 owned run。
2. payload 每 30ms 向自己的 TMPDIR 写一个小文件。
3. SIGKILL 内层 owner，保留 payload；仅把该合成 scope 的 mtime 调到两分钟前。
4. 对专属 base 执行 `reapOrphanScopes({baseDir, olderThanMs: 60000})`。
5. 观察归档结果、子进程存活及原路径是否再次出现。

**实际结果：**

```json
{
  "childAliveAfterReap": true,
  "reapedCount": 1,
  "originalScopeRecreated": true,
  "originalMarkerExists": false,
  "newActiveSentinelExists": true,
  "archiveHasOriginalSentinel": true
}
```

`test_env` run ID：`f5470b6db5c52f83`。这不是 WebCodex Job ID。结束时按捕获 PID 释放本次 payload，外层 `exit=0/tree_finalized=true`，专属 scratch 回收。

**影响：** “归档成功”不等于活动资源停止。孤儿进程能持续产出无 marker 的新目录，后续 reap 无法正常管理，A5 的宿主失联恢复仍不完整。本轮没有证明真实作者 DB 已损坏；风险来自活动进程继续使用被移动目录的事实。

**修复建议：** 复用现有 owner/进程组归属机制，登记可核验的子进程身份；恢复时先证明这些资源已结束，再移动 scope。无法确认归属或退出时保留现场并报告。

**复验要求：** 覆盖 owner 死而 payload 活、双方均死、活 owner、未过期、身份不明等情况；归档后无本次活子进程、原路径不再生成，必要原始内容保留，借用资源不变。不能只以归档数或根目录前缀清零作为通过条件。

### B84-REV-02 — P2：外层区域存在被误认为叙事恢复

**定位：** [external-ui-driver.mjs](../frontend/slice-verify/external-ui-driver.mjs)，30583–30591、30630–30633 行；对应 B84 landmark 修复提交 `073d0f37`。

**代码事实：** 刷新后只等待页面含“创作执行”“已完成”，并存在 `[aria-label="本轮创作过程"]`，随后把容器存在写成 `restored_ui_reasoning_restored`。

[WorkspaceChat.tsx](../frontend/src/components/WorkspaceChat.tsx) 912–941 行表明：零叙事时，活动文字、终态、时长等仍能使外层容器存在；真正叙事段落由另外的条件渲染。上方 activity API 断言证明后端事实存在，不能证明前端已恢复可见叙事。

**验证方法：** 用 Node 24.19 从当前 driver 原文提取 `waitForFunction` 判定函数，在仅有状态容器、零叙事段落的合成 document 上执行，没有重写判定逻辑。

```text
current_restore_predicate_passed = true
narrative_paragraph_count = 0
visible_text = 创作执行 / 已完成
```

**影响：** “后端持久化存在，但前端没有恢复叙事”的回归仍能被页面判据接受。本轮确认的是验收假阳性，不是当前产品已经丢失叙事内容。

**修复建议：** 沿用真实可访问区域，核对本次 run 应恢复的叙事内容及可见性，预期来自场景输入或已确认的对应事件；不得只检查外层容器，也不增加产品验收钩子。

**复验要求：** 状态可见但叙事为空必须失败；其他 run 的叙事不能替代本 run；正确持久化内容恢复必须通过。修复 driver 后用既有页面入口验证受影响恢复场景。

**关联静态风险，不重复计数：** 同文件 1195–1197 行把流式采样扩大到整个区域的 innerText；29289–29301 行用前缀和长度增长判断多 delta，可被状态/时长增长混淆。该点仅静态核对，后续应覆盖“一次性出现完整叙事，随后只有状态文字增长”的负例。

### B84-REV-03 — P2：cleanup 失败判断依赖始终成功的 helper

**定位：** [slice_verify.sh](../scripts/slice_verify.sh) 76–79 行、[tauri_slice_verify.sh](../scripts/tauri_slice_verify.sh) 765–775 行；底层 [process_tree.sh](../scripts/lib/process_tree.sh) 76–107 行。调用方变更来自 `6c55c05d`。

**代码事实：** B84 通过 `kill_process_tree "$PID" || cleanup_failed=1` 传播退出失败。但 helper 的实际 kill 错误被 `|| true` 忽略，最后一次 SIGKILL 后没有确认资源退出，直接返回 0。

**验证方法：** 加载真实 helper，创建本次专有 sleep 子进程，仅在该 shell 内注入非零检查以外的信号发送失败；调用 `kill_process_tree "$owned_pid" 0`。观察后通过 builtin kill 精确释放该子进程并 wait。

```json
{
  "helper_exit": 0,
  "owned_child_still_alive": true,
  "signal_failure_injected": true
}
```

**影响：** 新增 cleanup_failed 分支接不到这一类错误，可能残留进程，或继续卡在后续无期限 wait。底层吞错是旧问题；B84 新增的失败传播未打通其依赖的返回契约。本轮没有声称实际宿主出现了 EPERM。

**修复建议：** 共享 helper 区分进程已不存在、信号拒绝和超期仍存活；结束检查须有界，并返回可信状态。调用者保留原始失败和附加退出失败。

**复验要求：** 正常退出和重复清理通过；信号拒绝/仍存活不能返回成功；超时不能无限等待；主任务已失败时同时保留原始失败及清理诊断，且不影响未登记进程。

### B84-REV-04 — P2：成功发布后 owner 退出被误报为初始化失败

**定位：** [test_env.mjs](../scripts/lib/test_env.mjs) 1163–1171 行，`awaitFixtureOwner`；属于已提交的 A1/A2 逻辑。WIP 新增 reap 使这一段相对 HEAD 顺延 41 行。

**代码事实：** 等待方先查“尚未发布”，再读 claim 并检查 owner 存活。owner 可在两次观察之间完成原子 rename 并正常退出；等待方未再检查最终事实就报错。

**复现步骤：** 两个真实 Node 进程共享 owned run 和同一规格；在 waiter 首次未发布观察后、继续存活判断前施加受控调度，让 owner 完成构造、发布并 exit 0，再恢复 waiter。未改被审源码、模板内容或 owner 退出码。

```text
owner exit = 0
waiter materializeFixture accepted = false
error = 初始化 owner 已退出且未发布完整模板/failed
随后父进程同规格复用 = 成功
publishedBytes = valid fixture
```

`test_env` run ID：`b5a7404cf8c43b1c`。waiter 探针脚本捕获异常并输出结果，所以脚本自身 exit 0 不代表被测调用成功。外层结束 `exit=0/tree_finalized=true`，scratch 已回收。

**影响：** 合法并发成功路径出现偶发假失败，影响短命 worker 和反复启动的子进程。本轮固定了合法竞争时序，没有统计自然发生频率。

**修复建议：** 判断 owner 已退出时，再核对 published/failed 最终事实，然后决定是否为基础设施失败；沿用已有原子发布机制。

**复验要求：** “首次未发布观察→发布→owner 正常退出→waiter 继续”必须成功复用；真正发布前死亡仍须失败；同规格仍只有一次成功构造，不允许 waiter 自行重建。

### B84-REV-05 — P2：任务枚举遗漏 deadline，迟到空集合被当作成功

**定位：** [agent_run_cleanup_helper.exs](../apps/novel_application/test/support/agent_run_cleanup_helper.exs) 335–340 行、236–245 行、96–108 行。

**代码事实：** `owned_tasks/2` 同步调用 `DynamicSupervisor.which_children/1`，没有纳入传入的 deadline。当共享 Supervisor 正在等待其他 owner 的任务 shutdown，本 case 即使无任务也会阻塞；返回空集合后直接保留空 failures，没有重新核对期限。

**验证方法：** 独立 Elixir 进程加载真实 helper，建立真实 Task.Supervisor；让一个不属于被清理 caller 的任务 trap_exit，shutdown 为 250ms。由另一调用启动其 terminate_child，确认进入 shutdown 后执行 `release_task_caller(已死亡caller, 20)`。

```text
deadline_ms = 20
elapsed_ms = 307
result = :ok
```

短期限用于放大并证明调用边界。另一个任务由它原来的 terminate_child 超时结束，不是 cleanup helper 越权清理了它。

**影响：** 全局同步查询迫使本 case 等待其他 owner，可能重新引入慢收尾；越过期限后仍报告成功，违反既有所有权和 deadline 契约。

**修复建议：** 把 Supervisor 查询纳入同一剩余期限，在返回成功前复核时间事实；查询超时保留明确失败，不把迟到的空集合解释成按时收口。

**复验要求：** 其他 owner 正在 shutdown、本 caller 无任务时，清理不能无界阻塞或超期后返回成功；本 caller 的真实任务仍按现有顺序收口，其他 owner 的任务不被停止。

### B84-REV-06 — P2：裸 Mix 自有 DB 删除失败被静默忽略

**定位：** [config/test.exs](../config/test.exs) 36–39 行，`System.at_exit` 中的 `Enum.each(..., &File.rm/1)`。

**代码事实：** File.rm 的结果全部丢弃，文件已不存在与 EACCES 等真实删除失败没有区分。

**验证方法：** 在本次 owned scope 的专属子目录中，由真实 Elixir 加载 `Config.Reader.read!("config/test.exs")`，注册当前退出钩子；在它选定的自有 DB 路径创建占位文件，把仅该 case 的 TMPDIR 权限设为 0500，观察退出。此处验证真实文件删除与配置钩子，不是完整 Mix/SQLite 回归。

```text
exit_code = 0
stderr = 空
residue = ai_novel_studio_test-13194.sqlite3
```

外层 finally 恢复本次目录权限并回收文件，owned scope `tree_finalized=true`；没有触碰历史 DB。

**影响：** 测试成功退出时，自有 DB 可以仍然存在且没有诊断，重新形成静默泄漏。

**修复建议：** ENOENT 允许幂等成功；其他失败记录路径和原因，并反映到退出结果，保留原始测试失败。

**复验要求：** 正常归还、已不存在、真实删除失败和“业务断言失败+删除失败”均有证明；显式外部 NOVEL_TEST_DB_DIR 仍保持借用、不被删除。

**同类静态观察，不重复计数：** [frontend/src-tauri/src/lib.rs](../frontend/src-tauri/src/lib.rs) 931–934 行的 TempDir::drop 也通过 `let _ = remove_dir_all(...)` 忽略结果。本轮没有单独做 Rust 故障复现；后续处理应兼顾显式释放结果和 panic 展开时的诊断，避免双重 panic。

## 5. 有效验证与排除的执行问题

### 5.1 本轮有效 self-test

在审查工作区使用仓库已有 self-test 例外入口；没有安装新依赖：

```bash
/usr/bin/env \
  -u NOVEL_TEST_RUN_DIR \
  -u NOVEL_TEST_ENTRY_SCOPED \
  PATH=/Users/loong/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  bash scripts/node_test.sh --self \
  scripts/lib/test_env_scope.test.mjs
```

这是本机实际成功命令；Node/Python 路径属于执行环境，不是新增的仓库固定路径约定。

WebCodex Job：`wc_job_gklbdprEf9FdEZB9`。

```text
exit_code: 0
tests: 62
pass: 62
fail: 0
cancelled: 0
skipped: 0
duration_ms: 25383.575875
```

依据：[node_test.sh](../scripts/node_test.sh) 的 `--self` 分支，以及 [CI](../.github/workflows/ci.yml) 的 scope self-tests 例外。现有 62 项通过与新增反例成立可以同时成立。

### 5.2 两次无效执行的归因

| 执行 | 观察 | 归因与处置 |
|---|---|---|
| `wc_job_gnWmYqSWdI1Fm0sO` | 普通 run 外层包装 scope 自测，exit 124，约 123.356s | 审查入口使用错误，违反已有 self-test 例外；owned/borrowed 断言失配，不作为 B84 缺陷。该次 owned scratch 已回收 |
| `wc_job_QwscDgEvyGOF9mLJ` | 正确 --self，60/62，通过数外有 2 项失败 | Runner 最小 PATH 选择缺 PyYAML 的系统 Python；定向 manifest_io stdout 已确认 ManifestLoadError。加入现有 Homebrew Python 路径后得到最终 62/62，没有安装依赖 |

不得把这两次执行问题并入六项代码发现，也不得将整段执行历史概括为“每次运行均通过”。

### 5.3 历史证据与本轮未执行项

[B84 原任务的 A5 记录](../tasks/slices/B84-web-slow-tests-and-arch-debt.md) 包含 `mix check` 3203 tests/0、web 196/61.9s，以及独立两次 web 196/0（64s/63s）；A4 记录包含浏览器、Tauri 非原生和原生真实模型批次。

这些是已有实施验收记录，本轮没有重新运行完整 Mix/Cargo、模型、浏览器或 Tauri 批次。页面发现使用真实谓词反例，后端发现使用短机制探针，均不能描述成完整产品场景重跑。

## 6. 修复承接与再次签收要求

原任务承接六项修复状态；本节只保存本轮建议与验收条件，不随未来 checkpoint 复制状态。

| 顺序 | 建议处理范围 | 对应证明 |
|---|---|---|
| 1 | B84-REV-01：宿主失联后活动资源收口 | 归档前进程归属与退出，归档后原路径不再生，原始内容保留 |
| 2 | B84-REV-02/03：验收判断和退出失败可信性 | 零叙事必须失败；信号失败/超期必须传播；受影响页面场景正确通过 |
| 3 | B84-REV-04/05/06：并发、期限与文件清理 | 发布竞争、其他 owner shutdown、真实删除失败反例全部进入既有回归 |

修复应落回当前 owner/helper/driver，保留原有失败语义、覆盖和作者资源保护。按修改面运行对应测试及既有适用工程门；真实页面相关改动按原任务补页面证据。恢复既有 62 项通过是必要局部证据，不能单独替代六项反例的复核。Windows/Linux 不作为本次签收条件。

## 7. 审查指纹与文档维护

以下 SHA-256 在审查结束及报告写入前核对一致，用于定位含 WIP 的实际输入；它们不是修复后验证结果。

| 文件 | SHA-256 |
|---|---|
| `scripts/lib/test_env.mjs` | `94c339a5456f622da0cba545fa809b648d25d5e85b08cdb2e27bf618e4ff54bc` |
| `scripts/lib/test_env_scope.test.mjs` | `3632f9e2782cfdf1b9df2ec4f48120a381ea7851300e5dd9bcc8dcdccb8bb5d9` |
| `scripts/lib/process_tree.sh` | `94732e71e26a2198af73ecdf8f21a402bb9075a91b66642e352bece818bd5941` |
| `scripts/slice_verify.sh` | `eed37de39f2decaf71fc94329e8088c4d8976026a5022589b70d37813008a670` |
| `scripts/tauri_slice_verify.sh` | `d85d705e5d421151b1fc5194c0e7557882b7d227911c911f96899c304fc7427c` |
| `config/test.exs` | `9efb2bc9cbb10b406805d35cb37f0ff8e2cabc743d70749f7ef744c27a47d485` |
| `apps/novel_application/test/support/agent_run_cleanup_helper.exs` | `fdff706404b74d7aae36411a0388eff418bf418f44954d54f38a1dc0c2ad0242` |
| `frontend/slice-verify/external-ui-driver.mjs` | `4a62babd47a1dc0c753628514da1145b6b8e78cef068677f9921692c672a7d04` |

本报告通过 [reports 索引](README.md) 与 [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md) 双向可达。原任务顶部旧摘要的“A5 未开始”在落库时按已有记录纠正；历史 A5 段保留，本轮发现和 macOS-only 裁决追加到原任务。文档生成不代表代码已经修复，也不改变其他开发线 WIP。

## 8. 处理结果（2026-11-14，整改实施后）

> **后续独立复核提示：**本节保留整改实施者当时的记录；其“已修复”判断及 §8.2 根因已由 [§9](#9-整改后独立复核与交接) 重新核对。请勿直接将本节历史判断作为当前签收或派工依据。

> 本节由整改实施者追加，记录对本次审查发现的处理事实与证据；上方审查结论、证据与固定时间点记录保持不变。执行状态仍只维护在[原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)。

### 8.1 逐项状态

| 编号 | 处理结果 | 代码提交 | 本轮回放证据 |
|---|---|---|---|
| B84-REV-01（P1） | **已修复**：`reapOrphanScopes` 移动前检查打开句柄、全树最新写入、进程命令行引用；任一命中或无法确认归属即保留现场并给 reason | `1e732920` | 受控反例（payload 每30ms写、owner SIGKILL、root mtime 调老）：`reaped=0`、`kept=recent_write`、原 scope/marker 保留；活动结束后才归档。回归 2/2 |
| B84-REV-02（P2） | **判据已修复，页面复验未闭环**：恢复区域要求可见非空 `.agenticLoopReasoning p`；普通对话启动改用真实帧证明，不再依赖“创作执行”中间态 | `99b0fa35`、`6e066e48` | 从 driver 原文提取谓词：零叙事 `false`、有叙事 `true`、隐藏叙事 `false`；真实场景两次启动早超时，第三次后段失败于 `AgentRun activity API` 无 ProviderRun usage |
| B84-REV-03（P2） | **已修复**：区分 ESRCH 与信号失败、SIGKILL 后有界确认、僵尸(stat=Z)不计存活、进程组用 `ps pgid/stat` 复核 | `51fc8bfc` | 4/4 真实 bash 回归：正常、信号拒绝且仍存活、不存在/空 PID、子孙树 |
| B84-REV-04（P2） | **已修复**：owner 退出后再核对 published/failed 最终事实 | `1e732920` | scope 全套通过（含 fixture 并发/复用）；**未新增报告所述的精确调度反例** |
| B84-REV-05（P2） | **已修复**：Supervisor 查询移入受监控短进程并按剩余 deadline 等待；超期仍给短查询机会以 `force_kill` 已知任务 | `760c81fe` | `agent_run_cleanup_test` **12/12**，含其他 owner shutdown、迟到空集合不签成功 |
| B84-REV-06（P2） | **已修复**：ENOENT 幂等；其他删除失败写 stderr，测试成功时退出 1、测试已失败时保留原码 | `f84514ce` | 受控三态：正常 0 / 缺失 0 / 拒绝 1 + 诊断 + 文件保留 |
| Rust `TempDir::drop` 静态观察 | **未修**（报告未计数） | — | 登记为后续；未做 Rust 故障复现 |

### 8.2 REV-02 页面复验阻塞根因

真实场景 `agent-provider-execution-activity-restored` 第三次已通过启动与 provider 调用（app-log 有 `provider_gateway.complete`，`provider=slice_verify`、`purpose=planner`、`outcome=ok`），但场景数据库 `provider_runs` 为 **0 行**。

根因：`ProviderActivityProjector.with_stage_sink/3` 只在 `snapshot.stage_sink` 是函数时才订阅执行结果并调用 `ProviderRunLog.record_execution/2`；生产代码中未找到给 snapshot 注入 `stage_sink` 的调用点（只有测试显式传入），普通对话 AgentRun stage 未携带 sink，所以 ProviderRun/Event/Output 不落库，activity API 的 usage 断言必然失败。

该缺口属于 UA-01/ADR-0023 CP4D 的产品接线，不是 B84 测试作用域或场景预期可自行修绿。已登记到 [B87 总计划 §12](../tasks/slices/B87-model-interaction-request-projection.md)（跨任务缺口）；按 B87 当前计划**没有批次承接**：R01 不改 `apps/*/lib`，R02–R19 无 ProviderActivityProjector/stage_sink 注入批次，R19 只做最终质量门。需作者裁决新增批次或并入/前置某批；本轮未修改生产代码。

### 8.3 验证范围与诚实限制

- 本轮执行：`node --test scripts/lib/process_tree.test.mjs scripts/lib/test_env_scope.test.mjs`（通过）；`MIX_ENV=test mix test apps/novel_application/test/novel_application/agent_run_cleanup_test.exs`（12/12）；`pnpm test:slice-verify`（260/260）；`pnpm lint`（0）；REV-06 受控三态脚本。
- **未执行**：完整 `task_done`/`mix check`/Cargo 全量（本轮多次按作者要求中断长门禁）、完整真实模型批次、REV-04 精确调度反例、REV-02 受影响页面通过证据。
- 因此本节的“已修复”仅指对应代码与局部回归通过；**B84 不能据此签收**，REV-02 页面与 REV-04 反例仍是复核缺口。原有 A2 随 R01 两族、b71-pending、driver/G2 拆分、dogfood、lefthook 等 B84 债务也不因本节消失。

### 8.4 提交清单（均未 push）

`1e732920`、`51fc8bfc`、`760c81fe`、`f84514ce`、`99b0fa35`、`6e066e48`、`759406cc`、`ad5d2da7`、`01a2125f`、`10bec53a`。本地分支领先远端，推送需作者通知。

## 9. 整改后独立复核与交接

> 复核日期：2026-11-14。本节是在 §8 整改实施结果之后完成的独立复核快照，供后续处理人修复与复验；不覆盖 §1–8 的历史记录。执行状态继续只维护在 [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)。作者指令：“写报告，我叫人处理”；本次仅更新文档，不实施代码修复。

### 9.1 结论、版本与范围

**复核结论：REV-04 的原竞争缺陷已验证修复；REV-01、02、03、05、06 仍有确定的剩余问题。不能认可 §8 所述六项均已完成代码修复，也不能据此签收 B84。§8.2 的“缺少 stage_sink 导致未持久化”归因撤回，依据见 §9.8。**

| 项目 | 本轮口径 |
|---|---|
| 分支 / HEAD | `develop/dialogue-based-novel-workbench` / `adc71f2cf70ac577b29709b53384c5ef501cc66d` |
| 被复核提交 | `1e732920`、`51fc8bfc`、`760c81fe`、`f84514ce`、`99b0fa35`、`6e066e48` 及其报告/任务记录 |
| 工作区 | 仓库含其他开发线 WIP；本轮关键被审源码与报告在复核时与 HEAD 一致。不能宣称全仓 clean |
| 平台边界 | macOS；沿用作者“A5 验证过 mac 了，win/Linux 不需要验”的裁决 |
| 本轮新增执行 | 自有进程/目录的有界故障与竞态探针；真实 helper/配置的隔离机制验证 |
| 本轮读取 | 当前源码、既有编译 CSS、上轮页面运行的日志/帧/数据库与场景断言 |
| 未重新执行 | 完整 Mix/Cargo/task_done、完整前端套件、真实模型批次、真实页面、前端重新构建 |
| 证据归属 | §8 的 12/12、260/260 等是整改实施者历史批次，不计成本轮重新执行；本轮探针不是整链产品验收 |

以下级别沿用原发现，不新增一套问题编号；REV-05 的两条路径与 REV-06 的剩余清理问题均归原编号承接。

| 编号 | 本轮独立复核结论 | 已成立的部分 | 仍需完成 |
|---|---|---|---|
| REV-01 / P1 | **仍开放** | 持续写入、打开句柄、命令路径引用能被拦截 | 静默存活的失联 payload 仍会被归档，随后重建无 marker 原路径 |
| REV-02 / P2 | **仍开放** | 判据增加了可见非空段落条件；启动证明已调整 | CSS Modules 明文选择器不匹配真实 DOM；当前 run 内容绑定与真实页面通过证据待完成 |
| REV-03 / P2 | **部分修复，仍开放** | helper 在受控信号失败时能够返回非零 | 调用者收到失败后仍无期限 wait，阻塞后续回收与最终失败传播 |
| REV-04 / P2 | **原缺陷复核通过，可关闭** | 精确发布/退出竞争回放转绿，waiter 正确复用已发布模板 | 将该精确时序固化为仓库回归用例 |
| REV-05 / P2 | **部分修复，仍开放** | 原 dead-caller 分支会报告查询超时 | live-run 安全点仍无界查询；首个查询超时可漏掉其他 Supervisor 中的自有任务；宽限不得抹掉超期 |
| REV-06 / P2 | **部分修复，仍开放** | 缺失幂等、失败诊断、成功改非零、原失败码保留均有证据 | 成功运行遇首个删除失败立即 halt，跳过本可删除的 wal/shm |

### 9.2 REV-01：静默存活的 payload 仍被归档（P1）

**定位：**[test_env.mjs](../scripts/lib/test_env.mjs) 的 `latestTreeMtimeMs`（195–206）、`openHandlesInScope`（209–215）、`processesReferencingScope`（218–231）和 `reapOrphanScopes`（260–287）。当前 marker 在 306–313 行仅记录创建者 PID，没有持久登记实际 payload 进程组身份。

三种检查可以发现某些活动迹象，但三者均未命中不能证明子进程已经结束。payload 可以只通过环境变量持有 TMPDIR，暂时无文件句柄、无近期写入、命令行也不包含 scope 路径，随后恢复工作。

**本轮复现步骤：**

1. 用真实 `test_env.mjs run` 在本次专属 base 创建 owned scope；payload 从环境变量读取 TMPDIR，安装信号处理器并静默等待。
2. SIGKILL wrapper owner，确认 payload 仍存活。
3. 仅将本次合成 scope 的完整文件树 mtime 调到两分钟前，以一分钟阈值调用当前 reaper。
4. 归档后向该 payload 发送 SIGUSR1，观察它是否继续向原 TMPDIR 写入。

实际关键输出：

```json
{
  "probe": "idle-orphan-env-only-path",
  "ownerKilled": true,
  "payloadAliveAtReap": true,
  "reapedCount": 1,
  "keptReasons": [],
  "markerPreservedBeforeWake": false,
  "originalScopeRecreated": true,
  "originalMarkerExists": false,
  "payloadResumedWrite": true
}
```

这是受控目录老化和信号时序，不是等待自然过期，也没有操作历史 scope。探针最终按捕获 PID 结束本次 payload 并回收自有目录。

**处理要求：**在现有 owner 生命周期内补齐可验证的实际子进程/进程组归属与退出事实。无法证明归属或结束时保留现场；不能继续把“未发现活动迹象”当成“已证明资源结束”。先核对既有进程所有权机制，避免另建平行管理框架。

**关闭条件：**新增“静默、通过 env 持有路径、稍后恢复写入”的回归；归档前确认 owned 活动资源已收口，归档后原路径不再生，证据保留；未知归属保持现场且给出原因。已有近期写入/句柄/命令引用、已退出 owner、无 marker、重复执行等覆盖继续保留。现有 [scope 测试](../scripts/lib/test_env_scope.test.mjs) 3048–3127 行覆盖了新增迹象检查，但没有覆盖本轮反例。

### 9.3 REV-02：编译前 CSS 类名不能定位真实叙事（P2）

**定位：**[external-ui-driver.mjs](../frontend/slice-verify/external-ui-driver.mjs) 30595、30606 行使用：

```js
region.querySelectorAll(".agenticLoopReasoning p")
```

而 [WorkspaceChat.tsx](../frontend/src/components/WorkspaceChat.tsx) 230 行导入 `WorkspaceChat.module.css`，931 行通过 `styles.agenticLoopReasoning` 渲染；[vite.config.ts](../frontend/vite.config.ts) 没有保留明文类名的例外。工作区既有 `frontend/dist/assets/index-q0_YfWjJ.css` 对应类名为 `._agenticLoopReasoning_1p1yf_753`，不含明文类选择器。

因此实际叙事即使显示，新增选择器仍会得到空集合。§8 的合成 DOM 三态验证没有覆盖 CSS Modules 转换。另一个待落实条件是当前 run 绑定：当前代码读取第一个“本轮创作过程”并接受任意非空段落，尚不能单凭该条件证明当前目标 run 的预期叙事恢复。

**证据边界：**本轮核对源码、配置与既有编译 CSS，没有重新构建或重跑页面。第三次历史页面运行先在 ProviderRun 数量断言失败，尚未走到这个选择器；不能把本缺陷改写成该次运行已经观测到的直接失败原因。其他 run 内容代签的风险本轮未另做 GUI 复现，不另计新 finding。

**处理要求与关闭条件：**

1. 按真实页面可达的语义定位当前待恢复 run，并核对该 run 的预期可见叙事；不固定匹配编译前类名，不添加产品验收专用 hook。
2. 在既有测试集合补实际 DOM 形态的正反例：正确叙事、区域存在但零叙事、隐藏叙事、其他 run 有叙事而目标 run 未恢复。
3. 按 §9.8 对齐前置场景与现行设计契约后，完成受影响真实页面复验；局部谓词通过不能代签页面。
4. 同时复核原报告指出的流式采样是否混入活动文案/时长，避免把状态文字增长当作模型叙事增量；该项仍是原静态检查项，不冒充本轮新页面证据。

### 9.4 REV-03：helper 失败后，调用者仍无期限 wait（P2）

**定位：**[slice_verify.sh](../scripts/slice_verify.sh) 76–79 行、[tauri_slice_verify.sh](../scripts/tauri_slice_verify.sh) 765–776 行。调用链仍为：

```bash
kill_process_tree "$PID" || cleanup_failed=1
wait "$PID" 2>/dev/null || true
```

[process_tree.sh](../scripts/lib/process_tree.sh) 135–142 行虽然加入 SIGKILL 后有界确认，但 helper 报告目标仍活着后，调用者下一行又无期限等待同一进程，后续 owned 资源和最终失败诊断都无法继续。

**本轮复现：**从当前 slice 脚本原文提取未修改的 cleanup 函数，加载真实 helper；专有 shell/独立进程组中启动 sleep 30，仅对 TERM/KILL 注入失败，kill -0 保持真实探测。外层在 9 秒处结束观察。

```json
{
  "source": "scripts/slice_verify.sh cleanup (unmodified function)",
  "signal_failure_injected": true,
  "still_blocked_at_9s": true,
  "helper_failure_recorded": true,
  "caller_wait_lines": ["+ wait 62990"],
  "cleanup_failure_message_reached": false,
  "probe_process_group_killed_and_reaped": true
}
```

PID 62990 仅为该次专有 sleep 的临时 PID。探针外层终止了本次专有进程组并回收直接 shell；没有做全机残留扫描，不声称逐一 reap 所有后代。这是信号失败注入，不声称宿主自然发生了 EPERM，也不是完整页面入口验收。

**处理要求与关闭条件：**调用者在 helper 失败后等待仍须有界；一个资源失败不能阻塞其他自有资源的处理。保留原始退出码及附加 cleanup 诊断，原运行成功而清理失败时最终必须非零。回归要从真实 cleanup 调用链进入，验证结束期限、后续资源确实被处理、最终结果与幂等不存在路径，而不是只直接测试 helper。

另需核对 helper 的现有静态边界：81–87 行中 kill -0 本身不能区分 ESRCH 与 EPERM；95–100 行无法取得 stat 时返回“不存活”，与注释“无法查询时保守按存活”相反。本轮未扩展这两项故障探针，不单独增加发现计数。

### 9.5 REV-04：精确发布/退出竞争已转绿

**定位：**[test_env.mjs](../scripts/lib/test_env.mjs) 的 `awaitFixtureOwner`，1231–1235 行。发现 claim owner 已退出后再次调用 `ownerOutcome`，接受已发布或失败的最终事实。

本轮重放原来的关键调度：waiter 首先读到未发布，在读取 claim 后受控暂停；owner 完成原子 rename 并正常退出；waiter 再继续判断 owner 状态。

```json
{
  "probe": "publication-between-observation-and-owner-exit",
  "ownerExit": 0,
  "waiterAccepted": true,
  "publishedBytes": "valid fixture"
}
```

上面为原始双进程回执的字段摘要；waiter 原始 stdout 是 `{"accepted":true,"bytes":"valid fixture"}`。上一轮同一时序会误报 owner 退出且未发布；本轮正确复用模板，没有发生 waiter 重建。

**结论：原缺陷已验证修复，可关闭。** §8 的“未执行精确调度反例”仍是整改实施当时的历史事实；本轮已经补上运行证据。该反例尚未固化为仓库测试，应作为防回归工作继续承接，不能把“未入库”混写成“本轮没有验证”。

### 9.6 REV-05：安全点漏接 deadline，查询失败还可漏清其他自有任务（P2）

**定位：**[agent_run_cleanup_helper.exs](../apps/novel_application/test/support/agent_run_cleanup_helper.exs) 202–211、236–265、354–360 行。

**已经成立的修复：**原 dead-caller + 其他 owner background shutdown 的 20ms 反例，现在会报告 owned_tasks 超时，不再把迟到空集合当成成功；本轮该探针耗时 40ms，普通调度开销不另计缺陷。

**剩余路径 A：安全点仍无界查询。** `safe_point_state/2` 第 208 行直接执行 `owned_tasks(pid, [@step_supervisor])`，没有调用新增有界包装。另一 owner 的 step task 已进入 250ms shutdown 等待后，`release_run(live_run, 20)` 实际耗时 310ms，最终才报告 stop 超时。新实现改了最终 drain，却漏掉了实际 live-run 清理链上的安全点查询。

**剩余路径 B：前一个 Supervisor 阻塞时，另一个中的自有任务未处理。** `owned_tasks` 顺序查询两只 Supervisor；首个查询超时后 247–248 行直接返回错误，已经退出的 caller 所属 background task 仍然存活。

本轮字段摘要：

```text
original_dead_caller_20ms:
  result = owned_tasks timeout; elapsed_ms = 40

live_run_safe_point_20ms:
  result = stop timeout; elapsed_ms = 310
  live_run_alive_after = false

step_blocked_owned_background_20ms:
  result = owned_tasks timeout; elapsed_ms = 83
  owned_background_alive_after_cleanup = true

dead_caller_zero_deadline:
  result = :ok; elapsed_ms = 25
```

最后一个结果补充说明：259 行在 deadline 已过后给 50ms 查询机会，却没有记录超期；263 行返回迟到空集合后仍可能成功。宽限可以用于继续清理，不能抹掉已经发生的期限失败。

**严格证据边界：**通过 Code.require_file 加载当前真实 helper，使用真实 Task.Supervisor、DynamicSupervisor、任务、shutdown、监控与 $callers 归属。live-run 分支使用最小 GenServer 协议替身返回 current_task?: false，并在独立进程内以最小 API 转发模块承接 command/state；没有加载生产 AgentRunServer，也没有启动 Repo、SQLite、Provider 或创作业务。其他 owner 已收到 shutdown 的消息作为调度屏障。本证据证明 helper/OTP 机制问题，不代签产品整链。探针结束后自行清掉剩余任务，不能据此声称被测 helper 已经收净。

**处理要求与关闭条件：**

- 安全点及最终 drain 的查询都消费同一 deadline；不能等待无关 owner 的整个 shutdown。
- 各 Supervisor 查询失败要独立处理，保留已取得的归属任务；一处失败不能丢弃其他可查询范围的回收责任。
- deadline 已过时明确记录失败；随后如有有限清理宽限，迟到空集合也不能恢复为成功。
- 在既有 [agent_run_cleanup_test.exs](../apps/novel_application/test/novel_application/agent_run_cleanup_test.exs) 补 live-run、跨 Supervisor、自有任务实际存活状态、零期限/期限耗尽反例；用消息屏障控制时序，保留正常、嵌套、重复释放和无关 owner 保护覆盖。
- 仍须保证本 case 任务收口后才释放 Sandbox。只断言抛异常不足以证明所有权边界正确。

### 9.7 REV-06：成功运行的首个删除错误截断后续清理（P2）

**定位：**[config/test.exs](../config/test.exs) 39–52 行；50 行的 System.halt(1) 位于三个文件的遍历内部。

**已验证正确的部分：**正常删除和文件缺失均退出 0；真实删除拒绝会输出路径与 :eperm，原运行成功时改为 1，原运行退出 2 时保留 2。原“静默成功”的缺陷已经修复。

**剩余问题与本轮复现：**

1. 用当前 Config.Reader.read! 加载真实退出钩子，按其路径规则创建本次专属 db/wal/shm 普通文件。
2. 仅给主文件设置 macOS uchg，wal/shm 保持普通可删除状态。
3. 分别观察原运行成功退出与原运行失败退出的结果。

| 条件 | 最终退出 | 诊断 | 被测钩子执行后残留 |
|---|---:|---|---|
| 正常删除 | 0 | 无 | 无 |
| 文件原本缺失 | 0 | 无 | 无 |
| 仅主文件拒绝删除，原运行成功 | 1 | 主文件路径 + :eperm | **db、wal、shm** |
| 仅主文件拒绝删除，原运行退出 2 | 2 | 主文件路径 + :eperm | **仅 db** |

后一个结果证明 sidecars 原本可以删除；前一个结果的残留来自循环第一项失败后立即 halt。

**证据边界：**这是当前配置注册的真实 at_exit 与真实文件系统删除，不是真实 SQLite 业务库/连接测试。文件内容只是 owned-review-fixture。失败码有效补验使用 `exit({:shutdown, 2})`；早先一次 `System.stop(2)` 尝试绕过了目标退出钩子，属于探针设置错误，不参与验收结论。外层 finally 清除了自己设置的 uchg 并回收文件，没有处理历史 DB 或作者资料。

**处理要求与关闭条件：**完整尝试 db/wal/shm 清理并汇总失败后，再统一决定退出码；保留原失败码，继续处理仍可删除的文件。将正常、缺失、主文件失败但 sidecars 可删、原失败码保留、显式 NOVEL_TEST_DB_DIR 借用路径不删除等反例纳入既有测试体系。实施前先定位现有测试承接，不另建退出管理框架。

Rust TempDir::drop 忽略删除结果仍仅为原报告的静态观察，本轮没有补 Rust 故障复现，也不增加为第七项确认发现。

### 9.8 撤回“缺少 stage_sink 导致未持久化”的归因

§8.2 将页面失败确诊为“生产 snapshot 没有注入 stage_sink，ProviderRun/Event/Output 因此未落库”。当前源码及同次历史运行材料足以否定该确诊：

| 核对对象 | 已观察事实 | 可支持的判断 |
|---|---|---|
| [agent_run_server.ex](../apps/novel_application/lib/novel_application/agent_run_server.ex) 3442–3453、904–908 行 | step_snapshot 构造 stage_sink，再通过 with_request_view 传给 executor | 生产注入点存在；“生产没有注入调用点”不成立 |
| [authoring_session.ex](../apps/novel_application/lib/novel_application/agent_run_flows/authoring_session.ex) 34–52、283–291 行 | 请求视图扩展/更新 snapshot，保留已有字段 | 所核对链路没有在这里丢掉 sink |
| [judgment_protocol.ex](../apps/novel_application/lib/novel_application/judgment_protocol.ex) 49–59 行 | 普通判断执行经 with_stage_sink 包装 | 不能跳过真实调用链，仅凭搜索不全断言接线缺失 |
| 历史 backend.log 704–705、907–908 行 | QUERY OK 的 provider_runs INSERT 与 provider_outputs INSERT，后者含 input_tokens=746、output_tokens=5 | 运行期间实际执行过事实写入；成功 INSERT 单独不替代事务提交证明 |
| 历史 ui-frames.json | 同一 ProviderRun 有 6 条作者可见 provider_progress | 流式投影实际发生；6 条事件不等于 6 个 ProviderRun，也不能单独证明提交 |
| [external-ui-driver.mjs](../frontend/slice-verify/external-ui-driver.mjs) 30533–30548 行 | 历史报错对应 queriedProviderRuns.length >= 3；此前依次检查 AgentRun、started/final 与 provider refs | 该报错是集合数量门槛失败，不能解释成 ProviderRun 必然为 0 |
| [tauri_slice_verify.sh](../scripts/tauri_slice_verify.sh) 516–521、758–781 行与历史 tauri.log | 该场景不在系统原生 allowlist；日志为 tauri dev；非系统原生分支退出时会 reset_test_db | 退出后空库受到后处理影响，不能倒推运行期间从未持久化 |

历史材料位于 `artifacts/slice-verify/agent-provider-execution-activity-restored-tauri/`。本轮只读复核：保存库中的 provider_runs、provider_events、provider_outputs、agent_runs、agent_events 均为 0；日志有一次 ProviderRun INSERT、一次 ProviderOutput INSERT、28 条 commit、未见 rollback。后两个计数是日志汇总，不表示已逐笔重新对账每个事务。API 顺序断言的判断来自历史报错与当前源代码执行顺序，本轮没有重新调用运行中的 API 或取得新的响应快照。

**更正结论：**保留“真实页面未通过”的事实；撤回“没有 sink、从未落库”的确诊。退出后的数据库不能作为该确诊依据。当前已定位的直接失败门槛为 ProviderRun 数量 >= 3；其上层根因仍须按现行愿景、设计、调用契约与场景要求继续核对。

**交接要求：**

1. 先核对当前运行 profile、真实调用生命周期与场景所要求的数量/purpose/usage/恢复语义，判断是否为场景漂移、执行路径未覆盖或 API 投影遗漏。
2. 不能因为只观察到较少调用就直接把 >=3 改成 >=1，也不能增加无业务意义调用凑数。
3. 保留当前 run 因果绑定、usage、持久事实恢复、不重复调用 Provider、无原文泄露等原验收目标。
4. 复跑前明确证据保留时点，读取/快照必须在会重建 DB 的 cleanup 之前完成；不得把清理后空库当作运行期事实。
5. [B87 §12](../tasks/slices/B87-model-interaction-request-projection.md#12-跨任务登记更正rev-02-页面复验归因) 同步撤回“新增 sink 接线批次”的依据。本轮不改 B87 批次范围；后续若证明有产品缺口，再按真实责任层归属处理。

### 9.9 处理顺序与验收交接

| 建议顺序 | 处理对象 | 必须交回的证据 |
|---|---|---|
| 1 | REV-01 所有权与失联恢复 | 静默 payload 反例、活动结束/不可确认两类结果、原路径不再生、证据保留 |
| 2 | REV-03 / 05 / 06 清理调用链 | 真实 cleanup 入口有界失败；跨 Supervisor 自有任务收口；首文件失败后 sidecars 仍清理；原失败保留 |
| 3 | REV-02 页面与前置场景 | 现行设计/契约判据核对记录、真实 DOM 正反例、受影响真实页面通过、清理前持久证据 |
| 4 | REV-04 防回归 | 将本轮精确发布竞争固化到已有 scope 测试；既有并发/复用/失败路径继续通过 |

实施者先读本节与 [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)，复用既有 owner/helper/driver/test owner；任何新实体先查重。修复只处理已证明的问题及必要调用链，避免另建任务台账、清理框架或产品验收 hook。

scope 自测仍走仓库既有 self 入口，不套普通 borrowed run；本机依赖路径包含 Node 与 Homebrew Python/PyYAML：

```bash
/usr/bin/env -u NOVEL_TEST_RUN_DIR -u NOVEL_TEST_ENTRY_SCOPED \
  PATH=/Users/loong/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  bash scripts/node_test.sh --self scripts/lib/test_env_scope.test.mjs
```

此命令是已核实入口说明，**本轮复核没有重新执行完整 scope 套件**。其他验证按修改面复用当前工程入口、[质量门禁](../docs/engineering/quality-gates.md) 与场景 manifest；不要把上轮计数、合成谓词或本节诊断探针冒充新一轮完整验收。

修复回报必须包含：基线/改动文件、各反例修前修后结果、适用回归命令和实际计数、真实页面与局部机制的证据分层、剩余缺口及 owned 资源回收结果。整改状态只更新 B84 原任务，历史证据以追加方式保存。A2 随 R01 两族、b71-pending、driver/G2 拆分、dogfood、lefthook 等既有债务不因本节消失。

### 9.10 本轮证据标识、限制与源码指纹

| 内容 | 标识 / 来源 | 收尾与解释 |
|---|---|---|
| REV-01 静默 orphan | test_env run `5d9d4b32f5fd0477` | 外层 exit=0、tree_finalized=true；负例明确仍可误归档 |
| REV-04 精确发布竞争 | test_env run `611a304938f95c67` | 外层 exit=0、tree_finalized=true；waiter accepted=true |
| REV-05 四个机制反例 | test_env run `48817a12c00fa849` | 外层 exit=0、tree_finalized=true；残留任务由探针兜底结束，不算 helper 自行清净 |
| REV-06 正常/缺失/拒绝 | test_env run `2841694c67e4ae97` | 含一次被排除的 System.stop(2) 探针设置错误 |
| REV-06 原失败码有效补验 | test_env run `5accd2e39cc9a5c8` | exit({:shutdown, 2}) 执行目标钩子；外层回收自有标记/文件 |
| REV-03 调用者 wait | WebCodex 同步 run_script 回执 | 未返回 Job ID；临时 PID 不是证据编号，未虚构 artifacts 路径 |
| REV-02 / 页面归因 | 当前源码、既有 CSS、历史页面 artifacts | 本轮没有新构建/页面/API 运行证据 |

以上 run 值是 test_env 输出，不是 wc_job 编号。外层 exit=0 表示探针本身完成观察与收尾，不代表被测负例通过。短探针脚本未作为正式回归用例落库，本报告保存足够定位和重建反例的步骤、屏障、输出与边界；不得声称仓库已经新增这些测试。

REV-05 直接加载 helper 时还有“owned_tasks/2 默认参数未使用”的编译 warning；本轮不将其另计主要发现，也不宣称零告警编译通过。REV-06 无效的 System.stop(2) 尝试已排除。全部故障注入只作用于本次自有合成资源；没有全局 reap、历史 DB 清理或共享模型操作。

复核开始与文档写入前核对的源码 SHA-256：

| 文件 | SHA-256 |
|---|---|
| `scripts/lib/test_env.mjs` | `80a87e5825e4f938f1f17c47ab146503709e85dc784c2f804fe02a59bbc97c23` |
| `scripts/lib/test_env_scope.test.mjs` | `08b31690a06c105aa4751c8fdd2c739263c2cc747dc59feb85b59502329def5f` |
| `scripts/lib/process_tree.sh` | `d3001aa9d31c7b2226f96f3edccefd58c2cc9e9fa09b625e86a9e5083e914b41` |
| `scripts/slice_verify.sh` | `eed37de39f2decaf71fc94329e8088c4d8976026a5022589b70d37813008a670` |
| `scripts/tauri_slice_verify.sh` | `d85d705e5d421151b1fc5194c0e7557882b7d227911c911f96899c304fc7427c` |
| `frontend/slice-verify/external-ui-driver.mjs` | `9c48bc906931587a008f0aa96cccb0510b916052044b3a057479b889c52c8cb2` |
| `frontend/src/components/WorkspaceChat.tsx` | `de5db70bfdfd70e9ae3493e1547f12a83ebc6e0a483d9244f562b18241eafcf9` |
| `apps/novel_application/test/support/agent_run_cleanup_helper.exs` | `f099efa71d1fe7ca7120ca662ee0064b9a4c092ec5cd59869edc3e3d404ef86c` |
| `config/test.exs` | `5c93b79adb194bee741be48dbec266612933ccfee969413d247049bfd1ffbdd4` |
| `apps/novel_application/lib/novel_application/agent_run_server.ex` | `8c00d92fe2912cfda1982b04ce9a9d316476bbd0a4946c385f82f1f7dbe6bd66` |

追加前报告（326 行，含整改实施者 §8）的 SHA-256 为 `9c48fe693b181da23983c016b7a5dddd477e76c5df5f0357999649b7e32ac892`。本轮只追加复核和导航说明、同步原任务与 B87 归因更正；§1–8 的历史正文保留。后续源码变化时应按函数和指纹重新定位，不机械使用本节行号。

## 10. 复核问题整改结果（2026-11-14，复核后）

> 本节由整改实施者按 §9.9 的处理顺序追加，记录对 §9 剩余项的修复、局部证据与未闭环项；§1–9 的历史记录与判断保持不变。执行状态仍只维护在[B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)。

> **后续复核提示：**本节保留整改实施者当时的处理结果与运行记录；“已修复／run 绑定”的范围由 [§11 静态复核](#11-第二轮整改后的静态复核与交接)进一步核对和限定。请勿将本节自检声明直接作为独立签收结论。

### 10.1 逐项结果

| 编号 | 处理结果 | 提交 | 本轮证据 |
|---|---|---|---|
| REV-01（P1） | **已修复**：`spawnScoped` 将真实子进程 pid/pgid 持久登记到 scope 的 `.novel-test-run-children.jsonl`；`reap` 归档前先核对 journal：存活子进程/进程组 → `live_children`，缺失 journal → `children_unverifiable`（默认保留现场） | `02b16162` | 静默 env-only payload（不写文件/无句柄/命令行不含 scope）复验 `reaped=0`、原 scope 保留；终止后才归档；旧无 journal scope 默认保留。scope 全套 **65/65** |
| REV-02（P2） | **判据已修复，页面复验未闭环**：选择器改用 `[class*="agenticLoopReasoning"]` 匹配真实 CSS Modules 哈希类名；刷新前采集本 run 可见叙事，刷新后必须匹配同一片段 | `10ebf4b4` | 从 driver 原文提取谓词做合成 DOM：零叙事、隐藏叙事、其他 run 叙事均 `false`；哈希类名叙事与 expected 匹配为 `true`；driver 260/260、lint 0 |
| REV-03（P2） | **已修复**：新增 `wait_process_exit`/`reap_process_tree`；`slice_verify`/`tauri_slice_verify` cleanup 不再无期限 `wait`，信号失败有界返回非零后继续处理其他 owned 资源 | `00737ef7` | 正常、信号拒绝+仍存活、不存在/空 PID、子孙树、有界失败共 **7/7** |
| REV-04（P2） | **复核者已用精确发布/退出时序验证通过**；仓库内精确回归用例**尚未固化** | — | 本轮未新增调度反例；既有 fixture 并发/复用与 scope 套件通过 |
| REV-05（P2） | **已修复**：safe point 使用有界查询；逐 Supervisor 查询，一处超时不丢弃其他自有任务；deadline 已过的宽限查询记录超期，不再把迟到空集合当成功 | `fba0fca4` | live-run safe point、跨 Supervisor 清理、零期限反例；**15/15** |
| REV-06（P2） | **已修复**：先尝试 db/wal/shm 全部删除，再统一决定退出码；原运行成功+删除失败→1 且 sidecars 已清理，原失败码保留 | `79a3912f` | 受控四态：正常 0 / 缺失 0 / 原成功+主文件拒绝 1（sidecars 已删）/ 原失败 2（sidecars 已删） |
| Rust `TempDir::drop` | **未修**（原报告静态观察，未计数） | — | 未做 Rust 故障复现 |

### 10.2 REV-02 页面为何仍未闭环

真实场景 `agent-provider-execution-activity-restored` 在恢复判据之前失败于 `queriedProviderRuns.length >= 3`。历史 backend.log 确认运行期确有 ProviderRun/ProviderOutput 写入（此前“缺少 stage_sink、从未落库”的归因已按 §9.8 撤回）；退出后的数据库为空是 cleanup 重建所致，不能倒推运行期无持久化。

当前普通对话（`slice_verify` stub）只产生 **1 个** ProviderRun（purpose=planner），而 driver 断言至少 3 个；UA-01 CP1 的历史 routed conversation 验收口径为 3 次 provider calls。二者差异需要按现行愿景、设计与场景契约核对：判断是场景预期漂移，还是 stub/执行路径未覆盖。**不能直接把 >=3 改成 >=1，也不能增加无业务意义调用凑数**；本轮未修改该断言。

因此 REV-02 的页面关闭条件仍未满足：选择器与 run 绑定已有局部证据，但“受影响真实页面通过”尚未取得。

### 10.3 验证范围与诚实限制

- 本轮执行：`node --test scripts/lib/test_env_scope.test.mjs`（65/65）；`node --test scripts/lib/process_tree.test.mjs`（7/7）；`MIX_ENV=test mix test .../agent_run_cleanup_test.exs`（15/15）；`pnpm test:slice-verify`（260/260）；`pnpm lint`（0）；受控 REP-06 四态脚本。
- **未执行**：完整 `task_done`/`mix check`/Cargo、完整真实模型批次、REV-02 受影响真实页面通过证据、REV-04 精确回归入库。
- 局部探针与合成 DOM 不是整链页面验收；本轮不据此签收 B84。B84 保持 `doing`，等复核者按 §9 关闭条件复验。

### 10.4 提交清单（均未 push）

`79a3912f`（REV-06）、`00737ef7`（REV-03）、`fba0fca4`（REV-05）、`02b16162`（REV-01）、`10ebf4b4`（REV-02 判据）、`2c10b788`（B84 状态记录）。本地分支领先远端 23 个提交，推送需作者通知。

## 11. 第二轮整改后的静态复核与交接

> 复核日期：2026-11-14。本节核对 §10 的整改声明，保存本次固定基线下的判断与交接要求；执行状态仍只维护在 [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)。本节为静态复核，未新增功能运行验收。

### 11.1 基线与证据边界

- **代码基线**：`7f3208ef7749a5814d54cc629f1814f380d45ece`，分支 `develop/dialogue-based-novel-workbench`。仓库含其他 WIP；本次核对的 11 份实现、测试和调用方文件均与该 HEAD 一致，不能把全仓描述为 clean checkout。
- **已做**：读取 §10、相关整改提交、当前实现与回归代码；核对真实调用方、DataCase 收尾责任及报告导航。写回时再次确认基线和相关源码指纹。
- **未做**：未重跑 scope、driver、process_tree、Mix/Cargo 套件，未执行新的故障探针、真实页面或模型批次。§10 的 65/65、260/260、7/7、15/15、lint 0 与 DB 四态均为整改者记录的运行证据，不改写为本次独立复跑通过。
- **历史证据**：REV-04 沿用 §9.5 已取得的精确发布／退出竞争回放，不冒充当前基线新执行；§9 的其他反例用于说明修复目标，不把旧版本故障直接归到新代码。
- **平台范围**：沿用作者确认的 A5 macOS 已验事实；Windows/Linux 不属于本次验收范围，不列为补验缺口。
- **交付边界**：本次写回原报告、B84 任务状态及报告索引；实现与正式回归交由后续处理人。B84 保持 `doing`。

### 11.2 六项复核判断

| 编号 | 本次可支持的结论 | 仍需处理或证据限制 |
|---|---|---|
| REV-01（P1） | 子 PID/PGID 登记、缺失 journal 默认保留已落地；**尚未满足关闭条件** | journal 损坏或漏登仍可能被当成已核实，启动与登记之间的中断窗口未处理；见 §11.3 |
| REV-02（P2） | CSS Modules 选择器已修；**本 run 绑定仍未成立** | 首个区域、空 expected 放行及前缀匹配仍可接受错误叙事；真实页面未闭环；见 §11.4 |
| REV-03（P2） | 上轮“helper 失败后调用方无限 wait”的缺口**已在源码中补齐** | 本轮核对完整 cleanup 调用链及对应回归，未独立重跑 §10 的 7/7；见 §11.6 |
| REV-04（P2） | **维持 §9 原缺陷复核通过** | 精确竞争时序尚未固化为仓库回归；本轮没有新运行证据 |
| REV-05（P2） | 上轮三处实现缺口已补；**新增回归的失败收尾仍待补齐** | 用例断言失败会越过唯一显式清理，shutdown 时序仍依赖 sleep；见 §11.5 |
| REV-06（P2） | 上轮首个删除错误截断 sidecar 清理的问题**已在源码中修复** | §10 四态属于整改者受控脚本证据，未固化为本次新增仓库回归；见 §11.6 |

上述“源码落实”限定为本次所核对的具体缺陷，不等同于完整 B84 签收；也不因本轮未复跑，把已有明确对应修改写回成“原实现仍未修”。

### 11.3 REV-01：登记完整性尚不能支撑安全归档

**已认可的进展。** [test_env.mjs](../scripts/lib/test_env.mjs) 的 `spawnScoped` 在真实启动后登记 PID/PGID（486–497 行）；`reapOrphanScopes` 在归档前核对登记，已登记活子进程／进程组会保留为 `live_children`，无 journal 默认保留为 `children_unverifiable`（343–350 行）。这针对了 §9 的静默 env-only payload 缺口。

**遗留路径一：损坏记录仍得到 verified。** `scopeChildrenState`（291–309 行）忽略 JSON 解析失败的行，对剩余条目筛选活 PID/PGID，最终无条件返回 `verified: true`。空文件、仅有截断 JSON 的文件、缺少身份字段的 `{}` 都可能被认定为“已核实且无活子进程”。必要的组身份未知也没有单独判为不可验证。在 owner 已死、目录过期且其他活动检查未命中时，恢复过程仍可走到 rename（379 行）。

**遗留路径二：启动成功与登记完成之间没有可靠状态。** `registerScopeChild`（250–261 行）吞掉追加失败，注释只考虑“缺失 journal 会保留”。但同一 scope 已有旧登记时，新子进程启动后追加失败，或 owner 在 spawn 与登记之间被杀，旧 journal 仍存在；旧进程退出后，恢复阶段不能从这份不完整记录识别新活进程。首次追加创建空文件后失败也会落入上一条路径。

**现有回归的边界。** [test_env_scope.test.mjs](../scripts/lib/test_env_scope.test.mjs) 的静默 payload 用例（3135–3188 行）直接 spawn 后手工写入正确 journal（3165–3168 行），证明“登记完整时能检测静默 payload”。它没有覆盖真实 `spawnScoped` 登记、既有 journal 上的漏写、半行损坏或启动／登记中断。因此 65/65 不能代替这些路径的证明。

**影响与证据等级。** 上述判断由当前代码路径确认；本轮未执行新的写入失败或 SIGKILL 探针。原风险仍是：无法证明全部自有子进程已结束，却恢复归档资格，活 payload 随后可能继续使用原路径。

**处理及关闭条件：**

1. 复用已有 scope owner，明确区分完整登记、登记未完成和不可验证；空／损坏／必要身份缺失不能自动获得归档资格。
2. 令启动意图、登记完成或等价事实参与恢复判断，消除“子进程已启动，但 journal 看起来仍完整”的窗口；登记失败不能静默保留安全归档资格。
3. 在现有 scope 回归中走真实启动链，覆盖旧 journal 后追加失败、启动／登记中断、损坏尾行、静默 payload 及正常结束后可归档；未知状态默认保留现场。
4. 探针与回归只处理本用例资源，失败时也有独立清理兜底；不新建平行 owner 框架。

### 11.4 REV-02：选择器修正不等于本 run 绑定

**已认可的进展。** [external-ui-driver.mjs](../frontend/slice-verify/external-ui-driver.mjs) 使用 `[class*="agenticLoopReasoning"] p`，修正了 §9 中明文 CSS Modules 类名不匹配的问题。

**当前仍存在的判据缺口：**

- 刷新前（30570–30576 行）和刷新后（30603 行）都取全页面第一个 `[aria-label="本轮创作过程"]`，没有消费当前 run/turn 身份来定位对应消息。
- 刷新前未采集到预期叙事时，`input.expected.length === 0` 直接返回 true（30612 行）；只要刷新后有任意可见非空叙事便可通过。
- 30613–30616 行采用双向前 24 字子串匹配，相同前缀不能证明叙事属于同一 run。

**静态反例条件。** 历史 run A 的区域排在本次 run B 前面时，前后都可能采集 A；即使 B 的叙事丢失，比较仍可通过。刷新前 expected 为空时，连“同一片段”的约束也不存在。本轮未实际运行该页面反例，不将其写为新取得的页面故障复现。

因此，§10 的“刷新前采集本 run 叙事”“run 绑定已有局部证据”应被限定为实施者自检声明，不能作为本次关闭结论。

**真实页面的前置契约仍待核对。** 同文件 `driveAgentConversationTurn`（29036–29037 行）预期 1 次 Provider 调用；恢复场景仍要求 `queriedProviderRuns.length >= 3`（30547 行），并要求 purpose 包含 `author_reasoning` 与 `conversation`（30555–30557 行）。§10.2 已说明历史页面失败于数量断言，尚未执行到恢复判据；真正恢复判据仍未取得通过证据。调用数、purpose 及场景要证明的行为必须按现行愿景、设计和契约一并核对，不能仅把 3 改成 1，也不能增加无业务意义调用。§9.8 对“缺少 stage_sink、从未落库”归因的撤回继续有效。

**处理及关闭条件：**

1. 使用已有 run/turn 事实和作者可见语义定位对应消息及叙事，不增加产品验收专用 hook。
2. 缺少当前 run 预期时报告证据不足，或选用契约明确包含叙事的场景；不能退回任意非空段落放行。
3. 覆盖历史 run 存在而当前 run 恢复丢失、相同文本前缀、expected 为空、隐藏／零叙事等反例。
4. 对齐数量与 purpose 的场景契约，再取得受影响真实页面通过证据；合成 DOM 与 driver 套件只作局部证据。

### 11.5 REV-05：实现缺口已补，新增回归自身仍缺失败收尾

**实现修复与上轮问题对应。** [agent_run_cleanup_helper.exs](../apps/novel_application/test/support/agent_run_cleanup_helper.exs) 已在 safe point 使用有界查询（208 行）；逐 Supervisor 累积已取得任务和失败（265–287 行），并先处理已取得任务（248–251 行）；deadline 已过的宽限查询记录超期（241–255、281–287 行）。不再将 §9 中“安全点仍无界”“一次查询失败丢弃另一 Supervisor 的任务”“零期限可假成功”直接描述为当前实现事实。

**新增测试的失败路径仍有缺口。** [agent_run_cleanup_test.exs](../apps/novel_application/test/novel_application/agent_run_cleanup_test.exs) 的 live-run 用例（473–500 行）与跨 Supervisor 用例（510–545 行）创建 blocker、stopper 或自有 background task 后，只在断言之后显式清理；没有在资源创建成功时登记 `on_exit` 或 `try … after`。跨 Supervisor 用例中的任务等待 `:never`，若被测 cleanup 退化，断言恰好会失败并越过后续收尾，缺少独立兜底。

这些任务由全局 `AgentStepTaskSupervisor`／`BackgroundTaskSupervisor` 持有。[DataCase](../apps/novel_persistence/test/support/data_case.ex)（26–28 行）只登记 Sandbox owner 的停止，不能替代这些任务的清理。stopper 的链接或 Supervisor 后续超时也不等同于本 case 已确认归还全部资源。本轮为静态路径核对，未执行新泄漏探针。

另外，487、536 行使用 `Process.sleep(20)` 推测 shutdown 已进入；这仍依赖调度时机，未形成确定性消息屏障。它是回归可靠性问题，不另写成已动态复现的运行故障。

**处理及关闭条件：**

1. 每个资源创建成功后立即登记可幂等的兜底，覆盖中途断言失败；fixture 的归还不能仅依赖被测 cleanup 成功。
2. 用 blocker 已收到 shutdown 的消息确认替代固定 sleep，再进入被测操作。
3. 补定向失败退出验证，证明用例断言失败时本用例资源仍被回收、其他 owner 不受影响；复用现有测试体系，不因此扩展成全量模型／页面批次。
4. 保留 15/15 的准确证据层级：当前用例使用既有 FakeRunServer 与受控 `$callers`，属于 helper/OTP 生命周期回归，不是产品 AgentRun 整链验收。

### 11.6 可认可的修复与保留项

- **REV-03**：[process_tree.sh](../scripts/lib/process_tree.sh) 的 `wait_process_exit`／`reap_process_tree`（152–179 行）在确认进程退出后才执行 shell wait；[slice_verify.sh](../scripts/slice_verify.sh)（76–77 行）及 [tauri_slice_verify.sh](../scripts/tauri_slice_verify.sh)（765、770–772 行）已接入，失败记录非零并继续处理后续资源，保留原始失败码。对应 [process_tree.test.mjs](../scripts/lib/process_tree.test.mjs) 已包含有界失败用例。本次范围内未发现足以否定该具体修复的新问题；7/7 仍注明来源为 §10。
- **REV-06**：[config/test.exs](../config/test.exs)（40–56 行）先遍历 db/wal/shm，记录所有删除失败，再统一决定是否将原成功改为退出 1；原失败码保留，ENOENT 仍为幂等成功，外部指定目录的借用边界未变。上轮首个错误截断后续清理的缺陷已对应修复。四态受控脚本与已入库自动回归是不同证据，报告应继续区分。
- **REV-04**：维持 §9.5 原竞争缺陷通过；精确发布／退出时序仍须固化到已有 scope 回归，不能用普通并发用例替代。
- **Rust TempDir::drop**：维持既有未修静态观察，未新增故障复现，不纳入本轮六项之外的新实测缺陷计数。

### 11.7 处理顺序与文档交接

1. 先处理 REV-01 的登记完整性和启动／登记窗口，保护失联恢复边界。
2. 处理 REV-02 的当前 run 绑定，并核对 ProviderRun 数量与 purpose 的现行场景契约；补真实页面证据。
3. 补 REV-05 新增测试的失败兜底与确定性时序，固化 REV-04 精确竞争回归。
4. REV-03/06 保留已落实的修复进展，按修改面复用现有证据和适用回归，不退回旧缺陷描述。B84 原有其他债务与 Rust 静态观察继续由原任务承接。

原报告 §1–10 保留历史内容；顶部入口改指本节，§10 增加后续复核提示。B84 顶部、当前状态表及新 checkpoint 同步本节判断，旧 checkpoint 标明历史层级；reports 索引更新导航，不另建活动状态台账。本节只完成复核结论交接，不签收完整 B84。

## 12. REV-01 第二轮整改结果（2026-11-14）

> 本节由整改实施者按 §11.7 第 1 项追加，记录 B84-REV-01 的修复、回归与实际限制；§1–11 的历史记录与判断保持不变。执行状态仍只维护在 [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)。本轮只处理 REV-01，REV-02/05/04 等仍按 §11 承接。

> **后续独立复核：**[§13](#13-rev-01-第二轮整改独立复核)已独立复跑 70/70，并取得两条未覆盖的真实恢复反例及回归早期失败证据。下文“已闭环”是实施者当时判断，不能代替 §13 的关闭结论；原运行记录保留。

### 12.1 基线与改动面

- **代码基线**：`7f3208ef7749a5814d54cc629f1814f380d45ece` 加工作区；仓库其他 WIP 保留，不描述为 clean checkout。
- **改动文件**：`scripts/lib/test_env.mjs`、`scripts/lib/test_env_scope.test.mjs`。复用既有 scope owner、owner marker 与 `reapOrphanScopes`，未新建并行 owner/清理框架，也未改产品代码、driver 或页面。
- **整改后源码指纹**：`scripts/lib/test_env.mjs` = `f63ccd43d6d8e0169adbc3fa90eb00633d1af5c8eeab98731a1e339b0b76d308`；`scripts/lib/test_env_scope.test.mjs` = `87139a82d28811af7dcf08804ad41286abd2769ae71f58e0fabd09b3999baa7a`。后续源码变化时按函数名重新定位，不机械使用 §11 行号。
- **平台范围**：沿用作者 macOS 验收边界；Windows/Linux 不在本次范围。

### 12.2 实现变化

1. **登记格式带启动意图**。`createRunScope` 在创建时写入 journal 头部（`ai-novel-test-run-children` v2）。`spawnScoped` 在真实 `spawn` 之前写 `spawn_intent`，子进程启动成功后写 `spawn_registered`（pid/pgid）；启动失败写 `spawn_failed` 闭合意图。意图先落盘，消除“子进程已启动，但 journal 看起来仍完整”的窗口。
2. **恢复判定区分状态**。`scopeChildrenState` 返回 `complete | missing | empty | unreadable | corrupt | legacy | incomplete` 与 `live`；只有 `complete`（所有意图已闭合、登记身份完整、无活子进程）可自动获得归档资格。损坏尾行、非法 JSON、缺身份、未配对登记、旧格式与未闭合意图都不能自动归档。
3. **失败不静默保留归档资格**。`spawn_intent` 写入失败时拒绝启动（fail closed）；`spawn_registered` 写入失败时保留未闭合意图，并向 stderr 输出诊断，恢复阶段提示该 scope 将保留现场。
4. **reap 可审计原因**。保留现场时输出 `children_unverifiable`（缺失/空/不可读）、`children_corrupt`、`children_legacy`、`children_incomplete` 与 `children_state`/`detail`/`open_intents`；`--allow-unverified-children` 仍作为显式人工处置入口。

### 12.3 §11.3 两条遗留路径的修前／修后

| 反例 | §11.3 修前（静态结论） | 本轮修后（运行回归） |
|---|---|---|
| 空 journal 文件 | 无条件 `verified: true`，可归档 | 保留现场：`children_unverifiable` + `children_state=empty` |
| 截断/半行 JSON | 损坏行被忽略，仍可 verified | 保留现场：`children_corrupt` + `detail=unterminated_line` |
| `{}` 缺身份字段 | 不算活进程，仍可 verified | 保留现场：`children_corrupt` + `detail=registered_identity_missing` |
| 未配对登记 | 无此判定，仍可 verified | 保留现场：`children_corrupt` + `detail=unpaired_registration` |
| 旧格式 journal（无头部/意图） | 按完整登记处理 | 保留现场：`children_legacy`（无法排除启动/登记窗口） |
| 已有完整登记后追加失败 | 旧 journal 仍完整，活 payload 不可见 | 保留现场：`children_incomplete` + 1 个 open intent；终止该 payload 后仍不自动归档，显式允许才归档 |
| 启动意图写入失败 | 旧实现无此路径 | `runInScope` 返回失败，payload 未启动；journal 无 `spawn_intent` 残留 |
| 启动失败（命令不存在） | 旧实现无此记录 | `spawn_failed` 闭合意图，登记仍完整；可正常归档 |
| 静默 env-only payload（真实登记） | 若手工写入正确 journal 才可识别 | 真实 `spawnScoped` 登记后保留 `live_children`；终止后归档 |
| 真实启动链正常结束 | 未覆盖真实登记链 | 完整 `spawn_intent` + `spawn_registered`，owner 失联且过期后可归档 |

上表修前列是 §11.3 的静态判断，本轮没有回跑旧实现；修后列是本轮新增/改写回归的实际断言。没有把任一静态结论写成新的运行故障复现。

### 12.4 回归命令与实际计数

```bash
/usr/bin/env -u NOVEL_TEST_RUN_DIR -u NOVEL_TEST_ENTRY_SCOPED \
  PATH=/Users/loong/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  bash scripts/node_test.sh --self scripts/lib/test_env_scope.test.mjs
```

- **scope 全套：70/70 通过**，exit 0，duration ≈ 13.8s。原 65 项全部保留（其中 2 项手工空 journal 改为合法完整头部，1 项静默 payload 改为真实启动链），新增 5 项：真实启动链可归档、intent 失败拒绝启动、登记失败保留 incomplete、启动失败闭合意图、空/损坏/旧格式/未闭合/未配对状态族。
- **定向子集：9/9 通过**（`node --test --test-name-pattern='reap|spawnScoped'`），用于快速定位。
- **`node --test scripts/lib/test_env.test.mjs`：15/16**。唯一失败“工程入口借用已有父 scope”是既有基线问题：测试构造的 parent owner 进程已退出，与 `borrowRunScope` 要求 owner 存活的规则冲突。用 HEAD `7f3208ef` 的独立 worktree 复跑得到同样 15/16，该项不是本轮 REV-01 改动引入；本轮未顺手扩大范围修改它。

### 12.5 证据分层与限制

- 本轮证据是 **Node 机制/回归级**：真实 `spawnScoped`、真实子进程、真实文件系统与 `reapOrphanScopes`；不是产品页面、真实模型、Tauri 或完整 Mix/Cargo 验收。
- 失败注入只作用于本用例自有的 scope/子进程/`fs.appendFileSync`，测试用 `t.after`/`trackPid` 兜底结束 payload 并回收 scratch；未做全局 reap、未触碰历史作者资料或产品数据库。
- 回归未证明自然运行中的发生频率；“旧格式默认保留”是保守恢复策略，不是产品行为变化。
- 本批改动本地提交后未 push；B84 仍不据此签收。

### 12.6 关闭判断与剩余缺口

- 按 §11.3 的四条关闭条件：完整/未完成/不可验证已区分；启动意图、登记完成与失败闭合参与恢复判断；真实启动链回归覆盖正常归档、静默 payload、旧 journal 后追加失败、登记中断、损坏尾行与未知状态保留；测试资源有独立兜底。**REV-01 的整改与局部回归已闭环，待独立复核确认。**
- **行为变化提示**：无头部/空/损坏的旧 scope 不会再被自动归档；需要人工确认后用 `reap --allow-unverified-children` 或删除。这是为避免把无法证明已结束的活 payload 移走。
- 仍开放：REV-02 的当前 run 绑定、ProviderRun 数量/purpose 契约与真实页面；REV-05 回归失败兜底与确定性时序；REV-04 精确竞争回归固化；REV-03/06 保留既有修复；Rust `TempDir::drop` 静态观察。B84 保持 `doing`，由复核者按 §11 剩余关闭条件继续验证。

## 13. REV-01 第二轮整改独立复核

> 复核日期：2026-11-14。本节独立核对 §12，保存当前基线的运行证据、剩余缺口和处理条件；执行状态继续只维护在 [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)。

### 13.1 结论、基线与认可的进展

**REV-01 仍开放（P1）。** scope 70/70 已独立复跑通过，但另两条真实公共启动链反例仍会把活进程使用的 scope 归档；新增 Node 回归还存在一个 P2 级早期失败收尾缺口。§12 的“整改与局部回归已闭环”不能直接作为关闭结论。

- **当前基线**：`fc8aecf43513f8a5fa24f5509a7fe679a9a197de`，实现提交 `245fdc67319ea235e3d5282e5fcc70553c25b3dc`。本版实际只整改 REV-01；其余 finding 没有新实现变化。
- **源码稳定性**：探针前后核对 11 份被审实现/测试/调用方指纹均未漂移，并与当前 HEAD 一致；其中 9 份与 §11 基线相同。仓库仍有其他 WIP，不描述为 clean checkout。
- **关键指纹**：`scripts/lib/test_env.mjs` SHA-256 为 `f63ccd43d6d8e0169adbc3fa90eb00633d1af5c8eeab98731a1e339b0b76d308`；`scripts/lib/test_env_scope.test.mjs` 为 `87139a82d28811af7dcf08804ad41286abd2769ae71f58e0fabd09b3999baa7a`。
- **已认可**：v2 journal 对空/截断/非法/旧格式/未配对/未闭合状态的保守处理、owned spawn 前先登记 intent、intent 写入失败拒绝启动、登记追加失败保留 incomplete，以及静默 payload 改走真实启动链。这些进展不因新反例而被抹去。
- **平台范围**：macOS；沿用 A5 已验事实，Windows/Linux 不列为补验项。

### 13.2 本轮实际运行与证据层级

| 验证 | 实际结果 | 能证明及不能证明的范围 |
|---|---|---|
| 现有 scope 自检 | **70 tests / 70 pass / 0 fail**，exit 0，14,252.18675ms；Job `wc_job_jPDSFtK7wsF8fxpI` | 当前源码下现有套件通过，不代表覆盖下面的新反例 |
| 必要 PGID 缺失 | 真实 journal 为 root PID + `pgid:null`；owner/root 已退出、同组后代仍活，`reaped=1, kept=0`；后代恢复写入并重建原 scope | 受控 PGID 查询失败下的实际公共启动链机制缺陷，见 §13.3；不证明自然发生频率 |
| 外部借用与 header-only journal | 无 journal/marker 伪造；owner 已死、borrower/payload 均活，`reaped=1, kept=[]`；原目录移走后又由 payload 重建 | 已支持的外部 borrowed 调用路径未被登记覆盖，见 §13.4；不等同于标准受控父组内嵌套必然有问题 |
| 新增回归的 PID 观察早期失败 | 原测试用例在 5s 等待失败后，9.020s 时 suite/payload 仍活；外部终止 payload 后才退出 1，并报告原始 5000ms 超时 | 测试失败收尾缺口，见 §13.5；这个 exit 1 是故障注入结果，不是普通 70 项自检失败 |

独立自检使用原入口：

```bash
/usr/bin/env -u NOVEL_TEST_RUN_DIR -u NOVEL_TEST_ENTRY_SCOPED \
  PATH=/Users/loong/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  bash scripts/node_test.sh --self scripts/lib/test_env_scope.test.mjs
```

后面三个探针均为同步工具执行，没有工具生成的 Job ID。两个恢复探针中的 runId 是被测 scope 身份，不是 Runner Job ID；诊断程序 exit 0 仅说明观察和自身收尾完成，不表示被测恢复正确。

### 13.3 P1：必要 PGID 缺失仍被判为完整登记

**代码链路。** [test_env.mjs](../scripts/lib/test_env.mjs) 的 `processGroupId`（254–261 行）查询失败返回 null；`registerScopeChild`（291–304 行）仍写入 `spawn_registered`。但 `scopeEntryIdentity`（339–343 行）只要求 PID/PGID 至少一个有效，415–421 行便可闭合 intent，最终 441 行返回 complete。恢复时 `liveChildren`（346–353 行）没有 PGID 就只检查 root PID；root 已退出、同组后代仍活时会漏掉后代，530 行继续归档。

**一次实际复现。** scope runId `83c9f5d394157c97`。真实 `openTestRunScope → runInScope → spawnScoped` 创建 owned detached 组；仅在 creator 进程中将 `ps -o pgid= -p <root_pid>` 查询注入为失败，登记/文件系统/归档均使用原实现，恢复及外部观察使用正常 ps。真实 journal 记录 `pid=17579, pgid=null`；外部 ps 同时确认 root 17579 与后代 17580 的 PGID 都是 17579。

SIGKILL owner 17578 并确认退出后，令 root 正常退出，保留同组静默后代。恢复前后均观测到后代为活进程（PPID 1、PGID 17579）；恢复结果为：

```json
{
  "owner_alive": false,
  "root_alive": false,
  "payload_alive_at_reap": true,
  "registered_pgid": null,
  "reaped_count": 1,
  "kept_count": 0,
  "original_scope_exists_after_reap": false,
  "scope_recreated_after_payload_write": true,
  "owner_marker_exists_after_recreation": false
}
```

归档后用 payload 已注册的 SIGUSR2 handler 根据继承的 TMPDIR 写入，实际重建原路径；marker 检查使用正确名称 `.novel-test-run-owner.json`。为避免等待年龄窗口，探针仅对自有 base 使用 `olderThanMs: 0`；结论是达到恢复年龄后该身份缺口会误归档，不是默认一小时阈值会立即触发。正常完成时的 `finalizeOnce` 能收整组，但 owner 在其执行前失联正是本次恢复契约必须覆盖的情况。

**关闭要求。** 可靠保留 owned POSIX detached 子进程已建立的组身份；必要身份无法确认时默认不可验证，不能把“intent 已闭合”当成“身份充分”。在现有回归中加入真实启动、PGID 查询失败、root 退出而同组静默后代存活的反例。

### 13.4 P1：外部 borrowed 启动绕过登记，header-only 被误判为完整

**当前接口已允许这种调用。** [test_env_scope.test.mjs](../scripts/lib/test_env_scope.test.mjs) 846–855 行先由 `openTestRunScope` 创建 scope，再另起 CLI 进程、仅通过 `NOVEL_TEST_RUN_DIR` 借用，没有先把它登记到 owned 进程组。[test_env.mjs](../scripts/lib/test_env.mjs) 的 `borrowRunScope`（169–185 行）只检查目录/marker/owner 存活；268 行对 borrowed 直接跳过 intent，291–292 行随之跳过子进程登记。566–570 行创建的 header-only journal 却会在 406–441 行得到 complete。

**一次实际复现。** scope runId `38b58ecfada5bc5e`。独立 owner 16757 创建真实 scope；独立 borrower 16758 在 owner 尚活时经环境借用并调用 `runInScope`，启动同组 payload 16759（PGID 16758）。journal 真实内容始终只有一行 v2 header，没有手工重写 journal 或 marker，也没有替换 ps/lsof/文件 API。

确认 owner 被 SIGKILL 并 wait 到退出 -9 后，只将自有 scope 全树 mtime 置旧 120s，执行 `reapOrphanScopes({baseDir, olderThanMs: 60000})`：

```json
{
  "journal_line_count": 1,
  "owner_exit": -9,
  "borrower_alive_after_reap": true,
  "payload_alive_before_reap": true,
  "payload_alive_after_reap": true,
  "reaped_count": 1,
  "kept": [],
  "original_scope_exists_before_wake": false,
  "original_scope_recreated": true,
  "payload_resumed_write": true
}
```

归档后的 journal 字节与归档前一致。随后触发 payload 在 ready 前已安装的 SIGUSR1 handler，它只根据继承 TMPDIR 建目录并写 `after-reap.txt`；结果文件证实原路径已重建。此反例只覆盖外部 borrowed 拓扑，不把正常的已登记父组内嵌套一起判错。

**关闭要求。** 外部借用必须能够证明属于哪个已登记进程组，或由现有 owner 协议持久覆盖其借用/子进程生命周期；无法证明时保留现场或拒绝该启动。应区分“真实零子进程”与“有借用子进程但完全未登记”，不能仅禁用所有 header-only scope 来掩盖缺口。

### 13.5 P2：新增 Node 回归在取得 PID 前失败时不能可靠收尾

**代码与范围。** [test_env_scope.test.mjs](../scripts/lib/test_env_scope.test.mjs) 的静默 payload 用例（3156–3170 行）先启动长期进程，`payloadPid` 初始为 0；等待 PID 文件成功之后才赋值。若 3168 行等待失败，3158 行已登记的 after 跳过 kill，却在 3166 行 `await running`。调用只传 stdio，没有 timeoutMs；[test_env.mjs](../scripts/lib/test_env.mjs) 768–773、879–903 行也没有默认期限。

**真实测试文件定向验证。** 通过原 `node_test.sh --self` 运行该单一用例，使用外部 preload 仅令该用例 PID 文件的 `fs.existsSync` 暂时不可见，模拟“payload 已启动、PID 尚不可观察”。测试文件及被测实现均未改。Python 外层通过真实文件系统已读到 payload PID/PGID 16869，确认文件实际存在、进程在独立组内。

```json
{
  "injection_seen": true,
  "pid_file_actually_created": true,
  "elapsed_at_observation_ms": 9020,
  "suite_alive_at_observation": true,
  "payload_alive_at_observation": true,
  "exit_after_external_payload_stop": 1,
  "scope_original_timeout_reported": true
}
```

5s 的等待失败没有让 case 完成；到 9.020s 仍挂在收尾，只有探针外层终止 payload 后，才报告原始“等待条件超时（5000ms）”并退出 1。该外层兜底不能计作被测用例正常收尾。

**同类静态遗漏。** 新增“旧登记后追加失败”用例（3333–3349 行）也在等待成功后才登记 trackPid/after；3336 行失败时 finally 只恢复 `fs.appendFileSync`，尚未登记 payload 归还。此第二条仅做静态确认，未另跑故障注入。两处 fs.appendFileSync 注入本身均按本例 journalPath 过滤并在 finally 恢复，当前没有证据把它另判为并行污染。

**关闭要求。** 在读取 PID 文件之前就建立可终止、等待有界的资源归属，覆盖“启动成功但 PID 发布迟到/不可见”的失败分支；复用已有 runner/清理 helper，不只在取得 PID 后才登记。新增定向失败回归必须证明本例资源退出、其他 owner 不受影响。该缺口属于 REV-01 新增回归及 §11.3 第 4 条关闭条件，不替代原 REV-05 留项。

### 13.6 清理事实与证据口径

- PGID 探针只终止已核实的本次 PID/PGID，直接 owner 已关闭，root/payload/owned group 均无活进程，专有 temp 已删除。
- borrowed 探针只终止经 argv 与 PGID 确认的自有 payload；borrower 随后自然退出 0，owner 已 wait 到 -9，专有 temp 已删除。没有全局按名称杀进程或全局 reap。
- Node 用例探针的直接 suite 已回收，payload 不再是活进程，自有 temp 已删除。探针残留由外层清理，不计作被测清理成功。
- borrowed 探针原始输出有一个误查 `.novel-test-run.json` 的 marker 布尔字段，**已剔除、不采信**。本节只用其目录移动、活进程和恢复写入的直接事实；正确 owner marker 缺失的直接测量来自 §13.3。
- Node 探针首次仅从 stderr 取注入标记，遗漏了测试 runner 转发到 stdout 的记录；修正为合并观察后再执行得到 §13.5 的有效记录，未改 SUT。两个执行均完成自身资源收尾。
- 本轮未执行完整 Mix/Cargo、真实模型或产品页面，也未重跑 §12 的 `test_env.test.mjs` 15/16 及其旧 worktree 对照；后者保留为实施者证据，不据此新增或消除 finding。

### 13.7 其余状态与下一步

| 项目 | 本轮结论 |
|---|---|
| REV-01 | **继续开放**：保留 v2 登记与 70/70 的进展，处理 §13.3/13.4 两条实测误归档和 §13.5 回归收尾 |
| REV-02 | 本版未处理；当前 run 绑定、数量/purpose 契约与真实页面仍按 §11.4 开放，未重复执行同一谓词或页面 |
| REV-03/06 | 相关源码无变化，沿用 §11 对具体实现修复的认可；本轮未复跑各自局部证据 |
| REV-04 | `awaitFixtureOwner` 1488–1496 行仍保留退出后复查发布事实；沿用 §9.5 原缺陷通过，精确竞争回归本版未入库 |
| REV-05 | helper/ExUnit 源码无变化；实现修复进展保留，失败兜底与 shutdown 消息屏障仍待补 |
| 其他 | Rust 静态观察及 B84 原有债务继续承接，完整 B84 保持 doing |

处理顺序为：先补 REV-01 的必要身份与外部借用覆盖，再补新增回归早期失败收尾；随后按原任务处理 REV-02/05/04。使用当前复现条件与原不变量验证，不通过改低判据、跳过测试或全局清理获取通过。报告 §1–12 保留历史，只追加复核提示；本次写回报告、任务当前状态与索引，实施代码交由后续处理人。

## 14. REV-05 与 REV-04 整改结果（2026-11-14）

> **后续独立复核：**[§16](#16-rev-05-与-rev-04-整改独立复核)已确认 REV-04 可关闭；REV-05 正常回归通过，但 helper 内首次 ready 断言失败时清理尚未登记，继续开放。以下保留实施者原始记录。

> 本节由整改实施者按 §13.7 的 REV-05/REV-04 待补项追加；§13 对 REV-01 的开放结论、§13.3–13.5 的新缺口保持不变。执行状态仍只维护在 [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)。

### 14.1 基线与改动面

- **代码基线**：`fc8aecf43513f8a5fa24f5509a7fe679a9a197de` 加工作区；仓库其他 WIP 保留，不描述为 clean checkout。
- **本轮只处理**：§13.7 列出的 REV-05 测试治理与 REV-04 精确回归固化。REV-01 的 §13.3/13.4/13.5、REV-02、REV-03/06 源码、driver、产品页面均未改动。
- **改动文件**：`apps/novel_application/test/novel_application/agent_run_cleanup_test.exs`、`scripts/lib/test_env_scope.test.mjs`。没有改 `agent_run_cleanup_helper.exs`、`test_env.mjs` 或产品代码。
- **整改后源码指纹**：`agent_run_cleanup_test.exs` = `8f8ff02eddd6d92cfbbb1a610bf53b80f77416e5489c1cdb3c0a5b8939245688`；`test_env_scope.test.mjs` = `a37437c1d1204dcb08f31452459158859776e736cd91166bbe985aaeb7af5fb0`。`test_env.mjs` 保持 §13 的 `f63ccd43…308`。

### 14.2 REV-05：资源创建即登记兜底，shutdown 用回执代替 sleep

1. **资源兜底**。新增 `track_blocked_shutdown/1` 与 `track_task/1`：blocker/owned task 一旦创建就登记 `on_exit`，测试体末尾的显式 kill/await 不再是唯一收尾。blocker 由 `on_exit` 杀死并等到 `:DOWN`；`Task.async` 的 stopper 链接在测试进程上，随测试进程退出，`on_exit` 不再跨 owner 调 `Task.shutdown`。
2. **确定性屏障**。新增 `start_blocked_shutdown/2`：blocker `trap_exit` 后先回执 `{:blocker_ready, pid}`，收到 Supervisor 的 `{:EXIT, …}` 后再回执 `{:blocker_shutdown_received, pid}`。三个共享 Supervisor 用例改为等该回执后进入被测 cleanup，删除三处 `Process.sleep(20)`。
3. **失败退出验证**。临时探针测试体在创建真实 `BackgroundTaskSupervisor` task 后 `flunk`，`on_exit` 仍执行并杀掉该 task，marker 为 `killed_by_on_exit`；`mix test` 输出 `1 test, 1 failure`，非零退出。探针文件跑完即删除，不作为入库回归或验收资产。
4. **入库结构回归**。新增“清理兜底不依赖断言后的显式 tail cleanup”：测试体故意不做尾部清理，由 `on_exit` 逆序先执行兜底、后执行最终 observer 断言资源已死；覆盖“尾部显式清理被跳过”的结构缺口。
5. **其他 owner 保护**沿用既有覆盖：`release_run stops only…`、`release_task_caller collects a dead caller's tasks and leaves other owners alone` 等继续通过；本轮没有用新 helper 改变被测 cleanup 语义。

**实际计数**：`MIX_ENV=test mix test apps/novel_application/test/novel_application/agent_run_cleanup_test.exs` → **16/16**（原 15 + 1 兜底结构测试），零 warning；`MIX_ENV=test mix compile --warnings-as-errors` 通过。证据层级仍是 helper/OTP 生命周期回归，不是产品 AgentRun 整链或页面验收。

### 14.3 REV-04：精确发布-退出竞争已入库

新增 `writePublicationRaceHarness` 与双进程测试，重放 §9.5 的精确时序：

1. owner 子进程取得 claim，preload 在首个 payload 写入前停住并写“已开始构建”标记。
2. waiter 子进程经环境借用同一 scope；进入 `awaitFixtureOwner` 后，preload 在对 owner PID 的 `process.kill(pid, 0)` 存活判断前停住并写“到达检查点”标记。此时 owner 尚未发布，waiter 已读过“未发布”。
3. 测试进程按文件屏障先放行 owner；owner 完成原子发布并正常退出（exit 0）。
4. 再放行 waiter；waiter 的存活判断发现 owner 已退出，按 `awaitFixtureOwner` 的最终事实复查复用已发布模板。

断言：waiter `accepted=true`、与 owner 同一 `dir`、`alpha.txt` 字节为 `alpha\n`、无 staging 或 waiter 重建副本。定向测试 **1/1** 通过；完整 scope 套件 **71/71**（原 70 + 1），exit 0，14.4s。该时序因此不再只依赖外部探针，已固化为仓库回归。

### 14.4 证据分层与限制

- 本轮是 **Node 双进程 / OTP 生命周期机制级**证据；不是真实页面、真实模型、Tauri 或完整 Mix/Cargo 验收。
- 失败退出探针是临时受控证据，已删除；仓库内保留的是结构回归（on_exit 兜底 + 最终 observer），不是“故意让入库用例失败”。
- 未改 `test_env.mjs` 与 cleanup helper 实现；§13.5 指出的静默 payload 用例“取得 PID 前失败”的 P2 收尾缺口仍在本轮范围之外，仍开放。
- `test_env.test.mjs` 的 15/16 既有失败未修，保留为既有问题，不并入本轮关闭结论。
- macOS 范围；改动本地提交后未 push；B84 不据此签收。

### 14.5 关闭判断与剩余

- **REV-04**：§9.5 原缺陷通过，本轮精确时序回归已入库；可关闭，待独立复核确认。
- **REV-05**：资源兜底、确定性屏障、失败退出探针与入库结构回归均已落实；关闭条件满足，待独立复核确认。
- **仍开放**：REV-01（§13.3 必要 PGID 缺失、§13.4 外部 borrowed 未登记、§13.5 静默 payload 回归早期失败收尾）；REV-02（当前 run 绑定、数量/purpose 契约、真实页面）；REV-03/06 保留既有源码修复；Rust `TempDir::drop` 静态观察。B84 保持 `doing`。

## 15. REV-01 复核缺口整改结果（2026-11-14）

> 本节由整改实施者按 §13.3/13.4/13.5 追加，回应 REV-01 独立复核的三条开放项；§13 的修复前反例与判断保留。执行状态仍只维护在 [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)。

### 15.1 基线与改动面

- **代码基线**：`fc8aecf43513f8a5fa24f5509a7fe679a9a197de`（§13 复核基线）之后的 `4112ecb7` 加工作区；仓库其他 WIP 保留。
- **改动文件**：`scripts/lib/test_env.mjs`、`scripts/lib/test_env_scope.test.mjs`、`scripts/lib/README.md`。未改 cleanup helper、产品代码、driver 或页面。
- **整改后指纹**：`test_env.mjs` = `524252491a0c1793c07b95bd3a467d07ad355e15fb5afa7e6d06a3c6ae8825a5`；`test_env_scope.test.mjs` = `371da645f8d571f827feadd7ec890d260a2623ef5edcbaad4cb336414fc4388a`。

### 15.2 §13.3：必要 PGID 缺失改为回退 detached 组事实

- **实现**：owned 子进程在 POSIX 上 `detached` 启动（`setsid`），其真实进程组身份等于 PID。`registerScopeChild` 仍优先使用 `ps -o pgid=` 的查询值；查询失败时回退到 `child.pid`，并记录 `pgid_source="detached_pid"`。`spawn_registered` 增加 `group: "owned" | "shared"`：owned 条目必须同时有有效 PID 与 PGID，shared 条目只按 PID 判活。只有 PID、PGID 为 null 的 owned 条目被视为 `registered_identity_missing`，不再闭合为 complete。
- **真实回归**：新增 fake `ps` 只让 `-o pgid=` 失败；真实 CLI owner 创建 scope、root 启动同组静默后代，测试 SIGKILL owner 后让 root 正常退出。journal 记录 `pid=rootPid, pgid=rootPid, pgid_source=detached_pid`；恢复结果为 `live_children`、scope 保留；后代结束后才归档。这对应 §13.3 的“root 退出而同组静默后代存活”关闭条件。
- **边界**：PGID 查询成功时仍以查询值为准；只有查询失败且平台为非 win32 的 owned detached 路径才回退。win32 不在本次验收范围，缺失 PGID 会保守保留现场。

### 15.3 §13.4：外部借用登记生命周期与 shared 子进程

- **实现**：`borrowRunScope` 在验证 owner 存活后写 `borrow_attached`（borrower pid）；借用方 `scope.close()` 写 `borrow_released`。写入失败时拒绝借用（fail closed），避免 owner 失联后无法判断借用方是否仍在。borrowed scope 的 `spawnScoped` 也写 `spawn_intent`/`spawn_registered`，条目为 `group:"shared"`、只以 PID 判活。
- **恢复判据**：`scopeChildrenState` 解析 attach/release；未闭合借用使状态为 `incomplete`（附 `open_borrows`），借用方 PID 活着也进入 `live` 证据；释放后若 shared 子进程已结束才为 complete。header-only 且无任何借用/子进程的 scope 仍是真实零子进程，可归档，没有用“禁用所有 header-only”掩盖缺口。
- **真实回归**：独立 owner 创建 scope；独立 borrower 经 `NOVEL_TEST_RUN_DIR` 借用并启动长驻 payload；owner 被 SIGKILL 后，journal 有 attach + shared registered，恢复为 `live_children`、scope 保留。borrower 正常 `close()` 写 release、payload 结束后再恢复才归档。另有合成回归覆盖 attach/release 完整时可归档。

### 15.4 §13.5：在取得 PID 文件之前建立可终止归属

- **实现**：`runInScope` 新增 `onSpawn(child)`，在 spawn 成功、任何等待/PID 文件可见之前同步回调；回调抛错时终止已启动子进程并按启动失败返回。静默 payload 与“旧登记后追加失败”两个用例改为在 `onSpawn` 中立即取得 PID 并登记 `trackPid`/`t.after`，不再等 payload 写出的 PID 文件。
- **定向验证**：临时 preload 令该用例的 `reap-real-silent.pid` 的 `fs.existsSync` 始终不可见，再运行单一用例。结果为 exit 1、**5s** 报告原始等待超时、`payload_left=0`；修复前 §13.5 的记录是 9.020s 仍挂住、需外部终止。探针临时文件已删除，不入库。
- **保留的边界**：`fs.appendFileSync` 注入仍只对本次 journalPath 且在 finally 恢复；失败用例的资源由 `onSpawn` 登记后回收。`test_env.test.mjs` 的 15/16 既有失败仍未修，不并入本轮。

### 15.5 计数、证据层级与剩余

- **scope 全套**：**74/74 通过**，exit 0，15.149s；受影响子集 **7/7**。新增 3 项：PGID 回退真实反例、外部借用真实反例、借用 release 完整合成回归；状态族扩展了 missing-pgid/open-borrow/unpaired-borrow-release。
- **test_env.test.mjs**：仍 **15/16**，唯一失败与 HEAD 基线相同（借用测试的 parent owner 已退出），本轮未扩大范围修复。
- **证据层级**：Node 机制/回归级，使用真实子进程、进程组与文件系统；不是真实页面、模型、Tauri 或完整 Mix/Cargo。PGID/借用反例只终止已核实的本次 PID/组，探针临时文件已清理。
- **关闭判断**：§13.3、§13.4、§13.5 的关闭条件已由实现与回归覆盖，待独立复核确认。REV-02 仍开放；REV-03/06 沿用既有源码修复；Rust `TempDir::drop` 静态观察保留。B84 保持 `doing`。

## 16. REV-05 与 REV-04 整改独立复核

> 本节响应作者“REV-05/REV-04 已修”，复核 §14 的实施声明。**REV-04 可关闭；REV-05 仍留一个 P2 早期失败清理窗口。** 本节只更新本轮复核结论，执行状态继续由 [B84 原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)维护。

### 16.1 版本与证据范围

- **整改提交**：`fd40df2539634eafa624d9e6e853e2c22e24bca6`；报告提交／本轮开始 HEAD 为 `4112ecb7cf2c7bb5ec4e86f6634bcc9eaa56e49b`。只审 REV-04/05 的新增测试治理；原 cleanup helper 与 fixture 实现修复不被重新描述为未修。
- **并行工作区变化**：复核期间另有 REV-01 工作修改 `test_env.mjs` 与 scope 测试，不能把本轮结果写成整个当前工作区的 clean HEAD 验收。REV-04 使用 `git show 4112ecb7:<path>` 得到的固定临时镜像；REV-05 的目标测试/helper 在执行前后指纹不变，scope 包装入口则明确使用当时的 WIP 版本。并行 REV-01 改动不在本节签收，§13 保留为上一轮固定版本的证据。
- **平台**：macOS；REV-04 实测环境为 macOS 26.6.2 / arm64 / Node 24.19.0。A5 macOS 已验的裁决继续有效，Windows/Linux 不作为缺项。
- **本轮行为**：独立定向验证、隔离对照及报告写回；没有修改仓库实现或正式测试，没有 commit/push，没有真实页面、真实模型或全量 Mix/Cargo 验收。

| 本轮独立执行 | 实际结果 | 结论边界 |
|---|---|---|
| REV-04：提交版本的精确发布竞争用例 | 1 PASS / 0 FAIL，exit 0，外层耗时 194ms | 精确目标时序通过 |
| REV-04：仅删除二次 outcome 读取的旧逻辑对照 | 0 PASS / 1 FAIL，exit 1，外层耗时 186ms | 预期失败，证明新用例能捕获原缺陷；不计当前实现失败 |
| REV-05：现有 cleanup 定向套件 | 16 tests / 0 failures，ExUnit 0.5s，scope exit 0 | 正常路径与已有边界回归通过 |
| REV-05：ready 断言前的定向失败探针 | 1 test / 1 failure，exit 2；用例结束后 blocker 仍活 | 预期注入失败，同时确认兜底尚未登记的窗口 |

§14 的 scope **71/71** 与 compile 通过保留为实施者证据；本轮未重跑完整 scope 套件或 compile，不将这些数字改标为本轮独立运行结果。

### 16.2 REV-04：精确回归能捕获旧缺陷，可关闭

已核对 [scope 测试](../scripts/lib/test_env_scope.test.mjs) 在提交 `4112ecb7` 的 1244–1270、1373–1393 行，以及 [awaitFixtureOwner](../scripts/lib/test_env.mjs) 的 1488–1496 行：

1. owner 取得 claim，在首次 payload 写入前被测试侧 preload 阻塞。
2. waiter 已经从 `ownerOutcome()` 读到未发布，随后停在对 fixture owner PID 的存活检查之前；父 scope 的 owner PID 与此不同，不会误触发屏障。
3. 测试放行 owner，并等到 owner 真实退出 0，才放行 waiter。
4. waiter 观察 owner 已死后复查最终 outcome，复用同一目录；断言 `alpha.txt` 字节为 `alpha\n`，且没有 staging 或 waiter 重建副本。

两个临时镜像只复制提交内的五个依赖：`scripts/node_test.sh`、`scripts/lib/test_env.sh`、`scripts/lib/test_env.mjs`、`scripts/lib/process_tree.sh`、`scripts/lib/test_env_scope.test.mjs`。均运行既有入口：

```bash
/bin/bash scripts/node_test.sh --self \
  --test-reporter=tap \
  '--test-name-pattern=^发布竞争：' \
  scripts/lib/test_env_scope.test.mjs
```

命令使用 Node 24.19.0 的明确 PATH，移除继承的 run/entry/base scope 变量和 `NODE_OPTIONS`，并把临时目录及测试证据指向各自镜像。旧逻辑对照仅删除 `const finalOutcome = ownerOutcome(request, normalized);` 和紧接的返回语句，测试文件保持提交原样。它在新测试 1382 行的 waiter 退出码断言失败，实际错误为“初始化 owner 已退出且未发布完整模板/failed，本 run 按基础设施失败处理”。错误来自 waiter stderr，经断言进入 TAP stdout；外层命令 stderr 为空。

探针 ID 为 `b47e24ff5f6e482d`，时间 `2026-11-14T15:33:41.838032Z`；该 ID 由外层脚本生成，**不是 scope runId 或 Runner Job ID**。工具同步完成，未返回独立 Job ID。两次运行结束时自有进程组均空，外层未执行杀进程兜底；临时镜像均已删除。

**证据限制。** 本次动态对照只验证成功发布竞争；failed outcome 的统一处理有源码和既有失败用例支撑，本轮未另跑“首次 miss 后发布 failed”的竞争。外层每次设置 20s 总期限；新用例内部有 marker/fixture 等待期限，但两次 `done` 等待没有独立总时限，因此不外推为任意未来挂起都已有测试内建总超时。上述边界不影响本次原发布竞争缺口的关闭。

### 16.3 REV-05：正常回归通过，ready 断言前仍未登记 blocker 清理

**已认可的修复。** [agent_run_cleanup_test.exs](../apps/novel_application/test/novel_application/agent_run_cleanup_test.exs) 已为 owned task 在创建后立即登记 `track_task`（549 行）；三个共享 Supervisor 用例使用 `:blocker_shutdown_received` 回执替代原固定 sleep；ready 成功返回后的 blocker 有 `on_exit` 兜底。新增“跳过显式 tail cleanup”结构测试也通过。现有 helper 的 deadline、逐 Supervisor 收集和超期标记修复继续保留。

独立运行使用明确工具链 PATH、清除继承 scope 后，经统一入口执行：

```bash
node scripts/lib/test_env.mjs run --timeout-ms 120000 -- \
  /usr/bin/env MIX_ENV=test mix test \
  apps/novel_application/test/novel_application/agent_run_cleanup_test.exs
```

实际为 seed `888335`、**16 tests / 0 failures**、ExUnit 0.5s；scope runId `42c4d89dd4765a66`，exit 0、duration 1550ms、`tree_finalized=true`，未见 warning。入口 `test_env.mjs` 是并行 WIP 的 `52425249…25a5`；目标测试、cleanup helper、config 与该入口在这次执行前后均未变化。

**剩余 P2 的精确路径。** 当前测试文件 `start_blocked_shutdown/2` 在 447–460 行创建 blocker，462 行启动 stopper，463 行先执行 `assert_receive {:blocker_ready, ^blocker}, 1_000`，464 行才返回；调用方在 496、515、555、596 行才调用 `track_blocked_shutdown`。因此首次 ready 断言失败时，helper 不返回，清理登记也没有发生。§14 的“blocker 一创建就登记”只覆盖了 ready 成功后的路径，不能据此关闭 §11.5 条件 1。

**定向复现。** 从当前测试源码提取 `start_blocked_shutdown/2` 与 `track_blocked_shutdown/1` 到独立 Elixir/ExUnit 探针；只在原 ready 断言前消费一次 ready 和 shutdown 回执，再执行原断言，强制覆盖该早期失败出口。没有改变资源创建／登记顺序，也没有修改仓库文件。探针同样经 `node scripts/lib/test_env.mjs run --timeout-ms 20000 -- elixir -e <内存 AST 探针>` 执行；同步完成，无独立 Runner Job ID，scope duration 为 1353ms。实际输出：

```json
{
  "scope_run_id": "bd92d00ae05dc8bb",
  "exunit_seed": 535064,
  "tests": 1,
  "failures": 1,
  "exit_code": 2,
  "failed_assertion_source_line": 463,
  "after_test_shutdown_elapsed_ms": 1061,
  "blocker_alive_after_test": true,
  "stopper_alive_after_test": false,
  "after_probe_cleanup": {
    "blocker_alive": false,
    "stopper_alive": false,
    "supervisor_child_count": 0,
    "tree_finalized": true
  }
}
```

此时仍未到 Supervisor 默认 5s shutdown 兜底；事实是**用例失败并完成退出后，本 case 的 blocker 仍活，清理依赖外部 Supervisor 后续超时或探针兜底**，不能写成永久泄漏，也不能把探针最终回收算作测试自身已归还。该探针验证注入的早期失败出口，不表示自然调度发生率，也不是产品 AgentRun 整链证据。

**无效尝试单独归因。** 第一份探针在构造 AST 时误用 prewalk，使替换节点重复展开，未进入 ExUnit；外层 20s 期限终止，Job `wc_job_ZmVmPkF9220JIN2C`、scope `bcee542a499765bd`、exit 124、`tree_finalized=true`。修正为 postwalk 后才得到上面的有效反例。此构造错误不计作项目失败，且未改变仓库源码。

### 16.4 REV-05 剩余关闭条件

1. 在 `start_blocked_shutdown/2` 成功获得 blocker PID 后立即登记其幂等兜底，早于任何等待、断言或可能失败的后续操作；不要把登记留在 helper 成功返回后的调用方。
2. 将 ready 回执作为发起 shutdown 的前置顺序，然后用 shutdown 回执确认进入被测状态。当前 462→463 顺序仍先发起 shutdown 再等 ready；这是源码顺序观察，本轮未测试自然调度发生率。
3. 补本次“首次 ready 断言失败／helper 未返回”的定向验证，确认 ExUnit 用例结束时自有 blocker 已死、共享 Supervisor 可用；保留已登记路径和其他 owner 的既有覆盖。不能仅验证 `track_task` 已执行后的 flunk。
4. 继续区分 SUT 的正常清理、测试自己的 `on_exit` 和最外层探针兜底；只回收本用例资源，不增加平行 owner 框架或扩展为模型／页面批次。

### 16.5 指纹、状态与交接

| 证据输入 | SHA-256 |
|---|---|
| REV-04 固定提交 `test_env.mjs` | `f63ccd43d6d8e0169adbc3fa90eb00633d1af5c8eeab98731a1e339b0b76d308` |
| REV-04 固定提交 scope 测试 | `a37437c1d1204dcb08f31452459158859776e736cd91166bbe985aaeb7af5fb0` |
| REV-04 旧逻辑对照 SUT | `0afa3e496506d0a6ede4793ae7a9b676e64140aeb1b4237e65993434e284a207` |
| REV-05 当前测试 | `8f8ff02eddd6d92cfbbb1a610bf53b80f77416e5489c1cdb3c0a5b8939245688` |
| REV-05 cleanup helper | `3251d1cee678bc491ec75d537e9c659791edaec472be522133a1cf11b4e7e0c7` |
| REV-05 config | `11543a134e0a3850b245fe6cdfc4c56bc228b92f9c5f3001b5e759f6017156ba` |
| REV-05 执行时 scope 入口 WIP | `524252491a0c1793c07b95bd3a467d07ad355e15fb5afa7e6d06a3c6ae8825a5` |

- **REV-04：关闭。** 原实现修复、精确时序入库和本轮旧逻辑对照形成闭环。
- **REV-05：继续开放，仅剩上述测试早期失败窗口。** 16/16、已有资源兜底及 shutdown 回执进展保留，不退回“helper 实现仍无界”的旧判断。
- **REV-01：§15 的第三轮整改待独立复核，尚未关闭。** 已保留并行实施者新增的 PGID 回退、attach/release、onSpawn 与 74/74 记录；本轮未复核这些新增实现，也不把 §13 固定版本的旧反例机械外推为新 WIP 已验证结果。
- **REV-02、REV-03/06 与其他债务**：沿用既有状态和证据边界，不在本轮重签。B84 未取得整体签收；写回时原任务在并行更新中已改为 `deferred`，并记录 B87 提为当前任务及恢复条件。本轮保留该排期，不因局部复核重排或改成 done。
- 本次只写回原报告、B84 状态和报告索引；§1–15 保留历史记录并补充后续复核提示，具体实现继续交后续处理人。
