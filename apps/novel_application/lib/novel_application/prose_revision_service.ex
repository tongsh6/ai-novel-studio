defmodule NovelApplication.ProseRevisionService do
  @moduledoc """
  VS-00E CP3：按质量发现重写（`revise_from_findings`）。

  作者在某个待采纳正文草稿的质量复核里选择“按这些问题重写”后，本服务：

  1. 从 source TurnResult 取出被修订的原草稿（标题 + 正文）与其归章 provenance；
  2. 取出作者所选的质量发现（缺省取全部可见发现）；
  3. 构造一次**独立的 prose_writing 调用**：原正文作为上下文、所选发现作为修订要求，
     要求模型仅针对这些问题改写、保留情节与作品事实；
  4. 把结果组装成一个**新的 tentative 修订草稿**，记录 `revision_base` / `revision_reason`
     / `quality_finding_refs` provenance。

  不变量（ADR-0020）：
  - 原草稿保留，修订草稿是另一个 tentative artifact，二者并存供作者对比；
  - 修订草稿**不自动采纳**，仍走既有 accept/discard/edit 采纳链；
  - 每次动作只产出**一个**修订候选；
  - 修订路径**不再自动触发质量评估**（不自我递归），避免 evaluator 无限重写。

  本服务只做编排：修订动作先构造 revision MicroPlan 并重新经过 ExecutionOrchestrator，
  再把带真实 decision_ref 的 ToolRequest 交给 agent 侧执行边界；组装走
  `ArtifactAssembler`，不直接写作品事实、不调用 Repo。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.AuthorizedToolExecutor
  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @prose_tool "prose_writing"

  @spec revise(map(), AuthorActionInput.t(), (String.t() -> tuple()) | nil) ::
          {:ok, map(), map()} | {:error, String.t()}
  def revise(_source_turn_result, %AuthorActionInput{}, complete_fn)
      when not is_function(complete_fn, 1),
      do: {:error, "revise_from_findings requires a provider connection"}

  def revise(source_turn_result, %AuthorActionInput{} = action_input, complete_fn) do
    with {:ok, prepared} <- prepare_revision(source_turn_result, action_input),
         {:ok, execution} <- plan_revision(source_turn_result, action_input),
         {:ok, result} <-
           execute_revision(source_turn_result, action_input, prepared, execution, complete_fn) do
      {:ok, result.action_result, result.turn_result}
    end
  end

  @doc """
  Extracts the original prose draft and selected visible quality findings.
  """
  @spec prepare_revision(map(), AuthorActionInput.t()) :: {:ok, map()} | {:error, String.t()}
  def prepare_revision(source_turn_result, %AuthorActionInput{} = action_input) do
    with {:ok, original} <- original_prose(source_turn_result, action_input.target_ref) do
      findings = selected_findings(source_turn_result, action_input)

      {:ok,
       %{
         original: original,
         findings: findings
       }}
    end
  end

  @doc """
  Builds the revision frame/plan and re-enters ExecutionOrchestrator.
  """
  @spec plan_revision(map(), AuthorActionInput.t()) :: {:ok, map()} | {:error, String.t()}
  def plan_revision(source_turn_result, %AuthorActionInput{} = action_input) do
    turn_id = "turn_rev_#{System.unique_integer([:positive, :monotonic])}"
    frame = revision_frame(source_turn_result, action_input, turn_id)
    plan = revision_plan(frame, action_input)
    {decision, behavior} = ExecutionOrchestrator.decide(frame, plan)

    if OrchestratorDecision.blocks_execution?(decision) do
      {:error, "revision generation blocked by orchestrator: #{blocked_reason(decision)}"}
    else
      {:ok,
       %{
         turn_id: turn_id,
         frame: frame,
         plan: plan,
         decision: decision,
         behavior: behavior
       }}
    end
  end

  @doc """
  Executes the authorized revision tool call and returns action_result + TurnResult.
  """
  @spec execute_revision(
          map(),
          AuthorActionInput.t(),
          map(),
          map(),
          (String.t() -> tuple()) | nil
        ) ::
          {:ok, map()} | {:error, String.t()}
  def execute_revision(
        _source_turn_result,
        %AuthorActionInput{},
        _prepared,
        _execution,
        complete_fn
      )
      when not is_function(complete_fn, 1),
      do: {:error, "revise_from_findings requires a provider connection"}

  def execute_revision(
        source_turn_result,
        %AuthorActionInput{} = action_input,
        %{original: original, findings: findings},
        %{frame: frame, plan: plan, decision: decision} = execution,
        complete_fn
      ) do
    req = build_request(frame, plan, decision, original, findings)
    result = AuthorizedToolExecutor.execute(req, complete_fn)

    with {:ok, execution} <-
           assemble_revision_artifact(
             result,
             frame.turn_id,
             source_turn_result,
             original,
             findings,
             %{
               frame: frame,
               plan: plan,
               decision: decision,
               behavior: Map.get(execution, :behavior),
               req: req,
               result: result
             }
           ) do
      artifact_set = execution.artifact_set
      emit_revised(source_turn_result, action_input, artifact_set, findings)

      turn_result =
        TurnResultBuilder.revision_turn_result(
          field(source_turn_result, :turn_id) || action_input.source_turn_ref,
          artifact_set,
          trace_summary: revision_trace_summary(source_turn_result, action_input, execution)
        )

      {:ok,
       %{
         artifact_set: artifact_set,
         action_result: revise_action_result(action_input, artifact_set),
         turn_result: turn_result,
         execution: execution,
         findings: findings
       }}
    end
  end

  # ── 原草稿抽取 ──────────────────────────────────────────────

  # 修订对象 = 作者动作的 target_ref（指向待采纳正文草稿的 artifact_id）。从 source
  # TurnResult 的 adoption_state.pending 取该草稿的正文 item 与归章 provenance。
  defp original_prose(source_turn_result, target_ref)
       when is_binary(target_ref) and target_ref != "" do
    pending =
      source_turn_result
      |> field(:adoption_state)
      |> field(:pending)
      |> List.wrap()

    entry = Enum.find(pending, fn p -> field(p, :artifact_id) == target_ref end)

    cond do
      is_nil(entry) ->
        {:error, "revise target #{target_ref} not found in source turn pending drafts"}

      not prose_entry?(entry) ->
        {:error, "revise target #{target_ref} is not a prose draft"}

      true ->
        item =
          entry
          |> field(:payload)
          |> field(:items)
          |> List.wrap()
          |> List.first()

        body = item |> field(:body) |> to_text()

        if body == "" do
          {:error, "revise target #{target_ref} has no prose body to revise"}
        else
          {:ok,
           %{
             title: item |> field(:title) |> to_text(),
             body: body,
             revision_base: target_ref,
             target_chapter: field(entry, :target_chapter),
             authoring_intent: field(entry, :authoring_intent)
           }}
        end
    end
  end

  defp original_prose(_source_turn_result, _target_ref),
    do: {:error, "revise_from_findings missing target_ref"}

  defp prose_entry?(entry) do
    case field(entry, :artifact_type) do
      :prose_fragment -> true
      "prose_fragment" -> true
      _ -> false
    end
  end

  # ── 所选发现 ───────────────────────────────────────────────

  # 作者可在 payload.quality_finding_refs 指定要处理的发现（用 validator 引用标识）；
  # 缺省时处理本次质量复核里全部可见发现。findings 来自 source TurnResult 的
  # quality_review（作者可见摘要，非作品事实）。
  defp selected_findings(source_turn_result, %AuthorActionInput{} = action_input) do
    all =
      source_turn_result
      |> field(:quality_review)
      |> field(:findings)
      |> List.wrap()

    refs = requested_refs(action_input)

    case refs do
      [] -> all
      _ -> Enum.filter(all, fn f -> field(f, :validator) in refs end)
    end
  end

  defp requested_refs(%AuthorActionInput{payload: payload}) when is_map(payload) do
    payload
    |> field(:quality_finding_refs)
    |> List.wrap()
    |> Enum.map(&to_text/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp requested_refs(_action_input), do: []

  # ── 修订生成 ───────────────────────────────────────────────

  defp assemble_revision_artifact(
         result,
         turn_id,
         source_turn_result,
         original,
         findings,
         execution
       ) do
    case ArtifactAssembler.assemble(
           result,
           turn_id,
           provenance(source_turn_result, original, findings)
         ) do
      {:ok, artifact_set} ->
        {:ok, Map.put(execution, :artifact_set, artifact_set)}

      {:error, _reason} ->
        {:error, revision_error_message(result)}
    end
  end

  defp revision_frame(source_turn_result, %AuthorActionInput{} = action_input, turn_id) do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame_#{turn_id}",
      turn_id: turn_id,
      workspace_id: workspace_ref(source_turn_result),
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{
        author_action_ref: action_input.action_id,
        source_turn_ref: field(source_turn_result, :turn_id) || action_input.source_turn_ref
      },
      dialogue_goal: %{summary: "按质量发现重写正文草稿"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "按质量复核结果生成一个修订草稿。"},
      evidence_summary: %{revision_action: "revise_from_findings"},
      uncertainty: []
    }
  end

  defp revision_plan(%DialogueFrame{} = frame, %AuthorActionInput{} = action_input) do
    %MicroPlan{
      plan_id: "plan_#{frame.turn_id}",
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      primary: false,
      plan_goal: %{summary: "生成一个 tentative 修订草稿"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act_revision_#{frame.turn_id}",
          action_type: :capability_invocation,
          summary: "基于质量发现重写正文草稿",
          target_ref: @prose_tool,
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: :rewrite,
          target_chapter: action_input.target_ref
        }
      ],
      stop_after_next_action: true
    }
  end

  defp build_request(
         %DialogueFrame{} = frame,
         %MicroPlan{} = plan,
         %OrchestratorDecision{} = decision,
         original,
         findings
       ) do
    entry = CapabilityRegistry.get(@prose_tool)

    %ToolRequest{
      tool_request_id: "tq_rev_#{System.unique_integer([:positive, :monotonic])}",
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_ref: decision.decision_id,
      tool_name: @prose_tool,
      tool_version: (entry && entry.tool_version) || "unknown",
      input: %{
        "creative_brief" => revision_brief(),
        "context_text" => original_context(original),
        "revision" => revision_section(findings)
      },
      read_scope_grants: (entry && entry.read_scopes) || [],
      write_scope_grants: [],
      idempotency_key: "idem_#{frame.turn_id}_revise",
      trace_policy: %{level: "standard"},
      created_at: DateTime.utc_now()
    }
  end

  defp revision_brief do
    "请基于下文给出的原正文进行修订：保留原有情节走向、人物状态与作品设定，" <>
      "只针对所列质量问题逐项改写，不要新增情节、不要改变作品事实，输出一段完整连贯的正文。"
  end

  defp original_context(%{title: title, body: body}) do
    header = if title == "", do: "原正文：", else: "原正文（#{title}）："
    "#{header}\n#{body}"
  end

  defp revision_section(findings) do
    items =
      findings
      |> Enum.map(&finding_summary/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.with_index(1)
      |> Enum.map_join("\n", fn {text, i} -> "#{i}. #{text}" end)

    body = if items == "", do: "请整体提升正文质量。", else: items

    """
    [质量修订要求]
    请仅针对以下质量问题改写上文「原正文」，逐项回应，不得改变情节走向或新增作品事实：
    #{body}
    修订后保持与原正文相同的情节与人物状态，只解决上述问题。
    """
  end

  # ── provenance / 结果 ──────────────────────────────────────

  defp provenance(_source_turn_result, original, findings) do
    %{
      authoring_intent: original.authoring_intent,
      target_chapter: original.target_chapter,
      revision_base: original_revision_base(original),
      revision_reason: revision_reason(findings),
      quality_finding_refs: finding_refs(findings)
    }
  end

  # 原草稿 artifact_id 来自被修订对象（target_ref），由调用方在 original 中携带不便，
  # 故这里用 reason 之外的独立字段由 revise/3 注入；保留接口对称，默认空。
  defp original_revision_base(%{revision_base: base}) when is_binary(base), do: base
  defp original_revision_base(_original), do: nil

  defp revision_reason(findings) do
    summary =
      findings
      |> Enum.map(&finding_summary/1)
      |> Enum.reject(&(&1 == ""))
      |> Enum.take(3)
      |> Enum.join("；")

    if summary == "", do: "按质量复核结果重写", else: "针对：#{summary}"
  end

  defp finding_refs(findings) do
    findings
    |> Enum.map(fn f -> field(f, :validator) |> to_text() end)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp finding_summary(finding), do: finding |> field(:summary) |> to_text()

  defp revise_action_result(%AuthorActionInput{} = action_input, artifact_set) do
    %{
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      status: "accepted",
      idempotency_key: action_input.idempotency_key,
      target_ref: action_input.target_ref,
      revision_artifact_ref: artifact_set.artifact_set_id
    }
  end

  defp revision_trace_summary(source_turn_result, %AuthorActionInput{} = action_input, execution) do
    artifact_set = execution.artifact_set

    {_trace, tool_trace_summary} =
      TraceWriter.record_with_tool(
        execution.frame,
        execution.plan,
        execution.decision,
        execution.req,
        execution.result,
        %{turn_id: execution.frame.turn_id},
        nil
      )

    tool_trace_summary
    |> Map.merge(%{
      decision_type: "revise_from_findings",
      orchestrator_decision: execution.decision.decision_type,
      source_turn_ref: field(source_turn_result, :turn_id) || action_input.source_turn_ref,
      revision_base: artifact_set.revision_base,
      revision_artifact_ref: artifact_set.artifact_set_id,
      quality_finding_refs: artifact_set.quality_finding_refs,
      revision_provider_call_ref: provider_call_ref(artifact_set),
      no_write_reason: "revision draft is tentative and not auto-adopted",
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      provider_call_budget: %{
        revision_writer: if(provider_call_ref(artifact_set), do: 1, else: 0)
      }
    })
  end

  defp workspace_ref(source_turn_result) do
    field(source_turn_result, :workspace_id) ||
      field(source_turn_result, :work_id) ||
      "workspace_revision_unknown"
  end

  defp blocked_reason(%OrchestratorDecision{} = decision) do
    [
      decision.first_blocking_gate,
      List.first(decision.reason_codes)
    ]
    |> Enum.reject(&is_nil/1)
    |> Enum.join(":")
  end

  defp provider_call_ref(artifact_set) do
    artifact_set.items
    |> List.wrap()
    |> Enum.find_value(fn item -> field(item, :provider_call_ref) end)
  end

  defp emit_revised(
         source_turn_result,
         %AuthorActionInput{} = action_input,
         artifact_set,
         findings
       ) do
    LogEmit.emit(:prose_revision, :generated, :done, %{
      source_turn_ref: field(source_turn_result, :turn_id) || action_input.source_turn_ref,
      revision_base: artifact_set.revision_base,
      revision_artifact_ref: artifact_set.artifact_set_id,
      finding_count: length(findings)
    })
  end

  defp revision_error_message(%ToolResult{status: :failed}),
    do: "revision generation failed: provider did not return a usable draft"

  defp revision_error_message(_result),
    do: "revision generation failed: no draft produced"

  # ── 读取辅助（string / atom 键皆可，source TurnResult 可能来自持久化恢复） ──

  defp field(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, to_string(key))

  defp field(_map, _key), do: nil

  defp to_text(value) when is_binary(value), do: value
  defp to_text(nil), do: ""
  defp to_text(value), do: to_string(value)
end
