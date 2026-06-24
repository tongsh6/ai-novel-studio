defmodule NovelWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :novel_web

  socket("/socket", NovelWeb.UserSocket,
    websocket: true,
    longpoll: false
  )

  plug(Plug.RequestId)
  plug(Plug.Telemetry, event_prefix: [:phoenix, :endpoint])

  # Tauri 桌面 webview 跨源调用本机后端时回 CORS 头并处理 OPTIONS 预检。
  plug(NovelWeb.Plugs.CORSPlug)

  plug(Plug.Parsers,
    parsers: [:json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()
  )

  plug(Plug.MethodOverride)
  plug(Plug.Head)

  plug(NovelWeb.Router)
end
