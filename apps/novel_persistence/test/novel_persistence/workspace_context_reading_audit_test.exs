defmodule NovelPersistence.WorkspaceContextReadingAuditTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}
  alias NovelPersistence.WorkRepo
  alias NovelPersistence.WorkspaceContext

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  describe "context_fetcher_with_query/0 reading audit" do
    test "R05 carries the current reading audit without counting tentative or old revisions" do
      {:ok, work} = WorkRepo.create(%{title: "正文统计作品"})
      {:ok, other} = WorkRepo.create(%{title: "另一作品"})

      volume =
        %Volume{}
        |> Volume.changeset(%{work_id: work.id, title: "第一卷", seq: 1})
        |> Repo.insert!()

      [written, _empty, tentative] =
        for {title, seq} <- [{"已写章", 1}, {"空章", 2}, {"仅候选章", 3}] do
          %Chapter{}
          |> Chapter.changeset(%{work_id: work.id, volume_id: volume.id, title: title, seq: seq})
          |> Repo.insert!()
        end

      first_scene =
        %Scene{}
        |> Scene.changeset(%{work_id: work.id, chapter_id: written.id, title: "第一场", seq: 1})
        |> Repo.insert!()

      for {content, status, revision} <- [
            {"旧版本不会累加", AdoptionStatus.accepted(), 1},
            {"他终于慢慢醒来过来", AdoptionStatus.accepted(), 2},
            {"更高修订的候选也不能计入正文", AdoptionStatus.tentative(), 3}
          ] do
        %Draft{}
        |> Draft.changeset(%{
          work_id: work.id,
          scene_id: first_scene.id,
          content: content,
          status: status,
          revision: revision
        })
        |> Repo.insert!()
      end

      for {chapter, title, content, status, seq} <- [
            {written, "第二场", "世界  安静。", AdoptionStatus.accepted(), 2},
            {tentative, "候选场", "这章尚未采纳的正文不能计数", AdoptionStatus.tentative(), 1}
          ] do
        scene =
          %Scene{}
          |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: title, seq: seq})
          |> Repo.insert!()

        %Draft{}
        |> Draft.changeset(%{
          work_id: work.id,
          scene_id: scene.id,
          content: content,
          status: status,
          revision: 1
        })
        |> Repo.insert!()
      end

      {:ok, _} =
        AdoptionRepository.persist(%{
          actor_ref: "author",
          work_id: other.id,
          source_turn_ref: "r05-other-turn",
          artifact_id: "r05-other-prose",
          artifact_type: :prose_fragment,
          base_revision: 1,
          content: "另一作品的正文不应进入统计。",
          summary: "另一作品章节"
        })

      assert {:ok, context} = WorkspaceContext.context_fetcher_with_query().(work.id, "", nil)
      assert context.source_status.chapters == :ok
      assert length(context.structured_chapters) == 3

      assert %{
               work_id: work_id,
               audit: %{chapter_count: 3, empty_chapter_count: 2, total_word_count: 13}
             } = Map.get(context, :reading_audit)

      assert work_id == work.id
    end

    test "R05 supplies zero only after reading an existing empty work" do
      {:ok, work} = WorkRepo.create(%{title: "实读空作品"})
      assert {:ok, context} = WorkspaceContext.context_fetcher_with_query().(work.id, "", nil)
      assert context.source_status.chapters == :empty

      assert %{
               work_id: work_id,
               audit: %{chapter_count: 0, empty_chapter_count: 0, total_word_count: 0}
             } = Map.get(context, :reading_audit)

      assert work_id == work.id
    end
  end
end
