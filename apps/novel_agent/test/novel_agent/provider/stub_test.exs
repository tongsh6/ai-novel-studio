defmodule NovelAgent.Provider.StubTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Stub

  setup do
    {:ok, stub: %Stub{}}
  end

  describe "name/0" do
    test "returns stub identifier" do
      assert Stub.name() == "stub"
    end
  end

  describe "complete/3" do
    test "returns echo response", %{stub: stub} do
      assert {:ok, result} = Stub.complete(stub, "test-model", "hello world")
      assert result =~ "hello world"
      assert result =~ "[stub]"
    end

    test "works with empty prompt", %{stub: stub} do
      assert {:ok, result} = Stub.complete(stub, "any-model", "")
      assert result =~ "[stub]"
    end
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(Stub, :complete, 3)
      assert function_exported?(Stub, :name, 0)
    end
  end
end
