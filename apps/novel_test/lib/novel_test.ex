defmodule NovelTest do
  @moduledoc """
  跨 umbrella app 共享的测试 helper app。仅测试环境使用。

  只依赖 canonical 契约（novel_common），不依赖任何生产 app 运行时；提供请求材料
  读取与 canonical IR 夹具构造，避免各 app 的 test/support 重复。测试替身 provider
  依赖 agent 运行时实现，仍留在 novel_agent/test/support。
  """
end
