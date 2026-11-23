defmodule NovelApplication.AuthorContentRegistrationTest do
  use ExUnit.Case, async: false

  import NovelApplication.TestAgenticLoopFixtures,
    only: [drive_judgment: 3, drive_judgment: 4, drive_judgment_result: 3]

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.AuthorContentRegistration
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.JudgmentProtocol
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.MessageCoverage
  alias NovelDomain.AgentRun
  alias NovelPersistence.{InteractionLifecycle, Repo, WorkRepo, WorkSessionRepo, WorkspaceContext}

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  @tag :r08_author_sources
  test "R08 来源目录名单不能把未供应的作者原文升级为可登记证据" do
    source_ref = "r08-unread-author-input"

    input = TestAgenticLoopFixtures.judgment_input(author_content_sources: [source_ref])

    execution =
      registration_execution(source_ref,
        dialogue_goal: "登记指定的作者原文",
        narrative: "形成待采纳候选。"
      )

    assert {:error, {:author_content_registration_invalid, :source_not_available}, _state} =
             JudgmentProtocol.request_judgment(execution, %{}, input)
  end

  test "只有明确登记操作绑定来源；缺失和未供应来源保持失败" do
    request = source_request()
    reply = %{action: "reply"}
    assert {:ok, ^reply} = AuthorContentRegistration.bind_judgment(reply, request)

    assert {:error, {:author_content_registration_invalid, :source_required}} =
             AuthorContentRegistration.bind_judgment(
               %{action: "author_content_registration"},
               request
             )

    assert {:error, {:author_content_registration_invalid, :source_not_available}} =
             AuthorContentRegistration.bind_judgment(registration("unread"), request)
  end

  test "来源精确绑定真实 ref，同文多条作者消息也不按 goal、parent 或末条猜选" do
    original = "  上次潮来。\r\n"

    request =
      source_request(original, "actual-current")
      |> append_author(original, "later-visible-input")

    proposal =
      registration("actual-current")
      |> Map.put(:author_content_source, %{ref: "self-reported", source_hash: sha256("伪造")})

    assert {:ok, bound} = AuthorContentRegistration.bind_judgment(proposal, request)
    assert bound.author_content_source_ref == "actual-current"
    assert bound.author_content_source == %{ref: "actual-current", source_hash: sha256(original)}
    refute bound.author_content_source.ref == request.run.parent_turn_ref
    refute bound.author_content_source.ref == "later-visible-input"

    assert {:ok, sources} = AuthorContentRegistration.author_sources(request)

    assert MapSet.new(sources) ==
             MapSet.new([
               %{ref: "actual-current", source_hash: sha256(original)},
               %{ref: "later-visible-input", source_hash: sha256(original)}
             ])

    for ref <- ["current", " actual-current ", "unread"] do
      assert {:error, {:author_content_registration_invalid, :source_not_available}} =
               AuthorContentRegistration.bind_judgment(registration(ref), request)
    end
  end

  test "current 若是真实来源 ID 就按该条原文绑定，不借本轮 goal 解析" do
    raw = "  这条来源的真实标识恰好是 current。\r\n"

    request =
      source_request("本轮 goal 指向另一条原文。", "actual-current")
      |> append_author(raw, "current")

    assert {:ok, bound} =
             AuthorContentRegistration.bind_judgment(registration("current"), request)

    assert bound.author_content_source == %{ref: "current", source_hash: sha256(raw)}
  end

  test "Scope 中宣称的来源和 goal 不能给未供应的作者原文授信" do
    request = source_request()

    messages =
      Enum.map(request.messages, fn
        %{role: "scope_update", blocks: [block]} = message ->
          content =
            block.content
            |> put_in(["goal", "source_input_ref"], "unread")
            |> Map.put("operation", %{
              "author_content_sources" => [%{"ref" => "unread", "source_hash" => sha256("伪造")}]
            })

          %{message | blocks: [%{block | content: content}]}

        message ->
          message
      end)

    assert {:error, {:author_content_registration_invalid, :source_not_available}} =
             AuthorContentRegistration.bind_judgment(
               registration("unread"),
               %{request | messages: messages}
             )
  end

  test "完整来源只来自同作品会话的 user author 原文" do
    request = source_request()
    ref = "disallowed-source"

    for change <- [
          %{role: "assistant", provenance: "model"},
          %{provenance: "application"},
          %{canonical_ref: %{work_id: "different-work"}},
          %{canonical_ref: %{workspace_id: "different-workspace"}},
          %{canonical_ref: %{session_id: "different-session"}}
        ] do
      supplied = append_author(request, "完整但不合法的作者来源", ref)
      [candidate | previous] = Enum.reverse(supplied.messages)

      changed =
        case Map.pop(change, :canonical_ref) do
          {nil, rest} ->
            Map.merge(candidate, rest)

          {owner, rest} ->
            candidate
            |> Map.merge(rest)
            |> Map.update!(:canonical_ref, &Map.merge(&1, owner))
        end

      supplied = %{supplied | messages: Enum.reverse([changed | previous])}

      assert {:error, {:author_content_registration_invalid, :source_not_available}} =
               AuthorContentRegistration.bind_judgment(registration(ref), supplied)
    end
  end

  test "同 ref 的不同原文显式冲突，不能覆盖较早来源" do
    request =
      source_request()
      |> append_author("第一条原文。", "conflicting-source")
      |> append_author("内容不同的另一条原文。", "conflicting-source")

    assert {:error, {:author_content_registration_invalid, :source_identity_conflict}} =
             AuthorContentRegistration.author_sources(request)

    assert {:error, {:author_content_registration_invalid, :source_identity_conflict}} =
             AuthorContentRegistration.bind_judgment(registration("conflicting-source"), request)
  end

  test "来源绑定要求实际物化身份及完整原字节一致" do
    raw = "  原文\r\n第二行 e\u0301 👩‍💻  "
    binding = %{ref: "source-1", source_hash: sha256(raw)}

    assert {:ok, "source-1", ^raw} =
             AuthorContentRegistration.source_text(binding, "source-1", raw)

    assert {:error, {:author_content_registration_invalid, :source_required}} =
             AuthorContentRegistration.source_text(nil, "source-1", raw)

    assert {:error, {:author_content_registration_invalid, :source_not_available}} =
             AuthorContentRegistration.source_text(binding, nil, nil)

    assert {:error, {:author_content_registration_invalid, :source_identity_mismatch}} =
             AuthorContentRegistration.source_text(binding, "source-2", raw)

    assert {:error, {:author_content_registration_invalid, :source_content_mismatch}} =
             AuthorContentRegistration.source_text(binding, "source-1", String.trim(raw))

    assert {:ok, artifact} = ArtifactAssembler.assemble_author_content("source-1", raw)
    assert hd(artifact.items).body == raw
    assert artifact.source_tool_result_ref == "author_input:source-1"

    assert {:ok, linked} =
             ArtifactAssembler.assemble_author_content("save-request-2", raw, "source-1")

    assert linked.source_turn_ref == "save-request-2"
    assert linked.source_tool_result_ref == "author_input:source-1"
    assert hd(linked.items).provider_call_ref == "author_input:source-1"
    assert hd(linked.items).body == raw
  end

  @tag :r08_author_sources
  test "当前真实来源进入公开目录并绑定完整原字节，首轮只构造一个 Scope" do
    parent = self()
    raw = "  之前的海。\n"
    source_ref = "r08-current-author"
    source_hash = sha256(raw)

    input =
      TestAgenticLoopFixtures.judgment_input()
      |> Map.put(:author_text, raw)
      |> Map.put(:source_input_ref, source_ref)

    execution =
      registration_execution(source_ref,
        dialogue_goal: "登记本条原文",
        narrative: "按原文形成待采纳候选。",
        on_prompt: fn request -> send(parent, {:provider_request, request}) end
      )

    assert {:ok, judgment} = JudgmentProtocol.request_judgment(execution, %{}, input)
    assert judgment.author_content_source_ref == source_ref
    assert judgment.author_content_source == %{ref: source_ref, source_hash: source_hash}
    assert judgment.provider_call_count == 1
    assert_receive {:provider_request, request}
    refute_receive {:provider_request, _}, 10

    assert [base, scope, author] = request.messages
    assert base.role == "application_base"
    assert base.source_refs == [%{ref: "work:work-judgment-fixture"}]
    assert base.base_refs == []
    assert author.role == "user"
    assert author.provenance == "author"
    assert author.source_refs == [%{ref: source_ref}]
    assert author.blocks == [%{type: "text", text: raw}]
    assert author.canonical_ref.run_id == request.run.run_id
    assert author.canonical_ref.run_sequence == 3
    assert scope.role == "scope_update"
    assert scope.versions["scope_revision"] == 1
    assert [%{type: "scope", content: content}] = scope.blocks
    assert content["goal"]["source_input_ref"] == source_ref

    assert content["operation"]["author_content_sources"] == [
             %{"ref" => source_ref, "source_hash" => source_hash}
           ]

    refute judgment.author_content_source.ref == request.run.parent_turn_ref
  end

  test "原文登记缺来源或动作矛盾时不返回产物或创作 profile" do
    for {source, duplicate_call, reason} <- [
          {nil, false, {:author_content_registration_invalid, :source_required}},
          {"foreign", false, {:author_content_registration_invalid, :source_not_available}},
          {"guard-source", true, {:judgment_protocol_violation, :invalid_tool_combination}}
        ] do
      execution = registration_execution(source, duplicate_call: duplicate_call)

      {:ok, spec} =
        DialoguePlanningService.plan_agent_run(
          %{
            text: "把上一条原文保存为作品设定",
            workspace_id: "ws-guard",
            work_id: "work-guard",
            session_id: "session-guard",
            turn_id: "guard-#{inspect(reason)}"
          },
          nil,
          execution
        )

      {:ok, run} = AgentRun.new(spec.run_attrs)

      assert {_context, {:error, ^reason, _state}} =
               drive_judgment_result(spec, run, fn _ -> :ok end)
    end
  end

  @tag :r08_author_sources
  test "R08 按真实 ref 取本条原文，短句含过去词也不能由机械词法拒绝" do
    original = "  将本条原文登记为候选：上次潮来。\r\n"
    source_ref = "r08-current-original"

    execution =
      registration_execution(source_ref, narrative: "这条原文已形成待采纳候选。")

    {:ok, spec} =
      DialoguePlanningService.plan_agent_run(
        %{
          text: original,
          workspace_id: "r08-current-work",
          work_id: "r08-current-work",
          session_id: "r08-current-session",
          turn_id: source_ref
        },
        nil,
        execution
      )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    {_context, result} = drive_judgment(spec, run, fn _ -> :ok end)

    assert [pending] = result.turn_result.adoption_state.pending
    assert pending.requires_adoption
    assert [%{body: ^original, provider_call_ref: provenance}] = pending.payload.items
    assert provenance == "author_input:" <> source_ref
  end

  @tag :r08_author_sources
  test "R08 最近十条目录外的完整 canonical 作者原文仍可登记，物化绑定真实原字节" do
    parent = self()
    {:ok, work} = WorkRepo.create(%{title: "R08 历史作者来源"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    original = "  山城的旧钟只在退潮时鸣响。\r\n保留 e\u0301 与 👩‍💻。  "
    source_ref = "r08-original-author-input"

    for index <- 0..12 do
      run_id = "r08-source-run-#{index}"
      ref = if index == 0, do: source_ref, else: "r08-later-input-#{index}"
      text = if index == 0, do: original, else: "第 #{index} 条讨论，尚未成为作品事实。"

      assert {:ok, _} =
               InteractionLifecycle.call(:receive, %{
                 workspace_id: work.id,
                 session_id: session.id,
                 run_id: run_id,
                 turn_id: ref,
                 text: text
               })

      transcript =
        AuthoringTranscript.new(
          %{
            run_id: run_id,
            workspace_id: work.id,
            work_id: work.id,
            session_id: session.id,
            parent_turn_ref: "run-parent-#{index}"
          },
          base_text: "创作会话",
          author_text: text,
          author_turn_ref: ref
        )

      assert :ok =
               TestAgenticLoopFixtures.append_segment!(
                 transcript,
                 status: "completed"
               )
    end

    recent = InteractionLifecycle.context(work.id, session.id).author_inputs
    assert length(recent) == 10
    refute Enum.any?(recent, &(&1.turn_ref == source_ref))

    execution =
      registration_execution(source_ref,
        narrative: "已将你指定的原文形成待采纳候选。",
        on_prompt: fn request -> send(parent, {:r08_history_request, request}) end
      )

    {:ok, spec} =
      DialoguePlanningService.plan_agent_run(
        %{
          text: "请将那条山城旧钟的原文登记为候选。",
          workspace_id: work.id,
          work_id: work.id,
          session_id: session.id,
          turn_id: "r08-register-history"
        },
        WorkspaceContext.context_fetcher_with_query(),
        execution
      )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    {_context, result} = drive_judgment(spec, run, fn _ -> :ok end, session_history: true)

    assert_receive {:r08_history_request, request}

    assert Enum.any?(request.messages, fn message ->
             message.role == "user" and message.provenance == "author" and
               message.source_refs == [%{ref: source_ref}] and
               message.blocks == [%{type: "text", text: original}]
           end)

    assert [pending] = result.turn_result.adoption_state.pending
    assert pending.requires_adoption
    assert [%{body: ^original, provider_call_ref: provenance}] = pending.payload.items
    assert provenance == "author_input:" <> source_ref
    assert WorkSessionRepo.user_entry(work.id, session.id, source_ref).content["text"] == original
  end

  test "Q3c 作者内容物化：注册信号把作者消息字节变成待采纳 world_setting 候选" do
    author_text = "把这份大纲直接存档为作品设定：主角李衡靠账单推演天机，第一卷从记账学徒写到执掌灵市。"

    provider_execution =
      registration_execution("turn-acr",
        narrative: "我没有直接写入档案的能力；已把你的原文整理成待采纳候选，采纳后入档。",
        dialogue_goal: "把作者提供的内容登记进作品档案"
      )

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: author_text,
                 workspace_id: "ws-acr",
                 work_id: "work-acr",
                 session_id: "session-acr",
                 turn_id: "turn-acr"
               },
               nil,
               provider_execution
             )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    sink = fn _event -> :ok end
    {_context_result, judgment_result} = drive_judgment(spec, run, sink)

    turn_result = judgment_result.turn_result
    assert turn_result.frame_summary.frame_type == :casual_reply

    # 字节纯度：body 精确等于作者消息、title 是 body 字符前缀、来源 ref 结构化
    assert [pending] = turn_result.adoption_state.pending
    assert pending.artifact_type == :world_setting
    assert pending.requires_adoption == true

    item = pending.payload.items |> List.first()
    assert item.body == author_text
    assert String.starts_with?(item.body, item.title)
    assert item.provider_call_ref == "author_input:turn-acr"
    assert item.rationale == nil

    # 采纳动作在场（AU-09 组装复用）；未采纳零写入由采纳链既有边界保证
    assert Enum.any?(turn_result.available_actions, &(&1.action_type == "accept"))
  end

  defp registration_execution(source_ref, opts) do
    narrative = Keyword.get(opts, :narrative, "这是一个明确的创作动作，准备生成待采纳候选。")
    goal = Keyword.get(opts, :dialogue_goal, "推进作者本轮创作目标")
    on_prompt = Keyword.get(opts, :on_prompt, fn _ -> :ok end)

    call =
      TestAgenticLoopFixtures.judgment_call("register_author_content", %{
        author_content_source_ref: source_ref,
        dialogue_goal: goal,
        author_reasoning: narrative
      })

    calls =
      if Keyword.get(opts, :duplicate_call, false),
        do: [call, %{call | id: call.id <> "-second"}],
        else: [call]

    %Execution{
      result_fn: fn request ->
        on_prompt.(request)
        ref = TestAgenticLoopFixtures.unique_provider_call_id("registration")
        {:ok, TestAgenticLoopFixtures.judgment_response("", calls, ref)}
      end
    }
  end

  defp source_request(text \\ "当前完整作者原文。", ref \\ "current-source") do
    transcript =
      AuthoringTranscript.new(
        %{
          run_id: "registration-run",
          workspace_id: "registration-work",
          work_id: "registration-work",
          session_id: "registration-session",
          parent_turn_ref: "run-parent-is-not-author-ref"
        },
        base_text: "依据实际作者原文判断。",
        initial_scope: %{
          content: %{
            work_id: "registration-work",
            goal: %{provenance: "application", version: 1, source_input_ref: ref}
          },
          versions: %{},
          source_refs: []
        },
        author_text: text,
        author_turn_ref: ref
      )

    assert {:ok, request} = AuthoringTranscript.to_request_ir(transcript)
    request
  end

  defp append_author(request, text, ref) do
    assert {:ok, [message]} = RequestIR.author_input_messages(text, ref)
    messages = MessageCoverage.annotate(request.messages ++ [message], request.run)
    %{request | messages: messages}
  end

  defp registration(ref),
    do: %{action: "author_content_registration", author_content_source_ref: ref}

  defp sha256(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)
end
