defmodule NovelCommon.Contracts.QualityEvaluationResult do
  @moduledoc """
  独立质量评估结果（VS-00E §8）。

  evaluator 的输出契约，**不复用** `CreativeOutputSelfReport`（writer 自报告不可作为权威
  质量结果）。`status: :ok` 携带 finding map 列表；`status: :error` 表示评审未完成，由上层
  降级为 `quality_review_unavailable`（ADR-0020 I3：失败 ≠ 通过）。
  """

  @type t :: %__MODULE__{
          status: :ok | :error,
          findings: [map()],
          provider_call_ref: String.t() | nil,
          error: map() | nil
        }

  defstruct status: :ok, findings: [], provider_call_ref: nil, error: nil

  @spec ok([map()], String.t() | nil) :: t()
  def ok(findings, provider_call_ref \\ nil) when is_list(findings) do
    %__MODULE__{status: :ok, findings: findings, provider_call_ref: provider_call_ref}
  end

  @spec error(map()) :: t()
  def error(reason) when is_map(reason) do
    %__MODULE__{status: :error, findings: [], error: reason}
  end
end
