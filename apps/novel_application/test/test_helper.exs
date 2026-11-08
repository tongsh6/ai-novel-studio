ExUnit.start(exclude: [:integration, :real_llm])

Ecto.Adapters.SQL.Sandbox.mode(NovelPersistence.Repo, :manual)

Code.require_file(Path.expand("support/agent_run_cleanup_helper.exs", __DIR__))
Code.require_file(Path.expand("support/agent_event_relay_helper.exs", __DIR__))

defmodule NovelApplication.TestAssertions do
  @moduledoc false

  import ExUnit.Assertions

  def assert_provider_output_narrative_source(source) when is_map(source) do
    assert source.source_type == "provider_output"
    assert is_binary(source.provider_run_ref)
    assert is_binary(source.provider_call_ref)
    assert is_binary(source.provider_output_ref)
    assert is_binary(source.source_hash)
    assert is_binary(source.narrative_hash)
    assert %{start: start, length: length} = source.source_byte_range
    assert is_integer(start) and start >= 0
    assert is_integer(length) and length > 0
  end
end

defmodule NovelApplication.TestAgenticLoopFixtures do
  @moduledoc false

  import ExUnit.Assertions

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

  @doc "把内存 canonical 播种为会话执行段（绕过 run 提交，用于恢复/回查夹具）。"
  def append_segment!(transcript) do
    run = transcript.run

    record = %{
      id: run.run_id,
      workspace_id: run.workspace_id,
      work_id: run.work_id,
      session_id: run.session_id,
      parent_turn_ref: run.parent_turn_ref
    }

    {:ok, segment} =
      NovelApplication.AuthoringCheckpoint.encode_segment_for_write(record, transcript)

    {:ok, _state} =
      NovelPersistence.Repo.transaction(fn ->
        NovelPersistence.AuthoringSessionLog.append_run(record, segment)
      end)

    :ok
  end

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
      content: reasoning,
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

  # WR01：写前推理步的确定性 tool-call 结果（content=作者可见叙事，arguments 同带
  # author_reasoning 以覆盖强制 tool_choice 下空 content 的回退绑定路径）。
  def mission_tool_call_result(reasoning, statement, opts \\ []) do
    %{
      content: Keyword.get(opts, :content, reasoning),
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
end
