defmodule NovelApplication.SessionAdoptionsReadTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{ExplorationService, WorkService}
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "会话候选查询覆盖被摘要省略的对象，分页稳定且拒绝跨作品/会话", do: verify_adoption_exploration()

  defp verify_adoption_exploration do
    {:ok, work} = WorkService.create(%{title: "完整待办"})
    {:ok, session} = NovelPersistence.WorkSessionRepo.ensure_active_for_work(work.id)

    for n <- 1..15 do
      entry = %{
        artifact_id: "item-#{n}",
        artifact_type: "world_setting",
        adoption_status: "TENTATIVE",
        payload: %{items: [%{title: "第#{n}份资料", body: "原文-#{n}"}]}
      }

      {:ok, _} =
        NovelPersistence.MemoryLog.record(%{
          workspace_id: work.id,
          session_id: session.id,
          role: "assistant",
          turn_id: "source-#{n}",
          content: %{
            text: "待采纳",
            turn_result: %{
              turn_id: "source-#{n}",
              adoption_state: %{pending: [entry], resolved: []}
            }
          }
        })
    end

    for n <- 1..85 do
      {:ok, _} =
        NovelPersistence.MemoryLog.record(%{
          workspace_id: work.id,
          session_id: session.id,
          role: "user",
          turn_id: "later-#{n}",
          content: %{text: "闲聊"}
        })
    end

    state = NovelPersistence.InteractionLifecycle.context(work.id, session.id)

    facts = NovelApplication.TurnInteractionService.context_payload(state)

    assert facts.pending_adoption_count == 15
    assert facts.omitted_adoptions == 3
    assert length(facts.pending_adoptions) == 12
    assert {:ok, first} = ExplorationService.run(work.id, "session_adoptions", "", session.id)
    assert %{"matched_count" => 15, "next_offset" => 3} = Jason.decode!(first.summary)

    refs =
      for offset <- [0, 3, 6, 9, 12], reduce: [] do
        acc ->
          {:ok, page} =
            ExplorationService.run(
              work.id,
              "session_adoptions",
              Jason.encode!(%{query: "", offset: offset}),
              session.id
            )

          acc ++ page.refs
      end

    assert length(Enum.uniq(refs)) == 15

    assert {:ok, found} =
             ExplorationService.run(work.id, "session_adoptions", "第1份资料", session.id)

    assert found.refs == ["item-1"]
    refute found.summary =~ "原文-1"
    assert first.next_offset == 3

    assert first.coverage == %{
             kind: "directory",
             work_id: work.id,
             session_id: session.id,
             query: "",
             offset: 0,
             returned_items: 3,
             total_items: 15,
             offset_unit: "item"
           }

    assert first.versions == %{}
    assert first.omissions != []

    assert {:ok, by_ref} =
             ExplorationService.run(work.id, "session_adoptions", "item-1", session.id)

    assert by_ref.refs == ["item-1"]
    {:ok, other} = WorkService.create(%{title: "其它作品"})

    assert {:error, :active_session_not_found} =
             ExplorationService.run(other.id, "session_adoptions", "", session.id)

    assert {:error, :active_session_not_found} =
             ExplorationService.run(work.id, "session_adoptions", "", nil)

    assert {:error, :invalid_adoption_query} =
             ExplorationService.run(
               work.id,
               "session_adoptions",
               ~s({"query":"","offset":-1}),
               session.id
             )

    {:ok, _} = NovelPersistence.WorkSessionRepo.create_active(%{work_id: work.id})

    assert {:error, :active_session_not_found} =
             ExplorationService.run(work.id, "session_adoptions", "", session.id)
  end

  @tag :r05_exploration
  test "候选正文逐页保持原字节和来源，目录不能冒充全文或改变采纳状态" do
    {:ok, work} = WorkService.create(%{title: "候选全文"})
    {:ok, session} = NovelPersistence.WorkSessionRepo.ensure_active_for_work(work.id)
    body = "\r\n" <> String.duplicate("雨👩🏽‍🚀é", 2_300) <> "候选最后一页独有句"
    artifact_ref = "candidate-full-text"

    entry = %{
      artifact_id: artifact_ref,
      artifact_type: "world_setting",
      adoption_status: "TENTATIVE",
      source_tool_result_ref: "tool-result:original-candidate",
      payload: %{items: [%{title: "只读比较材料", body: body}]}
    }

    record_candidate(work.id, session.id, "candidate-source-turn", entry)
    before_state = NovelPersistence.WorkSessionRepo.adoption_state(work.id, session.id)

    assert {:ok, directory} = ExplorationService.run(work.id, "session_adoptions", "", session.id)
    refute directory.summary =~ String.slice(body, 0, 20)
    refute directory.summary =~ "body_preview"
    assert directory.coverage.kind == "directory"

    pages =
      for offset <- [0, 6_000] do
        assert {:ok, page} =
                 ExplorationService.run(
                   work.id,
                   "session_adoptions",
                   Jason.encode!(%{artifact_ref: artifact_ref, offset: offset}),
                   session.id
                 )

        assert page.refs == [artifact_ref]
        assert page.versions == %{}
        assert page.coverage.artifact_ref == artifact_ref
        assert page.coverage.work_id == work.id
        assert page.coverage.session_id == session.id
        assert page.coverage.summary.offset == offset
        assert page.coverage.summary.total_graphemes == String.length(body)
        assert page.coverage.summary.offset_unit == "unicode_grapheme"
        assert page.facts.artifact.status == "TENTATIVE"
        assert page.facts.artifact.source_turn_ref == "candidate-source-turn"
        assert page.facts.artifact.content_source_ref == "tool-result:original-candidate"
        page
      end

    assert Enum.map_join(pages, & &1.summary) == body
    assert hd(pages).next_offset == 6_000
    assert List.last(pages).next_offset == nil
    assert Enum.all?(pages, &(&1.outcome == :partial))
    assert ExplorationService.observation_metadata(hd(pages)).coverage == hd(pages).coverage
    assert NovelPersistence.WorkSessionRepo.adoption_state(work.id, session.id) == before_state

    assert {:error, :adoption_offset_out_of_range} =
             ExplorationService.run(
               work.id,
               "session_adoptions",
               Jason.encode!(%{artifact_ref: artifact_ref, offset: String.length(body) + 1}),
               session.id
             )

    {:ok, other_session} = NovelPersistence.WorkSessionRepo.create_active(%{work_id: work.id})

    assert {:error, :adoption_not_found} =
             ExplorationService.run(
               work.id,
               "session_adoptions",
               Jason.encode!(%{artifact_ref: artifact_ref, offset: 0}),
               other_session.id
             )
  end

  @tag :r05_exploration
  test "候选已处置内容保持真实状态，陌生坐标和混合查询不能取得正文" do
    {:ok, work} = WorkService.create(%{title: "候选状态"})
    {:ok, session} = NovelPersistence.WorkSessionRepo.ensure_active_for_work(work.id)

    entry = %{
      artifact_id: "accepted-candidate",
      artifact_type: "world_setting",
      adoption_status: "ACCEPTED",
      payload: %{content: "已处置候选的原内容"}
    }

    record_candidate(work.id, session.id, "resolved-turn", entry, :resolved)

    assert {:ok, page} =
             ExplorationService.run(
               work.id,
               "session_adoptions",
               ~s({"artifact_ref":"accepted-candidate","offset":0}),
               session.id
             )

    assert page.summary == "已处置候选的原内容"
    assert page.facts.artifact.status == "ACCEPTED"
    assert page.coverage.kind == "detail"
    assert page.next_offset == nil

    for query <- [
          ~s({"artifact_ref":"accepted-candidate","query":"","offset":0}),
          ~s({"artifact_ref":"accepted-candidate","offset":0,"session_id":"elsewhere"}),
          ~s({"artifact_ref":"accepted-candidate","offset":-1}),
          ~s({"query":"","offset":0,"work_id":"elsewhere"})
        ] do
      assert {:error, :invalid_adoption_query} =
               ExplorationService.run(work.id, "session_adoptions", query, session.id)
    end

    assert {:error, :adoption_not_found} =
             ExplorationService.run(
               work.id,
               "session_adoptions",
               ~s({"artifact_ref":"not-in-this-session","offset":0}),
               session.id
             )

    assert {:error, :adoption_offset_out_of_range} =
             ExplorationService.run(
               work.id,
               "session_adoptions",
               ~s({"query":"","offset":2}),
               session.id
             )
  end

  @tag :r05_exploration
  test "候选目录与详情只承认各自同源精确下一页" do
    directory = %{tool: "session_adoptions", kind: "directory", query: "雨夜", next_offset: 3}

    detail = %{
      tool: "session_adoptions",
      kind: "detail",
      artifact_ref: "candidate-a",
      next_offset: 6_000
    }

    assert ExplorationService.continuation_request?(
             "session_adoptions",
             ~s({"query":"雨夜","offset":3}),
             directory
           )

    assert ExplorationService.continuation_request?(
             "session_adoptions",
             ~s({"artifact_ref":"candidate-a","offset":6000}),
             detail
           )

    for query <- [
          ~s({"query":"另一组","offset":3}),
          ~s({"query":"雨夜","offset":6}),
          ~s({"artifact_ref":"candidate-a","offset":3})
        ] do
      refute ExplorationService.continuation_request?("session_adoptions", query, directory)
    end

    for query <- [
          ~s({"artifact_ref":"candidate-b","offset":6000}),
          ~s({"artifact_ref":"candidate-a","offset":6001}),
          ~s({"query":"candidate-a","offset":6000})
        ] do
      refute ExplorationService.continuation_request?("session_adoptions", query, detail)
    end

    refute ExplorationService.continuation_request?(
             "archive_read",
             ~s({"artifact_ref":"candidate-a","offset":6000}),
             detail
           )

    refute ExplorationService.continuation_request?(
             "session_adoptions",
             ~s({"artifact_ref":"candidate-a","offset":6000}),
             %{detail | next_offset: nil}
           )
  end

  defp record_candidate(work_id, session_id, turn_id, entry, state \\ :pending) do
    adoption_state = %{pending: [], resolved: []} |> Map.put(state, [entry])

    {:ok, _} =
      NovelPersistence.MemoryLog.record(%{
        workspace_id: work_id,
        session_id: session_id,
        role: "assistant",
        turn_id: turn_id,
        content: %{
          text: "候选已产生",
          turn_result: %{turn_id: turn_id, adoption_state: adoption_state}
        }
      })
  end
end
