defmodule NovelApplication.AIMessageEnvelope do
  @moduledoc """
  VS-00D 的 AI message envelope 过渡实现。

  当前只覆盖 AU11 质量诊断 checkpoint：把小说层原则、当前作品层证据/缺失、
  本轮引导层判断压缩成 author-safe map，供 Planner prompt 和 trace summary 共用。
  """

  alias NovelDomain.ContextSourceRef
  alias NovelDomain.DialogueContext

  @contract_version "VS-00D-draft"
  @quality_markers [
    "不够爽",
    "不爽",
    "赢得太轻",
    "太轻了",
    "没张力",
    "张力不够",
    "冲突不够",
    "代价不够",
    "爽点",
    "质量",
    "诊断",
    "问题",
    "不成立",
    "哪里不成立",
    "哪里不好",
    "不够好",
    "太平",
    "平了"
  ]

  @doc "Returns true when the author is asking for quality diagnosis / structural critique."
  @spec quality_diagnosis?(String.t() | nil) :: boolean()
  def quality_diagnosis?(text) when is_binary(text) do
    Enum.any?(@quality_markers, &String.contains?(text, &1))
  end

  def quality_diagnosis?(_text), do: false

  @doc "Build an author-safe quality diagnosis envelope for trace and prompt projection."
  @spec quality_diagnosis(String.t(), DialogueContext.t() | nil, keyword()) :: map() | nil
  def quality_diagnosis(author_text, context, opts \\ []) do
    if quality_diagnosis?(author_text) do
      %{
        contract_version: @contract_version,
        call_site: :planner,
        turn_ref: Keyword.get(opts, :turn_id),
        work_ref: work_ref(context),
        writing_coordinate: writing_coordinate(context),
        novel_layer: novel_layer(),
        work_state_layer: work_state_layer(context),
        turn_guidance_layer: turn_guidance_layer(context),
        missing_policy: %{
          on_missing_work_state: "ask_or_state_missing_before_diagnosis",
          on_missing_prose: "diagnose_from_summary_only_and_mark_limitation"
        },
        trace_requirements: [
          "record_guidance_mode",
          "record_context_refs_or_explicit_missing",
          "record_no_production_write"
        ]
      }
    end
  end

  @doc "Render the envelope as a compact provider-visible message block."
  @spec prompt_section(String.t(), DialogueContext.t() | nil) :: String.t()
  def prompt_section(author_text, context) do
    case quality_diagnosis(author_text, context) do
      nil ->
        ""

      envelope ->
        """
        ## AIMessageEnvelope（VS-00D 质量诊断）
        - contract_version: #{envelope.contract_version}
        - call_site: planner
        - guidance_mode: quality
        - NovelLayer: #{Enum.join(envelope.novel_layer.always_on_principles, "；")}
        - WorkState: #{work_state_prompt_summary(envelope.work_state_layer)}
        - TurnGuidance: 围绕冲突压力、代价可见、读者回报、主角能动性做质量诊断；只能给诊断和结构修订建议，不得宣称已改写或写入作品事实。
        """
    end
  end

  defp novel_layer do
    %{
      kernel_version: "novel-quality-kernel-v1",
      always_on_principles: [
        "冲突压力必须可感知",
        "胜利需要可见代价",
        "读者回报要和铺垫/期待绑定",
        "主角能动性必须驱动局面变化"
      ],
      expanded_elements: [
        "conflict_pressure",
        "cost_visibility",
        "reader_payoff",
        "protagonist_agency"
      ],
      quality_gates: [
        "conflict_pressure",
        "cost_visibility",
        "reader_payoff",
        "protagonist_agency"
      ],
      selection_rationale: "作者反馈本章爽感不足且胜利过轻，因此展开冲突、代价、回报和能动性质量门。",
      omitted_elements: ["full_style_rewrite", "production_adoption"]
    }
  end

  defp work_state_layer(%DialogueContext{} = context) do
    %{
      snapshot_summary: snapshot_summary(context.current_work_snapshot),
      writing_coordinate: writing_coordinate(context),
      chapter_state: chapter_state(context),
      prior_prose_excerpt: missing("no_prior_prose_excerpt_in_dialogue_context"),
      chapter_summary: chapter_summary(context.structured_chapters),
      character_state:
        snapshot_field_or_missing(
          context.current_work_snapshot,
          ["protagonist", :protagonist],
          "no_character_state"
        ),
      continuity_ledgers: context_refs_by_type(context.context_refs, [:memory, :continuity]),
      style_intent:
        snapshot_field_or_missing(
          context.current_work_snapshot,
          ["tone_preference", :tone_preference],
          "no_style_intent"
        ),
      context_refs: context_refs(context.context_refs),
      omission_notes: omission_notes(context),
      freshness_notes: ["dialogue_context_assembled_at:#{context.assembled_at || "unknown"}"]
    }
  end

  defp work_state_layer(_context) do
    %{
      snapshot_summary: missing("no_current_work_snapshot"),
      writing_coordinate: missing("no_writing_coordinate"),
      chapter_state: missing("no_chapter_state"),
      prior_prose_excerpt: missing("no_prior_prose_excerpt_in_dialogue_context"),
      chapter_summary: missing("no_chapter_summary"),
      character_state: missing("no_character_state"),
      continuity_ledgers: [],
      style_intent: missing("no_style_intent"),
      context_refs: [],
      omission_notes: ["no_dialogue_context"],
      freshness_notes: ["dialogue_context_missing"]
    }
  end

  defp turn_guidance_layer(context) do
    %{
      frame_type: :question_answer,
      dialogue_goal: "诊断当前章节爽感不足和胜利过轻的问题，给出结构修订取舍。",
      guidance_mode: :quality,
      guidance_candidates: [:quality, :structure, :clarify],
      element_focus: [
        "conflict_pressure",
        "cost_visibility",
        "reader_payoff",
        "protagonist_agency"
      ],
      missing_questions: missing_questions(context),
      risk_flags: [
        "do_not_rewrite_without_author_confirmation",
        "do_not_invent_work_facts_when_context_missing"
      ],
      output_contract: "quality_diagnosis_with_structural_revision_options_no_write"
    }
  end

  defp work_ref(%DialogueContext{workspace_id: workspace_id}) when is_binary(workspace_id),
    do: workspace_id

  defp work_ref(_), do: nil

  defp writing_coordinate(%DialogueContext{} = context) do
    current_chapter =
      snapshot_field(context.current_work_snapshot, ["current_chapter", :current_chapter])

    cond do
      present?(current_chapter) ->
        %{chapter: current_chapter, source: :current_work_snapshot}

      context.structured_chapters != [] ->
        first = List.first(context.structured_chapters)
        %{chapter: first.title, source: :structured_chapters}

      context.current_chapters != [] ->
        %{chapter: List.first(context.current_chapters), source: :current_chapters}

      true ->
        missing("no_current_chapter_coordinate")
    end
  end

  defp writing_coordinate(_), do: missing("no_current_chapter_coordinate")

  defp snapshot_summary(snapshot) when is_map(snapshot) do
    parts =
      [
        snapshot_field(snapshot, ["title", :title]),
        snapshot_field(snapshot, ["genre", :genre]),
        snapshot_field(snapshot, ["core_selling_point", :core_selling_point]),
        snapshot_field(snapshot, ["target_reader", :target_reader])
      ]
      |> Enum.filter(&present?/1)

    case parts do
      [] -> missing("snapshot_has_no_author_safe_fields")
      _ -> Enum.join(parts, " / ")
    end
  end

  defp snapshot_summary(_snapshot), do: missing("no_current_work_snapshot")

  defp chapter_state(%DialogueContext{structured_chapters: [_ | _] = chapters}) do
    %{
      status: :available,
      chapters:
        chapters
        |> Enum.take(5)
        |> Enum.map(fn chapter ->
          %{
            title: chapter.title,
            seq: chapter.seq,
            has_prose: chapter.has_prose,
            summary: blank_to_nil(chapter.summary)
          }
        end)
    }
  end

  defp chapter_state(%DialogueContext{current_chapters: [_ | _] = chapters}) do
    %{status: :available, chapters: Enum.take(chapters, 5)}
  end

  defp chapter_state(_context), do: missing("no_chapter_state")

  defp chapter_summary([_ | _] = chapters) do
    summaries =
      chapters
      |> Enum.map(fn chapter ->
        summary = blank_to_nil(chapter.summary)
        if summary, do: "#{chapter.title}: #{summary}"
      end)
      |> Enum.reject(&is_nil/1)
      |> Enum.take(3)

    case summaries do
      [] -> missing("no_chapter_summary")
      _ -> summaries
    end
  end

  defp chapter_summary(_chapters), do: missing("no_chapter_summary")

  defp context_refs(refs) when is_list(refs) do
    Enum.map(refs, fn
      %ContextSourceRef{} = ref ->
        %{
          source_type: ref.source_type,
          summary: ref.summary,
          redaction_level: ref.redaction_level
        }

      _ ->
        nil
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp context_refs(_refs), do: []

  defp context_refs_by_type(refs, types) do
    refs
    |> context_refs()
    |> Enum.filter(&(&1.source_type in types))
  end

  defp omission_notes(%DialogueContext{omission_notes: [_ | _] = notes}) do
    Enum.map(notes, &NovelDomain.OmissionNote.author_safe_summary/1)
  end

  defp omission_notes(%DialogueContext{context_refs: []}), do: ["no_context_refs_available"]
  defp omission_notes(_context), do: []

  defp missing_questions(%DialogueContext{} = context) do
    []
    |> maybe_missing(context.current_work_snapshot == nil, "缺当前作品快照，只能给通用质量诊断。")
    |> maybe_missing(
      context.structured_chapters == [] and context.current_chapters == [],
      "缺目标章节摘要或章节列表，需要作者补充要诊断的章节。"
    )
    |> maybe_missing(true, "缺本章已采纳正文片段，不能逐句诊断，只能基于摘要/上下文给结构建议。")
  end

  defp missing_questions(_context) do
    ["缺当前作品上下文，需要作者补充章节摘要或正文片段后再做具体诊断。"]
  end

  defp maybe_missing(list, true, question), do: [question | list]
  defp maybe_missing(list, false, _question), do: list

  defp work_state_prompt_summary(%{context_refs: refs, chapter_summary: chapter_summary}) do
    sources =
      refs
      |> Enum.map(&to_string(&1.source_type))
      |> Enum.uniq()
      |> case do
        [] -> "无上下文来源"
        types -> "来源：" <> Enum.join(types, "、")
      end

    chapter =
      case chapter_summary do
        [_ | _] -> "有章节摘要"
        %{status: :missing} -> "缺章节摘要"
        _ -> "章节状态有限"
      end

    sources <> "；" <> chapter
  end

  defp snapshot_field(snapshot, keys) when is_map(snapshot) do
    Enum.find_value(keys, fn key ->
      snapshot
      |> Map.get(key)
      |> blank_to_nil()
    end)
  end

  defp snapshot_field(_snapshot, _keys), do: missing("not_available")

  defp snapshot_field_or_missing(snapshot, keys, reason) do
    value = snapshot_field(snapshot, keys)
    if present?(value), do: value, else: missing(reason)
  end

  defp blank_to_nil(value) when is_binary(value) do
    value = String.trim(value)
    if value == "", do: nil, else: value
  end

  defp blank_to_nil(value), do: value

  defp present?(value) when is_binary(value), do: String.trim(value) != ""
  defp present?(value), do: not is_nil(value) and not is_map(value)

  defp missing(reason), do: %{status: :missing, reason: reason}
end
