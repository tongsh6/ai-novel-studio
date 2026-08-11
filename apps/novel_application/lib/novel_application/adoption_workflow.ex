defmodule NovelApplication.AdoptionWorkflow do
  @moduledoc """
  Application-level adoption workflow for author-triggered artifact adoption.

  This keeps the web channel thin: the frontend submits an artifact action,
  then application code evaluates the current pending artifact through
  `AdoptionBoundary` and returns the observable action/TurnResult payloads.
  """

  alias NovelApplication.AdoptionBoundary
  alias NovelApplication.TraceSummaryRef
  alias NovelDomain.AdoptionDecision
  alias NovelDomain.BehaviorState
  alias NovelDomain.CandidateSet
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MutationStatus

  @spec handle_adopt(
          map() | nil,
          map(),
          function() | nil,
          function() | nil,
          function() | nil,
          (String.t(), String.t() -> boolean()) | nil
        ) ::
          {:ok, map(), map()} | {:error, String.t()}
  def handle_adopt(
        source_turn_result,
        params,
        adoption_writer \\ NovelApplication.persistence_adoption_writer(),
        overwrite_reader \\ NovelApplication.persistence_overwrite_reader(),
        summary_maintainer \\ NovelApplication.chapter_summary_maintainer(),
        duplicate_name_checker \\ NovelApplication.persistence_accepted_character_name_checker()
      )

  def handle_adopt(
        nil,
        _params,
        _adoption_writer,
        _overwrite_reader,
        _summary_maintainer,
        _duplicate_name_checker
      ),
      do: {:error, "source_turn_result not available"}

  def handle_adopt(
        source_turn_result,
        %{"artifact_id" => artifact_id} = params,
        adoption_writer,
        overwrite_reader,
        summary_maintainer,
        duplicate_name_checker
      )
      when is_binary(artifact_id) do
    # 结构性/无效 action（artifact 不存在、跨作品、stale revision）保持 {:error}，
    # 由 channel 侧 ActionValidator 在前置守门。AdoptionBoundary 的决定（采纳/需确认/
    # 拒绝/失败恢复）则一律以 TurnResult 形式回传，满足 ADR-0010 决策规则4 与
    # VS-04 §4.5「adoption failure 必须产生 TurnResult，不允许静默丢弃」。
    with {:ok, artifact} <- find_pending_artifact(source_turn_result, artifact_id),
         {:ok, work_context} <- validate_work_boundary(source_turn_result, artifact, params),
         :ok <- check_revision_base(artifact, params) do
      candidate_set = candidate_set_from_artifact(source_turn_result, artifact)
      opts =
        adoption_decision_opts(
          work_context,
          artifact,
          params,
          overwrite_reader,
          duplicate_name_checker
        )

      decision =
        AdoptionBoundary.evaluate(
          candidate_set,
          %{"candidate_id" => artifact_id, "work_id" => work_context.work_id},
          nil,
          opts
        )

      finalize_adoption(
        decision,
        source_turn_result,
        artifact,
        params,
        adoption_writer,
        summary_maintainer,
        opts
      )
    end
  end

  def handle_adopt(
        _source_turn_result,
        _params,
        _adoption_writer,
        _overwrite_reader,
        _maintainer,
        _duplicate_name_checker
      ),
      do: {:error, "artifact_id is required"}

  # 把 work boundary、覆盖判定、确认状态合成采纳边界 opts。
  # 覆盖已有正文（同 title 章节已有已采纳内容）= 高风险 production write → 需确认。
  defp adoption_decision_opts(work_context, artifact, params, overwrite_reader, name_checker) do
    duplicate_match = duplicate_character_match(work_context, artifact, name_checker)

    work_context
    |> Map.put(:confirmation_satisfied, truthy?(Map.get(params, "confirmation_satisfied")))
    |> Map.put(:overwrite, overwrite_existing?(overwrite_reader, work_context.work_id, artifact))
    |> Map.put(:meta_leak_hits, artifact_meta_leak_hits(artifact))
    |> Map.put(:duplicate_character_name, duplicate_match && duplicate_match.proposed)
    |> Map.put(:duplicate_character_canonical, duplicate_match && duplicate_match.canonical)
    |> Map.put(:duplicate_character_alias_hit, (duplicate_match && duplicate_match.alias_hit) == true)
  end

  # 同名/别名角色（M4 实锤 + AU12 CP2 别名后门）：档案已有同名已确认角色、或提案
  # 名命中某已确认角色的别名时，都不静默处理——同名可能是重复采纳、同一人的补充、
  # 别名，也可能真是两个同名角色，这是创作判断不是数据判断。命中即升
  # require_confirmation 交作者裁决（与 B9 元泄漏同款拦截+主权语义）。
  # checker 返回命中详情（%{name, alias_hit}）；旧式布尔 checker（测试注入）兼容。
  defp duplicate_character_match(work_context, artifact, name_checker) do
    with true <- is_function(name_checker, 2),
         true <- character_dossier_artifact?(artifact_field(artifact, :artifact_type)),
         work_id when is_binary(work_id) <- Map.get(work_context, :work_id),
         name when is_binary(name) <- adoption_chapter_title(artifact),
         trimmed = String.trim(name),
         match when match not in [nil, false] <- name_checker.(work_id, name) do
      case match do
        %{name: canonical} = detail ->
          %{
            proposed: trimmed,
            canonical: canonical,
            alias_hit: Map.get(detail, :alias_hit) == true
          }

        _boolean_true ->
          %{proposed: trimmed, canonical: trimmed, alias_hit: false}
      end
    else
      _ -> nil
    end
  end

  defp character_dossier_artifact?(type)
       when type in [:character_seed, "character_seed"],
       do: true

  defp character_dossier_artifact?(_type), do: false

  # B9 元泄漏升采纳级（M3 审计：25 处泄漏经 advisory warn 存活——自动采纳绕过
  # 警告）。正文类候选采纳前机械扫描元泄漏（章号自指/工作流程词/结构标签，与
  # 生成期 validator/导出门同一 pattern 源），命中即升 require_confirmation；
  # 作者显式确认后仍可采纳（作者主权），但不再静默进入正文。
  defp artifact_meta_leak_hits(artifact) do
    if reading_projection_artifact_type?(artifact_field(artifact, :artifact_type)) do
      NovelApplication.ProseQualityValidators.meta_leak_hits(artifact_content(artifact) || "")
    else
      []
    end
  end

  # 续写（append）是追加新场景，不是覆盖，不需确认；只有重写/默认覆盖才查目标章已有正文。
  defp overwrite_existing?(reader, work_id, artifact)
       when is_function(reader, 2) and is_binary(work_id) do
    adoption_mode(artifact) == :overwrite and
      reading_projection_artifact_type?(artifact_field(artifact, :artifact_type)) and
      reader.(work_id, adoption_chapter_title(artifact))
  end

  defp overwrite_existing?(_reader, _work_id, _artifact), do: false

  defp reading_projection_artifact_type?(type)
       when type in [:prose_fragment, "prose_fragment", :scene_draft, "scene_draft"],
       do: true

  defp reading_projection_artifact_type?(_type), do: false

  defp truthy?(true), do: true
  defp truthy?("true"), do: true
  defp truthy?(_), do: false

  # adopt_tentative：通过采纳边界，写入 production fact 并物化阅读投影。
  # 其它决定（require_confirmation / reject / fail_with_recovery）：不写库，
  # 但仍产出真实 TurnResult（ADR-0010 规则4 / VS-04 §4.5）。confirm→重新 gate→
  # 完成采纳的确认闭环属 AU-04/06（ADR-0008/0009），与候选路径一致暂不在此实现。
  defp finalize_adoption(
         %AdoptionDecision{} = decision,
         source_turn_result,
         artifact,
         params,
         adoption_writer,
         summary_maintainer,
         decision_opts
       ) do
    if AdoptionDecision.adopted?(decision) do
      case persist_adoption(adoption_writer, source_turn_result, decision, artifact, params) do
        {:ok, persisted} ->
          maybe_maintain_chapter_summary(
            summary_maintainer,
            source_turn_result,
            artifact,
            params,
            persisted
          )

          {:ok, build_action_result(decision, artifact, persisted),
           build_turn_result(source_turn_result, decision, artifact, persisted, params)}

        {:error, reason} ->
          {:error, reason}
      end
    else
      {:ok, build_decision_action_result(decision, artifact),
       build_decision_turn_result(source_turn_result, decision, artifact, decision_opts)}
    end
  end

  # 正文/场景采纳成功后触发章摘要 maintenance（VS-00C CP2.1 / contract §5.3）。
  # 仅对正文类 artifact、且持久化已物化章节（persisted 带 chapter_id）时触发。
  # 失败容忍：maintainer 默认异步且自身不抛错，这里再包一层兜底，绝不影响采纳返回。
  defp maybe_maintain_chapter_summary(nil, _source_turn_result, _artifact, _params, _persisted),
    do: :ok

  defp maybe_maintain_chapter_summary(maintainer, source_turn_result, artifact, params, persisted)
       when is_function(maintainer, 1) do
    with true <- prose_artifact?(artifact),
         chapter_id when is_binary(chapter_id) <- chapter_id_from_persisted(persisted) do
      maintainer.(%{
        work_id: Map.get(params, "work_id") || map_field(source_turn_result, :work_id),
        chapter_id: chapter_id,
        chapter_title: adoption_chapter_title(artifact),
        prose_text: artifact_content(artifact),
        source_ref: turn_id(source_turn_result),
        revision_base: revision_base_from_persisted(persisted)
      })

      :ok
    else
      _ -> :ok
    end
  rescue
    _ -> :ok
  end

  defp prose_artifact?(artifact) do
    artifact_field(artifact, :artifact_type) in [
      :prose_fragment,
      "prose_fragment",
      :scene_draft,
      "scene_draft"
    ]
  end

  defp chapter_id_from_persisted(persisted) when is_map(persisted) do
    case Map.get(persisted, :reading_projection) do
      %{} = projection -> Map.get(projection, :chapter_id)
      _ -> nil
    end
  end

  defp chapter_id_from_persisted(_persisted), do: nil

  defp revision_base_from_persisted(persisted) when is_map(persisted) do
    case Map.get(persisted, :reading_projection) do
      %{source_revision_ref: ref} when is_binary(ref) -> ref
      _ -> Map.get(persisted, :source_revision_ref)
    end
  end

  defp revision_base_from_persisted(_persisted), do: nil

  defp artifact_risk_hint(artifact) do
    case artifact_field(artifact, :risk_hint) do
      :high -> :high
      "high" -> :high
      :medium -> :medium
      "medium" -> :medium
      _ -> :low
    end
  end

  @spec handle_discard(map() | nil, map()) :: {:ok, map(), map()} | {:error, String.t()}
  def handle_discard(nil, _params), do: {:error, "source_turn_result not available"}

  def handle_discard(source_turn_result, %{"artifact_id" => artifact_id} = params)
      when is_binary(artifact_id) do
    with {:ok, artifact} <- find_pending_artifact(source_turn_result, artifact_id),
         {:ok, _work_context} <- validate_work_boundary(source_turn_result, artifact, params) do
      {:ok, build_discard_action_result(artifact),
       build_discard_turn_result(source_turn_result, artifact)}
    end
  end

  def handle_discard(_source_turn_result, _params), do: {:error, "artifact_id is required"}

  @doc """
  拒绝/取消一个 open 采纳确认。关闭 confirmation behavior，不写 production fact，
  artifact 仍保留为待采纳（作者可改主意后重新采纳）。
  """
  @spec handle_confirmation_reject(map() | nil, map()) ::
          {:ok, map(), map()} | {:error, String.t()}
  def handle_confirmation_reject(nil, _params), do: {:error, "source_turn_result not available"}

  def handle_confirmation_reject(source_turn_result, %{"artifact_id" => artifact_id} = params)
      when is_binary(artifact_id) do
    with {:ok, artifact} <- find_pending_artifact(source_turn_result, artifact_id) do
      {:ok, build_cancel_confirmation_action_result(artifact),
       build_cancel_confirmation_turn_result(source_turn_result, artifact, params)}
    end
  end

  def handle_confirmation_reject(_source_turn_result, _params),
    do: {:error, "artifact_id is required"}

  @spec handle_modify_draft(map() | nil, map(), function() | nil) ::
          {:ok, map(), map()} | {:error, String.t()}
  def handle_modify_draft(
        source_turn_result,
        params,
        adoption_writer \\ NovelApplication.persistence_adoption_writer()
      )

  def handle_modify_draft(nil, _params, _adoption_writer),
    do: {:error, "source_turn_result not available"}

  def handle_modify_draft(source_turn_result, params, adoption_writer) do
    artifact_id = Map.get(params, "artifact_id") || Map.get(params, "draft_id")

    cond do
      not is_binary(artifact_id) ->
        {:error, "draft_id is required"}

      not has_edit_payload?(params) ->
        {:error, "edited content or instruction is required"}

      true ->
        handle_modify_draft_with_artifact(
          source_turn_result,
          params,
          adoption_writer,
          artifact_id
        )
    end
  end

  # edit_then_accept 接受两种编辑载荷：作者全文编辑（edited_content，替换）或
  # 旧版修改要求（instruction，追加，向后兼容）。
  defp has_edit_payload?(params) do
    not is_nil(normalize_edit(Map.get(params, "edited_content"))) or
      not is_nil(normalize_edit(Map.get(params, "instruction")))
  end

  defp normalize_edit(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_edit(_value), do: nil

  defp find_pending_artifact(source_turn_result, artifact_id) do
    pending =
      source_turn_result
      |> get_in_any([:adoption_state, :pending])
      |> List.wrap()

    case Enum.find(pending, &(artifact_field(&1, :artifact_id) == artifact_id)) do
      nil -> {:error, "pending artifact not found"}
      artifact -> {:ok, artifact}
    end
  end

  defp handle_modify_draft_with_artifact(source_turn_result, params, adoption_writer, artifact_id) do
    with {:ok, artifact} <- find_pending_artifact(source_turn_result, artifact_id),
         {:ok, work_context} <- validate_work_boundary(source_turn_result, artifact, params),
         :ok <- check_revision_base(artifact, params),
         edited_artifact <- edited_artifact(artifact, params),
         candidate_set <- candidate_set_from_artifact(source_turn_result, edited_artifact),
         decision <-
           AdoptionBoundary.evaluate(
             candidate_set,
             %{"candidate_id" => artifact_id, "work_id" => work_context.work_id},
             nil,
             work_context
             |> Map.put(:confirmation_satisfied, truthy?(Map.get(params, "confirmation_satisfied")))
             |> Map.put(:meta_leak_hits, artifact_meta_leak_hits(edited_artifact))
           ),
         true <- AdoptionDecision.adopted?(decision),
         {:ok, persisted} <-
           persist_adoption(
             adoption_writer,
             source_turn_result,
             decision,
             edited_artifact,
             params
           ) do
      {:ok, build_edit_action_result(decision, edited_artifact, persisted),
       build_edited_turn_result(source_turn_result, decision, edited_artifact, persisted)}
    else
      {:error, reason} -> {:error, reason}
      false -> {:error, "adoption boundary did not accept edited artifact"}
    end
  end

  defp check_revision_base(artifact, params) do
    expected = artifact_field(artifact, :revision_base)
    actual = Map.get(params, "base_revision")

    cond do
      is_nil(expected) or expected == "" ->
        :ok

      to_string(expected) == to_string(actual) ->
        :ok

      true ->
        {:error, "stale artifact revision"}
    end
  end

  defp validate_work_boundary(source_turn_result, artifact, params) do
    requested_work_id = Map.get(params, "work_id") || map_field(params, :work_id)
    source_work_id = map_field(source_turn_result, :work_id)
    artifact_work_id = artifact_field(artifact, :work_id)

    referenced_work_ids =
      [source_work_id, artifact_work_id]
      |> Enum.reject(&blank?/1)
      |> Enum.uniq()

    cond do
      length(referenced_work_ids) > 1 ->
        {:error, "cross-work adoption rejected"}

      not blank?(requested_work_id) and
          Enum.any?(referenced_work_ids, &(&1 != requested_work_id)) ->
        {:error, "cross-work adoption rejected"}

      true ->
        {:ok,
         %{
           work_id: requested_work_id || List.first(referenced_work_ids),
           source_work_id: source_work_id,
           artifact_work_id: artifact_work_id
         }}
    end
  end

  defp candidate_set_from_artifact(source_turn_result, artifact) do
    artifact_id = artifact_field(artifact, :artifact_id)
    artifact_type = artifact_field(artifact, :artifact_type)

    %CandidateSet{
      candidate_set_id: "cs_#{artifact_id}",
      turn_id: turn_id(source_turn_result),
      candidate_type: candidate_type(artifact_type),
      source_refs: [turn_id(source_turn_result), artifact_id] |> Enum.reject(&is_nil/1),
      candidates: [
        %{
          candidate_id: artifact_id,
          summary: artifact_summary(artifact),
          content_ref: "artifact:#{artifact_id}",
          origin_ref:
            artifact_field(artifact, :source_tool_result_ref) ||
              "turn:#{turn_id(source_turn_result)}",
          risk_hint: artifact_risk_hint(artifact),
          adoption_target_ref: "artifact:#{artifact_id}",
          work_id: artifact_field(artifact, :work_id) || map_field(source_turn_result, :work_id)
        }
      ],
      stability: :tentative,
      trace_ref: trace_ref(source_turn_result)
    }
  end

  defp persist_adoption(nil, _source_turn_result, decision, _artifact, _params) do
    {:ok,
     %{
       mutation_id: decision.adoption_decision_id,
       mutation_status: MutationStatus.applied(),
       memory_item_id: decision.adopted_state_ref,
       memory_status: MemoryStatus.confirmed(),
       source_revision_ref: "decision:#{decision.adoption_decision_id}",
       persisted: false,
       persistence_status: "not_configured"
     }}
  end

  defp persist_adoption(writer, source_turn_result, decision, artifact, params)
       when is_function(writer, 1) do
    attrs = %{
      actor_ref: "author",
      work_id: Map.get(params, "work_id") || map_field(source_turn_result, :work_id),
      source_turn_ref: turn_id(source_turn_result),
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      base_revision: normalized_base_revision(artifact_field(artifact, :revision_base)),
      content: artifact_content(artifact),
      summary: adoption_chapter_title(artifact),
      narrative_role: artifact_narrative_role(artifact),
      role: artifact_character_field(artifact, :role),
      aliases: artifact_character_field(artifact, :aliases),
      planned_reveal: artifact_character_field(artifact, :planned_reveal),
      resolution_target: artifact_character_field(artifact, :resolution_target),
      resolved_at_seq: artifact_character_field(artifact, :resolved_at_seq),
      memory_subtype: artifact_memory_subtype(artifact),
      skeleton_field: artifact_skeleton_slot(artifact, :skeleton_field),
      skeleton_value: artifact_skeleton_slot(artifact, :skeleton_value),
      mode: adoption_mode(artifact),
      decision_id: decision.adoption_decision_id
    }

    case writer.(attrs) do
      {:ok, persisted} -> {:ok, Map.put(persisted, :persisted, true)}
      {:error, reason} -> {:error, "adoption persistence failed: #{inspect(reason)}"}
    end
  end

  defp build_action_result(%AdoptionDecision{} = decision, artifact, persisted) do
    %{
      action_id: "adopt:#{artifact_field(artifact, :artifact_id)}",
      action_type: "adopt",
      status: "accepted",
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      decision: decision_payload(decision),
      persistence: persisted
    }
  end

  defp build_decision_action_result(%AdoptionDecision{} = decision, artifact) do
    %{
      action_id: "adopt:#{artifact_field(artifact, :artifact_id)}",
      action_type: "adopt",
      status: decision_action_status(decision),
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      decision: decision_payload(decision),
      persistence: %{persisted: false}
    }
  end

  defp decision_action_status(%AdoptionDecision{decision_type: :require_confirmation}),
    do: "needs_confirmation"

  defp decision_action_status(%AdoptionDecision{decision_type: :reject}), do: "rejected"
  defp decision_action_status(%AdoptionDecision{decision_type: :fail_with_recovery}), do: "failed"
  defp decision_action_status(_decision), do: "rejected"

  defp build_cancel_confirmation_action_result(artifact) do
    %{
      action_id: "reject:#{artifact_field(artifact, :artifact_id)}",
      action_type: "reject_or_cancel_confirmation",
      status: "cancelled",
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      persistence: %{persisted: false}
    }
  end

  # 取消确认：关闭 confirmation behavior（active: nil），artifact 仍 pending，不写库。
  defp build_cancel_confirmation_turn_result(source_turn_result, artifact, params) do
    source_turn_id = turn_id(source_turn_result)
    turn_id = NovelFoundation.ID.unique("turn_adopt")

    %{
      schema_version: "3.0-draft",
      turn_id: turn_id,
      parent_turn_id: source_turn_id,
      assistant_message: %{text: "已取消采纳；未覆盖正文，草稿仍保留为待采纳。"},
      ui_cards: [],
      trace_summary: %{
        decision_type: "cancel_confirmation",
        reason_codes: ["author_cancelled_confirmation"],
        decision_trace_ref: nil,
        state_trace_ref: nil
      },
      phase: "cancelled",
      status: "cancelled",
      available_actions: [],
      behavior_state:
        terminal_confirmation_behavior_state(
          source_turn_result,
          artifact,
          params,
          :cancelled,
          turn_id
        ),
      projection_refs: [],
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false,
        state_persisted: false,
        mutation_ref: nil,
        adopted_state_ref: nil,
        durable_behavior_opened: false,
        decision_type: :cancel_confirmation,
        reason_codes: ["author_cancelled_confirmation"]
      }
    }
  end

  defp build_discard_action_result(artifact) do
    %{
      action_id: "discard:#{artifact_field(artifact, :artifact_id)}",
      action_type: "discard",
      status: "discarded",
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type)
    }
  end

  defp build_edit_action_result(%AdoptionDecision{} = decision, artifact, persisted) do
    %{
      action_id: "modify_draft:#{artifact_field(artifact, :artifact_id)}",
      action_type: "modify_draft",
      status: "accepted",
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      decision: decision_payload(decision),
      persistence: persisted
    }
  end

  defp build_turn_result(
         source_turn_result,
         %AdoptionDecision{} = decision,
         artifact,
         persisted,
         params
       ) do
    source_turn_id = turn_id(source_turn_result)
    artifact_id = artifact_field(artifact, :artifact_id)
    adopted_state_ref = adopted_state_ref(persisted, decision)
    turn_id = NovelFoundation.ID.unique("turn_adopt")
    state_trace_refs = state_trace_refs(decision, artifact, persisted, turn_id, source_turn_id)
    state_trace_ref = primary_state_trace_ref(state_trace_refs)

    %{
      schema_version: "3.0-draft",
      turn_id: turn_id,
      parent_turn_id: source_turn_id,
      assistant_message: %{text: "已通过采纳边界，采纳内容已进入已决状态。"},
      ui_cards: [],
      trace_summary: %{
        trace_ref: action_trace_ref(turn_id),
        decision_type: to_string(decision.decision_type),
        reason_codes: decision.reason_codes,
        source_turn_ref: source_turn_id,
        source_trace_ref: trace_ref(source_turn_result),
        decision_trace_ref: decision.decision_trace_ref,
        state_trace_ref: state_trace_ref,
        state_trace_refs: state_trace_refs,
        no_tool_reason: "author_action_does_not_call_tool",
        no_behavior_reason: "adoption action resolved through boundary",
        no_write_reason: adoption_no_write_reason(persisted),
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        event_order: adoption_event_order(state_trace_refs, persisted)
      },
      phase: "completed",
      status: "conversational",
      available_actions: [],
      # 关闭任何 open confirmation behavior（确认后采纳完成）。
      behavior_state:
        if truthy?(Map.get(params, "confirmation_satisfied")) do
          terminal_confirmation_behavior_state(
            source_turn_result,
            artifact,
            params,
            :resolved,
            turn_id,
            decision
          )
        else
          BehaviorState.snapshot(nil)
        end,
      adoption_state: %{
        pending: [],
        resolved: [
          %{
            artifact_id: artifact_id,
            artifact_type: artifact_field(artifact, :artifact_type),
            adoption_status: AdoptionStatus.accepted(),
            requires_adoption: false,
            source_artifact_ref: artifact_id,
            adopted_state_ref: adopted_state_ref,
            state_trace_ref: state_trace_ref,
            decision_trace_ref: decision.decision_trace_ref,
            mutation_ref: persisted[:mutation_id],
            payload: artifact_field(artifact, :payload) || %{}
          }
        ]
      },
      projection_refs:
        projection_refs(decision, persisted, source_turn_id, artifact_id, state_trace_ref),
      truthfulness: %{
        tool_called: false,
        artifact_adopted: true,
        production_write_performed: persisted[:persisted] == true,
        state_persisted: persisted[:persisted] == true,
        mutation_ref: persisted[:mutation_id],
        adopted_state_ref: adopted_state_ref,
        durable_behavior_opened: false,
        decision_type: decision.decision_type,
        reason_codes: decision.reason_codes
      }
    }
  end

  defp terminal_confirmation_behavior_state(
         source_turn_result,
         artifact,
         params,
         lifecycle_status,
         closed_turn_id,
         decision \\ nil
       ) do
    active_behavior = get_in_any(source_turn_result, [:behavior_state, :active])
    artifact_id = artifact_field(artifact, :artifact_id)

    %BehaviorState{
      behavior_id:
        first_present([
          map_field(params, :behavior_ref),
          map_field(active_behavior, :behavior_id),
          "bh_confirm_#{artifact_id}"
        ]),
      behavior_type: :confirmation,
      lifecycle_status: lifecycle_status,
      blocking_actor: :author,
      opened_at_turn_ref:
        first_present([
          map_field(active_behavior, :opened_at_turn_ref),
          turn_id(source_turn_result)
        ]),
      opened_by_decision_ref:
        first_present([
          map_field(active_behavior, :opened_by_decision_ref),
          adoption_decision_ref(decision),
          "adoption_confirmation:#{artifact_id}"
        ]),
      frame_ref:
        first_present([
          map_field(active_behavior, :frame_ref),
          map_field(source_turn_result, :frame_ref),
          turn_id(source_turn_result)
        ]),
      plan_ref: map_field(active_behavior, :plan_ref),
      target_ref: artifact_id,
      required_next_action:
        first_present([
          map_field(active_behavior, :required_next_action),
          "confirm_before_execute"
        ]),
      available_actions: [],
      prompt_contract: map_field(active_behavior, :prompt_contract) || %{},
      constraints: map_field(active_behavior, :constraints) || %{},
      resolution: %{
        ref: "behavior_resolution:#{closed_turn_id}",
        status: terminal_resolution_status(lifecycle_status),
        action_id: map_field(params, :action_id),
        action_type: terminal_action_type(lifecycle_status, params),
        source_turn_ref: map_field(params, :source_turn_ref),
        idempotency_key: map_field(params, :idempotency_key),
        artifact_id: artifact_id
      },
      closed_at_turn_ref: closed_turn_id,
      trace_ref:
        first_present([
          map_field(active_behavior, :trace_ref),
          adoption_decision_trace_ref(decision),
          trace_ref(source_turn_result),
          "behavior_trace:#{closed_turn_id}"
        ])
    }
    |> BehaviorState.snapshot()
  end

  defp terminal_resolution_status(:resolved), do: "resolved"
  defp terminal_resolution_status(:cancelled), do: "cancelled"
  defp terminal_resolution_status(_), do: "closed"

  defp terminal_action_type(:resolved, params),
    do: map_field(params, :action_type) || "confirm_before_execute"

  defp terminal_action_type(:cancelled, params),
    do: map_field(params, :action_type) || "reject_or_cancel_confirmation"

  defp terminal_action_type(_status, params), do: map_field(params, :action_type)

  defp adoption_decision_ref(%AdoptionDecision{} = decision), do: decision.adoption_decision_id
  defp adoption_decision_ref(_), do: nil

  defp adoption_decision_trace_ref(%AdoptionDecision{} = decision),
    do: decision.decision_trace_ref

  defp adoption_decision_trace_ref(_), do: nil

  defp build_discard_turn_result(source_turn_result, artifact) do
    source_turn_id = turn_id(source_turn_result)
    artifact_id = artifact_field(artifact, :artifact_id)

    %{
      schema_version: "3.0-draft",
      turn_id: NovelFoundation.ID.unique("turn_discard"),
      parent_turn_id: source_turn_id,
      assistant_message: %{text: "已放弃该待采纳内容。"},
      ui_cards: [],
      trace_summary: %{
        decision_type: "discard_artifact",
        reason_codes: ["author_discarded_pending_artifact"],
        decision_trace_ref: nil,
        state_trace_ref: nil
      },
      phase: "completed",
      status: "conversational",
      available_actions: [],
      adoption_state: %{
        pending: [],
        resolved: [
          %{
            artifact_id: artifact_id,
            artifact_type: artifact_field(artifact, :artifact_type),
            adoption_status: AdoptionStatus.discarded(),
            requires_adoption: false,
            source_artifact_ref: artifact_id,
            payload: artifact_field(artifact, :payload) || %{}
          }
        ]
      },
      projection_refs: [],
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false,
        state_persisted: false,
        mutation_ref: nil,
        adopted_state_ref: nil,
        durable_behavior_opened: false,
        decision_type: :discard_artifact,
        reason_codes: ["author_discarded_pending_artifact"]
      }
    }
  end

  # 非采纳决定的 TurnResult：不写 production fact、不发 projection_refs。
  # - require_confirmation：打开 confirmation BehaviorState + confirm/reject available_actions
  #   （ADR-0008/0009），作者确认后重新 gate；artifact 留在原 pending。
  # - reject / fail_with_recovery：终态，available_actions 为空。
  defp build_decision_turn_result(
         source_turn_result,
         %AdoptionDecision{} = decision,
         artifact,
         decision_opts
       ) do
    source_turn_id = turn_id(source_turn_result)
    artifact_id = artifact_field(artifact, :artifact_id)
    confirmation? = decision.decision_type == :require_confirmation
    behavior_id = "bh_confirm_#{artifact_id}"

    %{
      schema_version: "3.0-draft",
      turn_id: NovelFoundation.ID.unique("turn_adopt"),
      parent_turn_id: source_turn_id,
      assistant_message: %{text: decision_message(decision, artifact, decision_opts)},
      ui_cards: [],
      trace_summary: %{
        decision_type: to_string(decision.decision_type),
        reason_codes: decision.reason_codes,
        decision_trace_ref: decision.decision_trace_ref,
        state_trace_ref: decision.state_trace_ref
      },
      phase: decision_phase(decision),
      status: decision_status(decision),
      available_actions:
        if(confirmation?, do: confirmation_available_actions(artifact_id, behavior_id), else: []),
      behavior_state:
        BehaviorState.snapshot(
          if(confirmation?,
            do: confirmation_behavior(behavior_id, artifact_id, source_turn_id, decision),
            else: nil
          )
        ),
      projection_refs: [],
      adoption_decision: decision_payload(decision),
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false,
        state_persisted: false,
        mutation_ref: nil,
        adopted_state_ref: nil,
        durable_behavior_opened: confirmation?,
        decision_type: decision.decision_type,
        reason_codes: decision.reason_codes
      }
    }
  end

  defp confirmation_available_actions(artifact_id, behavior_id) do
    [
      %{
        action_id: "confirm:#{artifact_id}",
        action_type: "confirm_before_execute",
        target_ref: artifact_id,
        behavior_ref: behavior_id,
        idempotency_key: "idem:confirm:#{artifact_id}",
        enabled: true
      },
      %{
        action_id: "reject:#{artifact_id}",
        action_type: "reject_or_cancel_confirmation",
        target_ref: artifact_id,
        behavior_ref: behavior_id,
        idempotency_key: "idem:reject:#{artifact_id}",
        enabled: true
      }
    ]
  end

  # 采纳覆盖确认是 durable BehaviorState（VS-03 §4）；构造领域结构体，由
  # BehaviorState.snapshot/1 序列化成 schema behavior_state，和主链同一形状。
  defp confirmation_behavior(behavior_id, artifact_id, source_turn_id, decision) do
    %BehaviorState{
      behavior_id: behavior_id,
      behavior_type: :confirmation,
      lifecycle_status: :awaiting_author,
      blocking_actor: :author,
      opened_at_turn_ref: source_turn_id,
      opened_by_decision_ref: decision.adoption_decision_id,
      frame_ref: source_turn_id,
      target_ref: artifact_id,
      required_next_action: "confirm_before_execute",
      available_actions: confirmation_available_actions(artifact_id, behavior_id),
      prompt_contract: %{
        summary: "采纳会覆盖该章节已有的已采纳正文，确认后才写入作品事实。",
        reason_codes: decision.reason_codes
      },
      trace_ref: decision.decision_trace_ref
    }
  end

  defp decision_phase(%AdoptionDecision{decision_type: :require_confirmation}),
    do: "awaiting_author"

  defp decision_phase(%AdoptionDecision{decision_type: :fail_with_recovery}), do: "failed"
  defp decision_phase(_decision), do: "completed"

  defp decision_status(%AdoptionDecision{decision_type: :require_confirmation}),
    do: "needs_confirmation"

  defp decision_status(%AdoptionDecision{decision_type: :reject}), do: "cancelled"
  defp decision_status(%AdoptionDecision{decision_type: :fail_with_recovery}), do: "failed"
  defp decision_status(_decision), do: "conversational"

  # 确认卡必须说清「为什么要我确认」：拦截住了但不给裁决材料，等于把判断推给作者
  # 又不给他依据（M4 的 15 次元泄漏确认，作者并不知道泄漏在哪一句）。按 reason_codes
  # 分派具体理由，落在原因语义上；未识别的原因回落原泛化文案。
  defp decision_message(
         %AdoptionDecision{decision_type: :require_confirmation} = decision,
         artifact,
         decision_opts
       ) do
    reason_codes = decision.reason_codes || []

    cond do
      "duplicate_character_name" in reason_codes ->
        duplicate_name_confirmation_message(artifact, decision_opts)

      "meta_leak_detected" in reason_codes ->
        meta_leak_confirmation_message(artifact)

      true ->
        "这段草稿需要你进一步确认对象和影响后才能采纳；当前未写入正文或作品事实。"
    end
  end

  defp decision_message(%AdoptionDecision{decision_type: :reject}, _artifact, _decision_opts),
    do: "当前不能采纳这段草稿，来源或状态已不满足采纳条件；草稿仍保留为待采纳。"

  defp decision_message(%AdoptionDecision{decision_type: :fail_with_recovery}, _artifact, _opts),
    do: "未能采纳这段草稿，请重新生成或检查目标章节后再试；当前未写入作品事实。"

  defp decision_message(_decision, _artifact, _decision_opts), do: "已处理这段草稿的采纳请求。"

  # 同名不是数据冲突而是创作判断（真重名/别名/改名），必须把「已有谁」告诉作者。
  # 别名命中（AU12 CP2）时更要点名「它是谁的别名」——作者裁决材料不能少这半句。
  defp duplicate_name_confirmation_message(artifact, decision_opts) do
    name = artifact |> adoption_chapter_title() |> to_string() |> String.trim()
    canonical = to_string(Map.get(decision_opts, :duplicate_character_canonical) || "")
    alias_hit = Map.get(decision_opts, :duplicate_character_alias_hit) == true

    if alias_hit and name != "" and canonical != "" do
      "「#{name}」是已确认角色「#{canonical}」的已登记别名。这可能是同一个人的重复提案，" <>
        "也可能是恰好同名的新角色——这需要你判断。确认后会新增一条角色档案；当前未写入作品事实。"
    else
      name_part = if name == "", do: "同名", else: "名为「#{name}」的"

      "作品档案里已经有#{name_part}已确认角色。同名可能是同一个人、别名或改名，" <>
        "也可能确实是两个同名角色——这需要你判断。确认后会新增一条角色档案；当前未写入作品事实。"
    end
  end

  # 元泄漏拦截同理：作者要判断的是「这句产品用语该不该留在正文里」，得先看见是哪句。
  defp meta_leak_confirmation_message(artifact) do
    hits =
      artifact
      |> artifact_meta_leak_hits()
      |> Enum.uniq()
      |> Enum.take(3)

    hit_part =
      case hits do
        [] -> "产品用语或章节自指"
        list -> Enum.map_join(list, "、", &"「#{&1}」")
      end

    "这段草稿里出现了#{hit_part}——属于产品用语或章节自指，采纳后会原样进入正文，" <>
      "读者也会看到。确认后仍按原文保存；当前未写入正文。"
  end

  defp build_edited_turn_result(
         source_turn_result,
         %AdoptionDecision{} = decision,
         artifact,
         persisted
       ) do
    source_turn_id = turn_id(source_turn_result)
    artifact_id = artifact_field(artifact, :artifact_id)
    adopted_state_ref = adopted_state_ref(persisted, decision)
    turn_id = NovelFoundation.ID.unique("turn_edit_accept")

    state_trace_refs =
      state_trace_refs(
        decision,
        artifact,
        persisted,
        turn_id,
        source_turn_id,
        :artifact_edited_accepted
      )

    state_trace_ref = primary_state_trace_ref(state_trace_refs)

    %{
      schema_version: "3.0-draft",
      turn_id: turn_id,
      parent_turn_id: source_turn_id,
      assistant_message: %{text: "已按修改意见采纳该内容。"},
      ui_cards: [],
      trace_summary: %{
        trace_ref: action_trace_ref(turn_id),
        decision_type: "edit_then_accept",
        reason_codes: ["author_edited_pending_artifact", "candidate_adopted_as_tentative"],
        source_turn_ref: source_turn_id,
        source_trace_ref: trace_ref(source_turn_result),
        decision_trace_ref: decision.decision_trace_ref,
        state_trace_ref: state_trace_ref,
        state_trace_refs: state_trace_refs,
        no_tool_reason: "author_action_does_not_call_tool",
        no_behavior_reason: "edit_then_accept action resolved through boundary",
        no_write_reason: adoption_no_write_reason(persisted),
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        event_order: adoption_event_order(state_trace_refs, persisted)
      },
      phase: "completed",
      status: "conversational",
      available_actions: [],
      adoption_state: %{
        pending: [],
        resolved: [
          %{
            artifact_id: artifact_id,
            artifact_type: artifact_field(artifact, :artifact_type),
            adoption_status: AdoptionStatus.edited_accepted(),
            requires_adoption: false,
            source_artifact_ref: artifact_id,
            adopted_state_ref: adopted_state_ref,
            state_trace_ref: state_trace_ref,
            decision_trace_ref: decision.decision_trace_ref,
            mutation_ref: persisted[:mutation_id],
            payload: artifact_field(artifact, :payload) || %{}
          }
        ]
      },
      projection_refs:
        projection_refs(decision, persisted, source_turn_id, artifact_id, state_trace_ref),
      truthfulness: %{
        tool_called: false,
        artifact_adopted: true,
        production_write_performed: persisted[:persisted] == true,
        state_persisted: persisted[:persisted] == true,
        mutation_ref: persisted[:mutation_id],
        adopted_state_ref: adopted_state_ref,
        durable_behavior_opened: false,
        decision_type: :edit_then_accept,
        reason_codes: ["author_edited_pending_artifact", "candidate_adopted_as_tentative"]
      }
    }
  end

  defp projection_refs(
         %AdoptionDecision{projection_hints: hints},
         persisted,
         source_turn_id,
         artifact_id,
         state_trace_ref
       ) do
    source_revision_ref = persisted[:source_revision_ref] || "#{source_turn_id}:#{artifact_id}"
    reading_projection = persisted[:reading_projection]

    if reading_projection do
      Enum.map(hints, fn hint ->
        %{
          projection_type: "reading_projection_toc",
          projection_id:
            to_string(
              reading_projection_ref(reading_projection) || hint[:projection_ref] ||
                "reading_projection"
            ),
          source_revision_refs: [source_revision_ref],
          source_state_trace_ref: state_trace_ref,
          refresh_status: "STALE",
          projection_hint_id: hint[:projection_hint_id],
          reason: hint[:reason]
        }
      end)
    else
      []
    end
  end

  defp state_trace_refs(
         %AdoptionDecision{} = decision,
         artifact,
         persisted,
         turn_id,
         source_turn_id,
         event_type \\ :candidate_adopted
       ) do
    if persisted?(persisted) do
      projection_ref = reading_projection_ref(persisted[:reading_projection])

      [
        %{
          trace_status: :summary_level,
          state_trace_ref: decision.state_trace_ref || "state_trace:#{turn_id}",
          event_type: event_type,
          action_turn_ref: turn_id,
          source_turn_ref: source_turn_id,
          adoption_decision_ref: decision.adoption_decision_id,
          decision_trace_ref: decision.decision_trace_ref,
          candidate_ref: decision.candidate_ref,
          target_ref: decision.target_ref || artifact_field(artifact, :artifact_id),
          artifact_id: artifact_field(artifact, :artifact_id),
          artifact_type: artifact_field(artifact, :artifact_type),
          adopted_state_ref: adopted_state_ref(persisted, decision),
          mutation_ref: persisted_value(persisted, :mutation_id),
          source_revision_ref: persisted_value(persisted, :source_revision_ref),
          production_write_performed: true,
          projection_ref: projection_ref,
          projection_hint_refs: projection_hint_refs(decision.projection_hints)
        }
        |> reject_nil_values()
      ]
    else
      []
    end
  end

  defp persisted?(persisted) when is_map(persisted),
    do: persisted_value(persisted, :persisted) == true

  defp persisted?(_persisted), do: false

  defp primary_state_trace_ref([ref | _]), do: map_field(ref, :state_trace_ref)
  defp primary_state_trace_ref(_), do: nil

  defp action_trace_ref(turn_id), do: "trace:#{turn_id}"

  defp adoption_no_write_reason(persisted) do
    if persisted?(persisted) do
      "production state changed through adoption boundary with state trace"
    else
      "adoption boundary accepted but no persistence writer recorded production state"
    end
  end

  defp adoption_event_order([_ | _], persisted) do
    base = [
      :author_action_received,
      :adoption_boundary_evaluated,
      :candidate_adopted,
      :production_state_written,
      :state_trace_recorded
    ]

    if persisted_value(persisted, :reading_projection) do
      base ++ [:projection_hint_emitted, :turn_result_emitted]
    else
      base ++ [:turn_result_emitted]
    end
  end

  defp adoption_event_order([], _persisted),
    do: [:author_action_received, :adoption_boundary_evaluated, :turn_result_emitted]

  defp projection_hint_refs(hints) when is_list(hints) do
    hints
    |> Enum.map(&(map_field(&1, :projection_hint_id) || map_field(&1, :projection_ref)))
    |> Enum.reject(&blank?/1)
  end

  defp projection_hint_refs(_hints), do: []

  defp reading_projection_ref(%{} = reading_projection) do
    cond do
      persisted_value(reading_projection, :draft_id) ->
        "reading_projection:draft:#{persisted_value(reading_projection, :draft_id)}"

      persisted_value(reading_projection, :chapter_id) ->
        "reading_projection:chapter:#{persisted_value(reading_projection, :chapter_id)}"

      true ->
        nil
    end
  end

  defp reading_projection_ref(_reading_projection), do: nil

  defp reject_nil_values(map) when is_map(map) do
    Map.reject(map, fn {_key, value} -> is_nil(value) or value == [] end)
  end

  defp adopted_state_ref(persisted, %AdoptionDecision{} = decision) when is_map(persisted) do
    persisted_value(persisted, :character_id) ||
      persisted_value(persisted, :memory_item_id) ||
      decision.adopted_state_ref
  end

  defp adopted_state_ref(_persisted, %AdoptionDecision{} = decision),
    do: decision.adopted_state_ref

  defp persisted_value(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, to_string(key))
  end

  defp decision_payload(%AdoptionDecision{} = decision) do
    %{
      adoption_decision_id: decision.adoption_decision_id,
      decision_type: decision.decision_type,
      candidate_ref: decision.candidate_ref,
      target_ref: decision.target_ref,
      adopted_state_ref: decision.adopted_state_ref,
      state_trace_ref: decision.state_trace_ref,
      decision_trace_ref: decision.decision_trace_ref,
      reason_codes: decision.reason_codes,
      projection_hints: decision.projection_hints
    }
  end

  # 采纳 provenance → 持久化分流：续写 append 同章新场景累积；重写/默认 overwrite 覆盖。
  defp adoption_mode(artifact) do
    case artifact_field(artifact, :authoring_intent) do
      :continuation -> :append
      "continuation" -> :append
      _ -> :overwrite
    end
  end

  # 续写/重写归目标章（target_chapter provenance）；无则回退 artifact 标题。
  defp adoption_chapter_title(artifact) do
    case artifact_field(artifact, :target_chapter) do
      title when is_binary(title) ->
        case String.trim(title) do
          "" -> artifact_summary(artifact)
          trimmed -> trimmed
        end

      _ ->
        artifact_summary(artifact)
    end
  end

  # 章节标题（归章用）优先取创作内容本身的 item 标题，而不是通用 UI 卡片标签
  # （例如"章节正文草稿"、"大纲草稿"这类展示标题不该成为章节名）。
  # items 无可用标题时才回退 payload.title，最后回退"已采纳内容"。
  defp artifact_summary(artifact) do
    payload = artifact_field(artifact, :payload) || %{}
    items = payload[:items] || payload["items"]

    cond do
      is_list(items) && summary_from_items(items, artifact) ->
        summary_from_items(items, artifact)

      meaningful_title?(payload[:title], artifact) ->
        String.trim(payload[:title])

      meaningful_title?(payload["title"], artifact) ->
        String.trim(payload["title"])

      true ->
        "已采纳内容"
    end
  end

  defp summary_from_items(items, artifact) do
    items
    |> Enum.map(&item_title/1)
    |> Enum.find(&meaningful_title?(&1, artifact))
    |> case do
      nil -> nil
      title -> title |> to_string() |> String.trim()
    end
  end

  defp item_title(item) when is_map(item), do: Map.get(item, :title) || Map.get(item, "title")
  defp item_title(_), do: nil

  # 叙事角色（主角/反派/...）来自 artifact item 的结构化字段，落到角色主档案。
  # 取第一个带 narrative_role 的 item（CP1 单角色采纳；逐项采纳归 per-item slice）。
  defp artifact_narrative_role(artifact) do
    payload = artifact_field(artifact, :payload) || %{}
    items = payload[:items] || payload["items"]

    if is_list(items) do
      items
      |> Enum.map(&item_narrative_role/1)
      |> Enum.find(&is_binary/1)
    end
  end

  defp item_narrative_role(item) when is_map(item),
    do: Map.get(item, :narrative_role) || Map.get(item, "narrative_role")

  defp item_narrative_role(_), do: nil

  # role/aliases（AU12 CP2 角色主体输入面）：与 narrative_role 同先例——取第一个
  # 带该键的 item（逐项采纳后单元只剩一个 item），落到角色主档案。
  defp artifact_character_field(artifact, key) do
    payload = artifact_field(artifact, :payload) || %{}
    items = payload[:items] || payload["items"]

    if is_list(items) do
      Enum.find_value(items, fn
        item when is_map(item) -> Map.get(item, key) || Map.get(item, to_string(key))
        _ -> nil
      end)
    end
  end

  # 全书规划建议槽位（VS-00G CP4d）：逐项采纳后单元只剩一个 item，取第一个带槽位
  # 的 item（与 narrative_role 同先例）。落位=works 立项字段回写。
  defp artifact_skeleton_slot(artifact, key) do
    payload = artifact_field(artifact, :payload) || %{}
    items = payload[:items] || payload["items"]

    if is_list(items) do
      Enum.find_value(items, fn
        item when is_map(item) -> Map.get(item, key) || Map.get(item, Atom.to_string(key))
        _item -> nil
      end)
    end
  end

  # 角色演化记忆子类（CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP）来自 artifact item。
  defp artifact_memory_subtype(artifact) do
    payload = artifact_field(artifact, :payload) || %{}
    items = payload[:items] || payload["items"]

    if is_list(items) do
      items
      |> Enum.map(&item_memory_subtype/1)
      |> Enum.find(&is_binary/1)
    end
  end

  defp item_memory_subtype(item) when is_map(item),
    do: Map.get(item, :memory_subtype) || Map.get(item, "memory_subtype")

  defp item_memory_subtype(_), do: nil

  defp meaningful_title?(title, artifact) when is_binary(title) do
    trimmed = String.trim(title)
    artifact_id = artifact_field(artifact, :artifact_id)

    trimmed != "" and trimmed != artifact_id and not String.match?(trimmed, ~r/^as_\d+$/)
  end

  defp meaningful_title?(_, _artifact), do: false

  defp artifact_content(artifact) do
    payload = artifact_field(artifact, :payload) || %{}
    items = payload[:items] || payload["items"]

    cond do
      is_binary(payload[:content]) -> payload[:content]
      is_binary(payload["content"]) -> payload["content"]
      is_list(items) -> items_to_content(items, artifact)
      true -> artifact_summary(artifact)
    end
  end

  # 正文类（prose_fragment/scene_draft）：正文 = 各 item 的 body 本身。不要把 item title
  # 拼进正文——title 已作为章节标题（adoption_chapter_title）单独承载，再拼一次会让正文以
  # "第N章：标题: …"重复开头（曾在阅读视图里看到）。其余类型保留 "title: body" 拼接。
  defp items_to_content(items, artifact) do
    if reading_projection_artifact_type?(artifact_field(artifact, :artifact_type)) do
      items
      |> Enum.map(&item_body/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n\n")
    else
      Enum.map_join(items, "\n", &item_content/1)
    end
  end

  defp item_body(item) when is_map(item) do
    (Map.get(item, :body) || Map.get(item, "body") || Map.get(item, :content) ||
       Map.get(item, "content") || "")
    |> to_string()
    |> String.trim()
  end

  defp item_body(other), do: other |> to_string() |> String.trim()

  defp edited_artifact(artifact, params) do
    payload = artifact_field(artifact, :payload) || %{}

    original_content =
      Map.get(params, "content") || payload[:content] || payload["content"] ||
        artifact_summary(artifact)

    edited = normalize_edit(Map.get(params, "edited_content"))
    instruction = normalize_edit(Map.get(params, "instruction"))

    # 作者全文编辑优先：直接替换正文（采纳/阅读投影/字数都以编辑后内容为准）。
    # 否则回退到旧版「修改要求」追加语义，保持向后兼容。
    {new_content, edit_instruction} =
      if edited do
        {edited, nil}
      else
        {edited_content(original_content, instruction), instruction}
      end

    edited_payload =
      payload
      |> Map.put(:content, new_content)
      |> Map.put(:original_content, original_content)
      |> Map.put(:edit_instruction, edit_instruction)

    put_artifact_field(artifact, :payload, edited_payload)
  end

  defp edited_content(original_content, instruction) do
    [to_string(original_content), "修改要求：#{instruction}"]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end

  defp item_content(item) when is_map(item) do
    title = Map.get(item, :title) || Map.get(item, "title")

    body =
      Map.get(item, :body) || Map.get(item, "body") || Map.get(item, :content) ||
        Map.get(item, "content")

    [title, body]
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
    |> Enum.join(": ")
  end

  defp item_content(other), do: to_string(other)

  defp normalized_base_revision(nil), do: 1
  defp normalized_base_revision(value) when is_integer(value) and value > 0, do: value

  defp normalized_base_revision(value) when is_binary(value) do
    case Integer.parse(value) do
      {int, ""} when int > 0 -> int
      _ -> 1
    end
  end

  defp normalized_base_revision(_), do: 1

  defp candidate_type(:plot_direction), do: :direction
  defp candidate_type("plot_direction"), do: :direction
  defp candidate_type(:character_seed), do: :setting
  defp candidate_type("character_seed"), do: :setting
  defp candidate_type(:world_setting), do: :setting
  defp candidate_type("world_setting"), do: :setting
  defp candidate_type(:foreshadowing_seed), do: :setting
  defp candidate_type("foreshadowing_seed"), do: :setting
  defp candidate_type(:world_rule_seed), do: :setting
  defp candidate_type("world_rule_seed"), do: :setting
  defp candidate_type(:style_rule_seed), do: :setting
  defp candidate_type("style_rule_seed"), do: :setting
  defp candidate_type(:constraint_seed), do: :setting
  defp candidate_type("constraint_seed"), do: :setting
  defp candidate_type(:work_skeleton_suggestion), do: :setting
  defp candidate_type("work_skeleton_suggestion"), do: :setting
  defp candidate_type(:outline_draft), do: :outline
  defp candidate_type("outline_draft"), do: :outline
  defp candidate_type(_), do: :draft_fragment

  defp trace_ref(source_turn_result), do: TraceSummaryRef.from_turn_result(source_turn_result)

  defp turn_id(source_turn_result), do: map_field(source_turn_result, :turn_id)

  defp get_in_any(map, keys) when is_map(map), do: do_get_in_any(map, keys)
  defp get_in_any(_, _), do: nil

  defp do_get_in_any(value, []), do: value

  defp do_get_in_any(map, [key | rest]) when is_map(map) do
    map
    |> map_field(key)
    |> do_get_in_any(rest)
  end

  defp do_get_in_any(_, _), do: nil

  defp map_field(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_field(_, _), do: nil

  defp artifact_field(map, key) when is_map(map) do
    map_field(map, key)
  end

  defp put_artifact_field(map, key, value) when is_map(map) do
    if Map.has_key?(map, key),
      do: Map.put(map, key, value),
      else: Map.put(map, Atom.to_string(key), value)
  end

  defp first_present(values) do
    Enum.find(values, &(not blank?(&1)))
  end

  defp blank?(value), do: is_nil(value) or value == ""
end
