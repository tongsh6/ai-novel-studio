defmodule NovelWeb.SystemController do
  use Phoenix.Controller, formats: [:json]

  def shutdown(conn, _params) do
    json(conn, %{status: "shutting_down"})

    # 异步执行，给 HTTP 响应留出时间
    Task.start(fn ->
      Process.sleep(500)
      System.stop(0)
    end)
  end
end
