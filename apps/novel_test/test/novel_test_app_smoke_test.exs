defmodule NovelTest.AppSmokeTest do
  @moduledoc """
  novel_test 是纯测试支撑 app：本 smoke test 只证明 app 可编译加载。

  背景（2026-10-27 门禁修复）：Elixir 1.19 起 `mix test` 在「app 没有任何测试」时
  以非 0 退出，导致 umbrella 根 `mix test` 被 novel_test/novel_e2e 空测试面拖红。
  这里保留最小 real test 让门禁恢复信号，不引入对被测 app 的行为断言。
  """
  use ExUnit.Case, async: true

  test "novel_test app is loadable" do
    assert Code.ensure_loaded?(NovelTest)
  end
end
