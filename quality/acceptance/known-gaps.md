# Known Acceptance Gaps

本文件登记已经进入 manifest、但当前不能作为质量 gate 执行的场景。Known gap 不是通过状态，也不能进入 `pr-smoke`。

当前无 blocked 场景。

2026-06-22 复核：`p1-chapter-plan-minimum` 的旧 blocked 事实已被当前真实 Tauri 证据取代。`artifacts/slice-verify/p1-chapter-plan-minimum-tauri/summary.json` 记录 `chapter_count=12`，并证明章节计划从真实工作台生成、经 adoption boundary 采纳、可由作品档案读取，且未进入 Reading Projection；该场景已恢复为 `nightly`。
