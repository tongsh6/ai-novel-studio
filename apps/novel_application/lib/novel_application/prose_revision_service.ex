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

  本服务只做编排：prose 生成走 `NovelAgent.Toolbox`（与正常写作同一 provider 边界），
  组装走 `ArtifactAssembler`，不直接写作品事实、不调用 Repo。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Toolbox
  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.AuthorActionInput

  @prose_tool "prose_writing"

  @spec revise(map(), AuthorActionInput.t(), (String.t() -> tuple()) | nil) ::
          {:ok, map(), map()} | {:error, String.t()}
  def revise(_source_turn_result, %AuthorActionInput{}, complete_fn) when not is_function(complete_fn, 1),
    do: {:error, "revise_from_findings requires a provider connection"}

  def revise(source_turn_result, %AuthorActionInput{} = action_input, complete_fn) do
    with {:ok, original} <- original_prose(source_turn_result, action_input.target_ref),
         findings <- selected_findings(source_turn_result, action_input),
         {:ok, artifact_set} <- generate_revision(source_turn_result, original, findings, complete_fn) do
      emit_revised(source_turn_result, action_input, artifact_set, findings)

      turn_result =
        TurnResultBuilder.revision_turn_result(
          field(source_turn_result, :turn_id) || action_input.source_turn_ref,
          artifact_set,
          trace_summary: revision_trace_summary(source_turn_result, action_input, artifact_set)
        )

      {:ok, revise_action_result(action_input, artifact_set), turn_result}
    end
  end

  # ── 原草稿抽取 ──────────────────────────────────────────────

  # 修订对象 = 作者动作的 target_ref（指向待采纳正文草稿的 artifact_id）。从 source
  # TurnResult 的 adoption_state.pending 取该草稿的正文 item 与归章 provenance。
  defp original_prose(source_turn_result, target_ref) when is_binary(target_ref) and target_ref != "" do
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

  defp generate_revision(source_turn_result, original, findings, complete_fn) do
    turn_id = "turn_rev_#{System.unique_integer([:positive, :monotonic])}"
    req = build_request(turn_id, original, findings)
    result = Toolbox.execute(req, complete_fn)

    case ArtifactAssembler.assemble(result, turn_id, provenance(source_turn_result, original, findings)) do
      {:ok, artifact_set} ->
        {:ok, artifact_set}

      {:error, _reason} ->
        {:error, revision_error_message(result)}
    end
  end

  defp build_request(turn_id, original, findings) do
    entry = CapabilityRegistry.get(@prose_tool)

    %ToolRequest{
      tool_request_id: "tq_rev_#{System.unique_integer([:positive, :monotonic])}",
      turn_id: turn_id,
      frame_ref: "frame_#{turn_id}",
      decision_ref: "decision_rev_#{turn_id}",
      tool_name: @prose_tool,
      tool_version: (entry && entry.tool_version) || "unknown",
      input: %{
        "creative_brief" => revision_brief(),
        "context_text" => original_context(original),
        "revision" => revision_section(findings)
      },
      read_scope_grants: (entry && entry.read_scopes) || [],
      write_scope_grants: [],
      idempotency_key: "idem_#{turn_id}_revise",
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

  defp revision_trace_summary(source_turn_result, %AuthorActionInput{} = action_input, artifact_set) do
    %{
      trace_ref: "trace:#{artifact_set.source_turn_ref}",
      decision_type: "revise_from_findings",
      source_turn_ref: field(source_turn_result, :turn_id) || action_input.source_turn_ref,
      revision_base: artifact_set.revision_base,
      quality_finding_refs: artifact_set.quality_finding_refs,
      no_write_reason: "revision draft is tentative and not auto-adopted",
      replay_policy: %{use_recorded_frame: true, recall_provider: true}
    }
  end

  defp emit_revised(source_turn_result, %AuthorActionInput{} = action_input, artifact_set, findings) do
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
