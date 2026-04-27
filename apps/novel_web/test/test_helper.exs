ExUnit.start()

# Phoenix.ChannelTest 需要 Endpoint 已启动；test 环境 server: false 故不监听端口。
{:ok, _} = Application.ensure_all_started(:novel_web)
