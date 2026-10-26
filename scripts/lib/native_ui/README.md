# scripts/lib/native_ui/ — 原生 Tauri 窗口外部驱动（验收 harness）

本目录提供**外部系统 UI 驱动**：通过 macOS Accessibility（AX）读取真实 Tauri 窗口的用户可见语义，
并用 AX 动作/CGEvent 输入操作真实窗口。产品代码不读取本目录，也不为此新增任何验收感知逻辑
（见 `docs/engineering/scenario-acceptance.md` 红线）。

## 组成

| 文件 | 角色 |
|---|---|
| `ax_cua.swift` | 单二进制 AX/CGEvent 驱动源：`pid / dump / dumpall / click / clickxy / set / focus / type / key / screenshot / apps / activate / windows / debug`。`dump` 输出窗口树（role/title/description/value/actions/frame），`screenshot` 用 `screencapture -l` 抓窗口。 |
| `build.sh` | 按需编译到 `artifacts/tools/ax_cua`（gitignore 产物；需要 Xcode command line tools 与「辅助功能」权限）。 |
| `driver.mjs` | 高层封装：`dump/findByText/click/typeText/pressKey/screenshot/waitUntil/writeAX/Step`（Step 写 B37 分型等待账 `native-driver-commands.jsonl`）。 |
| `workbench.mjs` | 真实工作台动作：启动应用、等待工作台、初始作品测试数据准备（`markWorkNewest`，仅隔离副本）、发送主输入、打开档案/标签、阅读模式、采集 AX+截图、`native-ui-complete.json` 收尾。 |

## 与既有验收协议的关系

- 启动/监督协议沿用 B37：`scripts/dogfood_run_detached.sh`（`ACCEPTANCE_RUNNER=native-slice`）创建隔离副本、
  编译嵌入式前端原生 app、写 `native-driver-ready.json`；外部驱动登记 `native_ui_wait` 分型等待（begin/finish），
  最后写 `native-ui-complete.json`，runner 调用对应 `native_*_evidence.mjs verify` 核验。
- 证据落点与命名沿用既有 `native_*.ax.txt` / `.png` / `native-transport.jsonl`（app 真实 HTTP/WS 帧）/
  `app-log` / `llm-calls` / 只读 DB 快照；失败批次只读保留。
- 驱动标识：本驱动为 `ax-native-system-ui`（AX 公共 API）；历史 Codex CUA 批次标识为 `cua-native-system-ui`。
  核验器必须按驱动标识区分，不能用一种驱动的证据冒充另一种。

## 使用约束

- 需要桌面解锁且系统授予「辅助功能」权限；一次只驱动一个原生批次（端口 4657/4661 单占）。
- 只操作产品真实入口与可见语义；不得新增 data-testid/隐藏钩子/验收 env 分支。
- 真实模型批次仍遵守单槽串行、加载前记录、结束卸载并验证为空；长跑用 detached 监督。
