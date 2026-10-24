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
  alias NovelDomain.VolumeBlueprint
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.NarrativeRole
  alias NovelFoundation.Enums.ProvisionalSource
  alias NovelFoundation.Enums.SourceType
  alias NovelFoundation.Enums.StructureStatus
  alias NovelFoundation.Enums.VolumeBlueprintStatus
  alias NovelFoundation.ID
  alias NovelPersistence.ChapterPlanParser
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.LedgerEntry
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

  # dialyzer 误报（call_without_opaque）：Ecto.Multi.new/0 返回的 %Ecto.Multi{} 里
  # MapSet.internal/0 是 opaque，同一函数内立即交给 Multi.insert/4 时 dialyzer 判
  # 「call without expected opaque term」；Ecto.Multi 本身不是 opaque，运行时无问题。
  # 只对本函数关闭 opacity 检查，不放宽全模块/全仓。
  @dialyzer {:no_opaque, [persist: 1]}
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
    |> Multi.run(:revision_supersede, fn repo, %{memory_item: memory_item} ->
      maybe_supersede_revision_target(repo, attrs, memory_item)
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
    |> Multi.run(:information_ledger, fn repo, %{mutation: mutation, memory_item: memory_item} ->
      maybe_update_information_ledger(repo, attrs, mutation, memory_item)
    end)
    |> Repo.transaction()
    |> case do
      {:ok,
       %{
         mutation: mutation,
         memory_item: memory_item,
         revision_supersede: revision_supersede,
         character: character,
         work_planning: work_planning,
         reading_projection: reading_projection
       }} ->
        {:ok,
         build_persist_result(
           mutation,
           memory_item,
           character,
           work_planning,
           reading_projection,
           revision_supersede
         )}

      {:error, _step, reason, _changes} ->
        {:error, reason}
    end
  end

  # 采纳产物按层落地：character_seed → Character 主档案（不写记忆）；
  # work_skeleton_suggestion → works 立项规划字段回写（VS-00G CP4d，不写记忆）；
  # 其它 → confirmed memory。
  defp build_persist_result(
         mutation,
         memory_item,
         character,
         work_planning,
         reading_projection,
         revision_supersede
       ) do
    %{
      mutation_id: mutation.id,
      mutation_status: mutation.status,
      source_revision_ref: "mutation:#{mutation.id}",
      reading_projection: reading_projection
    }
    |> put_memory_item(memory_item)
    |> put_supersede(revision_supersede)
    |> put_character(character)
    |> put_work_planning(work_planning)
  end

  defp put_memory_item(result, nil), do: result

  defp put_memory_item(result, %MemoryItem{} = memory_item) do
    result
    |> Map.put(:memory_item_id, memory_item.id)
    |> Map.put(:memory_status, memory_item.status)
  end

  defp put_supersede(result, nil), do: result

  defp put_supersede(result, %MemoryItem{} = superseded) do
    Map.put(result, :superseded_ref, superseded.id)
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

    if character_dossier_artifact?(artifact_type) or work_skeleton_artifact?(artifact_type) or
         foreshadowing_resolution_artifact?(artifact_type) do
      # foreshadowing_resolution 采纳=账面状态收束，不产新记忆（伏笔本体记忆已在）。
      {:ok, nil}
    else
      %MemoryItem{}
      |> MemoryItem.changeset(memory_item_attrs(attrs, mutation_id))
      |> repo.insert()
    end
  end

  # Q1c：采纳修订候选时，旧版本在同一事务内退场。旧条必须已存在且属于同一作品；
  # 只走 supersede_changeset（允许 locked canon 被一次新采纳决策替代），不改内容。
  defp maybe_supersede_revision_target(_repo, _attrs, nil), do: {:ok, nil}

  defp maybe_supersede_revision_target(repo, attrs, %MemoryItem{} = new_item) do
    case Map.get(attrs, :supersedes_ref) do
      nil ->
        {:ok, nil}

      ref ->
        case repo.get(MemoryItem, ref) do
          nil ->
            {:error, :revision_target_not_found}

          %MemoryItem{} = old_item ->
            supersede_revision_target(repo, new_item, old_item)
        end
    end
  end

  defp supersede_revision_target(repo, new_item, old_item) do
    cond do
      old_item.work_id != new_item.work_id ->
        {:error, :revision_target_cross_work}

      to_string(old_item.status) not in [MemoryStatus.confirmed(), MemoryStatus.stabilized()] ->
        {:error, :revision_target_stale}

      true ->
        old_item
        |> MemoryItem.supersede_changeset(%{
          status: MemoryStatus.superseded(),
          superseded_by_ref: new_item.id
        })
        |> repo.update()
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
  # VS-00G CP5b 同名收束：同名 AI 假定行（tentative+AI_ASSUMPTION）已存在时就地转正
  # （契约 §3.4「就地 accepted」），不插重复行——两条确认路径（提案采纳/暂定设定确认）
  # 收敛到同一行。
  defp maybe_persist_character(repo, attrs, _mutation_id) do
    if character_dossier_artifact?(Map.get(attrs, :artifact_type)) do
      character_attrs = character_attrs(attrs)

      case assumption_character(repo, Map.fetch!(attrs, :work_id), character_attrs.name) do
        %Character{} = assumption ->
          assumption
          |> Character.changeset(Map.put(character_attrs, :provisional_active, false))
          |> repo.update()

        nil ->
          %Character{}
          |> Character.changeset(character_attrs)
          |> repo.insert()
      end
    else
      {:ok, nil}
    end
  end

  defp assumption_character(repo, work_id, name) do
    case Ecto.UUID.cast(to_string(work_id)) do
      {:ok, uuid} ->
        repo.one(
          from(c in Character,
            where:
              c.work_id == ^uuid and c.name == ^name and
                c.status == ^AdoptionStatus.tentative() and
                c.provisional_source == ^ProvisionalSource.ai_assumption(),
            limit: 1
          )
        )

      :error ->
        nil
    end
  end

  # role/aliases（AU12 CP2）：有值才写入——nil 不进 changeset，避免就地转正/更新
  # 路径把既有别名/身份清空。
  defp character_attrs(attrs) do
    %{
      work_id: Map.fetch!(attrs, :work_id),
      name: character_name(attrs),
      summary: character_profile(attrs),
      narrative_role: character_narrative_role(attrs),
      status: AdoptionStatus.accepted()
    }
    |> put_present(:role, Map.get(attrs, :role))
    |> put_present(:aliases, Map.get(attrs, :aliases))
  end

  defp put_present(map, _key, nil), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)

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
      supersedes_ref: Map.get(attrs, :supersedes_ref),
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
    case replace_scope_effect(attrs) do
      nil -> persist_single_projection(repo, attrs, mutation_id)
      effect -> persist_replace_scope(repo, attrs, mutation_id, effect)
    end
  end

  # B28 CP1：replace_scope 多片段采纳——同章范围内旧 accepted drafts 全部 supersede，
  # 新整章稿 accepted；chapter_id/章数/seq 不变；失败由原子 Multi 整体回滚。
  defp persist_replace_scope(repo, attrs, mutation_id, effect) do
    work_id = Map.fetch!(attrs, :work_id)
    content = projection_content(attrs)
    chapter_ref = normalize_chapter_ref(Map.get(attrs, :target_chapter_ref))

    with {:ok, chapter} <- require_scope_chapter(repo, work_id, chapter_ref),
         {:ok, covered} <- covered_scope_drafts(repo, work_id, chapter.id, effect),
         :ok <- validate_expected_versions(repo, chapter.id, effect),
         :ok <- ensure_complete_cover(repo, work_id, chapter.id, covered, effect),
         :ok <- mark_chapter_drafted(repo, chapter),
         :ok <- supersede_covered_scenes(repo, work_id, covered),
         {:ok, draft} <-
           insert_scope_draft(repo, work_id, content, covered) do
      {:ok,
       %{
         volume_id: chapter.volume_id,
         chapter_id: chapter.id,
         scene_id: hd(covered).scene_id,
         draft_id: draft.id,
         source_revision_ref: "draft:#{draft.id}:#{draft.revision}",
         mutation_id: mutation_id,
         adoption_effect: "replace_scope",
         superseded_draft_refs: Enum.map(covered, &"draft:#{&1.id}:#{&1.revision}")
       }}
    end
  end

  defp persist_single_projection(repo, attrs, mutation_id) do
    work_id = Map.fetch!(attrs, :work_id)
    chapter_title = projection_title(attrs)
    content = projection_content(attrs)
    mode = projection_mode(attrs)

    chapter_ref = normalize_chapter_ref(Map.get(attrs, :target_chapter_ref))

    with {:ok, volume} <- find_or_create_volume(repo, work_id),
         {:ok, chapter} <- resolve_chapter(repo, work_id, volume.id, chapter_title, chapter_ref),
         :ok <- mark_chapter_drafted(repo, chapter),
         {:ok, scene} <- resolve_scene(repo, work_id, chapter, chapter_title, mode),
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
  # B21：首次 append（seq=1）落的是「整章正文」，场身份=章，不回填计划第 1 场名——否则
  # 阅读模式把整章正文挂在假的「第 1 场」标题下。占位「场景 1」由阅读端
  # isGeneratedScenePlaceholder 隐藏（D7 后 authoring_intent=nil 走 append，首次采纳必然命中）。
  # 第二次起（seq>=2）沿用 NEM04 刀③：优先用该章计划的场次名；计划没排到这一场时保持
  # 「场景 N」。存量占位行不回填（拍板③）。
  defp resolve_scene(repo, work_id, chapter, chapter_title, :overwrite) do
    find_or_create_scene(repo, work_id, chapter.id, chapter_title)
  end

  defp resolve_scene(repo, work_id, chapter, _chapter_title, :append) do
    seq = next_scene_seq(repo, chapter.id)
    title = append_scene_title(chapter, seq)
    insert_scene(repo, %{work_id: work_id, chapter_id: chapter.id, title: title, seq: seq})
  end

  # 首次 append = 整章正文（章身份=场身份），计划第 1 场是设计态切分，不能拿来命名这行正文。
  defp append_scene_title(_chapter, 1), do: "场景 1"

  defp append_scene_title(chapter, seq) do
    planned_scene_title(chapter, seq) || "场景 #{seq}"
  end

  defp planned_scene_title(chapter, seq) do
    with %{"scene_plans" => plans} when is_list(plans) <- Map.get(chapter, :plan_direction),
         %{"title" => title} when is_binary(title) and title != "" <- Enum.at(plans, seq - 1) do
      title
    else
      _ -> nil
    end
  end

  defp maybe_supersede_scene(repo, work_id, scene_id, :overwrite) do
    supersede_accepted_drafts(repo, work_id, scene_id)
  end

  defp maybe_supersede_scene(_repo, _work_id, _scene_id, :append), do: :ok

  @doc """
  读端口：当前作品是否已有该章（`chapter_ref` 或 title）的已采纳正文。
  采纳边界用它判断是否为覆盖已有 canon（需作者确认）。

  B25（I-CH-1）：章节身份优先 ref；title 只在**唯一命中**时成立。同名多章时保守返回 true
  （视为已有 canon，要求作者确认），绝不 first-match 静默覆盖。
  """
  @spec has_accepted_chapter_identity?(String.t(), String.t()) :: boolean()
  def has_accepted_chapter_identity?(work_id, identity)
      when is_binary(work_id) and is_binary(identity) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} ->
        case chapters_for_identity(uuid, identity) do
          [] -> false
          [chapter] -> chapter_has_accepted_prose?(uuid, chapter.id)
          # 同名多章（旧 title 身份）：无法唯一归属 → 保守视为已有 canon。
          _ambiguous -> true
        end

      :error ->
        false
    end
  end

  def has_accepted_chapter_identity?(_work_id, _identity), do: false

  @doc "旧 title-only 读端口（等价 identity 版；保留给既有调用方/测试）。"
  @spec has_accepted_chapter?(String.t(), String.t()) :: boolean()
  def has_accepted_chapter?(work_id, title), do: has_accepted_chapter_identity?(work_id, title)

  @doc "读端口工厂：注入 AdoptionWorkflow 判断覆盖（ref 或 title 均可）。"
  @spec overwrite_reader() :: (String.t(), String.t() -> boolean())
  def overwrite_reader, do: &has_accepted_chapter_identity?/2

  defp chapter_has_accepted_prose?(work_uuid, chapter_id) do
    accepted = AdoptionStatus.accepted()

    Chapter
    |> join(:inner, [c], s in Scene, on: s.chapter_id == c.id and s.work_id == ^work_uuid)
    |> join(:inner, [_c, s], d in Draft,
      on: d.scene_id == s.id and d.work_id == ^work_uuid and d.status == ^accepted
    )
    |> where([c], c.id == ^chapter_id and c.work_id == ^work_uuid)
    |> Repo.exists?()
  end

  # B25：把 ref/title 解析成章列表（ref 幂等；title 可能多行）。调用方按 0/1/>1 决定语义。
  defp chapters_for_identity(work_uuid, "chapter:" <> _rest = ref) do
    case find_chapter_by_ref(Repo, work_uuid, ref) do
      {:ok, chapter} -> [chapter]
      :not_found -> []
    end
  end

  defp chapters_for_identity(work_uuid, title) do
    chapters_with_title(Repo, work_uuid, canonical_chapter_title(title))
  end

  # 采纳章节计划（outline）→ 物化 accepted 卷/章结构（v3 AU-08：目录来源是已采纳的卷/章结构；
  # AU08-I1 只有已采纳作品事实进投影；SC-AU08-B2 允许章在目录里但还没有已采纳正文）。
  # 章以 status=PLANNED 落地，正文采纳时由 mark_chapter_drafted 翻成 DRAFTING。
  # B11A CP2：卷蓝图行先物化卷（卷身份 (work_id, seq) / 规划物化卷 status=PLANNED），
  # 再逐章物化（章标注的所属卷命中已建蓝图卷则复用）。
  defp maybe_materialize_chapter_structure(repo, attrs) do
    if outline_artifact?(Map.get(attrs, :artifact_type)) do
      materialize_chapter_structure(
        repo,
        Map.fetch!(attrs, :work_id),
        Map.get(attrs, :content),
        Map.get(attrs, :artifact_id)
      )
    else
      {:ok, 0}
    end
  end

  # AU08 CP2：计划章按各自标注的所属卷物化。无标注（单卷书或旧计划）→ 全部落规范卷，
  # 与 CP2 之前逐字节等价。卷按 (work_id, title) 幂等复用，同名不重复建卷。
  defp materialize_chapter_structure(repo, work_id, content, artifact_id) do
    %{chapters: chapters, volume_blueprints: volume_blueprints} =
      ChapterPlanParser.parse_with_volumes(content)

    with {:ok, _volumes} <-
           materialize_volume_blueprints(repo, work_id, volume_blueprints, artifact_id) do
      reduce_planned_chapters(chapters, repo, work_id)
    end
  end

  # 卷蓝图物化（VS-00J §3.1）：采纳=作者对卷纲的定稿授权，逐卷按 (work_id, seq)
  # upsert—不存在则按给定 seq 插入（规划物化 → PLANNED），已存在只在 title/blueprint
  # 变化时更新（改名不新建重复卷；existing 行 status 不动）。
  defp materialize_volume_blueprints(_repo, _work_id, [], _artifact_id), do: {:ok, []}

  defp materialize_volume_blueprints(repo, work_id, volume_blueprints, artifact_id) do
    Enum.reduce_while(volume_blueprints, {:ok, []}, fn blueprint, {:ok, acc} ->
      case upsert_volume_blueprint(repo, work_id, blueprint, artifact_id) do
        {:ok, volume} -> {:cont, {:ok, [volume | acc]}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:ok, volumes} -> {:ok, Enum.reverse(volumes)}
      error -> error
    end
  end

  defp upsert_volume_blueprint(
         repo,
         work_id,
         %{seq: seq, title: title, blueprint: blueprint},
         artifact_id
       ) do
    blueprint = confirmed_blueprint(blueprint, artifact_id)

    Volume
    |> where([v], v.work_id == ^work_id and v.seq == ^seq)
    |> limit(1)
    |> repo.one()
    |> case do
      nil ->
        insert_volume(repo, %{
          work_id: work_id,
          title: title,
          seq: seq,
          status: StructureStatus.planned(),
          blueprint: blueprint
        })

      %Volume{} = existing ->
        changes =
          %{}
          |> maybe_put_changed(:title, existing.title, title)
          |> maybe_put_changed(:blueprint, existing.blueprint, blueprint)

        if changes == %{} do
          {:ok, existing}
        else
          existing |> Volume.changeset(changes) |> repo.update()
        end
    end
  end

  # 采纳即定稿（VS-00J §3.1，不新增确认门）：补三态 CONFIRMED 与来源引用
  # `artifact:<artifact_id>`；无设计槽（只写了卷名/序号）不伪造 provenance 占位蓝图。
  defp confirmed_blueprint(blueprint, artifact_id) do
    normalized = VolumeBlueprint.to_storage(blueprint)

    if VolumeBlueprint.empty?(normalized) do
      nil
    else
      normalized
      |> VolumeBlueprint.put_status(VolumeBlueprintStatus.confirmed())
      |> VolumeBlueprint.merge(source_ref(artifact_id))
    end
  end

  defp source_ref(artifact_id) when is_binary(artifact_id) and artifact_id != "",
    do: %{"source_ref" => "artifact:#{artifact_id}"}

  defp source_ref(_artifact_id), do: nil

  defp maybe_put_changed(changes, _field, same, same), do: changes
  defp maybe_put_changed(changes, field, _existing, value), do: Map.put(changes, field, value)

  defp reduce_planned_chapters(chapters, repo, work_id) do
    Enum.reduce_while(chapters, {:ok, 0}, fn chapter, {:ok, n} ->
      with {:ok, volume} <-
             find_or_create_volume(
               repo,
               work_id,
               chapter[:volume_title],
               StructureStatus.planned()
             ),
           :ok <- ensure_planned_chapter(repo, work_id, volume.id, chapter) do
        {:cont, {:ok, n + 1}}
      else
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

    result =
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
            seq: next_chapter_seq(repo, work_id),
            status: StructureStatus.planned(),
            summary: summary,
            plan_direction: plan_direction
          })

        %Chapter{} = existing_chapter ->
          changes =
            %{}
            |> maybe_put_missing_summary(existing_chapter.summary, summary)
            |> maybe_put_missing_direction(existing_chapter.plan_direction, plan_direction)

          if changes == %{} do
            {:ok, existing_chapter}
          else
            existing_chapter |> Chapter.changeset(changes) |> repo.update()
          end
      end

    with {:ok, chapter_row} <- result,
         :ok <- maybe_seed_plan_info_entry(repo, work_id, chapter_row) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end

  # VS00F 刀④（CP1）：章计划「信息释放」建账——设计承诺入账，身份=设计槽位
  # （subject_ref 派生自章 seq，天然幂等），design_ref 指向章计划。已有条目不动
  # （重物化不得把已推进状态打回 HIDDEN）。planned_reveal_seq = 本章（信息释放
  # 是本章计划的组成部分）。
  defp maybe_seed_plan_info_entry(repo, work_id, %Chapter{} = chapter) do
    fact = plan_information_release(chapter.plan_direction)
    subject_ref = "plan_info_#{chapter.seq}"

    cond do
      is_nil(fact) ->
        :ok

      information_entry_exists?(repo, work_id, subject_ref) ->
        :ok

      true ->
        case seed_information_entry(repo, %{
               work_id: work_id,
               subject_ref: subject_ref,
               subject_label: "第#{chapter.seq}章信息释放",
               design_ref: "chapter_plan:#{chapter.seq}",
               payload: %{"fact" => fact, "planned_reveal_seq" => chapter.seq},
               source_refs: ["chapter_plan:#{chapter.seq}"]
             }) do
          {:ok, _entry} -> :ok
          {:error, reason} -> {:error, reason}
        end
    end
  end

  defp plan_information_release(%{} = plan_direction) do
    blank_to_nil(Map.get(plan_direction, "information_release"))
  end

  defp plan_information_release(_plan_direction), do: nil

  defp maybe_put_missing_summary(changes, existing, summary)
       when existing in [nil, ""] and not is_nil(summary),
       do: Map.put(changes, :summary, summary)

  defp maybe_put_missing_summary(changes, _existing, _summary), do: changes

  # WR01b：只落了本章使命的章，其设计态（E18-E22/场次）仍算缺失——补方向时把作者
  # 裁决过的使命一并带回，不让大纲重物化丢掉它。
  defp maybe_put_missing_direction(changes, existing, plan_direction) do
    if ChapterPlanDirection.design_empty?(existing) and not is_nil(plan_direction) do
      Map.put(
        changes,
        :plan_direction,
        ChapterPlanDirection.carry_mission(plan_direction, existing)
      )
    else
      changes
    end
  end

  # VS00F 刀④：信息账写入分派——伏笔 seed 采纳建账（CP1）；回收提案采纳收账（CP3）。
  defp maybe_update_information_ledger(repo, attrs, mutation, memory_item) do
    artifact_type = Map.get(attrs, :artifact_type)

    cond do
      foreshadowing_artifact?(artifact_type) ->
        maybe_seed_foreshadow_entry(repo, attrs, memory_item)

      foreshadowing_resolution_artifact?(artifact_type) ->
        apply_foreshadowing_resolution(repo, attrs, mutation.id)

      true ->
        {:ok, nil}
    end
  end

  # VS00F 刀④（CP3）：伏笔回收提案采纳=账面 HIDDEN→REVEALED（回收是语义判断，
  # 模型只提议、作者采纳才落账）。目标缺失诚实拒绝；已 REVEALED 幂等成功
  # （重复采纳不炸）；LEAKED 等其它状态不由回收提案改写。
  defp apply_foreshadowing_resolution(repo, attrs, mutation_id) do
    work_id = to_string(Map.fetch!(attrs, :work_id))
    target = to_string(Map.get(attrs, :resolution_target) || "")

    entry =
      if String.starts_with?(target, "foreshadow_") do
        repo.one(
          from(e in LedgerEntry,
            where:
              e.work_id == ^work_id and e.ledger == "information" and e.subject_ref == ^target
          )
        )
      end

    case entry do
      nil ->
        {:error, :resolution_target_not_found}

      %LedgerEntry{status: "REVEALED"} = revealed ->
        {:ok, revealed}

      %LedgerEntry{status: "HIDDEN"} = hidden ->
        refs =
          (hidden.source_refs ++ ["mutation:#{mutation_id}"] ++ resolved_chapter_ref(attrs))
          |> Enum.uniq()

        hidden
        |> LedgerEntry.changeset(%{status: "REVEALED", source_refs: refs})
        |> repo.update()

      %LedgerEntry{} ->
        {:error, :resolution_target_not_resolvable}
    end
  end

  defp resolved_chapter_ref(attrs) do
    case Map.get(attrs, :resolved_at_seq) do
      seq when is_integer(seq) and seq > 0 -> ["chapter_seq:#{seq}"]
      _ -> []
    end
  end

  defp foreshadowing_resolution_artifact?(type)
       when type in [:foreshadowing_resolution, "foreshadowing_resolution"],
       do: true

  defp foreshadowing_resolution_artifact?(_type), do: false

  # VS00F 刀④（CP1）：伏笔 seed 采纳建账——每条伏笔一条 information 条目
  # （subject_ref 派生自 memory id），design_ref 指向伏笔记忆。planted_at_seq =
  # 采纳时最大非计划章 seq（机械口径：伏笔进入档案时书写到了哪）；planned_reveal
  # 来自提案结构化槽（作者/模型没说就没有，机器不发明预期）。
  defp maybe_seed_foreshadow_entry(repo, attrs, %MemoryItem{} = memory_item) do
    if foreshadowing_artifact?(Map.get(attrs, :artifact_type)) do
      work_id = Map.fetch!(attrs, :work_id)
      subject_ref = "foreshadow_#{memory_item.id}"

      if information_entry_exists?(repo, work_id, subject_ref) do
        {:ok, nil}
      else
        payload =
          %{
            "fact" => to_string(Map.get(attrs, :content) || memory_item.content || ""),
            "planted_at_seq" => max_written_chapter_seq(repo, work_id)
          }
          |> put_planned_reveal(Map.get(attrs, :planned_reveal))

        seed_information_entry(repo, %{
          work_id: work_id,
          subject_ref: subject_ref,
          subject_label: foreshadow_label(attrs, memory_item),
          design_ref: "memory_item:#{memory_item.id}",
          payload: payload,
          source_refs: ["memory_item:#{memory_item.id}"]
        })
      end
    else
      {:ok, nil}
    end
  end

  defp maybe_seed_foreshadow_entry(_repo, _attrs, _memory_item), do: {:ok, nil}

  defp foreshadowing_artifact?(type)
       when type in [:foreshadowing_seed, "foreshadowing_seed"],
       do: true

  defp foreshadowing_artifact?(_type), do: false

  defp foreshadow_label(attrs, memory_item) do
    label = blank_to_nil(Map.get(attrs, :summary)) || blank_to_nil(memory_item.summary) || "伏笔"

    if String.starts_with?(label, "伏笔"), do: label, else: "伏笔：#{label}"
  end

  defp put_planned_reveal(payload, %{} = planned_reveal),
    do: Map.put(payload, "planned_reveal", planned_reveal)

  defp put_planned_reveal(payload, _planned_reveal), do: payload

  defp max_written_chapter_seq(repo, work_id) do
    planned = StructureStatus.planned()

    Chapter
    |> where([c], c.work_id == ^work_id and c.status != ^planned)
    |> select([c], max(c.seq))
    |> repo.one()
    |> Kernel.||(0)
  end

  defp information_entry_exists?(repo, work_id, subject_ref) do
    LedgerEntry
    |> where(
      [e],
      e.work_id == ^to_string(work_id) and e.ledger == "information" and
        e.subject_ref == ^subject_ref
    )
    |> repo.exists?()
  end

  # 账面两步仪式（ADR-0019 INV-1 同款：TENTATIVE 先落、系统发起接受到 ACCEPTED，
  # 与 LedgerRepository.upsert 同型，此处在采纳事务内执行）。
  defp seed_information_entry(repo, attrs) do
    base = %{
      work_id: to_string(attrs.work_id),
      ledger: "information",
      subject_kind: "fact",
      subject_ref: attrs.subject_ref,
      subject_label: attrs.subject_label,
      design_ref: attrs.design_ref,
      status: "HIDDEN",
      payload: attrs.payload,
      source_refs: attrs.source_refs,
      adoption_status: AdoptionStatus.tentative()
    }

    with {:ok, tentative} <- %LedgerEntry{} |> LedgerEntry.changeset(base) |> repo.insert() do
      tentative
      |> LedgerEntry.changeset(%{adoption_status: AdoptionStatus.accepted()})
      |> repo.update()
    end
  end

  defp blank_to_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp blank_to_nil(_value), do: nil

  # 正文采纳进某章 → 该章不再是纯计划态。PLANNED → DRAFTING；已 COMPLETED/其它不回退。
  # B28 CP1：当前章按阅读投影顺序的全部 accepted 片段（材料覆盖账/版本基线）。
  # 返回 [%{scene_ref, scene_seq, scene_id, draft_ref, draft_id, revision, content}]。
  def accepted_chapter_scopes(work_id, chapter_identity) do
    with {:ok, work_uuid} <- Ecto.UUID.cast(work_id),
         {:ok, chapter} <- resolve_scope_chapter_by_identity(work_uuid, chapter_identity) do
      scopes =
        Scene
        |> where([s], s.chapter_id == ^chapter.id and s.work_id == ^work_uuid)
        |> order_by([s], asc: s.seq)
        |> Repo.all()
        |> Enum.map(&scene_accepted_scope(work_uuid, &1))
        |> Enum.reject(&is_nil/1)

      {:ok,
       %{
         chapter_id: chapter.id,
         chapter_ref: "chapter:#{chapter.id}",
         chapter_title: chapter.title,
         scopes: scopes
       }}
    end
  end

  defp scene_accepted_scope(work_uuid, scene) do
    accepted = AdoptionStatus.accepted()

    draft =
      Draft
      |> where(
        [d],
        d.work_id == ^work_uuid and d.scene_id == ^scene.id and d.status == ^accepted
      )
      |> order_by([d], desc: d.revision, desc: d.updated_at)
      |> limit(1)
      |> Repo.one()

    case draft do
      %Draft{} = draft ->
        %{
          scene_ref: "scene:#{scene.id}",
          scene_seq: scene.seq,
          scene_id: scene.id,
          draft_ref: "draft:#{draft.id}:#{draft.revision}",
          draft_id: draft.id,
          revision: draft.revision,
          content: draft.content
        }

      nil ->
        nil
    end
  end

  defp resolve_scope_chapter_by_identity(work_uuid, "chapter:" <> _ = ref) do
    find_chapter_by_ref(Repo, work_uuid, ref)
  end

  defp resolve_scope_chapter_by_identity(work_uuid, title) when is_binary(title) do
    case chapters_with_title(Repo, work_uuid, canonical_chapter_title(title)) do
      [chapter] -> {:ok, chapter}
      [] -> {:error, :target_missing}
      _many -> {:error, :target_ambiguous}
    end
  end

  defp resolve_scope_chapter_by_identity(_work_uuid, _identity), do: {:error, :target_missing}

  defp replace_scope_effect(attrs) do
    case Map.get(attrs, :adoption_effect) do
      %{} = effect ->
        if effect_mode(effect) == "replace_scope", do: effect

      "replace_scope" ->
        %{}

      _ ->
        nil
    end
  end

  defp effect_mode(effect) do
    Map.get(effect, "mode") || Map.get(effect, :mode)
  end

  defp require_scope_chapter(_repo, _work_id, nil), do: {:error, :target_missing}

  defp require_scope_chapter(repo, work_id, "chapter:" <> _ = ref) do
    case find_chapter_by_ref(repo, work_id, ref) do
      {:ok, chapter} -> {:ok, chapter}
      _ -> {:error, :target_missing}
    end
  end

  defp require_scope_chapter(_repo, _work_id, _ref), do: {:error, :target_missing}

  defp covered_scope_drafts(repo, work_id, chapter_id, effect) do
    case effect_refs(effect) do
      [] ->
        {:error, :incomplete_scope}

      refs ->
        refs
        |> Enum.reduce_while({:ok, []}, fn ref, {:ok, acc} ->
          collect_covered_draft(repo, work_id, chapter_id, ref, acc)
        end)
        |> uniq_covered_drafts()
    end
  end

  defp collect_covered_draft(repo, work_id, chapter_id, ref, acc) do
    case load_covered_draft(repo, work_id, chapter_id, ref) do
      {:ok, draft} -> {:cont, {:ok, acc ++ [draft]}}
      {:error, reason} -> {:halt, {:error, reason}}
    end
  end

  defp uniq_covered_drafts({:ok, drafts}), do: {:ok, Enum.uniq_by(drafts, & &1.id)}
  defp uniq_covered_drafts(error), do: error

  defp effect_refs(effect) do
    refs =
      Map.get(effect, "covered") || Map.get(effect, :covered) || Map.get(effect, "covered_refs") ||
        Map.get(effect, :covered_refs) || []

    refs
    |> List.wrap()
    |> Enum.map(fn
      %{} = item ->
        Map.get(item, "draft_ref") || Map.get(item, :draft_ref) || Map.get(item, "ref") ||
          Map.get(item, :ref)

      ref when is_binary(ref) ->
        ref

      _ ->
        nil
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp load_covered_draft(repo, work_id, chapter_id, "draft:" <> rest) do
    [uuid, revision] =
      case String.split(rest, ":") do
        [uuid] -> [uuid, nil]
        [uuid, revision] -> [uuid, revision]
        _ -> [nil, nil]
      end

    with {:ok, draft_id} <- Ecto.UUID.cast(uuid),
         %Draft{} = draft <- repo.get(Draft, draft_id),
         true <- draft.work_id == work_id,
         %Scene{} = scene <- repo.get(Scene, draft.scene_id),
         true <- scene.chapter_id == chapter_id,
         true <- draft.status in [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()],
         true <- revision == nil or to_string(draft.revision) == to_string(revision) do
      {:ok, Map.merge(draft, %{scene_id: draft.scene_id})}
    else
      nil -> {:error, :incomplete_scope}
      false -> {:error, :stale_base_version}
      _ -> {:error, :target_missing}
    end
  end

  defp load_covered_draft(_repo, _work_id, _chapter_id, _ref), do: {:error, :target_missing}

  defp validate_expected_versions(repo, chapter_id, effect) do
    expected =
      (Map.get(effect, "expected_base_versions") || Map.get(effect, :expected_base_versions) || [])
      |> List.wrap()

    Enum.reduce_while(expected, :ok, fn item, :ok ->
      ref = Map.get(item, "ref") || Map.get(item, :ref)
      version = Map.get(item, "version") || Map.get(item, :version)

      with "draft:" <> rest <- ref,
           [uuid | _] <- String.split(rest, ":"),
           {:ok, draft_id} <- Ecto.UUID.cast(uuid),
           %Draft{} = draft <- repo.get(Draft, draft_id),
           %Scene{} = scene <- repo.get(Scene, draft.scene_id),
           true <- scene.chapter_id == chapter_id,
           true <- to_string(draft.revision) == to_string(version) do
        {:cont, :ok}
      else
        _ -> {:halt, {:error, :stale_base_version}}
      end
    end)
  end

  defp ensure_complete_cover(repo, work_id, chapter_id, covered, effect) do
    if Map.get(effect, "coverage") in ["complete", :complete] ||
         Map.get(effect, "require_complete", true) do
      all =
        Scene
        |> where([s], s.chapter_id == ^chapter_id and s.work_id == ^work_id)
        |> repo.all()
        |> Enum.flat_map(fn scene ->
          Draft
          |> where(
            [d],
            d.work_id == ^work_id and d.scene_id == ^scene.id and
              d.status in ^[AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]
          )
          |> repo.all()
        end)
        |> Enum.map(& &1.id)
        |> MapSet.new()

      covered_ids = covered |> Enum.map(& &1.id) |> MapSet.new()

      if MapSet.subset?(all, covered_ids), do: :ok, else: {:error, :incomplete_scope}
    else
      :ok
    end
  end

  defp supersede_covered_scenes(repo, work_id, covered) do
    covered
    |> Enum.map(& &1.scene_id)
    |> Enum.uniq()
    |> Enum.reduce_while(:ok, fn scene_id, :ok ->
      case supersede_accepted_drafts(repo, work_id, scene_id) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp insert_scope_draft(repo, _work_id, content, covered) do
    scene_id = hd(covered).scene_id

    insert_draft(repo, %{
      work_id: hd(covered).work_id,
      scene_id: scene_id,
      content: content,
      status: AdoptionStatus.accepted(),
      revision: next_draft_revision(repo, scene_id)
    })
  end

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
  # AU08 CP2 起，计划章可标注所属卷（`所属卷：xxx`）：给了卷标题就按 (work_id, title)
  # 幂等取用/新建，没给就仍落规范卷（单卷书与旧计划逐字节等价）。
  # B11A CP1 卷状态修复（VS-00J §2.3）：**新建**卷的状态由调用方给——规划物化
  # （卷蓝图/章计划）写 PLANNED，正文采纳在无卷信息时自动建的规范单卷保持 COMPLETED
  # （存量/单卷逐字节等价）；已存在的卷不改状态（不把历史事实打回/推高）。
  defp find_or_create_volume(
         repo,
         work_id,
         volume_title \\ nil,
         insert_status \\ StructureStatus.completed()
       )

  defp find_or_create_volume(repo, work_id, volume_title, insert_status)
       when is_binary(volume_title) and volume_title != "" do
    title = String.trim(volume_title)

    Volume
    |> where([v], v.work_id == ^work_id and v.title == ^title)
    |> limit(1)
    |> repo.one()
    |> case do
      nil ->
        insert_volume(repo, %{
          work_id: work_id,
          title: title,
          seq: next_volume_seq(repo, work_id),
          status: insert_status
        })

      volume ->
        {:ok, volume}
    end
  end

  defp find_or_create_volume(repo, work_id, _volume_title, insert_status) do
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
          seq: next_volume_seq(repo, work_id),
          status: insert_status
        })

      volume ->
        {:ok, volume}
    end
  end

  # B25（I-CH-1/I-CH-2）：章节身份解析——ref 优先、title 只允许唯一命中。
  #
  # - ref 存在（`chapter:<uuid>`）：按 id + work scope 精确命中；找不到 → 显式错误，
  #   **不回退 title**（回退会静默写错章）。
  # - 无 ref（旧 artifact / 非模型路径）：按 work 内 title 精确匹配；
  #   0 行 → 机械新建新章（新 ref）；1 行 → 复用；>1 行 → 歧义错误，禁止 first-match。
  defp resolve_chapter(repo, work_id, _volume_id, _title, ref) when is_binary(ref) do
    case find_chapter_by_ref(repo, work_id, ref) do
      {:ok, chapter} -> {:ok, chapter}
      :not_found -> {:error, {:target_chapter_not_found, ref}}
    end
  end

  defp resolve_chapter(repo, work_id, volume_id, title, nil) do
    case chapters_with_title(repo, work_id, title) do
      [] ->
        insert_chapter_with_next_seq(repo, work_id, volume_id, title, 3)

      [chapter] ->
        {:ok, chapter}

      chapters when is_list(chapters) ->
        {:error, {:ambiguous_chapter_title, Enum.map(chapters, & &1.id)}}
    end
  end

  defp chapters_with_title(repo, work_id, title) do
    Chapter
    |> where([c], c.work_id == ^work_id and c.title == ^title)
    |> order_by([c], asc: c.seq)
    |> repo.all()
  end

  # B25 CP3：新章 seq 由 max(seq)+1 机械计算；并发下可能撞唯一索引——重试一次即可
  # （下一次 max 会看到已提交行）。仍冲突 → 结构化错误（诚实失败，不静默换号）。
  defp insert_chapter_with_next_seq(repo, work_id, volume_id, title, attempts) do
    case insert_chapter(repo, %{
           work_id: work_id,
           volume_id: volume_id,
           title: title,
           seq: next_chapter_seq(repo, work_id)
         }) do
      {:ok, chapter} ->
        {:ok, chapter}

      {:error, %Ecto.Changeset{} = changeset} ->
        if attempts > 1 and unique_seq_conflict?(changeset) do
          insert_chapter_with_next_seq(repo, work_id, volume_id, title, attempts - 1)
        else
          {:error, {:chapter_seq_conflict, title}}
        end

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp unique_seq_conflict?(%Ecto.Changeset{errors: errors}) do
    Enum.any?(errors, fn
      {:seq, {_message, opts}} -> Keyword.get(opts, :constraint) == :unique
      _ -> false
    end)
  end

  defp find_chapter_by_ref(repo, work_id, ref) when is_binary(ref) do
    with "chapter:" <> uuid <- ref,
         {:ok, chapter_id} <- Ecto.UUID.cast(uuid),
         %Chapter{} = chapter <-
           Chapter
           |> where([c], c.id == ^chapter_id and c.work_id == ^work_id)
           |> repo.one() do
      {:ok, chapter}
    else
      _ -> :not_found
    end
  end

  # B25：把 artifact 上的 target_chapter_ref 归一为可解析形态；非法/空 → nil（回退 title 唯一语义）。
  defp normalize_chapter_ref(value) when is_binary(value) do
    case String.trim(value) do
      "chapter:" <> uuid = ref ->
        case Ecto.UUID.cast(uuid) do
          {:ok, _} -> ref
          :error -> nil
        end

      _ ->
        nil
    end
  end

  defp normalize_chapter_ref(_), do: nil

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

  # ADR-0019 INV-4（Q1Cb）：supersede 也必须经持久化边界矩阵校验，不再用
  # update_all 绕过 changeset（update_all 不触发 validate_adoption_transition）。
  defp supersede_accepted_drafts(repo, work_id, scene_id) do
    accepted_statuses = [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]

    Draft
    |> where(
      [d],
      d.work_id == ^work_id and d.scene_id == ^scene_id and d.status in ^accepted_statuses
    )
    |> repo.all()
    |> Enum.reduce_while(:ok, fn draft, :ok ->
      case update_with_transition_guard(repo, draft) do
        {:ok, _draft} -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  # 逐行 changeset 更新会触发 optimistic lock；并发下 repo.update 会抛
  # Ecto.StaleEntryError（不是 {:error, changeset}）。持久化边界把并发冲突收敛为
  # 可解释错误（事务回滚），不让异常逃逸成 500。
  defp update_with_transition_guard(repo, draft) do
    draft |> Draft.supersede_changeset() |> repo.update()
  rescue
    error in Ecto.StaleEntryError ->
      {:error, {:adoption_status_update_failed, Exception.message(error)}}
  end

  defp next_draft_revision(repo, scene_id) do
    (Draft |> where([d], d.scene_id == ^scene_id) |> repo.aggregate(:max, :revision) || 0) + 1
  end

  # 下一个 seq 用 max(seq)+1（非 count+1）：删行后也不会和现存 seq 撞（A5）。
  # 章号在 work 内全局单调（AU08 CP1 不变量）：书里的章号本就是全局的（「第12章」而非
  # 「卷二第2章」），且账本 accepted_summaries_by_seq/1、阅读章列表、正文检索三处都跨全书
  # 按 c.seq 排序。此前按 volume_id 取 max，在只有一卷时与全局等价而未暴露；一旦建出第
  # 二卷，卷二首章 seq=1 会与卷一首章撞号，上述三处静默乱序（账本错位、R7 末 N 章窗取错、
  # 检索顺序乱）。卷的次序由 volume.seq 承担，章号不再随卷重启。
  defp next_chapter_seq(repo, work_id) do
    (Chapter |> where([c], c.work_id == ^work_id) |> repo.aggregate(:max, :seq) || 0) + 1
  end

  defp next_scene_seq(repo, chapter_id) do
    (Scene |> where([s], s.chapter_id == ^chapter_id) |> repo.aggregate(:max, :seq) || 0) + 1
  end

  defp next_volume_seq(repo, work_id) do
    (Volume |> where([v], v.work_id == ^work_id) |> repo.aggregate(:max, :seq) || 0) + 1
  end

  # 卷状态不再恒写 COMPLETED（B11A CP1 / VS-00J §2.3）：状态由调用方按路径显式给。
  defp insert_volume(repo, attrs) do
    %Volume{}
    |> Volume.changeset(attrs)
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
