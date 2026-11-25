defmodule NovelApplication.R17CurrentRoleRequestTest do
  use ExUnit.Case, async: true

  import NovelApplication.TestAgenticLoopFixtures, only: [judgment_input: 0]

  alias NovelApplication.{AuthoringCheckpoint, AuthoringTranscript, JudgmentProtocol}
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.{Operation, Projection}

  test "当前角色在判断、专业操作、恢复、续行、再判断之间唯一生效" do
    input = judgment_input()
    judgment = JudgmentProtocol.request_for_production(input)
    assert judgment.system.run_role == "judgment"

    # 原角色标识来自真实 Judgment builder；专业阶段只带本次自己的规则。
    judgment_only = "单个创作产物用 judgment_decision.execute"
    assert judgment.system.instructions =~ judgment_only
    professional_only = "本测试专业角色只使用当前质量工具。"

    spec = %{
      role: "quality_evaluation",
      instructions: AuthoringSemantics.shared_rules() <> "\n" <> professional_only,
      scope: %{operation: %{role: "quality_evaluation", material: "真实材料边界"}},
      tool: %{name: "report_quality_findings", input_schema: %{type: "object"}},
      system_versions: %{output_protocol_version: "current-quality-contract"}
    }

    assert {:ok, professional} = Operation.prepare(judgment, nil, spec)
    assert Enum.take(professional.messages, length(judgment.messages)) == judgment.messages
    assert [%{role: "scope_update"}] = Enum.drop(professional.messages, length(judgment.messages))
    assert professional.system.run_role == "quality_evaluation"
    assert professional.system.output_protocol_version == "current-quality-contract"
    assert professional.system.instructions =~ professional_only
    refute professional.system.instructions =~ judgment_only

    assert {:ok, transcript} = AuthoringTranscript.from_request_ir(professional)
    assert {:ok, checkpoint_ir} = AuthoringTranscript.to_request_ir(transcript)
    assert checkpoint_ir.system == professional.system
    assert checkpoint_ir.run == professional.run
    assert checkpoint_ir.refs == professional.refs
    assert checkpoint_ir.tools == professional.tools

    # from_request_ir / to_request_ir 归属标注由现 canonical owner 派生；原始块与来源不能变。
    assert Enum.map(checkpoint_ir.messages, &Map.delete(&1, :canonical_ref)) ==
             Enum.map(professional.messages, &Map.delete(&1, :canonical_ref))

    checkpoint =
      transcript |> AuthoringCheckpoint.checkpoint() |> Jason.encode!() |> Jason.decode!()

    assert {:ok, restored} = AuthoringTranscript.restore(checkpoint)
    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)
    assert restored_ir.system == checkpoint_ir.system
    assert restored_ir.messages == checkpoint_ir.messages
    assert restored_ir.refs == checkpoint_ir.refs
    assert restored_ir.run == checkpoint_ir.run
    assert RequestIR.json_value(restored_ir.tools) == RequestIR.json_value(checkpoint_ir.tools)

    assert RequestIR.json_value(restored_ir.projection) ==
             RequestIR.json_value(checkpoint_ir.projection)

    for target <- ~w(chat_completions anthropic_messages responses_api) do
      assert {:ok, body} = Projection.project(checkpoint_ir, target)
      assert {:ok, ^body} = Projection.project(restored_ir, target)
    end

    continuation_input =
      Map.merge(input, %{
        transcript: restored,
        deviation_summary: "已有正文，尚需核对结尾",
        observation_block: "本次只继续既有目标"
      })

    continuation = JudgmentProtocol.request_for_production(continuation_input, :continuation)
    assert continuation.system.run_role == "continuation"
    assert continuation.system.instructions =~ "continuation_decision"
    refute continuation.system.instructions =~ professional_only
    refute continuation.system.instructions =~ judgment_only
    refute continuation.system.instructions =~ "不能以 reply / propose_creative_directions"

    assert {:ok, continuation_transcript} = AuthoringTranscript.from_request_ir(continuation)

    again =
      JudgmentProtocol.request_for_production(
        Map.put(input, :transcript, continuation_transcript)
      )

    assert again.system == judgment.system

    for ir <- [judgment, professional, restored_ir, continuation, again] do
      assert :ok = RequestIR.validate(ir)
      assert [author] = Enum.filter(ir.messages, &(&1.role == "user"))
      assert Projection.text_of(author.blocks) == input.author_text

      refute Enum.any?(ir.messages, fn m ->
               m.role == "application_notice" and
                 Enum.any?(m.blocks, &(&1.type == "text"))
             end)

      expected = Projection.system_text(ir.system)
      assert length(String.split(expected, AuthoringSemantics.shared_rules())) == 2

      assert {:ok, chat} = Projection.project(ir, "chat_completions")
      assert [%{role: "system", content: ^expected} | _] = chat.messages
      assert {:ok, anthropic} = Projection.project(ir, "anthropic_messages")
      assert [%{type: "text", text: ^expected}] = anthropic.system
      assert {:ok, responses} = Projection.project(ir, "responses_api")
      assert responses.instructions == expected
    end
  end
end
