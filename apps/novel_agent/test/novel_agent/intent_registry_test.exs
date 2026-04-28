defmodule NovelAgent.IntentRegistryTest do
  use ExUnit.Case, async: true

  alias NovelAgent.IntentRegistry
  alias NovelAgent.IntentRegistry.SlotSchema

  alias NovelFoundation.Enums.Defaultability
  alias NovelFoundation.Enums.Inferability
  alias NovelFoundation.Enums.Requiredness
  alias NovelFoundation.Enums.ScopeDependency

  describe "list/0" do
    test "returns registered intents as ADR-0010 intent.<NAME> strings" do
      assert "intent.CREATE_WORK_SEED" in IntentRegistry.list()
    end
  end

  describe "get/1" do
    test "returns slot schema for registered intent (atom interface)" do
      schema = IntentRegistry.get(:create_work_seed)
      assert %SlotSchema{} = schema
      assert schema.intent_name == "intent.CREATE_WORK_SEED"
      assert schema.schema_id == "slot_schema.CREATE_WORK_SEED.v1"
      assert length(schema.slots) == 5
    end

    test "blocking slots are required_to_execute + not_inferable + no_default" do
      schema = IntentRegistry.get(:create_work_seed)
      blocking = SlotSchema.blocking_slots(schema)

      assert "genre" in blocking
      assert "core_selling_point" in blocking
      assert "target_reader" in blocking
      refute "tone_preference" in blocking
      refute "reference_works" in blocking
    end

    test "slot entries have all ADR-0010 §3 fields" do
      schema = IntentRegistry.get(:create_work_seed)
      [first | _] = schema.slots

      assert first.slot_name == "genre"
      assert first.slot_type == "enum_or_text"
      assert first.requiredness == Requiredness.required_to_execute()
      assert first.inferability == Inferability.not_inferable()
      assert first.defaultability == Defaultability.no_default()
      assert first.scope_dependency == ScopeDependency.work()
      assert first.description =~ "类型"
    end

    test "deferred_to_runtime includes mandatory items (ADR-0010 §2)" do
      schema = IntentRegistry.get(:create_work_seed)
      assert "capability_mapping" in schema.deferred_to_runtime
      assert "prompt" in schema.deferred_to_runtime
    end

    test "returns nil for unregistered intent" do
      assert IntentRegistry.get(:unknown) == nil
      assert IntentRegistry.get("intent.UNKNOWN") == nil
    end
  end
end
