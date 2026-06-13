defmodule NovelDomain.DialogueFrame do
  @moduledoc """
  v3 每 turn 必有的认知帧。覆盖 reply-only、exploration、tool_dispatch 全场景。

  字段规格见 docs/design/contracts/VS-00-reply-only-contract-pack.md §2。
  """

  @type frame_type ::
          :casual_reply
          | :creative_exploration
          | :execution_candidate
          | :question_answer
          | :meta_discussion
  @type reason_code ::
          :no_tool_needed
          | :tool_needed
          | :exploratory_only
          | :insufficient_execution_target
          | :user_requested_discussion
  @type execution_readiness :: :not_applicable | :not_ready | :ready

  @type t :: %__MODULE__{
          schema_version: String.t(),
          frame_id: String.t(),
          turn_id: String.t(),
          workspace_id: String.t(),
          primary: boolean(),
          frame_type: frame_type(),
          source_refs: %{author_input_ref: String.t(), dialogue_context_ref: String.t() | nil},
          dialogue_goal: %{summary: String.t()},
          tool_need: %{needs_tool: boolean(), reason_code: reason_code()},
          execution_readiness: execution_readiness(),
          author_visible_draft: %{message: String.t()},
          evidence_summary: map(),
          uncertainty: [map()]
        }

  defstruct [
    :schema_version,
    :frame_id,
    :turn_id,
    :workspace_id,
    :primary,
    :frame_type,
    :source_refs,
    :dialogue_goal,
    :tool_need,
    :execution_readiness,
    :author_visible_draft,
    evidence_summary: %{},
    uncertainty: []
  ]

  @allowed_frame_types [
    :casual_reply,
    :creative_exploration,
    :execution_candidate,
    :question_answer,
    :meta_discussion
  ]
  @allowed_reason_codes [
    :no_tool_needed,
    :tool_needed,
    :exploratory_only,
    :insufficient_execution_target,
    :user_requested_discussion
  ]
  @allowed_execution_readiness [:not_applicable, :not_ready, :ready]

  @doc """
  Validate a DialogueFrame. Returns :ok or {:error, [reasons]}.
  """
  @spec validate(t()) :: :ok | {:error, [String.t()]}
  def validate(%__MODULE__{} = frame) do
    errors =
      []
      |> check_required(frame)
      |> check_frame_type(frame)
      |> check_tool_need(frame)
      |> check_execution_readiness(frame)
      |> check_forbidden(frame)

    case errors do
      [] -> :ok
      _ -> {:error, errors}
    end
  end

  defp check_required(errors, frame) do
    required = [
      {:frame_id, frame.frame_id},
      {:turn_id, frame.turn_id},
      {:workspace_id, frame.workspace_id},
      {:frame_type, frame.frame_type}
    ]

    errors =
      Enum.reduce(required, errors, fn {field, value}, acc ->
        if is_nil(value) || value == "" do
          ["#{field} is required" | acc]
        else
          acc
        end
      end)

    draft = frame.author_visible_draft

    cond do
      is_nil(draft) ->
        ["author_visible_draft is required" | errors]

      not is_map(draft) ->
        ["author_visible_draft must be a map" | errors]

      is_nil(draft[:message]) || draft[:message] == "" ->
        ["author_visible_draft.message is required" | errors]

      true ->
        errors
    end
  end

  defp check_frame_type(errors, frame) do
    if frame.frame_type in @allowed_frame_types do
      errors
    else
      ["invalid frame_type: #{inspect(frame.frame_type)}" | errors]
    end
  end

  defp check_tool_need(errors, frame) do
    tn = frame.tool_need

    cond do
      is_nil(tn) || not is_map(tn) ->
        ["tool_need is required" | errors]

      is_boolean(tn[:needs_tool]) == false ->
        ["tool_need.needs_tool must be a boolean" | errors]

      tn[:reason_code] not in @allowed_reason_codes ->
        ["invalid tool_need.reason_code: #{inspect(tn[:reason_code])}" | errors]

      true ->
        errors
    end
  end

  defp check_execution_readiness(errors, frame) do
    if frame.execution_readiness in @allowed_execution_readiness do
      errors
    else
      ["invalid execution_readiness: #{inspect(frame.execution_readiness)}" | errors]
    end
  end

  defp check_forbidden(errors, frame) do
    draft = frame.author_visible_draft
    message = if is_map(draft), do: draft[:message] || "", else: ""

    forbidden = [
      {"approved", "approved"},
      {"ready_to_execute", "ready_to_execute"},
      {"production_write_allowed", "production_write_allowed"}
    ]

    Enum.reduce(forbidden, errors, fn {word, _desc}, acc ->
      if String.contains?(String.downcase(message), word) do
        ["forbidden semantics found: #{word}" | acc]
      else
        acc
      end
    end)
  end
end
