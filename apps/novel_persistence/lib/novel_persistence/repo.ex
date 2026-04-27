defmodule NovelPersistence.Repo do
  @moduledoc """
  主 Repo。Phase 0 阶段 adapter 锁定为 PostgreSQL（复用本机 colima 上的 v2_spike_pg 容器）。

  06-database.md §2 阶段 1 （SQLite）暂未启用——Stage 1 由后续 ADR 决定何时引入。
  """

  use Ecto.Repo,
    otp_app: :novel_persistence,
    adapter: Ecto.Adapters.Postgres
end
