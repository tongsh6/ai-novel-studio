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
  alias NovelDomain.CanonFreshness
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MutationStatus
  alias NovelFoundation.Enums.NarrativeRole

  require NovelCommon.LogEmit, as: LogEmit

  @spec handle_adopt(
          map() | nil,
          map(),
          function() | nil,
          function() | nil,
          function() | nil,
          (String.t(), String.t() -> boolean()) | nil,
          (String.t(), tuple() -> {:ok, map()} | {:error, term()}) | nil
        ) ::
          {:ok, map(), map()} | {:error, String.t()}
  def handle_adopt(
        source_turn_result,
        params,
        adoption_writer \\ NovelApplication.persistence_adoption_writer(),
        overwrite_reader \\ NovelApplication.persistence_overwrite_reader(),
        summary_maintainer \\ NovelApplication.chapter_summary_maintainer(),
        duplicate_name_checker \\ NovelApplication.persistence_accepted_character_name_checker(),
        canon_reader \\ NovelApplication.persistence_canon_reader()
      )

  def handle_adopt(
        nil,
        _params,
        _adoption_writer,
        _overwrite_reader,
        _summary_maintainer,
        _duplicate_name_checker,
        _canon_reader
      ),
      do: {:error, "source_turn_result not available"}

  def handle_adopt(
        source_turn_result,
        %{"artifact_id" => artifact_id} = params,
        adoption_writer,
        overwrite_reader,
        summary_maintainer,
        duplicate_name_checker,
        canon_reader
      )
      when is_binary(artifact_id) do
    # 结构性/无效 action（artifact 不存在、跨作品、stale revision）保持 {:error}，
    # 由 channel 侧 ActionValidator 在前置守门。AdoptionBoundary 的决定（采纳/需确认/
    # 拒绝/失败恢复）则一律以 TurnResult 形式回传，满足 ADR-0010 决策规则4 与
    # VS-04 §4.5「adoption failure 必须产生 TurnResult，不允许静默丢弃」。
    with {:ok, artifact} <- find_pending_artifact(source_turn_result, artifact_id),
         {:ok, work_context} <- validate_work_boundary(source_turn_result, artifact, params),
         :ok <- check_current_pending(params, artifact_id),
         :ok <- check_revision_base(artifact, params) do
      candidate_set = candidate_set_from_artifact(source_turn_result, artifact)

      opts =
        work_context
        |> adoption_decision_opts(
          artifact,
          params,
          overwrite_reader,
          duplicate_name_checker
        )
        # B47 CP1/CP2：决策前先做系统计算的契约/freshness 判定（持久 canon 版本）。
        # 持久化事务内 B28/B36/B29 现有重校验保留为最终 re-gate 防线。
        |> Map.put(:adoption_contract, validate_b28_contract(artifact))
        |> Map.put(
          :canon_freshness,
          canon_freshness_verdict(artifact, work_context.work_id, canon_reader)
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
        _duplicate_name_checker,
        _canon_reader
      ),
      do: {:error, "artifact_id is required"}

  # 把 work boundary、覆盖判定、确认状态合成采纳边界 opts。
  # 覆盖已有正文（同 title 章节已有已采纳内容）= 高风险 production write → 需确认。
  defp adoption_decision_opts(work_context, artifact, params, overwrite_reader, name_checker) do
    duplicate_match = duplicate_character_match(work_context, artifact, name_checker)

    work_context
    |> Map.put(:confirmation_satisfied, truthy?(Map.get(params, "confirmation_satisfied")))
    |> Map.put(
      :overwrite,
      overwrite_existing?(overwrite_reader, work_context.work_id, artifact) or
        adopted_revision?(artifact)
    )
    |> Map.put(:meta_leak_hits, artifact_meta_leak_hits(artifact))
    |> Map.put(:duplicate_character_name, duplicate_match && duplicate_match.proposed)
    |> Map.put(:duplicate_character_canonical, duplicate_match && duplicate_match.canonical)
    |> Map.put(
      :duplicate_character_alias_hit,
      (duplicate_match && duplicate_match.alias_hit) == true
    )
    # ADR-0008 8-2：同 workstream 上一个 active author-blocking behavior（由 Channel
    # 从本 socket 的 turn_results 快照读出）。新 confirmation 打开时显式 supersede，
    # 而不是依赖 Channel current-turn guard 隐式失效。
    |> Map.put(
      :previous_behavior,
      Map.get(params, "previous_behavior") || Map.get(params, :previous_behavior)
    )
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
      reader.(work_id, adoption_chapter_identity(artifact))
  end

  defp overwrite_existing?(_reader, _work_id, _artifact), do: false

  # Q1c：修订已采纳设定的候选必须走覆盖确认，即使目标不是正文。
  defp adopted_revision?(artifact) do
    not is_nil(artifact_revision_of(artifact)) and
      not is_nil(artifact_supersedes_ref(artifact))
  end

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

          {:ok, build_action_result(decision, artifact, persisted, decision_opts),
           build_turn_result(
             source_turn_result,
             decision,
             artifact,
             persisted,
             params,
             decision_opts
           )}

        {:error, reason} ->
          # BB-7（VS-04 规则 5 / ADR-0010 #1，2026-10-23 作者拍板方案 A）：采纳
          # 持久化失败不允许静默丢弃——产出失败 action_result + failed_recoverable
          # TurnResult，走既有 action_result/turn_result 广播；原候选保持 pending，
          # 作品事实未被修改。原始错误只进 developer 日志（author-safe）。
          # B47 CP2：事务内重 gate 的拒绝（stale/冲突/越界）映射为具体 reason code，
          # 不再一律 generalize 成 adoption_persistence_failed。
          {reason_code, detail} = classify_persistence_failure(reason)

          LogEmit.emit(:adoption, :persist, :error, %{
            reason_code: reason_code,
            artifact_id: artifact_field(artifact, :artifact_id),
            canonical_versions: canonical_versions_log(decision_opts),
            outcome_detail: to_string(detail) |> String.slice(0, 300)
          })

          {:ok, build_failed_action_result(decision, artifact, reason_code, decision_opts),
           build_persistence_failure_turn_result(
             source_turn_result,
             decision,
             artifact,
             reason_code,
             decision_opts
           )}
      end
    else
      {:ok, build_decision_action_result(decision, artifact, decision_opts),
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
         chapter_id when is_binary(chapter_id) <- chapter_id_from_persisted(persisted),
         work_id = Map.get(params, "work_id") || map_field(source_turn_result, :work_id),
         {:ok, prose, scope} <- summary_material(artifact, work_id, chapter_id) do
      maintainer.(%{
        work_id: work_id,
        chapter_id: chapter_id,
        chapter_title: adoption_chapter_title(artifact),
        prose_text: prose,
        source_ref: turn_id(source_turn_result),
        revision_base: revision_base_from_persisted(persisted),
        # B27 CP3c/D4：主采纳路径只有本次采纳片段，不是整章已采纳正文；
        # 如实标注范围，摘要不得冒充整章。
        material_scope: scope
      })

      :ok
    else
      _ -> :ok
    end
  rescue
    _ -> :ok
  end

  defp summary_material(artifact, work_id, chapter_id) do
    if formatting_plan?(artifact) do
      with {:ok, facts} <- chapter_revision_context(work_id, "chapter:" <> chapter_id) do
        {:ok, facts.base_text, :chapter}
      end
    else
      {:ok, artifact_content(artifact), :fragment}
    end
  end

  defp formatting_plan?(artifact),
    do:
      artifact_field(artifact, :artifact_type) in [
        :prose_formatting_plan,
        "prose_formatting_plan"
      ]

  defp prose_artifact?(artifact) do
    artifact_field(artifact, :artifact_type) in [
      :prose_fragment,
      "prose_fragment",
      :prose_formatting_plan,
      "prose_formatting_plan",
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

  defp revision_base_from_persisted(persisted) when is_map(persisted) do
    case Map.get(persisted, :reading_projection) do
      %{source_revision_ref: ref} when is_binary(ref) -> ref
      _ -> Map.get(persisted, :source_revision_ref)
    end
  end

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
         {:ok, _work_context} <- validate_work_boundary(source_turn_result, artifact, params),
         :ok <- check_current_pending(params, artifact_id) do
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
        {:error, "edited_content is required; use candidate revision for instructions"}

      true ->
        handle_modify_draft_with_artifact(
          source_turn_result,
          params,
          adoption_writer,
          artifact_id
        )
    end
  end

  # 修改后采纳只接收作者完成编辑的全文；修改指令必须走独立修订候选，不能拼进正文入档。
  defp has_edit_payload?(params),
    do: not is_nil(normalize_edit(Map.get(params, "edited_content")))

  defp normalize_edit(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_edit(_value), do: nil

  defp check_current_pending(%{"work_id" => work, "session_id" => session}, artifact_id)
       when is_binary(work) and is_binary(session) do
    if NovelApplication.WorkSessionService.pending_artifact_available?(
         work,
         session,
         artifact_id
       ), do: :ok, else: {:error, "pending artifact is no longer available"}
  end

  # 未接持久作用域的内存调用保留原边界；真实 Channel 和对话操作必须传可信 work/session。
  defp check_current_pending(_params, _artifact_id), do: :ok

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
         :ok <- check_current_pending(params, artifact_id),
         :ok <- check_revision_base(artifact, params),
         edited_artifact <- edited_artifact(artifact, params),
         candidate_set <- candidate_set_from_artifact(source_turn_result, edited_artifact),
         decision <-
           AdoptionBoundary.evaluate(
             candidate_set,
             %{"candidate_id" => artifact_id, "work_id" => work_context.work_id},
             nil,
             work_context
             |> Map.put(
               :confirmation_satisfied,
               truthy?(Map.get(params, "confirmation_satisfied"))
             )
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

  @doc """
  B28 CP1：章级修订上下文事实（只读）——阅读投影顺序的 covered refs/versions + 覆盖账。
  task-49（builder/render）可据此调用 AuthoringTaskBuilder.for_chapter_revision/1。
  """
  def chapter_revision_context(work_id, chapter_identity) do
    case NovelPersistence.AdoptionRepository.accepted_chapter_scopes(work_id, chapter_identity) do
      {:ok, %{chapter_ref: ref, scopes: [_ | _] = scopes}} ->
        {:ok,
         %{
           target_chapter_ref: ref,
           covered_refs: Enum.map(scopes, &"draft:#{&1.draft_id}"),
           expected_base_versions:
             Enum.map(scopes, &%{ref: "draft:#{&1.draft_id}", version: &1.revision}),
           materials:
             Enum.map(scopes, fn scope ->
               %{
                 kind: :draft,
                 ref: "draft:#{scope.draft_id}",
                 version: scope.revision,
                 text: scope.content,
                 complete?: true,
                 omission_note: nil
               }
             end),
           # 整章当前阅读投影正文：沿用 ReadingProjectionRepo.accepted_chapter_prose/2 的
           # 约定——scene seq 升序、每 scene 当前 accepted draft、空片段剔除、
           # 片段间以 "\n\n" 连接（与阅读模式/章节阅读消费的章节正文一致）。
           base_text:
             scopes
             |> Enum.map(& &1.content)
             |> Enum.reject(&(&1 in [nil, ""]))
             |> Enum.join("\n\n"),
           coverage: :complete
         }}

      {:ok, _no_scopes} ->
        {:error, :incomplete_scope}

      # accepted_chapter_scopes/2 的错误面只有 :error（Ecto.UUID.cast 失败）与
      # {:error, :target_ambiguous | :target_missing}；原 :not_found 分支不可达（B60）。
      :error ->
        {:error, :target_missing}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  B28 CP1.5：该 work 有 accepted 正文的章目标列表（只读，按章 seq 排序）。
  返回 {:ok, [%{chapter_ref, chapter_title, seq, covered_refs, fragment_count, char_count, coverage}]}
  或 {:error, reason}；供判断上下文暴露章级目标（ref 唯一，title 仅展示）。
  """
  def chapter_revision_targets(work_id) do
    NovelPersistence.AdoptionRepository.accepted_chapter_targets(work_id)
  end

  # B28 CP1：采纳前契约守卫（目标作用域/排版模式）。仅在有 B28 additive 信号时收紧；
  # 缺省旧 artifact 保持 legacy 行为（迁移期兼容）。
  @doc false
  def validate_b28_contract(artifact) do
    payload = artifact_field(artifact, :payload) || %{}

    case character_revision_plan(payload) do
      nil ->
        case renumber_change_plan(payload) do
          nil -> validate_b28_adoption(artifact, payload)
          plan -> validate_renumber_change_plan(plan)
        end

      plan ->
        validate_character_revision(plan)
    end
  end

  defp validate_b28_adoption(artifact, payload) do
    effect = b28_map(payload, :adoption_effect)
    scope = b28_map(payload, :scope)
    effect_mode = b28_value(effect, :mode)
    modification = b28_modification_scope(payload, scope, effect_mode)

    cond do
      formatting_plan?(artifact) ->
        validate_formatting_plan(artifact, payload, effect)

      invalid_adoption_effect?(effect_mode) ->
        {:error, :invalid_adoption_effect}

      effect_requires_target?(effect_mode) and is_nil(adoption_chapter_ref(artifact)) ->
        {:error, :target_missing}

      b28_target_missing?(artifact, scope, effect_mode, modification) ->
        # 有 B28 修改范围但没有目标身份：默认拒绝，不再标题回退/新建章。
        {:error, :target_missing}

      modification == "format_only" ->
        validate_format_only(payload, artifact_content(artifact))

      true ->
        :ok
    end
  end

  defp validate_formatting_plan(artifact, payload, effect) do
    with ref when is_binary(ref) <- adoption_chapter_ref(artifact),
         "format_paragraphs" <- b28_value(effect, :mode),
         [item] <- b28_value(payload, :items),
         changes when is_list(changes) <- b28_value(item, :line_break_changes),
         true <- changes == b28_value(effect, :line_break_changes),
         {:ok, applied} <-
           NovelDomain.ProseFormatting.apply_plan(
             b28_value(payload, :base_text),
             b28_value(effect, :source_hash),
             changes
           ),
         true <- applied.text == b28_value(payload, :formatting_preview),
         true <- applied.result_hash == b28_value(effect, :preview_hash) do
      :ok
    else
      {:error, _} = error -> error
      _ -> {:error, :invalid_formatting_plan}
    end
  end

  defp b28_modification_scope(payload, scope, effect_mode) do
    b28_value(payload, :modification_scope) || b28_value(scope, :modification_scope) ||
      if(effect_mode == "format_only", do: "format_only")
  end

  defp invalid_adoption_effect?(mode),
    do: mode not in [nil, "replace_scope", "append", "new_chapter", "replace_segments"]

  defp effect_requires_target?(mode), do: mode in ["replace_scope", "append", "replace_segments"]

  defp b28_target_missing?(artifact, scope, effect_mode, modification) do
    b28_signal? = not is_nil(effect_mode) or not is_nil(modification)

    b28_signal? and is_nil(effect_mode) and is_nil(b28_value(scope, :target_chapter_ref)) and
      is_nil(adoption_chapter_ref(artifact)) and modification != "format_only"
  end

  defp renumber_change_plan(payload) when is_map(payload) do
    object_kind = b28_value(payload, :object_kind)
    plan = b28_map(payload, :change_plan)
    effect = b28_map(payload, :adoption_effect)

    if object_kind == "chapter_structure_change_plan" or
         b28_value(effect, :mode) == "renumber_chapters" or
         b28_value(plan, :operation) == "renumber_chapters" do
      plan || effect || payload
    end
  end

  defp renumber_change_plan(_payload), do: nil

  defp validate_renumber_change_plan(plan) do
    mapping = List.wrap(b28_value(plan, :mapping))
    effects = List.wrap(b28_value(plan, :effects) || ["display_number_only"])

    cond do
      effects != ["display_number_only"] ->
        {:error, :unsupported_effect}

      mapping == [] ->
        {:error, :no_target}

      Enum.any?(mapping, fn item ->
        is_nil(b28_value(item, :chapter_ref)) or not is_integer(b28_value(item, :to_seq))
      end) ->
        {:error, :no_target}

      true ->
        :ok
    end
  end

  defp renumber_plan_attrs(payload) do
    plan = renumber_change_plan(payload) || payload || %{}

    mapping =
      plan
      |> b28_value(:mapping)
      |> List.wrap()
      |> Enum.map(fn item ->
        %{
          "chapter_ref" => b28_value(item, :chapter_ref),
          "new_seq" => b28_value(item, :to_seq),
          "from_seq" => b28_value(item, :from_seq)
        }
      end)

    versions =
      plan
      |> b28_value(:base_versions)
      |> List.wrap()
      |> Map.new(fn item -> {b28_value(item, :chapter_ref), b28_value(item, :version)} end)

    expected =
      Enum.map(mapping, fn item ->
        %{
          "chapter_ref" => item["chapter_ref"],
          "expected_seq" => item["from_seq"],
          "version" => Map.get(versions, item["chapter_ref"])
        }
      end)

    %{mapping: mapping, expected: expected, object_count: b28_value(plan, :object_count)}
  end

  defp outline_chapter_refs(artifact) do
    payload = artifact_field(artifact, :payload) || %{}
    items = Map.get(payload, :items) || Map.get(payload, "items") || []

    items
    |> List.wrap()
    |> Enum.map(fn item ->
      Map.get(item, :chapter_ref) || Map.get(item, "chapter_ref") ||
        Map.get(item, :target_chapter_ref) || Map.get(item, "target_chapter_ref")
    end)
  end

  defp b36_scope_attr(artifact, key) do
    payload = artifact_field(artifact, :payload) || %{}
    scope = b28_map(payload, :scope)

    b28_value(scope, key) || b28_value(payload, key)
  end

  defp b28_effect_attrs(artifact) do
    payload = artifact_field(artifact, :payload) || %{}
    effect = b28_map(payload, :adoption_effect)
    scope = b28_map(payload, :scope)

    %{
      adoption_effect: effect,
      modification_scope:
        b28_value(payload, :modification_scope) || b28_value(scope, :modification_scope),
      target_chapter_ref: adoption_chapter_ref(artifact)
    }
  end

  defp b28_map(map, key) when is_map(map) do
    case Map.get(map, key) || Map.get(map, to_string(key)) do
      %{} = value -> value
      _ -> nil
    end
  end

  defp b28_map(_map, _key), do: nil

  defp b28_value(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, to_string(key))

  defp b28_value(_map, _key), do: nil

  defp validate_format_only(payload, content) do
    source = b28_value(payload, :base_text) || b28_value(payload, :source_text)

    cond do
      not is_binary(source) or source == "" ->
        {:error, :format_only_source_unavailable}

      normalize_format_text(source) == normalize_format_text(content) ->
        :ok

      true ->
        {offset, line} = first_format_difference(source, content)
        {:error, {:format_only_violation, %{offset: offset, line: line}}}
    end
  end

  # 冻结归一规则（B28 CP1）：行尾空白删除 → 换行归一 → 文末空行折叠；其余字节必须相等。
  defp normalize_format_text(text) do
    text
    |> to_string()
    |> String.replace("\r\n", "\n")
    |> String.replace("\r", "\n")
    |> String.split("\n")
    |> Enum.map_join("\n", &String.trim_trailing/1)
    |> String.replace(~r/\n+\z/u, "\n")
    |> String.trim_trailing("\n")
  end

  defp first_format_difference(source, content) do
    left = String.codepoints(normalize_format_text(source))
    right = String.codepoints(normalize_format_text(content))

    index =
      left
      |> Enum.zip(right)
      |> Enum.find_index(fn {a, b} -> a != b end)
      |> case do
        nil -> if length(left) == length(right), do: 0, else: min(length(left), length(right))
        value -> value
      end

    line = left |> Enum.take(index) |> Enum.count(&(&1 == "\n")) |> Kernel.+(1)
    {index, line}
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
    payload = artifact_field(artifact, :payload) || %{}

    case character_revision_plan(payload) do
      nil ->
        persist_artifact_adoption(writer, source_turn_result, decision, artifact, params, payload)

      plan ->
        persist_character_revision(source_turn_result, artifact, params, plan)
    end
  end

  defp persist_artifact_adoption(writer, source_turn_result, decision, artifact, params, payload) do
    case renumber_change_plan(payload) do
      nil ->
        case validate_b28_contract(artifact) do
          :ok -> do_persist_adoption(writer, source_turn_result, decision, artifact, params)
          error -> error
        end

      plan ->
        persist_renumber_adoption(source_turn_result, artifact, params, plan)
    end
  end

  defp persist_character_revision(source_turn_result, artifact, params, plan) do
    with :ok <- validate_character_revision(plan),
         work_id <-
           Map.get(params, "work_id") || artifact_field(artifact, :work_id) ||
             map_field(source_turn_result, :work_id),
         character_ref <- b28_value(plan, :character_ref),
         change <- plan_changes(plan) |> hd(),
         old_role <- b28_value(change, :old),
         new_role <- b28_value(change, :new),
         fingerprint <- b28_value(plan, :base_fingerprint),
         {:ok, receipt} <-
           NovelPersistence.AdoptionRepository.revise_character_narrative_role(
             work_id,
             character_ref,
             fingerprint,
             new_role,
             old_role: old_role
           ) do
      committed_change = %{
        field: "narrative_role",
        old: receipt.old,
        new: receipt.new
      }

      {:ok,
       %{
         mutation_id: nil,
         mutation_status: MutationStatus.applied(),
         source_revision_ref: "character_profile_revision:#{receipt.character_ref}",
         persisted: true,
         adoption_effect: %{mode: "character_field_update", effects: receipt.effects},
         committed_changes: [committed_change],
         character_ref: receipt.character_ref,
         base_fingerprint: receipt.base_fingerprint,
         current_fingerprint: Map.get(receipt, :current_fingerprint),
         object_count: receipt.object_count,
         duplicate: Map.get(receipt, :duplicate, false),
         reading_projection: nil
       }}
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp character_revision_plan(payload) when is_map(payload) do
    object_kind = b28_value(payload, :object_kind)
    effect = b28_map(payload, :adoption_effect)

    if object_kind == "character_profile_revision" or
         b28_value(effect, :mode) == "character_field_update" do
      payload
    end
  end

  defp character_revision_plan(_payload), do: nil

  defp validate_character_revision(plan) do
    with :ok <- validate_character_revision_target(plan),
         :ok <- validate_character_revision_effects(plan) do
      validate_character_revision_change(plan)
    end
  end

  defp validate_character_revision_target(plan) do
    if is_binary(b28_value(plan, :character_ref)), do: :ok, else: {:error, :target_missing}
  end

  defp validate_character_revision_effects(plan) do
    effects = List.wrap(b28_value(plan, :effects) || ["character_field_update"])
    other_changes = List.wrap(b28_value(plan, :other_character_changes) || [])

    cond do
      effects != ["character_field_update"] -> {:error, :unsupported_effect}
      # 首闭环只允许修订目标角色；“替换原主角/唯一主角”须作者逐项裁决，不能静默打包。
      other_changes != [] -> {:error, :unsupported_effect}
      true -> :ok
    end
  end

  defp validate_character_revision_change(plan) do
    changes = plan_changes(plan)
    change = List.first(changes) || %{}

    cond do
      length(changes) != 1 or b28_value(change, :field) != "narrative_role" ->
        {:error, :unsupported_field}

      is_nil(b28_value(change, :old)) ->
        {:error, :unsupported_field}

      not is_binary(b28_value(plan, :base_fingerprint)) ->
        {:error, :stale_base}

      not NarrativeRole.valid?(b28_value(change, :new)) ->
        {:error, :invalid_character_role}

      true ->
        :ok
    end
  end

  defp plan_changes(plan), do: List.wrap(b28_value(plan, :changes))

  defp persist_renumber_adoption(source_turn_result, artifact, params, plan) do
    with :ok <- validate_renumber_change_plan(plan),
         %{mapping: mapping, expected: expected} <- renumber_plan_attrs(plan),
         work_id <-
           Map.get(params, "work_id") || artifact_field(artifact, :work_id) ||
             map_field(source_turn_result, :work_id),
         {:ok, receipt} <-
           NovelPersistence.AdoptionRepository.renumber_chapters(
             work_id,
             mapping,
             expected,
             [
               base_revision: Map.get(params, "base_revision") || Map.get(params, :base_revision),
               volume_ref: Map.get(params, "volume_ref") || Map.get(params, :volume_ref)
             ]
             |> Enum.reject(fn {_key, value} -> is_nil(value) end)
           ) do
      {:ok,
       %{
         mutation_id: nil,
         mutation_status: MutationStatus.applied(),
         source_revision_ref: "renumber:#{receipt.object_count}",
         persisted: true,
         adoption_effect: %{mode: "renumber_chapters", effects: receipt.effects},
         committed_mapping: receipt.mapping,
         object_count: receipt.object_count,
         base_revision: receipt.base_revision,
         duplicate: Map.get(receipt, :duplicate, false),
         warnings: List.wrap(b28_value(plan, :warnings)),
         reading_projection: nil
       }}
    else
      {:error, reason} ->
        {:error, reason}
    end
  end

  defp do_persist_adoption(writer, source_turn_result, decision, artifact, params) do
    attrs = %{
      actor_ref: "author",
      work_id: Map.get(params, "work_id") || map_field(source_turn_result, :work_id),
      source_turn_ref: turn_id(source_turn_result),
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      base_revision: normalized_base_revision(artifact_field(artifact, :revision_base)),
      content: artifact_content(artifact),
      summary: adoption_chapter_title(artifact),
      # B25：章节身份优先 ref（title 只作展示/旧兼容；无 ref 时仓储层按 title 唯一命中）。
      target_chapter_ref: adoption_chapter_ref(artifact),
      # B28 CP1：additive 采纳 effect / 修改范围（持久层 replace_scope 事务入口）。
      adoption_effect: b28_effect_attrs(artifact).adoption_effect,
      modification_scope: b28_effect_attrs(artifact).modification_scope,
      # B36 CP1：局部修订范围声明（additive；经候选 payload.scope 透传到采纳 diff 校验）。
      target_segment_ids: b36_scope_attr(artifact, :target_segment_ids),
      base_draft_ref: b36_scope_attr(artifact, :base_draft_ref),
      base_version: b36_scope_attr(artifact, :base_version),
      expected_segment_hashes: b36_scope_attr(artifact, :expected_segment_hashes),
      # B30 CP3-A2：plot_outline item 级可选 chapter_ref（模型对已存在章复制），
      # 按章条目顺序透传给物化链；新章 nil/缺省。parser 也兼容正文标签行。
      chapter_refs: outline_chapter_refs(artifact),
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
      revision_of: artifact_revision_of(artifact),
      supersedes_ref: artifact_supersedes_ref(artifact),
      decision_id: decision.adoption_decision_id
    }

    case writer.(attrs) do
      {:ok, persisted} ->
        {:ok, Map.put(persisted, :persisted, true)}

      # ADR-0019 INV-4（Q1Cb）：持久化边界拒绝非法 adoption 状态转换时保留结构化
      # reason，供上层产出可解释失败（不静默吞、不伪装成通用写库失败）。
      {:error, {:illegal_adoption_transition, detail}} ->
        {:error, {:illegal_adoption_transition, detail}}

      # B47 CP2：保留持久层原始结构化 reason（stale_base_version/segment_mismatch/
      # incomplete_scope 等），由 classify_persistence_failure/1 映射为具体拒绝码；
      # 作者可见文案只使用映射后的结构事实，原始错误仅进 developer 日志。
      {:error, reason} ->
        {:error, reason}
    end
  end

  defp build_action_result(%AdoptionDecision{} = decision, artifact, persisted, decision_opts) do
    %{
      action_id: "adopt:#{artifact_field(artifact, :artifact_id)}",
      action_type: "adopt",
      status: "accepted",
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      decision: decision_payload(decision),
      persistence: persisted
    }
    |> put_b28_result_fields(persisted)
    |> put_canon_freshness_receipt(decision_opts)
  end

  @b28_result_fields [
    :adoption_effect,
    :superseded_draft_refs,
    :committed_mapping,
    :object_count,
    :warnings,
    :committed_changes,
    :character_ref,
    :base_fingerprint,
    :current_fingerprint,
    :scope,
    :covered_refs,
    :old_chars,
    :new_chars,
    :target_segment_ids,
    :segment_changes,
    :diff_stats
  ]

  # persisted 只来自 adoption writer 的 {:ok, map}；非 map 分支不可达（B60）。
  defp put_b28_result_fields(result, persisted) when is_map(persisted) do
    Enum.reduce(@b28_result_fields, result, fn key, acc ->
      maybe_put_b28_field(acc, key, map_field(persisted, key))
    end)
  end

  defp maybe_put_b28_field(result, _key, nil), do: result
  defp maybe_put_b28_field(result, key, value), do: Map.put(result, key, value)

  defp build_decision_action_result(%AdoptionDecision{} = decision, artifact, decision_opts) do
    %{
      action_id: "adopt:#{artifact_field(artifact, :artifact_id)}",
      action_type: "adopt",
      status: decision_action_status(decision),
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      decision: decision_payload(decision),
      persistence: %{persisted: false}
    }
    |> put_canon_freshness_receipt(decision_opts)
  end

  defp decision_action_status(%AdoptionDecision{decision_type: :require_confirmation}),
    do: "needs_confirmation"

  defp decision_action_status(%AdoptionDecision{decision_type: :reject}), do: "rejected"
  defp decision_action_status(%AdoptionDecision{decision_type: :fail_with_recovery}), do: "failed"
  defp decision_action_status(_decision), do: "rejected"

  # B47 CP2：持久层事务内重 gate 的拒绝映射为具体、稳定的 reason code；未知错误仍泛化，
  # 原始细节只进 developer 日志/action_result.persistence（作者可见文案不带原文）。
  defp classify_persistence_failure({:illegal_adoption_transition, detail}),
    do: {:illegal_adoption_transition, detail}

  defp classify_persistence_failure({:format_only_violation, detail}),
    do: {:format_only_violation, detail}

  defp classify_persistence_failure(:stale_base_version), do: {:stale_base_version, :stale}
  defp classify_persistence_failure("stale_base_version"), do: {:stale_base_version, :stale}
  defp classify_persistence_failure(:stale_base), do: {:stale_base, :stale}
  defp classify_persistence_failure("stale_base"), do: {:stale_base, :stale}

  defp classify_persistence_failure(:segment_mismatch),
    do: {:canon_conflict_detected, :segment_hash_mismatch}

  defp classify_persistence_failure(:incomplete_scope), do: {:incomplete_scope, :scope}
  defp classify_persistence_failure("incomplete_scope"), do: {:incomplete_scope, :scope}
  defp classify_persistence_failure(:out_of_scope_changes), do: {:out_of_scope_changes, :scope}

  defp classify_persistence_failure(:format_only_violation),
    do: {:format_only_violation, :format}

  defp classify_persistence_failure(:target_missing), do: {:target_missing, :target}
  defp classify_persistence_failure(:target_ambiguous), do: {:target_ambiguous, :target}

  defp classify_persistence_failure(:unsupported_field), do: {:unsupported_field, :contract}
  defp classify_persistence_failure(:unsupported_effect), do: {:unsupported_effect, :contract}

  defp classify_persistence_failure(:invalid_character_role),
    do: {:invalid_character_role, :contract}

  defp classify_persistence_failure(:invalid_adoption_effect),
    do: {:invalid_adoption_effect, :contract}

  defp classify_persistence_failure(:no_target), do: {:no_target, :contract}
  defp classify_persistence_failure(:duplicate_apply), do: {:duplicate_apply, :idempotent}

  defp classify_persistence_failure(reason),
    do: {:adoption_persistence_failed, inspect(reason)}

  # BB-7：持久化失败 = 失败 action_result（status 仍 failed，ADR 口径）+ 可恢复
  # TurnResult。作者可见文案只说结构事实（未保存/候选保留/作品事实未改），
  # 不带持久化异常原文。
  defp build_failed_action_result(
         %AdoptionDecision{} = decision,
         artifact,
         reason_code,
         decision_opts
       )
       when is_atom(reason_code) do
    build_failed_action_result(
      decision,
      artifact,
      Atom.to_string(reason_code),
      decision_opts
    )
  end

  defp build_failed_action_result(
         %AdoptionDecision{} = decision,
         artifact,
         reason_code,
         decision_opts
       ) do
    %{
      action_id: "adopt:#{artifact_field(artifact, :artifact_id)}",
      action_type: "adopt",
      status: "failed",
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      decision: decision_payload(decision),
      persistence: %{
        persisted: false,
        persistence_status: "failed",
        reason_code: reason_code
      }
    }
    |> put_canon_freshness_receipt(decision_opts)
  end

  defp build_persistence_failure_turn_result(
         source_turn_result,
         %AdoptionDecision{} = decision,
         artifact,
         reason_code,
         decision_opts
       )
       when is_atom(reason_code) do
    build_persistence_failure_turn_result(
      source_turn_result,
      decision,
      artifact,
      Atom.to_string(reason_code),
      decision_opts
    )
  end

  defp build_persistence_failure_turn_result(
         source_turn_result,
         %AdoptionDecision{} = decision,
         artifact,
         reason_code,
         decision_opts
       )
       when is_binary(reason_code) do
    source_turn_id = turn_id(source_turn_result)
    artifact_id = artifact_field(artifact, :artifact_id)
    reason_codes = [reason_code, "author_action_retryable"]

    %{
      schema_version: "3.0-draft",
      turn_id: NovelFoundation.ID.unique("turn_adopt"),
      parent_turn_id: source_turn_id,
      assistant_message: %{
        text: persistence_failure_message(reason_code)
      },
      ui_cards: [],
      trace_summary:
        %{
          decision_type: "adopt_persistence_failed",
          reason_codes: reason_codes,
          source_turn_ref: source_turn_id,
          artifact_ref: "artifact:#{artifact_id}",
          decision_trace_ref: decision.decision_trace_ref,
          state_trace_ref: nil
        }
        |> put_trace_canon_freshness(decision_opts),
      phase: "failed",
      status: "failed_recoverable",
      available_actions: [],
      projection_refs: [],
      adoption_decision: decision_payload(decision),
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false,
        state_persisted: false,
        mutation_ref: nil,
        adopted_state_ref: nil,
        durable_behavior_opened: false,
        decision_type: :adopt_persistence_failed,
        reason_codes: reason_codes
      }
    }
  end

  # 作者可见文案只说结构事实，不带持久化异常原文。
  defp persistence_failure_message("illegal_adoption_transition") do
    "这次采纳被拒绝：候选状态与当前作品事实不兼容（状态转换不合法），原候选仍保留为待采纳，作品事实没有被修改。"
  end

  defp persistence_failure_message(reason_code) do
    case freshness_rejection_message(reason_code) do
      nil ->
        "这次采纳没有保存成功：作品档案写入失败，原候选仍保留为待采纳，作品事实没有被修改。"

      message ->
        message
    end
  end

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
    |> put_b28_result_fields(persisted)
  end

  defp build_turn_result(
         source_turn_result,
         %AdoptionDecision{} = decision,
         artifact,
         persisted,
         params,
         decision_opts
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
      trace_summary:
        %{
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
        }
        |> put_trace_canon_freshness(decision_opts),
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

  defp terminal_action_type(:resolved, params),
    do: map_field(params, :action_type) || "confirm_before_execute"

  defp terminal_action_type(:cancelled, params),
    do: map_field(params, :action_type) || "reject_or_cancel_confirmation"

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
    decision_turn_id = NovelFoundation.ID.unique("turn_adopt")

    {behavior_state, supersede_ref} =
      decision_behavior_state(
        confirmation?,
        behavior_id,
        artifact_id,
        source_turn_id,
        decision_turn_id,
        decision,
        decision_opts
      )

    %{
      schema_version: "3.0-draft",
      turn_id: decision_turn_id,
      parent_turn_id: source_turn_id,
      assistant_message: %{text: decision_message(decision, artifact, decision_opts)},
      ui_cards: [],
      trace_summary:
        %{
          decision_type: to_string(decision.decision_type),
          reason_codes: decision.reason_codes,
          decision_trace_ref: decision.decision_trace_ref,
          state_trace_ref: decision.state_trace_ref
        }
        |> maybe_put_behavior_supersede(supersede_ref, decision_turn_id)
        |> put_trace_canon_freshness(decision_opts),
      phase: decision_phase(decision),
      status: decision_status(decision),
      available_actions:
        if(confirmation?, do: confirmation_available_actions(artifact_id, behavior_id), else: []),
      behavior_state: behavior_state,
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
        superseded_behavior_ref: supersede_ref,
        decision_type: decision.decision_type,
        reason_codes: decision.reason_codes
      }
    }
  end

  # 8-2 显式 supersede：新 author-blocking confirmation 打开时，把同 workstream 上一个
  # open author-blocking behavior 标成 :superseded 并放进新 TurnResult 的 behavior_state.history；
  # 只依赖服务端已加载的上一 behavior 快照（Channel turn_results），不读 UI、不读验收开关。
  defp decision_behavior_state(
         false,
         _behavior_id,
         _artifact_id,
         _source_turn_id,
         _decision_turn_id,
         _decision,
         _opts
       ),
       do: {BehaviorState.snapshot(nil), nil}

  defp decision_behavior_state(
         true,
         behavior_id,
         artifact_id,
         source_turn_id,
         decision_turn_id,
         decision,
         opts
       ) do
    new_behavior = confirmation_behavior(behavior_id, artifact_id, source_turn_id, decision)
    previous = BehaviorState.from_map(Map.get(opts, :previous_behavior))

    cond do
      is_nil(previous) or previous.behavior_id == behavior_id ->
        {BehaviorState.snapshot(new_behavior), nil}

      BehaviorState.open?(previous) and BehaviorState.author_blocking?(previous) ->
        superseded =
          BehaviorState.supersede(previous, new_behavior,
            closed_at_turn_ref: decision_turn_id,
            reason_code: "new_author_blocking_behavior_opened"
          )

        {BehaviorState.snapshot(new_behavior, [superseded]), superseded.resolution.ref}

      true ->
        {BehaviorState.snapshot(new_behavior), nil}
    end
  end

  defp maybe_put_behavior_supersede(summary, nil, _decision_turn_id), do: summary

  defp maybe_put_behavior_supersede(summary, supersede_ref, decision_turn_id) do
    summary
    |> Map.put(:behavior_supersede_ref, supersede_ref)
    |> Map.put(:behavior_trace_refs, [
      %{
        behavior_ref: superseded_behavior_id(supersede_ref),
        event_type: :supersede,
        next_status: :superseded,
        event_turn_ref: decision_turn_id,
        resolution_ref: supersede_ref,
        superseded_by_ref: superseded_by_ref(supersede_ref)
      }
    ])
  end

  # resolution_ref 形状冻结为 `behavior_superseded:<old_id>:<new_id>`（domain 同源）。
  defp superseded_behavior_id("behavior_superseded:" <> rest) do
    case String.split(rest, ":", parts: 2) do
      [old_id, _new_id] -> old_id
      _ -> rest
    end
  end

  defp superseded_behavior_id(_ref), do: nil

  defp superseded_by_ref("behavior_superseded:" <> rest) do
    case String.split(rest, ":", parts: 2) do
      [_old_id, new_id] -> "behavior:" <> new_id
      _ -> nil
    end
  end

  defp superseded_by_ref(_ref), do: nil

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

  # B13b BB-4（2026-10-23 作者拍板方案 A）：fail_with_recovery 决策 = 失败但可恢复
  # （phase 仍 failed，action_result.status 仍 failed）。
  defp decision_status(%AdoptionDecision{decision_type: :fail_with_recovery}),
    do: "failed_recoverable"

  defp decision_status(_decision), do: "conversational"

  # 确认卡必须说清「为什么要我确认」：拦截住了但不给裁决材料，等于把判断推给作者
  # 又不给他依据（M4 的 15 次元泄漏确认，作者并不知道泄漏在哪一句）。按 reason_codes
  # 分派具体理由，落在原因语义上；未识别的原因回落原泛化文案。
  defp decision_message(
         %AdoptionDecision{decision_type: :require_confirmation} = decision,
         artifact,
         decision_opts
       ) do
    reason_codes = decision.reason_codes

    cond do
      "duplicate_character_name" in reason_codes ->
        duplicate_name_confirmation_message(artifact, decision_opts)

      "meta_leak_detected" in reason_codes ->
        meta_leak_confirmation_message(artifact)

      "overwrite_existing_canon" in reason_codes ->
        adopted_revision_confirmation_message(artifact)

      true ->
        "这段草稿需要你进一步确认对象和影响后才能采纳；当前未写入正文或作品事实。"
    end
  end

  defp decision_message(%AdoptionDecision{decision_type: :reject}, _artifact, _decision_opts),
    do: "当前不能采纳这段草稿，来源或状态已不满足采纳条件；草稿仍保留为待采纳。"

  defp decision_message(
         %AdoptionDecision{decision_type: :fail_with_recovery} = decision,
         _artifact,
         _opts
       ) do
    decision.reason_codes
    |> Enum.find_value(&freshness_rejection_message/1)
    |> case do
      nil -> "未能采纳这段草稿，请重新生成或检查目标章节后再试；当前未写入作品事实。"
      message -> message
    end
  end

  defp decision_message(_decision, _artifact, _decision_opts), do: "已处理这段草稿的采纳请求。"

  # B47：把系统检测到的拒绝原因（stale/冲突/范围/目标/契约）翻译成作者可见的结构事实文案；
  # 不暴露内部错误原文，也不把「未写入」说成其他状态。
  defp freshness_rejection_message(code) when is_atom(code),
    do: freshness_rejection_message(Atom.to_string(code))

  defp freshness_rejection_message(code) when code in ["stale_base_version", "stale_base"] do
    "这次采纳没有进行：候选生成后作品事实的版本已变化（base version/fingerprint 过期），系统从持久事实检测到后没有写入作品事实；原候选仍保留，请重新生成候选后再采纳。"
  end

  defp freshness_rejection_message(code)
       when code in ["canon_conflict_detected", "segment_mismatch"] do
    "这次采纳没有进行：系统从当前作品事实检测到与候选依据不一致（canon 冲突），没有写入作品事实；原候选仍保留，请重新生成或修订候选后再采纳。"
  end

  defp freshness_rejection_message(code)
       when code in ["incomplete_scope", "out_of_scope_changes"] do
    "这次采纳没有进行：候选覆盖范围与当前作品事实不一致（不完整或越界），没有写入作品事实；原候选仍保留，请重新生成候选后再采纳。"
  end

  defp freshness_rejection_message("format_only_violation") do
    "这次采纳没有进行：候选违反仅排版约束（改变了字句），没有写入作品事实；原候选仍保留，请重新生成候选后再采纳。"
  end

  defp freshness_rejection_message(code) when code in ["target_missing", "target_ambiguous"] do
    "这次采纳没有进行：目标章节或角色已不存在或无法唯一确定，没有写入作品事实；请重新选择目标后再采纳。"
  end

  defp freshness_rejection_message("canon_freshness_unavailable") do
    "这次采纳没有进行：无法确认作品当前版本（读取不可用），没有写入作品事实；原候选仍保留，请重试。"
  end

  defp freshness_rejection_message(code)
       when code in [
              "unsupported_field",
              "unsupported_effect",
              "invalid_character_role",
              "invalid_adoption_effect",
              "no_target"
            ] do
    "这次采纳没有进行：候选包含当前采纳契约不允许的变更（字段/范围/效果），没有写入作品事实；原候选仍保留。"
  end

  defp freshness_rejection_message(_code), do: nil

  # ── B47 CP1/CP2：canon freshness 编排与回执 ─────────────────────

  # 声明基线：候选 payload 由产品在生成时从持久 canon 填充（B28/B36/ADR-0029
  # scope/adoption_effect、B29 character_ref/base_fingerprint）；legacy 候选没有
  # 结构化基线时返回 nil，保持既有确认/采纳路径，不猜测、不伪判 stale。
  defp canon_freshness_verdict(_artifact, _work_id, nil), do: nil

  defp canon_freshness_verdict(_artifact, _work_id, reader) when not is_function(reader, 2),
    do: nil

  defp canon_freshness_verdict(_artifact, work_id, _reader) when not is_binary(work_id), do: nil

  defp canon_freshness_verdict(artifact, work_id, reader) when is_function(reader, 2) do
    case declared_canon_baseline(artifact) do
      {object, target, declared} ->
        read_and_assess_canon(reader, work_id, object, target, declared)

      nil ->
        nil
    end
  end

  defp read_and_assess_canon(reader, work_id, object, target, declared) do
    case safe_canon_read(reader, work_id, target) do
      {:ok, current} ->
        CanonFreshness.assess(object, declared, current)

      {:error, reason} ->
        canon_read_failure_verdict(object, declared, reason)
    end
  end

  defp safe_canon_read(reader, work_id, target) do
    case reader.(work_id, target) do
      {:ok, %{} = current} -> {:ok, current}
      {:error, reason} -> {:error, reason}
      other -> {:error, {:invalid_canon_snapshot, other}}
    end
  rescue
    _ -> {:error, :reader_error}
  end

  defp canon_read_failure_verdict(object, declared, reason) do
    case reason do
      :target_missing -> CanonFreshness.missing(object, declared, "target_missing")
      :target_ambiguous -> CanonFreshness.missing(object, declared, "target_ambiguous")
      _unavailable -> CanonFreshness.unavailable(object, declared)
    end
  end

  defp declared_canon_baseline(artifact) do
    payload = artifact_field(artifact, :payload) || %{}

    character_canon_baseline(payload) || chapter_canon_baseline(artifact, payload)
  end

  defp character_canon_baseline(payload) do
    object_kind = b28_value(payload, :object_kind)
    effect = b28_map(payload, :adoption_effect) || %{}
    mode = b28_value(effect, :mode)
    ref = b28_value(payload, :character_ref)
    fingerprint = b28_value(payload, :base_fingerprint)
    change = payload |> b28_value(:changes) |> List.wrap() |> List.first()

    if (object_kind == "character_profile_revision" or mode == "character_field_update") and
         is_binary(ref) and is_binary(fingerprint) and is_map(change) and
         b28_value(change, :field) == "narrative_role" do
      {:character_profile, {:character_profile, ref},
       %{
         ref: ref,
         fingerprint: fingerprint,
         field: "narrative_role",
         old_value: b28_value(change, :old),
         new_value: b28_value(change, :new)
       }}
    end
  end

  @chapter_baseline_modes ["replace_scope", "replace_segments", "format_paragraphs"]

  defp chapter_canon_baseline(artifact, payload) do
    effect = b28_map(payload, :adoption_effect) || %{}
    scope = b28_map(payload, :scope) || %{}
    mode = b28_value(effect, :mode) || b28_value(scope, :kind)
    ref = chapter_baseline_ref(artifact, payload, scope)

    with true <- mode in @chapter_baseline_modes,
         true <- is_binary(ref),
         versions when map_size(versions) > 0 <- declared_chapter_versions(effect, scope) do
      {:chapter_prose, {:chapter_prose, ref},
       %{ref: ref, versions: versions, digest: chapter_baseline_digest(mode, effect)}}
    else
      _no_declared_baseline -> nil
    end
  end

  defp chapter_baseline_ref(artifact, payload, scope) do
    adoption_chapter_ref(artifact) || b28_value(payload, :target_chapter_ref) ||
      b28_value(scope, :target_chapter_ref)
  end

  defp chapter_baseline_digest("format_paragraphs", effect), do: b28_value(effect, :source_hash)
  defp chapter_baseline_digest(_mode, _effect), do: nil

  defp declared_chapter_versions(effect, scope) do
    [
      b28_value(effect, :expected_base_versions),
      b28_value(effect, :base_versions),
      b28_value(scope, :base_versions),
      b28_value(effect, :covered),
      b28_value(scope, :covered),
      b28_value(scope, :covered_refs)
    ]
    |> Enum.find_value(fn candidate ->
      case normalize_declared_versions(candidate) do
        versions when map_size(versions) > 0 -> versions
        _ -> nil
      end
    end)
    |> Kernel.||(%{})
  end

  defp normalize_declared_versions(items) when is_list(items) do
    Enum.reduce(items, %{}, fn item, acc ->
      case declared_version_entry(item) do
        {ref, version} -> Map.put(acc, ref, version)
        nil -> acc
      end
    end)
  end

  defp normalize_declared_versions(_items), do: %{}

  defp declared_version_entry(%{} = item) do
    ref = b28_value(item, :ref)
    version = b28_value(item, :version)

    if is_binary(ref) and is_integer(version), do: {ref, version}
  end

  defp declared_version_entry("draft:" <> _ = covered) do
    with [_draft, uuid, raw_version] <- String.split(covered, ":"),
         version when is_integer(version) <- parse_version(raw_version) do
      {"draft:#{uuid}", version}
    else
      _ -> nil
    end
  end

  defp declared_version_entry(_item), do: nil

  defp parse_version(value) when is_integer(value), do: value

  defp parse_version(value) when is_binary(value) do
    case Integer.parse(value) do
      {version, ""} -> version
      _ -> nil
    end
  end

  defp parse_version(_value), do: nil

  defp put_canon_freshness_receipt(%{} = result, decision_opts) do
    case canon_freshness_opt(decision_opts) do
      %{} = verdict -> Map.put(result, :canon_freshness, verdict)
      _ -> result
    end
  end

  defp put_trace_canon_freshness(%{} = summary, decision_opts) do
    case canon_freshness_opt(decision_opts) do
      %{} = verdict -> Map.put(summary, :canon_freshness, verdict)
      _ -> summary
    end
  end

  defp canon_freshness_opt(decision_opts) when is_map(decision_opts),
    do: Map.get(decision_opts, :canon_freshness)

  defp canon_freshness_opt(_decision_opts), do: nil

  defp canonical_versions_log(decision_opts) do
    case canon_freshness_opt(decision_opts) do
      %{expected: expected, current: current, status: status} ->
        %{status: status, expected: version_summary(expected), current: version_summary(current)}

      _ ->
        nil
    end
  end

  defp version_summary(%{versions: versions}), do: versions
  defp version_summary(%{fingerprint: fingerprint}), do: %{fingerprint: fingerprint}
  defp version_summary(_value), do: nil

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

  # Q1c：修订已采纳内容时，确认卡必须说清「替代哪一版、旧版是否保留」。
  defp adopted_revision_confirmation_message(artifact) do
    title =
      artifact
      |> adoption_chapter_title()
      |> to_string()
      |> String.trim()

    label = if title == "", do: "当前已采纳版本", else: "「#{title}」的当前已采纳版本"

    "这份修订稿会替代#{label}。旧版本会保留为历史版本（SUPERSEDED），不会删除；" <>
      "确认后才会写入新版本，当前未改变作品事实。"
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

  # 采纳 provenance → 持久化分流：**只有显式 rewrite 才覆盖**，其余（continuation /
  # 新章 null / 字段缺失）一律 append。
  #
  # D7（2026-08-26）：原实现是 `continuation -> :append; _ -> :overwrite`，把「模型
  # 没填 authoring_intent」等同于「作者要推翻重写」——覆盖已采纳正文是不可逆动作，
  # 缺信息时默认执行它，方向错了。M6/M9 对照实锤：qwen3.8 推理完全正确（原文
  # 「保留既有内容接着往下写」）但省略该可选字段（gpt-oss 14 次全填 vs qwen 1 次），
  # 于是每次续写都被判成覆盖并弹确认卡。M0（2026-07-19）踩过孪生坑（填错→吞成 nil
  # →748→432 字数倒退）时只补了「填错」半边，「不填」这半边留到现在。
  # 安全性论证：新章（intent=null/none）目标章无已采纳正文，append 等价于首次写入；
  # 续写 append 是本意；只有作者明确要重写才走破坏性分支。
  defp adoption_mode(artifact) do
    case artifact_field(artifact, :authoring_intent) do
      :rewrite -> :overwrite
      "rewrite" -> :overwrite
      _ -> :append
    end
  end

  # 续写/重写归目标章（target_chapter provenance）；无则回退 artifact 标题。
  # B25：章节身份字符串——有合法 ref 用 ref，否则回退 title（旧 artifact/非章节路径）。
  defp adoption_chapter_identity(artifact) do
    adoption_chapter_ref(artifact) || adoption_chapter_title(artifact)
  end

  defp adoption_chapter_ref(artifact) do
    case artifact_field(artifact, :target_chapter_ref) do
      "chapter:" <> uuid = ref ->
        case Ecto.UUID.cast(uuid) do
          {:ok, _} -> ref
          :error -> nil
        end

      _ ->
        nil
    end
  end

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

  # Q1c：修订候选的 provenance。revision_of 指向被修订的 accepted artifact；
  # supersedes_ref 指向被替代的 accepted state（memory / draft）。两者都可为空。
  defp artifact_revision_of(artifact) do
    artifact_field(artifact, :revision_of) || artifact_payload_field(artifact, :revision_of)
  end

  defp artifact_supersedes_ref(artifact) do
    artifact_field(artifact, :supersedes_ref) || artifact_payload_field(artifact, :supersedes_ref)
  end

  defp artifact_payload_field(artifact, key) do
    payload = artifact_field(artifact, :payload) || %{}
    Map.get(payload, key) || Map.get(payload, Atom.to_string(key))
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

    edited_payload =
      payload
      |> Map.put(:content, normalize_edit(Map.get(params, "edited_content")))
      |> Map.put(:original_content, original_content)
      |> Map.put(:edit_instruction, nil)

    put_artifact_field(artifact, :payload, edited_payload)
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
