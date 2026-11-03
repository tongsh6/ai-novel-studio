defmodule NovelAgent.Provider.StubTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.Stub

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
      assert {:ok, result} = Stub.complete(stub, "test-model", "hello world", %InferenceParams{})
      assert result.content =~ "hello world"
      refute result.content =~ "[stub]"
    end

    test "works with empty prompt", %{stub: stub} do
      assert {:ok, result} = Stub.complete(stub, "any-model", "", %InferenceParams{})
      assert result.content != ""
      refute result.content =~ "[stub]"
    end
  end

  test "原生创作 scope 允许空上下文并保留作者标识", %{stub: stub} do
    prompt = %{
      messages: [
        %{role: "user", content: "【应用数据 · application_base】\n## 创作协作共同规则"},
        %{
          role: "user",
          content: "【应用数据 · scope_update】\n版本：{}\n用户创作简述：标识符 EMPTYCTX9 必须保留\n上下文：\n重要：保留标识"
        }
      ],
      tools: [%{name: "submit_tentative_artifact", input_schema: %{type: "object"}}]
    }

    assert {:ok, result} = Stub.complete(stub, nil, prompt, %InferenceParams{})
    assert [%{arguments: %{items: [item]}}] = result.tool_calls
    assert item["body"] =~ "EMPTYCTX9"
    refute item["body"] =~ "application_base"
  end

  for tool <- ["agent_plan_draft", "agent_plan_revision"] do
    test "#{tool} 按当前单工具进入专业阶段，不被旧判断与续行历史覆盖", %{stub: stub} do
      tool = unquote(tool)

      scope =
        "- profile_ref: character_design_with_context_v1\n- author_goal: 设计当前角色\n- goal_version: 2"

      assert {:ok, result} =
               Stub.complete(stub, nil, operation_prompt(tool, scope), %InferenceParams{})

      assert [%{"name" => ^tool, "arguments" => arguments}] = result.tool_calls
      assert Enum.any?(arguments["plan"]["steps"], &(&1["target_tool_ref"] == "character_design"))
      refute Enum.any?(arguments["plan"]["steps"], &(&1["target_tool_ref"] == "fact_inventory"))

      if tool == "agent_plan_revision",
        do: assert("agent_plan_revised" in arguments["reason_codes"])
    end
  end

  for tool <- ["chapter_mission", "planning_mission"] do
    test "#{tool} 以当前工具决定使命种类，只引用最新材料", %{stub: stub} do
      tool = unquote(tool)
      scope = "当前应用目标：推进当前线索。\n[ledger:information:foreshadow_current] 当前伏笔\n[plan:current] 当前计划"

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
    history =
      "本次你承担创作判断器的角色。你的两种续行方式使用 continuation_decision。旧阶段曾使用规划前推理器。\n- profile_ref: fact_inventory_v1\n[ledger:information:foreshadow_old] 旧材料"

    %{
      ir_version: "authoring-request-ir/v1",
      messages: [
        %{role: "user", content: "【应用数据 · scope_update】\n" <> history},
        %{role: "assistant", content: "上一阶段已完成。"},
        %{role: "user", content: "【应用数据 · scope_update】\n" <> scope}
      ],
      tools: [%{name: tool, input_schema: %{type: "object"}}],
      tool_choice: "auto"
    }
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(Stub, :complete, 4)
      assert function_exported?(Stub, :name, 0)
    end
  end
end
