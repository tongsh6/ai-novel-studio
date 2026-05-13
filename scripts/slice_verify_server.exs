port =
  (System.get_env("PHOENIX_TEST_PORT") || System.get_env("PHOENIX_PORT") || "4657")
  |> String.to_integer()

endpoint_config =
  :novel_web
  |> Application.get_env(NovelWeb.Endpoint, [])
  |> Keyword.put(:server, true)
  |> Keyword.put(:http, ip: {127, 0, 0, 1}, port: port)
  |> Keyword.put(:check_origin, false)

Application.put_env(:novel_web, NovelWeb.Endpoint, endpoint_config)
Application.put_env(:novel_agent, :provider, default: :stub)

{:ok, _started} = Application.ensure_all_started(:novel_web)

IO.puts("[slice-verify-server] listening on http://127.0.0.1:#{port}")

Process.sleep(:infinity)
