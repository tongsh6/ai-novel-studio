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
        behavior \\ nil,
        opts \\ %{}
      ) do
    candidates = if frame.frame_type == :creative_exploration, do: candidates, else: []

    result = %{
      schema_version: "3.0-draft",
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      assistant_message: %{text: frame.author_visible_draft.message},
      ui_cards: [],
      frame_summary: %{
        frame_type: frame.frame_type,
        dialogue_goal: frame.dialogue_goal.summary,
        frame_origin: frame.evidence_summary[:frame_origin],
        goal_origin: frame.evidence_summary[:goal_origin],
        model_interpretation_status: frame.evidence_summary[:model_interpretation_status]
      },
      trace_summary: trace_summary,
      phase: build_phase(behavior, decision, tool_result),
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
    |> add_exploration_truth(frame)
    |> maybe_add_candidates(frame, candidates)
    |> maybe_add_decision(decision)
    |> maybe_add_tool_result(tool_result)
    |> maybe_add_artifacts(
      artifact_set,
      Map.get(opts, :pending_payload, %{}),
      Map.get(opts, :candidate_title)
    )
    |> maybe_add_behavior(behavior)
  end

  defp add_exploration_truth(result, frame) do
    count = get_in(frame.evidence_summary, [:reply_record, :exploration_call_count]) || 0

    if count > 0 do
      Map.update!(
        result,
        :truthfulness,
        &Map.merge(&1, %{tool_called: true, exploration_call_count: count})
      )
    else
      result
    end
  end

  @doc """
  为一次工具调用产生的多个既有 TentativeArtifactSet 构建同一个 TurnResult。

  设定盘点会同批产角色/规则/伏笔，但每组必须保持原 artifact_type 和采纳语义；
  此函数只合并既有 candidate_set / adoption_state / available_actions，不发明混合类型。
  """
  @spec build_artifact_sets(
          DialogueFrame.t(),
          map(),
          OrchestratorDecision.t() | nil,
          NovelCommon.Contracts.ToolResult.t(),
          [TentativeArtifactSet.t()]
        ) :: map()
  def build_artifact_sets(frame, trace_summary, decision, tool_result, artifact_sets)
      when is_list(artifact_sets) do
    result =
      build(frame, trace_summary, [], decision, tool_result, nil, nil)
      |> Map.put(
        :available_actions,
        Enum.flat_map(artifact_sets, &AvailableActionBuilder.artifact_actions/1)
      )

    Enum.reduce(artifact_sets, result, fn artifact_set, acc ->
      maybe_add_artifacts(acc, artifact_set)
    end)
  end

  # ── phase / status ────────────────────────────

  # ADR-0006 #1：无 behavior、无工具调用的回复轮 phase = dialogue（不是 completed）；
  # 工具成功仍 completed、失败仍 failed。
  # ADR-0006 #2（B13b BB-4，2026-10-23 作者拍板方案 A）：fail_with_recovery 决策是
  # 「失败但可恢复」——phase 仍 failed，status 用 failed_recoverable（区别于不可恢复
  # 的 failed）。恢复面=既有对话流与控制坞，不新增 recovery action/UI 卡。
  defp build_phase(_behavior, %OrchestratorDecision{decision_type: :fail_with_recovery}, _),
    do: "failed"

  defp build_phase(nil, _decision, nil), do: "dialogue"
  defp build_phase(nil, _decision, %ToolResult{status: :failed}), do: "failed"
  defp build_phase(nil, _decision, _tool_result), do: "completed"
  defp build_phase(%BehaviorState{lifecycle_status: :open}, _, _), do: "awaiting_author"

  defp build_phase(%BehaviorState{lifecycle_status: :awaiting_author}, _, _),
    do: "awaiting_author"

  defp build_phase(%BehaviorState{lifecycle_status: :resolving}, _, _), do: "completed"
  defp build_phase(%BehaviorState{lifecycle_status: :resolved}, _, _), do: "completed"
  defp build_phase(%BehaviorState{lifecycle_status: :cancelled}, _, _), do: "cancelled"
  defp build_phase(%BehaviorState{lifecycle_status: :failed}, _, _), do: "failed"
  defp build_phase(_, _, _), do: "completed"

  # ADR-0006 #2（B13b BB-4）：fail_with_recovery 决策 → failed_recoverable。
  # 判定先于工具失败分支——恢复语义由决策给出，不由 tool_result 形状推断。
  defp build_status(_behavior, %OrchestratorDecision{decision_type: :fail_with_recovery}, _),
    do: "failed_recoverable"

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
      required_author_action: d.required_author_action,
      # ADR-0004 #3：决策 trace 闭合——turn_result 引用本轮 DecisionTrace。
      decision_trace_ref: d.decision_trace_ref
    })
  end

  defp maybe_put_orchestrator_decision(result, decision) when is_map(decision),
    do: Map.put(result, :orchestrator_decision, decision)

  defp maybe_put_orchestrator_decision(result, _decision), do: result

  defp maybe_add_tool_result(r, nil), do: r

  defp maybe_add_tool_result(r, tr) do
    Map.put(r, :tool_result, %{
      tool_result_id: tr.tool_result_id,
      tool_request_ref: tr.tool_request_ref,
      tool_name: tr.tool_name,
      status: tr.status,
      output: tr.output,
      errors: tr.errors,
      warnings: tr.warnings,
      state_delta: tr.state_delta
    })
  end

  @doc """
  Q3c 作者内容物化：作者源候选的公开挂载入口（reply 路径无 tool_result/decision，
  不走 build_artifact_sets）。pending 条目、候选卡与 available_actions 全部复用
  AU-09 逐项采纳组装——采纳契约零改动。
  """
  @spec attach_author_artifact(map(), TentativeArtifactSet.t()) :: map()
  def attach_author_artifact(turn_result, %TentativeArtifactSet{} = artifact_set) do
    actions = AvailableActionBuilder.artifact_actions(artifact_set)

    turn_result
    |> maybe_add_artifacts(artifact_set)
    |> Map.update(:available_actions, actions, fn existing -> existing ++ actions end)
  end

  defp maybe_add_artifacts(r, artifact_set, extra_payload \\ %{}, candidate_title \\ nil)

  defp maybe_add_artifacts(r, nil, _extra_payload, _candidate_title), do: r

  defp maybe_add_artifacts(r, as, extra_payload, candidate_title) do
    # AU-09：逐候选独立采纳——多候选 character_seed 每条候选成为独立 pending 条目，
    # 拥有自己的 artifact_id（与 available_actions 的 target_ref 一致），作者逐项授权；
    # 采纳一个只物化该条目对应的 item，其它候选保持 pending、不进入作品事实。
    units = TentativeArtifactSet.adoptable_units(as)

    current_adoption_state = Map.get(r, :adoption_state, %{pending: [], resolved: []})

    adoption_state = %{
      pending:
        List.wrap(Map.get(current_adoption_state, :pending)) ++
          Enum.map(units, &unit_pending_entry(as, &1, extra_payload)),
      resolved: List.wrap(Map.get(current_adoption_state, :resolved))
    }

    candidate_set_card =
      %{
        card_type: "candidate_set",
        priority: "high",
        visibility: "always",
        title: candidate_title || artifact_card_title(as),
        body: artifact_card_body(as),
        artifact_refs: [as.artifact_set_id],
        candidate_set_ref: as.artifact_set_id,
        artifact_type: as.artifact_type,
        items: as.items,
        tentative: true
      }
      |> maybe_put_revision_provenance(as)
      |> Map.merge(Map.take(extra_payload, [:formatting_preview]))

    r
    |> Map.put(:adoption_state, adoption_state)
    |> Map.update(:ui_cards, [candidate_set_card], fn cards -> cards ++ [candidate_set_card] end)
  end

  @doc """
  VS-00E CP3：为“按质量发现重写”产出的修订草稿构建 TurnResult。

  修订草稿与普通待采纳草稿走同一套采纳卡 + available_actions（accept/discard/edit），
  作者照常逐项采纳；同时携带 revision provenance 供前端标注“这是针对质量问题的修订草稿”，
  并明确原草稿保留、未写入作品事实（ADR-0020）。
  """
  @spec revision_turn_result(String.t(), TentativeArtifactSet.t(), keyword()) :: map()
  def revision_turn_result(parent_turn_ref, %TentativeArtifactSet{} = artifact_set, opts \\ []) do
    turn_id = artifact_set.source_turn_ref

    base = %{
      schema_version: "3.0-draft",
      turn_id: turn_id,
      parent_turn_id: parent_turn_ref,
      frame_ref: "frame_#{turn_id}",
      assistant_message: %{
        text:
          opts[:message] ||
            "已根据所选质量问题生成修订草稿，供你对比后再决定是否采纳；原草稿保留，未写入作品事实。"
      },
      ui_cards: [],
      frame_summary: %{frame_type: :revision, dialogue_goal: "根据质量发现生成修订草稿"},
      trace_summary: opts[:trace_summary] || %{},
      phase: "completed",
      status: "conversational",
      available_actions: AvailableActionBuilder.artifact_actions(artifact_set),
      truthfulness: %{
        tool_called: true,
        tool_status: :succeeded,
        tool_name: "prose_writing",
        artifact_adopted: false,
        production_write_performed: false,
        durable_behavior_opened: false
      }
    }

    base
    |> maybe_put_orchestrator_decision(opts[:orchestrator_decision])
    |> maybe_add_artifacts(artifact_set)
  end

  defp artifact_card_title(%TentativeArtifactSet{} = as) do
    if TentativeArtifactSet.revision?(as),
      do: "修订草稿：#{artifact_payload_title(as)}",
      else: artifact_payload_title(as)
  end

  defp maybe_put_revision_provenance(card, %TentativeArtifactSet{} = as) do
    if TentativeArtifactSet.revision?(as) do
      Map.merge(card, %{
        revision_of: as.revision_base,
        revision_reason: as.revision_reason,
        quality_finding_refs: as.quality_finding_refs
      })
    else
      card
    end
  end

  defp unit_pending_entry(%TentativeArtifactSet{} = as, unit, extra_payload) do
    extra_payload = if is_map(extra_payload), do: extra_payload, else: %{}

    %{
      artifact_id: unit.artifact_id,
      artifact_type: as.artifact_type,
      requires_adoption: true,
      payload: Map.merge(unit_payload(as, unit), extra_payload),
      adoption_status: as.adoption_status,
      source_tool_result_ref: as.source_tool_result_ref,
      authoring_intent: as.authoring_intent,
      target_chapter: as.target_chapter,
      target_chapter_ref: as.target_chapter_ref
    }
  end

  # 单元 payload 只含该候选的 item，使采纳层（artifact_content/summary/narrative_role）
  # 只看到目标候选，且前端可从 payload.items 取候选名标注逐项按钮。
  defp unit_payload(%TentativeArtifactSet{} = as, %{items: items}) do
    %{
      items: items,
      title: artifact_payload_title(as),
      item_count: length(items)
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
       when type in [:character_evolution_seed, "character_evolution_seed"],
       do: "角色演化记忆草稿"

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

  # VS-00G CP4d：全书规划字段建议（采纳=立项字段回写，OQ7 用户可见词「全书规划」）。
  defp artifact_payload_title(%{artifact_type: type})
       when type in [:work_skeleton_suggestion, "work_skeleton_suggestion"],
       do: "全书规划建议"

  defp artifact_payload_title(_as), do: "待保存草稿"

  defp artifact_card_body(%{items: items} = as) do
    preview =
      items
      |> Enum.take(3)
      |> Enum.map_join("；", &item_title/1)
      |> case do
        "" -> ""
        text -> "预览：#{String.slice(text, 0, 120)}"
      end

    "#{artifact_save_hint(as)}#{preview}"
  end

  defp artifact_save_hint(%{artifact_type: type})
       when type in [:prose_formatting_plan, "prose_formatting_plan"],
       do: "分段方案待采纳。预览仅改变换行；应用后保留原文全部非换行字节和历史版本。"

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

  defp artifact_save_hint(%{artifact_type: type})
       when type in [:work_skeleton_suggestion, "work_skeleton_suggestion"],
       do: "这是全书规划建议。采纳后会写入作品的立项规划字段；未采纳前不会改变全书规划。"

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
    r
    |> maybe_add_behavior_card(b)
    |> Map.put(:behavior_state, BehaviorState.snapshot(b))
  end

  defp maybe_add_behavior_card(
         r,
         %BehaviorState{behavior_type: :confirmation, lifecycle_status: status} = behavior
       )
       when status in [:open, :awaiting_author] do
    card = %{
      card_type: "confirmation_card",
      priority: "high",
      visibility: "always",
      title: "需要确认",
      body: confirmation_card_body(behavior),
      behavior_ref: behavior.behavior_id,
      target_ref: behavior.target_ref
    }

    Map.update(r, :ui_cards, [card], fn cards -> cards ++ [card] end)
  end

  defp maybe_add_behavior_card(r, _behavior), do: r

  defp confirmation_card_body(%BehaviorState{} = behavior) do
    question =
      behavior.prompt_contract
      |> prompt_contract_text()
      |> blank_to_default("此操作需要作者明确确认。")

    target = confirmation_target_label(behavior.target_ref)

    [
      question,
      "确认对象：#{target}。",
      "确认前不会调用工具或写入作品事实；确认后系统会重新检查当前作品状态，再决定是否执行。"
    ]
    |> Enum.join("\n")
  end

  defp prompt_contract_text(%{question: question}) when is_binary(question), do: question
  defp prompt_contract_text(%{"question" => question}) when is_binary(question), do: question
  defp prompt_contract_text(%{summary: summary}) when is_binary(summary), do: summary
  defp prompt_contract_text(%{"summary" => summary}) when is_binary(summary), do: summary
  defp prompt_contract_text(_), do: nil

  defp blank_to_default(value, default) when is_binary(value) do
    if String.trim(value) == "", do: default, else: value
  end

  defp blank_to_default(_value, default), do: default

  defp confirmation_target_label("prose_writing"), do: "正文草稿生成"
  defp confirmation_target_label("character_design"), do: "角色设定草稿生成"
  defp confirmation_target_label("plot_outline"), do: "大纲草稿生成"
  defp confirmation_target_label("world_building"), do: "设定草稿生成"
  defp confirmation_target_label(target) when is_binary(target) and target != "", do: target
  defp confirmation_target_label(_target), do: "本轮待确认操作"

  defp format_candidates(candidates) do
    Enum.map(candidates, fn c ->
      %{
        direction_id: c.direction_id,
        kind: "creative_direction",
        title: c.title,
        pitch: c.pitch,
        tone_tags: c.tone_tags,
        risk_hint: c.risk_hint,
        adoption_status: c.adoption_status
      }
    end)
  end
end
