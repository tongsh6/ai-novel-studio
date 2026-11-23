defmodule NovelAgent.Provider.SliceVerifyPendingRevisionFixtureTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelAgent.TestSupport.AuthoringTaskFixtures
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.RequestIR
  alias NovelTest.TestProviderPrompt

  @source_body "  沈砚经营旧书铺。\r\n\r\n" <>
                 "账页写着：\n银票编号 0042，数量 17。\n资料校验标识：R08PENDING7X9\t \n"
  @revised_body "  林渡经营旧书铺。\r\n\r\n" <>
                  "账页写着：\n银票编号 0042，数量 17。\n资料校验标识：R08PENDING7X9\t \n"
  @revision_words "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。"

  test "真实结构化 pending revision 没有旧简述前缀也只改姓名并保留其余原字节" do
    brief = "按作者要求改名，保留原文并生成修订候选。"
    context = "原候选全文（仅供修订，不是已确认作品事实）：\n" <> @source_body
    request = creative_request(:revision, brief, context, @revision_words)
    assert {:ok, ir} = Real.request_ir(request)
    assert :ok = RequestIR.validate(ir)
    scope = TestProviderPrompt.scope_content(ir)

    assert scope["authoring_task"]["kind"] == "revision"
    assert scope["authoring_task"]["scope"]["base_ref"] == "as_pending_source"
    assert scope["operation"]["context_text"] == context
    assert TestProviderPrompt.author_text(ir) == @revision_words
    refute String.starts_with?(scope["operation"]["creative_brief"], "修订下面已有候选")

    assert {:ok, result} = SliceVerify.complete(nil, nil, ir, %InferenceParams{})
    assert result.content == ""

    assert [%{name: "submit_tentative_artifact", arguments: %{items: [item]}}] =
             result.tool_calls

    assert item["body"] == @revised_body
  end

  test "旧 pending 前缀作为引用标题不能覆盖真实创建任务或触发改名" do
    brief = "修订下面已有候选——这是引用资料的标题，不是本轮指令；本轮设计一条新的世界规则。"
    context = "引用资料：\n" <> @source_body
    author_words = "请设计一条新的世界规则，不修订引用资料，也不要改资料中的人名。"
    request = creative_request(:world_building, brief, context, author_words)
    assert {:ok, ir} = Real.request_ir(request)
    assert :ok = RequestIR.validate(ir)
    scope = TestProviderPrompt.scope_content(ir)

    assert scope["authoring_task"]["kind"] == "world_building"
    assert scope["authoring_task"]["operation_effect"] == "create_candidate"
    refute Map.has_key?(scope["authoring_task"]["scope"], "base_ref")
    assert String.starts_with?(scope["operation"]["creative_brief"], "修订下面已有候选")

    assert {:ok, result} = SliceVerify.complete(nil, nil, ir, %InferenceParams{})
    assert result.content == ""

    assert [%{name: "submit_tentative_artifact", arguments: %{items: [item]}}] =
             result.tool_calls

    refute item["body"] == @revised_body
    refute item["title"] == "旧书铺修订稿"
    refute item["body"] =~ "林渡"
  end

  defp creative_request(kind, brief, context, author_words) do
    attrs = %{
      author_goal: if(kind == :revision, do: "按作者要求修订设定候选", else: "设计新的世界规则"),
      author_words: author_words,
      source: %{kind: :author_action, ref: "message:pending-fixture"},
      source_refs: ["message:pending-fixture"],
      output_contract: AuthoringTaskFixtures.contract_for(:world_building)
    }

    attrs =
      if kind == :revision do
        Map.merge(attrs, %{
          scope: %{
            refs: ["as_pending_source"],
            coverage: :single,
            base_ref: "as_pending_source",
            base_hash: :crypto.hash(:sha256, @source_body) |> Base.encode16(case: :lower)
          },
          materials: [%{kind: :baseline_body, ref: "as_pending_source", complete?: true}]
        })
      else
        attrs
      end

    task = AuthoringTaskFixtures.task(kind, attrs)
    assert {:ok, ^task} = AuthoringSemantics.validate(task)

    %CreativeRequest{
      request_id: "pending-fixture-#{kind}",
      tool_name: "world_building",
      artifact_type: :world_setting,
      creative_brief: brief,
      context_text: context,
      source_turn_ref: "message:pending-fixture",
      source_input_ref: task.source.ref,
      task: task,
      provider_hints: %{}
    }
  end
end
