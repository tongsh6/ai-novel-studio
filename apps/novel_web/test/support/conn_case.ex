defmodule NovelWeb.ConnCase do
  @moduledoc """
  用于 Phoenix Controller 测试的 helper。

  提供 `conn` fixture 和 JSON 辅助函数。
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      import Plug.Conn
      import Phoenix.ConnTest
      import NovelWeb.ConnCase

      @endpoint NovelWeb.Endpoint
    end
  end

  setup do
    {:ok, conn: Phoenix.ConnTest.build_conn()}
  end
end
