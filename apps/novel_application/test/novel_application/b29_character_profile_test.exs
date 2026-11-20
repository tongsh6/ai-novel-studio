defmodule NovelApplication.B29CharacterProfileTest do
  use ExUnit.Case, async: true

  alias NovelApplication.{CapabilityRegistry, CharacterProfile}

  @shen_ref "character:11111111-1111-1111-1111-111111111111"
  @gu_ref "character:22222222-2222-2222-2222-222222222222"
  @shen2_ref "character:33333333-3333-3333-3333-333333333333"

  defp target(ref, name, aliases, role, summary \\ "角色摘要") do
    %{
      character_ref: ref,
      name: name,
      aliases: aliases,
      role: "身份",
      summary: summary,
      narrative_role: role,
      status: "ACCEPTED",
      updated_at: "2026-10-24T22:24:08Z",
      base_fingerprint: "fp-#{ref}"
    }
  end

  defp roster do
    [
      target(@shen_ref, "沈砚", ["老沈"], "ENSEMBLE_POV"),
      target(@gu_ref, "顾青", [], "PROTAGONIST"),
      target(@shen2_ref, "沈砚", ["小沈"], "MINOR")
    ]
  end

  test "能力注册：revise_character_profile 与 design/evolution 严格区分" do
    entry = CapabilityRegistry.get("revise_character_profile")

    assert entry
    assert entry.provider_dependency == :none
    assert entry.write_scopes == ["character_dossier"]
    assert entry.status == :active
    assert entry.effect_summary =~ "修订既有角色主档案字段"
    assert entry.effect_summary =~ "不新建角色"
    assert entry.effect_summary =~ "不写正文"
    assert entry.effect_summary =~ "不冒充角色演化记忆"
    assert "revise_character_profile" in CapabilityRegistry.list()

    refute entry == CapabilityRegistry.get("character_design")
    refute entry == CapabilityRegistry.get("character_evolution")
  end

  test "narrative_role 白名单从原话映射（修订意图路由已移交 B33 判断链）" do
    assert CharacterProfile.narrative_role_from_text("指定沈砚为主角") == "PROTAGONIST"
    assert CharacterProfile.narrative_role_from_text("把顾青改成反派") == "ANTAGONIST"
    assert CharacterProfile.narrative_role_from_text("把已有角色的叙事身份从配角改为主角") == "PROTAGONIST"
    assert CharacterProfile.narrative_role_from_text("把阿鸢设为配角") == "SUPPORTING"
    assert CharacterProfile.narrative_role_from_text("把沈砚定为主角") == "PROTAGONIST"
    assert CharacterProfile.narrative_role_from_text("随便聊聊") == nil
  end

  test "候选 payload：目标旧→新 + 唯一主角时其它角色变化供裁决（不默认应用）" do
    shen = target(@shen_ref, "沈砚", ["老沈"], "ENSEMBLE_POV")

    assert {:ok, payload} =
             CharacterProfile.build_candidate(
               shen,
               "PROTAGONIST",
               "把沈砚定为唯一主角，替换原主角",
               roster()
             )

    assert payload.object_kind == "character_profile_revision"
    assert payload.character_ref == @shen_ref
    assert payload.character_name == "沈砚"
    assert payload.base_fingerprint == "fp-#{@shen_ref}"
    assert payload.effects == ["character_field_update"]

    assert payload.changes == [
             %{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}
           ]

    assert payload.adoption_effect == %{
             mode: "character_field_update",
             character_ref: @shen_ref
           }

    # 采纳 payload 首闭环只改目标；既有另一个 PROTAGONIST（顾青）只作建议展示
    assert payload.other_character_changes == []

    assert [%{character_ref: @gu_ref, character_name: "顾青"}] =
             payload.suggested_other_character_changes

    assert :ok = CharacterProfile.validate_changes(payload)

    # 普通指定（非唯一）不生成其它角色变化建议
    {:ok, normal} = CharacterProfile.build_candidate(shen, "PROTAGONIST", "把沈砚设为主角", roster())
    assert normal.other_character_changes == []
    assert normal.suggested_other_character_changes == []

    # 白名单/枚举校验
    assert {:error, :unsupported_field} =
             CharacterProfile.validate_changes(%{changes: [%{field: "aliases", new: "x"}]})

    assert {:error, :invalid_character_role} =
             CharacterProfile.validate_changes(%{
               changes: [%{field: "narrative_role", old: "MINOR", new: "VILLAIN"}],
               effects: ["character_field_update"]
             })

    assert {:error, :invalid_character_role} =
             CharacterProfile.build_candidate(shen, "VILLAIN", "把沈砚设为主角", roster())
  end

  # B48 CP1（C04=A）：old==new 不产生候选；合法无变化出口用普通说明，保留真实检查事实。
  test "B48 no-op：old==new 返回 no_change 事实，不生成候选变化" do
    protagonist = target(@gu_ref, "顾青", [], "PROTAGONIST")

    assert {:no_change,
            %{character_ref: @gu_ref, old_role: "PROTAGONIST", desired_role: "PROTAGONIST"}} =
             CharacterProfile.build_candidate(
               protagonist,
               "PROTAGONIST",
               "指定顾青为主角",
               roster()
             )

    # 真实修订仍走候选链（不得被 no-op 守卫误伤）
    ensemble = target(@shen_ref, "沈砚", ["老沈"], "ENSEMBLE_POV")

    assert {:ok, %{changes: [%{old: "ENSEMBLE_POV", new: "PROTAGONIST"}]}} =
             CharacterProfile.build_candidate(
               ensemble,
               "PROTAGONIST",
               "指定沈砚为主角",
               roster()
             )
  end
