ExUnit.start(exclude: [:integration, :real_llm])

Ecto.Adapters.SQL.Sandbox.mode(NovelPersistence.Repo, :manual)

Code.require_file(Path.expand("support/agent_run_cleanup_helper.exs", __DIR__))
Code.require_file(Path.expand("support/agent_event_relay_helper.exs", __DIR__))

defmodule NovelApplication.TestAssertions do
  @moduledoc false

  import ExUnit.Assertions

  def assert_provider_output_narrative_source(source, source_type \\ "provider_output")
      when is_map(source) do
    assert source.source_type == source_type
    assert is_binary(source.provider_run_ref)
    assert is_binary(source.provider_call_ref)
    assert is_binary(source.provider_output_ref)
    assert is_binary(source.source_hash)
    assert is_binary(source.narrative_hash)
    assert %{start: start, length: length} = source.source_byte_range
    assert is_integer(start) and start >= 0
    assert is_integer(length) and length > 0
  end

  def find_event!(events, type) do
    case Enum.find(events, fn {event_type, _event} -> event_type == type end) do
      {^type, event} -> event
      nil -> flunk("expected collected event #{inspect(type)}")
    end
  end

  def assert_bound_narrative(
        source,
        raw,
        %NovelCommon.Contracts.ProviderOutput{} = output,
        tool_fields \\ %{}
      ) do
    source_type =
      case tool_fields do
        fields when fields == %{} ->
          "provider_output"

        %{tool_call_name: name, tool_call_narrative_field: field} = fields
        when is_binary(name) and is_binary(field) and map_size(fields) == 2 ->
          "provider_output_tool_narrative"
      end

    hash = :crypto.hash(:sha256, raw) |> Base.encode16(case: :lower)

    expected =
      Map.merge(
        %{
          source_type: source_type,
          provider_run_ref: output.provider_run_ref,
          provider_call_ref: output.provider_call_ref,
          provider_output_ref: output.provider_run_ref,
          source_hash: hash,
          source_byte_range: %{start: 0, length: byte_size(raw)},
          narrative_hash: hash
        },
        tool_fields
      )

    assert source == expected

    assert :ok =
             NovelApplication.AgentNarrativeSource.verify(raw, source, %{
               output.provider_run_ref => output
             })
  end
end

