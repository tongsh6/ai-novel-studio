defmodule NovelPersistence.DataCase do
  @moduledoc """
  测试基类：约定每个测试用例从 SQL Sandbox 拿到独立连接，结束自动 rollback。
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      alias NovelPersistence.Repo

      import Ecto
      import Ecto.Changeset
      import Ecto.Query
      import NovelPersistence.DataCase
    end
  end

  setup tags do
    NovelPersistence.DataCase.setup_sandbox(tags)
    :ok
  end

  def setup_sandbox(tags) do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(NovelPersistence.Repo, shared: not tags[:async])
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
  end
end
