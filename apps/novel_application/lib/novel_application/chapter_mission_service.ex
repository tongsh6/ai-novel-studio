defmodule NovelApplication.ChapterMissionService do
  @moduledoc """
  写前推理（WR01 / VS-00E §16）：携带材料 → 模型一次 native tool-call → `ChapterMission`。

  - 机械半边在 `NovelDomain.ChapterMissionInputs`（选取与 ref 列名），本模块只负责
    prompt、一次 `chapter_mission` 工具调用、解析、依据绑定（I-M1）与叙事绑定（I-M3）。
  - 结构、来源或可见字段不合约时携带原因重试一次，与计划起草器同模式。
  - 作者说明只取 `arguments.author_reasoning` 原字节，content 只能缺席或为空。
    闭合 schema、原始调用来源与全部作者可见字段均验收后，使命才能进入简报、
    持久化和叙事事件；任何拒收都由同一原生交换有界纠正。
  - 失败返回 `{:error, reason, meta}`，meta 带真实 `provider_call_count` 供预算核算；
    flow 按用户拍板「降级继续写」处理，本模块不做任何权威层写入（I-M2）。
  """

  alias NovelAgent.Provider.{Execution, NativeToolExchange}
  alias NovelApplication.AgentNarrativeSource
  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelApplication.AuthoringOperation
  alias NovelApplication.AuthoringTaskBuilder
  alias NovelApplication.JudgmentToolContract
  alias NovelCommon.AuthorVisible.Text
  alias NovelDomain.ChapterMission
  alias NovelDomain.ChapterMissionInputs
  alias NovelDomain.ChapterPlanDirection

  # kind（WR02）：:prose 写某章前 / :planning 按目标规划大纲前——两类调用点（prompt 目录
  # SSOT），工具名与锚点独立，值对象与绑定机制复用。
  @tool_names %{prose: "chapter_mission", planning: "planning_mission"}
  @prompt_anchors %{prose: "写前推理器", planning: "规划前推理器"}

  @type meta :: %{
          required(:provider_call_count) => non_neg_integer(),
          optional(:narrative) => String.t(),
          optional(:narrative_source) => map(),
          optional(:provider_call_ref) => String.t() | nil,
          optional(:judgment_transcript) => map()
        }

  @spec tool_name(:prose | :planning) :: String.t()
  def tool_name(kind \\ :prose), do: Map.fetch!(@tool_names, kind)

  @doc "真实使命阶段的角色锚点，供请求诊断识别当前推理职责。"
  @spec prompt_anchor(:prose | :planning) :: String.t()
  def prompt_anchor(kind \\ :prose), do: Map.fetch!(@prompt_anchors, kind)

  @doc """
  推导本章使命。`opts[:run]` 或 `opts[:snapshot]` 必须提供真实运行来源。
  `opts[:author_text]` 由应用会话边界按真实来源幂等记录为独立作者原话；
  `opts[:source_input_ref]` 由应用提供该原话的真实来源，不从目标版本推导。
  """
  @spec derive(ChapterMissionInputs.t(), Execution.dependency() | nil, keyword()) ::
          {:ok, ChapterMission.t(), meta()} | {:error, term(), meta()}
  def derive(%ChapterMissionInputs{} = inputs, provider_execution, opts \\ []) do
    kind = if Keyword.get(opts, :kind) == :planning, do: :planning, else: :prose

    case request_ir(inputs, kind, opts) do
      {:ok, ir} ->
        derive_with_execution(ir, inputs, provider_execution, kind)

      {:error, reason} ->
        {:error, reason, %{provider_call_count: 0}}
    end
  end

  defp derive_with_execution(ir, inputs, provider_execution, kind) do
    provider_execution = Execution.with_content_visibility(provider_execution, :developer)

    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) ->
        derive_from_exchange(ir, result_fn, inputs, kind)

      _ ->
        {:error, :provider_execution_missing,
         AuthoringOperation.metadata(%{request_ir: ir, provider_call_count: 0})}
    end
  end

  defp request_ir(inputs, kind, opts) do
    run = operation_run(opts)
    goal = map_get(run, :goal)

    versions =
      Keyword.get(opts, :versions, %{})
      |> Map.delete(:goal_version)
      |> Map.put("goal_version", map_get(goal, :version))

    material_refs = inputs |> ChapterMissionInputs.refs() |> Enum.sort() |> Enum.map(&%{ref: &1})

    AuthoringOperation.prepare(run, Keyword.get(opts, :snapshot), %{
      role: tool_name(kind),
      instructions: instructions(kind),
      scope: mission_scope(inputs, goal),
      tool: mission_tool(kind),
      source_refs: material_refs,
      base_refs: material_refs,
      versions: versions,
      # VS-00L §3.2（裁决 A）：版本引用进入 canonical system 前缀。
      system_versions: %{
        constitution_version: NovelApplication.AuthoringTaskPolicy.version(),
        output_protocol_version: NovelCommon.AuthoringSemantics.version()
      },
      author_text: Keyword.get(opts, :author_text),
      source_input_ref: Keyword.get(opts, :source_input_ref)
    })
  end

  defp operation_run(opts) do
    snapshot = Keyword.get(opts, :snapshot)

    Keyword.get(opts, :run) || map_get(snapshot, :run) ||
      map_get(AuthoringSession.transcript(snapshot), :run)
  end

  defp mission_scope(inputs, goal) do
    %{
      goal: goal || %{},
      operation: %{
        mission_inputs: %{
          mode: Atom.to_string(inputs.mode),
          chapter: mission_chapter(inputs.chapter),
          items:
            Enum.map(
              inputs.items,
              &Map.update!(&1, :group, fn group -> Atom.to_string(group) end)
            ),
          undated_foreshadow_count: inputs.undated_foreshadow_count,
          written_progress: inputs.written_progress
        }
      }
    }
  end

  defp mission_chapter(nil), do: nil

  defp mission_chapter(chapter) do
    Map.update!(chapter, :direction, &ChapterPlanDirection.to_storage/1)
  end

  defp instructions(kind) do
    """
    #{intro_line(kind)}

    要求：
    #{requirement_lines(kind)}

    - author_reasoning：唯一作者说明（第一人称，120 字以内）：核清了什么、判断是什么、
      只动哪里。content 必须为空，不另写解释。
    - statement 与条目 text 直接叙述创作内容；内部依据标识只放在 basis_ref。
    - 不要写正文；不要发明材料里没有的事实；不要引用材料之外的 ref。

    调用 #{tool_name(kind)} 工具返回结构，只调用这一个工具。
    """
  end

  defp intro_line(:prose) do
    """
    本次你承担#{prompt_anchor(:prose)}的角色。正文尚未开始写，请只根据下面列出的材料，
    推导「本章使命」：这一章现在必须推进什么、不得做什么。
    """
    |> String.trim()
  end

  defp intro_line(:planning) do
    """
    本次你承担#{prompt_anchor(:planning)}的角色。本轮大纲尚未起草，请根据当前目标的
    规划层级与下面列出的材料，推导「本轮规划使命」：本轮必须安排什么、不得安排什么。
    目标要求卷级规划时，使命停留在卷级；目标要求章计划时，才具体安排章节。
    """
    |> String.trim()
  end

  defp requirement_lines(:prose) do
    """
    - statement：一两句话说清这一章现在该干什么。优先处理已超期或本章到期的伏笔、停滞的
      弧光、沉寂的主线、偏离的题材承诺；没有这些压力就按本章计划推进。
    - must_advance：1 到 4 条，每条 text 具体可执行，basis_ref 必须精确复制 mission_inputs.items
      的 ref 或本次可见读取材料的 source_refs；仅有引用而没有可见内容的不构成依据。
    - must_avoid：0 到 3 条，后续章计划信息的保密与全书进度守则优先，basis_ref 同上。
    """
    |> String.trim()
  end

  defp requirement_lines(:planning) do
    """
    - statement：一两句话说清当前目标范围内要完成什么。优先给已超期或临近的伏笔安排回收、
      给停滞角色安排回归、让沉寂主线重新推进、守住题材承诺；并按全书进度控制节奏。
    - must_advance：1 到 4 条「本轮必须安排的事」，每条 text 在目标要求的卷级或章级范围内
      具体可执行，basis_ref 必须精确复制 mission_inputs.items 的 ref 或本次可见读取材料的
      source_refs；仅有引用而没有可见内容的不构成依据。
    - must_avoid：0 到 3 条「本轮不得安排的事」（不得超出作者要求的规划层级、距目标尚远
      不得提前收官、不得另立主导角色、不得提前揭示保密的计划信息等），basis_ref 同上。
    """
    |> String.trim()
  end

  @doc false
  @spec mission_tool(:prose | :planning) :: map()
  def mission_tool(kind \\ :prose) do
    item_schema = %{
      type: "object",
      required: ["text", "basis_ref"],
      additionalProperties: false,
      properties: %{
        text: %{type: "string", minLength: 1},
        basis_ref: %{type: "string", minLength: 1}
      }
    }

    %{
      name: tool_name(kind),
      description: "Return the mission derived only from the listed materials.",
      input_schema: %{
        type: "object",
        required: ["author_reasoning", "statement", "must_advance", "must_avoid", "confidence"],
        additionalProperties: false,
        properties: %{
          author_reasoning: %{type: "string", minLength: 1},
          statement: %{type: "string", minLength: 1},
          must_advance: %{type: "array", items: item_schema},
          must_avoid: %{type: "array", items: item_schema},
          confidence: %{type: "number", minimum: 0, maximum: 1}
        }
      }
    }
  end

  # 调用、失败回流与会话状态都由共享原生交换维护；本模块只解释使命契约。
  defp derive_from_exchange(ir, result_fn, inputs, kind) do
    {parsed, session} =
      NativeToolExchange.run(
        ir,
        result_fn,
        tool_name(kind),
        &parse_mission(&1, inputs, ir, kind),
        &exchange_error(&1, &2, tool_name(kind)),
        retry_transport: false,
        feedback: &mission_feedback(&1, kind)
      )

    case parsed do
      %{status: :ok, mission: mission} ->
        meta =
          AuthoringOperation.complete(session, "#{tool_name(kind)}_validated", %{
            mission_ref: ChapterMission.ref(mission),
            dropped_basis_count: length(mission.dropped),
            production_write_performed: false
          })

        {:ok, mission,
         Map.merge(meta, Map.take(parsed, [:narrative, :narrative_source, :provider_call_ref]))}

      %{status: :error, reason: reason} ->
        {:error, reason, AuthoringOperation.metadata(session)}
    end
  end

  defp parse_mission(provider_result, inputs, ir, kind) do
    with {:ok, args} <- tool_arguments(provider_result, kind),
         {:ok, narrative, source} <- narrative(provider_result, args, tool_name(kind)),
         :ok <- validate_mission_text(args) do
      mission = bound_mission(args, source, inputs, ir)

      %{
        status: :ok,
        mission: mission,
        narrative: narrative,
        narrative_source: source,
        provider_call_ref: mission.provider_call_ref
      }
    else
      {:error, reason} -> mission_error(reason)
    end
  end

  defp bound_mission(args, source, inputs, ir) do
    read_refs = ir |> AuthoringTaskBuilder.request_read_materials() |> Enum.map(& &1.ref)
    known_refs = MapSet.union(ChapterMissionInputs.refs(inputs), MapSet.new(read_refs))

    args
    |> ChapterMission.new()
    |> Map.put(:mission_id, NovelFoundation.ID.unique("cm"))
    |> Map.put(:provider_call_ref, source.provider_call_ref)
    |> ChapterMission.bind(
      known_refs,
      &ChapterMissionInputs.label(inputs, &1)
    )
  end

  defp exchange_error("native_tool_call_required", _detail, tool_name),
    do: mission_error({:native_tool_call_required, tool_name})

  defp exchange_error("provider_error", reason, _tool_name),
    do: mission_error(reason, "provider_error")

  defp exchange_error(code, reason, _tool_name), do: mission_error({code, reason}, code)

  defp mission_error(reason), do: mission_error(reason, reason_code(reason))
  defp mission_error(reason, code), do: %{status: :error, reason: reason, error: %{code: code}}
  defp reason_code({code, _}) when is_atom(code), do: Atom.to_string(code)
  defp reason_code(code) when is_atom(code), do: Atom.to_string(code)

  defp mission_feedback(parsed, kind) do
    message = """
    上一次输出无法使用（#{inspect(parsed.reason)}）。请重新调用 #{tool_name(kind)} 工具，且只调用这一个工具：
    - author_reasoning 是唯一作者说明；content 必须为空，不得另写解释或正文；
    - 严格使用工具字段，不得包裹调用信封或添加 basis_label 等额外字段；
    - author_reasoning、statement 与条目 text 应直接说明创作判断，不携带内部标识或协议；
    - statement 必填；must_advance / must_avoid 每条的 basis_ref 只能精确复制
      mission_inputs.items 的 ref，或本次有可见内容的读取材料 source_refs；
      不得引用隐藏材料或仅有引用的标识。
    """

    %{
      reason_code: parsed.error.code,
      message: message,
      detail: %{expected_tool: tool_name(kind), correction: message}
    }
  end

  # 原生交换维护名称与单调用边界；接收方核闭合 schema 与同一原始工具调用。
  defp tool_arguments(%{tool_calls: [call]} = provider_result, kind) do
    with {:ok, args} <- decode_arguments(map_get(call, :arguments)),
         true <- JudgmentToolContract.valid?(args, mission_tool(kind).input_schema),
         :ok <- AgentNarrativeSource.verify_tool_call(provider_result, call) do
      {:ok, args}
    else
      false -> {:error, :invalid_mission_tool_arguments}
      {:error, reason} -> {:error, reason}
    end
  end

  defp tool_arguments(_result, kind),
    do: {:error, {:native_tool_call_required, tool_name(kind)}}

  defp decode_arguments(args) when is_map(args), do: {:ok, args}

  defp decode_arguments(args) when is_binary(args) do
    case Jason.decode(args) do
      {:ok, %{} = decoded} -> {:ok, decoded}
      _ -> {:error, :native_tool_call_arguments_invalid}
    end
  end

  defp decode_arguments(_args), do: {:error, :native_tool_call_arguments_required}

  defp narrative(provider_result, args, tool_name) do
    content = map_get(provider_result, :content)
    reasoning = map_get(args, :author_reasoning)

    if content in [nil, ""] do
      with :ok <- Text.validate_narrative(reasoning),
           {:ok, source} <-
             AgentNarrativeSource.from_tool_call_narrative(provider_result, tool_name, reasoning) do
        {:ok, reasoning, source}
      end
    else
      {:error, :author_narrative_content_conflict}
    end
  end

  defp validate_mission_text(args) do
    items = map_get(args, :must_advance) ++ map_get(args, :must_avoid)
    texts = [map_get(args, :statement) | Enum.map(items, &map_get(&1, :text))]

    Enum.reduce_while(texts, :ok, fn text, :ok ->
      case Text.validate_narrative(text) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil
end
