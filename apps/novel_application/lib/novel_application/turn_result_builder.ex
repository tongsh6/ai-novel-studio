defmodule NovelApplication.TurnResultBuilder do
  @moduledoc """
  从 DialogueFrame 构建 v3 TurnResult。覆盖 reply_only、exploration、tool、artifact、behavior 全场景。
  """

  alias NovelApplication.AvailableActionBuilder
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.BehaviorState
  alias NovelDomain.CandidateDirection
  alias NovelDomain.DialogueFrame
  alias NovelDomain.OrchestratorDecision
  alias NovelDomain.TentativeArtifactSet

  @spec build(
          DialogueFrame.t(),
          map(),
          [CandidateDirection.t()],
          OrchestratorDecision.t() | nil,
          ToolResult.t() | nil,
          TentativeArtifactSet.t() | nil,
          BehaviorState.t() | nil
        ) :: map()
  def build(
        %DialogueFrame{} = frame,
        trace_summary,
        candidates \\ [],
        decision \\ nil,
        tool_result \\ nil,
        artifact_set \\ nil,
        behavior \\ nil
      ) do
    result = %{
      schema_version: "3.0-draft",
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      assistant_message: %{text: frame.author_visible_draft.message},
      ui_cards: [],
      frame_summary: %{
        frame_type: frame.frame_type,
        dialogue_goal: frame.dialogue_goal.summary
      },
      trace_summary: trace_summary,
      phase: build_phase(behavior, tool_result),
      status: build_status(behavior, decision, tool_result),
      available_actions:
        AvailableActionBuilder.build(
          frame: frame,
          candidates: candidates,
          artifact_set: artifact_set,
          behavior: behavior
        ),
      truthfulness: build_truthfulness(frame, decision, tool_result)
    }

    result
    |> maybe_add_candidates(frame, candidates)
    |> maybe_add_decision(decision)
    |> maybe_add_tool_result(tool_result)
    |> maybe_add_artifacts(artifact_set)
    |> maybe_add_behavior(behavior)
  end

  # ── phase / status ────────────────────────────

  defp build_phase(nil, %ToolResult{status: :failed}), do: "failed"
  defp build_phase(nil, _tool_result), do: "completed"
  defp build_phase(%BehaviorState{lifecycle_status: :open}, _), do: "awaiting_author"
  defp build_phase(%BehaviorState{lifecycle_status: :awaiting_author}, _), do: "awaiting_author"
  defp build_phase(%BehaviorState{lifecycle_status: :resolving}, _), do: "completed"
  defp build_phase(%BehaviorState{lifecycle_status: :resolved}, _), do: "completed"
  defp build_phase(%BehaviorState{lifecycle_status: :cancelled}, _), do: "cancelled"
  defp build_phase(%BehaviorState{lifecycle_status: :failed}, _), do: "failed"
  defp build_phase(_, _), do: "completed"

  defp build_status(nil, _decision, %ToolResult{status: :failed}), do: "failed"
  defp build_status(nil, _decision, _tool_result), do: "conversational"

  defp build_status(%BehaviorState{behavior_type: :clarification, lifecycle_status: s}, _, _)
       when s in [:open, :awaiting_author], do: "needs_clarification"

  defp build_status(%BehaviorState{behavior_type: :confirmation, lifecycle_status: s}, _, _)
       when s in [:open, :awaiting_author], do: "needs_confirmation"

  defp build_status(%BehaviorState{lifecycle_status: :cancelled}, _, _), do: "cancelled"
  defp build_status(_, _, _), do: "conversational"

  # ── truthfulness ──────────────────────────────

  defp build_truthfulness(_frame, nil, nil) do
    %{
      tool_called: false,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false
    }
  end

  defp build_truthfulness(_frame, nil, %ToolResult{} = tr) do
    %{
      tool_called: true,
      tool_status: tr.status,
      tool_name: tr.tool_name,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false
    }
  end

  defp build_truthfulness(_frame, %OrchestratorDecision{} = decision, nil) do
    blocked = OrchestratorDecision.blocks_execution?(decision)

    %{
      tool_called: false,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened:
        blocked and decision.decision_type in [:require_clarification, :require_confirmation],
      execution_blocked: blocked,
      decision_type: decision.decision_type,
      first_blocking_gate: decision.first_blocking_gate,
      reason_codes: decision.reason_codes
    }
  end

  defp build_truthfulness(_frame, %OrchestratorDecision{} = d, %ToolResult{} = tr) do
    %{
      tool_called: true,
      tool_status: tr.status,
      tool_name: tr.tool_name,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false,
      decision_type: d.decision_type,
      first_blocking_gate: d.first_blocking_gate,
      reason_codes: d.reason_codes
    }
  end

  # ── optional sections ─────────────────────────

  defp maybe_add_candidates(r, _frame, []), do: r

  defp maybe_add_candidates(r, _frame, c),
    do: Map.put(r, :candidate_directions, format_candidates(c))

  defp maybe_add_decision(r, nil), do: r

  defp maybe_add_decision(r, d) do
    Map.put(r, :orchestrator_decision, %{
      decision_id: d.decision_id,
      decision_type: d.decision_type,
      decision_status: d.decision_status,
      first_blocking_gate: d.first_blocking_gate,
      required_author_action: d.required_author_action
    })
  end

  defp maybe_add_tool_result(r, nil), do: r

  defp maybe_add_tool_result(r, tr) do
    Map.put(r, :tool_result, %{
      tool_result_id: tr.tool_result_id,
      tool_name: tr.tool_name,
      status: tr.status,
      output: tr.output,
      errors: tr.errors,
      warnings: tr.warnings,
      state_delta: tr.state_delta
    })
  end

  defp maybe_add_artifacts(r, nil), do: r

  defp maybe_add_artifacts(r, as) do
    payload = artifact_payload(as)

    adoption_state = %{
      pending: [
        %{
          artifact_id: as.artifact_set_id,
          artifact_type: as.artifact_type,
          requires_adoption: true,
          payload: payload,
          adoption_status: as.adoption_status,
          source_tool_result_ref: as.source_tool_result_ref,
          authoring_intent: as.authoring_intent,
          target_chapter: as.target_chapter
        }
      ],
      resolved: []
    }

    candidate_set_card = %{
      card_type: "candidate_set",
      priority: "high",
      visibility: "always",
      title: artifact_payload_title(as),
      body: artifact_card_body(as),
      artifact_refs: [as.artifact_set_id],
      candidate_set_ref: as.artifact_set_id,
      artifact_type: as.artifact_type,
      items: as.items,
      tentative: true
    }

    r
    |> Map.put(:adoption_state, adoption_state)
    |> Map.update(:ui_cards, [candidate_set_card], fn cards -> cards ++ [candidate_set_card] end)
  end

  defp artifact_payload(%TentativeArtifactSet{} = as) do
    %{
      items: as.items,
      title: artifact_payload_title(as),
      item_count: length(as.items)
    }
    |> maybe_put_chapter_count(as)
  end

  defp maybe_put_chapter_count(payload, %{artifact_type: :outline_draft} = as),
    do: Map.put(payload, :chapter_count, length(as.items))

  defp maybe_put_chapter_count(payload, _as), do: payload

  defp artifact_payload_title(%{artifact_type: type, target_chapter: chapter})
       when type in [:prose_fragment, "prose_fragment"] and is_binary(chapter) and chapter != "",
       do: "#{chapter}正文草稿"

  defp artifact_payload_title(%{artifact_type: type})
       when type in [:prose_fragment, "prose_fragment"],
       do: "章节正文草稿"

  defp artifact_payload_title(%{artifact_type: type})
       when type in [:outline_draft, "outline_draft"],
       do: "大纲草稿"

  defp artifact_payload_title(%{artifact_type: type})
       when type in [:character_seed, "character_seed"],
       do: "角色设定草稿"

  defp artifact_payload_title(%{artifact_type: type})
       when type in [:foreshadowing_seed, "foreshadowing_seed"],
       do: "伏笔草稿"

  defp artifact_payload_title(%{artifact_type: type})
       when type in [
              :world_rule_seed,
              "world_rule_seed",
              :style_rule_seed,
              "style_rule_seed",
              :constraint_seed,
              "constraint_seed"
            ],
       do: "规则草稿"

  defp artifact_payload_title(%{artifact_type: type})
       when type in [:world_setting, "world_setting"],
       do: "世界设定草稿"

  defp artifact_payload_title(_as), do: "待保存草稿"

  defp artifact_card_body(%{items: items} = as) do
    preview =
      items
      |> Enum.take(3)
      |> Enum.map_join("；", &item_title/1)
      |> case do
        nil -> ""
        "" -> ""
        text -> "预览：#{String.slice(text, 0, 120)}"
      end

    "#{artifact_save_hint(as)}#{preview}"
  end

  defp artifact_save_hint(%{artifact_type: type})
       when type in [:prose_fragment, "prose_fragment"],
       do: "这是待保存章节草稿。确认保存后会写入章节正文；未保存前不会进入阅读模式或作品事实。"

  defp artifact_save_hint(%{artifact_type: type}) when type in [:outline_draft, "outline_draft"],
    do: "这是待保存大纲草稿。确认保存后会进入作品档案的大纲与结构；未保存前只保留为本轮草稿。"

  defp artifact_save_hint(%{artifact_type: type})
       when type in [
              :character_seed,
              "character_seed",
              :world_setting,
              "world_setting",
              :foreshadowing_seed,
              "foreshadowing_seed",
              :world_rule_seed,
              "world_rule_seed",
              :style_rule_seed,
              "style_rule_seed",
              :constraint_seed,
              "constraint_seed"
            ],
       do: "这是待保存设定草稿。确认保存后会进入作品档案；未保存前不会写入作品事实。"

  defp artifact_save_hint(_as),
    do: "这是待保存草稿。确认保存后才会进入作品档案；未保存前不会写入作品事实。"

  defp item_title(item) when is_map(item),
    do: Map.get(item, :title) || Map.get(item, "title") || ""

  defp item_title(_item), do: ""

  defp maybe_add_behavior(r, nil), do: r

  # behavior_state 形状唯一来源：BehaviorState.snapshot/1（{active, history}，
  # active.status 为 BehaviorStatus 枚举）。本 turn 无 behavior 变化时不加该字段，
  # 保持前端「取最近一个携带 behavior_state 的 turn」语义。
  defp maybe_add_behavior(r, %BehaviorState{} = b) do
    Map.put(r, :behavior_state, BehaviorState.snapshot(b))
  end

  defp format_candidates(candidates) do
    Enum.map(candidates, fn c ->
      %{
        direction_id: c.direction_id,
        title: c.title,
        pitch: c.pitch,
        tone_tags: c.tone_tags,
        risk_hint: c.risk_hint,
        adoption_status: c.adoption_status
      }
    end)
  end
end
