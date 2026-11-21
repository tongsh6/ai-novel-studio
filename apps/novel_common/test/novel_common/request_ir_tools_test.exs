defmodule NovelCommon.RequestIR.ToolsTest do
  use ExUnit.Case, async: true

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Tools

  defp ir(tools, tool_choice) do
    RequestIR.new(%{
      run: %{run_id: "run-tools"},
      system: RequestIR.system_envelope(),
      messages: [
        RequestIR.message(:user, :author, [RequestIR.text_block("观察")])
      ],
      tools: tools,
      projection: %{tool_choice: tool_choice}
    })
  end

  test "active_tool_name 由目录与选择共同决定，不把多工具目录中的一个名字当成本阶段" do
    specs = [%{name: "first", input_schema: %{}}, %{name: "second", input_schema: %{}}]

    assert Tools.active_tool_name(ir(specs, "auto")) == nil
    assert Tools.active_tool_name(ir(specs, "second")) == "second"
    assert Tools.active_tool_name(ir(specs, "absent")) == nil
    assert Tools.active_tool_name(ir([hd(specs)], "auto")) == "first"
    assert Tools.active_tool_name(ir([hd(specs)], "none")) == nil
  end

  test "tool_specs 只从 IR.tools 规范化，缺 schema 的条目被丢弃而不是伪造默认 schema" do
    ir =
      ir(
        [
          %{name: "ok", description: "有完整 schema", input_schema: %{type: "object"}},
          %{"name" => "string_key_schema", "parameters" => %{"type" => "object"}},
          %{name: "missing_schema"},
          %{name: "", input_schema: %{type: "object"}}
        ],
        "auto"
      )

    assert Tools.tool_specs(ir) == [
             %{name: "ok", description: "有完整 schema", input_schema: %{"type" => "object"}},
             %{name: "string_key_schema", description: "", input_schema: %{"type" => "object"}}
           ]
  end

  test "select 的 nil 与显式名称保留原目录顺序和 schema 字节结构" do
    first = %{
      name: "first",
      input_schema: %{type: "object", properties: %{text: %{type: "string"}}}
    }

    second = %{"name" => "second", "parameters" => %{"type" => "object"}, "description" => " 原文 "}
    request = ir([first, second], "auto")

    assert Tools.select(request, nil) == {:ok, [first, second]}
    assert Tools.select(request, ["second", "first"]) == {:ok, [first, second]}
    assert Tools.select(request, ["second"]) == {:ok, [second]}
    assert Tools.select(request, []) == {:ok, []}

    assert Tools.select(request, ["missing", "first"]) ==
             {:error, {:unknown_tool_names, ["missing"]}}
  end

  test "select 不经 tool_specs 过滤坏条目，请求边界仍先拒收坏目录" do
    valid = %{name: "first", input_schema: %{type: "object"}}
    missing_schema = %{name: "missing_schema"}
    malformed = %{name: "", input_schema: %{type: "object"}}
    request = ir([valid, missing_schema, malformed], "auto")

    assert Tools.select(request, nil) == {:ok, [valid, missing_schema, malformed]}
    assert Tools.select(request, ["missing_schema"]) == {:ok, [missing_schema]}

    assert {:error, :malformed_tool_schema} =
             RequestIR.prepare_request(request, tool_names: ["first"])
  end

  test "name 保留原目录 atom 与 string 键规则，不补合法名称" do
    assert Tools.name(%{name: "first"}) == "first"
    assert Tools.name(%{"name" => "second"}) == "second"
    assert Tools.name(%{"name" => "fallback", name: ""}) == "fallback"
    assert Tools.name(%{"name" => "ignored", name: "first"}) == "first"

    for invalid <- [nil, %{}, %{name: ""}, %{"name" => false}, "first"] do
      assert Tools.name(invalid) == nil
    end
  end
end
