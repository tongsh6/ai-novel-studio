defmodule NovelApplication.ChapterSummaryAdoptionHookTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AdoptionWorkflow

  # 正文采纳成功后，应以正确的章锚点与正文触发章摘要 maintainer（VS-00C CP2.1）。
  test "正文采纳成功后用正确锚点与正文触发 maintainer" do
    test_pid = self()

    writer = fn _attrs ->
      {:ok,
       %{
         mutation_id: "m1",
         mutation_status: "APPLIED",
         memory_item_id: "mem1",
         memory_status: "CONFIRMED",
         source_revision_ref: "mutation:m1",
         reading_projection: %{
           chapter_id: "chapter-1",
           draft_id: "draft-1",
           source_revision_ref: "draft:draft-1:1"
         }
       }}
    end

    maintainer = fn input ->
      send(test_pid, {:maintain, input})
      :ok
    end

    assert {:ok, _action_result, _turn_result} =
             AdoptionWorkflow.handle_adopt(
               prose_source_turn(),
               %{"artifact_id" => "as-1", "work_id" => "work-1"},
               writer,
               nil,
               maintainer
             )

    assert_received {:maintain, input}
    assert input.work_id == "work-1"
    assert input.chapter_id == "chapter-1"
    assert input.prose_text == "巷口的灯在雨里晃。"
    assert input.revision_base == "draft:draft-1:1"
  end

  test "非正文 artifact（character_seed）不触发 maintainer" do
    test_pid = self()

    writer = fn _attrs ->
      {:ok,
       %{
         mutation_id: "m1",
         mutation_status: "APPLIED",
         memory_item_id: "mem1",
         memory_status: "CONFIRMED",
         source_revision_ref: "mutation:m1",
         reading_projection: nil
       }}
    end

    maintainer = fn input ->
      send(test_pid, {:maintain, input})
      :ok
    end

    assert {:ok, _action_result, _turn_result} =
             AdoptionWorkflow.handle_adopt(
               character_source_turn(),
               %{"artifact_id" => "as-1", "work_id" => "work-1"},
               writer,
               nil,
               maintainer
             )

    refute_received {:maintain, _}
  end

  defp prose_source_turn do
    source_turn(:prose_fragment, %{title: "第一章", content: "巷口的灯在雨里晃。"})
  end

  defp character_source_turn do
    source_turn(:character_seed, %{title: "角色", content: "角色设定"})
  end

  defp source_turn(artifact_type, payload) do
    %{
      turn_id: "turn-source",
      adoption_state: %{
        pending: [
          %{
            artifact_id: "as-1",
            artifact_type: artifact_type,
            adoption_status: :tentative,
            requires_adoption: true,
            source_tool_result_ref: "tr-1",
            payload: payload
          }
        ],
        resolved: []
      },
      trace_summary: %{trace_ref: "trace-source"}
    }
  end
end
