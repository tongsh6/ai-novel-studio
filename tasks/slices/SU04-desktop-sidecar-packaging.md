# SU04 — 桌面应用后端 sidecar 打包（下载即可用）

落地 `docs/design/tech-stack/05-desktop.md` 的 Tauri + Mix Release sidecar 方案：让 GitHub
release 下载的桌面应用**自带并自动拉起 Phoenix 后端**，而不是只打包前端。

## 背景 / 触发

下载 0.0.1 release 打开后顶栏显示「模型未连接 / 同步离线」。排查发现 release 产物是
**纯前端**：`tauri.conf.json` 无 `externalBin`/sidecar，Rust 不 spawn 后端，`release.yml`
不构建 Mix release。开发态靠 `scripts/dev.sh` 手动起 `mix phx.server`，下载态没有任何东西
起后端，前端连不上 `localhost:4658` → channel offline + health 抛错。

## 开工 6 问

1. **Contract**：前端打包态端点契约（`VITE_API_ENDPOINT`/`VITE_WS_ENDPOINT` = `127.0.0.1:4658`，与
   CSP `connect-src` 一致）；sidecar 启动契约（`NOVEL_DATA_DIR`/`PHOENIX_PORT`/`RELEASE_DISTRIBUTION`）。
2. **Invariant**：下载并打开应用后，后端在用户机上自动可达（channel online）；应用退出时
   sidecar 一并退出，无孤儿进程；DB/日志/secret 落在 OS 用户可写目录，不写只读 bundle。
3. **Boundary**：`mix.exs`(release)、`config/runtime.exs`(打包运行时)、`novel_persistence`(自动迁移)、
   `novel_agent`(去掉 cwd 相对 `log` 目录)、`novel_web`(CORS)、Rust `lib.rs`(spawn/解包/生命周期)、
   `tauri.conf.json`(resources)、`frontend/.env.production`、`scripts/build_sidecar.sh`、`release.yml`。
   不改：对话主链、业务编排、领域逻辑。
4. **Consumer**：下载应用的最终用户；前端 webview（HTTP `/api/*` + Phoenix Channel）。
5. **Proof**：构建 `.app` → `open`（双击等价）冷启动 → 后端在 4658 服务、health 200、webview 调用
   `/api/provider/health` 命中；退出后端随之关闭。
6. **Acceptance Driver**：`bash scripts/build_sidecar.sh` + `pnpm tauri build --bundles app` 后，
   `open` 应用并对 `127.0.0.1:4658/api/provider/health` 探活（见下「验证」）。产品代码无验收感知逻辑。

## 实现要点（as-built，含对设计文档的偏差）

- **后端形态**：用户选「各 OS 原生构建 Mix release」。release 是目录树（非单文件），故**不用
  Tauri `externalBin`**（其要求单文件），改为 `scripts/build_sidecar.sh` 打成
  `resources/sidecar.tar.gz`（单文件、保留权限/可执行位），由 Rust 首启解包到可写数据目录。
  原因：直接把 1700+ 文件、含只读(0555)二进制的目录做成 resource，构建工具拷贝/复写会报权限错。
- **Rust 生命周期**：release 构建（非 debug）在 `setup` 解包 + `bin/sidecar start` 拉起子进程，
  cwd 设为可写数据目录、补全 PATH（GUI 启动 PATH 被精简）、stdout/stderr 落 `<data>/log/sidecar.out`；
  `RunEvent::Exit` 时 kill 子进程。debug（`pnpm tauri dev`）不拉 sidecar，后端仍由 `scripts/dev.sh` 提供。
- **运行时配置**：`config/runtime.exs` 仅在 `config_env()==:prod 且 RELEASE_NAME 存在` 时生效
  （避免影响开发态 `MIX_ENV=prod mix phx.server`），把 DB/日志/secret 指向 `NOVEL_DATA_DIR`、端口设 4658、
  开 `:auto_migrate`。
- **首启自动迁移**：`NovelPersistence.Application` 在 `:auto_migrate` 开启时启动后跑 `Ecto.Migrator`
  （下载态无 `mix ecto.migrate`）。
- **CORS**：`NovelWeb.Plugs.CORSPlug` 放行 `tauri://localhost` / `http(s)://tauri.localhost` / localhost。
- **修掉一个 cwd 相关崩溃根因**：`NovelAgent.Application` 原 `File.mkdir_p!("log")`（cwd 相对）在
  LaunchServices 只读 `/` cwd 下 erofs 崩溃 → 整后端挂。该 mkdir 冗余（LLMLog/LogEmit 各自按绝对路径建目录），已删除。

