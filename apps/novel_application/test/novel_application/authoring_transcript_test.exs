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
  end

  test "原始工具参数与 opaque Provider 私有状态在恢复后保持，默认投影不泄漏" do
    private_state = %{
      "provider" => "deepseek",
      "model" => "reasoner",
      "payload" => %{
        "reasoning_content" => "provider-private-reasoning-handle",
        "role" => "private-role",
        "messages" => [%{"type" => "provider-private", "content" => "opaque-value"}]
      }
    }

    transcript =
      base_transcript()
      |> AuthoringTranscript.append_provider_result(%{
        content: "先核对。",
        provider_state: private_state,
        tool_calls: [
          %{
            id: "call-raw",
            name: "read_character",
            arguments: "{ \"character_ref\" : \"character:1\" }"
          }
        ]
      })
      |> AuthoringTranscript.append_validation("call-raw", "passed", "input_validated")

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, body} = Projection.project(ir, "chat_completions")
    assistant = Enum.find(body.messages, &(&1.role == "assistant"))
    refute Map.has_key?(assistant, :reasoning_content)
    refute Map.has_key?(assistant, :provider_state)

    assert hd(assistant.tool_calls).function.arguments ==
             "{ \"character_ref\" : \"character:1\" }"

    assert Enum.find(ir.messages, &(&1.role == "assistant")).provider_state == private_state

    assert {:ok, restored} =
             transcript
             |> AuthoringCheckpoint.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    assert Enum.find(restored.messages, &(&1.role == "assistant")).provider_state == private_state
    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)
    assert Projection.project(restored_ir, "chat_completions") == {:ok, body}
    assert restored_ir.messages == ir.messages

    assert Enum.find(restored_ir.messages, &(&1.role == "assistant")).provider_state ==
             private_state

    for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
      assert {:ok, projected_ir} = AuthoringTranscript.to_request_ir(restored)
      assert {:ok, projected} = Projection.project(projected_ir, target)
      refute Jason.encode!(projected) =~ "provider-private-reasoning-handle"
      refute Jason.encode!(projected) =~ "opaque-value"
    end
  end

  test "缺失原生 id 的显式 nil provenance 经 JSON 检查点/恢复与三投影保持" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_provider_result(%{
        content: "先核对角色。",
        tool_calls: [
          %{name: "read_character", arguments: %{"character_ref" => "character:1"}},
          %{
            id: "native-dup",
            name: "read_character",
            arguments: %{"character_ref" => "character:2"}
          },
          %{
            id: "native-dup",
            name: "read_character",
            arguments: %{"character_ref" => "character:3"}
          }
        ]
      })

    assistant = Enum.find(transcript.messages, &(&1.role == "assistant"))
    blocks = Enum.filter(assistant.blocks, &(&1.type == "tool_call"))
    assert Enum.map(blocks, & &1.call_id) == ["call_read_character", "native-dup", "native-dup:2"]
    assert Map.has_key?(hd(blocks), :provider_call_id)
    assert hd(blocks).provider_call_id == nil
    refute Map.has_key?(Enum.at(blocks, 1), :provider_call_id)
    assert Enum.at(blocks, 2).provider_call_id == "native-dup"

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, body} = Projection.project(ir, "chat_completions")

    assert {:ok, restored} =
             transcript
             |> AuthoringCheckpoint.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    restored_blocks =
      restored.messages
      |> Enum.find(&(&1.role == "assistant"))
      |> Map.fetch!(:blocks)
      |> Enum.filter(&(&1.type == "tool_call"))

    assert restored_blocks == blocks
    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)
    assert Projection.project(restored_ir, "chat_completions") == {:ok, body}

    for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
      assert {:ok, projected_ir} = AuthoringTranscript.to_request_ir(restored)
      assert {:ok, projected} = Projection.project(projected_ir, target)
      refute Jason.encode!(projected) =~ "provider_call_id"
    end
  end

  test "JSON string-key canonical 来源经 append/checkpoint 保留 nil 与 string" do
    transcript =
      AuthoringTranscript.append_provider_result(base_transcript(), %{
        "content" => "先核对角色。",
        "tool_calls" => [
          %{
            "id" => "local-id",
            "provider_call_id" => nil,
            "name" => "read_character",
            "arguments" => %{"character_ref" => "character:1"}
          },
          %{
            "id" => "internal-id",
            "provider_call_id" => "provider-original-id",
            "name" => "read_character",
            "arguments" => %{"character_ref" => "character:2"}
          }
        ]
      })

    blocks =
      transcript.messages
      |> Enum.find(&(&1.role == "assistant"))
      |> Map.fetch!(:blocks)
      |> Enum.filter(&(&1.type == "tool_call"))

    assert [%{call_id: "local-id", provider_call_id: nil}, second] = blocks
    assert second.call_id == "internal-id"
    assert second.provider_call_id == "provider-original-id"

    encoded = transcript |> AuthoringCheckpoint.checkpoint() |> Jason.encode!()
    assert length(Regex.scan(~r/"provider_call_id":/, encoded)) == 2

    assert {:ok, restored} =
             encoded |> Jason.decode!() |> AuthoringTranscript.restore()

    assert restored.messages == transcript.messages
  end

  test "checkpoint 保留领域 JSON 的 role 键，不与 canonical 结构字段混淆" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_scope_update(
        %{work_id: "work-1", operation: %{role: "writer"}},
        %{
          "scope_revision" => 1,
          "role" => "writer"
        },
        [],
        []
      )
      |> AuthoringTranscript.append_provider_result(%{
        content: "读取角色。",
        tool_calls: [
          %{
            id: "call-domain-role",
            name: "read_character",
            arguments: %{character_ref: "character:1", role: "主角"}
          }
        ]
      })

    assert {:ok, restored} =
             transcript
             |> AuthoringCheckpoint.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    assert restored.messages == transcript.messages

    assert List.last(transcript.messages).blocks
           |> Enum.find(&(&1.type == "tool_call"))
           |> Map.get(:arguments) == %{
             "character_ref" => "character:1",
             "role" => "主角"
           }
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

  test "损坏的持久 transcript 在恢复边界返回错误而不是抛异常" do
    for data <- [%{messages: []}, %{messages: [nil]}, %{messages: "bad"}, %{run: nil}] do
      assert {:error, _} =
               AuthoringTranscript.restore(%{
                 version: "authoring-transcript/v1",
                 transcript: data
               })
    end

    transcript = base_transcript()

    for {key, value} <- [
          messages: [nil],
          tools: nil,
          base_refs: nil,
          projection: nil,
          call_ids: 3
        ] do
      assert {:error, _} =
               transcript
               |> Map.put(key, value)
               |> AuthoringCheckpoint.checkpoint()
               |> AuthoringTranscript.restore()
    end
  end

  test "恢复时从真实消息重建调用号索引，不信任可漂移的派生字段" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("读取角色。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())
      |> Map.put(:call_ids, ["stale-call"])

    assert {:ok, restored} =
             transcript |> AuthoringCheckpoint.checkpoint() |> AuthoringTranscript.restore()

    assert restored.call_ids == ["call-1"]
    assert restored.messages == transcript.messages
  end

  test "canonical recovery 两个红例：map refs 投影一致，string refs 可恢复并保持身份" do
    for refs <- [[%{ref: "archive:fixture"}], ["archive:fixture"]] do
      before = recovery_transcript(refs)

      encoded =
        before
        |> AuthoringCheckpoint.checkpoint()
        |> Jason.encode!()
        |> Jason.decode!()

      assert {:ok, restored} = AuthoringTranscript.restore(encoded)
      assert restored.observation_refs == before.observation_refs

      [observation] = restored_observations(restored)

      assert observation.content["query"] == "原查询\n  保留空白 "
      assert observation.content["summary"] == "中文观察\n  保留空白"
      assert observation.content["未知键"] == %{"role" => "作者", "items" => [%{"text" => "a\n b"}]}
      assert observation.coverage["fields"] == ["summary"]
      assert observation.coverage["nested"] == %{"role" => "domain", "run" => [%{"type" => "x"}]}
      assert observation.versions == %{"archive:fixture" => 7}

      for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
        assert {:ok, fresh_ir} = AuthoringTranscript.to_request_ir(before)
        assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)

        assert Projection.project(fresh_ir, target) ==
                 Projection.project(restored_ir, target)
      end
    end
  end

  test "恢复后仍拒绝 used_refs 越界，不因 string ref 放宽范围" do
    transcript = recovery_transcript(["archive:fixture"], ["archive:missing"])

    assert {:error, {:used_refs_out_of_scope, ["archive:missing"]}} =
             AuthoringTranscript.to_request_ir(transcript)

    assert {:error, {:used_refs_out_of_scope, ["archive:missing"]}} =
             transcript
             |> AuthoringCheckpoint.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()
  end

  test "恢复不接受 nil、数字、空对象等伪造成 ref 的 observation_refs" do
    for refs <- [[nil], [123], [%{}], [""]] do
      transcript = recovery_transcript(refs)

      assert {:error, :invalid_transcript_checkpoint} =
               transcript
               |> AuthoringCheckpoint.checkpoint()
               |> Jason.encode!()
               |> Jason.decode!()
               |> AuthoringTranscript.restore()
    end
  end

  test "作者空白、原始参数、artifact 字节与三投影在恢复前后严格一致" do
    raw_arguments = "{  \"character_ref\" : \"角色:1\" ,\n  \"note\" : \"保留\\n换行\" }"
    article = "第一行\n\n  第二行保留空白  \n"

    transcript =
      AuthoringTranscript.new(run(),
        base_text: "稳定 Base",
        author_text: "  作者原话\n\n  第二段  ",
        author_turn_ref: "author_turn:roundtrip-input",
        tools: tools()
      )
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block(
          "submit_tentative_artifact",
          %{items: [%{item_id: "candidate-1", title: "夜雨", body: article}]},
          "artifact-call"
        )
      ])
      |> AuthoringTranscript.append_validation("artifact-call", "passed", "tentative_validated")
      |> AuthoringTranscript.append_provider_result(%{
        content: "工具参数原文。",
        tool_calls: [
          %{
            id: "raw-call",
            name: "read_character",
            raw_arguments: raw_arguments,
            arguments: %{"character_ref" => "角色:1"}
          }
        ]
      })
      |> AuthoringTranscript.append_observation("raw-call", %{
        status: "ok",
        source_refs: [%{ref: "character:1", version: 2}],
        versions: %{"character:1" => 2},
        content: %{query: "原查询\n  保留空白"},
        coverage: %{fields: ["summary"]}
      })
      |> AuthoringTranscript.append_scope_update(
        %{
          work_id: "work-1",
          context: %{"未知来源键" => %{"role" => "writer", "原材料" => "版本化 scope\n第二行"}}
        },
        %{
          "scope_revision" => 1,
          "role" => "writer",
          "未知版本键" => "保留"
        },
        [],
        []
      )
      |> AuthoringTranscript.declare_used_refs(["character:1"])

    assert {:ok, restored} =
             transcript
             |> AuthoringCheckpoint.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
      assert {:ok, fresh_ir} = AuthoringTranscript.to_request_ir(transcript)
      assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)
      assert {:ok, fresh_body} = Projection.project(fresh_ir, target)
      assert {:ok, restored_body} = Projection.project(restored_ir, target)
      assert restored_body == fresh_body
      assert Jason.encode!(restored_body) == Jason.encode!(fresh_body)
    end

    [raw_call] =
      for message <- restored.messages,
          block <- message.blocks,
          block.type == "tool_call" and block.call_id == "raw-call",
          do: block

    assert raw_call.raw_arguments == raw_arguments

    assert raw_call.arguments == %{
             "character_ref" => "角色:1",
             "note" => "保留\n换行"
           }

    [artifact_call] =
      for message <- restored.messages,
          block <- message.blocks,
          block.type == "tool_call" and block.call_id == "artifact-call",
          do: block

    assert get_in(artifact_call.arguments, ["items", Access.at(0), "body"]) == article

    assert Enum.any?(
             restored.messages,
             &(&1.role == "user" and text_of(&1) == "  作者原话\n\n  第二段  ")
           )

    assert AuthoringTranscript.current_scope(restored).versions["未知版本键"] == "保留"
  end

  test "checkpoint JSON 往返幂等：再次 checkpoint 解码后与原 checkpoint 相同" do
    transcript = recovery_transcript([%{ref: "archive:fixture", version: 7}])

    first =
      transcript
      |> AuthoringCheckpoint.checkpoint()
      |> Jason.encode!()
      |> Jason.decode!()

    assert {:ok, restored} = AuthoringTranscript.restore(first)

    second =
      restored
      |> AuthoringCheckpoint.checkpoint()
      |> Jason.encode!()
      |> Jason.decode!()

    assert second == first
  end

  defp recovery_transcript(refs, used_refs \\ ["archive:fixture"]) do
    AuthoringTranscript.new(%{run_id: "recovery-local-fixture"},
      base_text: "保留真实历史。",
      author_text: "  作者原话\n",
      author_turn_ref: "author_turn:recovery-input",
      tools: [%{name: "archive_read", input_schema: %{type: "object"}}]
    )
    |> AuthoringTranscript.append_assistant("", [
      RequestIR.tool_call_block("archive_read", %{"query" => "fixture"}, "fixture-read")
    ])
    |> AuthoringTranscript.append_observation("fixture-read", %{
      status: "ok",
      source_refs: refs,
      versions: %{"archive:fixture" => 7},
      coverage: %{
        fields: ["summary"],
        nested: %{role: "domain", run: [%{"type" => "x"}]}
      },
      content: %{
        "未知键" => %{"role" => "作者", "items" => [%{"text" => "a\n b"}]},
        query: "原查询\n  保留空白 ",
        summary: "中文观察\n  保留空白"
      }
    })
    |> AuthoringTranscript.declare_used_refs(used_refs)
  end

  defp restored_observations(transcript) do
    for message <- transcript.messages,
        block <- message.blocks,
        block.type == "observation",
        do: block
  end

  defp text_of(message) do
    message.blocks
    |> Enum.filter(&(&1.type == "text"))
    |> Enum.map_join("", & &1.text)
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
