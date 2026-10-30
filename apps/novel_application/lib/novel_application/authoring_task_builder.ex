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
  alias NovelCommon.Contracts.ToolOutputContract

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

  @doc """
  范围：refs + coverage；base_ref/base_hash/target_chapter_ref 只传真实来源。
  B28 CP1 additive：`modification_scope` / `expected_base_versions`（章级修订）。
  """
  def scope(refs, opts \\ []) do
    %{refs: List.wrap(refs), coverage: Keyword.get(opts, :coverage, :single)}
    |> put_opt(:object_kind, opts[:object_kind])
    |> put_opt(:base_ref, opts[:base_ref])
    |> put_opt(:base_hash, opts[:base_hash])
    |> put_opt(:target_chapter_ref, opts[:target_chapter_ref])
    |> put_opt(:modification_scope, opts[:modification_scope])
    |> put_opt(:expected_base_versions, opts[:expected_base_versions])
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
    |> put_opt(
      :optional_keys,
      Keyword.get(opts, :optional_keys, []) |> List.wrap() |> Enum.reject(&(&1 == ""))
    )
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
      materials: prose_materials(attrs) ++ observation_materials(attrs[:observations]),
      preserve: prose_preserve(kind, attrs),
      operation_effect: prose_effect(kind),
      output_contract: attrs[:output_contract] || output_contract(:json, @prose_contract_opts),
      source_refs: string_list(attrs[:source_refs]) ++ observation_refs(attrs[:observations])
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
    artifact_type = normalize_artifact_type(attrs[:artifact_type]) || :prose_fragment

    new(:revision, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])) || "按作者动作或复核发现修订已有内容",
      author_words: author_words(attrs),
      source: normalize_source(attrs[:source]),
      scope:
        scope(refs_for(base_ref),
          object_kind: attrs[:object_kind] || revision_object_kind(artifact_type),
          coverage: coverage,
          base_ref: blank_to_nil(base_ref),
          base_hash: content_hash(attrs[:base_body]),
          target_chapter_ref: blank_to_nil(text(attrs[:target_chapter_ref]))
        ),
      materials: revision_materials(attrs, base_ref),
      preserve: revision_preserve(attrs, coverage),
      operation_effect: :revise_candidate,
      output_contract:
        attrs[:output_contract] ||
          role_output_contract(revision_role(artifact_type), artifact_type),
      source_refs: string_list(attrs[:source_refs])
    })
  end

  @chapter_revision_contract_opts [
    schema_ref: "prose_writing_v1",
    artifact_type: :prose_fragment,
    required_keys: ["items", "item_id", "title", "body"],
    allow_companions: false
  ]

  @chapter_modification_scopes [:format_only, :target_segments, :whole_chapter]

  @doc """
  B28 CP1：整章/多片段修订任务（chapter-scoped）。

  `attrs`（材料/覆盖事实由调用方从真实上下文取，不在本模块推断）：
  - `:target_chapter_ref`（必填，章身份）
  - `:covered_refs`（有序 accepted 片段 refs；order 即阅读投影顺序）
  - `:modification_scope`（`:format_only` | `:target_segments` | `:whole_chapter`，必填）
  - `:expected_base_versions`（`[%{ref, version}]`，stale 校验依据，可空 v1）
  - `:coverage`（默认 `:complete`；`:whole_chapter` 强制 complete）
  - `:base_ref`/`:base_hash`（可选；章级修订以章身份+期望版本为基线）
  - `:materials`（全章片段材料条目，含 version/complete?/omission_note）
  - `:preserve`（追加保留项；默认整章 preserve 仍含“未要求修改内容逐字保留”）
  - `:author_goal`/`:author_words`/`:source`/`:source_refs`/`:output_contract`

  失败返回可解释 `{:error, {:authoring_task_invalid, detail}}`，调用方不得降级猜意图。
  """
  @spec for_chapter_revision(map()) ::
          {:ok, AuthoringTask.t()} | {:error, {atom(), term()}}
  def for_chapter_revision(attrs) when is_map(attrs) do
    with {:ok, target_chapter_ref} <- chapter_revision_target(attrs),
         {:ok, modification_scope} <- chapter_revision_modification_scope(attrs),
         {:ok, covered_refs} <- chapter_revision_covered_refs(attrs),
         :ok <- chapter_revision_scope_supported(modification_scope, attrs),
         :ok <- chapter_revision_versions(attrs[:expected_base_versions]) do
      coverage = chapter_revision_coverage(modification_scope, attrs[:coverage])

      new(:revision, %{
        author_goal: blank_to_nil(text(attrs[:author_goal])) || "按作者要求修订整章正文（覆盖范围内完整替换）",
        author_words: author_words(attrs),
        source: normalize_source(attrs[:source]),
        scope:
          scope(covered_refs,
            object_kind: :chapter_prose,
            coverage: coverage,
            base_ref: chapter_revision_base_ref(attrs, modification_scope, target_chapter_ref),
            base_hash: blank_to_nil(text(attrs[:base_hash])),
            target_chapter_ref: target_chapter_ref,
            modification_scope: modification_scope,
            expected_base_versions: normalize_versions(attrs[:expected_base_versions])
          ),
        materials: List.wrap(attrs[:materials]),
        preserve: revision_preserve(attrs, coverage),
        operation_effect: :revise_candidate,
        output_contract:
          attrs[:output_contract] || output_contract(:json, @chapter_revision_contract_opts),
        source_refs: string_list(attrs[:source_refs])
      })
    end
  end

  # :target_segments 未被冻结 semantics 的“章级基线豁免”覆盖；用章身份作为基线 ref
  # 让多片段/指定片段修订仍以章+期望版本为基线（不要求单 artifact base_ref）。
  defp chapter_revision_base_ref(attrs, :target_segments, target_chapter_ref) do
    blank_to_nil(text(attrs[:base_ref])) || target_chapter_ref
  end

  defp chapter_revision_base_ref(attrs, _scope, _target_chapter_ref) do
    blank_to_nil(text(attrs[:base_ref]))
  end

  defp chapter_revision_target(attrs) do
    case blank_to_nil(text(attrs[:target_chapter_ref])) do
      nil -> {:error, {:authoring_task_invalid, {:target_chapter_ref_required, :revision}}}
      ref -> {:ok, ref}
    end
  end

  defp chapter_revision_modification_scope(attrs) do
    case normalize_modification_scope(attrs[:modification_scope]) do
      nil ->
        {:error, {:authoring_task_invalid, {:modification_scope_required, :revision}}}

      scope ->
        {:ok, scope}
    end
  end

  defp normalize_modification_scope(value) when value in @chapter_modification_scopes, do: value

  defp normalize_modification_scope(value) when is_binary(value) do
    Enum.find(@chapter_modification_scopes, &(Atom.to_string(&1) == value))
  end

  defp normalize_modification_scope(_value), do: nil

  defp chapter_revision_covered_refs(attrs) do
    refs = string_list(attrs[:covered_refs] || attrs[:refs])

    cond do
      refs == [] ->
        {:error, {:authoring_task_invalid, {:covered_refs_required, :revision}}}

      length(refs) != length(Enum.uniq(refs)) ->
        {:error, {:authoring_task_invalid, {:covered_refs_duplicated, :revision}}}

      true ->
        {:ok, refs}
    end
  end

  # :whole_chapter 要求覆盖全部当前 accepted 片段；:format_only 同样必须给出完整覆盖，
  # 否则应用侧无法做空白归一后的字节等价判定（Q03）。
  defp chapter_revision_scope_supported(:whole_chapter, attrs) do
    case attrs[:coverage] do
      nil -> :ok
      :complete -> :ok
      "complete" -> :ok
      _ -> {:error, {:authoring_task_invalid, {:whole_chapter_coverage_required, :revision}}}
    end
  end

  defp chapter_revision_scope_supported(_scope, _attrs), do: :ok

  # 章级修订以章身份+期望版本为基线，覆盖范围必须是完整的。
  defp chapter_revision_coverage(_scope, _coverage), do: :complete

  defp chapter_revision_versions(nil), do: :ok
  defp chapter_revision_versions([]), do: :ok

  defp chapter_revision_versions(versions) when is_list(versions) do
    if Enum.all?(versions, &valid_chapter_revision_version?/1),
      do: :ok,
      else: {:error, {:authoring_task_invalid, {:expected_base_versions_invalid, :revision}}}
  end

  defp chapter_revision_versions(_versions),
    do: {:error, {:authoring_task_invalid, {:expected_base_versions_invalid, :revision}}}

  defp valid_chapter_revision_version?(%{} = entry) do
    ref = text(entry[:ref] || entry["ref"])
    version = entry[:version] || entry["version"]

    # ref 来自 text/1，恒为 binary；is_binary(ref) 是恒真守卫（B60 dialyzer 清理）。
    ref != "" and is_integer(version) and version > 0
  end

  defp valid_chapter_revision_version?(_entry), do: false

  defp normalize_versions(nil), do: nil
  defp normalize_versions([]), do: nil

  defp normalize_versions(versions) when is_list(versions) do
    Enum.map(versions, fn entry ->
      %{ref: text(entry[:ref] || entry["ref"]), version: entry[:version] || entry["version"]}
    end)
  end

  defp normalize_versions(_versions), do: nil

  @doc """
  组装正文质量评估（quality_evaluation）任务：只读评审本轮生成的正文材料。
  `:coverage` 默认 `:single`（单候选/片段），不冒充整章。
  """
  @spec for_quality_evaluation(map()) ::
          {:ok, AuthoringTask.t()} | {:error, {atom(), term()}}
  def for_quality_evaluation(attrs) when is_map(attrs) do
    # B60：text/1 恒返回 binary（空串也是真值），原 `|| text(attrs[:turn_id])`
    # 兜底不可能触发；保留既有行为（source_ref 为空串时不回退 turn_id）。
    source_ref = text(attrs[:source_ref])
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

  # ── CP3d：非 prose creative tool 的任务组装 ──────────────────────────
  #
  # plot_outline / character_design / character_evolution / world_building 的新建调用。
  # 角色/设定/大纲的领域 schema 与文案仍保留在 agent 模板；这里只统一任务语义、
  # 来源、范围/材料与输出契约（artifact_type + 运行时必填键）。

  @outline_contract_opts [
    schema_ref: "tentative_artifact_v1",
    artifact_type: :outline_draft,
    required_keys: ["items", "item_id", "title", "body"],
    optional_keys: ["chapter_ref"],
    allow_companions: false
  ]

  @character_design_contract_opts [
    schema_ref: "tentative_artifact_v1",
    artifact_type: :character_seed,
    required_keys: ["items", "item_id", "title", "body"],
    allow_companions: false
  ]

  @character_evolution_contract_opts [
    schema_ref: "tentative_artifact_v1",
    artifact_type: :character_evolution_seed,
    required_keys: ["items", "item_id", "title", "body"],
    allow_companions: false
  ]

  @doc "按 tool 分派 creative 新建任务组装；未知 creative tool 返回错误（不静默）。"
  @spec for_creative_tool(String.t(), map()) ::
          {:ok, AuthoringTask.t()} | {:error, {atom(), term()}}
  def for_creative_tool("prose_writing", attrs), do: for_prose_writing(attrs)
  def for_creative_tool("plot_outline", attrs), do: for_outline(attrs)
  def for_creative_tool("character_design", attrs), do: for_character_design(attrs)
  def for_creative_tool("character_evolution", attrs), do: for_character_evolution(attrs)
  def for_creative_tool("world_building", attrs), do: for_world_building(attrs)

  def for_creative_tool(tool, _attrs),
    do: {:error, {:unsupported_creative_tool, to_string(tool)}}

  @doc "大纲/章计划新建任务。"
  @spec for_outline(map()) :: {:ok, AuthoringTask.t()} | {:error, {atom(), term()}}
  def for_outline(attrs) when is_map(attrs) do
    new(:outline, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])),
      author_words: author_words(attrs),
      scope: creative_scope(attrs, :outline, :multi),
      materials: creative_materials(attrs),
      preserve: [],
      operation_effect: :create_candidate,
      output_contract: attrs[:output_contract] || output_contract(:json, @outline_contract_opts),
      source_refs: string_list(attrs[:source_refs])
    })
  end

  @doc "角色设计新建任务。"
  @spec for_character_design(map()) :: {:ok, AuthoringTask.t()} | {:error, {atom(), term()}}
  def for_character_design(attrs) when is_map(attrs) do
    new(:character_design, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])),
      author_words: author_words(attrs),
      scope: creative_scope(attrs, :character, :single),
      materials: creative_materials(attrs),
      preserve: [],
      operation_effect: :design_object,
      output_contract:
        attrs[:output_contract] || output_contract(:json, @character_design_contract_opts),
      source_refs: string_list(attrs[:source_refs])
    })
  end

  @doc "角色演化记录新建任务（写记忆，不改主档案；领域 schema 在 agent 模板保留）。"
  @spec for_character_evolution(map()) ::
          {:ok, AuthoringTask.t()} | {:error, {atom(), term()}}
  def for_character_evolution(attrs) when is_map(attrs) do
    new(:character_evolution, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])),
      author_words: author_words(attrs),
      scope: creative_scope(attrs, :character_memory, :single),
      materials: creative_materials(attrs),
      preserve: [],
      operation_effect: :create_candidate,
      output_contract:
        attrs[:output_contract] || output_contract(:json, @character_evolution_contract_opts),
      source_refs: string_list(attrs[:source_refs])
    })
  end

  @doc """
  世界设定/伏笔/规则/约束/风格草稿新建任务。

  artifact_type 由已解析任务给出；应用侧未显式给出时按作者意图文本做确定性归类
  （与旧 adapter 一致的唯一实现，agent adapter 不再持有另一份关键词表）。
  """
  @spec for_world_building(map()) :: {:ok, AuthoringTask.t()} | {:error, {atom(), term()}}
  def for_world_building(attrs) when is_map(attrs) do
    artifact_type = normalize_artifact_type(attrs[:artifact_type]) || classify_world_type(attrs)

    new(:world_building, %{
      author_goal: blank_to_nil(text(attrs[:author_goal])),
      author_words: author_words(attrs),
      scope: creative_scope(attrs, :world_setting, :single),
      materials: creative_materials(attrs),
      preserve: [],
      operation_effect: :create_candidate,
      output_contract:
        attrs[:output_contract] || role_output_contract(:world_building, artifact_type),
      source_refs: string_list(attrs[:source_refs])
    })
  end

  # 角色专属输出契约（修订路径与 world artifact_type 共用）。
  defp role_output_contract(:prose, artifact_type),
    do: output_contract(:json, Keyword.put(@prose_contract_opts, :artifact_type, artifact_type))

  defp role_output_contract(:outline, _artifact_type),
    do: output_contract(:json, @outline_contract_opts)

  defp role_output_contract(:character_design, _artifact_type),
    do: output_contract(:json, @character_design_contract_opts)

  defp role_output_contract(:character_evolution, _artifact_type),
    do: output_contract(:json, @character_evolution_contract_opts)

  defp role_output_contract(:world_building, artifact_type) do
    output_contract(:json,
      schema_ref: "tentative_artifact_v1",
      artifact_type: artifact_type,
      required_keys: ["items", "item_id", "title", "body"],
      allow_companions: false
    )
  end

  defp role_output_contract(_role, artifact_type) do
    output_contract(:json,
      schema_ref: "tentative_artifact_v1",
      artifact_type: artifact_type,
      required_keys: ["items", "item_id", "title", "body"],
      allow_companions: false
    )
  end

  defp revision_role(:prose_fragment), do: :prose
  defp revision_role(:outline_draft), do: :outline
  defp revision_role(:character_seed), do: :character_design
  defp revision_role(:character_evolution_seed), do: :character_evolution

  defp revision_role(type)
       when type in [
              :world_setting,
              :foreshadowing_seed,
              :world_rule_seed,
              :style_rule_seed,
              :constraint_seed
            ],
       do: :world_building

  defp revision_role(_type), do: :generic

  defp revision_object_kind(:outline_draft), do: :outline
  defp revision_object_kind(:character_seed), do: :character
  defp revision_object_kind(:character_evolution_seed), do: :character_memory

  defp revision_object_kind(type)
       when type in [
              :world_setting,
              :foreshadowing_seed,
              :world_rule_seed,
              :style_rule_seed,
              :constraint_seed
            ],
       do: :world_setting

  defp revision_object_kind(_type), do: :prose_fragment

  defp creative_scope(attrs, object_kind, coverage) do
    scope(refs_for(work_ref(attrs)),
      object_kind: object_kind,
      coverage: coverage,
      target_chapter_ref: blank_to_nil(text(attrs[:resolved_chapter_ref]))
    )
  end

  defp work_ref(attrs) do
    cond do
      ref = blank_to_nil(text(attrs[:work_ref])) -> ref
      id = blank_to_nil(text(attrs[:workspace_id])) -> "work:" <> id
      true -> nil
    end
  end

  defp classify_world_type(attrs) do
    # 优先用作者原话判断类型；只有原话缺失（按钮动作/系统触发）才退回应用归纳的目标。
    # 不把 action summary 的枚举词（如"伏笔或规则草稿"）混进作者意图。
    text = text(blank_to_nil(text(author_words(attrs))) || text(attrs[:author_goal]))

    cond do
      contains_any?(text, ["伏笔", "悬念", "线索", "回收"]) -> :foreshadowing_seed
      contains_any?(text, ["风格规则", "写作规则", "文风", "语气", "推荐写法"]) -> :style_rule_seed
      contains_any?(text, ["约束", "限制", "禁止", "不得", "禁忌"]) -> :constraint_seed
      contains_any?(text, ["规则", "规则体系", "世界规则"]) -> :world_rule_seed
      true -> :world_setting
    end
  end

  defp contains_any?(text, terms), do: Enum.any?(terms, &String.contains?(text, &1))

  defp normalize_artifact_type(nil), do: nil

  defp normalize_artifact_type(type) when is_atom(type) do
    if type in ToolOutputContract.creative_artifact_types(), do: type, else: nil
  end

  defp normalize_artifact_type(type) when is_binary(type) do
    case ToolOutputContract.normalize_artifact_type(type) do
      {:ok, atom} -> atom
      {:error, _} -> nil
    end
  end

  defp normalize_artifact_type(_type), do: nil

  defp creative_materials(attrs) do
    sections = attrs[:sections] || %{}
    key = creative_material_key(attrs)

    [
      optional_material(:target_structure, text(sections[:target_structure]),
        ref: "target_structure:#{key}",
        complete?: false,
        omission_note: "仅目标章与前后邻章结构窗口"
      ),
      prior_prose_material(text(attrs[:prior_prose]), key, omission_text(attrs[:omission_notes])),
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
        complete?: not (attrs[:facts_truncated?] == true),
        omission_note: truncation_note(attrs[:facts_truncated?] == true, "已确认事实按分组上限截断")
      ),
      optional_material(:style_guide, text(sections[:style_guide]),
        ref: "style_guide:#{key}",
        complete?: not (attrs[:style_truncated?] == true),
        omission_note: truncation_note(attrs[:style_truncated?] == true, "风格条目录入按上限截断")
      ),
      optional_material(:work_skeleton, text(sections[:work_skeleton]),
        ref: "work_skeleton:#{key}"
      ),
      optional_material(:volume_scope, text(sections[:volume_scope]), ref: "volume_scope:#{key}"),
      optional_material(:current_volume_blueprint, text(sections[:current_volume_blueprint]),
        ref: "current_volume_blueprint:#{key}"
      ),
      optional_material(:planning_mission, text(sections[:planning_mission]),
        ref: "planning_mission:#{key}"
      ),
      optional_material(:progress_state, text(sections[:progress_state]),
        ref: "progress_state:#{key}",
        complete?: false,
        omission_note: "账面投影最多 6 条相关弧光/伏笔"
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

  defp creative_material_key(attrs) do
    [
      text(attrs[:resolved_chapter_ref]),
      text(attrs[:resolved_chapter]),
      work_ref(attrs),
      "turn:" <> text(attrs[:turn_id])
    ]
    |> Enum.reject(&blank?/1)
    |> List.first()
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

  # B39 CP1b/D7：本 run 只读探索观察作为 writer 任务材料与来源 refs（additive）。
  # 内容由 author_input_text 观察段承载；这里只登记可核验来源，避免把同一份观察
  # 既当 Base 材料又当模型产出。
  defp observation_materials(observations) do
    observations
    |> observation_list()
    |> Enum.map(fn observation ->
      kind =
        Map.get(observation, :tool) || Map.get(observation.structured_payload, :tool) ||
          "observation"

      material(:observation, "observation:#{observation.observation_id}",
        complete?: true,
        omission_note: "单次只读观察；未覆盖全章/全书"
      )
      |> Map.put(:kind, :observation)
      |> Map.put(:source, to_string(kind))
    end)
  end

  defp observation_refs(observations) do
    observations
    |> observation_list()
    |> Enum.map(&"observation:#{&1.observation_id}")
  end

  defp observation_list(observations) do
    observations
    |> List.wrap()
    |> Enum.filter(&is_struct(&1, NovelDomain.AgentObservation))
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

  # refs_for/1 的输入全部来自 text/1（binary）；空/nil 走空列表，非空 binary 走单项。
  defp refs_for(ref) when is_binary(ref) and ref != "", do: [ref]
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

  # 调用点均传入 text/1 结果（binary）；非 binary 分支被 dialyzer 证明不可达（B60）。
  defp blank_to_nil(value) when is_binary(value) do
    if String.trim(value) == "", do: nil, else: value
  end

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
