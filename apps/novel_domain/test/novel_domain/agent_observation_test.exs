defmodule NovelDomain.AgentObservationTest do
  @moduledoc "B45 CP3：内部输出 Observation 的合法/负例契约矩阵（非页面证据）。"
  use ExUnit.Case, async: true

  alias NovelDomain.AgentObservation

  defp attrs(overrides \\ %{}) do
    Map.merge(
      %{
        observation_id: "obs-1",
        run_ref: "run-1",
        step_ref: "step-1",
        observation_type: :tool_fact,
        source_ref: "tool_result:tr-1",
        summary: "只读探索得到一条可追溯事实。",
        structured_payload: %{"tool" => "archive_read"},
        evidence_refs: ["chapter:1"],
        confidence: 0.9
      },
      overrides
    )
  end

  test "合法 internal observation 通过" do
    assert {:ok, observation} = AgentObservation.new(attrs())
    assert observation.evidence_refs == ["chapter:1"]
    assert observation.confidence == 0.9
  end

  test "缺必要来源/summary 被拒绝，不静默产成功空结果" do
    assert {:error, errors} = AgentObservation.new(Map.delete(attrs(), :summary))
    assert Enum.any?(errors, &String.contains?(&1, "summary"))
    assert {:error, errors} = AgentObservation.new(Map.delete(attrs(), :source_ref))
    assert Enum.any?(errors, &String.contains?(&1, "source_ref"))
  end

  test "非法 observation_type 被 validate 拒绝（new 的 normalize 会降级为 custom，另行登记）" do
    base = struct(AgentObservation, attrs())
    errors = AgentObservation.validate(%{base | observation_type: :unknown_type})
    assert Enum.any?(errors, &String.contains?(&1, "observation_type"))
  end

  test "confidence 越界/证据为空被 validate 拒绝" do
    base = struct(AgentObservation, attrs())

    assert Enum.any?(
             AgentObservation.validate(%{base | confidence: 1.2}),
             &String.contains?(&1, "confidence")
           )

    assert Enum.any?(
             AgentObservation.validate(%{base | evidence_refs: []}),
             &String.contains?(&1, "evidence_refs")
           )
  end

  test "已知边界：new/normalize 对非法 type/confidence 做默认降级而非报错" do
    assert {:ok, %{observation_type: :custom}} =
             AgentObservation.new(attrs(%{observation_type: :unknown_type}))

    assert {:ok, %{confidence: 1.0}} = AgentObservation.new(attrs(%{confidence: 1.2}))
  end
end
