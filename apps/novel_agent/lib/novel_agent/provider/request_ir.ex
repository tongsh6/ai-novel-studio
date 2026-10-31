defmodule NovelAgent.Provider.RequestIR do
  @moduledoc """
  B71 CP2：Authoring Run Transcript / Request IR v1（VS-00L §3–§4）。

  契约：
  - AgentRun 是唯一运行事实源；本结构是每次 Provider 请求的内部中间表示。
  - HTTP body 只是投影（`NovelAgent.Provider.RequestIR.Projection`），不得作为事实源。
  - 消息/工具/观察/校验/候选/作者出口/checkpoint 语义与不变量见 VS-00L §3–§5。

  `messages` 使用 map 列表（role/provenance/blocks/source_refs/versions），
  由 `validate/1` 做数据边界校验；投影层不可见字段不进入 body。
  """

  @ir_version "authoring-request-ir/v1"

  @roles ~w(system application_base user assistant tool checkpoint author_exit)
  @provenances ~w(product application author model tool_result)
  @projection_targets ~w(chat_completions anthropic_messages responses_api)
  @block_types ~w(text tool_call observation validation_result tentative_artifact author_exit checkpoint)
  @forbidden_tool_names ~w(adopt canon_write accept_candidate confirm_candidate self_approve)

  @required_capabilities [
    :native_multi_turn,
    :tool_calls,
    :tool_results,
    :streaming,
    :structured_output,
    :usage
  ]

  defstruct ir_version: @ir_version,
            run: %{},
            system: %{},
            messages: [],
            tools: [],
            projection: %{},
            refs: %{},
            provider_session: nil

  @type t :: %__MODULE__{
          ir_version: String.t(),
          run: map(),
          system: map(),
          messages: [map()],
          tools: [map()],
          projection: map(),
          refs: map(),
          provider_session: nil | map()
        }

  def ir_version, do: @ir_version
  def required_capabilities, do: @required_capabilities

  @doc "构造 IR（只做 envelope；完整校验用 validate/1）。"
  @spec new(map()) :: t()
  def new(attrs \\ %{}) do
    struct(
      __MODULE__,
      Map.take(attrs, [:run, :system, :messages, :tools, :projection, :refs, :provider_session])
    )
  end

  @doc "构造一条 transcript 消息。"
  @spec message(atom() | String.t(), atom() | String.t(), [map()], map()) :: map()
  def message(role, provenance, blocks, extra \\ %{}) do
    Map.merge(
      %{
        role: to_string(role),
        provenance: to_string(provenance),
        blocks: List.wrap(blocks),
        source_refs: [],
        versions: %{}
      },
      extra
    )
  end

  @doc "文本块。"
  def text_block(text) when is_binary(text), do: %{type: "text", text: text}

  @doc "assistant 工具调用块（call_id 关联后续 observation/validation）。"
  def tool_call_block(name, arguments, call_id, schema_version \\ "tools/v1") do
    %{
      type: "tool_call",
      call_id: call_id,
      name: to_string(name),
      arguments: arguments,
      schema_version: schema_version
    }
  end

  @doc "只读观察块（I-ART-4：status 必须如实）。"
  def observation_block(call_id, payload) do
    %{
      type: "observation",
      call_id: call_id,
      status: Map.get(payload, :status, "ok"),
      source_refs: Map.get(payload, :source_refs, []),
      versions: Map.get(payload, :versions, %{}),
      coverage: Map.get(payload, :coverage, %{}),
      omissions: Map.get(payload, :omissions, []),
      next_offset: Map.get(payload, :next_offset),
      content: Map.get(payload, :content, %{})
    }
  end

  @doc "校验结果块（I-ART-5：作为 tool 原生结果回流，不追加 user 纠错）。"
  def validation_result_block(call_id, status, reason_code, detail \\ %{}) do
    %{
      type: "validation_result",
      call_id: call_id,
      status: status,
      reason_code: reason_code,
      detail: detail
    }
  end

  @doc "tentative artifact 块（I-ART-6：模型无 adopt/canon_write）。"
  def tentative_artifact_block(artifact_type, items) do
    %{
      type: "tentative_artifact",
      artifact_type: to_string(artifact_type),
      items: List.wrap(items),
      adoption_required: true
    }
  end

  @doc "作者出口块。"
  def author_exit_block(kind, refs \\ %{}) do
    %{type: "author_exit", kind: to_string(kind), refs: refs}
  end

  @doc "显式压缩 checkpoint 块（I-ART-7）。"
  def checkpoint_block(covers, source_refs, versions, omissions, summary) do
    %{
      type: "checkpoint",
      covers: covers,
      source_refs: source_refs,
      versions: versions,
      omissions: omissions,
      summary: summary
    }
  end

  @doc """
  数据边界校验（进入投影前一次）。返回 :ok | {:error, reason}。

  覆盖 VS-00L 中可机械检查的部分：envelope、消息顺序/provenance、作者字节、
  call_id 唯一与关联、禁止工具、checkpoint 覆盖字段、used_refs ⊆ base∪观察。
  """
  @spec validate(t()) :: :ok | {:error, term()}
  def validate(%__MODULE__{} = ir) do
    cond do
      ir.ir_version != @ir_version ->
        {:error, {:unsupported_ir_version, ir.ir_version}}

      not is_map(ir.run) or ir.run == %{} ->
        {:error, :missing_run_envelope}

      not is_map(ir.projection) or ir.projection == %{} ->
        {:error, :missing_projection}

      ir.projection[:target] not in @projection_targets ->
        {:error, {:unsupported_projection_target, ir.projection[:target]}}

      true ->
        with :ok <- validate_system(ir),
             :ok <- validate_messages(ir.messages),
             :ok <- validate_tools(ir.tools),
             :ok <- validate_call_bindings(ir.messages) do
          validate_refs(ir.refs, ir.messages)
        end
    end
  end

  def validate(_other), do: {:error, :invalid_ir}

  defp validate_system(ir) do
    case Map.get(ir.system, :identity_ref) do
      ref when is_binary(ref) and ref != "" -> :ok
      _ -> {:error, :missing_system_identity_ref}
    end
  end

  defp validate_messages([]), do: {:error, :missing_messages}

  defp validate_messages(messages) when is_list(messages) do
    Enum.reduce_while(messages, :ok, fn message, :ok ->
      case validate_message(message) do
        :ok -> {:cont, :ok}
        error -> {:halt, error}
      end
    end)
  end

  defp validate_message(%{role: role, provenance: provenance, blocks: blocks}) do
    cond do
      role not in @roles -> {:error, {:invalid_message_role, role}}
      provenance not in @provenances -> {:error, {:invalid_message_provenance, provenance}}
      not is_list(blocks) -> {:error, :invalid_message_blocks}
      true -> validate_blocks(blocks)
    end
  end

  defp validate_message(_message), do: {:error, :malformed_message}

  defp validate_blocks([]), do: :ok

  defp validate_blocks(blocks) do
    Enum.reduce_while(blocks, :ok, fn block, :ok ->
      case validate_block(block) do
        :ok -> {:cont, :ok}
        error -> {:halt, error}
      end
    end)
  end

  defp validate_block(%{type: type} = block) when type in @block_types do
    case type do
      "text" -> validate_text_block(block)
      "tool_call" -> validate_tool_call_block(block)
      "observation" -> validate_observation_block(block)
      "validation_result" -> validate_validation_block(block)
      "tentative_artifact" -> validate_artifact_block(block)
      "author_exit" -> validate_author_exit_block(block)
      "checkpoint" -> validate_checkpoint_block(block)
    end
  end

  defp validate_block(%{type: type}), do: {:error, {:unknown_block_type, type}}
  defp validate_block(_block), do: {:error, :malformed_block}

  defp validate_text_block(%{text: text}) when is_binary(text) and text != "", do: :ok
  defp validate_text_block(_block), do: {:error, :invalid_text_block}

  defp validate_tool_call_block(%{call_id: call_id, name: name, arguments: arguments})
       when is_binary(call_id) and call_id != "" and is_binary(name) and name != "" and
              is_map(arguments) do
    if name in @forbidden_tool_names do
      {:error, {:forbidden_tool_name, name}}
    else
      :ok
    end
  end

  defp validate_tool_call_block(_block), do: {:error, :invalid_tool_call_block}

  defp validate_observation_block(%{call_id: call_id, status: status, source_refs: refs})
       when is_binary(call_id) and call_id != "" and is_list(refs) do
    if status in ["ok", "partial", "truncated", "unavailable", "stale"] do
      :ok
    else
      {:error, {:invalid_observation_status, status}}
    end
  end

  defp validate_observation_block(_block), do: {:error, :invalid_observation_block}

  defp validate_validation_block(%{call_id: call_id, status: status, reason_code: reason})
       when is_binary(call_id) and call_id != "" and is_binary(reason) and
              status in ["passed", "failed"] do
    :ok
  end

  defp validate_validation_block(_block), do: {:error, :invalid_validation_result_block}

  defp validate_artifact_block(%{artifact_type: type, adoption_required: true})
       when is_binary(type) and type != "" do
    :ok
  end

  defp validate_artifact_block(_block), do: {:error, :invalid_tentative_artifact_block}

  defp validate_author_exit_block(%{kind: kind} = block)
       when is_binary(kind) and kind != "" do
    if is_map(Map.get(block, :refs, %{})) do
      :ok
    else
      {:error, :invalid_author_exit_block}
    end
  end

  defp validate_author_exit_block(_block), do: {:error, :invalid_author_exit_block}

  defp validate_checkpoint_block(%{covers: covers, summary: summary} = block)
       when is_binary(summary) and summary != "" do
    if is_list(Map.get(block, :source_refs, [])) and is_map(Map.get(block, :versions, %{})) and
         is_list(Map.get(block, :omissions, [])) and valid_covers?(covers) do
      :ok
    else
      {:error, :invalid_checkpoint_block}
    end
  end

  defp validate_checkpoint_block(_block), do: {:error, :invalid_checkpoint_block}

  defp valid_covers?(%{turn_range: range}) when is_binary(range) and range != "", do: true
  defp valid_covers?(_covers), do: false

  defp validate_tools(tools) when is_list(tools) do
    names = Enum.map(tools, &tool_name/1)

    cond do
      Enum.any?(names, &is_nil/1) -> {:error, :malformed_tool_schema}
      Enum.any?(names, &(&1 in @forbidden_tool_names)) -> {:error, :forbidden_tool_schema}
      true -> :ok
    end
  end

  defp validate_tools(_tools), do: {:error, :invalid_tools}

  defp tool_name(%{name: name}) when is_binary(name) and name != "", do: name
  defp tool_name(%{"name" => name}) when is_binary(name) and name != "", do: name
  defp tool_name(_tool), do: nil

  defp validate_call_bindings(messages) do
    calls = call_ids(messages)
    results = result_call_ids(messages)

    cond do
      length(calls) != length(Enum.uniq(calls)) ->
        {:error, :duplicate_call_id}

      Enum.any?(results, &(&1 not in calls)) ->
        {:error, :orphan_tool_result}

      length(results) != length(Enum.uniq(results)) ->
        {:error, :duplicate_tool_result_for_call}

      true ->
        :ok
    end
  end

  defp call_ids(messages) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) == "tool_call",
        do: Map.get(block, :call_id)
  end

  defp result_call_ids(messages) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) in ["observation", "validation_result"],
        do: Map.get(block, :call_id)
  end

  defp validate_refs(refs, messages) when is_map(refs) do
    base = refs |> Map.get(:base_refs, []) |> Enum.map(&ref_key/1) |> MapSet.new()
    observed = refs |> Map.get(:observation_refs, []) |> Enum.map(&ref_key/1) |> MapSet.new()
    used = refs |> Map.get(:used_refs, []) |> Enum.map(&ref_key/1)

    unknown = Enum.reject(used, &(MapSet.member?(base, &1) or MapSet.member?(observed, &1)))

    cond do
      used_requires_observation?(used, messages) and MapSet.size(observed) == 0 ->
        {:error, :used_refs_without_observation}

      unknown != [] ->
        {:error, {:used_refs_out_of_scope, unknown}}

      true ->
        :ok
    end
  end

  defp validate_refs(_refs, _messages), do: {:error, :invalid_refs}

  # 仅当 used_refs 非空时要求有一致观察来源（G2/G4 黄金请求的机械守卫）。
  defp used_requires_observation?([], _messages), do: false
  defp used_requires_observation?(_used, messages), do: has_observation?(messages)

  defp has_observation?(messages) do
    Enum.any?(messages, fn message ->
      Enum.any?(Map.get(message, :blocks, []), &(Map.get(&1, :type) == "observation"))
    end)
  end

  defp ref_key(ref) when is_binary(ref), do: ref
  defp ref_key(ref) when is_map(ref), do: Map.get(ref, :ref) || Map.get(ref, "ref")
  defp ref_key(_ref), do: nil

  @doc """
  迁移期 legacy 适配器：把现有最低公分母 prompt 映射为 IR v1。

  结论只能作为历史兼容输入：legacy prompt 无法区分 application_base 与作者消息，
  因此标记 `projection.finite_mode = %{name: "legacy_prompt"}`，不得据此宣称完整
  AgentRun 语义（VS-00L §4/§8）。
  """
  @spec from_legacy(NovelAgent.Provider.prompt(), keyword()) :: t()
  def from_legacy(prompt, opts \\ []) do
    legacy_messages =
      prompt
      |> NovelAgent.Provider.normalize_messages()
      |> Enum.map(fn message ->
        message(message.role, if(message.role == "user", do: "author", else: "application"), [
          text_block(message.content)
        ])
      end)

    tools =
      case prompt do
        %{tools: tools} when is_list(tools) -> tools
        _ -> []
      end

    %__MODULE__{
      run: Keyword.get(opts, :run, %{run_id: "legacy", work_id: "legacy"}),
      system: Keyword.get(opts, :system, %{identity_ref: "legacy_prompt"}),
      messages: legacy_messages,
      tools: tools,
      projection: %{
        target: Keyword.get(opts, :target, "chat_completions"),
        capability_profile: Keyword.get(opts, :capability_profile, %{}),
        finite_mode: Keyword.get(opts, :finite_mode, %{name: "legacy_prompt"}),
        usage_streaming: false
      },
      refs: %{base_refs: [], observation_refs: [], used_refs: []}
    }
  end

  @doc "能力门槛：返回 capability_profile 缺失的必备能力。"
  @spec missing_capabilities(map()) :: [atom()]
  def missing_capabilities(capability_profile) when is_map(capability_profile) do
    Enum.reject(@required_capabilities, fn capability ->
      Map.get(capability_profile, capability) == true
    end)
  end

  def missing_capabilities(_capability_profile), do: @required_capabilities
end
