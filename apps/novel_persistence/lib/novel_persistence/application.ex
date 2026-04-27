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
      Logger.info("[NovelPersistence] Application started")
      {:ok, pid}
    end
  end
end
