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
end
