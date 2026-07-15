defmodule NovelApplication.DecisionSurfaceCardContractTest do
  @moduledoc """
  DS01 决策面卡片契约测试（ADR-0024 决策 2/3，不变量 N-SURF）。

  保护两条契约：
  1. 生产代码产出的 card_type 只能属于注册集合
     candidate_set / confirmation_card / result_card（07 §4.2）；
  2. ui_cards 是信息通告 lane，卡片结构不携带可提交动作字段（actions），
     可提交动作唯一来源是 available_actions（00c §7 #10 / #18）。

  Schema SSOT：docs/design/schemas/foundation/ui_card.json。
  """

  use ExUnit.Case, async: true

  alias NovelApplication.TurnResultBuilder
  alias NovelDomain.BehaviorState
  alias NovelDomain.TentativeArtifactSet

  @registered_card_types ~w(candidate_set confirmation_card result_card)

  # ── 运行时契约：TurnResultBuilder 产出 ────────────────────

  test "artifact 卡片在注册集合内且不携带 actions 字段" do
    turn_result =
      TurnResultBuilder.build(
        frame("turn-ds01-artifact"),
        %{trace_ref: "trace-ds01"},
        [],
        nil,
        nil,
        artifact_set("turn-ds01-artifact"),
        nil
      )

    assert [card] = turn_result.ui_cards
    assert card.card_type == "candidate_set"
    assert_card_contract(card)
  end

  test "confirmation 卡片在注册集合内且不携带 actions 字段" do
    behavior = %BehaviorState{
      behavior_id: "bhv-ds01",
      behavior_type: :confirmation,
      lifecycle_status: :open,
      opened_at_turn_ref: "turn-ds01-confirm",
      opened_by_decision_ref: "dec-ds01",
      frame_ref: "frame-ds01",
      required_next_action: "confirm_before_execute",
      prompt_contract: %{question: "确认把该候选写入作品档案吗？"},
      target_ref: "art-ds01"
    }

    turn_result =
      TurnResultBuilder.build(
        frame("turn-ds01-confirm"),
        %{trace_ref: "trace-ds01"},
        [],
        nil,
        nil,
        nil,
        behavior
      )

    assert [card] = turn_result.ui_cards
    assert card.card_type == "confirmation_card"
    assert_card_contract(card)
  end

  test "修订草稿卡片在注册集合内且不携带 actions 字段" do
    revision_set = %TentativeArtifactSet{
      artifact_set_id: "as-ds01-rev",
      artifact_type: :prose_fragment,
      source_turn_ref: "turn-ds01-rev",
      source_tool_result_ref: "tr-ds01-rev",
      items: [item("rev-1")],
      revision_base: "as-ds01-base",
      revision_reason: "quality_findings",
      quality_finding_refs: ["qf-1"]
    }

    turn_result = TurnResultBuilder.revision_turn_result("turn-parent", revision_set)

    assert [card] = turn_result.ui_cards
    assert card.card_type == "candidate_set"
    assert card.revision_of == "as-ds01-base"
    assert_card_contract(card)
  end

  # ── 源码级契约：整个 umbrella 的 card_type 字面量注册 ────────────────────

  test "生产代码所有 card_type 字面量均在注册集合内" do
    offenders =
      production_sources()
      |> Enum.flat_map(fn path ->
        ~r/card_type:\s*"([a-z_]+)"/
        |> Regex.scan(File.read!(path), capture: :all_but_first)
        |> List.flatten()
        |> Enum.reject(&(&1 in @registered_card_types))
        |> Enum.map(&{path, &1})
      end)

    assert offenders == [],
           "发现未注册的 card_type 产出（需先修订 ADR-0024 决策 3 与 07 §4.2）：#{inspect(offenders)}"
  end

  test "卡片构造源码不携带 actions 字段（available_actions 除外）" do
    offenders =
      production_sources()
      |> Enum.filter(fn path ->
        source = File.read!(path)

        String.contains?(source, "card_type:") and
          Regex.match?(~r/(?<![a-z_])actions:\s*\[/, source)
      end)

    assert offenders == [],
           "卡片产出文件中发现裸 actions 字段（N-SURF 违规）：#{inspect(offenders)}"
  end

  # ── helpers ────────────────────

  defp assert_card_contract(card) do
    assert card.card_type in @registered_card_types
    refute Map.has_key?(card, :actions)
    refute Map.has_key?(card, "actions")
  end

  defp production_sources do
    __DIR__
    |> Path.join("../../../../apps/*/lib/**/*.ex")
    |> Path.expand()
    |> Path.wildcard()
  end

  defp frame(turn_id) do
    %NovelDomain.DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-#{turn_id}",
      turn_id: turn_id,
      workspace_id: "ws",
      primary: true,
      frame_type: :casual_reply,
      source_refs: %{},
      dialogue_goal: %{summary: "测试"},
      tool_need: %{needs_tool: false, reason_code: :no_tool_needed},
      execution_readiness: :not_applicable,
      author_visible_draft: %{message: "测试"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp artifact_set(turn_id) do
    %TentativeArtifactSet{
      artifact_set_id: "as-#{turn_id}",
      artifact_type: :character_seed,
      source_turn_ref: turn_id,
      source_tool_result_ref: "tr-#{turn_id}",
      items: [item("c1")]
    }
  end

  defp item(id) do
    %{item_id: id, title: "标题-#{id}", body: "正文-#{id}", rationale: nil}
  end
end
