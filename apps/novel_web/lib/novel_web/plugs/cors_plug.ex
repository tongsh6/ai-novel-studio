defmodule NovelWeb.Plugs.CORSPlug do
  @moduledoc """
  最小 CORS 支持——只服务「Tauri 桌面 webview 跨源调用本机后端」这一真实场景。

  打包后前端由 Tauri 自定义协议托管（origin = `tauri://localhost` 或
  `http://tauri.localhost`），通过 `fetch` 调用 `http://localhost:<port>` 的 Phoenix
  后端属于跨源请求，WebView 会按浏览器 CORS 规则拦截。后端必须回 CORS 头并处理
  OPTIONS 预检。

  威胁面：后端只监听 127.0.0.1，仅本机进程可达；这里仅放行 Tauri webview 与
  localhost 来源，不是开放 `*`。非匹配来源不加任何 CORS 头，由 WebView 自行拦截。
  """

  @behaviour Plug

  import Plug.Conn

  @allow_methods "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  @allow_headers "content-type, authorization"

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    case allowed_origin(get_req_header(conn, "origin")) do
      nil ->
        conn

      origin ->
        conn
        |> put_resp_header("access-control-allow-origin", origin)
        |> put_resp_header("vary", "origin")
        |> put_resp_header("access-control-allow-methods", @allow_methods)
        |> put_resp_header("access-control-allow-headers", @allow_headers)
        |> maybe_halt_preflight()
    end
  end

  defp maybe_halt_preflight(%Plug.Conn{method: "OPTIONS"} = conn) do
    conn
    |> send_resp(:no_content, "")
    |> halt()
  end

  defp maybe_halt_preflight(conn), do: conn

  defp allowed_origin([origin | _]) when is_binary(origin) do
    if allowed?(origin), do: origin, else: nil
  end

  defp allowed_origin(_headers), do: nil

  # Tauri webview 与本机来源白名单。localhost/127.0.0.1 允许任意端口（覆盖
  # 浏览器调试与 Vite dev），其余一律不放行。
  defp allowed?("tauri://localhost"), do: true

  defp allowed?(origin) do
    String.starts_with?(origin, [
      "http://tauri.localhost",
      "https://tauri.localhost",
      "http://localhost",
      "https://localhost",
      "http://127.0.0.1",
      "https://127.0.0.1"
    ])
  end
end
