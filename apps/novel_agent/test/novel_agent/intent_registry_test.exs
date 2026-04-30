defmodule NovelAgent.IntentRegistryTest do
  use ExUnit.Case, async: true

  alias NovelAgent.IntentRegistry
  alias NovelAgent.IntentRegistry.SlotSchema

  alias NovelFoundation.Enums.Defaultability
  alias NovelFoundation.Enums.Inferability
  alias NovelFoundation.Enums.Requiredness
  alias NovelFoundation.Enums.ScopeDependency

  describe "list/0" do
    test "returns 5 registered intents" do
      intents = IntentRegistry.list()
      assert "intent.CREATE_WORK_SEED" in intents
      assert "intent.DRAFT_SCENE" in intents
      assert "intent.DRAFT_CHAPTER" in intents
      assert "intent.REVISE_DRAFT" in intents
      assert "intent.CONTINUE_DRAFTING" in intents
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

  describe "get/1 for new intents (VS-007)" do
    test "DRAFT_SCENE has required slots scene_ref + scene_boundary" do
      schema = IntentRegistry.get(:draft_scene)
      assert %SlotSchema{} = schema
      assert schema.intent_name == "intent.DRAFT_SCENE"
      blocking = SlotSchema.blocking_slots(schema)
      # scene_ref is inferable_with_high_confidence → not blocking
      # scene_boundary is not_inferable + no_default → blocking
      assert "scene_boundary" in blocking
    end

    test "DRAFT_CHAPTER has required slot chapter_ref (inferable → not blocking)" do
      schema = IntentRegistry.get(:draft_chapter)
      assert %SlotSchema{} = schema
      blocking = SlotSchema.blocking_slots(schema)
      assert blocking == []
    end

    test "REVISE_DRAFT has revision_direction as blocking slot" do
      schema = IntentRegistry.get(:revise_draft)
      blocking = SlotSchema.blocking_slots(schema)
      assert "revision_direction" in blocking
    end

    test "CONTINUE_DRAFTING has continuation_range as blocking slot" do
      schema = IntentRegistry.get(:continue_drafting)
      blocking = SlotSchema.blocking_slots(schema)
      assert "continuation_range" in blocking
    end
  end

  describe "meta/1" do
    test "returns risk_class and requires_confirmation for registered intents" do
      assert IntentRegistry.meta("intent.CREATE_WORK_SEED") == %{
               risk_class: "MEDIUM",
               requires_confirmation: false
             }

      assert IntentRegistry.meta("intent.DRAFT_CHAPTER") == %{
               risk_class: "HIGH",
               requires_confirmation: true
             }

      assert IntentRegistry.meta("intent.CONTINUE_DRAFTING") == %{
               risk_class: "HIGH",
               requires_confirmation: true
             }
    end

    test "works with atom interface" do
      assert IntentRegistry.meta(:draft_scene) == %{
               risk_class: "MEDIUM",
               requires_confirmation: false
             }
    end

    test "returns nil for unknown intent" do
      assert IntentRegistry.meta(:unknown) == nil
      assert IntentRegistry.meta("intent.UNKNOWN") == nil
    end
  end

  describe "classification_prompt/0" do
    test "includes all registered intents" do
      prompt = IntentRegistry.classification_prompt()
      assert prompt =~ "intent.CREATE_WORK_SEED"
      assert prompt =~ "intent.DRAFT_SCENE"
      assert prompt =~ "intent.DRAFT_CHAPTER"
      assert prompt =~ "intent.REVISE_DRAFT"
      assert prompt =~ "intent.CONTINUE_DRAFTING"
    end

    test "lists required slots for each intent" do
      prompt = IntentRegistry.classification_prompt()
      assert prompt =~ "genre"
      assert prompt =~ "scene_boundary"
      assert prompt =~ "revision_direction"
    end
  end
end
