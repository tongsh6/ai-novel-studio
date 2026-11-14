# B84 实现独立审查报告（2026-11-14）

> 本文件保存本次审查的版本、发现、证据摘要与复验要求，是固定时间点的审查记录。
> B84 的执行状态、整改 checkpoint 与后续签收只维护在[原任务](../tasks/slices/B84-web-slow-tests-and-arch-debt.md)；本报告不建立第二份活动状态台账。

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
