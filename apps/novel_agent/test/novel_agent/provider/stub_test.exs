defmodule NovelAgent.Provider.StubTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Stub

  setup do
    {:ok, stub: %Stub{}}
  end

  describe "name/0" do
    test "returns stub identifier" do
      assert Stub.name() == "stub"
    end
  end

  describe "complete/4" do
    test "returns echo response", %{stub: stub} do
      assert {:ok, result} = Stub.complete(stub, "test-model", "hello world", %InferenceParams{})
      assert result.content =~ "hello world"
      assert result.content =~ "[stub]"
    end

    test "works with empty prompt", %{stub: stub} do
      assert {:ok, result} = Stub.complete(stub, "any-model", "", %InferenceParams{})
      assert result.content =~ "[stub]"
    end
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(Stub, :complete, 4)
      assert function_exported?(Stub, :name, 0)
    end
  end
end
