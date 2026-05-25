defmodule NovelDomain.AuthorActionInput do
  @moduledoc """
  作者动作输入。UI 只能提交系统给出的 action，不能发明新 action。
  """

  @type t :: %__MODULE__{
          input_id: String.t(),
          source_turn_ref: String.t(),
          action_id: String.t(),
          action_type: String.t(),
          target_ref: String.t() | nil,
          candidate_set_ref: String.t() | nil,
          candidate_ref: String.t() | nil,
          behavior_ref: String.t() | nil,
          payload: map(),
          idempotency_key: String.t()
        }

  @enforce_keys [:input_id, :source_turn_ref, :action_id, :action_type]
  defstruct [
    :input_id,
    :source_turn_ref,
    :action_id,
    :action_type,
    target_ref: nil,
    candidate_set_ref: nil,
    candidate_ref: nil,
    behavior_ref: nil,
    payload: %{},
    idempotency_key: nil
  ]
end
