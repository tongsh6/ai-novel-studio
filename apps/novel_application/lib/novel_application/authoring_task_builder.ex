defmodule NovelApplication.AuthoringTaskBuilder do
  @moduledoc """
  B27 CP3：把已验证的业务事实机械组装为 `AuthoringTask`。

  边界（B27 §3.1 / CP3 设计冻结）：
  - 本模块只做**事实组装**与机械校验，不写规则文本、不推断作者意图、不虚构对象/范围/版本。
  - 域模块（prose/aux）各自从真实端口取事实，调用本模块的 helper 构造 task；
    task 必须通过 `AuthoringSemantics.validate/1` 才可进入 provider 请求。
  - 放入 `ToolRequest.input` 时用 `to_input/1`（JSON-safe map），出站时 `from_input/1` 恢复并校验。
  """

  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask

  @doc """
  构造并校验 task；失败返回 `{:error, {code, detail}}`，调用方不得降级猜意图。

  attrs 覆盖 AuthoringTask 字段（author_goal/author_words/source/scope/materials/
  preserve/operation_effect/prior_result/output_contract/source_refs）。
  """
  def new(kind, attrs \\ %{}) when is_atom(kind) and is_map(attrs) do
    task =
      struct!(
        %AuthoringTask{
          kind: kind,
          operation_effect: default_effect(kind),
          output_contract: output_contract(:json),
          semantic_version: AuthoringSemantics.version()
        },
        attrs
      )

    AuthoringSemantics.validate(task)
  end

  @doc "任务类型默认操作效果（首项白名单）；显式传入 operation_effect 时以 attrs 为准。"
  def default_effect(kind), do: kind |> AuthoringSemantics.allowed_effects() |> hd()

  @doc "材料条目：kind/ref 必填；version/complete?/omission_note 只在有真实来源时传入。"
  def material(kind, ref, opts \\ []) do
    %{kind: kind, ref: ref}
    |> put_opt(:version, opts[:version])
    |> put_opt(:complete?, opts[:complete?])
    |> put_opt(:omission_note, opts[:omission_note])
  end

  @doc "范围：refs + coverage；base_ref/base_hash/target_chapter_ref 只传真实来源。"
  def scope(refs, opts \\ []) do
    %{refs: List.wrap(refs), coverage: Keyword.get(opts, :coverage, :single)}
    |> put_opt(:object_kind, opts[:object_kind])
    |> put_opt(:base_ref, opts[:base_ref])
    |> put_opt(:base_hash, opts[:base_hash])
    |> put_opt(:target_chapter_ref, opts[:target_chapter_ref])
    |> Enum.reject(fn {_k, value} -> is_nil(value) end)
    |> Map.new()
  end

  @doc "输出契约：kind（json/text/tool）+ 角色 schema 必要字段；与运行时校验同源。"
  def output_contract(kind, opts \\ []) do
    %{
      kind: kind,
      required_keys: List.wrap(Keyword.get(opts, :required_keys, [])),
      allow_companions: Keyword.get(opts, :allow_companions, false)
    }
    |> put_opt(:schema_ref, opts[:schema_ref])
    |> put_opt(:artifact_type, opts[:artifact_type])
  end

  @doc "上一轮真实结果摘要（仅已发生事实）。"
  def prior_result(attrs) when is_map(attrs) do
    %{}
    |> put_opt(:run_ref, attrs[:run_ref] || attrs["run_ref"])
    |> put_opt(:turn_ref, attrs[:turn_ref] || attrs["turn_ref"])
    |> put_opt(:status, attrs[:status] || attrs["status"])
    |> put_opt(:summary, attrs[:summary] || attrs["summary"])
    |> put_opt(:pending_refs, attrs[:pending_refs] || attrs["pending_refs"])
  end

  @doc "把 task 放进 ToolRequest.input（JSON-safe），供 CreativeToolAdapter 出站恢复。"
  def to_input(task) when is_struct(task, AuthoringTask) do
    %{"authoring_task" => AuthoringTask.to_map(task)}
  end

  @doc "从 ToolRequest.input 恢复并校验；无字段返回 `{:ok, nil}`（迁移期兼容）。"
  def from_input(input) when is_map(input) do
    case input["authoring_task"] || input[:authoring_task] do
      nil ->
        {:ok, nil}

      map when is_map(map) ->
        case AuthoringTask.from_map(map) do
          nil -> {:error, {:authoring_task_invalid, :not_a_task}}
          task -> AuthoringSemantics.validate(task)
        end

      _other ->
        {:error, {:authoring_task_invalid, :not_a_task}}
    end
  end

  def from_input(_input), do: {:ok, nil}

  # ── CP3b：prose 域组装（writer / revision / quality_evaluation）─────────
  #
  # 这些函数只把调用点已有的真实业务事实映射成 task 字段；kind/效果/范围全部来自
  # 应用已解析事实，不从 prompt 或关键词猜。校验仍由 new/2 内统一执行。

  @prose_contract_opts [
    schema_ref: "prose_writing_v1",
    artifact_type: :prose_fragment,
    required_keys: ["items", "item_id", "title", "body"],
    allow_companions: true
  ]

  @quality_contract_opts [
    schema_ref: "quality_evaluation_v1",
    required_keys: [
      "findings",
      "quality_finding_id",
      "quality_gate_ref",
      "validator_ref",
      "summary",
      "reasoning",
      "evidence_spans",
      "impact_scope",
      "revision_scope",
      "confidence"
    ],
    allow_companions: false
  ]

  @doc """
  组装 writer（prose_writing）任务。

  `attrs`：
  - `:action`：MicroPlan action（`:authoring_intent` / `:summary` / `:target_chapter_ref`）
  - `:author_input` / `:author_words`：作者原话字节（仅 `author_goal_text` 或显式 words）
  - `:author_goal`：应用已验证的目标解释（action/step summary，来源在 `source_refs`）
  - `:resolved_chapter` / `:resolved_chapter_ref`：应用解析后的目标章
  - `:prior_prose` / `:omission_notes`：已采纳前文与预算省略
  - `:sections`：已渲染材料段（只用判空与生成材料清单）
  - `:execution_brief` / `:execution_brief_degraded?` / `:facts_truncated?` / `:style_truncated?`
  """
  @spec for_prose_writing(map()) :: {:ok, AuthoringTask.t()} | {:error, {atom(), term()}}
  def for_prose_writing(attrs) when is_map(attrs) do
    action = attrs[:action] || %{}
    prior_prose = text(attrs[:prior_prose])
    kind = prose_kind(action, prior_prose)

    new(kind, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])),
      author_words: author_words(attrs),
      scope: prose_scope(attrs, kind),
      materials: prose_materials(attrs),
      preserve: prose_preserve(kind, attrs),
      operation_effect: prose_effect(kind),
      output_contract: attrs[:output_contract] || output_contract(:json, @prose_contract_opts),
      source_refs: string_list(attrs[:source_refs])
    })
  end

  @doc """
  组装修订（revision）任务。三类来源（质量发现 / 候选 / 已采纳内容）共用同一结构，
  差异体现在 `:source` / `:author_goal` / `:findings_ref`，不各自手写一套规则。
  """
  @spec for_revision(map()) ::
          {:ok, AuthoringTask.t()} | {:error, {atom(), term()}}
  def for_revision(attrs) when is_map(attrs) do
    coverage = normalize_coverage(attrs[:coverage])
    base_ref = text(attrs[:artifact_ref])

    new(:revision, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])) || "按作者动作或复核发现修订已有内容",
      author_words: author_words(attrs),
      source: normalize_source(attrs[:source]),
      scope:
        scope(refs_for(base_ref),
          object_kind: attrs[:object_kind] || :prose_fragment,
          coverage: coverage,
          base_ref: blank_to_nil(base_ref),
          base_hash: content_hash(attrs[:base_body]),
          target_chapter_ref: blank_to_nil(text(attrs[:target_chapter_ref]))
        ),
      materials: revision_materials(attrs, base_ref),
      preserve: revision_preserve(attrs, coverage),
      operation_effect: :revise_candidate,
      output_contract: attrs[:output_contract] || output_contract(:json, @prose_contract_opts),
      source_refs: string_list(attrs[:source_refs])
    })
  end

  @doc """
  组装正文质量评估（quality_evaluation）任务：只读评审本轮生成的正文材料。
  `:coverage` 默认 `:single`（单候选/片段），不冒充整章。
  """
  @spec for_quality_evaluation(map()) ::
          {:ok, AuthoringTask.t()} | {:error, {atom(), term()}}
  def for_quality_evaluation(attrs) when is_map(attrs) do
    source_ref = text(attrs[:source_ref]) || text(attrs[:turn_id])
    coverage = normalize_coverage(attrs[:coverage])

    materials =
      [
        material(:prose, source_ref,
          complete?: coverage == :chapter,
          omission_note: prose_coverage_note(coverage)
        ),
        optional_material(:execution_brief, text(attrs[:execution_brief])),
        optional_material(:facts, text(attrs[:facts_context]))
      ]
      |> Enum.reject(&is_nil/1)

    new(:quality_evaluation, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])),
      scope:
        scope(refs_for(source_ref),
          object_kind: :prose_fragment,
          coverage: coverage,
          target_chapter_ref: blank_to_nil(text(attrs[:target_chapter_ref]))
        ),
      materials: materials,
      preserve: [],
      operation_effect: :evaluate,
      output_contract: attrs[:output_contract] || output_contract(:json, @quality_contract_opts),
      source_refs: string_list(attrs[:source_refs])
    })
  end

  # writer 的操作语义来自已解析事实：
  # - intent :rewrite → rewrite；:continuation → continuation
  # - intent 缺失但目标章已有已采纳前文（Q1a 产品事实）→ continuation
  # - 其余 → first_draft
  defp prose_kind(action, prior_prose) do
    case normalize_intent(action[:authoring_intent]) do
      :rewrite -> :rewrite
      :continuation -> :continuation
      _ -> if prior_prose == "", do: :first_draft, else: :continuation
    end
  end

  defp normalize_intent(value) when value in [:continuation, :rewrite], do: value
  defp normalize_intent("continuation"), do: :continuation
  defp normalize_intent("rewrite"), do: :rewrite
  defp normalize_intent(_value), do: nil

  defp prose_effect(_kind), do: :create_candidate

  defp prose_scope(attrs, kind) do
    chapter_ref = chapter_ref(attrs)
    base_ref = if kind == :rewrite, do: rewrite_base_ref(attrs), else: nil

    scope(refs_for(chapter_ref),
      object_kind: :chapter,
      coverage: :chapter,
      base_ref: base_ref,
      target_chapter_ref: blank_to_nil(text(attrs[:resolved_chapter_ref]))
    )
  end

  # rewrite 的基线必须是真实章身份；没有解析到章时返回 nil，让 validate 报
  # base_ref_required，而不是用 turn id 冒充章基线。
  defp rewrite_base_ref(attrs) do
    case blank_to_nil(text(attrs[:resolved_chapter_ref])) do
      nil ->
        case blank_to_nil(text(attrs[:resolved_chapter])) do
          nil -> nil
          title -> "chapter_title:" <> title
        end

      ref ->
        ref
    end
  end

  defp chapter_ref(attrs) do
    case blank_to_nil(text(attrs[:resolved_chapter_ref])) do
      nil ->
        case blank_to_nil(text(attrs[:resolved_chapter])) do
          nil -> "turn:" <> text(attrs[:turn_id])
          title -> "chapter_title:" <> title
        end

      ref ->
        ref
    end
  end

  defp prose_materials(attrs) do
    sections = attrs[:sections] || %{}
    key = material_key(attrs)
    omissions = omission_text(attrs[:omission_notes])
    facts_truncated? = attrs[:facts_truncated?] == true
    style_truncated? = attrs[:style_truncated?] == true
    brief_degraded? = attrs[:execution_brief_degraded?] == true

    [
      optional_material(:target_structure, text(sections[:target_structure]),
        ref: "target_structure:#{key}",
        complete?: false,
        omission_note: "仅目标章与前后邻章结构窗口"
      ),
      prior_prose_material(text(attrs[:prior_prose]), key, omissions),
      optional_material(:prior_summaries, text(sections[:prior_summaries]),
        ref: "prior_summaries:#{key}",
        complete?: false,
        omission_note: "仅最近章节摘要窗口，较早章节未列出"
      ),
      optional_material(:character_roster, text(sections[:character_roster]),
        ref: "character_roster:#{key}"
      ),
      optional_material(:creative_facts, text(sections[:creative_facts]),
        ref: "creative_facts:#{key}",
        complete?: not facts_truncated?,
        omission_note: truncation_note(facts_truncated?, "已确认事实按分组上限截断")
      ),
      optional_material(:style_guide, text(sections[:style_guide]),
        ref: "style_guide:#{key}",
        complete?: not style_truncated?,
        omission_note: truncation_note(style_truncated?, "风格条目录入按上限截断")
      ),
      optional_material(:execution_brief, text(attrs[:execution_brief]),
        ref: "execution_brief:#{key}",
        complete?: not brief_degraded?,
        omission_note: truncation_note(brief_degraded?, "执行简述降级为最小投影")
      ),
      optional_material(:progress_state, text(sections[:progress_state]),
        ref: "progress_state:#{key}",
        complete?: false,
        omission_note: "账面投影最多 6 条相关弧光/伏笔"
      ),
      optional_material(:work_skeleton, text(sections[:work_skeleton]),
        ref: "work_skeleton:#{key}"
      ),
      optional_material(:volume_scope, text(sections[:volume_scope]), ref: "volume_scope:#{key}"),
      optional_material(:current_volume_blueprint, text(sections[:current_volume_blueprint]),
        ref: "current_volume_blueprint:#{key}"
      ),
      optional_material(:absence_directives, text(sections[:absence_directives]),
        ref: "absence_directives:#{key}"
      ),
      optional_material(:dialogue_context, text(sections[:dialogue_context]),
        ref: "dialogue_context:#{key}"
      )
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp prior_prose_material(prose, _key, _omissions) when prose == "", do: nil

  defp prior_prose_material(_prose, key, omissions) do
    complete? = is_nil(omissions)

    material(:prior_prose, "prior_prose:#{key}",
      complete?: complete?,
      omission_note: if(complete?, do: nil, else: omissions)
    )
  end

  defp revision_materials(attrs, base_ref) do
    [
      material(:baseline_body, base_ref, complete?: true),
      optional_material(:quality_findings, text(attrs[:findings_ref])),
      optional_material(:execution_brief, text(attrs[:execution_brief])),
      optional_material(:facts, text(attrs[:facts_context]))
    ]
    |> Enum.reject(&is_nil/1)
  end

  defp prose_preserve(:rewrite, _attrs),
    do: ["未覆盖范围的正文与既有作品事实保持不变", "保持人物、设定与已采纳情节一致"]

  defp prose_preserve(_kind, _attrs), do: []

  defp revision_preserve(attrs, coverage) do
    custom = string_list(attrs[:preserve])
    defaults = ["未要求修改的内容逐字保留", "不改变原稿的情节走向与作品事实"] ++ coverage_preserve(coverage)
    Enum.uniq(defaults ++ custom)
  end

  defp coverage_preserve(:chapter), do: ["修订范围外的章内内容保持不变"]
  defp coverage_preserve(_coverage), do: ["修订范围外的段落与场次逐字保留"]

  # 材料条目：有真实 ref 才生成；opts 里的 complete?/omission_note 仅在有据时传入。
  defp optional_material(kind, text_content, opts \\ []) do
    if blank?(text_content) do
      nil
    else
      ref =
        case Keyword.get(opts, :ref) do
          nil -> kind_ref(kind, text_content)
          ref -> ref
        end

      material(kind, ref,
        complete?: Keyword.get(opts, :complete?),
        omission_note: Keyword.get(opts, :omission_note)
      )
    end
  end

  defp kind_ref(kind, content), do: "#{kind}:" <> short_hash(content)

  defp author_words(attrs) do
    words =
      blank_to_nil(text(attrs[:author_words])) ||
        blank_to_nil(text(get_in(attrs, [:author_input, :author_goal_text]))) ||
        blank_to_nil(text(get_in(attrs, [:author_input, "author_goal_text"])))

    words
  end

  defp prose_coverage_note(:chapter), do: nil
  defp prose_coverage_note(_coverage), do: "仅本轮生成的正文候选，非整章已采纳全文"

  defp omission_text(notes) when is_list(notes) do
    notes
    |> Enum.map(fn
      %{source: source, reason: reason} -> "#{source}（#{reason}）"
      %{"source" => source, "reason" => reason} -> "#{source}（#{reason}）"
      note when is_binary(note) -> note
      note -> inspect(note)
    end)
    |> Enum.reject(&blank?/1)
    |> case do
      [] -> nil
      lines -> Enum.join(lines, "；")
    end
  end

  defp omission_text(_notes), do: nil

  defp content_hash(body) when is_binary(body) do
    if String.trim(body) == "",
      do: nil,
      else: :sha256 |> :crypto.hash(body) |> Base.encode16(case: :lower)
  end

  defp content_hash(_body), do: nil

  defp normalize_source(%{} = source) do
    kind = source[:kind] || source["kind"]
    ref = blank_to_nil(text(source[:ref] || source["ref"]))

    if is_atom(kind) and kind in AuthoringTask.action_source_kinds() and ref,
      do: %{kind: kind, ref: ref},
      else: nil
  end

  defp normalize_source(_source), do: nil

  defp normalize_coverage(value) when value in [:single, :chapter, :multi, :none], do: value
  defp normalize_coverage("single"), do: :single
  defp normalize_coverage("chapter"), do: :chapter
  defp normalize_coverage("multi"), do: :multi
  defp normalize_coverage(_value), do: :single

  defp refs_for(""), do: []
  defp refs_for(nil), do: []
  defp refs_for(ref) when is_binary(ref), do: [ref]
  defp refs_for(_ref), do: []

  defp material_key(attrs) do
    [
      text(attrs[:resolved_chapter_ref]),
      text(attrs[:resolved_chapter]),
      "turn:" <> text(attrs[:turn_id])
    ]
    |> Enum.reject(&blank?/1)
    |> List.first()
  end

  defp short_hash(value) do
    :sha256
    |> :crypto.hash(to_string(value))
    |> Base.encode16(case: :lower)
    |> String.slice(0, 12)
  end

  defp truncation_note(true, note), do: note
  defp truncation_note(_truncated, _note), do: nil

  defp blank_to_nil(value) when is_binary(value) do
    if String.trim(value) == "", do: nil, else: value
  end

  defp blank_to_nil(_value), do: nil

  defp text(nil), do: ""
  defp text(value) when is_binary(value), do: value
  defp text(value), do: to_string(value)

  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(nil), do: true
  defp blank?(_value), do: false

  defp string_list(values) when is_list(values), do: Enum.filter(values, &is_binary/1)
  defp string_list(_values), do: []

  defp put_opt(map, _key, nil), do: map
  defp put_opt(map, key, value), do: Map.put(map, key, value)
end
