defmodule NovelDomain.ConfirmationBinding do
  @moduledoc """
  确认绑定。把作者的确认回答绑定到一个 open confirmation behavior + target，
  并只用于触发重新 gate，不直接写生产状态。

  规格冻结于 docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md §5
  与 ADR-0009：确认不能是「点了按钮就执行最近动作」，必须绑定明确对象后重新审查。
  """

  @type answer_type :: :confirm | :reject | :revise | :cancel

  @type t :: %__MODULE__{
          binding_id: String.t(),
          behavior_ref: String.t(),
          target_ref: String.t(),
          author_input_ref: String.t(),
          answer_type: answer_type(),
          idempotency_key: String.t(),
          rebased_state_snapshot_ref: String.t(),
          gate_result_refs: [String.t()],
          trace_ref: String.t() | nil
        }

  @enforce_keys [
    :binding_id,
    :behavior_ref,
    :target_ref,
    :author_input_ref,
    :answer_type,
    :rebased_state_snapshot_ref,
    :gate_result_refs
  ]
  defstruct [
    :binding_id,
    :behavior_ref,
    :target_ref,
    :author_input_ref,
    :answer_type,
    :idempotency_key,
    :rebased_state_snapshot_ref,
    :gate_result_refs,
    :trace_ref
  ]

  @answer_types [:confirm, :reject, :revise, :cancel]

  @doc """
  从作者动作构建确认绑定。要求 behavior_ref / target_ref / answer_type 齐全，
  且 answer_type 合法；否则返回 {:error, reason}。
  """
  @spec build(map()) :: {:ok, t()} | {:error, String.t()}
  def build(attrs) when is_map(attrs) do
    with {:ok, behavior_ref} <- require_field(attrs, :behavior_ref, "behavior_ref"),
         {:ok, target_ref} <- require_field(attrs, :target_ref, "target_ref"),
         {:ok, author_input_ref} <- require_field(attrs, :author_input_ref, "author_input_ref"),
         {:ok, answer_type} <- require_answer_type(attrs),
         {:ok, rebased_state_snapshot_ref} <-
           require_field(attrs, :rebased_state_snapshot_ref, "rebased_state_snapshot_ref"),
         {:ok, gate_result_refs} <- require_gate_result_refs(attrs) do
      {:ok,
       %__MODULE__{
         binding_id: field(attrs, :binding_id) || generate_id(),
         behavior_ref: behavior_ref,
         target_ref: target_ref,
         author_input_ref: author_input_ref,
         answer_type: answer_type,
         idempotency_key: field(attrs, :idempotency_key),
         rebased_state_snapshot_ref: rebased_state_snapshot_ref,
         gate_result_refs: gate_result_refs,
         trace_ref: field(attrs, :trace_ref)
       }}
    end
  end

  defp field(attrs, key), do: attrs[key] || attrs[Atom.to_string(key)]

  defp require_field(attrs, key, name) do
    value = field(attrs, key)
    if blank?(value), do: {:error, "confirmation binding requires #{name}"}, else: {:ok, value}
  end

  defp require_answer_type(attrs) do
    case normalize_answer_type(field(attrs, :answer_type)) do
      nil -> {:error, "confirmation binding requires a valid answer_type"}
      answer_type -> {:ok, answer_type}
    end
  end

  defp require_gate_result_refs(attrs) do
    refs =
      attrs
      |> field(:gate_result_refs)
      |> List.wrap()
      |> Enum.map(&normalize_ref/1)
      |> Enum.reject(&is_nil/1)

    if refs == [],
      do: {:error, "confirmation binding requires gate_result_refs"},
      else: {:ok, refs}
  end

  @spec confirm?(t()) :: boolean()
  def confirm?(%__MODULE__{answer_type: :confirm}), do: true
  def confirm?(%__MODULE__{}), do: false

  defp normalize_answer_type(value) when value in @answer_types, do: value
  defp normalize_answer_type("confirm"), do: :confirm
  defp normalize_answer_type("reject"), do: :reject
  defp normalize_answer_type("revise"), do: :revise
  defp normalize_answer_type("cancel"), do: :cancel
  defp normalize_answer_type(_), do: nil

  defp normalize_ref(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_ref(_), do: nil

  defp generate_id, do: NovelFoundation.ID.unique("cb")

  defp blank?(nil), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_), do: false
end
