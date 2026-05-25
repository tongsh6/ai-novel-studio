defmodule NovelApplication.CreativeArtifactTest do
  @moduledoc """
  Creative tool 测试集。

  与历史版本（验证 hardcoded items 字符串）相反，本测试集验证 I3 不变量：
  Provider 响应的 items 必须字节透传到 ToolResult.output.items，
  产品代码不允许 hardcoded 创作内容。

  详见 docs/engineering/scenario-invariants.md §2.3。
  """

  use ExUnit.Case, async: true

  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.DialogueGateway
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

  # ── Toolbox creative dispatch（不变量：字节透传） ─────────────────

  describe "creative generation dispatch (I3 byte-passthrough)" do
    test "execute/1 拒绝 LLM-dependent tool — 不可绕过 Provider" do
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req)

      assert result.status == :failed
      assert Enum.any?(result.errors, &(&1.code == "complete_fn_required"))
    end

    test "字节透传：Provider 响应的 items 字段原样出现在 ToolResult.output.items" do
      fixture_items = [
        %{
          "item_id" => "fix_a",
          "title" => "fixture-title-A-7K3Q",
          "body" => "fixture-body-A 含独特标记 7K3Q",
          "rationale" => "fixture-rationale-A"
        },
        %{
          "item_id" => "fix_b",
          "title" => "fixture-title-B-9MX2",
          "body" => "fixture-body-B 含独特标记 9MX2",
          "rationale" => nil
        }
      ]

      complete_fn = fixed_json_provider(fixture_items)
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req, complete_fn)

      assert result.status == :succeeded
      assert result.output.artifact_type == :character_seed
      assert result.output.item_count == 2

      [item_a, item_b] = result.output.items
      assert item_a.item_id == "fix_a"
      assert item_a.title == "fixture-title-A-7K3Q"
      assert item_a.body == "fixture-body-A 含独特标记 7K3Q"
      assert item_a.rationale == "fixture-rationale-A"
      assert item_b.item_id == "fix_b"
      assert item_b.title == "fixture-title-B-9MX2"
      assert item_b.body == "fixture-body-B 含独特标记 9MX2"
      assert item_b.rationale == nil
    end

    test "Provider 返回非 JSON 内容时 ToolResult 为 failed（不冒充成功）" do
      complete_fn = fn _prompt ->
        {:ok, %{content: "这不是合法的 JSON 数组"}}
      end

      req = build_creative_request("character_seed")
      result = Toolbox.execute(req, complete_fn)

      assert result.status == :failed
      assert Enum.any?(result.errors, &(&1.code == "provider_response_invalid"))
    end

    test "Provider 返回空数组时 ToolResult 为 failed" do
      complete_fn = fixed_json_provider([])
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req, complete_fn)
      assert result.status == :failed
    end

    test "Provider 调用失败时 ToolResult 携带 provider_error" do
      complete_fn = fn _prompt -> {:error, %{message: "provider unavailable"}} end
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req, complete_fn)
      assert result.status == :failed
      assert Enum.any?(result.errors, &(&1.code == "provider_error"))
    end

    test "typed plot_outline 通过 execute/2 走 Provider 路径" do
      fixture_items = [
        %{
          "item_id" => "outline_1",
          "title" => "fixture-outline-1",
          "body" => "fixture body 1",
          "rationale" => nil
        }
      ]

      complete_fn = fixed_json_provider(fixture_items)
      req = build_plot_outline_request()

      result = Toolbox.execute(req, complete_fn)

      assert result.status == :succeeded
      assert result.output.artifact_type == :outline_draft
      assert [%{item_id: "outline_1", title: "fixture-outline-1"}] = result.output.items
    end

    test "typed prose_writing 通过 execute/2 走 Provider 路径" do
      fixture_items = [
        %{
          "item_id" => "prose_1",
          "title" => "fixture-prose-1",
          "body" => "fixture prose body",
          "rationale" => nil
        }
      ]

      complete_fn = fixed_json_provider(fixture_items)
      req = build_prose_writing_request()

      result = Toolbox.execute(req, complete_fn)

      assert result.status == :succeeded
      assert result.output.artifact_type == :prose_fragment
      assert [%{title: "fixture-prose-1"}] = result.output.items
    end

    test "成功结果在 state_delta 携带 tentative_artifact" do
      complete_fn = fixed_json_provider([single_item()])
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req, complete_fn)
      assert Enum.any?(result.state_delta, &(&1.type == :tentative_artifact))
    end

    test "artifact_refs 指向 Provider 返回的 item_id" do
      complete_fn = fixed_json_provider([single_item()])
      req = build_creative_request("character_seed")

      result = Toolbox.execute(req, complete_fn)
      assert result.artifact_refs == ["single_item_id"]
    end
  end

  # ── TentativeArtifactSet ──────────────────────

  describe "TentativeArtifactSet" do
    test "build_artifact_set 从 creative ToolResult 字节透传 items" do
      complete_fn = fixed_json_provider([single_item()])
      req = build_creative_request("character_seed")
      result = Toolbox.execute(req, complete_fn)

      artifact_set = TurnResultBuilder.build_artifact_set(result, "turn-1")

      assert %TentativeArtifactSet{} = artifact_set
      assert artifact_set.artifact_type == :character_seed
      assert [%{item_id: "single_item_id", title: "single-title"}] = artifact_set.items
      assert artifact_set.adoption_status == :tentative
      assert artifact_set.source_tool_result_ref == result.tool_result_id
      assert artifact_set.source_turn_ref == "turn-1"
    end

    test "build_artifact_set 保留 typed creative tool 的 artifact_type" do
      complete_fn = fixed_json_provider([single_item()])
      req = build_typed_creative_request("character_design")
      result = Toolbox.execute(req, complete_fn)

      assert result.output.artifact_type == :character_seed

      artifact_set = TurnResultBuilder.build_artifact_set(result, "turn-typed")
      assert artifact_set.artifact_type == :character_seed
    end

    test "tentative? 默认返回 true" do
      artifact_set = %TentativeArtifactSet{
        artifact_set_id: "as-1",
        artifact_type: :character_seed,
        source_turn_ref: "t-1",
        source_tool_result_ref: "tr-1"
      }

      assert TentativeArtifactSet.tentative?(artifact_set)
    end

    test "字节透传后 items 必填字段齐全" do
      complete_fn =
        fixed_json_provider([
          %{
            "item_id" => "i_a",
            "title" => "T-a",
            "body" => "B-a",
            "rationale" => nil
          },
          %{
            "item_id" => "i_b",
            "title" => "T-b",
            "body" => "B-b",
            "rationale" => "R-b"
          }
        ])

      req = build_creative_request("character_seed")
      result = Toolbox.execute(req, complete_fn)
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

    test "tool provenance 把 ToolResult 链接回 ToolRequest" do
      complete_fn = fixed_json_provider([single_item()])
      req = build_creative_request("character_seed")
      result = Toolbox.execute(req, complete_fn)

      assert result.tool_request_ref == req.tool_request_id
      assert result.tool_name == "creative_generation"
    end
  end

  # ── DialogueGateway 主链（带 task_state lifecycle） ────────────────

  describe "sync creative tool task_state events" do
    @frame_json """
    {
      "frame_type": "casual_reply",
      "dialogue_goal_summary": "用户要求创作角色",
      "needs_tool": false,
      "no_tool_reason": "no_tool_needed",
      "execution_readiness": "not_applicable",
      "assistant_message": "收到。",
      "candidate_directions": [],
      "context_used": false,
      "uncertainty": []
    }
    """

    @creative_plan_json """
    {
      "plan_goal_summary": "生成角色设定",
      "risk_hint": "low",
      "requires_confirmation_hint": false,
      "proposed_actions": [
        {"action_id": "a1", "action_type": "capability_invocation", "summary": "创作角色", "target_ref": "creative_generation", "write_intent": "tentative", "risk_hint": "low"}
      ],
      "state_changes_requested": [],
      "required_capabilities": [],
      "fallback_message": "无法生成角色"
    }
    """

    @creative_items_json """
    [
      {"item_id": "fix_main_a", "title": "fixture 角色 A", "body": "fixture body A", "rationale": "fixture R-A"},
      {"item_id": "fix_main_b", "title": "fixture 角色 B", "body": "fixture body B", "rationale": null}
    ]
    """

    test "creative tool turn_result 携带 task_state lifecycle 事件" do
      complete_fn =
        sequenced_complete_fn([@frame_json, @creative_plan_json, @creative_items_json])

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "生成角色设定", workspace_id: "ws-task-state", generate_micro_plan: true},
          nil,
          complete_fn
        )

      phases = Enum.map(turn_result.task_state_events, & &1.phase)
      assert phases == ["RUNNING", "COMPLETED"]

      assert Enum.all?(turn_result.task_state_events, fn event ->
               event.task_id != nil and event.task_type == "creative_generation"
             end)
    end

    test "creative_generation artifact_type 由 input.direction 透传决定" do
      plan_json = """
      {
        "plan_goal_summary": "生成剧情方向",
        "risk_hint": "low",
        "requires_confirmation_hint": false,
        "proposed_actions": [
          {"action_id": "a1", "action_type": "capability_invocation", "summary": "生成剧情方向", "target_ref": "creative_generation", "write_intent": "tentative", "risk_hint": "low"}
        ],
        "state_changes_requested": [],
        "required_capabilities": [],
        "fallback_message": "无法生成剧情方向"
      }
      """

      complete_fn = sequenced_complete_fn([@frame_json, plan_json, @creative_items_json])

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{text: "生成剧情方向", workspace_id: "ws-plot-direction", generate_micro_plan: true},
          nil,
          complete_fn
        )

      # artifact_type 由 dialogue_gateway 推断的 direction 决定，但本测试只验证主链通畅
      assert turn_result.tool_result.output.artifact_type != nil
      assert [%{}] = turn_result.adoption_state.pending
    end

    test "plot_outline turn_result 暴露 adoption payload，items 来自字节透传" do
      plan_json = """
      {
        "plan_goal_summary": "生成章节计划",
        "risk_hint": "low",
        "requires_confirmation_hint": false,
        "proposed_actions": [
          {"action_id": "a1", "action_type": "capability_invocation", "summary": "生成章节计划", "target_ref": "plot_outline", "write_intent": "tentative", "risk_hint": "low"}
        ],
        "state_changes_requested": [],
        "required_capabilities": [],
        "fallback_message": "无法生成章节计划"
      }
      """

      outline_items_json = """
      [
        {"item_id": "fix_ch_01", "title": "fixture 章 01", "body": "fixture 章 01 摘要", "rationale": null},
        {"item_id": "fix_ch_02", "title": "fixture 章 02", "body": "fixture 章 02 摘要", "rationale": null}
      ]
      """

      complete_fn = sequenced_complete_fn([@frame_json, plan_json, outline_items_json])

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{
            text: "生成长篇章节大纲",
            workspace_id: "ws-chapter-plan",
            generate_micro_plan: true
          },
          nil,
          complete_fn
        )

      assert turn_result.tool_result.output.artifact_type == :outline_draft

      assert [
               %{
                 artifact_type: :outline_draft,
                 payload: %{title: title, chapter_count: 2, items: items}
               }
             ] = turn_result.adoption_state.pending

      # UI 标题为通用文案（不变量明确不约束）；items 字节透传自 fixture
      assert title == "章节计划"

      assert [
               %{item_id: "fix_ch_01", title: "fixture 章 01", body: "fixture 章 01 摘要"},
               %{item_id: "fix_ch_02", title: "fixture 章 02"}
             ] = items

      assert [
               %{
                 card_type: "adoption_card",
                 title: "章节计划待采纳",
                 body: body
               }
             ] = turn_result.ui_cards

      # 卡片 body 是通用 UI 文案 + 来自 fixture items 的预览字节
      assert String.contains?(body, "2 项章节计划")
      assert String.contains?(body, "fixture 章 01")
    end

    test "prose_writing turn_result 暴露 chapter draft 卡片，body 来自字节透传" do
      plan_json = """
      {
        "plan_goal_summary": "生成正文草稿",
        "risk_hint": "low",
        "requires_confirmation_hint": false,
        "proposed_actions": [
          {"action_id": "a1", "action_type": "capability_invocation", "summary": "生成正文草稿", "target_ref": "prose_writing", "write_intent": "tentative", "risk_hint": "low"}
        ],
        "state_changes_requested": [],
        "required_capabilities": [],
        "fallback_message": "无法生成正文草稿"
      }
      """

      prose_items_json = """
      [
        {"item_id": "fix_prose_1", "title": "fixture 正文标题", "body": "fixture 正文 body 含 ABCXYZ 标识", "rationale": null}
      ]
      """

      complete_fn = sequenced_complete_fn([@frame_json, plan_json, prose_items_json])

      {:ok, turn_result, _trace, _candidates, _context} =
        DialogueGateway.handle_input(
          %{
            text: "生成正文草稿",
            workspace_id: "ws-prose-card",
            generate_micro_plan: true
          },
          nil,
          complete_fn
        )

      assert turn_result.tool_result.output.artifact_type == :prose_fragment

      assert [
               %{
                 artifact_type: :prose_fragment,
                 payload: %{title: "正文草稿", items: [%{title: "fixture 正文标题"}]}
               }
             ] = turn_result.adoption_state.pending

      assert [
               %{
                 card_type: "adoption_card",
                 title: "正文草稿待采纳",
                 body: body
               }
             ] = turn_result.ui_cards

      assert String.contains?(body, "AI 生成了正文草稿")
      # 字节透传的 fixture body 在卡片 body 预览中出现
      assert String.contains?(body, "ABCXYZ")
    end
  end

  # ── helpers ───────────────────────────────────

  defp build_creative_request(direction) do
    %ToolRequest{
      tool_request_id: "tq-creative-#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "t-creative",
      frame_ref: "f-creative",
      decision_ref: "d-creative",
      tool_name: "creative_generation",
      tool_version: "1.0.0",
      input: %{"direction" => direction, "text" => "fixture user text"},
      read_scope_grants: ["author_text", "context_snapshot"],
      write_scope_grants: [],
      idempotency_key: "idem-creative",
      created_at: DateTime.utc_now()
    }
  end

  defp build_plot_outline_request do
    %ToolRequest{
      tool_request_id: "tq-outline-#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "t-outline",
      frame_ref: "f-outline",
      decision_ref: "d-outline",
      tool_name: "plot_outline",
      tool_version: "1.0.0",
      input: %{"text" => "fixture outline text", "direction" => "outline_draft"},
      read_scope_grants: ["author_text", "plot_summary", "beat_list"],
      write_scope_grants: [],
      idempotency_key: "idem-outline",
      created_at: DateTime.utc_now()
    }
  end

  defp build_prose_writing_request do
    %ToolRequest{
      tool_request_id: "tq-prose-#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "t-prose",
      frame_ref: "f-prose",
      decision_ref: "d-prose",
      tool_name: "prose_writing",
      tool_version: "1.0.0",
      input: %{"text" => "fixture prose text", "direction" => "prose_fragment"},
      read_scope_grants: ["author_text", "chapter_draft", "prose_style_guide"],
      write_scope_grants: [],
      idempotency_key: "idem-prose",
      created_at: DateTime.utc_now()
    }
  end

  defp build_typed_creative_request(tool_name) do
    %ToolRequest{
      tool_request_id: "tq-typed-#{System.unique_integer([:positive, :monotonic])}",
      turn_id: "t-typed",
      frame_ref: "f-typed",
      decision_ref: "d-typed",
      tool_name: tool_name,
      tool_version: "1.0.0",
      input: %{"text" => "fixture typed text", "direction" => tool_name},
      read_scope_grants: ["author_text", "character_list", "relationship_map"],
      write_scope_grants: [],
      idempotency_key: "idem-typed",
      created_at: DateTime.utc_now()
    }
  end

  defp single_item do
    %{
      "item_id" => "single_item_id",
      "title" => "single-title",
      "body" => "single-body",
      "rationale" => nil
    }
  end

  defp fixed_json_provider(items) do
    json = Jason.encode!(items)
    fn _prompt -> {:ok, %{content: json}} end
  end

  defp sequenced_complete_fn(responses) do
    {:ok, agent} = Agent.start_link(fn -> responses end)

    fn _prompt ->
      {:ok, %{content: next_response(agent)}}
    end
  end

  defp next_response(agent) do
    Agent.get_and_update(agent, fn
      [next | rest] -> {next, rest}
      [] -> {"工具执行完成。", []}
    end)
  end
end
