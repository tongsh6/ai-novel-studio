defmodule NovelApplication.CreativeArtifactTest do
  use ExUnit.Case, async: true

  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.Toolbox
  alias NovelApplication.TurnResultBuilder
  alias NovelDomain.TentativeArtifactSet
  alias NovelDomain.ToolRequest

  # ── Registry ──────────────────────────────────

  describe "creative_generation tool registration" do
    test "is registered and active" do
      entry = CapabilityRegistry.get("creative_generation")
      assert entry != nil
      assert entry.status == :active
      assert entry.tool_layer == :creative
      assert entry.risk_class == :medium
      assert CapabilityRegistry.dispatchable?("creative_generation")
    end

    test "has no write_scopes" do
      entry = CapabilityRegistry.get("creative_generation")
      assert entry.write_scopes == []
    end
  end

  # ── Toolbox creative dispatch ─────────────────

  describe "creative generation dispatch" do
    test "generates character_seed items" do
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req)

      assert result.status == :succeeded
      assert result.output.artifact_type == "character_seed"
      assert length(result.output.items) == 3
      assert Enum.all?(result.output.items, &(&1.title != nil and &1.body != nil))
    end

    test "generates plot_direction items" do
      req = build_creative_request("plot_direction")

      result = Toolbox.execute(req)
      assert result.status == :succeeded
      assert result.output.item_count == 2
    end

    test "result has tentative_artifact in state_delta" do
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req)

      assert Enum.any?(result.state_delta, &(&1.type == :tentative_artifact))
    end

    test "result has artifact_refs pointing to generated items" do
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req)

      assert result.artifact_refs != []
      assert length(result.artifact_refs) == 3
    end
  end

  # ── TentativeArtifactSet ──────────────────────

  describe "TentativeArtifactSet" do
    test "build_artifact_set from creative ToolResult" do
      req = build_creative_request("character_seed")
      result = Toolbox.execute(req)

      artifact_set = TurnResultBuilder.build_artifact_set(result, "turn-1")

      assert %TentativeArtifactSet{} = artifact_set
      assert artifact_set.artifact_type == :character_seed
      assert length(artifact_set.items) == 3
      assert artifact_set.adoption_status == :tentative
      assert artifact_set.source_tool_result_ref == result.tool_result_id
      assert artifact_set.source_turn_ref == "turn-1"
    end

    test "tentative? returns true by default" do
      artifact_set = %TentativeArtifactSet{
        artifact_set_id: "as-1",
        artifact_type: :character_seed,
        source_turn_ref: "t-1",
        source_tool_result_ref: "tr-1"
      }

      assert TentativeArtifactSet.tentative?(artifact_set)
    end

    test "artifact items have required fields" do
      req = build_creative_request("character_seed")
      result = Toolbox.execute(req)
      artifact_set = TurnResultBuilder.build_artifact_set(result, "turn-1")

      for item <- artifact_set.items do
        assert item.item_id != nil
        assert item.title != nil
        assert item.body != nil
      end
    end
  end

  # ── Invariants ────────────────────────────────

  describe "tentative invariants" do
    test "creative tool has no write_scopes — cannot produce production fact" do
      entry = CapabilityRegistry.get("creative_generation")
      assert entry.write_scopes == []
    end

    test "artifacts default to tentative, not adopted" do
      artifact_set = %TentativeArtifactSet{
        artifact_set_id: "as-inv",
        artifact_type: :scene_draft,
        source_turn_ref: "t-inv",
        source_tool_result_ref: "tr-inv"
      }

      assert artifact_set.adoption_status == :tentative
      refute artifact_set.adoption_status == :adopted
    end

    test "tool provenance links result to request" do
      req = build_creative_request("character_seed")
      result = Toolbox.execute(req)

      assert result.tool_request_ref == req.tool_request_id
      assert result.tool_name == "creative_generation"
    end
  end

  defp build_creative_request(direction) do
    %ToolRequest{
      tool_request_id: "tq-creative-#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "t-creative",
      frame_ref: "f-creative",
      decision_ref: "d-creative",
      tool_name: "creative_generation",
      tool_version: "1.0.0",
      input: %{"direction" => direction, "context_text" => "赛博修仙世界观"},
      read_scope_grants: ["author_text", "context_snapshot"],
      write_scope_grants: [],
      idempotency_key: "idem-creative",
      created_at: DateTime.utc_now()
    }
  end
end
