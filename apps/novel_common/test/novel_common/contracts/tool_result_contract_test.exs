defmodule NovelCommon.Contracts.ToolResultContractTest do
  @moduledoc "B45 CP3：ToolResult 内部输出契约的正反例（Toolbox 返回前校验的同一函数）。"
  use ExUnit.Case, async: true

  alias NovelCommon.Contracts.ToolResult

  defp result(overrides \\ %{}) do
    struct(
      ToolResult,
      Map.merge(
        %{
          tool_result_id: "tr_1",
          tool_request_ref: "req_1",
          tool_name: "text_analysis",
          status: :succeeded,
          output: %{"ok" => true},
          state_delta: [],
          artifact_refs: [],
          errors: [],
          warnings: [],
          usage: %{},
          trace_refs: [],
          completed_at: DateTime.utc_now()
        },
        overrides
      )
    )
  end

  test "合法 ToolResult 通过" do
    assert ToolResult.validate(result()) == []

    assert ToolResult.validate(result(%{status: :failed, output: nil, errors: [%{code: "x"}]})) ==
             []
  end

  test "缺必填 id/非法 status/output 被拒绝，不冒充成功事实" do
    assert Enum.any?(
             ToolResult.validate(result(%{tool_result_id: ""})),
             &(&1 =~ "tool_result_id")
           )

    assert Enum.any?(
             ToolResult.validate(result(%{tool_request_ref: nil})),
             &(&1 =~ "tool_request_ref")
           )

    assert Enum.any?(ToolResult.validate(result(%{status: :ok})), &(&1 =~ "status"))
    assert Enum.any?(ToolResult.validate(result(%{output: "not-map"})), &(&1 =~ "output"))
  end

  test "列表/映射/completed_at 形状错误被拒绝" do
    assert Enum.any?(ToolResult.validate(result(%{state_delta: :bad})), &(&1 =~ "state_delta"))

    assert Enum.any?(
             ToolResult.validate(result(%{artifact_refs: [""]})),
             &(&1 =~ "artifact_refs")
           )

    assert Enum.any?(ToolResult.validate(result(%{errors: [nil]})), &(&1 =~ "errors"))
    assert Enum.any?(ToolResult.validate(result(%{usage: :bad})), &(&1 =~ "usage"))
    assert Enum.any?(ToolResult.validate(result(%{completed_at: "now"})), &(&1 =~ "completed_at"))
  end

  test "非 ToolResult 结构被拒绝" do
    assert ToolResult.validate(%{}) == ["tool_result must be a ToolResult struct"]
  end
end
