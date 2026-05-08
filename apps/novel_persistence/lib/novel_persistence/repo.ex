defmodule NovelPersistence.Repo do
  @moduledoc """
  主 Repo。阶段 1 桌面单机使用 SQLite3（自包含，零运维）。

  阶段 2 B/S 时切换 PostgreSQL——仅需修改此处 adapter 并调整 config。
  """

  use Ecto.Repo,
    otp_app: :novel_persistence,
    adapter: Ecto.Adapters.SQLite3
end
