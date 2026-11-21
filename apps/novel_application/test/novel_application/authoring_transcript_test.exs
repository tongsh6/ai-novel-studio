defmodule NovelApplication.AuthoringTranscriptTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection

  @author_text "先读取沈砚的当前叙事身份，再给出把主角改为顾青的 tentative 候选。"

  defp run do
    %{run_id: "run-ir-1", work_id: "work-1", workspace_id: "ws-1", goal: %{text: @author_text}}
  end

  defp scope_facts(version, explore?) do
    %{
      work_id: "work-1",
      facts: %{work: %{ref: "work:work-1", work_id: "work-1", version: version}},
      operation: %{exploration: %{allowed: explore?}}
    }
  end

  defp tools do
    [%{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}]
  end

  defp base_transcript do
    AuthoringTranscript.new(run(),
      base_text: "run goal: 读取角色事实后给出 tentative 候选",
      author_text: @author_text,
      author_turn_ref: "author_turn:turn-1",
      base_refs: [%{ref: "work:work-1", version: 3}],
      tools: tools()
    )
  end

  defp tool_call do
    RequestIR.tool_call_block("read_character", %{"character_ref" => "character:1"}, "call-1")
  end

  defp observation do
    %{
      status: "ok",
      source_refs: [%{ref: "character:1", version: 2}],
      versions: %{"character:1" => 2},
      coverage: %{fields: ["narrative_role"]},
      omissions: [],
      content: %{"narrative_role" => "ENSEMBLE_POV"}
    }
  end

  test "两轮观察回流：tool_call 与真实观察按 call_id 关联进入下一真实请求" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("先读取角色事实。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())
      |> AuthoringTranscript.declare_used_refs(["character:1"])

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert :ok = RequestIR.validate(ir)

    assert {:ok, body} = Projection.project(ir, "chat_completions")
    assistant = Enum.find(body.messages, &(&1.role == "assistant"))
    assert [%{id: "call-1", function: %{name: "read_character"}}] = assistant.tool_calls

    tool = Enum.find(body.messages, &(&1.role == "tool"))
    assert tool.tool_call_id == "call-1"
    assert tool.content =~ "character:1"
    assert tool.content =~ "ok"

    # 作者原话独立消息且字节不变（I-ART-2）
    assert Enum.any?(body.messages, &(&1 == %{role: "user", content: @author_text}))
  end

  test "used_refs 越界拒绝：观察未提供的 ref 不得声明使用（I-ART-9）" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("先读取角色事实。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())
      |> AuthoringTranscript.declare_used_refs(["character:1", "memory:not-observed"])

    assert {:error, {:used_refs_out_of_scope, ["memory:not-observed"]}} =
             AuthoringTranscript.to_request_ir(transcript)
  end

  test "校验失败作为 tool 原生结果回流，不追加 user 纠错（I-ART-5）" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("", [tool_call()])
      |> AuthoringTranscript.append_validation("call-1", "failed", "missing_argument", %{
        field: "character_ref"
      })

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, body} = Projection.project(ir, "chat_completions")

    tool = Enum.find(body.messages, &(&1.role == "tool"))
    assert tool.content =~ "failed"
    assert tool.content =~ "missing_argument"

    assert length(Enum.filter(body.messages, &(&1.role == "user"))) == 2
  end

  test "Scope 普通来源不会升格为 Base，实际材料和真实观察分别保留权限" do
    before =
      base_transcript()
      |> AuthoringTranscript.append_assistant("先读取角色事实。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())

    supplied = [%{ref: "material:provided", version: 1}]
    provenance = [%{ref: "plan:mentioned"}, %{ref: "evidence:unread"}] ++ supplied

    transcript =
      AuthoringTranscript.append_scope_update(
        before,
        %{
          work_id: "work-1",
          context: %{material: %{ref: "material:provided", text: "实际供应的材料原文"}}
        },
        %{"scope_revision" => 2},
        provenance,
        supplied
      )

    assert transcript.base_refs == before.base_refs ++ supplied
    assert transcript.observation_refs == before.observation_refs
    assert AuthoringTranscript.current_scope(transcript).source_refs == provenance
    assert AuthoringTranscript.current_scope(transcript).base_refs == supplied

    assert {:ok, _ir} =
             transcript
             |> AuthoringTranscript.declare_used_refs(["material:provided", "character:1"])
             |> AuthoringTranscript.to_request_ir()

    for ref <- ["plan:mentioned", "evidence:unread"] do
      assert {:error, {:used_refs_out_of_scope, [^ref]}} =
               transcript
               |> AuthoringTranscript.declare_used_refs([ref])
               |> AuthoringTranscript.to_request_ir()
    end
  end

  @tag :r05_base_bindings
  test "JSON恢复保留逐消息材料绑定，历史声明有效不等于当前仍供应旧正文" do
    old = %{ref: "material:old", version: 1}
    current = %{ref: "material:current", version: 2}

    transcript =
      AuthoringTranscript.new(run(),
        base_text: RequestIR.application_base_text(),
        author_text: "先核对旧材料。",
        author_turn_ref: "author_turn:old-material"
      )
      |> AuthoringTranscript.append_scope_update(
        %{work_id: "work-1", context: %{material: %{text: "旧材料的真实正文。"}}},
        %{"scope_revision" => 1},
        [old],
        [old]
      )
      |> AuthoringTranscript.append_author_turn("继续当前材料。", "author_turn:current-material")
      |> AuthoringTranscript.append_scope_update(
        %{work_id: "work-1", context: %{material: %{text: "当前实际供应的正文。"}}},
        %{"scope_revision" => 2},
        [current],
        [current]
      )
      |> AuthoringTranscript.declare_used_refs([old.ref])

    covers = %{
      call_ids: [],
      message_refs: [
        %{
          run_id: "run-ir-1",
          run_sequence: 3,
          role: "scope_update",
          source_refs: [old],
          versions: %{"scope_revision" => 1}
        }
      ]
    }

    assert {:ok, compacted} =
             AuthoringTranscript.compact(
               transcript,
               covers,
               [old, %{ref: "session_message:run-ir-1:3", version: 1}],
               %{},
               ["旧材料正文已省略。"],
               "旧轮完成了材料核对；本摘要不含旧正文。"
             )

    assert {:ok, restored} =
             compacted
             |> AuthoringCheckpoint.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    assert {:ok, request} = AuthoringTranscript.to_request_ir(restored)
    assert request.refs.used_refs == [old.ref]
    assert request.refs.base_refs == [old, current]
    assert Enum.at(request.messages, 2).base_refs == [old]
    assert :ok = RequestIR.validate(request)
    assert RequestIR.usable_base_refs(request) == [current]
    assert :ok = RequestIR.validate_used_refs(request, [current.ref])
    assert {:error, _reason} = RequestIR.validate_used_refs(request, [old.ref])
  end

  test "G7 scope 只追加且带版本，G8 JSON 检查点恢复保持请求语义" do
    first =
      base_transcript()
      |> AuthoringTranscript.append_scope_update(
        scope_facts(3, true),
        %{
          "scope_revision" => 1,
          "work" => 3
        },
        [%{ref: "work:work-1"}],
        [%{ref: "work:work-1"}]
      )
      |> AuthoringTranscript.append_assistant("先读取角色事实。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())

    assert {:ok, first_ir} = AuthoringTranscript.to_request_ir(first)
    assert {:ok, first_body} = Projection.project(first_ir, "chat_completions")

    second =
      AuthoringTranscript.append_scope_update(
        first,
        scope_facts(4, false),
        %{
          "scope_revision" => 2,
          "work" => 4
        },
        [%{ref: "work:work-1"}],
        [%{ref: "work:work-1"}]
      )

    assert {:ok, second_ir} = AuthoringTranscript.to_request_ir(second)
    assert {:ok, second_body} = Projection.project(second_ir, "chat_completions")

    assert Enum.take(second_body.messages, length(first_body.messages)) == first_body.messages

    assert get_in(AuthoringTranscript.current_scope(second).content, [
             "operation",
             "exploration",
             "allowed"
           ]) == false

    assert List.last(second_body.messages).content =~ ~s("scope_revision":2)

    restored =
      second
      |> AuthoringCheckpoint.checkpoint()
      |> Jason.encode!()
      |> Jason.decode!()
      |> AuthoringTranscript.restore()

    assert {:ok, restored_transcript} = restored
    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored_transcript)

    assert Projection.project(restored_ir, "chat_completions") ==
             Projection.project(second_ir, "chat_completions")

    assert AuthoringTranscript.current_scope(restored_transcript).versions["scope_revision"] == 2

    assert Enum.map(restored_ir.messages, & &1.base_refs) ==
             Enum.map(second_ir.messages, & &1.base_refs)
  end

  test "application_base 带 provenance 标记，不冒充作者消息（I-ART-3）" do
    {:ok, ir} = AuthoringTranscript.to_request_ir(base_transcript())
    {:ok, body} = Projection.project(ir, "chat_completions")

    application_message =
      Enum.find(body.messages, &(is_binary(&1.content) and &1.content =~ "application_base"))

    assert application_message.role == "user"
    assert application_message.content =~ "应用数据"
  end

  test "观察 status 如实：读取失败不得渲染为完整事实（I-ART-4）" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", %{
        status: "unavailable",
        source_refs: [],
        omissions: ["chapters"]
      })

    {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    {:ok, body} = Projection.project(ir, "chat_completions")
    tool = Enum.find(body.messages, &(&1.role == "tool"))
    assert tool.content =~ "unavailable"
    assert tool.content =~ "chapters"
  end

  test "回答回合写入来源元数据：canonical transcript 可区分回答与普通作者请求" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_author_turn("按 A 线推进，但先只写一段验证。", "author_turn:turn-2",
        author_turn: %{origin: "author_choice", question_ref: "question:run-ir-1:q1"}
      )

    [message] = transcript.messages |> Enum.filter(&(&1.role == "user")) |> Enum.take(-1)

    assert message.author_turn == %{
             "origin" => "author_choice",
             "question_ref" => "question:run-ir-1:q1"
           }

    # 元数据不改变消息文本（Provider 投影只读 role/blocks，内容字节保真）。
    assert [%{type: "text", text: "按 A 线推进，但先只写一段验证。"}] = message.blocks
  end

  test "相同来源的原文只能记录一次，非末条来源也不能被不同字节覆盖" do
    raw = "  作者原文 Ω\né 与雪。\t "

    transcript =
      base_transcript()
      |> AuthoringTranscript.append_author_turn(raw, "author_turn:stable")
      |> AuthoringTranscript.append_author_turn("后来输入", "author_turn:later")

    assert AuthoringTranscript.append_author_turn(transcript, raw, "author_turn:stable") ==
             transcript

    assert_raise ArgumentError, "author_input_conflict", fn ->
      AuthoringTranscript.append_author_turn(transcript, String.trim(raw), "author_turn:stable")
    end
  end

  test "新建和追加都拒绝缺失或坏作者配对，不把父回合补为当前输入来源" do
    run = Map.put(run(), :parent_turn_ref, "author_turn:old-parent")

    for {text, ref} <- [
          {@author_text, nil},
          {nil, "author_turn:explicit"},
          {" \r\n ", "author_turn:explicit"},
          {@author_text, " \r\n "},
          {123, "author_turn:explicit"},
          {@author_text, 123}
        ] do
      assert_raise ArgumentError, "invalid_author_input", fn ->
        AuthoringTranscript.new(run,
          base_text: "应用材料",
          author_text: text,
          author_turn_ref: ref,
          allow_authorless: true
        )
      end

      assert_raise ArgumentError, "invalid_author_input", fn ->
        AuthoringTranscript.append_author_turn(base_transcript(), text, ref)
      end
    end

    authorless =
      AuthoringTranscript.new(run, base_text: "应用续行材料", allow_authorless: true)

    refute Enum.any?(authorless.messages, &(&1.role == "user"))

    assert_raise ArgumentError, "author_text is required for an authoring run", fn ->
      AuthoringTranscript.new(run, base_text: "作者驱动判断")
    end

    assert_raise ArgumentError, "invalid_author_input", fn ->
      AuthoringTranscript.append_author_turn(base_transcript(), nil, nil)
    end
  end

  test "普通作者回合不带来源元数据" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_author_turn("继续写下一场。", "author_turn:turn-3")

    [message] = transcript.messages |> Enum.filter(&(&1.role == "user")) |> Enum.take(-1)
    refute Map.has_key?(message, :author_turn)
  end

  # append_checkpoint/6 已按「无历史兼容」退役：生产唯一压缩入口是 compact/6。
  # 历史 turn_range checkpoint 事实由测试直接构造 canonical 消息，不再经产品 API。
end
