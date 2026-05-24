defmodule NovelApplication.CreativeExplorationLoopTest do
  use ExUnit.Case, async: true

  alias NovelApplication.DialogueGateway

  @moduledoc """
  VS-00A 自然创意探索循环证明。

  验证：模糊输入时，系统表现为“创作伙伴”展开方向，而不是机械地打开 slot 表单。
  """

  @exploration_response ~s({
    "frame_type": "creative_exploration",
    "dialogue_goal_summary": "展开赛博修仙的切入点方向",
    "needs_tool": false,
    "no_tool_reason": "exploratory_only",
    "execution_readiness": "not_applicable",
    "assistant_message": "赛博修仙是个很有张力的点！我们可以从几个方向切入：公司垄断灵气资源导致阶级固化、宗门数字化转型后的算法修仙，或者黑客修真者。你觉得哪个更有意思？",
    "candidate_directions": [
      {
        "title": "赛博公司垄断流",
        "pitch": "顶级大厂垄断了灵气带宽，底层散修只能用二手的“延迟灵气”。",
        "tone_tags": ["压抑", "社会批判"],
        "risk_hint": "high"
      },
      {
        "title": "算法飞升流",
        "pitch": "修仙不再看悟性，看的是算法优劣，飞升就是意识上传。 ",
        "tone_tags": ["硬核", "烧脑"]
      }
    ],
    "context_used": false,
    "uncertainty": ["核心矛盾尚未定死"]
  })

  describe "VS-00A Creative Exploration Loop" do
    test "fuzzy creative input produces partner-like exploration instead of mechanical forms" do
      # 1. Setup Mock Response
      complete_fn = fn _prompt -> {:ok, %{content: @exploration_response}} end

      # 2. Execute
      input = %{text: "我想写个赛博修仙，但还没想好。", workspace_id: "ws-vs00a"}

      {:ok, turn_result, trace, candidates, _context} =
        DialogueGateway.handle_input(input, nil, complete_fn)

      # 3. Proof Assertions (Contract Pack §6)

      # Proof #1: fuzzy idea enters exploration
      assert turn_result.frame_summary.frame_type == :creative_exploration

      # Proof #2: partner-like reply
      assert turn_result.assistant_message.text =~ "很有张力的点"
      assert turn_result.assistant_message.text =~ "公司垄断灵气"

      # Proof #3: candidate directions (2-3 items)
      assert length(candidates) == 2
      assert length(turn_result.candidate_directions) == 2
      assert hd(candidates).adoption_status == :not_adopted
      assert hd(candidates).title == "赛博公司垄断流"
      assert hd(candidates).risk_hint == :high
      assert hd(turn_result.candidate_directions).risk_hint == :high

      # Proof #4: no mechanical form
      assert turn_result.status == "conversational"
      assert turn_result.truthfulness.durable_behavior_opened == false
      assert Enum.all?(turn_result.available_actions, &(&1.action_type == "choose_candidate"))
      assert hd(turn_result.available_actions).candidate_ref == hd(candidates).direction_id

      # Proof #5: trace explains choice
      assert trace.decision_type == :exploration
      assert :reply_only_decision_recorded in trace.event_order
      # Trace summary should also reflect the frame
      assert trace.frame_ref == turn_result.frame_ref
    end
  end
end
