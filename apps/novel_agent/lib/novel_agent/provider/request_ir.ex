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

  alias NovelAgent.Provider.CapabilityProfile
  alias NovelAgent.Provider.RequestIR.Compaction
  alias NovelAgent.Provider.RequestIR.Projection
  alias NovelAgent.Provider.SystemIdentity

  @roles ~w(system application_base scope_update application_notice user assistant tool checkpoint author_exit)
  @provenances ~w(product application author model tool_result)
  @block_types ~w(text tool_call observation validation_result tentative_artifact author_exit checkpoint)
  @forbidden_tool_names ~w(adopt canon_write accept_candidate confirm_candidate self_approve)
  @run_fields ~w(run_id work_id workspace_id session_id parent_turn_ref profile_ref goal)a
  @goal_fields ~w(text source_ref version)a
  @execution_ref_keys ~w(provider_call_ref provider_run_ref)a

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
            refs: %{}

  @type t :: %__MODULE__{
          ir_version: String.t(),
          run: map(),
          system: map(),
          messages: [map()],
          tools: [map()],
          projection: map(),
          refs: map()
        }

  def ir_version, do: @ir_version
  def required_capabilities, do: @required_capabilities

  @doc "构造 IR（只做 envelope；完整校验用 validate/1）。"
  @spec new(map()) :: t()
  def new(attrs \\ %{}) do
    struct(
      __MODULE__,
      attrs
      |> Map.take([:run, :system, :messages, :tools, :projection, :refs])
      |> Map.update(:run, %{}, &run_envelope/1)
    )
  end

  @doc """
  canonical system envelope。

  产品身份只由 `SystemIdentity` 单一真源派生；调用方只能提供本次 run 的角色规则
  （`instructions` 或 `run_role`），不能自造身份引用或版本。投影时身份正文与角色
  规则形成稳定 system 前缀（VS-00L §6.1、§19.1）。
  """
  @spec system_envelope(keyword()) :: map()
  def system_envelope(opts \\ []) do
    %{identity_ref: SystemIdentity.identity_ref()}
    |> put_optional(:run_role, Keyword.get(opts, :run_role))
    |> put_optional(:instructions, Keyword.get(opts, :instructions))
  end

  defp put_optional(map, _key, nil), do: map
  defp put_optional(map, key, value), do: Map.put(map, key, value)

  @doc """
  非 AgentRun 的独立文本操作请求（章摘要、设定盘点、工具结果叙述等）。

  这些操作没有 AgentRun 的 run 事实：只携带真实操作 profile 与来源 refs，不伪造
  run_id/session_id，也不伪造作者消息。材料由应用作为 `application_base` 提供，
  作者原话仍以独立 `author` provenance 构造。请求仍走同一 canonical IR 投影边界
  （VS-00L §19.1），不再经 giant prompt 形态转译。
  """
  @spec text_operation(map()) :: t()
  def text_operation(attrs) when is_map(attrs) do
    text = Map.fetch!(attrs, :text)
    profile_ref = Map.fetch!(attrs, :profile_ref)
    refs = Map.get(attrs, :source_refs, [])

    request =
      new(%{
        run: Map.get(attrs, :run) || %{profile_ref: profile_ref},
        system: system_envelope(Map.get(attrs, :system, [])),
        messages: [
          message(:application_base, :application, [text_block(text)], %{source_refs: refs})
        ],
        tools: [],
        projection: %{},
        refs: %{base_refs: refs, observation_refs: [], used_refs: []}
      })

    case validate(request) do
      :ok ->
        request

      {:error, reason} ->
        raise ArgumentError, "invalid text operation request: #{inspect(reason)}"
    end
  end

  @doc "从运行快照提取 canonical 身份与目标；不携带运行时 struct、策略或执行函数。"
  @spec run_envelope(map()) :: map()
  def run_envelope(run) when is_map(run) do
    envelope = envelope_fields(run, @run_fields)

    case Map.fetch(envelope, :goal) do
      {:ok, goal} -> Map.put(envelope, :goal, goal_envelope(goal))
      :error -> envelope
    end
  end

  def run_envelope(_run), do: %{}

  defp goal_envelope(goal) when is_map(goal),
    do: goal |> envelope_fields(@goal_fields) |> json_value()

  defp goal_envelope(goal), do: goal

  defp envelope_fields(map, keys) do
    Enum.reduce(keys, %{}, fn key, result ->
      case Map.fetch(map, key) do
        {:ok, value} -> Map.put(result, key, value)
        :error -> copy_string_field(result, map, key)
      end
    end)
  end

  defp copy_string_field(result, map, key) do
    case Map.fetch(map, to_string(key)) do
      {:ok, value} -> Map.put(result, key, value)
      :error -> result
    end
  end

  @doc "构造一条 transcript 消息。"
  @spec message(atom() | String.t(), atom() | String.t(), [map()], map()) :: map()
  def message(role, provenance, blocks, extra \\ %{}) do
    extra =
      Enum.reduce([:versions, :provider_state], extra, fn key, acc ->
        case Map.fetch(acc, key) do
          {:ok, value} -> Map.put(acc, key, Projection.json_value(value))
          :error -> acc
        end
      end)

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
      arguments: Projection.json_value(arguments),
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
      versions: json_value(Map.get(payload, :versions, %{})),
      coverage: json_value(Map.get(payload, :coverage, %{})),
      omissions: Map.get(payload, :omissions, []),
      next_offset: Map.get(payload, :next_offset),
      content: json_value(Map.get(payload, :content, %{}))
    }
  end

  @doc "校验结果块（I-ART-5：作为 tool 原生结果回流，不追加 user 纠错）。"
  def validation_result_block(call_id, status, reason_code, detail \\ %{}) do
    %{
      type: "validation_result",
      call_id: call_id,
      status: status,
      reason_code: reason_code,
      detail: json_value(detail)
    }
  end

  @doc "tentative artifact 块（I-ART-6：模型无 adopt/canon_write）。"
  def tentative_artifact_block(artifact_type, items) do
    %{
      type: "tentative_artifact",
      artifact_type: to_string(artifact_type),
      items: json_value(List.wrap(items)),
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
      versions: json_value(versions),
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

      not is_map(ir.projection) ->
        {:error, :missing_projection}

      true ->
        with :ok <- validate_system(ir),
             :ok <- validate_messages(ir.messages),
             :ok <- validate_tools(ir.tools),
             :ok <- validate_call_bindings(ir.messages),
             :ok <- Compaction.validate(ir.messages) do
          validate_refs(ir.refs, ir.messages)
        end
    end
  end

  def validate(_other), do: {:error, :invalid_ir}

  # 产品身份只认 `SystemIdentity` 真值：构造侧写死的引用标签与执行侧记录的真实
  # 身份（version/content_hash）必须同源，否则请求从源头就是不可信的。
  defp validate_system(ir) do
    if Map.get(ir.system, :identity_ref) == SystemIdentity.identity_ref() do
      :ok
    else
      {:error, :missing_system_identity_ref}
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

  defp validate_message(%{role: role, provenance: provenance, blocks: blocks} = message) do
    cond do
      role not in @roles -> {:error, {:invalid_message_role, role}}
      provenance not in @provenances -> {:error, {:invalid_message_provenance, provenance}}
      not is_list(blocks) -> {:error, :invalid_message_blocks}
      true -> with :ok <- validate_execution_refs(message), do: validate_blocks(blocks)
    end
  end

  defp validate_message(_message), do: {:error, :malformed_message}

  # 执行引用是可选内部事实：缺失表示未经过执行边界，存在则必须是有效 UTF8、
  # 真正非空白的字符串。原值不 trim、不 coerce；错误只回固定 reason 与字段名，
  # 不把任意坏 map/二进制 payload 带进异常或校验结果。
  defp validate_execution_refs(message) do
    case collect_execution_refs(message) do
      {:ok, _refs} -> :ok
      error -> error
    end
  end

  defp execution_refs(result) do
    case collect_execution_refs(result) do
      {:ok, refs} ->
        refs

      {:error, {:invalid_execution_ref, key}} ->
        raise ArgumentError, "invalid execution ref field: #{key}"
    end
  end

  defp collect_execution_refs(map) do
    Enum.reduce_while(@execution_ref_keys, {:ok, %{}}, fn key, {:ok, refs} ->
      case field(map, key) do
        nil -> {:cont, {:ok, refs}}
        ref -> reduce_execution_ref(ref, key, refs)
      end
    end)
  end

  defp reduce_execution_ref(ref, key, refs) do
    if valid_execution_ref?(ref) do
      {:cont, {:ok, Map.put(refs, key, ref)}}
    else
      {:halt, {:error, {:invalid_execution_ref, key}}}
    end
  end

  defp valid_execution_ref?(ref) when is_binary(ref) do
    String.valid?(ref) and String.trim(ref) != ""
  end

  defp valid_execution_ref?(_ref), do: false

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

  defp validate_tool_call_block(%{call_id: call_id, name: name, arguments: arguments} = block)
       when is_binary(call_id) and is_binary(name) and name != "" and is_map(arguments) do
    # 模型的错误请求也是事实；禁用工具由目录与执行授权约束，不能删掉拒绝证据。
    if valid_source_id?(call_id),
      do: validate_provider_call_id(block),
      else: {:error, :invalid_call_id}
  end

  defp validate_tool_call_block(_block), do: {:error, :invalid_tool_call_block}

  # provider_call_id 是原 id 来源标记：缺 key 表示原 id 与 canonical 相同；
  # nil 表示 Provider 未提供原 id；字符串表示重复原 id 的私有映射。空白/非法
  # 值不能被解释成“未提供”，必须显式拒绝。
  defp validate_provider_call_id(block) do
    case fetch_field(block, :provider_call_id) do
      :error ->
        :ok

      {:ok, nil} ->
        :ok

      {:ok, id} when is_binary(id) ->
        if valid_source_id?(id),
          do: :ok,
          else: {:error, :invalid_provider_call_id}

      _ ->
        {:error, :invalid_provider_call_id}
    end
  end

  defp validate_observation_block(%{call_id: call_id, status: status, source_refs: refs} = block)
       when is_binary(call_id) and call_id != "" and is_list(refs) do
    cond do
      status not in ["ok", "partial", "truncated", "unavailable", "stale"] ->
        {:error, {:invalid_observation_status, status}}

      not is_map(Map.get(block, :versions, %{})) or
          not Enum.all?(refs, &(is_binary(ref_key(&1)) and ref_key(&1) != "")) ->
        {:error, :invalid_observation_block}

      true ->
        :ok
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
  defp valid_covers?(%{call_ids: [_ | _]}), do: true
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
        case pending_calls(messages) do
          {:ok, _pending} -> :ok
          error -> error
        end
    end
  end

  defp pending_calls(messages) do
    Enum.reduce_while(messages, {:ok, []}, fn message, {:ok, pending} ->
      case advance_exchange(message, pending) do
        {:ok, next} -> {:cont, {:ok, next}}
        error -> {:halt, error}
      end
    end)
  end

  @doc "查询 canonical 历史中尚未收到应用结果的调用，供唯一业务组装点闭合。"
  @spec pending_call_ids(t()) :: {:ok, [String.t()]} | {:error, term()}
  def pending_call_ids(%__MODULE__{} = ir) do
    with :ok <- validate(ir), do: pending_calls(ir.messages)
  end

  defp advance_exchange(%{role: "tool"} = message, pending) do
    results = result_call_ids([message])

    if Enum.all?(results, &(&1 in pending)),
      do: {:ok, pending -- results},
      else: {:error, :tool_result_before_call}
  end

  defp advance_exchange(%{role: "checkpoint"}, pending), do: {:ok, pending}
  defp advance_exchange(_message, [_ | _]), do: {:error, :interrupted_tool_exchange}
  defp advance_exchange(message, []), do: {:ok, call_ids([message])}

  defp validate_request_ready(messages) do
    case pending_calls(messages) do
      {:ok, []} -> :ok
      {:ok, pending} -> {:error, {:pending_tool_calls, pending}}
      error -> error
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

  defp used_requires_observation?(_used, messages),
    do: has_observation?(messages) or has_observation_checkpoint?(messages)

  defp has_observation_checkpoint?(messages) do
    Enum.any?(messages, fn message ->
      message.role == "checkpoint" and
        Enum.any?(message.blocks, &(Map.get(&1, :source_refs, []) != []))
    end)
  end

  defp has_observation?(messages) do
    Enum.any?(messages, fn message ->
      Enum.any?(Map.get(message, :blocks, []), &(Map.get(&1, :type) == "observation"))
    end)
  end

  defp ref_key(ref) when is_binary(ref), do: ref
  defp ref_key(ref) when is_map(ref), do: Map.get(ref, :ref) || Map.get(ref, "ref")
  defp ref_key(_ref), do: nil

  @doc "统一分配一次响应内的 run 调用 ID，保留重复 Provider ID 的私有映射。"
  @spec normalize_provider_result([String.t()], map()) :: map()
  def normalize_provider_result(existing_call_ids, result) when is_list(existing_call_ids) do
    {calls, _used} =
      result
      |> field(:tool_calls)
      |> List.wrap()
      |> Enum.map_reduce(existing_call_ids, fn call, used ->
        {id, call} = normalize_provider_call(call, used)
        {call, used ++ [id]}
      end)

    put_field(result, :tool_calls, calls)
  end

  defp normalize_provider_call(call, used) when is_map(call) do
    case fetch_field(call, :provider_call_id) do
      {:ok, provider_call_id} ->
        normalize_marked_provider_call(call, provider_call_id, used)

      :error ->
        normalize_raw_provider_call(call, used)
    end
  end

  defp normalize_provider_call(_call, _used) do
    raise ArgumentError, "invalid provider tool call"
  end

  # 已归一结果再次归一：canonical 也要让位于当前 run 与同响应已占用集合；
  # 只有冲突才改号，稳定输入重复归一保持同一 id。原 id 来源始终保留。
  defp normalize_marked_provider_call(call, provider_call_id, used) do
    provider_call_id = validated_provider_call_id!(provider_call_id)
    canonical_id = canonical_provider_call_id!(call)
    id = available_call_id(canonical_id, used, 1)

    {id, call |> put_field(:id, id) |> put_field(:provider_call_id, provider_call_id)}
  end

  defp normalize_raw_provider_call(call, used) do
    case raw_provider_id(call) do
      {:provided, provider_id} ->
        id = available_call_id(provider_id, used, 1)
        call = put_field(call, :id, id)

        call =
          if provider_id == id,
            do: drop_field(call, :provider_call_id),
            else: put_field(call, :provider_call_id, provider_id)

        {id, call}

      :not_provided ->
        id = available_call_id("call_#{field(call, :name)}", used, 1)
        {id, call |> put_field(:id, id) |> put_field(:provider_call_id, nil)}

      :invalid ->
        raise ArgumentError, "invalid provider tool call id"
    end
  end

  defp raw_provider_id(call) do
    case fetch_field(call, :id) do
      :error ->
        :not_provided

      {:ok, nil} ->
        :not_provided

      {:ok, id} when is_binary(id) ->
        if valid_source_id?(id), do: {:provided, id}, else: :invalid

      {:ok, _invalid} ->
        :invalid
    end
  end

  defp canonical_provider_call_id!(call) do
    case field(call, :id) do
      id when is_binary(id) ->
        if valid_source_id?(id),
          do: id,
          else: raise(ArgumentError, "invalid normalized provider tool call id")

      _invalid ->
        raise ArgumentError, "invalid normalized provider tool call id"
    end
  end

  defp validated_provider_call_id!(nil), do: nil

  defp validated_provider_call_id!(id) when is_binary(id) do
    if valid_source_id?(id),
      do: id,
      else: raise(ArgumentError, "invalid provider tool call id")
  end

  defp validated_provider_call_id!(_invalid) do
    raise ArgumentError, "invalid provider tool call id"
  end

  @doc "把真实模型响应追加为 assistant，保留原始参数和私有推理引用。"
  @spec append_assistant_result(t(), map()) :: {t(), map()}
  def append_assistant_result(%__MODULE__{} = ir, result) do
    result = normalize_provider_result(call_ids(ir.messages), result)

    blocks =
      result
      |> field(:tool_calls)
      |> List.wrap()
      |> Enum.map(&provider_tool_call/1)

    blocks =
      case field(result, :content) do
        text when is_binary(text) and text != "" -> [text_block(text) | blocks]
        _ -> blocks
      end

    provider_state = field(result, :provider_state) || %{}
    refs = execution_refs(result)

    message =
      message(:assistant, :model, blocks, Map.put(refs, :provider_state, provider_state))

    {%{ir | messages: ir.messages ++ [message]}, result}
  end

  @doc "按最近一次 scope 计算下一个 revision，与消息数量无关。"
  @spec next_scope_revision(t()) :: pos_integer()
  def next_scope_revision(%__MODULE__{} = ir) do
    ir.messages
    |> Enum.reverse()
    |> Enum.find_value(1, fn message ->
      if message.role == "scope_update" do
        versions = Map.get(message, :versions, %{})
        Map.get(versions, "scope_revision", Map.get(versions, :scope_revision, 0)) + 1
      end
    end)
  end

  @doc "追加当前运行事实；旧 scope 只保留为证据。"
  @spec append_scope_update(t(), String.t(), map(), [map()]) :: t()
  def append_scope_update(%__MODULE__{} = ir, text, versions \\ %{}, source_refs \\ []) do
    message =
      message(:scope_update, :application, [text_block(text)], %{
        versions: versions,
        source_refs: source_refs
      })

    %{ir | messages: ir.messages ++ [message]}
  end

  @doc "追加真实工具校验结果，保留 call_id 关联。"
  @spec append_validation_result(t(), String.t(), String.t(), String.t(), map()) :: t()
  def append_validation_result(%__MODULE__{} = ir, call_id, status, reason, detail \\ %{}) do
    message =
      message(:tool, :tool_result, [validation_result_block(call_id, status, reason, detail)])

    %{ir | messages: ir.messages ++ [message]}
  end

  @doc "追加无工具响应的应用协议反馈，不冒充作者输入。"
  @spec append_application_notice(t(), String.t()) :: t()
  def append_application_notice(%__MODULE__{} = ir, text) do
    message = message(:application_notice, :application, [text_block(text)])
    %{ir | messages: ir.messages ++ [message]}
  end

  @doc "扩展当前工具目录；既有工具定义不被替换。"
  @spec add_tools(t(), [map()]) :: t()
  def add_tools(%__MODULE__{} = ir, tools) do
    existing = Enum.map(ir.tools, &tool_name/1)
    additions = Enum.reject(tools, fn tool -> tool_name(tool) in existing end)
    %{ir | tools: ir.tools ++ additions}
  end

  defp available_call_id(base, used, suffix) do
    candidate = if suffix == 1, do: base, else: "#{base}:#{suffix}"
    if candidate in used, do: available_call_id(base, used, suffix + 1), else: candidate
  end

  defp provider_tool_call(call) do
    name = field(call, :name)
    call_id = field(call, :id)
    arguments = field(call, :raw_arguments) || field(call, :arguments)

    block = provider_tool_call_block(name, arguments, call_id)

    case fetch_field(call, :provider_call_id) do
      {:ok, provider_call_id} -> Map.put(block, :provider_call_id, provider_call_id)
      :error -> block
    end
  end

  defp provider_tool_call_block(name, arguments, call_id) when is_binary(arguments) do
    decoded =
      case Jason.decode(arguments) do
        {:ok, value} when is_map(value) -> value
        _ -> %{}
      end

    tool_call_block(name, decoded, call_id)
    |> Map.put(:raw_arguments, arguments)
  end

  defp provider_tool_call_block(name, arguments, call_id) when is_map(arguments),
    do: tool_call_block(name, json_value(arguments), call_id)

  defp provider_tool_call_block(name, _arguments, call_id),
    do: tool_call_block(name, %{}, call_id)

  defp json_value(value), do: Projection.json_value(value)

  defp valid_source_id?(id), do: String.valid?(id) and String.trim(id) != ""

  defp fetch_field(map, key) when is_map(map) do
    case Map.fetch(map, key) do
      {:ok, value} -> {:ok, value}
      :error -> Map.fetch(map, to_string(key))
    end
  end

  defp fetch_field(_map, _key), do: :error

  defp field(map, key) do
    case fetch_field(map, key) do
      {:ok, value} -> value
      :error -> nil
    end
  end

  defp put_field(map, key, value) do
    map |> drop_field(key) |> Map.put(key, value)
  end

  defp drop_field(map, key), do: map |> Map.delete(key) |> Map.delete(to_string(key))

  @doc """
  选择一个真实请求的 active tools 与 `projection.tool_choice`（VS-00L §19.1）。

  只做请求构造边界：校验 canonical 数据与当前交换闭合，不查询 Gateway、不猜测
  provider/model/能力。返回完整 IR；消息、refs、run 与原有 projection 事实保持不变，
  运行历史中的完整工具目录不被覆盖。
  """
  @spec prepare_request(t(), keyword()) :: {:ok, t()} | {:error, term()}
  def prepare_request(ir, opts \\ [])

  def prepare_request(%__MODULE__{} = ir, opts) do
    with :ok <- validate(ir),
         :ok <- validate_request_ready(ir.messages),
         {:ok, tools} <- active_tools(ir, Keyword.get(opts, :tool_names)) do
      tool_choice =
        case Keyword.fetch(opts, :tool_choice) do
          {:ok, choice} -> choice
          :error -> Map.get(ir.projection, :tool_choice)
        end

      {:ok,
       %{
         ir
         | tools: tools,
           projection: put_projection_tool_choice(ir.projection, tool_choice)
       }}
    end
  end

  defp put_projection_tool_choice(projection, nil), do: Map.delete(projection, :tool_choice)

  defp put_projection_tool_choice(projection, choice),
    do: Map.put(projection, :tool_choice, choice)

  defp active_tools(ir, nil), do: {:ok, ir.tools}

  defp active_tools(ir, names) when is_list(names) do
    known = MapSet.new(ir.tools, &tool_name/1)
    unknown = Enum.reject(names, &MapSet.member?(known, &1))

    if unknown == [] do
      {:ok, Enum.filter(ir.tools, &(tool_name(&1) in names))}
    else
      {:error, {:unknown_tool_names, unknown}}
    end
  end

  @doc """
  把请求构造失败 reason 转为作者安全的可读文案。

  只输出中文能力名，不回显内部 capability atom、prompt 内容或私有状态；
  调用方（判断/创作/评审）用它生成作者可见失败原因。
  """
  @spec rejection_message(term()) :: String.t()
  def rejection_message({:unsupported_capability, missing}) when is_list(missing) do
    "当前模型缺少完整创作运行所需的传输能力（" <>
      CapabilityProfile.labels(missing) <>
      "），已拒绝本次请求；没有降级为静默丢弃字段的运行。"
  end

  def rejection_message(_reason), do: "本次请求无法构造为可用的模型请求，已拒绝。"
end