end

defmodule NovelApplication.B29CharacterProfileObservedDispatchTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.{ExplorationService, PendingArtifactWorkflow, WorkService}
  alias NovelDomain.DialogueContext
  alias NovelPersistence.{AdoptionRepository, Repo}
  alias NovelPersistence.Schemas.Character

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{"title" => "角色求证派发"})

    character =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "林澈",
        aliases: ["老林"],
        role: "调查员",
        summary: "作者确认的基线",
        narrative_role: "ENSEMBLE_POV",
        status: "ACCEPTED"
      })

    ref = "character:#{character.id}"
    {:ok, fact} = AdoptionRepository.character_profile_context(work.id, ref)
    %{work: work, character: character, ref: ref, fact: fact}
  end

  @tag :scope_archive
  test "实际派发拒绝猜中的未读角色与仅目录观察", ctx do
    assert {:error, {:character_profile_invalid, :not_observed}} = dispatch(ctx, nil)
    assert {:ok, directory} = ExplorationService.run(ctx.work.id, "archive_read", "characters")

    assert {:error, {:character_profile_invalid, :not_observed}} =
             dispatch(ctx, canonical_observation(directory))
  end

  @tag :scope_archive
  test "协议后作者改写基线，派发不能悄悄采用重新读取的新指纹", ctx do
    observed = source_observation(ctx)
    ctx.character |> Ecto.Changeset.change(summary: "作者刚写入的新事实") |> Repo.update!()
    {:ok, latest} = AdoptionRepository.character_profile_context(ctx.work.id, ctx.ref)
    refute latest.base_fingerprint == ctx.fact.base_fingerprint

    assert {:error, {:character_profile_invalid, :stale_base}} = dispatch(ctx, observed)
    assert Repo.get!(Character, ctx.character.id).narrative_role == "ENSEMBLE_POV"
  end

  @tag :scope_archive
  test "实际派发只用同一次详情观察基线生成候选，零模型调用且未采纳零作品写入", ctx do
    previous =
      Repo.insert!(%Character{
        work_id: ctx.work.id,
        name: "顾青",
        narrative_role: "PROTAGONIST",
        status: "ACCEPTED"
      })

    assert {:ok, result} = dispatch(ctx, source_observation(ctx), author_text: "把林澈定为唯一主角，替换原主角")
    assert result.provider_call_count == 0
    assert [pending] = result.turn_result.adoption_state.pending
    assert pending.payload.base_fingerprint == ctx.fact.base_fingerprint
    assert pending.payload.character_ref == ctx.ref
    assert pending.adoption_status == NovelDomain.AdoptionStatus.initial()
    assert pending.payload.effects == ["character_field_update"]

    assert pending.payload.adoption_effect == %{
             mode: "character_field_update",
             character_ref: ctx.ref
           }

    assert pending.payload.other_character_changes == []

    assert Enum.map(pending.payload.suggested_other_character_changes, & &1.character_ref) ==
             ["character:#{previous.id}"]

    assert [item] = pending.payload.items
    assert item.body =~ "叙事身份：群像视角 → 主角"
    assert item.body =~ "候选尚未采纳，角色档案尚未修改。"
    assert item.body =~ "其它角色（需作者逐项裁决"
    assert item.body =~ "顾青（当前：主角）；未自动修改"
    refute item.body =~ "character:"
    refute item.body =~ "narrative_role"
    refute item.body =~ "PROTAGONIST"
    assert pending.payload.title =~ "林澈"
    assert Repo.get!(Character, previous.id).narrative_role == "PROTAGONIST"

    assert pending.payload.changes == [
             %{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}
           ]

    assert Repo.get!(Character, ctx.character.id).narrative_role == "ENSEMBLE_POV"
  end

  test "同名对象只绑定已读详情的精确 ref；缺 ref 不再按作者名字猜测", ctx do
    duplicate =
      Repo.insert!(%Character{
        work_id: ctx.work.id,
        name: "林澈",
        aliases: ["小林"],
        narrative_role: "MINOR",
        status: "ACCEPTED"
      })

    duplicate_ref = "character:#{duplicate.id}"
    observed = source_observation(ctx)

    assert {:error, {:character_profile_invalid, :not_observed}} =
             dispatch(ctx, observed, character_ref: duplicate_ref)

    assert {:error, {:character_profile_invalid, :target_missing}} =
             dispatch(ctx, observed, character_ref: nil)

    assert {:error, {:character_profile_invalid, :target_missing}} =
             dispatch(ctx, observed, character_ref: "character:#{Ecto.UUID.generate()}")

    query = Jason.encode!(%{facet: "characters", ref: duplicate_ref, offset: 0})
    assert {:ok, detail} = ExplorationService.run(ctx.work.id, "archive_read", query)

    assert {:ok, result} =
             dispatch(ctx, canonical_observation(detail),
               character_ref: duplicate_ref,
               author_text: "把小林改为配角"
             )

    [pending] = result.turn_result.adoption_state.pending
    assert pending.payload.character_ref == duplicate_ref

    assert pending.payload.changes == [
             %{field: "narrative_role", old: "MINOR", new: "SUPPORTING"}
           ]
  end

  test "已读同值修订仍是普通说明且每次留下实际裁决 trace，零候选零作品写入", ctx do
    ctx.character |> Ecto.Changeset.change(narrative_role: "PROTAGONIST") |> Repo.update!()
    {:ok, current} = AdoptionRepository.character_profile_context(ctx.work.id, ctx.ref)
    ctx = %{ctx | fact: current}
    parent = self()

    persist = fn _work, attrs ->
      send(parent, {:trace, attrs})
      :ok
    end

    for _attempt <- 1..2 do
      assert {:ok, result} = dispatch(ctx, source_observation(ctx), trace_persister: persist)
      assert result.provider_call_count == 0
      assert result.artifact_refs == []
      refute Map.get(result.turn_result, :adoption_state)
      assert result.turn_result.frame_summary.frame_type == :reply_only
      assert result.turn_result.available_actions == []
      assert result.turn_result.assistant_message.text == "按已读档案提出叙事身份候选。"
      assert [card] = result.turn_result.ui_cards
      assert card.card_type == "result_card"
      assert card.title == "系统核对结果"
      assert card.body =~ "林澈（别名：老林；身份：调查员；当前：主角）"
      assert card.body =~ "本次无需修改"
      refute card.body =~ "PROTAGONIST"
      assert result.turn_result.truthfulness.production_write_performed == false
      trace_ref = result.turn_result.orchestrator_decision.decision_trace_ref
      assert_receive {:trace, attrs}
      assert attrs.trace_id == trace_ref
      assert to_string(attrs.decision_type) == "character_profile_revision"
    end

    assert Repo.get!(Character, ctx.character.id).narrative_role == "PROTAGONIST"
  end

  test "判断接收在作者可辨认性缺失时拒绝，隐藏身份和摘要不能代替可见区别", ctx do
    duplicate_role(ctx)
    observed = source_observation(ctx)

    judgment = %{
      action: "execute",
      capability: "revise_character_profile",
      character_ref: ctx.ref,
      author_input: "把老林设为主角"
    }

    assert {:error, {:character_profile_invalid, :display_identity_ambiguous}} =
             NovelApplication.CharacterProfile.bind_judgment(judgment, ctx.work.id, [observed])

    assert {:error, {:character_profile_invalid, :display_identity_ambiguous}} =
             dispatch(ctx, observed)

    assert Repo.get!(Character, ctx.character.id).narrative_role == "ENSEMBLE_POV"
  end

  test "JP 的未决显示歧义不能被普通回复、无关执行或再次无效执行当作已解决", ctx do
    duplicate_role(ctx)
    input = role_judgment_input(ctx, [source_observation(ctx)])
    initial = role_decision(ctx.ref, "role-initial")

    unrelated = %{
      id: "role-unrelated",
      name: "judgment_decision",
      arguments: %{
        action: "execute",
        capability: "character_design",
        dialogue_goal: "另建角色",
        author_reasoning: "我会另建一个角色。"
      }
    }

    for {text, calls} <- [
          {"已经处理好了。", []},
          {"", [unrelated]},
          {"", [role_decision(ctx.ref, "role-invalid-again")]}
        ] do
      provider =
        role_execution([
          role_response("", [initial], "first"),
          role_response(text, calls, "second")
        ])

      assert {:error,
              {:judgment_protocol_violation,
               {:character_profile_invalid, :display_identity_ambiguous}}, state} =
               NovelApplication.JudgmentProtocol.request_judgment(provider, %{}, input)

      assert state.provider_call_count == 2

      assert Enum.any?(state.judgment_transcript.messages, fn message ->
               Enum.any?(message.blocks, fn block ->
                 block[:type] == "validation_result" and block[:call_id] == "role-initial" and
                   block[:status] == "failed"
               end)
             end)
    end

    assert Repo.get!(Character, ctx.character.id).narrative_role == "ENSEMBLE_POV"
  end

  test "不可辨认角色不能用同可见标签的不同目标选项伪装已澄清", ctx do
    other = duplicate_role(ctx)
    input = role_judgment_input(ctx, [source_observation(ctx)])

    # 空白标签属于既有非空 schema；其它反例补可见投影的选择唯一性。
    for {labels, reason} <- [
          {["林澈", "林澈"], :question_option_labels_invalid},
          {["  林澈 ", "林澈"], :question_option_labels_invalid},
          {["林澈\t调查员", "林澈 调查员"], :question_option_labels_invalid},
          {["林澈\r\n调查员", "林澈 调查员"], :question_option_labels_invalid},
          {[" \t\r\n\f "], :invalid_tool_arguments}
        ] do
      options =
        Enum.zip_with([ctx.ref, "character:#{other.id}"], labels, &%{value: &1, label: &2})

      ask = %{
        id: "role-ambiguous-choice",
        name: "ask_author",
        arguments: %{
          question: "哪位林澈需要修订？",
          options: options
        }
      }

      provider =
        role_execution([
          role_response("", [role_decision(ctx.ref, "role-initial")], "first"),
          role_response("", [ask], "second")
        ])

      assert {:error, {:judgment_protocol_violation, ^reason}, state} =
               NovelApplication.JudgmentProtocol.request_judgment(provider, %{}, input)

      assert state.provider_call_count == 2

      assert Enum.any?(state.judgment_transcript.messages, fn message ->
               Enum.any?(message.blocks, fn block ->
                 block[:type] == "validation_result" and block[:status] == "failed" and
                   block[:call_id] == "role-ambiguous-choice" and
                   block[:reason_code] == Atom.to_string(reason)
               end)
             end)
    end

    assert Repo.get!(Character, ctx.character.id).narrative_role == "ENSEMBLE_POV"
  end

  test "同标签首答纠错后才交付可区分选项，question和label原字节保持", ctx do
    input = role_judgment_input(ctx, [source_observation(ctx)])
    question = "  先补充身份信息，还是暂缓本次修订？\n"
    bad_options = [%{value: "clarify", label: "继续"}, %{value: "pause", label: "继续"}]
    options = [%{value: "clarify", label: "  补充身份说明\n"}, %{value: "pause", label: " 暂缓修订\t"}]

    bad = %{
      id: "role-ambiguous-choice",
      name: "ask_author",
      arguments: %{question: question, options: bad_options}
    }

    good = %{
      id: "role-clear-choice",
      name: "ask_author",
      arguments: %{question: question, options: options}
    }

    provider =
      role_execution([
        role_response("", [bad], "labels-first"),
        role_response("", [good], "labels-second")
      ])

    assert {:ok, judgment} =
             NovelApplication.JudgmentProtocol.request_judgment(provider, %{}, input)

    assert judgment.provider_call_count == 2
    assert judgment.question == question
    assert judgment.options == options
    assert judgment.narrative_source.provider_call_ref == "call-role-labels-second"

    result =
      NovelApplication.AuthorQuestion.attach(
        %{turn_id: "role-choice-turn"},
        judgment,
        input.options[:plan_run]
      )

    assert result.author_question.options == options

    assert Enum.map(Enum.take(result.available_actions, 2), &{&1.candidate_ref, &1.label}) ==
             [{"clarify", "  补充身份说明\n"}, {"pause", " 暂缓修订\t"}]
  end

  test "JP 真实 ask_author 才能把不可辨认角色交给作者决定，保留原失败回执", ctx do
    duplicate_role(ctx)
    question = "两份林澈档案的姓名、别名和身份相同，请先补充能区分他们的信息。"
    ask = %{id: "role-ask", name: "ask_author", arguments: %{question: question, options: []}}

    provider =
      role_execution([
        role_response("", [role_decision(ctx.ref, "role-initial")], "first"),
        role_response("", [ask], "second")
      ])

    assert {:ok, judgment} =
             NovelApplication.JudgmentProtocol.request_judgment(
               provider,
               %{},
               role_judgment_input(ctx, [source_observation(ctx)])
             )

    assert judgment.action == "await_author"
    assert judgment.question == question
    assert judgment.narrative == question
    assert judgment.provider_call_count == 2
    refute Map.has_key?(judgment, :character_observation)

    assert Enum.any?(judgment.transcript.messages, fn message ->
             Enum.any?(
               message.blocks,
               &(&1[:call_id] == "role-initial" and &1[:status] == "failed")
             )
           end)
  end

  test "JP 可接受重新绑定到作者指明且已读、可辨认的实际角色", ctx do
    duplicate_role(ctx)

    intended =
      Repo.insert!(%Character{
        work_id: ctx.work.id,
        name: "林澈",
        aliases: ["老林"],
        role: "调查主管",
        summary: "作者明确指定的主管",
        narrative_role: "SUPPORTING",
        status: "ACCEPTED"
      })

    ref = "character:#{intended.id}"
    {:ok, fact} = AdoptionRepository.character_profile_context(ctx.work.id, ref)
    intended_ctx = %{ctx | character: intended, ref: ref, fact: fact}

    input =
      role_judgment_input(
        ctx,
        [source_observation(ctx), source_observation(intended_ctx)],
        "把调查主管老林设为主角"
      )

    provider =
      role_execution([
        role_response("", [role_decision(ctx.ref, "role-initial")], "first"),
        role_response("", [role_decision(ref, "role-corrected")], "second")
      ])

    assert {:ok, judgment} =
             NovelApplication.JudgmentProtocol.request_judgment(provider, %{}, input)

    assert judgment.action == "execute"
    assert judgment.capability == "revise_character_profile"
    assert judgment.character_ref == ref
    assert judgment.character_observation.coverage["ref"] == ref
    assert judgment.provider_call_count == 2
    assert Repo.get!(Character, intended.id).narrative_role == "SUPPORTING"
    assert Repo.get!(Character, ctx.character.id).narrative_role == "ENSEMBLE_POV"
  end

  defp duplicate_role(ctx) do
    Repo.insert!(%Character{
      work_id: ctx.work.id,
      name: ctx.character.name,
      aliases: ctx.character.aliases,
      role: ctx.character.role,
      narrative_role: ctx.character.narrative_role,
      status: "ACCEPTED",
      summary: "另一份隐藏摘要，不能当成可见区分"
    })
  end

  defp role_judgment_input(ctx, observations, author_text \\ "把老林设为主角") do
    {:ok, run} =
      NovelDomain.AgentRun.new(%{
        run_id: "run-role-display",
        work_id: ctx.work.id,
        workspace_id: ctx.work.id,
        session_id: "session-role-display",
        parent_turn_ref: "role-author-turn",
        origin_frame_ref: "frame-role-display",
        profile_ref: "judgment_plan_v1",
        goal: %{text: author_text, version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["revise_character_profile"]}
      })

    input = %{
      author_text: author_text,
      source_input_ref: "role-author-turn",
      scope: %{
        work_id: ctx.work.id,
        facts: %{work: %{ref: "work:#{ctx.work.id}", work_id: ctx.work.id, title: "角色可辨认性"}},
        context: %{},
        coverage: %{}
      },
      supplied_context_refs: ["work:#{ctx.work.id}"],
      options: [plan_run: run, capabilities: ["revise_character_profile", "character_design"]]
    }

    {:ok, transcript} = NovelApplication.JudgmentProtocol.transcript_for_production(input)

    transcript =
      Enum.reduce(Enum.with_index(observations), transcript, fn {observation, index}, acc ->
        call_id = "role-read-#{index}"

        call =
          NovelCommon.RequestIR.tool_call_block(
            "judgment_decision",
            %{
              action: "explore",
              dialogue_goal: "读取角色档案",
              author_reasoning: "核对角色身份。",
              explore_request: %{tool: "archive_read", query: "characters"}
            },
            call_id
          )

        acc
        |> NovelApplication.AuthoringTranscript.append_assistant("", [call])
        |> NovelApplication.AuthoringTranscript.append_observation(call_id, observation)
      end)

    Map.put(input, :transcript, transcript)
  end

  defp role_decision(ref, id) do
    %{
      id: id,
      name: "judgment_decision",
      arguments: %{
        action: "execute",
        capability: "revise_character_profile",
        character_ref: ref,
        dialogue_goal: "指定老林为主角",
        author_reasoning: "根据已读档案提出角色修订。"
      }
    }
  end

  defp role_response(text, calls, ref) do
    %{
      content: text,
      tool_calls: calls,
      provider_output: %NovelCommon.Contracts.ProviderOutput{
        provider_run_ref: "run-role-#{ref}",
        provider_call_ref: "call-role-#{ref}",
        status: :ok,
        content: %{text: text, tool_calls: calls}
      }
    }
  end

  defp role_execution(responses) do
    key = make_ref()
    Process.put(key, responses)

    %Execution{
      result_fn: fn _request ->
        [response | rest] = Process.get(key)
        Process.put(key, rest)
        {:ok, response}
      end
    }
  end

  defp dispatch(ctx, observation, opts \\ []) do
    {:ok, run} =
      NovelDomain.AgentRun.new(%{
        run_id: "run-observed-role",
        run_mode: :bounded,
        profile_ref: "judgment_loop_v1",
        origin_frame_ref: "frame-observed-role",
        status: :running,
        phase: :executing,
        workspace_id: ctx.work.id,
        work_id: ctx.work.id,
        session_id: "session-observed-role",
        parent_turn_ref: "turn-observed-role",
        goal: %{text: Keyword.get(opts, :author_text, "把林澈改为主角"), version: 1},
        budget: %{
          max_steps: 5,
          max_tool_calls: 2,
          max_provider_calls: 2,
          max_replans: 1,
          max_pending_artifacts: 3
        },
        consumed_budget: %{
          steps: 0,
          execution_steps: 0,
          tool_calls: 0,
          provider_calls: 0,
          replans: 0
        },
        authority_scope: %{production_write: false, allowed_tools: ["judgment"]}
      })

    judgment = %{
      action: "execute",
      capability: "revise_character_profile",
      character_ref: Keyword.get(opts, :character_ref, ctx.ref),
      dialogue_goal: run.goal.text,
      narrative: "按已读档案提出叙事身份候选。",
      reason: "character_profile_revision",
      frame_type: "execution_candidate",
      candidate_directions: [],
      options: [],
      question: nil,
      reason_codes: [],
      pending_artifact_ref: nil,
      adopted_content_ref: nil,
      character_observation: observation
    }

    input = %{
      trace_persister: Keyword.get(opts, :trace_persister, fn _work, _attrs -> :ok end)
    }

    context = %DialogueContext{work_id: ctx.work.id, interaction_state: %{}}
    provider = %Execution{result_fn: fn _ -> flunk("角色字段候选不得调用模型") end}
    PendingArtifactWorkflow.run(judgment, input, run, context, provider)
  end

  # 独立使用持久读端口取得的已读事实；不从被测派发或新 reader 反推预期。
  defp source_observation(ctx) do
    %{
      tool: "archive_read",
      query: Jason.encode!(%{facet: "characters", ref: ctx.ref, offset: 0}),
      outcome: :observed,
      summary: ctx.fact.summary,
      refs: [ctx.ref],
      versions: %{ctx.ref => ctx.fact.base_fingerprint},
      facts: %{character: Map.delete(ctx.fact, :summary)},
      coverage: %{
        kind: "detail",
        facet: "characters",
        work_id: ctx.work.id,
        ref: ctx.ref,
        complete_fields: [
          "character_ref",
          "name",
          "aliases",
          "role",
          "narrative_role",
          "status",
          "updated_at",
          "base_fingerprint"
        ],
        summary: %{
          offset: 0,
          returned_graphemes: String.length(ctx.fact.summary),
          total_graphemes: String.length(ctx.fact.summary),
          offset_unit: "unicode_grapheme"
        }
      },
      omissions: [],
      next_offset: nil
    }
    |> canonical_observation()
  end

  defp canonical_observation(raw) do
    %{messages: [%{blocks: [leaf]}]} =
      NovelApplication.JudgmentProtocol.observation_transcript(
        %{messages: [], observation_refs: []},
        %{tool_call_id: "observed-role-read"},
        raw
      )

    leaf
  end
end
