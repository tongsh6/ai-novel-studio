defmodule NovelAgent.Provider.StubTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Stub
  alias NovelCommon.RequestIR
  alias NovelTest.TestRequestIR

  setup do
    {:ok, stub: %Stub{}}
  end

  describe "name/0" do
    test "returns stub identifier" do
      assert Stub.name() == "stub"
    end
  end

  describe "complete/4" do
    test "returns echo response", %{stub: stub} do
      prompt = TestRequestIR.ir([TestRequestIR.author("hello world")])

      assert {:ok, result} = Stub.complete(stub, "test-model", prompt, %InferenceParams{})
      assert result.content =~ "hello world"
      refute result.content =~ "[stub]"
    end

    test "works with empty prompt", %{stub: stub} do
      prompt = TestRequestIR.ir([TestRequestIR.base("")])

      assert {:ok, result} = Stub.complete(stub, "any-model", prompt, %InferenceParams{})
      assert result.content != ""
      refute result.content =~ "[stub]"
    end
  end

  test "原生创作 scope 允许空上下文并保留作者标识", %{stub: stub} do
    prompt =
      TestRequestIR.ir(
        [
          TestRequestIR.base("## 创作协作共同规则"),
          TestRequestIR.scope(%{
            operation: %{
              artifact_type: "prose_fragment",
              creative_brief: "  标识符 EMPTYCTX9 必须保留\n",
              context_text: ""
            }
          })
        ],
        tools: [TestRequestIR.tool("submit_tentative_artifact")]
      )

    assert {:ok, result} = Stub.complete(stub, nil, prompt, %InferenceParams{})
    assert [%{arguments: %{items: [item]}}] = result.tool_calls
    assert item["body"] =~ "EMPTYCTX9"
    refute item["body"] =~ "application_base"
  end

  test "判断阶段由当前工具目录识别，历史或描述中的续行名称不能改写路由", %{stub: stub} do
    prompt =
      TestRequestIR.ir(
        [
          TestRequestIR.base("旧说明曾提及 continuation_decision 和 AgentRun 计划起草器。"),
          TestRequestIR.author("先看看现有角色阵容，然后设计一个反派")
        ],
        tools: [
          TestRequestIR.tool("judgment_decision"),
          TestRequestIR.tool("agent_plan_draft"),
          TestRequestIR.tool("ask_author")
        ],
        projection: %{tool_choice: "auto"}
      )

    assert {:ok, result} = Stub.complete(stub, nil, prompt, %InferenceParams{})
    assert [%{name: "judgment_decision", arguments: arguments}] = result.tool_calls
    assert arguments.action == "execute"
    assert arguments.capability == "character_design"
    assert arguments.author_reasoning != ""
    refute Map.has_key?(arguments, :reason)
    assert result.content == ""
  end

  test "复杂判断直接给一个完整计划，作者说明只有 author_reasoning", %{stub: stub} do
    author = "梳理伏笔并重写第01章正文"

    prompt =
      TestRequestIR.ir(
        [
          TestRequestIR.author(author),
          TestRequestIR.scope(%{
            goal: %{text: author, version: 1},
            facts: %{chapters: [%{id: "chapter-one", title: "第01章：开端"}]}
          })
        ],
        tools: [
          TestRequestIR.tool("judgment_decision"),
          TestRequestIR.tool("agent_plan_draft"),
          TestRequestIR.tool("ask_author")
        ],
        projection: %{tool_choice: "auto"}
      )

    assert {:ok, result} = Stub.complete(stub, nil, prompt, %InferenceParams{})
    assert [%{name: "agent_plan_draft", arguments: arguments}] = result.tool_calls
    assert result.content == ""

    assert Enum.sort(Map.keys(arguments)) == [
             "author_reasoning",
             "confidence",
             "plan",
             "reason_codes"
           ]

    assert arguments["author_reasoning"] != ""
    assert [read, write] = arguments["plan"]["steps"]
    assert read["target_tool_ref"] == "context_assemble"
    assert write["target_tool_ref"] == "prose_writing"
    assert write["authoring_intent"] == "rewrite"
    assert write["target_chapter"] == "第01章：开端"
  end

  test "续行工具只有作者说明，普通判断回复只有 content", %{stub: stub} do
    continuation =
      TestRequestIR.ir(
        [TestRequestIR.base("旧创作判断器材料"), TestRequestIR.author("质量复核发现结尾缺失")],
        tools: [TestRequestIR.tool("continuation_decision"), TestRequestIR.tool("ask_author")]
      )

    assert {:ok, result} = Stub.complete(stub, nil, continuation, %InferenceParams{})
    assert [%{name: "continuation_decision", arguments: arguments}] = result.tool_calls
    assert arguments.action == "continue"
    assert arguments.author_reasoning != ""
    refute Map.has_key?(arguments, :reason)
    assert result.content == ""

    reply =
      TestRequestIR.ir(
        [TestRequestIR.author("只聊人物的选择")],
        tools: [TestRequestIR.tool("judgment_decision"), TestRequestIR.tool("ask_author")]
      )

    assert {:ok, result} = Stub.complete(stub, nil, reply, %InferenceParams{})
    assert result.tool_calls == []
    assert result.content != ""
  end

  for tool <- ["agent_plan_draft", "agent_plan_revision"] do
    test "#{tool} 按当前单工具进入专业阶段，不被旧判断与续行历史覆盖", %{stub: stub} do
      tool = unquote(tool)

      scope = %{
        goal: %{text: "设计当前角色", version: 2},
        operation: %{profile_ref: "character_design_with_context_v1"}
      }

      assert {:ok, result} =
               Stub.complete(stub, nil, operation_prompt(tool, scope), %InferenceParams{})

      assert [%{"name" => ^tool, "arguments" => arguments}] = result.tool_calls
      assert result.content == ""
      assert arguments["author_reasoning"] != ""
      assert Enum.any?(arguments["plan"]["steps"], &(&1["target_tool_ref"] == "character_design"))
      refute Enum.any?(arguments["plan"]["steps"], &(&1["target_tool_ref"] == "fact_inventory"))

      if tool == "agent_plan_revision",
        do: assert("agent_plan_revised" in arguments["reason_codes"])
    end
  end

  for tool <- ["chapter_mission", "planning_mission"] do
    test "#{tool} 以当前工具决定使命种类，只引用最新材料", %{stub: stub} do
      tool = unquote(tool)

      scope = %{
        goal: %{text: "推进当前线索。"},
        operation: %{
          mission_inputs: %{
            items: [
              %{ref: "ledger:information:foreshadow_current", group: "information", text: "当前伏笔"},
              %{ref: "plan:current", group: "plan", text: "当前计划"}
            ]
          }
        }
      }

      assert {:ok, result} =
               Stub.complete(stub, nil, operation_prompt(tool, scope), %InferenceParams{})

      assert [%{"name" => ^tool, "arguments" => arguments}] = result.tool_calls

      assert Enum.map(arguments["must_advance"], & &1["basis_ref"]) == [
               "ledger:information:foreshadow_current",
               "plan:current"
             ]

      refute inspect(result) =~ "foreshadow_old"

      if tool == "planning_mission",
        do: assert(arguments["statement"] =~ "接下来的章节"),
        else: assert(arguments["statement"] =~ "本章")
    end
  end

  defp operation_prompt(tool, scope) do
    history = %{
      goal: %{text: "旧阶段材料"},
      operation: %{
        profile_ref: "fact_inventory_v1",
        mission_inputs: %{
          items: [%{ref: "ledger:information:foreshadow_old", text: "旧材料", group: "information"}]
        }
      }
    }

    TestRequestIR.ir(
      [
        TestRequestIR.scope(history),
        TestRequestIR.assistant("上一阶段已完成。"),
        TestRequestIR.scope(scope)
      ],
      tools: [TestRequestIR.tool(tool)],
      projection: %{tool_choice: "auto"}
    )
  end

  describe "behaviour conformance" do
    test "declares the six test-simulation capabilities and chat projection target" do
      capabilities = Stub.capabilities(%Stub{})

      expected = Map.new(RequestIR.required_capabilities(), &{&1, true})

      assert capabilities == expected
      assert Stub.projection_target(%Stub{}) == "chat_completions"
    end

    test "passes the real Gateway capability gate for fixture IR" do
      prompt =
        TestRequestIR.ir([
          TestRequestIR.base("## 创作协作共同规则"),
          TestRequestIR.author("请回一句收到")
        ])

      assert {:ok, %{result: %Result{content: content}}} =
               Gateway.execute(prompt, nil, %InferenceParams{}, provider: :stub)

      assert is_binary(content)
    end
  end
end
