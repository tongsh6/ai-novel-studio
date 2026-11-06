defmodule NovelApplication.AuthoringTranscriptTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Projection
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction

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

  test "G7 scope 只追加且带版本，G8 JSON 检查点恢复保持请求语义" do
    first =
      base_transcript()
      |> AuthoringTranscript.append_scope_update("读取权限开放；作品 revision=3", %{
        "scope_revision" => 1,
        "work" => 3
      })
      |> AuthoringTranscript.append_assistant("先读取角色事实。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())

    assert {:ok, first_ir} = AuthoringTranscript.to_request_ir(first)
    assert {:ok, first_body} = Projection.project(first_ir, "chat_completions")

    second =
      AuthoringTranscript.append_scope_update(first, "读取预算关闭；作品 revision=4", %{
        "scope_revision" => 2,
        "work" => 4
      })

    assert {:ok, second_ir} = AuthoringTranscript.to_request_ir(second)
    assert {:ok, second_body} = Projection.project(second_ir, "chat_completions")

    assert Enum.take(second_body.messages, length(first_body.messages)) == first_body.messages
    assert List.last(second_body.messages).content =~ "读取预算关闭"
    assert List.last(second_body.messages).content =~ ~s("scope_revision":2)

    restored =
      second
      |> AuthoringTranscript.checkpoint()
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
             |> AuthoringTranscript.checkpoint()
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
             |> AuthoringTranscript.checkpoint()
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

    encoded = transcript |> AuthoringTranscript.checkpoint() |> Jason.encode!()
    assert length(Regex.scan(~r/"provider_call_id":/, encoded)) == 2

    assert {:ok, restored} =
             encoded |> Jason.decode!() |> AuthoringTranscript.restore()

    assert restored.messages == transcript.messages
  end

  test "checkpoint 保留领域 JSON 的 role 键，不与 canonical 结构字段混淆" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_scope_update("创作角色已确定", %{
        "scope_revision" => 1,
        "role" => "writer"
      })
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
             |> AuthoringTranscript.checkpoint()
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

  test "checkpoint 与 author_exit：显式压缩、无伪作者消息" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_checkpoint(
        %{turn_range: "turn-1..turn-20"},
        [%{ref: "turn:1..20", version: 1}],
        %{"turn:1..20" => 1},
        ["对话细节"],
        "前 20 轮摘要。"
      )
      |> AuthoringTranscript.append_author_exit("author_decision_required", %{
        question_ref: "question:1"
      })

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    {:ok, body} = Projection.project(ir, "chat_completions")

    checkpoint_message =
      Enum.find(body.messages, &(is_binary(&1.content) and &1.content =~ "checkpoint"))

    assert checkpoint_message.content =~ "turn-1..turn-20"
    refute inspect(body) =~ "author_exit"
  end

  test "显式压缩只改变 Provider 投影，canonical 原始交换与作者字节仍可回查" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("读取角色。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())
      |> AuthoringTranscript.append_scope_update("后续只开放创作。", %{"scope_revision" => 2})
      |> AuthoringTranscript.declare_used_refs(["character:1"])

    assert {:ok, compacted} = compact(transcript, ["call-1"])
    assert Enum.take(compacted.messages, length(transcript.messages)) == transcript.messages
    assert compacted.call_ids == transcript.call_ids
    assert compacted.observation_refs == transcript.observation_refs

    assert AuthoringTranscript.current_scope(compacted) ==
             AuthoringTranscript.current_scope(transcript)

    assert compact(compacted, ["call-1"]) == {:ok, compacted}
    assert {:error, :checkpoint_already_applied} = compact(compacted, ["call-1"], "不同摘要")

    for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
      assert {:ok, ir} = AuthoringTranscript.to_request_ir(compacted)
      assert {:ok, body} = Projection.project(ir, target)
      refute provider_call_ids(body) |> Enum.member?("call-1")
      assert inspect(body) =~ "已读取角色"
      assert inspect(body) =~ @author_text
      assert inspect(body) =~ "省略工具调用的逐字内容"
      refute inspect(body) =~ "ENSEMBLE_POV"
    end

    assert {:ok, restored} =
             compacted
             |> AuthoringTranscript.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    assert Jason.encode!(restored.messages) == Jason.encode!(compacted.messages)
    assert inspect(restored.messages) =~ "ENSEMBLE_POV"
    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)

    assert Projection.project(restored_ir, "chat_completions") ==
             Projection.project(
               elem(AuthoringTranscript.to_request_ir(compacted), 1),
               "chat_completions"
             )
  end

  test "压缩必须精确选择实际已闭合交换，不接受任意范围说明" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("读取角色。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())

    assert {:error, :checkpoint_call_ids_required} =
             AuthoringTranscript.compact(transcript, %{turn_range: "另一轮"}, [], %{}, ["省略"], "摘要")

    assert {:error, :checkpoint_unknown_call} = compact(transcript, ["missing-call"])
    assert {:error, :checkpoint_invalid_call_ids} = compact(transcript, ["call-1", "call-1"])

    assert {:error, :checkpoint_omissions_required} =
             AuthoringTranscript.compact(transcript, %{call_ids: ["call-1"]}, [], %{}, [], "摘要")

    pending = AuthoringTranscript.append_assistant(base_transcript(), "读取角色。", [tool_call()])
    assert {:error, :checkpoint_incomplete_exchange} = compact(pending, ["call-1"])
  end

  test "连续压缩按显式调用范围选择，未选历史和待完成调用保持不变" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("读取角色。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())
      |> AuthoringTranscript.append_scope_update("继续核查。", %{"scope_revision" => 2})
      |> AuthoringTranscript.append_assistant("再次读取。", [
        RequestIR.tool_call_block("read_character", %{}, "call-2")
      ])
      |> AuthoringTranscript.append_observation("call-2", observation())

    assert {:ok, first} = compact(transcript, ["call-2"])
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(first)
    assert {:ok, body} = Projection.project(ir, "chat_completions")
    assert provider_call_ids(body) == ["call-1", "call-1"]

    assert {:ok, second} = compact(first, ["call-1"])
    assert Enum.take(second.messages, length(transcript.messages)) == transcript.messages
    assert Enum.count(second.messages, &(&1.role == "checkpoint")) == 2
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(second)
    assert {:ok, body} = Projection.project(ir, "chat_completions")
    assert provider_call_ids(body) == []
    assert {:error, :checkpoint_already_applied} = compact(second, ["call-1", "call-2"])
  end

  test "同一 assistant 的多工具交换不能只压缩其中一半" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("并行核查。", [
        tool_call(),
        RequestIR.tool_call_block("read_character", %{}, "call-2")
      ])
      |> AuthoringTranscript.append_observation("call-1", observation())
      |> AuthoringTranscript.append_observation("call-2", observation())

    assert {:error, :checkpoint_partial_message} = compact(transcript, ["call-1"])
    assert {:ok, compacted} = compact(transcript, ["call-1", "call-2"])
    assert {:ok, _} = AuthoringTranscript.to_request_ir(compacted)
  end

  test "压缩不能丢失真实来源版本或声明没有读过的来源" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("读取角色。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())

    for {refs, versions} <- [
          {[], %{}},
          {[%{ref: "character:other", version: 2}], %{"character:other" => 2}},
          {[%{ref: "character:1", version: 2}], %{"character:1" => 99}}
        ] do
      assert {:error, :checkpoint_evidence_mismatch} =
               AuthoringTranscript.compact(
                 transcript,
                 %{call_ids: ["call-1"]},
                 refs,
                 versions,
                 ["省略原始工具细节"],
                 "已读取角色"
               )
    end
  end

  test "候选压缩后仍可从持久 canonical 记录逐字回查模型产物" do
    body = "雨落在门槛上。\n\n她没有回答。\n"
    arguments = %{"items" => [%{"item_id" => "candidate-1", "title" => "夜雨", "body" => body}]}

    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block("submit_tentative_artifact", arguments, "candidate-call")
      ])
      |> AuthoringTranscript.append_validation("candidate-call", "passed", "tentative_validated")

    assert {:ok, compacted} =
             AuthoringTranscript.compact(
               transcript,
               %{call_ids: ["candidate-call"]},
               [],
               %{},
               ["候选原文从请求中省略，仍保留在历史记录中。"],
               "已提出夜雨候选，尚未采纳。"
             )

    assert {:ok, restored} =
             compacted
             |> AuthoringTranscript.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    call =
      for message <- restored.messages,
          block <- message.blocks,
          Map.get(block, :type) == "tool_call",
          do: block

    assert [%{arguments: ^arguments}] = call
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(restored)
    assert {:ok, request} = Projection.project(ir, "chat_completions")
    refute Jason.encode!(request) =~ "雨落在门槛上"
    assert inspect(request) =~ "尚未采纳"
  end

  test "历史 turn_range checkpoint 只作说明，不授权删除真实交换" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("读取角色。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())
      |> AuthoringTranscript.append_checkpoint(%{turn_range: "turn-1"}, [], %{}, [], "旧版摘要")

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, request} = Projection.project(ir, "chat_completions")
    assert provider_call_ids(request) == ["call-1", "call-1"]
  end

  test "压缩更早的完整交换不会删除后来未完成的交换" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("读取角色。", [tool_call()])
      |> AuthoringTranscript.append_observation("call-1", observation())
      |> AuthoringTranscript.append_assistant("还有信息缺口。", [
        RequestIR.tool_call_block("read_character", %{}, "pending-call")
      ])

    assert {:ok, compacted} = compact(transcript, ["call-1"])
    assert Enum.take(compacted.messages, length(transcript.messages)) == transcript.messages
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(compacted)
    effective = Compaction.project(ir.messages)

    assert Enum.any?(effective, fn message ->
             Enum.any?(message.blocks, &(Map.get(&1, :call_id) == "pending-call"))
           end)

    assert {:error, {:pending_tool_calls, ["pending-call"]}} = RequestIR.prepare_request(ir)
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
               |> AuthoringTranscript.checkpoint()
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
             transcript |> AuthoringTranscript.checkpoint() |> AuthoringTranscript.restore()

    assert restored.call_ids == ["call-1"]
    assert restored.messages == transcript.messages
  end

  test "canonical recovery 两个红例：map refs 投影一致，string refs 可恢复并保持身份" do
    for refs <- [[%{ref: "archive:fixture"}], ["archive:fixture"]] do
      before = recovery_transcript(refs)

      encoded =
        before
        |> AuthoringTranscript.checkpoint()
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
             |> AuthoringTranscript.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()
  end

  test "恢复不接受 nil、数字、空对象等伪造成 ref 的 observation_refs" do
    for refs <- [[nil], [123], [%{}], [""]] do
      transcript = recovery_transcript(refs)

      assert {:error, :invalid_transcript_checkpoint} =
               transcript
               |> AuthoringTranscript.checkpoint()
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
      |> AuthoringTranscript.append_scope_update("版本化 scope\n第二行", %{
        "scope_revision" => 1,
        "role" => "writer",
        "未知版本键" => "保留"
      })
      |> AuthoringTranscript.declare_used_refs(["character:1"])

    assert {:ok, restored} =
             transcript
             |> AuthoringTranscript.checkpoint()
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
      |> AuthoringTranscript.checkpoint()
      |> Jason.encode!()
      |> Jason.decode!()

    assert {:ok, restored} = AuthoringTranscript.restore(first)

    second =
      restored
      |> AuthoringTranscript.checkpoint()
      |> Jason.encode!()
      |> Jason.decode!()

    assert second == first
  end

  defp recovery_transcript(refs, used_refs \\ ["archive:fixture"]) do
    AuthoringTranscript.new(%{run_id: "recovery-local-fixture"},
      base_text: "保留真实历史。",
      author_text: "  作者原话\n",
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

  defp compact(transcript, call_ids, summary \\ "已读取角色；这不表示候选已获采纳。") do
    AuthoringTranscript.compact(
      transcript,
      %{call_ids: call_ids},
      [%{ref: "character:1", version: 2}],
      %{"character:1" => 2},
      ["省略工具调用的逐字内容；原始证据仍可回查。"],
      summary
    )
  end

  defp provider_call_ids(body) do
    messages = Map.get(body, :messages, Map.get(body, :input, []))

    block_ids =
      for message <- messages,
          block <- Map.get(message, :tool_calls, []) ++ List.wrap(Map.get(message, :content)),
          is_map(block),
          id = Map.get(block, :id) || Map.get(block, :tool_use_id),
          is_binary(id),
          do: id

    message_ids =
      for message <- messages,
          id = Map.get(message, :tool_call_id) || Map.get(message, :call_id),
          is_binary(id),
          do: id

    block_ids ++ message_ids
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

  test "普通作者回合不带来源元数据" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_author_turn("继续写下一场。", "author_turn:turn-3")

    [message] = transcript.messages |> Enum.filter(&(&1.role == "user")) |> Enum.take(-1)
    refute Map.has_key?(message, :author_turn)
  end
end
