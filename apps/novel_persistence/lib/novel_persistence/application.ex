defmodule NovelPersistence.Application do
  @moduledoc """
  Persistence 层 OTP application：启动 NovelPersistence.Repo。

  注：测试环境 (Mix.env() == :test) 仍启动 Repo —— Ecto SQL Sandbox 由测试侧 setup 接管。
  """

  use Application

  require Logger

  @impl true
  def start(_type, _args) do
    children = [
      NovelPersistence.Repo
    ]

    opts = [strategy: :one_for_one, name: NovelPersistence.Supervisor]

    with {:ok, pid} <- Supervisor.start_link(children, opts) do
      maybe_migrate()
      Logger.info("[NovelPersistence] Application started")
      {:ok, pid}
    end
  end

  # 打包后的桌面 release：首次启动数据库为空，没有 mix ecto.migrate 这一步。
  # 仅当 runtime.exs 显式开启 `:auto_migrate`（生产 release）时，在 Repo 起来后
  # 自动建表/迁移。dev/test 不开此开关，迁移仍由 mix 任务 / SQL Sandbox 管理。
  defp maybe_migrate do
    if Application.get_env(:novel_persistence, :auto_migrate, false) do
      path = Application.app_dir(:novel_persistence, "priv/repo/migrations")
      Logger.info("[NovelPersistence] 自动迁移：#{path}")
      Ecto.Migrator.run(NovelPersistence.Repo, path, :up, all: true)
    end
  rescue
    error ->
      Logger.error("[NovelPersistence] 自动迁移失败：#{Exception.message(error)}")
      reraise error, __STACKTRACE__
  end
end
