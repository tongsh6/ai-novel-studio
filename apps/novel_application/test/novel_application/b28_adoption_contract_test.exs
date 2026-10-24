defmodule NovelApplication.B28AdoptionContractTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AdoptionWorkflow
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  defp artifact(attrs) do
    Map.merge(
      %{
        artifact_id: "as-b28-#{System.unique_integer([:positive])}",
        artifact_type: "prose_fragment",
        summary: "第01章：开端",
        payload: %{"modification_scope" => "whole_chapter"}
      },
      attrs
    )
  end

  test "replace_scope 缺 target_chapter_ref → target_missing（不回退 title/新建章）" do
    art = artifact(%{payload: %{adoption_effect: %{mode: "replace_scope"}}})

    assert {:error, :target_missing} = AdoptionWorkflow.validate_b28_contract(art)
  end

  test "new_chapter 显式 effect 允许无 ref；format_only 归一化等价通过、差异拒绝、无源拒绝" do
    new_chapter = artifact(%{payload: %{adoption_effect: %{mode: "new_chapter"}}})
    assert :ok = AdoptionWorkflow.validate_b28_contract(new_chapter)

    base = "第一段。\r\n第二段  \r\n\r\n"
    equal = "第一段。\n第二段\n"

    ok_art =
      artifact(%{
        payload: %{
          "content" => equal,
          "modification_scope" => "format_only",
          "base_text" => base
        }
      })

    assert :ok = AdoptionWorkflow.validate_b28_contract(ok_art)

    bad_art =
      artifact(%{
        payload: %{
          "content" => "第一段。\n第二段改字\n",
          "modification_scope" => "format_only",
          "base_text" => base
        }
      })

    assert {:error, {:format_only_violation, %{offset: _, line: _}}} =
             AdoptionWorkflow.validate_b28_contract(bad_art)

    no_source =
      artifact(%{payload: %{"content" => equal, "modification_scope" => "format_only"}})

    assert {:error, :format_only_source_unavailable} =
             AdoptionWorkflow.validate_b28_contract(no_source)
  end

  test "chapter_revision_context：阅读投影顺序 covered refs/versions/覆盖账；标题歧义拒绝" do
    work_id = Ecto.UUID.generate()
    volume = Repo.insert!(%Volume{work_id: work_id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{work_id: work_id, volume_id: volume.id, title: "第01章：开端", seq: 1})

    s1 = Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 1", seq: 1})
    s2 = Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 2", seq: 2})

    d1 =
      Repo.insert!(%Draft{
        work_id: work_id,
        scene_id: s1.id,
        content: "初稿",
        status: AdoptionStatus.accepted(),
        revision: 2
      })

    d2 =
      Repo.insert!(%Draft{
        work_id: work_id,
        scene_id: s2.id,
        content: "续写",
        status: AdoptionStatus.accepted(),
        revision: 1
      })

    assert {:ok, ctx} =
             AdoptionWorkflow.chapter_revision_context(work_id, "chapter:#{chapter.id}")

    assert ctx.target_chapter_ref == "chapter:#{chapter.id}"
    assert ctx.covered_refs == ["draft:#{d1.id}", "draft:#{d2.id}"]

    assert ctx.expected_base_versions == [
             %{ref: "draft:#{d1.id}", version: 2},
             %{ref: "draft:#{d2.id}", version: 1}
           ]

    assert ctx.coverage == :complete
    assert Enum.all?(ctx.materials, &(&1.kind == :draft and &1.complete? == true))

    # 同标题两章 → 标题寻址歧义拒绝（不再猜）
    _ch2 =
      Repo.insert!(%Chapter{work_id: work_id, volume_id: volume.id, title: "第01章：开端", seq: 2})

    assert {:error, :target_ambiguous} =
             AdoptionWorkflow.chapter_revision_context(work_id, "第01章：开端")
  end
end
