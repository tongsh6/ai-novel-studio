defmodule NovelApplication.ChapterRevisionRequestTest do
  use NovelPersistence.DataCase, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelApplication.AgentRunFlows.ExplorationStep
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.ChapterReadEvidence
  alias NovelApplication.ChapterRevisionScope
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.PendingArtifactWorkflow
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelApplication.TranscriptCompaction
  alias NovelApplication.TurnInteractionService
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.AgentPlan
  alias NovelDomain.AgentRun
  alias NovelDomain.DialogueContext
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.InteractionLifecycle
  alias NovelPersistence.ReadingProjectionRepo
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}
  alias NovelTest.TestProviderPrompt

  setup do
    {:ok, work} = NovelApplication.WorkService.create(%{title: "R05 章修订请求"})
    {:ok, session} = NovelPersistence.WorkSessionRepo.ensure_active_for_work(work.id)
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{
        work_id: work.id,
        volume_id: volume.id,
        title: "第01章：灯楼夜雨",
        seq: 1
      })

    drafts =
      for {body, seq, revision} <- [
            {"初稿：陈九斤二十五岁守灯楼，第七盏灯不点自亮。", 1, 2},
            {"续写：灯楼九层，每层九盏，他数到第九层时天边泛白。", 2, 1}
          ] do
        scene =
          Repo.insert!(%Scene{
            work_id: work.id,
            chapter_id: chapter.id,
            title: "场景 #{seq}",
            seq: seq
          })

        Repo.insert!(%Draft{
          work_id: work.id,
          scene_id: scene.id,
          content: body,
          status: AdoptionStatus.accepted(),
          revision: revision
        })
      end

    [draft1, draft2] = drafts
    author_input = %{turn_id: "request", text: "修订第一章正文。"}

    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-b28-chapter",
        origin_frame_ref: "frame-b28-chapter",
        status: :running,
        phase: :executing,
        run_mode: :bounded,
        profile_ref: "judgment_loop_v1",
        budget: %{max_tool_calls: 3, max_provider_calls: 6},
        consumed_budget: %{
          steps: 0,
          execution_steps: 0,
          tool_calls: 0,
          provider_calls: 0,
          replans: 0
        },
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]},
        workspace_id: work.id,
        work_id: work.id,
        session_id: session.id,
        parent_turn_ref: author_input.turn_id,
        goal: %{text: author_input.text, version: 1}
      })

    %{
      work: work,
      volume: volume,
      chapter_ref: "chapter:#{chapter.id}",
      draft1_ref: "draft:#{draft1.id}",
      draft2_ref: "draft:#{draft2.id}",
      base_text: "初稿：陈九斤二十五岁守灯楼，第七盏灯不点自亮。\n\n续写：灯楼九层，每层九盏，他数到第九层时天边泛白。",
      run: run,
      author_input: author_input,
      context: %DialogueContext{work_id: work.id, interaction_state: %{}}
    }
  end

  for {scope_name, author_words, goal} <- [
        {"whole_chapter", "  请通读整章并修订第一章正文。 R05CHAPTERAUTHOR91\r\n", "统一修订第一章正文"},
        {"target_segments", "  只把第一章开头一段改得更紧张，其他段落逐字保留。 R05CHAPTERAUTHOR91\r\n", "修订第一章开头的目标段落"}
      ] do
    test "R05: #{scope_name} 作者单供给且完整 accepted 基线与版本保留", c do
      words = unquote(author_words)
      goal = unquote(goal)
      input = %{c.author_input | text: words}
      run = %{c.run | goal: %{text: words, version: 1}}

      assert {:ok, result} =
               PendingArtifactWorkflow.run(
                 judgment(c.chapter_ref, %{dialogue_goal: goal}),
                 input,
                 run,
                 c.context,
                 provider(c.base_text, self())
               )

      assert_received {:chapter_writer_prompt, request}
      scope = TestProviderPrompt.scope_content(request)
      assert TestProviderPrompt.author_text(request) == words
      assert get_in(scope, ["operation", "context_text"]) =~ c.base_text
      assert get_in(scope, ["authoring_task", "author_goal"]) == goal
      refute Jason.encode!(scope) =~ "R05CHAPTERAUTHOR91"

      materials = get_in(scope, ["authoring_task", "materials"])
      assert Enum.any?(materials, &(&1["ref"] == c.draft1_ref and &1["version"] == 2))
      assert Enum.any?(materials, &(&1["ref"] == c.draft2_ref and &1["version"] == 1))
      refute Enum.any?(materials, &(Map.has_key?(&1, "body") or Map.has_key?(&1, "text")))

      for wire <- ["chat_completions", "responses_api", "anthropic_messages"] do
        assert {:ok, body} = Projection.project(request, wire)
        assert length(String.split(Jason.encode!(body), "R05CHAPTERAUTHOR91")) == 2
      end

      assert [pending] = result.turn_result.adoption_state.pending
      assert pending.payload.modification_scope == unquote(scope_name)
      assert ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref) == c.base_text
    end
  end

  for wire <- ["chat_completions", "responses_api", "anthropic_messages"] do
    @tag :r05_whole_visible_baseline
    test "R05: DPS 两页经真实 Writer 投到 #{wire} 时整章正文只供应一遍", c do
      state = prepare_paged_revision(c, 2)
      before = request_ir(state.snapshot)
      [first, last] = RequestIR.visible_observations(before)

      assert first.status == "ok"
      assert first.next_offset == 6_000
      assert first.coverage["prose_range"] == %{"start" => 1, "end" => 6_000}
      assert first.coverage["prose_byte_range"] == %{"start" => 0, "end" => 17_976}
      assert first.omissions != []
      assert last.coverage["prose_range"] == %{"start" => 6_001, "end" => 7_000}
      assert last.coverage["prose_byte_range"] == %{"start" => 17_976, "end" => 20_952}
      assert is_nil(last.next_offset)
      assert first.versions == %{state.source.draft_ref => 4}
      assert last.versions == %{state.source.draft_ref => 4}

      {state, result, request} = finish_paged_revision(state)
      assert RequestIR.visible_observations(request) == [first, last]
      assert :ok = RequestIR.validate(request)

      assert {:ok, body} = Projection.project(request, unquote(wire))
      bytes = Jason.encode!(body)

      for marker <- ["R05PAGEONE71", "R05PAGETWO71"] do
        assert length(String.split(bytes, marker)) == 2
      end

      scope = TestProviderPrompt.scope_content(request)
      refute get_in(scope, ["operation", "context_text"]) =~ state.source.body
      assert_whole_candidate(result, state.source)
      refute state.run.authority_scope.production_write
    end
  end

  @tag :r05_whole_visible_baseline
  test "R05: 旧页仍完整供应 fresh 基线，但新作者之后的模型选段不能借旧页授信", c do
    state = prepare_paged_revision(c, 2)
    before = request_ir(state.snapshot)
    pages = RequestIR.visible_observations(before)
    assert [first, _last] = pages
    [target | _] = first.content["target_segments"]
    words = "把本轮发现的重复写法改成一段候选，其他内容保持不变。"

    transcript =
      state.snapshot.stage_state.judgment_transcript
      |> AuthoringTranscript.append_author_turn(words, "r05-current-target")

    request =
      state.snapshot
      |> put_in([:stage_state, :judgment_transcript], transcript)
      |> request_ir()

    assert :ok = RequestIR.validate(request)
    assert RequestIR.visible_observations(request) == pages

    assert ReadingProjectionRepo.accepted_chapter_prose(c.work.id, state.source.chapter_ref) ==
             state.source.body

    facts = %{
      base_text: state.source.body,
      target_chapter_ref: state.source.chapter_ref,
      expected_base_versions: [%{ref: state.source.draft_ref, version: 4}]
    }

    assert ChapterReadEvidence.supplied_baseline?(request, facts)

    proposal = %{
      action: "execute",
      capability: "revise_adopted_content",
      adopted_content_ref: state.source.chapter_ref,
      author_input: words,
      target_segment_ids: [target["segment_id"]]
    }

    assert {:error, {:target_segments, :not_observed}} =
             ChapterRevisionScope.bind_observed_targets(proposal, request)
  end

  @tag :r05_whole_visible_baseline
  test "R05: 完整原生章页复用只授信实际 Observation，draft 版本不另登记 Base", c do
    state = prepare_paged_revision(c, 2)
    {state, result, request} = finish_paged_revision(state)
    task = TestProviderPrompt.scope_content(request)["authoring_task"]

    assert task["materials"] == [
             %{"kind" => "observation", "ref" => state.source.chapter_ref, "complete?" => true}
           ]

    assert task["scope"]["expected_base_versions"] == [
             %{"ref" => state.source.draft_ref, "version" => 4}
           ]

    assert state.source.chapter_ref in Enum.map(request.refs.observation_refs, &ref_id/1)
    refute state.source.draft_ref in Enum.map(request.refs.base_refs, &ref_id/1)
    assert_whole_candidate(result, state.source)
  end

  @tag :r05_whole_visible_baseline
  test "R05: 只有首页时 Writer 仍收到完整新鲜基线，尾页不能靠 refs 补齐", c do
    state = prepare_paged_revision(c, 1)
    {state, result, request} = finish_paged_revision(state)
    assert [page] = RequestIR.visible_observations(request)
    assert page.next_offset == 6_000
    refute page.content["summary"] =~ "R05PAGETWO71"
    assert_fresh_baseline(request, state.source)
    assert_whole_candidate(result, state.source)
  end

  @tag :r05_whole_visible_baseline
  test "R05: 两页正文和 hash 相同但 accepted 版本已变时仍供应新鲜完整基线", c do
    state = prepare_paged_revision(c, 2)
    source = state.source

    source.draft
    |> Draft.changeset(%{})
    |> Ecto.Changeset.force_change(:content, source.body)
    |> Repo.update!()

    draft = Repo.get!(Draft, source.draft.id)
    assert draft.revision == 5
    assert draft.content == source.body
    state = %{state | source: %{source | draft: draft, revision: 5}}

    {state, result, request} = finish_paged_revision(state)
    pages = RequestIR.visible_observations(request)
    assert length(pages) == 2
    assert Enum.all?(pages, &(&1.versions == %{state.source.draft_ref => 4}))
    assert Enum.all?(pages, &(&1.content["source_hash"] == source.hash))
    assert_fresh_baseline(request, state.source)
    assert_whole_candidate(result, state.source)
  end

  @tag :r05_whole_visible_baseline
  test "R05: 合法 Compaction 隐藏旧回合两页后，canonical 历史不能替代当前完整基线", c do
    state = prepare_paged_revision(c, 2)
    {state, _judgment_result} = advance_revision(state)
    transcript = state.snapshot.stage_state.judgment_transcript
    original_messages = transcript.messages
    store = &InteractionLifecycle.call/2
    assert is_function(store, 2)
    assert {:ok, _} = TurnInteractionService.receive_input(state.run, store, state.input)
    steer_ref = "#{state.run.parent_turn_ref}:steer:2"

    run = %{
      state.run
      | goal: %{text: state.input.text, version: 2, source_ref: steer_ref}
    }

    assert {:ok, _} = TurnInteractionService.record_steer(run, state.input.text, store)

    assert {:ok, %{turn_id: ^steer_ref} = received} =
             TurnInteractionService.current_input(run, store)

    assert received.text == state.input.text
    input = state.input |> Map.merge(received) |> Map.put(:interaction_store, store)

    transcript =
      %{transcript | run: RequestIR.run_envelope(run)}
      |> AuthoringTranscript.append_author_turn(received.text, received.turn_id)

    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)
    assert length(plan.covers.call_ids) >= 2
    assert {:ok, transcript} = AuthoringCheckpoint.append_checkpoint(transcript, plan)

    snapshot = put_in(state.snapshot, [:stage_state, :judgment_transcript], transcript)
    hidden_request = request_ir(snapshot)
    assert :ok = RequestIR.validate(hidden_request)
    assert RequestIR.visible_observations(hidden_request) == []
    assert Enum.take(transcript.messages, length(original_messages)) == original_messages

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               state.snapshot.stage_state.pending_artifact_request,
               input,
               run,
               c.context,
               state.execution,
               snapshot
             )

    assert_received {:paged_revision_writer, request}
    assert RequestIR.visible_observations(request) == []
    assert_fresh_baseline(request, state.source)

    assert result.turn_result.tool_result.output.self_report.used_context_refs == [
             state.source.draft_ref
           ]

    assert_whole_candidate(result, state.source)

    for wire <- ["chat_completions", "responses_api", "anthropic_messages"] do
      assert {:ok, body} = Projection.project(request, wire)
      bytes = Jason.encode!(body)
      assert length(String.split(bytes, "R05PAGEONE71")) == 2
      assert length(String.split(bytes, "R05PAGETWO71")) == 2
    end
  end

  @tag :r05_whole_visible_baseline
  test "R05: 真实计划两页复用保留 application Base 来源，不能伪升成原生 Observation", c do
    source = paged_chapter(c)
    state = planned_chapter_pages(c, source)
    before = request_ir(state.snapshot)
    pages = RequestIR.visible_observations(before)

    assert length(pages) == 2
    assert Enum.all?(pages, &(&1.provenance == "application"))
    assert Enum.all?(pages, &(&1.versions == %{source.draft_ref => 4}))
    assert RequestIR.call_ids(before.messages) == []
    assert before.refs.observation_refs == []

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment(source.chapter_ref, %{dialogue_goal: "修订第二章整章正文"}),
               state.input,
               state.run,
               c.context,
               paged_revision_execution(source, 0, self()),
               state.snapshot
             )

    assert_received {:paged_revision_writer, request}
    assert RequestIR.visible_observations(request) == pages
    assert source.chapter_ref in Enum.map(request.refs.base_refs, &ref_id/1)
    assert request.refs.observation_refs == []
    refute source.draft_ref in Enum.map(request.refs.base_refs, &ref_id/1)

    refute get_in(TestProviderPrompt.scope_content(request), ["operation", "context_text"]) =~
             source.body

    for wire <- ["chat_completions", "responses_api", "anthropic_messages"] do
      assert {:ok, body} = Projection.project(request, wire)
      bytes = Jason.encode!(body)
      assert length(String.split(bytes, "R05PAGEONE71")) == 2
      assert length(String.split(bytes, "R05PAGETWO71")) == 2
    end

    assert_whole_candidate(result, source)
  end

  defp planned_chapter_pages(c, source) do
    steps =
      for {offset, sequence} <- [{0, 1}, {6_000, 2}] do
        %{
          step_id: "r05-plan-page-#{sequence}",
          kind: :explore,
          description: "读取第二章第#{sequence}页正文",
          success_criteria: ["page_read"],
          depends_on: [],
          target_tool_ref: "chapter_read",
          exploration_query: Jason.encode!(%{chapter_ref: source.chapter_ref, offset: offset}),
          write_intent: :none,
          risk_hint: :low
        }
      end

    assert {:ok, plan} =
             AgentPlan.new(%{
               plan_id: "r05-fixed-chapter-read-plan",
               run_ref: c.run.run_id,
               steps: steps
             })

    input = %{c.author_input | text: "读取第二章后修订整章正文，生成一份待采纳修订稿。"}

    run = %{
      c.run
      | plan: plan,
        plan_ref: plan.plan_id,
        plan_version: plan.version,
        goal: %{text: input.text, version: 1, source_ref: input.turn_id}
    }

    transcript =
      AuthoringTranscript.new(run,
        base_text: RequestIR.application_base_text(),
        author_text: input.text,
        author_turn_ref: input.turn_id
      )

    initial = %{
      run: run,
      stage_state: %{judgment_transcript: transcript},
      stage_sink: fn _event -> :ok end
    }

    snapshot =
      plan.steps
      |> Enum.with_index(1)
      |> Enum.reduce(initial, fn {step, sequence}, snapshot ->
        current_run = %{run | current_step_ref: step.step_id}

        assert {:ok, result} =
                 current_run
                 |> ExplorationStep.execute(sequence, step, snapshot)
                 |> AuthoringSession.record_exploration_result(current_run, snapshot)

        %{snapshot | stage_state: Map.merge(snapshot.stage_state, result.stage_state)}
      end)

    %{run: run, input: input, snapshot: snapshot}
  end

  defp prepare_paged_revision(c, page_count) do
    source = paged_chapter(c)
    execution = paged_revision_execution(source, page_count, self())

    input = %{
      text: "先读完第二章全文，再修订整章；生成一份待采纳的完整修订稿。",
      workspace_id: c.work.id,
      work_id: c.work.id,
      session_id: c.run.session_id,
      turn_id: "r05-paged-chapter-revision"
    }

    assert {:ok, spec} = DialoguePlanningService.plan_agent_run(input, nil, execution)
    assert {:ok, run} = AgentRun.new(spec.run_attrs)

    state = %{
      source: source,
      execution: execution,
      input: input,
      spec: spec,
      run: run,
      sequence: 1,
      snapshot: %{stage_state: %{}, observations: [], events: [], stage_sink: fn _ -> :ok end}
    }

    Enum.reduce(1..(page_count + 1), state, fn _, current ->
      {next, _result} = advance_revision(current)
      next
    end)
  end

  defp advance_revision(state) do
    assert {:execute, step, _decision, _meta} =
             state.spec.next_step_planner.(state.run, state.sequence, state.snapshot)

    assert {:ok, result} = step.(state.run, state.sequence, state.snapshot)

    snapshot = %{
      state.snapshot
      | stage_state: Map.merge(state.snapshot.stage_state, Map.get(result, :stage_state, %{})),
        observations: state.snapshot.observations ++ Map.get(result, :observations, [])
    }

    run = struct!(state.run, Map.get(result, :run_patch, %{}))
    {%{state | run: run, snapshot: snapshot, sequence: state.sequence + 1}, result}
  end

  defp finish_paged_revision(state) do
    {state, _judgment_result} = advance_revision(state)
    {state, result} = advance_revision(state)
    assert_received {:paged_revision_writer, request}
    {state, result, request}
  end

  defp request_ir(snapshot) do
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(snapshot.stage_state.judgment_transcript)
    ir
  end

  defp paged_chapter(c) do
    body =
      "R05PAGEONE71" <>
        String.duplicate("雨", 5_988) <>
        "R05PAGETWO71" <> String.duplicate("雪", 988)

    assert String.length(body) == 7_000
    assert byte_size(body) == 20_952

    chapter =
      Repo.insert!(%Chapter{
        work_id: c.work.id,
        volume_id: c.volume.id,
        title: "第02章：分页修订",
        seq: 2
      })

    scene =
      Repo.insert!(%Scene{work_id: c.work.id, chapter_id: chapter.id, title: "雨雪", seq: 1})

    draft =
      Repo.insert!(%Draft{
        work_id: c.work.id,
        scene_id: scene.id,
        content: body,
        status: AdoptionStatus.accepted(),
        revision: 4
      })

    %{
      work_id: c.work.id,
      chapter_ref: "chapter:#{chapter.id}",
      draft_ref: "draft:#{draft.id}",
      draft: draft,
      revision: 4,
      body: body,
      hash: :crypto.hash(:sha256, body) |> Base.encode16(case: :lower)
    }
  end

  defp paged_revision_execution(source, page_count, test_pid) do
    calls = :atomics.new(1, [])

    %Execution{
      result_fn: fn request ->
        names = Enum.map(request.tools, & &1.name)

        cond do
          "judgment_decision" in names ->
            call_number = :atomics.add_get(calls, 1, 1)
            assert call_number <= page_count + 1
            arguments = paged_judgment_arguments(source, request, call_number, page_count)
            native_response("judgment_decision", arguments)

          "submit_tentative_artifact" in names ->
            send(test_pid, {:paged_revision_writer, request})
            base_refs = Enum.map(request.refs.base_refs, &ref_id/1)
            observed_refs = Enum.map(RequestIR.usable_observation_refs(request), &ref_id/1)

            used_ref =
              if source.draft_ref in base_refs, do: source.draft_ref, else: source.chapter_ref

            assert used_ref in (base_refs ++ observed_refs)

            native_response("submit_tentative_artifact", %{
              items: [
                %{
                  item_id: "r05-whole-revision",
                  title: "第02章：分页修订（整章修订）",
                  body: "修订稿：" <> source.body,
                  rationale: "按作者要求修订整章，等待采纳。"
                }
              ],
              self_report: %{
                assumptions: [],
                intended_reader_effect: "章内表达连贯",
                used_context_refs: [used_ref],
                risk_flags: []
              }
            })

          true ->
            flunk("unexpected revision provider tools: #{inspect(names)}")
        end
      end
    }
  end

  defp paged_judgment_arguments(source, request, call_number, page_count)
       when call_number <= page_count do
    offset =
      case RequestIR.visible_observations(request) do
        [] -> 0
        pages -> List.last(pages).next_offset
      end

    assert is_integer(offset)

    %{
      action: "explore",
      author_reasoning: "逐页读取第二章正文",
      dialogue_goal: "读取第二章完整正文后生成整章修订候选",
      explore_request: %{
        tool: "chapter_read",
        query: Jason.encode!(%{chapter_ref: source.chapter_ref, offset: offset})
      }
    }
  end

  defp paged_judgment_arguments(source, _request, _call_number, _page_count) do
    %{
      action: "execute",
      capability: "revise_adopted_content",
      adopted_content_ref: source.chapter_ref,
      dialogue_goal: "修订第二章整章正文，保留待采纳状态",
      author_reasoning: "按作者要求生成整章修订候选"
    }
  end

  defp native_response(name, arguments) do
    calls = TestAgenticLoopFixtures.native_tool_calls(name, arguments)
    ref = TestAgenticLoopFixtures.unique_provider_call_id("r05-paged-revision")

    assert {:ok, output} =
             ProviderOutput.new(%{
               provider_run_ref: "run-#{ref}",
               provider_call_ref: ref,
               status: :ok,
               output_type: :text,
               content: %{text: "", tool_calls: calls},
               refs: [ref]
             })

    {:ok, %{content: "", tool_calls: calls, provider_output: output}}
  end

  defp assert_fresh_baseline(request, source) do
    task_scope = TestProviderPrompt.scope_content(request)
    assert get_in(task_scope, ["operation", "context_text"]) =~ source.body

    assert get_in(task_scope, ["authoring_task", "scope", "expected_base_versions"]) == [
             %{"ref" => source.draft_ref, "version" => source.revision}
           ]

    assert Enum.any?(get_in(task_scope, ["authoring_task", "materials"]), fn material ->
             material["ref"] == source.draft_ref and material["version"] == source.revision
           end)
  end

  defp assert_whole_candidate(result, source) do
    assert [pending] = result.turn_result.adoption_state.pending
    assert pending.payload.modification_scope == "whole_chapter"
    assert pending.payload.target_chapter_ref == source.chapter_ref

    assert pending.payload.adoption_effect == %{
             "mode" => "replace_scope",
             "covered" => ["#{source.draft_ref}:#{source.revision}"],
             "expected_base_versions" => [%{ref: source.draft_ref, version: source.revision}],
             "coverage" => "complete"
           }

    assert ReadingProjectionRepo.accepted_chapter_prose(source.work_id, source.chapter_ref) ==
             source.body
  end

  defp ref_id(%{ref: ref}), do: ref
  defp ref_id(%{"ref" => ref}), do: ref
  defp ref_id(ref) when is_binary(ref), do: ref

  defp judgment(chapter_ref, opts) do
    Map.merge(
      %{
        action: "execute",
        capability: "revise_adopted_content",
        adopted_content_ref: chapter_ref,
        pending_artifact_ref: nil,
        dialogue_goal: "修订第一章正文",
        narrative: "按作者要求修订第一章正文。",
        reason: "revise_adopted_content",
        frame_type: "execution_candidate",
        candidate_directions: [],
        reason_codes: [],
        model_interpretation_status: "provided"
      },
      opts
    )
  end

  defp provider(body, test_pid) do
    %Execution{
      result_fn: fn prompt ->
        send(test_pid, {:chapter_writer_prompt, prompt})

        {:ok,
         TestAgenticLoopFixtures.native_artifact_result(
           [
             %{
               item_id: "chapter-revision-1",
               title: "第01章：灯楼夜雨（整章修订）",
               body: body,
               rationale: "按作者要求处理。"
             }
           ],
           provider_call_id: "pcall-b28-chapter"
         )}
      end
    }
  end
end
