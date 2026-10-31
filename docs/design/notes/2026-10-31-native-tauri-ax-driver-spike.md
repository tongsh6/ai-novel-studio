# 原生 Tauri AX 驱动 spike 预注册（2026-10-31）

- 目的：验证 macOS Accessibility（`scripts/lib/native_ui/ax_cua.swift`）能否读取并操作真实 Tauri WKWebView 窗口，从而让 task_done 获得诚实的 `surface=tauri` 证据。
- 范围：仅 b31 已注册原生批次的启动/窗口可读性；不改产品代码、不改验收判据、不写产品事实。
- 预算：单次启动 ≤300s；AX dump ≤60s；总预算 1 个批次；失败同因 ≤2 次。
- 判据：`ax_cua apps` 能看到 AI Novel Studio 进程；`ax_cua dump` 能读到窗口内按钮/输入框等真实语义；`screenshot` 能截到窗口。三者成立 → 可建设 AU12 native driver；任一不成立 → 记录具体能力缺口。
- 证据目录：`artifacts/native-spike/au12-ax-20261031/`（只读保留，不提交）。
- 资源：不加载真实模型；结束确认无遗留进程。

## Spike 结果（2026-10-31，PASS）

- `scripts/lib/native_ui/build.sh` 构建成功；`ax_cua apps` 可见 `AI Novel Studio`（bundle `com.ai-novel-studio.app`）。
- **关键发现**：`ax_cua dump` 只返回 menubar/application（无窗口内容）；`ax_cua dumpall` 返回 `AXWindow → AXScrollArea → AXWebArea` 及真实语义节点：`打开档案`/`发送` 按钮、`AXTextField` 输入框、`阅读`/`记忆`/`全书` 文本等。原生驱动必须用 `dumpall` 读 webview，不能用 `dump`。
- `screenshot` 成功截到真实 Tauri 窗口（含连接状态/作品档案入口）；`debug` 显示 `AXWindows count=1`，但 `windows` 命令返回空，不能用它判窗口存在。
- 结论：**AX 原生驱动可行**；之前 `driver_idle_timeout` 是无外部 driver 消费/登记等待账，而非 AX 能力缺失（本 spike 也未启动 external driver，故 supervisor 最终按 owned process 退出结束）。
- 证据：`artifacts/native-spike/au12-ax-20261031/`（gitignored，只读保留）。
- 后续：实现 `native_au12_drive.mjs`（用 `NativeScenarioHarness` + `dumpall`），登记 native allowlist/evidence，跑 AU12 原生批次后重跑 task_done。