## 验证（本机 macOS arm64，真实打包应用）

```bash
bash scripts/build_sidecar.sh
cd frontend && pnpm exec tauri build --bundles app
open "frontend/src-tauri/target/release/bundle/macos/AI Novel Studio.app"
curl -s http://127.0.0.1:4658/api/provider/health    # → {"connected":...}
```

- 冷启动（无已解包 runtime）经 `open` → 4s 内后端在 4658 服务，health 200；`sidecar.out` 记录
  webview 的 `GET /api/provider/health → 200`。
- 退出应用后 4658 立即 down（`RunEvent::Exit` 杀子进程，无孤儿）。
- DB/secret/日志落 `~/Library/Application Support/com.ai-novel-studio.app/`（可写），未写 bundle。
- 全量：`mix compile -Werror`、`mix test`、`xref` 无循环、`arch_check`、I1/I2/I3、前端 typecheck/lint
  全绿；`cargo check`/`cargo test` 通过；静态扫描 touched files 0 findings。

## 未闭环 / 后续

- **代码签名 + 公证（P1，需 Apple Developer 证书）**：已加 ad-hoc 签名（`bundle.macOS.signingIdentity="-"`），
  把「已损坏」硬拦截降级为「未验证开发者」（右键→打开即可）。真正「下载双击零提示」仍需 Developer ID
  签名 + 公证（付费证书），属独立后续。
- **Intel Mac**：✅ 已加 `macos-13`(Intel) 矩阵项 → 产出 `..._macos_x64.dmg`；Apple Silicon 为 `..._macos_arm64.dmg`。
  每 arch 各带匹配 ERTS（原生 release 不交叉编译，不做 universal 单包）。
- **首启无 LM Studio**：health 会显示「模型未连接」属预期；用户在设置里配置 DeepSeek 等会经 Tauri
  偏好/密钥回写后端（`loadAndSyncModelProviderState`）恢复。
- **CI 真实验证**：`release.yml` 已加各 OS `setup-beam` + `build_sidecar.sh`；首个 tag 触发的真实
  跑通（尤其 Windows `bin/sidecar.bat`、Linux）需在 CI 上观察确认。

## 现役故障与生命周期契约核对

