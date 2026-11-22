defmodule NovelAgent.CreativeProvider.RealTaskPromptTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.TestSupport.AuthoringTaskFixtures
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.RequestIR
  alias NovelTest.TestProviderPrompt

  @good_json Jason.encode!([
               %{item_id: "i1", title: "开篇", body: "夜色压在账单上。", rationale: nil}
             ])

  defp execution(agent) do
    AuthoringTaskFixtures.provider_execution(
      fn prompt ->
        Agent.update(agent, fn _ -> prompt end)
        {:ok, %{content: @good_json}}
      end,
      "submit_tentative_artifact"
    )
  end

  defp base_task(kind, attrs) do
    task = %AuthoringTask{
      kind: kind,
      author_goal: "写第 01 章开篇",
      author_words: "  把第一章开篇写出来 NONCE42\r\n\n",
      source: %{kind: :author_action, ref: "turn:t1"},
      scope: %{refs: ["chapter:one"], coverage: :chapter},
      materials: [
        %{
          kind: :target_structure,
          ref: "target_structure:chapter:one",
          complete?: false,
          omission_note: "仅目标章与前后邻章结构窗口"
        }
      ],
      preserve: [],
      operation_effect: :create_candidate,
      output_contract: %{
        kind: :json,
        schema_ref: "prose_writing_v2",
        artifact_type: :prose_fragment,
        required_keys: ["items", "item_id", "title", "body"],
        allow_companions: true
      },
      source_refs: ["turn:t1"],
      semantic_version: AuthoringSemantics.version()
    }

    struct!(task, attrs)
  end

  defp revision_task do
    base_task(:revision,
      operation_effect: :revise_candidate,
      scope: %{refs: ["as_1"], coverage: :single, base_ref: "as_1", base_hash: "abc123"},
      preserve: ["未要求修改的内容逐字保留"],
      author_goal: "按质量发现修订正文候选"
    )
  end

  defp request(task) do
    %CreativeRequest{
      request_id: "req-task",
      tool_name: "prose_writing",
      artifact_type: "prose_fragment",
      creative_brief: "  用户创作简述占位\n## 原样材料\n",
      context_text: "\n上下文占位\r\n  ",
      source_turn_ref: "turn-1",
      source_input_ref: task.source.ref,
      task: task,
      provider_hints: %{}
    }
  end

  defp captured_prompt(task) do
    assert {:ok, ir} = Real.request_ir(request(task))
    assert :ok = RequestIR.validate(ir)
    ir
  end

  test "task-aware writer prompt renders shared semantics exactly once as L1" do
    kind_cases = [
      {:first_draft, "本轮为首稿创作"},
      {:continuation, "本轮为续写"},
      {:rewrite, "本轮为重写/覆盖"}
    ]

    for {kind, operation_marker} <- kind_cases do
      attrs =
        if kind == :rewrite do
          %{
            scope: %{refs: ["chapter:one"], coverage: :chapter, base_ref: "chapter:one"},
            preserve: ["未覆盖范围的正文与既有作品事实保持不变"]
          }
        else
          %{}
        end

      task = base_task(kind, attrs)
      ir = captured_prompt(task)

      prompt = AuthoringTaskFixtures.prompt_text(ir)

      assert String.split(prompt, AuthoringSemantics.static_block(task)) |> length() == 2
      assert prompt =~ "## 创作协作共同规则"
      assert String.split(prompt, "## 创作协作共同规则") |> length() == 2
      assert prompt =~ operation_marker
      scope = TestProviderPrompt.scope_content(ir)
      assert prompt =~ "完成声明必须对应作者实际要求与已交付内容"
      assert prompt =~ "节选中未提及不证明原文不存在"
      assert prompt =~ "不能将未知改记为未交付"
      assert scope["authoring_task"]["semantic_version"] == "b27-semantics-v7"
      assert TestProviderPrompt.author_text(ir) == task.author_words

      assert scope["authoring_task"] ==
               task
               |> AuthoringTask.to_map()
               |> Map.drop(["author_words", "goal_source_ref"])
               |> Jason.encode!()
               |> Jason.decode!()

      refute Map.has_key?(scope["authoring_task"], "author_words")
      assert scope["operation"]["creative_brief"] == request(task).creative_brief
      assert scope["operation"]["context_text"] == request(task).context_text

      assert [
               %{
                 "kind" => "target_structure",
                 "complete?" => false,
                 "omission_note" => "仅目标章与前后邻章结构窗口"
               }
             ] = scope["authoring_task"]["materials"]

      # I3 规则只从单一 helper 渲染一次
      assert String.split(prompt, "随机标识符串") |> length() == 2

      # 输出契约与运行时校验同源：self_report/companions 为可选/允许，不写更严的"必须"
      assert prompt =~ "self_report"
      assert prompt =~ "companion_artifacts"
    end
  end

  test "native rationale explains author-facing creative choices for prose requests" do
    revision =
      AuthoringTaskFixtures.task(:revision, %{
        scope: %{
          refs: ["draft:one"],
          coverage: :complete,
          base_ref: "draft:one",
          target_chapter_ref: "chapter:one",
          object_kind: :chapter_prose,
          expected_base_versions: [%{ref: "draft:one", version: 1}]
        }
      })

    cases = [
      {base_task(:first_draft, %{}), "本轮为首稿创作", false},
      {%{revision | scope: Map.put(revision.scope, :modification_scope, :whole_chapter)},
       "## 整章内容修订", false},
      {%{revision | scope: Map.put(revision.scope, :modification_scope, :target_segments)},
       "target_segments", true}
    ]

    expected_description_fragments = [
      "将直接展示给作者的创作说明",
      "创作取舍、作品依据及预期作用",
      "共同作者说明规则",
      "材料引用身份只放 self_report.used_context_refs",
      "无需说明时省略或为 null"
    ]

    shared_author_rules =
      """
      面向作者，用自然创作语言说明有用的判断、依据与下一步，以实际作品和材料名称指明对象。
      本次调用的工具参数、引用绑定、指纹和版本校验属于内部执行，不将其写成创作说明；
      作品中涉及的同名概念，或作者主动询问的机制，按真实语境正常讨论。
      不机械复述输入。
      """
      |> String.trim()

    for {task, operation_marker, target_mapping?} <- cases do
      assert {:ok, ^task} = AuthoringSemantics.validate(task)
      ir = captured_prompt(task)
      prompt = AuthoringTaskFixtures.prompt_text(ir)

      assert prompt =~ operation_marker
      assert String.split(prompt, shared_author_rules) |> length() == 2

      assert {:ok,
              %{
                tools: [
                  %{
                    type: "function",
                    function: %{name: "submit_tentative_artifact", parameters: schema}
                  }
                ]
              }} = RequestIR.Projection.project(ir, "chat_completions")

      assert schema["required"] == ["items"]
      items = schema["properties"]["items"]
      assert items["type"] == "array"
      assert items["minItems"] == 1
      item_schema = items["items"]

      expected_required =
        if target_mapping?,
          do: ["item_id", "title", "body", "target_segment_ids"],
          else: ["item_id", "title", "body"]

      assert Enum.sort(item_schema["required"]) == Enum.sort(expected_required)

      if target_mapping? do
        mapping = item_schema["properties"]["target_segment_ids"]
        assert mapping["type"] == "array"
        assert mapping["minItems"] == 1
        assert mapping["uniqueItems"] == true
        assert mapping["items"] == %{"type" => "string", "minLength" => 1}
      else
        refute Map.has_key?(item_schema["properties"], "target_segment_ids")
      end

      rationale = item_schema["properties"]["rationale"]

      assert Map.drop(rationale, ["description"]) == %{
               "anyOf" => [%{"type" => "string"}, %{"type" => "null"}]
             }

      for fragment <- expected_description_fragments do
        assert rationale["description"] =~ fragment
      end

      used_refs = schema["properties"]["self_report"]["properties"]["used_context_refs"]
      assert used_refs["type"] == "array"
      assert used_refs["items"] == %{"type" => "string"}
      assert used_refs["description"] =~ "仅列本次实际使用的材料"
      assert used_refs["description"] =~ "成功工具观察使用 content.observation_ref"
      assert used_refs["description"] =~ "底座只用实际供应材料的已声明来源"
      assert used_refs["description"] =~ "作者消息来源、调用编号不授信"
      assert used_refs["description"] =~ "没有使用可省略"
    end
  end

  test "rewrite task prompt has no fixed continuation instruction (X1 closed)" do
    task =
      base_task(:rewrite,
        scope: %{refs: ["chapter:one"], coverage: :chapter, base_ref: "chapter:one"},
        preserve: ["未覆盖范围的正文与既有作品事实保持不变"]
      )

    ir = captured_prompt(task)

    prompt = AuthoringTaskFixtures.prompt_text(ir)

    refute prompt =~ "请在其后自然衔接续写"
    scope = TestProviderPrompt.scope_content(ir)["authoring_task"]
    assert scope["scope"]["base_ref"] == "chapter:one"
    assert scope["preserve"] == ["未覆盖范围的正文与既有作品事实保持不变"]
  end

  test "revision task prompt uses revision operation only" do
    ir = captured_prompt(revision_task())
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert prompt =~ "本轮为修订"
    refute prompt =~ "本轮为续写"
    refute prompt =~ "请在其后自然衔接续写"
    scope = TestProviderPrompt.scope_content(ir)["authoring_task"]
    assert scope["scope"]["base_ref"] == "as_1"
    assert scope["preserve"] == ["未要求修改的内容逐字保留"]
  end

  test "call without task fails instead of using legacy template" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    request = %CreativeRequest{
      request_id: "req-legacy",
      tool_name: "prose_writing",
      artifact_type: "prose_fragment",
      creative_brief: "写第一章开篇",
      context_text: "赛博修仙",
      source_turn_ref: "turn-1",
      provider_hints: %{}
    }

    result = Real.generate(request, execution(agent))
    assert result.status == :error
    assert [%{code: "authoring_task_required"}] = result.errors
    assert Agent.get(agent, & &1) == nil
  end

  test "创作外观复用原生会话，并以工具结果纠正无效参数" do
    request = request(revision_task())
    {:ok, agent} = Agent.start_link(fn -> [] end)

    result_fn = fn prompt ->
      calls = Agent.get_and_update(agent, &{&1, &1 ++ [prompt]})

      if calls == [] do
        {:ok,
         %{
           content: "",
           tool_calls: [
             %{id: "bad-native", name: "submit_tentative_artifact", arguments: "{invalid"}
           ]
         }}
      else
        {:ok,
         %{
           content: "",
           tool_calls: [
             %{
               id: "good-native",
               name: "submit_tentative_artifact",
               arguments: %{items: [%{item_id: "i1", title: "开篇", body: "夜色压在账单上。"}]}
             }
           ]
         }}
      end
    end

    assert Real.generate(request, %Execution{result_fn: result_fn}).status == :ok
    [original, correction] = Agent.get(agent, & &1)
    assert original.ir_version == RequestIR.ir_version()
    assert correction.projection.tool_choice == "submit_tentative_artifact"
    assert Enum.take(correction.messages, length(original.messages)) == original.messages

    # 纠错反馈在 canonical IR 的 validation_result block 里（原 call_id 关联），
    # 不再拼进任何一条 prompt 文本。
    assert Enum.any?(correction.messages, fn message ->
             message.role == "tool" and
               Enum.any?(message.blocks, fn block ->
                 block.type == "validation_result" and
                   block.reason_code == "provider_response_invalid"
               end)
           end)

    refute Enum.any?(correction.messages, fn message ->
             Enum.any?(message.blocks, fn block ->
               is_binary(Map.get(block, :text)) and Map.get(block, :text) =~ "不是合法 JSON"
             end)
           end)
  end
end
