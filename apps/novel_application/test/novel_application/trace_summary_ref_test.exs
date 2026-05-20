defmodule NovelApplication.TraceSummaryRefTest do
  use ExUnit.Case, async: true

  alias NovelApplication.TraceSummaryRef

  describe "from_turn_result/1" do
    test "prefers canonical trace_ref and falls back to legacy trace_id" do
      assert TraceSummaryRef.from_turn_result(%{
               trace_summary: %{trace_ref: "trace-canonical", trace_id: "trace-legacy"}
             }) == "trace-canonical"

      assert TraceSummaryRef.from_turn_result(%{
               "trace_summary" => %{"trace_id" => "trace-legacy"}
             }) == "trace-legacy"
    end

    test "ignores blank and non-string trace refs" do
      assert TraceSummaryRef.from_turn_result(%{trace_summary: %{trace_ref: " ", trace_id: 123}}) ==
               nil
    end
  end
end
