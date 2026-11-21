defmodule NovelApplication.JudgmentInitialSnapshotTest do
  # 真实 Gateway 捕获需要注入测试 provider，不能与其它 async 用例并行改全局配置。
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.InferenceParams
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.JudgmentProtocol
  alias NovelApplication.JudgmentToolContract
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.AgentRun

  @author_a "接着第02章往下写一段正文"
  @author_b "把第02章写得更紧凑些"
  @projection_targets ["chat_completions", "anthropic_messages", "responses_api"]

  @scope %{
    work_id: "work-1",
    facts: %{
      work: %{ref: "work:work-1", work_id: "work-1", title: "前缀度量样书", version: 3},
      chapters: [
        %{ref: "chapter:one", work_id: "work-1", title: "第01章：底层灵气账单", seq: 1, has_prose: true}
      ]
    },
    context: %{open_behavior_summary: "上一轮采纳了第01章草稿，作者准备继续推进正文。"},
    coverage: %{
      work: %{status: "complete"},
      chapters: %{status: "complete", returned: 1, total: 1}
    }
  }
  @refs [%{ref: "work:work-1"}, %{ref: "chapter:one"}]

  defmodule CaptureProvider do
    @behaviour NovelAgent.Provider

    alias NovelAgent.Provider.AdapterExecution
    alias NovelAgent.Provider.Result
    alias NovelCommon.RequestIR
    alias NovelCommon.RequestIR.Projection

    defstruct []

    @impl true
    def execute(_state, _model, %RequestIR{} = ir, _params, ctx) do
      {:ok, body} = Projection.project(ir, "chat_completions")
      send(self(), {:captured_request, body})
      AdapterExecution.materialize_result({:ok, Result.new("captured")}, ctx)
    end

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def capabilities(_state) do
      %{
        native_multi_turn: true,
        tool_calls: true,
        tool_results: true,
        streaming: true,
        structured_output: true,
        usage: true
      }
    end

    @impl true
    def projection_target(_state), do: "chat_completions"

    @impl true
    def name, do: "initial_snapshot_capture"
  end

  setup do
    old_extra = Application.get_env(:novel_agent, :extra_providers)

    extra =
      (old_extra || [])
      |> Map.new()
      |> Map.put(:initial_snapshot_capture, CaptureProvider)

    Application.put_env(:novel_agent, :extra_providers, extra)

    on_exit(fn ->
      if old_extra,
        do: Application.put_env(:novel_agent, :extra_providers, old_extra),
        else: Application.delete_env(:novel_agent, :extra_providers)
    end)

    :ok
  end

  test "R05 统计进入真实判断请求与三 wire，目录正文保持未读且不获得章节引用" do
    context = %NovelDomain.DialogueContext{
      work_id: "work-1",
      current_work_snapshot: %{title: "最小统计作品", revision: 7},
      structured_chapters: [
        %{
          id: "chapter-private",
          work_id: "work-1",
          title: "目录哨兵",
          summary: "章摘要哨兵",
          plan_direction: %{plot_progress: "章计划哨兵"},
          has_prose: true
        }
      ],
      conversation_summary: "历史预览哨兵",
      memory_summary: "角色正文哨兵",
      reading_audit: %{
        work_id: "work-1",
        audit: %{chapter_count: 3, empty_chapter_count: 2, total_word_count: 13}
      },
      source_status: %{work: :ok, chapters: :ok}
    }

    author_text = "  现在实际写了几章、多少正文有效字？\n"
    scope = NovelApplication.DialoguePlanningService.judgment_scope(context)

    protocol_input =
      input(author_text, "r05-statistics-author", scope)
      |> Map.put(:supplied_context_refs, ["work:work-1"])

    {request, transcript} = production_request(protocol_input)
    assert request.refs.base_refs == [%{ref: "work:work-1"}]
    assert request.refs.observation_refs == []

    content =
      request.messages
      |> Enum.find(&(&1.role == "scope_update"))
      |> Map.fetch!(:blocks)
      |> hd()
      |> Map.fetch!(:content)

    assert content["facts"]["work"]["chapter_statistics"] == %{
             "structure_chapter_count" => 3,
             "written_chapter_count" => 1,
             "empty_chapter_count" => 2,
             "total_word_count" => 13
           }

    assert content["coverage"]["chapters"] == %{"status" => "not_read"}
    assert content["coverage"]["chapter_prose"] == %{"status" => "not_read"}
    assert occurrences(capture(request) |> serialize(), author_text) == 1
    assert {:ok, restored} = restore(transcript)

    {restored_request, _restored_transcript} =
      production_request(Map.put(protocol_input, :transcript, restored))

    for target <- @projection_targets do
      assert {:ok, projected} = Projection.project(request, target)
      assert Projection.project(restored_request, target) == {:ok, projected}

      assert [decision] =
               Enum.filter(projected.tools, fn tool ->
                 (get_in(tool, [:function, :name]) || tool[:name]) == "judgment_decision"
               end)

      schema =
        get_in(decision, [:function, :parameters]) || decision[:parameters] ||
          decision[:input_schema]

      assert %{"type" => "object", "additionalProperties" => false} = schema
      assert schema["required"] == ["action"]
      assert schema["properties"]["dialogue_goal"]["type"] == "string"
      assert schema["properties"]["author_reasoning"]["type"] == "string"
      assert schema["properties"]["capability"]["type"] == "string"
      refute Map.has_key?(schema, "anyOf")

      if target == "responses_api" do
        assert Map.fetch(decision, :strict) == {:ok, false}
      end

      wire = Jason.encode!(projected)
      assert wire =~ "chapter_statistics"

      for marker <- ["目录哨兵", "章摘要哨兵", "章计划哨兵", "历史预览哨兵", "角色正文哨兵", "chapter-private"] do
        refute wire =~ marker
      end
    end
  end

  @tag :r05_base_bindings
  test "new/2 的 initial_scope 一次构造 base → scope → author，保留作者原字节与 turn 元数据" do
    transcript =
      AuthoringTranscript.new(
        %{run_id: "initial-snapshot-run", work_id: "work-1"},
        base_text: "稳定 Base",
        author_text: @author_a,
        author_turn_ref: "author-turn-a",
        author_turn: %{origin: "author_choice", question_ref: "question-1"},
        base_refs: @refs,
        initial_scope: %{
          content: @scope,
          versions: %{"scope_revision" => 1, "work" => 3, "change_reason" => "initial_scope"},
          source_refs: @refs
        }
      )

    assert [base, scope, author] = transcript.messages
    assert base.role == "application_base"
    assert base.provenance == "application"
    assert Projection.text_of(base.blocks) == "稳定 Base"
    assert base.base_refs == []
    assert scope.base_refs == @refs
    assert {:ok, initial_request} = AuthoringTranscript.to_request_ir(transcript)
    assert RequestIR.usable_base_refs(initial_request) == @refs

    assert scope.role == "scope_update"
    assert scope.provenance == "application"
    assert [%{type: "scope", content: content}] = scope.blocks
    assert content == RequestIR.json_value(@scope)

    assert scope.versions == %{
             "scope_revision" => 1,
             "work" => 3,
             "change_reason" => "initial_scope"
           }

    assert scope.source_refs == @refs

    assert author.role == "user"
    assert author.provenance == "author"
    assert Projection.text_of(author.blocks) == @author_a
    assert author.source_refs == [%{ref: "author-turn-a"}]

    assert author.author_turn == %{
             "origin" => "author_choice",
             "question_ref" => "question-1"
           }
  end

  test "生产判断请求首次快照经 Gateway 捕获为 base → scope → author，且内容不多不少" do
    input =
      input(@author_a, "author-turn-a")
      |> Map.put(:author_turn, %{origin: "author_choice", question_ref: "question-1"})
      |> Map.put(:scope_change_reason, "run_scope_refreshed")

    request = JudgmentProtocol.request_for_production(input)

    assert [base, scope, author] = request.messages
    assert base.role == "application_base"
    assert scope.role == "scope_update"
    assert scope.provenance == "application"
    assert [%{type: "scope", content: content}] = scope.blocks
    assert content["facts"] == RequestIR.json_value(@scope.facts)
    assert scope.versions["scope_revision"] == 1
    assert scope.versions["change_reason"] == "initial_scope"
    assert scope.source_refs == @refs
    assert author.role == "user"
    assert author.provenance == "author"
    assert Projection.text_of(author.blocks) == @author_a
    assert author.author_turn["origin"] == "author_choice"
    assert author.author_turn["question_ref"] == "question-1"
    assert Enum.count(request.messages, &(&1.role == "user")) == 1

    body = capture(request)

    assert Enum.map(body.messages, & &1.role) == ["system", "user", "user", "user"]
    assert Enum.at(body.messages, 1).content =~ "application_base"
    assert Enum.at(body.messages, 2).content =~ "scope_update"
    assert Enum.at(body.messages, 3).content == @author_a
    refute Enum.at(body.messages, 2).content =~ @author_a
    assert Enum.count(body.messages, &(&1.role == "user" and &1.content == @author_a)) == 1

    assert_narrative_contract(request, body, [
      {"judgment_decision", "explore 不提供，包括 null；content 必须为空"},
      {"agent_plan_draft", "说明计划的目标、安排和依据，不把计划说成已执行"},
      {"register_author_content", "不改写原文或声称已被采纳"},
      {"propose_creative_directions", "说明方向的依据与区别，保留作者选择"},
      {"propose_work_profile_revision", "这是待采纳提案，不是已生效修改"},
      {"report_capability_gap", "不把建议说成已执行"}
    ])
  end

  test "两个独立作者输入的同半稳定上下文共享前缀覆盖结构化 Scope 事实边界" do
    first_request = JudgmentProtocol.request_for_production(input(@author_a, "author-turn-a"))
    second_request = JudgmentProtocol.request_for_production(input(@author_b, "author-turn-b"))

    first = capture(first_request) |> serialize()
    second = capture(second_request) |> serialize()
    boundary = marker_offset!(first, "前缀度量样书")
    shared = shared_prefix_bytes(first, second)

    assert shared >= boundary,
           "shared=#{shared} boundary=#{boundary}"

    assert occurrences(first, @author_a) == 1
    assert occurrences(second, @author_b) == 1
    refute String.contains?(first, @author_b)
    refute String.contains?(second, @author_a)
  end

  test "已有 transcript 续行严格前缀不变，重复构造与 JSON restore 三类投影一致" do
    {first_request, first_transcript} = production_request(input(@author_a, "author-turn-a"))

    next_input =
      input(
        @author_b,
        "author-turn-b",
        put_in(@scope, [:context, :open_behavior_summary], "第02章需要压缩。")
      )
      |> Map.put(:transcript, first_transcript)
      |> Map.put(:scope_change_reason, "run_scope_changed")

    {next_request, next_transcript} = production_request(next_input)
    {duplicate_request, duplicate_transcript} = production_request(next_input)

    assert Enum.take(next_request.messages, length(first_request.messages)) ==
             first_request.messages

    author_texts =
      next_request.messages
      |> Enum.filter(&(&1.role == "user" and &1.provenance == "author"))
      |> Enum.map(&Projection.text_of(&1.blocks))

    assert author_texts == [@author_a, @author_b]
    assert next_request.messages == duplicate_request.messages
    assert next_transcript.messages == duplicate_transcript.messages

    scope = AuthoringTranscript.current_scope(next_transcript)
    assert scope.versions["scope_revision"] == 2
    assert scope.versions["change_reason"] == "run_scope_changed"
    assert scope.source_refs == @refs

    assert {:ok, restored} = restore(next_transcript)

    {restored_request, restored_transcript} =
      production_request(Map.put(next_input, :transcript, restored))

    assert restored_transcript.messages == next_transcript.messages

    Enum.each(@projection_targets, fn target ->
      expected = Projection.project(next_request, target)
      assert Projection.project(duplicate_request, target) == expected
      assert Projection.project(restored_request, target) == expected
    end)
  end

  test "同内容的来源集合或业务 plan 版本变化必须追加 Scope，重复读取幂等" do
    initial = input(@author_a, "author-turn-a")
    {_request, first} = production_request(initial)

    changed =
      initial
      |> Map.put(:transcript, first)
      |> Map.put(:options,
        plan_run: Map.put(Keyword.fetch!(initial.options, :plan_run), :plan_version, 2)
      )

    {_request, second} = production_request(changed)
    assert length(second.messages) == length(first.messages) + 1
    assert AuthoringTranscript.current_scope(second).versions["plan"] == 2

    changed_refs =
      changed
      |> Map.put(:transcript, second)
      |> Map.put(:supplied_context_refs, ["work:work-1", "chapter:one", "context:read-2"])

    {_request, third} = production_request(changed_refs)
    assert length(third.messages) == length(second.messages) + 1

    assert List.last(AuthoringTranscript.current_scope(third).source_refs) == %{
             ref: "context:read-2"
           }

    {_request, repeated} = production_request(Map.put(changed_refs, :transcript, third))
    assert repeated.messages == third.messages
  end

  test "固定 profile 的 schema 不随动态来源/对象/权限变化" do
    first =
      JudgmentProtocol.request_for_production(
        input(capabilities: ["prose_writing"], explore: true)
      )

    second =
      JudgmentProtocol.request_for_production(
        input(capabilities: [], author_content_sources: ["other"])
      )

    assert first.tools == second.tools
    assert first.tools == JudgmentToolContract.tools(:judgment)
    assert RequestIR.Tools.tool_choice(first) == "auto"
    refute first.messages == second.messages
  end

  describe "B71：judgment Request IR" do
    test "判断请求产出 canonical IR：工具目录稳定、application_base 与作者原话分离" do
      input = input(capabilities: ["prose_writing"], explore: true)
      {ir, transcript} = production_request(input)

      assert %RequestIR{} = ir
      assert ir.ir_version == RequestIR.ir_version()
      assert :ok = RequestIR.validate(ir)

      # 工具目录来自固定 profile contract（name 顺序一致）。
      assert Enum.map(ir.tools, & &1.name) ==
               Enum.map(JudgmentToolContract.tools(:judgment), & &1.name)

      assert RequestIR.Tools.tool_choice(ir) == "auto"
      assert [%{role: "application_base"} | rest] = ir.messages

      author = Enum.find(ir.messages, &(&1.role == "user" and &1.provenance == "author"))
      assert author
      assert TestAgenticLoopFixtures.message_text(author) == input.author_text

      application_base = Enum.find(ir.messages, &(&1.role == "application_base"))
      assert application_base
      assert application_base.provenance == "application"

      # 2026-11-06 裁决 A：角色规则/输出协议进入 canonical system 前缀，application_base
      # 只声明应用数据职责与来源边界。
      system_text = Projection.system_text(ir.system)
      assert system_text =~ "## 决策与输出契约"
      assert system_text =~ "本次你直接与作者讨论作品"
      assert TestAgenticLoopFixtures.message_text(application_base) =~ "应用数据"
      refute TestAgenticLoopFixtures.message_text(application_base) =~ "## 决策与输出契约"
      refute Enum.any?(application_base.blocks, &(&1.type == "scope"))
      refute TestAgenticLoopFixtures.message_text(application_base) =~ "只读探索当前允许："

      scope_update = Enum.find(ir.messages, &(&1.role == "scope_update"))
      assert scope_update
      assert scope_update.provenance == "application"
      assert [%{type: "scope", content: scope_content}] = scope_update.blocks
      assert scope_content["facts"] == RequestIR.json_value(input.scope.facts)
      assert scope_content["operation"]["exploration"]["allowed"] == true

      refute TestAgenticLoopFixtures.message_text(scope_update) =~
               "## 作者输入\n" <> input.author_text

      assert length(rest) >= 2

      assert AuthoringTranscript.current_scope(transcript).content == scope_content
    end

    test "作者新输入只追加新的 turn 与 scope，不重写既有请求" do
      first_input = input(explore: true)
      {first, transcript} = production_request(first_input)

      next_input =
        first_input
        |> Map.put(:author_text, "基于已读事实，改为只比较两个方向")
        |> Map.put(:source_input_ref, "author-turn-2")
        |> Map.put(:scope, %{
          work_id: first_input.scope.work_id,
          facts: %{},
          context: %{open_behavior_summary: "已有事实已刷新"}
        })
        |> Map.put(:transcript, transcript)
        |> Map.put(:options,
          plan_run: %{
            first_input.options[:plan_run]
            | goal: %{text: "只比较两个方向", version: 2}
          }
        )

      {second, next} = production_request(next_input)
      assert Enum.take(second.messages, length(first.messages)) == first.messages

      assert Enum.any?(
               second.messages,
               &(&1.role == "user" and &1.provenance == "author" and
                   TestAgenticLoopFixtures.message_text(&1) == next_input.author_text)
             )

      scope = NovelApplication.AuthoringTranscript.current_scope(next)
      assert scope.content["context"]["open_behavior_summary"] == "已有事实已刷新"
      assert scope.versions["change_reason"] == "run_scope_changed"
      assert scope.content["goal"]["source_input_ref"] == "author-turn-2"
      assert scope.source_refs == [%{ref: "chapter:one"}]
    end

    test "continuation profile 同样直接产出 canonical IR" do
      input =
        input(capabilities: ["ask_author"])
        |> Map.put(:deviation_summary, "偏离事实摘要")

      {ir, _transcript} = production_request(input, :continuation)

      assert Enum.any?(
               ir.messages,
               &(&1.role == "user" and &1.provenance == "author" and
                   TestAgenticLoopFixtures.message_text(&1) == input.author_text)
             )

      assert ir.tools != []

      assert_narrative_contract(ir, capture(ir), [
        {"continuation_decision", "唯一作者说明原文，content 必须为空"},
        {"continuation_decision", "依据已观察到的偏离说明为何这样调整"}
      ])
    end

    test "continuation 没有作者消息时保留 application goal，不伪造 user" do
      input =
        input(capabilities: ["ask_author"])
        |> Map.delete(:author_text)
        |> Map.delete(:source_input_ref)
        |> Map.put(:deviation_summary, "偏离事实摘要")

      {ir, _transcript} = production_request(input, :continuation)

      refute Enum.any?(ir.messages, &(&1.role == "user"))

      assert NovelTest.TestProviderPrompt.scope_content(ir)["goal"] ==
               %{"text" => "根据本章实际内容判断", "version" => 1}
    end

    test "新建与刷新均只登记显式供应材料，不提升普通 Scope 来源" do
      for profile <- [:judgment, :continuation] do
        initial_input =
          input()
          |> Map.put(:deviation_summary, "按已读材料继续")
          |> Map.put(:scope_source_refs, ["plan:unread", "evidence:unread"])

        {initial, transcript} = production_request(initial_input, profile)
        assert initial.refs.base_refs == [%{ref: "chapter:one"}]

        assert AuthoringTranscript.current_scope(transcript).source_refs == [
                 %{ref: "chapter:one"},
                 %{ref: "plan:unread"},
                 %{ref: "evidence:unread"}
               ]

        next_input =
          initial_input
          |> Map.put(:transcript, transcript)
          |> Map.put(:supplied_context_refs, ["chapter:two"])
          |> Map.put(:scope_source_refs, ["plan:unread", "evidence:unread"])
          |> Map.update!(:scope, fn scope ->
            Map.put(scope, :context, %{provided_chapter: %{ref: "chapter:two", text: "实读正文"}})
          end)

        {continued, next} = production_request(next_input, profile)
        assert continued.refs.base_refs == [%{ref: "chapter:one"}, %{ref: "chapter:two"}]
        assert next.observation_refs == transcript.observation_refs

        for ref <- ["plan:unread", "evidence:unread"] do
          assert {:error, {:used_refs_out_of_scope, [^ref]}} =
                   next
                   |> AuthoringTranscript.declare_used_refs([ref])
                   |> AuthoringTranscript.to_request_ir()
        end
      end
    end

    test "同 Scope 的引用从普通来源变为显式供应材料时不会被去重吞掉" do
      initial_input =
        input()
        |> Map.put(:supplied_context_refs, [])
        |> Map.put(:scope_source_refs, ["chapter:one"])

      {_initial, transcript} = production_request(initial_input)
      assert transcript.base_refs == []

      supplied_input =
        initial_input
        |> Map.put(:transcript, transcript)
        |> Map.put(:supplied_context_refs, ["chapter:one"])

      {supplied, next} = production_request(supplied_input)
      assert supplied.refs.base_refs == [%{ref: "chapter:one"}]
      assert length(next.messages) == length(transcript.messages) + 1

      assert AuthoringTranscript.current_scope(next).content ==
               AuthoringTranscript.current_scope(transcript).content

      {_repeated, repeated} =
        production_request(Map.put(supplied_input, :transcript, next))

      assert repeated == next
    end

    @tag :r05_base_bindings
    test "累计目录已有同 ref 时当前 Scope 首次实际供应仍须追加绑定" do
      initial_input =
        input()
        |> Map.put(:supplied_context_refs, [])
        |> Map.put(:scope_source_refs, ["chapter:one"])

      {_initial, transcript} = production_request(initial_input)
      current_scope = AuthoringTranscript.current_scope(transcript)
      supplied = [%{ref: "chapter:one"}]

      transcript =
        transcript
        |> AuthoringTranscript.append_scope_update(
          %{work_id: transcript.run.work_id, context: %{material: %{text: "较早实际供应的章节正文。"}}},
          %{"scope_revision" => 2},
          supplied,
          supplied
        )
        |> AuthoringTranscript.append_scope_update(
          current_scope.content,
          Map.put(current_scope.versions, "scope_revision", 3),
          current_scope.source_refs,
          []
        )

      assert transcript.base_refs == supplied
      assert AuthoringTranscript.current_scope(transcript).base_refs == []

      supplied_input =
        initial_input
        |> Map.put(:transcript, transcript)
        |> Map.put(:supplied_context_refs, ["chapter:one"])

      {_request, next} = production_request(supplied_input)
      assert length(next.messages) == length(transcript.messages) + 1
      assert AuthoringTranscript.current_scope(next).base_refs == supplied

      {_request, repeated} = production_request(Map.put(supplied_input, :transcript, next))
      assert repeated == next
    end

    test "CP4a：续行继承创作历史并追加有版本的 scope，恢复后保持幂等" do
      run = input().options[:plan_run]
      run = %{run | goal: Map.put(run.goal, :source_ref, "author-turn")}

      {creative, transcript} =
        production_request(input(capabilities: ["prose_writing"], plan_run: run))

      continuation_input = %{
        transcript: transcript,
        deviation_summary: "正文调用超时，尚未形成候选",
        observation_block: "已有章节计划，尚无本轮正文",
        scope_source_refs: ["observation:timeout", "plan:chapter-1"],
        supplied_context_refs: [],
        scope_change_reason: "continuation",
        options: [
          plan_run: %{
            run
            | goal: %{run.goal | version: 3},
              authority_scope: Map.put(run.authority_scope, :work_revision, 8),
              plan_version: 2
          }
        ]
      }

      {continued, continued_transcript} =
        production_request(continuation_input, :continuation)

      assert Enum.take(continued.messages, length(creative.messages)) == creative.messages
      assert continued.refs.base_refs == creative.refs.base_refs
      assert continued.refs.observation_refs == creative.refs.observation_refs
      scope = AuthoringTranscript.current_scope(continued_transcript)
      assert scope.content["goal"] == %{"source_input_ref" => "author-turn", "version" => 3}
      assert scope.content["context"]["deviation_summary"] == continuation_input.deviation_summary

      assert scope.content["context"]["observation_summary"] ==
               continuation_input.observation_block

      for target <- ~w(chat_completions responses_api anthropic_messages) do
        assert {:ok, wire} = Projection.project(continued, target)
        bytes = Jason.encode!(wire)
        assert occurrences(bytes, "根据本章实际内容判断") == 1
        assert bytes =~ "正文调用超时，尚未形成候选"
        assert bytes =~ "已有章节计划，尚无本轮正文"
      end

      assert scope.versions["scope_revision"] == 2
      assert scope.versions["change_reason"] == "continuation"
      assert scope.versions["goal"] == 3
      refute Map.has_key?(scope.versions, "work")
      assert scope.versions["plan"] == 2

      assert Enum.map(scope.source_refs, & &1.ref) == [
               "observation:timeout",
               "plan:chapter-1"
             ]

      tool_names = Enum.map(continued_transcript.tools, & &1.name)
      assert "continuation_decision" in tool_names
      assert "judgment_decision" in tool_names

      projected_tool_names = Enum.map(continued.tools, & &1.name)
      assert "continuation_decision" in projected_tool_names
      refute "judgment_decision" in projected_tool_names
      refute "submit_tentative_artifact" in projected_tool_names

      assert {:ok, restored} =
               continued_transcript
               |> AuthoringCheckpoint.checkpoint()
               |> AuthoringTranscript.restore()

      {replayed, _replayed_transcript} =
        production_request(%{continuation_input | transcript: restored}, :continuation)

      assert replayed.messages == continued.messages
    end
  end

  defp input(opts \\ []) do
    author_text = "根据本章实际内容判断"

    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-judgment-fixture",
        work_id: "work-judgment-fixture",
        workspace_id: "workspace-judgment-fixture",
        session_id: "session-judgment-fixture",
        parent_turn_ref: "author-turn",
        origin_frame_ref: "frame-judgment-fixture",
        profile_ref: "judgment_plan_v1",
        goal: %{text: author_text, version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    input(author_text, "author-turn", %{
      work_id: run.work_id,
      facts: %{characters: []},
      context: %{},
      coverage: %{}
    })
    |> Map.put(:supplied_context_refs, ["chapter:one"])
    |> Map.put(:options, Keyword.put_new(opts, :plan_run, run))
  end

  defp input(author_text, source_ref, scope \\ @scope) do
    %{
      author_text: author_text,
      scope: scope,
      source_input_ref: source_ref,
      supplied_context_refs: Enum.map(@refs, & &1.ref),
      options: [plan_run: %{run_id: "run-initial-snapshot"}]
    }
  end

  defp production_request(input, profile \\ :judgment) do
    assert {:ok, transcript} = JudgmentProtocol.transcript_for_production(input, profile)
    assert %RequestIR{} = request = JudgmentProtocol.request_for_production(input, profile)
    {request, transcript}
  end

  defp restore(transcript) do
    transcript
    |> AuthoringCheckpoint.checkpoint()
    |> Jason.encode!()
    |> Jason.decode!()
    |> AuthoringTranscript.restore()
  end

  defp capture(request) do
    assert {:ok, _} =
             Gateway.execute(request, "capture-model", InferenceParams.new(),
               provider: :initial_snapshot_capture,
               purpose: :planner
             )

    assert_receive {:captured_request, body}, 1_000
    body
  end

  defp assert_narrative_contract(request, body, obligations) do
    shared_rule = "本次调用的工具参数、引用绑定、指纹和版本校验属于内部执行"
    assert hd(body.messages).content =~ shared_rule
    assert occurrences(Jason.encode!(body), shared_rule) == 1

    for target <- @projection_targets do
      assert {:ok, projected} = Projection.project(request, target)
      assert occurrences(Jason.encode!(projected), shared_rule) == 1
      tools = Enum.map(projected.tools, &(Map.get(&1, :function) || &1))

      for {tool_name, obligation} <- obligations do
        assert [tool] = Enum.filter(tools, &(&1.name == tool_name))
        schema = tool[:parameters] || tool[:input_schema]

        assert %{"type" => "string", "minLength" => 1, "description" => description} =
                 schema["properties"]["author_reasoning"]

        assert description =~ obligation
      end
    end
  end

  defp serialize(%{messages: messages}) do
    Enum.map_join(messages, "", fn message -> "#{message.role}\n#{message.content}" end)
  end

  defp marker_offset!(text, marker) do
    case :binary.matches(text, marker) do
      [match | _] -> elem(match, 0)
      [] -> flunk("marker not found: #{inspect(marker)}")
    end
  end

  defp occurrences(text, needle), do: length(String.split(text, needle)) - 1

  defp shared_prefix_bytes(left, right) do
    left
    |> :binary.bin_to_list()
    |> Enum.zip(:binary.bin_to_list(right))
    |> Enum.take_while(fn {a, b} -> a == b end)
    |> length()
  end
end
