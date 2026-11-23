defmodule NovelApplication.AuthoringTranscriptCodecTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection

  @author_text "先读取沈砚的当前叙事身份，再给出把主角改为顾青的 tentative 候选。"

  defp run do
    %{run_id: "run-ir-1", work_id: "work-1", workspace_id: "ws-1", goal: %{text: @author_text}}
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

  @r08_response_fact "本次响应未通过接收，未作为作者回复发布；仍在处理原作者输入。\n"

  @tag :r08_response_rejection
  test "R08 application append 与 RequestIR 共用同一响应拒收形态及纠错前缀" do
    expected = response_rejection_transcript("  原始首稿。\r\n", %{})
    initial = %{expected | messages: Enum.drop(expected.messages, -1)}

    actual =
      AuthoringTranscript.append_validation(
        initial,
        %{provider_call_ref: "pcall-r08-codec", provider_run_ref: "prun-r08-codec"},
        "failed",
        "author_visible_narrative_invalid",
        %{message: "只纠正原说明。", reason: "invalid_narrative"},
        %{
          retryable: true,
          budget_after: %{exchange: %{provider_call_budget: 2, provider_call_count: 1}}
        }
      )

    assert actual == expected
    assert Enum.take(actual.messages, length(initial.messages)) == initial.messages
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(actual)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)
    assert actual.call_ids == []
    assert List.last(actual.messages).role == "application_notice"
  end

  @tag :r08_response_rejection
  test "R08 JSON checkpoint 恢复保留有文及空响应、私有状态与拒收事实，不引入 nil 工具索引" do
    for {text, private} <- [
          {"  原文 e\u0301 👩‍💻。\r\n末行  ", %{}},
          {"",
           %{
             "reasoning_content" => "r08-private-reasoning",
             "opaque" => [%{"id" => "opaque-r08"}]
           }}
        ] do
      original = response_rejection_transcript(text, private)
      assert {:ok, before} = AuthoringTranscript.to_request_ir(original)

      checkpoint =
        original |> AuthoringCheckpoint.checkpoint() |> Jason.encode!() |> Jason.decode!()

      assert {:ok, restored} = AuthoringTranscript.restore(checkpoint)
      assert restored.messages == original.messages
      assert restored.call_ids == []
      assert {:ok, after_restore} = AuthoringTranscript.to_request_ir(restored)
      assert after_restore == before
      assert {:ok, []} = RequestIR.pending_call_ids(after_restore)

      assert [assistant] = Enum.filter(restored.messages, &(&1.role == "assistant"))
      assert assistant.blocks == if(text == "", do: [], else: [RequestIR.text_block(text)])
      assert assistant.provider_state == private
      assert assistant.provider_call_ref == "pcall-r08-codec"
      assert List.last(restored.messages).provider_run_ref == "prun-r08-codec"
      [receipt] = List.last(restored.messages).blocks
      assert receipt.detail["message"] == @r08_response_fact <> "只纠正原说明。"
      refute Map.has_key?(receipt, :call_id)

      assert restored |> AuthoringCheckpoint.checkpoint() |> Jason.encode!() |> Jason.decode!() ==
               checkpoint

      for target <- ~w(chat_completions responses_api anthropic_messages) do
        assert {:ok, body} = Projection.project(after_restore, target)
        assert {:ok, ^body} = Projection.project(before, target)
        encoded = Jason.encode!(body)

        for internal <- [
              "pcall-r08-codec",
              "prun-r08-codec",
              "r08-private-reasoning",
              "opaque-r08"
            ] do
          refute encoded =~ internal
        end

        assert encoded =~ "未作为作者回复发布"
      end
    end
  end

  @tag :r08_response_rejection
  test "R08 持久 JSON 错绑与双主体不能恢复，旧 text notice 不按词面补标" do
    valid = response_rejection_transcript("同一首稿", %{})
    checkpoint = valid |> AuthoringCheckpoint.checkpoint() |> Jason.encode!() |> Jason.decode!()
    messages = checkpoint["transcript"]["messages"]
    notice = List.last(messages)
    [block] = notice["blocks"]

    for bad_notice <- [
          Map.delete(notice, "provider_call_ref"),
          Map.put(notice, "provider_run_ref", "wrong-run"),
          Map.put(notice, "blocks", [Map.put(block, "call_id", nil)]),
          Map.put(notice, "blocks", [Map.put(block, "status", "passed")])
        ] do
      broken =
        put_in(checkpoint, ["transcript", "messages"], List.replace_at(messages, -1, bad_notice))

      assert {:error, _} = AuthoringTranscript.restore(broken)
    end

    ordinary =
      RequestIR.message(:application_notice, :application, [
        RequestIR.text_block("旧纠错文字：未通过接收；历史是否发布仍未知。")
      ])

    unknown = %{valid | messages: List.replace_at(valid.messages, -1, ordinary)}

    assert {:ok, restored} =
             unknown
             |> AuthoringCheckpoint.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    assert restored.messages == unknown.messages
    assert List.last(restored.messages).blocks == ordinary.blocks
    refute Map.has_key?(List.last(restored.messages), :provider_call_ref)
    refute Enum.any?(List.last(restored.messages).blocks, &(&1.type == "validation_result"))
  end

  defp response_rejection_transcript(text, private) do
    initial = base_transcript()

    initial = %{
      initial
      | run:
          Map.merge(initial.run, %{
            session_id: "session-1",
            parent_turn_ref: "author_turn:turn-1"
          }),
        tools: [
          %{
            "name" => "read_character",
            "description" => "读取角色",
            "input_schema" => %{"type" => "object"}
          }
        ]
    }

    refs = %{provider_call_ref: "pcall-r08-codec", provider_run_ref: "prun-r08-codec"}

    source =
      AuthoringTranscript.append_provider_result(
        initial,
        Map.merge(refs, %{content: text, tool_calls: [], provider_state: private})
      )

    receipt = %{
      type: "validation_result",
      status: "failed",
      reason_code: "author_visible_narrative_invalid",
      detail: %{"message" => @r08_response_fact <> "只纠正原说明。", "reason" => "invalid_narrative"},
      retryable: true,
      budget_after: %{"exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}}
    }

    notice = RequestIR.message(:application_notice, :application, [receipt], refs)
    %{source | messages: source.messages ++ [notice]}
  end

  test "R07 两种结果窗口经 JSON 恢复保持，后续 Scope 不重写历史回执" do
    validation_context = %{
      retryable: true,
      budget_after: %{exchange: %{provider_call_budget: 2, provider_call_count: 1}}
    }

    observation_payload =
      Map.merge(observation(), %{
        status: "partial",
        content: %{summary: "实际观察\n  原字节", observation_ref: "observation:retained"},
        retryable: false,
        budget_after: %{
          exploration: %{
            open?: false,
            normal_open?: false,
            continuation_open?: false,
            continuation_only?: false,
            continuation: nil,
            total: 2
          }
        }
      })

    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("", [tool_call()])
      |> AuthoringTranscript.append_validation(
        "call-1",
        "failed",
        "invalid_tool_arguments",
        %{message: "只纠正参数"},
        validation_context
      )
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block(
          "read_character",
          %{"character_ref" => "character:1"},
          "call-read"
        )
      ])
      |> AuthoringTranscript.append_observation("call-read", observation_payload)
      |> AuthoringTranscript.append_scope_update(
        %{work_id: "work-1", operation: %{runtime: %{budget: %{provider_calls: 99}}}},
        %{"scope_revision" => 1},
        [],
        []
      )

    assert {:ok, original_ir} = AuthoringTranscript.to_request_ir(transcript)
    assert :ok = RequestIR.validate(original_ir)

    assert {:ok, restored} =
             transcript
             |> AuthoringCheckpoint.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)

    results =
      for %{role: "tool", blocks: blocks} <- restored_ir.messages,
          block <- blocks,
          do: block

    assert [
             %{
               type: "validation_result",
               call_id: "call-1",
               retryable: true,
               budget_after: %{
                 "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}
               }
             },
             %{
               type: "observation",
               call_id: "call-read",
               retryable: false,
               budget_after: %{
                 "exploration" => %{
                   "open?" => false,
                   "normal_open?" => false,
                   "continuation_open?" => false,
                   "continuation_only?" => false,
                   "continuation" => nil,
                   "total" => 2
                 }
               }
             }
           ] = results

    for target <- ~w(chat_completions responses_api anthropic_messages) do
      assert Projection.project(restored_ir, target) == Projection.project(original_ir, target)
    end

    assert {:ok, chat} = Projection.project(restored_ir, "chat_completions")

    [validation, observed] =
      for %{role: "tool", content: content} <- chat.messages, do: Jason.decode!(content)

    assert validation["retryable"] == true
    assert validation["observation_ref"] == nil
    assert observed["observation_ref"] == "observation:retained"
    assert observed["data"]["content"]["summary"] == "实际观察\n  原字节"
    assert observed["data"]["status"] == "partial"
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
end
