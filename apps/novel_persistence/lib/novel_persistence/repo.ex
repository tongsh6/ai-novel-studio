defmodule NovelPersistence.Repo do
  @moduledoc """
  主 Repo。Stage 1 使用 SQLite（桌面应用自包含），测试环境使用 PostgreSQL。

  Adapter 在编译时根据 Mix.env() 选择：
    - dev/prod：Ecto.Adapters.SQLite3
    - test：Ecto.Adapters.Postgres（CI Sandbox）
  """

  # 编译时确定 adapter——SQLite for desktop, PG for CI test sandbox
  adapter =
    if Mix.env() == :test do
      Ecto.Adapters.Postgres
    else
      Ecto.Adapters.SQLite3
    end

  use Ecto.Repo,
    otp_app: :novel_persistence,
    adapter: adapter
end
