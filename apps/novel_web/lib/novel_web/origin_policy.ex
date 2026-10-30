defmodule NovelWeb.OriginPolicy do
  @moduledoc """
  B65：本地 HTTP/WebSocket 来源白名单的唯一判定点。

  只接受精确的 Tauri webview 来源与约定的本机开发前端来源：
  - `tauri://localhost`（macOS/Linux Tauri 自定义协议）
  - `http://tauri.localhost` / `https://tauri.localhost`（Windows Tauri）
  - 开发/隔离验收 Vite 前端：`http://127.0.0.1:5768|5769`、`http://localhost:5768|5769`

  判定必须按 scheme/host/port 精确比较，不能使用 `String.starts_with?`：后者会把
  `https://localhost.example.invalid` 误判为本机。Origin 不是本机进程身份认证，CORS/
  Origin 检查不替代作品/会话隔离或业务授权；无 Origin 的客户端（桌面原生 HTTP）不在
  CORS 头场景内，WebSocket 的 `check_origin` 由 Phoenix transport 在本策略下执行。

  CP0 冻结：新增开发端口/平台来源必须改本模块并补测试，不在运行时放宽为任意端口。
  """

  @tauri_origins ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]
  @http_origins [
    "http://127.0.0.1:5768",
    "http://localhost:5768",
    "http://127.0.0.1:5769",
    "http://localhost:5769"
  ]
  @trusted_origins @tauri_origins ++ @http_origins

  @spec trusted_origins() :: [String.t()]
  def trusted_origins, do: @trusted_origins

  @doc "HTTP Origin header 字符串白名单（供 CORSPlug）；非字符串/空串拒绝。"
  @spec allowed_origin?(String.t()) :: boolean()
  def allowed_origin?(origin) when is_binary(origin), do: origin in @trusted_origins
  def allowed_origin?(_origin), do: false

  @doc "Phoenix socket transport check_origin MFA：入参是 URI 结构。"
  @spec allowed_uri?(URI.t()) :: boolean()
  def allowed_uri?(%URI{} = uri) do
    uri_string =
      %URI{
        scheme: uri.scheme,
        host: uri.host,
        port: uri.port,
        path: nil,
        query: nil,
        fragment: nil
      }
      |> URI.to_string()

    uri_string in @trusted_origins
  end

  def allowed_uri?(_uri), do: false
end
