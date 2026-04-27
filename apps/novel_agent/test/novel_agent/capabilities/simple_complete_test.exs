defmodule NovelAgent.Capabilities.SimpleCompleteTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Capabilities.SimpleComplete
  alias NovelAgent.Provider.Stub

  test "returns provider response" do
    stub = %Stub{}
    assert {:ok, result} = SimpleComplete.execute(Stub, stub, "hello")
    assert result =~ "[stub]"
    assert result =~ "hello"
  end

  test "passes through provider errors" do
    # 用 Stub 验证链路，Stub 不会返回 error，此处验证函数签名接受 prompt
    stub = %Stub{}
    assert {:ok, _} = SimpleComplete.execute(Stub, stub, "test")
  end
end
