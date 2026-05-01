defmodule NovelApplication.ReadingService do
  @moduledoc """
  阅读投影服务——从 persistence 层查询已采纳的领域对象，组装阅读视图数据。

  只返回 accepted 状态的 artifact，tentative/discarded 不进入阅读模式。
  """

  import Ecto.Query, only: [from: 2]

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  @doc """
  返回作品的目录树：volumes → chapters（仅非 DISCARDED/ARCHIVED）。
  """
  @spec build_toc(String.t()) :: %{volumes: [map()]}
  def build_toc(work_id) when is_binary(work_id) do
    volumes =
      from(v in Volume,
        where: v.work_id == ^work_id and v.status != "ARCHIVED",
        order_by: [asc: v.seq]
      )
      |> Repo.all()

    vol_list =
      Enum.map(volumes, fn vol ->
        chapters =
          from(c in Chapter,
            where: c.work_id == ^work_id and c.volume_id == ^vol.id and c.status != "ARCHIVED",
            order_by: [asc: c.seq]
          )
          |> Repo.all()
          |> Enum.map(fn ch ->
            %{id: ch.id, title: ch.title, seq: ch.seq}
          end)

        %{id: vol.id, title: vol.title, seq: vol.seq, chapters: chapters}
      end)

    %{volumes: vol_list}
  end

  @doc """
  返回一个章节的阅读内容：scenes → accepted drafts。
  """
  @spec build_chapter_content(String.t()) :: %{
          title: String.t(),
          scenes: [%{title: String.t(), content: String.t()}]
        }
  def build_chapter_content(chapter_id) when is_binary(chapter_id) do
    chapter = Repo.get!(Chapter, chapter_id)

    scenes =
      from(s in Scene,
        where: s.chapter_id == ^chapter_id,
        order_by: [asc: s.seq]
      )
      |> Repo.all()

    scene_list =
      Enum.map(scenes, fn scene ->
        drafts =
          from(d in Draft,
            where: d.scene_id == ^scene.id and d.status == "ACCEPTED",
            order_by: [asc: d.inserted_at]
          )
          |> Repo.all()

        content = Enum.map_join(drafts, "\n\n---\n\n", & &1.content)

        %{title: scene.title, content: content}
      end)

    %{title: chapter.title, scenes: scene_list}
  end

  @doc "返回作品的已采纳角色列表。"
  @spec build_characters(String.t()) :: [map()]
  def build_characters(work_id) when is_binary(work_id) do
    from(c in Character,
      where: c.work_id == ^work_id and c.status == "ACCEPTED",
      order_by: [asc: c.inserted_at]
    )
    |> Repo.all()
    |> Enum.map(fn c ->
      %{id: c.id, name: c.name, aliases: c.aliases, role: c.role, summary: c.summary}
    end)
  end

  @plot_types ["PLOT_FACT", "FORESHADOWING", "WORLD_RULE"]

  @doc "返回作品的伏笔/剧情事实列表。"
  @spec build_foreshadowing(String.t()) :: [map()]
  def build_foreshadowing(work_id) when is_binary(work_id) do
    from(m in MemoryItem,
      where: m.work_id == ^work_id and m.type in @plot_types,
      order_by: [desc: m.weight, desc: m.inserted_at]
    )
    |> Repo.all()
    |> Enum.map(fn m ->
      %{id: m.id, content: m.content, type: m.type, tags: m.tags, weight: m.weight}
    end)
  end

  @rule_types ["STYLE_RULE", "WORLD_RULE", "CONSTRAINT", "AUTHOR_PREFERENCE"]

  @doc "返回作品的经验规则列表。"
  @spec build_rules(String.t()) :: [map()]
  def build_rules(work_id) when is_binary(work_id) do
    from(m in MemoryItem,
      where: m.work_id == ^work_id and m.type in @rule_types,
      order_by: [desc: m.weight, desc: m.inserted_at]
    )
    |> Repo.all()
    |> Enum.map(fn m ->
      %{id: m.id, content: m.content, type: m.type, tags: m.tags, weight: m.weight}
    end)
  end
end
