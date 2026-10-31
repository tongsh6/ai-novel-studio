defmodule NovelApplication.AuthoringTranscriptTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.RequestIR.Projection
  alias NovelApplication.AuthoringTranscript

  @author_text "先读取沈砚的当前叙事身份，再给出把主角改为顾青的 tentative 候选。"

  defp run do
    %{run_id: "run-ir-1", work_id: "work-1", workspace_id: "ws-1", goal: %{text: @author_text}}
  end

  defp tools do
    [%{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}]
  end

  defp full_caps, do: Map.new(RequestIR.required_capabilities(), &{&1, true})

  defp base_transcript do
    AuthoringTranscript.new(run(),
      base_text: "run goal: 读取角色事实后给出 tentative 候选",
      author_text: @author_text,
      author_turn_ref: "author_turn:turn-1",
      base_refs: [%{ref: "work:work-1", version: 3}],
      tools: tools(),
      projection: %{target: "chat_completions", capability_profile: full_caps()}
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

    assert {:ok, body} = Projection.project(ir)
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
    assert {:ok, body} = Projection.project(ir)

    tool = Enum.find(body.messages, &(&1.role == "tool"))
    assert tool.content =~ "failed"
    assert tool.content =~ "missing_argument"

    assert length(Enum.filter(body.messages, &(&1.role == "user"))) == 2
  end

  test "application_base 带 provenance 标记，不冒充作者消息（I-ART-3）" do
    {:ok, ir} = AuthoringTranscript.to_request_ir(base_transcript())
    {:ok, body} = Projection.project(ir)

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
    {:ok, body} = Projection.project(ir)
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
    {:ok, body} = Projection.project(ir)

    checkpoint_message =
      Enum.find(body.messages, &(is_binary(&1.content) and &1.content =~ "checkpoint"))

    assert checkpoint_message.content =~ "turn-1..turn-20"
    refute inspect(body) =~ "author_exit"
  end
end
