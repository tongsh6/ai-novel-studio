defmodule NovelE2E.AppSmokeTest do
  @moduledoc """
  novel_e2e 是端到端集成 app：本 smoke test 只证明 app 可编译加载。

  背景（2026-10-27 门禁修复）：帧纪元退役批次（2c3c3b5a）移除了本 app 的旧 e2e
  测试文件后 app 变成空测试面；Elixir 1.19 起 umbrella 根 `mix test` 会因空测试
  非 0 退出。保留最小 real test 让门禁恢复信号，不新建旁路验收。
  """
  use ExUnit.Case, async: true

  test "novel_e2e app is loadable" do
    assert Code.ensure_loaded?(NovelE2E)
  end
end
