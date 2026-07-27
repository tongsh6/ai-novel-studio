defmodule NovelPersistence.AdoptionRepository do
  @moduledoc """
  Persistence boundary for accepted artifact adoption.

  AU-05 requires adoption to leave a durable state consequence. This repository
  records the accepted author action as an applied mutation, then persists the
  adopted creative fact **by its layer**：

  - `character_seed` → 角色**主档案层** `Character`（已采纳；AU-09 / `21-novel-object-model.md`
    §7.2 角色资产核心对象），**不写记忆**——角色随作品推进的演化才进 memory（连续性层，CP2）。
  - 其它创作产物 → 当前作品的 confirmed memory item（设定 / 连续性层）。
  """

  alias Ecto.Multi
  import Ecto.Query

  alias NovelDomain.ChapterPlanDirection
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.NarrativeRole
  alias NovelFoundation.Enums.SourceType
  alias NovelFoundation.Enums.StructureStatus
  alias NovelFoundation.ID
  alias NovelPersistence.ChapterPlanParser
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Mutation
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume
  alias NovelPersistence.Schemas.Work

  # 计划是扁平章列表、无卷分组，用单一默认卷承载已采纳卷/章结构。
  @default_volume_title "第一卷"

  @spec writer() :: function()
  def writer do
    &persist/1
  end

  @spec persist(map()) :: {:ok, map()} | {:error, term()}
  def persist(attrs) when is_map(attrs) do
    mutation_attrs = mutation_attrs(attrs)

    Multi.new()
    |> Multi.insert(
      :mutation,
      Mutation.changeset(%Mutation{}, mutation_attrs) |> Mutation.apply_changeset()
    )
    |> Multi.run(:memory_item, fn repo, %{mutation: mutation} ->
      maybe_persist_memory_item(repo, attrs, mutation.id)
    end)
    |> Multi.run(:character, fn repo, %{mutation: mutation} ->
      maybe_persist_character(repo, attrs, mutation.id)
    end)
    |> Multi.run(:work_planning, fn repo, _changes ->
      maybe_apply_work_skeleton(repo, attrs)
    end)
    |> Multi.run(:reading_projection, fn repo, %{mutation: mutation} ->
      maybe_persist_reading_projection(repo, attrs, mutation.id)
    end)
    |> Multi.run(:chapter_structure, fn repo, _changes ->
      maybe_materialize_chapter_structure(repo, attrs)
    end)
    |> Repo.transaction()
    |> case do
      {:ok,
       %{
         mutation: mutation,
         memory_item: memory_item,
         character: character,
         work_planning: work_planning,
         reading_projection: reading_projection
       }} ->
        {:ok,
         build_persist_result(mutation, memory_item, character, work_planning, reading_projection)}

      {:error, _step, reason, _changes} ->
        {:error, reason}
    end
  end

  # 采纳产物按层落地：character_seed → Character 主档案（不写记忆）；
  # work_skeleton_suggestion → works 立项规划字段回写（VS-00G CP4d，不写记忆）；
  # 其它 → confirmed memory。
  defp build_persist_result(mutation, memory_item, character, work_planning, reading_projection) do
    %{
      mutation_id: mutation.id,
      mutation_status: mutation.status,
      source_revision_ref: "mutation:#{mutation.id}",
      reading_projection: reading_projection
    }
    |> put_memory_item(memory_item)
    |> put_character(character)
    |> put_work_planning(work_planning)
  end

  defp put_memory_item(result, nil), do: result

  defp put_memory_item(result, %MemoryItem{} = memory_item) do
    result
    |> Map.put(:memory_item_id, memory_item.id)
    |> Map.put(:memory_status, memory_item.status)
  end

  defp put_character(result, nil), do: result

  defp put_character(result, %Character{} = character) do
    result
    |> Map.put(:character_id, character.id)
    |> Map.put(:character_status, character.status)
  end

  defp put_work_planning(result, nil), do: result

  defp put_work_planning(result, %Work{} = work) do
    result
    |> Map.put(:work_planning_updated, true)
    |> Map.put(:work_revision, work.revision)
  end

  # character_seed 是角色主档案层（21 §7.2），不写记忆；work_skeleton_suggestion 是
  # 立项规划字段回写（VS-00G CP4d），同样不写记忆；其它创作产物落 confirmed memory。
  defp maybe_persist_memory_item(repo, attrs, mutation_id) do
    artifact_type = Map.get(attrs, :artifact_type)

    if character_dossier_artifact?(artifact_type) or work_skeleton_artifact?(artifact_type) do
      {:ok, nil}
    else
      %MemoryItem{}
      |> MemoryItem.changeset(memory_item_attrs(attrs, mutation_id))
      |> repo.insert()
    end
  end

  # work_skeleton_suggestion 采纳 → works 立项规划字段回写（VS-00G CP4d 契约
  # 「works 字段类提案落位=立项字段回写」）。字段白名单硬校验；值缺失/字段非法
  # 一律拒绝采纳（不静默吞掉作者授权）。revision 经 Work.changeset optimistic_lock
  # 正常递增，与作者手工立项编辑同一冲突语义。
  @skeleton_writable_fields ~w(target_length planned_volumes serial_form)

  defp maybe_apply_work_skeleton(repo, attrs) do
    if work_skeleton_artifact?(Map.get(attrs, :artifact_type)) do
      apply_work_skeleton(repo, attrs)
    else
      {:ok, nil}
    end
  end

  defp apply_work_skeleton(repo, attrs) do
    field = attrs |> Map.get(:skeleton_field) |> to_string()
    value = Map.get(attrs, :skeleton_value)

    cond do
      field not in @skeleton_writable_fields ->
        {:error, {:invalid_skeleton_field, field}}

      is_nil(value) ->
        {:error, :skeleton_value_missing}

      true ->
        case repo.get(Work, Map.fetch!(attrs, :work_id)) do
          nil ->
            {:error, :work_not_found}

          %Work{} = work ->
            work
            |> Work.changeset(%{field => value})
            |> repo.update(stale_error_field: :revision)
        end
    end
  end

  defp work_skeleton_artifact?(:work_skeleton_suggestion), do: true
  defp work_skeleton_artifact?("work_skeleton_suggestion"), do: true
  defp work_skeleton_artifact?(_type), do: false

  # character_seed 采纳 → 结构化 Character 主档案（accepted）。
  # name ← artifact 标题（attrs.summary），summary ← artifact 正文（attrs.content），
  # narrative_role ← artifact item 的结构化叙事角色（缺省 nil，使主角成为可校验事实而非默认）；
  # aliases 等其它结构化字段与演化记忆留 CP2。
  defp maybe_persist_character(repo, attrs, _mutation_id) do
    if character_dossier_artifact?(Map.get(attrs, :artifact_type)) do
      %Character{}
      |> Character.changeset(character_attrs(attrs))
      |> repo.insert()
    else
      {:ok, nil}
    end
  end

  defp character_attrs(attrs) do
    %{
      work_id: Map.fetch!(attrs, :work_id),
      name: character_name(attrs),
      summary: character_profile(attrs),
      narrative_role: character_narrative_role(attrs),
      status: AdoptionStatus.accepted()
    }
  end

  defp character_narrative_role(attrs) do
    case Map.get(attrs, :narrative_role) do
      value when is_binary(value) ->
        if NarrativeRole.valid?(value), do: value, else: nil

      _ ->
        nil
    end
  end

  defp character_name(attrs) do
    case attrs |> Map.get(:summary) |> to_string() |> String.trim() do
      "" -> "未命名角色"
      name -> name
    end
  end

  defp character_profile(attrs) do
    case attrs |> Map.get(:content) |> to_string() |> String.trim() do
      "" -> nil
      profile -> profile
    end
  end

  defp character_dossier_artifact?(:character_seed), do: true
  defp character_dossier_artifact?("character_seed"), do: true
  defp character_dossier_artifact?(_), do: false

  defp mutation_attrs(attrs) do
    %{
      actor_ref: Map.fetch!(attrs, :actor_ref),
      source_turn_ref: Map.fetch!(attrs, :source_turn_ref),
      target_scope: "work:#{Map.fetch!(attrs, :work_id)}",
      target_object_ref: Map.fetch!(attrs, :artifact_id),
      base_revision: Map.get(attrs, :base_revision, 1),
      mutation_type: "adopt_artifact",
      proposed_change_ref: Map.fetch!(attrs, :artifact_id),
      authority_scope: "author_confirmed_adoption",
      requires_adoption: false
    }
  end

  defp memory_item_attrs(attrs, mutation_id) do
    %{
      id: ID.uuid(),
      work_id: Map.fetch!(attrs, :work_id),
      content: Map.fetch!(attrs, :content),
      summary: Map.get(attrs, :summary),
      type: memory_type(attrs),
      scope: MemoryScope.work(),
      status: MemoryStatus.confirmed(),
      source_type: MemorySourceType.author_confirmed(),
      source_id: mutation_id,
      weight: Decimal.new("0.8000"),
      confidence: Decimal.new("0.9000"),
      source_confidence: Decimal.new("1.0000"),
      locked: true,
      recallable: true,
      tags: ["adopted_artifact", to_string(Map.get(attrs, :artifact_type, SourceType.artifact()))]
    }
  end

  # character_evolution_seed → 角色记忆（CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP）。
  # 优先用 provider 给的结构化 memory_subtype，否则按内容兜底分类，默认 CHARACTER_PROFILE。
  defp memory_type(%{artifact_type: type} = attrs)
       when type in [:character_evolution_seed, "character_evolution_seed"],
       do: character_evolution_memory_type(attrs)

  defp memory_type(%{artifact_type: type})
       when type in [:plot_direction, "plot_direction"],
       do: MemoryType.plot_fact()

  defp memory_type(%{artifact_type: type})
       when type in [:outline_draft, "outline_draft"],
       do: MemoryType.draft_context()

  defp memory_type(%{artifact_type: type})
       when type in [:foreshadowing_seed, "foreshadowing_seed"],
       do: MemoryType.foreshadowing()

  defp memory_type(%{artifact_type: type})
       when type in [:world_rule_seed, "world_rule_seed"],
       do: MemoryType.world_rule()

  defp memory_type(%{artifact_type: type})
       when type in [:style_rule_seed, "style_rule_seed"],
       do: MemoryType.style_rule()

  defp memory_type(%{artifact_type: type})
       when type in [:constraint_seed, "constraint_seed"],
       do: MemoryType.constraint()

  defp memory_type(%{artifact_type: type} = attrs)
       when type in [:world_setting, "world_setting"],
       do: world_setting_memory_type(attrs)

  defp memory_type(_attrs), do: MemoryType.draft_context()

  # Legacy compatibility：早期 world_building 统一输出 world_setting。
  # 新链路应使用 foreshadowing_seed / *_rule_seed / constraint_seed 显式类型。
  defp world_setting_memory_type(attrs) do
    text =
      [Map.get(attrs, :summary), Map.get(attrs, :content)]
      |> Enum.reject(&is_nil/1)
      |> Enum.map_join("\n", &to_string/1)

    cond do
      contains_any?(text, ["伏笔", "回收点", "回收方式", "线索"]) ->
        MemoryType.foreshadowing()

      contains_any?(text, ["风格规则", "文风", "语气", "推荐写法"]) ->
        MemoryType.style_rule()

      contains_any?(text, ["约束", "限制", "禁止", "不得", "禁忌"]) ->
        MemoryType.constraint()

      true ->
        MemoryType.world_rule()
    end
  end

  # 角色演化记忆分类（AU-09 §4.5）：结构化 memory_subtype 优先，否则按标题/正文内容兜底。
  defp character_evolution_memory_type(attrs) do
    case Map.get(attrs, :memory_subtype) do
      subtype when subtype in ["CHARACTER_PROFILE", "CURRENT_STATE", "RELATIONSHIP"] ->
        subtype

      _ ->
        text =
          [Map.get(attrs, :summary), Map.get(attrs, :content)]
          |> Enum.reject(&is_nil/1)
          |> Enum.map_join("\n", &to_string/1)

        cond do
          contains_any?(text, ["关系", "结盟", "敌对", "背叛", "决裂", "联手"]) ->
            MemoryType.relationship()

          contains_any?(text, ["当前状态", "现状", "此刻", "目前", "伤势", "处境", "所在"]) ->
            MemoryType.current_state()

          true ->
            MemoryType.character_profile()
        end
    end
  end

  defp contains_any?(text, terms) do
    Enum.any?(terms, &String.contains?(text, &1))
  end

  defp maybe_persist_reading_projection(repo, attrs, mutation_id) do
    if reading_projection_artifact?(Map.get(attrs, :artifact_type)) do
      persist_reading_projection(repo, attrs, mutation_id)
    else
      {:ok, nil}
    end
  end

  defp reading_projection_artifact?(:scene_draft), do: true
  defp reading_projection_artifact?("scene_draft"), do: true
  defp reading_projection_artifact?(:prose_fragment), do: true
  defp reading_projection_artifact?("prose_fragment"), do: true
  defp reading_projection_artifact?(_), do: false

  # 章含多场景（v2 21 §6.6 / ADR-0004）。正文采纳按 mode 分流：
  # - :overwrite（默认/重写）—— 同 title 落同一卷/章/场景，supersede 旧 accepted 再写新版，
  #   阅读投影同一章显示最新正文，不堆重复章。
  # - :append（续写）—— 同章新建场景（seq+1）累积，不复用旧场景、不 supersede，字数累加。
  defp persist_reading_projection(repo, attrs, mutation_id) do
    work_id = Map.fetch!(attrs, :work_id)
    chapter_title = projection_title(attrs)
    content = projection_content(attrs)
    mode = projection_mode(attrs)

    with {:ok, volume} <- find_or_create_volume(repo, work_id),
         {:ok, chapter} <- find_or_create_chapter(repo, work_id, volume.id, chapter_title),
         :ok <- mark_chapter_drafted(repo, chapter),
         {:ok, scene} <- resolve_scene(repo, work_id, chapter.id, chapter_title, mode),
         :ok <- maybe_supersede_scene(repo, work_id, scene.id, mode),
         {:ok, draft} <-
           insert_draft(repo, %{
             work_id: work_id,
             scene_id: scene.id,
             content: content,
             status: AdoptionStatus.accepted(),
             revision: next_draft_revision(repo, scene.id)
           }) do
      {:ok,
       %{
         volume_id: volume.id,
         chapter_id: chapter.id,
         scene_id: scene.id,
         draft_id: draft.id,
         source_revision_ref: "draft:#{draft.id}:#{draft.revision}",
         mutation_id: mutation_id
       }}
    end
  end

  defp projection_mode(attrs) do
    case Map.get(attrs, :mode) do
      :append -> :append
      "append" -> :append
      _ -> :overwrite
    end
  end

  # :overwrite —— 复用同章同 title 场景（章身份=场景身份）。
  # :append —— 续写：同章新建场景（seq+1）累积。
  defp resolve_scene(repo, work_id, chapter_id, chapter_title, :overwrite) do
    find_or_create_scene(repo, work_id, chapter_id, chapter_title)
  end

  defp resolve_scene(repo, work_id, chapter_id, _chapter_title, :append) do
    seq = next_scene_seq(repo, chapter_id)
    insert_scene(repo, %{work_id: work_id, chapter_id: chapter_id, title: "场景 #{seq}", seq: seq})
  end

  defp maybe_supersede_scene(repo, work_id, scene_id, :overwrite) do
    supersede_accepted_drafts(repo, work_id, scene_id)
  end

  defp maybe_supersede_scene(_repo, _work_id, _scene_id, :append), do: :ok

  @doc """
  读端口：当前作品是否已有「同 title 且含已采纳正文」的章节。
  采纳边界用它判断是否为覆盖已有 canon（需作者确认）。
  """
  @spec has_accepted_chapter?(String.t(), String.t()) :: boolean()
  def has_accepted_chapter?(work_id, title) when is_binary(work_id) and is_binary(title) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        accepted = AdoptionStatus.accepted()
        normalized = canonical_chapter_title(title)

        Chapter
        |> join(:inner, [c], s in Scene, on: s.chapter_id == c.id and s.work_id == ^uuid)
        |> join(:inner, [_c, s], d in Draft,
          on: d.scene_id == s.id and d.work_id == ^uuid and d.status == ^accepted
        )
        |> where([c], c.work_id == ^uuid and c.title == ^normalized)
        |> Repo.exists?()

      :error ->
        false
    end
  end

  def has_accepted_chapter?(_work_id, _title), do: false

  @doc "读端口工厂：注入 AdoptionWorkflow 判断覆盖。"
  @spec overwrite_reader() :: (String.t(), String.t() -> boolean())
  def overwrite_reader, do: &has_accepted_chapter?/2

  # 采纳章节计划（outline）→ 物化 accepted 卷/章结构（v3 AU-08：目录来源是已采纳的卷/章结构；
  # AU08-I1 只有已采纳作品事实进投影；SC-AU08-B2 允许章在目录里但还没有已采纳正文）。
  # 章以 status=PLANNED 落地，正文采纳时由 mark_chapter_drafted 翻成 DRAFTING。
  defp maybe_materialize_chapter_structure(repo, attrs) do
    if outline_artifact?(Map.get(attrs, :artifact_type)) do
      materialize_chapter_structure(repo, Map.fetch!(attrs, :work_id), Map.get(attrs, :content))
    else
      {:ok, 0}
    end
  end

  defp materialize_chapter_structure(repo, work_id, content) do
    chapters = ChapterPlanParser.parse(content)

    with {:ok, volume} <- find_or_create_volume(repo, work_id) do
      reduce_planned_chapters(repo, work_id, volume.id, chapters)
    end
  end

  defp reduce_planned_chapters(repo, work_id, volume_id, chapters) do
    Enum.reduce_while(chapters, {:ok, 0}, fn chapter, {:ok, n} ->
      case ensure_planned_chapter(repo, work_id, volume_id, chapter) do
        :ok -> {:cont, {:ok, n + 1}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp outline_artifact?(:outline_draft), do: true
  defp outline_artifact?("outline_draft"), do: true
  defp outline_artifact?(_), do: false

  # 计划章按 (work_id, title) 幂等：不存在则建（带大纲摘要/方向）；已存在则只补缺失的
  # summary 或 plan_direction（正文先于计划采纳、或旧计划无结构方向时）。已有事实不覆盖。
  defp ensure_planned_chapter(repo, work_id, volume_id, %{title: title} = chapter) do
    summary = blank_to_nil(Map.get(chapter, :summary))
    plan_direction = ChapterPlanDirection.to_storage(Map.get(chapter, :plan_direction))

    Chapter
    |> where([c], c.work_id == ^work_id and c.title == ^title)
    |> limit(1)
    |> repo.one()
    |> case do
      nil ->
        insert_chapter(repo, %{
          work_id: work_id,
          volume_id: volume_id,
          title: title,
          seq: next_chapter_seq(repo, volume_id),
          status: StructureStatus.planned(),
          summary: summary,
          plan_direction: plan_direction
        })
        |> wrap_chapter_result()

      %Chapter{} = existing_chapter ->
        changes =
          %{}
          |> maybe_put_missing_summary(existing_chapter.summary, summary)
          |> maybe_put_missing_direction(existing_chapter.plan_direction, plan_direction)

        if changes == %{} do
          :ok
        else
          existing_chapter
          |> Chapter.changeset(changes)
          |> repo.update()
          |> wrap_chapter_result()
        end
    end
  end

  defp maybe_put_missing_summary(changes, existing, summary)
       when existing in [nil, ""] and not is_nil(summary),
       do: Map.put(changes, :summary, summary)

  defp maybe_put_missing_summary(changes, _existing, _summary), do: changes

  defp maybe_put_missing_direction(changes, existing, plan_direction) do
    if ChapterPlanDirection.empty?(existing) and not is_nil(plan_direction) do
      Map.put(changes, :plan_direction, plan_direction)
    else
      changes
    end
  end

  defp wrap_chapter_result({:ok, _chapter}), do: :ok
  defp wrap_chapter_result({:error, reason}), do: {:error, reason}

  defp blank_to_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp blank_to_nil(_value), do: nil

  # 正文采纳进某章 → 该章不再是纯计划态。PLANNED → DRAFTING；已 COMPLETED/其它不回退。
  defp mark_chapter_drafted(repo, %Chapter{status: status} = chapter) do
    if status == StructureStatus.planned() do
      chapter
      |> Chapter.changeset(%{status: StructureStatus.drafting()})
      |> repo.update()
      |> case do
        {:ok, _} -> :ok
        {:error, reason} -> {:error, reason}
      end
    else
      :ok
    end
  end

  # 当前作品的规范卷：复用已存在的（计划物化或历史采纳建的）首个卷；无则建默认卷。
  # 计划是扁平章列表，无卷分组（v3 27 §5.1：TOC 以 volume ordering 为一级、arc 仅 secondary），
  # 故用单一默认卷承载。
  defp find_or_create_volume(repo, work_id) do
    Volume
    |> where([v], v.work_id == ^work_id)
    |> order_by([v], asc: v.seq)
    |> limit(1)
    |> repo.one()
    |> case do
      nil ->
        insert_volume(repo, %{
          work_id: work_id,
          title: @default_volume_title,
          seq: next_volume_seq(repo, work_id)
        })

      volume ->
        {:ok, volume}
    end
  end

  # 章节身份按 (work_id, title) 跨卷匹配，与覆盖检测 has_accepted_chapter?/2 一致：
  # 旧代码每次采纳建新「已采纳内容」卷，遗留同名章会散落在多卷，按 title 跨卷查能复用并
  # 就地覆盖，不再堆出重复章（A3）。新章才落到当前规范卷。
  defp find_or_create_chapter(repo, work_id, volume_id, title) do
    Chapter
    |> where([c], c.work_id == ^work_id and c.title == ^title)
    |> order_by([c], asc: c.seq)
    |> limit(1)
    |> repo.one()
    |> case do
      nil ->
        insert_chapter(repo, %{
          work_id: work_id,
          volume_id: volume_id,
          title: title,
          seq: next_chapter_seq(repo, volume_id)
        })

      chapter ->
        {:ok, chapter}
    end
  end

  # 场景身份按 (work_id, chapter_id, title) 匹配：同章同 title 复用同场景并就地覆盖；
  # 多场景章不会误 supersede 别的场景（A6）。单场景模型下与原行为一致。
  defp find_or_create_scene(repo, work_id, chapter_id, title) do
    Scene
    |> where([s], s.work_id == ^work_id and s.chapter_id == ^chapter_id and s.title == ^title)
    |> order_by([s], asc: s.seq)
    |> limit(1)
    |> repo.one()
    |> case do
      nil -> insert_scene(repo, %{work_id: work_id, chapter_id: chapter_id, title: title, seq: 1})
      scene -> {:ok, scene}
    end
  end

  defp supersede_accepted_drafts(repo, work_id, scene_id) do
    accepted_statuses = [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]

    Draft
    |> where(
      [d],
      d.work_id == ^work_id and d.scene_id == ^scene_id and d.status in ^accepted_statuses
    )
    |> repo.update_all(set: [status: AdoptionStatus.superseded(), updated_at: DateTime.utc_now()])

    :ok
  end

  defp next_draft_revision(repo, scene_id) do
    (Draft |> where([d], d.scene_id == ^scene_id) |> repo.aggregate(:max, :revision) || 0) + 1
  end

  # 下一个 seq 用 max(seq)+1（非 count+1）：删行后也不会和现存 seq 撞（A5）。
  defp next_chapter_seq(repo, volume_id) do
    (Chapter |> where([c], c.volume_id == ^volume_id) |> repo.aggregate(:max, :seq) || 0) + 1
  end

  defp next_scene_seq(repo, chapter_id) do
    (Scene |> where([s], s.chapter_id == ^chapter_id) |> repo.aggregate(:max, :seq) || 0) + 1
  end

  defp next_volume_seq(repo, work_id) do
    (Volume |> where([v], v.work_id == ^work_id) |> repo.aggregate(:max, :seq) || 0) + 1
  end

  defp insert_volume(repo, attrs) do
    %Volume{}
    |> Volume.changeset(Map.put_new(attrs, :status, StructureStatus.completed()))
    |> repo.insert()
  end

  defp insert_chapter(repo, attrs) do
    %Chapter{}
    |> Chapter.changeset(Map.put_new(attrs, :status, StructureStatus.completed()))
    |> repo.insert()
  end

  defp insert_scene(repo, attrs) do
    %Scene{}
    |> Scene.changeset(Map.put(attrs, :status, StructureStatus.completed()))
    |> repo.insert()
  end

  defp insert_draft(repo, attrs) do
    %Draft{}
    |> Draft.changeset(Map.put_new(attrs, :revision, 1))
    |> repo.insert()
  end

  defp projection_title(attrs) do
    canonical_chapter_title(Map.get(attrs, :summary))
  end

  # 章节标题归一：trim + 空白回退「已采纳内容」。存储（projection_title）与覆盖查询
  # （has_accepted_chapter?）共用，保证空 summary 采纳也能被检测为覆盖（A4）。
  defp canonical_chapter_title(value) do
    case value |> to_string() |> String.trim() do
      "" -> "已采纳内容"
      title -> title
    end
  end

  defp projection_content(attrs) do
    attrs
    |> Map.get(:content, projection_title(attrs))
    |> to_string()
    |> String.trim()
    |> case do
      "" -> projection_title(attrs)
      content -> content
    end
  end
end
