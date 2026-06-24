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
