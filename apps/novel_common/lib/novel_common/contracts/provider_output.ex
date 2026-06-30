defmodule NovelCommon.Contracts.ProviderOutput do
  @moduledoc """
  Final materialized output from one provider execution stream.

  This contract is the bridge for compatibility callers that still need a final
  value. It does not define a second provider execution path; it is only the
  terminal fact produced by ProviderEvent.
  """

  @type status :: :ok | :error | :cancelled
  @type output_type :: :text | :json | :empty

  @type t :: %__MODULE__{
          provider_run_ref: String.t(),
          provider_call_ref: String.t(),
          status: status(),
          output_type: output_type(),
          content: map(),
          usage: map(),
          error: map(),
          refs: [String.t()],
          finalized_at: DateTime.t() | nil
        }

  @statuses [:ok, :error, :cancelled]
  @output_types [:text, :json, :empty]

  @enforce_keys [:provider_run_ref, :provider_call_ref, :status]
  defstruct [
    :provider_run_ref,
    :provider_call_ref,
    :status,
    output_type: :text,
    content: %{},
    usage: %{},
    error: %{},
    refs: [],
    finalized_at: nil
  ]

  @spec new(map() | keyword()) :: {:ok, t()} | {:error, [String.t()]}
  def new(attrs) do
    output = struct(__MODULE__, normalize(attrs))

    case validate(output) do
      [] -> {:ok, output}
      errors -> {:error, errors}
    end
  end

  @spec terminal?(t()) :: boolean()
  def terminal?(%__MODULE__{status: status}) when status in @statuses, do: true
  def terminal?(_output), do: false

  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = output) do
    []
    |> require_present(:provider_run_ref, output.provider_run_ref)
    |> require_present(:provider_call_ref, output.provider_call_ref)
    |> validate_status(output.status)
    |> validate_output_type(output.output_type)
  end

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:status, nil, &normalize_status/1)
    |> Map.update(:output_type, :text, &normalize_output_type/1)
    |> Map.update(:content, %{}, &normalize_map/1)
    |> Map.update(:usage, %{}, &normalize_map/1)
    |> Map.update(:error, %{}, &normalize_map/1)
    |> Map.update(:refs, [], &normalize_strings/1)
  end

  defp atomize_known(attrs),
    do: for({key, value} <- attrs, into: %{}, do: {known_key(key), value})

  defp known_key(key) when is_atom(key), do: key
  defp known_key("provider_run_ref"), do: :provider_run_ref
  defp known_key("provider_call_ref"), do: :provider_call_ref
  defp known_key("status"), do: :status
  defp known_key("output_type"), do: :output_type
  defp known_key("content"), do: :content
  defp known_key("usage"), do: :usage
  defp known_key("error"), do: :error
  defp known_key("refs"), do: :refs
  defp known_key("finalized_at"), do: :finalized_at
  defp known_key(key), do: key

  defp normalize_status(value) when value in @statuses, do: value

  defp normalize_status(value) when is_binary(value),
    do: Enum.find(@statuses, &(Atom.to_string(&1) == value))

  defp normalize_status(_), do: nil

  defp normalize_output_type(value) when value in @output_types, do: value

  defp normalize_output_type(value) when is_binary(value),
    do: Enum.find(@output_types, &(Atom.to_string(&1) == value))

  defp normalize_output_type(_), do: nil

  defp normalize_map(value) when is_map(value), do: value
  defp normalize_map(_), do: %{}

  defp normalize_strings(values) when is_list(values) do
    values |> Enum.map(&to_string/1) |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))
  end

  defp normalize_strings(_), do: []

  defp require_present(errors, _field, value) when is_binary(value) and value != "", do: errors
  defp require_present(errors, field, _value), do: ["#{field} is required" | errors]

  defp validate_status(errors, status) when status in @statuses, do: errors
  defp validate_status(errors, _status), do: ["status is invalid" | errors]

  defp validate_output_type(errors, output_type) when output_type in @output_types, do: errors
  defp validate_output_type(errors, _output_type), do: ["output_type is invalid" | errors]
end
