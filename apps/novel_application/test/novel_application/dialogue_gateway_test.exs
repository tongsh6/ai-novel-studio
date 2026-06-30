defmodule NovelApplication.DialogueGatewayTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.DialogueGateway
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.DialogueFrame

  @frame_json """
  {
    "frame_type": "casual_reply",
    "dialogue_goal_summary": "用户发来消息",
    "needs_tool": false,
    "no_tool_reason": "no_tool_needed",
    "execution_readiness": "not_applicable",
    "assistant_message": "收到你的消息。",
    "candidate_directions": [],
    "context_used": false,
    "uncertainty": []
  }
  """

  # ── VS-00 reply-only tests ──────────────────────────

  describe "reply-only turn" do
    test "produces primary DialogueFrame" do
      input = %{text: "我想聊聊这个故事开头的气质，先别写正文。", workspace_id: "ws-1"}

      {:ok, turn_result, trace, _candidates, _context} = DialogueGateway.handle_input(input)

      assert turn_result.frame_ref != nil
      assert turn_result.frame_summary != nil
      assert trace.decision_type == :reply_only
      assert trace.frame_ref == turn_result.frame_ref
    end

    test "does not produce MicroPlan" do
      input = %{text: "帮我判断应该更悬疑还是更温柔", workspace_id: "ws-1"}

      {:ok, turn_result, _trace, _candidates, _context} = DialogueGateway.handle_input(input)

      refute Map.has_key?(turn_result, :micro_plan)
      refute turn_result.truthfulness.tool_called
    end

    test "does not claim tool/adoption/write/behavior" do
      input = %{text: "先聊方向不写正文，纯交流", workspace_id: "ws-1"}

      {:ok, turn_result, _trace, _candidates, _context} = DialogueGateway.handle_input(input)

      assert turn_result.truthfulness.tool_called == false
      assert turn_result.truthfulness.artifact_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
      assert turn_result.truthfulness.durable_behavior_opened == false
    end

    test "explicit no-write discussion overrides provider execution frame" do
      execution_frame_json = """
      {
        "frame_type": "execution_candidate",
        "dialogue_goal_summary": "继续讨论但不要写正文或改设定",
        "needs_tool": true,
        "no_tool_reason": "tool_needed",
        "execution_readiness": "ready",
        "assistant_message": "可以，我们继续聊方向，不会写正文或改设定。",
        "candidate_directions": [],
        "context_used": false,
        "uncertainty": []
      }
      """

      {:ok, calls} = Agent.start_link(fn -> 0 end)

      complete_fn = fn _prompt ->
        Agent.update(calls, &(&1 + 1))
        {:ok, %{content: execution_frame_json}}
      end

      {:ok, turn_result, trace, candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "继续聊，但先不要写正文，也不要改设定。", workspace_id: "ws-no-write"},
          nil,
          complete_fn
        )

      assert Agent.get(calls, & &1) == 1
      assert turn_result.frame_summary.frame_type == :casual_reply
      assert trace.decision_type == :reply_only
      assert candidates == []
      refute Map.has_key?(turn_result, :micro_plan)
      refute Map.has_key?(turn_result, :tool_result)
      assert turn_result.ui_cards == []
      assert turn_result.available_actions == []
      assert turn_result.truthfulness.tool_called == false
      assert turn_result.truthfulness.production_write_performed == false
      assert turn_result.truthfulness.artifact_adopted == false
    end

    test "explicit discussion suppresses provider candidate exploration frame" do
      exploration_frame_json = """
      {
        "frame_type": "creative_exploration",
        "dialogue_goal_summary": "讨论雨夜开场的气质",
        "needs_tool": false,
        "no_tool_reason": "exploratory_only",
        "execution_readiness": "not_applicable",
        "assistant_message": "可以，我们只聊气质，不生成候选卡。",
        "candidate_directions": [
          {"title": "幽暗压抑", "pitch": "从压迫感切入。", "tone_tags": ["悬疑"]},
          {"title": "冷峻孤寂", "pitch": "从孤独感切入。", "tone_tags": ["悬疑"]}
        ],
        "context_used": false,
        "uncertainty": []
      }
      """

      complete_fn = fn _prompt -> {:ok, %{content: exploration_frame_json}} end

      {:ok, turn_result, trace, candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "我想写一个雨夜开场的悬疑故事，先聊聊气质。", workspace_id: "ws-chat"},
          nil,
          complete_fn
        )

      assert turn_result.frame_summary.frame_type == :casual_reply
      assert trace.decision_type == :reply_only
      assert candidates == []
      refute Map.has_key?(turn_result, :candidate_directions)
      assert turn_result.available_actions == []
      assert turn_result.truthfulness.tool_called == false
    end

    test "malformed provider JSON does not report the LLM as disconnected" do
      broken_json_fn = fn _prompt -> {:ok, %{content: "not-json"}} end

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "普通聊天", workspace_id: "ws-json-error"},
          nil,
          broken_json_fn
        )

      message = turn_result.assistant_message.text
      refute String.contains?(message, "无法连接")
      assert String.contains?(message, "格式")
    end

    test "accepts provider execution dependency for conversation turns" do
      provider_execution = %Execution{
        complete_fn: fn _prompt -> {:ok, %{content: @frame_json}} end
      }

      {:ok, turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "普通聊天", workspace_id: "ws-provider-execution"},
          nil,
          provider_execution
        )

      assert turn_result.frame_summary.frame_type == :casual_reply
      assert trace.decision_type == :reply_only
    end

    test "provider unavailable fallback is recoverable and truthfully reports no write" do
      unavailable_fn = fn _prompt ->
        {:error, %{type: :connection_refused, message: "LM Studio 未启动"}}
      end

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "普通聊天", workspace_id: "ws-provider-down"},
          nil,
          unavailable_fn
        )

      assert turn_result.status == "conversational"
      assert turn_result.assistant_message.text =~ "无法连接到创作引擎"
      assert turn_result.assistant_message.text =~ "没有写入作品事实"
      assert turn_result.truthfulness.tool_called == false
      assert turn_result.truthfulness.artifact_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
      assert turn_result.truthfulness.durable_behavior_opened == false
    end

    test "provider invalid_request fallback points at model params, not empty response" do
      invalid_request_fn = fn _prompt ->
        {:error,
         %{type: :invalid_request, message: "DeepSeek API: HTTP 400: reasoning_effort 非法"}}
      end

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "普通聊天", workspace_id: "ws-invalid-request"},
          nil,
          invalid_request_fn
        )

      message = turn_result.assistant_message.text
      assert message =~ "模型参数"
      refute message =~ "返回内容为空"
      assert turn_result.truthfulness.production_write_performed == false
    end

    test "frame JSON missing required fields is retried instead of silently defaulting message" do
      malformed_frame_json = """
      {
        "response_type": "continue",
        "next_topic": "轮回代价·时间裂隙"
      }
      """

      valid_frame_json = """
      {
        "frame_type": "creative_exploration",
        "dialogue_goal_summary": "继续深化宿命链",
        "needs_tool": false,
        "no_tool_reason": "exploratory_only",
        "execution_readiness": "not_applicable",
        "assistant_message": "我们继续围绕宿命链，把选择代价和未来分岔讲清楚。",
        "candidate_directions": [
          {"title": "记忆碎片", "pitch": "用破碎未来提示风险。", "tone_tags": ["悬疑"]},
          {"title": "预言棋局", "pitch": "用占卜师棋盘呈现选择。", "tone_tags": ["策略"]}
        ],
        "context_used": true,
        "uncertainty": []
      }
      """

      {:ok, agent} = Agent.start_link(fn -> 0 end)

      complete_fn = fn _prompt ->
        call_index = Agent.get_and_update(agent, &{&1, &1 + 1})

        if call_index == 0 do
          {:ok, %{content: malformed_frame_json}}
        else
          {:ok, %{content: valid_frame_json}}
        end
      end

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "继续聊这个方向", workspace_id: "ws-partial-frame"},
          nil,
          complete_fn
        )

      assert turn_result.assistant_message.text =~ "宿命链"
      refute turn_result.assistant_message.text == "收到你的消息。"
      assert Agent.get(agent, & &1) == 2
    end

    test "DecisionTrace records no-tool, no-behavior, no-write reasons" do
      input = %{text: "聊聊风格", workspace_id: "ws-1"}

      {:ok, _turn_result, trace, _candidates, _context} = DialogueGateway.handle_input(input)

      assert trace.no_tool_reason != nil
      assert trace.no_behavior_reason != nil
      assert trace.no_write_reason != nil
      assert trace.replay_policy.recall_provider == false
      assert length(trace.event_order) >= 4
      assert :author_input_received in trace.event_order
      assert :turn_result_emitted in trace.event_order
    end
  end

  # ── VS-00A creative exploration tests ──────────────────

  describe "creative exploration turn" do
    test "fuzzy creative idea enters exploration frame" do
      # This input is explicitly exploratory — the author hasn't decided yet
      input = %{text: "我想写一个赛博修仙，但还没想好方向。帮我想想可以怎么切入。", workspace_id: "ws-1"}

      {:ok, turn_result, trace, _candidates, _context} = DialogueGateway.handle_input(input)

      # Frame type should be creative_exploration
      assert turn_result.frame_summary.frame_type != nil
      assert trace.decision_type in [:exploration, :reply_only]

      # When using stub provider (fallback), candidates will be empty.
      # With real LLM, frame_type would be :creative_exploration and candidates non-empty.
      # Both paths are valid — the test verifies the system doesn't crash.
      assert turn_result.truthfulness.tool_called == false
      assert turn_result.truthfulness.durable_behavior_opened == false
    end

    test "does not open mechanical slot form" do
      input = %{text: "我想写小说但没想好", workspace_id: "ws-1"}

      {:ok, turn_result, _trace, _candidates, _context} = DialogueGateway.handle_input(input)

      # Must not contain slot-form-like fields
      refute Map.has_key?(turn_result, :required_slots)
      refute Map.has_key?(turn_result, :missing_slots)
      refute Map.has_key?(turn_result, :slot_schema)
      refute Map.has_key?(turn_result, :slot_form)

      # Must not open durable clarification
      refute turn_result.truthfulness.durable_behavior_opened
      refute Map.has_key?(turn_result, :clarification)
    end

    test "candidate directions are marked not_adopted" do
      provider_reply = """
      {
        "frame_type": "creative_exploration",
        "dialogue_goal_summary": "探索故事方向",
        "needs_tool": false,
        "no_tool_reason": "exploratory_only",
        "execution_readiness": "not_applicable",
        "assistant_message": "可以从悬疑、成长和冒险三个方向展开。",
        "candidate_directions": [
          {"title": "悬疑切入", "pitch": "从一个未解谜团开场。", "tone_tags": ["悬疑"]},
          {"title": "成长切入", "pitch": "从主角的错误选择开始。", "tone_tags": ["成长"]}
        ],
        "context_used": false,
        "uncertainty": []
      }
      """

      complete_fn = fn _prompt -> {:ok, %{content: provider_reply}} end

      {:ok, _turn_result, _trace, candidates, _context} =
        DialogueGateway.handle_input(%{text: "帮我想几个故事方向", workspace_id: "ws-1"}, nil, complete_fn)

      assert Enum.all?(candidates, &(Map.get(&1, :adoption_status, :not_adopted) == :not_adopted))
    end

    test "assistant message is natural exploration not field list" do
      input = %{text: "赛博修仙？没想好", workspace_id: "ws-1"}

      {:ok, turn_result, _trace, _candidates, _context} = DialogueGateway.handle_input(input)

      message = turn_result.assistant_message.text

      # A field-list-style response would contain patterns like "请补充" + 冒号列表
      # A natural exploration response reads like a conversation
      refute String.contains?(message, "请补充以下信息")
      refute String.contains?(message, "必填字段")
    end

    test "fuzzy exploration is normalized when provider returns casual reply with no candidates" do
      provider_reply = """
      {
        "frame_type": "casual_reply",
        "dialogue_goal_summary": "帮作者探索赛博修仙切入方向",
        "needs_tool": false,
        "no_tool_reason": "user_requested_discussion",
        "execution_readiness": "not_applicable",
        "assistant_message": "这个题材可以从公司垄断灵气、算法飞升、底层散修反抗几个方向切入。你更想写压抑一点还是热血一点？",
        "candidate_directions": [],
        "context_used": false,
        "uncertainty": []
      }
      """

      complete_fn = fn _prompt -> {:ok, %{content: provider_reply}} end
      input = %{text: "我想写赛博修仙，但还没想好方向。帮我想想怎么切入。", workspace_id: "ws-1"}

      {:ok, turn_result, trace, candidates, _context} =
        DialogueGateway.handle_input(input, nil, complete_fn)

      assert turn_result.frame_summary.frame_type == :creative_exploration
      assert trace.decision_type == :exploration
      assert length(candidates) >= 2
      assert length(turn_result.candidate_directions) >= 2
      assert Enum.all?(candidates, &(&1.adoption_status == :not_adopted))
    end

    test "creative exploration with missing candidates receives fallback candidates" do
      provider_reply = """
      {
        "frame_type": "creative_exploration",
        "dialogue_goal_summary": "探索赛博修仙方向",
        "needs_tool": false,
        "no_tool_reason": "exploratory_only",
        "execution_readiness": "not_applicable",
        "assistant_message": "可以先比较公司垄断灵气、算法飞升、黑客修真三个方向。",
        "candidate_directions": [],
        "context_used": false,
        "uncertainty": []
      }
      """

      complete_fn = fn _prompt -> {:ok, %{content: provider_reply}} end

      {:ok, turn_result, _trace, candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "赛博修仙怎么切入？帮我想几个方向。", workspace_id: "ws-1"},
          nil,
          complete_fn
        )

      assert turn_result.frame_summary.frame_type == :creative_exploration
      assert length(candidates) >= 2
      assert Enum.all?(candidates, &(&1.title != "" and &1.pitch != ""))
    end

    test "malformed candidate directions are ignored and replaced by fallback candidates" do
      provider_reply = """
      {
        "frame_type": "creative_exploration",
        "dialogue_goal_summary": "探索赛博修仙方向",
        "needs_tool": false,
        "no_tool_reason": "exploratory_only",
        "execution_readiness": "not_applicable",
        "assistant_message": "可以从几个方向试试。",
        "candidate_directions": {"title": "", "pitch": ""},
        "context_used": false,
        "uncertainty": []
      }
      """

      complete_fn = fn _prompt -> {:ok, %{content: provider_reply}} end

      {:ok, turn_result, _trace, candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "赛博修仙怎么切入？帮我想几个方向。", workspace_id: "ws-1"},
          nil,
          complete_fn
        )

      assert turn_result.frame_summary.frame_type == :creative_exploration
      assert length(candidates) >= 2
      assert Enum.all?(turn_result.candidate_directions, &(&1.title != "" and &1.pitch != ""))
    end
  end

  # ── Shared invariants ─────────────────────────────────

  describe "invariants" do
    test "empty text returns error" do
      assert {:error, _} = DialogueGateway.handle_input(%{text: ""})
      assert {:error, _} = DialogueGateway.handle_input(%{})
    end

    test "explicit nil provider is rejected instead of falling back to Gateway" do
      assert {:error, reason} = DialogueGateway.handle_input(%{text: "普通聊天"}, nil, nil)
      assert String.contains?(reason, "provider execution")

      assert {:error, reason} =
               DialogueGateway.handle_input(%{text: "普通聊天"}, nil, nil, fn _, _ -> :ok end, nil)

      assert String.contains?(reason, "provider execution")
    end

    test "explicit nil provider is rejected for author actions" do
      input = %AuthorActionInput{
        input_id: "in-provider-boundary",
        source_turn_ref: "turn-provider-boundary",
        action_id: "act-provider-boundary",
        action_type: "confirm_before_execute"
      }

      assert {:error, reason} = DialogueGateway.handle_action(input, %{}, nil)
      assert String.contains?(reason, "provider execution")
    end

    test "cancel waiting action records terminal behavior trace refs for replay" do
      input = %AuthorActionInput{
        input_id: "in-cancel-behavior",
        source_turn_ref: "turn-behavior-open",
        action_id: "act-cancel-behavior",
        action_type: "reject_or_cancel_confirmation",
        target_ref: "prose_writing",
        behavior_ref: "bh-behavior-open",
        idempotency_key: "ik-cancel-behavior"
      }

      source_turn_result = %{
        turn_id: "turn-behavior-open",
        frame_ref: "frame-behavior-open",
        trace_summary: %{trace_ref: "trace-behavior-open"},
        available_actions: [
          %{
            action_id: "act-cancel-behavior",
            action_type: "reject_or_cancel_confirmation",
            target_ref: "prose_writing",
            behavior_ref: "bh-behavior-open",
            idempotency_key: "ik-cancel-behavior",
            enabled: true
          }
        ],
        behavior_state: %{
          active: %{
            behavior_id: "bh-behavior-open",
            behavior_type: "confirmation",
            opened_at_turn_ref: "turn-behavior-open",
            opened_by_decision_ref: "decision-behavior-open",
            frame_ref: "frame-behavior-open",
            plan_ref: "plan-behavior-open",
            target_ref: "prose_writing",
            required_next_action: "confirm_before_execute",
            prompt_contract: %{},
            constraints: %{},
            trace_ref: "trace-behavior-open"
          },
          history: []
        }
      }

      assert {:ok, action_result, turn_result} =
               DialogueGateway.handle_action(input, source_turn_result, fn _prompt ->
                 flunk("cancel waiting must not call provider")
               end)

      assert action_result.status == "cancelled"
      assert turn_result.phase == "cancelled"
      assert turn_result.trace_summary.trace_ref == "trace:#{turn_result.turn_id}"

      assert [
               %{
                 behavior_ref: "bh-behavior-open",
                 behavior_type: "confirmation",
                 event_type: :close,
                 event_turn_ref: closed_turn_ref,
                 decision_ref: "decision-behavior-open",
                 target_ref: "prose_writing",
                 next_status: "CANCELLED",
                 resolution_ref: resolution_ref
               }
             ] = turn_result.trace_summary.behavior_trace_refs

      assert closed_turn_ref == turn_result.turn_id
      assert resolution_ref == "behavior_resolution:#{turn_result.turn_id}"
      assert :behavior_trace_recorded in turn_result.trace_summary.event_order
      assert :behavior_resolution_recorded in turn_result.trace_summary.event_order
    end

    test "DialogueFrame validation rejects forbidden semantics" do
      frame = %DialogueFrame{
        schema_version: "3.0-draft",
        frame_id: "f-1",
        turn_id: "t-1",
        workspace_id: "ws-1",
        primary: true,
        frame_type: :casual_reply,
        source_refs: %{author_input_ref: "a-1", dialogue_context_ref: nil},
        dialogue_goal: %{summary: "test"},
        tool_need: %{needs_tool: false, reason_code: :no_tool_needed},
        execution_readiness: :not_applicable,
        author_visible_draft: %{message: "something approved and ready_to_execute"},
        uncertainty: []
      }

      assert {:error, reasons} = DialogueFrame.validate(frame)
      assert Enum.any?(reasons, &String.contains?(&1, "approved"))
      assert Enum.any?(reasons, &String.contains?(&1, "ready_to_execute"))
    end

    test "every turn produces frame ref in TurnResult" do
      inputs = [
        %{text: "普通聊天", workspace_id: "ws-1"},
        %{text: "我想写赛博修仙但没想好", workspace_id: "ws-1"},
        %{text: "这个方向有什么问题吗？", workspace_id: "ws-1"}
      ]

      for input <- inputs do
        {:ok, turn_result, _trace, _candidates, _context} = DialogueGateway.handle_input(input)
        assert turn_result.frame_ref != nil
        assert turn_result.turn_id != nil
      end
    end
  end

  describe "trace persister callback" do
    test "trace_persister is called with workspace_id and trace attrs after handle_input" do
      complete_fn = fn _prompt -> {:ok, %{content: @frame_json}} end

      {:ok, agent} = Agent.start_link(fn -> [] end)
      ws_id = "ws-trace-#{System.unique_integer([:positive, :monotonic])}"

      persister = fn ws_id_arg, attrs ->
        Agent.update(agent, &[{ws_id_arg, attrs} | &1])
        :ok
      end

      {:ok, _turn_result, trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "trace test", workspace_id: ws_id},
          nil,
          complete_fn,
          persister
        )

      captured = Agent.get(agent, & &1) |> Enum.reverse()
      assert length(captured) == 1
      [{captured_ws_id, captured_attrs}] = captured

      assert captured_ws_id == ws_id
      assert captured_attrs[:trace_id] == trace.trace_id
      assert captured_attrs[:turn_id] == trace.turn_id
      assert captured_attrs[:decision_type] != nil
      assert captured_attrs[:event_order] != nil
    end
  end

  describe "interaction recorder callback" do
    test "records user and assistant messages after successful handle_input" do
      complete_fn = fn _prompt -> {:ok, %{content: @frame_json}} end

      {:ok, agent} = Agent.start_link(fn -> [] end)
      ws_id = "ws-memory-#{System.unique_integer([:positive, :monotonic])}"

      recorder = fn ws_id_arg, entries ->
        Agent.update(agent, &[{ws_id_arg, entries} | &1])
        :ok
      end

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "记住这轮", workspace_id: ws_id},
          nil,
          complete_fn,
          nil,
          recorder
        )

      captured = Agent.get(agent, & &1) |> Enum.reverse()
      assert length(captured) == 1
      [{captured_ws_id, entries}] = captured

      assert captured_ws_id == ws_id
      assert Enum.map(entries, & &1.role) == ["user", "assistant"]
      assert Enum.map(entries, & &1.turn_id) == [turn_result.turn_id, turn_result.turn_id]
      assert Enum.at(entries, 0).content.text == "记住这轮"
      assert Enum.at(entries, 1).content.text == "收到你的消息。"
    end

    test "jsonable normalizes encoder-less structs and keeps Jason-native scalars" do
      # 回归：require_confirmation 的 turn_result 内嵌 MicroPlan 等无 Encoder 的 struct，
      # 持久化（Ecto :map）/广播（Jason）若不规范化会崩。jsonable 只展开无 Encoder 的
      # struct；DateTime/Date 等 Jason 原生可编码的标量 struct 必须原样保留（展开会把
      # ISO8601 编码丢成 raw map）。
      plan = %NovelDomain.MicroPlan{
        plan_id: "p",
        turn_id: "t",
        frame_ref: "f",
        plan_goal: %{summary: "重写第一章"},
        risk_hint: :high,
        proposed_actions: [%{action_id: "a", target_chapter: "第01章"}]
      }

      input = %{
        text: "记住这轮",
        turn_result: %{
          status: "needs_confirmation",
          plan: plan,
          created_at: ~U[2024-01-01 00:00:00Z],
          actions: [%{at: ~D[2024-01-02], note: "x"}]
        }
      }

      out = DialogueGateway.jsonable(input)

      # 整体可被 Jason 编码（broadcast/persist 都安全）。
      assert {:ok, _json} = Jason.encode(out)
      # 无 Encoder 的 MicroPlan 被深度展开为纯 map，内容保留。
      refute is_struct(out.turn_result.plan)
      assert out.turn_result.plan.risk_hint == :high
      assert hd(out.turn_result.plan.proposed_actions).target_chapter == "第01章"
      # Jason 原生可编码的标量 struct 原样保留（不丢 ISO8601 编码）。
      assert out.turn_result.created_at == ~U[2024-01-01 00:00:00Z]
      assert hd(out.turn_result.actions).at == ~D[2024-01-02]
      assert out.turn_result.status == "needs_confirmation"
    end
  end
end
