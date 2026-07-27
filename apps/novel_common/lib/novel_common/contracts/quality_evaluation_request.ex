defmodule NovelCommon.Contracts.QualityEvaluationRequest do
  @moduledoc """
  独立质量评估请求（VS-00E §8）。

  与 `CreativeRequest`（正文生成）分离：本契约只承载「要评审什么正文、对照哪些目标」，
  供独立 evaluator 产出 `QualityEvaluationResult`。evaluator 只读，不产作品事实。
  """

  @type t :: %__MODULE__{
          request_id: String.t(),
          source_turn_ref: String.t() | nil,
          source_ref: String.t() | nil,
          source_type: atom(),
          prose_text: String.t(),
          execution_brief: String.t() | nil,
          reader_effect: String.t() | nil,
          facts_context: String.t() | nil,
          form_candidates: [map()],
          pacing_context: map() | nil
        }

  @enforce_keys [:request_id, :prose_text]
  defstruct [
    :request_id,
    :source_turn_ref,
    :source_ref,
    :prose_text,
    source_type: :prose_fragment,
    execution_brief: nil,
    reader_effect: nil,
    facts_context: nil,
    form_candidates: [],
    pacing_context: nil
  ]
end
