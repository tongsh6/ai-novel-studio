defmodule NovelApplication.ToolProvenanceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Toolbox
  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.Planner
  alias NovelApplication.TurnExecutionService
  alias NovelCommon.Contracts.CapabilityRegistryEntry
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  # ── Registry ──────────────────────────────────

  describe "CapabilityRegistry" do
    test "lists registered tools" do
      tools = CapabilityRegistry.list()
      assert "text_analysis" in tools
      assert "character_roster" in tools
      assert "disabled_tool" in tools
      refute ("creative_" <> "generation") in tools
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
      assert CapabilityRegistry.grants_valid?("character_roster", ["character_list"], [])
      refute CapabilityRegistry.grants_valid?("text_analysis", ["admin_access"], [])
    end

    test "grants_valid? rejects write scopes for read-only tool" do
      refute CapabilityRegistry.grants_valid?("text_analysis", [], ["production_write"])
      refute CapabilityRegistry.grants_valid?("character_roster", [], ["character_profile"])
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
        tool_request_id: "tq-unknown",
        turn_id: "t",
        frame_ref: "f",
        decision_ref: "d",
        tool_name: "nonexistent",
        tool_version: "1",
        input: %{},
        read_scope_grants: [],
        write_scope_grants: [],
        idempotency_key: "idem",
        created_at: DateTime.utc_now()
      }

      result = Toolbox.execute(req)
      assert result.status == :failed
      assert result.errors != []
    end

    test "rejects disabled tool" do
      req = %ToolRequest{
        tool_request_id: "tq-disabled",
        turn_id: "t",
        frame_ref: "f",
        decision_ref: "d",
        tool_name: "disabled_tool",
        tool_version: "1",
        input: %{},
        read_scope_grants: [],
        write_scope_grants: [],
        idempotency_key: "idem",
        created_at: DateTime.utc_now()
      }

      result = Toolbox.execute(req)
      assert result.status == :failed
      assert Enum.any?(result.errors, &(&1.code == "tool_not_dispatchable"))
    end

    test "rejects grant scope violation" do
      req = %ToolRequest{
        tool_request_id: "tq-scope",
        turn_id: "t",
        frame_ref: "f",
        decision_ref: "d",
        tool_name: "text_analysis",
        tool_version: "1",
        input: %{},
        read_scope_grants: ["admin_access"],
        write_scope_grants: [],
        idempotency_key: "idem",
        created_at: DateTime.utc_now()
      }

      result = Toolbox.execute(req)
      assert result.status == :failed
      assert Enum.any?(result.errors, &(&1.code == "grant_scope_violation"))
    end

    test "ToolResult not adoption — result has no production fact" do
      req = %ToolRequest{
        tool_request_id: "tq-adopt",
        turn_id: "t",
        frame_ref: "f",
        decision_ref: "d",
        tool_name: "text_analysis",
        tool_version: "1",
        input: %{"text" => "test content"},
        read_scope_grants: ["author_text"],
        write_scope_grants: [],
        idempotency_key: "idem",
        created_at: DateTime.utc_now()
      }

      result = Toolbox.execute(req)

      assert result.status == :succeeded
      # state_delta is observation, not production write
      refute Enum.any?(result.state_delta, &(&1[:type] == :production_write))
      # artifact_refs is empty (no artifacts created)
      assert result.artifact_refs == []
    end

    test "character_roster returns scoped read-only character facts" do
      req = %ToolRequest{
        tool_request_id: "tq-character-roster",
        turn_id: "t",
        frame_ref: "f",
        decision_ref: "d",
        tool_name: "character_roster",
        tool_version: "1.0.0",
        input: %{
          "characters" => [
            %{
              id: "internal-id-not-output",
              name: "林澈",
              role: "主角",
              summary: "追查灵源矿区真相",
              aliases: ["林烬"],
              status: "ACCEPTED"
            }
          ]
        },
        read_scope_grants: ["character_list"],
        write_scope_grants: [],
        idempotency_key: "idem",
        created_at: DateTime.utc_now()
      }

      result = Toolbox.execute(req)

      assert result.status == :succeeded
      assert result.tool_name == "character_roster"
      assert result.state_delta == []
      assert result.artifact_refs == []
      assert result.output.character_count == 1

      assert [%{name: "林澈", role: "主角", summary: "追查灵源矿区真相"}] =
               result.output.characters

      refute inspect(result.output) =~ "internal-id-not-output"
    end
  end

  # ── ToolRequest invariants ────────────────────

  describe "ToolRequest invariants" do
    test "ToolRequest must have decision_ref" do
      # ToolRequest struct requires decision_ref in @enforce_keys
      assert_raise ArgumentError, fn ->
        struct!(ToolRequest,
          tool_request_id: "x",
          turn_id: "x",
          frame_ref: "x",
          tool_name: "x",
          tool_version: "1"
        )
      end
    end

    test "decision_ref links request to orchestrator decision" do
      decision_id = "decision-123"

      req = %ToolRequest{
        tool_request_id: "tq-link",
        turn_id: "t",
        frame_ref: "f",
        decision_ref: decision_id,
        tool_name: "text_analysis",
        tool_version: "1.0.0",
        idempotency_key: "idem",
        created_at: DateTime.utc_now()
      }

      assert req.decision_ref == decision_id
    end
  end

  # ── OrchestratorDecision allow_tool ────────────

  describe "OrchestratorDecision allow_tool" do
    test "allow_tool decision has no blocking gate" do
      decision = %OrchestratorDecision{
        decision_id: "d-allow",
        turn_id: "t",
        frame_ref: "f",
        decision_type: :allow_tool,
        decision_status: :decided,
        reason_codes: ["gates_passed", "tool:text_analysis"]
      }

      refute OrchestratorDecision.blocks_execution?(decision)
      assert decision.first_blocking_gate == nil
    end

    test "truthfulness_constraints for allow_tool include result_not_adoption" do
      decision = %OrchestratorDecision{
        decision_id: "d",
        turn_id: "t",
        frame_ref: "f",
        decision_type: :allow_tool,
        decision_status: :decided,
        reason_codes: []
      }

      constraints = OrchestratorDecision.truthfulness_constraints(decision)
      assert "result_not_adoption" in constraints
    end
  end

  # ── checkpoint 2：续写连贯（prose_writing 带本章已采纳正文，基于前文衔接）──

  describe "TurnExecutionService continuation continuity" do
    @prior "林澈拔出阵钉，黑暗骤然裂开一线幽蓝，照亮墙上密密麻麻、尚未结清的灵气欠条。"

    test "continuation prose_writing prompt includes target chapter prior prose" do
      tool_prompt =
        first_tool_prompt(:continuation, "第01章：底层灵气账单", "接着第一章往下写", fn _w, _t ->
          @prior
        end)

      assert tool_prompt =~ "本章已采纳正文"
      assert tool_prompt =~ "衔接续写"
      assert tool_prompt =~ @prior
    end

    test "rewrite prose_writing prompt includes prior prose with rewrite framing" do
      tool_prompt =
        first_tool_prompt(:rewrite, "第01章：底层灵气账单", "第一章太平淡，推翻重写", fn _w, _t ->
          @prior
        end)

      assert tool_prompt =~ "基于它重写整章"
      assert tool_prompt =~ @prior
    end

    test "new chapter (no authoring_intent) does not pull prior prose" do
      # reader 返回前文，但非续写/重写意图不应消费它
      tool_prompt =
        first_tool_prompt(nil, nil, "写第二章的开篇正文", fn _w, _t -> @prior end)

      refute tool_prompt =~ "本章已采纳正文"
      refute tool_prompt =~ @prior
    end

    test "continuation with empty prior prose adds no section" do
      tool_prompt =
        first_tool_prompt(:continuation, "第01章：底层灵气账单", "接着往下写", fn _w, _t -> "" end)

      refute tool_prompt =~ "本章已采纳正文"
    end

    test "long prior prose is trimmed to the recent tail (small-context model safety)" do
      # 3000 字前文：注入必须只保留末尾（衔接只需最近文脉），并标注省略。
      early = String.duplicate("早", 1000)
      late = String.duplicate("近", 2000)

      tool_prompt =
        first_tool_prompt(:continuation, "第01章：底层灵气账单", "接着往下写", fn _w, _t ->
          early <> late
        end)

      assert tool_prompt =~ "最近的部分"
      assert tool_prompt =~ String.duplicate("近", 100)
      refute tool_prompt =~ "早早"
    end

    test "continuation falls back to latest accepted chapter when target_chapter missing" do
      # 真实 LLM 常识别出 continuation 意图但漏掉 target_chapter；应用层用 current_chapters 回退到最新章。
      {:ok, prompts} = Agent.start_link(fn -> [] end)
      # reader 只对最新章（第02章）返回前文
      reader = fn _w, "第02章：宗门试炼" -> @prior end

      complete_fn = fn prompt ->
        Agent.update(prompts, &[prompt | &1])

        {:ok,
         %{
           content:
             Jason.encode!([
               %{"item_id" => "i1", "title" => "续写", "body" => "新场景", "rationale" => nil}
             ])
         }}
      end

      context = %NovelDomain.DialogueContext{
        workspace_id: "work-cont",
        current_chapters: ["第01章：底层灵气账单", "第02章：宗门试炼"]
      }

      {turn_result, _trace} =
        TurnExecutionService.execute(%{
          frame: continuity_frame(),
          plan: continuity_plan(:continuation, nil),
          decision: allow_decision(),
          context: context,
          author_input: %{text: "接着往下写"},
          complete_fn: complete_fn,
          chapter_prose_reader: reader
        })

      tool_prompt = prompts |> Agent.get(&Enum.reverse/1) |> List.first()
      assert tool_prompt =~ "本章已采纳正文"
      assert tool_prompt =~ @prior

      # 采纳归章也用回退后的最新章，保证读前文的章与采纳归入的章一致
      [pending] = turn_result.adoption_state.pending
      assert pending.target_chapter == "第02章：宗门试炼"
    end

    test "prose_writing prompt carries author target word count into creative brief" do
      tool_prompt = first_tool_prompt_with_word_count(800)
      assert tool_prompt =~ "目标字数：约 800 字"
    end

    test "no target word count leaves brief without a concrete word count line" do
      # 写作要求里有占位符引导句"目标字数：约 N 字"，故只断言不出现具体数字的字数行。
      tool_prompt = first_tool_prompt_with_word_count(nil)
      refute tool_prompt =~ ~r/目标字数：约\s*\d+\s*字/
    end

    defp first_tool_prompt_with_word_count(word_count) do
      {:ok, prompts} = Agent.start_link(fn -> [] end)

      complete_fn = fn prompt ->
        Agent.update(prompts, &[prompt | &1])

        {:ok,
         %{
           content:
             Jason.encode!([
               %{"item_id" => "i1", "title" => "开篇", "body" => "正文", "rationale" => nil}
             ])
         }}
      end

      action =
        %{
          action_id: "act-wc",
          action_type: :capability_invocation,
          summary: "生成一段正文草稿",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low
        }
        |> maybe_put(:target_word_count, word_count)

      plan = %MicroPlan{
        plan_id: "plan-wc",
        turn_id: "turn-cont",
        frame_ref: "frame-cont",
        plan_goal: %{summary: "写正文"},
        risk_hint: :low,
        proposed_actions: [action]
      }

      TurnExecutionService.execute(%{
        frame: continuity_frame(),
        plan: plan,
        decision: allow_decision(),
        author_input: %{text: "写约800字的开篇"},
        complete_fn: complete_fn
      })

      prompts |> Agent.get(&Enum.reverse/1) |> List.first()
    end

    defp first_tool_prompt(intent, chapter, author_text, reader) do
      {:ok, prompts} = Agent.start_link(fn -> [] end)

      complete_fn = fn prompt ->
        Agent.update(prompts, &[prompt | &1])

        {:ok,
         %{
           content:
             Jason.encode!([
               %{"item_id" => "i1", "title" => "续写", "body" => "新场景", "rationale" => nil}
             ])
         }}
      end

      TurnExecutionService.execute(%{
        frame: continuity_frame(),
        plan: continuity_plan(intent, chapter),
        decision: allow_decision(),
        author_input: %{text: author_text},
        complete_fn: complete_fn,
        chapter_prose_reader: reader
      })

      prompts |> Agent.get(&Enum.reverse/1) |> List.first()
    end

    defp continuity_frame do
      %DialogueFrame{
        schema_version: "3.0-draft",
        frame_id: "frame-cont",
        turn_id: "turn-cont",
        workspace_id: "work-cont",
        primary: true,
        frame_type: :execution_candidate,
        source_refs: %{},
        dialogue_goal: %{summary: "续写本章"},
        tool_need: %{needs_tool: true, reason_code: :tool_needed},
        execution_readiness: :ready,
        author_visible_draft: %{message: "好的，我来续写。"},
        evidence_summary: %{},
        uncertainty: []
      }
    end

    defp continuity_plan(intent, chapter) do
      action =
        %{
          action_id: "act-cont",
          action_type: :capability_invocation,
          summary: "生成一段正文草稿",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low
        }
        |> maybe_put(:authoring_intent, intent)
        |> maybe_put(:target_chapter, chapter)

      %MicroPlan{
        plan_id: "plan-cont",
        turn_id: "turn-cont",
        frame_ref: "frame-cont",
        plan_goal: %{summary: "续写"},
        risk_hint: :low,
        proposed_actions: [action]
      }
    end

    defp maybe_put(map, _key, nil), do: map
    defp maybe_put(map, key, value), do: Map.put(map, key, value)

    defp allow_decision do
      %OrchestratorDecision{
        decision_id: "d-allow",
        turn_id: "turn-cont",
        frame_ref: "frame-cont",
        decision_type: :allow_tool,
        decision_status: :decided,
        reason_codes: ["gates_passed", "tool:prose_writing"]
      }
    end
  end

  describe "Planner target_word_count parsing" do
    test "parses author target word count from LLM action" do
      {:ok, plan} = plan_from_action(%{"target_word_count" => 800})
      assert hd(plan.proposed_actions).target_word_count == 800
    end

    test "missing target word count yields nil" do
      {:ok, plan} = plan_from_action(%{})
      assert hd(plan.proposed_actions).target_word_count == nil
    end

    test "string target word count is parsed to integer" do
      {:ok, plan} = plan_from_action(%{"target_word_count" => "600"})
      assert hd(plan.proposed_actions).target_word_count == 600
    end

    test "absurd target word count is clamped to upper bound" do
      {:ok, plan} = plan_from_action(%{"target_word_count" => 999_999})
      assert hd(plan.proposed_actions).target_word_count == 20_000
    end

    defp plan_from_action(extra) do
      action =
        Map.merge(
          %{
            "action_id" => "act-1",
            "action_type" => "capability_invocation",
            "summary" => "写开篇正文",
            "target_ref" => "prose_writing",
            "write_intent" => "tentative",
            "risk_hint" => "low",
            "authoring_intent" => "none",
            "target_chapter" => nil
          },
          extra
        )

      complete_fn = fn _prompt ->
        {:ok,
         %{
           content:
             Jason.encode!(%{
               "plan_goal_summary" => "写正文",
               "risk_hint" => "low",
               "proposed_actions" => [action],
               "required_capabilities" => ["prose_writing"],
               "fallback_message" => "降级对话"
             })
         }}
      end

      Planner.form_micro_plan(plan_frame(), %{text: "写约800字的开篇"}, complete_fn)
    end

    defp plan_frame do
      %DialogueFrame{
        schema_version: "3.0-draft",
        frame_id: "frame-wc",
        turn_id: "turn-wc",
        workspace_id: "work-wc",
        primary: true,
        frame_type: :execution_candidate,
        source_refs: %{},
        dialogue_goal: %{summary: "写正文"},
        tool_need: %{needs_tool: true, reason_code: :tool_needed},
        execution_readiness: :ready,
        author_visible_draft: %{message: "好的"},
        evidence_summary: %{},
        uncertainty: []
      }
    end
  end
end
