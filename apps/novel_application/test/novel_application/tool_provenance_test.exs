defmodule NovelApplication.ToolProvenanceTest do
  use ExUnit.Case, async: true

  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.Toolbox
  alias NovelDomain.CapabilityRegistryEntry
  alias NovelDomain.OrchestratorDecision
  alias NovelDomain.ToolRequest
  alias NovelDomain.ToolResult

  # ── Registry ──────────────────────────────────

  describe "CapabilityRegistry" do
    test "lists registered tools" do
      tools = CapabilityRegistry.list()
      assert "text_analysis" in tools
      assert "disabled_tool" in tools
    end

    test "get returns entry for known tool" do
      entry = CapabilityRegistry.get("text_analysis")
      assert %CapabilityRegistryEntry{} = entry
      assert entry.tool_name == "text_analysis"
      assert entry.tool_version == "1.0.0"
      assert entry.status == :active
    end

    test "get returns nil for unknown tool" do
      assert CapabilityRegistry.get("nonexistent") == nil
    end

    test "dispatchable? returns true for active tools" do
      assert CapabilityRegistry.dispatchable?("text_analysis")
    end

    test "dispatchable? returns false for disabled tools" do
      refute CapabilityRegistry.dispatchable?("disabled_tool")
    end

    test "dispatchable? returns false for unknown tools" do
      refute CapabilityRegistry.dispatchable?("nonexistent")
    end

    test "grants_valid? checks read scopes" do
      assert CapabilityRegistry.grants_valid?("text_analysis", ["author_text"], [])
      refute CapabilityRegistry.grants_valid?("text_analysis", ["admin_access"], [])
    end

    test "grants_valid? rejects write scopes for read-only tool" do
      refute CapabilityRegistry.grants_valid?("text_analysis", [], ["production_write"])
    end

    test "grants_valid? returns false for unknown tool" do
      refute CapabilityRegistry.grants_valid?("unknown", [], [])
    end
  end

  # ── Toolbox ───────────────────────────────────

  describe "Toolbox" do
    test "executes valid tool request and returns ToolResult" do
      req = %ToolRequest{
        tool_request_id: "tq-test-1",
        turn_id: "t-test",
        frame_ref: "f-test",
        decision_ref: "d-test",
        tool_name: "text_analysis",
        tool_version: "1.0.0",
        input: %{"text" => "这是一段测试文本，用于验证工具执行", "genre" => "test"},
        read_scope_grants: ["author_text"],
        write_scope_grants: [],
        idempotency_key: "idem-1",
        created_at: DateTime.utc_now()
      }

      result = Toolbox.execute(req)

      assert %ToolResult{} = result
      assert result.status == :succeeded
      assert result.tool_request_ref == "tq-test-1"
      assert result.tool_name == "text_analysis"
      assert is_map(result.output)
      assert result.output.word_count > 0
    end

    test "rejects unknown tool" do
      req = %ToolRequest{
        tool_request_id: "tq-unknown", turn_id: "t", frame_ref: "f",
        decision_ref: "d", tool_name: "nonexistent", tool_version: "1",
        input: %{}, read_scope_grants: [], write_scope_grants: [],
        idempotency_key: "idem", created_at: DateTime.utc_now()
      }

      result = Toolbox.execute(req)
      assert result.status == :failed
      assert result.errors != []
    end

    test "rejects disabled tool" do
      req = %ToolRequest{
        tool_request_id: "tq-disabled", turn_id: "t", frame_ref: "f",
        decision_ref: "d", tool_name: "disabled_tool", tool_version: "1",
        input: %{}, read_scope_grants: [], write_scope_grants: [],
        idempotency_key: "idem", created_at: DateTime.utc_now()
      }

      result = Toolbox.execute(req)
      assert result.status == :failed
      assert Enum.any?(result.errors, &(&1.code == "tool_not_dispatchable"))
    end

    test "rejects grant scope violation" do
      req = %ToolRequest{
        tool_request_id: "tq-scope", turn_id: "t", frame_ref: "f",
        decision_ref: "d", tool_name: "text_analysis", tool_version: "1",
        input: %{}, read_scope_grants: ["admin_access"], write_scope_grants: [],
        idempotency_key: "idem", created_at: DateTime.utc_now()
      }

      result = Toolbox.execute(req)
      assert result.status == :failed
      assert Enum.any?(result.errors, &(&1.code == "grant_scope_violation"))
    end

    test "ToolResult not adoption — result has no production fact" do
      req = %ToolRequest{
        tool_request_id: "tq-adopt", turn_id: "t", frame_ref: "f",
        decision_ref: "d", tool_name: "text_analysis", tool_version: "1",
        input: %{"text" => "test content"}, read_scope_grants: ["author_text"],
        write_scope_grants: [], idempotency_key: "idem", created_at: DateTime.utc_now()
      }

      result = Toolbox.execute(req)

      assert result.status == :succeeded
      # state_delta is observation, not production write
      refute Enum.any?(result.state_delta, &(&1[:type] == :production_write))
      # artifact_refs is empty (no artifacts created)
      assert result.artifact_refs == []
    end
  end

  # ── ToolRequest invariants ────────────────────

  describe "ToolRequest invariants" do
    test "ToolRequest must have decision_ref" do
      # ToolRequest struct requires decision_ref in @enforce_keys
      assert_raise ArgumentError, fn ->
        struct!(ToolRequest, tool_request_id: "x", turn_id: "x", frame_ref: "x",
                tool_name: "x", tool_version: "1")
      end
    end

    test "decision_ref links request to orchestrator decision" do
      decision_id = "decision-123"
      req = %ToolRequest{
        tool_request_id: "tq-link", turn_id: "t", frame_ref: "f",
        decision_ref: decision_id, tool_name: "text_analysis",
        tool_version: "1.0.0", idempotency_key: "idem",
        created_at: DateTime.utc_now()
      }

      assert req.decision_ref == decision_id
    end
  end

  # ── OrchestratorDecision allow_tool ────────────

  describe "OrchestratorDecision allow_tool" do
    test "allow_tool decision has no blocking gate" do
      decision = %OrchestratorDecision{
        decision_id: "d-allow", turn_id: "t", frame_ref: "f",
        decision_type: :allow_tool, decision_status: :decided,
        reason_codes: ["gates_passed", "tool:text_analysis"]
      }

      refute OrchestratorDecision.blocks_execution?(decision)
      assert decision.first_blocking_gate == nil
    end

    test "truthfulness_constraints for allow_tool include result_not_adoption" do
      decision = %OrchestratorDecision{
        decision_id: "d", turn_id: "t", frame_ref: "f",
        decision_type: :allow_tool, decision_status: :decided,
        reason_codes: []
      }

      constraints = OrchestratorDecision.truthfulness_constraints(decision)
      assert "result_not_adoption" in constraints
    end
  end
end
