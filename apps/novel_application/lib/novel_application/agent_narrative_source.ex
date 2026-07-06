defmodule NovelApplication.AgentNarrativeSource do
  @moduledoc """
  Builds and verifies provider-output byte bindings for author-facing narratives.

  N-NARR only allows an author-visible process narrative when the exact bytes are
  present in the model output for the same provider execution. Application
  summaries, event summaries, parsed JSON maps, and frontend copy are not valid
  sources.
  """

  alias NovelCommon.Contracts.ProviderOutput

  @type source :: %{
          required(:source_type) => String.t(),
          required(:provider_run_ref) => String.t(),
          required(:provider_call_ref) => String.t(),
          required(:provider_output_ref) => String.t(),
          required(:source_hash) => String.t(),
          required(:source_byte_range) => %{
            required(:start) => non_neg_integer(),
            required(:length) => non_neg_integer()
          },
          required(:narrative_hash) => String.t()
        }

  @spec from_provider_result(map(), String.t()) :: {:ok, source()} | {:error, term()}
  def from_provider_result(provider_result, narrative)
      when is_map(provider_result) and is_binary(narrative) do
    narrative = String.trim(narrative)

    with :ok <- require_narrative(narrative),
         {:ok, output} <- provider_output(provider_result),
         {:ok, source_text} <- provider_output_text(output),
         :ok <- result_content_matches_output(provider_result, source_text),
         {:ok, %{start: start, length: length}} <- source_byte_range(source_text, narrative) do
      {:ok,
       %{
         source_type: "provider_output",
         provider_run_ref: output.provider_run_ref,
         provider_call_ref: output.provider_call_ref,
         provider_output_ref: output.provider_run_ref,
         source_hash: sha256(source_text),
         source_byte_range: %{start: start, length: length},
         narrative_hash: sha256(narrative)
       }}
    end
  end

  def from_provider_result(_provider_result, _narrative), do: {:error, :invalid_provider_result}

  @doc """
  Binds an author narrative that arrived inside a native tool call's
  `author_reasoning` argument (providers that emit empty assistant content
  under forced tool_choice, e.g. LM Studio). The runtime ProviderOutput
  content already carries the tool calls; the narrative bytes must equal the
  `author_reasoning` field of the matching call.
  """
  @spec from_tool_call_narrative(map(), String.t(), String.t()) ::
          {:ok, source()} | {:error, term()}
  def from_tool_call_narrative(provider_result, tool_name, narrative)
      when is_map(provider_result) and is_binary(tool_name) and is_binary(narrative) do
    narrative = String.trim(narrative)

    with :ok <- require_narrative(narrative),
         {:ok, output} <- provider_output(provider_result),
         {:ok, source_text} <- tool_narrative_text(output, tool_name),
         :ok <- narrative_matches_tool_source(source_text, narrative) do
      {:ok,
       %{
         source_type: "provider_output_tool_narrative",
         provider_run_ref: output.provider_run_ref,
         provider_call_ref: output.provider_call_ref,
         provider_output_ref: output.provider_run_ref,
         tool_call_name: tool_name,
         source_hash: sha256(source_text),
         source_byte_range: %{start: 0, length: byte_size(narrative)},
         narrative_hash: sha256(narrative)
       }}
    end
  end

  def from_tool_call_narrative(_provider_result, _tool_name, _narrative),
    do: {:error, :invalid_provider_result}

  @source_types ["provider_output", "provider_output_tool_narrative"]

  @spec provider_output_source?(map()) :: boolean()
  def provider_output_source?(source) when is_map(source) do
    with type when type in @source_types <- map_get(source, :source_type),
         {:ok, _provider_run_ref} <- required_string(source, :provider_run_ref),
         {:ok, _provider_call_ref} <- required_string(source, :provider_call_ref),
         {:ok, _provider_output_ref} <- required_string(source, :provider_output_ref),
         {:ok, _source_hash} <- required_string(source, :source_hash),
         {:ok, _narrative_hash} <- required_string(source, :narrative_hash),
         {:ok, _range} <- byte_range(source) do
      true
    else
      _ -> false
    end
  end

  def provider_output_source?(_source), do: false

  @spec verify(String.t(), map(), %{String.t() => ProviderOutput.t() | String.t() | map()}) ::
          :ok | {:error, term()}
  def verify(narrative, source, provider_outputs)
      when is_binary(narrative) and is_map(source) and is_map(provider_outputs) do
    with :ok <- require_source_type(source),
         {:ok, output_ref} <- required_string(source, :provider_output_ref),
         {:ok, source_text} <- lookup_source_text(provider_outputs, output_ref, source),
         :ok <- verify_hash(:source_hash, source, source_text),
         :ok <- verify_hash(:narrative_hash, source, narrative),
         {:ok, range} <- byte_range(source) do
      verify_range(source_text, narrative, range)
    end
  end

  def verify(_narrative, _source, _provider_outputs), do: {:error, :invalid_narrative_source}

  defp require_narrative(""), do: {:error, :empty_author_narrative}
  defp require_narrative(_narrative), do: :ok

  defp provider_output(provider_result) do
    case map_get(provider_result, :provider_output) do
      %ProviderOutput{status: :ok} = output -> {:ok, output}
      %ProviderOutput{} -> {:error, :provider_output_not_ok}
      _ -> {:error, :provider_output_required}
    end
  end

  defp provider_output_text(%ProviderOutput{content: content}) when is_map(content) do
    case map_get(content, :text) do
      text when is_binary(text) and text != "" -> {:ok, text}
      _ -> {:error, :provider_output_text_required}
    end
  end

  defp provider_output_text(_output), do: {:error, :provider_output_text_required}

  defp result_content_matches_output(provider_result, source_text) do
    case map_get(provider_result, :content) do
      content when is_binary(content) and content == source_text -> :ok
      content when is_binary(content) -> {:error, :provider_result_content_mismatch}
      _ -> :ok
    end
  end

  defp source_byte_range(source_text, narrative) do
    case :binary.match(source_text, narrative) do
      {start, length} -> {:ok, %{start: start, length: length}}
      :nomatch -> {:error, :narrative_not_bound_to_provider_output}
    end
  end

  defp require_source_type(source) do
    case map_get(source, :source_type) do
      type when type in @source_types -> :ok
      _ -> {:error, :source_type_must_be_provider_output}
    end
  end

  defp lookup_source_text(provider_outputs, output_ref, source) do
    provider_outputs
    |> Map.get(output_ref)
    |> case do
      %ProviderOutput{} = output -> output_source_text(output, source)
      text when is_binary(text) -> {:ok, text}
      %{text: text} when is_binary(text) -> {:ok, text}
      %{"text" => text} when is_binary(text) -> {:ok, text}
      _ -> {:error, {:provider_output_not_found, output_ref}}
    end
  end

  defp output_source_text(%ProviderOutput{} = output, source) do
    case map_get(source, :source_type) do
      "provider_output_tool_narrative" ->
        with {:ok, tool_name} <- required_string(source, :tool_call_name) do
          tool_narrative_text(output, tool_name)
        end

      _ ->
        provider_output_text(output)
    end
  end

  defp tool_narrative_text(%ProviderOutput{content: content}, tool_name) when is_map(content) do
    content
    |> map_get(:tool_calls)
    |> List.wrap()
    |> Enum.find(fn call -> is_map(call) and map_get(call, :name) == tool_name end)
    |> case do
      nil -> {:error, :tool_call_not_in_provider_output}
      call -> tool_call_author_reasoning(map_get(call, :arguments))
    end
  end

  defp tool_narrative_text(_output, _tool_name), do: {:error, :tool_narrative_text_required}

  defp tool_call_author_reasoning(args) when is_map(args) do
    case map_get(args, :author_reasoning) do
      text when is_binary(text) and text != "" -> {:ok, String.trim(text)}
      _ -> {:error, :tool_narrative_text_required}
    end
  end

  defp tool_call_author_reasoning(_args), do: {:error, :tool_narrative_text_required}

  defp narrative_matches_tool_source(source_text, narrative) do
    if source_text == narrative do
      :ok
    else
      {:error, :narrative_not_bound_to_tool_call}
    end
  end

  defp verify_hash(key, source, text) do
    case required_string(source, key) do
      {:ok, expected} ->
        if expected == sha256(text), do: :ok, else: {:error, {:hash_mismatch, key}}

      error ->
        error
    end
  end

  defp byte_range(source) do
    range = map_get(source, :source_byte_range)

    start = map_get(range, :start)
    length = map_get(range, :length)

    if is_integer(start) and start >= 0 and is_integer(length) and length >= 0 do
      {:ok, %{start: start, length: length}}
    else
      {:error, :source_byte_range_required}
    end
  end

  defp verify_range(source_text, narrative, %{start: start, length: length}) do
    if start + length <= byte_size(source_text) and
         binary_part(source_text, start, length) == narrative do
      :ok
    else
      {:error, :source_byte_range_mismatch}
    end
  end

  defp required_string(map, key) do
    case map_get(map, key) do
      value when is_binary(value) and value != "" -> {:ok, value}
      _ -> {:error, {key, :required}}
    end
  end

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp sha256(value) when is_binary(value) do
    :crypto.hash(:sha256, value)
    |> Base.encode16(case: :lower)
  end
end
