defmodule NovelApplication.JudgmentPagedSourcesTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.WorkService
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.AgentRun
  alias NovelFoundation.Enums.{MemorySourceType, MemoryStatus, MemoryType}
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.WorkSessionRepo
  alias NovelTest.TestProviderPrompt

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @tag :r05_paged_sources
  test "15个会话候选目录通过真实判断循环在两轮之后继续精确下一页" do
    {work, session} = work_session("候选目录续页")

    for n <- 1..15 do
      record_candidate(work.id, session.id, "directory-item-#{n}", "资料#{n}", "目录正文哨兵#{n}")
    end

    before_state = WorkSessionRepo.adoption_state(work.id, session.id)

    execution =
      scripted_execution(fn request ->
        pages = TestProviderPrompt.visible_observations(request)
        exploration = TestProviderPrompt.scope_content(request)["operation"]["exploration"]

        case List.last(pages) do
          nil ->
            {:explore, "session_adoptions", ""}

          page ->
            refute page.content["summary"] =~ "目录正文哨兵"

            if length(pages) == 5 do
              assert page.next_offset == nil
              assert exploration["allowed"] == false
              {:reply, "已按实际目录核对15个候选，正文尚未读取。"}
            else
              assert is_integer(page.next_offset)

              if length(pages) >= 2 do
                assert exploration["budget"]["normal_open?"] == false
                assert exploration["budget"]["continuation_only?"] == true
                assert exploration["tools"] == ["session_adoptions"]
              end

              {:explore, "session_adoptions",
               Jason.encode!(%{query: page.coverage["query"], offset: page.next_offset})}
            end
        end
      end)

    {snapshot, results} = drive(work.id, session.id, execution, 6)
    pages = snapshot.stage_state.judgment_explorations

    assert Enum.map(pages, & &1.coverage.offset) == [0, 3, 6, 9, 12]
    assert Enum.map(pages, & &1.next_offset) == [3, 6, 9, 12, nil]
    assert Enum.all?(pages, &(&1.coverage.kind == "directory"))

    assert MapSet.new(Enum.flat_map(pages, & &1.refs)) ==
             MapSet.new(for n <- 1..15, do: "directory-item-#{n}")

    assert List.last(results).turn_result.assistant_message.text =~ "15个候选"
    assert WorkSessionRepo.adoption_state(work.id, session.id) == before_state
    requests = drain_requests([])
    assert length(requests) == 6
    assert length(TestProviderPrompt.visible_observations(List.last(requests))) == 5
  end

  for {tool, ref_key} <- [{"session_adoptions", :artifact_ref}, {"memory_recall", :memory_ref}] do
    @tag :r05_paged_sources
    test "#{tool} 从真实目录定位全文，两轮后续页仍回流并绑定来源" do
      verify_detail_loop(unquote(tool), unquote(ref_key))
    end
  end

  defp verify_detail_loop(tool, ref_key) do
    {work, session} = work_session("只读全文续页")
    body = "分页证据" <> String.duplicate("雨", 6_992) <> "末页证据"
    assert String.length(body) == 7_000
    {expected_ref, expected_versions} = seed_detail(tool, work.id, session.id, body)

    execution =
      scripted_execution(fn request ->
        pages = TestProviderPrompt.visible_observations(request)
        exploration = TestProviderPrompt.scope_content(request)["operation"]["exploration"]

        case pages do
          [] ->
            {:explore, tool, "分页证据"}

          [directory] ->
            assert directory.source_refs == [expected_ref]
            refute directory.content["summary"] =~ "末页证据"
            {:explore, tool, Jason.encode!(%{ref_key => expected_ref, :offset => 0})}

          [_directory, first] ->
            assert first.next_offset == 6_000
            assert first.versions == expected_versions
            assert exploration["budget"]["normal_open?"] == false
            assert exploration["budget"]["continuation_only?"] == true
            assert exploration["tools"] == [tool]
            assert first.coverage["continuation_hint"] =~ tool
            refute first.coverage["continuation_hint"] =~ "已覆盖全章"

            {:explore, tool,
             Jason.encode!(%{
               ref_key => first.coverage[to_string(ref_key)],
               :offset => first.next_offset
             })}

          [_directory, _first, last] ->
            assert last.next_offset == nil
            assert last.versions == expected_versions
            assert exploration["allowed"] == false
            assert last.content["summary"] =~ "末页证据"
            {:reply, "已取回同一来源的两页，末页证据可核。"}
        end
      end)

    {snapshot, results} = drive(work.id, session.id, execution, 4)
    [_directory, first, last] = snapshot.stage_state.judgment_explorations
    assert first.summary <> last.summary == body
    assert first.refs == [expected_ref]
    assert last.refs == [expected_ref]
    assert first.outcome == :partial
    assert last.outcome == :partial
    assert first.coverage.summary.offset == 0
    assert last.coverage.summary.offset == 6_000
    assert first.versions == expected_versions
    assert last.versions == expected_versions
    assert List.last(results).turn_result.assistant_message.text =~ "末页证据"

    requests = drain_requests([])

    [directory, first_leaf, last_leaf] =
      TestProviderPrompt.visible_observations(List.last(requests))

    assert directory.source_refs == [expected_ref]
    assert first_leaf.content["summary"] <> last_leaf.content["summary"] == body
    assert first_leaf.content["observation_ref"] != last_leaf.content["observation_ref"]
    assert first_leaf.versions == expected_versions
    assert last_leaf.versions == expected_versions
    assert List.last(requests).refs.base_refs == []
  end

  defp drive(work_id, session_id, execution, rounds) do
    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "请读取当前来源的完整材料，并保留实际覆盖范围。",
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: session_id,
                 turn_id: "paged-source-author"
               },
               nil,
               execution
             )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    empty = %{stage_state: %{}, observations: [], events: []}
    assert {:execute, prepare, _decision, _meta} = spec.next_step_planner.(run, 1, empty)
    assert {:ok, prepared} = prepare.(run, 1, empty)
    snapshot = %{empty | stage_state: prepared.stage_state}

    Enum.reduce(2..(rounds + 1), {snapshot, []}, fn sequence, {current, results} ->
      assert {:execute, step, _decision, _meta} = spec.next_step_planner.(run, sequence, current)
      assert {:ok, result} = step.(run, sequence, current)
      next = %{current | stage_state: Map.merge(current.stage_state, result.stage_state)}
      {next, results ++ [result]}
    end)
  end

  defp scripted_execution(script) do
    test_pid = self()

    %Execution{
      result_fn: fn request ->
        send(test_pid, {:paged_request, request})

        {text, calls} =
          case script.(request) do
            {:explore, tool, query} ->
              {"先读取当前来源。",
               [
                 %{
                   "name" => "judgment_decision",
                   "arguments" => %{
                     "action" => "explore",
                     "reason" => "read_actual_source",
                     "dialogue_goal" => "核对实际来源及覆盖",
                     "explore_request" => %{"tool" => tool, "query" => query}
                   }
                 }
               ]}

            {:reply, text} ->
              {text, []}
          end

        call_ref = "paged-source-#{System.unique_integer([:positive])}"

        {:ok, output} =
          ProviderOutput.new(%{
            provider_run_ref: "run-#{call_ref}",
            provider_call_ref: call_ref,
            status: :ok,
            output_type: :text,
            content: %{text: text},
            refs: [call_ref]
          })

        {:ok, %{content: text, tool_calls: calls, provider_output: output}}
      end
    }
  end

  defp work_session(title) do
    {:ok, work} = WorkService.create(%{title: title})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)
    {work, session}
  end

  defp seed_detail("session_adoptions", work_id, session_id, body) do
    artifact_ref = "candidate-full-source"
    record_candidate(work_id, session_id, artifact_ref, "分页证据资料", body)
    {artifact_ref, %{}}
  end

  defp seed_detail("memory_recall", work_id, _session_id, body) do
    memory =
      %MemoryItem{}
      |> MemoryItem.changeset(%{
        id: Ecto.UUID.generate(),
        work_id: work_id,
        content: body,
        summary: "分页证据摘要",
        type: MemoryType.style_rule(),
        scope: "WORK",
        status: MemoryStatus.confirmed(),
        source_type: MemorySourceType.author_confirmed(),
        recallable: true,
        version: 7,
        tags: []
      })
      |> Repo.insert!()

    ref = "memory:#{memory.id}"
    {ref, %{ref => 7}}
  end

  defp record_candidate(work_id, session_id, artifact_ref, title, body) do
    turn_id = "source-#{artifact_ref}"

    entry = %{
      artifact_id: artifact_ref,
      artifact_type: "world_setting",
      adoption_status: "TENTATIVE",
      payload: %{items: [%{title: title, body: body}]}
    }

    {:ok, _} =
      MemoryLog.record(%{
        workspace_id: work_id,
        session_id: session_id,
        role: "assistant",
        turn_id: turn_id,
        content: %{
          text: "候选已产生",
          turn_result: %{turn_id: turn_id, adoption_state: %{pending: [entry], resolved: []}}
        }
      })
  end

  defp drain_requests(acc) do
    receive do
      {:paged_request, request} -> drain_requests(acc ++ [request])
    after
      0 -> acc
    end
  end
end
