defmodule NovelApplication.B30ChapterStructureContextIntegrationTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.ChapterStructureMaintenance
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Volume, Work}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "读端口 → 第2卷密集重编号 change plan（真实章 ref/seq/version）" do
    work = Repo.insert!(%Work{title: "B30 结构维护"})
    v1 = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1})
    v2 = Repo.insert!(%Volume{work_id: work.id, title: "第二卷", seq: 2})
    c0 = Repo.insert!(%Chapter{work_id: work.id, volume_id: v1.id, title: "第01章：初夜", seq: 1})

    c1 = Repo.insert!(%Chapter{work_id: work.id, volume_id: v2.id, title: "第11章：甲", seq: 3})
    c2 = Repo.insert!(%Chapter{work_id: work.id, volume_id: v2.id, title: "第12章：乙", seq: 4})
    c3 = Repo.insert!(%Chapter{work_id: work.id, volume_id: v2.id, title: "第13章：丙", seq: 5})

    assert {:ok, facts} = ChapterStructureMaintenance.load_context(work.id)
    assert facts.work_id == work.id
    assert length(facts.volumes) == 2
    assert Enum.map(facts.chapters, & &1.seq) == [1, 3, 4, 5]
    assert Enum.all?(facts.chapters, &(&1.version == 0 and is_nil(&1.content_hash)))

    assert {:ok, plan} =
             ChapterStructureMaintenance.change_plan("把第2卷章节编号理顺，内容不要动", facts)

    assert plan.object_count == 3

    assert plan.mapping |> Enum.map(&{&1.chapter_ref, &1.from_seq, &1.to_seq}) == [
             {"chapter:#{c1.id}", 3, 2},
             {"chapter:#{c2.id}", 4, 3},
             {"chapter:#{c3.id}", 5, 4}
           ]

    assert plan.base_versions == [
             %{chapter_ref: "chapter:#{c1.id}", version: 0},
             %{chapter_ref: "chapter:#{c2.id}", version: 0},
             %{chapter_ref: "chapter:#{c3.id}", version: 0}
           ]

    # 只读：change_plan 构建后章 seq/标题/归卷未变化
    chapters =
      Repo.all(from(c in Chapter, where: c.work_id == ^work.id))
      |> Enum.map(&{&1.id, &1.seq, &1.title, &1.volume_id})

    assert Enum.sort(chapters) ==
             Enum.sort([
               {c0.id, 1, "第01章：初夜", v1.id},
               {c1.id, 3, "第11章：甲", v2.id},
               {c2.id, 4, "第12章：乙", v2.id},
               {c3.id, 5, "第13章：丙", v2.id}
             ])
  end

  test "越界卷 ref 从读端口返回 out_of_range（不猜/不新建）" do
    work = Repo.insert!(%Work{title: "B30 边界"})

    assert {:error, :out_of_range} =
             ChapterStructureMaintenance.load_context(work.id, "volume:#{Ecto.UUID.generate()}")
  end
end
