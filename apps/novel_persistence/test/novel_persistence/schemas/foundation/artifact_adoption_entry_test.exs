defmodule NovelPersistence.Schemas.Foundation.ArtifactAdoptionEntryTest do
  use ExUnit.Case, async: true

  alias NovelPersistence.Schemas.Foundation.ArtifactAdoptionEntry

  @base %{
    artifact_id: "art_1",
    artifact_type: "draft",
    requires_adoption: true
  }

  defp changeset(struct, status) do
    ArtifactAdoptionEntry.changeset(struct, Map.put(@base, :adoption_status, status))
  end

  describe "新建（无 from 态）不校验转换" do
    test "可直接落任意合法取值" do
      assert changeset(%ArtifactAdoptionEntry{}, "ACCEPTED").valid?
      assert changeset(%ArtifactAdoptionEntry{}, "TENTATIVE").valid?
    end
  end

  describe "ADR-0019：已有 from 态时校验转换" do
    test "合法转换通过（ACCEPTED → SUPERSEDED）" do
      from = %ArtifactAdoptionEntry{adoption_status: :ACCEPTED}
      assert changeset(from, "SUPERSEDED").valid?
    end

    test "合法复活通过（SUPERSEDED → TENTATIVE）" do
      from = %ArtifactAdoptionEntry{adoption_status: :SUPERSEDED}
      assert changeset(from, "TENTATIVE").valid?
    end

    test "非法转换被拒（SUPERSEDED → ACCEPTED，复活须经 TENTATIVE）" do
      from = %ArtifactAdoptionEntry{adoption_status: :SUPERSEDED}
      cs = changeset(from, "ACCEPTED")
      refute cs.valid?
      assert {"illegal adoption transition SUPERSEDED -> ACCEPTED", _} = cs.errors[:adoption_status]
    end

    test "非法转换被拒（TENTATIVE → ARCHIVED）" do
      from = %ArtifactAdoptionEntry{adoption_status: :TENTATIVE}
      refute changeset(from, "ARCHIVED").valid?
    end

    test "自反转换合法（ACCEPTED → ACCEPTED no-op）" do
      from = %ArtifactAdoptionEntry{adoption_status: :ACCEPTED}
      assert changeset(from, "ACCEPTED").valid?
    end
  end
end
