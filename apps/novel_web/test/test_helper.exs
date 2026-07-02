ExUnit.start(exclude: [:integration, :real_llm])

# Phoenix.ChannelTest 需要 Endpoint 已启动；test 环境 server: false 故不监听端口。
# Channel 单测不 checkout SQL Sandbox owner；AgentRun/ProviderRun 事实持久化由
# application/persistence 测试覆盖，避免 Repo 等待进入用户消息热路径。
Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, false)

{:ok, _} = Application.ensure_all_started(:novel_web)
