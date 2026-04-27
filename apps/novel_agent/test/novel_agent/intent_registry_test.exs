defmodule NovelAgent.IntentRegistryTest do
  use ExUnit.Case, async: true

  alias NovelAgent.IntentRegistry

  describe "list/0" do
    test "returns registered intents" do
      assert :create_work_seed in IntentRegistry.list()
    end
  end

  describe "get/1" do
    test "returns slot schema for registered intent" do
      schema = IntentRegistry.get(:create_work_seed)
      assert %IntentRegistry.SlotSchema{} = schema
      assert length(schema.required) == 3
      assert length(schema.optional) == 2
      assert Enum.any?(schema.required, &(&1.name == :genre))
      assert Enum.any?(schema.optional, &(&1.name == :tone_preference))
    end

    test "returns nil for unregistered intent" do
      assert IntentRegistry.get(:unknown) == nil
    end
  end
end
