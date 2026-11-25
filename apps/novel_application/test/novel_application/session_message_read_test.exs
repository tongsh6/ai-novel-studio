defmodule NovelApplication.SessionMessageReadTest do
  use ExUnit.Case, async: false

  import NovelApplication.TestAgenticLoopFixtures,
    only: [
      run_until_turn_result: 3,
      scripted_judgment_execution: 1,
      drain_prompt_maps: 1,
      observation_blocks: 1
    ]

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.{
    AuthorContentRegistration,
    AuthoringTranscript,
    DialoguePlanningService,
    ExplorationService,
    JudgmentProtocol,
    TestAgenticLoopFixtures,
    WorkService
  }

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.AgentRun
  alias NovelPersistence.{Repo, WorkSessionRepo}
  alias NovelTest.TestProviderPrompt

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "会话原文回查"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})
    %{work: work, session: session}
  end

  test "作者原话逐字节保留，来源指向真实消息而非采纳作品", context do
    original = "  未答问题：她为什么还没离开？\r\n不要替我决定。 e\u0301 👩‍💻  "
    transcript = transcript(context, "author-source", original)
    :ok = TestAgenticLoopFixtures.append_segment!(transcript, status: "awaiting_author")

    assert {:ok, observed} = read(context, "author-source", 2)
    assert observed.summary == original
    assert observed.refs == ["session_message:author-source:2"]
    assert observed.versions == %{"session_message:author-source:2" => 1}
    assert observed.source_hash == sha256(original)
    assert observed.next_offset == nil
    assert observed.omissions == []
    assert observed.outcome == :observed
    assert observed.coverage.offset_unit == "unicode_grapheme"
    assert observed.coverage.byte_range == %{start: 0, end_exclusive: byte_size(original)}

    assert observed.facts == %{
             run_id: "author-source",
             run_sequence: 2,
             session_sequence: 2,
             parent_turn_ref: "turn-author-source",
             run_status: "awaiting_author",
             role: "user",
             provenance: "author",
             source_refs: [%{"ref" => "input:author-source"}],
             workspace_id: context.work.id,
             work_id: context.work.id,
             session_id: context.session.id,
             format_version: "authoring-session-message/v1"
           }
  end

  @tag :r08_author_sources
  test "R08 同 run 多条作者原话各自保留真实来源，不能借 parent_turn_ref 代签", context do
    first = "  旧钟在退潮时鸣响。\r\n"
    second = "  这是第二条作者原文：e\u0301 👩‍💻。  "

    source =
      context
      |> transcript("r08-multiple-authors", first)
      |> AuthoringTranscript.append_author_turn(second, "input:r08-second-author")

    assert :ok = TestAgenticLoopFixtures.append_segment!(source, status: "awaiting_author")
    assert {:ok, first_read} = read(context, "r08-multiple-authors", 2)
    assert {:ok, second_read} = read(context, "r08-multiple-authors", 3)

    for {observed, ref, bytes} <- [
          {first_read, "input:r08-multiple-authors", first},
          {second_read, "input:r08-second-author", second}
        ] do
      assert observed.summary == bytes
      assert observed.source_hash == sha256(bytes)
      assert observed.facts.role == "user"
      assert observed.facts.provenance == "author"
      assert observed.facts.source_refs == [%{"ref" => ref}]
      assert observed.facts.work_id == context.work.id
      assert observed.facts.session_id == context.session.id
      refute observed.facts.parent_turn_ref == ref
    end
  end

  test "早期长答按 grapheme 分页，所有页拼合原文且全文 hash 不随页变", context do
    first_text = String.duplicate("e\u0301👩‍💻", 3000)
    second_text = String.duplicate("雪", 6000)
    last_text = "雪  \r\n尾"
    original = first_text <> second_text <> last_text

    source =
      context
      |> transcript("long-answer", "下一轮再逐条回答我。")
      |> AuthoringTranscript.append_assistant(original, [], %{
        "reasoning_content" => "private-reasoning-sentinel",
        "opaque" => "private-provider-state"
      })

    :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")

    assert {:ok, first} = read(context, "long-answer", 3)
    assert first.summary == first_text
    assert first.next_offset == 6000
    assert first.coverage.range == %{start: 0, end_exclusive: 6000}
    assert first.coverage.total_graphemes == 12_005
    assert first.outcome == :partial
    assert length(first.omissions) == 1

    assert {:ok, second} = read(context, "long-answer", 3, 6000)
    assert second.summary == second_text
    assert second.next_offset == 12_000
    assert second.coverage.range == %{start: 6000, end_exclusive: 12_000}
    assert length(second.omissions) == 2

    assert {:ok, last} = read(context, "long-answer", 3, 12_000)
    assert last.summary == last_text
    assert last.next_offset == nil
    assert last.coverage.range == %{start: 12_000, end_exclusive: 12_005}
    assert last.outcome == :partial
    assert length(last.omissions) == 1
    assert first.summary <> second.summary <> last.summary == original

    for page <- [first, second, last] do
      assert page.source_hash == sha256(original)
      assert page.coverage.total_bytes == byte_size(original)
      assert page.refs == ["session_message:long-answer:3"]
      refute inspect(page) =~ "private-reasoning-sentinel"
      refute inspect(page) =~ "private-provider-state"
      refute inspect(page) =~ "provider_state"
    end

    assert second.coverage.byte_range == %{
             start: byte_size(first_text),
             end_exclusive: byte_size(first_text <> second_text)
           }

    assert {:error, :session_message_offset_out_of_range} =
             read(context, "long-answer", 3, 12_006)
  end

  test "纯文本多块不插入分隔符；系统、工具和混合工具答复不可作为原文", context do
    source = transcript(context, "role-source", "作者输入")

    pure =
      RequestIR.message(:assistant, :model, [
        RequestIR.text_block("前段\r\n"),
        RequestIR.text_block("  后段")
      ])

    source =
      %{source | messages: source.messages ++ [pure]}
      |> AuthoringTranscript.append_assistant("带工具的答复", [
        RequestIR.tool_call_block("archive_read", %{}, "source-call")
      ])
      |> AuthoringTranscript.append_observation("source-call", %{
        status: "ok",
        content: %{summary: "tool-private-source"}
      })

    :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")
    assert {:ok, %{summary: "前段\r\n  后段"}} = read(context, "role-source", 3)

    for sequence <- [1, 4, 5] do
      assert {:error, :session_message_not_readable} = read(context, "role-source", sequence)
    end

    assert {:error, :session_message_not_found} = read(context, "role-source", 6)
  end

  test "查询只接受显式 run/消息/offset，不接受作用域覆盖或猜测引用串", context do
    valid = %{"run_id" => "query-source", "run_sequence" => 2, "offset" => 0}

    invalid = [
      "session_message:query-source:2",
      "",
      "{",
      Jason.encode!(Map.delete(valid, "offset")),
      Jason.encode!(Map.put(valid, "work_id", context.work.id)),
      Jason.encode!(Map.put(valid, "session_id", context.session.id)),
      Jason.encode!(Map.put(valid, "source_ref", "session_message:query-source:2")),
      Jason.encode!(Map.put(valid, "limit", 100)),
      Jason.encode!(Map.put(valid, "run_sequence", 0)),
      Jason.encode!(Map.put(valid, "run_sequence", "2")),
      Jason.encode!(Map.put(valid, "run_id", "")),
      Jason.encode!(Map.put(valid, "offset", -1)),
      Jason.encode!(Map.put(valid, "offset", 0.5)),
      nil
    ]

    for query <- invalid do
      assert {:error, :invalid_session_message_query} =
               ExplorationService.run(
                 context.work.id,
                 "session_message_read",
                 query,
                 context.session.id
               )
    end
  end

  test "可信 work/session 隔离，未知来源和缺会话 fail closed", context do
    :ok =
      context
      |> transcript("scoped-source", "不能被其他会话读到")
      |> TestAgenticLoopFixtures.append_segment!(status: "completed")

    {:ok, other_work} = WorkService.create(%{title: "另一作品"})

    {:ok, other_session} =
      WorkSessionRepo.create(%{work_id: context.work.id, title: "另一会话"})

    assert {:error, :session_message_session_not_found} =
             read(%{context | work: other_work}, "scoped-source", 2)

    assert {:error, :session_message_not_found} =
             read(%{context | session: other_session}, "scoped-source", 2)

    assert {:error, :session_message_not_found} = read(context, "missing-source", 2)

    assert {:error, :session_message_session_not_found} =
             ExplorationService.run(
               context.work.id,
               "session_message_read",
               query("scoped-source", 2, 0),
               nil
             )
  end

  test "交错提交仍按 run_sequence 定位，取消和失败原文保留真实状态", context do
    a = transcript(context, "interleave-a", "A 的未答问题")
    :ok = TestAgenticLoopFixtures.append_segment!(a, status: "running")

    b =
      context
      |> transcript("interleave-b", "B 的问题")
      |> AuthoringTranscript.append_assistant("B 的答复", [])

    :ok = TestAgenticLoopFixtures.append_segment!(b, status: "completed")
    a = AuthoringTranscript.append_assistant(a, "A 取消前的答复和未完成承诺", [])
    :ok = TestAgenticLoopFixtures.append_segment!(a, status: "cancelled")

    assert {:ok, observed} = read(context, "interleave-a", 3)
    assert observed.summary == "A 取消前的答复和未完成承诺"
    assert observed.facts.run_sequence == 3
    assert observed.facts.session_sequence == 6
    assert observed.facts.run_status == "cancelled"
    assert observed.facts.parent_turn_ref == "turn-interleave-a"

    failed =
      context
      |> transcript("failed-source", "失败前作者的原问题")
      |> AuthoringTranscript.append_assistant("失败前已可见的答复", [])

    :ok = TestAgenticLoopFixtures.append_segment!(failed, status: "failed")
    assert {:ok, failed_page} = read(context, "failed-source", 3)
    assert failed_page.summary == "失败前已可见的答复"
    assert failed_page.facts.run_status == "failed"
  end

  test "持久消息未知版本拒绝，不从摘要或旁路恢复正文", context do
    :ok =
      context
      |> transcript("bad-version", "损坏版本不得返回这句原文")
      |> TestAgenticLoopFixtures.append_segment!(status: "completed")

    SQL.query!(
      Repo,
      "UPDATE authoring_session_messages SET format_version = ? WHERE run_id = ?",
      ["authoring-session-message/v99", "bad-version"]
    )

    assert {:error, :authoring_message_version_unsupported} =
             read(context, "bad-version", 2)
  end

  test "持久 role 与 canonical role 不一致时沿源校验 fail closed", context do
    :ok =
      context
      |> transcript("bad-role", "不能靠被篡改的 role 读取")
      |> TestAgenticLoopFixtures.append_segment!(status: "completed")

    SQL.query!(
      Repo,
      "UPDATE authoring_session_messages SET role = ? WHERE run_id = ? AND run_sequence = ?",
      ["assistant", "bad-role", 2]
    )

    assert {:error, :authoring_message_shape_invalid} = read(context, "bad-role", 2)
  end

  test "真实观察携原文/coverage/hash进入下一请求，来源可用于 used_refs 和三类投影", context do
    original = "  请回查这句完整答复。\r\n我尚未履行的承诺仍在这里。  "
    source = transcript(context, "wire-source", original)
    :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")
    {:ok, observed} = read(context, "wire-source", 2)
    source_ref = "session_message:wire-source:2"

    next =
      context
      |> transcript("next-run", "请准确引用我上一轮的原话")
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block(
          "judgment_decision",
          %{
            action: "explore",
            author_reasoning: "读取上一轮对话的原文。",
            explore_request: %{tool: "session_message_read", query: query("wire-source", 2, 0)}
          },
          "read-call"
        )
      ])
      |> JudgmentProtocol.observation_transcript(%{tool_call_id: "read-call"}, observed)
      |> AuthoringTranscript.declare_used_refs([source_ref])

    assert source_ref in next.observation_refs
    assert {:ok, request} = AuthoringTranscript.to_request_ir(next)
    assert request.refs.used_refs == [source_ref]
    assert :ok = RequestIR.validate(request)

    for format <- ["chat_completions", "responses_api", "anthropic_messages"] do
      assert {:ok, projected} = Projection.project(request, format)
      block = projected |> observation_text(format) |> Jason.decode!() |> Map.fetch!("data")
      assert block["content"]["summary"] == original
      assert block["content"]["source_hash"] == sha256(original)
      assert block["source_refs"] == [source_ref]
      assert block["versions"] == %{source_ref => 1}
      assert block["coverage"]["offset_unit"] == "unicode_grapheme"

      assert block["coverage"]["byte_range"] == %{
               "start" => 0,
               "end_exclusive" => byte_size(original)
             }

      assert block["omissions"] == []
      assert block["next_offset"] == nil
    end

    forged = AuthoringTranscript.declare_used_refs(next, ["session_message:unread:2"])

    assert {:error, {:used_refs_out_of_scope, ["session_message:unread:2"]}} =
             AuthoringTranscript.to_request_ir(forged)
  end

  test "R03 会话原文三页续读共用探索预算，精确来源和 Unicode 坐标进入真实回环" do
    {:ok, work} = WorkService.create(%{title: "旧长答完整回查"})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)
    first_text = String.duplicate("早", 6000)
    second_text = String.duplicate("答", 6000)
    tail = "尚未完成的承诺：下一轮逐项作答。"
    original = first_text <> second_text <> tail
    source_id = "source:opaque:run"

    source =
      AuthoringTranscript.new(
        %{
          run_id: source_id,
          workspace_id: work.id,
          work_id: work.id,
          session_id: session.id,
          parent_turn_ref: "source-author-turn"
        },
        base_text: "创作助手",
        author_text: "请保留原问题和你的承诺。",
        author_turn_ref: "input:source-author-turn"
      )
      |> AuthoringTranscript.append_assistant(original, [])

    :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")
    test_pid = self()

    execution =
      scripted_judgment_execution(fn prompt ->
        send(test_pid, {:prompt_map, prompt})

        locator =
          case List.last(observation_blocks(prompt)) do
            nil ->
              %{"run_id" => source_id, "run_sequence" => 3, "offset" => 0}

            %{next_offset: nil} ->
              :finished

            _page ->
              continuation =
                get_in(TestProviderPrompt.scope_content(prompt), [
                  "operation",
                  "exploration",
                  "budget",
                  "continuation"
                ])

              assert continuation["tool"] == "session_message_read"

              %{
                "run_id" => Map.fetch!(continuation, "run_id"),
                "run_sequence" => Map.fetch!(continuation, "run_sequence"),
                "offset" => Map.fetch!(continuation, "next_offset")
              }
          end

        case locator do
          :finished ->
            {:narrative, "原文末段仍保留这项承诺：" <> tail}

          locator ->
            {:decision,
             %{
               "action" => "explore",
               "explore_request" => %{
                 "tool" => "session_message_read",
                 "query" => Jason.encode!(locator)
               }
             }}
        end
      end)

    {:ok, spec} =
      DialoguePlanningService.plan_agent_run(
        %{
          text: "回查上轮长答中尚未完成的承诺，准确读取全文。",
          workspace_id: work.id,
          work_id: work.id,
          session_id: session.id,
          turn_id: "read-original-turn"
        },
        NovelPersistence.WorkspaceContext.context_fetcher_with_query(),
        execution
      )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    {_snapshot, result} = run_until_turn_result(spec, run, 8)
    assert result.turn_result.assistant_message.text == "原文末段仍保留这项承诺：" <> tail

    prompts = drain_prompt_maps([])
    third_request = Enum.find(prompts, &(length(observation_blocks(&1)) == 2))
    assert third_request

    budget =
      get_in(TestProviderPrompt.scope_content(third_request), [
        "operation",
        "exploration",
        "budget"
      ])

    assert budget["normal_open?"] == false
    assert budget["continuation_only?"] == true

    assert budget["continuation"] == %{
             "tool" => "session_message_read",
             "run_id" => source_id,
             "run_sequence" => 3,
             "next_offset" => 12_000,
             "read_end" => 12_000,
             "total" => String.length(original)
           }

    second_page = third_request |> observation_blocks() |> List.last()
    assert second_page.status == "partial"
    assert second_page.coverage["range"] == %{"start" => 6000, "end_exclusive" => 12_000}
    assert second_page.coverage["coverage_note"] =~ "[6000, 12000)"
    hint = second_page.coverage["continuation_hint"]
    assert hint =~ "session_message_read"
    assert hint =~ ~s("run_id":"source:opaque:run")
    assert hint =~ ~s("run_sequence":3)
    assert hint =~ ~s("offset":12000)
    refute hint =~ "chapter_read"
    refute hint =~ "本章"

    final_request = Enum.find(prompts, &(length(observation_blocks(&1)) == 3))
    assert final_request
    pages = observation_blocks(final_request)
    assert Enum.map(pages, & &1.content["summary"]) == [first_text, second_text, tail]
    assert Enum.map(pages, & &1.next_offset) == [6000, 12_000, nil]
    assert Enum.all?(pages, &(&1.source_refs == ["session_message:source:opaque:run:3"]))
    assert Enum.all?(pages, &(&1.versions == %{"session_message:source:opaque:run:3" => 1}))
    assert Enum.all?(pages, &(&1.content["facts"]["run_status"] == "completed"))

    final_exploration =
      TestProviderPrompt.scope_content(final_request)["operation"]["exploration"]

    assert final_exploration["allowed"] == false
    assert final_exploration["budget"]["continuation_open?"] == false
  end

  test "R08 完整分页回查才授予作者来源，最后一页或有缺口的页不能代替全文", context do
    original = String.duplicate("e\u0301👩‍💻", 6000) <> "  尾声\r\n"
    source_ref = "input:r08-page-source"
    source = transcript(context, "r08-page-source", original)
    assert :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")

    assert {:ok, first} = read(context, "r08-page-source", 2, 0)
    assert {:ok, second} = read(context, "r08-page-source", 2, 6000)
    assert {:ok, last} = read(context, "r08-page-source", 2, 12_000)

    for pages <- [[first], [last], [first, last]] do
      request = observed_request(context, pages)

      assert {:error, {:author_content_registration_invalid, :source_not_available}} =
               AuthorContentRegistration.bind_judgment(registration(source_ref), request)
    end

    request = observed_request(context, [first, second, last])

    assert {:ok, bound} =
             AuthorContentRegistration.bind_judgment(registration(source_ref), request)

    assert bound.author_content_source == %{ref: source_ref, source_hash: sha256(original)}

    assert {:ok, transcript} = AuthoringTranscript.from_request_ir(request)

    projected =
      JudgmentProtocol.request_for_production(%{
        author_text: "登记已回查的作者原文。",
        source_input_ref: "input:r08-registration-reader",
        transcript: transcript,
        scope: %{work_id: context.work.id},
        options: [plan_run: request.run]
      })

    assert observation_blocks(projected) == observation_blocks(request)

    assert TestProviderPrompt.scope_content(projected)["operation"]["author_content_sources"] ==
             [%{"ref" => "input:r08-registration-reader"}, %{"ref" => source_ref}]

    assert {:error, {:author_content_registration_invalid, :source_not_available}} =
             AuthorContentRegistration.bind_judgment(
               registration("turn-r08-page-source"),
               request
             )
  end

  test "R08 回查的目录、assistant、partial、跨作品会话与错误 provenance 均不授信", context do
    original = "  作者提供的原始材料。\r\n"

    source =
      context
      |> transcript("r08-invalid-read", original)
      |> AuthoringTranscript.append_assistant("助手的同名答复，不能冒充作者原文。", [])

    assert :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")
    assert {:ok, observed} = read(context, "r08-invalid-read", 2)
    assert {:ok, assistant} = read(context, "r08-invalid-read", 3)
    ref = "input:r08-invalid-read"

    invalid = [
      %{observed | summary: ""},
      assistant,
      %{observed | outcome: :partial, omissions: ["尚未完整读取"]},
      put_in(observed, [:facts, :work_id], "different-work"),
      put_in(observed, [:facts, :workspace_id], "different-workspace"),
      put_in(observed, [:facts, :session_id], "different-session"),
      put_in(observed, [:facts, :provenance], "model")
    ]

    wrong_hash = %{observed | source_hash: sha256("另一段内容")}

    cases =
      Enum.map(invalid, &{[&1], :source_not_available}) ++
        [
          {[wrong_hash], :source_content_mismatch},
          {[observed, wrong_hash], :source_identity_conflict}
        ]

    for {evidence, reason} <- cases do
      assert {:error, {:author_content_registration_invalid, ^reason}} =
               AuthorContentRegistration.bind_judgment(
                 registration(ref),
                 observed_request(context, evidence)
               )
    end
  end

  @tag :r08_source_parent
  test "R08 父观察不可用时，完整 ok 作者原文叶也不能授予来源资格", context do
    source_ref = "input:r08-parent-observation"
    source = transcript(context, "r08-parent-observation", "  作者原文仍需真实可用的观察。\r\n")
    assert :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")
    assert {:ok, observed} = read(context, "r08-parent-observation", 2)
    request = observed_request(context, [observed])

    for status <- ["ok", "unavailable", "stale"] do
      messages =
        Enum.map(request.messages, fn
          %{role: "tool", blocks: [block]} = message ->
            leaf = block |> Map.drop([:type, :call_id]) |> RequestIR.json_value()

            parent = %{
              block
              | status: status,
                content: %{"tool" => "planned_exploration", "observations" => [leaf]}
            }

            %{message | blocks: [parent]}

          message ->
            message
        end)

      supplied = %{request | messages: messages}
      assert :ok = RequestIR.validate(supplied)
      assert [_leaf] = RequestIR.visible_observations(supplied)

      if status == "ok" do
        assert {:ok, bound} =
                 AuthorContentRegistration.bind_judgment(registration(source_ref), supplied)

        assert bound.author_content_source.ref == source_ref
      else
        assert {:error, {:author_content_registration_invalid, :source_not_available}} =
                 AuthorContentRegistration.bind_judgment(registration(source_ref), supplied)
      end
    end
  end

  test "R08 真实回查来源穿过判断与物化，目录外原文形成待采纳候选", context do
    original = "  潮水退尽后，旧钟才鸣响。\r\n保留 e\u0301 👩‍💻。  "
    source_run = "r08-registration-source"
    source_ref = "input:" <> source_run
    source = transcript(context, source_run, original)
    assert :ok = TestAgenticLoopFixtures.append_segment!(source, status: "completed")

    for index <- 0..12 do
      assert {:ok, _} =
               NovelPersistence.InteractionLifecycle.call(:receive, %{
                 workspace_id: context.work.id,
                 session_id: context.session.id,
                 run_id: if(index == 0, do: source_run, else: "r08-recent-run-#{index}"),
                 turn_id: if(index == 0, do: source_ref, else: "r08-recent-input-#{index}"),
                 text: if(index == 0, do: original, else: "第 #{index} 条普通讨论")
               })
    end

    recent = NovelPersistence.InteractionLifecycle.context(context.work.id, context.session.id)
    refute Enum.any?(recent.author_inputs, &(&1.turn_ref == source_ref))
    parent = self()

    execution = %NovelAgent.Provider.Execution{
      result_fn: fn request ->
        send(parent, {:r08_registration_request, request})

        {content, call} =
          case observation_blocks(request) do
            [] ->
              {"",
               TestAgenticLoopFixtures.judgment_call("judgment_decision", %{
                 action: "explore",
                 explore_request: %{
                   tool: "session_message_read",
                   query: query(source_run, 2, 0)
                 }
               })}

            [observed] ->
              assert observed.content["summary"] == original
              assert observed.content["source_hash"] == sha256(original)
              assert observed.content["facts"]["source_refs"] == [%{"ref" => source_ref}]

              {"已形成待采纳候选，采纳后才会入档。",
               TestAgenticLoopFixtures.judgment_call("register_author_content", %{
                 author_content_source_ref: source_ref,
                 dialogue_goal: "将指定的作者原文登记为候选"
               })}
          end

        {:ok,
         TestAgenticLoopFixtures.judgment_response(
           content,
           [call],
           TestAgenticLoopFixtures.unique_provider_call_id("r08-read-registration")
         )}
      end
    }

    {:ok, spec} =
      DialoguePlanningService.plan_agent_run(
        %{
          text: "把旧钟那条原文登记为候选。",
          workspace_id: context.work.id,
          work_id: context.work.id,
          session_id: context.session.id,
          turn_id: "r08-read-register"
        },
        NovelPersistence.WorkspaceContext.context_fetcher_with_query(),
        execution
      )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    {_snapshot, result} = run_until_turn_result(spec, run, 6)

    assert [pending] = result.turn_result.adoption_state.pending
    assert pending.requires_adoption
    assert [%{body: ^original, provider_call_ref: provenance}] = pending.payload.items
    assert provenance == "author_input:" <> source_ref

    assert_receive {:r08_registration_request, first_request}
    assert_receive {:r08_registration_request, final_request}
    assert observation_blocks(first_request) == []

    assert Enum.any?(
             TestProviderPrompt.scope_content(final_request)["operation"][
               "author_content_sources"
             ],
             &(&1 == %{"ref" => source_ref})
           )

    refute Enum.any?(final_request.messages, fn message ->
             message.role == "user" and
               Enum.any?(message.source_refs, &(&1.ref == source_ref))
           end)
  end

  defp observed_request(context, observations) do
    next =
      observations
      |> Enum.with_index(1)
      |> Enum.reduce(transcript(context, "r08-registration-reader", "登记已回查的作者原文。"), fn
        {observed, index}, transcript ->
          call_id = "r08-source-read-#{index}"

          transcript
          |> AuthoringTranscript.append_assistant("", [
            RequestIR.tool_call_block(
              "judgment_decision",
              %{
                action: "explore",
                explore_request: %{tool: "session_message_read", query: observed.query}
              },
              call_id
            )
          ])
          |> JudgmentProtocol.observation_transcript(%{tool_call_id: call_id}, observed)
      end)

    assert {:ok, request} = AuthoringTranscript.to_request_ir(next)
    request
  end

  defp registration(ref),
    do: %{action: "author_content_registration", author_content_source_ref: ref}

  defp transcript(%{work: work, session: session}, run_id, author_text) do
    AuthoringTranscript.new(
      %{
        run_id: run_id,
        workspace_id: work.id,
        work_id: work.id,
        session_id: session.id,
        parent_turn_ref: "turn-" <> run_id
      },
      base_text: "按原文理解作者问题。",
      author_text: author_text,
      author_turn_ref: "input:" <> run_id
    )
  end

  defp read(context, run_id, sequence, offset \\ 0) do
    ExplorationService.run(
      context.work.id,
      "session_message_read",
      query(run_id, sequence, offset),
      context.session.id
    )
  end

  defp query(run_id, sequence, offset),
    do: Jason.encode!(%{run_id: run_id, run_sequence: sequence, offset: offset})

  defp sha256(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)

  defp observation_text(body, "chat_completions"),
    do: body.messages |> Enum.find(&(&1.role == "tool")) |> Map.fetch!(:content)

  defp observation_text(body, "responses_api"),
    do: body.input |> Enum.find(&(&1.type == "function_call_output")) |> Map.fetch!(:output)

  defp observation_text(body, "anthropic_messages") do
    body.messages
    |> Enum.flat_map(& &1.content)
    |> Enum.find(&(&1.type == "tool_result"))
    |> Map.fetch!(:content)
  end
end
