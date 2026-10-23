defmodule NovelPersistence.Schemas.DraftTest do
  use NovelPersistence.DataCase, async: false

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Draft

  describe "changeset/2" do
    test "inserts a valid tentative draft" do
      {:ok, draft} =
        %Draft{}
        |> Draft.changeset(%{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文内容"
        })
        |> Repo.insert()

      assert draft.status == AdoptionStatus.tentative()
      assert draft.revision >= 1
    end

    test "rejects missing scene_id" do
      changeset = Draft.changeset(%Draft{}, %{work_id: Ecto.UUID.generate(), content: "正文"})
      refute changeset.valid?
      assert Keyword.has_key?(changeset.errors, :scene_id)
    end
  end

  describe "ADR-0019 adoption transition matrix (Q1Cb persistence boundary)" do
    defp insert_tentative_draft do
      {:ok, draft} =
        %Draft{}
        |> Draft.changeset(%{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文"
        })
        |> Repo.insert()

      draft
    end

    test "TENTATIVE → ACCEPTED is allowed (two-step canon entry)" do
      draft = insert_tentative_draft()

      changeset = Draft.changeset(draft, %{status: AdoptionStatus.accepted()})
      assert changeset.valid?
      assert {:ok, accepted} = Repo.update(changeset)
      assert accepted.status == AdoptionStatus.accepted()
    end

    test "rejects DISCARDED → ACCEPTED (INV-1: canon must re-enter via TENTATIVE)" do
      draft = insert_tentative_draft()
      {:ok, discarded} = draft |> Draft.discard_changeset() |> Repo.update()

      changeset = Draft.changeset(discarded, %{status: AdoptionStatus.accepted()})

      refute changeset.valid?
      assert {"illegal adoption transition DISCARDED -> ACCEPTED", _} = changeset.errors[:status]
    end

    test "rejects ARCHIVED → ACCEPTED (must un-archive to TENTATIVE first)" do
      draft = insert_tentative_draft()
      {:ok, discarded} = draft |> Draft.discard_changeset() |> Repo.update()

      {:ok, archived} =
        discarded |> Draft.changeset(%{status: AdoptionStatus.archived()}) |> Repo.update()

      changeset = Draft.changeset(archived, %{status: AdoptionStatus.accepted()})
      refute changeset.valid?
      assert {"illegal adoption transition ARCHIVED -> ACCEPTED", _} = changeset.errors[:status]
    end

    test "rejects ACCEPTED → TENTATIVE (no direct canon rollback)" do
      draft = insert_tentative_draft()
      {:ok, accepted} = draft |> Draft.adopt_changeset() |> Repo.update()

      changeset = Draft.changeset(accepted, %{status: AdoptionStatus.tentative()})
      refute changeset.valid?
      assert {"illegal adoption transition ACCEPTED -> TENTATIVE", _} = changeset.errors[:status]
    end

    test "insert directly as ACCEPTED is the second step of TENTATIVE → canon" do
      # 生产 insert 路径（persist_reading_projection）以 ACCEPTED 落库：new struct
      # 初始态默认 TENTATIVE，等价 TENTATIVE→ACCEPTED（INV-1 允许）。
      {:ok, accepted} =
        %Draft{}
        |> Draft.changeset(%{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文",
          status: AdoptionStatus.accepted()
        })
        |> Repo.insert()

      assert accepted.status == AdoptionStatus.accepted()
    end

    test "insert directly as a terminal status is rejected (initial state is TENTATIVE)" do
      # 初始态 TENTATIVE 不允许直接跳到 ARCHIVED（矩阵：TENTATIVE 只能到
      # ACCEPTED/EDITED_ACCEPTED/DISCARDED/INVALIDATED），insert 同样受矩阵约束。
      changeset =
        Draft.changeset(%Draft{}, %{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文",
          status: AdoptionStatus.archived()
        })

      refute changeset.valid?
      assert {"illegal adoption transition TENTATIVE -> ARCHIVED", _} = changeset.errors[:status]
    end

    test "allows ACCEPTED → SUPERSEDED (overwrite takeover) and self no-op" do
      draft = insert_tentative_draft()
      {:ok, accepted} = draft |> Draft.adopt_changeset() |> Repo.update()

      assert {:ok, superseded} = accepted |> Draft.supersede_changeset() |> Repo.update()
      assert superseded.status == AdoptionStatus.superseded()

      self_changeset = Draft.changeset(superseded, %{status: AdoptionStatus.superseded()})
      assert self_changeset.valid?
    end
  end

  describe "adopt_changeset/1" do
    test "transitions tentative → accepted and bumps revision on update" do
      {:ok, draft} =
        %Draft{}
        |> Draft.changeset(%{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文"
        })
        |> Repo.insert()

      assert {:ok, adopted} =
               draft
               |> Draft.adopt_changeset()
               |> Repo.update()

      assert adopted.status == AdoptionStatus.accepted()
      assert adopted.revision == draft.revision + 1
    end
  end

  describe "discard_changeset/1" do
    test "transitions tentative → discarded" do
      {:ok, draft} =
        %Draft{}
        |> Draft.changeset(%{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文"
        })
        |> Repo.insert()

      assert {:ok, discarded} =
               draft
               |> Draft.discard_changeset()
               |> Repo.update()

      assert discarded.status == AdoptionStatus.discarded()
    end
  end

  describe "optimistic_lock on revision" do
    test "concurrent adopt raises StaleEntryError" do
      {:ok, draft} =
        %Draft{}
        |> Draft.changeset(%{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文"
        })
        |> Repo.insert()

      stale_revision = draft.revision
      Repo.update_all(Draft, set: [revision: stale_revision + 1])

      assert_raise Ecto.StaleEntryError, fn ->
        draft |> Draft.adopt_changeset() |> Repo.update()
      end
    end
  end
end
