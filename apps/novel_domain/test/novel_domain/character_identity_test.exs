defmodule NovelDomain.CharacterIdentityTest do
  @moduledoc """
  AU12 角色身份归并纯计算：称呼集合吸收、主名归属、弧光账归一指令。
  """
  use ExUnit.Case, async: true

  alias NovelDomain.CharacterIdentity

  defp character(overrides \\ %{}) do
    Map.merge(
      %{
        id: "target-id",
        work_id: "work-1",
        name: "沈洛",
        aliases: [],
        status: "ACCEPTED"
      },
      overrides
    )
  end

  describe "merge_plan/3" do
    test "别名情形：source 主名与别名全部并入 target 别名集合，去重且不含主名" do
      target = character(%{aliases: ["洛公子"]})

      source =
        character(%{id: "source-id", name: "洛公子", aliases: ["沈公子", "沈洛", "  "]})

      assert {:ok, plan} = CharacterIdentity.merge_plan(target, source, "target")
      assert plan.name == "沈洛"
      assert plan.aliases == ["洛公子", "沈公子"]
    end

    test "改名情形：keep_name=source 换主名，旧主名转为别名" do
      target = character(%{name: "沈洛"})
      source = character(%{id: "source-id", name: "沈砚"})

      assert {:ok, plan} = CharacterIdentity.merge_plan(target, source, "source")
      assert plan.name == "沈砚"
      assert plan.aliases == ["沈洛"]
    end

    test "同名重复登记归一：同名不产生自指别名" do
      target = character()
      source = character(%{id: "source-id"})

      assert {:ok, plan} = CharacterIdentity.merge_plan(target, source, "target")
      assert plan.name == "沈洛"
      assert plan.aliases == []
    end

    test "自并/跨作品/非采纳态/非法 keep_name 全部拒绝" do
      target = character()

      assert {:error, :cannot_merge_self} =
               CharacterIdentity.merge_plan(target, character(), "target")

      assert {:error, :cross_work_merge_forbidden} =
               CharacterIdentity.merge_plan(
                 target,
                 character(%{id: "source-id", work_id: "work-2"}),
                 "target"
               )

      assert {:error, :source_not_mergeable} =
               CharacterIdentity.merge_plan(
                 target,
                 character(%{id: "source-id", status: "TENTATIVE"}),
                 "target"
               )

      assert {:error, :target_not_mergeable} =
               CharacterIdentity.merge_plan(
                 character(%{status: "SUPERSEDED"}),
                 character(%{id: "source-id"}),
                 "target"
               )

      assert {:error, :invalid_keep_name} =
               CharacterIdentity.merge_plan(
                 target,
                 character(%{id: "source-id"}),
                 "both"
               )
    end
  end

  describe "absorb_arc_plan/3" do
    @merged %{id: "target-id", name: "沈砚"}

    test "双方无条目 → noop；仅 target 且标签已一致 → noop" do
      assert CharacterIdentity.absorb_arc_plan(nil, nil, @merged) == :noop

      assert CharacterIdentity.absorb_arc_plan(%{subject_label: "沈砚"}, nil, @merged) == :noop
    end

    test "仅 target 且主名已换 → relabel" do
      assert {:relabel, %{subject_label: "沈砚"}} =
               CharacterIdentity.absorb_arc_plan(%{subject_label: "沈洛"}, nil, @merged)
    end

    test "仅 source → 整条改挂 target" do
      assert {:repoint, attrs} =
               CharacterIdentity.absorb_arc_plan(nil, %{subject_label: "沈洛"}, @merged)

      assert attrs.subject_ref == "target-id"
      assert attrs.subject_label == "沈砚"
    end

    test "双方都有 → target 吸收 refs 并集与更新进度，source 条目待删" do
      target_entry = %{
        subject_label: "沈洛",
        status: "ON_TRACK",
        payload: %{"last_seen_seq" => 3},
        last_event_chapter: "ch-3",
        source_refs: ["sum-1", "sum-3"]
      }

      source_entry = %{
        subject_label: "沈洛",
        status: "STALLED",
        payload: %{"last_seen_seq" => 10},
        last_event_chapter: "ch-10",
        source_refs: ["sum-3", "sum-10"]
      }

      assert {:absorb, %{target_attrs: attrs, delete_entry: ^source_entry}} =
               CharacterIdentity.absorb_arc_plan(target_entry, source_entry, @merged)

      assert attrs.subject_label == "沈砚"
      assert attrs.status == "STALLED"
      assert attrs.payload == %{"last_seen_seq" => 10}
      assert attrs.last_event_chapter == "ch-10"
      assert attrs.source_refs == ["sum-1", "sum-3", "sum-10"]
    end

    test "source 进度更旧时保留 target 的 payload 与状态" do
      target_entry = %{
        subject_label: "沈砚",
        status: "ON_TRACK",
        payload: %{"last_seen_seq" => 12},
        last_event_chapter: "ch-12",
        source_refs: ["sum-12"]
      }

      source_entry = %{
        subject_label: "沈洛",
        status: "STALLED",
        payload: %{"last_seen_seq" => 2},
        last_event_chapter: "ch-2",
        source_refs: ["sum-2"]
      }

      assert {:absorb, %{target_attrs: attrs}} =
               CharacterIdentity.absorb_arc_plan(target_entry, source_entry, @merged)

      assert attrs.status == "ON_TRACK"
      assert attrs.payload == %{"last_seen_seq" => 12}
      assert attrs.source_refs == ["sum-12", "sum-2"]
    end
  end
end
