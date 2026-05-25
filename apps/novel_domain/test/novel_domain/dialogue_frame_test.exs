defmodule NovelDomain.DialogueFrameTest do
  use ExUnit.Case, async: true
  alias NovelDomain.DialogueFrame

  @valid_frame %DialogueFrame{
    schema_version: "3.0-draft",
    frame_id: "f1",
    turn_id: "t1",
    workspace_id: "ws1",
    primary: true,
    frame_type: :casual_reply,
    source_refs: %{author_input_ref: "a1", dialogue_context_ref: nil},
    dialogue_goal: %{summary: "test"},
    tool_need: %{needs_tool: false, reason_code: :no_tool_needed},
    execution_readiness: :not_applicable,
    author_visible_draft: %{message: "hello"},
    evidence_summary: %{},
    uncertainty: []
  }

  describe "validate/1" do
    test "returns :ok for valid frame" do
      assert DialogueFrame.validate(@valid_frame) == :ok
    end

    test "accepts tool-needed frames for concrete creative production" do
      frame = %DialogueFrame{
        @valid_frame
        | frame_type: :creative_exploration,
          tool_need: %{needs_tool: true, reason_code: :tool_needed},
          execution_readiness: :ready
      }

      assert DialogueFrame.validate(frame) == :ok
    end

    test "returns error if required fields are missing" do
      frame = %DialogueFrame{@valid_frame | frame_id: nil, turn_id: ""}
      assert {:error, errors} = DialogueFrame.validate(frame)
      assert "frame_id is required" in errors
      assert "turn_id is required" in errors
    end

    test "returns error if author_visible_draft is missing or invalid" do
      frame = %DialogueFrame{@valid_frame | author_visible_draft: nil}
      assert {:error, errors} = DialogueFrame.validate(frame)
      assert "author_visible_draft is required" in errors

      frame = %DialogueFrame{@valid_frame | author_visible_draft: %{}}
      assert {:error, errors} = DialogueFrame.validate(frame)
      assert "author_visible_draft.message is required" in errors
    end

    test "returns error for invalid frame_type" do
      frame = %DialogueFrame{@valid_frame | frame_type: :invalid}
      assert {:error, errors} = DialogueFrame.validate(frame)
      assert "invalid frame_type: :invalid" in errors
    end

    test "returns error for invalid tool_need" do
      frame = %DialogueFrame{
        @valid_frame
        | tool_need: %{needs_tool: "yes", reason_code: :no_tool_needed}
      }

      assert {:error, errors} = DialogueFrame.validate(frame)
      assert "tool_need.needs_tool must be a boolean" in errors

      frame = %DialogueFrame{@valid_frame | tool_need: %{needs_tool: false, reason_code: :bad}}
      assert {:error, errors} = DialogueFrame.validate(frame)
      assert "invalid tool_need.reason_code: :bad" in errors
    end

    test "returns error for forbidden semantics in message" do
      frame = %DialogueFrame{
        @valid_frame
        | author_visible_draft: %{message: "Your request is APPROVED."}
      }

      assert {:error, errors} = DialogueFrame.validate(frame)
      assert "forbidden semantics found: approved" in errors
    end
  end
end
