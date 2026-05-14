defmodule NovelWeb.SystemController do
  use Phoenix.Controller, formats: [:json]

  def shutdown(conn, _params) do
    conn = json(conn, %{status: "shutting_down"})

    if Application.get_env(:novel_web, :system_shutdown_enabled, true) do
      # 异步执行，给 HTTP 响应留出时间
      Task.start(fn ->
        Process.sleep(500)
        System.stop(0)
      end)
    end

    conn
  end
end