- 状态：**blocked（2026-10-31 CP0 done；CP1 实现 marker/staging、进程组退出、端口就绪探测、作者可见失败分类；真实 release 打包应用外部故障复验缺 harness，按条件阻塞）**。
- 来源：[桌面设计 §2–§3](../../docs/design/tech-stack/05-desktop.md#3-启动流程) 的就绪/健康检查及优雅退出要求，与本任务 as-built 的 release 解包/spawn/退出流程对账；不机械恢复旧 splash 或示例端口/轮询间隔。
- 已核事实：`frontend/src-tauri/src/lib.rs:991–997` 启动失败只输出错误，`shutdown_sidecar` 直接 kill/wait；`WorkspaceChat.tsx:2079–2107` 已有约 30 次启动连接重试与最终加载失败，不能描述为“没有任何恢复”。自动迁移失败在 `NovelPersistence.Application` 重新抛出；当前证据未覆盖这些失败如何进入作者可操作的恢复链。
- 下一步：核对实际打包启动配置、子进程所有权、解包完成判据、迁移/监听就绪、前端启动状态及退出时序，冻结启动中/就绪/失败/退出的真实来源和最小恢复方式。先明确受影响消费者和七问，不默认新增常驻 watchdog、第二进程管理器或自动重启策略。
- 完整后果：半解包、启动/迁移失败、端口占用、已启动后退出及应用关闭分别有可核的失败类别和处置；不会把无后端冒充已就绪，不误杀非本应用进程，不产生重复 sidecar；退出/恢复遵循当前数据与运行状态边界，不静默重放创作。作者反馈与实际状态同源，失败证据及恢复后果可追溯。
- 证明：外部系统 UI 驱动真实打包应用，在隔离 profile/数据目录准备故障前置，观察窗口/重试或恢复动作，并结合进程、端口、日志及数据校验；正常冷启动、恢复后可用与退出无孤儿均须复验。CI 仅构建包或使用 dummy archive 的 Rust 测试不能代签生命周期；产品不增加验收开关/隐藏钩子。
- 依赖与条件：[B51](B51-tech-stack-current-rebase.md) 校准现役部署表述，[B65](B65-local-http-websocket-origin-boundary.md) 负责 HTTP/WS 来源，[B66](B66-local-workspace-backup-restore.md) 负责尚待冻结的备份恢复；本项不借故障恢复改写作者现有数据。签名、公证、各平台真实 release 的外部条件继续沿上节保留，不阻塞本机契约核对，也不因本机通过宣布跨平台完成。

### CP0 现役生命周期核对（2026-10-31）

| 面 | 现役事实 | 缺口/风险 |
|---|---|---|
| 解包完成判据 | `ensure_sidecar_installed` 先清同版本目录再 `tar -xzf`；成功返回，失败 `Err`；下次仅按 `bin/sidecar` 是否存在判断已安装 | 无安装完成 marker；tar 失败可能留下部分目录，若 bin 已落盘会被误判为已安装；半解包无专门状态 |
| 启动就绪 | `spawn_sidecar` 成功即 `manage(SidecarChild)`；无 HTTP health/ready 轮询；前端 `WorkspaceChat` 约 30 次连接重试后显示加载失败 | 「子进程已 spawn」≠「后端已就绪」；端口占用/迁移失败只体现为连接失败，无分类；作者反馈与实际状态未同源 |
| 迁移/端口失败 | 后端迁移失败在 `NovelPersistence.Application` 重新抛出，sidecar 退出；端口占用时 Phoenix 监听失败退出；stdout/stderr 落 `data/log/sidecar.out` | 失败类别未进入作者可操作恢复链；日志文件需外部查看，页面只有通用离线/加载失败 |
| 退出/孤儿 | `shutdown_sidecar` 只 kill+wait 直接 Child，未建进程组；`on_window_event CloseRequested` 立即 `exit(0)`；`RunEvent::Exit` 再 shutdown | release `bin/sidecar start` 若派生/exec 行为变化，kill 直接子进程可能留孤儿；无退出后孤儿/端口残留自动核验 |
| 恢复边界 | 正常冷启动/退出已有历史证据；本次未新增 watchdog/自动重启 | 不把无后端冒充已就绪；不误杀非本应用进程；不重放创作 |

**CP1 最小计划（不建第二进程管理器）**
1. 解包成功写完成 marker（含版本），仅 marker+bin 同时存在才复用；失败/半解包清理并保留失败证据；
2. 启动就绪用既有后端 health/端口探测（复用现有端点，不新增验收开关），失败分类（解包/迁移/端口/超时）进入作者可见恢复文案；
3. Unix 上以独立进程组启动并在退出时杀组+wait，验证无孤儿/端口残留；
4. 外部系统 UI 驱动真实打包应用：正常冷启动、半解包/坏 archive、端口占用、退出无孤儿分别留证；CI Rust 测试/构建不能代签。

### CP1 实施记录（2026-10-31，partial）

- **解包完成判据**：新增 `.install-complete` marker + bin 同时存在才复用（`sidecar_install_complete`）；解包到同版本 `.staging`，tar 成功后替换正式目录并写 marker；失败只留 staging，不把部分目录当已安装。
- **退出/孤儿**：Unix 启动时 `process_group(0)` 建独立进程组；退出先向组发 TERM，最多等 2s，再 KILL，最后 kill/wait 兜底。
- **测试**：Rust `sidecar_install_requires_marker_and_bin` 通过；`cargo check/test/fmt` 通过。
- **就绪探测（本轮补）**：`spawn_sidecar` 后以 127.0.0.1:4658 TCP 探测等待 15s；成功才视为 ready；提前退出/超时返回分类错误并 kill/wait 回收 Child；Rust 测试覆盖监听/关闭端口。
- **仍缺**：失败分类进入作者可见恢复文案（当前 Rust 仅 eprintln/启动错误，页面仍是通用加载失败）；真实打包应用的外部 UI 故障场景（正常冷启动、坏 archive/半解包、端口占用、退出无孤儿）未复验；不建第二进程管理器/不新增验收开关。

### CP1 实施记录（续，2026-10-31）

- **作者可见失败分类**：`SidecarStatus`（starting/ready/failed）+ `get_sidecar_startup_status` command；打包态启动放到后台线程，避免窗口被 15s 探测阻塞；前端启动最终失败时读取状态，附加「桌面后端仍在启动/启动失败，重启并查看 log/sidecar.out」恢复文案（copy 集中、helper 单测 657/657；非验收 hook）。
- Rust 12/12、`cargo fmt/check/test` 通过。
- **阻塞**：现役 `tauri_slice_verify` native 路径构建的是 **debug app**（`cfg!(debug_assertions)` 不 spawn sidecar），无法复验 release 打包应用的半解包/端口占用/退出无孤儿；注册表也没有 release-app 外部驱动。按预算不启动无 harness 的打包故障重跑。
- 解除条件：预注册 release-app 外部 UI 驱动（隔离 `AI_NOVEL_DESKTOP_PROFILE`/数据目录），分别做正常冷启动、坏 archive/半解包、端口占用、退出无孤儿并留进程/端口/日志/页面证据。

## 可独立推进 release-app 预注册（2026-10-31）

- 状态：todo（父任务整体仍 blocked：缺真实 release 打包应用的外部故障 harness；本小节只做 harness 建设准备）
- 范围：预注册隔离 release-app 外部 UI 驱动（正常冷启动/坏包/端口占用/退出无孤儿），复用既有 native/CUA 驱动基础，不把 debug app 结果冒充 release 证据。
- 验证：预注册文档 + harness 自检；真实 release 复验仍需打包环境，未获得前不标 CP 完成。

### CP1 release-app 外部复验（2026-10-31，partial）

- 状态：doing（外部三场景 PASS；port-conflict 失败分类 PASS 但关窗后 sidecar 残留待 root-cause；父任务整体仍 blocked）

- 预注册：`artifacts/model-contracts/su04-cp1-release/preregistration.json`（四场景/判据/隔离 HOME+profile/预算/fail-fast/失败只读）。
- harness：`scripts/release_app_lifecycle_check.sh`（每个场景独立隔离 HOME 与 `AI_NOVEL_DESKTOP_PROFILE=release-verify`，记录 app.out/进程快照/端口状态/安装树/summary；失败写 failure.json 并只清理本批归属进程）。
- 被测应用：`frontend/src-tauri/target/release/bundle/macos/AI Novel Studio.app`（06:32 构建，含 CP1 三个提交 `986256fc`/`c240e177`/`2b4cd31e`，Resources 含 sidecar.tar.gz）。
- 结果（真实 release 打包应用外部驱动）：
  - **cold-start PASS**：app 启动→sidecar 解包安装 `.install-complete`→4658 就绪；退出后端口释放、无本批进程。证据 `artifacts/slice-verify/su04-release-app/cold-start-20261031T103319Z/`。
  - **exit-no-orphan PASS**：AX 关闭真实窗口（Tauri CloseRequested → RunEvent::Exit → shutdown_sidecar）→ app 退出→无本批 sidecar 进程、端口释放；证据 `exit-no-orphan-20261031T103302Z/`。
  - **bad-archive PASS**：隔离副本替换 sidecar.tar.gz 为坏包→启动失败分类可核、无 `.install-complete`、无伪 ready；证据 `bad-archive-20261031T103347Z/`。
  - **port-conflict FAIL（部分证据成立）**：外部占用 4658 后启动，失败分类可核（`log/sidecar.out` + `erl_crash_dump` 的 `eaddrinuse`），无伪 ready、占用者未被误杀；但 AX 关窗后仍有本批 sidecar 进程残留（pid 28770）→ 不标 PASS，登记 known-gap 待 root-cause（崩溃退出时序或清理逻辑缺口）。失败批次只读保留（`port-conflict-20261031T103324Z/103430Z/103903Z/`）。
- **重要边界（产品待评估）**：外部 `SIGTERM` 强杀 app **不触发** Tauri 事件循环退出清理，会留下 sidecar 孤儿（首轮验证即暴露）；真实作者关窗路径已验证无孤儿。系统注销/崩溃/强杀场景是否应加信号处理，登记为待作者/后续决策的 known-gap，不在本批擅自加 watchdog。
- 日志位置（外部可核）：隔离 HOME 下 `Library/Application Support/com.ai-novel-studio.app/profiles/release-verify/log/sidecar.out` 与 `erl_crash.dump`；Tauri 进程 stderr（app.out）在端口冲突时不写分类（分类在 `SidecarStatus` 内存状态 + 前端恢复文案），因此外部核验以 sidecar 日志/崩溃转储为准。
- 未代签：跨平台（Intel/Windows/Linux）、签名/公证、真实模型语义、I10；port-conflict 清理缺口未修复前 CP1 不标 done。
