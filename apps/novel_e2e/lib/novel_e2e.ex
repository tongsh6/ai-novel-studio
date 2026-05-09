defmodule NovelE2E do
  @moduledoc """
  端到端集成测试 umbrella app。

  只依赖 novel_web。测试从 Channel 入口进入，经完整主链验证协作正确性。
  不直接引用 novel_persistence / novel_agent / novel_application 的模块。
  """
end