defmodule NovelApplication.TestAgenticLoopFixtures do
  @moduledoc false

  import ExUnit.Assertions

  alias NovelApplication.AgentRunFlows.AuthoringSession

  # 驱动判断循环前两步：机械准备 context（0 调用）→ 判断①。
  def drive_judgment(spec, run, sink, opts \\ []) do
    {context, result} = drive_judgment_result(spec, run, sink, opts)
    assert {:ok, judgment} = result
    {context, judgment}
  end

  def drive_judgment_result(spec, run, sink, opts \\ []) do
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: sink}

    assert {:execute, context_step, context_decision, context_meta} =
             spec.next_step_planner.(run, 1, empty)

    assert context_decision.target_tool_ref == "context_assemble"
    assert context_meta.provider_call_count == 0
    assert {:ok, context_result} = context_step.(run, 1, empty)
    assert context_result.provider_call_count == 0

    snapshot = %{
      stage_state: context_result.stage_state,
      observations: context_result.observations,
      events: [],
      stage_sink: sink
    }

    assert {:execute, judgment_step, judgment_decision, judgment_meta} =
             spec.next_step_planner.(run, 2, snapshot)

    assert judgment_decision.target_tool_ref == "judgment"
    assert judgment_meta.provider_call_count == 0

    result =
      if Keyword.get(opts, :session_history, false) do
        AuthoringSession.with_request_view(
          Map.put(snapshot, :run, run),
          &judgment_step.(run, 2, &1)
        )
      else
        judgment_step.(run, 2, snapshot)
      end

    {context_result, result}
  end

  def judgment_response(text, calls, ref \\ "call-1") do
    %{
      content: text,
      tool_calls: calls,
      provider_output: %NovelCommon.Contracts.ProviderOutput{
        provider_run_ref: "run-#{ref}",
        provider_call_ref: ref,
        status: :ok,
        content: %{text: text, tool_calls: calls}
      }
    }
  end

  def judgment_call(name, args), do: %{id: "tool-#{name}", name: name, arguments: args}

  def judgment_input(opts \\ []) do
    {:ok, run} =
      NovelDomain.AgentRun.new(%{
        run_id: "run-judgment-fixture",
        work_id: "work-judgment-fixture",
        workspace_id: "workspace-judgment-fixture",
        session_id: "session-judgment-fixture",
        parent_turn_ref: "author-turn",
        origin_frame_ref: "frame-judgment-fixture",
        profile_ref: "judgment_plan_v1",
        goal: %{text: "根据本章实际内容判断", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    %{
      author_text: "根据本章实际内容判断",
      scope: %{
        work_id: run.work_id,
        facts: %{
          work: %{ref: "work:#{run.work_id}", work_id: run.work_id, title: "协议测试作品"}
        },
        context: %{},
        coverage: %{}
      },
      source_input_ref: "author-turn",
      supplied_context_refs: ["work:#{run.work_id}"],
      options: Keyword.put_new(opts, :plan_run, run)
    }
  end

  # CP4 与会话原文读取共同使用的现役判断回环夹具；不启动服务器/第二执行循环。
  def run_until_turn_result(spec, run, max_steps) do
    empty = %{
      stage_state: %{},
      observations: [],
      events: [],
      step_results: [],
      stage_sink: fn _ -> :ok end
    }

    Enum.reduce_while(1..max_steps, {empty, nil}, fn seq, {snapshot, _result} ->
      case spec.next_step_planner.(run, seq, snapshot) do
        {:execute, step, _decision, _meta} ->
          {:ok, result} = step.(run, seq, snapshot)
          continue_after_step(result, snapshot)

        {:complete, _decision, _meta} ->
          {:halt, {snapshot, nil}}

        other ->
          flunk("unexpected planner result: #{inspect(other)}")
      end
    end)
  end

  defp continue_after_step(result, snapshot) do
    snapshot = %{
      snapshot
      | stage_state: Map.merge(snapshot.stage_state, result[:stage_state] || %{}),
        observations: snapshot.observations ++ (result[:observations] || []),
        step_results: snapshot.step_results ++ [result]
    }

    if result[:turn_result],
      do: {:halt, {snapshot, result}},
      else: {:cont, {snapshot, nil}}
  end

  def drain_prompt_maps(acc) do
    receive do
      {:prompt_map, prompt} -> drain_prompt_maps(acc ++ [prompt])
    after
      0 -> acc
    end
  end

  def observation_blocks(prompt_map) do
    for %{role: "tool", blocks: blocks} <- prompt_map.messages,
        %{type: "observation"} = block <- blocks,
        do: block
  end

  @doc "读取真实章节各页并构造当前作者之后的 canonical 观察；不解释原话或选择修改片段。"
  def chapter_read_request(run, input, chapter_ref) do
    transcript =
      NovelApplication.AuthoringTranscript.new(run,
        base_text: NovelCommon.RequestIR.application_base_text(),
        author_text: input.text,
        author_turn_ref: input.turn_id,
        tools: NovelApplication.JudgmentToolContract.tools(:judgment)
      )
      |> append_chapter_read_pages(run.work_id, chapter_ref, 0)

    assert {:ok, request} = NovelApplication.AuthoringTranscript.to_request_ir(transcript)
    assert :ok = NovelCommon.RequestIR.validate(request)
    request
  end

  defp append_chapter_read_pages(transcript, work_id, chapter_ref, offset) do
    query = Jason.encode!(%{chapter_ref: chapter_ref, offset: offset})
    assert {:ok, page} = NovelApplication.ExplorationService.run(work_id, "chapter_read", query)
    call_id = "chapter-read-#{offset}"

    call =
      NovelCommon.RequestIR.tool_call_block(
        "judgment_decision",
        %{action: "explore", explore_request: %{tool: "chapter_read", query: query}},
        call_id
      )

    transcript =
      transcript
      |> NovelApplication.AuthoringTranscript.append_assistant("", [call])
      |> NovelApplication.JudgmentProtocol.observation_transcript(%{tool_call_id: call_id}, page)

    case Map.get(page, :next_offset) do
      nil ->
        transcript

      next when is_integer(next) and next > offset ->
        append_chapter_read_pages(transcript, work_id, chapter_ref, next)
    end
  end

  def scripted_judgment_execution(script) do
    %NovelAgent.Provider.Execution{
      result_fn: fn prompt ->
        {text, calls} =
          case script.(prompt) do
            {:narrative, narrative} ->
              {narrative, []}

            {:decision, narrative, arguments} ->
              {narrative, [%{"name" => "judgment_decision", "arguments" => arguments}]}

            {operation, arguments} when operation in [:decision, :plan] ->
              name = if operation == :plan, do: "agent_plan_draft", else: "judgment_decision"
              {"", [%{"name" => name, "arguments" => arguments}]}
          end

        {:ok, %{content: text, tool_calls: calls, provider_output: provider_output(text, calls)}}
      end
    }
  end

  defp provider_output(text, calls) do
    %NovelCommon.Contracts.ProviderOutput{
      provider_run_ref: "prun-#{System.unique_integer([:positive])}",
      provider_call_ref: "pcall-#{System.unique_integer([:positive])}",
      status: :ok,
      content: %{text: text, tool_calls: calls}
    }
  end

  def assert_authoring_transcript(state, run_id) do
    transcript = Map.fetch!(state.stage_state, :judgment_transcript)
    assert transcript.run.run_id == run_id

    tool_names =
      for message <- transcript.messages,
          block <- message.blocks,
          block.type == "tool_call",
          do: block.name

    assert "submit_tentative_artifact" in tool_names
    transcript
  end

  @doc "从会话 canonical 存储重建本 run 执行段（B81 CP1）。"
  def persisted_transcript(run_or_id) do
    run =
      if is_binary(run_or_id),
        do: NovelPersistence.AgentRunLog.get_run(run_or_id),
        else: run_or_id

    {:ok, transcript, :session_segment} = NovelApplication.AuthoringCheckpoint.restore(run, nil)
    transcript
  end

  @doc "按 run 读取会话执行段（段头 + 消息）。"
  def persisted_segment(run_id) do
    {:ok, segment} = NovelPersistence.AuthoringSessionLog.fetch_run_segment(run_id)
    segment
  end

  @doc """
  把内存 canonical 播种为真实 run 的会话段（恢复/回查夹具，不启动执行）。

  既有 run 沿用已持久化状态；创建新 run 必须显式传入 status，活动历史不得
  被缺省当作已完成。显式 status 也可推进交错写入夹具的真实运行状态。
  """
  def append_segment!(transcript, opts \\ []) do
    {:ok, segment} =
      NovelApplication.AuthoringCheckpoint.encode_segment_for_write(transcript)

    {:ok, _state} =
      NovelPersistence.Repo.transaction(fn ->
        record = fixture_run!(transcript.run, opts)
        {:ok, state} = NovelPersistence.AuthoringSessionLog.append_run(record, segment)
        state
      end)

    :ok
  end

  defp fixture_run!(run, opts) do
    case NovelPersistence.AgentRunLog.get_run(run.run_id) do
      nil ->
        status = Keyword.fetch!(opts, :status)

        attrs = %{
          id: run.run_id,
          workspace_id: run.workspace_id,
          work_id: run.work_id,
          session_id: run.session_id,
          parent_turn_ref: run.parent_turn_ref,
          origin_frame_ref: "fixture:" <> run.parent_turn_ref,
          run_mode: "bounded",
          profile_ref: "judgment_loop_v1",
          status: status,
          phase: fixture_phase(status)
        }

        {:ok, record} = NovelPersistence.AgentRunLog.upsert_run(attrs)
        record

      record ->
        case Keyword.fetch(opts, :status) do
          :error ->
            record

          {:ok, status} ->
            {:ok, updated} =
              NovelPersistence.AgentRunLog.upsert_run(%{
                id: record.id,
                status: status,
                phase: fixture_phase(status)
              })

            updated
        end
    end
  end

  defp fixture_phase(status) when status in ~w(completed cancelled failed), do: "stopped"
  defp fixture_phase(_status), do: "executing"

  def reasoning_tail(packet) when is_map(packet) do
    tail = %{
      "evaluation_of_last" => Map.get(packet, :evaluation_of_last, evaluation_holds()),
      "decision" => Map.fetch!(packet, :decision),
      "next_action" => Map.fetch!(packet, :next_action),
      "plan_revision" => Map.get(packet, :plan_revision),
      "reason_codes" => Map.get(packet, :reason_codes, []),
      "confidence" => Map.get(packet, :confidence, 1.0)
    }

    Map.fetch!(packet, :reasoning) <> "\n" <> Jason.encode!(tail)
  end

  def plan_tool_call_result(reasoning, steps, opts \\ []) when is_list(steps) do
    tool_name = Keyword.get(opts, :tool_name, "agent_plan_draft")

    %{
      content: "",
      tool_calls: [
        %{
          "name" => tool_name,
          "arguments" => %{
            "author_reasoning" => reasoning,
            "plan" => %{
              "steps" => steps
            },
            "reason_codes" => Keyword.get(opts, :reason_codes, ["agent_plan_drafted"]),
            "confidence" => Keyword.get(opts, :confidence, 1.0)
          }
        }
      ]
    }
  end

  # WR01：作者说明只在工具 author_reasoning；content 仅供显式第二正文负例。
  def mission_tool_call_result(reasoning, statement, opts \\ []) do
    %{
      content: Keyword.get(opts, :content, ""),
      tool_calls: [
        %{
          "name" => "chapter_mission",
          "arguments" => %{
            "author_reasoning" => reasoning,
            "statement" => statement,
            "must_advance" => Keyword.get(opts, :must_advance, []),
            "must_avoid" => Keyword.get(opts, :must_avoid, []),
            "confidence" => Keyword.get(opts, :confidence, 0.9)
          }
        }
      ]
    }
  end

  def prompt_text(prompt) when is_binary(prompt), do: prompt

  def prompt_text(%NovelCommon.RequestIR{} = ir),
    do: NovelTest.TestProviderPrompt.text(ir)

  def prompt_text(prompt) when is_list(prompt) or is_map(prompt),
    do: NovelTest.TestProviderPrompt.text(prompt)

  def message_text(%{blocks: blocks}) when is_list(blocks) do
    Enum.map_join(blocks, "", fn
      %{type: "text", text: text} when is_binary(text) -> text
      _block -> ""
    end)
  end

  def message_text(%{content: content}), do: text_of(content)
  def message_text(%{"content" => content}), do: text_of(content)
  def message_text(_message), do: ""

  defp text_of(text) when is_binary(text), do: text
  defp text_of(text) when is_list(text), do: Enum.map_join(text, "", &text_of/1)
  defp text_of(text) when is_map(text), do: Jason.encode!(text)
  defp text_of(nil), do: ""
  defp text_of(text), do: to_string(text)

  def native_artifact_result(items, opts \\ []) when is_list(items) do
    %{
      content: "",
      provider_call_id: Keyword.get(opts, :provider_call_id),
      tool_calls: [
        %{
          id: Keyword.get(opts, :call_id, "creative-call-1"),
          name: "submit_tentative_artifact",
          arguments: %{items: items}
        }
      ]
    }
  end

  # 原生 fixture 直接声明工具参数；不从文本响应推断产品协议或补齐创作字节。
  def native_tool_calls(tool_name, arguments) do
    [
      %{
        id: "fixture-native-#{System.unique_integer([:positive, :monotonic])}",
        name: tool_name,
        arguments: arguments
      }
    ]
  end

  # 每次真实 Provider 调用必须有独立身份；固定 provider_call_id 会在
  # ProviderRunLog 的唯一事实边界被正确判为跨调用冲突。测试 fixture 统一用
  # 本函数按调用生成，不按分支临时拼 id，也不关闭事实持久化。
  def unique_provider_call_id(prefix) when is_binary(prefix) do
    "#{prefix}-#{System.unique_integer([:positive, :monotonic])}"
  end

  # 正式流程测试除应用态断言外，还要核对唯一事实边界真实落下的 run/event/output
  # 配对：同一次调用的 event 与 output 必须指向同一 run 和 provider_call_ref。
  def assert_provider_fact_pairs(agent_run_id) when is_binary(agent_run_id) do
    runs = NovelPersistence.ProviderRunLog.list_runs(agent_run_id)
    assert runs != []

    Enum.each(runs, fn run ->
      assert run.agent_run_id == agent_run_id

      events = NovelPersistence.ProviderRunLog.list_events(run.id)
      output = NovelPersistence.ProviderRunLog.get_output(run.id)

      Enum.each(events, fn event ->
        assert event.provider_run_id == run.id
        assert event.provider_call_ref == run.provider_call_ref
        assert event.agent_run_id == agent_run_id
      end)

      assert is_map(output)
      assert output.provider_run_id == run.id
      assert output.provider_call_ref == run.provider_call_ref
      assert output.agent_run_id == agent_run_id
    end)

    runs
  end

  def plan_step(step_id, target_tool_ref, description, opts \\ []) do
    %{
      "step_id" => step_id,
      "kind" => Keyword.get(opts, :kind, "explore"),
      "description" => description,
      "success_criteria" => Keyword.get(opts, :success_criteria, ["step_completed"]),
      "depends_on" => Keyword.get(opts, :depends_on, []),
      "target_tool_ref" => target_tool_ref,
      "write_intent" => Keyword.get(opts, :write_intent, "none"),
      "risk_hint" => Keyword.get(opts, :risk_hint, "low"),
      "authoring_intent" => Keyword.get(opts, :authoring_intent),
      "target_chapter" => Keyword.get(opts, :target_chapter),
      "target_chapter_ref" => Keyword.get(opts, :target_chapter_ref),
      "requested_chapter_raw" => Keyword.get(opts, :requested_chapter_raw)
    }
  end

  def continue_next(reasoning, target_tool_ref, opts \\ []) do
    %{
      reasoning: reasoning,
      evaluation_of_last: Keyword.get(opts, :evaluation_of_last, evaluation_holds()),
      decision: %{"type" => Keyword.get(opts, :decision_type, "continue")},
      next_action:
        Map.merge(
          %{
            "target_tool_ref" => target_tool_ref,
            "write_intent" => Keyword.get(opts, :write_intent, "none"),
            "risk_hint" => Keyword.get(opts, :risk_hint, "low")
          },
          Keyword.get(opts, :next_action_extra, %{})
        ),
      plan_revision: Keyword.get(opts, :plan_revision),
      reason_codes: Keyword.get(opts, :reason_codes, ["agentic_next_step"]),
      confidence: Keyword.get(opts, :confidence, 1.0)
    }
  end

  def done_next(reasoning, opts \\ []) do
    %{
      reasoning: reasoning,
      evaluation_of_last: Keyword.get(opts, :evaluation_of_last, evaluation_holds()),
      decision: %{"type" => "done"},
      next_action: %{"target_tool_ref" => nil, "write_intent" => "none", "risk_hint" => "low"},
      plan_revision: nil,
      reason_codes: Keyword.get(opts, :reason_codes, ["goal_satisfied"]),
      confidence: Keyword.get(opts, :confidence, 1.0)
    }
  end

  def evaluation_holds do
    %{"advanced" => true, "plan_holds" => true, "new_constraint" => nil}
  end

  @doc "按显式首尾锚点构造固定字符长度的已采纳正文夹具。"
  def long_prose(total, first_page_anchor, long_tail_anchor) do
    base =
      "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线，他数着自己的呼吸等回声。"

    pad = total - String.length(first_page_anchor) - String.length(long_tail_anchor)
    middle = String.duplicate(base, div(pad, String.length(base)) + 1) |> String.slice(0, pad)
    prose = first_page_anchor <> middle <> long_tail_anchor
    assert String.length(prose) == total
    prose
  end

  @doc "播种一个真实作品、章场及已采纳正文，不启动运行或读取投影。"
  def seed_chapter_with_prose(prose) do
    alias NovelApplication.WorkService
    alias NovelFoundation.Enums.AdoptionStatus
    alias NovelPersistence.Repo
    alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

    {:ok, work} = WorkService.create(%{"title" => "CP4 长章作品"})

    volume =
      %Volume{} |> Volume.changeset(%{work_id: work.id, title: "卷一", seq: 1}) |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{work_id: work.id, volume_id: volume.id, title: "第01章：灯楼夜雨", seq: 1})
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work.id,
      scene_id: scene.id,
      content: prose,
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    {work.id, "chapter:#{chapter.id}"}
  end

  def prose_drafting_body do
    "他走进房间，看了看四周，坐了下来。他拿起书本，翻了翻几页，放了下来。他望向窗外，看了看天色，叹了口气。他端起茶杯，喝了一小口，搁了回去。"
  end

  def prose_drafting_input(work_id, input_overrides \\ %{}) do
    %{
      text: "先写第01章正文草稿，再做质量复核。",
      workspace_id: work_id,
      work_id: work_id,
      session_id: "session-agent-prose-deviation",
      turn_id: "turn-agent-prose-deviation",
      chapter_prose_reader: fn _work_id, _chapter -> "" end,
      chapter_summary_reader: %{},
      character_reader: fn _work_id -> [] end
    }
    |> Map.merge(input_overrides)
  end

  def prose_plan_draft(prompt, opts \\ []) do
    prompt = prompt_text(prompt)

    # 嗅作者目标短语而非全 prompt（生产指引文案自身含"接着写"枚举说明，全文嗅探会误翻分支）
    {authoring_intent, target_chapter, requested_chapter_raw, reasoning} =
      if String.contains?(prompt, "接着第01章") do
        {"continuation", "第01章：开端", "第01章", "先读取第01章上下文，再按续写意图生成正文草稿。"}
      else
        {"none", "第01章：开端", "第01章", "先读取正文写作上下文，再生成一份待采纳正文草稿并复核。"}
      end

    authoring_intent = Keyword.get(opts, :authoring_intent, authoring_intent)
    target_chapter = Keyword.get(opts, :target_chapter, target_chapter)
    target_chapter_ref = Keyword.get(opts, :target_chapter_ref)
    requested_chapter_raw = Keyword.get(opts, :requested_chapter_raw, requested_chapter_raw)
    risk_hint = Keyword.get(opts, :risk_hint, "low")

    exploration_step =
      case Keyword.get(opts, :exploration) do
        {tool, query} ->
          [
            Map.put(
              plan_step(
                "explore_readonly_prose",
                tool,
                "按需读取作品事实。",
                success_criteria: ["exploration_observed"]
              ),
              "exploration_query",
              query
            )
          ]

        _ ->
          []
      end

    plan_tool_call_result(
      reasoning,
      [
        plan_step(
          "assemble_prose_context",
          "context_assemble",
          "读取正文写作上下文",
          success_criteria: ["prose_context_attached"]
        )
      ] ++
        exploration_step ++
        [
          plan_step(
            "derive_chapter_mission",
            "chapter_mission",
            "按本章计划与作品脉络推导本章使命",
            success_criteria: ["chapter_mission_derived"]
          ),
          plan_step(
            "draft_prose_with_quality",
            "prose_writing",
            "生成正文草稿并触发质量复核",
            kind: "act",
            write_intent: "tentative",
            risk_hint: risk_hint,
            authoring_intent: authoring_intent,
            target_chapter: target_chapter,
            target_chapter_ref: target_chapter_ref,
            requested_chapter_raw: requested_chapter_raw,
            success_criteria: ["prose_fragment_created", "quality_review_completed"]
          )
        ],
      reason_codes: Keyword.get(opts, :reason_codes, ["agent_plan_drafted"]),
      tool_name: Keyword.get(opts, :tool_name, "agent_plan_draft")
    )
  end

  def prose_next_step_decision(prompt) do
    prompt = prompt_text(prompt)

    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        done_next("已生成待采纳正文草稿并完成质量复核，本轮目标已经满足。")

      String.contains?(prompt, "prose_context /") ->
        continue_next(
          "基于已读取的正文上下文生成正文草稿并完成质量复核。",
          "prose_writing",
          write_intent: "tentative",
          reason_codes: ["agentic_next_step", "prose_context_consumed"]
        )

      true ->
        continue_next(
          "先读取正文写作上下文。",
          "context_assemble",
          reason_codes: ["agentic_next_step", "missing_prose_context"]
        )
    end
  end

  def plot_outline_context(work_id) do
    %NovelDomain.DialogueContext{
      work_id: work_id,
      current_chapters: [],
      structured_chapters: [
        %{
          title: "第00章：开局设定",
          seq: 0,
          summary: "矿区旧债与主角压力已经建立。",
          has_prose: false
        }
      ],
      assembly_policy: NovelDomain.AssemblyPolicy.for_tier(:floor)
    }
  end

  @doc "正文运行回归共享的完整章节与计划材料。"
  def prose_drafting_context(work_id) do
    %NovelDomain.DialogueContext{
      work_id: work_id,
      current_chapters: ["第01章：开端"],
      structured_chapters: [
        %{
          title: "第01章：开端",
          seq: 1,
          summary: "主角第一次进入封闭空间。",
          has_prose: false,
          plan_direction: %{
            "chapter_role" => "开端",
            "plot_progress" => "主角进入异常房间并发现压力来源",
            "character_change" => "从被动观察转向主动寻找出口",
            "information_release" => "房间和旧公司实验有关",
            "foreshadowing_action" => "茶杯上有旧编号",
            "emotion" => "压抑、警觉"
          }
        }
      ],
      assembly_policy: NovelDomain.AssemblyPolicy.for_tier(:floor)
    }
  end
end
