ExUnit.start()

# Ecto SQL Sandbox：每个测试在事务里跑，结束 rollback。
Ecto.Adapters.SQL.Sandbox.mode(NovelPersistence.Repo, :manual)
