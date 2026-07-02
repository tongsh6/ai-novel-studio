defmodule NovelCommon.Contracts.AgentEventTest do
  use ExUnit.Case, async: true

  alias NovelCommon.Contracts.AgentEvent

  test "author event normalizes type, refs, and visibility" do
    {:ok, event} =
      AgentEvent.new(%{
        "event_id" => "evt_1",
        "run_ref" => "run_1",
        "step_ref" => "step_1",
        "sequence" => 7,
        "event_type" => "exploration_observed",
        "visibility" => "author",
        "summary" => "已读取当前角色阵容，发现已有 3 个角色。",
        "reason_codes" => ["character_roster_loaded"],
        "refs" => ["obs_1"]
      })

    assert event.event_type == :exploration_observed
    assert event.visibility == :author
    assert AgentEvent.author_visible?(event)
    assert event.refs == ["obs_1"]
  end

  test "invalid event type is rejected" do
    assert {:error, errors} =
             AgentEvent.new(%{
               event_id: "evt_2",
               run_ref: "run_1",
               sequence: 1,
               event_type: "raw_prompt_dump",
               summary: "bad"
             })

    assert "event_type is invalid" in errors
  end
end
