# 场景不变量 driver 的测试库 schema 守卫。
#
# `MIX_ENV=test mix run` 使用每次进程独立的临时 SQLite 文件（不自动迁移）；
# CP2 起判断主链会读会话 canonical 表，driver 必须在跑主链前确保 schema 存在。
# 已迁移库上 `Ecto.Migrator.run(all: true)` 幂等；失败不静默（reraise）。
defmodule ScenarioInvariants.SchemaGuard do
  @moduledoc false

  @migrations_path Path.expand("../../apps/novel_persistence/priv/repo/migrations", __DIR__)

  def ensure_schema! do
    Ecto.Migrator.run(NovelPersistence.Repo, @migrations_path, :up, all: true, log: false)
    :ok
  end
end
