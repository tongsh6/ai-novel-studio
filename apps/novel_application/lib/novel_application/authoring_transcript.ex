defmodule NovelApplication.AuthoringTranscript do
  @moduledoc """
  B71 CP2：Authoring Run Transcript 的 application 层组装器（VS-00L §3–§5）。

  职责边界（ADR-0033 §6）：application 负责 AgentRun/transcript 与编排；IR/投影在
  `NovelCommon.RequestIR`；本模块只把 run 事实（Base、作者原话、模型 tool_call、
  真实观察、校验结果、作者出口）有序组装为 transcript，并产出 Request IR。

  不变量（可机械检查部分由 `RequestIR.validate/1` 承担）：
  - 作者原话独立消息、字节不变（I-ART-2）。
  - application_base 标记 application provenance（I-ART-3）。
  - 观察按 call_id 关联真实 tool_call，status 如实（I-ART-4）。
  - 校验失败作为 tool 原生结果回流，不追加 user 纠错（I-ART-5）。
  - observation_refs 只来自真实观察；used_refs ⊆ base_refs ∪ observation_refs（I-ART-9）。

  本模块不发起 provider 调用、不执行工具、不写库；执行与真实页面证据归 CP3 首个消费者。
  """

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction

  @type t :: %{
          run: map(),
          system: map(),
          messages: [map()],
          tools: [map()],
          base_refs: [map()],
          observation_refs: [map()],
          used_refs: [String.t()],
          projection: map(),
          call_ids: [String.t()]
        }

  @doc """
  创建 transcript 骨架：application_base + 可选的作者原话。

  opts:
  - `:base_text`（必须）应用提供的 Base 说明文本
  - `:author_text` 本轮作者原话（字节不变）；应用续行 goal 可为 nil
  - `:allow_authorless` 无作者 turn 的续行允许省略 user，默认 false
  - `:author_turn_ref` 作者消息来源
  - `:author_turn` 作者回合元数据（origin/question_ref）
  - `:initial_scope` 首次快照的实际 scope（`text`/`versions`/`source_refs`）；
    存在时按 application_base → scope_update → user 一次构造，无该选项维持原语义
  - `:base_refs` 应用主动提供的 refs
  - `:tools` run 角色工具目录（`RequestIR` 期望的 tool_spec 形状）
  - `:projection` 投影配置（默认空；目标由实际 adapter 显式选择）
  """
  @spec new(map(), keyword()) :: t()
  def new(run, opts) when is_map(run) do
    base_text = Keyword.fetch!(opts, :base_text)
    base_refs = Keyword.get(opts, :base_refs, [])

    messages =
      [
        RequestIR.message(:application_base, :application, [RequestIR.text_block(base_text)], %{
          source_refs: base_refs
        })
      ] ++
        initial_scope_messages(Keyword.get(opts, :initial_scope)) ++ author_messages(opts)

    %{
      run: RequestIR.run_envelope(run),
      system: Keyword.get(opts, :system, %{}),
      messages: messages,
      tools: Keyword.get(opts, :tools, []),
      base_refs: base_refs,
      observation_refs: [],
      used_refs: [],
      projection: Keyword.get(opts, :projection, %{}),
      call_ids: []
    }
  end

  defp initial_scope_messages(nil), do: []

  defp initial_scope_messages(%{text: text, versions: versions, source_refs: source_refs}),
    do: [scope_message(text, versions, source_refs)]

  defp author_messages(opts) do
    case {Keyword.get(opts, :author_text), Keyword.get(opts, :allow_authorless, false)} do
      {nil, true} ->
        []

      {nil, false} ->
        raise ArgumentError, "author_text is required for an authoring run"

      {text, _} ->
        [
          RequestIR.message(:user, :author, [RequestIR.text_block(text)], %{
            source_refs: [%{ref: Keyword.get(opts, :author_turn_ref, "author_turn:current")}]
          })
          |> put_author_turn_origin(Keyword.get(opts, :author_turn))
        ]
    end
  end

  @doc "追加模型产出的 assistant 消息（可见叙事 + 可选 tool_call 与 Provider 私有回放数据）。"
  @spec append_assistant(t(), String.t(), [map()], map()) :: t()
  def append_assistant(transcript, narrative, tool_calls \\ [], provider_state \\ %{}) do
    blocks =
      case {narrative, tool_calls} do
        {"", []} -> []
        {"", calls} -> calls
        {text, calls} -> [RequestIR.text_block(text) | calls]
      end

    if blocks == [] and provider_state == %{} do
      transcript
    else
      message = RequestIR.message(:assistant, :model, blocks, %{provider_state: provider_state})
      call_ids = Enum.map(tool_calls, &Map.get(&1, :call_id))

      %{
        transcript
        | messages: transcript.messages ++ [message],
          call_ids: transcript.call_ids ++ call_ids
      }
    end
  end

  @checkpoint_version "authoring-transcript/v1"

  @doc """
  transcript 结构 codec 版本（checkpoint/restore 的 `version` 字段）。

  这是 application 内存结构的 JSON codec 版本，不是会话 canonical 的持久化格式
  版本；后者由 `NovelApplication.AuthoringCheckpoint.format_version/0`（持久层
  `AuthoringSessionLog`）唯一持有。
  """
  @spec checkpoint_version() :: String.t()
  def checkpoint_version, do: @checkpoint_version

  @json_payload_keys ~w(arguments versions items run tools provider_state detail content coverage)a
  @canonical_keys ~w(
    run system messages tools base_refs observation_refs used_refs projection call_ids
    identity_ref instructions run_role finite_mode tool_choice
    constitution_version output_protocol_version output_schema_ref
    native_multi_turn tool_calls tool_results streaming structured_output usage
    role provenance blocks source_refs versions ref version type text call_id name arguments
    schema_version status source_refs coverage omissions next_offset content reason_code detail
    artifact_type items adoption_required canon_written artifact_refs kind refs covers summary
    finding_count review_status policy_action turn_range
    raw_arguments provider_call_id provider_state reasoning_content
    provider_call_ref provider_run_ref
  )a

  @doc "追加版本化 scope 更新；初始 Base 和既有消息永远不变。"
  @spec append_scope_update(t(), String.t(), map(), [map()]) :: t()
  def append_scope_update(transcript, scope_text, versions \\ %{}, source_refs \\ [])
      when is_binary(scope_text) and is_list(source_refs) do
    message = scope_message(scope_text, versions, source_refs)
    %{transcript | messages: transcript.messages ++ [message]}
  end

  defp scope_message(scope_text, versions, source_refs) do
    RequestIR.message(:scope_update, :application, [RequestIR.text_block(scope_text)], %{
      versions: versions,
      source_refs: source_refs
    })
  end

  @doc "追加新的作者 turn；同一 turn 重复构造保持幂等，作者字节不被改写。"
  @spec append_author_turn(t(), String.t(), String.t()) :: t()
  def append_author_turn(transcript, author_text, turn_ref, opts \\ []) do
    latest = transcript.messages |> Enum.filter(&(&1.role == "user")) |> List.last()

    if latest && text_of(latest.blocks) == author_text && author_ref(latest) == turn_ref do
      transcript
    else
      message =
        RequestIR.message(:user, :author, [RequestIR.text_block(author_text)], %{
          source_refs: [%{ref: turn_ref}]
        })
        |> put_author_turn_origin(Keyword.get(opts, :author_turn))

      %{transcript | messages: transcript.messages ++ [message]}
    end
  end

  # 回答回合来源：写入消息元数据供回放/审计区分「回答」与普通作者请求；
  # 不改变消息文本与 Provider 投影（投影只读取 role/blocks）。
  defp put_author_turn_origin(message, nil), do: message

  defp put_author_turn_origin(message, %{} = author_turn) do
    Map.put(message, :author_turn, %{
      "origin" =>
        to_string(Map.get(author_turn, :origin) || Map.get(author_turn, "origin") || ""),
      "question_ref" =>
        to_string(
          Map.get(author_turn, :question_ref) || Map.get(author_turn, "question_ref") || ""
        )
    })
  end

  @doc "当前生效的 scope；旧 scope 仍保留在消息序列中供审计。"
  @spec current_scope(t()) :: %{text: String.t(), versions: map(), source_refs: [map()]} | nil
  def current_scope(transcript) do
    transcript.messages
    |> Enum.reverse()
    |> Enum.find_value(fn message ->
      if message.role == "scope_update" do
        %{
          text: text_of(message.blocks),
          versions: Map.get(message, :versions, %{}),
          source_refs: Map.get(message, :source_refs, [])
        }
      end
    end)
  end

  defp text_of(blocks) do
    blocks
    |> Enum.filter(&(Map.get(&1, :type) == "text"))
    |> Enum.map_join("", &Map.get(&1, :text, ""))
  end

  defp author_ref(message) do
    case Map.get(message, :source_refs, []) do
      [%{ref: ref} | _] -> ref
      _ -> nil
    end
  end

  @doc "从 JSON 检查点恢复 canonical transcript；只校验和重建，不调用 Provider。"
  @spec restore(map()) :: {:ok, t()} | {:error, term()}
  def restore(%{"version" => @checkpoint_version, "transcript" => data}) when is_map(data),
    do: restore_transcript(data)

  def restore(%{version: @checkpoint_version, transcript: data}) when is_map(data),
    do: restore_transcript(data)

  def restore(_), do: {:error, :unsupported_transcript_checkpoint}

  @doc """
  段数据归一化：JSON 形状 → canonical atom-key transcript，只做文本形状校验。

  段本身允许含跨段 checkpoint（covers 指向会话历史中的更早交换），因此不做完整
  IR 校验；`AuthoringCheckpoint` 在会话视图上完成完整校验。仅供存储读取边界使用。
  """
  @spec normalize_segment(map()) :: {:ok, t()} | {:error, term()}
  def normalize_segment(data) when is_map(data) do
    transcript = normalize_checkpoint(data)

    with :ok <- validate_checkpoint_shape(transcript) do
      # run 属于 JSON payload 保护键（normalize 不递归转键），这里用与 new/1 相同的
      # run envelope 规范化，保证恢复出的 identity 是 canonical atom-key 形状。
      {:ok, %{transcript | run: RequestIR.run_envelope(transcript.run)}}
    end
  end

  def normalize_segment(_data), do: {:error, :invalid_authoring_segment}

  defp restore_transcript(data) do
    transcript = normalize_checkpoint(data)

    with :ok <- validate_checkpoint_shape(transcript),
         {:ok, ir} <- to_request_ir(transcript) do
      from_request_ir(ir)
    end
  end

  defp validate_checkpoint_shape(transcript) do
    maps = [:run, :system, :projection]
    lists = [:messages, :tools, :base_refs, :observation_refs, :used_refs, :call_ids]
    map_lists = [:messages, :tools]
    ref_lists = [:base_refs, :observation_refs]

    valid? =
      Enum.all?(maps, &is_map(Map.get(transcript, &1))) and
        Enum.all?(lists, &is_list(Map.get(transcript, &1))) and
        Enum.all?(map_lists, &Enum.all?(Map.fetch!(transcript, &1), fn item -> is_map(item) end)) and
        Enum.all?(
          ref_lists,
          &Enum.all?(Map.fetch!(transcript, &1), fn item -> valid_ref?(item) end)
        ) and
        Enum.all?(transcript.messages, &valid_message_shape?/1)

    if valid?, do: :ok, else: {:error, :invalid_transcript_checkpoint}
  end

  @doc """
  把 JSON 形状的 canonical 消息归一化为内存 canonical 形状（白名单键 string→atom）。

  会话历史（持久层读出的 string-key JSON）在进入请求派生视图前必须经过本函数，
  与 `restore/1` 使用同一套键归一化与 payload 保护；调用方仍负责完整 IR 校验。
  """
  @spec normalize_messages([map()]) :: [map()]
  def normalize_messages(messages) when is_list(messages) do
    Enum.map(messages, &normalize_checkpoint/1)
  end

  def normalize_messages(_messages), do: []

  # string ref 与结构化 ref 都是已支持输入；空值/伪 ref 不得进入 canonical 范围。
  defp valid_ref?(ref) when is_binary(ref), do: String.trim(ref) != ""

  defp valid_ref?(%{} = ref) do
    case Map.get(ref, :ref) || Map.get(ref, "ref") do
      key when is_binary(key) -> String.trim(key) != ""
      _ -> false
    end
  end

  defp valid_ref?(_ref), do: false

  defp valid_message_shape?(%{blocks: blocks}) when is_list(blocks),
    do: Enum.all?(blocks, &is_map/1)

  defp valid_message_shape?(_), do: false

  defp normalize_checkpoint(value) when is_map(value) do
    Map.new(value, fn {key, item} ->
      canonical = canonical_key(key)
      restored = if canonical in @json_payload_keys, do: item, else: normalize_checkpoint(item)
      {canonical, restored}
    end)
  end

  defp normalize_checkpoint(value) when is_list(value),
    do: Enum.map(value, &normalize_checkpoint/1)

  defp normalize_checkpoint(value), do: value

  defp canonical_key(key) when is_atom(key), do: key

  defp canonical_key(key) when is_binary(key),
    do: Enum.find(@canonical_keys, key, &(Atom.to_string(&1) == key))

  @doc """
  追加只读观察（真实工具查询结果，按 call_id 关联）。

  `observation` 至少含 `:status`（ok/partial/truncated/unavailable/stale）；可含
  `:source_refs`、`:versions`、`:coverage`、`:omissions`、`:next_offset`、`:content`。
  来源 refs 同步进入 observation_refs，供 `used_refs` 越界校验（I-ART-9）。
  """
  @spec append_observation(t(), String.t(), map()) :: t()
  def append_observation(transcript, call_id, observation) when is_binary(call_id) do
    block = RequestIR.observation_block(call_id, observation)

    message =
      RequestIR.message(:tool, :tool_result, [block], %{
        source_refs: Map.get(observation, :source_refs, [])
      })

    %{
      transcript
      | messages: transcript.messages ++ [message],
        observation_refs: transcript.observation_refs ++ refs_of(observation)
    }
  end

  @doc "追加校验失败/通过结果（tool 原生结果回流，不追加 user 纠错）。"
  @spec append_validation(t(), String.t(), String.t(), String.t(), map()) :: t()
  def append_validation(transcript, call_id, status, reason_code, detail \\ %{}) do
    block = RequestIR.validation_result_block(call_id, status, reason_code, detail)
    message = RequestIR.message(:tool, :tool_result, [block])
    %{transcript | messages: transcript.messages ++ [message]}
  end

  @doc "追加一次真实 Provider 响应，保留原生工具调用及无效参数原文供校验纠错。"
  @spec append_provider_result(t(), map()) :: t()
  def append_provider_result(transcript, result) do
    with {:ok, ir} <- to_request_ir(transcript),
         {ir, _result} <- RequestIR.append_assistant_result(ir, result),
         {:ok, restored} <- from_request_ir(ir) do
      restored
    end
  end

  @doc "从跨层 Request IR 恢复 application canonical transcript，不调用 Provider。"
  @spec from_request_ir(RequestIR.t()) :: {:ok, t()} | {:error, term()}
  def from_request_ir(%RequestIR{} = ir) do
    with :ok <- RequestIR.validate(ir) do
      {:ok,
       %{
         run: ir.run,
         system: system_run_rules(ir.system),
         messages: ir.messages,
         tools: ir.tools,
         base_refs: Map.get(ir.refs, :base_refs, []),
         observation_refs: Map.get(ir.refs, :observation_refs, []),
         used_refs: Map.get(ir.refs, :used_refs, []),
         projection: ir.projection,
         call_ids:
           for(
             message <- ir.messages,
             block <- Map.get(message, :blocks, []),
             Map.get(block, :type) == "tool_call",
             do: Map.get(block, :call_id)
           )
       }}
    end
  end

  @doc "追加无工具调用时的应用协议反馈；它不是作者的新指令。"
  @spec append_application_notice(t(), String.t()) :: t()
  def append_application_notice(transcript, text) when is_binary(text) do
    message = RequestIR.message(:application_notice, :application, [RequestIR.text_block(text)])
    %{transcript | messages: transcript.messages ++ [message]}
  end

  @doc "追加作者出口（机器消息链结束；不投影为 provider 消息）。"
  @spec append_author_exit(t(), String.t(), map()) :: t()
  def append_author_exit(transcript, kind, refs \\ %{}) do
    block = RequestIR.author_exit_block(kind, refs)
    message = RequestIR.message(:author_exit, :application, [block])
    %{transcript | messages: transcript.messages ++ [message]}
  end

  @doc "追加按调用号绑定的压缩事件；canonical 原文保留，只有 Provider 投影折叠历史。"
  @spec compact(t(), map(), [map()], map(), [String.t()], String.t()) ::
          {:ok, t()} | {:error, term()}
  def compact(transcript, covers, source_refs, versions, omissions, summary) do
    with :ok <- Compaction.require_call_ids(covers) do
      block = RequestIR.checkpoint_block(covers, source_refs, versions, omissions, summary)
      checkpoint = RequestIR.message(:checkpoint, :application, [block])

      if checkpoint in transcript.messages,
        do: {:ok, transcript},
        else: append_compaction(transcript, checkpoint)
    end
  end

  defp append_compaction(transcript, checkpoint) do
    compacted = %{transcript | messages: transcript.messages ++ [checkpoint]}

    with :ok <- Compaction.validate(compacted.messages),
         {:ok, _ir} <- to_request_ir(compacted) do
      {:ok, compacted}
    end
  end

  @doc "声明模型对来源的使用（机械校验 ⊆ Base ∪ 观察）。"
  @spec declare_used_refs(t(), [String.t()]) :: t()
  def declare_used_refs(transcript, refs) when is_list(refs) do
    %{transcript | used_refs: refs}
  end

  @doc "组装 Request IR v1（校验在 `RequestIR.validate/1` 与调用方一起完成）。"
  @spec to_request_ir(t(), keyword()) :: {:ok, RequestIR.t()} | {:error, term()}
  def to_request_ir(transcript, opts \\ []) do
    ir =
      RequestIR.new(%{
        run: transcript.run,
        system: system_envelope(transcript.system),
        messages: transcript.messages,
        tools: transcript.tools,
        projection: Map.merge(transcript.projection, Map.new(opts)),
        refs: %{
          base_refs: transcript.base_refs,
          observation_refs: transcript.observation_refs,
          used_refs: transcript.used_refs
        }
      })

    case RequestIR.validate(ir) do
      :ok -> {:ok, ir}
      error -> error
    end
  end

  # 产品身份（SystemIdentity 真源）是运行时常量，不随 transcript/checkpoint 持久化；
  # 持久化与恢复只保留 run 级角色规则与版本引用（VS-00L §3.2/§4）。
  @system_run_fields [
    :instructions,
    :run_role,
    :constitution_version,
    :output_protocol_version,
    :output_schema_ref
  ]

  @doc "只保留 run 级 system 规则（checkpoint 编码用；不含动态 system 文本）。"
  def system_run_rules(system) when is_map(system) do
    Map.take(system, @system_run_fields)
  end

  def system_run_rules(_system), do: %{}

  defp system_envelope(system) when is_map(system) do
    RequestIR.system_envelope(
      instructions: system_field(system, :instructions),
      run_role: system_field(system, :run_role),
      constitution_version: system_field(system, :constitution_version),
      output_protocol_version: system_field(system, :output_protocol_version),
      output_schema_ref: system_field(system, :output_schema_ref)
    )
  end

  defp system_envelope(_system), do: RequestIR.system_envelope()

  defp system_field(system, key), do: Map.get(system, key) || Map.get(system, to_string(key))

  defp refs_of(observation) do
    case Map.get(observation, :source_refs, []) do
      refs when is_list(refs) -> refs
      _ -> []
    end
  end
end
