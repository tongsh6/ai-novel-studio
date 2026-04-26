defmodule Persistence.Schemas.Foundation.TurnResultTest do
  use ExUnit.Case, async: true

  alias Persistence.Schemas.Foundation.TurnResult

  @minimal_valid %{
    "schema_version" => "2.0.0",
    "turn_id" => "turn_001",
    "phase" => "EXECUTING",
    "status" => "RUNNING",
    "next_action" => "ASK_USER",
    "assistant_message" => %{"text" => "hello"},
    "ui_cards" => [],
    "behavior_state" => %{"active" => nil, "history" => []},
    "adoption_state" => %{"pending" => [], "resolved" => []},
    "projection_refs" => [],
    "validation" => %{},
    "usage" => %{},
    "trace_ref" => %{},
    "produced_at" => "2026-04-27T00:00:00Z"
  }

  test "minimal valid payload casts cleanly" do
    cs = TurnResult.changeset(%TurnResult{}, @minimal_valid)
    assert cs.valid?, "expected valid changeset, got: #{inspect(cs.errors)}"
  end

  test "missing schema_version is rejected" do
    invalid = Map.delete(@minimal_valid, "schema_version")
    cs = TurnResult.changeset(%TurnResult{}, invalid)
    refute cs.valid?
    assert {:schema_version, {"can't be blank", _}} = List.keyfind(cs.errors, :schema_version, 0)
  end

  test "schema_version must be semver" do
    invalid = Map.put(@minimal_valid, "schema_version", "v2")
    cs = TurnResult.changeset(%TurnResult{}, invalid)
    refute cs.valid?
    assert {:schema_version, {"has invalid format", _}} = List.keyfind(cs.errors, :schema_version, 0)
  end

  test "adoption_state with one TENTATIVE pending entry" do
    payload =
      put_in(@minimal_valid, ["adoption_state", "pending"], [
        %{
          "artifact_id" => "art_001",
          "artifact_type" => "work_seed",
          "adoption_status" => "TENTATIVE",
          "requires_adoption" => true
        }
      ])

    cs = TurnResult.changeset(%TurnResult{}, payload)
    assert cs.valid?, inspect(cs.errors)
  end

  test "invalid adoption_status value rejected" do
    payload =
      put_in(@minimal_valid, ["adoption_state", "pending"], [
        %{
          "artifact_id" => "art_001",
          "artifact_type" => "work_seed",
          "adoption_status" => "BOGUS",
          "requires_adoption" => true
        }
      ])

    cs = TurnResult.changeset(%TurnResult{}, payload)
    refute cs.valid?
  end
end
