defmodule NovelApplication.B30OutlineRefWiringTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AdoptionWorkflow

  test "outline artifact payload item.chapter_ref 按章顺序透传为 attrs.chapter_refs" do
    parent = self()
    ref = "chapter:11111111-1111-4111-8111-111111111111"

    source_turn = %{
      turn_id: "turn-b30-outline",
      work_id: "work-1",
      adoption_state: %{
        pending: [
          %{
            artifact_id: "as-b30-outline",
            artifact_type: :outline_draft,
            adoption_status: "TENTATIVE",
            requires_adoption: true,
            payload: %{
              items: [
                %{item_id: "i1", title: "第11章：旧名", body: "章功能定位：推进章", chapter_ref: ref},
                %{item_id: "i2", title: "第12章：新章", body: "章功能定位：铺垫章"}
              ]
            }
          }
        ],
        resolved: []
      },
      trace_summary: %{trace_ref: "trace-b30"}
    }

    writer = fn attrs ->
      send(parent, {:outline_attrs, attrs})
      {:ok, %{mutation_id: "m-1", mutation_status: "APPLIED", reading_projection: nil}}
    end

    assert {:ok, action_result, _turn_result} =
             AdoptionWorkflow.handle_adopt(
               source_turn,
               %{"artifact_id" => "as-b30-outline", "work_id" => "work-1"},
               writer
             )

    assert_received {:outline_attrs, attrs}
    assert attrs[:chapter_refs] == [ref, nil]
    assert action_result.status == "accepted"
  end
end
