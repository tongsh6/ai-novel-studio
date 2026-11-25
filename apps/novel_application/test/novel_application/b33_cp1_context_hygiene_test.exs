defmodule NovelApplication.B33CP1ContextHygieneTest do
  use ExUnit.Case, async: true

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AgentRunFlows.ProseDraftingWithQuality
  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.CharacterProfile
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.ExplorationService
  alias NovelApplication.JudgmentProtocol
  alias NovelApplication.JudgmentToolContract
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.AgentRun
  alias NovelDomain.DialogueContext
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Character, Work}
  alias NovelPersistence.WorkSessionRepo

  defp context(overrides \\ %{}) do
    base = %DialogueContext{
      work_id: "w-b33",
      source_status: %{
        work: :ok,
        chapters: :ok,
        behavior: :ok,
        interaction: :ok,
        conversation: :ok,
        memory: :empty
      },
      current_work_snapshot: %{
        title: "灯楼夜雨",
        genre: "悬疑",
        target_length: 200_000,
        planned_volumes: 3
      },
      current_chapters: ["第01章：灯楼夜雨", "第02章：井底回声"],
      structured_chapters: [
        %{
          id: "chapter-1",
          title: "第01章：灯楼夜雨",
          seq: 1,
          has_prose: true,
          word_count: 900,
          char_count: 950,
          accepted_draft_count: 3,
          scene_count: 3,
          current_draft_refs: ["draft:d1:1", "draft:d2:1", "draft:d3:1"],
          superseded_draft_count: 1,
          chapter_status: "DRAFTING",
          summary_status: "ACCEPTED",
          plan_direction: %{opening_hook: "第七盏灯自亮"}
        },
        %{
          id: "chapter-2",
          title: "第02章：井底回声",
          seq: 2,
          has_prose: false,
          word_count: 0,
          plan_direction: %{plot_progress: "下井"}
        }
      ],
      conversation_summary: "长会话摘要：" <> String.duplicate("历史讨论内容。", 200),
      open_behavior_summary: "开放行为摘要：" <> String.duplicate("观察。", 120),
      interaction_state: %{
        pending_adoptions:
          for i <- 1..10 do
            %{
              artifact_id: "as_pending_#{i}",
              adoption_status: "PENDING",
              artifact_type: "prose_fragment",
              title: "候选 #{i}",
              preview: String.duplicate("候选正文预览。", 80)
            }
          end,
        resolved_adoptions:
          for i <- 1..10 do
            %{
              artifact_id: "as_resolved_#{i}",
              adoption_status: "ACCEPTED",
              artifact_type: "prose_fragment",
              title: "已采纳 #{i}",
              preview: String.duplicate("已采纳正文预览。", 80)
            }
          end,
        author_inputs: [%{turn_ref: "turn-b33", text: "第02章正文还没写，帮我写出来吧。"}],
        recent_results: []
      }
    }

    struct(base, overrides)
  end

  defp protocol_input(context, run, author_text \\ "第02章正文还没写，帮我写出来吧。") do
    DialoguePlanningService.judgment_protocol_input_for_test(
      %{text: author_text},
      run,
      context,
      []
    )
  end

  defp prompt_content(protocol_input) do
    protocol_input
    |> JudgmentProtocol.request_for_production()
    |> NovelApplication.TestAgenticLoopFixtures.prompt_text()
  end

  @tag :r03_scope
  test "R03 默认判断不供应未选择的章节材料、角色名册或第二套章目标目录" do
    :ok = Sandbox.checkout(Repo)
    work = Repo.insert!(%Work{title: "实际绑定作品"})

    character =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "默认供给不得出现的旧作人物",
        summary: "未读取的角色正文" <> String.duplicate("旧故事细节。", 100),
        narrative_role: "PROTAGONIST",
        status: AdoptionStatus.accepted()
      })

    value =
      context(%{
        work_id: work.id,
        current_work_snapshot: %{title: work.title, revision: 7}
      })

    for {author_text, index} <-
          Enum.with_index(["请比较这个新故事的两种叙事方案。", "先只讨论，不读取作品，也不改设定。"], 1) do
      run = scope_run(work.id, author_text, "materials-#{index}")

      request =
        protocol_input(value, run, author_text) |> JudgmentProtocol.request_for_production()

      scope = NovelTest.TestProviderPrompt.scope_content(request)
      content = NovelApplication.TestAgenticLoopFixtures.prompt_text(request)

      assert Map.keys(scope["facts"]) == ["work"]

      assert scope["facts"]["work"] == %{
               "ref" => "work:#{work.id}",
               "work_id" => work.id,
               "title" => work.title,
               "version" => 7
             }

      refute Map.has_key?(scope["operation"], "chapter_revision_targets")
      refute content =~ "第七盏灯自亮"
      refute content =~ "下井"
      refute content =~ character.name
      refute content =~ character.summary
      assert request.refs.base_refs == [%{ref: "work:#{work.id}"}]

      assert [%{blocks: [%{type: "text", text: ^author_text}]}] =
               Enum.filter(request.messages, &(&1.role == "user"))
    end
  end

  @tag :r03_scope
  test "R03 交互只供应真实处置元数据，历史作者与回复文字保持 canonical 单一来源" do
    author_text = "  继续核对尚未完成的风险表。\n不要把暂定选择算成完成。\t"
    old_author = "早期作者原话：风险表仍待完成。"
    old_reply = "早期模型回复：尚未交付风险表。"
    handling = %{status: "completed", processed_at: "2026-11-15T00:00:00Z"}
    truthfulness = %{production_write_performed: false, artifact_adopted: false}

    state = %{
      author_inputs: [
        %{turn_ref: "earlier-input", run_ref: "earlier-run", text: old_author, handling: handling}
      ],
      recent_results: [
        %{
          turn_ref: "earlier-input",
          run_ref: "earlier-run",
          text: old_reply,
          truthfulness: truthfulness
        }
      ],
      pending_adoptions: [],
      resolved_adoptions: []
    }

    run = scope_run("w-b33", author_text, "state")
    input = protocol_input(context(%{interaction_state: state}), run, author_text)

    prior =
      AuthoringTranscript.new(NovelCommon.RequestIR.run_envelope(run),
        base_text: NovelCommon.RequestIR.application_base_text(),
        author_text: old_author,
        author_turn_ref: "earlier-input"
      )
      |> AuthoringTranscript.append_assistant(old_reply)

    request =
      input
      |> Map.put(:transcript, prior)
      |> JudgmentProtocol.request_for_production()

    scope = NovelTest.TestProviderPrompt.scope_content(request)
    interaction = scope["context"]["interaction_state"]
    [source] = interaction["author_inputs"]
    [result] = interaction["recent_results"]

    refute Map.has_key?(source, "text")
    refute Map.has_key?(result, "text")
    refute Map.has_key?(scope["goal"], "text")

    assert source["handling"] == %{
             "status" => "completed",
             "processed_at" => "2026-11-15T00:00:00Z"
           }

    assert source["registration"] == %{
             "pending_count" => 0,
             "accepted_count" => 0,
             "discarded_count" => 0
           }

    assert result["truthfulness"] == %{
             "production_write_performed" => false,
             "artifact_adopted" => false
           }

    assert scope["goal"]["source_input_ref"] == run.parent_turn_ref
    assert scope["goal"]["version"] == 1
    texts = Enum.map(request.messages, &Projection.text_of(&1.blocks))
    assert Enum.count(texts, &(&1 == old_author)) == 1
    assert Enum.count(texts, &(&1 == old_reply)) == 1
    assert Enum.count(texts, &(&1 == author_text)) == 1
    scope_text = Jason.encode!(scope)
    refute scope_text =~ old_author
    refute scope_text =~ old_reply
  end

  @tag :r03_scope
  test "R03 稳定定义只在初始 Base，允许集与探索预算更新不复制或重写目录" do
    author_text = "比较两种叙事方案。"
    run = scope_run("w-b33", author_text, "catalog")
    input = protocol_input(context(), run, author_text)

    input =
      Map.update!(input, :options, fn options ->
        options
        |> Keyword.put(:capabilities, ["character_design", "prose_writing"])
        |> Keyword.put(:explore, true)
        |> Keyword.put(:explore_tools, ["chapter_read"])
      end)

    assert {:ok, before} = JudgmentProtocol.transcript_for_production(input)

    changed =
      input
      |> Map.put(:transcript, before)
      |> Map.update!(:options, fn options ->
        options
        |> Keyword.put(:capabilities, ["character_design"])
        |> Keyword.put(:explore, false)
        |> Keyword.put(:explore_tools, [])
        |> Keyword.put(:exploration_budget, %{open?: false, total: 2})
      end)

    assert {:ok, after_change} = JudgmentProtocol.transcript_for_production(changed)
    assert after_change.system == before.system
    [initial_base] = Enum.filter(before.messages, &(&1.role == "application_base"))
    assert [initial_base] == Enum.filter(after_change.messages, &(&1.role == "application_base"))

    stable_text =
      Projection.system_text(before.system) <> Projection.content_of(initial_base.blocks)

    definition = NovelApplication.CapabilityRegistry.get("character_design").effect_summary
    assert stable_text =~ definition
    assert stable_text =~ "chapter_read"
    scope = AuthoringTranscript.current_scope(after_change).content
    assert scope["operation"]["available_operations"] == ["character_design"]
    assert scope["operation"]["exploration"]["allowed"] == false
    assert scope["operation"]["exploration"]["tools"] == []
    assert scope["operation"]["exploration"]["budget"] == %{"open?" => false, "total" => 2}

    for message <- Enum.filter(after_change.messages, &(&1.role == "scope_update")) do
      refute Projection.content_of(message.blocks) =~ definition
      refute Projection.content_of(message.blocks) =~ "query_help"
    end
  end

  @tag :r03_scope
  test "R03 当前 Scope 使用同一真实运行权限与预算投影，目标关联不冒充已读材料" do
    author_text = "继续当前任务。"
    initial = scope_run("w-b33", author_text, "runtime")

    run = %{
      initial
      | authority_scope: %{
          production_write: false,
          allowed_tools: ["judgment"],
          target_revision_ref: "chapter:unread-target",
          target_revision: 9
        },
        budget: %{
          max_steps: 13,
          max_tool_calls: 8,
          max_provider_calls: 11,
          max_replans: 2,
          max_pending_artifacts: 3
        },
        consumed_budget: %{
          steps: 7,
          execution_steps: 5,
          tool_calls: 4,
          provider_calls: 3,
          replans: 1
        }
    }

    request =
      protocol_input(context(), run, author_text) |> JudgmentProtocol.request_for_production()

    scope = NovelTest.TestProviderPrompt.scope_content(request)

    assert scope["operation"]["runtime"] == %{
             "authority_scope" => %{
               "production_write" => false,
               "allowed_tools" => ["judgment"],
               "target_revision_ref" => "chapter:unread-target",
               "target_revision" => 9
             },
             "budget" => %{
               "max_steps" => 13,
               "max_tool_calls" => 8,
               "max_provider_calls" => 11,
               "max_replans" => 2,
               "max_pending_artifacts" => 3
             },
             "consumed_budget" => %{
               "steps" => 7,
               "execution_steps" => 5,
               "tool_calls" => 4,
               "provider_calls" => 3,
               "replans" => 1
             }
           }

    refute Enum.any?(request.refs.base_refs, &(&1.ref == "chapter:unread-target"))
    assert scope["goal"]["source_input_ref"] == run.parent_turn_ref
    refute Map.has_key?(scope["goal"], "text")
  end

  @tag :r03_scope
  test "R03 固定目录里仍有能力定义，当前许可收回后真实 execute 仍被拒绝" do
    author_text = "请执行写作任务。"
    run = scope_run("w-b33", author_text, "revoke")
    input = protocol_input(context(), run, author_text)
    assert {:ok, before} = JudgmentProtocol.transcript_for_production(input)

    current =
      input
      |> Map.put(:transcript, before)
      |> Map.update!(:options, &Keyword.put(&1, :capabilities, ["character_design"]))

    execution =
      TestAgenticLoopFixtures.scripted_judgment_execution(fn _request ->
        {:decision, "请求写正文",
         %{
           "action" => "execute",
           "capability" => "prose_writing",
           "dialogue_goal" => author_text
         }}
      end)

    assert {:error, {:judgment_protocol_violation, :capability_not_available}, state} =
             JudgmentProtocol.request_judgment(execution, %{}, current)

    assert state.provider_call_count == 2

    assert AuthoringTranscript.current_scope(state.judgment_transcript).content["operation"][
             "available_operations"
           ] == ["character_design"]
  end

  @tag :r03_scope
  test "R03 不支持的当前能力配置显式拒绝，不截断成另一套允许集" do
    author_text = "继续当前任务。"
    run = scope_run("w-b33", author_text, "unsupported")

    input =
      context()
      |> protocol_input(run, author_text)
      |> Map.update!(
        :options,
        &Keyword.put(&1, :capabilities, ["future_unimplemented_operation"])
      )

    assert {:error, :unsupported_judgment_capabilities} =
             JudgmentProtocol.transcript_for_production(input)
  end

  @tag :scope_history
  test "R03 可见历史角色详情属于本次真实供应集，不要求新 run 重读" do
    :ok = Sandbox.checkout(Repo)

    %{input: input, request: request, work: work, character: character, ref: ref} =
      character_history(false)

    [leaf] = visible_observations(request)

    assert leaf.content["tool"] == "archive_read"
    assert leaf.coverage["work_id"] == work.id
    assert leaf.coverage["ref"] == ref
    assert leaf.source_refs == [ref]

    assert {:ok, target, ^leaf} = CharacterProfile.observed_target(work.id, ref, [leaf])
    assert target.character_ref == ref
    assert target.name == character.name
    assert target.narrative_role == character.narrative_role
    assert input.observations == []

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(character_execution(ref), %{}, input)

    assert judgment.character_observation == leaf
    assert judgment.provider_call_count == 1
    assert judgment.reply_record.supplied_observation_refs == [ref]
    assert judgment.reply_record.exploration_call_count == 0
    refute Jason.encode!(request.messages) =~ "character_observation"
  end

  @tag :scope_history
  test "R03 checkpoint 隐藏的角色详情不能由累计 observation refs 恢复已读资格" do
    :ok = Sandbox.checkout(Repo)
    %{input: input, request: request, work: work, ref: ref} = character_history(true)

    assert [%{ref: ^ref}] = request.refs.observation_refs

    assert Enum.any?(request.messages, fn message ->
             Enum.any?(message.blocks, &(&1.type == "observation"))
           end)

    assert visible_observations(request) == []
    assert {:error, :not_observed} = CharacterProfile.observed_target(work.id, ref, [])

    assert {:error, {:judgment_protocol_violation, {:character_profile_invalid, :not_observed}},
            _state} = JudgmentProtocol.request_judgment(character_execution(ref), %{}, input)

    execution =
      TestAgenticLoopFixtures.scripted_judgment_execution(fn _request ->
        {:narrative, "原详情已不在本次请求中，需要重新读取才能修订。"}
      end)

    assert {:ok, reply} = JudgmentProtocol.request_judgment(execution, %{}, input)
    assert reply.reply_record.supplied_observation_refs == []
  end

  defp character_execution(ref) do
    TestAgenticLoopFixtures.scripted_judgment_execution(fn _request ->
      {:decision, "修改作者指定角色的叙事身份",
       %{
         "action" => "execute",
         "capability" => "revise_character_profile",
         "character_ref" => ref,
         "dialogue_goal" => "把历史观察人物设为主角"
       }}
    end)
  end

  defp visible_observations(request) do
    request.messages
    |> Compaction.project()
    |> Enum.flat_map(& &1.blocks)
    |> Enum.filter(&(&1.type == "observation"))
    |> Enum.flat_map(&RequestIR.observation_payloads/1)
  end

  defp character_history(hidden?) do
    work = Repo.insert!(%Work{title: "真实历史观察作品"})

    character =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "历史观察人物",
        aliases: ["旧称"],
        role: "查账人",
        summary: "真实人物原文。",
        narrative_role: "SUPPORTING",
        status: AdoptionStatus.accepted()
      })

    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)
    ref = "character:#{character.id}"
    query = Jason.encode!(%{facet: "characters", ref: ref, offset: 0})
    {:ok, observation} = ExplorationService.run(work.id, "archive_read", query)
    suffix = if hidden?, do: "hidden", else: "visible"
    author_text = "把历史观察人物设为主角。"

    run = %{
      scope_run(work.id, author_text, suffix)
      | session_id: session.id,
        workspace_id: work.id
    }

    old_run = %{
      run
      | run_id: "earlier-#{run.run_id}",
        parent_turn_ref: "earlier-#{run.parent_turn_ref}"
    }

    call_id = "history-character-read"

    history =
      AuthoringTranscript.new(RequestIR.run_envelope(old_run),
        base_text: "历史判断角色",
        author_text: "读取这个已有角色的当前详情。",
        author_turn_ref: old_run.parent_turn_ref,
        tools: JudgmentToolContract.tools(:judgment)
      )
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block(
          "judgment_decision",
          %{
            action: "explore",
            author_reasoning: "读取真实角色详情",
            explore_request: %{tool: "archive_read", query: query}
          },
          call_id
        )
      ])
      |> JudgmentProtocol.observation_transcript(%{tool_call_id: call_id}, observation)
      |> AuthoringTranscript.append_author_turn("这一轮先保留阅读结果。", "history-finished-#{suffix}")

    history =
      if hidden? do
        {:ok, compacted} =
          AuthoringTranscript.compact(
            history,
            %{call_ids: [call_id], message_refs: []},
            observation.refs,
            observation.versions,
            ["完整详情仅在 canonical 原始记录中保留，摘要不授予已读资格。"],
            "较早的只读角色详情已整理。"
          )

        compacted
      else
        history
      end

    :ok = TestAgenticLoopFixtures.append_segment!(history, status: "completed")
    {:ok, committed} = AuthoringSessionHistory.fetch(run)

    input =
      context(%{work_id: work.id, current_work_snapshot: %{title: work.title, revision: 1}})
      |> protocol_input(run, author_text)
      |> Map.put(:session_history, committed)

    request = JudgmentProtocol.request_for_production(input)
    %{input: input, request: request, work: work, character: character, ref: ref}
  end

  defp scope_run(work_id, author_text, suffix) do
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-scope-#{suffix}",
        workspace_id: "workspace-scope-#{suffix}",
        work_id: work_id,
        session_id: "session-scope-#{suffix}",
        parent_turn_ref: "turn-scope-#{suffix}",
        origin_frame_ref: "frame-scope-#{suffix}",
        profile_ref: "judgment_loop_v1",
        goal: %{text: author_text, version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["judgment"]}
      })

    run
  end

  test "初始判断只构造一个结构化 Scope，消息处置只有一个实际字段" do
    run = %{
      run_id: "run-b33-judgment",
      profile_ref: "judgment_loop_v1",
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    request = protocol_input(context(), run) |> JudgmentProtocol.request_for_production()
    assert Enum.count(request.messages, &(&1.role == "scope_update")) == 1
    scope = NovelTest.TestProviderPrompt.scope_content(request)
    assert scope["context"]["interaction_state"]["pending_adoption_count"] == 10
    assert scope["context"]["interaction_state"]["resolved_adoption_count"] == 10
  end

  test "写作判断只保留身份与运行事实，专业写作材料不在默认判断 Scope 预装" do
    run = %{
      run_id: "run-b33-prose",
      profile_ref: ProseDraftingWithQuality.profile_ref(),
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    context = context()
    protocol = protocol_input(context, run)
    content = prompt_content(protocol)

    # 写作判断不渲染历史消息处置段（按 keep-list 省略）
    assert protocol.scope.context == %{}
    assert protocol.scope.facts.work.title == "灯楼夜雨"
    assert protocol.scope.coverage.interaction.status == "not_read"
    assert Enum.any?(protocol.scope.omissions, &(&1.reason == "profile_not_supplied"))
    refute Map.has_key?(protocol.scope.facts, :chapters)
    assert protocol.scope.coverage.chapters.status == "not_read"
    refute content =~ "第七盏灯自亮"
    refute content =~ "下井"
    assert content =~ "第02章正文还没写，帮我写出来吧。"
    request = JudgmentProtocol.request_for_production(protocol)

    assert NovelTest.TestProviderPrompt.scope_content(request)["operation"][
             "available_operations"
           ] != []

    refute content =~ "长会话摘要："
    refute content =~ "开放行为摘要："
  end

  test "两种判断 profile 共用固定定义，诊断只声称实际提供的材料段" do
    context = context()

    default_run = %{
      run_id: "run-b33-judgment",
      profile_ref: "judgment_loop_v1",
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    write_run = %{
      run_id: "run-b33-prose",
      profile_ref: ProseDraftingWithQuality.profile_ref(),
      parent_turn_ref: "turn-b33",
      work_id: "w-b33",
      session_id: "s-b33",
      goal: %{text: "第02章正文还没写，帮我写出来吧。", version: 1}
    }

    default_protocol = protocol_input(context, default_run)
    write_protocol = protocol_input(context, write_run)

    diagnostics =
      DialoguePlanningService.judgment_prompt_diagnostics_for_test(write_protocol, true)

    production_chars =
      write_protocol
      |> JudgmentProtocol.request_for_production()
      |> Map.fetch!(:messages)
      |> Enum.map_join("", &Projection.content_of(&1.blocks))
      |> String.length()

    default_request = JudgmentProtocol.request_for_production(default_protocol)
    write_request = JudgmentProtocol.request_for_production(write_protocol)
    assert default_request.system == write_request.system
    assert Map.keys(default_protocol.scope.facts) == [:work]
    assert Map.keys(write_protocol.scope.facts) == [:work]
    assert Map.has_key?(default_protocol.scope.context, :interaction_state)
    assert write_protocol.scope.context == %{}
    assert diagnostics.prompt_chars == production_chars
    assert diagnostics.prompt_tokens == div(production_chars, 4)
    assert diagnostics.cropped == true
    assert diagnostics.selected_sections == ["work", "operations", "contracts"]
  end
end
