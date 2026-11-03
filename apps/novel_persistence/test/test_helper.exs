# 2026-11-04 测试提速：不再全局设 max_cases: 1。
# 原因（实测）：ExUnit 配置在 umbrella 同 VM 跨 app 执行时不重置，本 app 的
# max_cases: 1 会泄漏到后续 novel_application / novel_web，把 1332 + 190 个用例
# 全部强制串行（日志证据：persistence 之后各段 max_cases 由 36 变 1）。
# SQLite 单库的串行约束改在各测试模块用 async: false 表达。
ExUnit.start()

# Ecto SQL Sandbox：每个测试在事务里跑，结束 rollback。
Ecto.Adapters.SQL.Sandbox.mode(NovelPersistence.Repo, :manual)
