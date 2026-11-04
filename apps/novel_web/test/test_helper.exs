ExUnit.start(exclude: [:integration, :real_llm])

# Phoenix.ChannelTest 需要 Endpoint 已启动；test 环境 server: false 故不监听端口。
# SQL Sandbox 由各测试模块 setup 启动 shared owner，不在本文件全局启动；
# AgentRun/ProviderRun 事实持久化仍由 application/persistence 测试覆盖。
Code.require_file(
  Path.expand("../../novel_application/test/support/agent_run_cleanup_helper.exs", __DIR__)
)

Code.require_file(
  Path.expand("../../novel_application/test/support/agent_event_relay_helper.exs", __DIR__)
)

Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, false)

{:ok, _} = Application.ensure_all_started(:novel_web)
