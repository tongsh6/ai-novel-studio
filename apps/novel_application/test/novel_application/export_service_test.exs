defmodule NovelApplication.ExportServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.ExportService
  alias NovelApplication.WorkService
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  setup do
    pid = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(pid) end)
    :ok
  end

  test "empty work has nothing to export" do
    assert {:error, :nothing_to_export} = ExportService.export(Ecto.UUID.generate())
  end

  test "exports full markdown from accepted work facts with ordered toc and honest placeholders" do
    {:ok, work} = WorkService.create(%{"title" => "导出测试作品"})

    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work.id, title: "第一卷", seq: 1})
      |> Repo.insert!()

    written =
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work.id,
        volume_id: volume.id,
        title: "第01章：底层灵气账单",
        seq: 1
      })
      |> Repo.insert!()

    %Chapter{}
    |> Chapter.changeset(%{
      work_id: work.id,
      volume_id: volume.id,
      title: "第02章：旧服务器里的残诀",
      seq: 2
    })
    |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: written.id, title: "第一场", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work.id,
      scene_id: scene.id,
      content: "夜色压在账单上。",
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    # 未采纳草稿不得进入导出（阅读投影口径，AU08-I2 同源）。
    tentative_scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: written.id, title: "第二场", seq: 2})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work.id,
      scene_id: tentative_scene.id,
      content: "未采纳的内容不能导出",
      status: AdoptionStatus.tentative(),
      revision: 1
    })
    |> Repo.insert!()

    assert {:ok, result} = ExportService.export(work.id)
    assert result.format == "markdown"
    assert result.chapter_count == 2
    assert result.work_title == "导出测试作品"
    assert String.ends_with?(result.path, "导出测试作品.md")

    doc = File.read!(result.path)
    assert doc =~ "# 导出测试作品"
    assert doc =~ "1. 第01章：底层灵气账单"
    assert doc =~ "2. 第02章：旧服务器里的残诀"
    assert doc =~ "夜色压在账单上。"
    assert doc =~ "> （本章暂无已采纳正文）"
    refute doc =~ "未采纳的内容不能导出"

    # 目录与正文顺序一致：第01章先于第02章。
    {p1, _} = :binary.match(doc, "## 第01章：底层灵气账单")
    {p2, _} = :binary.match(doc, "## 第02章：旧服务器里的残诀")
    assert p1 < p2
  end
end
