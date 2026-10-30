# B65 CP2/CP3 隔离来源探针：test env 下启动真实 Phoenix Endpoint（独立端口），
# 只用于外部 HTTP/WS 来源边界验收；不写产品数据，不修改产品配置。
port = String.to_integer(System.get_env("PHOENIX_TEST_PORT", "4665"))

endpoint_config =
  :novel_web
  |> Application.get_env(NovelWeb.Endpoint, [])
  |> Keyword.put(:server, true)
  |> Keyword.put(:http, [ip: {127, 0, 0, 1}, port: port])
  |> Keyword.put(:check_origin, {NovelWeb.OriginPolicy, :allowed_uri?, []})

Application.put_env(:novel_web, NovelWeb.Endpoint, endpoint_config)

case Application.ensure_all_started(:novel_web) do
  {:ok, _apps} ->
    IO.puts("[b65-origin-probe] ready port=#{port}")
    Process.sleep(:infinity)

  {:error, reason} ->
    IO.puts(:stderr, "[b65-origin-probe] startup_failed #{inspect(reason)}")
    System.halt(1)
end
